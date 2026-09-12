import type { Curve, RedoResponse, SelectResponse } from "./types";

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
    fetch("/api/videos").then((r) => json<{ videos: string[] }>(r)),

  loadActivation: (videoId: string) =>
    fetch(`/api/videos/${videoId}/load-activation`, { method: "POST" }).then((r) =>
      json<unknown>(r),
    ),

  getCurve: (videoId: string) =>
    fetch(`/api/videos/${videoId}/curve`).then((r) => json<Curve>(r)),

  sourceUrl: (videoId: string) => `/api/videos/${videoId}/source`,

  brainHeatmap: (videoId: string) =>
    fetch(`/api/videos/${videoId}/brain-heatmap`)
      .then((r) => {
        if (!r.ok) return null;
        return r.arrayBuffer();
      })
      .then((buf) => {
        if (!buf) return null;
        const header = new Uint32Array(buf, 0, 2);
        const nWindows = header[0];
        const nVerts = header[1];
        const starts = new Float32Array(buf, 8, nWindows);
        const data = new Float32Array(buf, 8 + nWindows * 4, nWindows * nVerts);
        const windows: Float32Array[] = [];
        for (let i = 0; i < nWindows; i++) {
          windows.push(data.subarray(i * nVerts, (i + 1) * nVerts));
        }
        return { nWindows, nVerts, starts: Array.from(starts), windows };
      }),

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

  uploadVideo: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/videos/upload-video", { method: "POST", body: form })
      .then((r) => json<{ status: string; video_id: string; matched_activation_id: string | null; size_mb: number; has_activation: boolean }>(r));
  },
};
