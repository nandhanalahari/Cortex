export const REGIONS = [
  { key: "visual",             label: "Visual",               short: "VIS",  color: "#4fc3f7", rgb: [0.31, 0.76, 0.97] },
  { key: "language",           label: "Language",              short: "LANG", color: "#81c784", rgb: [0.51, 0.78, 0.52] },
  { key: "reward_novelty",     label: "Reward / Novelty",     short: "RWD",  color: "#ffb74d", rgb: [1.00, 0.72, 0.30] },
  { key: "memory_familiarity", label: "Memory",               short: "MEM",  color: "#ba68c8", rgb: [0.73, 0.41, 0.78] },
  { key: "emotional_arousal",  label: "Emotional Arousal",    short: "EMO",  color: "#e57373", rgb: [0.90, 0.45, 0.45] },
  { key: "attention_salience", label: "Attention / Salience",  short: "ATTN", color: "#9fa8da", rgb: [0.62, 0.66, 0.85] },
] as const;

export type RegionKey = (typeof REGIONS)[number]["key"];

export const REGION_WEIGHTS: Record<RegionKey, number> = {
  visual: 0.12,
  language: 0.12,
  reward_novelty: 0.22,
  memory_familiarity: 0.10,
  emotional_arousal: 0.22,
  attention_salience: 0.22,
};

export const EMPTY_LEVELS: Record<RegionKey, number> = {
  visual: 0,
  language: 0,
  reward_novelty: 0,
  memory_familiarity: 0,
  emotional_arousal: 0,
  attention_salience: 0,
};

export function engagementFrom(levels: Record<string, number>): number {
  let s = 0;
  for (const r of REGIONS) s += REGION_WEIGHTS[r.key] * (levels[r.key] ?? 0);
  return Math.max(0, Math.min(1, s));
}

export function lerpLevels(
  windows: { t_start: number; t_end: number; regions: Record<string, number> }[],
  t: number,
): Record<RegionKey, number> {
  if (!windows.length) return { ...EMPTY_LEVELS };
  if (t <= windows[0].t_start) return { ...EMPTY_LEVELS, ...windows[0].regions };
  const last = windows[windows.length - 1];
  if (t >= last.t_end) return { ...EMPTY_LEVELS, ...last.regions };

  let i = 0;
  while (i + 1 < windows.length && windows[i + 1].t_start <= t) i++;
  const a = windows[i];
  const b = windows[i + 1] ?? a;
  const midA = (a.t_start + a.t_end) / 2;
  const midB = (b.t_start + b.t_end) / 2;
  const u = midB === midA ? 0 : Math.max(0, Math.min(1, (t - midA) / (midB - midA)));
  const out = { ...EMPTY_LEVELS };
  for (const r of REGIONS) {
    const va = a.regions[r.key] ?? 0;
    const vb = b.regions[r.key] ?? 0;
    out[r.key] = va + (vb - va) * u;
  }
  return out;
}
