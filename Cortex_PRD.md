# Cortex — Final Product Requirements Document

**Product:** Cortex — predictive brain-engagement video optimizer
**Event / track:** HackRice 16 · Finance & Entrepreneurship
**Version:** Final (as built)
**Sponsor stack used:** Google Gemini, ElevenLabs, TigerData
**Inspiration:** [Percept](https://github.com/edrlu/Percept), which used Meta's TRIBE v2 as a predicted brain-engagement signal for video ads. Cortex turns that signal into a human-in-the-loop editing workflow on a different stack.

---

## 1. Summary

Cortex shows where a video ad is predicted to lose a viewer's attention, then lets the user replace that moment with an AI-generated take that is scored, on the same brain-engagement scale, against the original.

**One-line pitch:** *See where your ad loses attention, swap in an AI take that scores higher, ship the rest as-is.*

**The loop:** analyze → pick a 5-second moment → generate takes → compare takes by predicted engagement → splice the winner → export.

---

## 2. Problem

Ad teams learn what didn't work only after spend: watch-time and click-through arrive days later and don't say *which second* failed or *what to change*. Re-shooting a whole ad to fix one weak moment is slow and expensive.

Cortex answers two questions before an ad ships:
1. **Where** is engagement predicted to drop? (TRIBE v2 brain-response prediction)
2. **Does a fix actually help?** (every replacement take is scored on the original ad's scale before the user commits to it)

---

## 3. Tech stack

| Layer | Tool | Role in Cortex |
|---|---|---|
| Brain-response prediction | **Meta TRIBE v2** (LLaMA-3.2-3B + V-JEPA2 + Wav2Vec-BERT encoders) | Predicts cortical activity for 20,484 brain-surface points (fsaverage5), once per second, from the ad's video, audio and speech |
| GPU inference | **Kaggle Notebook, GPU T4 ×2** | Runs TRIBE v2 for each video |
| Region grouping | **HCP-MMP (Glasser) atlas** | Groups the 20,484 points into six named regions |
| Backend | **Python · FastAPI · Pydantic v2 · Uvicorn** | Scoring, video pipeline, API, auth |
| Frontend | **React 18 · TypeScript · Vite · Three.js** | 3D brain, video player, engagement chart, Resegment studio |
| Video processing | **ffmpeg / ffprobe** | Cut segments, trim takes, normalize geometry/audio, splice, export |
| Creative direction | **Gemini** (`gemini-2.5-flash`, multimodal) | Watches the chosen 5-second clip and writes a positive/negative prompt pair |
| Take generation | **ElevenLabs** (video + sound effects) | Produces candidate replacement takes, seeded from a frame of the original moment |
| Memory + accounts | **TigerData** (Postgres + pgvector) with Gemini embeddings (`text-embedding-004`) | Stores past creative directions for similarity recall; stores users and sessions |

**Changed from the plan:** GPU inference moved from Vultr to Kaggle T4 ×2.

---

## 4. Features — final status

### Core

| ID | Feature | Status | Notes |
|---|---|---|---|
| C1 | Analyze an ad | ✅ | The ad is paired with its TRIBE v2 activation data |
| C2 | TRIBE v2 inference → time-windowed six-region activation | ✅ | GPU notebook `infra/kaggle/tribe_v2_inference.ipynb` |
| C3 | Brain + chart synced to playback | ✅ | 3D brain lights by region, live engagement meter, single engagement line with playhead; click the chart to seek |
| C4 | Choose the moment to fix | ✅ | "Suggested moment" (lowest-engagement 5 s) or "Pick my own 5 seconds" (drag a fixed 5 s window) |
| C5 | Gemini writes creative direction | ✅ | Positive + negative prompt pair from the clip |
| C6 | ElevenLabs candidate takes | ✅ | Replacement takes with sound effects |
| C7 | Compare and choose a take | ✅ | Three cards: take video, TRIBE engagement score, delta vs original, "BEST" badge, AI-generated label |
| C8 | Splice back into the full ad | ✅ | Take trimmed to the 5 s window; resolution, frame rate and audio normalized before concatenation |
| C9 | Export | ✅ | Download the edited ad |

### Added during the build

| Feature | Why |
|---|---|
| **Same-scale take scoring** | TRIBE normalizes each video on its own, so raw scores can't be compared across videos. Activation data includes raw region means and stats; each take is re-normalized on the original ad's scale so "+18" is a real difference |
| **Show on dashboard** | After splicing, the main dashboard switches to the edited ad: video, brain, meter and chart all use the edited ad's data (original windows, with the replaced 5 s taken from the take's own TRIBE output) |
| **Single-line engagement chart with original overlay** | Six region lines were unreadable; one engagement line plus a dashed original line and a shaded replaced span shows the lift directly |
| **Optional login** | Sign up / log in / log out; the app is fully usable signed out |
| **TigerData creative memory** | Prompt pairs are embedded and stored; similar past edits are looked up in parallel with generation so repeated edits aren't blind |

---

## 5. User flow

```
1. TRIBE v2 runs on GPU and predicts the ad's brain response, second by second.
2. Open the ad in Cortex. Video plays at 0.5x; the brain, engagement meter and
   engagement line follow the playhead. Click the chart to jump to any moment.
3. Click Resegment.
   a. Setup: accept the suggested (weakest) 5 seconds, or drag your own window.
   b. Generating: staged progress (cut → Gemini reads frames → creative direction
      → ElevenLabs takes → TRIBE scoring).
   c. Choose: three AI takes with TRIBE engagement scores vs the original.
   d. Done: the take is spliced in; preview the full edited ad.
4. Show on dashboard: the edited ad and its engagement data replace the
   original on the main screen, with the original as a dashed overlay.
5. Export the edited ad.
```

---

## 6. System architecture

```
          GPU inference (Kaggle T4 x2)
 ┌──────────────────────────────────────────┐
 │ Ad → TRIBE v2 → (T × 20,484) predictions  │
 │ HCP-MMP atlas → 6 regions per 1.5 s window │──── activation data ────┐
 │ + raw region means + raw stats             │                         │
 └──────────────────────────────────────────┘                         ▼
                                                   ┌───────────────── FastAPI ─────────────────┐
 React + Three.js (Vite)  ◄────── JSON ─────────► │ activation_loader → engagement_curve       │
  • 3D brain  • video  • meter                    │ candidate_library (take scoring)            │
  • engagement line  • Resegment studio           │ ffmpeg_service (cut / trim / splice / export)│
  • login window                                  │ gemini_service (prompt pair)                │
                                                  │ elevenlabs_service (takes)                  │
                                                  │ memory_service ─┐   auth ─┐                 │
                                                  └─────────────────┼─────────┼─────────────────┘
                                                                    ▼         ▼
                                                           TigerData (Postgres + pgvector)
```

---

## 7. Scoring design

**Regions.** TRIBE outputs activity per brain-surface point, not labeled regions. Cortex groups HCP-MMP parcels into six regions: visual, language, reward/novelty, memory/familiarity, emotional arousal, attention/salience. Each region's series is z-scored within the video, averaged over 1.5-second windows and passed through a sigmoid (0–1).

**Engagement.** Cortex's own weighted composite — TRIBE has no built-in engagement score:

| Region | Weight |
|---|---|
| Reward / novelty | 0.22 |
| Emotional arousal | 0.22 |
| Attention / salience | 0.22 |
| Visual | 0.12 |
| Language | 0.12 |
| Memory / familiarity | 0.10 |

- **Dashboard curve:** the composite per window (live meter and engagement line).
- **Suggested moment:** the 5-second span with the lowest average composite.
- **Take score:** mean composite of the take's first 5 seconds (the part that is spliced), after re-normalizing the take's raw region means with the **original ad's** per-region mean and standard deviation. The original segment's score uses the same composite, so the two numbers compare directly.

**Why same-scale scoring matters.** Without it, every video averages ~0.5 regardless of quality. On the demo ad: original 0–5 s = 43; takes = 61, 59, 38.

---

## 8. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status and which services are configured |
| GET | `/api/videos` | Videos with TRIBE activation data |
| POST | `/api/videos/upload-video` | Upload an ad; paired with its activation data |
| POST | `/api/videos/upload-activation` | Ingest TRIBE activation JSON |
| POST | `/api/videos/upload-preds` | Ingest TRIBE `_preds.npz` |
| POST | `/api/videos/{id}/load-activation` | Activation windows with per-window engagement |
| GET | `/api/videos/{id}/curve` | Engagement curve with peak and drop-off markers |
| GET | `/api/videos/{id}/verts` | Per-vertex field |
| GET | `/api/videos/{id}/source` | The original ad |
| GET | `/api/videos/{id}/regen-options` | Suggested moment, baseline score, number of takes |
| POST | `/api/videos/{id}/segments/redo` | `{t_start?, t_end?}` → prompt pair, scored candidates, baseline, similar past edits |
| POST | `/api/videos/{id}/segments/{seg}/select` | `{candidate_id}` → spliced preview URL + edited ad's activation windows |
| GET | `/api/videos/{id}/export` | Download the edited ad |
| GET | `/media/{filename}` | Takes and spliced results |
| POST | `/api/auth/signup` · `/api/auth/login` | Returns a session token |
| GET | `/api/auth/me` | Current user (401 when signed out) |
| POST | `/api/auth/logout` | Ends the session |

---

## 9. Data model

```
Activation data (one per video, from TRIBE v2 inference)
  video_id, duration_sec,
  windows[]: { t_start, t_end,
               regions:     { visual, language, reward_novelty,
                              memory_familiarity, emotional_arousal, attention_salience },  // 0–1
               raw_regions: { same keys, un-normalized means } },
  raw_stats: { region: { mean, std } }        // what `regions` was normalized with

TigerData
  creative_memory { segment_id, video_id, embedding vector(768), embed_model,
                    positive_prompt, negative_prompt, selected_candidate_id,
                    engagement_score, user_id, created_at }
  users           { id, email, password_hash (bcrypt), created_at }
  sessions        { token, user_id, expires_at }            // 7-day default

In-process (per session)
  segment records: candidates per segment, latest spliced/exported file per video
```

---

## 10. Responsible AI

- **Prediction, not measurement.** TRIBE v2 predicts an average viewer's brain response. No one's brain is scanned, and no individual or demographic claim is made.
- **Engagement is Cortex's construction.** The six-region weighting above is ours; TRIBE outputs only activity predictions.
- **AI-generated content is labeled** on every take card and on the dashboard when a take is shown.
- **No invented scores.** A take without usable TRIBE data is shown as unscored, with the reason.
- **Region explanations (not built).** If added, each line must separate what TRIBE predicted (region, strength), what Gemini observed on screen or in audio, and a fixed textbook description of the region's function — phrased as a likely link, not a cause.
- **License.** TRIBE v2 weights are CC BY-NC-4.0: non-commercial prototype only.

---

## 11. Known limitations

- TRIBE inference covers the first 15 seconds of an ad.
- Segment records and spliced results live in memory; restarting the backend clears in-progress edits.
- The Resegment window is a fixed 5 seconds.
- Creative memory needs several stored edits before similarity recall is meaningful.

---

## 12. Future work

- Gemini region explanations per timestamp, linked to the chart (§10 wording rules)
- Variable-length segments and multiple edits per ad
- Validation against real ad metrics (watch time, click-through, conversion)
- Demographic-aware critique and a consent gateway for videos with recognizable people

---

## 13. Out of scope

- Static image/poster analysis (video only)
- Production-grade biometric consent compliance
- Commercial use of TRIBE v2
