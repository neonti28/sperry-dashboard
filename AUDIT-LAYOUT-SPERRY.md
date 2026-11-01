# Audit Layout Sperry: Status P-01 s.d. P-17

Berkas: `sperry.html`, `css/sperry.css`, `js/sperry.js`, `js/plantcharts.js`
Acuan: `C:\Users\lenovo\Downloads\PANDUAN-PERBAIKAN-LAYOUT-SPERRY.md`
Tanggal uji: 1 November 2026 · Chromium (Playwright/CDP), 14 ukuran layar x 5 tab = 70 kombinasi
Aset diuji: `sperry.css?v=78`, `sperry.js?v=78`, `plantcharts.js?v=78` dengan cache peramban dimatikan

## 1. Hasil kriteria otomatis (bagian 12.1)

| Metrik | Hasil |
|---|---|
| Gulir horizontal halaman (`docOverflowX`) | 0 pada 70/70 kombinasi |
| Kartu lebih sempit dari 120 px | 0 |
| Isi kartu terpotong (overflow hidden + isi lebih tinggi) | 0 |
| Label SVG keluar bingkai | 0 |
| Label SVG bertabrakan | 0 |
| Teks terpotong (scrollWidth > clientWidth tanpa gulir) | 0 |
| `undefined` / `NaN` di layar | 0 / 0 |
| Galat JavaScript | 0 |

Ukuran yang diuji: 1920x1080, 1600x900, 1440x900, 1366x768, 1280x720, 1180x820, 1024x768, 900x800, 820x1180, 768x1024, 430x932, 390x844, 360x800, 320x640.

## 2. Status per temuan

| ID | Temuan | Status | Bukti |
|---|---|---|---|
| P-01 | Grafik menembus batas atas | SELESAI | `niceTicks` (plantcharts.js:58) menaikkan tick teratas di atas nilai maksimum; jarak puncak ke tepi atas terukur 3–47 px di semua grafik berporos |
| P-02 | Warna `var(--warn/accent/bad/line-2)` tidak terdefinisi | SELESAI | alias didefinisikan di sperry.css:828–831; `stroke` terhitung hanya `rgb(232,23,37)` dan `rgb(251,182,50)`, hitam 0 |
| P-03 | Empat anak KPI bertumpuk di grid 3 kolom | SELESAI | `.kpi` kini 3 kolom x 2 baris dengan `grid-template-areas` (sperry.css); posisi terukur 1280px: tile (15,16) lab (85,13) val (85,41) trend (339,25); 390px: trend turun ke baris 3, tanpa potong |
| P-04 | Kartu 30 px di 1024/768 karena `style` inline | SELESAI | penempatan grid lewat kelas; kartu tersempit 300 px (320px viewport), 793 px (ultrawide) |
| P-05 | Tinggi baris dipatok 170/200/330/340 px | SELESAI | `grid-template-rows: none` pada view dan baris (sperry.css:266–288, 555–560); isi kartu terpotong 0 |
| P-06 | Dropdown pemilih kanal memakan 135 px | SELESAI | `.card:not(.hero)` memakai `auto minmax(0,1fr) auto` (sperry.css:665); tidak ada `card-body` terpotong di 70 kombinasi |
| P-07 | Kolom kanan tabel hilang | SELESAI | `.card-body` `overflow: auto` + `thead th` sticky (sperry.css:744); `card-body.x` untuk tabel lebar; tidak ada tabel terpotong tanpa gulir |
| P-08 | Subjudul topbar menimpa garis | SELESAI | topbar 1024/1280 diukur ulang: subjudul tidak melampaui tinggi topbar; di ≤520 px disembunyikan |
| P-09 | Panel "Cakupan data" terpotong di 1280x720 | SELESAI | `.side-panel { overflow-y: auto }`; terukur `overflowY: auto`, isi 246 px dalam 116 px dapat digulir |
| P-10 | Footer pecah, halaman bergeser di 390 px | SELESAI | `docOverflowX` 0 di 390 dan 360 px; tautan footer jadi tap target 44 px di layar sentuh |
| P-11 | Label SHAP terpotong kiri | SELESAI | padding kiri `pad.l` dihitung dari label; label SVG keluar bingkai 0 di 70 kombinasi |
| P-12 | KPI kelima sendirian di baris dua | SELESAI | `.kpis.five` 3+2 (lebar 549/829 px pada 1920); empat KPI jadi 2x2 lewat `:has(> .kpi:nth-child(4):last-child)` |
| P-13 | Histogram batang 1,5 px | SELESAI | bin digabung `Math.ceil(bins/8)` (sperry.js:986) |
| P-14 | Gulir/dropdown/fokus hilang saat resize | SELESAI (sebagian tidak dapat diuji) | resize tidak lagi memanggil `render()` penuh, hanya `drawCurrent()`; `render()` menyimpan lalu memulihkan gulir, nilai select, dan fokus (`snapUI`/`restoreUI`). Terukur pada aset v=78: layar lebar `.main` 260 px bertahan menjadi 291 px sesudah render, layar sempit gulir jendela 400 px bertahan, nilai select F-14 bertahan di kedua kasus, galat JS 0. Tidak dapat diuji: pemulihan posisi saat ambang lebar terlewati (1441 px ke 1180 px), karena lingkungan uji tidak memicu event `resize` asli dan tidak menyala-kan event `scroll` untuk gulir terprogram, sehingga angka tidak bisa dinyatakan |
| P-15 | Urutan DOM tab Aksi beda dengan visual | SELESAI | urutan kartu disamakan; pembacaan layar mengikuti urutan visual |
| P-16 | Label filter terpisah dari dropdown | SELESAI | `.filters` mengelompokkan label+dropdown dalam satu wadah flex |
| P-17 | 390 px: jam jadi kolom 5 baris, sidebar penuh satu layar | SELESAI | topbar jadi dua baris (tinggi 173 px -> 152 px), jam selebar 103 px satu baris; lencana notifikasi di sudut ikon, tidak menimpa |

## 3. Kriteria visual (bagian 12.2)

| Butir | Hasil |
|---|---|
| 1. Tidak ada teks menimpa teks | 0 tabrakan label SVG di 70 kombinasi; KPI terpisah per area grid |
| 2. Grafik penuh di bingkai, puncak tidak menyentuh tepi atas | jarak 3–47 px. Pengecualian sah: peta anomali (heatmap) tanpa poros, sel memang mengisi penuh bingkai |
| 3. Tidak ada kartu kosong >40% | diukur lewat tinggi isi vs kartu pada tab Aksi/Aset; tidak ada kartu dengan sisa ruang ekstrem setelah tinggi baris dilepas |
| 4. Garis ambang berwarna | `stroke` terhitung hanya merah `rgb(232,23,37)` dan kuning `rgb(251,182,50)`; hitam 0 |
| 5. Kolom prioritas tabel penuh | tabel punya `overflow-x` + header sticky; kolom prioritas ada di sisi kiri |
| 6. 320 px (zoom 400%) | `docOverflowX` 0, kartu 300 px satu kolom, teks 13 px |
| 7. 3440x1440 | `.main` dibatasi `max-width: 2200px`, kartu 793 px (sebelumnya 3200 px) |

## 4. Catatan

- Pemeriksaan warna dan tangkapan layar dilakukan manual pada beberapa titik; model pemeriksa gambar sempat kehabisan kuota, jadi butir visual yang tidak bisa diotomatisasi (mis. "kartu terasa kosong") diverifikasi lewat ukuran DOM, bukan lewat mata pada semua tab.
- Lingkungan uji (Chromium headless lewat CDP) tidak memicu event `resize` untuk perubahan ukuran emulasi dan tidak menyala-kan event `scroll` untuk gulir terprogram. Karena itu perilaku yang bergantung pada dua event tersebut diuji lewat jalur yang setara (render ulang setelah mengubah filter), bukan lewat perubahan ukuran jendela sungguhan.
- Salinan proyek sebelum perubahan: `/mnt/d/Download/predictive-maintenance-backup-20261101-174750`.
