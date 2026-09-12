import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import CandidatePreview from "./components/CandidatePreview";
import CorticalBrain from "./components/CorticalBrain";
import EngagementTimeline from "./components/EngagementTimeline";
import ExportButton from "./components/ExportButton";
import RegionCharts from "./components/RegionCharts";
import UploadPanel from "./components/UploadPanel";
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
  const [regionData, setRegionData] = useState<{ t_start: number; t_end: number; regions: Record<string, number> }[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [regenMode, setRegenMode] = useState(false); // 5s edit bar hidden until toggled

  const [redo, setRedo] = useState<RedoResponse | null>(null);
  const [loadingRedo, setLoadingRedo] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [splicedUrl, setSplicedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // Live prediction showcase (sweeps the brain through TRIBE v2's windows)
  const [showcase, setShowcase] = useState(false);
  const [showcaseTime, setShowcaseTime] = useState(0);
  const pendingShowcase = useRef(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  const runShowcase = useCallback((dur: number) => {
    if (!dur) return;
    setShowcase(true);
    setShowcaseTime(0);
    const SHOW_MS = 5500; // at least 5s, for coolness
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / SHOW_MS);
      setShowcaseTime(p * dur);
      if (p < 1) requestAnimationFrame(step);
      else setShowcase(false);
    };
    requestAnimationFrame(step);
  }, []);

  // Refresh video list (called after upload too)
  const refreshVideos = useCallback((selectId?: string) => {
    api.listVideos()
      .then((r) => {
        setVideos(r.videos);
        if (selectId && r.videos.includes(selectId)) setVideoId(selectId);
        else if (!videoId && r.videos.length) setVideoId(r.videos[0]);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [videoId]);

  // Load videos list on mount
  useEffect(() => {
    api.health().then((h) => setOffline(Boolean(h.offline_mode))).catch(() => {});
    refreshVideos();
  }, []);

  // Load curve + activation data when video changes
  useEffect(() => {
    if (!videoId) return;
    setCurve(null);
    setRedo(null);
    setSplicedUrl(null);
    setSelection(null);
    setRegenMode(false);
    setRegionData([]);
    Promise.all([
      api.getCurve(videoId),
      api.loadActivation(videoId),
    ])
      .then(([c, act]) => {
        setCurve(c);
        const a = act as { windows?: { t_start: number; t_end: number; regions: Record<string, number> }[] };
        if (a.windows) setRegionData(a.windows);
        if (pendingShowcase.current) {
          pendingShowcase.current = false;
          runShowcase(c.duration_sec);
        }
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [videoId, runShowcase]);

  const seekTo = useCallback(
    (t: number) => {
      setCurrentTime(t);
      if (videoRef.current) videoRef.current.currentTime = t;
    },
    [],
  );

  // During the showcase we sweep through TRIBE v2's windows; otherwise we track playback.
  const showDuration = duration || curve?.duration_sec || 0;
  const effectiveTime = showcase ? showcaseTime : currentTime;

  // Find the EXACT window [t_start, t_end) that contains the current second.
  // This is the source of truth for what the brain shows — no even-spacing
  // assumption, so the lit regions always match the video frame precisely.
  const activeWindowIdx = (() => {
    if (!regionData.length) return -1;
    for (let i = 0; i < regionData.length; i++) {
      const w = regionData[i];
      if (effectiveTime >= w.t_start && effectiveTime < w.t_end) return i;
    }
    // Past the last window's end (rounding at the very end) → clamp to last.
    return effectiveTime >= regionData[regionData.length - 1].t_end
      ? regionData.length - 1
      : 0;
  })();

  // Compute brain activation levels from the exact active window
  const brainLevels = (() => {
    const r = activeWindowIdx >= 0 ? regionData[activeWindowIdx].regions : {};
    return {
      visual: r.visual ?? 0,
      language: r.language ?? 0,
      reward_novelty: r.reward_novelty ?? 0,
      memory_familiarity: r.memory_familiarity ?? 0,
      emotional_arousal: r.emotional_arousal ?? 0,
      attention_salience: r.attention_salience ?? 0,
    };
  })();

  // Overall intensity from the SAME window index, so brain + shell stay in sync.
  const overallIntensity =
    activeWindowIdx >= 0 && curve?.scores[activeWindowIdx]
      ? curve.scores[activeWindowIdx].engagement_score
      : 0;

  // Reveal the 5-second edit bar, seeded at the current playhead.
  const enableRegen = () => {
    const len = Math.min(5, showDuration || 5);
    const start = Math.max(0, Math.min((showDuration || len) - len, currentTime));
    setSelection({ t_start: start, t_end: start + len });
    setRegenMode(true);
  };

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
          <span className="badge badge-cloud">CLOUD GPU</span>
          <span className="header-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
          <select value={videoId} onChange={(e) => setVideoId(e.target.value)}>
            {videos.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <button className="btn btn-upload" onClick={() => setShowUpload(true)}>
            Upload Video
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {/* ---- MAIN STAGE ---- */}
      <main className="stage">
        {/* LEFT COLUMN: 3D Brain hero */}
        <section className="brain-col">
          <CorticalBrain levels={brainLevels} intensity={overallIntensity} videoId={videoId} currentTime={effectiveTime} />
          {showcase && (
            <div className="showcase-overlay">
              <div className="showcase-badge">
                <span className="showcase-pulse" />
                TRIBE V2 · PREDICTING ON CLOUD GPU
              </div>
              <div className="showcase-progress">
                <div
                  className="showcase-progress-bar"
                  style={{ width: `${showDuration ? (showcaseTime / showDuration) * 100 : 0}%` }}
                />
              </div>
              <div className="showcase-time">{effectiveTime.toFixed(1)}s / {showDuration.toFixed(1)}s</div>
            </div>
          )}
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
            regenMode={regenMode}
            onSeek={seekTo}
            onSelect={setSelection}
          />
        )}

        <div className="deck-controls">
          {!regenMode ? (
            <>
              <div className="selection-info">
                <span className="muted">Playing in sync with the brain — pick a 5-second span to regenerate</span>
              </div>
              <button className="btn btn-accent" onClick={enableRegen} disabled={!curve}>
                Regenerate a segment
              </button>
            </>
          ) : (
            <>
              <div className="selection-info">
                <span className="sel-badge">5S WINDOW</span>
                {selection && (
                  <>
                    <b>{selection.t_start.toFixed(1)}s</b> – <b>{selection.t_end.toFixed(1)}s</b>
                    <span className="muted"> · slide it on the timeline</span>
                  </>
                )}
              </div>
              <button className="btn" onClick={() => { setRegenMode(false); setSelection(null); }}>
                Cancel
              </button>
              <button className="btn btn-accent" disabled={!selection || loadingRedo} onClick={runRedo}>
                {loadingRedo ? "Analyzing + generating…" : "Regenerate segment"}
              </button>
            </>
          )}
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
      {/* ---- UPLOAD PANEL ---- */}
      {showUpload && (
        <UploadPanel
          onClose={() => setShowUpload(false)}
          onReady={(vid) => {
            setShowUpload(false);
            pendingShowcase.current = true;
            if (vid === videoId) {
              // Same id already selected — reload + showcase manually.
              api.loadActivation(vid).then(() => runShowcase(showDuration));
            } else {
              refreshVideos(vid);
              setVideoId(vid);
            }
          }}
        />
      )}
    </div>
  );
}
