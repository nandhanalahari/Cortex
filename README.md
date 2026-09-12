# Cortex — Interface & Pipeline

Neuro-engagement video editor. Cortex loads **precomputed TRIBE v2 cortical-response
predictions** for a video, builds a composite **engagement curve**, renders a
**glowing timeline synced to playback**, and closes the loop: drag-select a weak
moment → **Gemini** turns it into a prompt pair → **ElevenLabs** generates candidate
takes → **ffmpeg** splices your pick back into the full video → **export**.

This repo is the **interface/pipeline half** only. TRIBE v2 inference (Kaggle,
LLaMA-3.2-3B / V-JEPA2 / Wav2Vec-BERT, GPU) is the teammate's half and is **out of
scope** here — Cortex only ever *loads already-computed results*. See
[`Cortex_Interface_PRD.md`](./Cortex_Interface_PRD.md).

> This is our own build for a hackathon. It is inspired by the reference project
> [Percept](https://github.com/edrlu/Percept) but deliberately uses a **different
> stack** (FastAPI + React/Vite + Gemini + ElevenLabs + ffmpeg, no Redis/Next.js/Seedance).

---

## Stack

| Layer | Tech |
| --- | --- |
| Backend | Python 3.11+ · FastAPI · Uvicorn · Pydantic v2 |
| Video | ffmpeg (extract / splice / export / seed-frame) |
| AI | Google Gemini (multimodal segment analysis) · ElevenLabs Image & Video (`flows.video`, image-to-video) |
| Frontend | React 18 · Vite · TypeScript (SVG glowing timeline) |

## Feature map (PRD Section 3)

| PRD | Feature | Where |
| --- | --- | --- |
| F1 | Load precomputed activation JSON | `backend/services/activation_loader.py` |
| F2 | Composite engagement curve builder | `backend/services/engagement_curve.py` |
| F3 | Video player + synced glowing timeline | `frontend/src/components/VideoPlayer.tsx`, `EngagementTimeline.tsx` |
| F4 | Manual segment selection (drag) | `frontend/src/components/SegmentSelector.tsx` |
| F5 | Segment extraction | `backend/services/ffmpeg_service.py › extract_segment` |
| F6 | Gemini → prompt pair | `backend/services/gemini_service.py` |
| F7 | ElevenLabs → candidate segments | `backend/services/elevenlabs_service.py` |
| F8 | Candidate preview UI | `frontend/src/components/CandidatePreview.tsx` |
| F9 | Selection + splice-back | `backend/services/ffmpeg_service.py › splice_segment` |
| F10 | Export/download | `ffmpeg_service.py › export_final`, `ExportButton.tsx` |

## API (PRD Section 6)

- `GET  /api/videos` — list videos that have a precomputed activation JSON
- `POST /api/videos/{id}/load-activation` — handoff JSON echoed with `engagement_score` per window
- `GET  /api/videos/{id}/curve` — full engagement curve + peak / drop-off markers
- `GET  /api/videos/{id}/source` — the original demo video
- `POST /api/videos/{id}/segments/redo` — `{t_start,t_end}` → `{segment_id, positive_prompt, negative_prompt, candidates[]}`
- `POST /api/videos/{id}/segments/{seg}/select` — `{candidate_id}` → splices, returns preview
- `GET  /api/videos/{id}/export` — final edited video download

## The data handoff contract (PRD Section 2)

Your teammate drops one JSON per demo video into `data/precomputed/` named
`<video_id>.json`, bucketing TRIBE v2's ~20k raw vertices into six macro-regions:

```json
{
  "video_id": "demo_1",
  "duration_sec": 15.0,
  "windows": [
    { "t_start": 0.0, "t_end": 1.5,
      "regions": { "visual": 0.62, "language": 0.31, "reward_novelty": 0.44,
                   "memory_familiarity": 0.20, "emotional_arousal": 0.55,
                   "attention_salience": 0.58 } }
  ]
}
```

A working sample (`data/precomputed/demo_1.json`) ships in this repo. The matching
source video goes in `data/videos/demo_1.mp4`.

---

## Run it

### One command (Windows)

```powershell
.\run.ps1
```

Then open http://localhost:5173.

### Manual

```powershell
# Backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

### Configuration

Copy `.env.example` → `.env` and set your keys:

```
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...       # ElevenLabs Image & Video needs a Pro plan or above
OFFLINE_MODE=false           # true = always use mock/local candidates
```

`FFMPEG_BIN` / `FFPROBE_BIN` already point at the portable ffmpeg under `.tools/`.

## Offline / demo-safety mode (PRD Section 10)

If no API keys are set (or `OFFLINE_MODE=true`, or a live call fails), Cortex
gracefully falls back:
- **Gemini** → a deterministic mock prompt pair.
- **ElevenLabs** → three **local ffmpeg variant clips** of the original segment
  (distinct color/motion treatments) so the full redo → splice → export loop still
  runs with no network. AI-generated candidates are always labelled in the UI.

## Honesty contract (PRD Section 10)

- The engagement curve is *our* scoring construction on top of the raw six-region
  data — TRIBE v2 has no built-in single "engagement" score.
- The glowing timeline is a **replay of precomputed data**, not live inference.
- ElevenLabs candidates are **AI-generated video**, labelled as such.
