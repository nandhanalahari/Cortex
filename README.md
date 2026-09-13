# Cortex

**See where your video ad loses attention, swap in an AI take that scores higher, ship the rest as-is.**

Cortex predicts how a viewer's brain responds to every second of a video ad using Meta's **TRIBE v2**, finds the weakest moment, and replaces it with an AI-generated take — scoring each take on the **same brain-engagement scale** as the original, so you can see whether the fix actually helps.

Built at **HackRice 16** (Finance & Entrepreneurship) with **Gemini**, **ElevenLabs** and **TigerData**. Full spec: [`Cortex_PRD.md`](./Cortex_PRD.md).

---

## How it works

```
Ad video ─► TRIBE v2 (GPU) ─► 6 brain regions per 1.5 s ─► engagement curve
                                                              │
       weakest 5 s ─► ffmpeg cut ─► Gemini (creative direction) ─► ElevenLabs takes
                                                              │
       TRIBE scores each take on the original's scale ─► pick one ─► ffmpeg splice ─► export
```

1. **Predict.** TRIBE v2 predicts activity at 20,484 points on the brain surface, once per second. Cortex groups them into six regions (visual, language, reward/novelty, memory, emotional arousal, attention) and combines them into an engagement score.
2. **Fix.** Pick the suggested lowest-engagement 5 seconds (or drag your own). Gemini watches the clip and writes a do/avoid prompt pair; ElevenLabs produces replacement takes with sound effects.
3. **Prove.** Each take's TRIBE output is re-normalized with the original ad's statistics, so the scores compare directly. Pick the winner, splice it in, view it on the dashboard against the original, and export.

## Features

- **Synced dashboard** — 3D brain lighting by region, live engagement meter, and an engagement line locked to the video playhead (click to seek)
- **Resegment studio** — suggested or custom 5-second moment → staged generation → three scored take cards with "BEST" badge and delta vs original → splice → export
- **Show on dashboard** — the edited ad replaces the original on the main screen, with the original drawn as a dashed overlay and the replaced span shaded
- **Creative memory** — past prompt pairs are embedded and stored in TigerData so similar edits can be recalled
- **Optional login** — sign up / log in; everything works signed out

## Tech stack

| Layer | Tech | Why |
|---|---|---|
| Brain prediction | Meta TRIBE v2 | Predicts brain response to video, audio and speech together |
| GPU inference | Kaggle Notebook, T4 ×2 | TRIBE v2 needs a GPU |
| Region grouping | HCP-MMP atlas | Turns 20,484 surface points into six understandable regions |
| Backend | Python · FastAPI · Pydantic · Uvicorn | The data work (numpy, ffmpeg, Gemini SDK, Postgres) is Python-native; typed requests and auto `/docs` |
| Frontend | React · TypeScript · Vite · Three.js | Brain, meter, chart and video all update from one shared playback time |
| Video | ffmpeg / ffprobe | Frame-accurate cuts, trimming, geometry/audio normalization, splicing |
| Creative direction | Gemini 2.5 Flash | Multimodal: watches the clip and writes a prompt pair |
| Takes | ElevenLabs | Video with matching sound effects |
| Memory + accounts | TigerData (Postgres + pgvector) | Vector search over past edits; users and sessions |

---

## Quick start

**Requirements:** Python 3.11+, Node 18+, ffmpeg on your PATH.

### macOS / Linux

```bash
# Backend
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp .env.example .env            # then fill in keys (see Configuration)
.venv/bin/python -m uvicorn backend.main:app --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

### Windows

```powershell
.\run.ps1
```

Open **http://localhost:5173**. API docs: **http://127.0.0.1:8000/docs**.

### Configuration

Copy `.env.example` to `.env`.

| Variable | Used for |
|---|---|
| `GEMINI_API_KEY` | Creative direction + memory embeddings |
| `ELEVENLABS_API_KEY` | Take generation |
| `TIGERDATA_CONNECTION_STRING` or `TIGER_DATABASE_URL` | Creative memory + login |

Apply the TigerData schema once:

```bash
psql "$TIGER_DATABASE_URL" -f infra/tigerdata_schema.sql
```

---

## TRIBE v2 inference

TRIBE v2 runs on GPU (Kaggle T4 ×2). Setup: [`infra/kaggle_setup.md`](./infra/kaggle_setup.md) — GPU T4 ×2, internet on, `HF_TOKEN` secret, Llama-3.2-3B license accepted, then run `infra/kaggle/tribe_v2_inference.ipynb` on the ad.

Inference produces two files for Cortex, placed in `data/activations/`:

| File | Contents |
|---|---|
| `{video_id}.json` | Six-region windows + raw stats (drives scoring) |
| `{video_id}_preds.npz` | Full (T × 20,484) prediction array |

Then open the same ad in Cortex.

> When running several videos in one Kaggle session, clear `/kaggle/working/cache` between videos — TRIBE caches features by file path.

---

## Project structure

```
backend/
  main.py                     FastAPI app, /api/health, /media
  api/videos.py               video, scoring, Resegment, splice, export routes
  api/auth.py                 optional login routes
  services/
    activation_loader.py      loads and validates TRIBE activation data
    engagement_curve.py       engagement composite, weakest span, same-scale rescoring
    candidate_library.py      take scoring
    ffmpeg_service.py         cut, trim, normalize, splice, export
    gemini_service.py         prompt pair from the clip
    elevenlabs_service.py     take generation
    memory_service.py         TigerData creative memory
    auth_service.py           bcrypt passwords, session tokens
    vertex_field.py           per-vertex field from TRIBE predictions
frontend/src/
  App.tsx                     dashboard state and layout
  components/                 CorticalBrain, VideoPlayer, EngagementMeter, SpikeGraph,
                              ResegmentStudio, AuthModal, UploadPanel
infra/
  kaggle/tribe_v2_inference.ipynb   TRIBE v2 GPU inference
  tigerdata_schema.sql              creative_memory, users, sessions
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/videos` | Videos with TRIBE data |
| POST | `/api/videos/upload-video` | Upload an ad |
| GET | `/api/videos/{id}/curve` | Engagement curve |
| GET | `/api/videos/{id}/regen-options` | Suggested moment + baseline score |
| POST | `/api/videos/{id}/segments/redo` | Prompt pair + scored takes |
| POST | `/api/videos/{id}/segments/{seg}/select` | Splice a take; returns preview + edited ad's data |
| GET | `/api/videos/{id}/export` | Download the edited ad |
| POST | `/api/auth/signup` · `/api/auth/login` · `/api/auth/logout` | Optional login |

Full list: [`Cortex_PRD.md` §8](./Cortex_PRD.md#8-api) or http://127.0.0.1:8000/docs.

---

## Responsible AI

- TRIBE v2 **predicts an average viewer's** brain response; nobody's brain is scanned.
- The engagement score is **our weighting** of six regions; TRIBE has no engagement score of its own.
- Takes are labeled **AI-generated**, and a take without TRIBE data is shown as unscored rather than given a made-up number.
- TRIBE v2 weights are **CC BY-NC-4.0** — non-commercial use only.

## Acknowledgments

- [Meta TRIBE v2](https://github.com/facebookresearch/tribev2)
- [Percept](https://github.com/edrlu/Percept), which inspired using TRIBE v2 as an ad-engagement signal
