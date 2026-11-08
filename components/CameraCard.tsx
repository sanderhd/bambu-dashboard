'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CameraInfo } from '@/lib/types';

const STORAGE_KEY = 'bambu-dashboard:camera';

function remembered(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function remember(id: string) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode etc. */ }
}

export default function CameraCard() {
  const [cameras, setCameras] = useState<CameraInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cameras').then((r) => r.json()).then((d: { cameras: CameraInfo[]; defaultCamera: string | null }) => {
      setCameras(d.cameras);
      const mine = remembered();
      setSelected(d.cameras.some((c) => c.id === mine) ? mine : d.defaultCamera);
    }).catch(() => setCameras([]));
  }, []);

  const checkStatus = useCallback(async (id: string) => {
    try {
      const s = await fetch(`/api/camera/${id}/status`).then((r) => r.json());
      setError(s.error ?? null);
      return s.error as string | null;
    } catch {
      setError('Camera unavailable');
      return 'Camera unavailable';
    }
  }, []);

  // While watching, show the reason when a stream stalls (the <img> keeps its last frame).
  useEffect(() => {
    if (!on || !selected) return;
    const t = setInterval(() => checkStatus(selected), 5000);
    return () => clearInterval(t);
  }, [on, selected, checkStatus]);

  const start = () => { setError(null); setNonce(Date.now()); setOn(true); };
  const choose = (id: string) => { setSelected(id); remember(id); setError(null); if (on) setNonce(Date.now()); };
  const onImgError = async () => {
    if (!selected) return;
    setOn(false);
    if (!(await checkStatus(selected))) setError('The camera stream stopped');
  };

  const current = cameras?.find((c) => c.id === selected);

  return (
    <section className="card s5">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Camera</h2>
        <span className="spacer" />
        {cameras && cameras.length > 1 && (
          <select aria-label="Choose camera" value={selected ?? ''} onChange={(e) => choose(e.target.value)}>
            {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {on && <button className="btn" onClick={() => setOn(false)}>Stop</button>}
      </div>
      <div className="cam">
        {on && selected ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- MJPEG stream, not a static image */}
            <img key={`${selected}-${nonce}`} src={`/api/camera/${selected}?t=${nonce}`} alt={`Live view: ${current?.name ?? 'camera'}`} onError={onImgError} />
            {error && <div className="cam-overlay">{error}</div>}
          </>
        ) : (
          <div className="cam-idle">
            {cameras === null ? <p>Loading…</p> : !cameras.length ? (
              <p>No camera available. <Link href="/settings">Add one in Settings</Link>.</p>
            ) : (
              <>
                {error && <p className="cam-error">{error}</p>}
                <button className="btn" onClick={start}>{error ? 'Try again' : `Start ${current?.name ?? 'camera'}`}</button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
