# TRIBE v2 on Kaggle GPU only (not your laptop)

Your machine **does not** run TRIBE. Compute host = **Kaggle Notebook → Accelerator → GPU T4 x2**.

Notebook in this repo: [`kaggle/tribe_v2_inference.ipynb`](./kaggle/tribe_v2_inference.ipynb)

## Do this now

1. Go to [kaggle.com](https://www.kaggle.com) → **Create** → **New Notebook**.
2. **Settings**
   - Accelerator: **GPU T4 x2**
   - Internet: **On**
3. **Add-ons → Secrets** → add secret named exactly `HF_TOKEN`
   (Hugging Face [read token](https://huggingface.co/settings/tokens)).
4. On Hugging Face, open [`meta-llama/Llama-3.2-3B`](https://huggingface.co/meta-llama/Llama-3.2-3B) and **accept the license** with the same account.
5. Import `infra/kaggle/tribe_v2_inference.ipynb`.
6. **Cell 3**: upload the video. **Run all** (1 → 6). First run downloads weights.

## The two Cell 6 downloads

Kaggle gives **two** files. You need **both**:

| File | What it is | Cortex uses it for |
|---|---|---|
| `{VIDEO_ID}.json` | 6-region windows | engagement curve + lobe fallback |
| `{VIDEO_ID}_preds.npz` | full (T × 20,484) BOLD field | per-vertex glow + lightning + spike graph |

Drop both into either:

- `Cortex/data/activations/`
- or `Cortex/data/kaggle_inbox/` (backend moves them automatically)

Do **not** use Cursor FileLink — that creates empty stubs.

## Then in the Cortex UI

Upload **the same video** you sent to Kaggle Cell 3. The dashboard plays it at 0.5× with the brain, meter and engagement line locked to the playhead.

## What the laptop must never do

- Do not `pip install tribev2` expecting inference on Mac/Windows CPU.
- Do not use the Hugging Face chat router snippet — TRIBE is **not** an Inference Provider model.

## Dual T4

Weights live on `cuda:0`. The second T4 is headroom so LLaMA + V-JEPA2 + Wav2Vec + the TRIBE head fit. Prefer **T4 x2** over a single T4.

## Official docs

- https://github.com/facebookresearch/TRIBEv2
- https://huggingface.co/facebook/tribev2
- License: CC BY-NC-4.0
