/* charts.js - primitif grafik SVG tanpa pustaka eksternal.
   Semua angka datang dari payload. Tidak ada nilai literal metrik di sini. */

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent = null) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    n.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(n);
  return n;
}

function txt(node, x, y, s, cls) {
  const t = el('text', { x, y, class: cls || 'tick' }, node);
  t.textContent = s;
  return t;
}

function extent(arr, pad = 0.05) {
  if (!arr.length) return [0, 1];
  let lo = Math.min(...arr), hi = Math.max(...arr);
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

function makeSvg(host, w, h) {
  host.innerHTML = '';
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img' }, host);
  return svg;
}

/* ----------------------------------------------------------------
   Line chart dengan garis ambang dan pita alert
   ---------------------------------------------------------------- */

function lineChart(host, cfg) {
  const pts = cfg.points;
  if (!pts || pts.length < 2) { host.textContent = cfg.empty || 'Tidak ada titik.'; return; }
  const W = 900, H = 300;
  const M = { t: 18, r: 22, b: 34, l: 48 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const svg = makeSvg(host, W, H);

  // sumbu X mengikuti waktu, bukan indeks: titik di sini tidak berjarak seragam
  const ts = pts.map(p => Date.parse(p.t));
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const tSpan = Math.max(1, tMax - tMin);

  const scoreMax = Math.max(...pts.map(p => p.v));
  const thr = (cfg.threshold === null || cfg.threshold === undefined) ? 0 : cfg.threshold;
  const y1 = Math.max(scoreMax, thr, 0.02) * 1.18;
  const xs = ts;

  const X = t => M.l + ((t - tMin) / tSpan) * iw;
  const Y = v => M.t + ih - ((v - 0) / (y1 - 0)) * ih;

  const ticks = 4;
  for (let k = 0; k <= ticks; k++) {
    const v = y1 * (k / ticks);
    const y = Y(v);
    el('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: 'grid-l' }, svg);
    txt(svg, M.l - 7, y + 3, v.toFixed(3), 'tick tick-y');
  }

  // pita prediksi positif sebagai lajur tipis di dasar plot, bukan blok penuh,
  // supaya garis ambang tetap terbaca di atasnya
  let runStart = null;
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].pred === 1;
    if (on && runStart === null) runStart = i;
    if ((!on || i === pts.length - 1) && runStart !== null) {
      const end = on ? i : i - 1;
      const x0 = X(xs[runStart]), x1 = X(xs[end]);
      const w = Math.max(1.5, x1 - x0);
      el('rect', {
        x: x0, y: M.t, width: w, height: ih,
        fill: 'rgba(224,122,47,0.06)',
        'data-tip': `Pita alert: ${end - runStart + 1} titik berurutan di atas ambang`,
      }, svg);
      el('rect', {
        x: x0, y: M.t + ih - 6, width: w, height: 6, rx: 1,
        fill: 'var(--accent)', 'fill-opacity': 0.9,
      }, svg);
      runStart = null;
    }
  }

  // mode sampel: titik, bukan garis, karena garis antar titik sampel mengarang transisi
  const sampled = cfg.sampled === true;
  if (sampled) {
    pts.forEach((p, i) => {
      el('circle', {
        cx: X(xs[i]), cy: Y(p.v), r: 1.3,
        fill: p.y === 1 ? 'var(--accent)' : 'var(--series-2)', 'fill-opacity': 0.85,
        'data-tip': `${p.t.replace('T', ' ')} | skor ${p.v.toFixed(3)} | aktual ${p.y === 1 ? 'event' : 'normal'}`,
      }, svg);
    });
  } else {
    let dArea = `M ${X(xs[0])} ${Y(pts[0].v)}`;
    pts.forEach((p, i) => { dArea += ` L ${X(xs[i])} ${Y(p.v)}`; });
    dArea += ` L ${X(xs[xs.length - 1])} ${M.t + ih} L ${X(xs[0])} ${M.t + ih} Z`;
    el('path', { d: dArea, fill: 'rgba(79,143,214,0.14)', stroke: 'none' }, svg);

    let d = `M ${X(xs[0])} ${Y(pts[0].v)}`;
    pts.forEach((p, i) => { d += ` L ${X(xs[i])} ${Y(p.v)}`; });
    el('path', { d, fill: 'none', stroke: 'var(--series-2)', 'stroke-width': 1.4 }, svg);
  }

  if (cfg.threshold !== null && cfg.threshold !== undefined) {
    const yt = Y(cfg.threshold);
    el('line', {
      x1: M.l, x2: W - M.r, y1: yt, y2: yt,
      stroke: 'var(--warn)', 'stroke-width': 1.8, 'stroke-dasharray': '7 4',
      'data-tip': `Ambang alarm ${cfg.threshold.toFixed(4)}, dituning pada fold validasi`,
    }, svg);
    txt(svg, M.l + 4, Math.max(M.t + 10, yt - 5), 'ambang', 'lbl-strong');
  }

  pts.forEach((p, i) => {
    if (p.pred !== 1) return;
    el('circle', {
      cx: X(xs[i]), cy: Y(p.v), r: 2.2, fill: 'var(--accent)',
      'data-tip': `${p.t.replace('T', ' ')} | skor ${p.v.toFixed(3)} | aktual ${p.y === 1 ? 'event' : 'normal'}`,
    }, svg);
  });

  // sumbu X: posisi waktu merata, label unik
  el('line', { x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih, class: 'ax' }, svg);
  const nx = 5;
  const withTime = tSpan < 3 * 86400000;
  for (let k = 0; k <= nx; k++) {
    const t = tMin + (tSpan * k) / nx;
    const dt = new Date(t);
    const label = withTime
      ? `${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')} ${String(dt.getUTCHours()).padStart(2, '0')}:00`
      : `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    const tx = txt(svg, X(t), H - 12, label, 'tick');
    tx.setAttribute('text-anchor', k === 0 ? 'start' : (k === nx ? 'end' : 'middle'));
  }
}

/* ----------------------------------------------------------------
   Timeline chart: band aktual vs prediksi per sumur
   ---------------------------------------------------------------- */

function timelineChart(host, cfg) {
  const rows = cfg.rows;
  if (!rows.length) { host.textContent = 'Tidak ada data.'; return; }
  const W = 900;
  const rowH = 34;
  const M = { t: 22, r: 18, b: 26, l: 88 };
  const H = M.t + rows.length * rowH + M.b;
  const iw = W - M.l - M.r;
  const svg = makeSvg(host, W, H);

  const t0 = Math.min(...rows.map(r => r.t0));
  const t1 = Math.max(...rows.map(r => r.t1));
  const span = Math.max(1, t1 - t0);
  const X = t => M.l + ((t - t0) / span) * iw;

  // tick tahun
  const years = [];
  const d0 = new Date(t0), d1 = new Date(t1);
  for (let y = d0.getUTCFullYear(); y <= d1.getUTCFullYear(); y++) years.push(y);
  years.forEach(y => {
    const t = Date.UTC(y, 0, 1);
    if (t < t0 || t > t1) return;
    const x = X(t);
    el('line', { x1: x, x2: x, y1: M.t - 6, y2: M.t + rows.length * rowH + 2, class: 'grid-l' }, svg);
    txt(svg, x, H - 10, String(y), 'tick').setAttribute('text-anchor', 'middle');
  });

  rows.forEach((r, i) => {
    const yTop = M.t + i * rowH;
    const bh = 9;
    // nama sumur
    const yb = yTop + bh + 3;
    txt(svg, M.l - 10, yTop + 8, r.label, 'lbl-strong').setAttribute('text-anchor', 'end');
    txt(svg, M.l - 10, yTop + 21, `${r.n_events} event`, 'tick').setAttribute('text-anchor', 'end');

    // band aktual
    el('rect', { x: M.l, y: yTop, width: iw, height: bh, rx: 2, fill: 'var(--surface-2)' }, svg);
    r.actual.forEach(a => {
      el('rect', {
        x: X(a[0]), y: yTop, width: Math.max(1.5, X(a[1]) - X(a[0])), height: bh, rx: 2,
        fill: 'var(--series-3)',
        'data-tip': `${r.label} aktual: ${a[2]} titik berlabel event`,
      }, svg);
    });

    // band prediksi
    el('rect', { x: M.l, y: yb, width: iw, height: bh, rx: 2, fill: 'var(--surface-2)' }, svg);
    r.predicted.forEach(p => {
      el('rect', {
        x: X(p[0]), y: yb, width: Math.max(1.5, X(p[1]) - X(p[0])), height: bh, rx: 2,
        fill: 'var(--accent)',
        'data-tip': `${r.label} alert: ${p[3]} titik, skor puncak ${p[2].toFixed(3)}`,
      }, svg);
    });
  });

  txt(svg, M.l, M.t - 10, 'baris atas: kejadian aktual, baris bawah: alarm model', 'lbl');
}

/* ----------------------------------------------------------------
   Histogram + area densitas skor
   ---------------------------------------------------------------- */

function scoreArea(host, cfg) {
  const { edges, negative, positive, threshold } = cfg;
  if (!edges || edges.length < 2) { host.textContent = 'Tidak ada data.'; return; }
  const W = 520, H = 280;
  const M = { t: 18, r: 16, b: 40, l: 46 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const svg = makeSvg(host, W, H);
  const nb = edges.length - 1;

  const totN = cfg.total_negative || negative.reduce((a, b) => a + b, 0);
  const totP = cfg.total_positive || positive.reduce((a, b) => a + b, 0);
  const dNeg = negative.map(v => (totN ? v / totN : 0));
  const dPos = positive.map(v => (totP ? v / totP : 0));
  const ymax = Math.max(...dNeg, ...dPos) * 1.15 || 1;

  const X = i => M.l + (i / nb) * iw;
  const Y = v => M.t + ih - (v / ymax) * ih;

  for (let k = 0; k <= 4; k++) {
    const v = (ymax) * (k / 4);
    const y = Y(v);
    el('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: 'grid-l' }, svg);
    txt(svg, M.l - 7, y + 3, (v * 100).toFixed(0) + '%', 'tick tick-y');
  }

  const path = (arr, color, fill) => {
    let d = `M ${X(0)} ${Y(arr[0])}`;
    for (let i = 1; i < nb; i++) d += ` L ${X(i)} ${Y(arr[i])}`;
    d += ` L ${X(nb)} ${Y(arr[nb - 1])}`;
    const dl = `${d} L ${X(nb)} ${M.t + ih} L ${X(0)} ${M.t + ih} Z`;
    el('path', { d: dl, fill, stroke: 'none' }, svg);
    el('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.5 }, svg);
    arr.forEach((v, i) => {
      el('circle', {
        cx: X(i) + (iw / nb) / 2, cy: Y(v), r: 2.2, fill: color,
        'data-tip': `skor ${edges[i].toFixed(2)} sampai ${edges[i + 1].toFixed(2)}: ${(v * 100).toFixed(1)}% dari kelasnya`,
      }, svg);
    });
  };

  path(dNeg, 'var(--series-2)', 'rgba(79,143,214,0.10)');
  path(dPos, 'var(--accent)', 'rgba(224,122,47,0.13)');

  if (threshold !== null && threshold !== undefined) {
    const i = Math.min(nb - 1, Math.max(0, Math.floor((threshold - edges[0]) / (edges[1] - edges[0]))));
    const x = X(i) + (iw / nb) / 2;
    el('line', {
      x1: x, x2: x, y1: M.t, y2: M.t + ih, stroke: 'var(--ok)',
      'stroke-width': 1.2, 'stroke-dasharray': '5 4',
      'data-tip': `Ambang alarm ${threshold.toFixed(4)}`,
    }, svg);
    txt(svg, x + 4, M.t + ih - 8, 'ambang', 'lbl');
  }

  el('line', { x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih, class: 'ax' }, svg);
  for (let k = 0; k <= 5; k++) {
    const i = Math.round((k / 5) * (nb - 1));
    txt(svg, X(i), H - 12, edges[i].toFixed(2), 'tick');
  }
  txt(svg, M.l, H - 1, 'skor model', 'lbl');
}

/* ----------------------------------------------------------------
   SHAP: area bertumpuk per sumur, urut mean |SHAP|
   ---------------------------------------------------------------- */

function shapArea(host, cfg) {
  const { features, labels, per_well, wells } = cfg;
  if (!features || !features.length) { host.textContent = 'SHAP tidak tersedia untuk run ini.'; return; }
  const W = 900, H = 390;
  const M = { t: 16, r: 16, b: 104, l: 64 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const svg = makeSvg(host, W, H);
  const n = features.length;

  const totals = labels.map((_, i) => wells.reduce((a, w) => a + (per_well[w] ? per_well[w][i] : 0), 0));
  const ymax = Math.max(...totals) * 1.1 || 1;

  const X = i => M.l + (i / Math.max(1, n - 1)) * iw;
  const Y = v => M.t + ih - (v / ymax) * ih;

  const stack = new Array(n).fill(0);
  const colors = ['var(--accent)', 'var(--series-2)', 'var(--series-3)', '#7fa8c9', '#c98f3f', '#5f7f5f', '#a05f7f'];

  wells.forEach((w, wi) => {
    const vals = features.map((_, i) => (per_well[w] ? per_well[w][i] : 0));
    const base = stack.slice();
    let d = `M ${X(0)} ${Y(base[0] + vals[0])}`;
    for (let i = 1; i < n; i++) d += ` L ${X(i)} ${Y(base[i] + vals[i])}`;
    for (let i = n - 1; i >= 0; i--) d += ` L ${X(i)} ${Y(base[i])}`;
    d += ' Z';
    el('path', {
      d, fill: colors[wi % colors.length], 'fill-opacity': 0.82, stroke: 'none',
      'data-tip': `${w}: kontribusi rata-rata fitur di sumur ini`,
    }, svg);
    for (let i = 0; i < n; i++) stack[i] += vals[i];
  });

  // garis total
  let dt = `M ${X(0)} ${Y(stack[0])}`;
  for (let i = 1; i < n; i++) dt += ` L ${X(i)} ${Y(stack[i])}`;
  el('path', { d: dt, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.2, opacity: 0.55 }, svg);

  for (let k = 0; k <= 4; k++) {
    const v = ymax * (k / 4);
    const y = Y(v);
    el('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: 'grid-l' }, svg);
    txt(svg, M.l - 7, y + 3, v.toFixed(3), 'tick tick-y');
  }

  // label fitur, diputar agar muat
  labels.forEach((s, i) => {
    const t = txt(svg, X(i), M.t + ih + 12, s.length > 14 ? s.slice(0, 13) + '.' : s, 'tick');
    t.setAttribute('transform', `rotate(-30 ${X(i)} ${M.t + ih + 12})`);
    t.setAttribute('text-anchor', 'end');
    t.setAttribute('data-tip', `${labels[i]}: total kontribusi ${totals[i].toFixed(4)}`);
  });

  el('line', { x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih, class: 'ax' }, svg);
}

/* ----------------------------------------------------------------
   Kurva precision-recall
   ---------------------------------------------------------------- */

function prChart(host, cfg) {
  const { precision, recall, baseline } = cfg;
  if (!precision || precision.length < 2) { host.textContent = 'Tidak ada data.'; return; }
  const W = 460, H = 260;
  const M = { t: 16, r: 18, b: 36, l: 44 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const svg = makeSvg(host, W, H);

  const X = r => M.l + r * iw;
  const Y = p => M.t + ih - p * ih;

  for (let k = 0; k <= 4; k++) {
    const y = M.t + ih - (k / 4) * ih;
    el('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: 'grid-l' }, svg);
    txt(svg, M.l - 7, y + 3, (k / 4).toFixed(2), 'tick tick-y');
  }

  // garis dasar = prevalensi
  if (baseline) {
    el('line', {
      x1: M.l, x2: W - M.r, y1: Y(baseline), y2: Y(baseline),
      stroke: 'var(--ink-faint)', 'stroke-dasharray': '4 4',
      'data-tip': `Garis dasar acak: presisi ${(baseline * 100).toFixed(1)}% setara prevalensi kelas`,
    }, svg);
  }

  let d = `M ${X(recall[0])} ${Y(precision[0])}`;
  for (let i = 1; i < precision.length; i++) d += ` L ${X(recall[i])} ${Y(precision[i])}`;
  let da = d + ` L ${X(recall[recall.length - 1])} ${M.t + ih} L ${X(recall[0])} ${M.t + ih} Z`;
  el('path', { d: da, fill: 'rgba(224,122,47,0.10)', stroke: 'none' }, svg);
  el('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.6 }, svg);

  el('line', { x1: M.l, x2: W - M.r, y1: M.t + ih, y2: M.t + ih, class: 'ax' }, svg);
  for (let k = 0; k <= 4; k++) {
    txt(svg, M.l + (k / 4) * iw, H - 12, (k / 4).toFixed(2), 'tick');
  }
  txt(svg, M.l + iw / 2 - 24, H - 1, 'recall', 'lbl');
  txt(svg, 6, M.t + 10, 'presisi', 'lbl');
}

window.Charts = { lineChart, timelineChart, scoreArea, shapArea, prChart, el };
