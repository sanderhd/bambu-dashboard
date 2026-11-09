'use client';
// AFFiNE in the dashboard: "Send to AFFiNE" buttons for reports, and the project card with its notes.
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client';
import type { AffineBlock, ReportBlock } from '@/lib/types';

/** `kind` decides where it goes in AFFiNE's sidebar: the History or Stats folder, or nested under the project page. */
export type Report = { title: string; blocks: ReportBlock[]; kind: 'history' | 'stats' | 'project'; projectId?: string };

let configured: Promise<boolean> | null = null;

/** True once we know AFFiNE is set up under Settings; null while checking. */
export function useAffine() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    configured ??= api('/api/affine/sync').then((d) => !!d.configured).catch(() => false);
    configured.then(setOn);
  }, []);
  return on;
}

const openLink = (url: string) => <a href={url} target="_blank" rel="noopener noreferrer">Open in AFFiNE ↗</a>;

/** Builds a report when clicked and creates an AFFiNE page from it. Hidden when AFFiNE isn't set up. */
export function SendToAffine({ build, disabled, label = 'Send to AFFiNE' }: { build: () => Report; disabled?: boolean; label?: string }) {
  const on = useAffine();
  const [state, setState] = useState<{ busy?: boolean; url?: string; error?: string; warning?: string }>({});
  if (!on) return null;
  const send = async () => {
    setState({ busy: true });
    try {
      const r = await api<{ url: string; warning?: string }>('/api/affine/report', 'POST', build());
      setState({ url: r.url, warning: r.warning });
    } catch (e) {
      setState({ error: (e as Error).message });
    }
  };
  return (
    <>
      <button className="btn" onClick={send} disabled={disabled || state.busy}>{state.busy ? 'Sending…' : label}</button>
      {state.url && <span className="ok-msg small">Page created · {openLink(state.url)}</span>}
      {state.warning && <span className="bad-msg small">{state.warning}</span>}
      {state.error && <span className="bad-msg small">{state.error}</span>}
    </>
  );
}

type Page = { configured: boolean; linked: boolean; url?: string; title?: string; notes?: AffineBlock[]; error?: string };

/** The project's AFFiNE page: notes written there, plus buttons to update it and to send a snapshot. */
export function ProjectAffineCard({ projectId, report }: { projectId: string; report: () => Report }) {
  const [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPage((await api<{ page: Page }>(`/api/affine/projects/${projectId}`)).page); } catch (e) { setError((e as Error).message); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (!page || !page.configured) return null;

  const sync = async () => {
    setBusy(true);
    setError(null);
    try { setPage((await api<{ page: Page }>(`/api/affine/projects/${projectId}`, 'POST')).page); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  return (
    <section className="card s12" id="affine">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Notes in AFFiNE</h2>
        <span className="spacer" />
        {page.url && page.linked && openLink(page.url)}
        <button className="btn" onClick={sync} disabled={busy}>{busy ? 'Updating…' : page.linked ? 'Update page now' : 'Create AFFiNE page'}</button>
        <button className="btn" onClick={load} disabled={busy} title="Read the notes from AFFiNE again">Reload notes</button>
        <SendToAffine build={report} label="Send snapshot" />
      </div>
      {error && <div className="alert">{error}</div>}
      {page.error && <div className="alert">{page.error}</div>}
      {!page.linked && !page.error && (
        <p className="muted">
          This project has no AFFiNE page yet. It gets one with an overview and a print log when its first print is counted,
          or create it now. Notes you write on that page show up here.
        </p>
      )}
      {page.linked && !page.notes?.length && !page.error && (
        <p className="muted">No notes yet. Write them under &quot;Notes&quot; on the AFFiNE page; the overview and print log above it are kept up to date by the dashboard.</p>
      )}
      {page.notes && page.notes.length > 0 && <AffineNotes blocks={page.notes} />}
    </section>
  );
}

/** Renders AFFiNE blocks read-only. Text stays text: nothing from the page is interpreted as HTML. */
export function AffineNotes({ blocks }: { blocks: AffineBlock[] }) {
  return (
    <div className="affine-notes">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h1': case 'h2': return <h3 key={i}>{b.text}</h3>;
          case 'h3': case 'h4': case 'h5': case 'h6': return <h4 key={i}>{b.text}</h4>;
          case 'quote': return <blockquote key={i}>{b.text}</blockquote>;
          case 'code': return <pre key={i}><code>{b.text}</code></pre>;
          case 'hr': return <hr key={i} />;
          case 'li': return (
            <div key={i} className={`affine-li ${b.kind}`} style={{ marginLeft: b.depth * 18 }}>
              <span className="affine-bullet" aria-hidden>{b.kind === 'todo' ? (b.checked ? '☑' : '☐') : '•'}</span>
              <span className={b.checked ? 'done' : undefined}>{b.text}</span>
            </div>
          );
          case 'table': return (
            <div key={i} className="table-scroll">
              <table className="data-table affine-table">
                <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => (ri === 0 ? <th key={ci}>{c}</th> : <td key={ci}>{c}</td>))}</tr>)}</tbody>
              </table>
            </div>
          );
          case 'other': return <p key={i} className="muted small">[{b.what}: open the page in AFFiNE to see it]</p>;
          default: return b.text ? <p key={i}>{b.text}</p> : <div key={i} className="affine-gap" />;
        }
      })}
    </div>
  );
}
