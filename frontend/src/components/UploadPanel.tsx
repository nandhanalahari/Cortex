import { useCallback, useRef, useState } from "react";
import { api } from "../api";

interface Props {
  onReady: (videoId: string) => void;
  onClose?: () => void;
  embedded?: boolean;
}

export default function UploadPanel({ onReady, onClose, embedded }: Props) {
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const videoRef = useRef<HTMLInputElement>(null);

  const handleVideo = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setStatus("Pairing video with TRIBE field…");
    try {
      const res = await api.uploadVideo(file);
      const paired = res.has_activation || res.has_verts;
      setStatus(
        paired
          ? `✓ ${res.video_id} — TRIBE field locked. Playing at 0.5×`
          : `✓ ${res.video_id} saved. Drop Cell 6 JSON + _preds.npz into data/activations/ first.`,
      );
      onReady(res.video_id);
      onClose?.();
    } catch (err: unknown) {
      setStatus(`✗ ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  }, [onReady, onClose]);

  const body = (
    <div className={`redo-panel upload-panel ${embedded ? "upload-embedded" : ""}`} onClick={(e) => e.stopPropagation()}>
      <h2 className="upload-title">Start Cortex</h2>
      <p className="upload-subtitle">
        TRIBE already ran on{" "}
        <span className="cloud-tag">CLOUD GPU T4×2</span>.
        Drop both Cell 6 files into <b>data/activations/</b> (or <b>data/kaggle_inbox/</b>),
        then upload the same video you sent to Kaggle.
      </p>

      <div className="upload-zones">
        <div className="upload-zone" onClick={() => videoRef.current?.click()}>
          <input ref={videoRef} type="file" accept=".mp4,.mov,.webm" hidden onChange={handleVideo} disabled={uploading} />
          <div className="upload-zone-icon">▶</div>
          <div className="upload-zone-label">Video</div>
          <div className="upload-zone-hint">The same .mp4 you uploaded in Kaggle Cell 3</div>
        </div>
      </div>

      {status && <div className={`upload-status ${status.startsWith("✗") ? "err" : ""}`}>{status}</div>}

      <div className="upload-actions">
        {!embedded && onClose && (
          <button className="btn btn-close" onClick={onClose} disabled={uploading}>Cancel</button>
        )}
        <button
          className="btn btn-accent"
          onClick={() => videoRef.current?.click()}
          disabled={uploading}
          type="button"
        >
          {uploading ? "Pairing…" : "Choose video"}
        </button>
      </div>
    </div>
  );

  if (embedded) return <div className="landing">{body}</div>;
  return (
    <div className="redo-overlay" onClick={onClose}>
      {body}
    </div>
  );
}
