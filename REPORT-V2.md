# MISI V2 — Latent Magnet / Token Radar

**Hasil: A LOLOS dengan guard v1, B LOLOS, C GAGAL pada kelengkapan run record. Belum siap submit.** Build, capture, dan bundle lokal tersedia; tidak ada klaim skor dev v2 atau posisi top 10.

Pemeriksaan final dilakukan 27 November 2026 UTC. Kit lokal: `makefun-cli 0.1.0+kit.57`, build `04828c52af6f`. Node `v24.22.1`; Chrome `158.0.8127.88`; Puppeteer yang sudah ada di `../scratch-tr3/`. Tidak ada pemasangan dependensi.

| Checkpoint | Status | Bukti utama |
| --- | --- | --- |
| A — model v2 | **LOLOS / guarded v1** | 198 baris membawa odds, P25/P75, verdict, net USD dan net USD/jam; ledger 119 LOO + 63 walk-forward; semua term v1 dipertahankan karena ablation tidak mendominasi baseline |
| B — dashboard dan capture | **LOLOS** | 10 kolom; 11 baris penuh terlihat; 6 KPI; 63.429 byte source; 3 capture asli 1280×900; dua build bersih dan validator dua arah lolos; 12 file identik |
| C — kit dan bundle | **GAGAL** | Check resmi lokal exit 1: 13 pass, 1 fail, 6 skip, 5 submission-only; `transcripts_run_record` gagal. Folder bundle dan manifest dirakit, tetapi tidak diberi label siap submit |

## A — model, estimasi odds dan ekonomi

Input tunggal: `kit/input/snapshot.json`, as-of **2026-11-14**. SHA-256: `42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393`. Tidak ada data harga, odds, launch, atau eligibility dari luar snapshot.

`lib/model.ts` dipertahankan sebagai baseline v1. `lib/v2.ts` menambah `forecast`, `validateModel`, `dispersion`, `fitOdds`, `economicCase`, dan `buildV2`. Kode v2 lengkap disertakan sebagai `dashboard/model.txt` dalam output dan dossier; `dashboard/proof.json` memuat seluruh 16 ablation dan ledger setiap target `[slug, actual, v1, v2, P25, P75]`. Tidak ada ledger yang dipotong.

### Held-out dan keputusan term

Median x-error didefinisikan sebagai `median(max(pred/actual, actual/pred))`; lebih rendah lebih baik. Setiap target dikeluarkan sebelum peer multiple dikalibrasi.

| Evaluasi | n | Formula v1 | Formula v2 yang dipakai |
| --- | ---: | ---: | ---: |
| Leave-one-out, seluruh priced peer | 119 | **4,810660702624229×** | **4,810660702624229×** |
| Walk-forward proxy, urutan listing | 63 | **4,805987917121093×** | **4,805987917121093×** |
| P25–P75: actual berada dalam rentang, LOO | 119 | — | **48/119 = 40,34%** |
| P25–P75: actual berada dalam rentang, walk-forward | 63 | — | **26/63 = 41,27%** |

Walk-forward hanya memakai peer yang tanggal listing-nya **lebih awal secara ketat** dari target, dengan warm-up 24 priced records; 32 priced records tanpa tanggal dikeluarkan dari split temporal. Kohor tanggal sama tidak saling melatih. Semua cap, TVL, dan 7d tetap observasi pada satu tanggal snapshot: ini **proxy berurutan menurut listing, bukan historical backtest**. Identitas token yang sama pada beberapa protokol juga dapat menggandakan ekonomi token. Batas ini tampil di UI, kode, dan dossier.

| Term yang dihapus dari baseline | LOO x-error | Walk x-error | Keputusan |
| --- | ---: | ---: | --- |
| Blend category/global, diganti median kategori tanpa blend | 5,167011645 | 4,805987917 | RETAIN blend |
| Momentum/growth | 4,890633713 | 4,782627442 | RETAIN: walk membaik sedikit, LOO memburuk |
| Maturity | 5,098659453 | 4,965339927 | RETAIN |
| Completeness | 4,892601658 | 4,805987917 | RETAIN |

Semua 16 kombinasi term dihitung. Ablation mask 1 memperoleh walk 4,345721180× tetapi LOO 4,936756545×: tidak dipilih. Guard mensyaratkan tidak satu pun median split memburuk; tidak ada pengganti yang memenuhi. **Mask 15 / semua term v1 dipakai; estimasi titik, slug, dan rank seluruh 198 baris sama dengan baseline. Tidak ada klaim akurasi titik meningkat.** Ablation menggunakan ulang split evaluasi, sehingga hasil pemilihan bukan independent test. Perbaikan substansial v2 adalah keputusan ekonomi, odds berprovenance, rentang berlabel dan bukti error yang sebelumnya tidak tersedia.

### Odds dan rentang

- `fitOdds`: positive labels adalah **119** record token berharga positif, non-CEX; controls adalah **300** record non-CEX yang belum mencatat token. **297** record beridentitas token tanpa cap positif diperlakukan sebagai missing outcome dan dihitung terbuka. Controls dipakai sebagai exposure denominator, bukan bukti tidak akan launch.
- Pooled rate **119/(119+300) = 0,2840095465393795**. Batas umur berasal dari kuartil umur priced peers: **571, 990, 1412 hari**. Kekuatan shrinkage **2** berasal dari median jumlah priced peer per kategori; bukan angka probabilitas global yang ditetapkan tangan.
- Age prior `(priced_age + strength*pooled)/(N_age+strength)`, lalu odds `(priced_category_age + strength*age_prior)/(N_category_age+strength)`. Tiap baris menyimpan hitungan kohornya.
- Ini **prevalence-as-launch proxy**, dengan censoring, survivor dan missing-price bias. Snapshot tunggal tidak mengidentifikasi peluang launch eventual atau hazard per horizon. Horizon rencana hanya mengubah biaya. Nilai odds di ekonomi adalah asumsi proxy yang diungkap, bukan frekuensi launch yang terkalibrasi.
- `dispersion` memakai nearest-rank P25/P75 multiple cap/TVL **mentah, tidak di-clip**: kategori jika minimal 5 priced peers (**76 baris**), pooled berlabel jika kurang (**122 baris**). Kalikan TVL dan term signal yang dipertahankan. Estimasi titik tetap blend v1. IQR dapat tidak mengapit titik; bukan confidence interval atau jaminan coverage 50%.
- `implied_p25_usd`, `implied_p75_usd`, dan `value_range` adalah rentang v2 yang dipakai UI; metadata baseline pada objek model dipertahankan untuk provenance v1. Rank envelope membandingkan batas interval semua baris, bukan interval confidence rank.

### Ekonomi yang benar-benar dihitung

Skenario tengah mengasumsikan wallet menerima **1 ppm = 0,0001%** dari implied circulating cap pada pilot $100, dikalikan `min(capital/100, 2)`. Matriks menguji 0,1/1/10 ppm × deposit $50/$100/$150/$250. Besar alokasi dan kelayakan **tidak diketahui** dari snapshot.

`expected_drop = odds * implied_value * assumed_wallet_share`.

`net = expected_drop - 4*fee_ceiling_per_action - capital*5%*days/365 - capital*1% - minutes/60*$15`.

Capital pilot dianggap dikembalikan sehingga tidak dibebankan seluruhnya sebagai biaya; opportunity cost, risk charge dan waktu dibebankan. Modal bisa hilang seluruhnya dan reward bisa nol. Angka fee adalah ceiling perencanaan, bukan quote. FARM jika net positif dan surplus setelah biaya waktu minimal $15/jam; MARGINAL jika net positif tetapi surplus/jam di bawah itu; selebihnya SKIP. Semua knob ekonomi adalah skenario, bukan estimasi fakta yang tidak ada di input.

Hasil tengah: **2 FARM, 0 MARGINAL, 196 SKIP**. Veda (rank 4) net **$25,9182**, **$15,8683/jam**; USDD (rank 5) net **$36,9910**, **$22,6475/jam**. Filter FARM mengagregasi **2 baris**, TVL **$2.619.209.088**, implied **$573.396.681**.

Rank 1 `steakhouse-financial`: implied **$601.868.820**, P25–P75 **$116.649.326–$2.728.665.744**, odds **0,006462777518063792**, verdict **SKIP**, net **−$40,7407**, net/jam **−$24,9433**. Nilai launch tertinggi tidak dipromosikan sebagai farm terbaik.

## B — dashboard, bukti capture dan determinisme

Header memiliki 6 KPI, stacked accounting bar (198 ranked + 144 excluded no-token + 119 priced + 297 recorded/unpriced = **758**), integrity strip dan tabel bukti held-out. Board 10 kolom membawa rank/envelope, protokol/badge, TVL, 7d, umur, odds/bar, point if-it-launches, P25–P75/range bar, verdict dan net/jam.

Detail rank 1 memuat kalkulasi faktor, 9 nearest peers berdasarkan `abs(log(TVL_peer/TVL_target))`, 12 sel matriks berverdict, 6 langkah bernomor dengan biaya/waktu, serta benchmarks. Screenshot final menampilkan semua sel matriks, langkah terakhir pada y=809,16 dan footer pada y=875,84. Tidak ada overflow horizontal. Board menampilkan **11 baris penuh**, table top y=433,23, viewport **1280×900**, device scale **1**.

### Ukuran source dan dossier

| File dashboard output | Byte |
| --- | ---: |
| app.css | 9.438 |
| app.js | 22.489 |
| index.html | 557 |
| method.txt | 2.309 |
| model.txt — executable model v2 lengkap | 15.260 |
| proof.json — seluruh ablation dan fold ledger | 13.376 |
| **Total** | **63.429** |

Di bawah batas konservatif **64.000 byte** dan batas kit **65.536 byte**. Draft awal 66.534 byte dipangkas lewat prose metodologi yang berulang dan stylesheet, bukan dengan menghapus ledger atau term model. Dossier text **63.921 byte**, **tanpa truncation**. Dossier total **954.924 byte**, 3 embedded images, identik dengan hasil builder vendor dan builder kit asli. `data.js` (**1.719.411 byte**) adalah payload data di root output sesuai interface kit; seluruh kode renderer/CSS/HTML, method, model v2 dan ledger tetap dihitung dalam source dashboard di atas.

### Tiga capture asli

Puppeteer memakai Chrome existing di scratch, `pipe:true`, mode offline. PNG dihasilkan langsung oleh `page.screenshot`; tidak disintesis, tidak digambar ulang, tidak diedit, dan tidak memakai fixture. Capture final dirender ulang dari **`v2-output-a/dashboard/index.html` pada 2026-11-27T00:05:52Z–00:05:58Z**, dan ketiga hasilnya identik dengan PNG yang sudah terpasang di repo/output. Source, data, dan board SHA diikat dalam `../scratch-tr3/evidence/capture-v2.json`.

| Capture | Dimensi | Byte | SHA-256 |
| --- | --- | ---: | --- |
| screenshots/1-board.png | 1280×900 | 231.382 | `aaf09c93569309ac38a37f51a13b2897325616fd9cb7373d507fb0fe9c76fd55` |
| screenshots/2-detail.png | 1280×900 | 259.324 | `3aeeaa38b4fd900ceeb6e5154ce6f1fe7fce84fd620ef510e3471dc413bd45fe` |
| screenshots/3-filtered.png | 1280×900 | 176.366 | `f58f8a653a99357c3fd1b0777538b6e6fa05e8b12ed195904c66a19d4efe3996` |

Semua 60–512 KB. Baris teratas capture dan detail adalah rank 1 yang sama di board. Browser memeriksa **198 detail**, **2.376 sel skenario**, seluruh teks aksi plan, search, empty state, kategori, sorting TVL, pemisahan **119** priced benchmarks dan filter FARM. **0 page errors, 0 permintaan HTTP(S)** dari dashboard.

### Build dan validasi

```sh
node main.ts --input kit/input/snapshot.json --output v2-output-a
node main.ts --input kit/input/snapshot.json --output v2-output-b
node scripts/validate-build.ts v2-output-a v2-output-b
node scripts/validate-build.ts v2-output-b v2-output-a
```

Kedua output dibuat pada path baru/kosong. Kedua arah validator **exit 0**, **12/12 file byte-identical**, **0 file beda**. Board **1.665.670 byte**, **198 baris**, **40/40** watchlist, **158** tambahan. Semua baris mempunyai 6 farm steps sepanjang **179–591 karakter**. PNG CRC, decompression, dimensi, hash/base64 dossier dan vendor provenance tetap diperiksa. Asumsi validator lama yang mengharuskan fixture diganti dengan pemeriksaan capture/source hashes dan QA browser asli; uji negatif screenshot menunjuk path yang memang tidak ada. Tidak ada gate yang dimatikan untuk memperoleh pass.

- Board SHA-256: `25b3e9d587caf96401b4ef2d03c818fa5c41ee3f26ed78de61af71d31d9766de`.
- Dossier SHA-256: `29aa51251092428cba0c999ff006f21d138c157e72870f6b76559b447095c90a`.
- Data SHA-256: `6dd75c2f652f749156f5b493c5c467dbfd8562430164815c6b666491965d4ab6`.
- Hasil lengkap validator: `../scratch-tr3/evidence/validate-v2-a.json` dan `validate-v2-b.json`.

## C — check kit lengkap dan status bundle

Check dijalankan **satu kali**, 2026-11-27T00:08:58Z, pada `worktree@a8ab9694f9ee`, setelah kode build dan ketiga screenshot final selesai. Laporan ini dan salinan JSON hasil check ditambahkan sesudahnya. Tidak dibuat klaim check terhadap commit baru. Perintah efektif:

```sh
MAKEFUN_OFFLINE=1 MAKEFUN_CREDENTIALS=<path scratch yang tidak ada> \
node kit/cli/makefun.mjs check --kit kit --repo . --worktree \
  --transcripts ../scratch-tr3/transcripts-v2/opencode.db --json
```

Isolasi environment menghindari credential asli. **Exit 1**, `ok:false`. Seluruh output, alasan, fixes dan notes disimpan utuh di **`KIT-CHECK-V2.json`**; wrapper dengan command/exit/stdout/stderr di `../scratch-tr3/evidence/kit-check-v2.json`.

| Check resmi | Status |
| --- | --- |
| prerequisites | skip — diperiksa sendiri: Node dan Chrome telah berjalan |
| competition_open | pass |
| snapshot | pass — 20 file, 816.456 byte pada saat check |
| license_osi | pass — MIT/SPDX |
| entrypoint | pass — main.ts/node22 |
| strategy_note | skip — tidak diminta |
| committed_secret | skip — tidak memakai dotenv |
| transcripts_present | pass — 2 session OpenCode asli |
| transcripts_recorded | pass — native record, bukan handed-over |
| thinking_wellformed | pass — 226 messages; 111 tool results; satu call masih berjalan saat snapshot log |
| thinking_in_window | pass — 341 timestamps dalam window |
| thinking_committed | skip — tidak ada tanda tangan |
| thinking_reproduces | pass — 537/1574 lines, 34,1%; main.ts 10 authored lines |
| thinking_on_task | skip — kit tidak menamai task terms |
| thinking_turns | pass — 24 turns, minimal 5 |
| thinking_priced | pass — 112 usage records dikenali |
| thinking_revised | pass — app.css content berasal dari 3 messages |
| thinking_fresh | skip — repo GitHub tanpa beacon root |
| **transcripts_run_record** | **FAIL — tidak ada run record lengkap** |
| thinking_own_work | pass — tidak ada borrowed/downloaded runs yang melanggar |
| repo_public | submission — hanya situs dapat memeriksa |
| repo_owner | submission |
| repo_created_after_open | submission |
| commit_in_repo | submission |
| duplicate_snapshot | submission |
| **Tally** | **13 pass / 1 fail / 6 skip / 5 submission** |

Alasan failure persis: **“the upload carries no run record (a bundle's manifest.run, or makefun-run.json beside loose transcripts), which an entry received from 17 November 2026 (00:00 UTC) must”**.

`bundle --dry-run --no-superbot-attest` menemukan dua native session (TR3 dan V2), tetapi **tidak ada system prompt di log** dan belum ada run record lengkap dengan context, deklarasi MCP/effort. Tidak dibuat system prompt, usage, timestamps atau run record palsu. Native SQLite export mempertahankan isi row session/message/part tanpa rekonstruksi; provenance/digest row ada di `evidence/native-export-v2.json`. Ini belum pengganti bundle transcript resmi yang lengkap. Penghalang tersebut perlu diselesaikan dengan ekspor/run-record nyata dari client sebelum submission.

Satu note kit menyebut rasio teks/thinking per authored line rendah; kit secara eksplisit menyatakannya **note, bukan rejection atau penalti**. `gitleaks` tidak terpasang; built-in redaction dipakai check. Lima status submission tidak dihitung sebagai pass lokal. Check kit bukan scorer atau dev grade, sehingga tidak diklaim sebagai tujuh artifact gate server yang telah dinilai.

### Bundle yang dirakit

Lokasi: **`../scratch-tr3/bundle-v2/`**, dengan **`MANIFEST.txt`** berisi seluruh path, ukuran, dan SHA-256 board/dossier serta file lainnya. Isi: entrypoint, kedua model, vendor, lisensi, README, validator, dashboard output lengkap, data, board, dossier, tiga PNG baru, laporan ini, hasil check lengkap, bukti validator/browser dan native log snapshot beserta status kekurangannya. Browser binaries, node_modules, cache, fixture kit dan wallet/credentials bukan isi bundle. Ini **folder review lokal dengan status C GAGAL**, bukan source/transcript archive yang sudah diterima make.fun.

## Sisa masalah dan batas penghentian

1. **Blocker submission:** run record/context transcript resmi belum lengkap; check harus menjadi nol failure sesudah memperoleh catatan client yang sah. Jangan menyatakan bundle ini siap submit sebelum itu.
2. Titik v2 tidak lebih akurat dari v1: guard mempertahankan v1. Odds dan alokasi wallet bukan prediksi launch/reward terkalibrasi; walk-forward bukan histori. Batas ini disengaja ditampilkan, bukan ditutupi oleh desain.
3. Belum ada penilaian dev v2; kemampuan mengalahkan entry top 10 tidak dapat dijamin dari check lokal.
4. Kriteria bunuh dua failure gate sama **tidak terpicu**: validate-build gagal 0 kali; kit check dijalankan 1 kali dan gagal pada prasyarat run record yang belum dapat diperbaiki secara sah. Tidak diulang tanpa perubahan prasyarat. Draft layout/source sempat tidak memenuhi target, lalu dipangkas nyata sampai B lolos tanpa menghapus evidence model.

Tidak ada submit, tanda tangan, akses wallet/credential asli, API make.fun, push, atau commit Git. Baseline v1 dan vendor/lisensi tidak diubah. `REPORT-TR3.md` yang sudah ada sebelum misi ini dipertahankan. Perubahan dan keluaran hanya di repo ini dan `../scratch-tr3/`; seluruh kode v2 ditulis pada sesi ini.
