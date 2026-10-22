// The Climate Chain globe: a real WebGL scene (Three.js) showing Earth as a
// hologram wireframe, the four pilots as glowing beacons with beams, and
// optional schematic arcs between pilots. Arcs are not measured relationships.
// Drag to rotate, wheel to zoom, auto-rotates when idle.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Overview } from '../types';

const PILOTS: { id: string; name: string; lat: number; lng: number; color: number }[] = [
  { id: 'waste', name: 'JunkSnap', lat: 26.29, lng: 73.02, color: 0xf0b429 },
  { id: 'fire', name: 'clearsky', lat: 30.9, lng: 75.85, color: 0xff7a3d },
  { id: 'water', name: 'Teesri Shikayat', lat: 19.12, lng: 72.84, color: 0x38bdf8 },
  { id: 'air', name: 'The Vayu Project', lat: 28.61, lng: 77.23, color: 0xa78bfa },
];

// Decorative pilot-to-pilot links for the overview only.
const CHAIN: [number, number][] = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
];

function toVec3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function circlePoints(segments: number, radius: number): Float32Array {
  const pts = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts[i * 3] = Math.cos(a) * radius;
    pts[i * 3 + 1] = 0;
    pts[i * 3 + 2] = Math.sin(a) * radius;
  }
  return pts;
}

export function Globe3D({ data, showPilotBeacons = true, showSchematicLinks = true, showWasteSites = true, reviewSite = null }: { data: Overview; showPilotBeacons?: boolean; showSchematicLinks?: boolean; showWasteSites?: boolean; reviewSite?: { lat: number; lng: number } | null }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const reviewLat = reviewSite?.lat;
  const reviewLng = reviewSite?.lng;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const R = 10;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    const mappedWaste = data.waste.sites.filter((site) => site.lat != null && site.lng != null).length;
    const plottedDescription = reviewLat !== undefined && reviewLng !== undefined
      ? 'The selected public waste site and its Vayu query place are plotted.'
      : mappedWaste + ' waste locations are plotted when supplied by the source.';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D climate globe. Use arrow keys to rotate and plus or minus to zoom. ' + plottedDescription);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, mount.clientWidth / mount.clientHeight, 0.1, 500);
    camera.position.set(0, 2.5, 34);

    const globe = new THREE.Group();
    globe.rotation.x = 0.42;
    scene.add(globe);

    // --- the dark body (occludes the far wireframe so the sphere reads as solid) ---
    globe.add(new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.985, 48, 48),
      new THREE.MeshBasicMaterial({ color: 0x0a1428 }),
    ));

    // --- hologram wireframe ---
    globe.add(new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(R * 0.99, 3)),
      new THREE.LineBasicMaterial({ color: 0x2a4d7f, transparent: true, opacity: 0.3 }),
    ));

    // --- graticule: latitude rings and meridians ---
    const gratMat = new THREE.LineBasicMaterial({ color: 0x1c3a63, transparent: true, opacity: 0.45 });
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = R * Math.sin((lat * Math.PI) / 180);
      const rad = R * Math.cos((lat * Math.PI) / 180);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(circlePoints(96, rad), 3));
      const ring = new THREE.LineLoop(geo, gratMat);
      ring.position.y = y;
      globe.add(ring);
    }
    for (let lng = 0; lng < 180; lng += 30) {
      const meridian = new THREE.LineLoop(
        (() => {
          const seg = 96;
          const pts = new Float32Array(seg * 3);
          for (let i = 0; i < seg; i++) {
            const a = (i / seg) * Math.PI * 2;
            pts[i * 3] = Math.cos(a) * R;
            pts[i * 3 + 1] = Math.sin(a) * R;
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
          return geo;
        })(),
        gratMat,
      );
      meridian.rotation.y = (lng * Math.PI) / 180;
      globe.add(meridian);
    }

    // --- orbital chain rings (decorative, tilted to pass over the pilots) ---
    const dashMat = new THREE.LineDashedMaterial({ color: 0x3f6bb0, dashSize: 0.35, gapSize: 0.55, transparent: true, opacity: 0.4 });
    for (const tilt of [0.95, -0.7]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(circlePoints(128, R * 1.32), 3));
      const ring = new THREE.LineLoop(geo, dashMat);
      ring.computeLineDistances();
      ring.rotation.x = tilt;
      ring.rotation.y = tilt * 0.6;
      globe.add(ring);
    }

    // --- star field ---
    const starGeo = new THREE.BufferGeometry();
    const starCount = 700;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 90);
      starPos[i * 3] = v.x;
      starPos[i * 3 + 1] = v.y;
      starPos[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9db8e0, size: 0.45, transparent: true, opacity: 0.8 })));

    // --- atmosphere halo behind the globe ---
    const glow = glowTexture();
    const haloMat = () => new THREE.SpriteMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

    // --- pilot beacons: dot + beam + pulsing halo ---
    const beamMats: THREE.MeshBasicMaterial[] = [];
    const halos: THREE.Sprite[] = [];
    const positions = PILOTS.map((p) => toVec3(p.lat, p.lng, R));
    if (showPilotBeacons) PILOTS.forEach((p, i) => {
      const pos = positions[i];
      const normal = pos.clone().normalize();
      const color = new THREE.Color(p.color);

      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshBasicMaterial({ color }));
      dot.position.copy(pos);
      globe.add(dot);

      const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
      beamMats.push(beamMat);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 2.4, 6), beamMat);
      beam.position.copy(normal).multiplyScalar(R + 1.2);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      globe.add(beam);

      const halo = new THREE.Sprite(haloMat());
      halo.material.color = color;
      halo.scale.setScalar(1.4);
      halo.position.copy(normal).multiplyScalar(R * 1.02);
      globe.add(halo);
      halos.push(halo);
    });

    // Plot real JunkSnap site coordinates when the API supplies them. The
    // source badge in the UI still controls whether these points are live or mock.
    const wastePositions = (showWasteSites ? data.waste.sites : [])
      .filter((site) => typeof site.lat === 'number' && typeof site.lng === 'number')
      .slice(0, 500)
      .map((site) => toVec3(site.lat!, site.lng!, R + 0.08));
    if (wastePositions.length > 0) {
      const positions = new Float32Array(wastePositions.length * 3);
      wastePositions.forEach((position, i) => {
        positions[i * 3] = position.x;
        positions[i * 3 + 1] = position.y;
        positions[i * 3 + 2] = position.z;
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: data.sources.junksnap.mode === 'live' ? 0xffd166 : 0xc28a24,
        size: 0.26,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.92,
      });
      globe.add(new THREE.Points(geometry, material));
    }

    if (reviewLat !== undefined && Number.isFinite(reviewLat) && reviewLng !== undefined && Number.isFinite(reviewLng)) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 18, 18),
        new THREE.MeshBasicMaterial({ color: 0xffd166, wireframe: true }),
      );
      marker.position.copy(toVec3(reviewLat, reviewLng, R + 0.2));
      globe.add(marker);
    }

    // Vayu's selected place is a separate beacon; household coordinates are
    // deliberately not rendered here.
    if (data.air.place) {
      const pos = toVec3(data.air.place.lat, data.air.place.lng, R + 0.17);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 18, 18),
        new THREE.MeshBasicMaterial({ color: data.sources.vayu.mode === 'live' ? 0xd5c6ff : 0x7562a8, wireframe: true }),
      );
      marker.position.copy(pos);
      globe.add(marker);
    }

    // --- schematic overview arcs; hidden in evidence-specific review mode ---
    if (showSchematicLinks) CHAIN.forEach(([a, b]) => {
      const mid = positions[a].clone().add(positions[b]).multiplyScalar(0.5).normalize().multiplyScalar(R * 1.45);
      const curve = new THREE.QuadraticBezierCurve3(positions[a], mid, positions[b]);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(PILOTS[a].color).lerp(new THREE.Color(PILOTS[b].color), 0.5),
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
      });
      globe.add(new THREE.Line(geo, mat));
    });

    // --- interaction: drag to rotate, wheel to zoom, auto-rotate when idle ---
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let idleTimer = 0;
    let rotX = 0.42;
    let camZ = 34;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      globe.rotation.y += (e.clientX - lastX) * 0.005;
      rotX = Math.max(-0.6, Math.min(1.25, rotX + (e.clientY - lastY) * 0.004));
      globe.rotation.x = rotX;
      lastX = e.clientX;
      lastY = e.clientY;
      idleTimer = 0;
    };
    const onUp = () => {
      dragging = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const step = 0.12;
      if (e.key === 'ArrowLeft') globe.rotation.y -= step;
      else if (e.key === 'ArrowRight') globe.rotation.y += step;
      else if (e.key === 'ArrowUp') { rotX = Math.min(1.25, rotX + step); globe.rotation.x = rotX; }
      else if (e.key === 'ArrowDown') { rotX = Math.max(-0.6, rotX - step); globe.rotation.x = rotX; }
      else if (e.key === '+' || e.key === '=') camZ = Math.max(22, camZ - 2);
      else if (e.key === '-') camZ = Math.min(48, camZ + 2);
      else return;
      e.preventDefault();
      idleTimer = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camZ = Math.max(22, Math.min(48, camZ + e.deltaY * 0.02));
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);
    renderer.domElement.addEventListener('keydown', onKeyDown);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // --- animate ---
    const timer = new THREE.Timer();
    timer.connect(document);
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      timer.update();
      const t = timer.getElapsed();
      idleTimer += 1;
      if (!reduceMotion && !dragging && idleTimer > 90) globe.rotation.y += 0.0016;
      camera.position.z += (camZ - camera.position.z) * 0.08;
      if (!reduceMotion) {
        beamMats.forEach((m, i) => {
          m.opacity = 0.55 + 0.4 * Math.sin(t * 2.2 + i * 1.7);
        });
        halos.forEach((h, i) => {
          const s = 1.2 + 0.35 * Math.sin(t * 2 + i * 1.5);
          h.scale.setScalar(s);
        });
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointerleave', onUp);
      renderer.domElement.removeEventListener('pointercancel', onUp);
      renderer.domElement.removeEventListener('keydown', onKeyDown);
      renderer.domElement.removeEventListener('wheel', onWheel);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      timer.dispose();
      glow.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, [data, showPilotBeacons, showSchematicLinks, showWasteSites, reviewLat, reviewLng]);

  return <div className="globe-wrap" ref={mountRef} />;
}
