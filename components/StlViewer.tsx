'use client';
// 3D preview of an STL file. three.js is loaded only when the viewer opens.
import { useEffect, useRef, useState } from 'react';

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
      const [THREE, { STLLoader }, { OrbitControls }] = await Promise.all([
        import('three'),
        import('three/addons/loaders/STLLoader.js'),
        import('three/addons/controls/OrbitControls.js'),
      ]);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status})`);
      const data = await res.arrayBuffer();
      if (cancelled || !mount.current) return;

      const geom = new STLLoader().parse(data);
      geom.computeBoundingBox();
      const bb = geom.boundingBox!;
      const dims = bb.getSize(new THREE.Vector3());
      setSize(`${dims.x.toFixed(1)} × ${dims.y.toFixed(1)} × ${dims.z.toFixed(1)} mm`);
      // Centre on X/Y and stand the model on the "bed" (Z = 0), like a slicer does.
      geom.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
      geom.computeVertexNormals();
      const r = Math.max(dims.x, dims.y, dims.z) || 10;

      const el = mount.current;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(el.clientWidth, el.clientHeight);
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, r / 100, r * 100);
      camera.up.set(0, 0, 1); // STL files are Z-up
      camera.position.set(r * 1.3, -r * 1.8, r * 1.2);

      const material = new THREE.MeshStandardMaterial({ color: color || '#2fd36b', roughness: 0.55, metalness: 0.05 });
      scene.add(new THREE.Mesh(geom, material));
      scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2));
      const sun = new THREE.DirectionalLight(0xffffff, 2.2);
      sun.position.set(r, -r, r * 2);
      scene.add(sun);
      const grid = new THREE.GridHelper(Math.ceil((r * 2) / 10) * 10, Math.ceil((r * 2) / 10), 0x777777, 0x3a3a3a);
      grid.rotation.x = Math.PI / 2;
      scene.add(grid);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0, dims.z / 2);
      controls.enableDamping = true;
      controls.update();

      let raf = 0;
      const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
      loop();
      const ro = new ResizeObserver(() => {
        camera.aspect = el.clientWidth / el.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(el.clientWidth, el.clientHeight);
      });
      ro.observe(el);
      setStatus(null);

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        geom.dispose();
        material.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
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
