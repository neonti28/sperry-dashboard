# Predictive Maintenance Dashboard - Volve Field, Sperry Drilling

Dashboard pemantauan kondisi dan prediksi kegagalan untuk operasi pengeboran Volve (blok 15/9,
Laut Utara). Seluruh angka dihitung di Python, halaman hanya menampilkan.

## Menjalankan

```bash
cd "/mnt/d/Download/predictive maintenance"
/home/neonti/.hermes/venvs/pm/bin/python serve.py        # http://127.0.0.1:8099/
```

Membuka `index.html` langsung dari disk juga bisa (mode `file://`), karena payload juga ditulis
sebagai `data/plant.js`.

## Tiga halaman

| Berkas | Isi |
| --- | --- |
| `sperry.html` | Kulit baru mengikuti `DESIGN.md`: sidebar, pita judul bergradien, footer bertanda, lima tab yang sama |
| `index.html` | Dashboard lapangan versi fungsional: lima tab Operasi, Aset, Aksi, Keandalan, Model |
| `legacy_engines.html` | Dashboard lama tiga tab (Ringkasan, Sumur, Engine) dari `data/pm_full.json` |

`sperry.html` memakai `css/sperry.css` dan `js/sperry.js`; keduanya hanya menata, angka tetap dari
`data/plant.js` yang dibangun `code/plant_build.py`. Di layar penuh (1280x752 ke atas) tiap tab
mengisi satu layar tanpa gulir; di jendela pendek atau layar sempit halaman bergulir supaya tidak ada
isi kartu yang terpotong.

Tab bisa ditautkan langsung: `#aset`, `#aksi`, `#keandalan`, `#model`.

## Jalur data

```
data mentah capstone (read-only)          hasil run capstone
  labels_curated_v2.csv                     scratch/v9_i1/*.json
  witsml_parsed/*.csv                       data/pm_full.json
  USROP_health.csv                                 |
        |                                          |
        v                                          v
  code/plant_build.py  --------------------->  data/plant.json  (payload utama, ~830 KB)
        |                                          |
        |                                          v
        |                                     data/plant.js   (cermin untuk file://)
        v
  data/.witsml_hourly_<sha>.pkl (cache agregat per jam, boleh dihapus)
```

`code/exporter.py` dan `code/exporter_full.py` tetap ada untuk membangun `data/pm_data.json` dan
`data/pm_full.json` yang dipakai tab Model.

## Tiga lapisan angka

Setiap angka punya badge sumber, dan badge itu ditampilkan di layar:

| Lapisan | Arti |
| --- | --- |
| TERUKUR | Dibaca langsung dari berkas capstone: 884 kejadian operasi, 239 kanal WITSML, 9,9 juta baris telemetri |
| TURUNAN | Dihitung dari data terukur: MTBF, MTTR, ketersediaan, downtime, RUL, probabilitas, skor anomali, D-OEE |
| SINTETIS | Dibangkitkan dengan seed tetap `20260511`: work order administrasi, teknisi, biaya, sisa parameter sensor yang tidak ada di data publik |

Seed tetap membuat hasil bisa direproduksi: dua kali run menghasilkan sha256 payload yang sama.

## Aturan waktu

Tanggal acuan **2015-08-13 23:59 UTC**, yaitu kejadian terakhir di log. Tidak ada nilai setelah
tanggal itu yang masuk fitur. Validator menolak payload bila ada seri atau work order melewati acuan.

Satu kenyataan yang ditampilkan terang-terangan di halaman: telemetri WITSML berhenti **16 Juli 2009**,
sekitar 2.219 hari sebelum acuan. Jadi nilai sensor adalah pembacaan terakhir yang tersedia, bukan
kondisi Agustus 2015. Prediksi memakai kejadian dan umur operasi, bukan sensor yang tidak ada.

## Pembersihan data yang dilakukan

Sumber mencampur satuan dan memuat nilai mustahil. Tanpa pembersihan, ambang warning tekanan menjadi
21.000 bar karena satu sumur menulis kPa dan sumur lain menulis bar.

| Kanal | Tindakan | Jumlah baris |
| --- | --- | --- |
| SPPA | kPa ke bar (bagi 100) lalu saring 0-700 bar | 73 dikonversi, 33.087 dibuang |
| TRPM | 0,1 rpm ke rpm (bagi 10) lalu saring 0-300 rpm | 1.624 dikonversi, 1.620 dibuang |
| ATMP_RT | saring -20 sampai 180 C | 662 dibuang |
| VIBLAT_RT | saring 0-400 m/s2 | 144 dibuang |
| TQA | saring -80 sampai 120 kN.m | 9 dibuang |

Angka ini juga tertulis di payload pada `meta.data_fixes`.

## Yang dihitung bagaimana

- **RUL**: Weibull dengan beta dari fit per komponen (dibatasi minimal 1,0 karena hasil fit di bawah 1
  berarti hazard menurun, bukan keausan) dan eta dari MTBF aset itu sendiri. Umur diukur dalam jam
  operasi, bukan jam dinding, supaya aset yang berhenti dipakai tidak menua sendiri.
- **Probabilitas 7 dan 30 hari**: peluang bersyarat Weibull dari umur sekarang.
- **Skor risiko 0-100**: 60% probabilitas 7 hari, 40% simpangan kanal. RUL tidak masuk skor agar aset
  tua tanpa gejala tidak otomatis di puncak daftar.
- **Status**: mengikuti bukti saat ini. Aset yang umurnya melewati MTBF diberi tanda terpisah
  `lewat MTBF`, bukan langsung dinilai kritis.
- **D-OEE**: analogi OEE untuk rig, yaitu rasio waktu putar x kinerja ROP terhadap target x mutu lubang.
  Hanya dihitung pada bulan yang punya jendela pengeboran minimal 200 jam; bulan lain tidak digambar,
  bukan diplot sebagai nol.
- **Anomali**: simpangan nilai terakhir terhadap median kanal, dibagi jarak median ke persentil 95.
  Aset tanpa kanal memakai riwayat kejadian 12 bulan terakhir.

## Invarian yang diperiksa setiap build

1. Jumlah status sama dengan total aset.
2. Health index dalam 0-100.
3. Probabilitas 7 dan 30 hari dalam 0-1.
4. MTBF sama dengan jam operasi dibagi jumlah kegagalan.
5. Tidak ada seri sensor melewati tanggal acuan.
6. Tidak ada work order dibuat setelah tanggal acuan.

Build berhenti dengan `error validasi: 0` bila semua lolos; jumlahnya tertulis di kaki halaman.

## Isi tiap tab

| Tab | Bagian |
| --- | --- |
| Operasi | 8 KPI, lima pertanyaan, D-OEE bulanan, donut kesehatan, tren kegagalan, top 5 risiko, top drivers, governed actions, watch areas, chronic, control loop, aktivitas maintenance, AI advisory, alert |
| Aset | Daftar 46 aset, detail (registri, 8 parameter dengan ambang, tren per parameter, RUL, diagnosis, riwayat), tabel registri, heatmap anomali, distribusi failure mode |
| Aksi | KPI pekerjaan, work order, rekomendasi, suku cadang, biaya per aset, riwayat maintenance, tren biaya |
| Keandalan | MTBF, MTTR, ketersediaan, downtime, laju kegagalan, biaya, keandalan per komponen, diagnosis, chronic, penyimpangan SPC, riwayat kegagalan |
| Model | Metrik capstone apa adanya: PR-AUC, recall, presisi, kurva PR, per sumur, per engine |

## Berkas

```
index.html              dashboard lapangan (lima tab)
legacy_engines.html     dashboard lama (tiga tab)
css/plant.css           tata letak dashboard lapangan
css/app.css             tata letak dashboard lama
js/plant.js             render lima tab
js/plantcharts.js       grafik SVG tanpa pustaka luar
js/app.js, js/charts.js dashboard lama
code/plant_build.py     pembangun payload lapangan
code/exporter.py        pembangun data/pm_data.json
code/exporter_full.py   pembangun data/pm_full.json
serve.py                server statis port 8099, tanpa cache
PLAN_DASHBOARD_V3.md    rencana yang mengikat
```

## Batas yang jujur

- Telemetri berhenti 2009; nilai sensor bukan kondisi 2015.
- Aset permukaan (top drive, drawworks, pompa lumpur, rotary table, iron roughneck, shale shaker,
  wireline tractor) tidak punya kanal sendiri; delapan parameternya sintetis ber-seed dengan karakter
  dari ISO 20816-3 dan benchmark keandalan.
- BOP tidak dibuat karena tidak ada satu pun kejadian atau kanal yang menyebutnya.
- Hasil model capstone ditampilkan apa adanya, termasuk yang lemah (PR-AUC 0,091 untuk window).

## Arah desain dan aset

Design read: dashboard pemantauan kondisi untuk engineer operasi pengeboran, gaya industrial gelap
dengan aksen crimson dan tipografi condensed, dial ENERGY 2 / RHYTHM 2 / MOTION 1.

| Dial | Nilai | Alasan satu baris |
| --- | --- | --- |
| ENERGY | 2 | Blok logo merah dan judul condensed memberi karakter, tetapi isi tetap tabel dan angka, bukan panggung |
| RHYTHM | 2 | Tiap tab punya susunan baris berbeda (Operasi 3 baris, Aset 3 kolom, Aksi 4 kolom), sementara radius 8 px dan border 1 px yang sama menjaga kesatuan |
| MOTION | 1 | Tidak ada animasi; satu-satunya gerak adalah keadaan hover dan focus (diukur: nol properti `animation`, nol `transform` berjalan) |

Alasan keputusan yang mudah ditanyakan:

- Warna: navy hitam dan crimson diambil dari `DESIGN.md`, bukan pilihan default; hijau, kuning, merah hanya berarti status.
- Tipografi: Barlow Condensed untuk judul dan angka besar karena karakter industrial, Inter untuk isi karena angka harus rapi dibaca cepat.
- Tata letak: sidebar 212 px dan topbar 70 px mengikuti `DESIGN.md`; kartu dibuat rapat karena satu layar operator harus memuat seluruh keputusan.
- Tanpa shadow dan tanpa glass: kedalaman dari border 1 px dan beda tone, sesuai aturan pemakaian di `DESIGN.md`.
- Ikon: SVG garis 1,5 px yang relevan dengan isinya (grid untuk Operasi, perisai untuk Aset, clipboard untuk Aksi, grafik untuk Keandalan, gauge untuk Model).

### Aset gambar: apa yang raster, apa yang vektor

Yang **wajib raster** menurut `DESIGN.md` dan statusnya sekarang:

| Elemen | Berkas | Status |
| --- | --- | --- |
| Ilustrasi derrick sidebar | `assets/rig-night.jpg` (1280x1707, foto rig malam) | Terpasang apa adanya, byte identik dengan sumber. Opasitas 0,22 dan fade hanya penyajian CSS |
| Hero banner | `assets/hero-drillpipe.jpg` (3072x2304) | Foto rak drill pipe nyata, dipakai apa adanya. Kredit: Joshua Doubek, CC BY-SA 3.0, Wikimedia Commons `File:ND Bakken Drill Pipe.JPG`. Bukan render ber-brand seperti yang diminta `DESIGN.md`, karena render itu milik Halliburton dan tidak tersedia publik |
| Foto alat MWD | belum dipakai | `tool-mwd.jpg` berisi drill collar di gravel siang hari, subjeknya bukan MWD; tidak dipasang supaya tidak salah label |
| Peta dunia | `world-map.svg` (950x620, vektor) | Belum dipasang; tab Aset belum punya kartu lokasi |

Yang **vektor/DOM**: logo (teks "HALLIBURTON" di blok merah, lihat catatan di bawah), seluruh ikon
inline SVG, chart SVG di `js/plantcharts.js`, pin peta dan panah tren bila nanti dipakai.

Aturan yang dipegang:

- Logo perusahaan tidak diubah, tidak digambar ulang, tidak diwarnai ulang, dan tidak diganti teks
  menjadi SVG atau sebaliknya. Aset resmi ada di `Magang Halliburton/dashboard-dummy/assets/`
  (`logo-halliburton-red.svg` dan `logo-halliburton-white.svg`), tetapi pemasangannya menunggu
  keputusan pemilik produk.
- Gambar tidak diganti elemen buatan. Ilustrasi derrick versi garis tangan sudah dibuang karena itu
  gambar buatan yang menyamar sebagai aset raster.
- Berkas gambar tidak pernah diedit untuk masuk ke halaman. Perubahan tampilan dilakukan di CSS
  (opasitas, mask, scrim) supaya berkas aslinya tetap utuh.

