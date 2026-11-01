// plant.js: render dashboard lapangan Volve dari payload Python.
// Semua angka sudah dihitung di code/plant_build.py; berkas ini tidak menghitung metrik,
// hanya memilih, memformat, dan menaruhnya ke DOM.

(function () {
  "use strict";

  const D = window.PLANT;
  const F = window.PM_FULL || null;
  const C = window.PCharts;

  if (!D) {
    document.body.insertAdjacentHTML("afterbegin",
      '<p style="padding:20px;color:#f85149">data/plant.js tidak termuat.</p>');
    return;
  }

  const $ = (id) => document.getElementById(id);
  const state = { well: "", type: "", status: "", crit: "", assetId: null };

  // ---------- format ----------
  const nf = (x, dg = 1) => (x === null || x === undefined || Number.isNaN(x))
    ? "–" : Number(x).toLocaleString("id-ID", { minimumFractionDigits: dg, maximumFractionDigits: dg });
  const ni = (x) => (x === null || x === undefined) ? "–" : Number(x).toLocaleString("id-ID");
  const pc = (x, dg = 1) => (x === null || x === undefined) ? "–" : `${nf(x * 100, dg)}%`;
  const usd = (x) => {
    if (x === null || x === undefined) return "–";
    if (Math.abs(x) >= 1e6) return `$${nf(x / 1e6, 2)} jt`;
    if (Math.abs(x) >= 1e3) return `$${nf(x / 1e3, 0)} rb`;
    return `$${nf(x, 0)}`;
  };
  const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const dt = (s) => {
    if (!s) return "–";
    const d0 = new Date(s);
    if (Number.isNaN(d0.getTime())) return String(s).slice(0, 10);
    return `${d0.getUTCDate()} ${MON[d0.getUTCMonth()]} ${d0.getUTCFullYear()}`;
  };
  const dtt = (s) => {
    if (!s) return "–";
    const d0 = new Date(s);
    if (Number.isNaN(d0.getTime())) return String(s);
    return `${d0.getUTCDate()} ${MON[d0.getUTCMonth()]} ${String(d0.getUTCHours()).padStart(2, "0")}:00`;
  };
  const esc = (s) => String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const src = (s) => s ? `<span class="src" data-s="${esc(s)}">${esc(s.toLowerCase())}</span>` : "";
  const dot = (st) => `<span class="dot ${esc(st)}"></span>`;
  const riskChip = (r) => {
    const cls = r === "Critical" ? "crit" : r === "High" ? "high" : r === "Low" ? "low" : "med";
    return `<span class="chip ${cls}">${esc(r)}</span>`;
  };
  const priChip = (p) => {
    const cls = p === "Critical" ? "crit" : p === "High" ? "high" : p === "Medium" ? "med" : "low";
    return `<span class="chip ${cls}">${esc(p)}</span>`;
  };
  const healthClass = (h) => h >= 70 ? "ok" : h >= 40 ? "warn" : "bad";

  function table(host, head, rows, cls) {
    const t = typeof host === "string" ? $(host) : host;
    if (!t) return;
    const th = head.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.label || h)}</th>`).join("");
    const tb = rows.length
      ? rows.map((r) => "<tr>" + r.map((c, i) =>
          `<td class="${head[i] && head[i].num ? "num" : ""}${head[i] && head[i].wrap ? " wrap" : ""}">${c}</td>`
        ).join("") + "</tr>").join("")
      : `<tr><td colspan="${head.length}" class="empty">tidak ada baris untuk saringan ini</td></tr>`;
    t.innerHTML = `<thead><tr>${th}</tr></thead><tbody>${tb}</tbody>`;
  }

  // ---------- saringan ----------
  function filteredAssets() {
    return D.assets.filter((a) =>
      (!state.well || a.wellbore === state.well) &&
      (!state.type || a.type === state.type) &&
      (!state.status || a.status === state.status) &&
      (!state.crit || a.criticality === state.crit));
  }
  const assetIds = () => new Set(filteredAssets().map((a) => a.id));
  const byAsset = (rows, key = "asset_id") => {
    const ids = assetIds();
    return rows.filter((r) => ids.has(r[key]));
  };
  // baris riwayat bisa merujuk komponen yang tidak punya aset sendiri; saringan sumur
  // tetap menampilkannya supaya catatan operasi tidak hilang dari layar
  const byWell = (rows) => rows.filter((r) =>
    !state.well || (r.wellbore && r.wellbore === state.well) ||
    (r.asset_id && assetIds().has(r.asset_id)));

  function fillFilters() {
    const wells = [...new Set(D.assets.map((a) => a.wellbore).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "id", { numeric: true }));
    $("f-well").innerHTML = '<option value="">Semua sumur</option>' +
      wells.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join("");
    const types = [...new Set(D.assets.map((a) => a.type))].sort();
    $("f-type").innerHTML = '<option value="">Semua jenis</option>' +
      types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  }

  function bindFilters() {
    [["f-well", "well"], ["f-type", "type"], ["f-status", "status"], ["f-crit", "crit"]].forEach(([id, key]) => {
      $(id).addEventListener("change", (e) => { state[key] = e.target.value; renderAll(); });
    });
    $("f-reset").addEventListener("click", () => {
      state.well = state.type = state.status = state.crit = "";
      ["f-well", "f-type", "f-status", "f-crit"].forEach((id) => { $(id).value = ""; });
      renderAll();
    });
  }

  // ---------- tab ----------
  const TABS = ["operasi", "aset", "aksi", "keandalan", "model"];
  function switchTab(name) {
    TABS.forEach((t) => {
      const btn = $(`tab-${t}`), panel = $(`p-${t}`);
      const on = t === name;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      panel.hidden = !on;
    });
  }
  function bindTabs() {
    TABS.forEach((t) => {
      $(`tab-${t}`).addEventListener("click", () => switchTab(t));
      $(`tab-${t}`).addEventListener("keydown", (e) => {
        const i = TABS.indexOf(t);
        if (e.key === "ArrowRight") { e.preventDefault(); const n = TABS[(i + 1) % TABS.length]; switchTab(n); $(`tab-${n}`).focus(); }
        if (e.key === "ArrowLeft") { e.preventDefault(); const n = TABS[(i - 1 + TABS.length) % TABS.length]; switchTab(n); $(`tab-${n}`).focus(); }
      });
    });
  }

  // ---------- kepala ----------
  function renderHead() {
    const m = D.meta;
    $("as-of").textContent = dtt(m.as_of);
    $("tel-last").textContent = dtt(m.telemetry_last);
    $("seed-chip").textContent = `seed ${m.seed}`;
    $("built").innerHTML = `payload ${ni(m.real_events)} kejadian nyata · ${ni(m.witsml_rows)} baris telemetri`;

    // telemetri berhenti jauh sebelum tanggal acuan; ini harus terlihat, bukan disembunyikan
    const gapDays = Math.round((new Date(m.as_of) - new Date(m.telemetry_last)) / 864e5);
    const box = $("stale");
    if (gapDays > 30) {
      box.hidden = false;
      box.innerHTML = `<b>Telemetri berhenti ${ni(gapDays)} hari sebelum tanggal acuan.</b>
        Pembacaan sensor terakhir ${dtt(m.telemetry_last)}, sedangkan log kejadian berjalan sampai
        ${dtt(m.as_of)}. Nilai sensor di halaman ini adalah pembacaan terakhir yang tersedia, bukan
        kondisi 2015. Prediksi memakai kejadian dan waktu, bukan sensor 2015 yang tidak ada.`;
    }
  }

  function kpi(lab, val, sub, cls) {
    return `<div class="kpi ${cls || ""}"><span class="lab">${lab}</span>
      <span class="val">${val}</span><span class="sub">${sub || ""}</span></div>`;
  }

  // ---------- halaman Operasi ----------
  function renderOperasi() {
    const A = filteredAssets();
    const ov = D.overview;
    const h = A.filter((a) => a.status === "healthy").length;
    const w = A.filter((a) => a.status === "warning").length;
    const c = A.filter((a) => a.status === "critical").length;
    const pred = A.filter((a) => (a.failure_prob_30d || 0) >= 0.5).length;
    // jatuh tempo = pekerjaan yang harus dikerjakan dalam 7 hari, bukan ulangan kartu critical
    const horizon = new Date(new Date(D.meta.as_of).getTime() + 7 * 864e5);
    const due = byWell(D.work_orders).filter((w) => w.status !== "Completed" && w.due
      && new Date(w.due) <= horizon).length;
    const av = A.length ? A.reduce((s, a) => s + (a.availability || 0), 0) / A.filter((a) => a.availability !== null).length : null;

    $("kpis").innerHTML =
      kpi("Total aset", ni(A.length), `${ni(D.assets.length)} di seluruh lapangan`) +
      kpi("Sehat", ni(h), "status normal", "ok") +
      kpi("Warning", ni(w), "keluar dari baseline", "warn") +
      kpi("Critical", ni(c), "perlu tindakan", "bad") +
      kpi("Prediksi gagal", ni(pred), `probabilitas 30 hari ≥ 50%`) +
      kpi("Jatuh tempo", ni(due), "work order dalam 7 hari") +
      kpi("Ketersediaan", av === null ? "–" : pc(av), "1 − downtime/(jam operasi + downtime)") +
      kpi("D-OEE", pc(ov.oee), `median 6 bln · sebelumnya ${pc(ov.oee_prev)}`, "warn");

    // lima pertanyaan yang harus dijawab dashboard, dijawab dengan angka yang sama
    const withRul = A.filter((a) => a.rul_days !== null && a.rul_days !== undefined);
    const nearest = withRul.filter((a) => a.rul_days > 0).sort((a, b) => a.rul_days - b.rul_days)[0]
      || withRul.sort((a, b) => a.rul_days - b.rul_days)[0];
    const modeTop = Object.entries(A.reduce((m, a) => {
      m[a.failure_mode] = (m[a.failure_mode] || 0) + 1; return m;
    }, {})).sort((a, b) => b[1] - a[1])[0] || ["–", 0];
    $("qstrip").innerHTML = [
      ["Kondisi saat ini", `${ni(h)} sehat · ${ni(w + c)} bermasalah`, "dari " + ni(A.length) + " aset", "aset"],
      ["Aset berisiko", `${ni(c)} critical`, `${ni(pred)} diperkirakan gagal 30 hari`, "aset"],
      ["Kapan", !nearest ? "–" : nearest.rul_days <= 0 ? "lewat MTBF"
        : nearest.rul_days < 1 ? `${nf(nearest.rul_days * 24, 0)} jam` : `${nf(nearest.rul_days)} hari`,
        nearest ? esc(nearest.name) : "tidak ada", "aset"],
      ["Komponen apa", esc(modeTop[0]), `${ni(modeTop[1])} aset`, "keandalan"],
      ["Tindakan apa", `${ni(due)} pekerjaan`, "jatuh tempo 7 hari", "aksi"],
    ].map(([q, a, b, tab]) => `
      <button class="q" data-goto="${tab}">
        <span class="q1">${q}</span><span class="q2">${a}</span><span class="q3">${b}</span>
      </button>`).join("");

    // OEE bulanan
    // hanya bulan yang punya jendela pengeboran yang digambar. Bulan kosong tidak diplot
    // sebagai nol dan tidak menyisakan titik lepas; keterbatasan ini ditulis di legenda.
    const rows = D.oee_monthly.filter((r) => r.oee !== null).slice(-18);
    const labels = rows.map((r) => r.month.slice(2));
    const p100 = (v) => (v === null || v === undefined ? null : v * 100);
    C.lineChart($("ch-oee"), {
      labels, height: 230, min: 0, max: 100,
      series: [
        { label: "D-OEE", color: "var(--accent)", values: rows.map((r) => p100(r.oee)), width: 2.4 },
        { label: "rasio waktu putar", color: "var(--series-2)", values: rows.map((r) => p100(r.active_ratio)), dash: "5 4" },
        { label: "kinerja ROP", color: "var(--ok)", values: rows.map((r) => p100(r.performance)), dash: "2 4" },
        { label: "mutu lubang", color: "var(--warn)", values: rows.map((r) => p100(r.quality)), dash: "7 4" },
      ],
      yFmt: (v) => `${Math.round(v)}`,
    });
    const last = rows.filter((r) => r.oee !== null).pop() || {};
    $("oee-foot").innerHTML = `
      <span>D-OEE median 6 bulan <b>${pc(ov.oee)}</b> <span style="color:var(--dim)">(sebelumnya ${pc(ov.oee_prev)})</span></span>
      <span>Bulan terakhir ${esc(last.month || "–")}:
        D-OEE <b>${pc(last.oee)}</b> · waktu putar <b>${pc(last.active_ratio)}</b> ·
        kinerja ROP <b>${pc(last.performance)}</b> · mutu <b>${pc(last.quality)}</b></span>
      <span>Downtime bulan itu <b>${nf(last.downtime_h)} jam</b></span>`;

    // donut kesehatan
    C.donut($("ch-health"), {
      size: 168, centerValue: ni(A.length), centerLabel: "aset",
      data: [
        { label: "sehat", value: h, color: "var(--ok)" },
        { label: "warning", value: w, color: "var(--warn)" },
        { label: "critical", value: c, color: "var(--bad)" },
      ],
    });
    $("health-list").innerHTML = [["sehat", h, "var(--ok)"], ["warning", w, "var(--warn)"], ["critical", c, "var(--bad)"]]
      .map(([lab, v, col]) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px">
        <span><i class="dot" style="background:${col}"></i>${lab}</span>
        <b style="font-family:var(--mono)">${ni(v)}</b></div>`).join("");

    // tren kegagalan
    const ft = D.failure_trend.slice(-36);
    C.barChart($("ch-fail"), {
      labels: ft.map((r) => r.month.slice(2)), height: 230, stacked: true,
      series: [
        { label: "kegagalan", color: "var(--bad)", values: ft.map((r) => r.real) },
        { label: "prediktif", color: "var(--series-2)", values: ft.map((r) => r.predicted) },
      ],
      yFmt: (v) => `${Math.round(v)}`,
    });

    // top 5
    const t5 = D.top5_risk.filter((t) => assetIds().has(t.asset_id));
    $("top5").innerHTML = t5.length ? t5.map((t) => `
      <button class="item" data-asset="${esc(t.asset_id)}">
        <span class="t">${dot(t.risk === "Critical" ? "critical" : t.risk === "High" ? "warning" : "healthy")}${esc(t.asset)}</span>
        <span class="n">${nf(t.risk_score)}<span style="font-size:10px;color:var(--dim)">/100</span></span>
        <span class="m">${riskChip(t.risk)} ${esc(t.mode)} · RUL ${nf(t.rul_days)} hari ·
          prob 7 hari ${pc(t.prob_7d)} · 30 hari ${pc(t.prob_30d)}</span>
      </button>`).join("")
      : '<p class="empty">tidak ada aset pada saringan ini</p>';

    // drivers
    const dr = D.drivers.filter((x) => assetIds().has(x.asset_id));
    $("drivers").innerHTML = dr.length ? dr.map((x) => `
      <div class="action">
        <div class="pri">${riskChip(x.anomaly >= 66 ? "Critical" : x.anomaly >= 33 ? "High" : "Low")}</div>
        <div class="body">${esc(x.asset)} · ${esc(x.param)} ${nf(x.value, 2)} ${esc(x.unit || "")}
          <div class="sub">${esc(x.evidence)} · ambang ${nf(x.warning, 2)} ${esc(x.unit || "")} · skor ${nf(x.anomaly)}</div>
        </div>
        <div class="n">${nf(x.impact_pct, 2)}%</div>
      </div>`).join("")
      : '<p class="empty">tidak ada penyimpangan pada saringan ini</p>';

    // governed actions
    const wo = byAsset(D.work_orders).filter((x) => x.status !== "Completed")
      .sort((a, b) => (a.due || "").localeCompare(b.due || "")).slice(0, 6);
    $("governed").innerHTML = wo.length ? wo.map((x) => `
      <div class="action">
        <div class="pri">${priChip(x.priority)}</div>
        <div class="body">${esc(x.action)}
          <div class="sub">${esc(x.asset_name)} · ${esc(x.wo_id)} · jatuh tempo ${dt(x.due)}</div>
        </div>
        <div><span class="src" data-s="${esc(x.layer)}">${esc(String(x.layer).toLowerCase())}</span></div>
      </div>`).join("")
      : '<p class="empty">tidak ada pekerjaan terbuka</p>';

    // watch areas
    const wa = byAsset(D.watch_areas);
    $("watch").innerHTML = wa.length ? wa.map((x) => `
      <div class="item" data-asset="${esc(x.asset_id)}" style="cursor:pointer">
        <span class="t">${dot(x.risk === "Critical" ? "critical" : "warning")}${esc(x.asset)}</span>
        <span class="n">${nf(x.value, 2)} ${esc(x.unit)}</span>
        <span class="m">${esc(x.param)} · ambang ${nf(x.warning, 2)} ${esc(x.unit)} ${src(x.source)}</span>
      </div>`).join("")
      : '<p class="empty">tidak ada area pantau</p>';

    // chronic
    const cs = D.chronic_severity;
    C.donut($("ch-chronic"), {
      size: 150, centerValue: ni(D.chronic.length), centerLabel: "kronis",
      data: [
        { label: "S3 tinggi", value: cs.S3 || 0, color: "var(--bad)" },
        { label: "S2 sedang", value: cs.S2 || 0, color: "var(--warn)" },
        { label: "S1 rendah", value: cs.S1 || 0, color: "var(--info)" },
      ],
    });
    $("chronic-legend").innerHTML = [["S3 tinggi", cs.S3 || 0, "var(--bad)"], ["S2 sedang", cs.S2 || 0, "var(--warn)"], ["S1 rendah", cs.S1 || 0, "var(--info)"]]
      .map(([lab, v, col]) => `<div style="display:flex;justify-content:space-between;font-size:12.5px">
        <span><i class="dot" style="background:${col}"></i>${lab}</span><b style="font-family:var(--mono)">${ni(v)}</b></div>`).join("");

    // control loop
    const cl = D.control_loop;
    $("control").innerHTML = [["Deteksi", cl.detection], ["Standarisasi", cl.standardization],
      ["Respons", cl.response], ["Penutupan", cl.closure]].map(([lab, v]) => `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px">
          <span>${lab}</span><b style="font-family:var(--mono)">${pc(v)}</b></div>
        <div class="meter ${v >= 0.9 ? "ok" : v >= 0.75 ? "warn" : "bad"}"><i style="width:${Math.min(100, v * 100)}%"></i></div>
      </div>`).join("");

    // aktivitas maintenance
    const ma = D.maintenance_activity.slice(-24);
    C.barChart($("ch-activity"), {
      labels: ma.map((r) => r.month.slice(2)), height: 210, stacked: true,
      series: [
        { label: "terencana", color: "var(--ok)", values: ma.map((r) => r.planned) },
        { label: "prediktif", color: "var(--series-2)", values: ma.map((r) => r.predicted) },
        { label: "perbaikan", color: "var(--info)", values: ma.map((r) => r.repair) },
      ],
      yFmt: (v) => `${Math.round(v)}`,
    });

    // advisory
    const ad = D.advisory.filter((x) => assetIds().has(x.asset_id));
    $("advisory").innerHTML = ad.length ? ad.map((x) => `
      <div class="action">
        <div class="pri">${riskChip(x.risk)}</div>
        <div class="body"><b>${esc(x.title)}</b>
          <div class="sub">${esc(x.text)}</div>
          <div class="sub">Tindakan: ${esc(x.action)}</div>
          <div class="sub">Dasar: ${esc(x.basis)}</div>
        </div>
        <div class="n">${pc(x.confidence, 0)}</div>
      </div>`).join("")
      : '<p class="empty">tidak ada saran untuk saringan ini</p>';

    // alert
    const al = byAsset(D.alerts).slice().sort((a, b) => (b.time || "").localeCompare(a.time || "")).slice(0, 60);
    table("alert-tbl", ["Waktu", "Aset", "Alert", "Detail", "Tingkat", "Sumber", "Ack"],
      al.map((x) => [
        dtt(x.time), esc(x.asset), esc(x.alert), esc(x.detail),
        `<span class="chip ${x.severity === "Critical" ? "crit" : "high"}">${esc(x.severity)}</span>`,
        src(x.source), x.ack ? "sudah" : "belum",
      ]));
  }

  // ---------- halaman Aset ----------
  function renderAsetList() {
    const A = filteredAssets().slice().sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
    $("aset-count").textContent = `${A.length} aset`;
    if (!A.some((a) => a.id === state.assetId)) state.assetId = A.length ? A[0].id : null;
    $("aset-list").innerHTML = A.length ? A.map((a) => `
      <button class="item" data-asset="${esc(a.id)}" aria-current="${a.id === state.assetId}">
        <span class="t">${dot(a.status)}${esc(a.name)}</span>
        <span class="n">${nf(a.health, 0)}</span>
        <span class="m">${esc(a.type)}${a.wellbore ? " · " + esc(a.wellbore) : ""} ·
          RUL ${a.rul_days === null || a.rul_days === undefined ? "–" : nf(a.rul_days) + " hari"} ·
          prob 7h ${pc(a.failure_prob_7d)}${a.overdue_mtbf ? " · lewat MTBF" : ""}</span>
      </button>`).join("")
      : '<p class="empty">tidak ada aset pada saringan ini</p>';
  }

  function paramTable(a) {
    const rows = a.sensors.map((s) => [
      `${esc(s.param)} <span class="src" data-s="${esc(s.source)}">${esc(String(s.source).toLowerCase())}</span>`,
      `<span class="v">${nf(s.actual, 2)}</span> ${esc(s.unit)}`,
      `<span class="v">${nf(s.normal, 2)}</span>`,
      `<span class="v">${nf(s.warning, 2)}</span>`,
      `<span class="v">${nf(s.critical, 2)}</span>`,
      `<span class="st ${esc(s.status)}">${esc(s.status)}</span>`,
    ]);
    const arrow = a.sensors.some((s) => s.direction === "turun") ? " ↑/↓" : " ↑";
    return `<div class="param-row head"><span>Parameter</span><span>Aktual</span><span>Normal</span>
      <span>Warning${arrow}</span><span>Critical${arrow}</span><span>Status</span></div>` +
      rows.map((r) => `<div class="param-row">${r.map((c) => `<span>${c}</span>`).join("")}</div>`).join("");
  }

  function renderAsetDetail() {
    const a = D.assets.find((x) => x.id === state.assetId);
    const host = $("aset-detail");
    if (!a) { host.innerHTML = '<div class="card"><p class="empty">pilih aset di daftar kiri</p></div>'; return; }

    const wb = a.weibull || {};
    const rulTxt = a.rul_days === null || a.rul_days === undefined ? "–" : `${nf(a.rul_days)} hari`;
    const sensTs = a.sensors.map((s) => s.ts).filter(Boolean).sort().pop();

    host.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
          <div>
            <h2 style="margin:0 0 4px;text-transform:none;font-size:16px;letter-spacing:0;color:var(--text)">${esc(a.name)}</h2>
            <div class="note" style="margin:0">${esc(a.type)} · ${esc(a.wellbore || "permukaan")} · ${esc(a.location || "")}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${riskChip(a.risk_class)}
            <span class="chip grey">kritikalitas ${esc(a.criticality)}</span>
            <span class="chip grey">${esc(a.status)}</span></div>
        </div>
        <div class="tbl-wrap mt"><table>
          <tbody>
            <tr><th>Pabrikan</th><td>${esc(a.manufacturer)}</td><th>Terpasang</th><td>${dt(a.install_date)}</td></tr>
            <tr><th>Jam operasi</th><td>${nf(a.operating_h, 0)} jam</td><th>Spesifikasi</th><td class="wrap">${esc(a.spec)}</td></tr>
            <tr><th>Kanal terukur</th><td class="wrap">${a.sensor_config.length ? a.sensor_config.map(esc).join(", ") : "tidak ada"}</td>
                <th>Kanal sintetis</th><td class="wrap">${a.sensor_config_syn.length ? a.sensor_config_syn.map(esc).join(", ") : "tidak ada"}</td></tr>
            <tr><th>Pembacaan terakhir</th><td>${dtt(sensTs)}</td><th>Interval servis</th>
                <td>${a.maintenance_interval_days ? nf(a.maintenance_interval_days, 0) + " hari" : "–"}</td></tr>
          </tbody></table></div>
      </div>

      <div class="card">
        <h2>Parameter Mesin <span class="hint">nilai aktual terhadap ambang</span></h2>
        ${paramTable(a)}
        <p class="note">Ambang normal, warning, dan critical dihitung dari sebaran kanal itu sendiri
          (median, persentil 95, persentil 99). Kanal sintetis memakai karakter dari ISO 20816-3 dan
          benchmark keandalan, bukan pengukuran lapangan.</p>
      </div>

      <div class="card">
        <h2>Tren Sensor <span class="hint">48 jam terakhir yang tersedia, satu skala per parameter</span></h2>
        <div id="ch-sens"></div>
      </div>

      <div class="card">
        <h2>Remaining Useful Life</h2>
        <div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          ${kpi("RUL", rulTxt, `rentang ${nf(a.rul_lo_h, 0)}–${nf(a.rul_hi_h, 0)} jam`)}
          ${kpi("Probabilitas 7 hari", pc(a.failure_prob_7d), "Weibull + skor anomali", a.failure_prob_7d > 0.5 ? "bad" : "warn")}
          ${kpi("Probabilitas 30 hari", pc(a.failure_prob_30d), `beta ${nf(wb.beta, 2)} eta ${nf(wb.eta, 0)} jam`)}
        </div>
        <div class="chart mt" id="ch-prob"></div>
        <p class="note" id="prob-note"></p>
        <div class="chart mt" id="ch-deg"></div>
        <p class="note">Kurva probabilitas dihitung mundur dari tanggal acuan. Garis putus-putus adalah
          proyeksi menuju ambang, bukan pengukuran.</p>
      </div>

      <div class="card">
        <h2>Diagnosis &amp; Tindakan</h2>
        <div class="action">
          <div class="pri">${riskChip(a.risk_class)}</div>
          <div class="body"><b>${esc(a.failure_mode)}</b>
            <div class="sub">Sebab: ${esc(a.root_cause)}</div>
            <div class="sub">Metode deteksi: ${esc(a.detection_method)}</div>
            <div class="sub">Tindakan: ${esc(a.recommended_action)}</div>
          </div>
          <div class="n">${pc(a.confidence, 0)}</div>
        </div>
        <div class="tbl-wrap mt"><table id="aset-hist"></table></div>
        <div class="card-foot">
          <span>MTBF <b>${nf(a.mtbf_h, 0)}</b> jam</span>
          <span>MTTR <b>${nf(a.mttr_h, 2)}</b> jam</span>
          <span>Downtime <b>${nf(a.downtime_h, 1)}</b> jam</span>
          <span>Kegagalan <b>${ni(a.failure_count)}</b></span>
          <span>12 bulan terakhir <b>${ni(a.failures_365d)}</b></span>
        </div>
      </div>`;

    // satu grafik per parameter: menyatukan suhu dan getaran pada satu sumbu membuat
    // salah satunya tampak datar di nol
    const sensHost = $("ch-sens");
    if (sensHost) {
      sensHost.innerHTML = "";
      ["Temperature", "Vibration", "Pressure", "Rotary Speed"].forEach((name) => {
        const s = a.series.find((x) => x.param === name);
        const box = document.createElement("div");
        box.className = "mt";
        const cap = document.createElement("div");
        cap.className = "note";
        cap.style.margin = "6px 0 2px";
        cap.innerHTML = `<b>${esc(name)}</b> (${esc(s ? s.unit : "")}) ${s ? src(s.src) : ""}`;
        const chart = document.createElement("div");
        chart.className = "chart";
        box.appendChild(cap);
        box.appendChild(chart);
        sensHost.appendChild(box);
        if (!s) { chart.innerHTML = '<p class="empty">tidak ada seri</p>'; return; }
        C.lineChart(chart, {
          labels: s.t.map((t) => dtt(t)),
          height: 130,
          series: [{ label: name, color: "var(--accent)", values: s.v, width: 1.8,
            dash: s.src === "SINTETIS" ? "4 3" : null }],
          yFmt: (v) => nf(v, 1),
        });
      });
    }

    const pt = a.prob_trend || { t: [], p7: [], rul_d: [] };
    C.lineChart($("ch-prob"), {
      labels: pt.t.map((t) => dt(t)), height: 160,
      series: [{ label: "prob 7 hari", color: "var(--bad)", values: pt.p7.map((v) => v * 100) }],
      thresholds: [{ value: 50, color: "var(--warn)", label: "50%" }],
      yFmt: (v) => `${Math.round(v)}%`,
    });
    const own = D.history.filter((x) => x.asset_id === a.id).slice(0, 12);
    table("aset-hist", ["Tanggal", "WO", "Jenis", "Masalah", "Durasi (jam)", { label: "Biaya", num: true }, "Hasil"],
      own.map((x) => [dt(x.date), esc(x.wo_id), esc(x.type), esc(x.problem),
        nf(x.duration_h, 2), usd(x.cost_usd), esc(x.result)]));

    $("prob-note").innerHTML = wb.beta_clamped
      ? `Bentuk kurva datar karena beta hasil fit di bawah 1,0 (hazard menurun, bukan keausan);
         nilai dipakai dengan batas bawah beta 1,0. ${a.overdue_mtbf ? "Umur operasi sudah melewati MTBF aset ini." : ""}`
      : `Kurva memakai beta ${nf(wb.beta, 2)} dan eta efektif ${nf(a.eta_eff_h, 0)} jam.
         ${a.overdue_mtbf ? "Umur operasi sudah melewati MTBF aset ini." : ""}`;

    const deg = D.degradation.find((x) => x.asset_id === a.id);
    if (deg) {
      C.curveChart($("ch-deg"), { history: deg.history, predicted: deg.predicted, threshold: deg.threshold, height: 170 });
    } else {
      $("ch-deg").innerHTML = '<p class="empty">kurva degradasi hanya dibuat untuk 20 aset berisiko tertinggi</p>';
    }
  }

  function renderRegistry() {
    const A = filteredAssets().slice().sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
    table("registry", [
      "ID", "Nama", "Jenis", "Sumur", "Status", { label: "Kesehatan", num: true },
      { label: "RUL (hari)", num: true }, { label: "Prob 7h", num: true },
      { label: "MTBF (jam)", num: true }, { label: "Downtime (jam)", num: true },
      { label: "Kegagalan", num: true },
    ], A.map((a) => [
      esc(a.id), esc(a.name), esc(a.type), esc(a.wellbore || "permukaan"),
      `${dot(a.status)}${esc(a.status)}`, nf(a.health, 0),
      a.rul_days === null ? "–" : nf(a.rul_days), pc(a.failure_prob_7d),
      nf(a.mtbf_h, 0), nf(a.downtime_h, 1), ni(a.failure_count),
    ]));
  }

  function renderHeatmap() {
    const rows = D.anomaly_heatmap
      .filter((r) => assetIds().has(r.asset_id))
      .slice()
      .sort((a, b) => (b.cells[b.cells.length - 1] || 0) - (a.cells[a.cells.length - 1] || 0))
      .slice(0, 14);
    if (!rows.length) { $("ch-heat").innerHTML = '<p class="empty">tidak ada data</p>'; return; }
    C.heatmap($("ch-heat"), { rows });
  }

  function renderFailureModes() {
    const list = (host, rows, color) => {
      const max = Math.max(...rows.map((r) => r.count), 1);
      host.innerHTML = `<h3 style="margin:0 0 8px">${host.id === "fm-pred" ? "Prediksi" : "Kejadian nyata"}</h3>` +
        rows.slice(0, 8).map((r) => `
          <div style="display:grid;grid-template-columns:1fr 46px;gap:8px;align-items:center;margin-bottom:6px">
            <div>
              <div style="font-size:12.5px">${esc(r.label)}</div>
              <div class="meter"><i style="width:${(r.count / max) * 100}%;background:${color}"></i></div>
            </div>
            <b style="font-family:var(--mono);font-size:12.5px;text-align:right">${ni(r.count)}</b>
          </div>`).join("");
    };
    list($("fm-pred"), D.failure_modes.prediction, "var(--accent)");
    list($("fm-real"), D.failure_modes.real, "var(--series-2)");
  }

  // ---------- halaman Aksi ----------
  function renderAksi() {
    const wo = byWell(D.work_orders);
    const open = wo.filter((x) => x.status !== "Completed");
    const due7 = open.filter((x) => x.due && new Date(x.due) <= new Date(new Date(D.meta.as_of).getTime() + 7 * 864e5));
    const overdue = open.filter((x) => x.status === "Overdue");
    const high = open.filter((x) => x.priority === "Critical" || x.priority === "High");
    const cost = wo.reduce((s, x) => s + (x.cost_usd || 0), 0);
    const downCost = D.cost_trend.reduce((s, x) => s + (x.downtime_cost_usd || 0), 0);

    $("aksi-kpis").innerHTML =
      kpi("Work order terbuka", ni(open.length), `${ni(wo.length)} total`) +
      kpi("Jatuh tempo 7 hari", ni(due7.length), "termasuk yang telat", "warn") +
      kpi("Terlambat", ni(overdue.length), "melewati tanggal rencana", overdue.length ? "bad" : "ok") +
      kpi("Prioritas tinggi", ni(high.length), "Critical dan High", "warn") +
      kpi("Biaya work order", usd(cost), "akumulasi tercatat") +
      kpi("Biaya downtime", usd(downCost), `tarif ${usd(D.meta.rig_day_rate_usd)} per hari`, "bad") +
      kpi("Terencana dari yang terbuka",
        pc(open.filter((x) => x.wo_id.startsWith("WO-P")).length / Math.max(open.length, 1)),
        `${ni(open.filter((x) => x.wo_id.startsWith("WO-P")).length)} terjadwal · ` +
        `${ni(open.filter((x) => !x.wo_id.startsWith("WO-P")).length)} menunggu prediksi`) +
      kpi("Rencana vs aktual", pc(D.overview.plan_adherence / 100), "kepatuhan penutupan", "warn");

    const sorted = wo.slice().sort((a, b) => (a.due || "").localeCompare(b.due || ""));
    table("wo-tbl", ["WO", "Aset", "Prioritas", "Masalah", "Tindakan", "Suku cadang", "Teknisi", "Jatuh tempo", "Status", { label: "Biaya", num: true }, "Sumber"],
      sorted.map((x) => [
        esc(x.wo_id), esc(x.asset_name), priChip(x.priority), esc(x.problem), esc(x.action),
        esc(x.spare), esc(x.technician), dt(x.due),
        `<span class="chip ${x.status === "Completed" ? "low" : x.status === "Overdue" ? "crit" : "med"}">${esc(x.status)}</span>`,
        usd(x.cost_usd), src(x.layer),
      ]));

    const rec = filteredAssets().filter((a) => a.risk_class === "Critical" || a.risk_class === "High")
      .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)).slice(0, 6);
    $("rekom").innerHTML = rec.length ? rec.map((a) => `
      <div class="action">
        <div class="pri">${priChip(a.risk_class === "Critical" ? "Critical" : "High")}</div>
        <div class="body">${esc(a.recommended_action)}
          <div class="sub">${esc(a.name)} · ${esc(a.failure_mode)} · RUL ${a.rul_days === null ? "–" : nf(a.rul_days) + " hari"}</div>
        </div>
        <div class="n">${nf(a.risk_score)}</div>
      </div>`).join("")
      : '<p class="empty">tidak ada aset berisiko pada saringan ini</p>';

    const sp = {};
    wo.forEach((x) => { if (x.spare) sp[x.spare] = (sp[x.spare] || 0) + 1; });
    table("spare-tbl", ["Suku cadang", { label: "Dipakai", num: true }],
      Object.entries(sp).sort((a, b) => b[1] - a[1]).map(([k, v]) => [esc(k), ni(v)]));

    const hist = D.history.filter((x) => !state.well || x.wellbore === state.well ||
      (x.asset_id && assetIds().has(x.asset_id)));
    table("hist-tbl", ["Tanggal", "Aset", "Jenis", "Masalah", "Durasi (jam)", "Teknisi", { label: "Biaya", num: true }, "Hasil"],
      hist.map((x) => [
        dt(x.date), esc(x.asset), esc(x.type), esc(x.problem), nf(x.duration_h, 2),
        esc(x.technician), usd(x.cost_usd),
        `<span class="chip ${x.result === "Completed" ? "low" : "med"}">${esc(x.result)}</span>`,
      ]));

    // biaya per aset: gabungan biaya work order dan biaya downtime kejadian
    const perAsset = {};
    wo.forEach((x) => {
      if (!x.asset_name) return;
      perAsset[x.asset_name] = (perAsset[x.asset_name] || 0) + (x.cost_usd || 0);
    });
    D.assets.forEach((a) => {
      if (!assetIds().has(a.id)) return;
      perAsset[a.name] = (perAsset[a.name] || 0) + (a.downtime_h || 0) * (D.meta.rig_day_rate_usd / 24);
    });
    table("costasset-tbl", ["Aset", { label: "Total biaya", num: true }],
      Object.entries(perAsset).sort((a, b) => b[1] - a[1]).slice(0, 20)
        .map(([k, v]) => [esc(k), usd(v)]));

    const ct = D.cost_trend.slice(-18);
    C.barChart($("ch-cost"), {
      labels: ct.map((r) => r.month.slice(2)), height: 220, stacked: true,
      series: [
        { label: "work order", color: "var(--series-2)", values: ct.map((r) => r.wo_cost_usd) },
        { label: "downtime", color: "var(--bad)", values: ct.map((r) => r.downtime_cost_usd) },
      ],
      yFmt: (v) => usd(v),
    });
    $("cost-foot").innerHTML = `
      <span>Total <b>${usd(cost + downCost)}</b></span>
      <span>Work order <b>${usd(cost)}</b></span>
      <span>Downtime <b>${usd(downCost)}</b></span>`;
  }

  // ---------- halaman Keandalan ----------
  function renderKeandalan() {
    const f = D.reliability.fleet;
    $("rel-kpis").innerHTML =
      kpi("MTBF", `${nf(f.mtbf_h, 0)} jam`, "jam operasi per kegagalan") +
      kpi("MTTR", `${nf(f.mttr_h, 2)} jam`, "rata-rata waktu perbaikan") +
      kpi("Ketersediaan", pc(f.availability), "jam operasi tercatat", "ok") +
      kpi("Downtime", `${nf(f.downtime_h, 1)} jam`, "akumulasi kejadian") +
      kpi("Laju kegagalan", nf(f.failure_rate_per_1000h, 2), "per 1.000 jam operasi") +
      kpi("Kegagalan", ni(f.failures), "kategori kegagalan saja") +
      kpi("Biaya", usd(f.cost_usd), "work order") +
      kpi("Terencana", `${ni(f.planned_wo)} : ${ni(f.unplanned_wo)}`, "terencana : tak terencana", "warn");

    table("rel-tbl", ["Komponen", { label: "Aset", num: true }, { label: "Kegagalan", num: true },
      { label: "MTBF (jam)", num: true }, { label: "MTTR (jam)", num: true },
      { label: "Downtime (jam)", num: true }, { label: "Ketersediaan", num: true },
      { label: "Laju /1.000 jam", num: true }, { label: "Biaya", num: true }],
      D.reliability.components.map((r) => [
        esc(r.component), ni(r.n_assets), ni(r.failures), nf(r.mtbf_h, 0), nf(r.mttr_h, 2),
        nf(r.downtime_h, 1), pc(r.availability), nf(r.failure_rate_per_1000h, 2), usd(r.cost_usd),
      ]));

    const diag = D.diagnosis.filter((x) => assetIds().has(x.asset_id));
    table("diag-tbl", ["Aset", "Komponen", "Jenis kegagalan", "Metode deteksi", "Sebab", "Tindakan", "Tingkat", { label: "Keyakinan", num: true }],
      diag.map((x) => [
        esc(x.asset), esc(x.component), esc(x.failure_type), esc(x.detection_method),
        esc(x.root_cause), esc(x.recommended_action), riskChip(x.severity), pc(x.confidence, 0),
      ]));

    table("chronic-tbl", ["Sumur", "Komponen", { label: "Kejadian", num: true }, { label: "Downtime (jam)", num: true },
      "Pertama", "Terakhir", "Tingkat"],
      D.chronic.map((c) => [
        esc(c.wellbore), esc(c.component), ni(c.count), nf(c.downtime_h, 1),
        dt(c.first), dt(c.last), `<span class="chip ${c.severity === "S3" ? "crit" : c.severity === "S2" ? "high" : "med"}">${esc(c.severity)}</span>`,
      ]));

    table("spc-tbl", ["Sumur", "Kanal", { label: "Titik", num: true }, { label: "90 hari", num: true },
      "Terakhir", { label: "Nilai", num: true }, { label: "Baseline", num: true }, "Aturan"],
      D.exceptions.map((x) => [
        esc(x.wellbore), esc(x.channel), ni(x.n_points), ni(x.n_points_90d),
        dtt(x.last_time), nf(x.last_value, 2), `${nf(x.baseline_mean, 2)} ± ${nf(x.baseline_sd, 2)}`,
        esc(x.rule),
      ]));

    const ev = D.events_recent.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 80);
    table("event-tbl", ["Waktu", "Sumur", "Komponen", "Kategori", { label: "Durasi (jam)", num: true }, "Catatan"],
      ev.map((e) => [
        dtt(e.date), esc(e.wellbore), esc(e.component), esc(e.category),
        nf(e.duration_h, 2), `<span class="wrap">${esc((e.comment || "").slice(0, 150))}</span>`,
      ]));
  }

  // ---------- halaman Model ----------
  function renderModel() {
    if (!F) {
      $("model-note").textContent = "data/pm_full.js tidak termuat.";
      return;
    }
    const m = F.overview.meta, p = F.overview.pooled;
    $("model-note").innerHTML = `${esc(m.model)} · target <b>${esc(m.target)}</b> (${esc(m.target_note)}) ·
      ${ni(m.source_rows)} baris · protokol ${esc(m.protocol)} · prevalensi ${pc(p.window.prev, 2)}`;

    $("model-kpis").innerHTML =
      kpi("PR-AUC window", nf(p.window.pr_auc, 3), `row ${nf(p.row.pr_auc, 3)} · acak ${nf(p.window.prev, 3)}`) +
      kpi("Recall window", pc(p.window.recall), `presisi ${pc(p.window.precision)}`, "warn") +
      kpi("PR-AUC row", nf(p.row.pr_auc, 3), `recall ${pc(p.row.recall)}`) +
      kpi("Engine", ni(F.meta.n_engines), `${ni(F.meta.n_heads)} head · ${ni(F.meta.n_wells)} sumur`);

    const pr = F.overview.pr_curve;
    C.lineChart($("ch-pr"), {
      labels: pr.recall.map((v) => nf(v, 2)), height: 210,
      series: [{ label: "presisi", color: "var(--accent)", values: pr.precision.map((v) => v * 100) }],
      thresholds: [{ value: p.window.prev * 100, color: "var(--info)", label: "garis acak" }],
      yFmt: (v) => `${Math.round(v)}%`,
    });

    table("model-tbl", ["Engine", { label: "PR-AUC median", num: true }, { label: "PR-AUC maks", num: true },
      { label: "Fold", num: true }, { label: "Head", num: true }, "Klaim"],
      F.engines.map((e) => [
        esc(e.display_name || e.engine), nf(e.rf_range ? e.rf_range[0] : null, 3),
        nf(e.rf_range ? e.rf_range[1] : null, 3), ni(e.folds.length), ni(e.n_heads), esc(e.klaim_tugas || "–"),
      ]));

    $("model-wells").innerHTML = F.wells.map((w) => `
      <div class="item" style="cursor:default">
        <span class="t">${esc(w.well_norm || w.well)}</span>
        <span class="n">${ni(w.n_test_total)}</span>
        <span class="m">uji ${ni(w.n_test_total)} baris · positif ${ni(w.pos_test_total)}</span>
      </div>`).join("");

    $("model-engines").innerHTML = F.engines.map((e) => `
      <div class="item" style="cursor:default">
        <span class="t">${esc(e.display_name || e.engine)}</span>
        <span class="n">${nf(e.rf_range ? e.rf_range[0] : null, 3)}</span>
        <span class="m">${esc(e.klaim_tugas || "")} · ${esc(e.jenis_task || "")} · ${ni(e.n_features)} fitur ·
          ${ni(e.folds.length)} fold · ${ni(e.n_heads)} head</span>
      </div>`).join("");
  }

  // ---------- footer ----------
  function renderFooter() {
    const m = D.meta, v = m.validation;
    $("sys").innerHTML = `
      <span>Payload dibangun dari <b>${esc(m.sources.length)} sumber</b> capstone</span>
      <span>Validasi <b>${v.n_errors === 0 ? "lolos" : v.n_errors + " galat"}</b></span>
      <span>Kejadian setelah tanggal acuan dipakai sebagai fitur: <b>${ni(m.real_events_after_asof)}</b></span>
      <span>Lapisan: TERUKUR ${ni(m.real_events)} kejadian · TURUNAN metrik · SINTETIS seed ${m.seed}</span>
      <span>${esc(m.field)} · ${esc(m.operator)}</span>`;
  }

  // ---------- render ----------
  function renderAll() {
    const A = filteredAssets();
    $("filter-count").textContent = `${A.length} dari ${D.assets.length} aset`;
    renderOperasi();
    renderAsetList();
    renderAsetDetail();
    renderRegistry();
    renderHeatmap();
    renderFailureModes();
    renderAksi();
    renderKeandalan();
  }

  function bindAssetClicks() {
    document.addEventListener("click", (e) => {
      const go = e.target.closest("[data-goto]");
      if (go) { switchTab(go.dataset.goto); window.scrollTo(0, 0); return; }
      const btn = e.target.closest("[data-asset]");
      if (!btn) return;
      state.assetId = btn.dataset.asset;
      switchTab("aset");
      renderAsetList();
      renderAsetDetail();
      const cur = document.querySelector(`.item[data-asset="${CSS.escape(state.assetId)}"]`);
      if (cur) cur.scrollIntoView({ block: "nearest" });
    });
  }

  // tautan langsung: /#aset membuka tab Aset
  const hashTab = (location.hash || "").replace("#", "");
  if (TABS.includes(hashTab)) switchTab(hashTab);
  window.addEventListener("hashchange", () => {
    const h = (location.hash || "").replace("#", "");
    if (TABS.includes(h)) switchTab(h);
  });

  fillFilters();
  bindFilters();
  bindTabs();
  bindAssetClicks();
  renderHead();
  renderAll();
  renderModel();
  renderFooter();
})();
