import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { REGIONS } from "../regions";

export const REGION_COLORS = Object.fromEntries(REGIONS.map((r) => [r.key, r.color]));

interface BrainMeshData {
  vertices: number[];
  faces: number[];
  region_ids: number[];
  lobe_ids?: number[];
  lobes?: string[];
  n_vertices: number;
}

interface Props {
  vertexField: Float32Array | null;
  levels: Record<string, number>;
  intensity: number;
  playing?: boolean;
}

interface HoverInfo { name: string; x: number; y: number; }

/** Opaque bright whitish tissue. */
const CREAM = [0.98, 0.97, 0.95] as const;
/** Solid blue highlight for active creases / patches. */
const BLUE = [0.18, 0.48, 0.92] as const;
const BLUE_DEEP = [0.08, 0.28, 0.65] as const;

function buildAdj(n: number, faces: Uint32Array): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  const add = (a: number, b: number) => {
    const la = adj[a];
    if (la.length < 10 && !la.includes(b)) la.push(b);
    const lb = adj[b];
    if (lb.length < 10 && !lb.includes(a)) lb.push(a);
  };
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i], b = faces[i + 1], c = faces[i + 2];
    add(a, b); add(b, c); add(c, a);
  }
  return adj;
}

/** Ambient-occlusion-ish factor from local curvature (deep sulci → dark). */
function computeCavity(pos: Float32Array, nrm: Float32Array, adj: number[][], n: number) {
  const cavity = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const nbrs = adj[i];
    if (!nbrs.length) { cavity[i] = 1; continue; }
    let acc = 0;
    for (const j of nbrs) {
      let dx = pos[j * 3] - pos[i * 3];
      let dy = pos[j * 3 + 1] - pos[i * 3 + 1];
      let dz = pos[j * 3 + 2] - pos[i * 3 + 2];
      const len = Math.hypot(dx, dy, dz) || 1;
      acc += (dx / len) * nx + (dy / len) * ny + (dz / len) * nz;
    }
    const mean = acc / nbrs.length;
    cavity[i] = THREE.MathUtils.clamp(0.42 + mean * 0.95, 0.28, 1);
  }
  return cavity;
}

export default function CorticalBrain({ vertexField, levels, intensity, playing = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef(vertexField);
  const levelsRef = useRef(levels);
  const intensityRef = useRef(intensity);
  const playingRef = useRef(playing);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  useEffect(() => { fieldRef.current = vertexField; }, [vertexField]);
  useEffect(() => { levelsRef.current = levels; }, [levels]);
  useEffect(() => { intensityRef.current = intensity; }, [intensity]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    let disposed = false;
    let animId = 0;
    let cleanupFn: (() => void) | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return;

    fetch("/brain_mesh.json")
      .then((r) => r.json())
      .then((data: BrainMeshData) => {
        if (disposed) return;
        setLoading(false);
        cleanupFn = initScene(canvas, data);
      })
      .catch((err) => {
        console.error("Failed to load brain mesh:", err);
        setLoading(false);
      });

    function initScene(cvs: HTMLCanvasElement, data: BrainMeshData) {
      const nVerts = data.n_vertices;
      const rawVerts = new Float32Array(data.vertices);
      const indices = new Uint32Array(data.faces);
      const verts = new Float32Array(nVerts * 3);
      for (let i = 0; i < nVerts; i++) {
        verts[i * 3]     =  rawVerts[i * 3];
        verts[i * 3 + 1] =  rawVerts[i * 3 + 2];
        verts[i * 3 + 2] = -rawVerts[i * 3 + 1];
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox!.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);
      geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      geometry.boundingBox!.getSize(size);
      const s = 2.15 / Math.max(size.x, size.y, size.z);
      geometry.scale(s, s, s);
      geometry.computeVertexNormals();

      const pos = geometry.attributes.position.array as Float32Array;
      const nrm = geometry.attributes.normal.array as Float32Array;
      const regionIds = new Int8Array(data.region_ids);
      const lobeIds = new Int8Array(data.lobe_ids ?? []);
      const lobeNames = data.lobes ?? [];
      const adj = buildAdj(nVerts, indices);
      const cavity = computeCavity(pos, nrm, adj, nVerts);

      const renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.set(0, 0.1, 3.65);
      camera.lookAt(0, 0, 0);

      // Soft top-key + fill like the reference (bright ridges, dark folds).
      scene.add(new THREE.AmbientLight(0xffffff, 0.45));
      const key = new THREE.DirectionalLight(0xffffff, 1.15);
      key.position.set(-1.2, 5.2, 3.5);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xfff8f0, 0.35);
      fill.position.set(3.5, 0.5, 2);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xffffff, 0.35);
      rim.position.set(0.5, 1.5, -4.5);
      scene.add(rim);

      const brainGroup = new THREE.Group();
      scene.add(brainGroup);

      const colors = new Float32Array(nVerts * 3);
      for (let i = 0; i < nVerts; i++) {
        const cav = Math.pow(cavity[i], 1.15);
        colors[i * 3]     = CREAM[0] * cav;
        colors[i * 3 + 1] = CREAM[1] * cav;
        colors[i * 3 + 2] = CREAM[2] * cav;
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.78,
        metalness: 0,
        flatShading: false,
      });
      const mesh = new THREE.Mesh(geometry, mat);
      brainGroup.add(mesh);

      // Soft white silhouette halo (reference rim), not an activity outline.
      const haloGeo = geometry.clone();
      haloGeo.scale(1.025, 1.025, 1.025);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      });
      brainGroup.add(new THREE.Mesh(haloGeo, haloMat));

      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      // Mild bloom for ridge highlights only.
      const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.55, 0.88);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());

      brainGroup.rotation.set(-0.08, 1.55, 0.02);

      let isDragging = false;
      let lastX = 0, lastY = 0;
      const yAx = new THREE.Vector3(0, 1, 0);
      const xAx = new THREE.Vector3(1, 0, 0);
      const dq = new THREE.Quaternion();
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();

      const onDown = (e: PointerEvent) => {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        setHover(null);
        cvs.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (isDragging) {
          dq.setFromAxisAngle(yAx, (e.clientX - lastX) * 0.008);
          brainGroup.quaternion.premultiply(dq);
          dq.setFromAxisAngle(xAx, (e.clientY - lastY) * 0.008);
          brainGroup.quaternion.premultiply(dq);
          lastX = e.clientX;
          lastY = e.clientY;
          return;
        }
        if (!lobeIds.length) return;
        const rect = cvs.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObject(mesh, false);
        const face = hits.length ? hits[0].face : null;
        const lid = face ? lobeIds[face.a] : -1;
        if (lid >= 0 && lid < lobeNames.length) {
          setHover({ name: lobeNames[lid], x: e.clientX - rect.left, y: e.clientY - rect.top });
        } else setHover(null);
      };
      const onUp = () => { isDragging = false; };
      const onLeave = () => { isDragging = false; setHover(null); };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        camera.position.z = THREE.MathUtils.clamp(camera.position.z * (1 + e.deltaY * 0.001), 2.5, 6.5);
      };
      cvs.addEventListener("pointerdown", onDown);
      cvs.addEventListener("pointermove", onMove);
      cvs.addEventListener("pointerup", onUp);
      cvs.addEventListener("pointerleave", onLeave);
      cvs.addEventListener("wheel", onWheel, { passive: false });

      const resize = () => {
        const rect = cvs.getBoundingClientRect();
        renderer.setSize(rect.width, rect.height, false);
        composer.setSize(rect.width, rect.height);
        bloom.setSize(rect.width, rect.height);
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
      };
      const obs = new ResizeObserver(resize);
      obs.observe(cvs);
      resize();

      const clock = new THREE.Clock();
      const smoothLv = [0, 0, 0, 0, 0, 0];
      const prevLv = [0, 0, 0, 0, 0, 0];
      /** 0–1 spike envelope per region — rises with the graph, dies fast. */
      const spikeEnv = [0, 0, 0, 0, 0, 0];
      const focusA = [-1, -1, -1, -1, -1, -1];
      const focusB = [-1, -1, -1, -1, -1, -1];
      const smoothField = new Float32Array(nVerts);
      const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute;

      const byRegion: number[][] = Array.from({ length: 6 }, () => []);
      for (let i = 0; i < nVerts; i++) {
        const r = regionIds[i];
        if (r >= 0 && r < 6) byRegion[r].push(i);
      }

      const pickPatch = (region: number) => {
        const pool = byRegion[region];
        if (!pool.length) return -1;
        let best = pool[0];
        let bestS = -1;
        for (let k = 0; k < 40; k++) {
          const vi = pool[(Math.random() * pool.length) | 0];
          const score = (1 - cavity[vi]) + Math.random() * 0.2;
          if (score > bestS) { bestS = score; best = vi; }
        }
        return best;
      };

      const render = () => {
        if (disposed) return;
        const dt = Math.min(clock.getDelta(), 0.05);
        const live = playingRef.current;
        const lv = levelsRef.current;
        const vf = fieldRef.current;
        const active = live || Object.values(lv).some((v) => (v ?? 0) > 0.05);

        let maxLv = 0;
        for (let r = 0; r < 6; r++) {
          const target = active ? (lv[REGIONS[r].key] ?? 0) : 0;
          // Track graph values tightly (same lerp series the spike chart uses).
          smoothLv[r] += (target - smoothLv[r]) * Math.min(1, dt * 28);
          if (smoothLv[r] > maxLv) maxLv = smoothLv[r];
        }

        for (let r = 0; r < 6; r++) {
          const delta = smoothLv[r] - prevLv[r];
          // Spike when this line is rising or near the current graph peak.
          const nearPeak = maxLv > 0.35 && smoothLv[r] > maxLv * 0.82;
          const rising = delta > 0.004;
          const hot = active && smoothLv[r] > 0.32 && (rising || nearPeak);
          if (hot) {
            // Pop envelope to match spike height on the graph.
            const amp = Math.min(1, 0.35 + smoothLv[r] * 0.75);
            spikeEnv[r] = Math.max(spikeEnv[r], amp);
            if (focusA[r] < 0 || (rising && delta > 0.012)) {
              focusA[r] = pickPatch(r);
              focusB[r] = Math.random() < 0.6 ? pickPatch(r) : -1;
            }
          } else {
            // Die fast — no lingering after the graph drops.
            spikeEnv[r] *= Math.exp(-dt * 9);
            if (spikeEnv[r] < 0.06) {
              spikeEnv[r] = 0;
              focusA[r] = -1;
              focusB[r] = -1;
            }
          }
          prevLv[r] = smoothLv[r];
        }

        const easeIn = 1 - Math.pow(0.0000005, dt);
        const easeOut = 1 - Math.pow(0.000002, dt);
        // Larger patches that still read as local sections.
        const sigma = 0.16;
        let peak = 0;

        for (let i = 0; i < nVerts; i++) {
          let t = 0;
          if (vf && vf.length === nVerts) {
            const v = vf[i];
            t = v > 0.5 ? Math.pow((v - 0.5) / 0.5, 0.65) : 0;
          } else if (active) {
            const r = regionIds[i];
            if (r >= 0 && r < 6 && spikeEnv[r] > 0.05 && focusA[r] >= 0) {
              const amp = spikeEnv[r];
              const fa = focusA[r];
              const dx = pos[i * 3] - pos[fa * 3];
              const dy = pos[i * 3 + 1] - pos[fa * 3 + 1];
              const dz = pos[i * 3 + 2] - pos[fa * 3 + 2];
              t = amp * Math.exp(-(dx * dx + dy * dy + dz * dz) / sigma);
              if (focusB[r] >= 0) {
                const fb = focusB[r];
                const bx = pos[i * 3] - pos[fb * 3];
                const by = pos[i * 3 + 1] - pos[fb * 3 + 1];
                const bz = pos[i * 3 + 2] - pos[fb * 3 + 2];
                t = Math.max(t, amp * 0.88 * Math.exp(-(bx * bx + by * by + bz * bz) / (sigma * 0.95)));
              }
              t *= 0.85 + 0.25 * (1 - cavity[i]);
              t = Math.min(1, t);
            }
          }

          const ease = t > smoothField[i] ? easeIn : easeOut;
          smoothField[i] += (t - smoothField[i]) * ease;
          const a = smoothField[i] < 0.12 ? 0 : Math.min(1, smoothField[i] * 1.25);
          if (a > peak) peak = a;

          const cav = Math.pow(cavity[i], 1.15);
          const baseR = CREAM[0] * cav;
          const baseG = CREAM[1] * cav;
          const baseB = CREAM[2] * cav;
          const shade = 0.9 + 0.1 * cav;
          const br = BLUE[0] * (1 - a * 0.15) + BLUE_DEEP[0] * a * 0.15;
          const bg = BLUE[1] * (1 - a * 0.12) + BLUE_DEEP[1] * a * 0.12;
          const bb = BLUE[2] * (1 - a * 0.08) + BLUE_DEEP[2] * a * 0.08;
          colors[i * 3]     = baseR * (1 - a) + br * shade * a;
          colors[i * 3 + 1] = baseG * (1 - a) + bg * shade * a;
          colors[i * 3 + 2] = baseB * (1 - a) + bb * shade * a;
        }
        colorAttr.needsUpdate = true;
        bloom.strength = 0.14 + peak * 0.18;
        haloMat.opacity = 0.07 + intensityRef.current * 0.04;

        composer.render();
        animId = requestAnimationFrame(render);
      };
      animId = requestAnimationFrame(render);

      return () => {
        cancelAnimationFrame(animId);
        obs.disconnect();
        cvs.removeEventListener("pointerdown", onDown);
        cvs.removeEventListener("pointermove", onMove);
        cvs.removeEventListener("pointerup", onUp);
        cvs.removeEventListener("pointerleave", onLeave);
        cvs.removeEventListener("wheel", onWheel);
        geometry.dispose();
        haloGeo.dispose();
        mat.dispose();
        haloMat.dispose();
        composer.dispose();
        renderer.dispose();
      };
    }

    return () => {
      disposed = true;
      if (cleanupFn) cleanupFn();
    };
  }, []);

  return (
    <div className="brain-container">
      {loading && <div className="brain-loading">Loading cortical mesh…</div>}
      <canvas ref={canvasRef} className="brain-canvas" tabIndex={0} />
      {hover && (
        <div className="brain-tooltip" style={{ left: hover.x + 14, top: hover.y + 12 }}>
          {hover.name}
        </div>
      )}
      <div className="brain-labels">
        <span className="brain-hint">DRAG TO ROTATE · HOVER FOR LOBE</span>
      </div>
    </div>
  );
}
