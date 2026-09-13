import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, session } from "./api";
import AuthModal from "./components/AuthModal";
import AutumnGrid from "./components/AutumnGrid";
import CorticalBrain from "./components/CorticalBrain";
import EngagementMeter from "./components/EngagementMeter";
import ResegmentStudio from "./components/ResegmentStudio";
import SpikeGraph from "./components/SpikeGraph";
import UploadPanel from "./components/UploadPanel";
import VideoPlayer from "./components/VideoPlayer";
import { engagementFrom, lerpLevels } from "./regions";
import type { AuthUser, Curve, DashboardTake, RegionWindow, VertexField } from "./types";

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function App() {
  const [started, setStarted] = useState(false);
  const [videoId, setVideoId] = useState("");
  const [curve, setCurve] = useState<Curve | null>(null);
  const [verts, setVerts] = useState<VertexField | null>(null);
  const [regionData, setRegionData] = useState<RegionWindow[]>([]);
  const [takeView, setTakeView] = useState<DashboardTake | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showResegment, setShowResegment] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!session.get()) return;
    api
      .me()
      .then((u) => {
        if (u) setUser(u);
        else session.set(null);
      })
      .catch(() => {}); // backend unreachable: keep the token, stay signed-out in the UI
  }, []);

  const logout = useCallback(() => {
    api.logout().catch(() => {});
    session.set(null);
    setUser(null);
  }, []);

  const account = user ? (
    <span className="account-chip" title={user.email}>
      <span className="account-email">{user.email}</span>
      <button className="take-chip-x" onClick={logout}>Log out</button>
    </span>
  ) : (
    <button className="btn btn-upload" onClick={() => setShowAuth(true)}>
      Log in
    </button>
  );

  const authModal = showAuth && (
    <AuthModal
      onClose={() => setShowAuth(false)}
      onAuthed={(u) => {
        setUser(u);
        setShowAuth(false);
      }}
    />
  );

  const openResegment = useCallback(() => {
    videoRef.current?.pause();
    setShowResegment(true);
  }, []);

  const begin = useCallback((vid: string) => {
    setError(null);
    setStarted(true);
    setShowUpload(false);
    setShowResegment(false);
    setTakeView(null);
    setVideoId(vid);
    setCurrentTime(0);
    setPlaying(false);
  }, []);

  const showTake = useCallback((take: DashboardTake | null) => {
    setShowResegment(false);
    setTakeView(take);
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
        const a = act as { windows?: RegionWindow[] } | null;
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

  // A spliced take with its own TRIBE windows drives the brain, meter and graph.
  const takeScored = Boolean(takeView?.windows?.length);
  const activeWindows = takeScored ? takeView!.windows! : regionData;

  const showDuration = duration || curve?.duration_sec || 0;
  const brainLevels = useMemo(() => lerpLevels(activeWindows, currentTime), [activeWindows, currentTime]);
  const engagement = engagementFrom(brainLevels);

  const graphTimes = useMemo(() => {
    const n = 120;
    const dur = showDuration || 1;
    return Array.from({ length: n }, (_, i) => (i / Math.max(1, n - 1)) * dur);
  }, [showDuration]);

  const engagementLine = useCallback(
    (windows: RegionWindow[]) => graphTimes.map((t) => engagementFrom(lerpLevels(windows, t))),
    [graphTimes],
  );

  const graphLine = useMemo(
    () => ({
      label: takeView ? (takeScored ? takeView.label : `${takeView.label} · not scored, showing original`) : "Original",
      color: "#f5d07a",
      values: activeWindows.length ? engagementLine(activeWindows) : [],
    }),
    [takeView, takeScored, activeWindows, engagementLine],
  );

  const graphOverlay = useMemo(
    () => (takeScored && regionData.length ? { label: "Original", color: "#cfd3e6", values: engagementLine(regionData) } : null),
    [takeScored, regionData, engagementLine],
  );

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
            {account}
          </div>
        </header>
        {error && <div className="error-banner">{error}</div>}
        <UploadPanel embedded onReady={begin} />
        {authModal}
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
          {takeView ? (
            <span className="take-chip" title={videoId}>
              <span className="ai-label">AI TAKE</span>
              {takeView.label}
              <button className="take-chip-x" onClick={() => showTake(null)}>
                Show original
              </button>
            </span>
          ) : (
            <span className="header-vid">{videoId}</span>
          )}
          <button className="btn btn-accent btn-reseg" onClick={openResegment} disabled={!videoId}>
            Resegment
          </button>
          <button className="btn btn-upload" onClick={() => setShowUpload(true)}>
            New clip
          </button>
          {account}
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
          {!activeWindows.length && (
            <div className="verts-hint">Drop the Kaggle JSON into data/activations/ to light the six regions</div>
          )}
        </section>

        <section className="insight-col">
          <div className="video-wrapper">
            <VideoPlayer
              key={takeView?.videoUrl ?? "original"}
              ref={videoRef}
              src={takeView?.videoUrl ?? api.sourceUrl(videoId)}
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
          line={graphLine}
          overlay={graphOverlay}
          highlight={takeView ? { t_start: takeView.t_start, t_end: takeView.t_end } : null}
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
          onShowOnDashboard={showTake}
        />
      )}

      {authModal}
    </div>
  );
}
