// Backup and restore of everything in data/ as one ZIP: settings, print history, maintenance,
// projects with their model files and previews. The password (auth.json) is left out on purpose:
// restoring is only possible while logged in, so the current password simply stays.
import 'server-only';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getPrinter } from './printer';
import { reloadMaintenance } from './maintenance';
import { reloadProjects, UserError } from './projects';
import { reloadSettings } from './settings';
import { extractToFile, listEntries, zipStream, type ZipSource } from './zip';

const DATA = path.join(process.cwd(), 'data');
const MANIFEST = 'bambu-backup.json';
const APP = 'bambu-dashboard';
/** Never in a backup and never overwritten by a restore. */
const KEEP = new Set(['auth.json']);

/** A path inside data/ that may be backed up or restored, as its parts; null when not allowed. */
function allowed(rel: string): string[] | null {
  if (!rel || rel.includes('\\') || rel.startsWith('/') || /^[a-z]:/i.test(rel)) return null;
  const parts = rel.split('/');
  // Dot files are temporary (uploads, restores in progress); ".." would escape data/.
  if (parts.some((p) => !p || p.startsWith('.') || p.endsWith('.tmp'))) return null;
  if (parts.length === 1 && (KEEP.has(parts[0]) || parts[0] === MANIFEST)) return null;
  return parts;
}

function* walk(dir: string, rel = ''): Generator<ZipSource> {
  let items: fs.Dirent[];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${item.name}` : item.name;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) { if (!item.name.startsWith('.')) yield* walk(full, r); continue; }
    if (!item.isFile() || !allowed(r)) continue;
    try { yield { name: r, path: full, mtime: fs.statSync(full).mtime }; } catch { /* removed meanwhile */ }
  }
}

export function backupFileName() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `bambu-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}

/** The whole backup as a stream of ZIP chunks. */
export function backupStream() {
  const manifest = { app: APP, format: 1, createdAt: new Date().toISOString(), printer: getPrinter().info.name };
  function* sources(): Generator<ZipSource> {
    yield { name: MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2)), mtime: new Date() };
    yield* walk(DATA);
  }
  return zipStream(sources());
}

const g = globalThis as unknown as { __bambuRestoring?: boolean };

/**
 * Replaces the contents of data/ (except the password) with the backup in `zipPath`.
 * Everything is unpacked and checked first; only then are the old files swapped out.
 */
export async function restoreBackup(zipPath: string): Promise<{ files: number; createdAt: string | null }> {
  if (g.__bambuRestoring) throw new UserError('A restore is already running', 409);
  g.__bambuRestoring = true;
  const id = crypto.randomBytes(4).toString('hex');
  const staging = path.join(DATA, `.restore-${id}`);
  const old = path.join(DATA, `.restore-old-${id}`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(zipPath, 'r');
    let entries;
    try { entries = listEntries(fd, fs.fstatSync(fd).size); } catch { throw new UserError('This is not a ZIP file'); }

    const manifestEntry = entries.find((e) => e.name === MANIFEST);
    if (!manifestEntry) throw new UserError('This ZIP is not a Bambu Dashboard backup');
    const manifestFile = path.join(DATA, `.restore-${id}.json`);
    let manifest: { app?: string; createdAt?: string };
    try {
      await extractToFile(fd, zipPath, manifestEntry, manifestFile);
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch { throw new UserError('The backup is damaged (unreadable manifest)'); } finally { fs.rmSync(manifestFile, { force: true }); }
    if (manifest.app !== APP) throw new UserError('This ZIP is not a Bambu Dashboard backup');

    const files = entries.filter((e) => !e.name.endsWith('/') && e.name !== MANIFEST);
    for (const e of files) {
      if (!allowed(e.name) && !KEEP.has(e.name)) throw new UserError(`The backup contains a file that isn't allowed: ${e.name}`);
    }
    const toRestore = files.filter((e) => allowed(e.name));
    const total = toRestore.reduce((n, e) => n + e.size, 0);
    try {
      const fsStat = fs.statfsSync(DATA);
      if (fsStat.bavail * fsStat.bsize < total + 50 * 1024 * 1024) throw new UserError(`Not enough free disk space to restore (${Math.ceil(total / 1024 / 1024)} MB needed)`, 507);
    } catch (e) { if (e instanceof UserError) throw e; /* statfs unsupported: just try */ }

    // 1. Unpack everything into a staging folder, checking every file's CRC.
    for (const e of toRestore) {
      const dest = path.join(staging, ...allowed(e.name)!);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try { await extractToFile(fd, zipPath, e, dest); } catch (err) { throw new UserError(`The backup is damaged: ${(err as Error).message}`); }
    }
    fs.mkdirSync(staging, { recursive: true });

    // 2. Swap: move the current data aside, move the restored data in. Undo on failure.
    const current = fs.readdirSync(DATA).filter((n) => !n.startsWith('.') && !KEEP.has(n));
    fs.mkdirSync(old, { recursive: true });
    const movedOut: string[] = [], movedIn: string[] = [];
    try {
      for (const n of current) { fs.renameSync(path.join(DATA, n), path.join(old, n)); movedOut.push(n); }
      for (const n of fs.readdirSync(staging)) { fs.renameSync(path.join(staging, n), path.join(DATA, n)); movedIn.push(n); }
    } catch (err) {
      for (const n of movedIn) try { fs.rmSync(path.join(DATA, n), { recursive: true, force: true }); } catch { /* best effort */ }
      for (const n of movedOut) try { fs.renameSync(path.join(old, n), path.join(DATA, n)); } catch { /* best effort */ }
      throw err;
    }

    // 3. Load the restored data into the running server.
    reloadSettings();
    reloadMaintenance();
    reloadProjects();
    getPrinter().loadData();
    return { files: toRestore.length, createdAt: manifest.createdAt ?? null };
  } finally {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    g.__bambuRestoring = false;
  }
}

/** Removes leftovers of an interrupted restore (temp folders and uploads). */
export function cleanRestoreLeftovers() {
  try {
    for (const n of fs.readdirSync(DATA)) if (n.startsWith('.restore-')) fs.rmSync(path.join(DATA, n), { recursive: true, force: true });
  } catch { /* no data folder yet */ }
}
