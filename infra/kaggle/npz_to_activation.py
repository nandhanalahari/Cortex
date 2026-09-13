"""Turn a downloaded Kaggle `_preds.npz` into a Cortex activation JSON, locally.

Same region aggregation as the notebook (HCP-MMP masks saved in
hcp_region_masks_fsaverage5.npz), so no GPU, tribev2 or atlas download needed.

  python infra/kaggle/npz_to_activation.py PREDS.npz VIDEO.mp4 OUT.json [--video-id ID]
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np

from export_activation import to_windows

MASKS = Path(__file__).with_name("hcp_region_masks_fsaverage5.npz")


def video_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("preds")
    ap.add_argument("video")
    ap.add_argument("out")
    ap.add_argument("--video-id")
    args = ap.parse_args()

    d = np.load(args.preds)
    preds, starts = d["preds"], d["starts"]
    m = np.load(MASKS)
    masks = {k: m[k] for k in m.files}

    video = Path(args.video)
    covered = float(starts[-1] + 1.0)
    duration = video_duration(video)
    if covered + 1.5 < duration:
        # Don't pad the curve past the brain data by repeating the last frame.
        print(f"WARNING: {Path(args.preds).name} covers {covered:.0f}s but {video.name} is "
              f"{duration:.1f}s - is this the right npz? Curve stops at {covered:.0f}s.")
        duration = covered

    windows, duration, raw_stats = to_windows(preds, starts, tr=1.0, masks=masks, duration=duration)
    payload = {
        "video_id": args.video_id or video.stem,
        "duration_sec": duration,
        "windows": windows,
        "raw_stats": raw_stats,
    }
    Path(args.out).write_text(json.dumps(payload, indent=2))
    print(f"Wrote {args.out}: {len(windows)} windows, {duration:.1f}s")


if __name__ == "__main__":
    main()
