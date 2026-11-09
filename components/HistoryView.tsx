'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import Header from './Header';
import { SendToAffine, type Report } from './Affine';
import { api, fmtGrams } from '@/lib/client';
import { fmtDur } from '@/lib/format';
import type { PrintJob } from '@/lib/types';

type Result = 'all' | 'FINISH' | 'FAILED';
const RESULTS: [Result, string][] = [['all', 'All'], ['FINISH', 'Succeeded'], ['FAILED', 'Failed']];
const PAGE = 100;
const NO_PROJECT = '-';

const durMin = (j: PrintJob) => (j.started ? (j.ended - j.started) / 60000 : null);
const dayStart = (s: string) => (s ? new Date(`${s}T00:00:00`).getTime() : null);
const filamentText = (j: PrintJob) => (j.filaments ?? []).map((f) => `${f.type || '?'} ${f.color} ${f.grams} g`).join(', ');

export default function HistoryView() {
  const [jobs, setJobs] = useState<PrintJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [result, setResult] = useState<Result>('all');
  const [project, setProject] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    api('/api/stats').then((d) => setJobs(d.jobs)).catch((e) => setError(e.message));
  }, []);

  const projects = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs ?? []) if (j.counted) m.set(j.counted.projectId, j.counted.projectName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [jobs]);

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const lo = dayStart(from), hi = dayStart(to);
    return (jobs ?? []).filter((j) => {
      if (result !== 'all' && j.result !== result) return false;
      if (project === NO_PROJECT ? j.counted : project && j.counted?.projectId !== project) return false;
      if (lo != null && j.ended < lo) return false;
      if (hi != null && j.ended >= hi + 86_400_000) return false;
      const hay = `${j.name} ${j.counted?.projectName ?? ''} ${j.counted?.partName ?? ''} ${filamentText(j)}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [jobs, q, result, project, from, to]);

  useEffect(() => setShown(PAGE), [q, result, project, from, to]);

  const ok = filtered.filter((j) => j.result === 'FINISH').length;
  const grams = filtered.reduce((n, j) => n + (j.grams ?? 0), 0);
  const kwh = filtered.reduce((n, j) => n + (j.energyKwh ?? 0), 0);
  const anyFilter = q || result !== 'all' || project || from || to;
  const filterText = () => [
    q && `search "${q}"`,
    result !== 'all' && (result === 'FINISH' ? 'succeeded only' : 'failed only'),
    project && (project === NO_PROJECT ? 'not counted on a project' : `project ${projects.find(([id]) => id === project)?.[1] ?? ''}`),
    from && `from ${from}`,
    to && `to ${to}`,
  ].filter(Boolean).join(', ');
  const reset = () => { setQ(''); setResult('all'); setProject(''); setFrom(''); setTo(''); };

  return (
    <>
      <Header title="Print history" active="history" />
      <main>
        {error && <div className="card s12 alert">{error}</div>}
        <section className="card s12">
          <div className="history-filters">
            <label className="field grow"><span>Search</span>
              <input type="search" value={q} placeholder="Print name, project, part or filament" onChange={(e) => setQ(e.target.value)} /></label>
            <label className="field"><span>Project</span>
              <select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">All prints</option>
                <option value={NO_PROJECT}>Not counted on a project</option>
                {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select></label>
            <label className="field"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="field"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="row">
            <div className="filter-row" role="group" aria-label="Result">
              {RESULTS.map(([r, label]) => (
                <button key={r} className={`chip ${result === r ? 'on' : ''}`} aria-pressed={result === r} onClick={() => setResult(r)}>{label}</button>
              ))}
            </div>
            {anyFilter && <button className="linklike small" onClick={reset}>Clear filters</button>}
            <span className="spacer" />
            <button className="btn" disabled={!filtered.length} onClick={() => downloadCsv(filtered)}>
              Export CSV ({filtered.length})
            </button>
            <SendToAffine disabled={!filtered.length} build={() => historyReport(filtered, filterText())} />
          </div>
          {jobs && (
            <p className="muted small" style={{ margin: '12px 0 0' }}>
              {filtered.length} of {jobs.length} prints · {ok} succeeded · {filtered.length - ok} failed
              {grams > 0 && ` · ${fmtGrams(grams)} filament`}{kwh > 0 && ` · ${kwh.toFixed(1)} kWh`}
            </p>
          )}
        </section>

        <section className="card s12">
          {!jobs && !error && <p className="muted">Loading…</p>}
          {jobs && !jobs.length && <p className="muted">No prints recorded yet. The dashboard records prints from the moment it runs.</p>}
          {jobs && jobs.length > 0 && !filtered.length && <p className="muted">No prints match these filters.</p>}
          {filtered.length > 0 && (
            <div className="table-scroll">
              <table className="data-table history-table">
                <thead>
                  <tr><th>Finished</th><th>Print</th><th>Result</th><th>Duration</th><th>Filament</th><th>Energy</th><th>Project</th></tr>
                </thead>
                <tbody>
                  {filtered.slice(0, shown).map((j) => {
                    const d = durMin(j);
                    return (
                      <tr key={j.ended}>
                        <td className="nowrap">{new Date(j.ended).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                        <td className="name-cell">{j.name}</td>
                        <td><span className={`result ${j.result === 'FINISH' ? 'ok' : 'bad'}`}>{j.result === 'FINISH' ? 'Succeeded' : 'Failed'}</span></td>
                        <td className="nowrap">{d != null ? fmtDur(d) : '–'}</td>
                        <td className="nowrap" title={filamentText(j) || (j.gramsSource === 'project' ? 'From the project part' : undefined)}>
                          {(j.filaments ?? []).map((f, i) => <i key={i} className="fil-dot" style={{ background: f.color || 'var(--muted)' }} />)}
                          {j.grams != null ? `${Math.round(j.grams)} g` : '–'}
                        </td>
                        <td className="nowrap">{j.energyKwh != null ? `${j.energyKwh.toFixed(2)} kWh` : '–'}</td>
                        <td>
                          {j.counted
                            ? <Link href={`/projects/${j.counted.projectId}`}>{j.counted.projectName} → {j.counted.partName}</Link>
                            : <span className="muted">–</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > shown && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setShown(shown + PAGE)}>Show more</button>
              <span className="muted small">Showing {shown} of {filtered.length}</span>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

// ---------------------------------------------------------------- AFFiNE
const MAX_REPORT_ROWS = 2000;

function historyReport(jobs: PrintJob[], filters: string): Report {
  const ok = jobs.filter((j) => j.result === 'FINISH').length;
  const grams = jobs.reduce((n, j) => n + (j.grams ?? 0), 0);
  const kwh = jobs.reduce((n, j) => n + (j.energyKwh ?? 0), 0);
  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const shown = jobs.slice(0, MAX_REPORT_ROWS);
  return {
    kind: 'history',
    title: `Print history · ${new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })}`,
    blocks: [
      { t: 'p', text: filters ? `Filtered: ${filters}.` : 'All recorded prints.' },
      { t: 'li', text: `${jobs.length} prints: ${ok} succeeded, ${jobs.length - ok} failed` },
      ...(grams ? [{ t: 'li' as const, text: `Filament: ${fmtGrams(grams)}` }] : []),
      ...(kwh ? [{ t: 'li' as const, text: `Energy: ${kwh.toFixed(1)} kWh` }] : []),
      ...(jobs.length > shown.length ? [{ t: 'p' as const, text: `The table shows the newest ${shown.length}; export a CSV for all of them.` }] : []),
      {
        t: 'table',
        rows: [['Finished', 'Print', 'Result', 'Duration', 'Filament', 'Energy', 'Project'], ...shown.map((j) => {
          const d = durMin(j);
          return [
            when(j.ended), j.name, j.result === 'FINISH' ? '✅ Succeeded' : '❌ Failed', d != null ? fmtDur(d) : '–',
            j.grams != null ? `${Math.round(j.grams)} g` : '–', j.energyKwh != null ? `${j.energyKwh.toFixed(2)} kWh` : '–',
            j.counted ? `${j.counted.projectName} → ${j.counted.partName}` : '–',
          ];
        })],
      },
      { t: 'p', text: `Exported from Bambu Dashboard, ${new Date().toLocaleString()}.` },
    ],
  };
}

// ---------------------------------------------------------------- CSV

/**
 * Spreadsheet apps read CSV with the system's list separator: where the decimal mark is a comma
 * (e.g. Dutch Excel), that's a semicolon. Match it so the file opens in columns right away.
 */
function csvFormat() {
  const comma = (1.5).toLocaleString().includes(',');
  return { sep: comma ? ';' : ',', num: (n: number | null | undefined, digits = 1) => (n == null ? '' : comma ? n.toFixed(digits).replace('.', ',') : n.toFixed(digits)) };
}

function cell(v: string, sep: string) {
  // A leading = + - @ would run as a formula in Excel.
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (t: number | null) => {
  if (t == null) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function downloadCsv(jobs: PrintJob[]) {
  const { sep, num } = csvFormat();
  const head = ['Started', 'Finished', 'Print', 'Result', 'Duration (min)', 'Print time (h)', 'Layers', 'Filament (g)',
    'Filament source', 'Filaments', 'Energy (kWh)', 'Project', 'Part', 'Pieces'];
  const rows = jobs.map((j) => [
    stamp(j.started), stamp(j.ended), j.name, j.result === 'FINISH' ? 'Succeeded' : 'Failed',
    num(durMin(j), 0), num(j.printSeconds != null ? j.printSeconds / 3600 : null, 2), j.layers?.toString() ?? '',
    num(j.grams), j.gramsSource ?? '', filamentText(j), num(j.energyKwh, 3),
    j.counted?.projectName ?? '', j.counted?.partName ?? '', j.counted?.pieces.toString() ?? '',
  ]);
  const csv = '﻿' + [head, ...rows].map((r) => r.map((v) => cell(v, sep)).join(sep)).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `print-history-${stamp(Date.now()).slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
