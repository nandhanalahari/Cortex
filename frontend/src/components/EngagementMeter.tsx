import { REGIONS, engagementFrom } from "../regions";

interface Props {
  levels: Record<string, number>;
}

export default function EngagementMeter({ levels }: Props) {
  const score = engagementFrom(levels);
  const pct = Math.round(score * 100);

  return (
    <div className="engagement-meter">
      <div className="engagement-hero">
        <div className="hero-score">{pct}</div>
        <div className="hero-label">
          ENGAGEMENT
          <span className="hero-sub">weighted from the six TRIBE regions</span>
        </div>
      </div>
      <div className="region-bars">
        {REGIONS.map((r) => {
          const v = levels[r.key] ?? 0;
          return (
            <div key={r.key} className="region-bar-row">
              <span className="region-bar-name">
                <i className="region-dot" style={{ background: r.color }} />
                {r.short}
              </span>
              <div className="region-bar-track">
                <div className="region-bar-fill" style={{ width: `${Math.round(v * 100)}%`, background: r.color }} />
              </div>
              <span className="region-bar-val">{v.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
