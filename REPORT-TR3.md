# REPORT TR3 — Token Radar

**Hasil akhir: BELUM SIAP SUBMIT. Checkpoint A GAGAL, B GAGAL, C GAGAL.**

Penghalang aktual pada checkout ini adalah kit asli tidak tersedia: direktori `kit/`, `kit/input/snapshot.json`, dan `kit/starter/` tidak ada. Seluruh direktori output yang disebut dalam dua laporan sebelumnya juga tidak ada. Karena itu build final, capture dashboard berbasis snapshot, dan bundle final tidak dapat dibuat dengan sah. Tidak ada input pengganti atau hasil validasi lama yang diklaim sebagai hasil TR3.

Bukti proses menggunakan timestamp UTC: pemeriksaan prasyarat `2026-11-26T23:15:07.138Z`; uji browser final selesai `2026-11-26T23:17:12.647Z`.

## Konteks dan pemeriksaan awal

- Membaca `BUILD-REPORT.md`, `REVISION-REPORT.md`, `PLAN.md`, entrypoint, dashboard, dan validator; tidak mengulang pengembangan model.
- Git bersih sebelum pekerjaan. HEAD: `3737dfe`; commit implementasi tersedia: `da0a2f7`.
- `git log --all --format='%h %s' -- kit/input/snapshot.json kit/starter/vendor/makefun-board.ts` tidak menghasilkan entri: dua berkas kit tersebut tidak ditemukan dalam riwayat Git yang tersedia.
- `kit/`, `kit/input/snapshot.json`, `kit/starter/vendor/makefun-board.ts`, `kit/starter/LICENSE`, dan `kit/starter/screenshots/`: **semuanya tidak ada**.
- `build-output/`, `build-output-repeat/`, `revision-output/`, `revision-output-repeat/`, dan `final-output/`: **semuanya tidak ada**.
- Angka historis 198 baris dan watchlist 40/40 tercatat pada laporan sebelumnya; keduanya **belum dapat diverifikasi ulang dalam TR3**.
- Node: `v24.22.1`; npm: `10.9.4`.

## Checkpoint A — GAGAL

### Browser: berhasil dipasang dan dijalankan

Puppeteer **25.19.0** dipasang hanya dalam `../scratch-tr3/`; dependensi tidak dipasang dalam repo. Chrome yang diunduh oleh installer Puppeteer berhasil dijalankan:

- Versi: `Chrome/158.0.8127.88`.
- Executable: `../scratch-tr3/browser-cache/chrome/linux-158.0.8127.88/chrome-linux64/chrome`.
- Viewport aktual yang diperiksa dengan JavaScript browser: **1280 × 900**, device scale factor **1**.
- Mode offline diaktifkan sebelum membuka `about:blank`.
- Cache npm, cache Chrome, direktori sementara, profil uji, helper, dan bukti pekerjaan ditempatkan dalam scratch.
- Uji ini hanya memeriksa peluncuran dan viewport; **bukan** capture dashboard.

Peluncuran awal memakai executable override lingkungan dan gagal dengan stderr berikut:

```text
Error: Failed to launch the browser process:  Code: 127

stderr:
hatch-chromium-sandbox: --remote-debugging-port cannot reach this Chromium, which has no network; use --remote-debugging-pipe (Puppeteer: launch with pipe: true; Playwright already does)

TROUBLESHOOTING: https://pptr.dev/troubleshooting
```

Menambahkan `pipe: true` pada executable override masih menghasilkan:

```text
TargetCloseError: Protocol error (Target.setDiscoverTargets): Target closed
```

Perbaikan yang berhasil adalah mengunduh Chrome dengan installer Puppeteer ke scratch, mengosongkan override `PUPPETEER_EXECUTABLE_PATH` untuk proses tersebut, lalu menjalankan Chrome bawaan dengan `pipe: true`. Gerbang penghentian browser sekitar 30 menit **tidak terpicu**, karena browser akhirnya berjalan.

### Build untuk render: gagal sebelum output ditulis

Perintah dari root repo:

```sh
node main.ts --input kit/input/snapshot.json --output tr3-build-render
```

Exit code **1**, stdout kosong, stderr persis:

```text
token radar: ENOENT: no such file or directory, lstat '/home/hatch/sepuh1/bengkel/projects/token-radar/kit/input/snapshot.json'
```

`tr3-build-render/` tidak terbentuk. Tidak tersedia `board.json` untuk menentukan baris teratas dan membuktikan kecocokan data. Jumlah capture dashboard asli TR3: **0/3**. Screenshot lama tidak diganti, tidak dimodifikasi, dan tidak dipakai untuk menyatakan checkpoint lolos.

### Inventaris screenshot yang masih ada — BUKAN hasil capture TR3

Ketiga gambar berikut merupakan gambar lama yang disebut fixture dalam instruksi tugas. Kit pembanding tidak tersedia untuk membandingkan hash terhadap starter secara independen. Semua berukuran **1440 × 900**, sehingga juga belum memenuhi target viewport **1280 × 900** TR3.

| Berkas | Ukuran byte | Dimensi | SHA-256 |
| --- | ---: | --- | --- |
| `screenshots/1-board.png` | 120367 | 1440 × 900 | `bf46ab54ca1574d534beb08b7b1cd6a6eda625c54ae9efb5e7516d946b6c93b9` |
| `screenshots/2-detail.png` | 177342 | 1440 × 900 | `93a811797ebd9396923ad708118b5ac3e98752851a525bbe63ebde4cb17f253d` |
| `screenshots/3-filtered.png` | 114403 | 1440 × 900 | `c78017eeb8b40224ddaf80da711eab7a3dc451ce8b1b4bf7c5855d70b8648faf` |

Ukuran ketiganya berada antara 60–512 KB, tetapi ukuran dan hash yang berbeda **tidak membuktikan** bahwa gambar tersebut merupakan capture build ini. Kecocokan baris teratas, perbedaan visual terhadap fixture, detail protokol, dan filter aktif belum dapat diperiksa untuk build TR3.

## Checkpoint B — GAGAL

Percobaan validator dari root repo:

```sh
node scripts/validate-build.ts tr3-output-a tr3-output-b
```

Exit code **1**, stdout kosong. Stderr lengkap:

```text
node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/hatch/sepuh1/bengkel/projects/token-radar/kit/starter/vendor/makefun-board.ts' imported from /home/hatch/sepuh1/bengkel/projects/token-radar/scripts/validate-build.ts
    at finalizeResolution (node:internal/modules/esm/resolve:272:11)
    at moduleResolve (node:internal/modules/esm/resolve:879:10)
    at defaultResolve (node:internal/modules/esm/resolve:1006:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:705:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:725:38)
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:763:56)
    at #resolve (node:internal/modules/esm/loader:687:17)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:607:35)
    at ModuleJob.syncLink (node:internal/modules/esm/module_job:276:33)
    at ModuleJob.link (node:internal/modules/esm/module_job:381:17) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/hatch/sepuh1/bengkel/projects/token-radar/kit/starter/vendor/makefun-board.ts'
}

Node.js v24.22.1
```

Validator berhenti pada import kit, sebelum memeriksa artefak. Dilakukan **1 percobaan build gagal** dan **1 percobaan validator gagal**. Tidak dilakukan pengulangan pada prasyarat yang tetap hilang; tidak ada perbaikan sah tanpa kit asli. Ambang validator gagal pada gerbang sama dua kali setelah perbaikan tidak dicapai.

| Audit deliverable | Bukti TR3 | Status |
| --- | --- | --- |
| Dua run bersih selesai | 0/2; run render pun gagal karena snapshot tidak ada | GAGAL |
| Validator lolos untuk kedua run | 0/2; satu percobaan berhenti pada import kit | GAGAL |
| Semua file byte-identical | Belum ada dua output untuk dibandingkan; jumlah beda tidak dapat dihitung | BELUM TERVERIFIKASI |
| `board.json` ≥100 baris | Artefak final tidak tersedia | BELUM TERVERIFIKASI |
| Seluruh watchlist | Snapshot dan artefak final tidak tersedia | BELUM TERVERIFIKASI |
| Implied value dan farm plan setiap baris | Artefak final tidak tersedia | BELUM TERVERIFIKASI |
| Source dashboard ≤64 KB | 3 file, **27084 byte**, di bawah 65536 byte | LOLOS |
| `dossier.json` final ada | Tidak terbentuk | GAGAL |
| 3 screenshot asli | **0/3**; tiga file lama dipertahankan | GAGAL |
| `LICENSE` ada | Ada di root repo; kesamaan dengan kit belum dapat diperiksa | LOLOS untuk keberadaan |

Rincian ukuran source: `dashboard/app.css` **10062 byte**, `dashboard/app.js` **16465 byte**, `dashboard/index.html` **557 byte**.

### Penyesuaian validator yang masih diperlukan setelah kit dipulihkan

Dua asumsi lama terlihat langsung pada source validator dan belum diubah pada pekerjaan yang terhalang ini:

1. Baris 109 mengharuskan screenshot byte-identical terhadap `kit/starter/screenshots/`, dengan pesan `only unchanged starter fixtures may be used during this build`. Ini bertentangan dengan kebutuhan screenshot asli TR3.
2. Baris 225–230 menguji hilangnya screenshot tanpa memasok `--screenshots`, padahal root `screenshots/` sekarang tersedia. Uji negatif perlu menunjuk direktori yang memang tidak ada, bukan mengasumsikan default hilang.

Label `screenshot_status` pada baris 244 juga masih menyebut fixture starter. Koreksi nantinya harus mempertahankan pemeriksaan integritas PNG, ukuran, hash/base64 dossier, dan reproduksibilitas; tidak boleh sekadar menonaktifkan gate screenshot.

## Checkpoint C — GAGAL

`../scratch-tr3/bundle/` **tidak dibuat**, karena belum ada `board.json`, `dossier.json`, atau tiga screenshot final yang sah. Jumlah file dalam bundle final: **0**. `MANIFEST.txt` final tidak dibuat dan SHA-256 board/dossier final belum tersedia. Isi bundle final belum dapat dilaporkan sebagai siap submit.

Isi yang harus dirakit sesudah A/B lolos: source entrypoint/model/vendor dan lisensi, source dashboard, tiga screenshot hasil capture, `board.json`, `data.js`, `dossier.json`, serta `MANIFEST.txt` berisi daftar berkas/ukuran dan SHA-256 board/dossier. Dependensi browser, profil/cache scratch, fixture lama, serta output percobaan bukan bagian bundle final.

### Bukti dan pekerjaan yang tersedia dalam scratch

- `package.json`, `package-lock.json`, `.npmrc`, dan `node_modules/`: pemasangan Puppeteer terpisah dari repo.
- `browser-cache/`: Chrome bawaan Puppeteer yang sudah berhasil dijalankan.
- `browser-smoke.mjs`: helper uji browser; tidak membuat screenshot.
- `check-prerequisites.mjs`: helper audit prasyarat, inventaris PNG/source, dan pencatatan satu percobaan build/validator.
- `evidence/prerequisites.json`: keberadaan prasyarat/output, ukuran/hash/dimensi gambar lama, ukuran dashboard, serta hasil perintah.
- `evidence/build-attempt.json`: perintah, exit code, stdout, dan stderr build.
- `evidence/validator-attempt.json`: perintah, exit code, stdout, dan stderr validator.
- `evidence/browser-smoke.json`: kegagalan awal executable override.
- `evidence/browser-smoke-pipe.json`: uji sukses pertama Chrome bawaan dengan pipe.
- `evidence/browser-smoke-final.json`: uji sukses final, termasuk path executable, versi, offline, dan viewport aktual.

## Sisa masalah dan batas pekerjaan

Pulihkan kit asli pada `token-radar/kit/`, minimal snapshot serta vendor, LICENSE, dan screenshot starter pembanding yang diimpor/dibaca validator. Lokasi atau isi kit tidak direka ulang. Sesudah tersedia: build untuk render, capture tiga view asli 1280×900 secara offline, pasang hasil di `screenshots/`, sesuaikan asumsi fixture validator secara terbatas, lakukan dua build baru dan validasi keduanya, lalu rakit bundle dan manifest dari hasil yang lolos.

Satu-satunya file repo yang ditambah atau diubah oleh pekerjaan TR3 ini adalah `REPORT-TR3.md`. Tidak ada screenshot sintesis, pengeditan PNG, submit, panggilan API make.fun, penandatanganan, operasi wallet/credentials, commit, atau push Git.
