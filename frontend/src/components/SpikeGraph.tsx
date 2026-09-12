import { REGIONS } from "../regions";

export interface GraphSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

interface Props {
  times: number[];
  series: GraphSeries[];
  duration: number;
  currentTime: number;
  onSeek: (t: number) => void;
}

export default function SpikeGraph({ times, series, duration, currentTime, onSeek }: Props) {
  const W = 1000;
  const H = 132;
  const dur = duration || 1;
  const reveal = Math.max(0, Math.min(1, currentTime / dur));
  const yScale = (v: number) => H - 10 - Math.max(0, Math.min(1, v)) * (H - 20);

  const toPts = (vals: number[]) => {
    if (!times.length || times.length !== vals.length) return "";
    return vals
      .map((v, i) => {
        const x = ((times[i] ?? 0) / dur) * W;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yScale(v).toFixed(1)}`;
      })
      .join(" ");
  };

  const playX = reveal * W;

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * dur);
  };

  return (
    <div className="spike-graph">
      <div className="spike-graph-head">
        <span className="spike-title">Region signals</span>
        <span className="spike-legend region-legend">
          {REGIONS.map((r) => (
            <span key={r.key} className="legend-item">
              <i className="lg" style={{ background: r.color }} />
              {r.short}
            </span>
          ))}
          <span className="legend-item">
            <i className="lg" style={{ background: "#f5d07a" }} />
            ENG
          </span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="spike-svg" onClick={click}>
        <defs>
          <clipPath id="revealClip">
            <rect x="0" y="0" width={Math.max(playX, 1)} height={H} />
          </clipPath>
        </defs>
        <g clipPath="url(#revealClip)">
          {series.map((s) => {
            const d = toPts(s.values);
            if (!d) return null;
            const thick = s.key === "engagement";
            return (
              <path
                key={s.key}
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={thick ? 2.6 : 1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={thick ? 0.95 : 0.88}
              />
            );
          })}
        </g>
        <line x1={playX} y1="0" x2={playX} y2={H} stroke="#fff" strokeWidth="1.4" opacity="0.85" />
      </svg>
      <div className="spike-labels">
        <span>0:00</span>
        <span>{Math.floor(dur / 60)}:{String(Math.floor(dur % 60)).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
