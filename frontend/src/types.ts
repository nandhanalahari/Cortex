export interface RegionValues {
  visual: number;
  language: number;
  reward_novelty: number;
  memory_familiarity: number;
  emotional_arousal: number;
  attention_salience: number;
}

export interface WindowScore {
  t_start: number;
  t_end: number;
  response_strength: number;
  engagement_score: number;
  is_peak: boolean;
  drop_off: number;
}

export interface Curve {
  video_id: string;
  duration_sec: number;
  peak_time: number;
  peak_score: number;
  scores: WindowScore[];
}

export interface Candidate {
  candidate_id: string;
  preview_url: string;
  label?: string | null;
  /** 0–1, same scale as RedoResponse.baseline_engagement; null when TRIBE hasn't scored it. */
  engagement_score?: number | null;
  /** Where the score came from, or why it's missing (backend candidate_library.take_score). */
  score_status?: string | null;
  duration_sec?: number | null;
}

export interface SimilarSegment {
  segment_id: string;
  similarity: number;
  positive_prompt: string;
  selected_candidate_id?: string | null;
  engagement_score?: number | null;
}

export interface RedoResponse {
  segment_id: string;
  positive_prompt: string;
  negative_prompt: string;
  candidates: Candidate[];
  t_start?: number | null;
  t_end?: number | null;
  baseline_engagement?: number | null;
  candidate_source?: string | null;
  similar_segments?: SimilarSegment[];
}

export interface RegenOptions {
  video_id: string;
  segment_len_sec: number;
  suggested: { t_start: number; t_end: number; reason: string };
  baseline_engagement: number | null;
  has_library: boolean;
  n_takes: number;
}

export interface RegionWindow {
  t_start: number;
  t_end: number;
  regions: Record<string, number>;
}

export interface SelectResponse {
  video_id: string;
  status: string;
  preview_url: string;
  candidate_id?: string | null;
  t_start?: number | null;
  t_end?: number | null;
  /** The spliced ad's windows; null when the take has no TRIBE export. */
  windows?: RegionWindow[] | null;
}

export interface AuthUser {
  id: number;
  email: string;
  created_at: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

/** A spliced take the user sent to the main dashboard. */
export interface DashboardTake {
  videoUrl: string;
  label: string;
  t_start: number;
  t_end: number;
  windows: RegionWindow[] | null;
}

export interface Selection {
  t_start: number;
  t_end: number;
}

export interface VertexField {
  video_id: string;
  n_vertices: number;
  n_frames: number;
  times: number[];
  mean: number[];
  peak: number[];
  frames: number[][];
  source?: string;
}
