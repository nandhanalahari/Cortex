import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/* ── Region metadata (shared with RegionCharts via REGION_COLORS) ──── */
const REGIONS = [
  { key: "visual",             label: "Visual",               short: "VIS",  color: "#4fc3f7", rgb: [0.31, 0.76, 0.97] },
  { key: "language",           label: "Language",              short: "LANG", color: "#81c784", rgb: [0.51, 0.78, 0.52] },
  { key: "reward_novelty",     label: "Reward / Novelty",     short: "RWD",  color: "#ffb74d", rgb: [1.00, 0.72, 0.30] },
  { key: "memory_familiarity", label: "Memory",               short: "MEM",  color: "#ba68c8", rgb: [0.73, 0.41, 0.78] },
  { key: "emotional_arousal",  label: "Emotional Arousal",    short: "EMO",  color: "#e57373", rgb: [0.90, 0.45, 0.45] },
  { key: "attention_salience", label: "Attention / Salience",  short: "ATTN", color: "#9fa8da", rgb: [0.62, 0.66, 0.85] },
] as const;

export const REGION_COLORS = Object.fromEntries(REGIONS.map((r) => [r.key, r.color]));

/* ── Brain mesh JSON contract ──────────────────────────────────────── */
interface BrainMeshData {
  vertices: number[];
  faces: number[];
  region_ids: number[];
  n_vertices: number;
  n_left: number;
}

/* ── Component props ───────────────────────────────────────────────── */
interface Props {
  levels: Record<string, number>;
  intensity: number;
}

export default function CorticalBrain({ levels, intensity }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef(levels);
  const intensityRef = useRef(intensity);
  const [loading, setLoading] = useState(true);

  useEffect(() => { levelsRef.current = levels; }, [levels]);
  useEffect(() => { intensityRef.current = intensity; }, [intensity]);

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

      /* ── Build geometry ──────────────────────────────────────────── */
      const rawVerts = new Float32Array(data.vertices);
      const indices = new Uint32Array(data.faces);

      // FreeSurfer RAS → Three.js Y-up: (x,y,z) → (x, z, -y)
      const verts = new Float32Array(nVerts * 3);
      for (let i = 0; i < nVerts; i++) {
        verts[i * 3]     =  rawVerts[i * 3];       // X stays
        verts[i * 3 + 1] =  rawVerts[i * 3 + 2];   // Y ← Z (up)
        verts[i * 3 + 2] = -rawVerts[i * 3 + 1];   // Z ← -Y (forward)
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();

      // Center and normalize
      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox!.getCenter(center);
      geometry.translate(-center.x, -center.y, -center.z);
      geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      geometry.boundingBox!.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2.2 / maxDim;
      geometry.scale(scale, scale, scale);

      const regionIds = new Int8Array(data.region_ids);

      /* ── Renderer ────────────────────────────────────────────────── */
      const renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x050508, 1);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x050508);

      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.set(0, 0.15, 4.5);
      camera.lookAt(0, 0, 0);

      /* ── Lighting ────────────────────────────────────────────────── */
      scene.add(new THREE.AmbientLight(0x1a1a2e, 0.6));
      const keyLight = new THREE.DirectionalLight(0xd0c8e0, 0.9);
      keyLight.position.set(-3, 4, 5);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x5060a0, 0.4);
      rimLight.position.set(3, -2, -4);
      scene.add(rimLight);
      const topLight = new THREE.DirectionalLight(0x8080b0, 0.3);
      topLight.position.set(0, 5, 0);
      scene.add(topLight);

      const brainGroup = new THREE.Group();
      scene.add(brainGroup);

      /* ── Layer 1: Inner glow mesh (MeshBasicMaterial = self-luminous) */
      const innerGeo = geometry.clone();
      innerGeo.scale(0.97, 0.97, 0.97);

      const innerColors = new Float32Array(nVerts * 3);
      const DARK = [0.015, 0.015, 0.03];
      for (let i = 0; i < nVerts; i++) {
        innerColors[i * 3]     = DARK[0];
        innerColors[i * 3 + 1] = DARK[1];
        innerColors[i * 3 + 2] = DARK[2];
      }
      innerGeo.setAttribute("color", new THREE.BufferAttribute(innerColors, 3));

      const innerMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
      });
      const innerMesh = new THREE.Mesh(innerGeo, innerMat);
      brainGroup.add(innerMesh);

      /* ── Layer 2: Outer glass shell (translucent, catches light) ── */
      const outerMat = new THREE.MeshStandardMaterial({
        color: 0xd8d8e8,
        transparent: true,
        opacity: 0.38,
        roughness: 0.28,
        metalness: 0.08,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      const outerMesh = new THREE.Mesh(geometry, outerMat);
      brainGroup.add(outerMesh);

      // Start at a 3/4 lateral view (like Percept's default)
      brainGroup.rotation.set(-0.2, -2.3, 0.1);

      /* ── Interaction: drag to rotate, scroll to zoom ─────────────── */
      let isDragging = false;
      let lastX = 0, lastY = 0;
      const yAx = new THREE.Vector3(0, 1, 0);
      const xAx = new THREE.Vector3(1, 0, 0);
      const dq = new THREE.Quaternion();

      const onDown = (e: PointerEvent) => {
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        cvs.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!isDragging) return;
        dq.setFromAxisAngle(yAx, (e.clientX - lastX) * 0.008);
        brainGroup.quaternion.premultiply(dq);
        dq.setFromAxisAngle(xAx, (e.clientY - lastY) * 0.008);
        brainGroup.quaternion.premultiply(dq);
        lastX = e.clientX;
        lastY = e.clientY;
      };
      const onUp = () => { isDragging = false; };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        camera.position.z = THREE.MathUtils.clamp(
          camera.position.z * (1 + e.deltaY * 0.001), 2.5, 7.0,
        );
      };
      cvs.addEventListener("pointerdown", onDown);
      cvs.addEventListener("pointermove", onMove);
      cvs.addEventListener("pointerup", onUp);
      cvs.addEventListener("pointerleave", onUp);
      cvs.addEventListener("wheel", onWheel, { passive: false });

      /* ── Resize observer ─────────────────────────────────────────── */
      const resize = () => {
        const rect = cvs.getBoundingClientRect();
        renderer.setSize(rect.width, rect.height, false);
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
      };
      const obs = new ResizeObserver(resize);
      obs.observe(cvs);
      resize();

      /* ── Animation loop ──────────────────────────────────────────── */
      const smoothLevels = new Float32Array(6);
      const clock = new THREE.Clock();
      const idleQ = new THREE.Quaternion();

      const render = () => {
        if (disposed) return;
        const dt = clock.getDelta();

        // Smooth-ease activation levels toward targets
        const k = 1 - Math.pow(0.002, dt);
        const lv = levelsRef.current;
        for (let i = 0; i < 6; i++) {
          const target = lv[REGIONS[i].key] ?? 0;
          smoothLevels[i] += (target - smoothLevels[i]) * k;
        }

        // Update inner mesh vertex colors — only bright for high activations
        const colorAttr = innerMesh.geometry.attributes.color as THREE.BufferAttribute;
        const arr = colorAttr.array as Float32Array;
        for (let vi = 0; vi < nVerts; vi++) {
          const reg = regionIds[vi];
          if (reg >= 0 && reg < 6) {
            const level = smoothLevels[reg];
            if (level > 0.08) {
              const [cr, cg, cb] = REGIONS[reg].rgb;
              // Ramp: fades in gently, peaks brightly
              const t = Math.pow((level - 0.08) / 0.92, 0.7);
              const glow = t * 0.85;
              arr[vi * 3]     = DARK[0] + cr * glow;
              arr[vi * 3 + 1] = DARK[1] + cg * glow;
              arr[vi * 3 + 2] = DARK[2] + cb * glow;
            } else {
              arr[vi * 3]     = DARK[0];
              arr[vi * 3 + 1] = DARK[1];
              arr[vi * 3 + 2] = DARK[2];
            }
          } else {
            arr[vi * 3]     = DARK[0];
            arr[vi * 3 + 1] = DARK[1];
            arr[vi * 3 + 2] = DARK[2];
          }
        }
        colorAttr.needsUpdate = true;

        // Outer shell opacity gently reacts to overall intensity
        const act = intensityRef.current;
        outerMat.opacity = 0.32 + act * 0.1;

        // Idle auto-rotation
        if (!isDragging) {
          idleQ.setFromAxisAngle(yAx, dt * 0.06);
          brainGroup.quaternion.premultiply(idleQ);
        }

        renderer.render(scene, camera);
        animId = requestAnimationFrame(render);
      };
      animId = requestAnimationFrame(render);

      /* ── Cleanup ─────────────────────────────────────────────────── */
      return () => {
        cancelAnimationFrame(animId);
        obs.disconnect();
        cvs.removeEventListener("pointerdown", onDown);
        cvs.removeEventListener("pointermove", onMove);
        cvs.removeEventListener("pointerup", onUp);
        cvs.removeEventListener("pointerleave", onUp);
        cvs.removeEventListener("wheel", onWheel);
        geometry.dispose();
        innerGeo.dispose();
        innerMat.dispose();
        outerMat.dispose();
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
      <div className="brain-labels">
        <span className="brain-mesh-label">FSAVERAGE5 · 20,484 VERTICES · DESTRIEUX PARCELLATION</span>
        <span className="brain-hint">DRAG TO ROTATE · SCROLL TO ZOOM</span>
      </div>
      <div className="brain-legend">
        <span>Low</span>
        <div className="brain-legend-bar" />
        <span>High</span>
      </div>
    </div>
  );
}
