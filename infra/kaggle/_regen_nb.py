#!/usr/bin/env python3
"""Regenerate tribe_v2_inference.ipynb with upload widget."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# when run from repo: infra/kaggle/
OUT = Path("/Users/nandhanalahari/Cortex/infra/kaggle/tribe_v2_inference.ipynb")

RUNNER_TEMPLATE = r'''
import json, sys
from pathlib import Path
import numpy as np
import torch

sys.path.insert(0, "/kaggle/working/TRIBEv2")
from tribev2 import TribeModel

VIDEO_PATH = Path(__VIDEO_PATH__)
VIDEO_ID = __VIDEO_ID__
OUT_DIR = Path(__OUT_DIR__)
CACHE = "/kaggle/working/cache"
MAX_SEC = __MAX_SEC__

REGION_PARCELS = {
    "visual": ["V1","V2","V3","V4","V3A","V3B","V6","V6A","MT","MST","LO1","LO2","LO3","V4t","FST"],
    "language": ["44","45","IFSa","STSdp","STSvp","STGa","TE1a","A5","PSL","SFL","55b"],
    "reward_novelty": ["10r","10v","10d","10pp","p32","s32","a24","d32","25","OFC","pOFC","11l","13l","9m"],
    "memory_familiarity": ["7m","POS2","v23ab","d23ab","31pv","31pd","RSC","PCV","PHA1","PHA2","PHA3","PreS","EC"],
    "emotional_arousal": ["A1","LBelt","MBelt","PBelt","A4","A5","STSdp","STSvp","STSda","STSva","TE1p","TE2p","PI","Ig","52"],
    "attention_salience": ["FEF","LIPv","LIPd","VIP","MIP","AIP","IP0","IP1","IP2","TPOJ1","TPOJ2","PGi","PGs","PFm","IFJa","IFJp","p9-46v","a9-46v","9-46d","46","8C","i6-8","s6-8"],
}

def safe_z(x):
    return (x - float(np.mean(x))) / (float(np.std(x)) + 1e-6)

def sigmoid(x):
    return float(1.0 / (1.0 + np.exp(-x)))

print("Loading TribeModel…")
model = TribeModel.from_pretrained("facebook/tribev2", cache_folder=CACHE, device="cuda")
model.remove_empty_segments = True

print("Events…")
events = model.get_events_dataframe(video_path=str(VIDEO_PATH))
print("Predict…")
preds, segments = model.predict(events=events, verbose=True)
preds = np.asarray(preds)
print("preds", preds.shape)

starts = [float(getattr(s, "start", i)) for i, s in enumerate(segments)]
tr = float(getattr(model.data, "TR", 1.0))

try:
    from tribev2.utils import get_hcp_labels, get_hcp_roi_indices
    valid = set(get_hcp_labels(mesh="fsaverage5", combine=False, hemi="both").keys())
    masks = {}
    for region, parcels in REGION_PARCELS.items():
        missing = [p for p in parcels if p not in valid]
        if missing:
            print(f"[roi] {region}: dropped unknown parcels {missing}")
        idxs = [get_hcp_roi_indices(p, hemi="both", mesh="fsaverage5") for p in parcels if p in valid]
        masks[region] = np.unique(np.concatenate(idxs))
    print("ROI grouping: HCP-MMP via tribev2.utils")
except Exception as e:
    import os
    if os.environ.get("CORTEX_ALLOW_BAND_FALLBACK") != "1":
        raise RuntimeError(
            "HCP-MMP atlas unavailable, so the six region names would not be anatomical. "
            "Fix the mne atlas download, or set CORTEX_ALLOW_BAND_FALLBACK=1 for placeholders."
        ) from e
    print("WARNING: band fallback — region names are NOT anatomical:", e)
    masks = None

keys = list(REGION_PARCELS.keys())
series = {}
if masks is None:
    band = max(preds.shape[1] // 6, 1)
    for i, k in enumerate(keys):
        a, b = i * band, (preds.shape[1] if i == 5 else (i + 1) * band)
        series[k] = preds[:, a:b].mean(axis=1)
else:
    for k in keys:
        series[k] = preds[:, masks[k]].mean(axis=1)

global_curve = (series["attention_salience"] + series["reward_novelty"] + series["emotional_arousal"]) / 3.0
z_regions = {k: safe_z(v) for k, v in series.items()}
z_global = safe_z(global_curve)

try:
    from moviepy import VideoFileClip
    with VideoFileClip(str(VIDEO_PATH)) as clip:
        duration = float(clip.duration)
except Exception:
    duration = float(starts[-1] + tr) if starts else float(MAX_SEC)

starts_arr = np.asarray(starts, dtype=np.float64)
windows = []
t0 = 0.0
window_sec = 1.5
while t0 < duration - 1e-6 and len(starts_arr):
    t1 = min(t0 + window_sec, duration)
    m = (starts_arr >= t0) & (starts_arr < t1)
    if not np.any(m):
        idx = int(np.argmin(np.abs(starts_arr - t0)))
        m = np.zeros(len(starts_arr), dtype=bool); m[idx] = True
    idxs = np.where(m)[0]
    windows.append({
        "t_start": float(t0),
        "t_end": float(t1),
        "regions": {k: sigmoid(float(np.mean(z_regions[k][idxs]))) for k in z_regions},
        # Un-normalized region means: lets Cortex score another clip (an AI
        # take) on the scale of this video instead of on the clip by itself.
        "raw_regions": {k: float(np.mean(series[k][idxs])) for k in series},
    })
    t0 = t1

# PM handoff schema, plus the raw stats that `regions` was normalized with
payload = {
    "video_id": VIDEO_ID,
    "duration_sec": float(duration),
    "windows": windows,
    "raw_stats": {k: {"mean": float(np.mean(v)), "std": float(np.std(v))} for k, v in series.items()},
}
np.savez_compressed(OUT_DIR / f"{VIDEO_ID}_preds.npz", preds=preds.astype(np.float32), starts=starts_arr.astype(np.float32))
json_path = OUT_DIR / f"{VIDEO_ID}.json"
json_path.write_text(json.dumps(payload, indent=2))
print("SUCCESS", json_path)
for w in windows[:8]:
    r = w["regions"]
    print(
        f"  [{w['t_start']:.1f}-{w['t_end']:.1f}] "
        f"vis={r['visual']:.3f} attn={r['attention_salience']:.3f}"
    )
'''


def src_lines(text: str):
    lines = text.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    return lines


def code(text: str):
    return {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": src_lines(text),
    }


def md(text: str):
    return {"cell_type": "markdown", "metadata": {}, "source": src_lines(text)}


# Cell 4 builds runner by embedding template with replacements — store template on disk in cell via write of escaped string
cell4 = r'''# ===== Cell 4: save chosen video + write TRIBE runner =====
from pathlib import Path
import subprocess

assert "source_widget" in dir() and "upload_widget" in dir(), "Run Cell 3 first (upload widgets)."

MAX_SEC = globals().get("MAX_SEC", 15)
VIDEO_DIR = Path("/kaggle/working/videos")
VIDEO_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR = Path("/kaggle/working/activations")
OUT_DIR.mkdir(parents=True, exist_ok=True)
RUNNER = Path("/kaggle/working/run_tribe_cortex.py")
RAW_PATH = VIDEO_DIR / "source_upload.mp4"
VIDEO_PATH = VIDEO_DIR / "vid_for_tribe.mp4"
mode = source_widget.value

def _upload_bytes_and_name(w):
    val = w.value
    if not val:
        return None, None
    if isinstance(val, dict):  # ipywidgets v7
        name = next(iter(val.keys()))
        content = val[name]["content"]
        if hasattr(content, "tobytes"):
            content = content.tobytes()
        return name, bytes(content)
    f = val[0]  # v8
    name = getattr(f, "name", None) or (f.get("name") if isinstance(f, dict) else None)
    content = getattr(f, "content", None)
    if content is None and isinstance(f, dict):
        content = f["content"]
    if hasattr(content, "tobytes"):
        content = content.tobytes()
    return name, bytes(content)

def make_test_video(out: Path, seconds: int = 15) -> None:
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=size=640x360:rate=30:duration={seconds}",
        "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=44100:duration={seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", "-movflags", "+faststart",
        str(out),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:])
        raise RuntimeError("ffmpeg testsrc failed")

def trim_to(src: Path, dst: Path, seconds: int) -> None:
    r = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-t", str(seconds),
         "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", str(dst)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(r.stderr[-2000:])
        raise RuntimeError("ffmpeg trim failed")

if mode == "upload":
    name, content = _upload_bytes_and_name(upload_widget)
    if not content:
        raise RuntimeError(
            "No file uploaded yet. In Cell 3 click Upload video, wait for the filename, then re-run THIS cell."
        )
    RAW_PATH.write_bytes(content)
    VIDEO_ID = Path(name).stem.replace(" ", "_")[:64] or "vid_upload"
    print(f"Saved upload: {name} ({len(content)/1e6:.2f} MB)")
    trim_to(RAW_PATH, VIDEO_PATH, MAX_SEC)

elif mode == "input":
    candidates = list(Path("/kaggle/input").rglob("*.mp4")) if Path("/kaggle/input").exists() else []
    if not candidates:
        raise RuntimeError("No .mp4 under /kaggle/input. Use Upload, or Add Input on Kaggle.")
    RAW_PATH = candidates[0]
    VIDEO_ID = RAW_PATH.stem.replace(" ", "_")[:64]
    print("Using attached:", RAW_PATH)
    trim_to(RAW_PATH, VIDEO_PATH, MAX_SEC)

else:
    VIDEO_ID = "vid_test_15s"
    print(f"Generating {MAX_SEC}s test video…")
    make_test_video(VIDEO_PATH, MAX_SEC)

print("VIDEO_ID", VIDEO_ID)
print("VIDEO_PATH", VIDEO_PATH, "mb", round(VIDEO_PATH.stat().st_size / 1e6, 2))

# Load runner template written next to this notebook flow
template_path = Path("/kaggle/working/_runner_template.py")
if not template_path.exists():
    raise RuntimeError("Missing runner template — re-run Cell 2 (it writes the template).")
text = template_path.read_text()
text = (
    text.replace("__VIDEO_PATH__", repr(str(VIDEO_PATH)))
    .replace("__VIDEO_ID__", repr(VIDEO_ID))
    .replace("__OUT_DIR__", repr(str(OUT_DIR)))
    .replace("__MAX_SEC__", str(MAX_SEC))
)
RUNNER.write_text(text)
print("Wrote runner", RUNNER)
'''

cell2 = r'''# ===== Cell 2: install TRIBE (keep Kaggle torch/numpy) =====
import sys
import subprocess
from pathlib import Path

import torch

print("torch", torch.__version__, "cuda", torch.cuda.is_available(), "gpus", torch.cuda.device_count())
assert torch.cuda.is_available(), "Enable GPU T4 x2"

REPO = "/kaggle/working/TRIBEv2"
subprocess.run(["rm", "-rf", REPO], check=False)
subprocess.check_call([
    "git", "clone", "--depth", "1",
    "https://github.com/facebookresearch/TRIBEv2.git", REPO,
])
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "--no-deps", "-e", REPO])
subprocess.check_call([
    sys.executable, "-m", "pip", "install", "-q",
    "neuralset==0.0.2", "neuraltrain==0.0.2", "exca==0.5.20",
    "x_transformers==1.27.20", "einops", "pyyaml", "moviepy>=2.2.1",
    "huggingface_hub", "gtts", "langdetect", "spacy", "soundfile",
    "Levenshtein", "julius", "transformers", "tqdm", "pandas",
    "pydantic", "requests", "mne", "ipywidgets",
])
subprocess.check_call([sys.executable, "-m", "spacy", "download", "en_core_web_sm"])

# Runner template for Cell 4
Path("/kaggle/working/_runner_template.py").write_text(Path("/kaggle/working/_runner_template.py").read_text() if False else """PLACEHOLDER""")

subprocess.check_call([
    sys.executable, "-c",
    "import sys; sys.path.insert(0, '/kaggle/working/TRIBEv2'); "
    "import numpy, torch; from tribev2 import TribeModel; "
    "print('VERIFY OK', numpy.__version__, torch.__version__, TribeModel)",
])
print("Install + verify OK — continue to Cell 3 to upload a video")
'''

# Fix cell2 properly - write template in cell2 without the False hack
cell2 = '''# ===== Cell 2: install TRIBE (keep Kaggle torch/numpy) =====
import sys
import subprocess
from pathlib import Path

import torch

print("torch", torch.__version__, "cuda", torch.cuda.is_available(), "gpus", torch.cuda.device_count())
assert torch.cuda.is_available(), "Enable GPU T4 x2"

REPO = "/kaggle/working/TRIBEv2"
subprocess.run(["rm", "-rf", REPO], check=False)
subprocess.check_call([
    "git", "clone", "--depth", "1",
    "https://github.com/facebookresearch/TRIBEv2.git", REPO,
])
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "--no-deps", "-e", REPO])
subprocess.check_call([
    sys.executable, "-m", "pip", "install", "-q",
    "neuralset==0.0.2", "neuraltrain==0.0.2", "exca==0.5.20",
    "x_transformers==1.27.20", "einops", "pyyaml", "moviepy>=2.2.1",
    "huggingface_hub", "gtts", "langdetect", "spacy", "soundfile",
    "Levenshtein", "julius", "transformers", "tqdm", "pandas",
    "pydantic", "requests", "mne", "ipywidgets",
])
subprocess.check_call([sys.executable, "-m", "spacy", "download", "en_core_web_sm"])

# Write inference runner template (filled in Cell 4)
Path("/kaggle/working/_runner_template.py").write_text(%s)

subprocess.check_call([
    sys.executable, "-c",
    "import sys; sys.path.insert(0, '/kaggle/working/TRIBEv2'); "
    "import numpy, torch; from tribev2 import TribeModel; "
    "print('VERIFY OK', numpy.__version__, torch.__version__, TribeModel)",
])
print("Install + verify OK — continue to Cell 3 to upload a video")
''' % repr(RUNNER_TEMPLATE)

cell3 = '''# ===== Cell 3: UPLOAD YOUR VIDEO =====
# 1) Pick a source  2) If uploading, click the button and wait for the filename  3) Run Cell 4
from pathlib import Path

from IPython.display import display, HTML
from ipywidgets import FileUpload, RadioButtons, VBox

VIDEO_DIR = Path("/kaggle/working/videos")
VIDEO_DIR.mkdir(parents=True, exist_ok=True)
MAX_SEC = 15  # seconds to keep for first TRIBE run

upload_widget = FileUpload(
    accept=".mp4,.mov,.webm,.avi,.mkv",
    multiple=False,
    description="Upload video",
)
source_widget = RadioButtons(
    options=[
        ("Upload a video with the button below", "upload"),
        ("Use a video already in /kaggle/input (Add Input on Kaggle)", "input"),
        ("No video — generate a 15s test clip", "test"),
    ],
    value="upload",
    description="Source:",
    layout={"width": "max-content"},
)

display(HTML(
    "<h3>Video for TRIBE</h3>"
    "<ol>"
    "<li>Choose a <b>Source</b></li>"
    "<li>If uploading: click <b>Upload video</b> and pick your file</li>"
    "<li>When the filename appears, run <b>Cell 4</b></li>"
    "</ol>"
))
display(VBox([source_widget, upload_widget]))
print("→ Upload (or pick input/test), then run Cell 4.")
'''

cell5 = '''# ===== Cell 5: RUN TRIBE inference =====
import os
import subprocess
import sys
from pathlib import Path

env = os.environ.copy()
env["HF_HUB_ENABLE_HF_TRANSFER"] = "0"
env["TOKENIZERS_PARALLELISM"] = "false"

assert "VIDEO_ID" in dir(), "Run Cell 4 first"

print("Starting inference (first run downloads weights — slow)…")
proc = subprocess.run(
    [sys.executable, "/kaggle/working/run_tribe_cortex.py"],
    env=env,
    text=True,
)
print("exit code", proc.returncode)
if proc.returncode != 0:
    raise RuntimeError("Inference failed — scroll this cell for the traceback")

json_path = Path("/kaggle/working/activations") / f"{VIDEO_ID}.json"
assert json_path.exists(), json_path
print("DONE on Kaggle VM →", json_path.resolve())
print("bytes", json_path.stat().st_size)
print("Re-run Cell 6 for plot + browser download buttons (ignore Cursor FileLink).")
'''

cell6 = '''# ===== Cell 6: plot + REAL download (Cursor FileLink is broken for remote Kaggle) =====
import base64
import json
from pathlib import Path

import matplotlib.pyplot as plt
from IPython.display import HTML, display

assert "VIDEO_ID" in dir(), "Run Cells 4–5 first"

OUT = Path("/kaggle/working/activations")
json_path = OUT / f"{VIDEO_ID}.json"
npz_path = OUT / f"{VIDEO_ID}_preds.npz"

print("Looking on Kaggle VM (NOT your Mac):")
for path in (json_path, npz_path):
    if path.exists():
        print(f"  OK  {path}  ({path.stat().st_size:,} bytes)")
    else:
        print(f"  MISSING  {path}")

if not json_path.exists():
    raise FileNotFoundError(
        f"Inference output not found at {json_path}. "
        "Re-run Cell 5 and check it printed DONE → ..."
    )

payload = json.loads(json_path.read_text())
windows = payload["windows"]
print("\\nSchema check:")
print("  top keys:", list(payload.keys()))
print("  n_windows:", len(windows))
print("  first window:", json.dumps(windows[0], indent=2) if windows else None)

ts = [0.5 * (w["t_start"] + w["t_end"]) for w in windows]
ys = [float(sum(w["regions"].values()) / max(len(w["regions"]), 1)) for w in windows]
plt.figure(figsize=(10, 3))
plt.plot(ts, ys, color="#1f6feb", lw=2)
plt.fill_between(ts, ys, alpha=0.2, color="#1f6feb")
plt.xlabel("time (s)")
plt.ylabel("mean region activation")
plt.title(f"Cortex / TRIBE — {VIDEO_ID}")
plt.tight_layout()
plt.show()

def download_button(path: Path, label: str):
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    href = f"data:application/octet-stream;base64,{data}"
    return HTML(
        f'<p><a download="{path.name}" href="{href}" '
        f'style="font-size:16px;padding:8px 12px;background:#1f6feb;color:white;'
        f'text-decoration:none;border-radius:6px;">{label}</a> '
        f'<code>{path}</code> ({path.stat().st_size:,} bytes)</p>'
    )

display(HTML("<h3>Download from Kaggle VM</h3>"))
display(download_button(json_path, f"Download {json_path.name}"))
if npz_path.exists():
    if npz_path.stat().st_size < 40_000_000:
        display(download_button(npz_path, f"Download {npz_path.name}"))
    else:
        print(f"NPZ is large ({npz_path.stat().st_size:,} bytes) — use Kaggle Output pane.")

print("\\nAfter download → put JSON in Cortex/data/activations/ (e.g. demo_1.json)")
print("Do NOT use Cursor FileLink 'activations/...' — that creates empty local stubs.")
'''

cell1 = '''# ===== Cell 1: GPU + HF auth =====
import os

!nvidia-smi

from huggingface_hub import login, whoami

HF_TOKEN = ""  # empty → Kaggle Secret HF_TOKEN

if not HF_TOKEN:
    from kaggle_secrets import UserSecretsClient
    HF_TOKEN = UserSecretsClient().get_secret("HF_TOKEN")

assert HF_TOKEN.startswith("hf_"), "HF_TOKEN missing"
os.environ["HF_TOKEN"] = HF_TOKEN
os.environ["HUGGING_FACE_HUB_TOKEN"] = HF_TOKEN
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

login(token=HF_TOKEN, add_to_git_credential=False)
print("HF OK as:", whoami().get("name") or "authenticated")
'''

nb = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
    },
    "cells": [
        md(
            "# Cortex — TRIBE v2 (Kaggle GPU)\n\n"
            "1. Cell 1 auth → Cell 2 install\n"
            "2. **Cell 3 upload your video** (button appears)\n"
            "3. Cell 4 save → Cell 5 infer → Cell 6 plot\n\n"
            "Setup: GPU **T4 x2**, Internet **On**, Secret `HF_TOKEN`, "
            "[Llama 3.2-3B](https://huggingface.co/meta-llama/Llama-3.2-3B).\n"
        ),
        code(cell1),
        code(cell2),
        code(cell3),
        code(cell4),
        code(cell5),
        code(cell6),
    ],
}

OUT.write_text(json.dumps(nb, indent=2))
print("Wrote", OUT)
