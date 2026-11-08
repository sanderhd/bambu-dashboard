// User settings stored in data/settings.json (survives Docker rebuilds via the data volume).
// Contains the Home Assistant token, so the file is only readable by the app (mode 600).
import 'server-only';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { CameraConfig, HaSettings, Settings } from './types';

const FILE = path.join(process.cwd(), 'data', 'settings.json');
const DEFAULTS: Settings = { cameras: [] };
const MAX_CAMERAS = 10;
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

const g = globalThis as unknown as { __bambuSettings?: { data: Settings; events: EventEmitter } };
const store = (g.__bambuSettings ??= { data: load(), events: new EventEmitter() });

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settingsEvents = store.events;
export const getSettings = (): Settings => store.data;

/** Settings as sent to the browser: the Home Assistant token never leaves the server. */
export function publicSettings() {
  const { ha, ...rest } = store.data;
  return { ...rest, ha: ha ? { url: ha.url, powerEntity: ha.powerEntity, energyEntity: ha.energyEntity, tokenSet: !!ha.token } : null };
}

/** Validates and normalises a camera list coming from the browser. Throws on bad input. */
export function validateCameras(input: unknown): CameraConfig[] {
  if (!Array.isArray(input)) throw new Error('cameras must be a list');
  if (input.length > MAX_CAMERAS) throw new Error(`At most ${MAX_CAMERAS} cameras`);
  return input.map((c, i) => {
    const name = String(c?.name ?? '').trim();
    const url = String(c?.url ?? '').trim();
    if (!name || name.length > 50) throw new Error(`Camera ${i + 1}: name must be 1–50 characters`);
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error(`Camera "${name}": invalid URL`); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`Camera "${name}": URL must start with http:// or https://`);
    const id = typeof c?.id === 'string' && /^[a-z0-9-]{1,40}$/.test(c.id) && c.id !== 'printer' ? c.id : crypto.randomUUID().slice(0, 8);
    return { id, name, type: 'mjpeg' as const, url: parsed.toString() };
  });
}

/**
 * Home Assistant settings from the browser. An empty token keeps the saved one,
 * so the browser never needs to know it. `null` turns the integration off.
 */
export function validateHa(input: unknown): HaSettings | undefined {
  if (input === null) return undefined;
  const i = (input ?? {}) as Record<string, unknown>;
  const url = String(i.url ?? '').trim().replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Home Assistant URL is invalid'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Home Assistant URL must start with http:// or https://');
  const powerEntity = String(i.powerEntity ?? '').trim();
  const energyEntity = String(i.energyEntity ?? '').trim();
  if (powerEntity && !ENTITY.test(powerEntity)) throw new Error('Power sensor must look like sensor.my_plug_power');
  if (energyEntity && !ENTITY.test(energyEntity)) throw new Error('Energy sensor must look like sensor.my_plug_energy');
  const token = String(i.token ?? '').trim() || store.data.ha?.token;
  if (!token) throw new Error('Enter a long-lived access token');
  if (token.length > 1000) throw new Error('Token is too long');
  return { url, token, powerEntity, energyEntity };
}

export function validatePrintHours(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error('Print hours must be a number from 0 to 100000');
  return Math.round(n * 10) / 10;
}

export function saveSettings(patch: Partial<Settings>) {
  const next: Settings = { ...store.data, ...patch };
  for (const k of Object.keys(next) as (keyof Settings)[]) if (next[k] === undefined) delete next[k];
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.chmodSync(FILE, 0o600); // also tightens files created by older versions
  store.data = next;
  store.events.emit('change', next);
  return next;
}
