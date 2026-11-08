// Password login with signed session cookies. No database: the password hash and the
// signing secret live in data/auth.json (mode 600). Changing the password rotates the
// secret, which logs out every existing session.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;
const FILE = path.join(process.cwd(), 'data', 'auth.json');
export const SESSION_COOKIE = 'bd_session';
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, in seconds
export const MIN_PASSWORD_LENGTH = 8;

type AuthFile = { salt: string; hash: string; secret: string };

let cache: { mtime: number; data: AuthFile } | null = null;
function read(): AuthFile | null {
  try {
    const { mtimeMs } = fs.statSync(FILE);
    if (cache?.mtime === mtimeMs) return cache.data;
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8')) as AuthFile;
    cache = { mtime: mtimeMs, data };
    return data;
  } catch {
    return null;
  }
}

function write(data: AuthFile) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  cache = null;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (secret: string, payload: string) => b64url(crypto.createHmac('sha256', secret).update(payload).digest());
const newSecret = () => crypto.randomBytes(32).toString('base64');

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export const isConfigured = () => read() !== null;

/** Sets a new password. Rotating the secret logs out all sessions. */
export async function setPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const salt = crypto.randomBytes(16).toString('base64');
  const hash = (await scrypt(password, salt, 64)).toString('base64');
  write({ salt, hash, secret: newSecret() });
}

export async function verifyPassword(password: string) {
  const a = read();
  if (!a) return false;
  const hash = (await scrypt(password, a.salt, 64)).toString('base64');
  return safeEqual(hash, a.hash);
}

/** Invalidates every session, including the current one. */
export function rotateSecret() {
  const a = read();
  if (a) write({ ...a, secret: newSecret() });
}

export function createSessionToken() {
  const a = read();
  if (!a) throw new Error('No password set');
  const payload = b64url(JSON.stringify({ exp: Date.now() + SESSION_MAX_AGE * 1000 }));
  return `${payload}.${sign(a.secret, payload)}`;
}

export function verifySessionToken(token?: string | null) {
  if (!token) return false;
  const a = read();
  if (!a) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(a.secret, payload))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}

function cookieFromRequest(req: Request) {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const isLoggedIn = (req: Request) => verifySessionToken(cookieFromRequest(req));

/** For API routes: returns a 401 response when the request has no valid session. */
export function requireSession(req: Request): Response | null {
  return isLoggedIn(req) ? null : Response.json({ ok: false, error: 'Not logged in' }, { status: 401 });
}

/** Set-Cookie header value. `Secure` only when the dashboard is served over HTTPS. */
export function sessionCookie(req: Request, token: string | null) {
  const https = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  const parts = [
    `${SESSION_COOKIE}=${token ?? ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${token ? SESSION_MAX_AGE : 0}`,
  ];
  if (https) parts.push('Secure');
  return parts.join('; ');
}
