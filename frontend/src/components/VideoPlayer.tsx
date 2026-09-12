import { forwardRef, useEffect, useRef, useState } from "react";

interface Props {
  src: string;
  playbackRate?: number;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
  onPlaying?: (playing: boolean) => void;
  onError?: () => void;
}

const VideoPlayer = forwardRef<HTMLVideoElement, Props>(function VideoPlayer(
  { src, playbackRate = 0.5, onTime, onDuration, onPlaying, onError },
  ref,
) {
  const [err, setErr] = useState<string | null>(null);
  const onTimeRef = useRef(onTime);
  const onDurationRef = useRef(onDuration);
  const onPlayingRef = useRef(onPlaying);
  const onErrorRef = useRef(onError);

  useEffect(() => { onTimeRef.current = onTime; }, [onTime]);
  useEffect(() => { onDurationRef.current = onDuration; }, [onDuration]);
  useEffect(() => { onPlayingRef.current = onPlaying; }, [onPlaying]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    const el = (ref as React.MutableRefObject<HTMLVideoElement | null>)?.current;
    if (!el) return;
    setErr(null);
    let raf = 0;
    let alive = true;

    const setPlaying = (v: boolean) => onPlayingRef.current?.(v);
    const tick = () => {
      if (!alive) return;
      onTimeRef.current(el.currentTime);
      if (!el.paused && !el.ended) raf = requestAnimationFrame(tick);
    };
    const startTick = () => {
      el.playbackRate = playbackRate;
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stopTick = () => {
      cancelAnimationFrame(raf);
      onTimeRef.current(el.currentTime);
      setPlaying(false);
    };
    const onMeta = () => {
      el.playbackRate = playbackRate;
      onDurationRef.current(el.duration || 0);
    };
    const tryPlay = () => {
      if (!el.paused) return;
      el.playbackRate = playbackRate;
      el.play().catch(() => setPlaying(false));
    };
    const fail = () => {
      setErr("Video failed to load. Choose the same .mp4 you ran through TRIBE.");
      setPlaying(false);
      onErrorRef.current?.();
    };

    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("canplay", tryPlay);
    el.addEventListener("playing", startTick);
    el.addEventListener("pause", stopTick);
    el.addEventListener("ended", stopTick);
    el.addEventListener("error", fail);
    el.playbackRate = playbackRate;

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("canplay", tryPlay);
      el.removeEventListener("playing", startTick);
      el.removeEventListener("pause", stopTick);
      el.removeEventListener("ended", stopTick);
      el.removeEventListener("error", fail);
      setPlaying(false);
    };
  }, [ref, src, playbackRate]);

  return (
    <div className="video-player">
      <video
        ref={ref}
        src={src}
        controls
        autoPlay
        muted
        playsInline
        preload="auto"
        className="video-el"
      />
      {err && <div className="video-error">{err}</div>}
    </div>
  );
});

export default VideoPlayer;
