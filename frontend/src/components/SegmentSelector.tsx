import { useCallback, useEffect, useRef } from "react";
import type { Selection } from "../types";

interface Props {
  duration: number;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

/** Fixed regenerate window length, in seconds. */
export const SEGMENT_LEN = 5;

/**
 * F4: segment selection is a FIXED 5-second window the user slides along the
 * timeline. Click anywhere to drop the window there, or drag the pink band to
 * reposition it. The window is always exactly SEGMENT_LEN long (clamped to the
 * clip), so every regenerate request has a consistent duration.
 */
export default function SegmentSelector({ duration, selection, onSelect, containerRef }: Props) {
  const dragging = useRef(false);
  const grabOffset = useRef(0); // seconds between window start and cursor

  const winLen = Math.min(SEGMENT_LEN, duration || SEGMENT_LEN);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || !duration) return 0;
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return frac * duration;
    },
    [containerRef, duration],
  );

  const clampStart = useCallback(
    (start: number) => Math.max(0, Math.min(duration - winLen, start)),
    [duration, winLen],
  );

  const placeAt = useCallback(
    (startCandidate: number) => {
      const start = clampStart(startCandidate);
      onSelect({ t_start: start, t_end: start + winLen });
    },
    [clampStart, onSelect, winLen],
  );

  // Auto-place a default window as soon as we know the duration.
  useEffect(() => {
    if (duration && !selection) placeAt(0);
  }, [duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTrackDown = (e: React.MouseEvent) => {
    if (!duration) return;
    e.stopPropagation();
    const t = timeFromClientX(e.clientX);
    // Center the window on the click.
    placeAt(t - winLen / 2);
    dragging.current = true;
    grabOffset.current = winLen / 2;
  };

  const onBandDown = (e: React.MouseEvent) => {
    if (!duration || !selection) return;
    e.stopPropagation();
    dragging.current = true;
    grabOffset.current = timeFromClientX(e.clientX) - selection.t_start;
  };

  const onMove = (e: React.MouseEvent) => {
    if (!dragging.current || !duration) return;
    placeAt(timeFromClientX(e.clientX) - grabOffset.current);
  };

  const onUp = () => { dragging.current = false; };

  const leftPct = selection ? (selection.t_start / duration) * 100 : 0;
  const widthPct = (winLen / (duration || 1)) * 100;

  return (
    <div
      className="segment-selector"
      onMouseDown={onTrackDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
    >
      {selection && duration > 0 && (
        <div
          className="segment-window"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          onMouseDown={onBandDown}
        >
          <span className="segment-window-label">{winLen.toFixed(0)}s</span>
        </div>
      )}
    </div>
  );
}
