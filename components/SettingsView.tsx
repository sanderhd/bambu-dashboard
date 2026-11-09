'use client';
import { useEffect, useState } from 'react';
import Header from './Header';
import type { CameraConfig, Connection, NotifyEvent, PrinterInfo } from '@/lib/types';

type SettingsResponse = {
  cameras: CameraConfig[];
  defaultCamera?: string;
  ha: { url: string; powerEntity: string; energyEntity: string; tokenSet: boolean } | null;
  notify: { events: NotifyEvent[]; snapshot: boolean; camera: string; pushbulletSet: boolean; discordSet: boolean };
  printHoursOffset?: number;
  totalPrintHours: number;
  countedPrintHours: number;
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
            <HomeAssistantSection ha={data.ha} onSaved={(d) => setData({ ...data, ...d })} />
            <NotificationsSection data={data} onSaved={(d) => setData({ ...data, ...d })} />
            <PasswordSection />
            <PrinterSection data={data} onSaved={(d) => setData({ ...data, ...d })} />
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

// ---------------------------------------------------------------- Home Assistant (smart plug)
const DEFAULT_POWER = 'sensor.grillplats_plug_vermogen';
const DEFAULT_ENERGY = 'sensor.grillplats_plug_energie';

function HomeAssistantSection({ ha, onSaved }: { ha: SettingsResponse['ha']; onSaved: (d: Partial<SettingsResponse>) => void }) {
  const [url, setUrl] = useState(ha?.url ?? '');
  const [token, setToken] = useState('');
  const [power, setPower] = useState(ha?.powerEntity ?? DEFAULT_POWER);
  const [energy, setEnergy] = useState(ha?.energyEntity ?? DEFAULT_ENERGY);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tests, setTests] = useState<{ entity: string; ok: boolean; message: string }[] | null>(null);

  const body = { url, token, powerEntity: power, energyEntity: energy };
  const test = async () => {
    setTests(null);
    const r = await api('/api/settings/test-ha', 'POST', body);
    setTests(r.results ?? []);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api('/api/settings', 'PUT', { ha: body });
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setToken('');
    onSaved({ ha: r.ha });
    setMsg({ ok: true, text: 'Saved. Power shows on the dashboard; energy is recorded for each print from now on.' });
  };
  const disconnect = async () => {
    if (!confirm('Stop reading the smart plug from Home Assistant?')) return;
    const r = await api('/api/settings', 'PUT', { ha: null });
    if (r.ok) { onSaved({ ha: null }); setMsg({ ok: true, text: 'Disconnected.' }); }
  };

  return (
    <section className="card s6">
      <h2>Home Assistant</h2>
      <p className="muted small">
        Reads your printer&apos;s smart plug: live power on the dashboard and energy (kWh) per print.
        Create a token in Home Assistant under <b>your profile → Security → Long-lived access tokens</b>.
      </p>
      <form onSubmit={save}>
        <label className="field"><span>Home Assistant URL</span>
          <input className="mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.178.10:8123" required /></label>
        <label className="field"><span>Long-lived access token {ha?.tokenSet && '(saved, leave empty to keep it)'}</span>
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={ha?.tokenSet ? '••••••••' : ''} required={!ha?.tokenSet} /></label>
        <label className="field"><span>Power sensor (W)</span>
          <input className="mono" value={power} onChange={(e) => setPower(e.target.value)} placeholder={DEFAULT_POWER} /></label>
        <label className="field"><span>Energy sensor (kWh)</span>
          <input className="mono" value={energy} onChange={(e) => setEnergy(e.target.value)} placeholder={DEFAULT_ENERGY} /></label>
        {tests && (
          <ul className="test-results">
            {tests.map((t) => <li key={t.entity} className={t.ok ? 'ok-msg' : 'bad-msg'}>{t.ok ? '✓' : '✗'} {t.entity}: {t.message}</li>)}
          </ul>
        )}
        <div className="row">
          <button className="btn primary">Save</button>
          <button type="button" className="btn" onClick={test} disabled={!url}>Test</button>
          <span className="spacer" />
          {ha && <button type="button" className="btn danger" onClick={disconnect}>Disconnect</button>}
        </div>
        {msg && <p className={msg.ok ? 'ok-msg' : 'bad-msg'}>{msg.text}</p>}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- notifications
const EVENTS: [NotifyEvent, string][] = [
  ['finished', 'Print finished'],
  ['failed', 'Print failed or stopped'],
  ['paused', 'Print paused (e.g. filament runout)'],
  ['hms', 'New printer alert (HMS)'],
  ['maintenance', 'Maintenance due'],
  ['started', 'Print started'],
];

function NotificationsSection({ data, onSaved }: { data: SettingsResponse; onSaved: (d: Partial<SettingsResponse>) => void }) {
  const n = data.notify;
  const [pushbullet, setPushbullet] = useState('');
  const [discord, setDiscord] = useState('');
  const [events, setEvents] = useState<NotifyEvent[]>(n.events);
  const [snapshot, setSnapshot] = useState(n.snapshot);
  const [camera, setCamera] = useState(n.camera);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tests, setTests] = useState<{ service: string; ok: boolean; message: string }[] | 'busy' | null>(null);
  const cameras = [
    ...(data.printer.camera !== 'off' ? [{ id: 'printer', name: 'Printer camera' }] : []),
    ...data.cameras.filter((c) => c.id).map((c) => ({ id: c.id, name: c.name })),
  ];

  const toggle = (e: NotifyEvent) => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e]);
  const test = async () => {
    setTests('busy');
    const r = await api('/api/settings/test-notify', 'POST', { pushbullet, discord, snapshot, camera })
      .catch(() => ({ results: [{ service: 'Server', ok: false, message: 'unreachable' }] }));
    setTests(r.results ?? []);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api('/api/settings', 'PUT', { notify: { pushbullet, discord, events, snapshot, camera } });
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setPushbullet('');
    setDiscord('');
    onSaved({ notify: r.notify });
    setMsg({ ok: true, text: r.notify.pushbulletSet || r.notify.discordSet ? 'Saved. Notifications are on.' : 'Saved. Add Pushbullet or Discord to receive notifications.' });
  };
  const remove = async (service: 'pushbullet' | 'discord') => {
    if (!confirm(`Stop sending notifications to ${service === 'pushbullet' ? 'Pushbullet' : 'Discord'}?`)) return;
    const r = await api('/api/settings', 'PUT', { notify: { [service]: null } });
    if (r.ok) { onSaved({ notify: r.notify }); setMsg({ ok: true, text: 'Removed.' }); }
  };

  return (
    <section className="card s6">
      <h2>Notifications</h2>
      <p className="muted small">
        Get a message on your phone or in a Discord channel. Fill in one or both; they work even when no browser is open.
      </p>
      <form onSubmit={save}>
        <label className="field"><span>Pushbullet access token {n.pushbulletSet && '(saved, leave empty to keep it)'}</span>
          <input type="password" autoComplete="off" className="mono" value={pushbullet} onChange={(e) => setPushbullet(e.target.value)}
            placeholder={n.pushbulletSet ? '••••••••' : 'o.xxxxxxxxxxxxxxxx'} /></label>
        <p className="muted small" style={{ marginTop: -6 }}>
          Create one at pushbullet.com under <b>Settings → Account → Create Access Token</b>.
        </p>
        <label className="field"><span>Discord webhook URL {n.discordSet && '(saved, leave empty to keep it)'}</span>
          <input type="password" autoComplete="off" className="mono" value={discord} onChange={(e) => setDiscord(e.target.value)}
            placeholder={n.discordSet ? '••••••••' : 'https://discord.com/api/webhooks/…'} /></label>
        <p className="muted small" style={{ marginTop: -6 }}>
          In Discord: <b>channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL</b>.
        </p>

        <div className="label">Send a notification when</div>
        {EVENTS.map(([e, label]) => (
          <label key={e} className="toggle" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={events.includes(e)} onChange={() => toggle(e)} /> {label}
          </label>
        ))}

        <div className="label">Camera image</div>
        <label className="toggle" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={snapshot} onChange={(e) => setSnapshot(e.target.checked)} /> Attach a camera image to print notifications
        </label>
        {snapshot && cameras.length > 1 && (
          <label className="field"><span>Camera</span>
            <select value={camera} onChange={(e) => setCamera(e.target.value)}>
              <option value="">Default camera</option>
              {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
        )}

        {tests === 'busy' && <p className="muted">Sending…</p>}
        {Array.isArray(tests) && (
          <ul className="test-results">
            {tests.map((t) => <li key={t.service} className={t.ok ? 'ok-msg' : 'bad-msg'}>{t.ok ? '✓' : '✗'} {t.service}: {t.message}</li>)}
          </ul>
        )}
        <div className="row">
          <button className="btn primary">Save</button>
          <button type="button" className="btn" onClick={test} disabled={tests === 'busy' || (!pushbullet && !discord && !n.pushbulletSet && !n.discordSet)}>Send test</button>
          <span className="spacer" />
          {n.pushbulletSet && <button type="button" className="btn danger" onClick={() => remove('pushbullet')}>Remove Pushbullet</button>}
          {n.discordSet && <button type="button" className="btn danger" onClick={() => remove('discord')}>Remove Discord</button>}
        </div>
        {msg && <p className={msg.ok ? 'ok-msg' : 'bad-msg'}>{msg.text}</p>}
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- printer
function PrinterSection({ data, onSaved }: { data: SettingsResponse; onSaved: (d: Partial<SettingsResponse>) => void }) {
  const p = data.printer;
  const [offset, setOffset] = useState(String(data.printHoursOffset ?? 0));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saveHours = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api('/api/settings', 'PUT', { printHoursOffset: offset });
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    onSaved({ printHoursOffset: r.printHoursOffset, totalPrintHours: r.totalPrintHours });
    setMsg({ ok: true, text: `Saved. Total: ${r.totalPrintHours} print hours.` });
  };
  const rows: [string, string | null][] = [
    ['Name', p.name],
    ['Model', p.model],
    ['IP address', p.ip],
    ['Serial number', p.serial],
    ['Connection', p.demo ? 'Demo mode' : p.connection.status + (p.connection.error ? ` (${p.connection.error})` : '')],
    ['Printer camera', p.camera === 'jpeg' ? 'JPEG stream, port 6000' : p.camera === 'rtsp' ? 'RTSP via ffmpeg, port 322' : 'Off'],
  ];
  return (
    <section className="card s6" id="printer">
      <h2>Printer</h2>
      <ul className="list">
        {rows.filter(([, v]) => v).map(([k, v]) => <li key={k}><span className="muted">{k}</span><span>{v}</span></li>)}
      </ul>
      <form onSubmit={saveHours} style={{ marginTop: 14 }}>
        <label className="field">
          <span>Print hours before this dashboard (for maintenance reminders)</span>
          <input type="number" min={0} step="0.1" value={offset} onChange={(e) => setOffset(e.target.value)} />
        </label>
        <p className="muted small">
          The A1 doesn&apos;t report its total print time, so fill in the hours it had already printed.
          You can find it in the Bambu Handy app or on the printer. Counted by the dashboard so far: {data.countedPrintHours} h.
          Total now: <b>{data.totalPrintHours} h</b>.
        </p>
        <div className="row">
          <button className="btn primary">Save print hours</button>
          {msg && <span className={msg.ok ? 'ok-msg' : 'bad-msg'}>{msg.text}</span>}
        </div>
      </form>
      <p className="muted small">
        These come from <code>.env</code> on the server. Change them there and restart the dashboard.
        {p.camera === 'jpeg' && <> For the printer camera, turn on <b>LAN Only Liveview</b> on the printer.</>}
      </p>
    </section>
  );
}
