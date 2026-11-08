'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { MaintenanceStatus } from '@/lib/types';

/** On the dashboard: only shown when a maintenance job is due (or nearly). */
export default function MaintenanceCard({ refreshKey }: { refreshKey: number }) {
  const [tasks, setTasks] = useState<MaintenanceStatus[]>([]);
  const load = useCallback(() => {
    fetch('/api/maintenance').then((r) => r.json()).then((d) => setTasks(d.tasks ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const done = async (id: string) => {
    const r = await fetch(`/api/maintenance/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"done":true}' });
    const d = await r.json().catch(() => null);
    if (d?.tasks) setTasks(d.tasks);
  };

  const shown = tasks.filter((t) => t.state !== 'ok').sort((a, b) => b.progress - a.progress);
  if (!shown.length) return null;
  return (
    <section className="card s12">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Maintenance</h2>
        <span className="spacer" />
        <Link href="/stats#maintenance" className="muted">All tasks →</Link>
      </div>
      <ul className="list">
        {shown.map((t) => (
          <li key={t.id}>
            <span>
              <span className={`status-tag ${t.state}`}>{t.state === 'due' ? '⚠ Due' : '◷ Soon'}</span>{' '}
              <b>{t.name}</b>
              <br /><span className="muted small">{sinceText(t)}</span>
            </span>
            <button className="btn" onClick={() => done(t.id)}>Mark done</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function sinceText(t: MaintenanceStatus) {
  const parts: string[] = [];
  if (t.intervalHours) parts.push(`${t.hoursSince} of ${t.intervalHours} print hours`);
  if (t.intervalDays) parts.push(`${t.daysSince} of ${t.intervalDays} days`);
  return parts.join(' · ') + ' since last done';
}
