import { useState } from "react";
import type { RedoResponse } from "../types";

interface Props {
  redo: RedoResponse;
  onSelect: (candidateId: string) => void;
  selecting: boolean;
}

/**
 * F8: candidate preview UI. Plays each ElevenLabs candidate. Candidates are
 * AI-generated video, not the original footage, so each is clearly labelled
 * (PRD Section 10 honesty contract).
 */
export default function CandidatePreview({ redo, onSelect, selecting }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <div className="candidates">
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

      <div className="candidate-grid">
        {redo.candidates.map((c) => (
          <div
            key={c.candidate_id}
            className={`candidate-card ${chosen === c.candidate_id ? "chosen" : ""}`}
          >
            <div className="ai-label">AI-GENERATED</div>
            <video src={c.preview_url} controls loop className="candidate-video" />
            <button
              className="btn"
              disabled={selecting}
              onClick={() => {
                setChosen(c.candidate_id);
                onSelect(c.candidate_id);
              }}
            >
              {selecting && chosen === c.candidate_id ? "Splicing…" : "Use this take"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
