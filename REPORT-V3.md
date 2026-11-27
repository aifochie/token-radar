# MISI V3 — Token Radar / fitted engine

Status bertahap: **A LOLOS guard; B LOLOS; C belum dijalankan.** Belum ada klaim siap submit atau dev grade. Sesi OpenCode native: `ses_de5883638ffeHfJ0CgenXtei7A` (metadata session diperiksa langsung, tanpa membuat transcript atau run record). Baseline v2 tersimpan dalam commit lokal `351d1df` (`v2 baseline`). Checkpoint A: `5568061`.

## Checkpoint A — fitted ridge value + logit odds

Kode: `lib/v3.ts`, pemeriksa angka: `scripts/evaluate-v3.ts`. Hasil eksekusi awal dikonfirmasi ulang secara independen oleh mandor, sebagaimana dicatat dalam `../MISSION-V3-RESUME.md`. Input tunggal tetap snapshot tersegel `kit/input/snapshot.json`, as-of **2026-11-14**, SHA-256 `42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393`.

**Engine terpilih FITTED RIDGE. Kriteria bunuh tidak terpicu:** fitted mengalahkan heuristik v2 pada kedua median held-out x-error. Definisi x-error: median `max(predicted/actual, actual/predicted)`.

| Split nilai | n | Fitted | Heuristik v2 |
| --- | ---: | ---: | ---: |
| Leave-one-out | 119 | 3,609194965× | 4,810660703× |
| Listing-order walk-forward | 63 | 2,408236345× | 4,805987917× |

Regresi target `log(mcap/TVL)` memakai ridge coordinate descent dan empat iterasi Huber IRLS (ambang residual log 1,5). Penalti tetap: continuous 2, kategori 8, family 12, intercept 0. Ukuran memakai `log(TVL/1e8)/2` dan kuadratnya. Family berasal dari gecko ID bila tersedia, selain itu slug yang dinormalisasi penanda versi; ini grup identitas token, bukan parent terverifikasi. Efek unseen bernilai nol. Target tidak di-clip; nilai dolar final dibatasi mengikuti cap kit.

Semua kandidat diuji berurutan terhadap model yang sebelumnya dipertahankan. Term masuk hanya bila LOO dan WF tidak memburuk (odds juga mensyaratkan ten-fold tidak memburuk). Penalti, urutan term, warm-up, dan transformasi tetap; tidak ditune agar mengejar angka pembanding publik.

| Kandidat nilai | LOO x-error | WF x-error | Keputusan |
| --- | ---: | ---: | --- |
| Intercept | 5,117563 | 4,274267 | KEPT |
| + kurva ukuran | 3,635839 | 2,414217 | KEPT |
| + kategori ridge | 3,989048 | 2,435506 | DROPPED |
| + family ridge | 3,609195 | 2,408236 | KEPT |
| + growth | 3,605497 | 2,423810 | DROPPED |
| + maturity | 3,641273 | 2,490683 | DROPPED |
| + completeness | 3,622658 | 2,408236 | DROPPED |

### Odds adalah klasifikasi record peers, bukan ramalan launch

Logit ridge dilatih pada **419 record non-CEX**: 119 mencatat token dengan market cap positif dan 300 belum mencatat token. **297 record** beridentitas token tanpa cap positif atau CEX dikecualikan dan di-account. Label nol berarti belum tercatat dalam snapshot, bukan bukti tidak akan launch. Share token kategori dihitung dari training saja, dengan smoothing 8; training-row encoding juga mengeluarkan label row itu sendiri. Ten-fold ditentukan hash slug; WF hanya melatih tanggal listing yang lebih awal secara ketat, warm-up 48 record; tanggal sama tidak saling melatih. Nilai yang hilang memakai transformasi terdokumentasi, bukan diisi dari target.

| Odds split | n | Brier logit | Brier base training |
| --- | ---: | ---: | ---: |
| LOO | 419 | 0,195092644 | 0,204322245 |
| Ten-fold | 419 | 0,196280231 | 0,204331026 |
| Listing-order WF | 320 | 0,143597146 | 0,174114665 |

| Kandidat odds | LOO Brier | Ten-fold Brier | WF Brier | Keputusan |
| --- | ---: | ---: | ---: | --- |
| Intercept | 0,204322 | 0,204331 | 0,174115 | KEPT |
| + log listed years | 0,201349 | 0,201988 | 0,144000 | KEPT |
| + log TVL | 0,202328 | 0,203507 | 0,144539 | DROPPED |
| + growth 7d | 0,198797 | 0,199801 | 0,143890 | KEPT |
| + chain count | 0,193831 | 0,193779 | 0,146048 | DROPPED |
| + category token share | 0,195093 | 0,196280 | 0,143597 | KEPT |

### Rentang dan keterbatasan

Rentang berasal dari kuantil residual log fitted pada training fold, tanpa memasukkan target held-out. Rentang nilai conditional dilaporkan terpisah dari rentang yang dikalikan odds. Coverage berikut berlaku pada **nilai conditional cap** terhadap cap record priced peers; bukan coverage prediksi launch ataupun coverage ekonomi yang dikalikan odds.

| Split | P25–P75 actual hits | Coverage | P10–P90 actual hits | Coverage |
| --- | ---: | ---: | ---: | ---: |
| LOO | 54/119 | 45,38% | 91/119 | 76,47% |
| WF | 33/63 | 52,38% | 46/63 | 73,02% |

Warm-up nilai 24 priced peers; WF mengeluarkan 32 priced records tanpa tanggal. **Seleksi term memakai split evaluasi yang sama**, sehingga ini diagnostik yang optimistis, bukan test independen. Semua market cap, TVL dan growth diambil pada satu tanggal: WF urutan listing **bukan historical backtest**. Umur listing bukan riwayat tanpa token. Shared-token dependence, censoring, survivor bias, missing-price bias, dan kategori yang tidak seimbang masih ada. Brier tidak mengkalibrasi eventual launch atau launch pada horizon tertentu.

### Ekonomi dan keputusan framing mandor

Rumus tidak diubah untuk memperbanyak FARM: `drop = implied_odds_weighted × drop_share × deposit/(TVL+deposit)`; `net = drop − 4×fee_ceiling − deposit×5%×days/365 − minutes/60×$15`. Waktu `70 + 7×weeks` menit. Hurdle skenario T-bill tetap **4% APR** pro-rata horizon (asumsi benchmark, bukan quote pasar kini). FARM jika net positif dan melebihi hurdle; MARGINAL jika net positif sampai hurdle; SKIP jika net tidak positif. Modal diasumsikan kembali, dapat hilang; fee adalah ceiling skenario, bukan quote. Drop share, eligibility dan reward tidak diketahui dari snapshot.

Skenario tengah **brief asli** ($10.000, 7%, 12 minggu) menghasilkan **0 FARM / 0 MARGINAL / 198 SKIP**. Rank 1 Steakhouse Financial: value-if-launches $68.721.840; odds record 0,231384346; implied odds-weighted $15.901.158; net −$169,526792.

Mandor menetapkan grid skenario terbuka untuk UI, dengan horizon awal 12 minggu dan **default Mid**, tanpa mengganti ECON atau hurdle:

| Skenario UI | Deposit | Drop share | FARM | MARGINAL | SKIP | Sumber angka sementara |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Conservative | $10.000 | 7% | 0 | 0 | 198 | evaluate-v3, dikonfirmasi mandor |
| Mid — default UI | $50.000 | 15% | 16 | 86 | 96 | uji economicCase mandor; akan dicek browser B |
| Aggressive | $50.000 | 25% | 99 | 52 | 47 | uji economicCase mandor; akan dicek browser B |

Keputusan ini mengubah skenario tampilan secara transparan. `board.json` tetap menyimpan ekonomi dasar brief asli; UI dan ekspor skenario akan menyatakan parameter aktif. Tidak ada parameter ECON/hurdle yang boleh diganti demi komposisi verdict.

### Status artefak pada penutupan A

`evaluate-v3` selesai sekitar 16,8 detik, `boardIssue = null`, 198 row, semua watchlist tercakup dalam builder. Pada checkpoint ini integrasi entrypoint v3, dossier final, dashboard, capture baru, dua build identik dan check kit **masih pekerjaan B/C**, belum diklaim lolos. Nilai byte dashboard, SHA capture dan tally kit akan ditulis setelah benar-benar tersedia. Tidak ada push, submit, signing, wallet, API make.fun, atau run record buatan.

## Checkpoint B — LOLOS / grid terbuka dan capture build yang sama

Entry point sekarang memakai `buildV3`. Dua output bersih `v3-output-a/` dan `v3-output-b/` berisi **198 row**, **40/40** watchlist, 158 early rows. `board.json` membawa value-if-launches, score record, implied odds-weighted, kedua pasangan kuantil conditional dan weighted, serta verdict/net/net per jam pada dasar brief asli. Default frontend **Mid** dinyatakan pada kartu skenario, kontrol, detail dan ekspor. Semua komposisi verdict di tabel A dikonfirmasi browser, tanpa perubahan `ECON`, rumus atau hurdle. Validator mengunci objek ECON persis terhadap konstanta A.

### Bukti halaman dan kalkulasi

- Enam KPI kualitas, tiga tabel terbuka (7 kandidat nilai, 6 kandidat odds, 7 baris kejujuran range/benchmark), accounting bar dan tiga pemeriksaan integritas aktif.
- Accounting saling lepas: ranked no-token 198 + recorded/unpriced atau CEX 297 + priced peers 119 + wrapped/versioned 16 + bridge 43 + exchange 42 + liquid staking/restaking 43 = **758**. Off-list/parent unknown **0 dalam bucket sisa**; bukan klaim tidak ada parent. Snapshot tidak membawa parentProtocol; beberapa row off-watchlist tetap ranked dan parent bawah floor tidak dapat diidentifikasi.
- Browser menghitung ulang SHA-256 serialisasi board dan mencocokkannya dengan checksum yang ditulis `main.ts`; pemeriksaan totals/uniknya accounting dan kelengkapan ledger semua split juga true. Main SHA ditampilkan dan diverifikasi validator.
- Board **11 kolom**, **11 row penuh terlihat** pada viewport 1280×900, table top y=494, tanpa overflow horizontal. CSV dan JSON memakai skenario aktif; Evidence JSON membawa semua ledger dan koefisien. Seluruhnya unduhan browser yang benar-benar diuji.
- Kontrol deposit, drop share, horizon, preset, tab verdict, pencarian/empty state, kategori, sorting TVL dan pemisahan 119 priced benchmarks diuji. Browser memeriksa **198 row × 4 skenario = 792** hasil ekonomi melawan `economicCase`, termasuk Custom $25.000/10,5%/26 minggu.
- Semua **198 detail** dan **2.376 sel matriks** diuji. Detail rank 1 memiliki dekomposisi 7 kandidat dengan dampak log/faktor dan anotasi LOO/WF, 6 peers terdekat, rentang conditional/weighted, hurdle T-bill, 12 sel matriks, 6 langkah bertipe serta chip biaya/waktu dan aturan exit. Plan terakhir berakhir y=837,33; seluruh matriks dan exit rule terlihat. Footer umum berada di bawah viewport (y=939,72); tidak diklaim terlihat.
- **0 page error, 0 request HTTP(S)** dari halaman. UI odds berlabel klasifikasi record, bukan peluang launch.

### Source dan dossier

| Source dashboard output | Byte |
| --- | ---: |
| app.css | 7.777 |
| app.js | 22.790 |
| index.html | 564 |
| method.txt | 1.127 |
| model.txt — fungsi fitting dan ekonomi persis dari lib/v3.ts | 8.215 |
| proof.json — tabel dan ledger lengkap | 23.408 |
| **Total** | **63.881** |

Total source di bawah **64.000 byte**, sisa 119 byte. Dossier text **64.369 byte**, tanpa truncation; dossier total **1.049.837 byte**, 3 gambar. Builder vendor dan builder kit mereproduksi dossier byte-identical. Seluruh fold tetap disertakan: 119 LOO + 63 WF nilai, dan 419 target odds dengan LOO/ten-fold serta 320 target WF. `proof.json` mengodekan bilangan dolar tepat sebagai base36 reversible; probabilitas dossier enam desimal, dengan error pembulatan diuji ≤0,500001×10⁻⁶. Payload `data.js` dan ekspor Evidence JSON menyimpan ledger kaya dengan probabilitas tepat, label, jumlah training dan base rate setiap fold. Tidak ada target dibuang demi anggaran source.

Source draft sempat 70.579 byte. Penghematan berasal dari prosa/CSS, encoding ledger reversible dan menampilkan bagian source fitting+ekonomi di `model.txt`; kode evaluasi, assembly dan packing lengkap tetap di repo `lib/v3.ts` yang SHA-nya terikat ke output. Semua tabel ablasi, Brier dan coverage tetap di dossier dan halaman.

### Capture asli

Puppeteer existing 25.19.0 dan Chrome **158.0.8127.88** dari `../scratch-tr3/`, `pipe:true`, offline, viewport 1280×900, device scale 1. Capture final benar-benar merender **`v3-output-a/dashboard/index.html`**, 27 November 2026 **16:02:15–16:02:23 UTC**. File di `screenshots/` mengganti capture v2, byte-identical dengan yang disalin kedua output dan yang di-embed dossier. Tidak ada fixture, sintesis, atau pengeditan PNG.

| Capture | Dimensi | Byte | SHA-256 |
| --- | --- | ---: | --- |
| screenshots/1-board.png | 1280×900 | 252.682 | `9d70d8374f94daab6305c0ef5370eb8dd2c0b844e7da70723bc401b45d8fc702` |
| screenshots/2-detail.png | 1280×900 | 233.630 | `6fb207c041e47f3d94d1134b1c65d555e408b2d381003b1f56c3345ce81cd9d3` |
| screenshots/3-filtered.png | 1280×900 | 250.987 | `226f60d3ef0d118a93a02151a8d1661120e8d36a0d1d6499f57fe3b433a7130a` |

Board/detail adalah rank 1 Steakhouse Financial; filter FARM menampilkan **16 row Mid**. Bukti Chrome, waktu, hash semua source/data/board, pemeriksaan layout, seluruh skenario dan unduhan: `v3-evidence/capture-v3.json`.

### Dua run dan validasi

```sh
node main.ts --input kit/input/snapshot.json --output v3-output-a
node main.ts --input kit/input/snapshot.json --output v3-output-b
node scripts/capture-v3.mjs v3-output-a
node scripts/run-validation-v3.mjs v3-output-a v3-output-b a
node scripts/run-validation-v3.mjs v3-output-b v3-output-a b
```

Kedua arah validator **exit 0**: **12/12 file byte-identical, 0 beda**. Board **1.220.080 byte**, 6 farm steps per row, panjang 178–591 karakter. Uji struktur board, refit seluruh ablasi, band held-out, ekonomi independen, freeze ECON, decoder ledger, sumber capture, CRC/decompress PNG, dossier vendor, order invariance dan missing-screenshot fail-before-write lolos. Bukti utuh: `v3-evidence/validate-a.json` dan `validate-b.json`.

- Board SHA-256: `6a8c91d7a61499a82bebbe8d63d0474441f13ee2002f6f1dea4f1193c01f52a0`.
- Data SHA-256: `d6bfb5318c490790081266664b67412d8b3fec3d079fd414d51e20408ffff5ae`.
- Dossier SHA-256: `f54c62b23fd5b9373b06c1b827ceef8913186aecbd063b5b9a80e2cb0f393ad4`.
- Main SHA-256: `085c9d9e36b409ec1510d66091b207589e8075f2be5240210d573285915b8a0c`.
- Model SHA-256: `cb32a5f08d562a8b3b607e9421d90cec3f9a14e3d88c2ee2dcdb9d6241991a4e`.

Kegagalan pengembangan yang diperbaiki: satu kurung JavaScript berlebih, path package Puppeteer berbeda dari asumsi, event download CDP lama yang tidak terbit meski file telah terunduh, dan validator raw-object yang membedakan `-0` dari `0` sesudah JSON menormalkannya. Pemeriksaan order invariance kini membandingkan bentuk serialisasi JSON yang memang merupakan kontrak output; tidak ada nilai model atau gate data yang dilonggarkan. Output/source draft yang melewati byte limit ditolak, lalu dipangkas nyata.

Sisa masalah pada penutupan B: check kit belum dijalankan; run record/context pengemasan tetap urusan mandor. Coverage P10–P90 WF hanya 73,02% terhadap nominal 80%; odds bukan launch forecast; validasi masih reuse split. Tidak ada klaim jaminan return, independensi penuh, dev rank, atau siap submit.
