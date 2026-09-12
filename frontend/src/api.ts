import type { Curve, RedoResponse, SelectResponse, VertexField } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listVideos: () =>
    fetch("/api/videos").then((r) =>
      json<{
        videos: string[];
        items?: { id: string; has_activation: boolean; has_verts: boolean; has_video: boolean }[];
      }>(r),
    ),

  loadActivation: (videoId: string) =>
    fetch(`/api/videos/${videoId}/load-activation`, { method: "POST" }).then((r) =>
      json<unknown>(r),
    ),

  getCurve: (videoId: string) =>
    fetch(`/api/videos/${videoId}/curve`).then((r) => json<Curve>(r)),

  sourceUrl: (videoId: string) => `/api/videos/${videoId}/source`,

  redo: (videoId: string, t_start: number, t_end: number) =>
    fetch(`/api/videos/${videoId}/segments/redo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t_start, t_end }),
    }).then((r) => json<RedoResponse>(r)),

  select: (videoId: string, segmentId: string, candidateId: string) =>
    fetch(`/api/videos/${videoId}/segments/${segmentId}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidate_id: candidateId }),
    }).then((r) => json<SelectResponse>(r)),

  exportUrl: (videoId: string) => `/api/videos/${videoId}/export`,

  health: () => fetch("/api/health").then((r) => json<Record<string, unknown>>(r)),

  uploadActivation: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/videos/upload-activation", { method: "POST", body: form })
      .then((r) => json<{ status: string; video_id: string; windows: number; duration_sec: number }>(r));
  },

  uploadVideo: (file: File, videoId?: string | null) => {
    const form = new FormData();
    form.append("file", file);
    if (videoId) form.append("video_id", videoId);
    return fetch("/api/videos/upload-video", { method: "POST", body: form })
      .then((r) => json<{ status: string; video_id: string; size_mb: number; has_activation: boolean; has_verts: boolean }>(r));
  },

  uploadPreds: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/videos/upload-preds", { method: "POST", body: form })
      .then((r) => json<{ status: string; video_id: string; n_vertices: number; n_frames: number }>(r));
  },

  getVerts: (videoId: string) =>
    fetch(`/api/videos/${videoId}/verts`).then((r) => json<VertexField>(r)),
};
