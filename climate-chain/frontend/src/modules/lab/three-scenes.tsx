import { useEffect, useRef, useState } from 'react';
import type * as THREE_NS from 'three';
import { earthSun, type Molecule } from './physics';

type Three = typeof THREE_NS;
export interface SceneKit { THREE: Three; scene: THREE_NS.Scene; camera: THREE_NS.PerspectiveCamera; renderer: THREE_NS.WebGLRenderer }
export interface SceneApi { update?: (seconds: number, reduced: boolean) => void }
export type SceneSetup = (kit: SceneKit) => SceneApi | void;

const WARM = 0xfff3dc;

function disposeScene(scene: THREE_NS.Scene) {
  scene.traverse((object) => {
    const mesh = object as THREE_NS.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) { (material as THREE_NS.MeshStandardMaterial).map?.dispose?.(); material.dispose(); }
  });
}

/** One GPU-accelerated canvas with orbit/zoom, picking and full cleanup. Falls back to a message without WebGL. */
export function ThreeCanvas({ setup, label, height = 360, distance = 7, onPick }: { setup: SceneSetup; label: string; height?: number; distance?: number; onPick?: (value: unknown) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let cleanup: () => void = () => undefined;
    (async () => {
      const THREE = await import('three');
      const el = host.current;
      if (disposed || !el) return;
      let renderer: THREE_NS.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
      catch { setError('This browser or device cannot create a WebGL context, so the 3D view is unavailable. All numbers remain available as text.'); return; }
      const width = () => Math.max(240, el.clientWidth);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width(), height);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, width() / height, 0.1, 200);
      scene.add(new THREE.HemisphereLight(WARM, 0xc8bfa8, 1.1));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.position.set(5, 8, 6);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      scene.add(key);
      let api: SceneApi;
      try { api = setup({ THREE, scene, camera, renderer }) || {}; }
      catch (e) {
        disposeScene(scene); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
        setError(e instanceof Error ? `The 3D scene could not be built: ${e.message}` : 'The 3D scene could not be built.');
        return;
      }

      let azimuth = 0.6; let elevation = 0.35; let radius = distance;
      let drag: { x: number; y: number; moved: boolean } | null = null;
      const place = () => { camera.position.set(radius * Math.cos(elevation) * Math.sin(azimuth), radius * Math.sin(elevation), radius * Math.cos(elevation) * Math.cos(azimuth)); camera.lookAt(0, 0, 0); };
      const canvas = renderer.domElement;
      canvas.style.touchAction = 'none';
      const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, moved: false }; canvas.setPointerCapture(e.pointerId); };
      const move = (e: PointerEvent) => {
        if (!drag) return;
        const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
        drag.x = e.clientX; drag.y = e.clientY;
        azimuth -= dx * 0.008; elevation = Math.max(-1.2, Math.min(1.3, elevation + dy * 0.006));
      };
      const cancel = () => { drag = null; };
      const up = (e: PointerEvent) => {
        const wasClick = drag !== null && !drag.moved;
        drag = null;
        if (!wasClick || !pickRef.current) return;
        const rect = canvas.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
        const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.userData.pick !== undefined);
        pickRef.current(hit ? hit.object.userData.pick : null);
      };
      const wheel = (e: WheelEvent) => { e.preventDefault(); radius = Math.max(2.5, Math.min(30, radius * (1 + Math.sign(e.deltaY) * 0.08))); };
      canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', cancel); canvas.addEventListener('lostpointercapture', cancel); canvas.addEventListener('wheel', wheel, { passive: false });
      let visible = true; // pause the GPU loop while scrolled away or inside a closed <details>
      const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
      visibility.observe(el);
      const resize = new ResizeObserver(() => { renderer.setSize(width(), height); camera.aspect = width() / height; camera.updateProjectionMatrix(); });
      resize.observe(el);

      const reducedQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      const started = performance.now();
      let raf = 0;
      const frame = () => {
        raf = requestAnimationFrame(frame);
        if (document.hidden || !visible) return;
        const seconds = (performance.now() - started) / 1000;
        if (!reducedQuery?.matches && !drag) azimuth += 0.0015;
        place();
        api.update?.(seconds, Boolean(reducedQuery?.matches));
        renderer.render(scene, camera);
      };
      frame();
      cleanup = () => {
        cancelAnimationFrame(raf); resize.disconnect(); visibility.disconnect();
        canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', cancel); canvas.removeEventListener('lostpointercapture', cancel); canvas.removeEventListener('wheel', wheel);
        disposeScene(scene); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
      };
    })().catch((e) => { if (!disposed) setError(e instanceof Error ? e.message : '3D engine failed to load.'); });
    return () => { disposed = true; cleanup(); };
  }, [setup, height, distance]);

  return (
    <div>
      <div className="lab-canvas" role="img" aria-label={label} style={{ minHeight: height }}>
        <div ref={host} className="lab-canvas-host" />
      </div>
      {error ? <p className="lab-canvas-error" role="alert">{error}</p> : null}
    </div>
  );
}

export const ELEMENT_STYLE = { C: { color: 0x3a3733, r: 0.4 }, O: { color: 0xd9483b, r: 0.37 }, H: { color: 0xf6f0e4, r: 0.23 }, N: { color: 0x3f6fd1, r: 0.37 } } as const;

export function solarSetup(date: Date, exaggeration = 20): SceneSetup {
  return ({ THREE, scene, camera }) => {
    camera.position.set(0, 4, 8);
    const eVis = Math.min(0.5, 0.0167086 * exaggeration);
    const A = 3.2;
    const orbitAt = (nu: number) => { const r = (A * (1 - eVis * eVis)) / (1 + eVis * Math.cos(nu)); return new THREE.Vector3(r * Math.cos(nu), 0, -r * Math.sin(nu)); };
    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.55, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffc94a }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 24), new THREE.MeshBasicMaterial({ color: 0xffe3a1, transparent: true, opacity: 0.25 }));
    const sunLight = new THREE.PointLight(0xfff0cf, 90, 0, 1.6);
    sun.userData.pick = 'sun';
    scene.add(sun, glow, sunLight);
    const pts = Array.from({ length: 181 }, (_, i) => orbitAt((i / 180) * Math.PI * 2));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8b8274 })));
    const mark = (nu: number, color: number, tag: string) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color }));
      m.position.copy(orbitAt(nu)); m.userData.pick = tag; scene.add(m);
    };
    mark(0, 0xd9483b, 'perihelion'); mark(Math.PI, 0x3f6fd1, 'aphelion');
    const earth = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.rotation.z = (23.44 * Math.PI) / 180;
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.26, 48, 32), new THREE.MeshPhysicalMaterial({ color: 0x3d7ab8, roughness: 0.55, clearcoat: 0.6 }));
    globe.castShadow = true; globe.receiveShadow = true; globe.userData.pick = 'earth';
    const land = new THREE.Mesh(new THREE.IcosahedronGeometry(0.265, 2), new THREE.MeshStandardMaterial({ color: 0x6b9b57, flatShading: true, transparent: true, opacity: 0.55 }));
    tilt.add(globe, land);
    earth.add(tilt);
    earth.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.18 })));
    earth.position.copy(orbitAt(earthSun(date).trueAnomaly));
    scene.add(earth);
    return { update: (t, reduced) => { if (!reduced) tilt.rotation.y = t * 1.2; } };
  };
}

export function moleculeSetup(mol: Molecule): SceneSetup {
  return ({ THREE, scene }) => {
    const group = new THREE.Group();
    const scale = 1.4;
    mol.atoms.forEach((atom) => {
      const style = ELEMENT_STYLE[atom.el];
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(style.r * scale, 48, 32), new THREE.MeshPhysicalMaterial({ color: style.color, roughness: 0.35, clearcoat: 0.8 }));
      mesh.position.set(...atom.pos).multiplyScalar(scale);
      mesh.castShadow = true; mesh.userData.pick = atom.el;
      group.add(mesh);
    });
    for (const [a, b] of mol.bonds) {
      const from = new THREE.Vector3(...mol.atoms[a].pos).multiplyScalar(scale);
      const to = new THREE.Vector3(...mol.atoms[b].pos).multiplyScalar(scale);
      const dir = to.clone().sub(from);
      const bond = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, dir.length(), 20), new THREE.MeshStandardMaterial({ color: 0xb9b0a0, roughness: 0.5 }));
      bond.position.copy(from.clone().add(to).multiplyScalar(0.5));
      bond.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      group.add(bond);
    }
    scene.add(group);
    return { update: (t, reduced) => { if (!reduced) { group.rotation.y = t * 0.5; group.rotation.x = Math.sin(t * 0.3) * 0.15; } } };
  };
}

export interface LedgerBlock { id: string; label: string; hash: string; anchored: boolean; blockNumber?: number; summary: string; at: string }

export function ledgerSetup(blocks: LedgerBlock[]): SceneSetup {
  return ({ THREE, scene }) => {
    const shown = blocks.length ? blocks : [{ id: 'genesis', label: 'Genesis', hash: '', anchored: false, summary: 'No evidence recorded yet', at: '' }];
    const pos = shown.map((_, i) => new THREE.Vector3(Math.cos(i * 0.62) * 3.2, i * 0.55 - shown.length * 0.275, Math.sin(i * 0.62) * 3.2));
    const group = new THREE.Group();
    shown.forEach((block, i) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.62, 0.62), new THREE.MeshPhysicalMaterial(block.anchored
        ? { color: 0xc9a24a, metalness: 0.65, roughness: 0.28, clearcoat: 0.7 }
        : { color: 0xd9d0bd, metalness: 0.05, roughness: 0.55, transparent: !blocks.length, opacity: blocks.length ? 1 : 0.5 }));
      mesh.position.copy(pos[i]);
      mesh.lookAt(0, pos[i].y, 0);
      mesh.castShadow = true; mesh.userData.pick = block;
      group.add(mesh);
      if (i > 0) {
        const dir = pos[i].clone().sub(pos[i - 1]);
        const link = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, dir.length(), 10), new THREE.MeshStandardMaterial({ color: 0x8b8274 }));
        link.position.copy(pos[i - 1].clone().add(pos[i]).multiplyScalar(0.5));
        link.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        group.add(link);
      }
    });
    scene.add(group);
    return { update: (t, reduced) => { if (!reduced) group.position.y = Math.sin(t * 0.8) * 0.06; } };
  };
}
