import { forwardRef, useEffect } from "react";

interface Props {
  src: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
}

/**
 * F3 (part): the video element. Reports playback time up to the parent so the
 * glowing timeline can stay synced. The parent holds the ref for seeking.
 */
const VideoPlayer = forwardRef<HTMLVideoElement, Props>(function VideoPlayer(
  { src, onTime, onDuration },
  ref,
) {
  useEffect(() => {
    const el = (ref as React.MutableRefObject<HTMLVideoElement | null>)?.current;
    if (!el) return;
    const time = () => onTime(el.currentTime);
    const dur = () => onDuration(el.duration || 0);
    el.addEventListener("timeupdate", time);
    el.addEventListener("loadedmetadata", dur);
    return () => {
      el.removeEventListener("timeupdate", time);
      el.removeEventListener("loadedmetadata", dur);
    };
  }, [ref, onTime, onDuration, src]);

  return (
    <video
      ref={ref}
      src={src}
      controls
      className="video-el"
      crossOrigin="anonymous"
    />
  );
});

export default VideoPlayer;
