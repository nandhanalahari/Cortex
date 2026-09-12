import { useCallback, useRef } from "react";
import type { Selection } from "../types";

interface Props {
  duration: number;
  selection: Selection | null;
  onSelect: (sel: Selection | null) => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

/**
 * F4: manual segment selection. Drag horizontally across the timeline to pick a
 * time range to redo. Renders a transparent overlay that captures drag and maps
 * pixel positions to seconds using the shared timeline container rect.
 *
 * State is kept in refs (not useState) so mid-drag handlers never read stale
 * values — robust even if events arrive in the same tick.
 */
export default function SegmentSelector({ duration, onSelect, containerRef }: Props) {
  const dragging = useRef(false);
  const startFrac = useRef(0);
  const lastRange = useRef<Selection | null>(null);

  const fracFromEvent = useCallback(
    (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    },
    [containerRef],
  );

  const onDown = (e: React.MouseEvent) => {
    if (!duration) return;
    e.stopPropagation();
    dragging.current = true;
    startFrac.current = fracFromEvent(e.clientX);
    const t = startFrac.current * duration;
    lastRange.current = { t_start: t, t_end: t };
    onSelect(lastRange.current);
  };

  const onMove = (e: React.MouseEvent) => {
    if (!dragging.current || !duration) return;
    const cur = fracFromEvent(e.clientX);
    const a = Math.min(startFrac.current, cur);
    const b = Math.max(startFrac.current, cur);
    lastRange.current = { t_start: a * duration, t_end: b * duration };
    onSelect(lastRange.current);
  };

  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const r = lastRange.current;
    if (r && r.t_end - r.t_start < 0.2) {
      onSelect(null); // a click / tiny drag deselects
    }
  };

  return (
    <div
      className="segment-selector"
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
    />
  );
}
