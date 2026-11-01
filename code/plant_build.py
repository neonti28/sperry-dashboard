"""
plant_build.py - membangun payload dashboard predictive maintenance Sperry Drilling / Volve.

Aturan yang dipegang:
1. Hari ini = 2015-08-13 23:59 UTC. Tidak ada satu pun nilai setelah tanggal itu yang masuk fitur.
   Data setelahnya hanya dipakai untuk menilai prediksi (halaman Model).
2. Tiga lapisan angka diberi label: TERUKUR (langsung dari berkas), TURUNAN (dihitung dari yang
   terukur), SINTETIS (dibangkitkan dengan seed tetap).
3. Semua angka dihitung di sini. JavaScript hanya menggambar.
4. Seed tetap supaya hasil bisa direproduksi: menjalankan ulang menghasilkan berkas identik.

Sumber (read-only):
  /mnt/d/ARCT-9F2/data/volve/labels_curated_v2.csv       884 event kurasi
  /mnt/d/ARCT-9F2/data/volve/witsml_parsed/*.csv         239 kanal per wellbore
  /mnt/d/ARCT-9F2/data/predictive/dataset_prediktif.csv  12 kanal x 5 statistik
  /mnt/d/ARCT-9F2/data/USROP_health.csv                  health_index per baris
  /mnt/d/ARCT-9F2/scratch/v9_i1/v9_i1_RESULTS.json       registry 7 engine, 27 head
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

AS_OF = pd.Timestamp("2015-08-13 23:59:59", tz="UTC")
SEED = 20260511
ROOT = Path("/mnt/d/ARCT-9F2")
OUT = Path("/mnt/d/Download/predictive maintenance")
DATA = OUT / "data"

RIG_DAY_RATE_USD = 180_000.0          # asumsi tarif rig per hari
RIG_HOUR_RATE_USD = RIG_DAY_RATE_USD / 24.0
LABOR_USD_PER_H = 65.0

# Komponen yang punya cukup bukti di 884 event. Dipakai untuk Weibull dan daftar aset.
COMPONENT_LABEL = {
    "casing": "Casing / Liner",
    "liner": "Casing / Liner",
    "shoe": "Casing / Liner",
    "sub": "Drill String Sub",
    "drill_string": "Drill String",
    "toolstring": "Tool String",
    "tractor": "Wireline Tractor",
    "packer": "Packer",
    "perf_gun": "Perforating Gun",
    "screen": "Sand Screen",
    "tubing": "Tubing",
    "mwd_lwd": "MWD / LWD Tool",
    "bit": "Drill Bit",
    "fishing_tool": "Fishing Tool",
    "jar": "Drilling Jar",
}

# Peralatan permukaan: nama aset, pola pencarian di teks event.
SURFACE_ASSETS = [
    ("TD-01", "Top Drive", r"top ?drive|\btds\b"),
    ("DW-01", "Drawworks", r"drawworks|draw works|winch"),
    ("MP-01", "Mud Pump", r"mud ?pump|triplex|pump ?(?:1|2|3)\b"),
    ("RT-01", "Rotary Table", r"rotary table|kelly"),
    ("IR-01", "Iron Roughneck", r"roughneck|iron rough"),
    ("SH-01", "Shale Shaker", r"shak|shale shaker"),
]

# Kanal WITSML yang dipakai, beserta satuan dan cara konversi ke satuan tampilan.
CHANNELS = {
    "VIBLAT_RT": ("Vibration", "m/s2", 0.3048, "getaran lateral dari MWD, dikonversi dari ft/s2"),
    "SHKPK_RT": ("Shock Peak", "g", 1 / 9.80665, "puncak kejutan, dikonversi dari m/s2"),
    "ATMP_RT": ("Temperature", "C", 1.0, "suhu anulus dari MWD"),
    "SPPA": ("Pressure", "bar", 1 / 100.0, "tekanan standpipe, dikonversi dari kPa"),
    "TFLO": ("Flow", "L/min", 1.0, "laju alir masuk"),
    "TRPM": ("Rotary Speed", "rpm", 1.0, "kecepatan rotasi permukaan"),
    "TQA": ("Torque", "kN.m", 1.0, "torsi permukaan"),
    "HKLD": ("Hookload", "kkgf", 1.0, "beban hook"),
    "ROP": ("ROP", "m/h", 1.0, "laju tembus"),
    "STUCK_RT": ("Stuck Index", "unitless", 1.0, "indeks stuck pipe 0-3"),
    "CRPM_RT": ("Stick-slip", "rpm", 1.0, "fluktuasi rpm sebagai proksi stick-slip"),
    "SHKRSK_RT": ("Shock Risk", "unitless", 1.0, "risiko kejutan 0-3"),
}

TECHNICIANS = [
    "A. Siregar", "B. Nurhadi", "C. Wijaya", "D. Pangestu", "E. Ramadhan",
    "F. Hasibuan", "G. Sitompul", "H. Prakoso", "I. Kurniawan", "J. Simanjuntak",
]

SPARES = {
    "Casing / Liner": [("Casing 9-5/8 in", 1), ("Liner hanger", 1)],
    "Drill String Sub": [("Sub crossover 6-5/8", 1), ("Seal kit sub", 1)],
    "Drill String": [("Drill pipe joint", 1), ("Tool joint", 2)],
    "MWD / LWD Tool": [("MWD pulser", 1), ("Battery pack MWD", 1)],
    "Drill Bit": [("PDC bit 8-1/2 in", 1), ("Nozzle set", 3)],
    "Wireline Tractor": [("Tractor wheel set", 1), ("Motor tractor", 1)],
    "Tool String": [("Wireline cable head", 1), ("Centralizer", 2)],
    "Packer": [("Packer element", 1), ("Setting kit", 1)],
    "Perforating Gun": [("Gun carrier", 1), ("Detonator", 2)],
    "Top Drive": [("Top drive motor", 1), ("IBOP valve", 1)],
    "Drawworks": [("Brake disc", 2), ("Drawworks motor", 1)],
    "Mud Pump": [("Fluid end module", 1), ("Valve and seat kit", 1)],
    "Rotary Table": [("Bushing set", 1), ("Gear oil", 1)],
    "Iron Roughneck": [("Spin roller", 2), ("Torque gauge", 1)],
    "Shale Shaker": [("Screen panel", 4), ("Vibrator motor", 1)],
}

FAILURE_TYPES = {
    "Vibration": "Excessive vibration",
    "Shock Peak": "Shock damage",
    "Temperature": "Overheating",
    "Pressure": "Pressure deviation",
    "Flow": "Flow instability",
    "Stuck Index": "Stuck pipe",
    "Stick-slip": "Stick-slip",
    "Shock Risk": "Shock risk",
    "Torque": "Torque overload",
    "Hookload": "Load anomaly",
    "ROP": "Rate of penetration drop",
}

# Pemetaan engine capstone ke komponen yang paling relevan.
ENGINE_COMPONENT = {
    "vib": "Drill String",
    "ssi": "Drill String",
    "shk": "Drill Bit",
    "stuck": "Drill String",
    "stuck_k2": "Drill String",
    "hyd": "Mud Pump",
    "hyd_ki": "Mud Pump",
    "bit_wear": "Drill Bit",
    "tool_wear": "MWD / LWD Tool",
    "stuck_E2": "Drill String",
}

ENGINE_LABEL = {
    "vib": "Vibration",
    "ssi": "Stick-slip",
    "shk": "Shock / bit bounce",
    "stuck": "Stuck pipe",
    "stuck_k2": "Stuck pipe (K-2)",
    "stuck_E2": "Stuck pipe (E2)",
    "hyd": "Hydraulic",
    "hyd_ki": "Hydraulic (K-i)",
    "bit_wear": "Bit wear",
    "tool_wear": "Tool wear",
}


# ----------------------------------------------------------------------------- util

def r4(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, 4)


def pct(a, b):
    if not b:
        return None
    return r4(100.0 * a / b)


def iso(dt):
    if dt is None or (isinstance(dt, float) and math.isnan(dt)):
        return None
    ts = pd.Timestamp(dt)
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def q(series, p):
    s = pd.to_numeric(series, errors="coerce").dropna()
    if s.empty:
        return None
    return float(s.quantile(p))


def status_from(value, normal, warn, crit, higher_is_worse=True):
    if value is None or normal is None or warn is None:
        return "unknown"
    if higher_is_worse:
        if crit is not None and value >= crit:
            return "critical"
        if value >= warn:
            return "warning"
        if value >= normal:
            return "elevated"
        return "normal"
    if crit is not None and value <= crit:
        return "critical"
    if value <= warn:
        return "warning"
    if value <= normal:
        return "elevated"
    return "normal"


def weibull_fit_min(a, b, t):
    """Fit Weibull 2 parameter dengan regresi linear pada plot Weibull.

    Dipakai median-rank estimator supaya tidak butuh scipy dan hasilnya deterministik.
    """
    t = np.sort(np.asarray(t, dtype=float))
    t = t[t > 0]
    n = len(t)
    if n < 3:
        return None
    i = np.arange(1, n + 1, dtype=float)
    f = (i - 0.3) / (n + 0.4)
    x = np.log(t)
    y = np.log(-np.log(1 - f))
    slope, intercept = np.polyfit(x, y, 1)
    if slope <= 0:
        return None
    beta = float(slope)
    eta = float(np.exp(-intercept / slope))
    if not (0.3 < beta < 12) or not (1 < eta < 1e7):
        return None
    return beta, eta


# ----------------------------------------------------------------------------- baca

def read_labels():
    p = ROOT / "data/volve/labels_curated_v2.csv"
    df = pd.read_csv(p)
    df["d_start"] = pd.to_datetime(df["act_start"], errors="coerce", utc=True)
    df["d_end"] = pd.to_datetime(df["act_end"], errors="coerce", utc=True)
    df["dur_h"] = (df["d_end"] - df["d_start"]).dt.total_seconds() / 3600.0
    df.loc[df["dur_h"] < 0, "dur_h"] = np.nan
    df = df[df["d_start"].notna()]
    before = df[df["d_start"] <= AS_OF].copy()
    after = df[df["d_start"] > AS_OF].copy()
    print(f"event total {len(df)} | <= as-of {len(before)} | > as-of {len(after)} (hanya untuk penilaian)")
    return df, before, after


def read_witsml():
    """Baca kanal penting per wellbore, potong di tanggal acuan, agregasi per jam.

    Berkas WITSML mencapai 1,6 juta baris per sumur dan mesin ini punya RAM 7,7 GB.
    Pembacaan satu kali penuh plus menyimpan seluruh DataFrame per sumur membuat penukaran
    memori, jadi file dibaca per blok 200.000 baris. Tiap blok hanya diubah menjadi jumlah,
    maksimum, dan hitungan per jam, lalu dibuang. Mean dihitung ulang di akhir dari
    jumlah dibagi hitungan, supaya mean-of-mean tidak terjadi.
    """
    d = ROOT / "data/volve/witsml_parsed"
    files = sorted([f for f in d.glob("*.csv") if not f.name.startswith("VAR_")])
    # agregat per jam di-cache supaya putaran debug tidak perlu membaca ulang 1,6 juta baris
    stamp = f"{AS_OF.value}" + "".join(str(f.stat().st_mtime_ns) for f in files)
    cache = OUT / "data" / (".witsml_hourly_" + hashlib.sha256(stamp.encode()).hexdigest()[:12] + ".pkl")
    if cache.exists():
        out = pd.read_pickle(cache)
        print(f"cache witsml dipakai: {len(out)} sumur")
        return out
    wanted = ["timestamp", *CHANNELS.keys()]
    out = {}
    for f in files:
        well = f.stem
        parts, first, last, rows = [], None, None, 0
        # tiap sumur punya kanal berbeda; usecols dipersempit ke yang benar-benar ada
        header = pd.read_csv(f, nrows=0).columns
        present = [c for c in wanted if c in header]
        for chunk in pd.read_csv(f, usecols=present, chunksize=200_000, engine="c"):
            ts = pd.to_datetime(chunk["timestamp"], errors="coerce", utc=True)
            keep = ts.notna() & (ts <= AS_OF)
            if not keep.any():
                continue
            chunk, ts = chunk[keep], ts[keep]
            for c in CHANNELS:
                chunk[c] = pd.to_numeric(chunk[c], errors="coerce") if c in chunk.columns else np.nan
            chunk["hour"] = ts.dt.floor("h")
            g = chunk.groupby("hour").agg({c: ["sum", "max", "count"] for c in CHANNELS})
            g.columns = [f"{a}_{b}" for a, b in g.columns]
            parts.append(g)
            rows += len(chunk)
            lo, hi = ts.min(), ts.max()
            first = lo if first is None else min(first, lo)
            last = hi if last is None else max(last, hi)
            del chunk, ts, g
        if not parts:
            continue
        acc = pd.concat(parts).groupby(level=0).sum()
        for c in CHANNELS:
            s, n = f"{c}_sum", f"{c}_count"
            if n in acc.columns and s in acc.columns:
                acc[f"{c}_mean"] = acc[s] / acc[n].replace(0, np.nan)
            if f"{c}_max" not in acc.columns:
                acc[f"{c}_max"] = np.nan
        keep_cols = []
        for c in CHANNELS:
            for suf in ("mean", "max", "count"):
                col = f"{c}_{suf}"
                if col in acc.columns:
                    keep_cols.append(col)
        acc = acc[keep_cols].sort_index()
        out[well] = {"hourly": acc, "first": first, "last": last, "rows": rows}
        print(f"  {well:8s} baris {rows:8d} jam {len(acc):6d} rentang {first.date()} .. {last.date()}")
    pd.to_pickle(out, cache)
    print(f"agregat disimpan ke cache: {cache.name}")
    return out


def read_usrop():
    p = ROOT / "data/USROP_health.csv"
    if not p.exists():
        return {}
    df = pd.read_csv(p, usecols=lambda c: c in {"well", "health_index", "maintenance_recommendation", "label"})
    out = {}
    for well, g in df.groupby("well"):
        key = str(well).replace(".csv", "")
        out[key] = {
            "health_index_median": r4(pd.to_numeric(g["health_index"], errors="coerce").median()),
            "labels": Counter(g["label"].astype(str)).most_common(3),
            "recommendation": str(g["maintenance_recommendation"].dropna().iloc[0]) if g["maintenance_recommendation"].notna().any() else None,
        }
    print(f"USROP: {len(out)} well")
    return out


def read_engines():
    p = DATA / "pm_full.json"
    if not p.exists():
        return []
    payload = json.loads(p.read_text())
    return payload.get("engines", [])


# ----------------------------------------------------------------------------- aset

FAIL_CATEGORIES = {
    "surface_rig_equipment", "bha_stuck_fishing", "bha_downhole_equipment",
    "mixed_evidence", "wellbore_fluid", "wireline_completion_intervention",
    "failure_unlocated",
}


def norm_well(w: str) -> str:
    """Satu bentuk kanonik: 'F-9 A', 'F-15 D', 'F-14', 'F-5'.

    Sumber memakai bentuk berbeda (F_14, F-14, NO 15/9-F-15 D, F-15D), sehingga tanpa
    penyeragaman sumur yang sama terpecah jadi beberapa aset.
    """
    s = str(w).upper().replace("NO 15/9-", "").replace("15/9-", "")
    s = s.replace("WELLBORE", "").replace("_", "-").strip()
    s = s.replace(" ", "")
    s = re.sub(r"^F-?0*(\d+)-?([A-Z])?$", lambda m: f"F-{int(m.group(1))}" + (f" {m.group(2)}" if m.group(2) else ""), s)
    return s


def text_of(row) -> str:
    return " ".join(str(x) for x in (row.get("comments_full"), row.get("state_detail"), row.get("evidence")) if isinstance(x, str))


def build_assets(labels_before: pd.DataFrame, witsml: dict, usrop: dict, engines: list):
    events = labels_before.copy()
    events["text"] = events.apply(text_of, axis=1)
    events["text_l"] = events["text"].str.lower()
    events["is_failure"] = events["category"].isin(FAIL_CATEGORIES)
    events["comp_family"] = events["component"].fillna("").str.split("|").str[0]
    events["comp_label"] = events["comp_family"].map(COMPONENT_LABEL).fillna("")

    field_first = min(v["first"] for v in witsml.values())
    field_last = max(v["last"] for v in witsml.values())
    field_span_h = (field_last - field_first).total_seconds() / 3600.0

    assets = []

    def metrics(sub: pd.DataFrame, span_h: float):
        fails = sub[sub["is_failure"]]
        n_fail = int(len(fails))
        cut = AS_OF - pd.Timedelta(days=365)
        recent = fails[fails["d_start"] > cut]
        cats = Counter(str(c).replace("_", " ") for c in fails["category"]).most_common(1)
        down = float(sub["dur_h"].fillna(0).sum())
        op_h = max(span_h - down, 1.0)
        mtbf = op_h / n_fail if n_fail else None
        mttr = down / n_fail if n_fail else None
        avail = 1.0 - down / span_h if span_h > 0 else None
        frate = (n_fail / op_h * 1000.0) if n_fail else 0.0
        return {
            "event_count": int(len(sub)),
            "failure_count": n_fail,
            "downtime_h": r4(down),
            "operating_h": r4(op_h),
            "mtbf_h": r4(mtbf),
            "mttr_h": r4(mttr),
            "availability": r4(avail),
            "failure_rate_per_1000h": r4(frate),
            "last_event": iso(sub["d_start"].max()) if len(sub) else None,
            "first_event": iso(sub["d_start"].min()) if len(sub) else None,
            "failures_365d": int(len(recent)),
            "top_category": cats[0][0] if cats else None,
        }

    # ---------- aset bawah permukaan: BHA, bit, MWD per wellbore
    for well, w in sorted(witsml.items()):
        wn = norm_well(well)
        sub_well = events[events["wellbore"].map(norm_well) == wn]
        span_h = (w["last"] - w["first"]).total_seconds() / 3600.0
        for suffix, label, comp, engs in [
            ("BHA", "BHA Assembly", "Drill String", ["vib", "ssi", "shk", "stuck"]),
            ("BIT", "Drill Bit", "Drill Bit", ["bit_wear", "shk"]),
            ("MWD", "MWD / LWD Tool", "MWD / LWD Tool", ["tool_wear"]),
        ]:
            sub = sub_well[sub_well["comp_label"] == comp]
            base = metrics(sub, span_h)
            assets.append({
                "id": f"{suffix}-{wn}",
                "name": f"{label} {wn}",
                "type": label,
                "wellbore": wn,
                "location": f"Volve 15/9 {wn}",
                "component": comp,
                "criticality": "A" if suffix == "BHA" else ("B" if suffix == "BIT" else "B"),
                "engines": engs,
                "has_channels": True,
                "span_h": r4(span_h),
                "witsml_rows": w["rows"],
                "first_seen": iso(w["first"]),
                "last_seen": iso(w["last"]),
                **base,
            })

    # ---------- casing / liner per wellbore (komponen dengan event terbanyak)
    for well in sorted({norm_well(x) for x in events["wellbore"]}):
        sub = events[(events["wellbore"].map(norm_well) == well) & (events["comp_label"] == "Casing / Liner")]
        if len(sub) == 0:
            continue
        span_h = field_span_h
        base = metrics(sub, span_h)
        assets.append({
            "id": f"CSG-{well}", "name": f"Casing / Liner {well}", "type": "Casing / Liner",
            "wellbore": well, "location": f"Volve 15/9 {well}", "component": "Casing / Liner",
            "criticality": "A", "engines": [], "has_channels": False, "span_h": r4(span_h),
            "witsml_rows": 0, "first_seen": None, "last_seen": None, **base,
        })

    # ---------- peralatan permukaan (rig level, satu unit per rig)
    for aid, label, pattern in SURFACE_ASSETS:
        sub = events[events["text_l"].str.contains(pattern, regex=True, na=False)]
        base = metrics(sub, field_span_h)
        assets.append({
            "id": aid, "name": label, "type": label, "wellbore": None,
            "location": "Volve rig 15/9-A", "component": label, "criticality": "A",
            "engines": ["hyd"] if label == "Mud Pump" else [],
            "has_channels": False, "span_h": r4(field_span_h), "witsml_rows": 0,
            "first_seen": None, "last_seen": None, **base,
        })

    # ---------- peralatan intervensi (rig level)
    for aid, comp in [("TR-01", "Wireline Tractor"), ("TS-01", "Tool String"), ("PK-01", "Packer"), ("PG-01", "Perforating Gun")]:
        sub = events[events["comp_label"] == comp]
        if len(sub) == 0:
            continue
        base = metrics(sub, field_span_h)
        assets.append({
            "id": aid, "name": comp, "type": comp, "wellbore": None,
            "location": "Volve rig 15/9-A", "component": comp, "criticality": "C",
            "engines": [], "has_channels": False, "span_h": r4(field_span_h), "witsml_rows": 0,
            "first_seen": None, "last_seen": None, **base,
        })

    print(f"aset terbentuk: {len(assets)}")
    return assets, events, field_first, field_last, field_span_h


# ----------------------------------------------------------------------------- sensor dan prediksi

def hour_series(agg: pd.DataFrame, ch: str, n: int = 48):
    col = f"{ch}_mean"
    if col not in agg.columns:
        return []
    s = clean_channel(ch, agg[col].dropna()).tail(n)
    return [r4(v) for v in s.tolist()], [iso(i) for i in s.index]


# Rentang fisik yang masuk akal per kanal, dan faktor satuan bila sumber mencampur unit.
# SPPA tercatat dalam bar dan kPa pada sumur berbeda (250 vs 21.000), TRPM dalam 0,1 rpm.
CHANNEL_RANGE = {
    "SPPA": (0.0, 700.0, 100.0),
    "TRPM": (0.0, 300.0, 10.0),
    "VIBLAT_RT": (0.0, 400.0, None),
    "ATMP_RT": (-20.0, 180.0, None),
    "TQA": (-80.0, 120.0, None),
    "HKLD": (0.0, 1200.0, None),
    "TFLO": (0.0, 8000.0, None),
    "ROP": (0.0, 250.0, None),
    "SHKPK_RT": (0.0, 60.0, None),
    "SHKRSK_RT": (0.0, 60.0, None),
    "STUCK_RT": (0.0, 60.0, None),
    "CRPM_RT": (0.0, 400.0, None),
}
UNIT_FIXES = {}


def clean_channel(ch: str, s: pd.Series) -> pd.Series:
    """Buang nilai di luar rentang fisik dan samakan satuan yang bercampur.

    Tanpa ini ambang warning untuk tekanan menjadi 21.000 bar karena satu sumur
    menulis kPa sementara sumur lain menulis bar.
    """
    lo, hi, div = CHANNEL_RANGE.get(ch, (None, None, None))
    n0 = len(s)
    if div:
        over = s > hi * div * 0.5
        if over.any():
            s = s.copy()
            s[over] = s[over] / div
            UNIT_FIXES[ch] = UNIT_FIXES.get(ch, 0) + int(over.sum())
    if lo is not None:
        s = s[(s >= lo) & (s <= hi)]
    dropped = n0 - len(s)
    if dropped:
        UNIT_FIXES[f"{ch}:dropped"] = UNIT_FIXES.get(f"{ch}:dropped", 0) + dropped
    return s


def channel_stats(agg: pd.DataFrame, ch: str):
    col_mean = f"{ch}_mean"
    col_max = f"{ch}_max"
    if col_mean not in agg.columns:
        return None
    s = clean_channel(ch, agg[col_mean].dropna())
    if s.empty:
        return None
    peak = clean_channel(ch, agg[col_max].dropna()) if col_max in agg.columns else s
    return {
        "n": int(s.shape[0]),
        "p50": r4(s.quantile(0.50)),
        "p95": r4(s.quantile(0.95)),
        "p99": r4(s.quantile(0.99)),
        "last": r4(s.iloc[-1]),
        "last_ts": iso(s.index[-1]),
        "peak": r4(peak.max()),
    }


SYNTH_PARAMS = {
    "Current": ("A", 118.0, 8.0, 150.0, 175.0),
    "Voltage": ("V", 415.0, 6.0, 445.0, 460.0),
    "Acoustic": ("dB", 78.0, 5.0, 92.0, 100.0),
    "Lubrication": ("%", 72.0, 9.0, 40.0, 25.0),
}


def synth_param(rng, asset_id: str, name: str, drift: float):
    unit, mean, sd, warn, crit = SYNTH_PARAMS[name]
    base = rng.normal(mean, sd)
    if name == "Lubrication":
        val = max(0.0, min(100.0, base - drift * 1.6))
        return unit, r4(val), r4(mean), r4(warn), r4(crit), (val <= crit, val <= warn)
    val = base + drift * sd * 2.2
    return unit, r4(val), r4(mean), r4(warn), r4(crit), (val >= crit, val >= warn)


def build_sensors(assets, witsml, rng):
    """Bangun 8 parameter monitor per aset: aktual, normal, warning, critical, status."""
    field_vals = {}
    for ch in ("SPPA", "TFLO", "TRPM"):
        vals = []
        for w in witsml.values():
            col = f"{ch}_mean"
            if col in w["hourly"].columns:
                s = clean_channel(ch, w["hourly"][col].dropna())
                if not s.empty:
                    vals.append(s.tail(720))
        if vals:
            field_vals[ch] = pd.concat(vals)

    for a in assets:
        well = a.get("wellbore")
        agg = witsml[well]["hourly"] if well in witsml else None
        seed = int(hashlib.sha256(f"{SEED}:{a['id']}".encode()).hexdigest()[:8], 16)
        arng = np.random.default_rng(seed)
        drift = float(arng.uniform(0, 1)) * (0.35 if a["criticality"] == "A" else 0.25)

        rows = []
        spec = [
            ("Temperature", "ATMP_RT", 1.0),
            ("Vibration", "VIBLAT_RT", 1.0),
            ("Pressure", "SPPA", 1.0),
            ("Rotary Speed", "TRPM", 1.0),
        ]
        for label, ch, scale in spec:
            st = channel_stats(agg, ch) if agg is not None else None
            if st and st["n"] >= 20:
                cur = st["last"]
                rows.append({
                    "param": label, "unit": CHANNELS[ch][1],
                    "actual": cur, "normal": st["p50"], "warning": st["p95"], "critical": st["p99"],
                    "status": status_from(cur, st["p50"], st["p95"], st["p99"]),
                    "direction": "naik",
                    "source": "TERUKUR", "n": st["n"], "peak": st["peak"], "ts": st["last_ts"],
                    "note": CHANNELS[ch][3],
                })
            elif ch in field_vals and label == "Pressure":
                s = field_vals[ch].dropna()
                p50, p95, p99 = s.quantile(.5), s.quantile(.95), s.quantile(.99)
                cur = float(s.iloc[-1])
                rows.append({
                    "param": label, "unit": "bar", "actual": r4(cur), "normal": r4(p50),
                    "warning": r4(p95), "critical": r4(p99),
                    "status": status_from(cur, p50, p95, p99), "direction": "naik", "source": "TURUNAN",
                    "n": int(s.shape[0]), "peak": r4(s.max()), "ts": iso(s.index[-1]),
                    "note": "nilai lapangan gabungan, aset ini tidak punya kanal sendiri",
                })
            else:
                # aset tanpa kanal: batas diturunkan dari profil normal tipe peralatan itu,
                # bukan dari data sumur ini, sehingga sumbernya tetap jelas
                unit = {"Temperature": "C", "Vibration": "m/s2", "Pressure": "bar", "Rotary Speed": "rpm"}[label]
                span = {"Temperature": (62.0, 78.0, 88.0), "Vibration": (2.4, 4.6, 7.2),
                        "Pressure": (120.0, 160.0, 190.0), "Rotary Speed": (95.0, 130.0, 150.0)}[label]
                mean, warn, crit = span
                val = mean + drift * (crit - mean) * 0.55 + arng.normal(0, (crit - mean) * 0.06)
                rows.append({
                    "param": label, "unit": unit, "actual": r4(val), "normal": r4(mean),
                    "warning": r4(warn), "critical": r4(crit),
                    "status": status_from(val, mean, warn, crit), "direction": "naik", "source": "SINTETIS",
                    "n": 0, "peak": None, "ts": None,
                    "note": "aset ini tidak punya kanal, nilai dibangkitkan dengan seed tetap",
                })

        for name in ("Current", "Voltage", "Acoustic", "Lubrication"):
            unit, val, mean, warn, crit, (c_crit, c_warn) = synth_param(arng, a["id"], name, drift)
            rows.append({
                "param": name, "unit": unit, "actual": val, "normal": mean,
                "warning": warn, "critical": crit,
                "status": "critical" if c_crit else ("warning" if c_warn else "normal"),
                "direction": "turun" if name == "Lubrication" else "naik",
                "source": "SINTETIS", "n": 0, "peak": None, "ts": None,
                "note": "tidak ada sensor di data publik, dibangkitkan dengan seed tetap",
            })
        a["sensors"] = rows

        # seri waktu untuk grafik: pakai kanal nyata bila ada, sisanya sintetis ber-seed
        series = []
        for label, ch in [("Vibration", "VIBLAT_RT"), ("Temperature", "ATMP_RT"),
                          ("Pressure", "SPPA"), ("Rotary Speed", "TRPM"), ("Torque", "TQA")]:
            if agg is not None:
                vals, ts = hour_series(agg, ch, 48)
                if len(vals) >= 8:
                    series.append({"param": label, "unit": CHANNELS[ch][1], "src": "TERUKUR", "t": ts, "v": vals})
                    continue
            t0 = AS_OF - pd.Timedelta(hours=47)
            base = {"Vibration": 3.2, "Temperature": 68.0, "Pressure": 140.0,
                    "Rotary Speed": 110.0, "Torque": 6.5}[label]
            amp = {"Vibration": 1.4, "Temperature": 6.0, "Pressure": 18.0,
                   "Rotary Speed": 9.0, "Torque": 1.8}[label]
            vals = [r4(base + amp * (drift * 0.6 + 0.25 * math.sin(i / 5.0)) + arng.normal(0, amp * 0.12))
                    for i in range(48)]
            series.append({"param": label, "unit": {"Vibration": "m/s2", "Temperature": "C", "Pressure": "bar",
                                                   "Rotary Speed": "rpm", "Torque": "kN.m"}[label],
                           "src": "SINTETIS", "t": [iso(t0 + pd.Timedelta(hours=i)) for i in range(48)], "v": vals})
        a["series"] = series
    return assets


def weibull_table(events: pd.DataFrame):
    table = {}
    fam = events[events["is_failure"] & events["comp_label"].ne("")]
    for comp, g in fam.groupby("comp_label"):
        t = (g["d_start"].sort_values().diff().dt.total_seconds() / 3600.0).dropna()
        t = t[t > 1].to_numpy()
        if len(t) >= 5:
            fit = weibull_fit_min(None, None, t)
            if fit:
                table[comp] = {"beta": r4(fit[0]), "eta": r4(fit[1]), "n": int(len(t)), "borrowed": False}
    allt = (fam.sort_values("d_start")["d_start"].diff().dt.total_seconds() / 3600.0).dropna()
    allt = allt[allt > 1].to_numpy()
    pooled = weibull_fit_min(None, None, allt) if len(allt) >= 5 else None
    pooled_entry = {"beta": r4(pooled[0]), "eta": r4(pooled[1]), "n": int(len(allt)), "borrowed": True} if pooled else None
    for a in {c for c in COMPONENT_LABEL.values()}:
        if a not in table and pooled_entry:
            table[a] = dict(pooled_entry)
    print(f"Weibull: {len([k for k,v in table.items() if not v['borrowed']])} komponen fit sendiri, "
          f"{len([k for k,v in table.items() if v['borrowed']])} meminjam parameter gabungan")
    return table


def predict(assets, wtable, engines, events):
    eng_by_well = defaultdict(list)
    for e in engines:
        for f in e.get("folds") or []:
            eng_by_well[norm_well(f["well"])].append({
                "engine": e["engine"], "name": e.get("display_name", e["engine"]),
                "auprc": (f.get("models", {}).get("rf") or {}).get("auprc"),
                "tier": next((h.get("tier") for h in (e.get("heads") or []) if h.get("tier")), None),
            })

    for a in assets:
        comp = a["component"]
        wi = wtable.get(comp) or wtable.get("Drill String") or {"beta": 1.8, "eta": 26000.0, "n": 0, "borrowed": True}
        # beta < 1 menandakan hazard menurun (kegagalan dini), bukan keausan.
        # Untuk RUL dipakai batas bawah 1,0 supaya kurva tidak naik sendiri.
        beta, eta = max(float(wi["beta"]), 1.0), float(wi["eta"])

        anomalies = []
        for s in a["sensors"]:
            if s["source"] != "TERUKUR" or s["warning"] in (None, 0) or s["normal"] is None:
                continue
            denom = max(abs(s["warning"] - s["normal"]), 1e-9)
            anomalies.append(abs((s["actual"] - s["normal"]) / denom))
        if anomalies:
            z = min(max(anomalies), 3.5)
            anomaly = round(100.0 * (1.0 - math.exp(-z / 1.6)), 1)
            anomaly_source = "TERUKUR"
        else:
            # tanpa kanal, anomali diturunkan dari kejadian nyata 12 bulan terakhir
            # dibanding laju jangka panjang aset itu
            expected = max((a.get("failure_rate_per_1000h") or 0.0) * 8.76, 0.4)
            last = pd.Timestamp(a["last_event"]) if a.get("last_event") else None
            recency = 0.0 if last is None or (AS_OF - last).days > 365 else                 40.0 * (1 - (AS_OF - last).days / 365.0)
            anomaly = round(min(100.0, 30.0 * (a.get("failures_365d") or 0) / expected + recency), 1)
            anomaly_source = "TURUNAN"

        # umur diukur dalam jam operasi, bukan jam dinding: aset yang berhenti dipakai
        # bertahun-tahun tidak menua seperti aset yang terus berputar
        first_seen = pd.Timestamp(a["first_seen"]) if a.get("first_seen") else AS_OF - pd.Timedelta(days=365)
        span_h = max((AS_OF - first_seen).total_seconds() / 3600.0, 1.0)
        last_fail = pd.Timestamp(a["last_event"]) if a.get("last_event") else None
        frac = 1.0 if last_fail is None else min(1.0, max(0.0,
            (AS_OF - last_fail).total_seconds() / 3600.0 / span_h))
        age = max((a.get("operating_h") or span_h) * frac, 1.0)

        # eta dari tabel komponen adalah jarak antar-kegagalan se-lapangan (jam), jauh lebih
        # pendek daripada umur satu aset. Untuk RUL dipakai MTBF aset itu sendiri bila ada.
        eta_base = a.get("mtbf_h") if (a.get("mtbf_h") or 0) >= 168 else eta
        eta_base = max(eta_base or 0.0, 720.0)
        if not a.get("failure_count"):
            # tidak ada bukti kegagalan pada aset ini: pakai default satu tahun, bukan 5 hari
            eta_base = max(eta_base, 8760.0)
        eta_eff = max(eta_base * (1.0 - 0.35 * anomaly / 100.0), 168.0)
        age = min(age, eta_eff * 3.0)
        # peluang selamat sampai h jam ke depan, dihitung dari umur sekarang
        def surv(h, age=age, eta_eff=eta_eff, beta=beta):
            return math.exp(-((((age + h) / eta_eff) ** beta) - ((age / eta_eff) ** beta)))
        p7 = max(0.0, min(0.99, 1.0 - surv(168)))
        p30 = max(0.0, min(0.99, 1.0 - surv(720)))
        rul = max(0.0, eta_eff - age)
        spread = 0.25 + 0.5 / max(wi["n"], 1)
        rul_lo = max(0.0, rul * (1 - spread))
        rul_hi = rul * (1 + spread)

        eng = (eng_by_well.get(norm_well(a["wellbore"])) or []) if a.get("wellbore") else []
        best_auprc = max([x["auprc"] for x in eng if x.get("auprc") is not None], default=None)
        n_complete = sum(1 for s in a["sensors"] if s["source"] == "TERUKUR")
        conf = 0.55 + 0.02 * min(a["failure_count"], 12) + 0.03 * n_complete
        conf = round(min(0.97, conf), 3)

        # status mengikuti bukti saat ini (probabilitas dan simpangan kanal), bukan umur saja.
        # Umur yang melewati MTBF dicatat terpisah sebagai overdue_mtbf.
        overdue = bool(rul <= 0)
        # ambang mengikuti sebaran data lapangan ini: probabilitas 7 hari tertinggi 0,24,
        # jadi ambang 0,5 tidak akan pernah tercapai
        if p7 >= 0.18 or (anomaly >= 66 and p7 >= 0.09):
            risk, status = "Critical", "critical"
        elif p7 >= 0.09 or anomaly >= 50:
            risk, status = "High", "warning"
        elif p7 >= 0.05 or anomaly >= 33:
            risk, status = "Medium", "warning"
        else:
            risk, status = "Low", "healthy"

        if anomaly_source == "TERUKUR":
            top = max(a["sensors"], key=lambda s: abs((s["actual"] or 0) - (s["normal"] or 0)) / max(abs((s["warning"] or 1) - (s["normal"] or 0)), 1e-9))
        else:
            top = next((s for s in a["sensors"] if s["param"] == "Temperature"), a["sensors"][0])
        mode = FAILURE_TYPES.get(top["param"], a.get("top_category") or "Condition drift")
        if eng:
            eng_sorted = sorted(eng, key=lambda x: (x.get("auprc") is not None, x.get("auprc") or 0), reverse=True)
            mode = f"{ENGINE_LABEL.get(eng_sorted[0]['engine'], eng_sorted[0]['name'])} degradation"

        root = {
            "Vibration": "Getaran lateral di atas pita normal, indikasi ketidakseimbangan atau bantalan aus",
            "Shock Peak": "Puncak kejutan tinggi, indikasi bit bounce atau formasi keras",
            "Temperature": "Suhu anulus naik, indikasi gesekan atau pendinginan lumpur kurang",
            "Pressure": "Tekanan standpipe menyimpang, indikasi sumbatan atau pompa lumpur",
            "Rotary Speed": "Fluktuasi putaran, indikasi stick-slip",
            "Current": "Arus motor naik, indikasi beban berlebih",
            "Voltage": "Tegangan tidak stabil, indikasi suplai listrik",
            "Acoustic": "Kebisingan naik, indikasi gesekan mekanis",
            "Lubrication": "Level pelumasan turun, indikasi keausan dipercepat",
        }.get(top["param"], "Penyimpangan kondisi terhadap baseline 30 hari")

        action = {
            "Critical": "Inspeksi dan penggantian komponen dalam 7 hari",
            "High": "Inspeksi terjadwal dalam 14 hari",
            "Medium": "Pantau dan jadwalkan inspeksi 30 hari",
            "Low": "Pemantauan rutin",
        }[risk]

        a.update({
            "anomaly": anomaly,
            "failure_prob_7d": r4(p7),
            "failure_prob_30d": r4(p30),
            "rul_h": r4(rul),
            "rul_lo_h": r4(rul_lo),
            "rul_hi_h": r4(rul_hi),
            "rul_days": r4(rul / 24.0),
            "risk_class": risk,
            "status": status,
            "confidence": conf,
            "failure_mode": mode,
            "root_cause": root,
            "top_param": top["param"],
            "detection_method": "Ambang kanal + skor anomali" if n_complete else "Ambang kanal + riwayat kegagalan",
            "recommended_action": action,
            "eta_eff_h": r4(eta_eff), "age_h": r4(age),
            "weibull": {"beta": r4(beta), "eta": r4(eta), "eta_eff": r4(eta_eff), "n": wi["n"],
                        "borrowed": wi["borrowed"],
                        "beta_clamped": bool(beta < 1.0)},
            "engine_auprc": r4(best_auprc) if best_auprc is not None else None,
            "engines_detail": eng[:4],
            "health": round(max(0.0, min(100.0, 100.0 * (1 - 0.55 * p7 - 0.25 * anomaly / 100.0 - 0.20 * (1 - (a["availability"] or 0))))), 1),
        })
    return assets


# ----------------------------------------------------------------------------- lapisan operasional sintetis

def build_work_orders(assets, events, rng):
    """Work order: riwayat dari event nyata, terbuka dari prediksi. Semua ber-rujukan."""
    wos = []
    admin_rng = np.random.default_rng(SEED + 7)

    def money(dur_h, comp):
        spa = SPARES.get(comp, [("Consumable kit", 1)])
        spare_cost = 900 * spa[0][1] + 250
        return r4(dur_h * RIG_HOUR_RATE_USD + dur_h * LABOR_USD_PER_H * 2 + spare_cost), spa

    # rujukan aset: sumur + komponen untuk aset bawah permukaan, jenis untuk aset permukaan.
    # Tanpa ini riwayat nyata tidak bisa dibuka dari halaman aset mana pun.
    by_well_comp = {(a["wellbore"], a["component"]): a for a in assets if a.get("wellbore")}
    by_type = {a["type"]: a for a in assets if not a.get("wellbore")}

    def resolve(row):
        label = COMPONENT_LABEL.get(str(row["component"]).split("|")[0], "")
        wn = norm_well(row["wellbore"])
        return by_well_comp.get((wn, label)) or by_type.get(label), label or "Rig equipment"

    # riwayat dari event nyata (200 terakhir supaya payload wajar)
    hist = events[events["is_failure"]].sort_values("d_start").tail(200)
    for i, (_, e) in enumerate(hist.iterrows()):
        dur = float(e["dur_h"]) if pd.notna(e["dur_h"]) else 2.0
        target, label = resolve(e)
        cost, spa = money(dur, label)
        wos.append({
            "wo_id": f"WO-H{i+1:04d}",
            "asset_id": target["id"] if target else None,
            "asset_name": target["name"] if target else label,
            "wellbore": norm_well(e["wellbore"]),
            "problem": FAILURE_TYPES.get(str(e["category"]), str(e["category"]).replace("_", " ")),
            "priority": "High" if e["bha_relevant"] == "yes" else ("Medium" if e["category"] != "routine_no_failure_evidence" else "Low"),
            "action": "Perbaikan komponen sesuai laporan operasi",
            "status": "Completed",
            "created": iso(e["d_start"]),
            "due": iso(e["d_start"] + pd.Timedelta(hours=24)),
            "closed": iso(e["d_end"]),
            "est_duration_h": r4(dur),
            "spare": f"{spa[0][0]} x{spa[0][1]}",
            "technician": TECHNICIANS[i % len(TECHNICIANS)],
            "cost_usd": cost,
            "source": f"event:{int(e['event_id'])}",
            "event_id": int(e["event_id"]),
            "layer": "SINTETIS",
        })

    # work order terbuka dari prediksi
    open_assets = [a for a in assets if a["risk_class"] in ("Critical", "High", "Medium")]
    open_assets.sort(key=lambda a: ({"Critical": 0, "High": 1, "Medium": 2}[a["risk_class"]], -(a["failure_prob_7d"] or 0)))
    statuses = ["Overdue", "Pending", "Scheduled", "In Progress", "Pending", "Scheduled"]
    for i, a in enumerate(open_assets):
        dur = float(a["mttr_h"] or 4.0)
        cost, spa = money(dur, a["component"])
        days = {"Critical": 2, "High": 7, "Medium": 21}[a["risk_class"]]
        due = AS_OF + pd.Timedelta(days=days)
        st = statuses[i % len(statuses)]
        if st == "Overdue":
            due = AS_OF - pd.Timedelta(days=2 + (i % 5))
        created = AS_OF - pd.Timedelta(days=3 + (i % 10))
        wos.append({
            "wo_id": f"WO-O{i+1:04d}",
            "asset_id": a["id"],
            "asset_name": a["name"],
            "wellbore": a.get("wellbore"),
            "problem": a["failure_mode"],
            "priority": {"Critical": "Critical", "High": "High", "Medium": "Medium"}[a["risk_class"]],
            "action": a["recommended_action"],
            "status": st,
            "created": iso(created),
            "due": iso(due),
            "closed": None,
            "est_duration_h": r4(dur),
            "spare": f"{spa[0][0]} x{spa[0][1]}",
            "technician": TECHNICIANS[i % len(TECHNICIANS)],
            "cost_usd": cost,
            "source": f"prediction:{a['id']}",
            "layer": "SINTETIS",
        })

    # work order preventif terjadwal
    for i, a in enumerate([x for x in assets if x["risk_class"] == "Low"][:12]):
        dur = 3.0
        cost, spa = money(dur, a["component"])
        wos.append({
            "wo_id": f"WO-P{i+1:04d}", "asset_id": a["id"], "asset_name": a["name"],
            "wellbore": a.get("wellbore"), "problem": "Preventive inspection",
            "priority": "Low", "action": "Inspeksi berkala sesuai interval",
            "status": "Scheduled", "created": iso(AS_OF - pd.Timedelta(days=12)),
            "due": iso(AS_OF + pd.Timedelta(days=30)), "closed": None,
            "est_duration_h": dur, "spare": "Tidak ada", "technician": TECHNICIANS[(i + 3) % len(TECHNICIANS)],
            "cost_usd": cost, "source": "schedule", "layer": "SINTETIS",
        })
    return wos


def build_alerts(assets, wos, rng):
    alerts = []
    rng2 = np.random.default_rng(SEED + 11)
    for a in assets:
        for s in a["sensors"]:
            if s["status"] in ("critical", "warning"):
                t = AS_OF - pd.Timedelta(hours=int(rng2.integers(0, 72)))
                alerts.append({
                    "time": iso(t), "asset_id": a["id"], "asset": a["name"],
                    "alert": f"{s['param']} {s['status']}",
                    "detail": f"nilai {s['actual']} {s['unit']}, batas warning {s['warning']}, batas critical {s['critical']}",
                    "severity": "Critical" if s["status"] == "critical" else "Warning",
                    "source": s["source"],
                    "ack": bool(rng2.random() < 0.45),
                })
    for a in assets:
        if (a["anomaly"] or 0) >= 60:
            alerts.append({
                "time": iso(AS_OF - pd.Timedelta(hours=int(rng2.integers(1, 40)))),
                "asset_id": a["id"], "asset": a["name"],
                "alert": "Anomaly score tinggi",
                "detail": f"skor {a['anomaly']} dari kanal {a['top_param']}, "
                          f"probabilitas kegagalan 7 hari {a['failure_prob_7d']}",
                "severity": "Critical" if a["risk_class"] == "Critical" else "Warning",
                "source": "TURUNAN", "ack": bool(rng2.random() < 0.4),
            })
    for w in wos:
        if w["status"] != "Completed" and w.get("due") and pd.Timestamp(w["due"]) <= AS_OF + pd.Timedelta(days=2):
            alerts.append({
                "time": w["due"], "asset_id": w["asset_id"], "asset": w["asset_name"],
                "alert": "Jatuh tempo maintenance", "detail": f"{w['wo_id']} jatuh tempo {w['due'][:10]}",
                "severity": "Warning", "source": "SINTETIS", "ack": False,
            })
    for w in wos:
        if w["status"] == "Overdue":
            alerts.append({
                "time": w["due"], "asset_id": w["asset_id"], "asset": w["asset_name"],
                "alert": "Work order overdue", "detail": f"{w['wo_id']} lewat jatuh tempo",
                "severity": "Critical", "source": "SINTETIS", "ack": False,
            })
    alerts.sort(key=lambda x: x["time"], reverse=True)
    return alerts[:80]


def spc_exceptions(witsml):
    """Aturan Western Electric 1: titik di luar 3 sigma dari baseline sebelumnya (nyata)."""
    out = []
    for well, w in sorted(witsml.items()):
        agg = w["hourly"]
        for ch in ("SPPA", "VIBLAT_RT", "TQA"):
            col = f"{ch}_mean"
            if col not in agg.columns:
                continue
            s = agg[col].dropna()
            if len(s) < 200:
                continue
            mu, sd = s.mean(), s.std()
            if not sd or math.isnan(sd):
                continue
            hits = s[(s - mu).abs() > 3 * sd]
            if len(hits) < 3 or sd < abs(mu) * 0.02:
                continue
            recent = hits[hits.index >= AS_OF - pd.Timedelta(days=90)]
            out.append({
                "wellbore": well, "channel": CHANNELS.get(ch, (ch,))[0],
                "n_points": int(len(hits)),
                "n_points_90d": int(len(recent)),
                "last_time": iso(hits.index[-1]),
                "last_value": r4(hits.iloc[-1]),
                "baseline_mean": r4(mu), "baseline_sd": r4(sd),
                "rule": "Western Electric 1 (di luar 3 sigma)",
                "source": "TERUKUR",
            })
    return out


def monthly_stats(events, witsml, wos):
    """Dua deret waktu terpisah karena rentang datanya berbeda.

    Telemetri WITSML berakhir 2009, sedangkan log kejadian berjalan sampai 2015.
    OEE dihitung dari bulan yang punya telemetri. Tren kegagalan dihitung dari bulan
    yang punya kejadian. Menggabungkan keduanya menghasilkan OEE nol pada bulan tanpa data.
    """
    fails = events[events["is_failure"]].copy()
    fails["mkey"] = fails["d_start"].dt.strftime("%Y-%m")
    fcount = fails.groupby("mkey").size().to_dict()
    fdown = fails.groupby("mkey")["dur_h"].apply(lambda s: float(s.fillna(0).sum())).to_dict()

    rop_all, active_all, window_all = [], {}, {}
    for well, w in witsml.items():
        agg = w["hourly"]
        if "ROP_mean" in agg.columns:
            rop_all.append(agg["ROP_mean"].dropna())
        parts = []
        for col, thr in (("ROP_mean", 0.5), ("TRPM_mean", 5.0), ("HKLD_mean", 5.0),
                         ("TFLO_mean", 20.0), ("SPPA_mean", 50.0)):
            if col in agg.columns:
                parts.append(agg[col].fillna(0) > thr)
        act = pd.concat(parts, axis=1).any(axis=1).astype(float) if parts \
            else pd.Series(0, index=agg.index, dtype=float)
        active_all[well] = act
        window_all[well] = (w["first"], w["last"])
    rop = pd.concat(rop_all) if rop_all else pd.Series(dtype=float)
    target = float(rop.quantile(0.90)) if len(rop) else 30.0

    first_tel = min(w["first"] for w in witsml.values())
    last_tel = max(w["last"] for w in witsml.values())
    tel_months = pd.date_range(first_tel.normalize().replace(day=1),
                               last_tel.normalize().replace(day=1), freq="MS", tz="UTC")
    out = []
    for m in tel_months:
        m_end = m + pd.offsets.MonthEnd(1)
        # hanya jam di dalam jendela pengeboran sumur itu yang dihitung sebagai waktu terencana,
        # supaya bulan tanpa data tidak terbaca sebagai mesin mati
        w_active, w_window, w_down, w_rop = 0.0, 0.0, 0.0, []
        for well, act in active_all.items():
            w0, w1 = window_all[well]
            lo, hi = max(m, w0), min(m_end, w1)
            if hi <= lo:
                continue
            span_h = (hi - lo).total_seconds() / 3600.0
            if span_h < 200:
                continue
            seg = act[(act.index >= lo) & (act.index <= hi)]
            w_window += span_h
            w_active += float(seg.sum())
            w_rop.append(rop[(rop.index >= lo) & (rop.index <= hi)])
        if w_window <= 0:
            # bulan tanpa jendela pengeboran tetap ditulis supaya sumbu waktu tidak bolong;
            # nilainya null, bukan nol, karena tidak ada pengukuran
            out.append({"month": m.strftime("%Y-%m"), "failures": int(fcount.get(m.strftime("%Y-%m"), 0)),
                        "downtime_h": r4(float(fdown.get(m.strftime("%Y-%m"), 0.0))),
                        "active_ratio": None, "performance": None, "quality": None,
                        "oee": None, "window_h": 0.0})
            continue
        A = min(1.0, w_active / w_window)
        seg_rop = pd.concat(w_rop) if w_rop else pd.Series(dtype=float)
        P = float(seg_rop.median() / target) if len(seg_rop) and target else 0.0
        P = min(max(P, 0.0), 1.0)
        down = float(fdown.get(m.strftime("%Y-%m"), 0.0))
        Q = max(0.0, 1.0 - down / max(w_active, 1.0))
        out.append({
            "month": m.strftime("%Y-%m"),
            "failures": int(fcount.get(m.strftime("%Y-%m"), 0)),
            "downtime_h": r4(down),
            "active_ratio": r4(A),
            "performance": r4(P),
            "quality": r4(Q),
            "oee": r4(A * P * Q),
            "window_h": r4(w_window),
        })

    # MTBF bulanan dipisah dari OEE karena penyebutnya berbeda: jam operasi jendela
    # pengeboran dibagi kegagalan pada bulan yang sama
    mtbf_series = []
    for m in out:
        fm = m.get("failures")
        op = m.get("window_h")
        if fm is None:
            continue
        mtbf_series.append({
            "month": m["month"],
            "mtbf_h": r4(op / fm) if (fm and op) else None,
            "operating_h": r4(op),
            "failures": int(fm),
        })

    ev_months = pd.date_range(fails["d_start"].min().normalize().replace(day=1),
                              AS_OF.normalize().replace(day=1), freq="MS", tz="UTC")
    fail_series = [{"month": m.strftime("%Y-%m"),
                    "failures": int(fcount.get(m.strftime("%Y-%m"), 0)),
                    "downtime_h": r4(fdown.get(m.strftime("%Y-%m"), 0.0))}
                   for m in ev_months]
    return out, r4(target), fail_series, mtbf_series


def build_payload():
    print("baca label...")
    labels_all, labels_before, labels_after = read_labels()
    print("baca witsml (ini bagian terlama)...")
    witsml = read_witsml()
    usrop = read_usrop()
    engines = read_engines()

    assets, events, field_first, field_last, field_span_h = build_assets(labels_before, witsml, usrop, engines)

    print("susun sensor...")
    rng = np.random.default_rng(SEED)
    build_sensors(assets, witsml, rng)

    print("fit Weibull...")
    wtable = weibull_table(events)
    print("hitung prediksi...")
    predict(assets, wtable, engines, events)

    print("bangun work order dan alert...")
    wos = build_work_orders(assets, events, rng)
    alerts = build_alerts(assets, wos, rng)
    exceptions = spc_exceptions(witsml)
    monthly, rop_target, fail_series, mtbf_trend = monthly_stats(events, witsml, wos)

    # ---------------- ringkasan
    total = len(assets)
    healthy = sum(1 for a in assets if a["status"] == "healthy")
    warning = sum(1 for a in assets if a["status"] == "warning")
    critical = sum(1 for a in assets if a["status"] == "critical")
    predicted = sum(1 for a in assets if (a["failure_prob_30d"] or 0) >= 0.5)
    due7 = sum(1 for w in wos if w["status"] != "Completed" and w["due"] and pd.Timestamp(w["due"]) <= AS_OF + pd.Timedelta(days=7))
    overdue = sum(1 for w in wos if w["status"] == "Overdue")
    open_wos = [w for w in wos if w["status"] != "Completed"]
    open_actions = len(open_wos)
    high_actions = sum(1 for w in open_wos if w["priority"] in ("Critical", "High"))
    avails = [a["availability"] for a in assets if a["availability"] is not None]
    availability = sum(avails) / len(avails) if avails else None
    def _med(rows):
        vals = sorted(x["oee"] for x in rows if x["oee"] is not None)
        return r4(vals[len(vals) // 2]) if vals else None

    oee_last = _med(monthly[-6:])
    oee_prev = _med(monthly[-12:-6])

    chronic = []
    for comp, g in events[events["is_failure"]].groupby([events["wellbore"].map(norm_well), "comp_label"]):
        well, label = comp
        if not label or len(g) < 3:
            continue
        sev = "S3" if len(g) >= 10 else ("S2" if len(g) >= 6 else "S1")
        chronic.append({
            "wellbore": norm_well(well), "component": label, "count": int(len(g)),
            "severity": sev, "downtime_h": r4(g["dur_h"].fillna(0).sum()),
            "first": iso(g["d_start"].min()), "last": iso(g["d_start"].max()),
            "source": "TERUKUR",
        })
    chronic.sort(key=lambda x: (-x["count"], x["wellbore"]))
    sev_count = Counter(c["severity"] for c in chronic)

    control = {
        "detection": r4(min(1.0, 0.62 + 0.03 * len(alerts) / 10)),
        "standardization": 0.92,
        "response": r4(min(1.0, 0.55 + 0.02 * len(wos) / 10)),
        "closure": r4(sum(1 for w in wos if w["status"] == "Completed") / max(len(wos), 1)),
    }

    # top drivers: kanal dengan simpangan terbesar terhadap baseline minggu sebelumnya
    # satu sumbu dan satu parameter hanya muncul sekali, supaya tidak ada tiga baris identik
    drivers, seen = [], set()
    for a in sorted(assets, key=lambda x: (-(x["anomaly"] or 0), x["id"])):
        key = (a.get("wellbore"), a["top_param"])
        if key in seen:
            continue
        seen.add(key)
        s = next((x for x in a["sensors"] if x["param"] == a["top_param"]), None)
        drivers.append({
            "asset": a["name"], "asset_id": a["id"], "param": a["top_param"],
            "anomaly": a["anomaly"], "impact_pct": r4(-(a["anomaly"] or 0) / 100.0 * 0.42),
            "value": s["actual"] if s else None, "unit": s["unit"] if s else "",
            "warning": s["warning"] if s else None, "source": s["source"] if s else None,
            "ts": s["ts"] if s else None,
            "evidence": f"{a['top_param']} {s['actual'] if s else ''} {s['unit'] if s else ''} pada {a['name']}",
        })
        if len(drivers) == 5:
            break

    health_weights = {"A": 3.0, "B": 2.0, "C": 1.0}
    num = sum(a["health"] * health_weights[a["criticality"]] for a in assets)
    den = sum(health_weights[a["criticality"]] for a in assets)
    plant_health = r4(num / den) if den else None

    payload = {
        "meta": {
            "as_of": iso(AS_OF),
            "telemetry_last": iso(max(w["last"] for w in witsml.values())),
            "seed": SEED,
            "field": "Volve, blok 15/9, Laut Utara",
            "operator": "Halliburton Sperry Drilling",
            "rig_day_rate_usd": RIG_DAY_RATE_USD,
            "real_events": int(len(events)),
            "real_events_after_asof": int(len(labels_after)),
            "witsml_rows": int(sum(w["rows"] for w in witsml.values())),
            "rop_target": rop_target,
            "layers": {
                "TERUKUR": "dibaca langsung dari berkas capstone",
                "TURUNAN": "dihitung dari data terukur",
                "SINTETIS": f"dibangkitkan dengan seed {SEED}",
            },
            "sources": [
                "data/volve/labels_curated_v2.csv",
                "data/volve/witsml_parsed/*.csv",
                "data/USROP_health.csv",
                "scratch/v9_i1/v9_i1_RESULTS.json",
                "data/pm_full.json",
            ],
            "asof_rule": "tidak ada nilai setelah as_of yang dipakai sebagai fitur",
            "data_fixes": dict(sorted(UNIT_FIXES.items())),
        },
        "overview": {
            "plant_health": plant_health,
            "total": total, "healthy": healthy, "warning": warning, "critical": critical,
            "predicted_failures": predicted, "predicted_horizon_days": 30,
            "maintenance_due": due7, "overdue": overdue,
            "open_actions": open_actions, "high_actions": high_actions,
            "open_exceptions": len(exceptions), "open_chronic": len(chronic),
            "chronic_high": sev_count.get("S3", 0) + sev_count.get("S2", 0),
            "machine_availability": r4(availability),
            "oee": oee_last, "oee_prev": oee_prev,
            "plan_adherence": r4(control["closure"] * 100),
            "due_now": due7 + overdue,
        },
        "control_loop": control,
        "drivers": drivers,
        "chronic": chronic,
        "chronic_severity": {k: int(v) for k, v in sev_count.items()},
        "monthly": monthly,
        "exceptions": exceptions,
        "assets": assets,
        "work_orders": wos,
        "alerts": alerts,
        "weibull": wtable,
        "engines": [
            {"engine": e["engine"], "name": e.get("display_name", e["engine"]),
             "kind": e.get("kind"), "n_folds": len(e.get("folds") or []),
             "rf_median": (e.get("rf_range") or {}).get("median"),
             "rf_min": (e.get("rf_range") or {}).get("min"),
             "rf_max": (e.get("rf_range") or {}).get("max"),
             "n_heads": e.get("n_heads"),
             "claim": e.get("klaim_tugas")}
            for e in engines
        ],
        "usrop": usrop,
        "events_recent": [
            {"id": int(r["event_id"]), "wellbore": r["wellbore"], "date": iso(r["d_start"]),
             "category": r["category"], "component": r["component"],
             "duration_h": r4(r["dur_h"]), "bha_relevant": r["bha_relevant"],
             "comment": (str(r["comments_trunc300"])[:120] if pd.notna(r["comments_trunc300"]) else "")}
            for _, r in events.sort_values("d_start", ascending=False).head(120).iterrows()
        ],
    }

    payload = build_sections(payload, assets, events, wos, alerts, monthly, fail_series, mtbf_trend, witsml)

    # ---------------- validasi
    errors = []
    if healthy + warning + critical != total:
        errors.append("jumlah status tidak sama dengan total aset")
    if abs((plant_health or 0)) > 100:
        errors.append("health index di luar 0-100")
    for a in assets:
        for k in ("failure_prob_7d", "failure_prob_30d"):
            v = a.get(k)
            if v is None or not (0 <= v <= 1):
                errors.append(f"{a['id']} {k} tidak valid: {v}")
        if a["mtbf_h"] is not None and a["failure_count"]:
            calc = a["operating_h"] / a["failure_count"]
            if abs(calc - a["mtbf_h"]) > 0.05:
                errors.append(f"{a['id']} MTBF tidak konsisten")
    for a in assets:
        for s in a["series"]:
            if s["t"] and pd.Timestamp(s["t"][-1]) > AS_OF:
                errors.append(f"{a['id']} seri melewati tanggal acuan")
    for w in wos:
        if w["created"] and pd.Timestamp(w["created"]) > AS_OF + pd.Timedelta(days=1):
            errors.append(f"{w['wo_id']} dibuat setelah tanggal acuan")
    # Hasil model capstone disalin apa adanya dari data/pm_full.json agar halaman
    # tidak mengarang angka kinerja model di sisi JavaScript.
    try:
        pf = json.loads((DATA / "pm_full.json").read_text())
        ov = pf.get("overview", {})
        payload["models"] = {
            "pooled": ov.get("pooled", {}),
            "pr_curve": ov.get("pr_curve", {}),
            "meta": {
                "target": ov.get("meta", {}).get("target"),
                "target_note": ov.get("meta", {}).get("target_note"),
                "protocol": ov.get("meta", {}).get("protocol"),
                "model": ov.get("meta", {}).get("model"),
                "source_rows": ov.get("meta", {}).get("source_rows"),
            },
            "folds": [
                {"label": f.get("label"), "well": f.get("well"), "n": f.get("n"),
                 "n_pos": f.get("n_pos"), "prev": f.get("prev")}
                for f in ov.get("folds", [])
            ],
            "engines_meta": pf.get("meta", {}),
        }
    except Exception as exc:  # noqa: BLE001
        payload["models"] = {"error": str(exc)}

    payload["meta"]["validation"] = {"errors": errors, "n_errors": len(errors)}

    jp = DATA / "plant.json"
    js = DATA / "plant.js"
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    jp.write_text(text)
    js.write_text("window.PLANT = " + text + ";\n")
    (DATA / "plant.built.txt").write_text(
        f"built_utc={datetime.now(timezone.utc).isoformat()}\nsha256={hashlib.sha256(text.encode()).hexdigest()}\n")
    h = hashlib.sha256(text.encode()).hexdigest()[:16]
    print(f"payload {jp} {len(text)/1024:.0f} KB sha256 {h}")
    print(f"aset {total} | sehat {healthy} warning {warning} critical {critical}")
    print(f"WO {len(wos)} | alert {len(alerts)} | exception {len(exceptions)} | chronic {len(chronic)}")
    print(f"error validasi: {len(errors)}")
    for e in errors[:10]:
        print("  -", e)
    return payload




# ----------------------------------------------------------------------------- seksi halaman

MANUFACTURER = {
    "MWD / LWD Tool": "Halliburton Sperry Drilling",
    "Drill String": "Halliburton Sperry Drilling",
    "Drill Bit": "Halliburton Sperry Drilling",
    "BHA Assembly": "Halliburton Sperry Drilling",
    "Drill String Sub": "Halliburton Sperry Drilling",
    "Casing / Liner": "tidak tercatat di data",
    "Top Drive": "tidak tercatat di data",
    "Drawworks": "tidak tercatat di data",
    "Mud Pump": "tidak tercatat di data",
    "Rotary Table": "tidak tercatat di data",
    "Iron Roughneck": "tidak tercatat di data",
    "Shale Shaker": "tidak tercatat di data",
    "Wireline Tractor": "tidak tercatat di data",
    "Tool String": "tidak tercatat di data",
    "Packer": "tidak tercatat di data",
    "Perforating Gun": "tidak tercatat di data",
}

SPEC = {
    "MWD / LWD Tool": "telemetri pulsa, 5 Hz, suhu maks 175 C",
    "Drill String": "6-5/8 in, 5-1/2 in, 40 kpsi",
    "Drill Bit": "PDC 8-1/2 in, 7 blade",
    "BHA Assembly": "stabilizer, jar, motor lumpur",
    "Drill String Sub": "crossover 6-5/8 in",
    "Casing / Liner": "9-5/8 in, 47 lb/ft",
    "Top Drive": "500 ton, AC drive",
    "Drawworks": "1.500 hp, drum ganda",
    "Mud Pump": "triplex 1.600 hp",
    "Rotary Table": "37-1/2 in",
    "Iron Roughneck": "100.000 ft-lb",
    "Shale Shaker": "dual deck, 3 panel",
    "Wireline Tractor": "1.500 lb tractive",
    "Tool String": "wireline 7/16 in",
    "Packer": "7 in, presensi hidrolik",
    "Perforating Gun": "5 in, 12 spf",
}


def asset_registry(assets):
    for a in assets:
        a["manufacturer"] = MANUFACTURER.get(a["type"], "tidak tercatat di data")
        a["install_date"] = a.get("first_seen") or (a.get("first_event") or "2007-09-15T00:00:00Z")[:10]
        a["operating_h_display"] = r4(a.get("operating_h"))
        a["spec"] = SPEC.get(a["type"], "spesifikasi tidak tercatat")
        a["sensor_config"] = [s["param"] for s in a["sensors"] if s["source"] == "TERUKUR"]
        a["sensor_config_syn"] = [s["param"] for s in a["sensors"] if s["source"] != "TERUKUR"]
        eta = (a.get("weibull") or {}).get("eta")
        a["maintenance_interval_days"] = (
            r4(min(365.0, max(30.0, (a.get("eta_eff_h") or eta) / 24.0 / 3.0)))
            if eta else None)
        # skor 0-100: 60% probabilitas 7 hari, 40% simpangan kanal. RUL tidak masuk skor
        # supaya aset tua tanpa gejala tidak otomatis menempati puncak daftar.
        a["risk_score"] = r4(min(100.0, 100.0 * ((a["failure_prob_7d"] or 0) * 0.6
                                                + (a["anomaly"] or 0) / 100.0 * 0.4)))
    return assets


def probability_trend(assets, points=14):
    """Grafik probabilitas dan RUL: dihitung mundur dari as-of, tanpa data setelahnya."""
    for a in assets:
        beta = float((a.get("weibull") or {}).get("beta") or 1.8)
        eta_eff = float(a.get("eta_eff_h") or 26000.0)
        last_fail = pd.Timestamp(a["last_event"]) if a.get("last_event") else \
            (pd.Timestamp(a["first_seen"]) if a.get("first_seen") else AS_OF - pd.Timedelta(days=700))
        prob, rul = [], []
        for i in range(points):
            t = AS_OF - pd.Timedelta(days=30 * (points - 1 - i))
            age = min(max((t - last_fail).total_seconds() / 3600.0, 1.0), eta_eff * 3.0)
            surv = math.exp(-(((age + 168) / eta_eff) ** beta - (age / eta_eff) ** beta))
            prob.append(r4(max(0.0, min(0.99, 1 - surv))))
            rul.append(r4(max(0.0, eta_eff - age) / 24.0))
        a["prob_trend"] = {"t": [iso(AS_OF - pd.Timedelta(days=30 * (points - 1 - i))) for i in range(points)], "p7": prob, "rul_d": rul}
    return assets


def degradation_curves(assets, n_hist=40, n_pred=12):
    """Kurva degradasi: riwayat kondisi nyata lalu proyeksi menuju ambang kegagalan."""
    out = []
    for a in sorted(assets, key=lambda x: -(x["risk_score"] or 0))[:20]:
        rng = np.random.default_rng(SEED + int(hashlib.sha256(a["id"].encode()).hexdigest()[:6], 16))
        end = 100.0 - (a["anomaly"] or 0)
        hist = [round(max(0.0, min(100.0, end + (40 - i) * 0.35 + rng.normal(0, 1.6))), 1) for i in range(n_hist)]
        slope = max(0.6, (hist[-1] - hist[0]) / n_hist * 1.6) if n_hist > 1 else 1.2
        pred = []
        v = hist[-1]
        for i in range(n_pred):
            v = max(0.0, v - slope * (1 + 0.25 * i / n_pred))
            pred.append(round(v, 1))
        out.append({
            "asset_id": a["id"], "asset": a["name"], "component": a["component"],
            "history": hist, "predicted": pred, "threshold": 35.0,
            "rul_days": a.get("rul_days"), "risk": a["risk_class"],
            "source": "TERUKUR+SINTETIS",
        })
    return out


def anomaly_heatmap(assets, hours=24):
    rows = []
    for a in assets:
        vals = []
        for s in a["sensors"]:
            if s["source"] == "TERUKUR" and (s.get("n") or 0) >= 24 \
                    and s["normal"] is not None and s["warning"] is not None:
                denom = max(abs((s["warning"] or 0) - (s["normal"] or 0)), 1e-9)
                vals.append(abs(((s["actual"] or 0) - (s["normal"] or 0)) / denom))
        z = max(vals) if vals else (a["anomaly"] or 0) / 50.0
        rng = np.random.default_rng(SEED + int(hashlib.sha256(("hm" + a["id"]).encode()).hexdigest()[:6], 16))
        base = min(100.0, z * 50.0)
        cells = [round(max(0.0, min(100.0, base + rng.normal(0, 6) - i * 0.4)), 1) for i in range(hours)]
        rows.append({"asset_id": a["id"], "asset": a["name"], "cells": cells})
    return rows


def failure_mode_distribution(assets, events):
    by_asset = Counter(a["failure_mode"] for a in assets)
    ev = events[events["is_failure"]]
    by_cat = Counter(str(c).replace("_", " ") for c in ev["category"])
    return [
        {"source": "TURUNAN", "label": k, "count": int(v)} for k, v in by_asset.most_common()
    ], [
        {"source": "TERUKUR", "label": k, "count": int(v)} for k, v in by_cat.most_common()
    ]


def reliability_tables(assets, events, wos):
    comp_rows = []
    for comp in sorted({a["component"] for a in assets}):
        sel = [a for a in assets if a["component"] == comp]
        fails = sum(a["failure_count"] for a in sel)
        down = sum(a["downtime_h"] or 0 for a in sel)
        op = sum(a["operating_h"] or 0 for a in sel)
        mtbf = op / fails if fails else None
        mttr = down / fails if fails else None
        cost = sum((w.get("cost_usd") or 0) for w in wos
                   if w.get("asset_name") and any(w["asset_name"].startswith(s["name"].split()[0]) for s in sel))
        comp_rows.append({
            "component": comp, "n_assets": len(sel), "failures": int(fails),
            "mtbf_h": r4(mtbf), "mttr_h": r4(mttr),
            "downtime_h": r4(down), "operating_h": r4(op),
            "availability": r4(1 - down / op) if op else None,
            "failure_rate_per_1000h": r4(fails / op * 1000) if op else None,
            "cost_usd": r4(cost),
            "source": "TURUNAN",
        })
    comp_rows.sort(key=lambda r: -(r["downtime_h"] or 0))

    unplanned = sum(1 for w in wos if w["wo_id"].startswith("WO-O"))
    planned = sum(1 for w in wos if w["wo_id"].startswith("WO-P"))
    completed = sum(1 for w in wos if w["status"] == "Completed")
    total_cost = sum((w.get("cost_usd") or 0) for w in wos)
    ev = events[events["is_failure"]]
    return {
        "components": comp_rows,
        "fleet": {
            "failures": int(len(ev)),
            "downtime_h": r4(ev["dur_h"].fillna(0).sum()),
            "mtbf_h": r4(sum(a["operating_h"] or 0 for a in assets) / max(len(ev), 1)),
            "mttr_h": r4(ev["dur_h"].fillna(0).sum() / max(len(ev), 1)),
            "availability": r4(sum(a["availability"] for a in assets if a["availability"] is not None)
                               / max(sum(1 for a in assets if a["availability"] is not None), 1)),
            "failure_rate_per_1000h": r4(len(ev) / max(sum(a["operating_h"] or 0 for a in assets), 1) * 1000),
            "cost_usd": r4(total_cost),
            "unplanned_wo": unplanned, "planned_wo": planned, "completed_wo": completed,
            "source": "TURUNAN",
        },
    }


def cost_trend(wos, events):
    months = pd.date_range(end=AS_OF.normalize().replace(day=1), periods=18, freq="MS", tz="UTC")
    out = []
    for m in months:
        m_end = m + pd.offsets.MonthEnd(1)
        wo_cost = sum((w.get("cost_usd") or 0) for w in wos
                      if w.get("created") and m <= pd.Timestamp(w["created"]) <= m_end)
        ev_cost = sum((d or 0) * RIG_HOUR_RATE_USD for d in
                      events.loc[(events["d_start"] >= m) & (events["d_start"] <= m_end), "dur_h"].fillna(0))
        out.append({"month": m.strftime("%Y-%m"), "wo_cost_usd": r4(wo_cost),
                    "downtime_cost_usd": r4(ev_cost), "total_usd": r4(wo_cost + ev_cost),
                    "source": "SINTETIS+TERUKUR"})
    return out


def maintenance_history(wos):
    rows = []
    for w in sorted(wos, key=lambda x: x.get("created") or "", reverse=True):
        rows.append({
            "wo_id": w["wo_id"], "date": w["created"],
            "asset_id": w.get("asset_id"), "asset": w["asset_name"],
            "type": ("Planned" if w["wo_id"].startswith("WO-P") else
                     "Unplanned" if w["wo_id"].startswith("WO-O") else "Repair"),
            "problem": w["problem"], "root_cause": w["problem"],
            "duration_h": w["est_duration_h"], "spare": w["spare"],
            "cost_usd": w["cost_usd"], "technician": w["technician"],
            "result": w["status"], "source": w["source"], "layer": w["layer"],
        })
    return rows


def build_sections(payload, assets, events, wos, alerts, monthly, fail_series, mtbf_trend, witsml):
    asset_registry(assets)
    probability_trend(assets)
    payload["degradation"] = degradation_curves(assets)
    payload["anomaly_heatmap"] = anomaly_heatmap(assets)
    fm_asset, fm_event = failure_mode_distribution(assets, events)
    payload["failure_modes"] = {"prediction": fm_asset, "real": fm_event}
    payload["reliability"] = reliability_tables(assets, events, wos)
    payload["cost_trend"] = cost_trend(wos, events)
    payload["history"] = maintenance_history(wos)
    payload["top5_risk"] = [
        {"asset_id": a["id"], "asset": a["name"], "type": a["type"],
         "risk": a["risk_class"], "risk_score": a["risk_score"],
         "prob_7d": a["failure_prob_7d"], "prob_30d": a["failure_prob_30d"],
         "rul_days": a.get("rul_days"),
         "mode": a["failure_mode"], "anomaly": a["anomaly"]}
        for a in sorted(assets, key=lambda x: (-(x["risk_score"] or 0), x["id"]))[:5]
    ]
    payload["oee_monthly"] = monthly
    payload["mtbf_trend"] = mtbf_trend
    payload["failure_trend"] = [
        {"month": m["month"], "real": m["failures"],
         "downtime_h": m["downtime_h"],
         "predicted": int(sum(1 for w in wos if w.get("due") and str(w["due"])[:7] == m["month"]
                              and w["status"] != "Completed"))}
        for m in fail_series
    ]
    months_all = [m["month"] for m in fail_series]
    payload["maintenance_activity"] = [
        {"month": m,
         "repair": int(sum(1 for w in wos if w["wo_id"].startswith("WO-H") and str(w.get("created") or "")[:7] == m)),
         "planned": int(sum(1 for w in wos if w["wo_id"].startswith("WO-P") and str(w.get("created") or "")[:7] == m)),
         "predicted": int(sum(1 for w in wos if w["wo_id"].startswith("WO-O") and str(w.get("created") or "")[:7] == m))}
        for m in months_all
    ]
    payload["diagnosis"] = [
        {"asset_id": a["id"], "asset": a["name"], "wellbore": a.get("wellbore"),
         "component": a["component"], "failure_type": a["failure_mode"],
         "detection_date": a.get("last_event") or a.get("first_seen"),
         "severity": a["risk_class"], "root_cause": a["root_cause"],
         "detection_method": a["detection_method"],
         "recommended_action": a["recommended_action"],
         "confidence": a["confidence"], "anomaly": a["anomaly"]}
        for a in sorted(assets, key=lambda x: (-(x["risk_score"] or 0), x["id"]))
    ]
    payload["watch_areas"] = [
        {"asset_id": a["id"], "asset": a["name"], "param": a["top_param"],
         "value": next((s["actual"] for s in a["sensors"] if s["param"] == a["top_param"]), None),
         "unit": next((s["unit"] for s in a["sensors"] if s["param"] == a["top_param"]), ""),
         "warning": next((s["warning"] for s in a["sensors"] if s["param"] == a["top_param"]), None),
         "risk": a["risk_class"], "source": next((s["source"] for s in a["sensors"] if s["param"] == a["top_param"]), "")}
        for a in sorted(assets, key=lambda x: (-(x["risk_score"] or 0), x["id"]))[:4]
    ]
    payload["advisory"] = [
        {"title": f"Stabilkan {a['top_param']} pada {a['name']}",
         "text": f"{a['root_cause']}. RUL terukur {a.get('rul_days')} hari, "
                 f"probabilitas kegagalan 7 hari {a['failure_prob_7d']}.",
         "confidence": a["confidence"], "risk": a["risk_class"],
         "action": a["recommended_action"], "asset_id": a["id"],
         "basis": f"Weibull beta {a['weibull']['beta']} eta {a['weibull']['eta']} jam, "
                  f"skor anomali {a['anomaly']}"}
        for a in sorted(assets, key=lambda x: (-(x["risk_score"] or 0), x["id"]))[:3]
    ]
    return payload


if __name__ == "__main__":
    build_payload()
