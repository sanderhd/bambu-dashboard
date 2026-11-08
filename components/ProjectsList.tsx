'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from './Header';
import { api, fmtGrams } from '@/lib/client';
import { fmtDur } from '@/lib/format';
import type { ProjectStatus, ProjectSummary } from '@/lib/types';

export const STATUS_LABEL: Record<ProjectStatus, string> = { planning: 'Planning', active: 'Active', paused: 'Paused', done: 'Done' };

export function Progress({ printed, needed }: { printed: number; needed: number }) {
  const pct = needed ? Math.round((printed / needed) * 100) : 0;
  return (
    <div className="progress" title={`${printed} of ${needed} pieces`}>
      <div className="bar big"><i style={{ width: `${pct}%` }} /></div>
      <span><b>{printed}</b> / {needed} pieces · {pct}%</span>
    </div>
  );
}

export default function ProjectsList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    api<{ projects: ProjectSummary[] }>('/api/projects').then((d) => setProjects(d.projects)).catch((e) => setError(e.message));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { project } = await api('/api/projects', 'POST', { name, description });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const visible = projects?.filter((p) => showDone || p.status !== 'done') ?? [];
  const doneCount = projects?.filter((p) => p.status === 'done').length ?? 0;

  return (
    <>
      <Header title="Projects" active="projects" />
      <main>
        <section className="card s4">
          <h2>New project</h2>
          <form onSubmit={create}>
            <label className="field"><span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Desk organiser" required maxLength={80} /></label>
            <label className="field"><span>Description (optional)</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} /></label>
            <button className="btn primary">Create project</button>
          </form>
          {error && <div className="alert" style={{ marginTop: 12 }}>{error}</div>}
        </section>

        <section className="s8 project-grid">
          {projects === null && !error && <div className="card muted">Loading…</div>}
          {projects?.length === 0 && (
            <div className="card empty">
              <b>No projects yet</b>
              <p className="muted">Create a project, upload your STL or 3MF files, set how many of each you need,
                and track what&apos;s printed. Finished prints are counted automatically when their name matches a part.</p>
            </div>
          )}
          {visible.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="card project-card">
              {p.cover && (
                // eslint-disable-next-line @next/next/no-img-element -- private preview served by the API
                <img className="project-cover" src={`/api/projects/${p.id}/parts/${p.cover.partId}/thumb?v=${p.cover.v}`} alt="" loading="lazy" />
              )}
              <div className="row">
                <b className="project-name">{p.name}</b>
                <span className="spacer" />
                <span className={`pill ${p.status}`}>{STATUS_LABEL[p.status]}</span>
              </div>
              {p.description && <p className="muted clamp">{p.description}</p>}
              <Progress printed={p.printed} needed={p.needed} />
              <div className="muted small">
                {p.partCount} {p.partCount === 1 ? 'part' : 'parts'}
                {p.needed - p.printed > 0 && p.remainingMinutes != null && ` · ~${fmtDur(p.remainingMinutes)} left`}
                {p.needed - p.printed > 0 && p.remainingGrams != null && ` · ~${fmtGrams(p.remainingGrams)} filament`}
                {p.failed > 0 && ` · ${p.failed} failed`}
              </div>
            </Link>
          ))}
          {doneCount > 0 && (
            <button className="btn" onClick={() => setShowDone(!showDone)}>
              {showDone ? 'Hide finished projects' : `Show ${doneCount} finished ${doneCount === 1 ? 'project' : 'projects'}`}
            </button>
          )}
        </section>
      </main>
    </>
  );
}
