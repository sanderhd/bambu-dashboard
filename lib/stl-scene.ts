'use client';
// Shared three.js setup for STL files: the 3D viewer and the preview-image renderer use the same look.
// three.js is imported dynamically so it never weighs down pages that don't show a model.

export async function loadThree() {
  const [THREE, { STLLoader }, { OrbitControls }] = await Promise.all([
    import('three'),
    import('three/addons/loaders/STLLoader.js'),
    import('three/addons/controls/OrbitControls.js'),
  ]);
  return { THREE, STLLoader, OrbitControls };
}

type Three = Awaited<ReturnType<typeof loadThree>>;

/** Builds a scene with the model standing on a grid, centred, lit like a slicer preview. */
export function createStlScene({ THREE, STLLoader }: Three, data: ArrayBuffer, color: string | undefined, width: number, height: number, opts: { preserveDrawingBuffer?: boolean; grid?: boolean } = {}) {
  const geom = new STLLoader().parse(data);
  geom.computeBoundingBox();
  const bb = geom.boundingBox!;
  const dims = bb.getSize(new THREE.Vector3());
  // Centre on X/Y and stand the model on the "bed" (Z = 0).
  geom.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  geom.computeVertexNormals();
  const r = Math.max(dims.x, dims.y, dims.z) || 10;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
  renderer.setPixelRatio(opts.preserveDrawingBuffer ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, width / height, r / 100, r * 100);
  camera.up.set(0, 0, 1); // STL files are Z-up
  camera.position.set(r * 1.3, -r * 1.8, r * 1.2);
  camera.lookAt(0, 0, dims.z / 2);

  const material = new THREE.MeshStandardMaterial({ color: color || '#2fd36b', roughness: 0.55, metalness: 0.05 });
  scene.add(new THREE.Mesh(geom, material));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(r, -r, r * 2);
  scene.add(sun);
  if (opts.grid !== false) {
    const grid = new THREE.GridHelper(Math.ceil((r * 2) / 10) * 10, Math.ceil((r * 2) / 10), 0x777777, 0x3a3a3a);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
  }

  return {
    renderer, scene, camera, dims,
    target: new THREE.Vector3(0, 0, dims.z / 2),
    dispose() { geom.dispose(); material.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}

/** Renders a square PNG preview of an STL file, for parts that have no image yet. */
export async function renderStlThumbnail(url: string, color?: string, size = 320): Promise<Blob> {
  const three = await loadThree();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const s = createStlScene(three, await res.arrayBuffer(), color, size, size, { preserveDrawingBuffer: true, grid: false });
  try {
    s.renderer.render(s.scene, s.camera);
    return await new Promise<Blob>((resolve, reject) =>
      s.renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not render'))), 'image/png'));
  } finally {
    s.dispose();
  }
}
