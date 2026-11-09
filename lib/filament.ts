// Filament use per print, read from the sliced .3mf on the printer's SD card (FTPS, port 990).
// When a print starts, the file is downloaded once to a temp folder, the slicer's prediction for
// the plate being printed is read from Metadata/slice_info.config, and the file is deleted again.
// lib/printer.ts puts the grams on the job when it finishes (scaled by progress for failed prints).
import 'server-only';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Client, type FileInfo } from 'basic-ftp';
import { getPrinter, type Config } from './printer';
import { plateUsage } from './threemf';
import type { JobFilament, PrintState } from './types';

const MAX_FILE = 500 * 1024 * 1024;
const RETRIES = [20, 60, 180, 600]; // seconds after the print started
const DIRS = ['/', '/cache', '/sdcard', '/sdcard/cache'];

const base = (p: string) => p.split('/').pop() ?? p;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The printer's FTP server only gives `ls`-style dates: "Jul 29 18:44" (recent, year left out)
 * or "Mar 05 2026". Without a year, it's the most recent such date that isn't in the future.
 */
function modified(f: FileInfo): number {
  if (f.modifiedAt) return f.modifiedAt.getTime();
  const m = f.rawModifiedAt.trim().match(/^(\w{3})\s+(\d{1,2})\s+(?:(\d{4})|(\d{1,2}):(\d{2}))$/);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (!m || month < 0) return 0;
  if (m[3]) return new Date(Number(m[3]), month, Number(m[2])).getTime();
  const now = new Date();
  const t = new Date(now.getFullYear(), month, Number(m[2]), Number(m[4]), Number(m[5]));
  if (t.getTime() > now.getTime() + 86_400_000) t.setFullYear(now.getFullYear() - 1);
  return t.getTime();
}

/** The plate being printed: from MQTT, the gcode path inside the 3MF, or the task name. */
function plateIndex(s: PrintState): number | null {
  const fromMqtt = Number(s.plate_idx);
  if (Number.isInteger(fromMqtt) && fromMqtt > 0) return fromMqtt;
  const m = (s.gcode_file ?? '').match(/plate_(\d+)\.gcode$/i) ?? (s.subtask_name ?? '').match(/_plate_(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/** File names that may hold the print, best guess first. */
function candidateNames(s: PrintState): string[] {
  const names: string[] = [];
  const file = (s.gcode_file ?? '').replace(/^(file|ftp):\/\/\/?/i, '');
  if (/\.3mf$/i.test(file)) names.push(base(file));
  const task = (s.subtask_name ?? '').trim();
  if (task) names.push(`${task}.gcode.3mf`, `${task}.3mf`);
  return [...new Set(names.map((n) => n.toLowerCase()))];
}

async function download(cfg: Config, s: PrintState): Promise<JobFilament | null> {
  const names = candidateNames(s);
  if (!names.length) return null;
  const client = new Client(30_000);
  const tmp = path.join(os.tmpdir(), `bambu-print-${crypto.randomBytes(6).toString('hex')}.3mf`);
  try {
    await client.access({
      host: cfg.printerIp, port: 990, user: 'bblp', password: cfg.accessCode,
      secure: 'implicit', secureOptions: { rejectUnauthorized: false }, // self-signed certificate
    });
    // Same name in several folders (e.g. an old /cache copy): the newest file wins.
    const found: { dir: string; f: FileInfo }[] = [];
    for (const dir of DIRS) {
      const list = await client.list(dir).catch(() => [] as FileInfo[]);
      for (const f of list) if (f.isFile && names.includes(f.name.toLowerCase())) found.push({ dir, f });
    }
    if (!found.length) return null;
    const rank = (x: { f: FileInfo }) => names.indexOf(x.f.name.toLowerCase());
    found.sort((a, b) => modified(b.f) - modified(a.f) || rank(a) - rank(b));
    const { dir, f } = found[0];
    if (f.size > MAX_FILE) return null;
    await client.downloadTo(tmp, path.posix.join(dir, f.name));
    const usage = plateUsage(tmp, plateIndex(s));
    return usage && { ...usage, file: f.name };
  } finally {
    client.close();
    fs.rm(tmp, { force: true }, () => {});
  }
}

let warned = false;

async function onJobStarted(jobId: number) {
  const p = getPrinter();
  if (p.demo) {
    p.jobFilament = { file: 'Benchy.gcode.3mf', plate: 1, grams: 14.6, filaments: [{ type: 'PLA', color: '#FFFFFF', grams: 14.6 }] };
    return;
  }
  for (const delay of RETRIES) {
    await new Promise((r) => setTimeout(r, delay * 1000 - (Date.now() - jobId)));
    if (p.jobId !== jobId || p.jobFilament) return; // print ended, or already known
    try {
      const usage = await download(p.config!, p.state);
      if (p.jobId !== jobId) return;
      if (usage) {
        p.jobFilament = usage;
        console.log(`[filament] ${usage.file}${usage.plate ? ` plate ${usage.plate}` : ''}: ${usage.grams} g`);
        return;
      }
    } catch (e) {
      if (!warned) console.warn('[filament] Could not read the print file from the printer (FTPS):', (e as Error).message);
      warned = true;
    }
  }
}

const g = globalThis as unknown as { __bambuFilament?: boolean };
/** Call once at startup. */
export function initFilament() {
  if (g.__bambuFilament) return;
  g.__bambuFilament = true;
  const p = getPrinter();
  p.on('jobStarted', (jobId: number) => { onJobStarted(jobId).catch(() => {}); });
  // A print that was already running when the server started (its jobStarted came before this listener).
  if (p.jobId) onJobStarted(p.jobId).catch(() => {});
}
