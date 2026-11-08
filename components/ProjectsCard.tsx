'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Progress } from './ProjectsList';
import type { ProjectSummary } from '@/lib/types';

/** Active projects on the dashboard. Refreshes when a print finishes (it may have been counted). */
export default function ProjectsCard({ refreshKey }: { refreshKey: number }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then((d) => setProjects(d.projects ?? [])).catch(() => setProjects([]));
  }, [refreshKey]);

  const active = (projects ?? []).filter((p) => p.status === 'active').slice(0, 4);
  if (!active.length) return null;
  return (
    <section className="card s12">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Active projects</h2>
        <span className="spacer" />
        <Link href="/projects" className="muted">All projects →</Link>
      </div>
      <div className="mini-projects">
        {active.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="mini-project">
            <b>{p.name}</b>
            <Progress printed={p.printed} needed={p.needed} />
          </Link>
        ))}
      </div>
    </section>
  );
}
