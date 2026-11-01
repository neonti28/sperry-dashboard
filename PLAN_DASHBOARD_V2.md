# PLAN: Dashboard Plant Head + Fleet Predictive Maintenance (v2)

> **SUPERSEDED 2026-11-01.** Rencana ini mengandaikan pabrik generik dengan data hampir seluruhnya
> sintetis. Setelah isi folder capstone diperiksa, ditemukan 884 event nyata, 239 kanal WITSML nyata,
> dan 7 engine nyata. Pakai `PLAN_DASHBOARD_V3.md`.

**Status:** rencana saja, belum ada yang dibangun.
**Target berkas kerja:** `/mnt/d/Download/predictive maintenance/`
**Tanggal rencana:** 2026-11-01

---

## 1. Tujuan

Membuat satu dashboard mandiri yang meniru cara Plant Head membaca pabrik pada satu shift, lalu
menambahkan lapisan fleet predictive maintenance yang jauh lebih dalam daripada versi sekarang.

Versi sekarang punya: tab Ringkasan, Sumur, Engine, semuanya tentang model capstone Volve.
Versi yang diminta menambahkan:

1. **Tab Dashboard** dengan kartu plant-level seperti contoh: Plant Health Index, Due-Now, Open
   Actions, Open Exceptions, Open Chronic, Plan Adherence, OEE, Production & Quality Snapshot, Top
   Drivers, Next Governed Actions, AI Advisory, Active Watch Areas, Chronic Trend, Control Loop
   Health, footer status sistem.
2. **Dropdown filter**: pabrik/line, shift, tanggal, tipe mesin, kelas risiko. Semua kartu ikut
   berubah saat filter diganti.
3. **Grup kartu fleet**: total machine, healthy, warning, critical, predicted failure, maintenance
   due, machine availability, OEE.
4. **Per mesin**: suhu, getaran, failure probability, RUL, anomaly score, jenis kerusakan yang
   diprediksi, risk classification, prediction confidence, root cause, detection method,
   recommended action.
5. **Keandalan**: MTBF, MTTR, availability, downtime, failure rate, estimasi biaya maintenance.

**Definisi selesai:** dashboard bisa dibuka lewat `python3 serve.py`, semua angka berasal dari satu
payload hasil skrip Python dengan seed tetap, dan menjalankan ulang skrip menghasilkan berkas yang
identik byte-per-byte (sha256 sama).

---

## 2. Kondisi sekarang (fakta, bukan asumsi)

| Item | Status |
|---|---|
| `index.html` | 3 tab: Ringkasan, Sumur, Engine. 193 baris. |
| `js/app.js` | 810 baris, render kartu + logika tab + filter sumur/engine. |
| `js/charts.js` | primitif SVG: garis, area, timeline, area bertumpuk, kurva PR. |
| `css/app.css` | 505 baris, token warna gelap, sudah responsif 4 lebar. |
| `code/exporter.py` | hitung ulang LOWO 4 mesin + SHAP, 651 detik. |
| `code/exporter_full.py` | gabung hasil run capstone jadi `data/pm_full.json` (528 KB). |
| Data capstone | hanya dipakai lewat `data/pm_full.json` yang sudah ada. Tidak ada penulisan ke folder capstone. |
| Server | `serve.py` di 127.0.0.1:8099 dengan `Cache-Control: no-store`. |

Yang **tidak** ada dan harus dibuat: seluruh data plant, mesin, telemetri, aksi, exception, chronic,
keandalan, biaya.

---

## 3. Anchor riset (kenapa angka yang dipalsukan tetap bisa dipertanggungjawabkan)

Semua karakter data diambil dari literatur, bukan dikarang bebas. Tabel ini jadi lampiran wajib di
`DOCS/PROVENANCE.md` dan ditampilkan di footer dashboard.

| Parameter | Nilai yang dipakai | Sumber |
|---|---|---|
| OEE world class | 85 persen, komposisi 90 A x 95 P x 99,9 Q | benchmark Nakajima/TPM, diringkas di fabriko.io dan tractian.com |
| OEE rata-rata industri | sekitar 60 persen, di bawah 40 persen dianggap merah | fabriko.io |
| Zona getaran ISO 20816-3 grup 1 (mesin >300 kW) | A <2,3 / B 2,3-4,5 / C 4,5-7,1 / D >7,1 mm/s RMS | vibromera.eu tabel A.1, fabriko.io |
| Zona getaran ISO 20816-3 grup 2 (15-300 kW) | A <1,4 / B 1,4-2,8 / C 2,8-4,5 / D >4,5 mm/s RMS | vibromera.eu tabel A.2 |
| MTBF pompa sentrifugal kilang | 3 sampai 10 tahun, contoh terkelola 7,7 tahun | Heinz Bloch, diringkas reliamag.com |
| MTBF pompa proses ANSI B73.1 | rata-rata 2,5 tahun, target 3,75, bagus 4,5, buruk 1,5-2,0 | Budris via reliamag.com |
| Bentuk Weibull beta bantalan gelinding | 1,5 sampai 3,5 (fatigue, kontaminasi, wear-out) | ifactoryapp.com tabel beta, firgelli.com |
| Kontribusi mode kegagalan | bantalan 40-70 persen kegagalan mesin rotasi; seal + bantalan sekitar 70 persen downtime pompa | Atmaji 2025 (ScienceDirect), f7i.ai |
| Batas suhu belitan motor kelas F | maksimum 155 C, alarm disetel 10-15 C di bawahnya | industrialmonitordirect.com, oxmaint.com |
| Batas suhu bantalan | alarm sekitar 105 C untuk batas kelas 130 C | yeslon.com |
| Biaya downtime tak terencana | median lintas sektor sekitar 125 ribu USD per jam; food & beverage sekitar 85 ribu; light assembly 5 ribu | SeQent, Xurrent, oxmaint |
| Aturan SPC | 8 aturan Western Electric (1 titik di luar batas, 9 titik satu sisi, 6 tren, dan seterusnya) | Wikipedia Western Electric rules, sigmadesk.app |
| Konsep P-F interval | jarak antara gejala terdeteksi dan kegagalan fungsi, makin dini terdeteksi makin panjang jendela | ifactoryapp.com, prismecs.com |
| Bad actor / chronic | aset dengan kegagalan berulang, bukan sporadis | reliabilityweb.com, f7i.ai |

Catatan kejujuran: nomor-nomor di atas adalah **batas dan bentuk distribusi**, bukan angka pabrik
nyata. Semua angka yang tampil di dashboard tetap berasal dari simulasi, dan itu dinyatakan di layar.

---

## 4. Prinsip yang tidak boleh dilanggar

1. **Satu jalur data.** `code/plant_sim.py` (baru) menghasilkan `data/plant.json` + `data/plant.js`.
   JS hanya membaca dan menggambar. Tidak ada satu pun metrik yang dihitung di JS.
2. **Seed tetap dan tercatat.** `numpy.random.default_rng(20260511)`. Seed ditampilkan di footer.
   Menjalankan ulang skrip harus menghasilkan sha256 identik.
3. **Label sintetis terlihat.** Banner di atas dashboard: "Data sintetis untuk demo, seed 20260511,
   karakter parameter dari ISO 20816-3, benchmark OEE Nakajima, Weibull beta bantalan 1,5-3,5".
   Tanpa banner ini dashboard berpotensi disalahartikan sebagai data asli.
4. **Konsistensi internal dijaga oleh konstruksi, bukan oleh tangan.** Contoh: jumlah mesin healthy
   + warning + critical harus sama dengan total mesin, karena keduanya dihitung dari daftar mesin
   yang sama. OEE dihitung dari event downtime, bukan ditulis langsung.
5. **Tidak menyentuh folder capstone.** Semua di dalam `/mnt/d/Download/predictive maintenance/`.
6. **Tanpa em-dash** di seluruh berkas hasil.

---

## 5. Model data simulasi

### 5.1 Entitas

| Entitas | Jumlah | Keterangan |
|---|---|---|
| Plant | 1 | Bandapuram Plant, 3 line produksi |
| Line | 3 | Line A, Line B, Line C |
| Machine | 24 | 8 per line, campuran pompa, kompresor, conveyor drive, gearbox, fan, agitator |
| Component | 2-4 per mesin | motor, bantalan DE/NDE, seal, gearbox, belt |
| Sensor channel | 5 per mesin | vibration RMS (mm/s), bearing temp (C), winding temp (C), current (A), speed (rpm) |
| Telemetri | 24 mesin x 90 hari x 24 jam | agregat per jam, bukan per detik, supaya payload wajar |
| Failure event | sekitar 180 dalam 24 bulan | waktu, komponen, mode, downtime menit, biaya, deteksi |
| Maintenance action | sekitar 400 | status, prioritas, due date, owner, source (PM, CM, PdM) |
| Exception | sekitar 90 | penyimpangan proses, severity, status, umur |
| Chronic issue | sekitar 26 | masalah berulang, severity S1-S4, recurrence count |
| SPC parameter | 6 parameter proses | moisture, throughput, pressure, temperature, viscosity, particle size |

### 5.2 Karakter tiap kanal (dipakai di generator)

| Kanal | Bentuk | Parameter | Dasar |
|---|---|---|---|
| Vibration RMS | baseline per mesin + tren degradasi + noise | baseline 1,1-2,6 mm/s, naik linear ke 4,5-11 mm/s dalam 3-21 hari sebelum failure | zona ISO 20816-3 grup 1 dan 2 |
| Bearing temp | 45-70 C normal, naik 8-25 C saat degradasi | AR(1) harian + offset degradasi | alarm 105 C |
| Winding temp | ambient + 40-60 C, plafon 130 C | AR(1) + beban per jam | kelas F 155 C, alarm 125-130 C |
| Current | mengikuti beban, lonjakan 5-15 persen saat gesekan | korelasi dengan vibration | umum |
| Speed | nominal +-1 persen, turun saat beban berat | sinus harian | umum |
| TTF (waktu antar kegagalan) | Weibull beta 1,6-2,8 per komponen, eta sesuai MTBF target | bantalan eta 26.000 jam, seal 18.000, motor 60.000 | beta bantalan 1,5-3,5, MTBF pompa 3-10 tahun |
| Waktu perbaikan | lognormal, median 3,5 jam, sigma 0,6 | MTTR agregat 4-6 jam | benchmark umum |
| Downtime per kejadian | mengikuti mode: bantalan 6-14 jam, seal 3-8, motor 8-20 |  | proporsi downtime seal+bantalan dominan |
| Biaya per kejadian | komponen + jam kerja + produksi hilang | lihat 5.3 | benchmark downtime 5-125 ribu USD per jam |

### 5.3 Biaya

```
biaya_komponen   = tabel per komponen (bantalan 1.200, seal 800, motor 9.500, gearbox 14.000 USD)
biaya_tenaga     = jam_kerja x 65 USD
biaya_produksi   = downtime_jam x tarif_line (Line A 18.000, Line B 12.000, Line C 9.000 USD/jam)
total            = jumlah ketiganya
```
Tarif per line dipilih di dalam rentang benchmark (light assembly 5 ribu sampai food 85 ribu per jam),
disesuaikan skala pabrik menengah, dan dinyatakan sebagai asumsi.

### 5.4 Status mesin dan kelas risiko

```
critical  : failure_probability >= 0,70 atau RUL <= 7 hari atau vibration di zona D
warning   : 0,35 <= failure_probability < 0,70 atau RUL 7-30 hari atau zona C
healthy   : sisanya
risk_class: A (critical, dampak produksi besar), B, C
```

### 5.5 Model prediksi per mesin (bukan kotak hitam, bisa diperiksa)

| Keluaran | Cara membangkitkan |
|---|---|
| failure_probability | fungsi logistik dari (z_vibration, z_temp, umur relatif komponen, sisa RUL) + noise; dikalibrasi supaya Brier score agregat di bawah 0,15 |
| remaining_useful_life | `eta_komponen - umur_pakai` dikali faktor kondisi, dilaporkan dalam hari + interval keyakinan |
| anomaly_score | jarak Mahalanobis dari 5 kanal terhadap baseline 30 hari, diskalakan 0-100 |
| predicted_failure_mode | sampel kategorikal dengan bobot literatur: bantalan 42 persen, misalignment 16, imbalance 12, seal 14, kelistrikan motor 9, pelumasan 7 |
| root_cause | pemetaan dari mode + kanal dominan (contoh: vibration 1x RPM tinggi ke imbalance, 2x RPM ke misalignment, high frequency ke bantalan) |
| detection_method | aturan: anomaly detection, ISO zone crossing, SPC rule, threshold rule, model klasifikasi |
| recommended_action | pemetaan mode ke aksi (contoh: bantalan ke "ganti bantalan DE, cek alignment", seal ke "inspeksi seal, cek flush plan") |
| prediction_confidence | 1 - lebar relatif interval, dipotong 0,55-0,97 |

Semua pemetaan ditulis sebagai tabel konstanta di skrip, jadi bisa dibaca dan diubah.

---

## 6. Rumus yang dipakai (dihitung di Python, ditampilkan di kartu)

```
OEE            = availability x performance x quality
availability   = (planned_time - downtime) / planned_time
performance    = (actual_output / ideal_output)
quality        = good_units / total_units        (reject = 1 - quality)
MTBF           = total_operating_hours / failure_count
MTTR           = total_repair_hours / repair_count
availability_r = MTBF / (MTBF + MTTR)
failure_rate   = failure_count / total_operating_hours  (per 1.000 jam)
plan_adherence = task_selesai_tepat_waktu / task_jatuh_tempo
```

**Plant Health Index 0-100** (bobot eksplisit, ditampilkan di tooltip kartu):

```
health = 100 x (0,28 x norm_availability
              + 0,22 x norm_oee
              + 0,18 x norm_quality
              + 0,16 x norm_action_closure
              + 0,10 x norm_exception_closure
              + 0,06 x norm_chronic_control)
```
Pita: 85-100 Excellent, 70-84 Good, 55-69 Watch, di bawah 55 Critical.

**Control Loop Health** memakai empat skor yang diturunkan dari timestamp, bukan angka hiasan:

```
Detection       : median jeda gejala ke tiket dibuat
Standardization : rasio tiket yang punya prosedur + owner + due date
Response        : median jeda tiket dibuat ke mulai dikerjakan
Closure         : rasio tiket ditutup sebelum due date
```

**Top Drivers**: dekomposisi delta harian. OEE bersifat multiplikatif, jadi dipakai dekomposisi
log: `ln(OEE) = ln(A) + ln(P) + ln(Q)`, kontribusi tiap komponen = delta masing-masing terhadap
kemarin. Untuk Yield dipakai delta langsung. Hasilnya satu tabel penyebab dengan angka persen yang
bisa dijumlahkan kembali ke delta total.

---

## 7. Struktur halaman

### 7.1 Navigasi

Dua kelompok tab, dipisah garis:

```
[ Dashboard ] [ Mesin ] [ Aksi ] [ Keandalan ]   <- plant sintetis
[ Ringkasan ] [ Sumur ] [ Engine ]                <- model capstone (tetap)
```

Alasan dipisah: dua-duanya beda sumber data dan beda tingkat kepercayaan. Mencampur akan membuat
pembaca mengira metrik plant punya dasar yang sama dengan metrik Volve.

### 7.2 Baris filter (dropdown, sticky di bawah tab)

| Dropdown | Nilai awal | Efek |
|---|---|---|
| Plant | Bandapuram Plant | satu-satunya pilihan sekarang, disiapkan untuk multi-plant |
| Line | Semua line | memfilter mesin, telemetri, aksi, KPI |
| Shift | Shift A | memfilter jendela waktu snapshot 06:00-14:00 |
| Tanggal | 11 Mei 2026 | memfilter snapshot dan tren harian |
| Tipe mesin | Semua | memfilter daftar mesin dan distribusi |
| Kelas risiko | Semua | A, B, C, critical, warning |
| Jendela tren | 7 hari | 7 / 30 / 90 hari untuk grafik tren |

Filter disimpan di URL hash (`#tab=dashboard&line=B&shift=A`) supaya bisa dibagikan dan di-refresh
tanpa kehilangan pilihan. Semua kombinasi dihitung dari payload yang sama, tidak ada permintaan
jaringan baru.

### 7.3 Tab Dashboard (meniru contoh, diisi data simulasi)

**Baris 1, tujuh kartu besar**

| Kartu | Isi | Turunan |
|---|---|---|
| Plant Health Index | angka 0-100 + pita + delta harian | rumus 6 |
| Due-Now | total jatuh tempo, pecahan telat dan hari ini | maintenance action |
| Open Actions | total terbuka, jumlah prioritas tinggi | maintenance action |
| Open Exceptions | total terbuka, jumlah kritis | exception |
| Open Chronic | total kronis, jumlah S3/S4 | chronic |
| Plan Adherence | persen + target + delta | maintenance action |
| OEE | persen rata-rata 7 hari + delta | downtime event |

**Baris 2, bagian tengah**

- **Production & Quality Snapshot**: grafik garis 3 seri (OEE, Yield, Reject) per jam 06:00-14:00,
  plus baris angka di bawah grafik.
- **Top Drivers**: batang horizontal penyebab yang menekan KPI hari itu, dengan nilai delta persen.
  Dihitung dengan dekomposisi log di bagian 6, jadi angka bisa dijumlahkan.

**Kolom kanan**

- **Next Governed Actions**: 6 tindakan berurutan prioritas Critical sampai Medium, tiap baris punya
  tombol "Open Action" yang membuka detail di tab Aksi.
- **AI Leadership Advisory**: 1 sampai 3 saran, tiap saran menyebut keyakinan persen dan dasar
  (kanal mana yang bergerak, berapa lama). Saran dibangkitkan dari aturan eksplisit, bukan model
  bahasa, supaya bisa direproduksi.

**Baris 3**

- **Active Watch Areas**: 4 area yang dipantau khusus, tiap area menyebut mesin, kanal, nilai
  sekarang, dan tren.
- **Chronic Trend**: donut 26 masalah kronis menurut severity (tinggi, sedang, rendah).
- **Control Loop Health**: empat bar Detection, Standardization, Response, Closure dengan label
  Good / Watch / At Risk.
- **Footer**: versi payload, seed, waktu generate, kualitas data (persen kanal yang lengkap),
  status sinyal per line, jumlah mesin terlambat kirim data.

### 7.4 Tab Mesin

**Grup kartu di atas**

| Kartu | Angka |
|---|---|
| Total Machine | 24 |
| Healthy Machine | hasil klasifikasi |
| Warning Machine | hasil klasifikasi |
| Critical Machine | hasil klasifikasi |
| Predicted Failure | mesin dengan failure_probability >= 0,50 |
| Maintenance Due | mesin dengan tiket jatuh tempo 7 hari |
| Machine Availability | persen fleet |
| OEE | persen fleet |

**Kartu grafik**

| Kartu | Bentuk |
|---|---|
| Machine Health Distribution | donut healthy / warning / critical |
| Machine Status Overview | bar bertumpuk per line (running, idle, maintenance, down) |
| Failure Prediction Trend | garis 90 hari: jumlah mesin critical dan jumlah prediksi kegagalan |
| Maintenance Activity | bar per minggu: PM, CM, PdM selesai dan terlambat |
| Top 5 Machines at Risk | bar horizontal dengan skor risiko, RUL, dan mode kegagalan |
| Live Snapshot per mesin terpilih | 5 sparkline: getaran, suhu bantalan, suhu belitan, arus, kecepatan |

**Daftar mesin (tabel, bisa diurutkan)**

Kolom: kode mesin, nama, line, tipe, status, risk class, failure probability, RUL hari, anomaly
score, getaran mm/s (zona ISO), suhu bantalan, mode kegagalan, confidence, MTBF, MTTR, availability,
downtime 30 hari, failure rate, biaya 12 bulan, aksi berikutnya.

**Panel detail mesin** (muncul saat satu baris diklik, tanpa pindah halaman)

- header: kode, nama, line, criticality, status
- 8 kotak angka: failure probability, RUL, anomaly score, confidence, MTBF, MTTR, availability, biaya
- grafik getaran 90 hari dengan pita zona ISO A/B/C/D
- grafik suhu dengan garis alarm
- tabel 5 kegagalan terakhir: waktu, komponen, mode, downtime, biaya, detection method
- root cause + recommended action + detection method dalam bentuk blok teks berlabel
- tindakan terbuka untuk mesin itu

### 7.5 Tab Aksi

Empat sub-tabel dengan filter status: Actions (412 gaya contoh, di sini jumlah hasil simulasi),
Exceptions, Chronic, Due-Now. Tiap baris punya prioritas, umur, owner, due date, mesin terkait.
Kartu ringkas di atas: overdue, due today, due this week, closed on time.

### 7.6 Tab Keandalan

- MTBF dan MTTR fleet per line (bar)
- Distribusi waktu antar kegagalan dengan kurva Weibull fit (garis + titik)
- Pareto mode kegagalan (bar + kumulatif)
- Heatmap jam x hari untuk downtime (kapan pabrik paling sering berhenti)
- Tabel 10 aset dengan biaya tertinggi (bad actor), lengkap dengan recurrence count
- Kurva P-F: contoh satu mesin, jarak deteksi ke kegagalan dalam hari

---

## 8. Berkas yang akan dibuat dan diubah

**Baru**

```
code/plant_sim.py            generator + semua perhitungan, seed 20260511
code/plant_export.py         validasi invarian lalu tulis data/plant.json + plant.js
DOCS/PROVENANCE.md           tabel anchor riset + asumsi + cara reproduksi
DOCS/SCHEMA.md               skema payload per kunci
tests/test_plant_sim.py      tes invarian dan reproduksi
js/plant.js                  render tab plant (dashboard, mesin, aksi, keandalan)
js/plant-filters.js          dropdown, state URL, penyaringan payload
data/plant.json              payload (perkiraan 400-700 KB)
data/plant.js                cermin untuk mode file://
```

**Diubah**

```
index.html                   tambah grup tab plant, baris filter, panel baru
css/app.css                  gaya dropdown, tabel, donut, gauge, heatmap, sparkline, badge risiko
js/charts.js                 tambah donut, gauge, sparkline, heatmap, pareto, control chart
README.md                    bagian cara jalan, sumber angka, batas pemakaian
CHANGELOG.md                 v2.0.0
```

**Tidak diubah:** `code/exporter.py`, `code/exporter_full.py`, `data/pm_full.json`. Tab capstone
tetap memakai payload lama, jadi tidak ada risiko merusak yang sudah jalan.

---

## 9. Urutan pengerjaan

Tiap langkah punya hasil yang bisa diperiksa sebelum lanjut.

| # | Langkah | Hasil yang bisa diperiksa | Perkiraan |
|---|---|---|---|
| 1 | `plant_sim.py` bagian data statis: plant, line, 24 mesin, komponen, tabel biaya, tabel mode kegagalan | cetak daftar mesin + tabel konstanta | 40 menit |
| 2 | Generator failure event 24 bulan dengan Weibull per komponen, + validasi MTBF hasil masuk rentang literatur | cetak MTBF per komponen vs target | 50 menit |
| 3 | Generator telemetri 90 hari x 24 jam per mesin, termasuk ramp degradasi sebelum tiap failure | cek visual 3 mesin: baseline datar, ramp terlihat, alarm menyala sebelum failure | 50 menit |
| 4 | Generator action, exception, chronic, SPC, dengan timestamp yang konsisten terhadap failure | cek: tidak ada aksi menutup kejadian yang belum terjadi | 40 menit |
| 5 | Hitung semua metrik: OEE, MTBF, MTTR, availability, downtime, failure rate, biaya, health index, control loop, top drivers | tabel metrik tercetak, cocok dengan rumus bagian 6 | 45 menit |
| 6 | `plant_export.py`: validasi invarian + tulis JSON dan JS | 8 invarian lulus, sha256 stabil pada dua kali jalan | 25 menit |
| 7 | Bangun kerangka UI: grup tab plant, baris dropdown, state URL | dropdown mengubah hash, tab berpindah tanpa error konsol | 40 menit |
| 8 | Tab Dashboard: 7 kartu + snapshot + top drivers + governed actions + advisory + watch + donut + control loop + footer | semua kartu terisi, angka cocok dengan cetakan langkah 5 | 70 menit |
| 9 | Tab Mesin: 8 kartu + 6 grafik + tabel + panel detail | satu mesin diklik, panel detail muncul lengkap 8 kotak | 70 menit |
| 10 | Tab Aksi dan Keandalan | empat sub-tabel, pareto, Weibull fit, heatmap | 60 menit |
| 11 | Primitif grafik baru di `charts.js` | tiap primitif dites dengan data contoh | 50 menit |
| 12 | Audit visual dan responsif 4 lebar, kontras, luapan | laporan cek, screenshot tiap tab | 40 menit |
| 13 | Dokumentasi: PROVENANCE, SCHEMA, README, CHANGELOG | bisa dibaca orang lain tanpa bertanya | 30 menit |

Total sekitar 11 jam kerja terfokus. Bisa dipecah ke kanban (5 kartu paralel: generator, UI
dashboard, UI mesin, UI aksi-keandalan, grafik-dokumentasi) kalau ingin lebih cepat, dengan syarat
langkah 1-6 selesai lebih dulu karena semua UI bergantung pada skema payload.

---

## 10. Verifikasi

**Reproduksi**
- jalankan `plant_sim.py` dua kali, bandingkan `sha256sum data/plant.json`. Harus identik.
- seed ditampilkan di footer dan di `meta.seed`.

**Invarian (dites di `tests/test_plant_sim.py`)**
1. healthy + warning + critical = total machine.
2. Jumlah mesin per line di kartu = jumlah mesin di payload line itu.
3. OEE = A x P x Q, toleransi 1e-6.
4. availability dari MTBF dan MTTR cocok dengan availability dari event downtime (beda < 0,5 persen).
5. Tidak ada failure event bertanggal setelah tanggal snapshot.
6. Tidak ada aksi dengan due date lebih awal dari tanggal dibuat.
7. Jumlah chronic di donut = jumlah chronic di tabel.
8. Setiap mesin critical punya minimal satu tindakan terbuka.
9. Seluruh angka persen berada di 0-100; probability di 0-1.
10. Tidak ada NaN atau null di field yang wajib.

**Kualitas prediksi (supaya angka probability tidak asal)**
- Brier score agregat < 0,15 dan calibration curve dilaporkan di tab Keandalan.
- RUL: median absolute error terhadap waktu kegagalan sebenarnya dilaporkan apa adanya.

**Tampilan**
- 4 lebar (1440, 1024, 768, 390): nol luapan halaman, nol luapan kartu, nol kartu kosong.
- Kontras teks minimal 3,0:1 untuk teks kecil.
- Mode `file://` tetap jalan lewat `data/plant.js`.
- `node --check` bersih, nol em-dash.

**Kejujuran**
- Banner sintetis terlihat di semua tab plant.
- Footer menyebut seed, waktu generate, dan versi payload.
- Metrik yang lemah (kalau Brier jelek atau kalibrasi melenceng) ditampilkan, tidak disembunyikan.

---

## 11. Risiko dan cara menanganinya

| Risiko | Dampak | Penanganan |
|---|---|---|
| Payload membengkak karena telemetri 24 mesin x 90 hari x 24 jam | halaman lambat | agregat per jam, titik dipilih untuk grafik (awal, puncak, akhir degradasi), target di bawah 800 KB |
| Angka simulasi terlihat nyata lalu disalahgunakan | risiko etika | banner sintetis + PROVENANCE + seed terlihat |
| Metrik saling bertentangan karena dibangkitkan terpisah | dashboard tidak masuk akal | semua metrik diturunkan dari satu event log, bukan angka terpisah |
| Waktu pengerjaan membengkak | tidak selesai | kerjakan langkah 1-8 dulu (dashboard + mesin), aksi dan keandalan menyusul |
| Tab capstone rusak karena perubahan `app.js` | kehilangan kerja lama | kode plant di berkas terpisah (`js/plant.js`), tab lama tidak disentuh selain penambahan markup |

---

## 12. Keputusan yang perlu Anda setujui sebelum saya mulai

1. **Objek pabrik.** Pakai pabrik fiktif "Bandapuram Plant" dengan 24 mesin di 3 line seperti contoh,
   atau pakai nama rig/instalasi yang terkait Volve supaya terasa satu dunia dengan capstone?
2. **Hubungan dengan tab lama.** Tab capstone (Ringkasan, Sumur, Engine) tetap ada di grup terpisah,
   atau disembunyikan di balik satu tombol "Model Riset" supaya dashboard plant terlihat bersih?
3. **Mata uang dan tarif downtime.** USD dengan tarif per line seperti bagian 5.3, atau IDR dengan
   tarif lokal?
4. **Cakupan waktu.** Snapshot satu shift (06:00-14:00, 11 Mei 2026) + riwayat 90 hari, atau riwayat
   12 bulan penuh untuk tren keandalan?
5. **Cara eksekusi.** Langsung saya kerjakan berurutan, atau dipecah ke kanban dengan beberapa worker
   paralel setelah skema payload selesai?
