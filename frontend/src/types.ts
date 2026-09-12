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
}

export interface RedoResponse {
  segment_id: string;
  positive_prompt: string;
  negative_prompt: string;
  candidates: Candidate[];
}

export interface SelectResponse {
  video_id: string;
  status: string;
  preview_url: string;
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
