// Maintenance reminders, by print hours and/or calendar days. Stored in data/maintenance.json.
import 'server-only';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getPrinter } from './printer';
import { getSettings } from './settings';
import { UserError } from './projects';
import type { MaintenanceStatus, MaintenanceTask } from './types';

const FILE = path.join(process.cwd(), 'data', 'maintenance.json');
const DAY = 24 * 60 * 60 * 1000;
const SOON = 0.9; // show "soon" when 90% of the interval is used

/**
 * Starting list for the A1. These are suggestions to adjust to your own use;
 * check Bambu Lab's A1 maintenance guide for the details of each job.
 */
const A1_DEFAULTS: Omit<MaintenanceTask, 'id' | 'lastDoneHours' | 'lastDoneAt'>[] = [
  { name: 'Wash the build plate', notes: 'Warm water and dish soap; wipe with IPA between prints.', intervalHours: 30 },
  { name: 'Clean the nozzle and check it for wear', intervalHours: 100 },
  { name: 'Clean the nozzle wiper and purge area', intervalHours: 100 },
  { name: 'Clean and lubricate the X and Y axes', notes: 'Wipe off old grease and dust before adding new lubricant.', intervalHours: 200 },
  { name: 'Clean and lubricate the Z lead screws', intervalHours: 300 },
  { name: 'Check belt tension', intervalHours: 200 },
  { name: 'Clean the extruder gears', intervalHours: 300 },
  { name: 'Check the PTFE tubes and AMS lite feeders', intervalHours: 500 },
  { name: 'Run the printer calibration', intervalDays: 30 },
  { name: 'Check for firmware updates', intervalDays: 30 },
];

const newId = () => crypto.randomBytes(5).toString('hex');

const g = globalThis as unknown as { __bambuMaintenance?: { tasks: MaintenanceTask[] } };
const store = (g.__bambuMaintenance ??= { tasks: load() });

function load(): MaintenanceTask[] {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).tasks; } catch { /* first run */ }
  // First run: everything counts as "last done at 0 print hours, today". With your current
  // print hours filled in under Settings, tasks you haven't done for a while show up as due.
  const now = Date.now();
  return A1_DEFAULTS.map((t) => ({ ...t, id: newId(), lastDoneHours: 0, lastDoneAt: now }));
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ tasks: store.tasks }, null, 2));
}

/** Total print hours: the starting value from Settings plus what the dashboard counted. */
export const totalPrintHours = () =>
  Math.round(((getSettings().printHoursOffset ?? 0) + getPrinter().countedPrintHours) * 10) / 10;

export function listTasks(): MaintenanceStatus[] {
  const hours = totalPrintHours();
  const now = Date.now();
  return store.tasks.map((t) => {
    const hoursSince = Math.max(0, hours - t.lastDoneHours);
    const daysSince = Math.max(0, (now - t.lastDoneAt) / DAY);
    const progress = Math.max(
      t.intervalHours ? hoursSince / t.intervalHours : 0,
      t.intervalDays ? daysSince / t.intervalDays : 0,
    );
    const state = progress >= 1 ? 'due' : progress >= SOON ? 'soon' : 'ok';
    return { ...t, hoursSince: Math.round(hoursSince * 10) / 10, daysSince: Math.floor(daysSince), progress, state };
  });
}

function validate(input: Record<string, unknown>, existing?: MaintenanceTask): Omit<MaintenanceTask, 'id'> {
  const name = String(input.name ?? existing?.name ?? '').trim();
  if (!name || name.length > 100) throw new UserError('Name must be 1–100 characters');
  const num = (v: unknown, field: string, max: number) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > max) throw new UserError(`${field} must be a number from 1 to ${max}`);
    return Math.round(n * 10) / 10;
  };
  const intervalHours = 'intervalHours' in input ? num(input.intervalHours, 'Interval (print hours)', 100000) : existing?.intervalHours;
  const intervalDays = 'intervalDays' in input ? num(input.intervalDays, 'Interval (days)', 3650) : existing?.intervalDays;
  if (!intervalHours && !intervalDays) throw new UserError('Set an interval in print hours, days, or both');
  const notes = 'notes' in input ? String(input.notes ?? '').trim().slice(0, 500) || undefined : existing?.notes;
  let lastDoneHours = existing?.lastDoneHours ?? totalPrintHours();
  if (input.lastDoneHours !== undefined && input.lastDoneHours !== '') {
    const n = Number(input.lastDoneHours);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new UserError('Last done (print hours) must be from 0 to 100000');
    lastDoneHours = n;
  }
  return { name, notes, intervalHours, intervalDays, lastDoneHours, lastDoneAt: existing?.lastDoneAt ?? Date.now() };
}

export function addTask(input: Record<string, unknown>) {
  const task: MaintenanceTask = { id: newId(), ...validate(input) };
  store.tasks.push(task);
  save();
  return task;
}

export function updateTask(id: string, input: Record<string, unknown>) {
  const i = store.tasks.findIndex((t) => t.id === id);
  if (i < 0) throw new UserError('Task not found', 404);
  store.tasks[i] = { id, ...validate(input, store.tasks[i]) };
  save();
  return store.tasks[i];
}

export function markDone(id: string) {
  const t = store.tasks.find((x) => x.id === id);
  if (!t) throw new UserError('Task not found', 404);
  t.lastDoneHours = totalPrintHours();
  t.lastDoneAt = Date.now();
  save();
  return t;
}

export function deleteTask(id: string) {
  const before = store.tasks.length;
  store.tasks = store.tasks.filter((t) => t.id !== id);
  if (store.tasks.length === before) throw new UserError('Task not found', 404);
  save();
}

/** Adds any A1 starter tasks that are missing (by name). */
export function restoreDefaults() {
  const names = new Set(store.tasks.map((t) => t.name));
  const hours = totalPrintHours();
  for (const d of A1_DEFAULTS) if (!names.has(d.name)) store.tasks.push({ ...d, id: newId(), lastDoneHours: hours, lastDoneAt: Date.now() });
  save();
}
