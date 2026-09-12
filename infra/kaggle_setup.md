# TRIBE v2 on Kaggle GPU only (not your laptop)

Your machine **does not** run TRIBE. Compute host = **Kaggle Notebook → Accelerator → GPU T4 x2**.

Notebook in this repo: [`kaggle/tribe_v2_inference.ipynb`](./kaggle/tribe_v2_inference.ipynb)

## Do this now (≈15–40 min first run)

1. Go to [kaggle.com](https://www.kaggle.com) → **Create** → **New Notebook**.
2. **Settings**
   - Accelerator: **GPU T4 x2**
   - Internet: **On**
3. **Add-ons → Secrets** → add secret named exactly `HF_TOKEN`  
   (Hugging Face [read token](https://huggingface.co/settings/tokens)).
4. On Hugging Face, open [`meta-llama/Llama-3.2-3B`](https://huggingface.co/meta-llama/Llama-3.2-3B) and **accept the license** with the same account.
5. Upload this file into the notebook (File → Import notebook), or paste cells from:
   `infra/kaggle/tribe_v2_inference.ipynb`
6. **Run all cells** (1 → 6). First run downloads weights; later runs are faster.
7. In **Output**, download:
   - `activations/{video_id}.json`
8. On your laptop (no GPU needed):

```bash
cp ~/Downloads/<video_id>.json /Users/nandhanalahari/Cortex/data/activations/
```

Cortex then only **reads** that JSON for the glow timeline.

## What the laptop must never do

- Do not `pip install tribev2` expecting inference on Mac CPU/MPS.
- Do not use the Hugging Face chat router snippet — TRIBE is **not** an Inference Provider model.

## Dual T4

Weights live on `cuda:0`. The second T4 is headroom so LLaMA + V-JEPA2 + Wav2Vec + the TRIBE head fit. Prefer **T4 x2** over a single T4.

## Official docs

- https://github.com/facebookresearch/TRIBEv2  
- https://huggingface.co/facebook/tribev2  
- License: CC BY-NC-4.0
