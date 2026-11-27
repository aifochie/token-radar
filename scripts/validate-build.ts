// Offline integration checks. Run after the two documented main.ts executions.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { inflateSync } from 'node:zlib';
import { ageDays, boardIssue, buildBoard, buildRadar, calibrate, impliedValue, isPreToken, MODEL, parseSnapshot } from '../lib/model.ts';
import { buildV2, economicCase, fitOdds, pricedPeers } from '../lib/v2.ts';
import { buildDossier } from '../vendor/makefun-board.ts';
import { buildDossier as kitDossier } from '../kit/starter/vendor/makefun-board.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, process.argv[2] ?? 'build-output');
const repeat = resolve(root, process.argv[3] ?? 'build-output-repeat');
assert(out.startsWith(root) && repeat.startsWith(root), 'validation paths must stay inside this project');
const bytes = (path: string): Buffer => readFileSync(path);
const text = (path: string): string => readFileSync(path, 'utf8');
const hash = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');
const snapshotText = text(join(root, 'kit/input/snapshot.json'));
const snapshot = parseSnapshot(snapshotText);
const boardBytes = bytes(join(out, 'board.json'));
const { rows } = JSON.parse(boardBytes.toString());
assert(Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000);
assert(boardBytes.length <= 8 * 1024 * 1024);
const known = new Map(snapshot.protocols.map((p) => [p.slug, p]));
const slugs = new Set<string>();
const ranks = new Set<number>();
for (const row of rows) {
  assert(known.has(row.slug) && !slugs.has(row.slug) && /^\S{1,128}$/.test(row.slug));
  slugs.add(row.slug);
  assert(typeof row.name === 'string' && row.name.trim());
  assert(Number.isInteger(row.rank) && row.rank >= 1 && row.rank <= rows.length && !ranks.has(row.rank));
  ranks.add(row.rank);
  assert(Number.isSafeInteger(row.implied_value_usd) && row.implied_value_usd >= 1 && row.implied_value_usd <= 100_000_000_000_000);
  assert(Array.isArray(row.farm_steps) && row.farm_steps.length >= 3 && row.farm_steps.length <= 12);
  for (const step of row.farm_steps) {
    assert(typeof step === 'string' && step.trim().length >= 20 && step.trim().length <= 600);
    assert(step.includes('Cost: ') && step.includes('Time: '));
  }
  assert(isPreToken(known.get(row.slug)!));
  assert.equal(row.age_days, ageDays(snapshot.as_of, row.listed_at));
  assert.equal(row.implied_value_usd, Math.min(MODEL.max_value_usd, Math.max(1, Math.round(row.tvl_usd * row.model.peer_multiple * row.model.growth_multiplier * row.model.maturity_multiplier * row.model.completeness_multiplier))));
}
const ordered = rows.slice().sort((a: any, b: any) => a.rank - b.rank);
for (let i = 1; i < ordered.length; i++) assert(ordered[i].implied_value_usd <= ordered[i - 1].implied_value_usd);
assert(new Set(rows.map((r: any) => r.implied_value_usd)).size > 1);
assert(snapshot.watchlist.every((slug) => slugs.has(slug)));
assert.equal(boardIssue(rows, snapshot), null);

const dataContext: any = { window: {} };
runInNewContext(text(join(out, 'data.js')), dataContext, { timeout: 1000 });
const radar = JSON.parse(JSON.stringify(dataContext.window.RADAR));
assert.deepEqual(radar.rows, rows, 'dashboard data must contain the exact board and farm plans');
assert.equal(radar.watchlist_size, snapshot.watchlist.length);
assert.equal(radar.board_size, rows.length);

// V2: independently recompute observed peer quartiles, hierarchical rates and costs.
const peers = pricedPeers(snapshot);
const oddsFit = fitOdds(snapshot);
const empiricalQuantile = (a: number[], q: number) => a.slice().sort((a, b) => a - b)[Math.ceil(a.length * q) - 1]!;
for (const row of rows) {
  const local = peers.filter(p => (p.category ?? 'Other') === (row.category ?? 'Other'));
  const pool = local.length >= 5 ? local : peers;
  const ratios = pool.map(p => p.mcap_usd! / p.tvl_usd);
  const factor = row.model.growth_multiplier * row.model.maturity_multiplier * row.model.completeness_multiplier;
  assert.equal(row.implied_p25_usd, Math.max(1, Math.round(row.tvl_usd * empiricalQuantile(ratios, .25) * factor)));
  assert.equal(row.implied_p75_usd, Math.max(1, Math.round(row.tvl_usd * empiricalQuantile(ratios, .75) * factor)));
  assert.equal(row.value_range.peer_count, pool.length);
  assert.equal(row.value_range.source, local.length >= 5 ? 'category' : 'pooled (category <5)');
  assert(row.token_odds > 0 && row.token_odds < 1);
  assert.deepEqual(row.odds, oddsFit.estimate(row));
  assert.equal(row.token_odds, (row.odds.priced + row.odds.strength * row.odds.prior) / (row.odds.cohort_n + row.odds.strength));
  const plan = row.farm_plan, e = row.economics;
  assert.equal(plan.steps.reduce((n: number, s: any) => n + s.fee_actions, 0), e.fee_actions);
  assert.equal(plan.steps.reduce((n: number, s: any) => n + s.minutes, 0), e.minutes);
  assert.deepEqual(e, economicCase(row.implied_value_usd, row.token_odds, plan.capital_budget_usd, plan.gas_budget_per_action_usd, plan.observation_days, plan.total_minutes));
  const expectedReward = row.token_odds * row.implied_value_usd * 0.000001 * Math.min(plan.capital_budget_usd / 100, 2);
  const cost = 4 * plan.gas_budget_per_action_usd + plan.capital_budget_usd * .05 * plan.observation_days / 365 + plan.capital_budget_usd * .01 + plan.total_minutes / 60 * 15;
  assert(Math.abs(row.net_usd - (expectedReward - cost)) < 1e-8);
  assert.equal(row.net_per_hour_usd, row.net_usd / (plan.total_minutes / 60));
  assert.equal(row.verdict, row.net_usd <= 0 ? 'SKIP' : row.net_per_hour_usd >= 15 ? 'FARM' : 'MARGINAL');
  assert(row.nearest_peers.length <= 9 && row.nearest_peers.every((p: any) => pool.some(q => q.slug === p.slug)));
  assert.equal(row.rank_best, 1 + rows.filter((q: any) => q.slug !== row.slug && q.implied_p25_usd > row.implied_p75_usd).length);
  assert.equal(row.rank_worst, 1 + rows.filter((q: any) => q.slug !== row.slug && q.implied_p75_usd > row.implied_p25_usd).length);
}
const validation = radar.validation;
const mid = (a: number[]) => { a.sort((a, b) => a - b); return a.length % 2 ? a[a.length >> 1]! : (a[a.length / 2 - 1]! + a[a.length / 2]!) / 2; };
for (const [key, temporal] of [['leave_one_out', false], ['walk_forward', true]] as const) {
  const proof = validation[key];
  const expectedSlugs = peers.filter(p => !temporal || peers.filter(q => p.listed_at && q.listed_at && q.listed_at < p.listed_at).length >= 24).map(p => p.slug);
  assert.deepEqual(proof.folds.map((f: any[]) => f[0]), expectedSlugs);
  for (const [slug, actual, v1, v2, low, high] of proof.folds) {
    const target = peers.find(p => p.slug === slug)!;
    const train = peers.filter(p => temporal ? target.listed_at && p.listed_at && p.listed_at < target.listed_at : p.slug !== slug);
    assert(!train.some(p => p.slug === slug), 'held-out target must never calibrate itself');
    assert.equal(actual, target.mcap_usd);
    assert.equal(v1, impliedValue(target, snapshot.as_of, calibrate({ ...snapshot, protocols: train })).implied);
    // The sealed-input guard retained the exact frozen baseline, not a new model.
    assert.equal(validation.selected_mask, 15);
    assert.equal(v2, v1);
    const local = train.filter(p => p.category === target.category);
    const ratios = (local.length >= 5 ? local : train).map(p => p.mcap_usd! / p.tvl_usd);
    const f = impliedValue(target, snapshot.as_of, calibrate({ ...snapshot, protocols: train })).model;
    const adjust = f.growth_multiplier * f.maturity_multiplier * f.completeness_multiplier;
    assert.equal(low, Math.max(1, Math.round(target.tvl_usd * empiricalQuantile(ratios, .25) * adjust)));
    assert.equal(high, Math.max(1, Math.round(target.tvl_usd * empiricalQuantile(ratios, .75) * adjust)));
  }
  assert.equal(proof.n, proof.folds.length);
  assert.equal(proof.v1_x, mid(proof.folds.map((f: any[]) => Math.max(f[2] / f[1], f[1] / f[2]))));
  assert.equal(proof.v2_x, mid(proof.folds.map((f: any[]) => Math.max(f[3] / f[1], f[1] / f[3]))));
  assert(proof.v2_x <= proof.v1_x, 'non-degradation guard');
  assert.equal(proof.range_hits, proof.folds.filter((f: any[]) => f[1] >= f[4] && f[1] <= f[5]).length);
}
assert.equal(validation.trials.length, 16);
for (const decision of validation.term_decisions) {
  assert(decision.retained);
  assert(decision.without.loo_x > validation.leave_one_out.v1_x || decision.without.walk_x > validation.walk_forward.v1_x);
}
assert.equal(Object.values(radar.accounting).reduce((a: any, b: any) => a + b, 0), snapshot.protocols.length);
assert(new Set(rows.map((r: any) => r.token_odds)).size > 1, 'no hardcoded global odds');

assert(bytes(join(root, 'vendor/makefun-board.ts')).equals(bytes(join(root, 'kit/starter/vendor/makefun-board.ts'))), 'vendor must be byte-identical to the kit');
assert(bytes(join(root, 'LICENSE')).equals(bytes(join(root, 'kit/starter/LICENSE'))));
const dossierBytes = bytes(join(out, 'dossier.json'));
assert(dossierBytes.length <= 1.5 * 1024 * 1024);
assert(dossierBytes.equals(Buffer.from(buildDossier(out, { text_max_bytes: 65_536 }))));
assert(dossierBytes.equals(Buffer.from(kitDossier(out, { text_max_bytes: 65_536 }))), 'the original kit builder must reproduce the same bytes');
const dossier = JSON.parse(dossierBytes.toString());
assert.equal(dossier.schema, 'makefun/dossier/v1');
assert.equal(dossier.cover, 0);
assert(dossier.text.startsWith('## Dashboard\n') && dossier.text.includes('## Source\n'));
assert(Buffer.byteLength(dossier.text) <= 65_536);
assert(!dossier.text.includes('[Cut at'), 'dashboard source must fit in full');
assert(dossier.images.length >= 3 && dossier.images.length <= 4);

function files(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(), 'no symlinks in generated outputs');
    return entry.isDirectory() ? files(join(dir, entry.name), rel) : [rel];
  });
}
const dashboardFiles = files(join(out, 'dashboard'));
assert(dashboardFiles.includes('index.html') && dashboardFiles.some((f) => f.endsWith('.css')) && dashboardFiles.some((f) => f.endsWith('.js')));
assert(dashboardFiles.length <= 400);
let dashboardBytes = 0;
for (const file of dashboardFiles) {
  assert(file.split('/').every((part) => /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(part)));
  const source = text(join(out, 'dashboard', file));
  dashboardBytes += Buffer.byteLength(source);
  if (file === 'model.txt') assert.equal(source, text(join(root, 'lib/v2.ts')));
  else if (file === 'proof.json') assert.deepEqual(JSON.parse(source).validation, validation);
  else assert.equal(source, text(join(root, 'dashboard', file)), 'copied dashboard must match source');
  assert(dossier.text.includes(source.trimEnd()), `dossier must show ${file} whole`);
  if (file.endsWith('.css')) assert(!/https?:\/\//i.test(source));
  if (file.endsWith('.html')) {
    assert(!/\b[\w:-]+\s*=\s*["'][^"']*https?:\/\//i.test(source));
    for (const [, style] of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) assert(!/https?:\/\//i.test(style));
  }
  if (file.endsWith('.js')) assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(|(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']https?:\/\//i.test(source));
}
assert(dashboardBytes <= 64_000, 'use conservative decimal 64KB source limit');

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
for (const image of dossier.images) {
  const imageBytes = bytes(join(out, 'screenshots', image.name));
  assert(imageBytes.equals(bytes(join(root, 'screenshots', image.name))), 'output must copy this build capture');
  const fixture = join(root, 'kit/starter/screenshots', image.name);
  if (existsSync(fixture)) assert(!imageBytes.equals(bytes(fixture)), 'kit fixtures forbidden');
  assert(imageBytes.length >= 60_000 && imageBytes.length <= 512_000);
  assert.equal(image.media_type, 'image/png');
  assert.equal(image.sha256, hash(imageBytes));
  assert.equal(image.base64, imageBytes.toString('base64'));
  assert(imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.equal(imageBytes.toString('ascii', 12, 16), 'IHDR');
  const w = imageBytes.readUInt32BE(16), h = imageBytes.readUInt32BE(20);
  assert(Math.max(w, h) <= 1440 && Math.min(w, h) >= 800);
  assert.equal(w, 1280); assert.equal(h, 900);
  let at = 8, ended = false;
  const compressed: Buffer[] = [];
  while (at < imageBytes.length) {
    assert(at + 12 <= imageBytes.length);
    const length = imageBytes.readUInt32BE(at);
    const type = imageBytes.toString('ascii', at + 4, at + 8);
    assert(at + 12 + length <= imageBytes.length);
    assert.equal(crc32(imageBytes.subarray(at + 4, at + 8 + length)), imageBytes.readUInt32BE(at + 8 + length));
    if (type === 'IDAT') compressed.push(imageBytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
    if (type === 'IEND') { assert.equal(length, 0); ended = true; break; }
  }
  assert(ended && at === imageBytes.length && compressed.length > 0, 'PNG must be whole');
  assert(inflateSync(Buffer.concat(compressed)).length > 0);
}

const outputFiles = files(out);
assert.deepEqual(outputFiles, files(repeat));
for (const file of outputFiles) assert(bytes(join(out, file)).equals(bytes(join(repeat, file))), `nondeterministic output: ${file}`);

// Model behavior: known peers, growth, maturity, missingness, and input order.
const sample = { ...snapshot.protocols[0]!, category: 'Synthetic', tvl_usd: 10_000_000, change_7d: 0, listed_at: '2025-11-14', gecko_id: null, symbol: null };
const syntheticPeers = Array.from({ length: 8 }, (_, i) => ({ ...sample, slug: `peer-${i}`, gecko_id: `token-${i}`, mcap_usd: 10_000_000 }));
const calibration = calibrate({ ...snapshot, protocols: syntheticPeers });
assert.equal(calibration.global_multiple, 1);
assert.equal(calibration.categories.Synthetic!.multiple, 1);
const base = impliedValue(sample, snapshot.as_of, calibration).implied;
assert.equal(base, Math.round(10_000_000 * (0.55 + 0.45 * (1 - Math.exp(-1)))));
assert(impliedValue({ ...sample, change_7d: 50 }, snapshot.as_of, calibration).implied > base);
assert(impliedValue({ ...sample, listed_at: snapshot.as_of }, snapshot.as_of, calibration).implied < base);
assert(impliedValue({ ...sample, change_7d: null }, snapshot.as_of, calibration).implied < base);
assert.equal(impliedValue({ ...sample, change_7d: 1e9 }, snapshot.as_of, calibration).implied, impliedValue({ ...sample, change_7d: 150 }, snapshot.as_of, calibration).implied);
assert(isPreToken({ ...sample, mcap_usd: 100 }), 'token status follows identifiers, not missing market cap');
assert(!isPreToken({ ...sample, symbol: 'TOKEN' }));
assert.equal(ageDays(snapshot.as_of, '2027-01-01'), 0);
assert.equal(ageDays(snapshot.as_of, null), null);
assert.throws(() => parseSnapshot(JSON.stringify({ ...snapshot, as_of: '2026-02-30' })));
assert.throws(() => parseSnapshot(JSON.stringify({ ...snapshot, protocols: [...snapshot.protocols, snapshot.protocols[0]] })));
assert.throws(() => parseSnapshot(JSON.stringify({ ...snapshot, watchlist: ['not-in-the-snapshot'] })));
assert.deepEqual(buildV2({ ...snapshot, protocols: snapshot.protocols.slice().reverse(), watchlist: snapshot.watchlist.slice().reverse() }).board, rows, 'selection and ranks must not depend on input order');
assert.deepEqual(buildV2(snapshot).board, rows);
assert.deepEqual(buildBoard(snapshot).map(r => [r.slug, r.implied_value_usd]), rows.map((r: any) => [r.slug, r.implied_value_usd]), 'v1 point estimates retained by guard');

// Replace the old fixture-only DOM stub with real Puppeteer evidence from scratch.
const browserEvidence = JSON.parse(text(resolve(root, process.argv[4] ?? '../scratch-tr3/evidence/capture-v2.json')));
assert.equal(browserEvidence.board_sha256, hash(boardBytes));
assert.equal(browserEvidence.data_sha256, hash(bytes(join(out, 'data.js'))));
for (const file of dashboardFiles) assert.equal(browserEvidence.dashboard_sources[file], hash(bytes(join(out, 'dashboard', file))), 'capture source must match this build');
assert.equal(browserEvidence.boardState.top, rows[0].slug);
assert.equal(browserEvidence.boardState.columns, 10);
assert.equal(browserEvidence.boardState.kpis, 6);
assert(browserEvidence.boardState.visibleRows >= 10 && browserEvidence.layout_pass);
assert.deepEqual(browserEvidence.boardState.viewport, [1280, 900]);
assert.deepEqual(browserEvidence.detailQA.failures, []);
assert.equal(browserEvidence.detailQA.details, rows.length);
assert.equal(browserEvidence.detailQA.cells, rows.length * 12);
assert.equal(browserEvidence.detailState.visibleMatrixCells, 12);
assert.deepEqual(browserEvidence.errors, []);
assert.deepEqual(browserEvidence.network, []);
assert.deepEqual(browserEvidence.filterState.rows, rows.filter((r: any) => r.verdict === 'FARM').map((r: any) => r.slug));
for (const image of browserEvidence.captures) assert.equal(image.sha256, hash(bytes(join(out, 'screenshots', image.name))));

const missingOutput = join(root, 'build-no-screenshots-check');
assert(!existsSync(missingOutput));
const failure = spawnSync(process.execPath, ['main.ts', '--input', 'kit/input', '--output', 'build-no-screenshots-check', '--screenshots', 'does-not-exist-v2-screenshots'], { cwd: root, encoding: 'utf8' });
assert.equal(failure.status, 1);
assert(failure.stderr.includes('screenshots are required'));
assert(!existsSync(missingOutput), 'missing screenshots must fail before writing partial outputs');

console.log(JSON.stringify({
  status: 'passed', node: process.version,
  rows: rows.length, watchlist_covered: snapshot.watchlist.length, additional_candidates: radar.early_size,
  step_count: rows[0].farm_steps.length,
  min_step_characters: Math.min(...rows.flatMap((r: any) => r.farm_steps.map((s: string) => s.trim().length))),
  max_step_characters: Math.max(...rows.flatMap((r: any) => r.farm_steps.map((s: string) => s.trim().length))),
  peer_rows: radar.calibration.global_peers, board_bytes: boardBytes.length,
  dashboard_files: dashboardFiles.length, dashboard_bytes: dashboardBytes,
  dossier_bytes: dossierBytes.length, dossier_text_bytes: Buffer.byteLength(dossier.text),
  dossier_images: dossier.images.length, dossier_sha256: hash(dossierBytes),
  vendor_identical: true, dossier_matches_kit_builder: true, deterministic_files: outputFiles.length,
  model_checks: 'passed', v2_guard: validation.guard, v1_loo_x: validation.leave_one_out.v1_x, v2_loo_x: validation.leave_one_out.v2_x,
  v1_walk_x: validation.walk_forward.v1_x, v2_walk_x: validation.walk_forward.v2_x,
  dashboard_browser_qa: '198 details and 2376 matrix cells checked by Puppeteer', visible_rows: browserEvidence.boardState.visibleRows,
  missing_screenshots_fails_before_writes: true,
  screenshot_status: 'three real 1280x900 Puppeteer captures; current board/source matched',
}, null, 2));
