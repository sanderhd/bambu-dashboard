'use client';
// 3D preview of an STL file. three.js is loaded only when the viewer opens.
import { useEffect, useRef, useState } from 'react';
import { createStlScene, loadThree } from '@/lib/stl-scene';

export default function StlViewer({ url, name, color, onClose }: { url: string; name: string; color?: string; onClose: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>('Loading model…');
  const [size, setSize] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      const three = await loadThree();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status})`);
      const data = await res.arrayBuffer();
      if (cancelled || !mount.current) return;

      const el = mount.current;
      const s = createStlScene(three, data, color, el.clientWidth, el.clientHeight);
      el.appendChild(s.renderer.domElement);
      setSize(`${s.dims.x.toFixed(1)} × ${s.dims.y.toFixed(1)} × ${s.dims.z.toFixed(1)} mm`);

      const controls = new three.OrbitControls(s.camera, s.renderer.domElement);
      controls.target.copy(s.target);
      controls.enableDamping = true;
      controls.update();

      let raf = 0;
      const loop = () => { controls.update(); s.renderer.render(s.scene, s.camera); raf = requestAnimationFrame(loop); };
      loop();
      const ro = new ResizeObserver(() => {
        s.camera.aspect = el.clientWidth / el.clientHeight;
        s.camera.updateProjectionMatrix();
        s.renderer.setSize(el.clientWidth, el.clientHeight);
      });
      ro.observe(el);
      setStatus(null);

      cleanup = () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); s.dispose(); };
    })().catch((e) => !cancelled && setStatus((e as Error).message || 'Could not show this model'));
    return () => { cancelled = true; cleanup(); };
  }, [url, color]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={`3D preview of ${name}`} onClick={(e) => e.stopPropagation()}>
        <div className="row modal-head">
          <b>{name}</b>
          {size && <span className="muted">{size}</span>}
          <span className="spacer" />
          <span className="muted small">Drag to rotate · scroll to zoom</span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="viewer" ref={mount}>{status && <div className="viewer-status">{status}</div>}</div>
      </div>
    </div>
  );
}
