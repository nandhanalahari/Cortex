import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Candidate, Curve, RedoResponse, RegenOptions, Selection } from "../types";
import EngagementTimeline from "./EngagementTimeline";
import ExportButton from "./ExportButton";

interface Props {
  videoId: string;
  curve: Curve | null;
  duration: number;
  onClose: () => void;
}

type Phase = "setup" | "generating" | "choose" | "done";

/** Floor on the generating screen so every pipeline stage gets its moment. */
const MIN_LOADING_MS = 16000;

const REASON_TEXT: Record<string, string> = {
  takes_generated_for: "the moment your takes were made for",
  lowest_engagement: "the lowest-engagement stretch",
  default: "the opening seconds",
};

const SCORE_HINT: Record<string, string> = {
  tribe: "TRIBE v2 · on the original's scale",
  manifest: "from manifest.json",
  no_take_json: "not scored by TRIBE yet",
  bad_take_json: "TRIBE JSON unreadable",
  no_original_json: "original has no TRIBE JSON",
  original_json_outdated: "re-export original with the new notebook",
  take_json_outdated: "re-export this take with the new notebook",
};

function scoreHint(c: Candidate) {
  return SCORE_HINT[c.score_status ?? ""] ?? (c.engagement_score == null ? "not scored by TRIBE yet" : "TRIBE v2");
}

function stages(takes: number) {
  return [
    { label: "Cutting the 5-second segment", detail: "ffmpeg · frame-accurate cut" },
    { label: "Gemini reads the start & end frames", detail: "scene, pacing, emotional beat" },
    { label: "Writing the creative direction", detail: "positive + negative prompt pair" },
    { label: `ElevenLabs renders ${takes} takes`, detail: "video with sound effects" },
    { label: "TRIBE v2 scores every take", detail: "six cortical regions → engagement" },
  ];
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function pct(v: number | null | undefined) {
  return v == null ? null : Math.round(v * 100);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The resegment flow: pick (or accept) a 5-second moment → staged generation →
 * choose one of the AI takes by its TRIBE engagement score → splice → export.
 * Takes are AI-generated video and labelled as such (PRD Section 10).
 */
export default function ResegmentStudio({ videoId, curve, duration, onClose }: Props) {
  const [options, setOptions] = useState<RegenOptions | null>(null);
  const [custom, setCustom] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [startedAt, setStartedAt] = useState(0);
  const [responded, setResponded] = useState(false);
  const [redo, setRedo] = useState<RedoResponse | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [splicedUrl, setSplicedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    api
      .regenOptions(videoId)
      .then((o) => {
        if (!alive.current) return;
        setOptions(o);
        setSelection({ t_start: o.suggested.t_start, t_end: o.suggested.t_end });
      })
      .catch((e) => alive.current && setError(String(e.message ?? e)));
  }, [videoId]);

  const takeCount = options?.n_takes || 3;

  const useSuggested = () => {
    setCustom(false);
    if (options) setSelection({ t_start: options.suggested.t_start, t_end: options.suggested.t_end });
  };

  const generate = useCallback(async () => {
    if (!selection) return;
    setError(null);
    setRedo(null);
    setSplicedUrl(null);
    setChosenId(null);
    setResponded(false);
    setStartedAt(performance.now());
    setPhase("generating");
    try {
      const [res] = await Promise.all([
        api.redo(videoId, selection).then((r) => {
          if (alive.current) setResponded(true);
          return r;
        }),
        wait(MIN_LOADING_MS),
      ]);
      await wait(700); // let the finished checklist land before the reveal
      if (!alive.current) return;
      setRedo(res);
      setPhase("choose");
    } catch (e) {
      if (!alive.current) return;
      setError(`Resegment failed: ${(e as Error).message}`);
      setPhase("setup");
    }
  }, [videoId, selection]);

  const choose = async (candidateId: string) => {
    if (!redo) return;
    setSelecting(candidateId);
    setError(null);
    try {
      const res = await api.select(videoId, redo.segment_id, candidateId);
      if (!alive.current) return;
      setChosenId(candidateId);
      setSplicedUrl(res.preview_url);
      setPhase("done");
    } catch (e) {
      if (alive.current) setError(`Splice failed: ${(e as Error).message}`);
    } finally {
      if (alive.current) setSelecting(null);
    }
  };

  const base = redo?.baseline_engagement ?? null;
  const chosen = redo?.candidates.find((c) => c.candidate_id === chosenId) ?? null;

  return (
    <div className="redo-overlay" onClick={phase === "setup" ? onClose : undefined}>
      <div className="rs-panel" onClick={(e) => e.stopPropagation()}>
        <header className="rs-head">
          <div>
            <h2 className="rs-title">Resegment</h2>
            <p className="rs-sub">
              Replace a 5-second moment with an AI-generated take, scored by TRIBE v2.
            </p>
          </div>
          {phase !== "generating" && (
            <button className="rs-x" onClick={onClose} aria-label="Close" disabled={selecting !== null}>
              ×
            </button>
          )}
        </header>

        {error && <div className="rs-error">{error}</div>}

        {phase === "setup" && (
          <div className="rs-setup">
            <div className="rs-toggle" role="radiogroup" aria-label="Segment to regenerate">
              <button
                className={`rs-opt ${!custom ? "on" : ""}`}
                role="radio"
                aria-checked={!custom}
                onClick={useSuggested}
              >
                <span className="rs-opt-title">Suggested moment</span>
                <span className="rs-opt-sub">
                  {options ? REASON_TEXT[options.suggested.reason] ?? options.suggested.reason : "finding the weakest stretch…"}
                </span>
              </button>
              <button
                className={`rs-opt ${custom ? "on" : ""}`}
                role="radio"
                aria-checked={custom}
                onClick={() => setCustom(true)}
              >
                <span className="rs-opt-title">Pick my own 5 seconds</span>
                <span className="rs-opt-sub">drag the window along the engagement timeline</span>
              </button>
            </div>

            {curve && duration > 0 ? (
              <EngagementTimeline
                scores={curve.scores}
                duration={duration}
                currentTime={selection?.t_start ?? 0}
                selection={selection}
                regenMode
                selectable={custom}
                onSeek={() => {}}
                onSelect={(s) => s && setSelection(s)}
              />
            ) : (
              <div className="rs-note">No engagement curve for this clip, so the suggested moment is used.</div>
            )}

            <div className="rs-summary">
              <div className="rs-range">
                <span className="sel-badge">SEGMENT</span>
                {selection ? `${fmt(selection.t_start)} – ${fmt(selection.t_end)}` : "—"}
              </div>
              <div className="rs-baseline">
                {custom ? (
                  <span className="muted">scored against the original after generation</span>
                ) : (
                  <>
                    current engagement <b>{pct(options?.baseline_engagement) ?? "—"}</b>
                  </>
                )}
              </div>
            </div>

            {options && !options.has_library && (
              <div className="rs-note">
                No pre-generated takes in <code>data/candidates/{videoId}/</code>, so Cortex will generate takes live.
              </div>
            )}

            <div className="rs-actions">
              <button className="btn btn-close" onClick={onClose}>Cancel</button>
              <button className="btn btn-accent" disabled={!selection} onClick={generate}>
                Generate {takeCount} takes
              </button>
            </div>
          </div>
        )}

        {phase === "generating" && (
          <GeneratingView startedAt={startedAt} responded={responded} segment={selection} takes={takeCount} />
        )}

        {phase === "choose" && redo && (
          <ChooseView redo={redo} selecting={selecting} onChoose={choose} onBack={() => setPhase("setup")} />
        )}

        {phase === "done" && splicedUrl && (
          <div className="rs-done">
            {chosen && (
              <div className="rs-done-summary">
                <span className="spliced-ok">✓ {chosen.label ?? chosen.candidate_id}</span> spliced into{" "}
                {fmt(redo?.t_start ?? 0)} – {fmt(redo?.t_end ?? 0)}
                {pct(chosen.engagement_score) != null && (
                  <>
                    {" "}· engagement <b>{pct(chosen.engagement_score)}</b>
                    {base != null && ` (${(pct(chosen.engagement_score)! - pct(base)!) >= 0 ? "+" : "−"}${Math.abs(pct(chosen.engagement_score)! - pct(base)!)} vs original)`}
                  </>
                )}
              </div>
            )}
            <video src={splicedUrl} controls autoPlay playsInline className="rs-final" />
            <div className="rs-actions">
              <button className="btn" onClick={() => setPhase("choose")}>← Back to takes</button>
              <button className="btn" onClick={onClose}>Close</button>
              <ExportButton videoId={videoId} splicedUrl={splicedUrl} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GeneratingView({
  startedAt,
  responded,
  segment,
  takes,
}: {
  startedAt: number;
  responded: boolean;
  segment: Selection | null;
  takes: number;
}) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, []);

  const list = stages(takes);
  const elapsed = Math.max(0, now - startedAt);
  const timed = Math.min(1, elapsed / MIN_LOADING_MS);
  // Hold short of 100% until the backend has actually answered.
  const progress = responded ? timed : Math.min(timed, 0.94);
  const active = progress >= 1 ? list.length : Math.min(list.length - 1, Math.floor(progress * list.length));

  return (
    <div className="rs-gen" aria-live="polite">
      <div className="rs-gen-orb" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="rs-gen-head">
        <span className="rs-gen-title">{active >= list.length ? "Takes ready" : list[active].label}</span>
        <span className="rs-gen-time">{(elapsed / 1000).toFixed(1)}s</span>
      </div>
      <div className="rs-progress">
        <div className="rs-progress-bar" style={{ width: `${progress * 100}%` }} />
      </div>
      <ol className="rs-stages">
        {list.map((s, i) => {
          const state = i < active ? "done" : i === active ? "active" : "todo";
          return (
            <li key={s.label} className={`rs-stage ${state}`}>
              <span className="rs-stage-icon">
                {state === "done" ? "✓" : state === "active" ? <i className="rs-dot-spin" /> : i + 1}
              </span>
              <div>
                <div className="rs-stage-label">{s.label}</div>
                <div className="rs-stage-detail">{s.detail}</div>
              </div>
            </li>
          );
        })}
      </ol>
      {segment && (
        <p className="rs-gen-foot">
          Regenerating {fmt(segment.t_start)} – {fmt(segment.t_end)} · hang tight, good takes take a moment
        </p>
      )}
    </div>
  );
}

function ChooseView({
  redo,
  selecting,
  onChoose,
  onBack,
}: {
  redo: RedoResponse;
  selecting: string | null;
  onChoose: (candidateId: string) => void;
  onBack: () => void;
}) {
  const base = pct(redo.baseline_engagement);
  const segLen = (redo.t_end ?? 0) - (redo.t_start ?? 0);
  const scored = redo.candidates.filter((c) => c.engagement_score != null);
  const bestId = scored.length
    ? scored.reduce((a, b) => (b.engagement_score! > a.engagement_score! ? b : a)).candidate_id
    : null;

  return (
    <div className="rs-choose">
      <div className="rs-choose-head">
        <div className="rs-range">
          <span className="sel-badge">SEGMENT</span>
          {fmt(redo.t_start ?? 0)} – {fmt(redo.t_end ?? 0)}
        </div>
        <div className="rs-baseline">
          original engagement <b>{base ?? "—"}</b>
        </div>
      </div>

      <div className="rs-grid">
        {redo.candidates.map((c, i) => {
          const score = pct(c.engagement_score);
          const delta = score != null && base != null ? score - base : null;
          const isBest = c.candidate_id === bestId;
          return (
            <div
              key={c.candidate_id}
              className={`rs-card ${isBest ? "best" : ""}`}
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <div className="rs-media">
                <video src={c.preview_url} autoPlay muted loop playsInline controls className="rs-video" />
                <span className="ai-label rs-ai">AI-GENERATED</span>
                {isBest && <span className="rs-best">▲ BEST</span>}
              </div>
              <div className="rs-card-body">
                <div className="rs-card-top">
                  <span className="rs-label">{c.label ?? `Take ${i + 1}`}</span>
                  {c.duration_sec != null && (
                    <span className="rs-dur">
                      {segLen > 0 && c.duration_sec > segLen + 0.05
                        ? `${c.duration_sec.toFixed(1)}s · trimmed to ${segLen.toFixed(1)}s`
                        : `${c.duration_sec.toFixed(1)}s`}
                    </span>
                  )}
                </div>
                <div className="rs-score-row">
                  <span className={`rs-score ${score == null ? "none" : ""}`}>{score ?? "—"}</span>
                  <span className="rs-score-label">
                    ENGAGEMENT
                    <span className="hero-sub">{scoreHint(c)}</span>
                  </span>
                  {delta != null && (
                    <span className={`rs-delta ${delta >= 0 ? "up" : "down"}`}>
                      {delta >= 0 ? "+" : "−"}
                      {Math.abs(delta)}
                    </span>
                  )}
                </div>
                <div className="rs-meter" title={base != null ? `white tick = original (${base})` : undefined}>
                  <div className="rs-meter-fill" style={{ width: `${score ?? 0}%` }} />
                  {base != null && <div className="rs-meter-base" style={{ left: `${base}%` }} />}
                </div>
                <button
                  className={`btn rs-use ${isBest ? "btn-accent" : ""}`}
                  disabled={selecting !== null}
                  onClick={() => onChoose(c.candidate_id)}
                >
                  {selecting === c.candidate_id ? "Splicing…" : "Use this take"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <details className="rs-direction">
        <summary>CREATIVE DIRECTION</summary>
        <div className="prompt-pair">
          <div>
            <span className="tag positive">positive</span>
            <p>{redo.positive_prompt}</p>
          </div>
          <div>
            <span className="tag negative">negative</span>
            <p>{redo.negative_prompt}</p>
          </div>
        </div>
      </details>

      <div className="rs-actions">
        <button className="btn" onClick={onBack} disabled={selecting !== null}>
          ← Pick a different moment
        </button>
      </div>
    </div>
  );
}
