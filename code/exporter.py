#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
exporter.py - mesin prediktif maintenance untuk dashboard.

Migrasi kontrak model capstone (code/25_rf_raw_lowo.py dan Bab 4 proposal) menjadi
satu payload JSON. Satu jalur data:

    dataset mentah -> perhitungan di sini -> data/pm_data.json -> data/pm_data.js
                   -> fetch layer di js/app.js -> render

Aturan yang dipegang:
- Nilai dihitung di sini, tidak pernah di JavaScript.
- Tidak ada smoothing, tidak ada rescale, tidak ada null diisi nol.
- Setiap angka punya asal yang bisa dilacak ke berkas sumber.

Dua set fitur diuji pada fold yang sama:
    row    : 12 kanal, nilai sensor pada baris itu saja (kontrak 25_rf_raw_lowo.py)
    window : 12 kanal x 5 statistik dari jendela 10 m (mean, std, first, last, delta)
Set utama untuk seri waktu, timeline, dan SHAP adalah `window`.

Jalankan:
    /home/neonti/.hermes/venvs/pm/bin/python -u code/exporter.py
"""

from __future__ import annotations

import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (average_precision_score, confusion_matrix,
                             precision_recall_curve, roc_auc_score)

# --------------------------------------------------------------------------
# Konfigurasi
# --------------------------------------------------------------------------

BASE = Path(__file__).resolve().parents[1]
DATA_DIR = BASE / "data"
CAPSTONE = Path("/mnt/d/ARCT-9F2")
SRC_CSV = CAPSTONE / "data" / "predictive" / "dataset_prediktif.csv"

TARGET = "y_10"
PRIMARY = "window"
MAX_POINTS_PER_WELL = 700
SHAP_SAMPLE_PER_FOLD = 400
HIST_BINS = 24
RANDOM_STATE = 42

RF_PARAMS = dict(
    n_estimators=300,
    class_weight="balanced",
    min_samples_leaf=2,
    n_jobs=-1,
    random_state=RANDOM_STATE,
)

CHANNELS = ["md", "wob", "spp", "torque", "rop", "rpm",
            "flow", "mud_density", "diameter", "hookload", "tvd", "gamma"]

CHANNEL_LABEL = {
    "md": "Measured depth",
    "wob": "Weight on bit",
    "spp": "Standpipe pressure",
    "torque": "Surface torque",
    "rop": "Rate of penetration",
    "rpm": "Rotary speed",
    "flow": "Mud flow in",
    "mud_density": "Mud density",
    "diameter": "Hole diameter",
    "hookload": "Hookload",
    "tvd": "True vertical depth",
    "gamma": "Gamma ray",
}

STAT_LABEL = {
    "mean": "rata-rata",
    "std": "simpangan",
    "first": "awal",
    "last": "akhir",
    "delta": "selisih",
}

WELL_LABEL = {
    "USROP_A 0 N-NA_F-9_Ad.csv": "F-9 A",
    "USROP_A 1 N-S_F-7d.csv": "F-7",
    "USROP_A 2 N-SH_F-14d.csv": "F-14",
    "USROP_A 3 N-SH-F-15d.csv": "F-15",
    "USROP_A 4 N-SH_F-15Sd.csv": "F-15 S",
    "USROP_A 5 N-SH-F-5d.csv": "F-5",
    "USROP_A 6 N-SH_F-9d.csv": "F-9",
}

CHANNEL_PHYSICS = {
    "wob": "Beban bit. Lonjakan atau kehilangan mendadak menandai bit lepas cengkeram.",
    "spp": "Tekanan pompa. Naik tajam menandai sumbatan atau pack-off.",
    "torque": "Torsi permukaan. Lonjakan menandai bit macet berputar.",
    "rop": "Laju tembus. Turun mendadak tanpa sebab geologi menandai bit berhenti mencacah.",
    "hookload": "Beban rangkaian. Turun menandai rangkaian tertahan.",
    "flow": "Laju alir lumpur. Turun menandai pompa atau jalur tersumbat.",
    "rpm": "Putaran rotary, untuk memisahkan stall mekanis dari perubahan formasi.",
    "mud_density": "Massa jenis lumpur, konteks tekanan dan gaya apung.",
    "gamma": "Radioaktivitas formasi, penanda litologi.",
    "md": "Kedalaman terukur, sumbu kemajuan lubang.",
    "tvd": "Kedalaman vertikal, konteks geometri lubang.",
    "diameter": "Diameter lubang, penanda tahap pengeboran.",
}


# --------------------------------------------------------------------------
# Utilitas
# --------------------------------------------------------------------------

def robust_z(x: np.ndarray, med: float, mad: float) -> np.ndarray:
    scale = mad if mad > 1e-9 else 1.0
    return (x - med) / scale


def tune_threshold(y: np.ndarray, s: np.ndarray) -> float:
    """Ambang F1 maksimum dari kurva PR (kontrak capstone tune_thr)."""
    p, r, t = precision_recall_curve(y, s)
    denom = np.maximum(p[:-1] + r[:-1], 1e-12)
    f1 = np.where((p[:-1] + r[:-1]) > 0, 2 * p[:-1] * r[:-1] / denom, 0.0)
    if f1.size == 0:
        return float(np.quantile(s, 0.95))
    return float(t[f1 >= f1.max() - 1e-12].max())


def metrics(y: np.ndarray, s: np.ndarray, pred: np.ndarray) -> dict:
    n = int(len(y))
    n_pos = int(y.sum())
    out = {"n": n, "n_pos": n_pos, "prev": round(float(y.mean()), 4) if n else None}
    if n_pos == 0:
        out.update({"note": "tanpa positif di test", "pr_auc": None, "roc_auc": None,
                    "precision": None, "recall": None, "f1": None,
                    "tp": 0, "fp": int(pred.sum()), "fn": 0, "tn": int(n - pred.sum())})
        return out
    if n_pos == n:
        out.update({"note": "tanpa negatif di test", "pr_auc": None, "roc_auc": None})
    else:
        out["pr_auc"] = round(float(average_precision_score(y, s)), 4)
        out["roc_auc"] = round(float(roc_auc_score(y, s)), 4)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    prec = float(tp / (tp + fp)) if (tp + fp) else None
    rec = float(tp / (tp + fn)) if (tp + fn) else None
    f1 = (2 * prec * rec / (prec + rec)) if (prec and rec) else None
    out.update({
        "tp": int(tp), "fp": int(fp), "fn": int(fn), "tn": int(tn),
        "precision": round(prec, 4) if prec is not None else None,
        "recall": round(rec, 4) if rec is not None else None,
        "f1": round(f1, 4) if f1 is not None else None,
        "alert_rate": round(float(pred.mean()), 4),
    })
    return out


def runs_from_flags(flags: np.ndarray, gap: int = 0):
    """Vektor 0/1 menjadi daftar (start, end), toleran celah `gap` sampel."""
    idx = np.flatnonzero(flags)
    if idx.size == 0:
        return []
    out = []
    start = prev = int(idx[0])
    for i in idx[1:]:
        i = int(i)
        if i - prev <= gap + 1:
            prev = i
        else:
            out.append((start, prev))
            start = prev = i
    out.append((start, prev))
    return out


def select_points(score: np.ndarray, pred: np.ndarray, y: np.ndarray, limit: int) -> np.ndarray:
    """Awal, puncak, dan akhir tiap run dipertahankan, sisanya sampel seragam."""
    n = len(score)
    if n <= limit:
        return np.arange(n)
    keep = {0, n - 1}
    for flags in (pred, y):
        for s, e in runs_from_flags(flags):
            keep.add(int(s))
            keep.add(int(s + int(np.argmax(score[s:e + 1]))))
            keep.add(int(e))
    room = max(0, limit - len(keep))
    if room > 0:
        for i in np.linspace(0, n - 1, room).astype(int):
            keep.add(int(i))
    return np.array(sorted(keep))


def build_feature_sets(cols: list[str]) -> dict[str, list[str]]:
    row = [c for c in cols if c.startswith("last_")]
    window = [c for c in cols if c.split("_")[0] in STAT_LABEL]
    return {"row": row, "window": window}


def feature_label(name: str) -> str:
    parts = name.split("_")
    stat, chan = parts[0], "_".join(parts[1:])
    if chan in CHANNEL_LABEL and stat in STAT_LABEL:
        return f"{CHANNEL_LABEL[chan]} ({STAT_LABEL[stat]})"
    return name


# --------------------------------------------------------------------------
# Mesin utama
# --------------------------------------------------------------------------

def main() -> int:
    t0 = time.time()
    print("exporter.py - mesin prediktif maintenance")
    print("=" * 70)

    if not SRC_CSV.exists():
        print(f"GAGAL: dataset tidak ada: {SRC_CSV}")
        return 2
    ds = pd.read_csv(SRC_CSV, low_memory=False)
    print(f"sumber: {SRC_CSV} ({SRC_CSV.stat().st_size/1e6:.1f} MB)")
    print(f"baris: {len(ds):,}  kolom: {ds.shape[1]}")

    fsets = build_feature_sets(list(ds.columns))
    for k, v in fsets.items():
        print(f"set fitur {k}: {len(v)} kolom")
    primary_cols = fsets[PRIMARY]

    ds["ts"] = pd.to_datetime(ds["est_timestamp"], utc=True, errors="coerce")
    bad = int(ds["ts"].isna().sum())
    if bad:
        print(f"peringatan: {bad} baris tanpa timestamp, dibuang")
        ds = ds[ds["ts"].notna()].copy()

    y = ds[TARGET].to_numpy(int)
    wells = ds["well"].to_numpy()
    ts_np = ds["ts"].dt.tz_convert("UTC").dt.tz_localize(None).to_numpy(dtype="datetime64[ns]")
    Xs = {k: ds[v].to_numpy(float) for k, v in fsets.items()}

    ch_tq = ds["last_torque"].to_numpy(float)
    ch_hk = ds["last_hookload"].to_numpy(float)
    ch_rop = ds["last_rop"].to_numpy(float)

    print(f"target {TARGET}: {int(y.sum()):,} positif ({y.mean()*100:.2f}%)")
    print(f"well: {len(set(wells))}")

    try:
        import shap
        have_shap = True
    except Exception as exc:  # noqa: BLE001
        have_shap = False
        print(f"peringatan: shap tidak tersedia ({exc})")

    folds = []
    series, segments = {}, {}
    pooled = {k: {"y": [], "s": [], "pred": []} for k in
              list(fsets) + ["persistence", "rule"]}
    shap_abs = np.zeros(len(primary_cols))
    shap_signed = np.zeros(len(primary_cols))
    shap_n = 0
    shap_per_well = {}

    for w in sorted(set(wells)):
        label = WELL_LABEL.get(w, w)
        te = np.flatnonzero(wells == w)
        rest = np.flatnonzero(wells != w)
        rest = rest[np.argsort(ts_np[rest], kind="stable")]
        n_va = max(1, int(0.15 * len(rest)))
        va, tr = rest[-n_va:], rest[:-n_va]

        fold = {"well": w, "label": label,
                "n": int(te.size), "n_pos": int(y[te].sum()),
                "prev": round(float(y[te].mean()), 4),
                "ts_min": str(pd.Timestamp(ts_np[te].min())),
                "ts_max": str(pd.Timestamp(ts_np[te].max())),
                "engines": {}}

        model_primary = None
        for name, cols in fsets.items():
            X = Xs[name]
            rf = RandomForestClassifier(**RF_PARAMS)
            rf.fit(X[tr], y[tr])
            s_va = rf.predict_proba(X[va])[:, 1]
            s_te = rf.predict_proba(X[te])[:, 1]
            thr = tune_threshold(y[va], s_va)
            pred = (s_te >= thr).astype(int)
            m = metrics(y[te], s_te, pred)
            m["threshold"] = round(thr, 6)
            m["n_features"] = len(cols)
            fold["engines"][name] = m
            pooled[name]["y"].append(y[te])
            pooled[name]["s"].append(s_te)
            pooled[name]["pred"].append(pred)
            if name == PRIMARY:
                model_primary = (rf, s_te, pred, thr, m)

            if have_shap and name == PRIMARY:
                try:
                    expl = shap.TreeExplainer(rf)
                    rng = np.random.default_rng(RANDOM_STATE)
                    take = np.sort(rng.choice(te, size=min(SHAP_SAMPLE_PER_FOLD, te.size), replace=False))
                    sv = expl.shap_values(X[take], check_additivity=False)
                    if isinstance(sv, list):
                        sv = sv[1]
                    sv = np.asarray(sv)
                    if sv.ndim == 3:
                        sv = sv[:, :, 1]
                    shap_abs += np.abs(sv).mean(axis=0) * len(take)
                    shap_signed += sv.mean(axis=0) * len(take)
                    shap_n += len(take)
                    shap_per_well[label] = [round(float(v), 5) for v in np.abs(sv).mean(axis=0)]
                except Exception as exc:  # noqa: BLE001
                    print(f"    SHAP gagal di {label}: {exc}")

        rf, s_te, pred, thr, m_primary = model_primary

        # --- persistence y(t-1) per sumur, urut waktu
        order = np.argsort(ts_np[te], kind="stable")
        te_sorted = te[order]
        y_lag = np.concatenate([[0], y[te_sorted][:-1]])
        fold["engines"]["persistence"] = metrics(y[te_sorted], y_lag.astype(float), y_lag)
        fold["engines"]["persistence"]["threshold"] = None
        fold["engines"]["persistence"]["n_features"] = 1
        pooled["persistence"]["y"].append(y[te_sorted])
        pooled["persistence"]["s"].append(y_lag.astype(float))
        pooled["persistence"]["pred"].append(y_lag)

        # --- rule z(torsi) + z(hookload) - z(rop), ambang q95 fold latihan
        med = {"tq": float(np.nanmedian(ch_tq[tr])), "hk": float(np.nanmedian(ch_hk[tr])),
               "rop": float(np.nanmedian(ch_rop[tr]))}
        mad = {"tq": float(np.nanmedian(np.abs(ch_tq[tr] - med["tq"]))) * 1.4826,
               "hk": float(np.nanmedian(np.abs(ch_hk[tr] - med["hk"]))) * 1.4826,
               "rop": float(np.nanmedian(np.abs(ch_rop[tr] - med["rop"]))) * 1.4826}

        def rule_score(idx):
            return (robust_z(ch_tq[idx], med["tq"], mad["tq"])
                    + robust_z(ch_hk[idx], med["hk"], mad["hk"])
                    - robust_z(ch_rop[idx], med["rop"], mad["rop"]))

        thr_rule = float(np.quantile(rule_score(tr), 0.95))
        s_rule = rule_score(te)
        pred_rule = (s_rule >= thr_rule).astype(int)
        m_rule = metrics(y[te], s_rule, pred_rule)
        m_rule["threshold"] = round(thr_rule, 4)
        m_rule["n_features"] = 3
        fold["engines"]["rule"] = m_rule
        pooled["rule"]["y"].append(y[te])
        pooled["rule"]["s"].append(s_rule)
        pooled["rule"]["pred"].append(pred_rule)

        fold["threshold"] = round(thr, 6)
        folds.append(fold)

        print(f"  {label:<7} n={fold['n']:>6} pos={fold['n_pos']:>5} | "
              f"row PR={fold['engines']['row']['pr_auc']} R={fold['engines']['row']['recall']} | "
              f"win PR={m_primary['pr_auc']} R={m_primary['recall']} | "
              f"per PR={fold['engines']['persistence']['pr_auc']}")

        # --- seri waktu dari model utama
        sel = select_points(s_te, pred, y[te], MAX_POINTS_PER_WELL)
        sel = sel[np.argsort(ts_np[te][sel], kind="stable")]
        pts = [[pd.Timestamp(ts_np[te][i]).strftime("%Y-%m-%dT%H:%M:%S"),
                round(float(s_te[i]), 4), int(pred[i]), int(y[te][i])] for i in sel]
        series[label] = {"n_total": int(te.size), "n_plotted": len(pts),
                         "threshold": round(thr, 6), "points": pts}

        # --- segmen timeline
        seg_p = []
        for s, e in runs_from_flags(pred, gap=3):
            seg_p.append([pd.Timestamp(ts_np[te][s]).strftime("%Y-%m-%dT%H:%M:%S"),
                          pd.Timestamp(ts_np[te][e]).strftime("%Y-%m-%dT%H:%M:%S"),
                          round(float(s_te[s:e + 1].max()), 4), int(e - s + 1)])
        seg_a = [[pd.Timestamp(ts_np[te][s]).strftime("%Y-%m-%dT%H:%M:%S"),
                  pd.Timestamp(ts_np[te][e]).strftime("%Y-%m-%dT%H:%M:%S"),
                  int(e - s + 1)] for s, e in runs_from_flags(y[te], gap=1)]
        segments[label] = {"predicted": seg_p, "actual": seg_a}

    # --- histogram dari model utama
    s_all = np.concatenate(pooled[PRIMARY]["s"])
    y_all = np.concatenate(pooled[PRIMARY]["y"])
    edges = np.linspace(0.0, 1.0, HIST_BINS + 1)
    hp, _ = np.histogram(s_all[y_all == 1], bins=edges)
    hn, _ = np.histogram(s_all[y_all == 0], bins=edges)

    def pooled_metrics(key):
        return metrics(np.concatenate(pooled[key]["y"]),
                       np.concatenate(pooled[key]["s"]),
                       np.concatenate(pooled[key]["pred"]).astype(int))

    pooled_out = {k: pooled_metrics(k) for k in pooled}

    prec, rec, _ = precision_recall_curve(y_all, s_all)
    step = max(1, len(prec) // 200)
    pr_curve = {"precision": [round(float(v), 4) for v in prec[::step]],
                "recall": [round(float(v), 4) for v in rec[::step]],
                "baseline": round(float(y_all.mean()), 4)}

    shap_out = {
        "available": bool(shap_n > 0),
        "engine": PRIMARY,
        "n_samples": int(shap_n),
        "features": primary_cols,
        "labels": [feature_label(f) for f in primary_cols],
        "mean_abs": [round(float(v / shap_n), 5) for v in shap_abs] if shap_n else [],
        "signed_mean": [round(float(v / shap_n), 5) for v in shap_signed] if shap_n else [],
        "per_well": shap_per_well,
    }

    meta = {
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_csv": str(SRC_CSV),
        "source_rows": int(len(ds)),
        "source_mtime": datetime.fromtimestamp(SRC_CSV.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "target": TARGET,
        "target_note": "kejadian berikutnya berada dalam 10 m di depan titik ini",
        "protocol": "LOWO: satu sumur jadi data uji, 15 persen sisa sumur jadi fold validasi ambang",
        "model": "RandomForestClassifier",
        "model_params": {"n_estimators": 300, "class_weight": "balanced",
                         "min_samples_leaf": 2, "random_state": RANDOM_STATE},
        "primary_engine": PRIMARY,
        "feature_sets": {k: {"n": len(v), "cols": v} for k, v in fsets.items()},
        "channel_physics": {k: v for k, v in CHANNEL_PHYSICS.items()},
        "python": platform.python_version(),
        "runtime_s": round(time.time() - t0, 1),
        "capstone_contract": "code/25_rf_raw_lowo.py + Bab 4 proposal (fitur 11 kanal x 5 statistik)",
    }

    payload = {
        "meta": meta,
        "folds": folds,
        "pooled": pooled_out,
        "series": series,
        "segments": segments,
        "histogram": {
            "edges": [round(float(v), 4) for v in edges],
            "negative": [int(v) for v in hn],
            "positive": [int(v) for v in hp],
            "total_negative": int((y_all == 0).sum()),
            "total_positive": int((y_all == 1).sum()),
        },
        "shap": shap_out,
        "pr_curve": pr_curve,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "pm_data.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA_DIR / "pm_data.js").write_text(
        "window.PM_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")

    sizes = {p.name: f"{p.stat().st_size/1024:.0f} KB" for p in DATA_DIR.iterdir() if p.is_file()}
    print("=" * 70)
    print("payload:", sizes)
    for k in pooled_out:
        p = pooled_out[k]
        print(f"  {k:<12} PR-AUC={p['pr_auc']} ROC={p['roc_auc']} P={p['precision']} R={p['recall']}")
    if shap_n:
        top = sorted(zip(shap_out["labels"], shap_out["mean_abs"]), key=lambda x: -x[1])[:3]
        print(f"SHAP sampel {shap_n}, tiga teratas: {top}")
    print(f"waktu total: {meta['runtime_s']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
