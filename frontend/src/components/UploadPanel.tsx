import { useCallback, useRef, useState } from "react";
import { api } from "../api";

interface Props {
  onClose: () => void;
  onReady: (videoId: string) => void;
}

/**
 * Video-first import. You drop the video you ran through TRIBE v2 on Kaggle;
 * we auto-pair it with its activation JSON (matched by filename). The JSON drop
 * zone only appears if no match is found — because TRIBE runs on the cloud GPU,
 * the engagement numbers must come from that exported JSON, not local compute.
 */
export default function UploadPanel({ onClose, onReady }: Props) {
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [needsJson, setNeedsJson] = useState(false);
  const [jsonDone, setJsonDone] = useState(false);
  const videoRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);

  const handleVideo = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatus("Uploading video…");
    try {
      const res = await api.uploadVideo(file);
      const effectiveId = res.matched_activation_id ?? res.video_id;
      setVideoId(effectiveId);
      if (res.has_activation) {
        setStatus(`✓ ${effectiveId} — TRIBE v2 activation auto-loaded`);
        setNeedsJson(false);
      } else {
        setStatus(`Video saved. No TRIBE v2 activation found for “${res.video_id}”.`);
        setNeedsJson(true);
      }
    } catch (err: unknown) {
      setStatus(`✗ ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleJson = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatus("Uploading activation JSON…");
    try {
      const res = await api.uploadActivation(file);
      setVideoId(res.video_id);
      setJsonDone(true);
      setStatus(`✓ TRIBE v2 activation loaded: ${res.windows} windows, ${res.duration_sec.toFixed(1)}s`);
    } catch (err: unknown) {
      setStatus(`✗ ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }, []);

  const canGo = Boolean(videoId) && (!needsJson || jsonDone);

  const finish = () => {
    if (videoId && canGo) onReady(videoId);
    onClose();
  };

  return (
    <div className="redo-overlay" onClick={onClose}>
      <div className="redo-panel upload-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="upload-title">Upload Video</h2>
        <p className="upload-subtitle">
          Drop the video you ran through TRIBE v2 —{" "}
          <span className="cloud-tag">CLOUD GPU T4×2</span> — we auto-pair its activation.
        </p>

        {/* Primary: video */}
        <div
          className={`upload-zone upload-zone-hero ${videoId ? "done" : ""}`}
          onClick={() => videoRef.current?.click()}
        >
          <input
            ref={videoRef}
            type="file"
            accept=".mp4,.mov,.webm"
            hidden
            onChange={handleVideo}
            disabled={uploading}
          />
          <div className="upload-zone-icon">{videoId ? "✓" : "▶"}</div>
          <div className="upload-zone-label">
            {videoId ? `${videoId}` : "Drop your video"}
          </div>
          <div className="upload-zone-hint">
            {videoId ? "Uploaded" : "The same clip you fed into TRIBE v2"}
          </div>
        </div>

        {/* Fallback: JSON only when no auto-match */}
        {needsJson && (
          <div
            className={`upload-zone upload-zone-json ${jsonDone ? "done" : ""}`}
            onClick={() => jsonRef.current?.click()}
          >
            <input
              ref={jsonRef}
              type="file"
              accept=".json"
              hidden
              onChange={handleJson}
              disabled={uploading}
            />
            <div className="upload-zone-icon">{jsonDone ? "✓" : "{ }"}</div>
            <div className="upload-zone-label">
              {jsonDone ? "Activation JSON loaded" : "Add TRIBE v2 activation JSON"}
            </div>
            <div className="upload-zone-hint">
              {jsonDone ? "From notebook Cell 6" : "The .json exported from Kaggle for this video"}
            </div>
          </div>
        )}

        {status && <div className={`upload-status ${status.startsWith("✗") ? "err" : ""}`}>{status}</div>}

        <div className="upload-actions">
          <button className="btn btn-close" onClick={onClose} disabled={uploading}>Cancel</button>
          <button className="btn btn-accent" onClick={finish} disabled={!canGo || uploading}>
            {canGo ? "Run prediction" : needsJson ? "Add JSON to continue" : "Upload video first"}
          </button>
        </div>
      </div>
    </div>
  );
}
