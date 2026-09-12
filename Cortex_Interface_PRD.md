# Product Requirements Document
## Cortex — Interface & Pipeline (Post-TRIBE Track)

**Version:** 1.0
**Scope owner:** You (interface/pipeline half of the team)
**Companion doc:** `Cortex_PRD_v3.md` (full product spec) — this document is a focused subset of it, scoped to exactly your half of the build, written so both halves merge without friction.
**Assumption:** TRIBE v2 inference (Kaggle notebook, model loading, GPU wrangling) is owned by your teammate and is **out of scope here**. This document starts from the moment TRIBE v2's output already exists as data.

---

## 1. Scope Boundary (read this first)

**Not your job (teammate's side, already working):**
- Running TRIBE v2 on Kaggle
- Loading LLaMA 3.2-3B / V-JEPA2 / Wav2Vec-BERT
- Producing the raw per-window cortical activation values

**Your job (everything this document covers):**
- Defining and enforcing the exact data handoff format so their Kaggle output plugs directly into your app with zero manual reformatting
- Building the composite engagement curve from their raw output
- Building the glowing timeline UI synced to video playback
- Building segment selection
- Gemini integration (segment analysis → positive/negative prompt pair)
- ElevenLabs integration (prompt pair → 2-3 candidate video segments)
- Candidate preview, selection, splice-back, export

---

## 2. Data Handoff Contract (the seam between the two halves)

This is the single most important section — get this right and the two halves of the team never block each other.

**Ask your teammate to export, per demo video, one JSON file shaped exactly like this** (this matches the schema in the full PRD, Section 7, so nothing downstream needs to change if they follow it):

```json
{
  "video_id": "demo_1",
  "duration_sec": 15.0,
  "windows": [
    {
      "t_start": 0.0,
      "t_end": 1.5,
      "regions": {
        "visual": 0.62,
        "language": 0.31,
        "reward_novelty": 0.44,
        "memory_familiarity": 0.20,
        "emotional_arousal": 0.55,
        "attention_salience": 0.58
      }
    }
  ]
}
```

Practical notes for the handoff:
- TRIBE v2's raw `preds` output is `(n_timesteps, n_vertices)` — ~20k raw cortical vertices, not six clean labeled regions. Someone (either side, but cleanest if your teammate does it right after `model.predict()` while they still have the raw array in memory) needs to **bucket the ~20k vertices into the six macro-regions** above using an ROI/atlas mapping (TRIBE's own repo includes ROI analysis utilities — check `utils_fmri.py` in `facebookresearch/tribev2` for existing region-grouping helpers rather than building this from scratch).
- One JSON file per demo video, named predictably (`demo_1.json`, `demo_2.json`, etc.), dropped in a shared folder both of you can access (a shared Drive folder, or committed to the repo under `/data/precomputed/` if the files are small).
- You do not need to know or care how their Kaggle notebook works internally — you only need this file to show up in the agreed format. If the shape ever changes, that's a conversation to have explicitly, not something to discover from a crash.

**Your side's responsibility starts here:** treat this JSON as your only input. Do not write any code that imports `tribev2`, calls Hugging Face, or touches GPU inference — if you find yourself doing that, you've drifted into your teammate's half.

---

## 3. Your Core Feature List

- **F1: Load precomputed activation JSON** for a selected demo video
- **F2: Composite engagement curve builder** — derive response strength / peak / drop-off per window from the raw six-region data (this is your own scoring construction on top of their raw output, same as Percept built theirs)
- **F3: Video player + synced glowing timeline** — the main visual, timestamp-synced to playback
- **F4: Manual segment selection** — user drag-selects a time range on the timeline
- **F5: Segment extraction** (ffmpeg) — pull out the selected video+audio range
- **F6: Gemini integration** — send the segment to Gemini (multimodal), receive `{positive_prompt, negative_prompt}`
- **F7: ElevenLabs integration** — send the prompt pair (+ seed frame for continuity) to ElevenLabs video generation, receive 2-3 candidate segments
- **F8: Candidate preview UI** — play each candidate spliced against the surrounding original footage
- **F9: Selection + splice-back** (ffmpeg) — replace the original range with the chosen candidate in the full video
- **F10: Export/download** the final edited video

---

## 4. User Flow (your half only)

```
1. [Input] Precomputed activation JSON for a video already exists
   (from teammate's Kaggle run) and is placed where your app expects it.
2. [Your app] Loads the JSON, builds the composite engagement curve.
3. [Your app] Video plays with the glow/graph synced beneath it.
4. [User] Drag-selects a time range to redo.
5. [Your app] Extracts that segment (ffmpeg).
6. [Your app] Sends segment to Gemini -> gets positive_prompt, negative_prompt.
7. [Your app] Sends prompt pair to ElevenLabs -> gets 2-3 candidate segments.
8. [User] Previews and picks a favorite.
9. [Your app] Splices chosen candidate into the full video (ffmpeg).
10. [User] Exports the final video.
```

---

## 5. Architecture (your half)

```
        [Precomputed Activation JSON]  <-- handoff point, Section 2
                       |
                       v
        +-----------------------------------+
        |  Engagement Curve Builder           |
        |  response_strength / peak / drop-off|
        +-----------------------------------+
                       |
                       v
        [Frontend: video player + glowing timeline synced to playback]
                       |
              (user drag-selects a range)
                       v
        +-----------------------------------+
        |  ffmpeg: extract segment            |
        +-----------------------------------+
                       |
                       v
        +-----------------------------------+
        |  Gemini API (multimodal)            |
        |  -> positive_prompt, negative_prompt|
        +-----------------------------------+
                       |
                       v
        +-----------------------------------+
        |  ElevenLabs video generation         |
        |  (image-to-video seeded from a       |
        |   frame of the original segment)     |
        |  -> 2-3 candidate segments            |
        +-----------------------------------+
                       |
                       v
        [Frontend: candidate preview + selection]
                       |
              (user picks favorite)
                       v
        +-----------------------------------+
        |  ffmpeg: splice into full video     |
        +-----------------------------------+
                       |
                       v
              [Frontend: export final video]
```

---

## 6. API Contracts (your side implements these)

### `POST /api/videos/{video_id}/load-activation`
Loads the precomputed JSON from Section 2's handoff location.
**Response:** the same shape as the handoff JSON, echoed back with a derived `engagement_score` added per window:
```json
{
  "video_id": "demo_1",
  "duration_sec": 15.0,
  "windows": [
    { "t_start": 0.0, "t_end": 1.5, "regions": { ... }, "engagement_score": 0.51 }
  ]
}
```

### `POST /api/videos/{video_id}/segments/redo`
**Request:** `{ "t_start": 4.0, "t_end": 7.0 }`
**Response:**
```json
{
  "segment_id": "seg_45",
  "positive_prompt": "...",
  "negative_prompt": "...",
  "candidates": [
    { "candidate_id": "cand_1", "preview_url": "..." },
    { "candidate_id": "cand_2", "preview_url": "..." },
    { "candidate_id": "cand_3", "preview_url": "..." }
  ]
}
```

### `POST /api/videos/{video_id}/segments/{segment_id}/select`
**Request:** `{ "candidate_id": "cand_2" }`
**Response:** `{ "video_id": "demo_1", "status": "spliced", "preview_url": "..." }`

### `GET /api/videos/{video_id}/export`
Returns the final video file / signed download URL.

*(These match Section 6 of the full PRD, minus the TRIBE-inference-triggering endpoint, since inference isn't your responsibility — you only ever load already-computed results.)*

---

## 7. Suggested Repo Structure (your half)

```
/cortex-interface
  /frontend
    /components
      VideoPlayer.tsx
      EngagementTimeline.tsx      <- glow/graph synced to playback
      SegmentSelector.tsx         <- drag-select
      CandidatePreview.tsx        <- 2-3 candidate playback + select
      ExportButton.tsx
    /pages
      AnalysisPage.tsx
      RedoPage.tsx
      ExportPage.tsx
  /backend
    /services
      activation_loader.py        <- reads the handoff JSON, no model code
      engagement_curve.py         <- builds composite score
      gemini_service.py
      elevenlabs_service.py
      ffmpeg_service.py
    /api
      videos.py
    main.py
  /data
    /precomputed                  <- handoff JSON files land here
  .env.example
```

---

## 8. Environment Variables (your half only)

```
ACTIVATION_DATA_PATH=./data/precomputed   # where teammate's exported JSON files live
GEMINI_API_KEY=
ELEVENLABS_API_KEY=
```

No TRIBE/Kaggle/Hugging Face variables belong here — those live entirely on your teammate's side.

---

## 9. Build Order (your half)

**First session**
- Get one real handoff JSON from your teammate (even a small hand-crafted sample matching Section 2's schema is fine to start against before their real export is ready).
- Scaffold the repo (Section 7).
- Build `activation_loader.py` + `engagement_curve.py` against that sample JSON.

**Next**
- Build the video player + `EngagementTimeline.tsx`, synced to playback using the curve data.
- Build `SegmentSelector.tsx` (drag-select on the timeline).

**Then**
- Wire up `gemini_service.py`: send an extracted segment, confirm you get back a usable `{positive_prompt, negative_prompt}`.
- Wire up `elevenlabs_service.py`: send the prompt pair + seed frame, confirm candidates come back.
- Budget-check ElevenLabs' video-seconds allowance before iterating on this repeatedly.

**Finally**
- Build `CandidatePreview.tsx` and the splice-back/export flow.
- Swap the hand-crafted sample JSON for your teammate's real exported file and run the full flow end-to-end.
- Build an offline/cached fallback (a known-good full run saved) in case live API calls fail during the actual demo.

---

## 10. Non-Functional Requirements & Honesty Contract (carried over)

- The composite engagement curve is your own scoring construction on top of the raw six-region data — TRIBE v2 itself has no built-in single "engagement" score.
- The glowing timeline during normal playback is a **replay of the precomputed data**, not live inference — nothing on your side should imply otherwise.
- ElevenLabs-generated segments are AI-generated video, not the original footage — worth a visible label in the UI when previewing candidates.
- Segment redo requests (Gemini + ElevenLabs round trip) realistically take 10-30 seconds — show a real loading state, don't fake instant results.
- Build a fully offline/cached fallback path for your locked demo videos in case venue wifi drops API access mid-demo.

---

## 11. Out of Scope (this document)

- TRIBE v2 inference, Kaggle notebook management, LLaMA/V-JEPA2/Wav2Vec setup — entirely your teammate's side
- Demographic-aware critique, Consent Gateway, TigerData, personas — deferred per the full PRD (Section 3/14 of `Cortex_PRD_v3.md`)
- Any change to the handoff schema in Section 2 without explicitly syncing with your teammate first
