# PLAN v3: Dashboard Sperry Drilling / Volve (satu dunia dengan capstone)

**Status:** rencana saja, belum dibangun. Menggantikan `PLAN_DASHBOARD_V2.md` (versi itu mengandaikan
pabrik generik, sekarang tidak dipakai).

**Revisi b (keputusan operator, mengikat):**
1. Waktu acuan 2015-08-13. Hari ini dianggap masih 2015. Tidak boleh ada informasi setelah tanggal itu
   yang masuk ke fitur mana pun. Prediksi berarti meramal ke depan dari titik itu.
2. Bandapuram adalah **contoh tata letak**, bukan nama lokasi dan bukan bagian produk. Nama yang
   dipakai adalah Volve Field, Sperry Drilling.
3. Tidak ada "tab capstone". Seluruh dashboard adalah satu produk capstone. Tab lama Ringkasan,
   Sumur, dan Engine adalah bagian dari produk yang sama, bukan kumpulan tab terpisah.
4. Peralatan permukaan ikut dibuat semua yang punya bukti di data, termasuk yang tidak punya kanal.
**Tanggal:** 2026-11-01
**Berkas kerja:** `/mnt/d/Download/predictive maintenance/`
**Sumber data capstone (izin eksplisit operator):** `/mnt/d/ARCT-9F2` (aktif), `/mnt/d/ARCT-4K7` (arsip).
Tidak ada penulisan ke kedua folder itu.

---

## 0. Ringkasan perubahan dari v2

v2 mengandaikan pabrik generik berisi 24 mesin pompa dan kompresor, dengan hampir semua data
dipalsukan. Setelah membaca isi capstone, asumsi itu salah arah, karena capstone **sudah punya**
data nyata yang jauh lebih kuat:

| Kebutuhan dashboard | Ternyata sudah ada data nyata | Keputusan |
|---|---|---|
| Daftar aset | 10 wellbore nyata + komponen BHA nyata di `labels_curated_v2.csv` | pakai nyata |
| Riwayat kegagalan | 884 event kurasi 2007-2015 | pakai nyata |
| MTBF / MTTR / downtime / failure rate | bisa dihitung dari 884 event | hitung nyata |
| Chronic / bad actor | 27 pasangan well-komponen dengan 3 atau lebih kejadian | pakai nyata |
| Getaran, suhu, stick-slip, shock, stuck | 239 kanal WITSML per well, termasuk VIBLAT_RT, SHKPK_RT, ATMP_RT, CRPM_RT, STUCK_RT | pakai nyata |
| Prediksi per engine | 7 engine, 27 head, tier, FAR, AUPRC sudah dihitung capstone | pakai nyata |
| Work order, exception, plan adherence, biaya | tidak ada | sintetis ber-seed, diberi label |
| Failure probability, RUL, anomaly score | belum ada sebagai angka per aset | diturunkan (Weibull dari event nyata + skor kanal nyata) |

Kesimpulan: dashboard ini kira-kira **70 persen data nyata, 30 persen lapisan operasional sintetis**.
Itu jauh lebih kuat daripada v2 yang hampir seluruhnya karangan, dan tetap memenuhi permintaan
"buat data random ber-seed kalau datanya tidak ada".

---

## 1. Tujuan

Membuat dashboard bertab yang meniru tata letak dashboard Plant Head (Bandapuram) tetapi seluruh
isinya bercerita tentang **Sperry Drilling, Halliburton** di lapangan Volve:

- satu baris kartu kondisi operasi (health index, due-now, open actions, open exceptions,
  open chronic, plan adherence, OEE analogi pengeboran)
- panel tengah: snapshot produksi dan mutu per jam, top drivers
- panel kanan: next governed actions, advisory
- baris bawah: watch areas, chronic donut, control loop health, footer status
- tab Mesin: kartu fleet (total, healthy, warning, critical, predicted failure, maintenance due,
  availability, OEE), distribusi, tren prediksi, aktivitas maintenance, top 5 at risk, tabel 20
  kolom, panel detail per aset
- tab Aksi, tab Keandalan, dan tab Model yang memuat evaluasi 7 engine (Ringkasan, Sumur, Engine
di versi sekarang menjadi isi tab Model, bukan tab terpisah)
- dropdown filter: lapangan, wellbore, shift, tanggal, tipe aset, kelas risiko, jendela tren

**Definisi selesai:** dashboard jalan di `python3 serve.py`, semua angka berasal dari satu payload
hasil skrip Python, lapisan sintetis diberi label di layar, dan menjalankan ulang skrip menghasilkan
sha256 identik.

---

## 2. Fakta data yang sudah diverifikasi (bukan asumsi)

Semua baris di bawah dibaca langsung dari folder capstone pada sesi ini.

| Berkas / folder | Isi terverifikasi |
|---|---|
| `data/predictive/dataset_prediktif.csv` | 198.927 baris, 73 kolom, 109,9 MB. 60 kolom = 12 kanal x 5 statistik (md, wob, spp, torque, rop, rpm, flow, mud_density, diameter, hookload, tvd, gamma) + label y_5/y_10/y_15/y_30 |
| `data/volve/labels_curated_v2.csv` | 884 event, 2007-09-15 sampai 2015-08-13, 10 wellbore |
| Distribusi kategori event | routine_no_failure_evidence 496, surface_rig_equipment 216, mixed_evidence 47, bha_stuck_fishing 38, failure_unlocated 28, wellbore_fluid 25, wireline_completion 21, bha_downhole_equipment 12, safety_personnel 1 |
| `bha_relevant` | yes 50, no 263, uncertain 571 |
| Komponen terisi | 254 baris: casing 64, sub 28, toolstring 22, tractor 18, perf_gun 11, mwd_lwd 7, shoe 7, liner 7, screen 6, tubing 6, packer 6, bit 5, drill_string 5 |
| Durasi event (act_start ke act_end) | 884 terisi, median 0,75 jam, p90 3,0 jam, total 1.225 jam |
| Kandidat chronic | 27 pasangan well-komponen dengan 3 atau lebih kejadian. Teratas: F-15 D casing 18, F-5 casing 16, F-15 D tractor 12, F-14 sub 11, F-5 sub 10, F-14 casing 10 |
| `data/volve/witsml_parsed/` | 10 wellbore + 1 varian, 239 kanal per berkas. F-14.csv 1.648.027 baris |
| Kanal penting yang ada | VIBLAT_RT (getaran), SHKPK_RT (puncak shock), SHKRSK_RT (risiko shock), STUCK_RT (stuck pipe), CRPM_RT (stick-slip), ATMP_RT dan ATMP_MWD (suhu anulus), SPPA, TFLO, SWOB, TRPM, RPM, TQA, HKLD |
| `data/witsml/Norway-NA-15_47_9-F-9 A time.csv` | 409 MB, 247 kanal time series satu well, termasuk 3 kanal suhu (MWD DNI, Temperature Out, Annular) dan shock |
| `data/USROP/` | 7 berkas, 12 kanal + turunan per baris: MSE, D_exp, ROC_coef, health_index, maintenance_recommendation |
| `scratch/v9_i1/v9_i1_RESULTS.json` | 7 engine, 27 head, registry tier dan layer, segmen |
| `scratch/v9_e_ml/v9_e_ML_*.json` | fold per well per model (rf, gb, lr) dengan AUPRC dan CI95 |
| `data/pm_full.json` (dashboard sekarang) | 528 KB, 10 entri engine, 6 di antaranya punya fold per well, 4 hanya catatan head |

Implikasi penting: **tidak perlu mengarang getaran dan suhu**. Keduanya ada, dengan resolusi baris
per detik sampai menit. Yang benar-benar tidak ada hanya sisi administrasi maintenance (work order,
exception, jadwal, biaya), dan itu memang wajar karena data publik tidak memuat CMMS.

---

## 3. Dunia yang dipakai (satu dunia dengan capstone)

```
Lapangan     : Volve, blok 15/9, Laut Utara Norwegia
Operator jasa: Halliburton Sperry Drilling
Peran        : Drilling Operations Supervisor (padanan Plant Head pada contoh Bandapuram)
Shift        : Shift A 06:00-14:00
Waktu acuan  : 13 Agustus 2015. Dashboard bersikap seolah hari ini tanggal itu
Aset         : 10 wellbore x rangkaian BHA + seluruh peralatan permukaan yang punya bukti di data
```

Pemetaan istilah dashboard pabrik ke konteks pengeboran:

| Istilah contoh | Padanan pengeboran | Dasar |
|---|---|---|
| OEE | D-OEE: availability rig x performance ROP terhadap rencana x quality lubang tanpa rework | analogi eksplisit, diberi label "analogi OEE" |
| Yield / Reject | meter berhasil / meter diulang (ream, sidetrack, plug back) | dari event dan kanal |
| Due-Now | job maintenance jatuh tempo hari ini | sintetis ber-seed |
| Open Actions | work order belum tutup | sintetis ber-seed |
| Open Exceptions | pelanggaran SPC pada kanal nyata | diturunkan dari data nyata |
| Open Chronic | pasangan well-komponen berulang | nyata |
| Plan Adherence | job selesai sebelum due date | sintetis ber-seed |
| Machine / mesin | aset: rangkaian BHA per well + peralatan permukaan (top drive, mud pump, shaker, MWD/LWD) | nyata sebagian |
| Failure mode | vib, ssi, shk, stuck, hyd, bit_wear, tool_wear | engine capstone nyata |

### 3.1 Aturan waktu: sekarang adalah 13 Agustus 2015

Dashboard tidak boleh tahu apa pun setelah 2015-08-13. Ini bukan hiasan, ini aturan yang diuji.

| Aturan | Konsekuensi teknis |
|---|---|
| Fitur hanya dari data sampai 2015-08-13 23:59 | agregasi, baseline, dan statistik kanal dipotong di tanggal itu |
| Fit Weibull hanya dari event sebelum tanggal itu | parameter tidak memakai kegagalan masa depan |
| Anomaly baseline 30 hari | jendela 2015-07-14 sampai 2015-08-13 |
| Prediksi | meramal 7, 30, dan 90 hari ke depan dari titik itu |
| Data setelah 2015-08-13 | hanya dipakai untuk **menilai** prediksi di tab Model, tidak pernah masuk fitur |
| Uji otomatis | assert bahwa tidak ada nilai yang berasal dari timestamp setelah tanggal acuan |

Berkas setelah tanggal acuan tetap ada di disk (data sampai 2015-09-22), jadi uji kebocoran ini
penting: kalau skrip salah membaca, hasilnya akan terlihat bagus padahal curang.

---

## 4. Tiga lapisan data dan labelnya

Setiap kartu di dashboard membawa satu badge kecil yang menyatakan asal angkanya.

| Lapisan | Isi | Badge | Warna |
|---|---|---|---|
| **L1 Terukur** | 884 event, durasi, kategori, komponen; kanal WITSML; 12 kanal statistik; hasil engine (AUPRC, FAR, tier, lead time); health_index USROP | TERUKUR | hijau |
| **L2 Turunan** | MTBF, MTTR, availability, downtime, failure rate, chronic set, exception SPC, health index aset, RUL Weibull, failure probability, anomaly score, top drivers, control loop | TURUNAN | biru |
| **L3 Sintetis** | work order, status, owner, due date, plan adherence, biaya, jadwal shift, advisory text | SINTETIS seed 20260511 | jingga |

Aturan: L3 tidak boleh menjadi sumber angka L1 atau L2. Kalau sebuah kartu mencampur, badge
menyebut komposisinya, contoh "TURUNAN + SINTETIS".

Footer dashboard selalu menampilkan: rentang data nyata, jumlah event nyata, seed sintetis, waktu
generate, versi payload.

---

## 5. Aset dan model data

### 5.1 Daftar aset

Aset dibentuk dari kategori dan komponen yang benar-benar muncul di `labels_curated_v2.csv`, ditambah
peralatan permukaan yang tercatat pada kategori `surface_rig_equipment`.

Jumlah penyebutan dihitung dari kolom `comments_full`, `state_detail`, dan `evidence` di 884 event.

| Kelompok | Aset | Bukti nyata | Kanal |
|---|---|---|---|
| Permukaan | top drive | 71 event | tidak ada kanal khusus, telemetri rig dipakai |
| Permukaan | drawworks | 48 event | tidak ada kanal khusus |
| Permukaan | mud pump | 20 event | tekanan dan laju alir rig |
| Permukaan | rotary table | 11 event | RPM dan torsi rig |
| Permukaan | iron roughneck | 9 event | tidak ada kanal khusus |
| Permukaan | shale shaker | 1 event | tidak ada kanal khusus |
| Bawah permukaan | drill string, MWD/LWD, sub, jar, stabilizer, bit | komponen di kolom `component` (mwd_lwd 7, bit 5, drill_string 5, sub 28) | VIBLAT, SHKPK, STUCK, CRPM, TTV, torque |
| Intervensi | tractor, toolstring, packer, perf gun, casing, liner | 18, 22, 6, 11, 64, 7 event | sebagian tanpa kanal |

Aturan yang dipakai:

- **Semua aset permukaan di atas masuk**, termasuk yang tidak punya kanal sendiri. Untuk aset tanpa
  kanal, status ditentukan dari event nyata dan dari kanal rig yang paling dekat (contoh mud pump dari
  SPPA dan TFLO), dan itu dinyatakan di kartu.
- BOP tidak masuk karena nol penyebutan di 884 event. Tidak ada aset tanpa bukti.
- Kedalaman aset: peralatan permukaan satu unit per rig (bukan per wellbore), rangkaian BHA per
  wellbore, peralatan intervensi per kejadian.

Jumlah aset final dihitung skrip dan dicetak, bukan ditetapkan tangan di dokumen ini.

### 5.2 Telemetri

| Kanal | Sumber | Resolusi disimpan |
|---|---|---|
| VIBLAT_RT, SHKPK_RT, SHKRSK_RT, STUCK_RT, CRPM_RT | WITSML parsed per well | agregat per jam (mean, max, p95) |
| ATMP_RT, ATMP_MWD (suhu) | WITSML parsed per well | agregat per jam |
| SPPA, TFLO, SWOB, TRPM, TQA, HKLD, ROP | WITSML parsed + CSV statistik | agregat per jam |
| 12 kanal statistik | dataset_prediktif.csv | sudah per baris 60 detik, disimpan per jam |
| health_index, maintenance_recommendation | USROP | per baris, disimpan per jam |

Untuk menjaga payload, kanal disimpan dalam dua resolusi: harian untuk 8 tahun, dan per jam hanya
untuk 7 hari terakhir sebelum tanggal acuan.

### 5.3 Event dan work order

- **Event nyata**: 884 baris dari `labels_curated_v2.csv`, apa adanya, termasuk `component`,
  `category`, `bha_relevant`, `outcome`, `comments_trunc300`.
- **Work order sintetis**: dibangkitkan dari event nyata dan dari head engine yang berstatus
  L1 (peringatan). Setiap WO menyebut event atau head mana yang menjadi asalnya. Tidak ada WO tanpa
  rujukan.
- **Exception sintetis** hanya untuk hal yang tidak punya kanal; exception yang punya kanal
  (misalnya lonjakan SPPA, getaran di zona D) dihitung dari data nyata dengan aturan Western Electric
  dan zona ISO.
- **Chronic**: dari 27 pasangan well-komponen nyata, ditambah definisi berulang 3 kali dalam 180 hari.

### 5.4 Skema payload (`data/plant.json`)

```
meta        : seed, generated_at, rentang data nyata, jumlah event, versi skema, sumber per lapisan
filters     : daftar lapangan, wellbore, shift, tanggal, tipe aset, kelas risiko
kpi         : health_index, due_now, open_actions, open_exceptions, open_chronic, plan_adherence, oee
fleet       : total, healthy, warning, critical, predicted_failure, maintenance_due, availability, oee
assets[]    : id, nama, tipe, wellbore, status, risk_class, telemetry_ref, event_count, mtbf, mttr,
              availability, downtime_30d, failure_rate, cost_12m
asset_detail: per aset: 8 kotak angka, seri getaran dan suhu, 5 event terakhir, root cause,
              recommended action, detection method, confidence, RUL
events[]    : 884 event nyata + turunan (durasi jam, bulan, wellbore, komponen)
actions[]   : work order sintetis dengan sumber rujukan
exceptions[]: campuran nyata (SPC) dan sintetis, dengan flag
chronic[]   : pasangan nyata dengan severity
series      : snapshot per jam hari acuan, dan harian 8 tahun (kanal terpilih)
engines[]   : hasil capstone apa adanya (tier, head, AUPRC, FAR, batas pemakaian)
drivers     : dekomposisi delta harian
control     : detection, standardization, response, closure
```

Target ukuran payload: di bawah 1,5 MB, dengan pemilihan titik eksplisit untuk grafik panjang.

---

## 6. Rumus

### 6.1 Keandalan (nyata, dari 884 event)

```
MTBF_aset   = total jam operasi aset / jumlah kegagalan aset
MTTR_aset   = total jam perbaikan / jumlah perbaikan
availability= MTBF / (MTBF + MTTR)
failure_rate= jumlah kegagalan / total jam operasi x 1000
downtime    = jumlah (act_end - act_start) dalam jam
```

Batas yang harus disebut di kartu: durasi di data adalah durasi interupsi operasi, bukan durasi
bengkel. Jadi MTTR di sini berarti waktu operasi berhenti, bukan waktu tangan bekerja.

### 6.2 RUL dan failure probability (turunan, berbasis event nyata)

```
fit Weibull per komponen dari 254 event yang punya komponen (beta, eta)
RUL(t)      = eta_efektif - umur, dengan eta_efektif = eta x faktor kondisi
faktor_kon = 1 - 0,35 x z(VIBLAT) - 0,20 x z(SHKPK) - 0,15 x z(ATMP)   (dipotong 0,4 sampai 1,0)
P(gagal 30h)= 1 - exp(-((t+30)/eta_efektif)^beta)
confidence  = 1 - lebar relatif CI bootstrap, dipotong 0,55 sampai 0,97
```

Kalau jumlah event per komponen kurang dari 5, beta dan eta dipinjam dari kelompok komponen yang
lebih besar dan diberi label "parameter dipinjam, n kecil".

### 6.3 Anomali (nyata)

```
anomaly_score = jarak Mahalanobis 5 kanal (VIBLAT, SHKPK, STUCK, CRPM, ATMP)
                terhadap baseline 30 hari milik aset itu, diskalakan 0-100
```

### 6.4 Health Index aset dan lapangan

```
health_aset = 100 x (0,30 norm_availability + 0,25 norm_oee + 0,20 norm_quality
                   + 0,15 (1 - norm_failure_rate) + 0,10 (1 - norm_anomaly))
health_lapangan = rata-rata berbobot criticality aset
Pita: 85-100 Excellent, 70-84 Good, 55-69 Watch, di bawah 55 Critical
```

### 6.5 Top drivers

Dekomposisi log untuk OEE (multiplikatif) dan delta langsung untuk mutu, sehingga angka penyebab
bisa dijumlahkan kembali ke delta total. Bukti tiap driver menyebut kanal dan wellbore asalnya.

### 6.6 Control loop health

```
Detection       : median jeda gejala (kanal naik) ke tiket dibuat
Standardization : rasio tiket yang punya prosedur, owner, dan due date
Response        : median jeda tiket dibuat ke mulai dikerjakan
Closure         : rasio tiket ditutup sebelum due date
```

---

## 7. Tampilan

### 7.1 Navigasi dan filter

Satu baris tab, satu produk:

```
[ Operasi ] [ Aset ] [ Aksi ] [ Keandalan ] [ Model ]
```

- **Operasi**: tampilan pembaca pimpinan, padanan tata letak contoh Bandapuram.
- **Aset**: fleet dan detail per aset.
- **Aksi**: work order, exception, chronic, due-now.
- **Keandalan**: MTBF, MTTR, Weibull, Pareto, heatmap, bad actor.
- **Model**: evaluasi 7 engine. Isi tab ini adalah Ringkasan, Sumur, dan Engine yang sudah ada
  sekarang, dipindah ke dalam satu tab sebagai sub-tab. Tidak ada kelompok tab terpisah.

Dropdown sticky: Lapangan, Wellbore, Shift, Tipe aset, Kelas risiko, Jendela tren (7 / 30 / 90 hari /
sepanjang data sampai tanggal acuan). Tanggal acuan tetap 2015-08-13 dan tidak dijadikan dropdown,
supaya tidak ada yang menggeser titik waktu dan diam-diam memakai data masa depan. State disimpan di
URL hash.

### 7.2 Tab Operasi (meniru tata letak Bandapuram)

Baris 1, tujuh kartu: Health Index, Due-Now, Open Actions, Open Exceptions, Open Chronic,
Plan Adherence, D-OEE. Tiap kartu menyebut delta harian dan badge lapisan.

Baris 2: grafik tiga seri per jam 06:00-14:00 pada tanggal acuan (D-OEE, meter berhasil, meter
diulang), plus baris angka di bawahnya; dan Top Drivers berbentuk batang horizontal.

Kolom kanan: Next Governed Actions (6 baris, Critical sampai Medium, tombol ke tab Aksi) dan
Advisory (1-3 saran, tiap saran menyebut keyakinan dan dasar kanal).

Baris 3: Active Watch Areas (4 aset, kanal, nilai, tren), Chronic donut (rentang nyata: 27 pasangan,
dipecah severity), Control Loop Health (empat bar), footer status (kualitas data per wellbore,
kanal hilang, seed, tanggal generate).

### 7.3 Tab Aset

Delapan kartu fleet, lalu enam grafik: donut health distribution, status per wellbore, tren prediksi
kegagalan 8 tahun, aktivitas maintenance per bulan, top 5 aset berisiko, dan sparkline enam kanal
untuk aset terpilih.

Tabel 20 kolom: aset, wellbore, tipe, status, risk class, failure probability, RUL, anomaly score,
VIBLAT mm/s (zona ISO), SHKPK, STUCK, suhu anulus, mode kegagalan, confidence, MTBF, MTTR,
availability, downtime 90 hari, failure rate, biaya, aksi berikutnya.

Panel detail: header, 8 kotak angka, grafik getaran 8 tahun dengan pita zona, grafik suhu dengan
garis alarm, tabel 5 event nyata terakhir, blok root cause dan recommended action, daftar WO.

### 7.4 Tab Aksi

Empat sub-tabel: Actions, Exceptions (dengan flag nyata atau sintetis), Chronic, Due-Now.

### 7.5 Tab Keandalan

MTBF dan MTTR per komponen dan per wellbore, distribusi waktu antar kegagalan dengan fit Weibull,
Pareto kategori event, heatmap bulan x kategori, bad actor by cost, dan kurva P-F untuk satu aset
terpilih.

---

## 8. Berkas

**Baru**

```
code/capstone_read.py      pembaca read-only: label, witsml_parsed, USROP, hasil engine
code/plant_build.py        pembangun payload: agregasi, Weibull, health, WO sintetis
code/plant_validate.py     pemeriksa invarian, penulis laporan validasi
js/plant.js                render tab Operasi, Aset, Aksi, Keandalan
js/plant-filters.js        dropdown, state URL, penyaringan
data/plant.json            payload
data/plant.js              cermin untuk mode file://
DOCS/DATA_PROVENANCE.md    tabel asal tiap angka: nyata, turunan, atau sintetis
DOCS/SCHEMA.md             skema payload
README / CHANGELOG         diperbarui
```

**Diubah terbatas**

```
index.html   tambah grup tab, baris filter, kerangka panel
css/app.css  gaya dropdown, tabel, donut, gauge, heatmap, sparkline, badge lapisan
js/charts.js tambah donut, gauge, sparkline, heatmap, pareto, control chart
```

**Tidak diubah:** `code/exporter.py`, `code/exporter_full.py`, `data/pm_full.json`, seluruh isi
`/mnt/d/ARCT-9F2`.

---

## 9. Urutan pengerjaan

| # | Langkah | Hasil yang bisa diperiksa |
|---|---|---|
| 1 | `capstone_read.py`: baca label, witsml_parsed, USROP, hasil engine; cetak profil tiap sumber | ringkasan: 884 event, 10 wellbore, 239 kanal, health_index terisi |
| 2 | Uji kualitas kanal: persen data hilang per kanal per wellbore, rentang waktu efektif | tabel coverage, kanal yang tidak layak dibuang |
| 3 | Hitung keandalan nyata: MTBF, MTTR, availability, downtime, failure rate per aset dan komponen | tabel, dibandingkan dengan rentang literatur |
| 4 | Fit Weibull per komponen + uji goodness of fit, tandai n kecil | parameter beta dan eta dengan CI |
| 5 | Turunkan anomaly score, RUL, failure probability, health index | tabel 20 kolom terisi dari data nyata |
| 6 | Deteksi exception nyata dengan Western Electric dan zona ISO | daftar exception nyata dengan waktu |
| 7 | Bangun work order sintetis ber-seed dengan rujukan ke event atau head | jumlah WO, rasio tertutup tepat waktu, plan adherence |
| 8 | Agregasi telemetri dua resolusi, susun payload, cek ukuran di bawah 1,5 MB | `data/plant.json`, cetak ukuran |
| 9 | Validasi invarian dan determinisme (dua kali jalan, sha256 sama) | laporan PASS/FAIL |
| 10 | Kerangka UI: grup tab, dropdown, state URL | dropdown mengubah hash tanpa error |
| 11 | Tab Operasi lengkap | 7 kartu, snapshot, drivers, actions, advisory, watch, donut, control loop, footer |
| 12 | Tab Aset lengkap, termasuk tabel dan panel detail | 20 kolom, panel detail 8 kotak |
| 13 | Tab Aksi dan Keandalan | empat sub-tabel, Weibull, Pareto, heatmap, P-F |
| 14 | Primitif grafik baru | tiap primitif dites dengan data contoh |
| 15 | Audit visual 4 lebar, kontras, luapan, mode file:// | laporan cek dan tangkapan layar |
| 16 | Dokumentasi provenance, skema, README, CHANGELOG | bisa diaudit orang lain |

Perkiraan 14 sampai 16 jam terfokus. Langkah 1 sampai 9 harus selesai sebelum UI. Setelah itu UI
boleh dipecah paralel (Operasi, Aset, Aksi-Keandalan, grafik-dokumentasi).

---

## 10. Verifikasi

**Determinisme**
- dua kali jalan, `sha256 data/plant.json` identik
- seed tampil di footer dan di `meta.seed`

**Invarian**
1. healthy + warning + critical = total aset
2. jumlah event di dashboard = 884 (kecuali filter aktif, dan itu terlihat di kartu)
3. jumlah chronic donut = jumlah baris tabel chronic
4. MTBF x jumlah kegagalan = total jam operasi, toleransi 0,1 persen
5. availability dari MTBF dan MTTR cocok dengan availability dari log event, beda di bawah 0,5 persen
6. tidak ada WO dengan tanggal dibuat sebelum event sumbernya
7. setiap angka L1 di payload bisa dilacak ke baris berkas sumber (uji sampel acak 20 angka)
8. tidak ada aset tanpa kanal nyata maupun event nyata
9. semua persen di 0-100, probability di 0-1, tidak ada NaN
10. kanal yang dinyatakan dipakai benar-benar ada di berkas sumber
11. tidak ada fitur, baseline, parameter Weibull, atau skor yang memakai timestamp setelah
    2015-08-13; diuji dengan menandai setiap baris sumber yang dipakai dan memeriksa tanggalnya

**Kejujuran**
- badge lapisan muncul di setiap kartu
- footer menyebut rentang data nyata dan seed
- laporan validasi mencetak berapa persen angka tiap lapisan

**Tampilan**
- 1440, 1024, 768, 390: nol luapan, nol kartu kosong, nol label terpotong
- kontras teks kecil minimal 3,0:1
- mode `file://` jalan
- `node --check` bersih, nol em-dash

---

## 11. Risiko

| Risiko | Penanganan |
|---|---|
| 239 kanal x 1,6 juta baris membuat payload membengkak | dua resolusi, pilih 8 sampai 12 kanal penting, titik grafik dipilih eksplisit |
| Label event tidak lengkap (571 uncertain, 263 bukan BHA) | laporkan sebagai angka, jangan pakai yang uncertain untuk MTBF utama; sediakan filter keyakinan |
| n kecil per komponen membuat Weibull rapuh | pinjam parameter kelompok, beri label, tampilkan CI lebar |
| Durasi event bukan durasi bengkel | sebut di kartu dan di README, jangan beri nama "repair time" tanpa penjelasan |
| Kebocoran data masa depan (fitur memakai data setelah 2015-08-13) | uji otomatis menolak nilai bertimestamp setelah tanggal acuan; hasil terlihat lebih bagus kalau bocor, jadi ini risiko utama |
| Dashboard dikira data operasional asli | badge lapisan dan banner sintetis untuk sisi work order |
| Halaman Model (evaluasi engine) rusak karena perubahan | kode plant di berkas terpisah, halaman Model hanya dipindah sebagai sub-tab tanpa mengubah logikanya |

---

## 12. Keputusan

Sudah dikunci oleh operator:

| Keputusan | Nilai |
|---|---|
| Waktu acuan | 2015-08-13, hari ini dianggap masih 2015 |
| Arah prediksi | meramal ke depan dari titik itu, tanpa memakai data setelahnya |
| Nama entitas | Volve Field, Sperry Drilling, Halliburton |
| Peran Bandapuram | contoh tata letak dan standar kelengkapan, bukan nama dan bukan bagian produk |
| Struktur tab | satu produk, lima tab: Operasi, Aset, Aksi, Keandalan, Model |
| Peralatan permukaan | dibuat semua yang punya bukti di data, termasuk yang tanpa kanal |

Satu hal yang masih saya perlukan sebelum mulai: apakah saya jalan sekarang, atau Anda mau membaca
plan ini dulu dan memberi koreksi lagi?
