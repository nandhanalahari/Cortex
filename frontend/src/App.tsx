import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import CandidatePreview from "./components/CandidatePreview";
import CorticalBrain from "./components/CorticalBrain";
import EngagementTimeline from "./components/EngagementTimeline";
import ExportButton from "./components/ExportButton";
import RegionCharts from "./components/RegionCharts";
import VideoPlayer from "./components/VideoPlayer";
import type { Curve, RedoResponse, Selection, WindowScore } from "./types";

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function App() {
  const [videos, setVideos] = useState<string[]>([]);
  const [videoId, setVideoId] = useState("");
  const [curve, setCurve] = useState<Curve | null>(null);
  const [regionData, setRegionData] = useState<{ regions: Record<string, number> }[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);

  const [redo, setRedo] = useState<RedoResponse | null>(null);
  const [loadingRedo, setLoadingRedo] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [splicedUrl, setSplicedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Load videos list on mount
  useEffect(() => {
    api.health().then((h) => setOffline(Boolean(h.offline_mode))).catch(() => {});
    api
      .listVideos()
      .then((r) => {
        setVideos(r.videos);
        if (r.videos.length) setVideoId(r.videos[0]);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // Load curve + activation data when video changes
  useEffect(() => {
    if (!videoId) return;
    setCurve(null);
    setRedo(null);
    setSplicedUrl(null);
    setSelection(null);
    setRegionData([]);
    Promise.all([
      api.getCurve(videoId),
      api.loadActivation(videoId),
    ])
      .then(([c, act]) => {
        setCurve(c);
        const a = act as { windows?: { regions: Record<string, number> }[] };
        if (a.windows) setRegionData(a.windows);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [videoId]);

  const seekTo = useCallback(
    (t: number) => {
      setCurrentTime(t);
      if (videoRef.current) videoRef.current.currentTime = t;
    },
    [],
  );

  // Compute brain activation levels from regionData at the current time
  const brainLevels = (() => {
    if (!regionData.length || !duration) {
      return { visual: 0, language: 0, reward_novelty: 0, memory_familiarity: 0, emotional_arousal: 0, attention_salience: 0 };
    }
    const windowIdx = Math.min(
      regionData.length - 1,
      Math.max(0, Math.floor((currentTime / duration) * regionData.length)),
    );
    const r = regionData[windowIdx]?.regions ?? {};
    return {
      visual: r.visual ?? 0,
      language: r.language ?? 0,
      reward_novelty: r.reward_novelty ?? 0,
      memory_familiarity: r.memory_familiarity ?? 0,
      emotional_arousal: r.emotional_arousal ?? 0,
      attention_salience: r.attention_salience ?? 0,
    };
  })();

  const overallIntensity = curve?.scores.length
    ? (curve.scores[
        Math.min(
          curve.scores.length - 1,
          Math.max(0, Math.floor((currentTime / (duration || 1)) * curve.scores.length)),
        )
      ]?.engagement_score ?? 0)
    : 0;

  const runRedo = async () => {
    if (!selection) return;
    setError(null);
    setLoadingRedo(true);
    setRedo(null);
    setSplicedUrl(null);
    try {
      const res = await api.redo(videoId, selection.t_start, selection.t_end);
      setRedo(res);
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoadingRedo(false);
    }
  };

  const chooseCandidate = async (candidateId: string) => {
    if (!redo) return;
    setSelecting(true);
    setError(null);
    try {
      const res = await api.select(videoId, redo.segment_id, candidateId);
      setSplicedUrl(res.preview_url);
    } catch (e: unknown) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSelecting(false);
    }
  };

  const scores: WindowScore[] = curve?.scores ?? [];

  return (
    <div className="app">
      {/* ---- HEADER ---- */}
      <header className="app-header">
        <div className="header-brand">
          <h1>Cortex</h1>
          <span className="header-tag">TRIBE V2 · INTERFACE</span>
        </div>
        <div className="header-right">
          {offline && <span className="badge badge-offline">OFFLINE</span>}
          <span className="header-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
          <select value={videoId} onChange={(e) => setVideoId(e.target.value)}>
            {videos.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {/* ---- MAIN STAGE ---- */}
      <main className="stage">
        {/* LEFT COLUMN: 3D Brain hero */}
        <section className="brain-col">
          <CorticalBrain levels={brainLevels} intensity={overallIntensity} />
        </section>

        {/* RIGHT COLUMN: Video + Region charts + controls */}
        <section className="insight-col">
          {/* Video player */}
          <div className="video-wrapper">
            {videoId && (
              <VideoPlayer
                ref={videoRef}
                src={api.sourceUrl(videoId)}
                onTime={setCurrentTime}
                onDuration={(d) => setDuration(d || curve?.duration_sec || 0)}
              />
            )}
          </div>

          {/* Per-region signal charts */}
          {regionData.length > 0 && curve && (
            <RegionCharts
              scores={scores}
              regionData={regionData}
              duration={duration || curve.duration_sec}
              currentTime={currentTime}
              engagementScore={overallIntensity}
            />
          )}
        </section>
      </main>

      {/* ---- BOTTOM DECK: Timeline + Controls ---- */}
      <section className="deck">
        {curve && (
          <EngagementTimeline
            scores={scores}
            duration={duration || curve.duration_sec}
            currentTime={currentTime}
            selection={selection}
            onSeek={seekTo}
            onSelect={setSelection}
          />
        )}

        <div className="deck-controls">
          <div className="selection-info">
            {selection ? (
              <>
                <span className="sel-badge">CUT</span>
                <b>{selection.t_start.toFixed(1)}s</b> – <b>{selection.t_end.toFixed(1)}s</b>
                {" "}({(selection.t_end - selection.t_start).toFixed(1)}s)
              </>
            ) : (
              <span className="muted">Drag the timeline to select a segment to regenerate</span>
            )}
          </div>
          <button className="btn btn-accent" disabled={!selection || loadingRedo} onClick={runRedo}>
            {loadingRedo ? "Analyzing + generating…" : "Regenerate segment"}
          </button>
        </div>
      </section>

      {/* ---- REDO RESULTS OVERLAY ---- */}
      {(loadingRedo || redo || splicedUrl) && (
        <div className="redo-overlay">
          <div className="redo-panel">
            {loadingRedo && (
              <div className="loading-card">
                <div className="spinner" />
                <p>
                  Gemini is analyzing the segment…<br />
                  ElevenLabs is generating candidates (10–30s)
                </p>
              </div>
            )}
            {redo && !loadingRedo && (
              <CandidatePreview redo={redo} onSelect={chooseCandidate} selecting={selecting} />
            )}
            {splicedUrl && (
              <div className="result-card">
                <h3>✓ Spliced into full video</h3>
                <video src={splicedUrl} controls className="candidate-video" />
                <ExportButton videoId={videoId} splicedUrl={splicedUrl} />
              </div>
            )}
            {!loadingRedo && (
              <button
                className="btn btn-close"
                onClick={() => { setRedo(null); setSplicedUrl(null); }}
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
