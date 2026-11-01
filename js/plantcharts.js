// plantcharts.js: grafik SVG tanpa pustaka luar.
// Setiap fungsi menerima elemen host dan konfigurasi, lalu menggambar ulang isinya.
// Angka datang dari payload Python; berkas ini hanya menggambar, tidak menghitung metrik.

const NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, parent = null) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  if (parent) parent.appendChild(n);
  return n;
}

function clear(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

function frame(host, w, h, pad) {
  clear(host);
  // lebar kanvas mengikuti lebar wadah. Kalau dipatok 640 lalu diskalakan,
  // huruf sumbu ikut mengecil dan tidak terbaca di kartu sempit.
  // matikan gulir dulu supaya bilah gulir tidak muncul setelah grafik jadi dan mengecilkan kanvas
  host.style.overflow = "hidden";
  const cw = Math.max(120, Math.round(host.clientWidth || w));
  const s = svgEl("svg", {
    viewBox: `0 0 ${cw} ${h}`, width: "100%", height: h,
    preserveAspectRatio: "none", role: "img",
  }, host);
  const g = svgEl("g", { transform: `translate(${pad.l},${pad.t})` }, s);
  return { s, g, w: cw - pad.l - pad.r, h: h - pad.t - pad.b };
}

let measSvg = null;
let measText = null;
function textWidth(str, cls) {
  if (!measSvg) {
    measSvg = document.createElementNS(NS, "svg");
    measSvg.setAttribute("width", "0");
    measSvg.setAttribute("height", "0");
    measSvg.style.cssText = "position:absolute;left:-9999px;top:0;overflow:hidden";
    document.body.appendChild(measSvg);
    measText = svgEl("text", { x: 0, y: 0, class: "axis" }, measSvg);
  }
  measText.setAttribute("class", cls || "axis");
  measText.textContent = str;
  return measText.getComputedTextLength();
}

// lebar label sumbu Y menentukan jarak kiri grafik
function yPad(ticks, fmt) {
  let max = 0;
  ticks.forEach((v) => { max = Math.max(max, textWidth(String(fmt ? fmt(v) : v))); });
  return Math.max(34, Math.min(120, Math.ceil(max) + 12));
}

function niceTicks(lo, hi, n = 4) {
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1];
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(step) || 1)));
  const norm = step / mag;
  const mult = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  const s = mult * mag;
  const start = Math.floor(lo / s) * s;
  const end = Math.ceil(hi / s) * s;
  const out = [];
  for (let v = start; v <= end + s * 0.001; v += s) out.push(Number(v.toFixed(10)));
  return out;
}

function fitText(t, maxPx) {
  const full = t.textContent;
  if (!full || t.getComputedTextLength() <= maxPx) return;
  let lo = 1, hi = full.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    t.textContent = full.slice(0, mid) + "\u2026";
    if (t.getComputedTextLength() <= maxPx) lo = mid; else hi = mid - 1;
  }
  t.textContent = full.slice(0, lo) + "\u2026";
}

function widestLabel(g, labels) {
  const probe = svgEl("text", { x: -9999, y: -9999, class: "axis" }, g);
  let max = 0;
  labels.forEach((l) => { probe.textContent = l; max = Math.max(max, probe.getComputedTextLength()); });
  probe.remove();
  return max;
}

function xText(g, x, y, lab, w, slot) {
  const anchor = x < 14 ? "start" : x > w - 14 ? "end" : "middle";
  const t = svgEl("text", { x, y, class: "axis xlab", "text-anchor": anchor }, g);
  t.textContent = lab;
  const edgeRoom = anchor === "start" ? w - x : anchor === "end" ? x : Math.min(x, w - x) * 2;
  fitText(t, Math.max(24, slot ? Math.min(edgeRoom, slot) : edgeRoom));
  return t;
}

// buang label sumbu X yang masih beririsan dengan label sebelumnya
function dedupeX(g) {
  const labs = [...g.querySelectorAll("text.xlab")].sort((a, b) => (+a.getAttribute("x")) - (+b.getAttribute("x")));
  let right = null;
  labs.forEach((t) => {
    const b = t.getBBox();
    if (right !== null && b.x < right - 0.5) { t.remove(); return; }
    right = b.x + b.width;
  });
}

function axis(g, box, yTicks, fmtY, xLabels, xPos) {
  const pitch = yTicks.length > 1 ? box.h / (yTicks.length - 1) : box.h;
  const skip = Math.max(1, Math.ceil(16 / Math.max(1, pitch)));
  yTicks.forEach((v, i) => {
    const y = box.h - ((v - yTicks[0]) / ((yTicks[yTicks.length - 1] - yTicks[0]) || 1)) * box.h;
    const last = i === yTicks.length - 1;
    if (i % skip && !last) return;
    svgEl("line", { x1: 0, x2: box.w, y1: y, y2: y, class: "grid" }, g);
    const t = svgEl("text", { x: -8, y: y + 4, class: "axis", "text-anchor": "end" }, g);
    t.textContent = fmtY ? fmtY(v) : v;
  });
  if (xLabels && xPos) {
    xLabels.forEach((lab, i) => xText(g, xPos[i], box.h + 18, lab, box.w));
  }
}

// Seri waktu garis. cfg: { series:[{label,color,values,dash,fill}], labels, yFmt, height, area }
function lineChart(host, cfg) {
  const H = cfg.height || 220;
  const all = cfg.series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
  if (!all.length) return;
  const lo = cfg.min !== undefined ? cfg.min : Math.min(...all);
  const hi = cfg.max !== undefined ? cfg.max : Math.max(...all);
  const ticks = niceTicks(lo, hi, 4);
  const pad = { l: yPad(ticks, cfg.yFmt), r: 12, t: 12, b: 26 };
  const { g, w, h } = frame(host, 640, H, pad);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const n = cfg.labels.length;
  const X = (i) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const Y = (v) => h - ((v - y0) / ((y1 - y0) || 1)) * h;
  axis(g, { w, h }, ticks, cfg.yFmt);
  // jumlah label mengikuti lebar teks sebenarnya, bukan angka tetap
  const spacing = n > 1 ? w / (n - 1) : w;
  const labW = widestLabel(g, cfg.labels);
  const every = Math.max(1, Math.ceil((labW + 18) / Math.max(1, spacing)));
  const slot = spacing * every - 10;
  cfg.labels.forEach((lab, i) => {
    if (i % every) return;
    xText(g, X(i), h + 18, lab, w, slot);
  });
  dedupeX(g);
  cfg.series.forEach((s) => {
    // segmen dipisah pada nilai null supaya celah data tidak digambar sebagai garis lurus
    const segs = [];
    let cur = [];
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { if (cur.length) segs.push(cur); cur = []; return; }
      cur.push([X(i), Y(v)]);
    });
    if (cur.length) segs.push(cur);
    segs.forEach((pts) => {
      if (pts.length === 1) {
        svgEl("circle", { cx: pts[0][0], cy: pts[0][1], r: 2.2, fill: s.color }, g);
        return;
      }
      if (s.fill) {
        const d = `M${pts[0][0]},${h} ` + pts.map((p) => `L${p[0]},${p[1]}`).join(" ") + ` L${pts[pts.length - 1][0]},${h} Z`;
        svgEl("path", { d, fill: s.color, opacity: 0.12 }, g);
      }
      svgEl("path", {
        d: "M" + pts.map((p) => `${p[0]},${p[1]}`).join(" L"),
        fill: "none", stroke: s.color, "stroke-width": s.width || 2,
        "stroke-dasharray": s.dash || null, "stroke-linejoin": "round",
      }, g);
    });
  });
  if (cfg.points || cfg.series.some((s) => s.points)) {
    cfg.series.forEach((s) => {
      if (!cfg.points && !s.points) return;
      s.values.forEach((v, i) => {
        if (v === null || v === undefined) return;
        const c = svgEl("circle", { cx: X(i), cy: Y(v), r: 1.9, fill: s.color, opacity: 0.9 }, g);
        const head = [cfg.labels[i], s.label].filter(Boolean).join(" ");
        c.appendChild(document.createElementNS(NS, "title")).textContent =
          `${head}: ${cfg.yFmt ? cfg.yFmt(v) : v}`;
      });
    });
  }
  (cfg.markers || []).forEach((m) => {
    const x = X(m.i);
    svgEl("line", {
      x1: x, x2: x, y1: 0, y2: h,
      stroke: m.color || "var(--brand)", "stroke-width": 1, "stroke-dasharray": "2 3", opacity: 0.7,
    }, g);
  });
  (cfg.thresholds || []).forEach((th) => {
    const y = Y(th.value);
    svgEl("line", { x1: 0, x2: w, y1: y, y2: y, stroke: th.color, "stroke-dasharray": "6 4", "stroke-width": 1.4 }, g);
    const t = svgEl("text", { x: w - 2, y: y - 4, class: "axis", "text-anchor": "end" }, g);
    t.textContent = th.label;
    t.setAttribute("fill", th.color);
  });
}

// Batang berkelompok atau bertumpuk per bulan.
function barChart(host, cfg) {
  const H = cfg.height || 220;
  const labels = cfg.labels;
  const series = cfg.series;
  const stacked = !!cfg.stacked;
  const totals = labels.map((_, i) => stacked
    ? series.reduce((a, s) => a + (s.values[i] || 0), 0)
    : Math.max(...series.map((s) => s.values[i] || 0)));
  const hi = Math.max(...totals, 1) * 1.12;
  const ticks = niceTicks(0, hi, 4);
  const pad = { l: yPad(ticks, cfg.yFmt), r: 12, t: 12, b: 26 };
  const { g, w, h } = frame(host, 640, H, pad);
  const y1 = ticks[ticks.length - 1];
  const Y = (v) => h - (v / (y1 || 1)) * h;
  axis(g, { w, h }, ticks, cfg.yFmt);
  const slot = w / labels.length;
  const bw = stacked ? Math.max(2, slot * 0.62) : Math.max(1.5, (slot * 0.7) / series.length);
  const short = {};
  labels.forEach((l) => { const s = String(l); short[s] = s.length > 9 ? s.slice(0, 8) + "\u2026" : s; });
  const labW = widestLabel(g, Object.values(short));
  const step = Math.max(1, Math.ceil((labW + 18) / Math.max(1, slot)));
  labels.forEach((lab, labIndex) => {
    const cx = slot * labIndex + slot / 2;
    let base = 0;
    series.forEach((s, si) => {
      const v = s.values[labIndex] || 0;
      if (!v) return;
      const x = stacked ? cx - bw / 2 : cx - (series.length * bw) / 2 + si * bw;
      const yTop = stacked ? Y(base + v) : Y(v);
      const hh = stacked ? Y(base) - Y(base + v) : h - Y(v);
      svgEl("rect", {
        x, y: yTop, width: Math.max(1, bw - 1), height: Math.max(0.8, hh),
        fill: s.color, opacity: 0.9, rx: 1.5,
      }, g).appendChild(document.createElementNS(NS, "title")).textContent =
        `${[lab, s.label].filter(Boolean).join(" ")}: ${v}`;
      base += v;
    });
    if (labIndex % step === 0) {
      xText(g, cx, h + 18, short[labIndex], w, slot * step - 10);
    }
  });
  dedupeX(g);
}

function donut(host, cfg) {
  const size = cfg.size || 180;
  const s = svgEl("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img" }, host);
  clear(host);
  host.appendChild(s);
  const total = cfg.data.reduce((a, x) => a + x.value, 0) || 1;
  const r = size / 2 - 12, cx = size / 2, cy = size / 2, sw = cfg.thickness || 22;
  let ang = -Math.PI / 2;
  cfg.data.forEach((seg) => {
    const frac = seg.value / total;
    const end = ang + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x1, y1] = p(ang), [x2, y2] = p(end - 0.0001);
    const path = svgEl("path", {
      d: `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`,
      fill: "none", stroke: seg.color, "stroke-width": sw, "stroke-linecap": "butt",
    }, s);
    path.appendChild(document.createElementNS(NS, "title")).textContent = `${seg.label}: ${seg.value}`;
    ang = end;
  });
  const t1 = svgEl("text", { x: cx, y: cy + 2, "text-anchor": "middle", class: "donut-num" }, s);
  t1.textContent = cfg.centerValue !== undefined ? cfg.centerValue : total;
  const t2 = svgEl("text", { x: cx, y: cy + 20, "text-anchor": "middle", class: "donut-lab" }, s);
  t2.textContent = cfg.centerLabel || "";
}

// Kurva degradasi: riwayat padat lalu proyeksi putus-putus menuju ambang.
function curveChart(host, cfg) {
  const H = cfg.height || 200;
  const pad = { l: 40, r: 12, t: 12, b: 22 };
  const { g, w, h } = frame(host, 640, H, pad);
  const hist = cfg.history, pred = cfg.predicted;
  const n = hist.length + pred.length - 1;
  const Y = (v) => h - (Math.max(0, Math.min(100, v)) / 100) * h;
  const X = (i) => (i / (n - 1)) * w;
  [0, 25, 50, 75, 100].forEach((v) => {
    svgEl("line", { x1: 0, x2: w, y1: Y(v), y2: Y(v), class: "grid" }, g);
    const t = svgEl("text", { x: -6, y: Y(v) + 4, class: "axis", "text-anchor": "end" }, g);
    t.textContent = v;
  });
  const yT = Y(cfg.threshold || 35);
  svgEl("line", { x1: 0, x2: w, y1: yT, y2: yT, stroke: "var(--warn)", "stroke-dasharray": "6 4" }, g);
  const tl = svgEl("text", { x: w - 2, y: yT - 4, class: "axis", "text-anchor": "end" }, g);
  tl.textContent = `ambang ${cfg.threshold || 35}`;
  tl.setAttribute("fill", "var(--warn)");
  const hp = hist.map((v, i) => [X(i), Y(v)]);
  svgEl("path", { d: "M" + hp.map((p) => `${p[0]},${p[1]}`).join(" L"), fill: "none", stroke: "var(--accent)", "stroke-width": 2 }, g);
  const start = hist.length - 1;
  const pp = [[X(start), Y(hist[hist.length - 1])]].concat(pred.map((v, i) => [X(start + i + 1), Y(v)]));
  svgEl("path", {
    d: "M" + pp.map((p) => `${p[0]},${p[1]}`).join(" L"),
    fill: "none", stroke: "#4F9CF0", "stroke-width": 2, "stroke-dasharray": "5 4",
  }, g);
  hp.forEach((p, i) => {
    const c = svgEl("circle", { cx: p[0], cy: p[1], r: 1.8, fill: "var(--accent)" }, g);
    c.appendChild(document.createElementNS(NS, "title")).textContent = `riwayat ${i + 1}: ${hist[i]}`;
  });
  pp.slice(1).forEach((p, i) => {
    const c = svgEl("circle", { cx: p[0], cy: p[1], r: 1.8, fill: "#4F9CF0" }, g);
    c.appendChild(document.createElementNS(NS, "title")).textContent = `proyeksi ${i + 1}: ${pred[i]}`;
  });
  const nowX = X(start);
  svgEl("line", { x1: nowX, x2: nowX, y1: 0, y2: h, stroke: "var(--line-2)", "stroke-width": 1 }, g);
  const nl = svgEl("text", { x: nowX + 4, y: 10, class: "axis" }, g);
  nl.textContent = "sekarang";
  // label tidak boleh keluar bingkai: balik ke kiri garis bila ruang kanan kurang
  const tw = nl.getComputedTextLength ? nl.getComputedTextLength() : 46;
  if (nowX + 4 + tw > w) {
    nl.setAttribute("text-anchor", "end");
    nl.setAttribute("x", Math.max(0, nowX - 4));
  }
}

function heatmap(host, cfg) {
  const rows = cfg.rows;
  if (!rows.length) return;
  const cellH = 12, gap = 4, labelW = 126;
  const w = 640, h = rows.length * (cellH + gap) + 8;
  const { g } = frame(host, w, h, { l: 0, r: 0, t: 0, b: 0 });
  const cw = (w - labelW) / rows[0].cells.length;
  rows.forEach((r, ri) => {
    const name = r.label || r.asset || r.asset_id || "";
    const t = svgEl("text", { x: labelW - 6, y: ri * (cellH + gap) + cellH - 2, class: "axis heat-lab", "text-anchor": "end" }, g);
    t.textContent = name;
    fitText(t, labelW - 12);
    r.cells.forEach((v, ci) => {
      const color = v >= 66 ? "var(--bad)" : v >= 33 ? "var(--warn)" : "var(--ok)";
      const rect = svgEl("rect", {
        x: labelW + ci * cw, y: ri * (cellH + gap), width: Math.max(1, cw - 1.5), height: cellH,
        fill: color, opacity: 0.25 + Math.min(0.75, v / 100), rx: 1.5,
      }, g);
      rect.appendChild(document.createElementNS(NS, "title")).textContent =
        `${name} jam ke-${r.cells.length - ci}: ${v}`;
    });
  });
}

function sparkline(host, values, color = "var(--accent)", h = 34) {
  const { g, w } = frame(host, 240, h, { l: 0, r: 0, t: 3, b: 3 });
  const vals = values.filter((v) => v !== null && v !== undefined);
  if (!vals.length) return;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const Y = (v) => h - 3 - ((v - lo) / ((hi - lo) || 1)) * (h - 6);
  const X = (i) => (i / Math.max(1, values.length - 1)) * w;
  svgEl("path", {
    d: "M" + values.map((v, i) => `${X(i)},${Y(v)}`).join(" L"),
    fill: "none", stroke: color, "stroke-width": 1.6,
  }, g);
}

// Batang horizontal untuk peringkat fitur: label di kiri, nilai di ujung batang.
function hBar(host, cfg) {
  const rows = cfg.rows || [];
  if (!rows.length) return;
  const H = cfg.height || Math.max(90, rows.length * 20 + 12);
  const hostW = Math.max(120, Math.round(host.clientWidth || 640));
  const labelW = Math.max(80, Math.min(cfg.labelWidth || 132, Math.floor(hostW * 0.42)));
  const pad = { l: labelW, r: 52, t: 6, b: 6 };
  const { g, w, h } = frame(host, 640, H, pad);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  const rowH = h / rows.length;
  const barH = Math.max(4, rowH * 0.62);
  rows.forEach((r, i) => {
    const y = i * rowH + (rowH - barH) / 2;
    const len = Math.max(1.2, (Math.abs(r.value) / maxAbs) * w);
    const rect = svgEl("rect", {
      x: 0, y, width: len, height: barH, rx: 1.5,
      fill: r.color || "var(--brand)", opacity: 0.9,
    }, g);
    rect.appendChild(document.createElementNS(NS, "title")).textContent =
      `${r.label}: ${cfg.fmt ? cfg.fmt(r.value) : r.value}`;
    const lt = svgEl("text", { x: -6, y: y + barH / 2 + 3.5, class: "axis", "text-anchor": "end" }, g);
    lt.textContent = r.label;
    lt.appendChild(document.createElementNS(NS, "title")).textContent = r.label;
    fitText(lt, labelW - 10);
    const vt = svgEl("text", { x: len + 5, y: y + barH / 2 + 3.5, class: "axis" }, g);
    vt.textContent = cfg.fmt ? cfg.fmt(r.value) : r.value;
  });
}

window.PCharts = { lineChart, barChart, hBar, donut, curveChart, heatmap, sparkline, gauge, svgEl };


// Gauge ring: cincin parsial dengan angka di tengah, dipakai untuk tingkat keyakinan model.
// cfg: { value 0..100, label, size, thickness, color }
function gauge(host, cfg) {
  const size = cfg.size || 150;
  clear(host);
  const s = svgEl("svg", { viewBox: `0 0 ${size} ${size * 0.66}`, width: "100%",
    height: size * 0.66, preserveAspectRatio: "xMidYMid meet", role: "img" }, host);
  const cx = size / 2, cy = size * 0.55;
  const r = size / 2 - 16, th = cfg.thickness || 13;
  const start = Math.PI, sweep = Math.PI;
  const arc = (from, to, color, width) => {
    const x1 = cx + r * Math.cos(from), y1 = cy + r * Math.sin(from);
    const x2 = cx + r * Math.cos(to), y2 = cy + r * Math.sin(to);
    const path = svgEl("path", {
      d: `M${x1},${y1} A${r},${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x2},${y2}`,
      fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "butt",
    }, s);
    path.appendChild(document.createElementNS(NS, "title")).textContent = `${Math.round(cfg.value)}%`;
  };
  arc(start, start + sweep, "#6E7989", th);
  arc(start, start + sweep * Math.max(0, Math.min(1, cfg.value / 100)), cfg.color || "#E2142E", th);
  const t1 = svgEl("text", { x: cx, y: cy - 2, "text-anchor": "middle",
    fill: "#F1F4F5", "font-size": 28, "font-weight": 700 }, s);
  t1.textContent = `${Math.round(cfg.value)}%`;
  const t2 = svgEl("text", { x: cx, y: cy + 16, "text-anchor": "middle",
    fill: "#7C8797", "font-size": 11, "letter-spacing": "0.1em" }, s);
  t2.textContent = (cfg.label || "").toUpperCase();
  return s;
}
