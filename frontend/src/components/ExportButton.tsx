interface Props {
  videoId: string;
  splicedUrl: string | null;
}

/**
 * F10: export/download the final edited video. Enabled once a candidate has
 * been spliced back into the full video.
 */
export default function ExportButton({ videoId, splicedUrl }: Props) {
  if (!splicedUrl) return null;
  return (
    <div className="export-row">
      <span className="spliced-ok">✓ Spliced into full video</span>
      <a className="btn btn-primary" href={`/api/videos/${videoId}/export`} download>
        Export final video
      </a>
    </div>
  );
}
