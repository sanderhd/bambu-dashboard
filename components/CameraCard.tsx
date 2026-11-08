'use client';
import { useState } from 'react';

export default function CameraCard({ available }: { available: boolean }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = () => { setError(null); setOn(true); };

  // An <img> can't read the error body, so fetch the reason separately when the stream fails.
  const onError = async () => {
    setOn(false);
    try {
      const r = await fetch('/api/camera', { method: 'GET' });
      setError(r.ok ? 'Camera stream stopped' : await r.text());
      r.body?.cancel();
    } catch {
      setError('Camera unavailable');
    }
  };

  return (
    <section className="card s5">
      <div className="row" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Camera</h2>
        <span className="spacer" />
        {on && <button className="btn" onClick={() => setOn(false)}>Stop</button>}
      </div>
      <div className="cam">
        {on ? (
          // eslint-disable-next-line @next/next/no-img-element -- MJPEG stream, not a static image
          <img src="/api/camera" alt="Live camera view of the printer" onError={onError} />
        ) : (
          <div style={{ textAlign: 'center', padding: 16 }}>
            {error && <p style={{ margin: '0 0 12px' }}>{error}</p>}
            <button className="btn" disabled={!available} onClick={start}>
              {available ? (error ? 'Try again' : 'Start camera') : 'Camera not available'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
