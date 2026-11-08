'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from './Header';
import BarChart, { type Bucket } from './BarChart';
import { sinceText } from './MaintenanceCard';
import { api, fmtGrams } from '@/lib/client';
import type { MaintenanceStatus, PrintJob } from '@/lib/types';

type Range = '30d' | '12w' | '12m' | 'all';
const RANGES: [Range, string][] = [['30d', 'Last 30 days'], ['12w', 'Last 12 weeks'], ['12m', 'Last 12 months'], ['all', 'All time']];
const DAY = 86_400_000;

const jobHours = (j: PrintJob) => (j.printSeconds ?? (j.started ? (j.ended - j.started) / 1000 : 0)) / 3600;

/** Splits a period into day / week / month buckets and sums the jobs per bucket. */
function bucketize(jobs: PrintJob[], range: Range) {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const unit = range === '30d' ? 'day' : range === '12w' ? 'week' : 'month';
  let start: Date;
  if (range === '30d') start = new Date(startOfDay(now).getTime() - 29 * DAY);
  else if (range === '12w') {
    const monday = new Date(startOfDay(now).getTime() - ((now.getDay() + 6) % 7) * DAY);
    start = new Date(monday.getTime() - 11 * 7 * DAY);
  } else if (range === '12m') start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  else {
    const first = jobs.length ? Math.min(...jobs.map((j) => j.ended)) : now.getTime();
    const f = new Date(first);
    start = new Date(f.getFullYear(), f.getMonth(), 1);
  }
  const next = (d: Date) => unit === 'day' ? new Date(d.getTime() + DAY) : unit === 'week' ? new Date(d.getTime() + 7 * DAY) : new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const edges: Date[] = [];
  for (let d = start; d <= now; d = next(d)) edges.push(d);
  const fmt = (d: Date, long: boolean) => unit === 'month'
    ? d.toLocaleDateString(undefined, { month: 'short', year: long || range === 'all' ? 'numeric' : '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(long ? { year: 'numeric' } : {}) });
  const inRange = jobs.filter((j) => j.ended >= start.getTime());
  const buckets = edges.map((e) => ({ from: e.getTime(), to: next(e).getTime(), label: fmt(e, false), title: (unit === 'week' ? 'Week of ' : '') + fmt(e, true), jobs: [] as PrintJob[] }));
  for (const j of inRange) buckets.find((b) => j.ended >= b.from && j.ended < b.to)?.jobs.push(j);
  return { buckets, jobs: inRange };
}

export default function StatsView() {
  const [jobs, setJobs] = useState<PrintJob[] | null>(null);
  const [totalHours, setTotalHours] = useState<number | null>(null);
  const [range, setRange] = useState<Range>('12w');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api('/api/stats').then((d) => { setJobs(d.jobs); setTotalHours(d.totalPrintHours); }).catch((e) => setError(e.message));
  }, []);

  const { buckets, jobs: sel } = useMemo(() => bucketize(jobs ?? [], range), [jobs, range]);
  const ok = sel.filter((j) => j.result === 'FINISH').length;
  const failed = sel.length - ok;
  const hours = sel.reduce((n, j) => n + jobHours(j), 0);
  const withGrams = sel.filter((j) => j.grams != null);
  const grams = withGrams.reduce((n, j) => n + j.grams!, 0);
  const withEnergy = sel.filter((j) => j.energyKwh != null);
  const kwh = withEnergy.reduce((n, j) => n + j.energyKwh!, 0);

  const sum = (f: (j: PrintJob) => number) => buckets.map((b) => b.jobs.reduce((n, j) => n + f(j), 0));
  const mk = (vals: number[][]): Bucket[] => buckets.map((b, i) => ({ label: b.label, title: b.title, values: vals.map((v) => v[i]) }));
  const printsData = mk([sum((j) => (j.result === 'FINISH' ? 1 : 0)), sum((j) => (j.result === 'FAILED' ? 1 : 0))]);
  const hoursData = mk([sum(jobHours)]);
  const energyData = mk([sum((j) => j.energyKwh ?? 0)]);
  const gramsData = mk([sum((j) => j.grams ?? 0)]);

  return (
    <>
      <Header title="Stats" active="stats" />
      <main className="viz-root">
        {error && <div className="card s12 alert">{error}</div>}
        <div className="s12 filter-row" role="group" aria-label="Period">
          {RANGES.map(([r, label]) => (
            <button key={r} className={`chip ${range === r ? 'on' : ''}`} aria-pressed={range === r} onClick={() => setRange(r)}>{label}</button>
          ))}
        </div>

        <section className="s12 tiles" style={{ opacity: jobs ? 1 : 0.5 }}>
          <Tile label="Prints" value={String(sel.length)} note={`${ok} succeeded · ${failed} failed`} />
          <Tile label="Success rate" value={sel.length ? `${Math.round((ok / sel.length) * 100)}%` : '–'} />
          <Tile label="Print time" value={`${hours.toFixed(1)} h`} />
          <Tile label="Filament" value={withGrams.length ? fmtGrams(grams) : '–'}
            note={withGrams.length ? `from ${withGrams.length} of ${sel.length} prints` : 'Known for prints counted on a project part with grams set'} />
          <Tile label="Energy" value={withEnergy.length ? `${kwh.toFixed(1)} kWh` : '–'}
            note={withEnergy.length ? `from ${withEnergy.length} of ${sel.length} prints` : <>Set up Home Assistant in <Link href="/settings">Settings</Link></>} />
          <Tile label="Total print hours" value={totalHours != null ? `${totalHours} h` : '–'} note="All time, incl. your starting value" />
        </section>

        <section className="card s12">
          <BarChart title="Prints" buckets={printsData} format={(v) => String(Math.round(v))}
            series={[{ name: 'Succeeded', color: 'var(--series-1)' }, { name: 'Failed', color: 'var(--series-2)' }]} />
        </section>
        <section className="card s6">
          <BarChart title="Print time (hours)" buckets={hoursData} series={[{ name: 'Hours', color: 'var(--series-1)' }]} format={(v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))} />
        </section>
        <section className="card s6">
          <BarChart title="Energy (kWh)" buckets={energyData} series={[{ name: 'kWh', color: 'var(--series-1)' }]} format={(v) => v.toFixed(v >= 10 ? 0 : 2)}
            emptyText="No energy data yet. Connect your smart plug under Settings → Home Assistant." />
        </section>
        <section className="card s12">
          <BarChart title="Filament (grams, where known)" buckets={gramsData} series={[{ name: 'Grams', color: 'var(--series-1)' }]} format={(v) => String(Math.round(v))}
            emptyText="Filament is recorded for prints that count towards a project part with grams per piece." />
        </section>

        <MaintenanceSection />
        {jobs !== null && jobs.length === 0 && (
          <p className="s12 muted">Statistics fill up as prints finish. The dashboard records prints from the moment it runs.</p>
        )}
      </main>
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div className="card tile">
      <span className="tile-label">{label}</span>
      <b className="tile-value">{value}</b>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- maintenance
type Draft = { name: string; intervalHours: string; intervalDays: string; notes: string; lastDoneHours: string };
const emptyDraft: Draft = { name: '', intervalHours: '', intervalDays: '', notes: '', lastDoneHours: '' };
const STATE_LABEL = { ok: '✓ OK', soon: '◷ Soon', due: '⚠ Due' };

function MaintenanceSection() {
  const [tasks, setTasks] = useState<MaintenanceStatus[] | null>(null);
  const [hours, setHours] = useState(0);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api('/api/maintenance').then((d) => { setTasks(d.tasks); setHours(d.totalPrintHours); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (p: Promise<{ tasks: MaintenanceStatus[] }>) => {
    try { setTasks((await p).tasks); setError(null); setEditing(null); } catch (e) { setError((e as Error).message); }
  };
  const edit = (t?: MaintenanceStatus) => {
    setDraft(t ? { name: t.name, intervalHours: t.intervalHours?.toString() ?? '', intervalDays: t.intervalDays?.toString() ?? '', notes: t.notes ?? '', lastDoneHours: String(t.lastDoneHours) } : emptyDraft);
    setEditing(t?.id ?? 'new');
  };
  const save = () => {
    const body = { ...draft, intervalHours: draft.intervalHours || null, intervalDays: draft.intervalDays || null };
    run(editing === 'new' ? api('/api/maintenance', 'POST', body) : api(`/api/maintenance/${editing}`, 'PATCH', body));
  };

  const sorted = [...(tasks ?? [])].sort((a, b) => b.progress - a.progress);
  const form = (
    <div className="task-edit">
      <label className="field"><span>Task</span><input value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="field"><span>Every … print hours</span><input type="number" min={1} value={draft.intervalHours} onChange={(e) => setDraft({ ...draft, intervalHours: e.target.value })} /></label>
      <label className="field"><span>and/or every … days</span><input type="number" min={1} value={draft.intervalDays} onChange={(e) => setDraft({ ...draft, intervalDays: e.target.value })} /></label>
      {editing !== 'new' && (
        <label className="field"><span>Last done at (print hours)</span><input type="number" min={0} value={draft.lastDoneHours} onChange={(e) => setDraft({ ...draft, lastDoneHours: e.target.value })} /></label>
      )}
      <label className="field wide-field"><span>Notes</span><input value={draft.notes} maxLength={500} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
      <div className="row wide-field">
        <button className="btn primary" onClick={save}>{editing === 'new' ? 'Add task' : 'Save'}</button>
        <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
        <span className="spacer" />
        {editing !== 'new' && <button className="btn danger" onClick={() => confirm(`Remove "${draft.name}"?`) && run(api(`/api/maintenance/${editing}`, 'DELETE'))}>Remove</button>}
      </div>
    </div>
  );

  return (
    <section className="card s12" id="maintenance">
      <div className="row" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Maintenance</h2>
        <span className="spacer" />
        <span className="muted small">Printer at <b>{hours} print hours</b> · <Link href="/settings#printer">set starting hours</Link></span>
      </div>
      <p className="muted small">Suggested intervals for the A1. Adjust them to how you print; Bambu Lab&apos;s A1 maintenance guide explains each job.</p>
      {error && <div className="alert">{error}</div>}
      <ul className="list tasks">
        {sorted.map((t) => (
          <li key={t.id} className="task">
            {editing === t.id ? form : (
              <>
                <div className="task-main">
                  <div className="row">
                    <span className={`status-tag ${t.state}`}>{STATE_LABEL[t.state]}</span>
                    <b>{t.name}</b>
                  </div>
                  <div className={`meter ${t.state}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(t.progress * 100))} aria-label={`${t.name}: ${Math.round(t.progress * 100)}% of the interval used`}>
                    <i style={{ width: `${Math.min(100, t.progress * 100)}%` }} />
                  </div>
                  <span className="muted small">{sinceText(t)}{t.notes && ` · ${t.notes}`}</span>
                </div>
                <div className="row">
                  <button className="btn" onClick={() => run(api(`/api/maintenance/${t.id}`, 'PATCH', { done: true }))}>Mark done</button>
                  <button className="btn" onClick={() => edit(t)}>Edit</button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {editing === 'new' ? form : (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => edit()}>+ Add task</button>
          <button className="linklike small" onClick={() => run(api('/api/maintenance', 'POST', { restoreDefaults: true }))}>Restore missing A1 tasks</button>
        </div>
      )}
    </section>
  );
}
