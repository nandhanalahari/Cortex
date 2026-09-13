import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import AutumnGrid from "./components/AutumnGrid";
import CorticalBrain from "./components/CorticalBrain";
import EngagementMeter from "./components/EngagementMeter";
import ResegmentStudio from "./components/ResegmentStudio";
import SpikeGraph from "./components/SpikeGraph";
import UploadPanel from "./components/UploadPanel";
import VideoPlayer from "./components/VideoPlayer";
import { REGIONS, engagementFrom, lerpLevels } from "./regions";
import type { Curve, VertexField } from "./types";

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function App() {
  const [started, setStarted] = useState(false);
  const [videoId, setVideoId] = useState("");
  const [curve, setCurve] = useState<Curve | null>(null);
  const [verts, setVerts] = useState<VertexField | null>(null);
  const [regionData, setRegionData] = useState<{ t_start: number; t_end: number; regions: Record<string, number> }[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showResegment, setShowResegment] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const openResegment = useCallback(() => {
    videoRef.current?.pause();
    setShowResegment(true);
  }, []);

  const begin = useCallback((vid: string) => {
    setError(null);
    setStarted(true);
    setShowUpload(false);
    setShowResegment(false);
    setVideoId(vid);
    setCurrentTime(0);
    setPlaying(false);
  }, []);

  useEffect(() => {
    api.health().then((h) => setOffline(Boolean(h.offline_mode))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!videoId) return;
    setCurve(null);
    setVerts(null);
    setRegionData([]);
    Promise.all([
      api.getCurve(videoId).catch(() => null),
      api.loadActivation(videoId).catch(() => null),
      api.getVerts(videoId).catch(() => null),
    ])
      .then(([c, act, v]) => {
        if (c) {
          setCurve(c);
          setDuration((prev) => prev || c.duration_sec || 0);
        }
        const a = act as { windows?: { t_start: number; t_end: number; regions: Record<string, number> }[] } | null;
        if (a?.windows) setRegionData(a.windows);
        setVerts(v);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [videoId]);

  const seekTo = useCallback((t: number) => {
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  }, []);

  const handleDuration = useCallback((d: number) => {
    setDuration(d || curve?.duration_sec || 0);
  }, [curve]);

  const showDuration = duration || curve?.duration_sec || 0;
  const brainLevels = useMemo(() => lerpLevels(regionData, currentTime), [regionData, currentTime]);
  const engagement = engagementFrom(brainLevels);

  const graphTimes = useMemo(() => {
    const n = 72;
    const dur = showDuration || 1;
    return Array.from({ length: n }, (_, i) => (i / Math.max(1, n - 1)) * dur);
  }, [showDuration]);

  const graphSeries = useMemo(() => {
    const regionSeries = REGIONS.map((r) => ({
      key: r.key,
      label: r.short,
      color: r.color,
      values: graphTimes.map((t) => lerpLevels(regionData, t)[r.key] ?? 0),
    }));
    return [
      ...regionSeries,
      {
        key: "engagement",
        label: "ENG",
        color: "#f5d07a",
        values: graphTimes.map((t) => engagementFrom(lerpLevels(regionData, t))),
      },
    ];
  }, [graphTimes, regionData]);

  if (!started) {
    return (
      <div className="app">
        <AutumnGrid />
        <header className="app-header">
          <div className="header-brand">
            <h1>Cortex</h1>
            <span className="header-tag">TRIBE V2 · INTERFACE</span>
          </div>
          <div className="header-right">
            {offline && <span className="badge badge-offline">OFFLINE</span>}
            <span className="badge badge-cloud">CLOUD GPU</span>
          </div>
        </header>
        {error && <div className="error-banner">{error}</div>}
        <UploadPanel embedded onReady={begin} />
      </div>
    );
  }

  return (
    <div className="app">
      <AutumnGrid />
      <header className="app-header">
        <div className="header-brand">
          <h1>Cortex</h1>
          <span className="header-tag">TRIBE V2 · INTERFACE</span>
        </div>
        <div className="header-right">
          {offline && <span className="badge badge-offline">OFFLINE</span>}
          <span className="badge badge-cloud">CLOUD GPU</span>
          <span className="header-rate">0.5×</span>
          <span className="header-time">{formatTime(currentTime)} / {formatTime(showDuration)}</span>
          <span className="header-vid">{videoId}</span>
          <button className="btn btn-accent btn-reseg" onClick={openResegment} disabled={!videoId}>
            Resegment
          </button>
          <button className="btn btn-upload" onClick={() => setShowUpload(true)}>
            New clip
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <main className="stage">
        <section className="brain-col">
          <CorticalBrain
            vertexField={null}
            levels={brainLevels}
            intensity={engagement}
            playing={playing}
          />
          {playing && (
            <div className="showcase-overlay">
              <div className="showcase-badge">
                <span className="showcase-pulse" />
                TRIBE V2 · PREDICTING
              </div>
            </div>
          )}
          {!regionData.length && (
            <div className="verts-hint">Drop the Kaggle JSON into data/activations/ to light the six regions</div>
          )}
        </section>

        <section className="insight-col">
          <div className="video-wrapper">
            <VideoPlayer
              ref={videoRef}
              src={api.sourceUrl(videoId)}
              playbackRate={0.5}
              onTime={setCurrentTime}
              onDuration={handleDuration}
              onPlaying={setPlaying}
            />
          </div>
          <EngagementMeter levels={brainLevels} />
        </section>
      </main>

      <section className="spike-deck">
        <SpikeGraph
          times={graphTimes}
          series={graphSeries}
          duration={showDuration}
          currentTime={currentTime}
          onSeek={seekTo}
        />
      </section>

      {showUpload && (
        <UploadPanel onClose={() => setShowUpload(false)} onReady={begin} />
      )}

      {showResegment && (
        <ResegmentStudio
          videoId={videoId}
          curve={curve}
          duration={showDuration}
          onClose={() => setShowResegment(false)}
        />
      )}
    </div>
  );
}
