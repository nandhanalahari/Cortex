# Candidate takes

Resegment takes for a video are stored per video:

```
data/candidates/<video_id>/     # or default/ for any video
  manifest.json                 # optional, see below
  take_1.mp4                    # a take; without a manifest, takes are used in filename order
  take_1.mp3                    # optional sound effect with the same name, muxed onto the take
  take_1.json                   # the take's TRIBE v2 activation data
```

`manifest.json` (every field optional):

```json
{
  "t_start": 0,
  "t_end": 5,
  "positive_prompt": "creative direction for the takes",
  "negative_prompt": "what the takes avoid",
  "candidates": [
    { "file": "take_1.mp4", "label": "Warm push-in" },
    { "file": "take_2.mp4", "label": "Crowd reaction", "audio": "crowd_sfx.mp3" },
    { "file": "take_3.mp4", "label": "Product close-up", "activation": "take_3.json" }
  ]
}
```

Each take's engagement score comes from its TRIBE v2 activation data, re-normalized
with the original video's stats (`raw_regions` / `raw_stats`) so the take and the
original compare on the same scale. A take without usable activation data is shown
as unscored, with the reason. Scores are never made up.

A take's activation file is matched by filename (`take_1.json` next to `take_1.mp4`)
or by the `video_id` inside it. Only the first segment-length seconds of a take are
scored, because that's the part that gets spliced in; longer takes are trimmed.

`t_start` / `t_end` set the moment the Resegment studio suggests. Without them it
suggests the original's lowest-engagement 5 seconds.
