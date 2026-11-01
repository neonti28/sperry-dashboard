# CHANGELOG

## 2026-11-01 - v2.1.2 - foto drill pipe nyata di hero

- Hero banner memakai foto rak drill pipe nyata `assets/hero-drillpipe.jpg` (3072x2304, disalin
  byte identik dari Wikimedia Commons `File:ND Bakken Drill Pipe.JPG`, Joshua Doubek, CC BY-SA 3.0).
  Berkas tidak diedit; peredupan lewat `opacity: 0.28` dan scrim gradien di CSS.
- SVG `pipe-mark` (gambar pipa buatan tangan) di sudut kanan hero dibuang karena digantikan foto nyata.
- Kontras teks hero diukur pada piksel hasil render dengan teks disembunyikan: terburuk 4,77:1
  di 1440x900, 4,78:1 di 1280x752, 15,85:1 di 390x844 (batas AA 4,5:1).
- Scrim sempat 0,62 di sisi kanan dan membuat tiga label statistik gagal (4,24 sampai 4,41); dinaikkan
  ke 0,82 dan opasitas foto diturunkan dari 0,34 ke 0,28 sampai semua lolos.
- Halaman tetap tepat satu layar di 1440x900 dan 1280x752; 390x844 bergulir vertikal tanpa luapan
  horizontal. Konsol bersih.

## 2026-11-01 - v2.1.1 - foto rig asli, tap target, dan catatan aset

**Aset gambar**
- Sidebar: ilustrasi derrick versi garis tangan (SVG tiga path buatan) diganti foto rig nyata
  `assets/rig-night.jpg` (1280x1707, disalin byte identik dari `Magang Halliburton/dashboard-dummy/assets/`).
  Opasitas 0,22, `object-fit: cover`, dan mask fade ke atas adalah penyajian CSS; berkas gambar tidak diedit.
- Scrim gelap di antara foto dan teks (`.derrick-scrim`) ditambahkan karena label abu di bawah foto
  kehilangan kontras. Diukur pada piksel hasil render: kontras terburuk 4,67:1 (batas AA 4,5:1) di
  1440x900 dan 390x844.
- `README.md` mencatat klasifikasi raster vs vektor: foto rig terpasang, hero banner belum punya aset
  yang benar (`hero-derrick.jpg` isinya sunset), `tool-mwd.jpg` bukan MWD melainkan drill collar,
  `world-map.svg` belum dipasang.
- Logo perusahaan tidak disentuh. Aset resmi sudah ada di folder sumber, pemasangannya menunggu
  keputusan pemilik produk.

**Aksesibilitas terukur**
- Lonceng notifikasi: 34x37 px menjadi 44x44 px (tap target R-03). Badge dipindah ke sudut ikon.
- Input pencarian: tinggi 18 px menjadi 38 px di dalam wadah 40 px, jadi klik di seluruh kotak fokus.
- Tautan footer: 14 px menjadi 44 px di lebar <= 1180 px, dan baris footer ikut memanjang di sana.
- Tidak ada luapan horizontal di 1440, 1280, 1024, 768, dan 390 px; di 1440x900 dan 1280x752 halaman
  tetap tepat satu layar (`scrollHeight == innerHeight`).

**Verifikasi klik**
- Lima tab berpindah dan judul topbar ikut berubah; Enter pada tombol nav bekerja, Space pada lonceng bekerja.
- Pencarian "F-10" menyaring daftar 46 menjadi 3 aset; filter kelas A menyaring 46 menjadi 24; Reset kembali 46.
- Lonceng membuka tab Aksi; klik aset memindahkan `aria-current`; tautan footer menuju `index.html` dan `legacy_engines.html` yang ada.
- Konsol bersih (nol error) dan setiap elemen fokus memakai outline 2 px solid.

## 2026-11-01 - v2.1.0 - kulit baru dari DESIGN.md

**Halaman baru tanpa menghapus yang lama**
- `sperry.html` + `css/sperry.css` + `js/sperry.js`: lima tab yang sama (Operasi, Aset, Aksi,
  Keandalan, Model) dengan tema, gradien, sidebar, header, dan footer mengikuti `DESIGN.md`.
- `index.html` dan `legacy_engines.html` tetap ada. Ketiga halaman saling menaut.

**Tata letak**
- Layar penuh 1280x752 dan 1440x900: tiap tab mengisi tepat satu layar, tanpa gulir halaman dan
  tanpa kartu terpotong (diukur lewat DOM: `scrollWidth == innerWidth`, isi kartu <= tinggi kartu).
- Jendela pendek (tinggi < 720 px) dan lebar < 1180 px: halaman bergulir, kartu diberi tinggi minimum
  supaya isi tidak terpotong.
- Grafik digambar seukuran wadahnya. Sebelumnya kanvas dipatok 640 px lalu diskalakan, sehingga
  huruf sumbu mengecil sampai tidak terbaca di kartu 250 px.

**Data tambahan di payload**
- `models`: hasil model capstone (pooled persistence/row/window/rule, kurva PR, daftar fold) disalin
  apa adanya dari `data/pm_full.json`. Tab Model membacanya, tidak menghitung di JavaScript.
- `mtbf_trend`: MTBF per bulan berkejadian.

## 2026-11-01 - v2.0.0 - dashboard lapangan lima tab

**Halaman baru**
- `index.html` sekarang dashboard lapangan: Operasi, Aset, Aksi, Keandalan, Model. Dashboard lama
  dipindah ke `legacy_engines.html` tanpa diubah.
- Saringan satu baris (sumur, jenis aset, status, kritikalitas) berlaku untuk semua tab. Tab bisa
  ditautkan langsung lewat `#aset`, `#aksi`, `#keandalan`, `#model`.
- Strip lima pertanyaan di bawah KPI: kondisi sekarang, aset berisiko, kapan, komponen apa,
  tindakan apa. Tiap kotak membuka tab yang menjawabnya.

**Payload baru**
- `code/plant_build.py` membangun `data/plant.json` (~830 KB) dan `data/plant.js`. Isinya 46 aset,
  239 work order, 26 alert, 12 penyimpangan SPC, 13 masalah kronis, 20 kurva degradasi, heatmap
  46 aset x 24 jam, dan seksi keandalan per komponen.
- Dua kali run menghasilkan sha256 identik (seed 20260511, tanpa cap waktu di payload; cap waktu
  pindah ke `data/plant.built.txt`).

**Perbaikan yang muncul saat audit**
- Satuan bercampur di sumber: SPPA ditulis bar dan kPa, TRPM dalam 0,1 rpm. Tanpa pembersihan,
  ambang warning tekanan menjadi 21.006 bar. Sekarang dikonversi dan disaring ke rentang fisik;
  jumlah konversi dan pembuangan tercatat di `meta.data_fixes`.
- Nama sumur diseragamkan (`F_14`, `F-14`, `F 14` menjadi satu). Sebelumnya satu sumur terpecah
  menjadi beberapa aset.
- OEE sempat nol karena bulan 2015 tidak punya telemetri. OEE sekarang hanya dihitung pada bulan
  dengan jendela pengeboran minimal 200 jam, dan bulan kosong tidak digambar.
- RUL sempat menjadi 2% dari umur untuk semua aset karena `eta` dinaikkan ke `age * 1,02`.
  Sekarang memakai MTBF aset, umur dalam jam operasi, dan `overdue_mtbf` ditandai terpisah.
- Status kritis sempat menempel pada 39 aset karena RUL nol dipakai sebagai penentu tunggal.
  Sekarang status mengikuti probabilitas dan simpangan kanal, dengan ambang mengikuti sebaran data
  lapangan (probabilitas 7 hari tertinggi 0,24).
- Tren sensor disatukan pada satu sumbu sehingga getaran tampak datar; sekarang satu grafik per
  parameter dengan skala sendiri.
- Kartu grid tidak menyusut sehingga tabel lebar mendorong kartu keluar layar; ditambahkan
  `min-width: 0` pada anak grid.
- Banner kesegaran data: telemetri berhenti 16 Juli 2009, 2.219 hari sebelum tanggal acuan.
- Work order dari kejadian nyata sebelumnya tidak punya rujukan aset, sehingga riwayat per aset
  kosong. Sekarang dipetakan lewat sumur dan komponen, atau jenis untuk aset permukaan.


## 2026-11-01 - v1.2.0 - navigasi tiga tab dan payload terpadu

**Navigasi**
- Halaman dipecah menjadi tiga tab: Ringkasan, Sumur, Engine. Tab memakai `role="tablist"`, atribut
  `aria-selected`, dan `aria-controls`, serta bisa dipindah dengan tombol panah saat fokus di baris tab.
- Tab Sumur menampilkan daftar sembilan sumur. Satu sumur diklik, kolom kanan berganti menjadi KPI
  sumur, batang AUPRC tiap engine di sumur itu, dan rincian model per engine.
- Tab Engine menampilkan daftar sepuluh engine. Satu engine diklik, kolom kanan berganti menjadi KPI
  engine, batang AUPRC tiap sumur, perbandingan median lawan nilai tertinggi per model, dan daftar head
  beserta tier serta batas pemakaian.
- Ringkasan tetap seperti v1.1.0, hanya sumber datanya pindah ke `data/pm_full.json` kunci `overview`.

**Payload**
- `code/exporter_full.py` menggabungkan hasil hitung ulang dengan artefak run capstone menjadi
  `data/pm_full.json` (528 KB) berisi `meta`, `overview`, `engines`, dan `wells`. Tidak ada metrik yang
  dihitung ulang di tahap ini, semuanya dibaca dari berkas hasil.
- Agregat per engine ditambahkan: `model_ranges` (min, median, max, n per model), `rf_range`,
  `n_test_total`, `n_pos_total`, dan `underpowered_folds`.

**Perbaikan tampilan hasil audit**
- Label nama batang tidak lagi dipotong elipsis. Sebelumnya kolom nama 108 px dengan `nowrap` membuat
  "Shock, bit bounce" tidak terbaca; sekarang nama membungkus dan kolomnya 120 px.
- Jalur batang dibuat lebih terang dari permukaan kartu supaya sisa panjang masih terlihat saat nilainya
  kecil.
- Legenda mutu AUPRC dicetak di kartu yang memakai warna hijau, kuning, dan merah. Warna batang pada
  kartu perbandingan model diganti jadi biru dan ungu agar tidak berbenturan arti dengan skala mutu.
- Tile yang isinya cuma mengulang badge (misalnya jumlah head) hanya ditampilkan saat engine tidak punya
  metrik lain. Tile "fold kurang tenaga" hanya muncul kalau jumlahnya lebih dari nol, dan statusnya
  dipindah ke kalimat penjelas.
- Engine tanpa fold diberi label "tanpa AUPRC" di daftar, dan kartunya menjelaskan bahwa angkanya
  berhenti di tingkat head.

**Verifikasi**
- Empat lebar layar (1440, 1024, 768, 390) pada dua tab: tidak ada luapan halaman, tidak ada luapan di
  dalam kartu, tidak ada kartu kosong.
- `node --check js/app.js` bersih, tanpa em-dash di `index.html`, `css/app.css`, dan `js/app.js`.
- Tab Ringkasan tetap 11 KPI, 9 kartu, dan 5 grafik.

## 2026-11-01 - v1.1.0 - dua set fitur dan perbaikan grafik

**Mesin**
- Dua set fitur diuji pada fold yang sama: `row` (12 kolom `last_*`) dan `window`
  (12 kanal x 5 statistik jendela, 60 kolom). Mesin utama untuk seri waktu, timeline, dan SHAP
  adalah `window`.
- Pembanding persistence dan rule z-score tetap pada fold identik, ambang rule dari q95 fold latihan.
- Payload turun dari 3,5 MB ke 418 KB karena pemilihan titik grafik berubah: awal, puncak, dan akhir
  tiap run dipertahankan, sisanya sampel seragam.

**Grafik**
- Sumbu X grafik skor sekarang dipetakan menurut waktu, bukan indeks titik. Sebelumnya label tanggal
  berulang delapan kali pada satu fold.
- Skala Y mengikuti puncak skor dan ambang, tidak lagi dipaksa 0 sampai 1.
- Saat seri disampel, skor digambar sebagai titik, bukan garis, supaya tidak terlihat ada transisi
  yang tidak pernah terukur.
- Pita alert jadi lajur tipis di dasar plot, garis ambang dipindah ke warna kuning dan labelnya ke
  kiri, jadi tetap terbaca.
- Grafik kepadatan diperbesar dan grid kartu memakai lantai 460 px supaya label sumbu terbaca.
- Ubin mutu per sumur disusun dua kolom di dalam kartu.

**Hasil run terakhir (jujur, apa adanya)**
- `window` PR-AUC 0,091, recall 79,2 persen, presisi 7,5 persen.
- `row` PR-AUC 0,085, recall 23,1 persen.
- `persistence` PR-AUC 0,258, recall 47,1 persen.
- `rule` PR-AUC 0,057, recall 4,3 persen.
- Kesimpulan yang ditampilkan di dashboard: baseline naif persistence belum terlewati oleh model.

## 2026-11-01 - v1.0.0 - build pertama

- Migrasi kontrak model `code/25_rf_raw_lowo.py` menjadi exporter mandiri.
- Payload tunggal `data/pm_data.json` plus cermin `data/pm_data.js` untuk mode `file://`.
- Sembilan kartu: timeline, garis dengan ambang, kepadatan skor, perbandingan mesin, SHAP area,
  peringkat SHAP, kurva PR, kotak konfusi, ubin mutu per sumur.
- Popover penjelas pada setiap elemen visual.
- `serve.py` dengan `Cache-Control: no-store` supaya perbaikan langsung terlihat saat muat ulang.
