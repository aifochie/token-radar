# Token launch radar plan

Based only on `kit/RULES.txt`, `kit/competition.yaml`, and `kit/input/README.md`.

## 1. Required deliverables

- An entrant-owned public GitHub repository and submitted commit, or a source bundle, created at or after opening (`2026-11-14T10:00:00Z`), under an OSI-approved license. Root entrypoint: `main.ts`, Node 22, standard library only; include the kit's `vendor/makefun-board.ts`.
- The program reads `/input/snapshot.json`, writes `/output/board.json` and the dashboard's data, copies `dashboard/` and `screenshots/` into `/output`, and writes `/output/dossier.json` using the vendor's `buildDossier`. Two isolated runs must produce identical bytes, offline, with read-only `/bot`, writable `/output`, 1 CPU, 1,024 MB memory, 64 processes, and 120 seconds per run.
- `dashboard/`: a static, offline page with a board ranked by implied value, farm steps for every row, a detail view for every protocol, and filtering; make the board sortable. Include `index.html`, at least one `.css`, and at least one `.js`; maximum 400 files and 4 MiB. Files must be regular, with 1–128-character names using letters, digits, and `._-`, starting with neither `.` nor `-`; no directory may start with `.`. No HTTP(S) addresses in HTML attributes, HTML style bodies, inline-script imports, CSS files, or JS import/export-from/require/dynamic-import specifiers. Visible text and comments may contain URLs.
- Three actual dashboard screenshots under `screenshots/`: board, protocol detail, and filtered view. The gate accepts 3–4 whole PNG/JPEG images, each a regular file with a dossier-accepted name, at most 512 KiB, long side at most 1,440 px and short side at least 800 px. Target 300–350 KB each to fit the dossier; the first image by name is the public cover.
- Agent build transcripts, bundled or loose, up to 200 MB, with the required run record and context. Preserve genuine harness records; account for at least 30% of counted lines, author at least one `main.ts` line, include at least five assistant turns containing text/thinking, and meaningfully revise a code file across at least two assistant writes. Apply the later `## The transcript gate` rules in `RULES.txt`, including run metadata/context and own-work requirements; handed-over sessions take no paid place.
- For GitHub entry: satisfy ownership (matching account or committed `.makefun/owner.json`), the README's three live competition/repository badges and make.fun link, and GitHub About's make.fun website and `makefun` topic. For source-bundle entry: initialize the fresh repository with the kit before implementation and retain its freshness root/anchor. Submit with the required linked-wallet signature before `2026-12-14T10:00:00Z`; at most five submissions per UTC day and ten total, latest timely receipt is final.

## 2. Phased build plan

1. **Prepare:** confirm Node ≥22.18 and a browser; establish the chosen submission route, license, ownership/freshness, and authentic session recording before implementation.
2. **Model:** use the sealed snapshot's 758 protocols and supplied 40-slug watchlist. Cover every watchlist slug and add at least 60 other snapshot protocols. Derive a transparent implied-value model from TVL, seven-day growth, and age relative to snapshot `as_of`; define null handling, bounds, and deterministic tie-breaking. Distinguish recorded token status and say “records no token”; do not claim issuance, timing, or airdrop eligibility is known.
3. **Farm plans and page:** generate concrete protocol/category-appropriate actions with costs and duration; expose assumptions and model inputs in details. Build a readable, consistently styled offline board with sorting and filtering. Keep dashboard source below the dossier's 65,536-byte text budget where possible.
4. **Package:** implement deterministic `main.ts` output generation; capture the three views from the generated dashboard and finalize dashboard data/screenshots before building the dossier.
5. **Validate and submit:** compare both runs byte for byte; check all seven artifact gates (`dashboard_files`, `board_file`, `sorted_by_value`, `coverage`, `farm_steps`, `screenshots`, `dossier_matches`). Bundle authentic transcripts/context, run the kit's pre-submit checks, and submit the chosen commit/bundle. There is no local judge grade; inspect server development results and iterate within submission limits.

## 3. Exact output formats

### `/output/board.json`

UTF-8 JSON, at most 8 MiB. Preferred container is an object with a `rows` array; a bare row array is also accepted. Extra keys are allowed. Required shape in type notation:

```typescript
type Board = { rows: Row[] };
type Row = {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
};
```

- `rows`: 100–4,000 entries; every watchlist slug must appear.
- `slug`: unique, 1–128 characters, no whitespace, and present in snapshot `protocols`.
- `name`: non-empty string.
- `rank`: positive integer; ranks must be exactly `1..N`, each once.
- `implied_value_usd`: integer dollars in `1..100000000000000`; non-increasing as rank ascends. Values cannot all be equal. Rank, rather than array position, defines order.
- `farm_steps`: 3–12 strings per row, each 20–600 characters after trimming.

### `/output/dossier.json`

Must match **byte for byte** what the kit's `buildDossier('/output', {text_max_bytes: 65536})` writes from the final `dashboard/` and `screenshots/`; maximum 1.5 MiB. The three permitted source documents do not specify JSON member names or a literal serialization schema: use the vendor builder rather than inventing one.

The dossier presents screenshots followed by dashboard source text. That text starts with `## Dashboard` (file count, total bytes, every path and size), then `## Source` (text-file paths, sizes, line counts, and fenced contents in path order). Source extensions: `.html`, `.css`, `.js`, `.json`, `.mjs`, `.svg`, `.md`, `.txt`; other files are listed only. Text is capped at 65,536 UTF-8 bytes: whole files while they fit, then the first overflowing file through the last complete fitting line, an omitted-line notice, and a final omitted-files/bytes summary. The builder refuses invalid/oversized screenshots, non-plain dashboard files, and an oversized dossier.
