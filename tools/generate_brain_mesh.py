"""
Generate brain_mesh.json from the FreeSurfer fsaverage5 cortical surface.

Uses nilearn to fetch the pial mesh and Destrieux parcellation, then maps
the ~75 Destrieux regions into the 6 macro-regions used by Cortex.
Output is a JSON file consumable by the Three.js frontend.
"""

import json, sys, pathlib
import numpy as np
from nilearn import datasets, surface

OUT = pathlib.Path(__file__).resolve().parent.parent / "frontend" / "public" / "brain_mesh.json"

# ── 1. Fetch fsaverage5 pial surfaces ──────────────────────────────────
print("Fetching fsaverage5 pial surfaces …")
fsaverage = datasets.fetch_surf_fsaverage("fsaverage5")
lh_coords, lh_faces = surface.load_surf_mesh(fsaverage["pial_left"])
rh_coords, rh_faces = surface.load_surf_mesh(fsaverage["pial_right"])

n_left = len(lh_coords)
vertices = np.vstack([lh_coords, rh_coords])
faces = np.vstack([lh_faces, rh_faces + n_left])
print(f"  Mesh: {len(vertices)} vertices, {len(faces)} faces (n_left={n_left})")

# ── 2. Fetch Destrieux parcellation labels ─────────────────────────────
print("Fetching Destrieux parcellation …")
destrieux = datasets.fetch_atlas_surf_destrieux()

# nilearn may return either numpy arrays or file paths — handle both
def _load_labels(data):
    if isinstance(data, np.ndarray):
        return data
    return surface.load_surf_data(data)

lh_labels = _load_labels(destrieux["map_left"])
rh_labels = _load_labels(destrieux["map_right"])
label_names = [l.decode() if isinstance(l, bytes) else str(l) for l in destrieux["labels"]]
all_labels = np.concatenate([lh_labels, rh_labels]).astype(int)
print(f"  Parcellation: {len(label_names)} Destrieux labels")

# ── 3. Map Destrieux labels → our 6 macro-regions ─────────────────────
MACRO = {
    # 0 = visual (occipital / visual cortex)
    "G_cuneus": 0, "G_occipital_middle": 0, "G_occipital_sup": 0,
    "G_oc-temp_lat-fusifor": 0, "G_oc-temp_med-Lingual": 0,
    "Pole_occipital": 0, "S_calcarine": 0, "S_collat_transv_post": 0,
    "S_oc_middle_and_Lunatus": 0, "S_oc_sup_and_transversal": 0,
    "S_occipital_ant": 0, "S_parieto_occipital": 0,
    "S_oc-temp_lat": 0, "S_oc-temp_med_and_Lingual": 0,
    "G_and_S_occipital_inf": 0,

    # 1 = language (temporal + Broca)
    "G_temp_sup-G_T_transv": 1, "G_temp_sup-Lateral": 1,
    "G_temp_sup-Plan_polar": 1, "G_temp_sup-Plan_tempo": 1,
    "G_temporal_inf": 1, "G_temporal_middle": 1,
    "G_front_inf-Opercular": 1, "G_front_inf-Triangul": 1,
    "G_pariet_inf-Supramar": 1, "S_temporal_sup": 1,
    "S_temporal_transverse": 1, "S_temporal_inf": 1,
    "Lat_Fis-ant-Horizont": 1, "Lat_Fis-ant-Vertical": 1,
    "Lat_Fis-post": 1,

    # 2 = reward / novelty (orbitofrontal + anterior cingulate)
    "G_orbital": 2, "G_rectus": 2, "G_subcallosal": 2,
    "G_front_inf-Orbital": 2, "G_and_S_frontomargin": 2,
    "G_and_S_transv_frontopol": 2, "G_and_S_cingul-Ant": 2,
    "G_and_S_cingul-Mid-Ant": 2, "S_orbital_lateral": 2,
    "S_orbital_med-olfact": 2, "S_orbital-H_Shaped": 2,
    "S_suborbital": 2,

    # 3 = memory / familiarity (medial temporal)
    "G_oc-temp_med-Parahip": 3, "Pole_temporal": 3,
    "S_collat_transv_ant": 3, "S_interm_prim-Jensen": 3,

    # 4 = emotional arousal (insula + posterior cingulate)
    "G_Ins_lg_and_S_cent_ins": 4, "G_insular_short": 4,
    "G_cingul-Post-dorsal": 4, "G_cingul-Post-ventral": 4,
    "G_and_S_cingul-Mid-Post": 4, "S_circular_insula_ant": 4,
    "S_circular_insula_inf": 4, "S_circular_insula_sup": 4,
    "S_pericallosal": 4, "S_subparietal": 4,

    # 5 = attention / salience (parietal + dorsal frontal)
    "G_parietal_sup": 5, "G_pariet_inf-Angular": 5, "G_precuneus": 5,
    "G_front_sup": 5, "G_front_middle": 5, "G_precentral": 5,
    "G_postcentral": 5, "G_and_S_paracentral": 5, "G_and_S_subcentral": 5,
    "S_central": 5, "S_front_inf": 5, "S_front_middle": 5,
    "S_front_sup": 5, "S_intrapariet_and_P_trans": 5,
    "S_cingul-Marginalis": 5, "S_postcentral": 5,
    "S_precentral-inf-part": 5, "S_precentral-sup-part": 5,
}

region_ids = np.full(len(vertices), -1, dtype=np.int8)
mapped = 0
for vi in range(len(vertices)):
    label_idx = all_labels[vi]
    if 0 <= label_idx < len(label_names):
        name = label_names[label_idx]
        if name in MACRO:
            region_ids[vi] = MACRO[name]
            mapped += 1

print(f"  Mapped {mapped}/{len(vertices)} vertices to macro-regions "
      f"({mapped*100/len(vertices):.1f}%)")
unmapped_names = set()
for vi in range(len(vertices)):
    li = all_labels[vi]
    if 0 <= li < len(label_names) and region_ids[vi] == -1:
        unmapped_names.add(label_names[li])
if unmapped_names:
    print(f"  Unmapped labels: {sorted(unmapped_names)}")

# ── 4. Export JSON ─────────────────────────────────────────────────────
print(f"Writing {OUT} …")
mesh = {
    "vertices": [round(float(v), 4) for v in vertices.flatten()],
    "faces": faces.flatten().tolist(),
    "region_ids": region_ids.tolist(),
    "n_vertices": len(vertices),
    "n_left": int(n_left),
    "regions": [
        "visual", "language", "reward_novelty",
        "memory_familiarity", "emotional_arousal", "attention_salience",
    ],
}

OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w") as f:
    json.dump(mesh, f)

size_mb = OUT.stat().st_size / 1024 / 1024
print(f"Done! {size_mb:.1f} MB -> {OUT}")
