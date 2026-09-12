import { useMemo, useRef } from "react";
import type { Selection, WindowScore } from "../types";
import SegmentSelector from "./SegmentSelector";

interface Props {
  scores: WindowScore[];
  duration: number;
  currentTime: number;
  selection: Selection | null;
  onSeek: (t: number) => void;
  onSelect: (sel: Selection | null) => void;
}

const VB_W = 1000;
const VB_H = 60;

/**
 * F3: the engagement timeline ribbon. This is a REPLAY of precomputed data,
 * not live inference (PRD Section 10 honesty contract). The glow tracks
 * the composite engagement score across time.
 */
export default function EngagementTimeline({
  scores,
  duration,
  currentTime,
  selection,
  onSeek,
  onSelect,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  const { linePath, areaPath, gradientStops, peaks } = useMemo(() => {
    if (!scores.length || !duration) {
      return { linePath: "", areaPath: "", gradientStops: [] as JSX.Element[], peaks: [] as WindowScore[] };
    }
    const pts = scores.map((s) => {
      const mid = (s.t_start + s.t_end) / 2;
      const x = (mid / duration) * VB_W;
      const y = VB_H - s.engagement_score * (VB_H - 6) - 3;
      return { x, y, s };
    });

    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const area = `M0,${VB_H} ` + pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + ` L${VB_W},${VB_H} Z`;

    // Inferno-ish gradient: dark purple → magenta → orange → amber
    const stops = scores.map((s, i) => {
      const mid = (s.t_start + s.t_end) / 2;
      const offset = (mid / duration) * 100;
      const t = s.engagement_score;
      // Interpolate through inferno stops
      const r = Math.round(66 + t * 189);
      const g = Math.round(10 + t * 155);
      const b = Math.round(104 - t * 60);
      return (
        <stop key={i} offset={`${offset}%`} stopColor={`rgb(${r},${g},${b})`} />
      );
    });

    return { linePath: line, areaPath: area, gradientStops: stops, peaks: scores.filter((s) => s.is_peak) };
  }, [scores, duration]);

  const playheadX = duration ? (currentTime / duration) * VB_W : 0;

  const handleClick = (e: React.MouseEvent) => {
    if (!wrapRef.current || !duration) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(duration, frac * duration)));
  };

  return (
    <div className="timeline">
      <div className="timeline-track" ref={wrapRef} onClick={handleClick}>
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="timeline-svg">
          <defs>
            <linearGradient id="glowGrad" x1="0" y1="0" x2="1" y2="0">
              {gradientStops}
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <path d={areaPath} fill="url(#glowGrad)" opacity="0.22" />
          <path d={linePath} fill="none" stroke="url(#glowGrad)" strokeWidth="2.5" filter="url(#glow)" />

          {peaks.map((p, i) => {
            const mid = (p.t_start + p.t_end) / 2;
            const x = (mid / duration) * VB_W;
            const y = VB_H - p.engagement_score * (VB_H - 6) - 3;
            return <circle key={i} cx={x} cy={y} r="3" fill="#fff" stroke="#FCA50A" strokeWidth="1.5" />;
          })}

          {/* Selection band */}
          {selection && (
            <rect
              x={(selection.t_start / duration) * VB_W}
              y={0}
              width={((selection.t_end - selection.t_start) / duration) * VB_W}
              height={VB_H}
              fill="#ff4fd8"
              opacity="0.15"
              rx="2"
            />
          )}

          {/* Playhead */}
          <line x1={playheadX} y1={0} x2={playheadX} y2={VB_H} stroke="#fff" strokeWidth="1.5" opacity="0.8" />
        </svg>

        <SegmentSelector
          duration={duration}
          selection={selection}
          onSelect={onSelect}
          containerRef={wrapRef}
        />
      </div>

      <div className="timeline-labels">
        <span>0:00</span>
        <span className="peak-label">
          peak {scores.length
            ? (() => {
                const p = scores.reduce((a, b) => (b.engagement_score > a.engagement_score ? b : a));
                const m = Math.floor(p.t_start / 60);
                return `${m}:${String(Math.floor(p.t_start % 60)).padStart(2, "0")}`;
              })()
            : "—"}
        </span>
        <span>{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
