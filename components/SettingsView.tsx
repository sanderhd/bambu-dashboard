'use client';
import { useEffect, useState } from 'react';
import Header from './Header';
import type { CameraConfig, Connection, PrinterInfo } from '@/lib/types';

type SettingsResponse = {
  cameras: CameraConfig[];
  defaultCamera?: string;
  printer: PrinterInfo & { demo: boolean; ip: string | null; serial: string | null; connection: Connection };
};

type Draft = { id?: string; name: string; url: string };

async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { window.location.href = '/login?next=/settings'; throw new Error('Not logged in'); }
  return r.json();
}

export default function SettingsView() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api<SettingsResponse>('/api/settings').then(setData).catch((e) => setLoadError(e.message));
  }, []);

  return (
    <>
      <Header title="Settings" active="settings" />
      <main>
        {loadError && <div className="card s12 alert">{loadError}</div>}
        {data && (
          <>
            <CamerasSection data={data} onSaved={(d) => setData({ ...data, ...d })} />
            <PasswordSection />
            <PrinterSection p={data.printer} />
          </>
        )}
      </main>
    </>
  );
}

// ---------------------------------------------------------------- cameras
function CamerasSection({ data, onSaved }: { data: SettingsResponse; onSaved: (d: Partial<SettingsResponse>) => void }) {
  const [cams, setCams] = useState<Draft[]>(data.cameras);
  const [def, setDef] = useState(data.defaultCamera ?? '');
  const [draft, setDraft] = useState<Draft>({ name: '', url: '' });
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string } | 'busy'>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const printerCam = data.printer.camera !== 'off';
  const dirty = JSON.stringify(cams) !== JSON.stringify(data.cameras) || def !== (data.defaultCamera ?? '');

  const test = async (key: string, url: string) => {
    setTests((t) => ({ ...t, [key]: 'busy' }));
    const r = await api('/api/settings/test-camera', 'POST', { url }).catch(() => ({ ok: false, message: 'Server unreachable' }));
    setTests((t) => ({ ...t, [key]: r }));
  };

  const add = () => {
    if (!draft.name.trim() || !draft.url.trim()) return setMsg({ ok: false, text: 'Fill in a name and a URL.' });
    setCams([...cams, { name: draft.name.trim(), url: draft.url.trim() }]);
    setDraft({ name: '', url: '' });
    setTests(({ new: _, ...rest }) => rest);
    setMsg(null);
  };

  const save = async () => {
    const r = await api('/api/settings', 'PUT', { cameras: cams, defaultCamera: def || undefined });
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setCams(r.cameras);
    onSaved({ cameras: r.cameras, defaultCamera: r.defaultCamera });
    setMsg({ ok: true, text: 'Saved. The cameras are now available on the dashboard.' });
  };

  const TestResult = ({ k }: { k: string }) => {
    const t = tests[k];
    if (!t) return null;
    if (t === 'busy') return <span className="muted">Testing…</span>;
    return <span className={t.ok ? 'ok-msg' : 'bad-msg'}>{t.ok ? '✓' : '✗'} {t.message}</span>;
  };

  return (
    <section className="card s12">
      <h2>Cameras</h2>
      <p className="muted">
        Add a USB webcam or any other camera that serves an <b>MJPEG stream</b> or a <b>JPEG snapshot</b> over HTTP,
        for example from picam, mjpg-streamer, ustreamer or motionEye. The dashboard fetches the stream on the server,
        so the URL is never exposed to the browser and you only need to log in once.
      </p>

      <ul className="list">
        {printerCam && (
          <li>
            <span><b>Printer camera</b><br /><span className="muted">Built into the {data.printer.model}</span></span>
            <label className="radio"><input type="radio" name="def" checked={def === 'printer' || !def} onChange={() => setDef('printer')} /> Default</label>
          </li>
        )}
        {cams.map((c, i) => {
          const key = c.id ?? `i${i}`;
          return (
            <li key={key} className="cam-row">
              <div className="cam-fields">
                <input aria-label="Camera name" value={c.name} onChange={(e) => setCams(cams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input aria-label="Camera URL" className="mono" value={c.url} onChange={(e) => setCams(cams.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <TestResult k={key} />
              </div>
              <div className="row">
                {c.id && <label className="radio"><input type="radio" name="def" checked={def === c.id} onChange={() => setDef(c.id!)} /> Default</label>}
                <button className="btn" onClick={() => test(key, c.url)}>Test</button>
                <button className="btn danger" onClick={() => { setCams(cams.filter((_, j) => j !== i)); if (def === c.id) setDef(''); }}>Remove</button>
              </div>
            </li>
          );
        })}
        {!printerCam && !cams.length && <li className="muted">No cameras yet.</li>}
      </ul>

      <div className="label">Add a camera</div>
      <div className="cam-add">
        <input placeholder="Name, e.g. USB webcam" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className="mono" placeholder="http://192.168.178.81:8080/stream.mjpg" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
        <button className="btn" onClick={() => test('new', draft.url)} disabled={!draft.url.trim()}>Test</button>
        <button className="btn" onClick={add}>Add</button>
      </div>
      <TestResult k="new" />

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={save} disabled={!dirty}>Save cameras</button>
        {msg && <span className={msg.ok ? 'ok-msg' : 'bad-msg'}>{msg.text}</span>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- password
function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setMsg({ ok: false, text: 'The new passwords don\'t match.' });
    const r = await api('/api/auth/password', 'POST', { current, next });
    setMsg(r.ok ? { ok: true, text: 'Password changed. Other devices have been logged out.' } : { ok: false, text: r.error });
    if (r.ok) { setCurrent(''); setNext(''); setConfirm(''); }
  };

  const logoutEverywhere = async () => {
    if (!confirm_('Log out on every device, including this one?')) return;
    await api('/api/auth/logout', 'POST', { everywhere: true });
    window.location.href = '/login';
  };

  return (
    <section className="card s6">
      <h2>Password</h2>
      <form onSubmit={change}>
        <label className="field"><span>Current password</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label className="field"><span>New password (at least 8 characters)</span>
          <input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        <label className="field"><span>Repeat new password</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
        <div className="row">
          <button className="btn primary">Change password</button>
          {msg && <span className={msg.ok ? 'ok-msg' : 'bad-msg'}>{msg.text}</span>}
        </div>
      </form>
      <div className="label">Sessions</div>
      <button className="btn" onClick={logoutEverywhere}>Log out everywhere</button>
    </section>
  );
}

const confirm_ = (q: string) => window.confirm(q);

// ---------------------------------------------------------------- printer (read-only)
function PrinterSection({ p }: { p: SettingsResponse['printer'] }) {
  const rows: [string, string | null][] = [
    ['Name', p.name],
    ['Model', p.model],
    ['IP address', p.ip],
    ['Serial number', p.serial],
    ['Connection', p.demo ? 'Demo mode' : p.connection.status + (p.connection.error ? ` (${p.connection.error})` : '')],
    ['Printer camera', p.camera === 'jpeg' ? 'JPEG stream, port 6000' : p.camera === 'rtsp' ? 'RTSP via ffmpeg, port 322' : 'Off'],
  ];
  return (
    <section className="card s6">
      <h2>Printer</h2>
      <ul className="list">
        {rows.filter(([, v]) => v).map(([k, v]) => <li key={k}><span className="muted">{k}</span><span>{v}</span></li>)}
      </ul>
      <p className="muted small">
        These come from <code>.env</code> on the server. Change them there and restart the dashboard.
        {p.camera === 'jpeg' && <> For the printer camera, turn on <b>LAN Only Liveview</b> on the printer.</>}
      </p>
    </section>
  );
}
