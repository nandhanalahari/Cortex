import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { api } from "../api";

const REGIONS = [
  { key: "visual",             label: "Visual",               short: "VIS",  color: "#4fc3f7", rgb: [0.31, 0.76, 0.97] },
  { key: "language",           label: "Language",              short: "LANG", color: "#81c784", rgb: [0.51, 0.78, 0.52] },
  { key: "reward_novelty",     label: "Reward / Novelty",     short: "RWD",  color: "#ffb74d", rgb: [1.00, 0.72, 0.30] },
  { key: "memory_familiarity", label: "Memory",               short: "MEM",  color: "#ba68c8", rgb: [0.73, 0.41, 0.78] },
  { key: "emotional_arousal",  label: "Emotional Arousal",    short: "EMO",  color: "#e57373", rgb: [0.90, 0.45, 0.45] },
  { key: "attention_salience", label: "Attention / Salience",  short: "ATTN", color: "#9fa8da", rgb: [0.62, 0.66, 0.85] },
] as const;

export const REGION_COLORS = Object.fromEntries(REGIONS.map((r) => [r.key, r.color]));

interface BrainMeshData {
  vertices: number[];
  faces: number[];
  region_ids: number[];
  lobe_ids?: number[];
  lobes?: string[];
  n_vertices: number;
  n_left: number;
}

interface HeatmapData {
  nWindows: number;
  nVerts: number;
  starts: number[];
  windows: Float32Array[];
}

interface Props {
  levels: Record<string, number>;
  intensity: number;
  videoId?: string;
  currentTime: number;
}

interface HoverInfo { name: string; x: number; y: number; }

function heatmapColor(t: number, out: [number, number, number]) {
  const v = Math.max(0, Math.min(1, t));
  if (v < 0.25) {
    const s = v / 0.25;
    out[0] = 0.0;          out[1] = s * 0.8;       out[2] = 0.3 + s * 0.7;
  } else if (v < 0.5) {
    const s = (v - 0.25) / 0.25;
    out[0] = s * 0.2;      out[1] = 0.8 + s * 0.2; out[2] = 1.0 - s * 0.7;
  } else if (v < 0.75) {
    const s = (v - 0.5) / 0.25;
    out[0] = 0.2 + s * 0.8; out[1] = 1.0 - s * 0.1; out[2] = 0.3 - s * 0.3;
  } else {
    const s = (v - 0.75) / 0.25;
    out[0] = 1.0;          out[1] = 0.9 - s * 0.9; out[2] = 0.0;
  }
}

export default function CorticalBrain({ levels, intensity, videoId, currentTime }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef(levels);
  const intensityRef = useRef(intensity);
  const timeRef = useRef(currentTime);
  const heatmapRef = useRef<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [hasHeatmap, setHasHeatmap] = useState(false);

  useEffect(() => { levelsRef.current = levels; }, [levels]);
  useEffect(() => { intensityRef.current = intensity; }, [intensity]);
  useEffect(() => { timeRef.current = currentTime; }, [currentTime]);

  useEffect(() => {
    if (!videoId) { heatmapRef.current = null; setHasHeatmap(false); return; }
    let cancelled = false;
    api.brainHeatmap(videoId).then((data) => {
      if (cancelled) return;
      heatmapRef.current = data;
      setHasHeatmap(!!data);
    });
    return () => { cancelled = true; };
  }, [videoId]);

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
      .catch((err) => { console.error("Failed to load brain mesh:", err); setLoading(false); });

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
      const scale = 2.2 / Math.max(size.x, size.y, size.z);
      geometry.scale(scale, scale, scale);

      const regionIds = new Int8Array(data.region_ids);
      const lobeIds = new Int8Array(data.lobe_ids ?? []);
      const lobeNames = data.lobes ?? [];

      const renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x050508, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x050508);
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.set(0, 0.1, 3.9);
      camera.lookAt(0, 0, 0);

      scene.add(new THREE.AmbientLight(0x2a2620, 0.7));
      const keyLight = new THREE.DirectionalLight(0xfff2e0, 1.0);
      keyLight.position.set(-3, 4, 5); scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x9098b0, 0.35);
      rimLight.position.set(3, -2, -4); scene.add(rimLight);
      const topLight = new THREE.DirectionalLight(0xd8d0c0, 0.35);
      topLight.position.set(0, 5, 0); scene.add(topLight);

      const brainGroup = new THREE.Group();
      scene.add(brainGroup);

      const innerGeo = geometry.clone();
      innerGeo.scale(0.97, 0.97, 0.97);
      const DARK = [0.015, 0.015, 0.03] as const;
      const innerColors = new Float32Array(nVerts * 3);
      for (let i = 0; i < nVerts; i++) {
        innerColors[i * 3] = DARK[0]; innerColors[i * 3 + 1] = DARK[1]; innerColors[i * 3 + 2] = DARK[2];
      }
      innerGeo.setAttribute("color", new THREE.BufferAttribute(innerColors, 3));
      const innerMat = new THREE.MeshBasicMaterial({ vertexColors: true });
      const innerMesh = new THREE.Mesh(innerGeo, innerMat);
      brainGroup.add(innerMesh);

      const outerMat = new THREE.MeshStandardMaterial({
        color: 0xe6d8c6, transparent: true, opacity: 0.35,
        roughness: 0.5, metalness: 0.04, depthWrite: false, side: THREE.FrontSide,
      });
      const outerMesh = new THREE.Mesh(geometry, outerMat);
      brainGroup.add(outerMesh);
      brainGroup.rotation.set(-0.06, 1.62, 0);

      let isDragging = false; let lastX = 0, lastY = 0;
      const yAx = new THREE.Vector3(0, 1, 0);
      const xAx = new THREE.Vector3(1, 0, 0);
      const dq = new THREE.Quaternion();
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();

      const onDown = (e: PointerEvent) => { isDragging = true; lastX = e.clientX; lastY = e.clientY; setHover(null); cvs.setPointerCapture(e.pointerId); };
      const onMove = (e: PointerEvent) => {
        if (isDragging) {
          dq.setFromAxisAngle(yAx, (e.clientX - lastX) * 0.008); brainGroup.quaternion.premultiply(dq);
          dq.setFromAxisAngle(xAx, (e.clientY - lastY) * 0.008); brainGroup.quaternion.premultiply(dq);
          lastX = e.clientX; lastY = e.clientY; return;
        }
        if (!lobeIds.length) return;
        const rect = cvs.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObject(outerMesh, false);
        const face = hits.length ? hits[0].face : null;
        const lid = face ? lobeIds[face.a] : -1;
        if (lid >= 0 && lid < lobeNames.length) setHover({ name: lobeNames[lid], x: e.clientX - rect.left, y: e.clientY - rect.top });
        else setHover(null);
      };
      const onUp = () => { isDragging = false; };
      const onLeave = () => { isDragging = false; setHover(null); };
      const onWheel = (e: WheelEvent) => { e.preventDefault(); camera.position.z = THREE.MathUtils.clamp(camera.position.z * (1 + e.deltaY * 0.001), 2.5, 7.0); };
      cvs.addEventListener("pointerdown", onDown); cvs.addEventListener("pointermove", onMove);
      cvs.addEventListener("pointerup", onUp); cvs.addEventListener("pointerleave", onLeave);
      cvs.addEventListener("wheel", onWheel, { passive: false });

      const resize = () => { const rect = cvs.getBoundingClientRect(); renderer.setSize(rect.width, rect.height, false); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); };
      const obs = new ResizeObserver(resize); obs.observe(cvs); resize();

      const smoothVerts = new Float32Array(nVerts);
      const targetVerts = new Float32Array(nVerts);
      const color: [number, number, number] = [0, 0, 0];
      const MATTE_ORANGE = [0.42, 0.13, 0.02] as const;
      const HOT_ORANGE = [1.55, 0.62, 0.14] as const;
      const smoothLevels = new Float32Array(6);
      const clock = new THREE.Clock();
      let elapsed = 0;

      const render = () => {
        if (disposed) return;
        const dt = clock.getDelta();
        elapsed += dt;
        const hm = heatmapRef.current;
        const colorAttr = innerMesh.geometry.attributes.color as THREE.BufferAttribute;
        const arr = colorAttr.array as Float32Array;

        if (hm && hm.nVerts === nVerts) {
          const t = timeRef.current;
          let winIdx = 0;
          for (let i = 0; i < hm.nWindows - 1; i++) { if (t >= hm.starts[i + 1]) winIdx = i + 1; }
          const nextIdx = Math.min(winIdx + 1, hm.nWindows - 1);
          const winStart = hm.starts[winIdx];
          const winEnd = nextIdx < hm.nWindows ? hm.starts[nextIdx] : winStart + 1.0;
          const blend = winIdx === nextIdx ? 0 : Math.max(0, Math.min(1, (t - winStart) / (winEnd - winStart)));

          for (let vi = 0; vi < nVerts; vi++) {
            targetVerts[vi] = hm.windows[winIdx][vi] + (hm.windows[nextIdx][vi] - hm.windows[winIdx][vi]) * blend;
          }
          const k = 1 - Math.pow(0.0001, dt);
          for (let vi = 0; vi < nVerts; vi++) {
            smoothVerts[vi] += (targetVerts[vi] - smoothVerts[vi]) * k;
            heatmapColor(smoothVerts[vi], color);
            const glow = smoothVerts[vi] > 0.7 ? 1.0 + (smoothVerts[vi] - 0.7) * 2.0 : 1.0;
            arr[vi * 3]     = DARK[0] + color[0] * glow * 0.9;
            arr[vi * 3 + 1] = DARK[1] + color[1] * glow * 0.9;
            arr[vi * 3 + 2] = DARK[2] + color[2] * glow * 0.9;
          }
        } else {
          const k = 1 - Math.pow(0.002, dt);
          const lv = levelsRef.current;
          for (let i = 0; i < 6; i++) { smoothLevels[i] += ((lv[REGIONS[i].key] ?? 0) - smoothLevels[i]) * k; }
          const strobe = Math.pow(0.5 + 0.5 * Math.sin(elapsed * 5.0), 3.0);
          let maxLevel = 1e-4;
          for (let i = 0; i < 6; i++) if (smoothLevels[i] > maxLevel) maxLevel = smoothLevels[i];
          const GATE = 0.72;
          for (let vi = 0; vi < nVerts; vi++) {
            const reg = regionIds[vi];
            let t = 0;
            if (reg >= 0 && reg < 6 && maxLevel > 0.12) {
              const rel = smoothLevels[reg] / maxLevel;
              if (rel > GATE) { const gate = (rel - GATE) / (1 - GATE); t = Math.pow(gate, 1.1) * Math.pow(smoothLevels[reg], 0.5); }
            }
            const cr = MATTE_ORANGE[0] + (HOT_ORANGE[0] - MATTE_ORANGE[0]) * strobe;
            const cg = MATTE_ORANGE[1] + (HOT_ORANGE[1] - MATTE_ORANGE[1]) * strobe;
            const cb = MATTE_ORANGE[2] + (HOT_ORANGE[2] - MATTE_ORANGE[2]) * strobe;
            arr[vi * 3] = DARK[0] + cr * t; arr[vi * 3 + 1] = DARK[1] + cg * t; arr[vi * 3 + 2] = DARK[2] + cb * t;
          }
        }
        colorAttr.needsUpdate = true;
        outerMat.opacity = 0.30 + intensityRef.current * 0.08;
        outerMat.emissive.setRGB(0, 0, 0);
        renderer.render(scene, camera);
        animId = requestAnimationFrame(render);
      };
      animId = requestAnimationFrame(render);

      return () => {
        cancelAnimationFrame(animId); obs.disconnect();
        cvs.removeEventListener("pointerdown", onDown); cvs.removeEventListener("pointermove", onMove);
        cvs.removeEventListener("pointerup", onUp); cvs.removeEventListener("pointerleave", onLeave);
        cvs.removeEventListener("wheel", onWheel);
        geometry.dispose(); innerGeo.dispose(); innerMat.dispose(); outerMat.dispose(); renderer.dispose();
      };
    }
    return () => { disposed = true; if (cleanupFn) cleanupFn(); };
  }, []);

  return (
    <div className="brain-container">
      {loading && <div className="brain-loading">Loading cortical mesh…</div>}
      <canvas ref={canvasRef} className="brain-canvas" tabIndex={0} />
      {hover && <div className="brain-tooltip" style={{ left: hover.x + 14, top: hover.y + 12 }}>{hover.name}</div>}
      <div className="brain-labels">
        <span className="brain-mesh-label">
          {hasHeatmap ? "FSAVERAGE5 · 20,484 VERTICES · PER-VERTEX TRIBE V2 HEATMAP" : "FSAVERAGE5 · 20,484 VERTICES · DESTRIEUX PARCELLATION"}
        </span>
        <span className="brain-hint">DRAG TO ROTATE · SCROLL TO ZOOM · HOVER FOR LOBE</span>
      </div>
      <div className="brain-legend"><span>Low</span><div className="brain-legend-bar" /><span>High</span></div>
    </div>
  );
}
