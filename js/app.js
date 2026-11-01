/* app.js - lapisan render. Semua angka berasal dari payload.
   Script klasik (bukan modul) supaya halaman juga bisa dibuka lewat file://. */

(function () {
const { lineChart, timelineChart, scoreArea, shapArea, prChart } = window.Charts;

const $ = id => document.getElementById(id);
const fmtPct = v => (v === null || v === undefined) ? 'n/a' : (v * 100).toFixed(1) + '%';
const fmtNum = (v, d = 2) => (v === null || v === undefined) ? 'n/a' : Number(v).toFixed(d);
const int = v => Number(v).toLocaleString('id-ID');

const ENGINE_META = {
  row: { title: 'RF fitur baris', sub: 'row', color: 'var(--series-2)',
         desc: 'Random Forest pada 12 nilai sensor baris saat itu' },
  window: { title: 'RF fitur jendela', sub: 'window', color: 'var(--accent)',
            desc: 'Random Forest pada 12 kanal kali 5 statistik jendela 10 m' },
  persistence: { title: 'Persistence', sub: 'y(t-1)', color: 'var(--series-3)',
                 desc: 'Tebakan naif: keadaan berikutnya sama dengan keadaan sekarang' },
  rule: { title: 'Rule z-score', sub: 'torsi + hookload - laju tembus', color: '#7fa8c9',
          desc: 'Aturan ambang dari z-score tiga kanal, ambang q95 fold latihan' },
};

let DATA = null;
let FULL = null;
let PRIMARY = 'window';
let state = { well: null, tab: 'overview', wellSel: null, engineSel: null };

/* ------------------------------ popover ------------------------------ */

function showTip(target) {
  const t = target.getAttribute('data-tip');
  if (!t) return;
  const p = $('tip-pop');
  const s = t.length > 100 ? t.slice(0, 97) + '...' : t;
  p.textContent = s;
  p.classList.add('on');
  const r = target.getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  let x = r.left + r.width / 2 - pr.width / 2;
  let y = r.top - pr.height - 10;
  if (y < 8) y = r.bottom + 12;
  x = Math.max(8, Math.min(window.innerWidth - pr.width - 8, x));
  p.style.left = x + 'px';
  p.style.top = y + 'px';
}

function hideTip() { $('tip-pop').classList.remove('on'); }

function adoptTips(root) {
  root.querySelectorAll('[title]').forEach(n => {
    if (!n.hasAttribute('data-tip')) n.setAttribute('data-tip', n.getAttribute('title'));
    n.removeAttribute('title');
  });
}

document.addEventListener('pointerover', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (t) showTip(t);
});
document.addEventListener('pointerout', hideTip);
document.addEventListener('focusin', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (t) showTip(t);
});
document.addEventListener('focusout', hideTip);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
window.addEventListener('scroll', hideTip, { passive: true });

/* ------------------------------ pemuatan data ------------------------------ */

async function loadData() {
  const panel = $('err');
  panel.classList.remove('on');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('data/pm_full.json', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    FULL = await res.json();
    $('src-note').innerHTML = 'sumber angka: <b>data/pm_full.json</b> (dibaca lewat server lokal)';
    return true;
  } catch (err) {
    clearTimeout(timer);
    if (window.PM_FULL) {
      FULL = window.PM_FULL;
      $('src-note').innerHTML =
        'sumber angka: <b>data/pm_full.js</b> (cadangan untuk file://; fetch gagal: ' + err.message + ')';
      return true;
    }
    $('err-msg').textContent = String(err && err.message ? err.message : err);
    panel.classList.add('on');
    return false;
  }
}

/* ------------------------------ kartu ------------------------------ */

function renderHeader() {
  const m = DATA.meta;
  $('prov').innerHTML =
    `<b>dibuat</b> ${m.generated_at_utc}<br>` +
    `<b>sumber</b> ${m.source_csv}<br>` +
    `<b>baris</b> ${int(m.source_rows)} · <b>target</b> ${m.target}<br>` +
    `<b>mesin utama</b> ${m.primary_engine} · <b>runtime</b> ${m.runtime_s}s`;
  $('proto').textContent = m.protocol;
}

function renderKpis() {
  const p = DATA.pooled[PRIMARY];
  const m = DATA.meta;
  const kpis = [
    { label: 'Recall pada kelas event', value: fmtPct(p.recall),
      note: `${int(p.tp)} dari ${int(p.tp + p.fn)} titik event tertangkap di seluruh fold uji` },
    { label: 'Presisi alarm', value: fmtPct(p.precision),
      note: `${int(p.fp)} alarm palsu dari ${int(p.tp + p.fp)} total alarm` },
    { label: 'PR-AUC gabungan', value: fmtNum(p.pr_auc, 3),
      note: `garis dasar acak ${fmtNum(DATA.pr_curve.baseline, 3)}, setara prevalensi event` },
    { label: 'Cakupan data', value: int(m.source_rows), unit: 'baris',
      note: `${DATA.folds.length} sumur, ${m.feature_sets[PRIMARY].n} fitur, target ${m.target}` },
  ];
  const host = $('kpis');
  host.innerHTML = '';
  kpis.forEach(k => {
    const d = document.createElement('div');
    d.className = 'kpi';
    d.setAttribute('data-tip', k.note);
    d.innerHTML = `<div class="k-label"></div><div class="k-value"></div><div class="k-note"></div>`;
    d.querySelector('.k-label').textContent = k.label;
    const val = d.querySelector('.k-value');
    val.textContent = k.value;
    if (k.unit) {
      const s = document.createElement('small');
      s.textContent = k.unit;
      val.appendChild(s);
    }
    d.querySelector('.k-note').textContent = k.note;
    host.appendChild(d);
  });
}

function renderChips() {
  const host = $('well-chips');
  host.innerHTML = '';
  DATA.folds.forEach(f => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = f.label;
    b.setAttribute('aria-pressed', String(state.well === f.label));
    b.setAttribute('data-tip', `Seri skor sumur ${f.label}: ${int(f.n)} baris, ${int(f.n_pos)} titik event`);
    b.addEventListener('click', () => {
      state.well = f.label;
      renderChips();
      renderWellLine();
    });
    host.appendChild(b);
  });
}

function renderWellLine() {
  const w = state.well || DATA.folds[0].label;
  const s = DATA.series[w];
  const f = DATA.folds.find(x => x.label === w);
  if (!s) return;
  const e = f.engines[PRIMARY];
  const cond = s.n_plotted < 0.9 * s.n_total;
  $('line-note').textContent =
    `${w}: ${int(s.n_plotted)} dari ${int(s.n_total)} baris digambar, titik awal, puncak, dan akhir ` +
    `tiap kejadian selalu ikut. ${cond ? 'Karena disampel, skor digambar sebagai titik, bukan garis, ' +
    'supaya tidak seolah ada transisi yang tidak terukur. ' : ''}Ambang ${fmtNum(s.threshold, 4)} ` +
    `dituning pada fold validasi.`;
  lineChart($('line-host'), {
    points: s.points.map(p => ({ t: p[0], v: p[1], pred: p[2], y: p[3] })),
    threshold: s.threshold,
    sampled: cond,
  });
  $('line-foot').textContent =
    `fold ${w} · PR-AUC ${fmtNum(e.pr_auc, 3)} · ROC-AUC ${fmtNum(e.roc_auc, 3)} · ` +
    `P ${fmtPct(e.precision)} · R ${fmtPct(e.recall)} · ${f.ts_min.slice(0, 10)} sampai ${f.ts_max.slice(0, 10)}`;
}

function renderTimeline() {
  const rows = DATA.folds.map(f => {
    const seg = DATA.segments[f.label] || { predicted: [], actual: [] };
    return {
      label: f.label,
      t0: Date.parse(f.ts_min),
      t1: Date.parse(f.ts_max),
      actual: seg.actual.map(a => [Date.parse(a[0]), Date.parse(a[1]), a[2]]),
      predicted: seg.predicted.map(p => [Date.parse(p[0]), Date.parse(p[1]), p[3], p[2]]),
      n_events: seg.actual.length,
    };
  });
  timelineChart($('timeline-host'), { rows });
  const totA = rows.reduce((a, r) => a + r.actual.length, 0);
  const totP = rows.reduce((a, r) => a + r.predicted.length, 0);
  $('timeline-foot').textContent =
    `${int(totA)} segmen kejadian aktual dan ${int(totP)} segmen alarm model di ` +
    `${rows.length} sumur. Segmen alarm yang berdekatan digabung untuk keterbacaan.`;
}

function medianThreshold() {
  const t = DATA.folds.map(f => f.threshold).filter(v => typeof v === 'number').sort((a, b) => a - b);
  return t.length ? t[Math.floor(t.length / 2)] : null;
}

function renderHist() {
  const h = DATA.histogram;
  scoreArea($('hist-host'), {
    edges: h.edges, negative: h.negative, positive: h.positive,
    total_negative: h.total_negative, total_positive: h.total_positive,
    threshold: medianThreshold(),
  });
  $('hist-foot').textContent =
    `Kelas normal ${int(h.total_negative)} baris dan kelas event ${int(h.total_positive)} baris. ` +
    `Tiap kurva dinormalkan ke kelasnya sendiri, jadi tinggi menyatakan proporsi, bukan jumlah.`;
}

function renderShap() {
  const s = DATA.shap;
  if (!s.available) { $('shap-host').textContent = 'SHAP tidak tersedia pada run ini.'; return; }
  const wells = Object.keys(s.per_well);
  shapArea($('shap-host'), {
    features: s.features, labels: s.labels, per_well: s.per_well, wells,
  });
  $('shap-foot').textContent =
    `SHAP dari ${int(s.n_samples)} sampel uji pada mesin ${s.engine} (${s.features.length} fitur), ` +
    `nilai mutlak rata-rata per fitur. Tumpukan warna adalah sumbangan tiap sumur.`;

  const order = s.features.map((_, i) => i)
    .sort((a, b) => s.mean_abs[b] - s.mean_abs[a]).slice(0, 12);
  const max = Math.max(...s.mean_abs, 1e-9);
  const host = $('shap-bars');
  host.innerHTML = '';
  order.forEach(i => {
    const arah = s.signed_mean[i] >= 0 ? 'menaikkan' : 'menurunkan';
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.setAttribute('data-tip',
      `${s.labels[i]}: ${fmtNum(s.mean_abs[i], 4)} mutlak rata-rata, arah ${arah} skor`);
    row.innerHTML =
      `<div class="b-name"><b></b><span></span></div>` +
      `<div class="bar-track"><div class="bar-fill" style="background:var(--accent)"></div></div>` +
      `<div class="b-val"></div>`;
    row.querySelector('b').textContent = s.labels[i];
    row.querySelector('span').textContent = s.features[i];
    row.querySelector('.bar-fill').style.width = (s.mean_abs[i] / max * 100).toFixed(1) + '%';
    row.querySelector('.b-val').textContent = fmtNum(s.mean_abs[i], 4);
    host.appendChild(row);
  });
}

function renderEngines() {
  const keys = Object.keys(DATA.pooled);
  const host = $('engine-bars');
  host.innerHTML = '';

  const section = (title, key) => {
    const g = document.createElement('div');
    g.className = 'group-label';
    g.textContent = title;
    host.appendChild(g);
    keys.forEach(k => {
      const meta = ENGINE_META[k] || { title: k, sub: k, color: 'var(--ink-dim)' };
      const v = DATA.pooled[k][key];
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.setAttribute('data-tip',
        `${meta.title}: ${key === 'pr_auc' ? 'PR-AUC' : 'recall'} ` +
        `${v === null ? 'tidak terdefinisi' : fmtNum(v, 3)} pada seluruh titik uji`);
      row.innerHTML =
        `<div class="b-name"><b></b><span></span></div>` +
        `<div class="bar-track"><div class="bar-fill"></div></div>` +
        `<div class="b-val"></div>`;
      row.querySelector('b').textContent = meta.title;
      row.querySelector('span').textContent = meta.sub;
      const pct = v === null ? 0 : Math.max(0, Math.min(1, v)) * 100;
      const fill = row.querySelector('.bar-fill');
      fill.style.width = pct.toFixed(1) + '%';
      fill.style.background = meta.color;
      row.querySelector('.b-val').textContent = v === null ? 'n/a' : fmtNum(v, 3);
      host.appendChild(row);
    });
  };

  section('PR-AUC gabungan (0 sampai 1)', 'pr_auc');
  section('Recall pada kelas event', 'recall');

  const best = keys
    .map(k => ({ k, v: DATA.pooled[k].pr_auc === null ? -1 : DATA.pooled[k].pr_auc }))
    .sort((a, b) => b.v - a.v)[0];
  const ml = keys.filter(k => k === 'row' || k === 'window')
    .map(k => ({ k, v: DATA.pooled[k].pr_auc }))
    .sort((a, b) => b.v - a.v)[0];
  const base = DATA.pooled.persistence.pr_auc;
  const gap = (ml.v === null || base === null) ? null : (ml.v - base);
  const verdict = gap === null ? ''
    : (gap >= 0
      ? `Model terbaik (${(ENGINE_META[ml.k] || {}).title}) unggul ${fmtNum(gap, 3)} di atas persistence.`
      : `Model terbaik (${(ENGINE_META[ml.k] || {}).title}) masih ${fmtNum(Math.abs(gap), 3)} di bawah persistence, jadi baseline naif belum terlewati.`);
  $('engine-foot').textContent =
    `Pemenang PR-AUC gabungan: ${(ENGINE_META[best.k] || {}).title || best.k} ` +
    `(${fmtNum(DATA.pooled[best.k].pr_auc, 3)}). ${verdict} ` +
    `Keempat mesin diuji pada fold yang sama, ambang dilatih hanya dari fold validasi.`;
}

function renderPr() {
  prChart($('pr-host'), DATA.pr_curve);
  $('pr-foot').textContent =
    `Kurva presisi-recall seluruh titik uji mesin ${PRIMARY}. Garis putus-putus menandai ` +
    `prevalensi event ${fmtPct(DATA.pr_curve.baseline)}.`;
}

function renderConfusion() {
  const p = DATA.pooled[PRIMARY];
  const total = p.tp + p.fp + p.fn + p.tn;
  const rows = [
    { n: 'Benar event', v: p.tp, c: 'var(--ok)', tip: `${int(p.tp)} titik event benar diramalkan alert` },
    { n: 'Alarm palsu', v: p.fp, c: 'var(--warn)', tip: `${int(p.fp)} titik normal salah diramalkan alert` },
    { n: 'Event lolos', v: p.fn, c: 'var(--bad)', tip: `${int(p.fn)} titik event tidak diramalkan` },
    { n: 'Benar normal', v: p.tn, c: 'var(--series-2)', tip: `${int(p.tn)} titik normal benar tidak diramalkan` },
  ];
  const host = $('confusion');
  host.innerHTML = '';
  rows.forEach(r => {
    const d = document.createElement('div');
    d.className = 'cf-row';
    d.setAttribute('data-tip', r.tip);
    d.innerHTML = `<div class="cf-name"></div><div class="bar-track"><div class="bar-fill"></div></div><div class="cf-val"></div>`;
    d.querySelector('.cf-name').textContent = r.n;
    const f = d.querySelector('.bar-fill');
    f.style.width = (total ? r.v / total * 100 : 0).toFixed(1) + '%';
    f.style.background = r.c;
    d.querySelector('.cf-val').textContent = int(r.v);
    host.appendChild(d);
  });
  $('confusion-foot').textContent = `${int(total)} baris uji. Proporsi tiap kotak dihitung terhadap seluruh baris uji.`;
}

function renderFoldTiles() {
  const host = $('fold-tiles');
  host.innerHTML = '';
  DATA.folds.forEach(f => {
    const e = f.engines[PRIMARY];
    const tone = e.pr_auc === null ? 'var(--ink-faint)'
      : (e.pr_auc >= 0.5 ? 'var(--ok)' : e.pr_auc >= 0.2 ? 'var(--warn)' : 'var(--bad)');
    const d = document.createElement('div');
    d.className = 'kpi';
    d.setAttribute('data-tip',
      `${f.label}: ${int(f.n)} baris, ${int(f.n_pos)} event, prevalensi ${fmtPct(f.prev)}. ` +
      `PR-AUC ${fmtNum(e.pr_auc, 3)}, recall ${fmtPct(e.recall)}, presisi ${fmtPct(e.precision)}`);
    d.innerHTML =
      `<div class="k-label"></div><div class="k-value" style="font-size:22px"></div>` +
      `<div class="k-note"></div>` +
      `<div class="bar-track" style="margin-top:10px"><div class="bar-fill"></div></div>`;
    d.querySelector('.k-label').textContent = f.label;
    d.querySelector('.k-value').textContent = fmtNum(e.pr_auc, 3);
    d.querySelector('.k-note').textContent =
      `recall ${fmtPct(e.recall)} · presisi ${fmtPct(e.precision)} · ${int(f.n_pos)} event`;
    const fill = d.querySelector('.bar-fill');
    fill.style.width = (e.pr_auc === null ? 0 : Math.min(1, e.pr_auc) * 100).toFixed(1) + '%';
    fill.style.background = tone;
    host.appendChild(d);
  });
  $('fold-foot').textContent =
    'Satu ubin per sumur, nilai besar adalah PR-AUC fold itu. Warna mengikuti pita mutu: ' +
    'hijau 0.5 ke atas, kuning 0.2 sampai 0.5, merah di bawah 0.2.';
}

/* ------------------------------ tab: daftar dan detail ------------------------------ */

const TAB_IDS = ['overview', 'wells', 'engines'];

function switchTab(name) {
  state.tab = name;
  TAB_IDS.forEach(t => {
    $('tabbtn-' + t).setAttribute('aria-selected', String(t === name));
    $('tab-' + t).hidden = t !== name;
  });
  adoptTips(document);
}

function barRow(name, sub, value, scale, color, tip) {
  const row = document.createElement('div');
  row.className = 'bar-row';
  row.setAttribute('data-tip', tip || '');
  row.innerHTML =
    `<div class="b-name"><b></b><span></span></div>` +
    `<div class="bar-track"><div class="bar-fill"></div></div>` +
    `<div class="b-val"></div>`;
  row.querySelector('b').textContent = name;
  row.querySelector('span').textContent = sub || '';
  const pct = (value === null || value === undefined) ? 0
    : Math.max(0, Math.min(1, value / (scale || 1))) * 100;
  const fill = row.querySelector('.bar-fill');
  fill.style.width = pct.toFixed(1) + '%';
  fill.style.background = color || 'var(--accent)';
  row.querySelector('.b-val').textContent =
    (value === null || value === undefined) ? 'n/a' : fmtNum(value, 3);
  return row;
}

function mbox(key, value, note) {
  const d = document.createElement('div');
  d.className = 'mbox';
  d.innerHTML = `<div class="m-k"></div><div class="m-v"></div><div class="m-n"></div>`;
  d.querySelector('.m-k').textContent = key;
  d.querySelector('.m-v').textContent = value;
  d.querySelector('.m-n').textContent = note || '';
  return d;
}

// Skala warna mutu AUPRC dipakai di dua kartu, jadi legendanya dibuat sekali
// supaya warna hijau, kuning, dan merah selalu punya arti yang sama.
function qualityLegend() {
  const d = document.createElement('div');
  d.className = 'legend';
  d.innerHTML =
    '<span><i style="background:var(--ok)"></i>0,5 ke atas</span>' +
    '<span><i style="background:var(--warn)"></i>0,2 sampai 0,5</span>' +
    '<span><i style="background:var(--bad)"></i>di bawah 0,2</span>';
  return d;
}

function tierClass(tier) {
  const t = String(tier || '').toUpperCase();
  if (t.includes('PERINGATAN')) return 'warn';
  if (t.includes('TREN')) return 'accent';
  if (t.includes('BATAS') || t.includes('TIDAK')) return 'bad';
  return '';
}

/* ---- tab Sumur ---- */

function renderWellList() {
  const host = $('well-list');
  host.innerHTML = '';
  FULL.wells.forEach(w => {
    const b = document.createElement('button');
    b.className = 'tile';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.wellSel === w.well));
    b.setAttribute('data-tip',
      `${w.well}: diuji di ${w.engines.length} engine, ${int(w.n_test_total)} baris uji gabungan`);
    b.innerHTML = `<div class="t-name"></div><div class="t-meta"></div>`;
    b.querySelector('.t-name').textContent = w.well;
    b.querySelector('.t-meta').textContent =
      `${w.engines.length} engine · ${int(w.n_test_total)} baris uji`;
    b.addEventListener('click', () => {
      state.wellSel = w.well;
      renderWellList();
      renderWellDetail();
    });
    host.appendChild(b);
  });
  $('well-list-foot').textContent =
    `${FULL.wells.length} sumur. Jumlah baris uji dijumlahkan lintas engine, jadi bisa lebih besar ` +
    `dari jumlah baris unik karena satu sumur diuji lebih dari sekali.`;
}

function renderWellDetail() {
  const host = $('well-detail');
  host.innerHTML = '';
  const w = FULL.wells.find(x => x.well === state.wellSel);
  if (!w) {
    host.innerHTML = '<section class="card"><p class="c-note empty-state">' +
      'Belum ada sumur dipilih. Pilih satu dari daftar di kiri.</p></section>';
    return;
  }

  const prev = w.n_test_total ? (w.pos_test_total / w.n_test_total) : null;
  const head1 = document.createElement('section');
  head1.className = 'card';
  head1.innerHTML =
    `<div class="detail-head"><h2></h2></div>` +
    `<div class="chiprow"></div>` +
    `<div class="metrgrid"></div>` +
    `<p class="c-note" style="margin-top:12px"></p>`;
  head1.querySelector('h2').textContent = w.well;
  const cr = head1.querySelector('.chiprow');
  const badges = [
    `${w.engines.length} engine`,
    `${int(w.n_test_total)} baris uji`,
    w.series_label ? 'ada seri y_10' : 'tanpa seri y_10',
  ];
  badges.forEach(t => {
    const s = document.createElement('span');
    s.className = 'badge' + (t === 'ada seri y_10' ? ' good' : '');
    s.textContent = t;
    s.setAttribute('data-tip', t === 'ada seri y_10'
      ? 'Sumur ini punya seri waktu hasil hitung ulang di tab Ringkasan'
      : 'Metrik engine untuk sumur ini dibaca dari hasil run capstone');
    cr.appendChild(s);
  });
  const up = w.engines.filter(e => e.underpowered).length;
  const g = head1.querySelector('.metrgrid');
  g.appendChild(mbox('Sumur', w.well, 'nama fold uji di run capstone'));
  g.appendChild(mbox('Engine', String(w.engines.length), 'engine yang pernah menguji sumur ini'));
  g.appendChild(mbox('Baris uji', int(w.n_test_total), 'dijumlahkan lintas engine'));
  g.appendChild(mbox('Titik positif', int(w.pos_test_total), 'prevalensi ' + fmtPct(prev)));
  if (up > 0) {
    g.appendChild(mbox('Fold kurang tenaga', String(up), 'fold dengan sampel positif terlalu sedikit'));
  }
  head1.querySelector('p').textContent =
    (w.series_label
      ? `Seri waktu sumur ini tersedia dan bisa dilihat di tab Ringkasan.`
      : `Seri waktu y_10 tidak tersedia untuk sumur ini.`) +
    ` Metrik di bawah berasal langsung dari berkas hasil run capstone, tidak dihitung ulang.` +
    (up > 0
      ? ` Ada ${up} fold yang sampel positifnya terlalu sedikit, jadi angkanya lemah.`
      : ` Tidak ada fold yang ditandai kurang tenaga.`);
  host.appendChild(head1);

  // perbandingan antar engine pada sumur ini
  const c2 = document.createElement('section');
  c2.className = 'card';
  c2.innerHTML =
    `<h2>Hasil tiap engine di sumur ini</h2>` +
    `<p class="c-note">AUPRC model terbaik yang dilaporkan fold ini. Batang tanpa nilai berarti ` +
    `fold itu tidak melaporkan AUPRC.</p><div class="bars"></div>`;
  c2.insertBefore(qualityLegend(), c2.querySelector('.bars'));
  const bars = c2.querySelector('.bars');
  w.engines.forEach(e => {
    const models = e.models || {};
    let bestName = null, bestVal = null;
    Object.entries(models).forEach(([k, m]) => {
      if (m && typeof m.auprc === 'number' && (bestVal === null || m.auprc > bestVal)) {
        bestVal = m.auprc; bestName = k;
      }
    });
    const color = bestVal === null ? 'var(--ink-faint)'
      : (bestVal >= 0.5 ? 'var(--ok)' : bestVal >= 0.2 ? 'var(--warn)' : 'var(--bad)');
    bars.appendChild(barRow(
      e.display_name, bestName || 'tanpa AUPRC', bestVal, 1, color,
      `${e.display_name} di ${w.well}: AUPRC ${bestVal === null ? 'tidak dilaporkan' : fmtNum(bestVal, 4)} ` +
      `(model ${bestName || '-'}), ${int(e.n_test)} baris, ${int(e.pos_test)} positif` +
      (e.underpowered ? ', fold kurang tenaga' : '')));
    if (e.underpowered) {
      const note = document.createElement('div');
      note.className = 'h-text';
      note.style.margin = '2px 0 6px';
      note.textContent = `${e.display_name}: fold ini ditandai kurang tenaga, angkanya tidak boleh dibaca sebagai bukti stabil.`;
      bars.appendChild(note);
    }
  });
  const agg = document.createElement('div');
  agg.className = 'c-foot';
  agg.textContent =
    `Prevalensi gabungan di sumur ini ${fmtPct(prev)}. AUPRC acak setara prevalensi itu, ` +
    `jadi angka di atas 0,5 baru berarti kuat.`;
  c2.appendChild(agg);
  host.appendChild(c2);

  // rincian per engine
  const c3 = document.createElement('section');
  c3.className = 'card';
  c3.innerHTML = `<h2>Rincian per engine</h2><div class="headlist"></div>`;
  const list = c3.querySelector('.headlist');
  w.engines.forEach(e => {
    const row = document.createElement('div');
    row.className = 'headrow l1';
    const modelBits = Object.entries(e.models || {})
      .map(([k, m]) => `${k} ${m && m.auprc != null ? fmtNum(m.auprc, 4) : 'n/a'}`)
      .join(' · ');
    row.innerHTML =
      `<div class="h-top"><span class="h-name"></span><span class="badge"></span>` +
      `<span class="badge"></span></div>` +
      `<div class="h-metrics"></div>`;
    row.querySelector('.h-name').textContent = e.display_name;
    const bs = row.querySelectorAll('.badge');
    bs[0].textContent = int(e.n_test) + ' baris';
    bs[1].textContent = 'prevalensi ' + fmtPct(e.prev_test);
    if (e.underpowered) {
      bs[1].className = 'badge warn';
      bs[1].textContent += ' · kurang tenaga';
    }
    row.querySelector('.h-metrics').textContent = modelBits || 'fold ini tidak melaporkan metrik model';
    row.setAttribute('data-tip',
      `${e.display_name} di ${w.well}: ${modelBits || 'tanpa metrik model'}`);
    list.appendChild(row);
  });
  host.appendChild(c3);
}

/* ---- tab Engine ---- */

function renderEngineList() {
  const host = $('engine-list');
  host.innerHTML = '';
  FULL.engines.forEach(e => {
    const b = document.createElement('button');
    b.className = 'tile';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.engineSel === e.engine));
    const r = e.rf_range || {};
    b.setAttribute('data-tip',
      `${e.display_name}: ${e.folds.length} fold, ${e.n_heads} head, ` +
      `AUPRC ${r.min != null ? fmtNum(r.min, 3) + ' s/d ' + fmtNum(r.max, 3) : 'tidak ada fold per well'}`);
    b.innerHTML = `<div class="t-name"></div><div class="t-meta"></div>`;
    b.querySelector('.t-name').textContent = e.display_name;
    b.querySelector('.t-meta').textContent =
      `${e.folds.length} fold · ${e.n_heads} head` +
      (r.min != null ? ` · AUPRC ${fmtNum(r.min, 3)} sampai ${fmtNum(r.max, 3)}`
                     : ' · tanpa AUPRC');
    b.addEventListener('click', () => {
      state.engineSel = e.engine;
      renderEngineList();
      renderEngineDetail();
    });
    host.appendChild(b);
  });
  $('engine-list-foot').textContent =
    `${FULL.engines.length} engine. Dua di antaranya hanya punya catatan head tanpa fold per well, ` +
    `sehingga rinciannya berhenti di tingkat pooled.`;
}

function renderEngineDetail() {
  const host = $('engine-detail');
  host.innerHTML = '';
  const e = FULL.engines.find(x => x.engine === state.engineSel);
  if (!e) {
    host.innerHTML = '<section class="card"><p class="c-note empty-state">' +
      'Belum ada engine dipilih. Pilih satu dari daftar di kiri.</p></section>';
    return;
  }
  const r = e.rf_range || {};

  const c1 = document.createElement('section');
  c1.className = 'card';
  c1.innerHTML =
    `<div class="detail-head"><h2></h2></div>` +
    `<div class="chiprow"></div>` +
    `<div class="metrgrid"></div>` +
    `<p class="c-note" style="margin-top:12px"></p>`;
  c1.querySelector('h2').textContent = e.display_name;
  const cr = c1.querySelector('.chiprow');
  const chips = [
    { t: e.kind === 'ml' ? 'model ML' : (e.kind === 'stat' ? 'mesin statistik' : 'catatan head'), c: 'accent' },
    { t: `${e.folds.length} fold`, c: '' },
    { t: `${e.n_heads} head`, c: '' },
    e.n_features ? { t: `${e.n_features} fitur`, c: '' } : null,
    e.underpowered_folds.length ? { t: `${e.underpowered_folds.length} fold kurang tenaga`, c: 'warn' } : null,
  ].filter(Boolean);
  chips.forEach(c => {
    const s = document.createElement('span');
    s.className = 'badge ' + c.c;
    s.textContent = c.t;
    cr.appendChild(s);
  });
  const g = c1.querySelector('.metrgrid');
  if (e.folds.length) {
    g.appendChild(mbox('AUPRC median', r.median != null ? fmtNum(r.median, 3) : 'n/a',
      r.min != null ? `rentang ${fmtNum(r.min, 3)} sampai ${fmtNum(r.max, 3)}` : 'tanpa fold per well'));
    g.appendChild(mbox('Fold', String(e.folds.length), 'sumur yang menjadi data uji'));
    g.appendChild(mbox('Baris uji', int(e.n_test_total), 'dijumlahkan lintas fold'));
    g.appendChild(mbox('Titik positif', int(e.n_pos_total),
      e.n_test_total ? 'prevalensi ' + fmtPct(e.n_pos_total / e.n_test_total) : ''));
  }
  // Saat ada fold, jumlah head sudah tampil sebagai badge, jadi tile ini hanya
  // dipakai kalau engine memang tidak punya metrik lain untuk ditampilkan.
  if (!e.folds.length) {
    g.appendChild(mbox('Head', String(e.n_heads), 'aturan, persistence, hibrida, dan model'));
  }
  c1.querySelector('p').textContent =
    (e.klaim_tugas || 'Klaim tugas tidak tercatat di payload.') +
    (e.jenis_task ? ' | Tugas: ' + e.jenis_task : '') +
    (e.folds.length ? '' :
      ' | Engine ini tidak punya fold per sumur di run capstone, jadi tidak ada AUPRC yang ' +
      'bisa dilaporkan. Rinciannya berhenti di tingkat head di bawah.');
  host.appendChild(c1);

  // hasil per well
  if (e.folds.length) {
    const c2 = document.createElement('section');
    c2.className = 'card';
    c2.innerHTML =
      `<h2>Hasil di tiap sumur</h2>` +
      `<p class="c-note">AUPRC model terbaik per fold. Semua fold memakai satu sumur sebagai data ` +
      `ujian dan sisanya untuk latih.</p><div class="bars"></div>`;
    c2.insertBefore(qualityLegend(), c2.querySelector('.bars'));
    const bars = c2.querySelector('.bars');
    e.folds
      .slice()
      .sort((a, b) => {
        const av = Object.values(a.models || {}).map(m => m && m.auprc).filter(v => typeof v === 'number');
        const bv = Object.values(b.models || {}).map(m => m && m.auprc).filter(v => typeof v === 'number');
        return (Math.max(...bv, -1)) - (Math.max(...av, -1));
      })
      .forEach(f => {
        let bestName = null, bestVal = null;
        Object.entries(f.models || {}).forEach(([k, m]) => {
          if (m && typeof m.auprc === 'number' && (bestVal === null || m.auprc > bestVal)) {
            bestVal = m.auprc; bestName = k;
          }
        });
        const color = bestVal === null ? 'var(--ink-faint)'
          : (bestVal >= 0.5 ? 'var(--ok)' : bestVal >= 0.2 ? 'var(--warn)' : 'var(--bad)');
        bars.appendChild(barRow(
          f.well, bestName || 'tanpa AUPRC', bestVal, 1, color,
          `${e.display_name} di ${f.well}: AUPRC ${bestVal === null ? 'tidak dilaporkan' : fmtNum(bestVal, 4)} ` +
          `(model ${bestName || '-'}), ${int(f.n_test)} baris, ${int(f.pos_test)} positif, ` +
          `prevalensi ${fmtPct(f.prev_test)}` + (f.underpowered ? ', kurang tenaga' : '')));
      });
    const foot = document.createElement('div');
    foot.className = 'c-foot';
    const ups = e.underpowered_folds;
    foot.textContent =
      `${e.folds.length} fold. ` +
      (ups.length ? `Fold kurang tenaga: ${ups.join(', ')}. Angkanya tidak boleh dibaca sebagai bukti stabil.`
                  : 'Tidak ada fold yang ditandai kurang tenaga.');
    c2.appendChild(foot);
    host.appendChild(c2);
  }

  // rentang antar model
  const mr = e.model_ranges || {};
  const mkeys = Object.keys(mr);
  if (mkeys.length) {
    const c3 = document.createElement('section');
    c3.className = 'card';
    c3.innerHTML =
      `<h2>Perbandingan antar model</h2>` +
      `<p class="c-note">Rentang AUPRC lintas fold untuk tiap model. Batang menunjukkan median.</p>` +
      `<div class="bars"></div><div class="c-foot"></div>`;
    const bars = c3.querySelector('.bars');
    // Warna menandai jenis batang, bukan model: biru untuk median, jingga untuk
    // nilai tertinggi. Sebelumnya tiap model punya warna sendiri sehingga jingga
    // berarti dua hal berbeda di dua kartu.
    mkeys.forEach(k => {
      bars.appendChild(barRow(k, `${mr[k].n} fold`, mr[k].median, 1, 'var(--series-2)',
        `${k}: median AUPRC ${fmtNum(mr[k].median, 4)}, rentang ${fmtNum(mr[k].min, 4)} sampai ` +
        `${fmtNum(mr[k].max, 4)} pada ${mr[k].n} fold`));
      bars.appendChild(barRow('', 'tertinggi', mr[k].max, 1, 'var(--series-3)',
        `${k}: AUPRC tertinggi ${fmtNum(mr[k].max, 4)} di satu fold`));
    });
    const leg = document.createElement('div');
    leg.className = 'legend';
    leg.innerHTML = '<span><i style="background:var(--series-2)"></i>median lintas fold</span>' +
                    '<span><i style="background:var(--series-3)"></i>nilai tertinggi</span>';
    c3.insertBefore(leg, c3.querySelector('.bars'));
    c3.querySelector('.c-foot').textContent =
      'Dua batang per model: atas median, bawah nilai tertinggi. Selisih lebar berarti hasil ' +
      'sangat bergantung pada sumur mana yang diuji.';
    host.appendChild(c3);
  }

  // head
  if (e.heads && e.heads.length) {
    const c4 = document.createElement('section');
    c4.className = 'card';
    c4.innerHTML =
      `<h2>Head pada engine ini</h2>` +
      `<p class="c-note">Satu head adalah satu cara menghasilkan status. Metrik di bawah berasal ` +
      `dari segmen yang dilaporkan run capstone.</p><div class="headlist"></div>`;
    const list = c4.querySelector('.headlist');
    e.heads.forEach(h => {
      const m = h.metrics || {};
      const row = document.createElement('div');
      const lvl = String(h.layer || '').replace(/\D/g, '');
      row.className = 'headrow l' + (lvl || '1');
      row.innerHTML =
        `<div class="h-top"><span class="h-name"></span>` +
        `<span class="badge"></span><span class="badge"></span></div>` +
        `<div class="h-metrics"></div>` +
        `<div class="h-text"></div>`;
      row.querySelector('.h-name').textContent = h.head;
      const bs = row.querySelectorAll('.badge');
      bs[0].textContent = h.layer || 'tanpa layer';
      bs[1].textContent = h.tier || 'tanpa tier';
      bs[1].className = 'badge ' + tierClass(h.tier);
      const bits = [];
      if (m.precision != null) bits.push('presisi ' + fmtPct(m.precision));
      if (m.recall != null) bits.push('recall ' + fmtPct(m.recall));
      if (m.far != null) bits.push('FAR ' + fmtNum(m.far, 1) + '/24jam');
      if (h.n_windows) bits.push(int(h.n_windows) + ' jendela');
      if (h.frac_aktif != null) bits.push('aktif ' + fmtPct(h.frac_aktif));
      row.querySelector('.h-metrics').textContent = bits.length ? bits.join(' · ') : 'tanpa metrik';
      const txt = [h.definisi, h.badge_far, h.batas].filter(Boolean).join(' ');
      row.querySelector('.h-text').textContent = txt;
      row.setAttribute('data-tip',
        `${h.head}: ${bits.join(', ') || 'tanpa metrik'}. ` +
        `${h.batas ? 'Batas: ' + h.batas : ''}`.slice(0, 100));
      list.appendChild(row);
    });
    const f = document.createElement('div');
    f.className = 'c-foot';
    f.textContent =
      `${e.heads.length} head. Warna garis kiri menandai layer: biru L0, jingga L1, kuning L2 atau lebih. ` +
      `Semua head butuh tinjauan manusia sebelum dipakai sebagai keputusan.`;
    c4.appendChild(f);
    host.appendChild(c4);
  }
}

/* ------------------------------ boot ------------------------------ */

async function boot() {
  const ok = await loadData();
  if (!ok) return;
  DATA = FULL.overview;
  PRIMARY = DATA.meta.primary_engine;
  if (!state.well) state.well = DATA.folds[0].label;
  renderHeader();
  renderKpis();
  renderChips();
  renderWellLine();
  renderTimeline();
  renderHist();
  renderShap();
  renderEngines();
  renderPr();
  renderConfusion();
  renderFoldTiles();

  bindTabs();
  renderWellList();
  renderEngineList();
  switchTab('overview');

  adoptTips(document);
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType === 1) adoptTips(n);
  }))).observe(document.body, { childList: true, subtree: true });
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = TAB_IDS.indexOf(b.dataset.tab);
      const step = e.key === 'ArrowRight' ? 1 : TAB_IDS.length - 1;
      const next = TAB_IDS[(i + step) % TAB_IDS.length];
      switchTab(next);
      $('tabbtn-' + next).focus();
    });
  });
}

$('retry').addEventListener('click', boot);
boot();

})();
