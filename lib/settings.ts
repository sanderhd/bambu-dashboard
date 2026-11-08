// User settings stored in data/settings.json (survives Docker rebuilds via the data volume).
import 'server-only';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { CameraConfig, Settings } from './types';

const FILE = path.join(process.cwd(), 'data', 'settings.json');
const DEFAULTS: Settings = { cameras: [] };
const MAX_CAMERAS = 10;

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

export function saveSettings(patch: Partial<Settings>) {
  const next: Settings = { ...store.data, ...patch };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  store.data = next;
  store.events.emit('change', next);
  return next;
}
