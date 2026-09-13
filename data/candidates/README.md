# Pre-generated candidate takes

Our ElevenLabs plan has no video API, so takes are generated on the ElevenLabs
website and dropped here. The Resegment button serves them instead of calling
the API.

```
data/candidates/<video_id>/     # e.g. videoplayback/  (or default/ for any video)
  manifest.json                 # optional, see below
  take_1.mp4                    # the takes; without a manifest they're used in filename order
  take_1.mp3                    # optional sound effect with the same name, muxed onto the take
  take_1.json                   # optional TRIBE v2 activation JSON for the take
```

`manifest.json` (every field optional):

```json
{
  "t_start": 0,
  "t_end": 5,
  "positive_prompt": "the prompt you used on ElevenLabs",
  "negative_prompt": "what you told it to avoid",
  "candidates": [
    { "file": "take_1.mp4", "label": "Warm push-in", "engagement_score": 71 },
    { "file": "take_2.mp4", "label": "Crowd reaction", "audio": "crowd_sfx.mp3" },
    { "file": "take_3.mp4", "label": "Product close-up", "activation": "take_3.json" }
  ]
}
```

Each take's engagement score comes from, in order:

1. `engagement_score` in the manifest (0–1 or 0–100).
2. The take's TRIBE JSON, rescaled with the original video's stats so the two
   numbers compare. The original and each take both need a JSON from the
   updated notebook, which adds `raw_regions` and `raw_stats`. Older exports
   are shown as "re-export … with the new notebook".
3. Neither: the card says why it has no score. Scores are never made up.

If you only downloaded the Kaggle `_preds.npz`, convert it locally (same regions
as the notebook):

```
python infra/kaggle/npz_to_activation.py take_1_preds.npz data/candidates/<video_id>/take_1.mp4 data/candidates/<video_id>/take_1.json
```

The take's JSON is matched by filename (`take_1.json` next to `take_1.mp4`) or
by the `video_id` inside it, so a Kaggle download can be dropped in unrenamed.
Only the first segment-length seconds of a take are scored, because that's
the part that gets spliced in.

`t_start` / `t_end` set the moment the Resegment studio suggests. Leave them out
and it suggests the original's lowest-engagement 5 seconds. Takes should be
about as long as the segment, because the splice drops the whole take into
that range.

Prompts aren't required. Without them, Gemini writes the creative direction
from the clip.
