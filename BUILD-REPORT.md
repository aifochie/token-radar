# Build report — token-radar-01

Build and local validation completed on 2026-11-26, entirely inside this project, using Node v24.22.1 (the entry targets Node 22.18+; no dependencies are installed).

## Files created

- `main.ts`: starter-based entrypoint with default `/input/snapshot.json` → `/output` I/O, local path overrides, board validation, dashboard/data output, copying of supplied screenshots, and vendor dossier generation.
- `lib/model.ts`: original peer-calibrated valuation, candidate selection, missing-data handling, deterministic ranking, and category-specific conditional farm plans.
- `vendor/makefun-board.ts` and `LICENSE`: byte-identical copies of the starter files.
- `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js`: adapted starter page with search, category filters, sortable values, separate recorded-token examples, and protocol details that display the exact board farm steps and model factors.
- `scripts/validate-build.ts`: offline artifact, repeatability, model-behavior, image-integrity, and dashboard DOM checks.
- `.gitignore`: excludes the two local output directories from version control.
- `BUILD-REPORT.md`: this report. Existing `PLAN.md` and the kit were not modified.

## Execution

Ran these commands from the project root:

```bash
node main.ts --input kit/input/snapshot.json --output build-output --screenshots kit/starter/screenshots
MAKEFUN_OUTPUT_DIR=build-output-repeat node main.ts --input kit/input --screenshots kit/starter/screenshots
node scripts/validate-build.ts
```

Each output directory contains `board.json`, `data.js`, `dossier.json`, the three dashboard files under `dashboard/`, and copies of the three existing starter images under `screenshots/`. Preview the generated page at `build-output/dashboard/index.html`; the source page expects generated data beside its directory.

## Results

| Check | Result |
| --- | --- |
| `board.json` row count | **198**: all 40 watchlist entries and 158 additional candidates |
| Required row data | Every row has a positive integer implied value and six farm steps |
| Farm-step lengths | 232–388 characters after trimming; all include costs and duration |
| Slugs, ranks, ordering | Unique snapshot slugs; ranks 1–198; non-increasing implied values; values differ |
| Board size | 510,135 bytes; below 8 MiB |
| Valuation peers | 119 token-bearing snapshot rows with positive reported market caps |
| Dashboard | 3 files, 24,161 bytes; local assets only; complete source fits the dossier |
| `dossier.json` validity | **Valid JSON**, schema `makefun/dossier/v1`; exactly reproducible by both the copied vendor and original kit builder with `{text_max_bytes: 65536}` |
| Dossier size | 699,466 bytes; below the competition's 1.5 MiB limit |
| Dossier source text | 24,425 UTF-8 bytes; no source truncation |
| Fixture image checks | 3 unchanged PNGs; size/dimensions, chunk CRCs, compressed image data, and embedded hashes checked |
| Determinism | All 9 generated files match byte for byte across both runs |
| Model and page behavior | Passed peer-calibration, growth/age/missingness, input-order, malformed-input, search, category, sort, detail, and recorded-token-view checks |

Dossier SHA-256: `4bddf89f80230be4bffe1d8f4743381b731f4d05113b1cc32bd99d5167e4812f`.

## Model and deviations

The model blends category and global medians of clipped market-cap/TVL ratios, applies square-root seven-day growth and saturating listing-age factors, and discounts missing data. Watchlist inclusion is mandatory; other eligible protocols compete by modeled value, with slug tie-breaks. The target is 200 rows, but the current exclusions leave 198 eligible protocols, still above the required 100. Listing age is a proxy; no token launch or reward eligibility is asserted. Farm actions, capital ceilings, gas budgets, and observation periods are conditional estimates derived from snapshot categories and chains, not verified live integrations.

The first run found a negative market-cap sentinel (`-1`) in the sealed input. The parser was revised to preserve such integer records while excluding nonpositive market caps from peer calibration; the subsequent runs and validation passed.

**Screenshot phase deferred as requested.** No screenshots were captured, rendered, or synthesized. The vendor refuses missing/empty screenshots, so local runs explicitly reuse the three supplied starter images as test fixtures. Their copies and embedded dossier images show the starter, not this build. The dossier is valid vendor output, but it is **not ready for submission** until those fixtures are replaced with actual board, detail, and filtered-view captures of this dashboard. No root `screenshots/` directory was created; without `--screenshots`, the entry expects that directory for the later screenshot phase and fails clearly before writing outputs if it is absent.

Validation used a lightweight DOM harness, not a real-browser layout review. No server grade, submission, wallet operation, authentication, or network request was performed.
