// Keeps AFFiNE pages up to date: one page per project (an overview and a print log that the dashboard
// rewrites, then your own notes, which it never touches), one page for prints without a project,
// and report pages on request. Which blocks belong to the dashboard is remembered in data/affine.json.
import 'server-only';
import fs from 'fs';
import path from 'path';
import * as A from './affine';
import { fmtDur } from './format';
import { getPrinter } from './printer';
import { getProject, projectEvents, UserError } from './projects';
import { getSettings } from './settings';
import type { AffineBlock, AffineSettings, PrintJob, Project, ReportBlock } from './types';

const FILE = path.join(process.cwd(), 'data', 'affine.json');
const OTHER = 'other';
const FINISH_DELAY_MS = 12_000; // after project counting, filament and Home Assistant energy are filled in
const PROJECT_DEBOUNCE_MS = 60_000;
const RETRY_MS = 10 * 60 * 1000;
const BACKFILL = 300; // rows written when a print log page is first created
const STATUS: Record<Project['status'], string> = { planning: 'Planning', active: 'Active', paused: 'Paused', done: 'Done' };

type PageState = {
  docId: string;
  /** Overview blocks, replaced on every update. */
  summary: string[];
  logHeading?: string;
  table?: string;
  /** Print (by end time) → table row, so each print is written once. */
  rows: Record<string, string>;
  /** Project.updatedAt that the page shows. */
  synced?: number;
  /** Put in its sidebar folder (done once, so moving it elsewhere in AFFiNE sticks). */
  filed?: boolean;
  /** Snapshot pages of this project, newest first; linked from the overview so they nest under it. */
  snapshots?: string[];
};

/** The dashboard's folders in AFFiNE's sidebar ("Organize"). */
const FOLDERS: A.FolderSpec[] = [
  { key: 'root', name: 'Bambu Dashboard', parent: null },
  { key: 'projects', name: 'Projects', parent: 'root' },
  { key: 'reports', name: 'Reports', parent: 'root' },
  { key: 'history', name: 'History', parent: 'reports' },
  { key: 'stats', name: 'Stats', parent: 'reports' },
];
const MAX_SNAPSHOT_LINKS = 30;

type State = {
  url?: string;
  workspaceId?: string;
  pages: Record<string, PageState>;
  /** Pages that still need an update because AFFiNE couldn't be reached. */
  dirty: string[];
  lastSync?: number;
  lastError?: { at: number; message: string } | null;
  /** FOLDERS key → AFFiNE folder id. */
  folders?: Record<string, string>;
};

// ---------------------------------------------------------------- state
const g = globalThis as unknown as { __bambuAffine?: { state: State; hooked?: boolean } };
const store = (g.__bambuAffine ??= { state: loadState() });

function loadState(): State {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { pages: s.pages ?? {}, dirty: s.dirty ?? [], url: s.url, workspaceId: s.workspaceId, lastSync: s.lastSync, lastError: s.lastError };
  } catch {
    return { pages: {}, dirty: [] };
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store.state));
  fs.renameSync(tmp, FILE);
}

/** Re-reads data/affine.json, e.g. after restoring a backup. */
export function reloadAffine() { store.state = loadState(); }

/** The saved settings; pages from another server or workspace are forgotten. */
function config(): AffineSettings {
  const cfg = getSettings().affine;
  if (!cfg) throw new UserError('AFFiNE is not set up. Add it under Settings.');
  const st = store.state;
  if (st.url !== cfg.url || st.workspaceId !== cfg.workspaceId) {
    store.state = { url: cfg.url, workspaceId: cfg.workspaceId, pages: {}, dirty: [] };
    saveState();
  }
  return cfg;
}

const auth = (c: AffineSettings): A.AffineAuth => ({ url: c.url, email: c.email, password: c.password });

function markDirty(key: string, dirty: boolean) {
  const has = store.state.dirty.includes(key);
  if (dirty && !has) store.state.dirty.push(key);
  if (!dirty && has) store.state.dirty = store.state.dirty.filter((k) => k !== key);
}

function recordError(e: unknown) {
  const message = e instanceof A.AffineError || e instanceof UserError ? e.message : 'Unexpected error, see the server log';
  if (!(e instanceof A.AffineError) && !(e instanceof UserError)) console.error('[affine]', e);
  else console.warn('[affine]', message);
  store.state.lastError = { at: Date.now(), message };
  saveState();
  return message;
}

// ---------------------------------------------------------------- formatting
const jobKey = (j: PrintJob) => String(j.ended);

function when(t: number, timeZone?: string) {
  // sv-SE formats as 2026-11-09 14:02: unambiguous in every language.
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(t);
}

const grams = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`);

function filament(j: PrintJob) {
  if (j.grams == null) return '–';
  const types = [...new Set((j.filaments ?? []).map((f) => f.type).filter(Boolean))];
  return types.length ? `${grams(j.grams)} ${types.join('/')}` : grams(j.grams);
}

function jobRow(j: PrintJob, name: string, tz?: string) {
  return [
    when(j.ended, tz),
    name,
    j.result === 'FINISH' ? '✅ Succeeded' : '❌ Failed',
    j.started ? fmtDur((j.ended - j.started) / 60000) : '–',
    filament(j),
    j.energyKwh != null ? `${j.energyKwh.toFixed(2)} kWh` : '–',
  ];
}

const header = (what: string) => ['Finished', what, 'Result', 'Duration', 'Filament', 'Energy'];

function projectSummary(p: Project, jobs: PrintJob[], tz?: string, snapshots: string[] = []): A.WriteBlock[] {
  const needed = p.parts.reduce((n, x) => n + x.quantity, 0);
  const printed = p.parts.reduce((n, x) => n + Math.min(x.printed, x.quantity), 0);
  const failed = p.parts.reduce((n, x) => n + x.failed, 0);
  const done = p.parts.filter((x) => x.quantity > 0 && x.printed >= x.quantity).length;
  const left = (x: Project['parts'][number]) => Math.max(0, x.quantity - x.printed);
  const withTime = p.parts.filter((x) => x.minutesPerPiece != null);
  const withGrams = p.parts.filter((x) => x.gramsPerPiece != null);
  const usedGrams = jobs.reduce((n, j) => n + (j.grams ?? 0), 0);
  const usedKwh = jobs.reduce((n, j) => n + (j.energyKwh ?? 0), 0);
  const ok = jobs.filter((j) => j.result === 'FINISH').length;

  const out: A.WriteBlock[] = [{ t: 'h2', text: 'Overview' }];
  if (p.description) out.push({ t: 'quote', text: p.description });
  out.push({ t: 'li', text: `Status: ${STATUS[p.status]}` });
  out.push({ t: 'li', text: `Pieces: ${printed} of ${needed} printed${needed ? ` (${Math.round((printed / needed) * 100)}%)` : ''}${failed ? `, ${failed} failed` : ''}` });
  out.push({ t: 'li', text: `Parts finished: ${done} of ${p.parts.length}` });
  if (withTime.length) out.push({ t: 'li', text: `Print time left: ~${fmtDur(withTime.reduce((n, x) => n + left(x) * x.minutesPerPiece!, 0))}` });
  if (withGrams.length) out.push({ t: 'li', text: `Filament left: ~${grams(withGrams.reduce((n, x) => n + left(x) * x.gramsPerPiece!, 0))}` });
  if (jobs.length) {
    out.push({ t: 'li', text: `Prints so far: ${jobs.length} (${ok} succeeded)${usedGrams ? `, ${grams(usedGrams)} filament` : ''}${usedKwh ? `, ${usedKwh.toFixed(1)} kWh` : ''}` });
  }
  if (p.parts.length) {
    out.push({
      t: 'table',
      rows: [['Part', 'Printed', 'Failed', 'Material', 'Per print'], ...p.parts.map((x) => [
        x.name, `${x.printed} / ${x.quantity}${x.quantity > 0 && x.printed >= x.quantity ? ' ✓' : ''}`, String(x.failed),
        x.material || '–', String(x.perPlate),
      ])],
    });
  }
  if (snapshots.length) {
    out.push({ t: 'h3', text: 'Snapshots' });
    for (const pageId of snapshots.slice(0, MAX_SNAPSHOT_LINKS)) out.push({ t: 'link', pageId });
  }
  out.push({ t: 'p', text: `Updated by Bambu Dashboard on ${when(Date.now(), tz)}. The overview and the print log are rewritten automatically; write your own notes under "Notes".` });
  return out;
}

// ---------------------------------------------------------------- pages
type PageSpec = { key: string; title: string; summary: A.WriteBlock[]; what: string; jobs: PrintJob[]; name: (j: PrintJob) => string };

/** Creates the page, or updates its overview and adds new prints to its log. */
async function syncPage(s: A.Session, spec: PageSpec, tz?: string): Promise<PageState> {
  const st = store.state;
  let ps: PageState | undefined = st.pages[spec.key];
  const root = await s.load(s.workspaceId);
  if (ps && !(root && A.pageEntry(root, ps.docId))) ps = undefined; // deleted or in the trash: start a new page
  root?.destroy();
  const row = (j: PrintJob) => jobRow(j, spec.name(j), tz);

  if (!ps) {
    const jobs = spec.jobs.slice(0, BACKFILL);
    const n = spec.summary.length;
    // Snapshots are separate pages: they survive a deleted project page and get linked from the new one.
    const next: PageState = { docId: '', summary: [], rows: {}, snapshots: st.pages[spec.key]?.snapshots };
    next.docId = await A.createPage(s, spec.title, [
      ...spec.summary,
      { t: 'h2', text: 'Print log' },
      { t: 'table', rows: [header(spec.what)] },
      { t: 'h2', text: 'Notes' },
      { t: 'p', text: '' },
    ], (doc, ids) => {
      next.summary = ids.slice(0, n);
      next.logHeading = ids[n];
      next.table = ids[n + 1];
      const rowIds = A.insertRowsAtTop(A.blocksOf(doc).get(next.table)!, jobs.map(row));
      jobs.forEach((j, i) => { next.rows[jobKey(j)] = rowIds[i]; });
    });
    return next;
  }

  const next: PageState = structuredClone(ps);
  await s.change(ps.docId, (doc) => {
    const blocks = A.blocksOf(doc);
    A.setPageTitle(doc, spec.title);
    const anchor = [...next.summary, next.logHeading, next.table].find((id) => id && blocks.has(id));
    const note = A.bodyNote(doc, anchor);
    if (!note) throw new A.AffineError('The AFFiNE page has no text body');
    const kids = note.get('sys:children') as A.Y.Array<string>;
    // The overview goes where it was (or at the top when it was removed).
    let at = kids.toArray().findIndex((id) => next.summary.includes(id));
    if (at < 0) at = 0;
    for (const id of next.summary) A.deleteBlock(doc, id);
    next.summary = A.createBlocks(blocks, spec.summary);
    at = Math.min(at, kids.length);
    kids.insert(at, next.summary);

    let table = next.table ? blocks.get(next.table) : undefined;
    if (!table) {
      // The log was removed: add a fresh one below the overview.
      if (next.logHeading) A.deleteBlock(doc, next.logHeading);
      const [h, t] = A.createBlocks(blocks, [{ t: 'h2', text: 'Print log' }, { t: 'table', rows: [header(spec.what)] }]);
      kids.insert(Math.min(at + next.summary.length, kids.length), [h, t]);
      next.logHeading = h;
      next.table = t;
      next.rows = {};
      table = blocks.get(t)!;
    }
    // Rows you deleted in AFFiNE stay deleted: only prints never written are added.
    const fresh = spec.jobs.slice(0, BACKFILL).filter((j) => !(jobKey(j) in next.rows));
    if (fresh.length) {
      const ids = A.insertRowsAtTop(table, fresh.map(row));
      fresh.forEach((j, i) => { next.rows[jobKey(j)] = ids[i]; });
    }
  });
  await A.touchPage(s, ps.docId, spec.title);
  return next;
}

const history = () => getPrinter().printHistory; // newest first

function projectSpec(p: Project, tz?: string): PageSpec {
  const jobs = history().filter((j) => j.counted?.projectId === p.id);
  return { key: p.id, title: `${p.name} · 3D print`, summary: projectSummary(p, jobs, tz, store.state.pages[p.id]?.snapshots), what: 'Part', jobs, name: (j) => j.counted?.partName ?? j.name };
}

function otherSpec(tz?: string): PageSpec {
  const jobs = history().filter((j) => !j.counted);
  return {
    key: OTHER,
    title: 'Print log · other prints',
    summary: [{ t: 'p', text: `Prints that weren't counted on a project. Updated by Bambu Dashboard on ${when(Date.now(), tz)}.` }],
    what: 'Print',
    jobs,
    name: (j) => j.name,
  };
}

/** Updates (or creates) pages by key: a project id or "other". Returns the keys that failed. */
async function syncKeys(keys: string[], create: boolean): Promise<void> {
  const cfg = config();
  const specs: PageSpec[] = [];
  for (const key of new Set(keys)) {
    if (!create && !store.state.pages[key]) { markDirty(key, false); continue; }
    if (key === OTHER) { specs.push(otherSpec(cfg.timeZone)); continue; }
    let p: Project;
    try { p = getProject(key); } catch { markDirty(key, false); continue; } // project deleted
    specs.push(projectSpec(p, cfg.timeZone));
  }
  if (!specs.length) { saveState(); return; }
  specs.forEach((sp) => markDirty(sp.key, true));
  saveState();
  await A.withWorkspace(auth(cfg), cfg.workspaceId, async (s) => {
    for (const spec of specs) {
      const ps = await syncPage(s, spec, cfg.timeZone);
      if (!ps.filed) {
        const folders = await folderIds(s);
        await A.fileInFolder(s, spec.key === OTHER ? folders.root : folders.projects, ps.docId);
        ps.filed = true;
      }
      if (spec.key !== OTHER) ps.synced = getProject(spec.key).updatedAt;
      store.state.pages[spec.key] = ps;
      markDirty(spec.key, false);
      store.state.lastSync = Date.now();
      store.state.lastError = null;
      saveState();
    }
  });
}

/** The dashboard's sidebar folders, created when missing. */
async function folderIds(s: A.Session) {
  const ids = await A.ensureFolders(s, FOLDERS, store.state.folders ?? {});
  store.state.folders = ids;
  saveState();
  return ids;
}

async function run(keys: string[], create: boolean) {
  try { await syncKeys(keys, create); } catch (e) { throw new A.AffineError(recordError(e)); }
}

// ---------------------------------------------------------------- public
export type ProjectPage = { configured: boolean; linked: boolean; url?: string; title?: string; notes?: AffineBlock[]; error?: string };

function pageInfo(key: string): { url: string } | null {
  const cfg = getSettings().affine;
  const ps = store.state.pages[key];
  if (!cfg || !ps?.docId || store.state.workspaceId !== cfg.workspaceId) return null;
  return { url: A.pageUrl(cfg, cfg.workspaceId, ps.docId) };
}

/** The project's page and the notes on it (everything the dashboard didn't write). */
export async function projectPage(id: string): Promise<ProjectPage> {
  getProject(id);
  const cfg = getSettings().affine;
  if (!cfg) return { configured: false, linked: false };
  config();
  const ps = store.state.pages[id];
  if (!ps?.docId) return { configured: true, linked: false };
  const url = A.pageUrl(cfg, cfg.workspaceId, ps.docId);
  try {
    return await A.withWorkspace(auth(cfg), cfg.workspaceId, async (s) => {
      const root = await s.load(s.workspaceId);
      const exists = root && A.pageEntry(root, ps.docId);
      root?.destroy();
      const doc = exists ? await s.load(ps.docId) : null;
      if (!doc) return { configured: true, linked: false, error: 'The AFFiNE page was deleted. Create it again to keep it up to date.' };
      const skip = new Set([...ps.summary, ps.logHeading, ps.table].filter(Boolean) as string[]);
      let notes = A.readPage(doc, skip);
      const title = A.pageTitle(doc);
      doc.destroy();
      if (notes[0]?.t === 'h2' && notes[0].text.trim().toLowerCase() === 'notes') notes = notes.slice(1);
      const blank = (b?: AffineBlock) => b?.t === 'p' && !b.text.trim();
      while (blank(notes[0])) notes.shift();
      while (blank(notes[notes.length - 1])) notes.pop();
      return { configured: true, linked: true, url, title, notes };
    });
  } catch (e) {
    return { configured: true, linked: true, url, error: e instanceof A.AffineError ? e.message : recordError(e) };
  }
}

/** "Update now" on a project: creates the page when needed. */
export async function syncProjectNow(id: string) {
  getProject(id);
  await run([id], true);
  return projectPage(id);
}

/** "Sync now" in Settings: every page that exists, plus the other-prints page when it's on. */
export async function syncAllNow() {
  const cfg = config();
  const keys = Object.keys(store.state.pages);
  if (cfg.otherPrints && !keys.includes(OTHER)) keys.push(OTHER);
  await run(keys, true);
  return status();
}

export function status() {
  const cfg = getSettings().affine;
  const s = store.state;
  const matches = cfg && s.workspaceId === cfg.workspaceId && s.url === cfg.url;
  return {
    pages: matches ? Object.values(s.pages).filter((p) => p.docId).length : 0,
    pending: matches ? s.dirty.length : 0,
    lastSync: matches ? s.lastSync ?? null : null,
    lastError: matches ? s.lastError ?? null : null,
    otherUrl: pageInfo(OTHER)?.url ?? null,
  };
}

const LIMITS = { blocks: 3000, text: 5000, rows: 5000, cols: 20 };
const BLOCK_TYPES = new Set(['h1', 'h2', 'h3', 'p', 'quote', 'li', 'table', 'hr']);

/**
 * A report page built in the browser. Returns its URL. History and Stats reports go in their sidebar
 * folder (newest on top); a project snapshot is linked from the project's page, so it nests under it.
 */
export async function createReport(input: { title?: unknown; blocks?: unknown; kind?: unknown; projectId?: unknown }) {
  const cfg = config();
  const kind = input.kind === 'history' || input.kind === 'stats' || input.kind === 'project' ? input.kind : null;
  const projectId = kind === 'project' ? String(input.projectId ?? '') : '';
  if (kind === 'project') getProject(projectId); // 404 when it doesn't exist
  const title = String(input.title ?? '').trim().slice(0, 200);
  if (!title) throw new UserError('A report needs a title');
  if (!Array.isArray(input.blocks) || input.blocks.length > LIMITS.blocks) throw new UserError('Report content is missing or too long');
  const clip = (v: unknown) => String(v ?? '').slice(0, LIMITS.text);
  const blocks: ReportBlock[] = input.blocks.map((b: any) => {
    if (!b || !BLOCK_TYPES.has(b.t)) throw new UserError('Unknown report block');
    if (b.t === 'hr') return { t: 'hr' };
    if (b.t === 'table') {
      if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > LIMITS.rows) throw new UserError('Report table is empty or too long');
      return { t: 'table', rows: b.rows.map((r: unknown) => (Array.isArray(r) ? r.slice(0, LIMITS.cols).map(clip) : [])) };
    }
    return { t: b.t, text: clip(b.text) };
  });
  let docId: string;
  try {
    docId = await A.withWorkspace(auth(cfg), cfg.workspaceId, async (s) => {
      const id = await A.createPage(s, title, blocks);
      if (kind === 'history' || kind === 'stats') await A.fileInFolder(s, (await folderIds(s))[kind], id, true);
      return id;
    });
  } catch (e) {
    throw new A.AffineError(recordError(e));
  }
  const url = A.pageUrl(cfg, cfg.workspaceId, docId);
  if (kind !== 'project') return { url };
  // Link it from the project page (created when needed). The snapshot itself exists either way.
  const ps = store.state.pages[projectId];
  const snapshots = [docId, ...(ps?.snapshots ?? [])];
  if (ps) ps.snapshots = snapshots;
  else store.state.pages[projectId] = { docId: '', summary: [], rows: {}, snapshots }; // no page yet: syncPage makes it
  saveState();
  try {
    await run([projectId], true);
    return { url };
  } catch (e) {
    return { url, warning: `Snapshot created, but the project page wasn't updated: ${(e as Error).message}` };
  }
}

/** For Settings: signs in and lists the workspaces the account can open. */
export async function testConnection(cfg: Pick<AffineSettings, 'url' | 'email' | 'password'>) {
  const a = { url: cfg.url, email: cfg.email, password: cfg.password };
  A.forgetSession(a); // a test always signs in fresh
  const { version } = await A.serverInfo(a.url);
  const user = await A.currentUser(a);
  const workspaces = await A.listWorkspaces(a);
  return { version, user: { name: user.name, email: user.email }, workspaces };
}

// ---------------------------------------------------------------- automatic updates
let projectTimer: NodeJS.Timeout | null = null;

function background(keys: string[], create: boolean) {
  run(keys, create).catch(() => { /* recorded; retried later */ });
}

/** Call once at startup: updates pages after prints and project changes, and retries failed updates. */
export function initAffine() {
  if (store.hooked) return;
  store.hooked = true;
  getPrinter().on('jobFinished', (job: PrintJob) => {
    setTimeout(() => {
      const cfg = getSettings().affine;
      if (!cfg?.auto) return;
      const key = job.counted?.projectId ?? (cfg.otherPrints ? OTHER : null);
      if (key) background([key], true);
    }, FINISH_DELAY_MS);
  });
  // Counts or parts changed by hand: update pages that exist, once things are quiet for a minute.
  projectEvents.on('change', () => {
    if (!getSettings().affine?.auto) return;
    if (projectTimer) clearTimeout(projectTimer);
    projectTimer = setTimeout(() => {
      projectTimer = null;
      const keys = Object.entries(store.state.pages).filter(([key, ps]) => {
        if (key === OTHER) return false;
        try { return getProject(key).updatedAt !== ps.synced; } catch { return false; }
      }).map(([key]) => key);
      if (keys.length) background(keys, false);
    }, PROJECT_DEBOUNCE_MS);
  });
  setInterval(() => {
    const cfg = getSettings().affine;
    if (cfg?.auto && store.state.dirty.length) background([...store.state.dirty], true);
  }, RETRY_MS);
}
