'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from './Header';
import { ProjectAffineCard, type Report } from './Affine';
import { Progress, STATUS_LABEL } from './ProjectsList';
import { api, fmtBytes, fmtGrams, uploadFile } from '@/lib/client';
import { fmtDur } from '@/lib/format';
import type { Part, Project, ProjectStatus } from '@/lib/types';

// three.js is big: only load it when someone opens a 3D preview.
const StlViewer = dynamic(() => import('./StlViewer'), { ssr: false });

const ACCEPT = '.stl,.3mf,.obj,.step,.stp,.gcode';
type Upload = { id: number; name: string; progress: number; error?: string };

export default function ProjectView({ id }: { id: string }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [viewing, setViewing] = useState<Part | null>(null);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setProject((await api<{ project: Project }>(`/api/projects/${id}`)).project);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => { reload(); }, [reload]);

  // STL files have no built-in preview: render one in the browser, once, and store it on the server.
  const tried = useRef(new Set<string>());
  useEffect(() => {
    const todo = project?.parts.filter((p) => p.file?.kind === 'stl' && !p.thumbnail && !tried.current.has(p.id)) ?? [];
    if (!todo.length) return;
    let cancelled = false;
    (async () => {
      const { renderStlThumbnail } = await import('@/lib/stl-scene');
      for (const p of todo) {
        if (cancelled) return;
        tried.current.add(p.id);
        try {
          const png = await renderStlThumbnail(`/api/projects/${id}/parts/${p.id}/file`, p.color);
          await fetch(`/api/projects/${id}/parts/${p.id}/thumb`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
        } catch { /* no preview then; the icon stays */ }
      }
      if (!cancelled) reload();
    })();
    return () => { cancelled = true; };
  }, [project, id, reload]);

  const patchProject = async (patch: Partial<Project>) => {
    try { setProject((await api(`/api/projects/${id}`, 'PATCH', patch)).project); } catch (e) { setError((e as Error).message); }
  };

  const remove = async () => {
    if (!project || !confirm(`Delete "${project.name}" and all its files? This cannot be undone.`)) return;
    await api(`/api/projects/${id}`, 'DELETE');
    router.push('/projects');
  };

  const upload = async (files: FileList | File[], partId?: string) => {
    for (const file of Array.from(files)) {
      const u: Upload = { id: Math.random(), name: file.name, progress: 0 };
      setUploads((list) => [...list, u]);
      const set = (patch: Partial<Upload>) => setUploads((list) => list.map((x) => (x.id === u.id ? { ...x, ...patch } : x)));
      try {
        await uploadFile(`/api/upload/${id}${partId ? `?part=${partId}` : ''}`, file, (p) => set({ progress: p }));
        setUploads((list) => list.filter((x) => x.id !== u.id));
        await reload();
      } catch (e) {
        set({ error: (e as Error).message });
      }
    }
  };

  if (error && !project) {
    return (
      <>
        <Header title="Project" active="projects" />
        <main><div className="card s12"><div className="alert">{error}</div><Link href="/projects">← All projects</Link></div></main>
      </>
    );
  }
  if (!project) return <><Header title="Project" active="projects" /><main><div className="card s12 muted">Loading…</div></main></>;

  const needed = project.parts.reduce((n, p) => n + p.quantity, 0);
  const printed = project.parts.reduce((n, p) => n + Math.min(p.printed, p.quantity), 0);
  const failed = project.parts.reduce((n, p) => n + p.failed, 0);
  const partsDone = project.parts.filter((p) => p.quantity > 0 && p.printed >= p.quantity).length;
  const left = (p: Part) => Math.max(0, p.quantity - p.printed);
  const withTime = project.parts.filter((p) => p.minutesPerPiece != null);
  const withGrams = project.parts.filter((p) => p.gramsPerPiece != null);
  const minutesLeft = withTime.reduce((n, p) => n + left(p) * p.minutesPerPiece!, 0);
  const gramsLeft = withGrams.reduce((n, p) => n + left(p) * p.gramsPerPiece!, 0);

  return (
    <>
      <Header title={project.name} active="projects">
        <span className={`pill ${project.status}`}>{STATUS_LABEL[project.status]}</span>
      </Header>
      <main>
        <section className="card s8">
          <div className="row" style={{ marginBottom: 10 }}>
            <Link href="/projects" className="muted">← All projects</Link>
            <span className="spacer" />
            <button className="btn" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit project'}</button>
          </div>
          {editing ? (
            <ProjectEditor project={project} onSave={patchProject} onDelete={remove} />
          ) : (
            project.description && <p className="description">{project.description}</p>
          )}
          <Progress printed={printed} needed={needed} />
          <div className="kv">
            <div><span>Parts finished</span><b>{partsDone} / {project.parts.length}</b></div>
            <div><span>Pieces to go</span><b>{needed - printed}</b></div>
            <div><span>Print time left</span><b>{withTime.length ? `~${fmtDur(minutesLeft)}` : '–'}</b></div>
            <div><span>Filament left</span><b>{withGrams.length ? `~${fmtGrams(gramsLeft)}` : '–'}</b></div>
            <div><span>Failed</span><b>{failed}</b></div>
          </div>
          {(withTime.length > 0 && withTime.length < project.parts.length) && (
            <p className="muted small">Time left only counts parts where you filled in the minutes per piece.</p>
          )}
        </section>

        <section className="card s4">
          <h2>Automatic counting</h2>
          <label className="toggle">
            <input type="checkbox" checked={project.autoCount} onChange={(e) => patchProject({ autoCount: e.target.checked })} />
            <span>Count finished prints that match a part</span>
          </label>
          <p className="muted small">
            When a print finishes, its name is compared with each part&apos;s file name (or the &quot;print name&quot; you set).
            A match adds the part&apos;s pieces-per-print. Only for projects with status <b>Active</b>.
            {project.status !== 'active' && <> This project is <b>{STATUS_LABEL[project.status].toLowerCase()}</b>, so nothing is counted now.</>}
          </p>
        </section>

        <section className="card s12">
          <div className="row" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>Parts</h2>
            <span className="spacer" />
            <AddPart projectId={id} onAdded={reload} />
          </div>
          <DropZone onFiles={(f) => upload(f)} />
          {uploads.map((u) => (
            <div key={u.id} className={`upload ${u.error ? 'failed' : ''}`}>
              <span>{u.name}</span>
              {u.error
                ? <><span className="bad-msg">{u.error}</span><button className="btn" onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))}>Dismiss</button></>
                : <div className="bar"><i style={{ width: `${Math.round(u.progress * 100)}%` }} /></div>}
            </div>
          ))}
          {!project.parts.length && <p className="muted">No parts yet. Drop your model files above, or add a part without a file.</p>}
          <div className="parts">
            {project.parts.map((p) => (
              <PartRow key={p.id} projectId={id} part={p} onChange={reload} onView={() => setViewing(p)} onReplace={(f) => upload([f], p.id)} />
            ))}
          </div>
        </section>

        <ProjectAffineCard projectId={id} report={() => projectReport(project)} />

        <section className="card s12">
          <h2>Activity</h2>
          <ul className="list">
            {project.activity.slice(0, 30).map((a, i) => (
              <li key={i}><span>{a.text}</span><span className="muted">{new Date(a.t).toLocaleString()}</span></li>
            ))}
          </ul>
        </section>
      </main>
      {viewing && (
        <StlViewer url={`/api/projects/${id}/parts/${viewing.id}/file`} name={viewing.file?.name ?? viewing.name} color={viewing.color} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------- AFFiNE snapshot
/** A dated copy of the project as it is now, for a separate AFFiNE page. */
function projectReport(p: Project): Report {
  const needed = p.parts.reduce((n, x) => n + x.quantity, 0);
  const printed = p.parts.reduce((n, x) => n + Math.min(x.printed, x.quantity), 0);
  const failed = p.parts.reduce((n, x) => n + x.failed, 0);
  const left = (x: Part) => Math.max(0, x.quantity - x.printed);
  const minutes = p.parts.reduce((n, x) => n + (x.minutesPerPiece != null ? left(x) * x.minutesPerPiece : 0), 0);
  const grams = p.parts.reduce((n, x) => n + (x.gramsPerPiece != null ? left(x) * x.gramsPerPiece : 0), 0);
  const date = new Date().toLocaleDateString(undefined, { dateStyle: 'medium' });
  return {
    kind: 'project',
    projectId: p.id,
    title: `${p.name} · snapshot ${date}`,
    blocks: [
      ...(p.description ? [{ t: 'quote' as const, text: p.description }] : []),
      { t: 'h2', text: 'Progress' },
      { t: 'li', text: `Status: ${STATUS_LABEL[p.status]}` },
      { t: 'li', text: `Pieces: ${printed} of ${needed} printed${failed ? `, ${failed} failed` : ''}` },
      ...(minutes ? [{ t: 'li' as const, text: `Print time left: ~${fmtDur(minutes)}` }] : []),
      ...(grams ? [{ t: 'li' as const, text: `Filament left: ~${fmtGrams(grams)}` }] : []),
      { t: 'h2', text: 'Parts' },
      p.parts.length
        ? { t: 'table', rows: [['Part', 'Printed', 'Needed', 'Failed', 'Material', 'Min/pc', 'g/pc', 'File'], ...p.parts.map((x) => [
            x.name, String(x.printed), String(x.quantity), String(x.failed), x.material ?? '', x.minutesPerPiece?.toString() ?? '',
            x.gramsPerPiece?.toString() ?? '', x.file?.name ?? '',
          ])] }
        : { t: 'p', text: 'No parts yet.' },
      { t: 'h2', text: 'Recent activity' },
      ...p.activity.slice(0, 20).map((a) => ({ t: 'li' as const, text: `${new Date(a.t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}: ${a.text}` })),
      { t: 'p', text: `Snapshot from Bambu Dashboard, ${new Date().toLocaleString()}.` },
    ],
  };
}

// ---------------------------------------------------------------- project editor
function ProjectEditor({ project, onSave, onDelete }: { project: Project; onSave: (p: Partial<Project>) => void; onDelete: () => void }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  return (
    <div className="editor">
      <label className="field"><span>Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Description</span><textarea rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="field"><span>Status</span>
        <select value={project.status} onChange={(e) => onSave({ status: e.target.value as ProjectStatus })}>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <div className="row">
        <button className="btn primary" onClick={() => onSave({ name, description })}>Save</button>
        <span className="spacer" />
        <button className="btn danger" onClick={onDelete}>Delete project</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- upload drop zone
function DropZone({ onFiles }: { onFiles: (f: FileList) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}
      role="button"
      tabIndex={0}
    >
      <b>Drop model files here</b> or click to choose
      <span className="muted small">STL, 3MF, OBJ, STEP or G-code · up to 300 MB each · one part per file</span>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

function AddPart({ projectId, onAdded }: { projectId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button className="btn" onClick={() => setOpen(true)}>+ Part without file</button>;
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/projects/${projectId}/parts`, 'POST', { name, quantity: Number(quantity) });
      setOpen(false); setName(''); setQuantity('1'); setError(null);
      onAdded();
    } catch (err) { setError((err as Error).message); }
  };
  return (
    <form className="row" onSubmit={add}>
      <input placeholder="Part name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
      <input type="number" min={0} aria-label="Quantity" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: 80 }} />
      <button className="btn primary">Add</button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      {error && <span className="bad-msg">{error}</span>}
    </form>
  );
}

// ---------------------------------------------------------------- part row
const FIELDS: { key: keyof Part; label: string; type: 'text' | 'number' | 'color'; hint?: string }[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'quantity', label: 'Pieces needed', type: 'number' },
  { key: 'perPlate', label: 'Pieces per print', type: 'number', hint: 'Added per finished print when counting automatically' },
  { key: 'material', label: 'Material', type: 'text' },
  { key: 'color', label: 'Color', type: 'color' },
  { key: 'minutesPerPiece', label: 'Minutes per piece', type: 'number' },
  { key: 'gramsPerPiece', label: 'Grams per piece', type: 'number' },
  { key: 'matchName', label: 'Print name to match', type: 'text', hint: 'Defaults to the file name. Use this if your prints are named differently.' },
  { key: 'notes', label: 'Notes', type: 'text' },
];

function PartRow({ projectId, part, onChange, onView, onReplace }: {
  projectId: string; part: Part; onChange: () => void; onView: () => void; onReplace: (f: File) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const replace = useRef<HTMLInputElement>(null);
  const url = `/api/projects/${projectId}/parts/${part.id}`;
  const done = part.quantity > 0 && part.printed >= part.quantity;
  const pct = part.quantity ? Math.min(100, Math.round((part.printed / part.quantity) * 100)) : 0;

  const patch = async (body: object) => {
    try { await api(url, 'PATCH', body); setError(null); onChange(); } catch (e) { setError((e as Error).message); }
  };
  const startEdit = () => {
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, part[f.key] == null ? '' : String(part[f.key])])));
    setEditing(true);
  };
  const save = async () => {
    const body: Record<string, unknown> = {};
    for (const f of FIELDS) body[f.key] = f.type === 'number' && draft[f.key] !== '' ? Number(draft[f.key]) : draft[f.key];
    if (body.color === '') body.color = null;
    try { await api(url, 'PATCH', body); setEditing(false); setError(null); onChange(); } catch (e) { setError((e as Error).message); }
  };
  const del = async () => {
    if (!confirm(`Remove "${part.name}"${part.file ? ' and its file' : ''}?`)) return;
    await api(url, 'DELETE');
    onChange();
  };

  return (
    <div className={`part ${done ? 'done' : ''}`}>
      <div className="part-main">
        {part.thumbnail ? (
          <button className="part-thumb" onClick={part.file?.kind === 'stl' ? onView : undefined} disabled={part.file?.kind !== 'stl'}
            aria-label={part.file?.kind === 'stl' ? `3D view of ${part.name}` : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element -- small private preview, served by the API */}
            <img src={`${url}/thumb?v=${part.thumbnail}`} alt="" loading="lazy" />
          </button>
        ) : (
          <div className="part-icon" style={part.color ? { background: part.color } : undefined}>{part.file?.kind.toUpperCase() ?? '—'}</div>
        )}
        <div className="part-info">
          <b>{part.name}</b>
          <span className="muted small">
            {part.file ? `${part.file.name} · ${fmtBytes(part.file.size)}` : 'No file'}
            {part.material && ` · ${part.material}`}
            {part.perPlate > 1 && ` · ${part.perPlate} per print`}
            {part.minutesPerPiece != null && ` · ${fmtDur(part.minutesPerPiece)}/pc`}
            {part.gramsPerPiece != null && ` · ${part.gramsPerPiece} g/pc`}
          </span>
          {part.file?.slice && (
            <span className="muted small">
              Sliced: {part.file.slice.plates} {part.file.slice.plates === 1 ? 'plate' : 'plates'}
              {part.file.slice.minutes != null && ` · ${fmtDur(part.file.slice.minutes)}`}
              {part.file.slice.grams != null && ` · ${part.file.slice.grams} g`}
            </span>
          )}
          {part.notes && <span className="muted small">{part.notes}</span>}
        </div>
        <div className="counter">
          <button className="btn" aria-label="One less printed" onClick={() => patch({ inc: { printed: -1 } })} disabled={part.printed <= 0}>−</button>
          <div className="count">
            <b>{part.printed}</b><span className="muted"> / {part.quantity}</span>
            <div className="bar"><i style={{ width: `${pct}%` }} /></div>
          </div>
          <button className="btn" aria-label="One more printed" onClick={() => patch({ inc: { printed: 1 } })}>+</button>
          <button className="btn small-btn" title="Count a failed print" onClick={() => patch({ inc: { failed: 1 } })}>
            ✗ {part.failed > 0 ? part.failed : ''}
          </button>
        </div>
        <div className="row part-actions">
          {part.file?.kind === 'stl' && <button className="btn" onClick={onView}>3D view</button>}
          {part.file && <a className="btn" href={`${url}/file?download=1`}>Download</a>}
          <button className="btn" onClick={() => replace.current?.click()}>{part.file ? 'Replace file' : 'Add file'}</button>
          <button className="btn" onClick={editing ? () => setEditing(false) : startEdit}>{editing ? 'Cancel' : 'Edit'}</button>
          <input ref={replace} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onReplace(f); e.target.value = ''; }} />
        </div>
      </div>
      {editing && (
        <div className="part-edit">
          {FIELDS.map((f) => (
            <label key={f.key} className="field" title={f.hint}>
              <span>{f.label}</span>
              {f.type === 'color' ? (
                <div className="row">
                  <input type="color" value={draft.color || '#2fd36b'} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                  {draft.color && <button type="button" className="linklike" onClick={() => setDraft({ ...draft, color: '' })}>Clear</button>}
                </div>
              ) : (
                <input type={f.type} min={f.type === 'number' ? 0 : undefined} step="any" value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              )}
              {f.hint && <span className="small">{f.hint}</span>}
            </label>
          ))}
          <div className="row">
            <button className="btn primary" onClick={save}>Save part</button>
            <span className="spacer" />
            <button className="btn danger" onClick={del}>Remove part</button>
          </div>
        </div>
      )}
      {error && <div className="bad-msg small">{error}</div>}
    </div>
  );
}
