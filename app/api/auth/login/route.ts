import { createSessionToken, isConfigured, sessionCookie, verifyPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Brute-force protection: after 5 wrong passwords, wait (doubling, up to 15 min).
// Counted for all clients together: forwarded-for headers can be faked, so they can't be trusted here.
const g = globalThis as unknown as { __bambuLoginFails?: Map<string, { count: number; until: number }> };
const fails = (g.__bambuLoginFails ??= new Map());

export async function POST(req: Request) {
  if (!isConfigured()) return Response.json({ ok: false, error: 'No password set yet' }, { status: 409 });

  const key = 'all';
  const f = fails.get(key);
  if (f && f.until > Date.now()) {
    const s = Math.ceil((f.until - Date.now()) / 1000);
    return Response.json({ ok: false, error: `Too many attempts. Try again in ${s} seconds.` }, { status: 429 });
  }

  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== 'string' || !(await verifyPassword(password))) {
    const count = (f?.count ?? 0) + 1;
    const lock = count >= 5 ? Math.min(15 * 60_000, 30_000 * 2 ** (count - 5)) : 0;
    fails.set(key, { count, until: Date.now() + lock });
    return Response.json({ ok: false, error: 'Wrong password' }, { status: 401 });
  }

  fails.delete(key);
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(req, createSessionToken()) } });
}
