import { useMemo } from "react";
import type { WindowScore } from "../types";
import { REGION_COLORS } from "./CorticalBrain";

const REGIONS = [
  { key: "visual", label: "Visual", short: "VIS" },
  { key: "language", label: "Language", short: "LANG" },
  { key: "reward_novelty", label: "Reward / Novelty", short: "RWD" },
  { key: "memory_familiarity", label: "Memory", short: "MEM" },
  { key: "emotional_arousal", label: "Emotional Arousal", short: "EMO" },
  { key: "attention_salience", label: "Attention / Salience", short: "ATTN" },
];

interface Props {
  scores: WindowScore[];
  /** Raw per-window region data (regions dict per window) */
  regionData: { regions: Record<string, number> }[];
  duration: number;
  currentTime: number;
  engagementScore: number;
}

const W = 300;
const H = 36;

function sparklinePath(values: number[], width: number, height: number) {
  if (!values.length) return "";
  const max = Math.max(...values, 0.01);
  return values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * width;
      const y = height - (v / max) * height * 0.85 - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Per-region signal charts mimicking Percept's "Response systems" panel.
 * Each region gets a colored sparkline showing its activation over time,
 * with the current playhead position and a score readout.
 */
export default function RegionCharts({
  regionData,
  duration,
  currentTime,
  engagementScore,
}: Props) {
  const regionSeries = useMemo(() => {
    return REGIONS.map((reg) => ({
      ...reg,
      color: REGION_COLORS[reg.key] || "#888",
      values: regionData.map((w) => w.regions[reg.key] ?? 0),
      avg: regionData.length
        ? regionData.reduce((s, w) => s + (w.regions[reg.key] ?? 0), 0) / regionData.length
        : 0,
    }));
  }, [regionData]);

  const playheadFrac = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="region-panel">
      <div className="region-header">
        <span className="region-title">RESPONSE SYSTEMS</span>
        <span className="region-subtitle">Surface proxy · precomputed data</span>
      </div>

      <div className="engagement-hero">
        <div className="hero-score">{Math.round(engagementScore * 100)}</div>
        <div className="hero-label">
          ENGAGEMENT
          <span className="hero-sub">composite score</span>
        </div>
      </div>

      <div className="region-charts">
        {regionSeries.map((reg) => (
          <div key={reg.key} className="region-row">
            <div className="region-info">
              <span className="region-dot" style={{ background: reg.color }} />
              <span className="region-name">{reg.short}</span>
              <span className="region-score">{Math.round(reg.avg * 100)}</span>
            </div>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="region-spark"
              preserveAspectRatio="none"
            >
              <path
                d={sparklinePath(reg.values, W, H)}
                fill="none"
                stroke={reg.color}
                strokeWidth="2"
                opacity="0.85"
              />
              {/* Playhead */}
              <line
                x1={playheadFrac * W}
                y1={0}
                x2={playheadFrac * W}
                y2={H}
                stroke="#fff"
                strokeWidth="1"
                opacity="0.5"
              />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
