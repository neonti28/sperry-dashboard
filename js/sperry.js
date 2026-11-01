// sperry.js: lapisan render untuk kulit DESIGN.md.
// Angka tetap dihitung di code/plant_build.py; berkas ini memilih dan menaruh, tidak menghitung metrik.
(function () {
  "use strict";

  const D = window.PLANT;
  const C = window.PCharts;
  const M = window.PM_FULL || {};
  const MO = M.overview || {};
  const VIEWS = ["operasi", "aset", "aksi", "keandalan", "model"];
  const state = { view: "operasi", well: "", type: "", status: "", crit: "", q: "", assetId: null, modelWell: "", channel: "" };

  const $ = (id) => document.getElementById(id);
  const paramCount = () =>
    new Set(D.assets.flatMap((a) => (a.sensors || []).map((s) => s.param))).size;

  // ---------- format ----------
  const nf = (x, dg = 1) => (x === null || x === undefined || Number.isNaN(x))
    ? "-" : Number(x).toLocaleString("id-ID", { minimumFractionDigits: dg, maximumFractionDigits: dg });
  const ni = (x) => (x === null || x === undefined) ? "-" : Number(x).toLocaleString("id-ID");
  const pc = (x, dg = 1) => (x === null || x === undefined) ? "-" : `${nf(x * 100, dg)}%`;
  const usd = (x) => {
    if (x === null || x === undefined) return "-";
    if (Math.abs(x) >= 1e6) return `$${nf(x / 1e6, 2)} jt`;
    if (Math.abs(x) >= 1e3) return `$${nf(x / 1e3, 0)} rb`;
    return `$${nf(x, 0)}`;
  };
  const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const dt = (s) => {
    if (!s) return "-";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? String(s).slice(0, 10)
      : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };
  const dtt = (s) => {
    if (!s) return "-";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? String(s)
      : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  const esc = (s) => String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const src = (s) => s ? `<span class="src" data-s="${esc(s)}">${esc(String(s).toLowerCase())}</span>` : "";
  const dot = (st) => `<span class="dot" style="color:${st === "critical" ? "var(--risk-text)"
    : st === "warning" ? "var(--monitor)" : "var(--ok-text)"}"></span>`;
  const stChip = (st, label) => `<span class="st ${esc(st)}">${dot(st)}${esc(label || st)}</span>`;
  const riskChip = (r) => stChip(r === "Critical" ? "critical" : r === "High" ? "warning" : "healthy", r);
  const priChip = (p) => stChip(p === "Critical" ? "critical" : p === "High" ? "warning" : "healthy", p);
  // label pendek supaya chip tidak melebar di kolom sempit
  const SHORT = { Critical: "Kritis", High: "Pantau", Medium: "Sedang", Low: "Rendah" };
  const riskChipShort = (r) => stChip(r === "Critical" ? "critical" : r === "High" ? "warning" : "healthy", SHORT[r] || r);

  // ---------- keadaan data ----------
  function emptyState(title, why, how) {
    return `<div class="state"><b>${esc(title)}</b><span>${esc(why)}</span><span>${esc(how || "")}</span></div>`;
  }
  function loadingState(label) {
    return `<div class="state loading" role="status"><b>${esc(label || "Memuat")}</b><span>Menunggu payload plant.json dari server.</span></div>`;
  }
  function errorState(where) {
    return `<div class="state error" role="alert"><b>Data ${esc(where)} tidak terbaca.</b>
      <span>Berkas payload tidak termuat. Jalankan ulang <b>code/plant_build.py</b>, lalu muat ulang halaman.</span></div>`;
  }

  function table(host, head, rows, emptyMsg) {
    const t = typeof host === "string" ? $(host) : host;
    if (!t) return;
    const th = head.map((h) => `<th class="${h.num ? "num" : ""}${h.p ? " p" + h.p : ""}">${esc(h.label || h)}</th>`).join("");
    const body = rows.length
      ? rows.map((r) => "<tr>" + r.map((c, i) =>
          `<td class="${head[i] && head[i].num ? "num" : ""}${head[i] && head[i].wrap ? " wrap" : ""}${head[i] && head[i].p ? " p" + head[i].p : ""}">${c}</td>`
        ).join("") + "</tr>").join("")
      : `<tr><td colspan="${head.length}">${emptyState(
          emptyMsg ? emptyMsg[0] : "Tidak ada baris",
          emptyMsg ? emptyMsg[1] : "Saringan saat ini tidak menemukan baris apa pun.",
          emptyMsg ? emptyMsg[2] : "Longgarkan saringan atau tekan Reset.")}</td></tr>`;
    t.innerHTML = `<thead><tr>${th}</tr></thead><tbody>${body}</tbody>`;
  }

  // ---------- saringan ----------
  const matched = (a) =>
    (!state.well || a.wellbore === state.well) &&
    (!state.type || a.type === state.type) &&
    (!state.status || a.status === state.status) &&
    (!state.crit || a.criticality === state.crit) &&
    (!state.q || (a.name + " " + a.id + " " + a.type + " " + (a.wellbore || "")).toLowerCase().includes(state.q));
  const assets = () => D.assets.filter(matched);
  const assetIds = () => new Set(assets().map((a) => a.id));
  const byWell = (rows) => rows.filter((r) =>
    !state.well || (r.wellbore && r.wellbore === state.well) ||
    (r.asset_id && assetIds().has(r.asset_id)));

  const filterBar = () => {
    const wells = [...new Set(D.assets.map((a) => a.wellbore).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "id", { numeric: true }));
    const types = [...new Set(D.assets.map((a) => a.type))].sort();
    const opt = (list, cur) => list.map((x) =>
      `<option value="${esc(x)}"${x === cur ? " selected" : ""}>${esc(x)}</option>`).join("");
    return `<div class="filters">
      <span class="f-pair"><label class="src" for="f-well">sumur</label>
      <select id="f-well"><option value="">Semua sumur</option>${opt(wells, state.well)}</select></span>
      <span class="f-pair"><label class="src" for="f-type">jenis</label>
      <select id="f-type"><option value="">Semua jenis</option>${opt(types, state.type)}</select></span>
      <span class="f-pair"><label class="src" for="f-status">status</label>
      <select id="f-status">
        <option value="">Semua status</option>
        <option value="healthy"${state.status === "healthy" ? " selected" : ""}>Sehat</option>
        <option value="warning"${state.status === "warning" ? " selected" : ""}>Pantau</option>
        <option value="critical"${state.status === "critical" ? " selected" : ""}>Risiko tinggi</option>
      </select></span>
      <span class="f-pair"><label class="src" for="f-crit">kelas</label>
      <select id="f-crit">
        <option value="">Semua kelas</option>${opt(["A", "B", "C"], state.crit)}
      </select></span>
      <button class="btn" type="button" id="f-reset">Reset saringan</button>
      <span class="src" id="f-count"></span>
    </div>`;
  };

  const card = (title, hint, bodyHtml, cls) =>
    `<div class="card ${cls || ""}"><h3>${esc(title)}${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</h3>${bodyHtml}</div>`;

  // Arah tren hanya muncul kalau ada pembanding nyata. Tanpa pembanding, catatan
  // ditulis apa adanya supaya tidak ada panah yang tidak berdasar.
  const kpiTrend = (d) => {
    if (typeof d.delta !== "number" || Number.isNaN(d.delta)) {
      return `<span class="kpi-trend">${esc(d.trend || "-")}${esc(d.note || "")}</span>`;
    }
    const better = d.goodWhenUp === false ? d.delta < 0 : d.delta > 0;
    const dir = d.delta === 0 ? "flat" : better ? "up" : "down";
    const txt = d.deltaText || `${d.delta > 0 ? "+" : ""}${nf(d.delta, d.dp === undefined ? 2 : d.dp)}`;
    return `<span class="kpi-trend"><b class="${dir}">${esc(txt)}</b>${esc(d.note || "")}</span>`;
  };
  const kpiTile = (d) => `<div class="kpi">
      <span class="kpi-tile" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d.icon}</svg>
      </span>
      <span class="kpi-lab">${esc(d.label)}</span>
      <span class="kpi-val">${d.value}${d.unit ? `<small> ${esc(d.unit)}</small>` : ""}</span>
      ${kpiTrend(d)}
    </div>`;

  const ICO = {
    gauge: '<circle cx="12" cy="12" r="8"/><path d="M12 12l4-3"/>',
    shield: '<path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7z"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    wrench: '<path d="M15 4a4 4 0 015 5l-8 8-4 1 1-4z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    money: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.4"/>',
  };

  // tinggi grafik diambil dari tinggi wadahnya supaya tidak ada grafik terpotong
  const H = (id, fb) => Math.max(88, ((($(id) || {}).clientHeight) || fb) - 6);

  // ---------- Operasi ----------
  // Semua seri di sini dibatasi ke bulan yang benar-benar punya kejadian.
  // Alasannya: data lapangan berhenti bertahap, bulan kosong akan tampak seperti nol palsu.
  const activeMonths = (rows, key) => rows.filter((r) => r[key]);
  const miniStat = (label, value, note, cls) =>
    `<div class="stat"><span class="stat-lab">${esc(label)}</span>
      <span class="stat-val ${cls || ""}">${value}</span>
      <span class="stat-note">${esc(note)}</span></div>`;

  function viewOperasi() {
    const o = D.overview;
    const lastOee = [...D.oee_monthly].reverse().find((m) => m.oee !== null);
    const hero = `<div class="card hero">
      <!-- Foto rak drill pipe nyata: ND Bakken Drill Pipe, Joshua Doubek, CC BY-SA 3.0,
           Wikimedia Commons. Disalin byte identik, tidak diedit; peredupan dilakukan lewat CSS. -->
      <img class="hero-photo" src="assets/hero-drillpipe.jpg" alt="" aria-hidden="true"
           width="3072" height="2304" decoding="async">
      <div>
        <h2>Volve Field <span class="red">/ Predictive Maintenance</span></h2>
        <p class="hero-sub">Kondisi peralatan pengeboran dari ${ni(D.meta.real_events)} kejadian lapangan
           dan ${ni(paramCount())} kategori kanal telemetri (${ni(D.meta.witsml_rows)} baris WITSML),
           dinilai per ${esc(dt(D.meta.as_of))}. Setiap prediksi memakai batas data tanggal itu,
           tidak ada kejadian sesudahnya yang ikut dihitung.</p>
        <div class="hero-meta">
          <span>Operator <b>${esc(D.meta.operator)}</b></span>
          <span>Lokasi <b>${esc(D.meta.field)}</b></span>
          <span>Aset <b>${ni(o.total)}</b></span>
          <span>Kejadian nyata <b>${ni(D.meta.real_events)}</b></span>
          <span>Telemetri <b>${ni(D.meta.witsml_rows)} baris</b></span>
        </div>
      </div>
      <div class="hero-stats">
        ${miniStat("OEE bulan berjendela", lastOee ? pc(lastOee.oee) : "-", lastOee ? lastOee.month : "tidak ada jendela", "")}
        ${miniStat("Kesiapan mesin", pc(o.machine_availability), `${ni(o.healthy)} dari ${ni(o.total)} sehat`, "ok")}
        ${miniStat("Aset kritis", ni(o.critical), `${ni(o.warning)} monitor`, o.critical ? "risk" : "")}
        ${miniStat("Aksi terbuka", ni(o.open_actions), `${ni(o.due_now)} jatuh tempo 7 hari`, "")}
      </div>
      <div class="hero-right">
        <div class="src">indeks lapangan ${nf(o.plant_health, 1)}/100 ${src("TURUNAN")}</div>
        <div class="src">rencana ${nf(o.plan_adherence, 1)}% ${src("SINTETIS")}</div>
      </div>
    </div>`;

    const rowA = `<div class="row4">
      ${card("Kegagalan per bulan", "bulan berkejadian", `<div class="card-body" id="ch-fail"></div>
        <div class="legend"><span><i style="background:var(--brand)"></i>kegagalan</span>
        <span><i style="background:var(--monitor)"></i>downtime (jam)</span></div>`)}
      ${card("Sebaran status", `${ni(o.total)} aset`, `<div class="card-body"><div class="donut-wrap"><div id="ch-donut"></div>
        <div class="metrics" id="donut-legend"></div></div></div>`)}
      ${card("Kesiapan komponen", `${ni(Math.min(6, (D.reliability.components || []).length))} dari ${ni((D.reliability.components || []).length)} teratas · TURUNAN`, `<div class="card-body"><div class="wells" id="avail-list"></div></div>`)}
      ${card("Aset per sumur", "hitung aset", `<div class="card-body"><div class="wells" id="well-list"></div></div>`)}
    </div>`;

    const rowB = `<div class="row4">
      ${card("Top 5 risiko", "probabilitas 7 hari", `<div class="card-body"><table id="t-top5"></table></div>`)}
      ${card("Titik pantau", "nilai terakhir", `<div class="card-body"><div class="stack" id="watch"></div></div>`)}
      ${card("Nyata vs prediksi", "bulan berkejadian", `<div class="card-body" id="ch-pred"></div>
        <div class="legend"><span><i style="background:var(--brand)"></i>kegagalan nyata</span>
        <span><i style="background:var(--monitor)"></i>prediksi</span></div>`)}
      ${card("Rekomendasi teratas", "SINTETIS", `<div class="card-body" id="adv-list"></div>`)}
    </div>`;

    const rowC = `<div class="row4">
      ${card("Tren OEE", "bulan berjendela", `<div class="card-body" id="ch-oee"></div>
        <div class="legend"><span><i style="background:var(--brand)"></i>D-OEE</span>
        <span><i style="background:#4F9CF0"></i>waktu putar</span>
        <span><i style="background:var(--ok)"></i>kinerja ROP</span>
        <span><i style="background:var(--monitor)"></i>mutu lubang</span></div>`)}
      ${card("Aktivitas perawatan", "24 bulan terakhir", `<div class="card-body" id="ch-act"></div>
        <div class="legend"><span><i style="background:var(--ok)"></i>terencana</span>
        <span><i style="background:var(--monitor)"></i>prediktif</span>
        <span><i style="background:#4F9CF0"></i>perbaikan</span></div>`)}
      ${card("Tren MTBF", "bulan berkejadian", `<div class="card-body" id="ch-mtbf-trend"></div>`)}
      ${card("Pemicu utama", "penekan indeks lapangan", `<div class="card-body scroll"><div class="stack" id="drv-list"></div></div>`)}
    </div>`;

    return hero + rowA + rowB + rowC;
  }

  function drawOperasi() {
    const o = D.overview;

    const ft = activeMonths(D.failure_trend, "real").slice(-16);
    C.lineChart($("ch-fail"), {
      height: H("ch-fail", 150), labels: ft.map((r) => r.month.slice(2)),
      series: [
        { values: ft.map((r) => r.real), color: "var(--brand)", label: "kegagalan" },
        { values: ft.map((r) => Math.round(r.downtime_h)), color: "var(--monitor)", label: "downtime" },
      ],
      min: 0, yFmt: (v) => ni(v),
    });

    C.donut($("ch-donut"), {
      size: 120, thickness: 14,
      data: [
        { label: "Sehat", value: o.healthy, color: "#23B67C" },
        { label: "Pantau", value: o.warning, color: "var(--monitor)" },
        { label: "Risiko tinggi", value: o.critical, color: "var(--risk-text)" },
      ],
      centerValue: ni(o.total), centerLabel: "ASET",
    });
    $("donut-legend").innerHTML = [
      ["Sehat", o.healthy, "#23B67C"], ["Pantau", o.warning, "var(--monitor)"],
      ["Risiko tinggi", o.critical, "var(--risk-text)"],
    ].map(([n, v, c]) => `<div class="metric"><span class="k"><i class="dot" style="color:${c};display:inline-block;margin-right:6px"></i>${n}</span>
      <span class="v" style="font-size:13px">${ni(v)}</span><span class="note">${pc(v / (o.total || 1), 1)}</span></div>`).join("");

    const comps = D.reliability.components.slice(0, 6);
    $("avail-list").innerHTML = comps.map((c) => `
      <div class="well-row"><span title="${esc(c.component)}">${esc(c.component)}</span>
        <span class="bars"><span class="meter ${c.availability > 0.999 ? "ok" : c.availability > 0.995 ? "warn" : "bad"}">
          <i style="width:${Math.max(2, c.availability * 100)}%"></i></span></span>
        <span class="count">${pc(c.availability, 2)}</span></div>`).join("");

    const wellAgg = {};
    D.assets.forEach((a) => {
      const w = a.wellbore || "Tanpa sumur";
      wellAgg[w] = wellAgg[w] || { n: 0, crit: 0, warn: 0 };
      wellAgg[w].n += 1;
      if (a.status === "critical") wellAgg[w].crit += 1;
      if (a.status === "warning") wellAgg[w].warn += 1;
    });
    const wells = Object.entries(wellAgg).sort((a, b) => b[1].n - a[1].n);
    const maxN = Math.max(...wells.map((w) => w[1].n), 1);
    $("well-list").innerHTML = wells.slice(0, 6).map(([w, v]) => `
      <div class="well-row"><span>${esc(w)}</span>
        <span class="bars"><span class="meter"><i style="width:${(v.n / maxN) * 100}%"></i></span></span>
        <span class="count">${ni(v.n)}${v.crit ? ` · ${ni(v.crit)} kritis` : ""}</span></div>`).join("")
      + (wells.length > 6 ? `<div class="count" style="font-size:12px;color:var(--text-3)">+ ${wells.length - 6} sumur lain</div>` : "");

    table($("t-top5"),
      [{ label: "Aset", wrap: true, p: 1 }, { label: "Risiko", p: 1 }, { label: "7 h", num: true, p: 1 }, { label: "RUL", num: true, p: 1 }],
      D.top5_risk.map((r) => [
        `<span class="wrap"><b>${esc(r.asset)}</b></span>`,
        riskChipShort(r.risk), nf(r.prob_7d * 100, 1) + "%", `${nf(r.rul_days, 0)} h`,
      ]));

    const watch = (D.watch_areas || []).slice(0, 3);
    $("watch").innerHTML = watch.length ? watch.map((w) => `
      <div class="watch-row">
        <span class="wn">${esc(w.asset)}<span class="wp">${esc(w.param)}</span></span>
        <span class="wv">${nf(w.value, 1)} <small>${esc(w.unit)}</small></span>
        <span class="wr">${riskChipShort(w.risk)}<span class="wa">ambang ${nf(w.warning, 1)}</span></span>
      </div>`).join("")
      + ((D.watch_areas || []).length > 3
        ? `<div class="watch-note">+${ni(D.watch_areas.length - 3)} titik lain, semuanya bertanda ${esc(D.watch_areas[3].risk)}</div>` : "") : emptyState("Tidak ada titik pantau", "Payload tidak memuat watch_areas.", "Bangun ulang payload.");

    const fy = activeMonths(D.failure_trend, "real").slice(-12);
    C.barChart($("ch-pred"), {
      height: H("ch-pred", 150), labels: fy.map((r) => r.month.slice(2)),
      series: [
        { values: fy.map((r) => r.real), color: "var(--brand)", label: "kegagalan nyata" },
        { values: fy.map((r) => r.predicted), color: "var(--monitor)", label: "prediksi" },
      ],
      yFmt: (v) => ni(v),
    });

    const adv = D.advisory.slice(0, 1);
    $("adv-list").innerHTML = adv.length ? adv.map((a) => `
      <div class="advisory rek">
        <div class="ad-head">${esc(a.title)}</div>
        <p>${esc(a.basis)}</p>
        <div class="ad-meta">${esc(a.action)} · keyakinan ${pc(a.confidence, 0)} · ${src("SINTETIS")}</div>
      </div>`).join("") + `<div class="note-foot">
        ${ni(D.advisory.length)} rekomendasi aktif. ${ni(Math.max(0, D.advisory.length - 1))} sisanya ada di tab Aksi.</div>`
      : emptyState("Belum ada rekomendasi", "Payload tidak memuat advisory.", "Bangun ulang payload.");

    const oeeRows = D.oee_monthly.filter((r) => r.oee !== null).slice(-18);
    const p100 = (v) => (v === null || v === undefined ? null : v * 100);
    C.lineChart($("ch-oee"), {
      height: H("ch-oee", 128), labels: oeeRows.map((r) => r.month.slice(2)), min: 0, max: 100,
      series: [
        { values: oeeRows.map((r) => p100(r.oee)), color: "var(--brand)", label: "D-OEE", width: 2.4, points: true },
        { values: oeeRows.map((r) => p100(r.active_ratio)), color: "#4F9CF0", label: "waktu putar", dash: "5 4" },
        { values: oeeRows.map((r) => p100(r.performance)), color: "var(--ok)", label: "kinerja ROP", dash: "2 4" },
        { values: oeeRows.map((r) => p100(r.quality)), color: "var(--monitor)", label: "mutu lubang", dash: "7 4" },
      ],
      yFmt: (v) => `${Math.round(v)}`, points: true,
    });

    const act = D.maintenance_activity.slice(-24);
    C.barChart($("ch-act"), {
      height: H("ch-act", 128), labels: act.map((r) => r.month.slice(2)), stacked: true,
      series: [
        { values: act.map((r) => r.planned), color: "var(--ok)", label: "terencana" },
        { values: act.map((r) => r.predicted), color: "var(--monitor)", label: "prediktif" },
        { values: act.map((r) => r.repair), color: "#4F9CF0", label: "perbaikan" },
      ],
      yFmt: (v) => ni(v),
    });

    const mt = D.mtbf_trend.slice(-18);
    C.lineChart($("ch-mtbf-trend"), {
      height: H("ch-mtbf-trend", 128), labels: mt.map((r) => r.month.slice(2)),
      series: [{ values: mt.map((r) => r.mtbf_h), color: "#4F9CF0", label: "MTBF", fill: true, points: true }],
      min: 0, yFmt: (v) => (v >= 1000 ? `${nf(v / 1000, 1)}k` : nf(v, 0)),
    });

    const drv = D.drivers;
    $("drv-list").innerHTML = drv.length ? drv.map((x) => `
      <div class="drv-row">
        <span class="dn">${esc(x.asset)}<span class="dp">${esc(x.param)} ${nf(x.value, 2)} ${esc(x.unit || "")}</span></span>
        <span class="dv">${nf(x.impact_pct, 2)}%</span>
        <span class="dm">${riskChipShort(x.anomaly >= 66 ? "Critical" : x.anomaly >= 33 ? "High" : "Low")}
          <span class="da">skor ${nf(x.anomaly, 0)} · ambang ${nf(x.warning, 1)}</span></span>
      </div>`).join("")
      : emptyState("Tidak ada driver", "Payload tidak memuat drivers.", "Bangun ulang payload.");
  }

  // ---------- Aset ----------
  const current = () => {
    const picked = D.assets.find((a) => a.id === state.assetId);
    if (picked) return picked;
    const rows = assets();
    const risky = (D.top5_risk[0] || {}).asset_id;
    return rows.find((a) => a.id === risky) || rows[0] || D.assets[0];
  };

  function viewAset() {
    const a = current();
    const list = `<div class="card card-col card-r1s3 card-sticky">
      <h3>Daftar aset <span class="hint" id="f-count2"></span></h3>
      ${filterBar()}
      <div class="card-body scroll" id="asset-list" style="margin-top:10px"></div>
    </div>`;

    if (!a) {
      return list + `<div class="card card-c2s2-r1s3">
        ${emptyState("Tidak ada aset pada saringan ini", "Saringan sumur, jenis, status, atau kelas tidak cocok dengan aset mana pun.",
          "Tekan Reset saringan untuk kembali ke 46 aset.")}</div>`;
    }

    const rulTop = Math.max((a.rul_hi_h || 0) * 1.15, a.rul_days ? a.rul_days * 24 : 1);
    const rulBand = (v) => Math.max(0, Math.min(100, ((v || 0) / rulTop) * 100));
    const detail = `<div class="card">
      <h3>${esc(a.name)} <span class="hint">${esc(a.id)}</span></h3>
      <div class="card-body">
        <div class="metrics tight">
          <div class="metric"><span class="k">Status</span><span class="v">${stChip(a.status, a.status === "critical" ? "Risiko tinggi" : a.status === "warning" ? "Pantau" : "Sehat")}</span></div>
          <div class="metric"><span class="k">Indeks kesehatan</span><span class="v">${nf(a.health, 1)}</span>
            <span class="note"><span class="meter ${a.status === "critical" ? "bad" : a.status === "warning" ? "warn" : "ok"}"><i style="width:${Math.max(2, Math.min(100, a.health))}%"></i></span></span></div>
          <div class="metric"><span class="k">Probabilitas gagal 7 hari</span><span class="v">${pc(a.failure_prob_7d)}</span>
            <span class="note">30 hari ${pc(a.failure_prob_30d)}</span></div>
          <div class="metric"><span class="k">Sisa umur (RUL)</span><span class="v">${nf(a.rul_days, 0)} hari</span>
            <span class="note rul-band" role="img"
              aria-label="rentang sisa umur ${nf(a.rul_lo_h, 0)} sampai ${nf(a.rul_hi_h, 0)} jam">
              <span class="band" style="left:${rulBand(a.rul_lo_h)}%;width:${Math.max(2, rulBand(a.rul_hi_h) - rulBand(a.rul_lo_h))}%"></span>
              <span class="band-mid" style="left:${rulBand(a.rul_days * 24)}%"></span>
            </span>
            <span class="note">${nf(a.rul_lo_h, 0)} sampai ${nf(a.rul_hi_h, 0)} jam</span></div>
          <div class="metric"><span class="k">MTBF</span><span class="v" style="font-size:13px">${a.mtbf_h ? nf(a.mtbf_h, 0) + " jam" : "tanpa kegagalan"}</span></div>
          <div class="metric"><span class="k">Kelas / skor risiko</span><span class="v" style="font-size:15px">${esc(a.criticality)} / ${nf(a.risk_score, 1)}</span></div>
        </div>
      </div>
    </div>`;

    const params = `<div class="card">
      <h3>Parameter kondisi <span class="hint">${ni((a.sensors || []).length)} kanal, satuan asli</span></h3>
      <div class="card-body scroll">
        <div class="param-head"><span>Parameter</span><span>Nilai</span><span>Normal</span><span>Waspada</span><span>Kritis</span><span>Sumber</span></div>
        ${(a.sensors || []).map((s) => `
          <div class="param-row"><span>${esc(s.param)} ${s.direction === "naik" ? "↑" : s.direction === "turun" ? "↓" : ""}</span>
            <span class="v">${nf(s.actual, 1)}</span><span class="v">${nf(s.normal, 1)}</span>
            <span class="v">${nf(s.warning, 1)}</span><span class="v">${nf(s.critical, 1)}</span>
            <span>${src(s.source)}</span></div>`).join("") || emptyState("Tidak ada kanal", "Aset ini tidak punya kanal telemetri.", "Parameter dibangkitkan hanya untuk aset berkanal.")}
      </div>
    </div>`;

    const trend = `<div class="card">
      <h3>Kurva degradasi <span class="hint">indeks kesehatan 0-100</span></h3>
      <div class="card-body" id="ch-deg"></div>
      <div class="legend"><span><i style="background:var(--brand)"></i>riwayat</span>
        <span><i class="dash"></i>proyeksi</span><span><i style="background:var(--monitor)"></i>ambang</span></div>
    </div>`;

    const wbv = a.weibull || {};
    const wb = `<div class="card">
      <h3>Keandalan Weibull <span class="hint">beta ${nf(wbv.beta, 3)} · eta ${nf(wbv.eta_eff || wbv.eta, 0)} jam</span></h3>
      <div class="card-body" id="ch-wb"></div>
      <div class="legend"><span><i style="background:var(--brand)"></i>R(t)</span>
        <span><i class="dash"></i>umur ${nf(a.age_h, 0)} jam</span>
        <span>keyakinan ${pc(a.confidence, 0)}</span>
        <span>${wbv.beta_clamped ? "beta diklem ke 1,0" : "beta tidak diklem"}</span></div>
    </div>`;

    const heat = `<div class="card">
      <h3>Peta anomali 24 jam <span class="hint">skor per jam</span></h3>
      <div class="card-body scroll" id="ch-heat"></div>
    </div>`;

    const modes = `<div class="card">
      <h3>Mode kegagalan <span class="hint">TERUKUR</span></h3>
      <div class="card-body">
        <div class="metrics tight">
          <div class="block"><span class="k">Akar masalah</span><span class="t">${esc(a.root_cause || "-")}</span></div>
          <div class="block"><span class="k">Tindakan disarankan</span><span class="t">${esc(a.recommended_action || "-")}</span></div>
          <div class="metric"><span class="k">Kejadian tercatat</span><span class="v">${ni(a.event_count)}</span><span class="note">365 h ${ni(a.failures_365d)} · ${nf(a.failure_rate_per_1000h, 2)}/1000 j</span></div>
          <div class="metric"><span class="k">Jendela data</span><span class="v" style="font-size:13px">${dt(a.first_seen)} - ${dt(a.last_seen)}</span></div>
        </div>
      </div>
    </div>`;

    const chans = a.series || [];
    const chNow = chans.some((s) => s.param === state.channel) ? state.channel : (chans[0] || {}).param || "";
    const tele = `<div class="card card-c2s2-r4">
      <h3>Telemetri per kanal <span class="hint">${chans.length
        ? `${chans.length} kanal × ${chans[0].t.length} titik per jam`
        : "tidak ada deret"}</span></h3>
      <div class="card-tools">${chans.length ? `<select id="f-channel" aria-label="Pilih kanal telemetri">
        ${chans.map((s) => `<option value="${esc(s.param)}"${s.param === chNow ? " selected" : ""}>${esc(s.param)}${s.unit ? " (" + esc(s.unit) + ")" : ""}</option>`).join("")}
      </select>` : ""}</div>
      <div class="card-body" id="ch-tele"></div>
      <div class="legend"><span><i style="background:var(--brand)"></i>nilai terukur</span>
        <span>${esc(chNow)}${chans.length ? ` · ${esc((chans.find((s) => s.param === chNow) || {}).unit || "")}` : ""}</span></div>
    </div>`;

    return list + detail + params + trend + wb + heat + modes + tele;
  }

  function drawAset() {
    const a = current();
    const rows = assets();
    const degById = new Map(D.degradation.map((d) => [d.asset_id, d]));
    $("asset-list").innerHTML = rows.length ? rows.map((x) => `
      <button class="item" type="button" data-asset="${esc(x.id)}" aria-current="${x.id === a.id}">
        <span class="t">${esc(x.name)}</span>
        <span class="n">${stChip(x.status, "")}</span>
        <span class="m">${esc(x.wellbore || "tanpa sumur")} · ${esc(x.type)} · risik ${nf(x.risk_score, 1)} · RUL ${nf(x.rul_days, 0)} h</span>
        <span class="spark" data-spark="${esc(x.id)}"></span>
      </button>`).join("")
      : emptyState("Tidak ada aset cocok", "Saringan aktif menyaring semua aset.", "Tekan Reset saringan.");
    const cnt = $("f-count2");
    if (cnt) cnt.textContent = `${rows.length} dari ${D.assets.length}`;
    $("asset-list").querySelectorAll("[data-asset]").forEach((b) => {
      b.addEventListener("click", () => { state.assetId = b.dataset.asset; render(); });
    });
    $("asset-list").querySelectorAll("[data-spark]").forEach((el) => {
      const dg = degById.get(el.dataset.spark);
      if (dg && dg.history && dg.history.length > 2) {
        C.sparkline(el, dg.history, el.dataset.spark === a.id ? "var(--brand)" : "#4F9CF0", 20);
      } else {
        el.remove();
      }
    });

    const deg = D.degradation.find((x) => x.asset_id === a.id);
    if (deg && deg.history.length) {
      C.curveChart($("ch-deg"), { height: H("ch-deg", 168), history: deg.history, predicted: deg.predicted, threshold: deg.threshold });
    } else {
      $("ch-deg").innerHTML = emptyState("Belum ada kurva", "Aset ini tidak masuk 20 kurva degradasi teratas.",
        "Pilih aset lain dari daftar, misalnya Wireline Tractor.");
    }

    const wbv = a.weibull || {};
    const eta = wbv.eta_eff || wbv.eta;
    if (eta && wbv.beta) {
      const steps = 48;
      const tmax = eta * 1.2;
      const vals = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = (tmax * i) / steps;
        vals.push(100 * Math.exp(-Math.pow(t / eta, wbv.beta)));
      }
      const ageIdx = Math.max(0, Math.min(steps, Math.round(((a.age_h || 0) / tmax) * steps)));
      C.lineChart($("ch-wb"), {
        height: H("ch-wb", 150), min: 0, max: 100,
        labels: vals.map((_, i) => nf((tmax * i) / steps, 0)),
        series: [{ values: vals, color: "var(--brand)", label: "R(t)", fill: true, points: true }],
        yFmt: (v) => `${nf(v, 0)}%`,
        markers: [{ i: ageIdx, color: "var(--monitor)" }],
      });
    } else {
      $("ch-wb").innerHTML = emptyState("Parameter Weibull kosong",
        "Aset ini tidak punya beta dan eta.", "Pilih aset berkanal telemetri.");
    }

    const score = (r) => (r.cells || []).reduce((x, y) => x + y, 0) / ((r.cells || []).length || 1);
    const hm = D.anomaly_heatmap.slice()
      .sort((x, y) => score(y) - score(x))
      .filter((r, i) => i < 8 || r.asset_id === a.id)
      .map((r) => ({ label: r.asset_id === a.id ? `${r.asset_id} (dipilih)` : r.asset_id, cells: r.cells }));
    if (hm.length) C.heatmap($("ch-heat"), { rows: hm });
    else $("ch-heat").innerHTML = emptyState("Tidak ada peta anomali", "Aset ini tidak punya kanal telemetri.", "Hanya aset berkanal yang dihitung.");

    const chans = a.series || [];
    const chNow = chans.some((s) => s.param === state.channel) ? state.channel : (chans[0] || {}).param || "";
    const ser = chans.find((s) => s.param === chNow);
    if (ser && (ser.v || []).length) {
      C.lineChart($("ch-tele"), {
        height: H("ch-tele", 132), min: 0,
        labels: ser.t.map((t) => String(t).slice(11, 16)),
        series: [{ values: ser.v, color: "var(--brand)", label: `${ser.param}${ser.unit ? " " + ser.unit : ""}`, fill: true, points: true }],
        yFmt: (v) => nf(v, 1),
      });
      const cs = $("f-channel");
      if (cs) cs.addEventListener("change", () => { state.channel = cs.value; render(); });
    } else {
      $("ch-tele").innerHTML = emptyState("Tidak ada deret telemetri",
        "Payload tidak memuat assets[].series untuk aset ini.", "Bangun ulang payload lewat code/exporter_full.py.");
    }
  }

  // ---------- Aksi ----------
  function wosFiltered() {
    const q = state.q;
    return byWell(D.work_orders).filter((w) =>
      (!state.assetId || w.asset_id === state.assetId || !w.asset_id) &&
      (!q || (w.wo_id + " " + (w.asset_name || "") + " " + (w.problem || "") + " " + (w.action || "")).toLowerCase().includes(q)));
  }

  function viewAksi() {
    const f = D.reliability.fleet;
    const wo = wosFiltered();
    const woCard = `<div class="card card-c1-r1s2">
      <h3>Perintah kerja terbuka <span class="hint">${ni(wo.length)} dari ${ni(D.work_orders.length)} · klik judul kolom untuk mengurutkan</span></h3>
      <div class="card-body scroll" style="overflow-x:auto"><table id="t-wo"></table></div>
    </div>`;

    const alertCard = `<div class="card card-c2-r1s2">
      <h3>Alert aktif <span class="hint">${ni(D.alerts.length)} notifikasi</span></h3>
      <div class="card-body scroll"><div class="stack" id="alert-list"></div></div>
    </div>`;

    const chronicCard = `<div class="card card-c3-r1s2">
      <h3>Kegagalan kronis <span class="hint">${ni(D.chronic.length)} pasangan sumur-komponen</span></h3>
      <div class="card-body scroll"><table id="t-chronic"></table></div>
    </div>`;

    const loopCard = `<div class="card card-c4-r1s2">
      <h3>Kinerja siklus aksi <span class="hint">SINTETIS</span></h3>
      <div class="card-body"><div class="metrics" id="loop-metrics"></div>
        <div class="notice" style="margin-top:10px">Deteksi ${pc(D.control_loop.detection, 0)}, respons ${pc(D.control_loop.response, 0)},
        penutupan ${pc(D.control_loop.closure, 0)}, standardisasi ${pc(D.control_loop.standardization, 0)}. Angka ini mengukur alur kerja, bukan kondisi mesin.</div>
      </div>
    </div>`;

    const advisoryCard = `<div class="card card-c1-r3">
      <h3>Rekomendasi tindakan <span class="hint">${ni(D.advisory.length)} aktif · SINTETIS</span></h3>
      <div class="card-body scroll"><div class="stack" id="adv-list-full"></div></div>
    </div>`;

    const histCard = `<div class="card card-c2s2-r3">
      <h3>Riwayat perawatan <span class="hint">${ni(D.history.length)} catatan</span></h3>
      <div class="card-body scroll" style="overflow-x:auto"><table id="t-hist"></table></div>
    </div>`;

    const costCard = `<div class="card card-c4-r3">
      <h3>Biaya per bulan <span class="hint">USD, ${nf(f.cost_usd / 1e6, 2)} juta total</span></h3>
      <div class="card-body" id="ch-cost"></div>
      <div class="legend"><span><i style="background:var(--brand)"></i>work order</span>
        <span><i style="background:var(--monitor)"></i>downtime</span></div>
    </div>`;

    const journalCard = `<div class="card card-c1s2-r4">
      <h3>Jurnal kejadian lapangan <span class="hint">${ni(D.events_recent.length)} catatan · TERUKUR</span></h3>
      <div class="card-body scroll" style="overflow-x:auto"><table id="t-journal"></table></div>
    </div>`;

    const spareCard = `<div class="card card-c3s2-r4">
      <h3>Kebutuhan suku cadang <span class="hint">dari ${ni(D.work_orders.length)} work order</span></h3>
      <div class="card-body scroll"><table id="t-spare"></table></div>
    </div>`;

    return woCard + alertCard + costCard + chronicCard + loopCard + advisoryCard
      + histCard + journalCard + spareCard;
  }

  function drawAksi() {
    const wos = wosFiltered().slice(0, 60);
    table($("t-wo"),
      [{ label: "WO", p: 1 }, { label: "Aset", wrap: true, p: 1 }, { label: "Masalah", wrap: true, p: 1 }, { label: "Prioritas", p: 1 },
       { label: "Status", p: 2 }, { label: "Jatuh tempo", p: 2 }, { label: "Suku cadang", wrap: true, p: 3 }, { label: "Biaya", num: true, p: 3 }],
      wos.map((w) => [
        `${esc(w.wo_id)}<br>${src(w.layer)}`,
        `${esc(w.asset_name || "-")}<br><span class="src">${esc(w.asset_id || w.wellbore || "-")}</span>`,
        `<span class="wrap">${esc(w.problem || w.action || "-")}</span>`,
        esc(w.status), priChip(w.priority), dt(w.due),
        `<span class="wrap">${esc(w.spare || "-")}</span>`, usd(w.cost_usd),
      ]),
      ["Tidak ada work order", "Saringan sumur atau aset menyaring semua work order.",
       "Tekan Reset saringan pada tab Aset, atau pilih sumur lain."]);

    const al = D.alerts.slice(0, 12);
    $("alert-list").innerHTML = al.length ? al.map((x) => `
      <div class="metric">
        <span class="k">${stChip(x.severity === "Critical" ? "critical" : "warning", x.severity)} ${esc(x.alert)}</span>
        <span class="v" style="font-size:12px">${dt(x.time)}</span>
        <span class="note">${esc(x.asset)} · ${esc(x.detail)} ${src(x.source)}</span>
      </div>`).join("") : emptyState("Tidak ada alert", "Payload tidak memuat alert aktif.", "Bangun ulang payload.");

    table($("t-chronic"),
      [{ label: "Sumur", p: 1 }, { label: "Komponen", wrap: true, p: 1 }, { label: "Kejadian", num: true, p: 1 }, { label: "Downtime", num: true, p: 2 }],
      D.chronic.map((c) => [esc(c.wellbore || "-"), `<span class="wrap">${esc(c.component)}</span>`, ni(c.count), `${nf(c.downtime_h, 1)} j`]));

    const L = D.control_loop;
    $("loop-metrics").innerHTML = [["Deteksi", L.detection], ["Respons", L.response], ["Penutupan", L.closure], ["Standardisasi", L.standardization]]
      .map(([k, v]) => `<div class="metric"><span class="k">${k}</span><span class="v">${pc(v, 0)}</span>
        <span class="note"><span class="meter ${v > 0.9 ? "ok" : v > 0.7 ? "warn" : "bad"}"><i style="width:${v * 100}%"></i></span></span></div>`).join("");

    table($("t-hist"),
      [{ label: "Tanggal", p: 2 }, { label: "Aset", wrap: true, p: 2 }, { label: "Masalah", wrap: true, p: 1 }, { label: "Teknisi", p: 3 }, { label: "Durasi", num: true, p: 3 }, { label: "Biaya", num: true, p: 3 }],
      byWell(D.history).slice(0, 40).map((h) => [
        dt(h.date), `${esc(h.asset || "-")}<br><span class="src">${esc(h.asset_id || "-")}</span>`,
        `<span class="wrap">${esc(h.problem || "-")}</span>`, esc(h.technician || "-"), `${nf(h.duration_h, 1)} j`, usd(h.cost_usd),
      ]),
      ["Tidak ada riwayat", "Saringan aktif tidak menemukan catatan perawatan.", "Longgarkan saringan."]);

    const ct = D.cost_trend.slice(-14);
    C.barChart($("ch-cost"), {
      height: H("ch-cost", 132), labels: ct.map((r) => r.month.slice(2)), stacked: true,
      series: [
        { values: ct.map((r) => r.wo_cost_usd), color: "var(--brand)", label: "work order" },
        { values: ct.map((r) => r.downtime_cost_usd), color: "var(--monitor)", label: "downtime" },
      ],
      yFmt: (v) => (v >= 1000 ? `${nf(v / 1000, 0)}k` : nf(v, 0)),
    });

    $("adv-list-full").innerHTML = D.advisory.length ? D.advisory.map((x) => `
      <div class="advisory rek">
        <div class="ad-head">${esc(x.title)}</div>
        <p>${esc(x.basis)}</p>
        <div class="ad-meta">${esc(x.action)} · keyakinan ${pc(x.confidence, 0)} · ${esc(x.asset_id || "-")}</div>
      </div>`).join("")
      : emptyState("Belum ada rekomendasi", "Payload tidak memuat advisory.", "Bangun ulang payload.");

    table($("t-journal"),
      [{ label: "Tanggal", p: 2 }, { label: "Sumur", wrap: true, p: 1 }, { label: "Kategori", wrap: true, p: 2 },
       { label: "Ringkasan", wrap: true, p: 1 }, { label: "BHA", p: 3 }],
      D.events_recent.slice().sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")))
        .slice(0, 80).map((e) => [
          dt(e.date), `<span class="wrap">${esc(e.wellbore || "-")}</span>`,
          `<span class="wrap">${esc(String(e.category || "-").replace(/_/g, " "))}</span>`,
          `<span class="wrap">${esc(e.comment || "-")}</span>`,
          e.bha_relevant === "yes" ? stChip("warning", "relevan") : `<span class="src">tidak</span>`,
        ]),
      ["Tidak ada jurnal", "Payload tidak memuat events_recent.", "Bangun ulang payload."]);

    const sp = {};
    D.work_orders.forEach((w) => {
      const key = (w.spare || "").trim();
      if (key && key !== "Tidak ada") sp[key] = (sp[key] || 0) + 1;
    });
    const spRows = Object.entries(sp).sort((x, y) => y[1] - x[1]).slice(0, 12);
    const spTotal = spRows.reduce((a, r) => a + r[1], 0) || 1;
    table($("t-spare"),
      [{ label: "Suku cadang", wrap: true, p: 1 }, { label: "WO", num: true, p: 2 }, { label: "Porsi", num: true, p: 2 }],
      spRows.map(([k, v]) => [`<span class="wrap">${esc(k)}</span>`, ni(v), pc(v / spTotal, 1)]),
      ["Tidak ada data suku cadang", "Perintah kerja tidak mencantumkan spare.", "Bangun ulang payload."]);
  }

  // ---------- Keandalan ----------
  function viewKeandalan() {
    const f = D.reliability.fleet;
    const mtSeries = D.mtbf_trend.filter((r) => r.mtbf_h !== null);
    const mtLast = mtSeries[mtSeries.length - 1] || {};
    const mtPrev = mtSeries[mtSeries.length - 2] || {};
    const mtDelta = (typeof mtLast.mtbf_h === "number" && typeof mtPrev.mtbf_h === "number")
      ? mtLast.mtbf_h - mtPrev.mtbf_h : null;
    const kpis = `<div class="kpis five">
      ${kpiTile({ icon: ICO.clock, label: "MTBF armada", value: nf(f.mtbf_h, 0), unit: "jam",
        delta: mtDelta === null ? undefined : mtDelta, note: mtDelta === null ? " tanpa pembanding bulanan" : " jam vs bulan sebelumnya" })}
      ${kpiTile({ icon: ICO.wrench, label: "MTTR armada", value: nf(f.mttr_h, 2), unit: "jam", trend: `${ni(f.completed_wo)} WO selesai`, note: ` ${ni(f.unplanned_wo)} tak terencana` })}
      ${kpiTile({ icon: ICO.shield, label: "Ketersediaan", value: pc(f.availability, 2), unit: "", trend: `${nf(f.downtime_h, 0)} jam berhenti`, note: " akumulasi" })}
      ${kpiTile({ icon: ICO.money, label: "Biaya kegagalan", value: usd(f.cost_usd), unit: "", trend: `${nf(f.failure_rate_per_1000h, 2)}/1000 j`, note: " laju kegagalan" })}
      ${kpiTile({ icon: ICO.alert, label: "Penyimpangan SPC", value: ni(D.exceptions.length), unit: "kanal", trend: `${ni(D.chronic.length)} kronis`, note: " pasangan sumur" })}
    </div>`;

    const rowA = `<div class="row3">
      ${card("MTBF per komponen", "7 komponen terbesar", `<div class="card-body" id="ch-mtbf"></div>`)}
      ${card("Tabel keandalan", "TURUNAN", `<div class="card-body scroll"><table id="t-rel"></table></div>`)}
      ${card("Parameter Weibull", "per jenis komponen", `<div class="card-body scroll"><table id="t-wb"></table></div>`)}
    </div>`;

    const rowB = `<div class="row2">
      ${card("Kurva degradasi", "20 aset berisiko tertinggi", `<div class="card-body scroll" id="deg-list"></div>`)}
      ${card("Penyimpangan SPC", "Western Electric", `<div class="card-body scroll"><table id="t-spc"></table></div>`)}
    </div>`;

    const rowC = `<div class="row3">
      ${card("Diagnosa aktif", "TURUNAN", `<div class="card-body scroll"><table id="t-diag"></table></div>`)}
      ${card("Kegagalan nyata", "TERUKUR", `<div class="card-body" id="ch-realmode"></div>`)}
      ${card("Mode prediksi", "TURUNAN", `<div class="card-body" id="ch-predmode"></div>`)}
    </div>`;

    const wellKeys = Object.keys(MO.series || {});
    const cur = wellKeys.includes(state.modelWell) ? state.modelWell : wellKeys[0];
    const rowD = `<div class="row2">
      ${card("Skor model per sumur", cur ? `${esc(cur)} · ambang ${nf((MO.series[cur] || {}).threshold, 4)}` : "tidak ada sumur",
        `<div class="card-tools"><select id="f-modelwell" aria-label="Pilih sumur untuk skor model">
          ${wellKeys.map((w) => `<option value="${esc(w)}"${w === cur ? " selected" : ""}>${esc(w)}</option>`).join("")}
        </select></div>
        <div class="card-body" id="ch-wscore"></div>
        <div class="legend"><span><i style="background:var(--brand)"></i>skor</span>
          <span><i class="dash"></i>ambang</span>
          <span><i style="background:var(--monitor)"></i>kejadian nyata</span></div>`)}
      ${card("Kejadian nyata per sumur", "segmen dari payload engine",
        `<div class="card-body scroll"><table id="t-wseg"></table></div>`)}
    </div>`;

    return kpis + rowA + rowB + rowC + rowD;
  }

  function drawKeandalan() {
    const comps = D.reliability.components.filter((c) => c.mtbf_h)
      .slice().sort((x, y) => y.mtbf_h - x.mtbf_h).slice(0, 7);
    C.barChart($("ch-mtbf"), {
      height: H("ch-mtbf", 150), labels: comps.map((c) => c.component.split(" ")[0].slice(0, 8)),
      series: [{ values: comps.map((c) => c.mtbf_h), color: "#4F9CF0" }],
      yFmt: (v) => (v >= 1000 ? `${nf(v / 1000, 1)}k` : nf(v, 0)),
    });

    table($("t-rel"),
      [{ label: "Komponen", wrap: true, p: 1 }, { label: "Gagal", num: true, p: 1 }, { label: "MTBF", num: true, p: 1 },
       { label: "MTTR", num: true, p: 2 }],
      D.reliability.components.map((c) => [
        `<span class="wrap">${esc(c.component)}</span>`, ni(c.failures),
        c.mtbf_h ? nf(c.mtbf_h, 0) : "-", nf(c.mttr_h, 2),
      ]));

    table($("t-wb"),
      [{ label: "Komponen", wrap: true }, { label: "Beta", num: true }, { label: "Eta (jam)", num: true }, { label: "n", num: true }],
      Object.entries(D.weibull).map(([k, v]) => [
        `<span>${esc(k.length > 16 ? k.slice(0, 15) + "…" : k)}${v.borrowed ? ' <span class="src">pinjam</span>' : ""}</span>`,
        nf(v.beta, 3), nf(v.eta, 0), ni(v.n),
      ]));

    const deg = D.degradation.slice(0, 20);
    $("deg-list").innerHTML = deg.map((d) => `
      <div class="metric" style="border-bottom:1px solid var(--border-subtle);padding:4px 0">
        <span class="k">${esc(d.asset)} ${riskChip(d.risk)}</span>
        <span class="v" style="font-size:13px">${nf(d.rul_days, 0)} hari</span>
        <span class="note">${d.history.length} titik riwayat · proyeksi ${d.predicted.length} titik · ambang ${nf(d.threshold, 0)} · ${esc(d.source)}</span>
      </div>`).join("") || emptyState("Tidak ada kurva", "Payload tidak memuat degradation.", "Bangun ulang payload.");

    table($("t-spc"),
      [{ label: "Sumur" }, { label: "Kanal" }, { label: "Aturan", wrap: true }, { label: "Nilai", num: true }, { label: "Waktu" }],
      D.exceptions.map((e) => [
        esc(e.wellbore || "-"), esc(e.channel), `<span class="wrap">${esc(e.rule)}</span>`,
        nf(e.last_value, 1), dt(e.last_time),
      ]));

    table($("t-diag"),
      [{ label: "Aset", wrap: true }, { label: "Jenis", wrap: true }, { label: "Tanggal" }, { label: "Keyakinan", num: true }],
      D.diagnosis.slice(0, 24).map((x) => [
        `<span class="wrap">${esc(x.asset)}</span>`, `<span class="wrap">${esc(x.failure_type)}</span>`,
        dt(x.detection_date), pc(x.confidence, 0),
      ]));

    const real = D.failure_modes.real.slice(0, 5);
    C.barChart($("ch-realmode"), {
      height: H("ch-realmode", 150), labels: real.map((r) => r.label.slice(0, 12)),
      series: [{ values: real.map((r) => r.count), color: "var(--brand)", label: "kejadian nyata" }], yFmt: (v) => ni(v),
    });
    const pred = D.failure_modes.prediction.slice(0, 5);
    C.barChart($("ch-predmode"), {
      height: H("ch-predmode", 150), labels: pred.map((r) => r.label.slice(0, 12)),
      series: [{ values: pred.map((r) => r.count), color: "var(--monitor)", label: "prediksi" }], yFmt: (v) => ni(v),
    });

    const wellKeys = Object.keys(MO.series || {});
    const cur = wellKeys.includes(state.modelWell) ? state.modelWell : wellKeys[0];
    const sel = $("f-modelwell");
    if (sel) sel.addEventListener("change", () => { state.modelWell = sel.value; render(); });
    const ws = (MO.series || {})[cur];
    if (ws && ws.points && ws.points.length) {
      const step = Math.max(1, Math.ceil(ws.points.length / 240));
      const pts = ws.points.filter((_, i) => i % step === 0);
      const marks = [];
      pts.forEach((p, i) => { if (p[2] === 1) marks.push({ i, color: "var(--monitor)" }); });
      C.lineChart($("ch-wscore"), {
        height: H("ch-wscore", 150),
        labels: pts.map((p) => dtt(p[0])),
        series: [{ values: pts.map((p) => p[1]), color: "var(--brand)", label: "skor", points: true }],
        min: 0, yFmt: (v) => nf(v, 3),
        thresholds: [{ value: ws.threshold, color: "var(--monitor)", label: `ambang ${nf(ws.threshold, 4)}` }],
        markers: marks,
      });
    } else {
      $("ch-wscore").innerHTML = emptyState("Tidak ada deret skor",
        "Payload engine tidak memuat sumur ini.", "Pilih sumur lain dari daftar.");
    }

    const seg = ((MO.segments || {})[cur] || {}).actual || [];
    table($("t-wseg"),
      [{ label: "Mulai" }, { label: "Selesai" }, { label: "Durasi" }, { label: "Menit" }],
      seg.slice().sort((x, y) => String(x[0]).localeCompare(String(y[0]))).map((x) => {
        const bad = new Date(x[1]) < new Date(x[0]);
        return [dtt(x[0]),
          bad ? `<span class="src" title="payload mencatat selesai lebih awal dari mulai">urutan cek</span>` : dtt(x[1]),
          `${nf((x[2] || 0) / 60, 1)} j`, ni(x[2])];
      }),
      ["Tidak ada segmen", "Sumur ini tidak punya segmen kejadian nyata.", "Pilih sumur lain."]);
  }

  // ---------- Model ----------
  const pct01 = (x) => (typeof x === "number" ? `${nf(x * 100, 1)}%` : "-");
  const foldEngine = (fold, key) => (fold.engines && fold.engines[key]) || {};

  function viewModel() {
    const pooled = MO.pooled || {};
    const w = pooled.window || {};
    const r = pooled.row || {};
    const pe = pooled.persistence || {};
    const ru = pooled.rule || {};
    if (!Object.keys(pooled).length) {
      return `<div class="card card-r1s5">${emptyState("Data model tidak tersedia",
        "Berkas data/pm_full.js tidak termuat atau tidak berisi overview.pooled.",
        "Pastikan data/pm_full.js ada, lalu jalankan code/exporter_full.py bila perlu.")}</div>`;
    }
    const dWin = typeof w.pr_auc === "number" && typeof pe.pr_auc === "number" ? w.pr_auc - pe.pr_auc : undefined;
    const dRow = typeof r.pr_auc === "number" && typeof pe.pr_auc === "number" ? r.pr_auc - pe.pr_auc : undefined;
    const kpis = `<div class="kpis">
      ${kpiTile({ icon: ICO.gauge, label: "PR-AUC jendela RF", value: nf(w.pr_auc, 4), unit: "",
        delta: dWin, note: " selisih vs persistence", trend: `recall ${pct01(w.recall)}` })}
      ${kpiTile({ icon: ICO.gauge, label: "PR-AUC per baris RF", value: nf(r.pr_auc, 4), unit: "",
        delta: dRow, note: " selisih vs persistence", trend: `recall ${pct01(r.recall)}` })}
      ${kpiTile({ icon: ICO.shield, label: "Baseline persistence", value: nf(pe.pr_auc, 4), unit: "",
        trend: `recall ${pct01(pe.recall)}`, note: " pembanding wajib" })}
      ${kpiTile({ icon: ICO.alert, label: "Aturan z", value: nf(ru.pr_auc, 4), unit: "",
        trend: `recall ${pct01(ru.recall)}`, note: ` · prevalensi ${pct01(w.prev)}` })}
    </div>`;

    const cm = `<div class="cm" role="table" aria-label="Matriks konfusi jendela">
      <span class="cm-h"></span><span class="cm-h">prediksi positif</span><span class="cm-h">prediksi negatif</span>
      <span class="cm-h">nyata positif</span><span class="cm-c hit">${ni(w.tp)}</span><span class="cm-c miss">${ni(w.fn)}</span>
      <span class="cm-h">nyata negatif</span><span class="cm-c fa">${ni(w.fp)}</span><span class="cm-c tn">${ni(w.tn)}</span>
    </div>
    <div class="metrics tight" style="margin-top:8px">
      <div class="metric"><span class="k">Presisi / recall / F1</span>
        <span class="v" style="font-size:13px">${nf(w.precision, 3)} / ${nf(w.recall, 3)} / ${nf(w.f1, 3)}</span></div>
      <div class="metric"><span class="k">Laju alert</span><span class="v" style="font-size:13px">${pct01(w.alert_rate)}</span>
        <span class="note">${ni(w.n)} baris uji, ${ni(w.n_pos)} positif</span></div>
    </div>`;

    const rowA = `<div class="row3">
      ${card("Kurva precision-recall", "pooled LOWO, sumbu-x recall",
        `<div class="card-body" id="ch-pr"></div>
        <div class="legend"><span><i style="background:var(--brand)"></i>model RF</span>
          <span><i class="dash"></i>acak ${nf((MO.pr_curve || {}).baseline, 4)}</span>
          <span><i style="background:var(--monitor)"></i>titik operasi</span></div>`)}
      ${card("Ringkasan protokol", "apa adanya", `<div class="card-body">
        <div class="metrics tight">
          <div class="metric"><span class="k">Target</span><span class="v" style="font-size:13px">${esc((MO.meta || {}).target || "-")}</span>
            <span class="note">${esc((MO.meta || {}).target_note || "")}</span></div>
          <div class="metric"><span class="k">Protokol</span><span class="v" style="font-size:13px">LOWO</span>
            <span class="note">${esc((MO.meta || {}).protocol || "")}</span></div>
          <div class="metric"><span class="k">Model</span><span class="v" style="font-size:13px">${esc((MO.meta || {}).model || "-")}</span>
            <span class="note">${ni((MO.meta || {}).source_rows)} baris sumber</span></div>
          <div class="metric"><span class="k">Lipatan sumur</span><span class="v">${ni((MO.folds || []).length)}</span>
            <span class="note">${(MO.folds || []).map((f) => esc(f.label)).join(", ")}</span></div>
        </div>
      </div>`)}
      ${card("Matriks konfusi", "ambang lipatan", `<div class="card-body">${cm}</div>`)}
    </div>`;

    const shap = MO.shap || {};
    const rowB = `<div class="row3">
      ${card("SHAP kanal teratas", `${ni(shap.n_samples)} sampel · ${esc(shap.engine || "-")}`,
        `<div class="card-body scroll" id="ch-shap"></div>`)}
      ${card("Sebaran skor", "porsi di dalam kelas", `<div class="card-body" id="ch-hist"></div>
        <div class="legend"><span><i style="background:#4F9CF0"></i>normal</span>
          <span><i style="background:var(--brand)"></i>kejadian</span></div>`)}
      ${card("Kinerja 10 engine", "PR-AUC median per lipatan", `<div class="card-body" id="ch-eng"></div>`)}
    </div>`;

    const rowC = `<div class="row3">
      ${card("Kinerja per lipatan", "LOWO, ambang per lipatan", `<div class="card-body scroll"><table id="t-fold"></table></div>`)}
      ${card("Rincian engine", "SINTETIS label tugas", `<div class="card-body scroll"><table id="t-eng"></table></div>`)}
      ${card("Kesehatan USROP per sumur", "TERUKUR", `<div class="card-body scroll"><table id="t-usrop"></table></div>`)}
    </div>`;

    const srcList = ((MO.meta || {}).source_csv ? [String(MO.meta.source_csv)] : [])
      .concat(((MO.meta || {}).sources) || []);
    const rowD = `<div class="card">
      <h3>Sumber dan batas data <span class="hint">yang tidak digambar, disebut di sini</span></h3>
      <div class="card-body scroll">
        <div class="metrics tight">
          <div class="metric"><span class="k">Berkas sumber</span><span class="v" style="font-size:12px">${ni(new Set(srcList).size)}</span>
            <span class="note">${[...new Set(srcList)].map(esc).join(" · ") || "-"}</span></div>
          <div class="metric"><span class="k">Dibangun</span><span class="v" style="font-size:12px">${esc((M.meta || {}).generated_at_utc || (MO.meta || {}).generated_at_utc || "-")}</span>
            <span class="note">payload plant ${esc(D.meta.as_of)}</span></div>
          <div class="block"><span class="k">Batas yang diketahui</span><span class="t">
            Kurva untuk baseline persistence dan aturan-z tidak ada di payload, jadi yang tampil hanya angka tunggalnya.
            Deret telemetri mentah tidak termasuk di sini; yang tersedia hanya skor model per sumur di tab Keandalan.
            Matriks konfusi memakai ambang lipatan, bukan satu ambang global.</span></div>
        </div>
      </div>
    </div>`;

    return kpis + rowA + rowB + rowC + rowD;
  }

  function drawModel() {
    const pr = MO.pr_curve || {};
    const w = (MO.pooled || {}).window || {};
    if (pr.precision && pr.precision.length && pr.recall && pr.recall.length) {
      const step = Math.max(1, Math.floor(pr.precision.length / 80));
      const idx = [];
      for (let i = pr.precision.length - 1; i >= 0; i -= step) idx.push(i);
      const opIdx = idx.reduce((best, i) =>
        Math.abs(pr.recall[i] - w.recall) < Math.abs(pr.recall[best] - w.recall) ? i : best, idx[0]);
      C.lineChart($("ch-pr"), {
        height: H("ch-pr", 150),
        labels: idx.map((i) => nf(pr.recall[i], 2)),
        series: [{ values: idx.map((i) => pr.precision[i]), color: "var(--brand)", label: "precision", points: true }],
        min: 0, yFmt: (v) => nf(v, 2),
        thresholds: pr.baseline
          ? [{ value: pr.baseline, color: "var(--text-3)", label: `acak ${nf(pr.baseline, 4)}` }] : [],
        markers: [{ i: idx.indexOf(opIdx), color: "var(--monitor)" }],
      });
    } else {
      $("ch-pr").innerHTML = emptyState("Kurva tidak tersedia",
        "payload tidak memuat precision dan recall berpasangan.", "Jalankan ulang code/exporter_full.py.");
    }

    const shap = MO.shap || {};
    if (shap.labels && shap.mean_abs) {
      const rows = shap.labels.map((lab, i) => ({
        label: String(lab),
        value: shap.mean_abs[i],
        color: (shap.signed_mean && shap.signed_mean[i] < 0) ? "var(--monitor)" : "var(--brand)",
      })).sort((a, b) => b.value - a.value).slice(0, 12);
      C.hBar($("ch-shap"), { rows, fmt: (v) => nf(v, 4), labelWidth: 150 });
    } else {
      $("ch-shap").innerHTML = emptyState("SHAP tidak tersedia", "payload engine tidak memuat shap.", "Jalankan ulang exporter.");
    }

    const h = MO.histogram || {};
    if (h.edges && h.negative && h.positive) {
      const bins = h.negative.length;
      const k = Math.max(1, Math.ceil(bins / 8));
      const mid = [];
      const neg = [];
      const pos = [];
      for (let i = 0; i < bins; i += k) {
        mid.push(`${nf(h.edges[i], 2)}`);
        neg.push(h.negative.slice(i, i + k).reduce((a, b) => a + b, 0));
        pos.push(h.positive.slice(i, i + k).reduce((a, b) => a + b, 0));
      }
      const nSum = neg.reduce((a, b) => a + b, 0) || 1;
      const pSum = pos.reduce((a, b) => a + b, 0) || 1;
      C.barChart($("ch-hist"), {
        height: H("ch-hist", 150), labels: mid,
        series: [
          { values: neg.map((v) => (v / nSum) * 100), color: "#4F9CF0", label: "normal" },
          { values: pos.map((v) => (v / pSum) * 100), color: "var(--brand)", label: "kejadian" },
        ],
        yFmt: (v) => `${nf(v, 0)}%`,
      });
    } else {
      $("ch-hist").innerHTML = emptyState("Histogram tidak tersedia", "payload tidak memuat histogram skor.", "Jalankan ulang exporter.");
    }

    const eng = D.engines || [];
    C.barChart($("ch-eng"), {
      height: H("ch-eng", 150), labels: eng.map((e) => e.engine.slice(0, 8)),
      series: [{ values: eng.map((e) => e.rf_median), color: "#4F9CF0", label: "PR-AUC" }],
      yFmt: (v) => nf(v, 2),
    });

    table($("t-fold"),
      [{ label: "Sumur" }, { label: "Baris", num: true }, { label: "Positif", num: true }, { label: "Prevalensi", num: true },
       { label: "PR-AUC baris", num: true }, { label: "PR-AUC jendela", num: true },
       { label: "Persistence", num: true }, { label: "Recall jendela", num: true }],
      (MO.folds || []).map((f) => [
        esc(f.label || f.well), ni(f.n), ni(f.n_pos), pct01(f.prev),
        nf(foldEngine(f, "row").pr_auc, 4), nf(foldEngine(f, "window").pr_auc, 4),
        nf(foldEngine(f, "persistence").pr_auc, 4), pct01(foldEngine(f, "window").recall),
      ]),
      ["Tidak ada lipatan", "payload tidak memuat folds.", "Jalankan ulang exporter."]);

    table($("t-eng"),
      [{ label: "Engine", wrap: true }, { label: "Median", num: true }, { label: "Min", num: true },
       { label: "Maks", num: true }, { label: "Lipatan", num: true }],
      eng.map((e) => [`<span class="wrap">${esc(e.name)}<br><span class="src">${esc(e.claim || "")}</span></span>`,
        nf(e.rf_median, 3), nf(e.rf_min, 3), nf(e.rf_max, 3), ni(e.n_folds)]));

    table($("t-usrop"),
      [{ label: "Sumur", wrap: true }, { label: "Health", num: true }, { label: "Normal", num: true },
       { label: "Low ROP", num: true }, { label: "MSE/wear", num: true }],
      Object.entries(D.usrop || {}).map(([k, v]) => {
        const lab = Object.fromEntries((v.labels || []).map(([n, c]) => [n, c]));
        return [`<span class="wrap">${esc(k.replace(/^USROP_A \d+ /, ""))}</span>`, nf(v.health_index_median, 0),
          ni(lab.normal || 0), ni(lab.low_ROP_efficiency || 0), ni(lab.high_MSE_bit_wear || 0)];
      }));
  }

  // ---------- kerangka: navigasi, jam, fakta samping ----------
  const HEAD = {
    operasi: ["Operasi", "Drilling Operations Supervisor · Shift A 06:00-14:00"],
    aset: ["Aset", "Kondisi peralatan permukaan dan BHA"],
    aksi: ["Aksi", "Perintah kerja, alert, dan riwayat perawatan"],
    keandalan: ["Keandalan", "MTBF, MTTR, Weibull, dan penyimpangan kanal"],
    model: ["Model", "Hasil engine capstone apa adanya"],
  };

  function setView(v, push) {
    if (!VIEWS.includes(v)) v = "operasi";
    if (v !== state.view) scrollMemo.clear();
    state.view = v;
    VIEWS.forEach((k) => {
      const el = $("v-" + k);
      if (el) el.hidden = k !== v;
      const btn = document.querySelector(`.nav-item[data-view="${k}"]`);
      if (btn) btn.setAttribute("aria-current", k === v ? "page" : "false");
    });
    $("tb-heading").textContent = HEAD[v][0];
    $("tb-sub").textContent = HEAD[v][1];
    if (push && location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
    render();
  }

  function fillSidePanel() {
    const o = D.overview;
    const rows = [["Sehat", o.healthy, "ok"], ["Pantau", o.warning, "warn"], ["Risiko tinggi", o.critical, "bad"]];
    const host = $("side-health");
    if (host) host.innerHTML = rows.map(([k, v, cls]) => `
      <div class="sp-row"><span>${k}</span><b>${ni(v)}</b>
        <span class="meter ${cls}"><i style="width:${(v / (o.total || 1)) * 100}%"></i></span></div>`).join("");
    const cov = $("side-cover");
    if (cov) cov.innerHTML = [
      ["Kanal per aset", ni(paramCount())],
      ["Baris WITSML", ni(D.meta.witsml_rows)],
      ["Kejadian nyata", ni(D.meta.real_events)],
      ["Perintah kerja", ni(D.work_orders.length)],
      ["Kurva degradasi", ni(D.degradation.length)],
    ].map(([k, v]) => `<div class="sp-row"><span>${k}</span><b>${v}</b></div>`).join("");
  }

  function shellFacts() {
    $("sf-asof").textContent = dt(D.meta.as_of);
    $("sf-tel").textContent = dt(D.meta.telemetry_last);
    $("sf-seed").textContent = ni(D.meta.seed);
    $("clk-date").textContent = dt(D.meta.as_of);
    $("clk-time").textContent = "23:59 acuan tetap";
    $("bell-count").textContent = ni(D.alerts.length);
    const counts = {
      operasi: D.overview.total, aset: D.assets.length, aksi: D.overview.open_actions,
      keandalan: D.exceptions.length, model: (D.models && D.models.folds ? D.models.folds.length : 0),
    };
    Object.entries(counts).forEach(([k, v]) => {
      const el = document.querySelector(`[data-count="${k}"]`);
      if (el) el.textContent = ni(v);
    });
    fillSidePanel();
    $("foot-left").textContent = `Sperry Drill · dibangun ${dt(D.meta.as_of)} · seed ${D.meta.seed} · ${ni(D.meta.real_events)} kejadian nyata`;
  }

  function bindFilters() {
    const map = [["f-well", "well"], ["f-type", "type"], ["f-status", "status"], ["f-crit", "crit"]];
    map.forEach(([id, key]) => {
      const el = $(id);
      if (el) el.addEventListener("change", () => { state[key] = el.value; render(); });
    });
    const rs = $("f-reset");
    if (rs) rs.addEventListener("click", () => {
      state.well = state.type = state.status = state.crit = state.q = "";
      const s = $("q-search");
      if (s) s.value = "";
      render();
    });
    const cnt = $("f-count");
    if (cnt) cnt.textContent = `${assets().length} aset lolos saringan`;
  }

  // P-14: render() mengganti seluruh isi view, jadi posisi gulir, nilai dropdown,
  // dan fokus harus diambil dulu lalu dipulihkan setelah isi baru terpasang.
  function uiPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return "#" + el.id;
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body && n !== document.documentElement) {
      let i = 1;
      let s = n;
      while ((s = s.previousElementSibling)) if (s.tagName === n.tagName) i++;
      parts.unshift(n.tagName.toLowerCase() + ":nth-of-type(" + i + ")");
      n = n.parentElement;
    }
    return parts.length ? parts.join(">") : null;
  }

  // P-14: render()/resize mengganti isi atau tata letak, jadi posisi gulir, nilai
  // dropdown, dan fokus diambil dulu lalu dipulihkan.
  const scrollMemo = new Map();
  let lastRatio = 0;

  function isRootLike(el) {
    return el === document.body || el === document.documentElement || el === document.scrollingElement;
  }

  function rootTop() { return Math.round(window.scrollY || window.pageYOffset || 0); }

  function rootMax() {
    const d = document.scrollingElement || document.documentElement;
    return Math.max(0, d.scrollHeight - window.innerHeight);
  }

  // penggulung aktif berpindah elemen saat ambang media query terlewati:
  // di layar lebar .main yang bergulir, di layar sempit jendela yang bergulir
  function activeScroller() {
    const main = document.querySelector(".main");
    const mainMax = main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0;
    const wMax = rootMax();
    if (mainMax <= 4 && wMax <= 4) return null;
    return mainMax > wMax ? main : "window";
  }

  function scrollerPos(sc) { return sc === "window" ? rootTop() : sc.scrollTop; }
  function scrollerMax(sc) { return sc === "window" ? rootMax() : Math.max(0, sc.scrollHeight - sc.clientHeight); }

  function scrollerSeek(sc, top) {
    if (sc === "window") {
      if (Math.abs(rootTop() - top) > 2) window.scrollTo(0, top);
    } else if (Math.abs(sc.scrollTop - top) > 2) {
      sc.scrollTop = top;
    }
  }

  function rememberRatio() {
    const sc = activeScroller();
    if (!sc) return;
    const max = scrollerMax(sc);
    if (max <= 4) return;
    const r = scrollerPos(sc) / max;
    // nol muncul saat tata ulang memaksa gulir ke atas, bukan posisi pilihan pengguna
    if (r > 0) lastRatio = r;
  }

  // peristiwa scroll pada elemen tidak melewati document saat fase tangkap,
  // jadi pendengar dipasang langsung pada jendela dan wadah gulir utama
  function onScrollEvent(ev) {
    const t = ev.target;
    const el = (t === window || t === document) ? null : t;
    if (el && el.nodeType === 1 && (el.scrollTop || el.scrollLeft)) {
      const k = isRootLike(el) ? "@root" : uiPath(el);
      if (k) scrollMemo.set(k, [el.scrollTop, el.scrollLeft]);
    }
    rememberRatio();
  }

  function bindScrollWatch() {
    if (bindScrollWatch.done) return;
    [window, document.querySelector(".main")].filter(Boolean).forEach((t) => t.addEventListener("scroll", onScrollEvent, { passive: true }));
    bindScrollWatch.done = true;
  }

  function snapUI() {
    const live = new Map();
    document.querySelectorAll("*").forEach((el) => {
      if (!el.scrollTop && !el.scrollLeft) return;
      if (isRootLike(el)) return;
      const k = uiPath(el);
      if (k) live.set(k, [el.scrollTop, el.scrollLeft]);
    });
    scrollMemo.forEach((v, k) => { if (!live.has(k) && (v[0] || v[1])) live.set(k, v); });
    const sc = activeScroller();
    const ratio = sc ? scrollerPos(sc) / Math.max(1, scrollerMax(sc)) : 0;
    const focusEl = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    return {
      scrolls: [...live.entries()],
      ratio,
      focus: focusEl ? { id: focusEl.id || null, path: uiPath(focusEl), sel: [focusEl.selectionStart, focusEl.selectionEnd] } : null,
    };
  }

  function restoreUI(snap) {
    if (!snap) return;
    const find = (id, path) => (id ? document.getElementById(id) : null) || (path ? document.querySelector(path) : null);
    snap.scrolls.forEach(([k, top, left]) => {
      if (k === "@root") return; // gulir tingkat halaman dipulihkan lewat rasio di bawah
      const el = find(k[0] === "#" ? k.slice(1) : null, k);
      if (!el) return;
      if (top) el.scrollTop = top;
      if (left) el.scrollLeft = left;
    });
    if (snap.ratio > 0) {
      const sc = activeScroller();
      if (sc && scrollerPos(sc) === 0) scrollerSeek(sc, Math.round(snap.ratio * scrollerMax(sc)));
    }
    if (snap.focus) {
      const el = find(snap.focus.id, snap.focus.path);
      if (el && el.focus) {
        try {
          el.focus({ preventScroll: true });
          if (snap.focus.sel && snap.focus.sel[0] != null && el.setSelectionRange) el.setSelectionRange(snap.focus.sel[0], snap.focus.sel[1]);
        } catch (err) { /* elemen tidak mendukung fokus terprogram */ }
      }
    }
  }

  function render() {
    const host = $("v-" + state.view);
    if (!host) return;
    const snap = snapUI();
    if (state.view === "operasi") { host.innerHTML = viewOperasi(); drawOperasi(); }
    else if (state.view === "aset") { host.innerHTML = viewAset(); drawAset(); }
    else if (state.view === "aksi") { host.innerHTML = viewAksi(); drawAksi(); }
    else if (state.view === "keandalan") { host.innerHTML = viewKeandalan(); drawKeandalan(); }
    else { host.innerHTML = viewModel(); drawModel(); }
    bindFilters();
    enhance();
    watchCharts();
    restoreUI(snap);
    // pemulihan diulang beberapa kali karena tinggi tata letak baru bisa belum
    // final saat render() baru selesai (grafik digambar setelahnya)
    requestAnimationFrame(() => restoreUI(snap));
    setTimeout(() => restoreUI(snap), 80);
    setTimeout(() => restoreUI(snap), 260);
  }

  // P-14: gambar ulang grafik saja, tanpa mengganti HTML, supaya posisi gulir,
  // nilai dropdown, dan fokus tidak hilang saat ukuran jendela berubah.
  function drawCurrent() {
    if (state.view === "operasi") drawOperasi();
    else if (state.view === "aset") drawAset();
    else if (state.view === "aksi") drawAksi();
    else if (state.view === "keandalan") drawKeandalan();
    else drawModel();
  }

  // P-14: kanvas digambar seukuran wadah. Kalau lebar wadah berubah tanpa
  // perubahan ukuran jendela (misalnya daftar diperluas), gambar harus diulang.
  function watchCharts() {
    const host = $("v-" + state.view);
    if (!host || typeof ResizeObserver !== "function") return;
    if (watchCharts.ro) watchCharts.ro.disconnect();
    let last = host.clientWidth;
    let timer = null;
    const redraw = drawCurrent;
    const ro = new ResizeObserver(() => {
      if (Math.abs(host.clientWidth - last) < 8) return;
      last = host.clientWidth;
      clearTimeout(timer);
      timer = setTimeout(redraw, 160);
    });
    ro.observe(host);
    watchCharts.ro = ro;
  }

  // tabindex untuk bodi bergulir, label nav, dan sortir tabel
  function enhance() {
    const host = $("v-" + state.view);
    if (!host) return;
    host.querySelectorAll(".card-body.scroll, .card-body").forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 2 && !el.hasAttribute("tabindex")) {
        el.setAttribute("tabindex", "0");
        const t = el.closest(".card")?.querySelector("h3")?.innerText.trim();
        if (t) el.setAttribute("aria-label", t.split("\n")[0]);
      }
    });
    host.querySelectorAll("table").forEach((tb) => {
      const head = tb.querySelector("thead tr");
      if (!head) return;
      [...head.children].forEach((th, i) => {
        if (th.hasAttribute("data-sort")) return;
        th.setAttribute("data-sort", String(i));
        th.setAttribute("tabindex", "0");
        th.setAttribute("role", "button");
        const go = () => sortTable(tb, i, th);
        th.addEventListener("click", go);
        th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
      });
    });
    document.querySelectorAll(".nav-item").forEach((b) => {
      const num = b.querySelector(".badge, .nav-count, small");
      const name = b.innerText.split("\n")[0].trim();
      if (num && !b.getAttribute("aria-label")) b.setAttribute("aria-label", `${name}, ${num.innerText.trim()} item`);
    });
    const list = $("asset-list");
    if (list && !list.hasAttribute("aria-live")) { list.setAttribute("aria-live", "polite"); }
    collapseLong(host);
  }

  // tabel dan daftar panjang: tampilkan 12 baris dulu, sisanya lewat tombol
  function collapseLong(host) {
    const LIMIT = 12;
    const addBtn = (after, hidden, label) => {
      if (!hidden || after.dataset.moreDone) return;
      after.dataset.moreDone = "1";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn more-btn";
      b.textContent = `Tampilkan semua (${label} baris)`;
      b.addEventListener("click", () => {
        after.querySelectorAll("[data-folded]").forEach((el) => { el.style.display = ""; el.removeAttribute("data-folded"); });
        b.remove();
      });
      after.insertAdjacentElement("afterend", b);
    };
    host.querySelectorAll("table").forEach((tb) => {
      const body = tb.tBodies[0];
      if (!body || body.rows.length <= LIMIT + 3) return;
      let n = 0;
      [...body.rows].forEach((r) => { if (++n > LIMIT) { r.style.display = "none"; r.dataset.folded = "1"; } });
      addBtn(tb, body.rows.length - LIMIT, body.rows.length);
    });
    host.querySelectorAll(".stack, .q-strip, .wells, #asset-list").forEach((box) => {
      const kids = [...box.children];
      if (kids.length <= LIMIT + 3) return;
      kids.slice(LIMIT).forEach((k) => { k.style.display = "none"; k.dataset.folded = "1"; });
      addBtn(box, kids.length - LIMIT, kids.length);
    });
  }

  function sortTable(tb, col, th) {
    const body = tb.tBodies[0];
    if (!body) return;
    const asc = th.getAttribute("aria-sort") !== "ascending";
    const num = (s) => {
      const v = parseFloat(String(s).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
      return Number.isFinite(v) ? v : null;
    };
    const rows = [...body.rows];
    rows.sort((a, b) => {
      const x = a.cells[col]?.innerText.trim() ?? "";
      const y = b.cells[col]?.innerText.trim() ?? "";
      const nx = num(x), ny = num(y);
      if (nx !== null && ny !== null && /\d/.test(x) && /\d/.test(y)) return asc ? nx - ny : ny - nx;
      return asc ? x.localeCompare(y, "id") : y.localeCompare(x, "id");
    });
    rows.forEach((r) => body.appendChild(r));
    tb.querySelectorAll("th[aria-sort]").forEach((o) => o.removeAttribute("aria-sort"));
    th.setAttribute("aria-sort", asc ? "ascending" : "descending");
  }

  function boot() {
    if (!window.PLANT) {
      $("v-operasi").innerHTML = `<div class="card card-r1s5">
        <h3>Payload belum termuat</h3>${errorState("plant.js")}</div>`;
      return;
    }
    shellFacts();
    document.querySelectorAll(".nav-item").forEach((b) =>
      b.addEventListener("click", () => setView(b.dataset.view, true)));
    $("bell").addEventListener("click", () => setView("aksi", true));
    const q = $("q-search");
    if (q) q.addEventListener("input", () => {
      state.q = q.value.trim().toLowerCase();
      if (state.view !== "aset" && state.view !== "aksi") setView("aset", true);
      else render();
    });
    window.addEventListener("hashchange", () => setView(location.hash.replace("#", ""), false));
    // huruf web bisa datang setelah render pertama dan mengubah tinggi baris,
    // jadi grafik digambar ulang begitu font siap
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => render());
    // grafik digambar memakai lebar wadah, jadi harus digambar ulang saat ukuran berubah
    let rt = null;
    let lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (Math.abs(window.innerWidth - lastW) < 24) return;
      lastW = window.innerWidth;
      clearTimeout(rt);
      rt = setTimeout(drawCurrent, 220);
    });
    bindScrollWatch();
    setView(location.hash.replace("#", "") || "operasi", false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
