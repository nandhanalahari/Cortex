export interface GraphLine {
  label: string;
  color: string;
  values: number[];
}

interface Props {
  times: number[];
  line: GraphLine;
  /** Faint dashed comparison, e.g. the original ad under a spliced version. */
  overlay?: GraphLine | null;
  /** Shaded span, e.g. the 5 seconds a take replaced. */
  highlight?: { t_start: number; t_end: number } | null;
  duration: number;
  currentTime: number;
  onSeek: (t: number) => void;
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function SpikeGraph({ times, line, overlay, highlight, duration, currentTime, onSeek }: Props) {
  const W = 1000;
  const H = 132;
  const dur = duration || 1;
  const reveal = Math.max(0, Math.min(1, currentTime / dur));

  // Engagement sits in a narrow band; fit the y-axis to both lines so changes are visible.
  const all = [...line.values, ...(overlay?.values ?? [])];
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const pad = Math.max((hi - lo) * 0.15, 0.02);
  const yMin = Math.max(0, lo - pad);
  const yMax = Math.min(1, hi + pad);
  const yScale = (v: number) => H - 10 - ((v - yMin) / (yMax - yMin || 1)) * (H - 20);

  const toPath = (vals: number[]) => {
    if (!times.length || times.length !== vals.length) return "";
    return vals
      .map((v, i) => `${i === 0 ? "M" : "L"}${(((times[i] ?? 0) / dur) * W).toFixed(1)},${yScale(v).toFixed(1)}`)
      .join(" ");
  };

  const playX = reveal * W;
  const at = times.length ? Math.min(times.length - 1, Math.round(reveal * (times.length - 1))) : 0;
  const now = line.values[at];
  const before = overlay?.values[at];

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * dur);
  };

  const mainPath = toPath(line.values);
  const overlayPath = overlay ? toPath(overlay.values) : "";

  return (
    <div className="spike-graph">
      <div className="spike-graph-head">
        <span className="spike-title">Engagement</span>
        <span className="spike-legend region-legend">
          <span className="legend-item">
            <i className="lg" style={{ background: line.color }} />
            {line.label}
            {now != null && <b className="spike-now">{Math.round(now * 100)}</b>}
          </span>
          {overlay && (
            <span className="legend-item">
              <i className="lg lg-dashed" style={{ borderColor: overlay.color }} />
              {overlay.label}
              {before != null && <b className="spike-now muted">{Math.round(before * 100)}</b>}
            </span>
          )}
          {highlight && (
            <span className="legend-item">
              <i className="lg lg-shade" />
              replaced {fmt(highlight.t_start)}–{fmt(highlight.t_end)}
            </span>
          )}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="spike-svg" onClick={click}>
        <defs>
          <clipPath id="revealClip">
            <rect x="0" y="0" width={Math.max(playX, 1)} height={H} />
          </clipPath>
        </defs>
        {highlight && (
          <rect
            x={(highlight.t_start / dur) * W}
            y="0"
            width={((highlight.t_end - highlight.t_start) / dur) * W}
            height={H}
            className="spike-shade"
          />
        )}
        {overlayPath && (
          <path
            d={overlayPath}
            fill="none"
            stroke={overlay!.color}
            strokeWidth={1.6}
            strokeDasharray="6 5"
            opacity={0.55}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {mainPath && (
          <g clipPath="url(#revealClip)">
            <path
              d={mainPath}
              fill="none"
              stroke={line.color}
              strokeWidth={2.6}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
        <line x1={playX} y1="0" x2={playX} y2={H} stroke="#fff" strokeWidth="1.4" opacity="0.85" />
      </svg>
      <div className="spike-labels">
        <span>0:00</span>
        <span>{fmt(dur)}</span>
      </div>
    </div>
  );
}
