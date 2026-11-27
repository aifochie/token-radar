# MISI V3 — Token Radar / fitted engine

Status bertahap: **A — mesin LOLOS guard; B dan C belum selesai.** Belum ada klaim siap submit atau dev grade. Sesi OpenCode native: `ses_de5883638ffeHfJ0CgenXtei7A` (metadata session diperiksa langsung, tanpa membuat transcript atau run record). Baseline v2 tersimpan dalam commit lokal `351d1df` (`v2 baseline`).

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
