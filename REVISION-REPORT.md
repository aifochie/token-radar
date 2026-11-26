# Revision report — token-radar-01

## Changes by item

- **A1 — Peer-dispersion sensitivity:** `calibrate()` now computes nearest-rank p25 and p75 from sorted, clamped market-cap/TVL ratios. Category-blend estimates use their category's ratios and median; global estimates use all peer ratios and their median. `sensitivity_low_factor = p25 / median` and `sensitivity_high_factor = p75 / median` are stored in each row's model breakdown. Dollar bands multiply the implied value by those factors, retaining integer-dollar rounding and existing bounds. Empty peer sets use neutral factors of 1. The detail label displays the row's factors to two decimals, and the method text describes peer dispersion rather than a fixed percentage band.
- **A2 — Complete CSS rewrite:** `dashboard/app.css` now defines the Night Ledger theme: ink-blue canvas (`#101827`), blue panels, copper accents (`#ffb86b`), a six-pixel spacing scale, serif headings, and local sans/monospace text. Its original header comment describes this theme. Existing application class names remain supported. The stylesheet contains neither prohibited starter color, no external assets, and no fetch, import, or URL references.
- **A3 — Effective peer counts:** global-source rows report the global count, **119** on this snapshot; category-blend rows report their category count. The detail label reads “Global peer rows,” “Category peer rows,” or “Observed peer rows” according to `peer_source`. There are 122 global-source rows and 76 category-blend rows.
- **A4a — Kept the existing capital tiers:** $150 at TVL ≥ $1B, $100 at TVL ≥ $100M, otherwise $50. The dashboard method text now states the rationale: scale the size of a small pilot position with protocol size as a planning convention. It explicitly says higher TVL does not establish safety, eligibility, or rewards.
- **A4b — All chains in research:** farm step 1 joins the complete chain array. The first attempted build exposed a 632-character step for Steer Protocol's 45 chains; only step 1's introductory wording was shortened to fit every name within the 600-character cap. Its exact “the snapshot proves none of these” caveat, research cost, and duration remain. The plan's primary-chain field, all capital tiers, the six-step structure, and steps 2–6 remain unchanged.

Source changes are limited to `lib/model.ts`, `dashboard/app.js`, and `dashboard/app.css`, plus this report and the requested fresh build outputs. `scripts/validate-build.ts` had no assertions encoding the old sensitivity band and was left unchanged. The core valuation formula, its signals and constants, category shrinkage, candidate selection, `main.ts`, vendor files, and `LICENSE` were not changed. Comparison with the prior build confirmed identical selected slugs, ranks, implied values, existing valuation factors, farm-plan metadata, and farm steps 2–6.

## A5 — Execution and results

The validator accepts two positional output-directory arguments. After the step-length fix, both successful runs used fresh directories inside the project:

```bash
node main.ts --input kit/input/snapshot.json --output revision-output --screenshots kit/starter/screenshots
node main.ts --input kit/input/snapshot.json --output revision-output-repeat --screenshots kit/starter/screenshots
node scripts/validate-build.ts revision-output revision-output-repeat
```

- **Board:** 198 rows; all 40/40 watchlist protocols covered; six farm steps per row.
- **Dossier:** 702,471 bytes, valid vendor output reproduced byte for byte by the original kit builder, within the 1.5 MiB limit.
- **Repeatability:** all nine output files are byte-identical between runs.
- **Additional revision checks:** independently recomputed quartiles, factors, bands, and effective counts for every row; checked even-sized synthetic category/global peer sets, sparse-category fallback, empty-peer fallback, CSS constraints, all chain names, and unchanged valuations/ranks/farm steps 2–6. All passed without editing the project validator or creating additional test files.

Observed sensitivity ratios across all 198 board rows, computed from the emitted integer-dollar bands (values shown to 12 decimal places):

| Ratio | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| `sensitivity_low_usd / implied_value_usd` | 0.193811446946 | 0.193811928539 | 0.630025846851 |
| `sensitivity_high_usd / implied_value_usd` | 1.508399456494 | 4.533655270427 | 7.755352331060 |

The observed ratios include integer-dollar rounding; stored model factors retain the unrounded quartile/median ratios.

## Validator summary — verbatim

```json
{
  "status": "passed",
  "node": "v24.22.1",
  "rows": 198,
  "watchlist_covered": 40,
  "additional_candidates": 158,
  "step_count": 6,
  "min_step_characters": 199,
  "max_step_characters": 598,
  "peer_rows": 119,
  "board_bytes": 524777,
  "dashboard_files": 3,
  "dashboard_bytes": 27086,
  "dossier_bytes": 702471,
  "dossier_text_bytes": 27352,
  "dossier_images": 3,
  "dossier_sha256": "e656242fc259406978eca84937c59d889b16c9fa8d181394d26ad56fefc56624",
  "vendor_identical": true,
  "dossier_matches_kit_builder": true,
  "deterministic_files": 9,
  "model_checks": "passed",
  "dashboard_dom_smoke": "passed",
  "missing_screenshots_fails_before_writes": true,
  "screenshot_status": "unchanged starter fixtures, not captures of this build; replacement required"
}
```

The dossier uses unchanged starter screenshots as permitted test fixtures; fresh captures remain for the later screenshot phase. No screenshots were generated, and no submission, bundle, wallet operation, network request, or git commit was performed.

## Addendum — renderer header comment

Replaced only the first-line comment in `dashboard/app.js` with an original description of the file as an offline renderer for the token radar board. Regenerated `revision-output` and `revision-output-repeat` from fresh directories using the same snapshot and screenshot fixtures. `node scripts/validate-build.ts revision-output revision-output-repeat` **passed**: 198 rows, 40/40 watchlist coverage, and all nine output files byte-identical across runs. The new dossier size is **702,469 bytes**.

Final screenshot run: `node main.ts --input kit/input/snapshot.json --output final-output` used the project `screenshots/` folder; program output confirmed 3 supplied images written, with a final dossier size of **577,821 bytes**.
