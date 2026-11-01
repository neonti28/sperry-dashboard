#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
exporter_full.py - payload terpadu untuk dashboard bertab.

Menggabungkan dua sumber yang berbeda peran:

1. Hasil run capstone (tidak dihitung ulang, dibaca apa adanya):
   - scratch/v9_e_ml/v9_e_ML_{vib,ssi,shk,stuck_k2}_RESULTS.json
     metrik per fold, artinya per well, per model (rf/gb/lr + baseline).
   - scratch/v9_eval_a/v9_eval_a_RESULTS.json
     mesin statistik (hyd_ki, stuck_e2) + fold aturan per kelas.
   - scratch/v9_i1/v9_i1_RESULTS.json dan dashboard/data/engine_v9_i1.json
     tujuh engine, 27 head, tier, layer, batas pemakaian.

2. Hasil hitung ulang dari code/exporter.py (data/pm_data.json):
   seri waktu, timeline, SHAP, kurva PR untuk target y_10.

Keluaran: data/pm_full.json dan cermin data/pm_full.js.

Tidak ada angka yang dihitung ulang di sini selain turunan hitung sederhana
(rata-rata fold, jumlah baris) yang eksplisit ditandai di payload.

Jalankan:
    /home/neonti/.hermes/venvs/pm/bin/python code/exporter_full.py
"""

from __future__ import annotations

import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

CAPSTONE = Path("/mnt/d/ARCT-9F2")
BASE = Path(__file__).resolve().parents[1]
DATA_DIR = BASE / "data"

V9_E_ML = CAPSTONE / "scratch" / "v9_e_ml"
V9_EVAL_A = CAPSTONE / "scratch" / "v9_eval_a" / "v9_eval_a_RESULTS.json"
V9_I1 = CAPSTONE / "scratch" / "v9_i1" / "v9_i1_RESULTS.json"
ENGINE_V9 = CAPSTONE / "dashboard" / "data" / "engine_v9_i1.json"
OVERVIEW = DATA_DIR / "pm_data.json"

ML_ENGINES = ["vib", "ssi", "shk", "stuck_k2"]


def load(p: Path):
    if not p.exists():
        print(f"  lewati, tidak ada: {p.name}")
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def norm_well(w: str) -> str:
    """F-9_A -> F-9 A. Hanya penggantian garis bawah, tanpa menggabungkan well."""
    return w.replace("_", " ").strip()


def num(v, nd=4):
    return round(float(v), nd) if isinstance(v, (int, float)) else None


# --------------------------------------------------------------------------
# 1. Mesin ML per fold (v9_e_ml)
# --------------------------------------------------------------------------

def read_ml_engines() -> list[dict]:
    out = []
    for name in ML_ENGINES:
        p = V9_E_ML / f"v9_e_ML_{name}_RESULTS.json"
        d = load(p)
        if not d:
            continue
        folds = []
        for f in d.get("folds", []):
            models = {}
            for mname, m in (f.get("models") or {}).items():
                if not isinstance(m, dict) or m.get("auprc") is None:
                    continue
                models[mname] = {
                    "auprc": num(m.get("auprc")),
                    "ci95": [num(x) for x in (m.get("ci95") or [])] or None,
                    "lift": num(m.get("lift")),
                    "plafon_lift": num(m.get("plafon_lift")),
                }
            folds.append({
                "well": f.get("test_well"),
                "well_norm": norm_well(str(f.get("test_well"))),
                "n_train": f.get("n_train"),
                "n_test": f.get("n_test"),
                "pos_test": f.get("pos_test"),
                "prev_test": num(f.get("prev_test")),
                "underpowered": bool(f.get("underpowered")),
                "train_wells": f.get("train_wells"),
                "models": models,
            })
        out.append({
            "engine": d.get("engine") or name,
            "source": str(p.relative_to(CAPSTONE)),
            "kind": "ml",
            "klaim_tugas": d.get("klaim_tugas"),
            "jenis_task": d.get("jenis_task"),
            "n_features": d.get("n_features"),
            "seed": d.get("seed"),
            "dataset_sha256": d.get("dataset_sha256"),
            "folds": folds,
        })
    return out


# --------------------------------------------------------------------------
# 2. Mesin statistik dan aturan (v9_eval_a)
# --------------------------------------------------------------------------

def read_stat_engines(eval_a: dict) -> list[dict]:
    out = []
    spec = [
        ("stat_hyd_ki", "hyd_ki", "hyd"),
        ("stat_stuck_e2", "stuck_E2", "stuck"),
    ]
    for key, engine_id, group in spec:
        blk = eval_a.get(key)
        if not isinstance(blk, dict):
            continue
        folds = []
        for f in blk.get("folds", []):
            well = f.get("test_well")
            models = {}
            if f.get("auprc") is not None:
                models["stat"] = {"auprc": num(f.get("auprc")), "lift": num(f.get("lift"))}
            for mname, m in (f.get("methods") or {}).items():
                if isinstance(m, dict) and m.get("auprc") is not None:
                    models[mname] = {
                        "auprc": num(m.get("auprc")),
                        "lift": num(m.get("lift")),
                        "precision": num(m.get("P") if m.get("P") is not None else m.get("precision")),
                        "recall": num(m.get("R") if m.get("R") is not None else m.get("recall")),
                        "far": num(m.get("FAR") if m.get("FAR") is not None else m.get("far_24h")),
                    }
            if not well and not models:
                continue
            folds.append({
                "well": well,
                "well_norm": norm_well(str(well)) if well else None,
                "n_test": f.get("n_test") or f.get("n"),
                "pos_test": f.get("pos_test") or f.get("n_pos") or f.get("pos"),
                "prev_test": num(f.get("prev_test") or f.get("prev")),
                "underpowered": bool(f.get("underpowered")),
                "models": models,
            })
        if folds:
            out.append({
                "engine": engine_id,
                "source": str(V9_EVAL_A.relative_to(CAPSTONE)) + "#" + key,
                "kind": "stat",
                "klaim_tugas": blk.get("claim_task") or blk.get("klaim_tugas"),
                "jenis_task": blk.get("jenis_engine"),
                "group": group,
                "folds": folds,
            })
    return out


# --------------------------------------------------------------------------
# 3. Head dan metadata engine (v9_i1 / engine_v9_i1)
# --------------------------------------------------------------------------

def read_heads(engine_v9: dict, v9_i1: dict) -> dict:
    """kunci: engine id -> daftar head dengan metrik segmen."""
    src = engine_v9 or v9_i1 or {}
    out = {}
    for eng in src.get("engines", []):
        eid = eng.get("engine")
        heads = []
        for h in eng.get("heads", []):
            m = h.get("metrics") or h.get("metrik_segmen") or {}
            heads.append({
                "head": h.get("head"),
                "layer": h.get("layer"),
                "tier": h.get("tier"),
                "klaim": h.get("klaim"),
                "human_review": h.get("human_review"),
                "head_utama": h.get("head_utama"),
                "n_windows": h.get("n_windows"),
                "frac_aktif": num(h.get("frac_aktif"), 4),
                "lead_menit": num(h.get("lead_menit"), 2),
                "auprc": num(h.get("auprc")),
                "definisi": h.get("definisi"),
                "badge_far": h.get("badge_far") or h.get("batas_far"),
                "keyakinan": h.get("keyakinan"),
                "batas": h.get("batas") or h.get("batas_pemakaian"),
                "status": h.get("status"),
                "metrics": {
                    "n": m.get("n"),
                    "pos": m.get("pos"),
                    "neg": m.get("neg"),
                    "tp": m.get("tp"),
                    "fp": m.get("fp"),
                    "fn": m.get("fn"),
                    "precision": num(m.get("precision")),
                    "recall": num(m.get("recall")),
                    "far": num(m.get("far")),
                },
            })
        out[eid] = {
            "display_name": eng.get("display_name"),
            "klaim_tugas": eng.get("klaim_tugas"),
            "jenis_tugas": eng.get("jenis_tugas"),
            "sumber_tier": eng.get("sumber_tier"),
            "heads": heads,
        }
    return out


# --------------------------------------------------------------------------
# 4. Susun payload
# --------------------------------------------------------------------------

def main() -> int:
    print("exporter_full.py - payload terpadu")
    print("=" * 70)

    eval_a = load(V9_EVAL_A) or {}
    engine_v9 = load(ENGINE_V9)
    v9_i1 = load(V9_I1)
    overview = load(OVERVIEW)
    if overview is None:
        print("GAGAL: data/pm_data.json belum ada. Jalankan code/exporter.py dulu.")
        return 2

    heads = read_heads(engine_v9, v9_i1)

    engines = read_ml_engines()
    engines += read_stat_engines(eval_a)
    print(f"mesin dengan fold per well: {len(engines)}")

    # engine yang hanya punya head (tanpa fold per well) tetap ikut tampil
    known = {e["engine"] for e in engines}
    for eid, meta in heads.items():
        if eid in known:
            continue
        engines.append({
            "engine": eid,
            "source": ENGINE_V9.relative_to(CAPSTONE).as_posix(),
            "kind": "head_only",
            "klaim_tugas": meta.get("klaim_tugas"),
            "jenis_task": meta.get("jenis_tugas"),
            "folds": [],
        })
    print(f"total engine: {len(engines)}")

    # lampirkan head + display name ke tiap engine
    for e in engines:
        meta = heads.get(e["engine"], {})
        e["display_name"] = meta.get("display_name") or e["engine"].replace("_", " ")
        e["sumber_tier"] = meta.get("sumber_tier")
        e["heads"] = meta.get("heads", [])
        e["n_heads"] = len(e["heads"])
        if not e.get("klaim_tugas"):
            e["klaim_tugas"] = meta.get("klaim_tugas")

    # agregat per engine: rentang AUPRC per model lintas fold
    for e in engines:
        by_model: dict[str, list] = {}
        for f in e["folds"]:
            for mname, m in (f.get("models") or {}).items():
                if isinstance(m, dict) and m.get("auprc") is not None:
                    by_model.setdefault(mname, []).append(m["auprc"])
        e["model_ranges"] = {
            m: {"min": round(min(v), 4), "median": round(statistics.median(v), 4),
                "max": round(max(v), 4), "n": len(v)}
            for m, v in by_model.items()
        }
        rf = e["model_ranges"].get("rf")
        e["rf_range"] = rf or (e["model_ranges"].get("stat")
                               or next(iter(e["model_ranges"].values()), None))
        e["n_test_total"] = sum(f.get("n_test") or 0 for f in e["folds"])
        e["n_pos_total"] = sum(f.get("pos_test") or 0 for f in e["folds"])
        e["underpowered_folds"] = [f["well"] for f in e["folds"] if f.get("underpowered")]

    # daftar well: gabungan semua fold, tanpa menggabungkan nama yang berbeda
    well_map: dict[str, dict] = {}
    for e in engines:
        for f in e["folds"]:
            w = f.get("well")
            if not w:
                continue
            entry = well_map.setdefault(w, {
                "well": w,
                "well_norm": norm_well(w),
                "engines": [],
                "n_test_total": 0,
                "pos_test_total": 0,
            })
            entry["engines"].append({
                "engine": e["engine"],
                "display_name": e["display_name"],
                "kind": e["kind"],
                "n_test": f.get("n_test"),
                "pos_test": f.get("pos_test"),
                "prev_test": f.get("prev_test"),
                "underpowered": f.get("underpowered"),
                "models": f.get("models", {}),
            })
            entry["n_test_total"] += f.get("n_test") or 0
            entry["pos_test_total"] += f.get("pos_test") or 0

    wells = sorted(well_map.values(), key=lambda x: x["well"])
    print(f"well unik: {len(wells)} -> {[w['well'] for w in wells]}")

    # pasangkan dengan seri y_10 hasil hitung ulang (tab Ringkasan)
    ov_wells = {w["label"]: w for w in overview.get("folds", [])}
    matched = 0
    for w in wells:
        w["series_label"] = None
        if w["well_norm"] in ov_wells:
            w["series_label"] = w["well_norm"]
            matched += 1
    print(f"well yang cocok dengan seri y_10: {matched}")

    payload = {
        "meta": {
            "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "capstone_root": str(CAPSTONE),
            "sources": [
                "scratch/v9_e_ml/v9_e_ML_{vib,ssi,shk,stuck_k2}_RESULTS.json",
                "scratch/v9_eval_a/v9_eval_a_RESULTS.json",
                "scratch/v9_i1/v9_i1_RESULTS.json",
                "dashboard/data/engine_v9_i1.json",
                "data/pm_data.json (hasil hitung ulang code/exporter.py)",
            ],
            "note": "Metrik engine dibaca langsung dari hasil run capstone, tidak dihitung ulang. "
                    "Seri waktu, timeline, dan SHAP berasal dari hitung ulang sendiri.",
            "n_engines": len(engines),
            "n_wells": len(wells),
            "n_heads": sum(e["n_heads"] for e in engines),
        },
        "engines": engines,
        "wells": wells,
        "overview": overview,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    jp = DATA_DIR / "pm_full.json"
    jp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA_DIR / "pm_full.js").write_text(
        "window.PM_FULL = " + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")

    print("=" * 70)
    print(f"payload: {jp} ({jp.stat().st_size/1024:.0f} KB)")
    print(f"engine: {[e['engine'] for e in engines]}")
    for e in engines:
        r = e["rf_range"]
        rr = f"{r['min']}-{r['max']}" if r else "n/a"
        print(f"  {e['engine']:<10} fold={len(e['folds'])} head={e['n_heads']} "
              f"rf_auprc={rr} up={len(e['underpowered_folds'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
