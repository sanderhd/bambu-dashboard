// Print projects: parts with model files and how many of each still need printing.
// Metadata lives in data/projects/index.json, files in data/projects/<projectId>/.
import 'server-only';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getPrinter } from './printer';
import type { Activity, FileKind, Part, PrintJob, Project, ProjectStatus, ProjectSummary } from './types';

const DIR = path.join(process.cwd(), 'data', 'projects');
const INDEX = path.join(DIR, 'index.json');
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const MAX_ACTIVITY = 100;
const STATUSES: ProjectStatus[] = ['planning', 'active', 'paused', 'done'];
const EXT_KIND: Record<string, FileKind> = {
  '.stl': 'stl', '.3mf': '3mf', '.obj': 'obj', '.step': 'step', '.stp': 'step', '.gcode': 'gcode',
};

export class UserError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// ---------------------------------------------------------------- store
type Store = { projects: Project[] };
const g = globalThis as unknown as { __bambuProjects?: Store; __bambuProjectsHooked?: boolean };
const store = (g.__bambuProjects ??= { projects: load() });

function load(): Project[] {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')).projects ?? []; } catch { return []; }
}

function save() {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = INDEX + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ projects: store.projects }, null, 2));
  fs.renameSync(tmp, INDEX); // atomic: a crash never leaves a half-written index
}

const newId = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase();
const now = () => Date.now();

function log(p: Project, text: string) {
  p.activity.unshift({ t: now(), text } satisfies Activity);
  p.activity = p.activity.slice(0, MAX_ACTIVITY);
  p.updatedAt = now();
}

// ---------------------------------------------------------------- validation helpers
function str(v: unknown, field: string, max: number, required = false): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw new UserError(`${field} is required`);
    return undefined;
  }
  const s = String(v).trim();
  if (required && !s) throw new UserError(`${field} is required`);
  if (s.length > max) throw new UserError(`${field} is too long (max ${max} characters)`);
  return s || undefined;
}

function int(v: unknown, field: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${field} must be a whole number from ${min} to ${max}`);
  return n;
}

function optNum(v: unknown, field: string, max: number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new UserError(`${field} must be a number from 0 to ${max}`);
  return Math.round(n * 10) / 10;
}

function color(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new UserError('Color must look like #ff8800');
  return s.toLowerCase();
}

/** Keeps a file name readable but safe for disk and HTTP headers. */
export function safeFileName(name: string) {
  const base = path.basename(name).replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '').slice(-120);
  return base || 'file';
}

export function fileKind(name: string): FileKind | null {
  return EXT_KIND[path.extname(name).toLowerCase()] ?? null;
}

// ---------------------------------------------------------------- queries
function summarize(p: Project): ProjectSummary {
  const { parts, activity, ...rest } = p;
  let needed = 0, printed = 0, failed = 0, mins = 0, grams = 0, minsKnown = false, gramsKnown = false;
  for (const part of parts) {
    needed += part.quantity;
    printed += Math.min(part.printed, part.quantity);
    failed += part.failed;
    const left = Math.max(0, part.quantity - part.printed);
    if (part.minutesPerPiece != null) { mins += left * part.minutesPerPiece; minsKnown = true; }
    if (part.gramsPerPiece != null) { grams += left * part.gramsPerPiece; gramsKnown = true; }
  }
  return {
    ...rest, partCount: parts.length, needed, printed, failed,
    remainingMinutes: minsKnown ? Math.round(mins) : null,
    remainingGrams: gramsKnown ? Math.round(grams) : null,
  };
}

export const listProjects = (): ProjectSummary[] =>
  [...store.projects].sort((a, b) => b.updatedAt - a.updatedAt).map(summarize);

export function getProject(id: string): Project {
  const p = store.projects.find((x) => x.id === id);
  if (!p) throw new UserError('Project not found', 404);
  return p;
}

export function getPart(projectId: string, partId: string) {
  const project = getProject(projectId);
  const part = project.parts.find((x) => x.id === partId);
  if (!part) throw new UserError('Part not found', 404);
  return { project, part };
}

export const projectDir = (projectId: string) => path.join(DIR, projectId);
export const partFilePath = (projectId: string, part: Part) =>
  path.join(projectDir(projectId), `${part.id}${path.extname(part.file?.name ?? '').toLowerCase()}`);

// ---------------------------------------------------------------- projects
export function createProject(input: { name?: unknown; description?: unknown }) {
  const p: Project = {
    id: newId(),
    name: str(input.name, 'Name', 80, true)!,
    description: str(input.description, 'Description', 2000),
    status: 'active',
    autoCount: true,
    createdAt: now(),
    updatedAt: now(),
    parts: [],
    activity: [],
  };
  log(p, 'Project created');
  store.projects.push(p);
  save();
  return p;
}

export function updateProject(id: string, input: Record<string, unknown>) {
  const p = getProject(id);
  if ('name' in input) p.name = str(input.name, 'Name', 80, true)!;
  if ('description' in input) p.description = str(input.description, 'Description', 2000);
  if ('autoCount' in input) p.autoCount = Boolean(input.autoCount);
  if ('status' in input) {
    if (!STATUSES.includes(input.status as ProjectStatus)) throw new UserError('Unknown status');
    if (p.status !== input.status) log(p, `Status changed to ${input.status}`);
    p.status = input.status as ProjectStatus;
  }
  p.updatedAt = now();
  save();
  return p;
}

export function deleteProject(id: string) {
  const p = getProject(id);
  store.projects = store.projects.filter((x) => x !== p);
  save();
  fs.rmSync(projectDir(p.id), { recursive: true, force: true });
}

// ---------------------------------------------------------------- parts
function applyPartFields(part: Part, input: Record<string, unknown>) {
  if ('name' in input) part.name = str(input.name, 'Name', 120, true)!;
  if ('quantity' in input) part.quantity = int(input.quantity, 'Quantity', 0, 100000);
  if ('printed' in input) part.printed = int(input.printed, 'Printed', 0, 100000);
  if ('failed' in input) part.failed = int(input.failed, 'Failed', 0, 100000);
  if ('perPlate' in input) part.perPlate = int(input.perPlate, 'Pieces per print', 1, 1000);
  if ('material' in input) part.material = str(input.material, 'Material', 40);
  if ('color' in input) part.color = color(input.color);
  if ('minutesPerPiece' in input) part.minutesPerPiece = optNum(input.minutesPerPiece, 'Minutes per piece', 100000);
  if ('gramsPerPiece' in input) part.gramsPerPiece = optNum(input.gramsPerPiece, 'Grams per piece', 100000);
  if ('matchName' in input) part.matchName = str(input.matchName, 'Print name to match', 120);
  if ('notes' in input) part.notes = str(input.notes, 'Notes', 2000);
}

export function createPart(projectId: string, input: Record<string, unknown>) {
  const p = getProject(projectId);
  const part: Part = { id: newId(), name: 'Part', quantity: 1, printed: 0, failed: 0, perPlate: 1, createdAt: now() };
  applyPartFields(part, input);
  p.parts.push(part);
  log(p, `Added part "${part.name}"`);
  save();
  return part;
}

export function updatePart(projectId: string, partId: string, input: Record<string, unknown>) {
  const { project, part } = getPart(projectId, partId);
  const before = { printed: part.printed, failed: part.failed };
  applyPartFields(part, input);
  // Relative changes (+1 / −1) so two quick clicks never overwrite each other.
  const inc = (input.inc ?? {}) as Record<string, unknown>;
  for (const field of ['printed', 'failed', 'quantity'] as const) {
    if (inc[field] !== undefined) part[field] = Math.max(0, part[field] + int(inc[field], field, -1000, 1000));
  }
  if (part.printed !== before.printed) log(project, `${part.name}: printed ${before.printed} → ${part.printed} of ${part.quantity}`);
  if (part.failed !== before.failed) log(project, `${part.name}: failed ${before.failed} → ${part.failed}`);
  project.updatedAt = now();
  save();
  return part;
}

export function deletePart(projectId: string, partId: string) {
  const { project, part } = getPart(projectId, partId);
  if (part.file) fs.rmSync(partFilePath(projectId, part), { force: true });
  project.parts = project.parts.filter((x) => x !== part);
  log(project, `Removed part "${part.name}"`);
  save();
}

/** Stores an uploaded file (already written to `tmpPath`) on a new or existing part. */
export function attachFile(projectId: string, partId: string | null, originalName: string, tmpPath: string, size: number) {
  const project = getProject(projectId);
  const name = safeFileName(originalName);
  const kind = fileKind(name);
  if (!kind) throw new UserError('Unsupported file type');

  let part = partId ? project.parts.find((x) => x.id === partId) : undefined;
  if (partId && !part) throw new UserError('Part not found', 404);
  if (part?.file) fs.rmSync(partFilePath(projectId, part), { force: true });
  if (!part) {
    part = { id: newId(), name: name.replace(/\.[^.]+$/, ''), quantity: 1, printed: 0, failed: 0, perPlate: 1, createdAt: now() };
    project.parts.push(part);
  }
  part.file = { name, size, kind, uploadedAt: now() };
  fs.renameSync(tmpPath, partFilePath(projectId, part));
  log(project, `Uploaded ${name}`);
  save();
  return part;
}

// ---------------------------------------------------------------- automatic counting
/** "Bracket_v2.gcode.3mf" → "bracket v2" */
const normalize = (s: string) =>
  s.toLowerCase().replace(/(\.(gcode|3mf|stl|obj|step|stp))+$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Counts a finished print towards the part whose name matches the print's name.
 * Only active projects with automatic counting on; skipped when more than one part matches equally well.
 */
function countJob(job: PrintJob) {
  const jobName = ` ${normalize(job.name)} `;
  let best: { project: Project; part: Part; len: number }[] = [];
  for (const project of store.projects) {
    if (!project.autoCount || project.status !== 'active') continue;
    for (const part of project.parts) {
      // Whole words only: "bracket" matches "bracket plate 1", not "bracketholder".
      const key = normalize(part.matchName || part.file?.name || part.name);
      if (key.length < 3 || !jobName.includes(` ${key} `)) continue;
      if (!best.length || key.length > best[0].len) best = [{ project, part, len: key.length }];
      else if (key.length === best[0].len) best.push({ project, part, len: key.length });
    }
  }
  if (best.length !== 1) return;
  const { project, part } = best[0];
  const pieces = part.perPlate;
  if (job.result === 'FINISH') {
    part.printed += pieces;
    log(project, `${part.name}: +${pieces} from print "${job.name}" (${part.printed} of ${part.quantity})`);
  } else {
    part.failed += pieces;
    log(project, `${part.name}: print "${job.name}" failed (+${pieces} failed)`);
  }
  job.counted = { projectId: project.id, projectName: project.name, partId: part.id, partName: part.name, pieces };
  save();
}

/** Call once at startup: listens for finished prints. */
export function initProjects() {
  if (g.__bambuProjectsHooked) return;
  g.__bambuProjectsHooked = true;
  getPrinter().on('jobFinished', (job: PrintJob) => {
    try { countJob(job); } catch (e) { console.warn('[projects] counting failed:', (e as Error).message); }
  });
}
