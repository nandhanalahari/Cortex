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
  lobe_ids?: number[];
  lobes?: string[];
  n_vertices: number;
  n_left: number;
}

/* ── Component props ───────────────────────────────────────────────── */
interface Props {
  levels: Record<string, number>;
  intensity: number;
}

interface HoverInfo { name: string; x: number; y: number; }

export default function CorticalBrain({ levels, intensity }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef(levels);
  const intensityRef = useRef(intensity);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<HoverInfo | null>(null);

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
      const lobeIds = new Int8Array(data.lobe_ids ?? []);
      const lobeNames = data.lobes ?? [];

      /* ── Renderer ────────────────────────────────────────────────── */
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

      /* ── Lighting (soft, neutral-warm like a studio brain model) ─── */
      scene.add(new THREE.AmbientLight(0x2a2620, 0.7));
      const keyLight = new THREE.DirectionalLight(0xfff2e0, 1.0);
      keyLight.position.set(-3, 4, 5);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0x9098b0, 0.35);
      rimLight.position.set(3, -2, -4);
      scene.add(rimLight);
      const topLight = new THREE.DirectionalLight(0xd8d0c0, 0.35);
      topLight.position.set(0, 5, 0);
      scene.add(topLight);

      const brainGroup = new THREE.Group();
      scene.add(brainGroup);

      /* ── Layer 1: Inner glow mesh (MeshBasicMaterial = self-luminous) */
      const innerGeo = geometry.clone();
      innerGeo.scale(0.97, 0.97, 0.97);

      const innerColors = new Float32Array(nVerts * 3);
      const DARK = [0.015, 0.015, 0.03];
      // Firing regions strobe from a matte (non-glowing) orange up to a
      // glowing hot orange. HOT values exceed 1.0 so ACES tone-mapping pushes
      // the peak toward a white-hot highlight.
      const MATTE_ORANGE = [0.42, 0.13, 0.02];
      const HOT_ORANGE = [1.55, 0.62, 0.14];
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
      // Warm ivory/beige tint so the translucent brain reads like a real
      // anatomical specimen (à la BrainFacts.org), not cold glass.
      const outerMat = new THREE.MeshStandardMaterial({
        color: 0xe6d8c6,
        transparent: true,
        opacity: 0.4,
        roughness: 0.5,
        metalness: 0.04,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      const outerMesh = new THREE.Mesh(geometry, outerMat);
      brainGroup.add(outerMesh);

      // Clean left-lateral framing like the BrainFacts.org 3D brain: left
      // hemisphere facing the camera, frontal pole to the left, occipital to
      // the right, superior up. (Lobe boundaries are kept for hover but not
      // drawn — no seam lines.)
      brainGroup.rotation.set(-0.06, 1.62, 0);

      /* ── Interaction: drag to rotate, scroll to zoom, hover for lobe ── */
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
        // Hover: raycast to find which lobe is under the cursor.
        if (!lobeIds.length) return;
        const rect = cvs.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObject(outerMesh, false);
        const face = hits.length ? hits[0].face : null;
        const lid = face ? lobeIds[face.a] : -1;
        if (lid >= 0 && lid < lobeNames.length) {
          setHover({ name: lobeNames[lid], x: e.clientX - rect.left, y: e.clientY - rect.top });
        } else {
          setHover(null);
        }
      };
      const onUp = () => { isDragging = false; };
      const onLeave = () => { isDragging = false; setHover(null); };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        camera.position.z = THREE.MathUtils.clamp(
          camera.position.z * (1 + e.deltaY * 0.001), 2.5, 7.0,
        );
      };
      cvs.addEventListener("pointerdown", onDown);
      cvs.addEventListener("pointermove", onMove);
      cvs.addEventListener("pointerup", onUp);
      cvs.addEventListener("pointerleave", onLeave);
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
      let elapsed = 0;

      const render = () => {
        if (disposed) return;
        const dt = clock.getDelta();
        elapsed += dt;

        // Smooth-ease activation levels toward targets
        const k = 1 - Math.pow(0.002, dt);
        const lv = levelsRef.current;
        for (let i = 0; i < 6; i++) {
          const target = lv[REGIONS[i].key] ?? 0;
          smoothLevels[i] += (target - smoothLevels[i]) * k;
        }

        // Firing regions strobe matte orange -> glowing hot orange. No
        // parcellation colors: just a dark base with a strobing orange section.
        const colorAttr = innerMesh.geometry.attributes.color as THREE.BufferAttribute;
        const arr = colorAttr.array as Float32Array;
        // Sharp strobe in [0,1]: cubic curve dwells on the matte side, then
        // snaps up to hot — a strobe rather than a soft pulse.
        const strobe = Math.pow(0.5 + 0.5 * Math.sin(elapsed * 5.0), 3.0);

        // Relative gate: only regions NEAR the current peak fire, so distinct
        // sections flash and change over time instead of the whole cortex.
        let maxLevel = 1e-4;
        for (let i = 0; i < 6; i++) if (smoothLevels[i] > maxLevel) maxLevel = smoothLevels[i];
        const GATE = 0.72; // fraction of the peak a region must reach to fire

        for (let vi = 0; vi < nVerts; vi++) {
          const reg = regionIds[vi];
          let t = 0; // firing strength for this vertex's region
          if (reg >= 0 && reg < 6 && maxLevel > 0.12) {
            const level = smoothLevels[reg];
            const rel = level / maxLevel;            // 0..1 closeness to peak region
            if (rel > GATE) {
              const gate = (rel - GATE) / (1 - GATE); // 0 at cutoff -> 1 at peak
              t = Math.pow(gate, 1.1) * Math.pow(level, 0.5);
            }
          }
          // Blend matte -> hot orange by the strobe; scale by firing strength.
          const cr = MATTE_ORANGE[0] + (HOT_ORANGE[0] - MATTE_ORANGE[0]) * strobe;
          const cg = MATTE_ORANGE[1] + (HOT_ORANGE[1] - MATTE_ORANGE[1]) * strobe;
          const cb = MATTE_ORANGE[2] + (HOT_ORANGE[2] - MATTE_ORANGE[2]) * strobe;
          arr[vi * 3]     = DARK[0] + cr * t;
          arr[vi * 3 + 1] = DARK[1] + cg * t;
          arr[vi * 3 + 2] = DARK[2] + cb * t;
        }
        colorAttr.needsUpdate = true;

        // The translucent shell must NEVER glow — only the firing inner-mesh
        // vertices glow, showing through the glass locally. So the shell keeps
        // a constant tint with zero emissive; opacity eases only slightly with
        // overall intensity (that's transparency, not light emission).
        const act = intensityRef.current;
        outerMat.opacity = 0.34 + act * 0.08;
        outerMat.emissive.setRGB(0, 0, 0);

        // Static frame like the website — no idle auto-rotation (drag to rotate).

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
        cvs.removeEventListener("pointerleave", onLeave);
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
      {hover && (
        <div className="brain-tooltip" style={{ left: hover.x + 14, top: hover.y + 12 }}>
          {hover.name}
        </div>
      )}
      <div className="brain-labels">
        <span className="brain-mesh-label">FSAVERAGE5 · 20,484 VERTICES · DESTRIEUX PARCELLATION</span>
        <span className="brain-hint">DRAG TO ROTATE · SCROLL TO ZOOM · HOVER FOR LOBE</span>
      </div>
      <div className="brain-legend">
        <span>Low</span>
        <div className="brain-legend-bar" />
        <span>High</span>
      </div>
    </div>
  );
}
