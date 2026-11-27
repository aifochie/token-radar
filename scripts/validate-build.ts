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
import { median, pricedPeers, quantile } from '../lib/v2.ts';
import { buildV3, dossierProof, economicCase, ECON, fitLogit, fitValue, recordPopulation } from '../lib/v3.ts';
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
  assert.equal(row.implied_value_usd, Math.min(MODEL.max_value_usd, Math.max(1, Math.round(row.value_if_launches_usd * row.token_odds))));
  assert.equal(row.implied_odds_weighted_usd, row.implied_value_usd);
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

// V3: recompute selected models; independently check bands, economics and ledgers.
const peers = pricedPeers(snapshot);
const validation = radar.validation, population = recordPopulation(snapshot);
const valueFit = fitValue(peers, snapshot.as_of, validation.value_terms);
const oddsFit = fitLogit(population, snapshot.as_of, validation.odds_terms);
const dollars = (n: number) => Math.max(1, Math.min(MODEL.max_value_usd, Math.round(n)));
const near = (a: number, b: number) => assert(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`);
assert.deepEqual(ECON, { deposit:10000,drop_share:.07,horizon_weeks:12,capital_apr:.05,risk_free_apr:.04,time_per_hour:15,shares:[.01,.07,.15],deposits:[1000,5000,10000,25000] }, 'frozen ECON must not be tuned to verdicts');
for (const row of rows) {
  assert.equal(row.value_if_launches_usd, valueFit.predict(row));
  near(row.model.decomposition.reduce((n: number, d: any) => n + d.log_effect, 0), valueFit.predictLog(row));
  assert(row.token_odds > 0 && row.token_odds < 1);
  near(row.token_odds, oddsFit.predict(row));
  for (const [q,key] of [[.1,'10'],[.25,'25'],[.75,'75'],[.9,'90']] as const) {
    const conditional = dollars(row.tvl_usd * Math.exp(valueFit.predictLog(row) + quantile(valueFit.residuals,q)));
    assert.equal(row[`value_p${key}_usd`], conditional);
    assert.equal(row[`implied_p${key}_usd`], dollars(conditional * row.token_odds));
  }
  assert.deepEqual(row.economics,economicCase(row));
  assert.equal(row.farm_plan.steps.reduce((n:number,s:any)=>n+s.minutes,0),154);
  for(const [deposit,share,weeks] of [[10000,.07,12],[50000,.15,12],[50000,.25,12],[25000,.105,26]]){
    const s = economicCase(row,deposit,share,weeks), minutes = 70 + weeks * 7;
    const expectedDrop = row.implied_value_usd * share * deposit / (row.tvl_usd + deposit);
    const expectedNet = expectedDrop - 4*row.farm_plan.gas_budget_per_action_usd - deposit*.05*weeks*7/365 - minutes/60*15;
    near(s.expected_drop_usd,expectedDrop);near(s.net_usd,expectedNet);near(s.hurdle_usd,deposit*.04*weeks*7/365);
    near(s.net_per_hour_usd,expectedNet/(minutes/60));assert.equal(s.verdict,expectedNet<=0?'SKIP':expectedNet>s.hurdle_usd?'FARM':'MARGINAL');
  }
  assert.equal(row.verdict,row.economics.verdict);assert.equal(row.net_usd,row.economics.net_usd);
  assert.equal(row.net_per_hour_usd,row.economics.net_per_hour_usd);
  assert(row.nearest_peers.length===6&&row.nearest_peers.every((p:any)=>peers.some(q=>q.slug===p.slug)));
}
for (const [key,temporal] of [['loo',false],['wf',true]] as const) {
  const folds = validation.value_folds[key], summary = validation[temporal?'value_wf':'value_loo'];
  const expectedSlugs = peers.filter(p=>!temporal||peers.filter(q=>p.listed_at&&q.listed_at&&q.listed_at<p.listed_at).length>=24).map(p=>p.slug);
  assert.deepEqual(folds.map((f:any)=>f.slug),expectedSlugs);
  for (const f of folds) {
    const p = peers.find(p=>p.slug===f.slug)!,train = peers.filter(q=>temporal?p.listed_at&&q.listed_at&&q.listed_at<p.listed_at:q.slug!==p.slug);
    assert(!train.some(q=>q.slug===p.slug));assert.equal(f.train_n,train.length);assert.equal(f.actual,p.mcap_usd);
    const fit = fitValue(train,snapshot.as_of,validation.value_terms);
    assert.equal(f.predicted,fit.predict(p));assert.equal(f.baseline,impliedValue(p,snapshot.as_of,calibrate({...snapshot,protocols:train})).implied);
    assert.deepEqual(f.bounds,[.1,.25,.75,.9].map(q=>dollars(p.tvl_usd*Math.exp(fit.predictLog(p)+quantile(fit.residuals,q)))));
  }
  assert.equal(summary.n,folds.length);
  for(const [pred,metric]of [['predicted','fitted_x'],['baseline','v2_x']])assert.equal(summary[metric],median(folds.map((f:any)=>Math.max(f[pred]/f.actual,f.actual/f[pred]))));
  assert(summary.fitted_x<summary.v2_x,'fitted engine must beat v2 on BOTH splits');
  const coverage = validation.coverage[temporal?1:0];assert.equal(coverage.n,folds.length);
  assert.equal(coverage.p25_p75,folds.filter((f:any)=>f.actual>=f.bounds[1]&&f.actual<=f.bounds[2]).length);
  assert.equal(coverage.p10_p90,folds.filter((f:any)=>f.actual>=f.bounds[0]&&f.actual<=f.bounds[3]).length);
}
for(const key of ['loo','ten','wf']){
  const fs=validation.odds_folds[key],summary=validation['odds_'+key];
  assert.equal(fs.length,summary.n);assert.equal(new Set(fs.map((f:any)=>f.slug)).size,fs.length);
  for(const f of fs)assert.equal(f.y,isPreToken(known.get(f.slug)!)?0:1);
  for(const [field,metric]of [['p','brier'],['base','base']])near(summary[metric],fs.reduce((n:number,f:any)=>n+(f.y-f[field])**2,0)/fs.length);
  assert(summary.brier<summary.base);
}
assert.equal(validation.value_ablation.length,7);assert.equal(validation.odds_ablation.length,6);
for(const [table,keys]of [[validation.value_ablation,['loo','wf']],[validation.odds_ablation,['loo','ten','wf']]] as const){
  let kept:any;
  for(const a of table){const pass=!kept||keys.every(k=>a[k]<=kept[k]);assert.equal(a.kept,pass);if(a.kept)kept=a;}
}
const accountingSlugs=Object.values(radar.accounting.groups).flat() as string[];
assert.deepEqual(accountingSlugs.slice().sort(),snapshot.protocols.map(p=>p.slug).sort());
assert.equal(new Set(accountingSlugs).size,snapshot.protocols.length);
assert.equal(Object.values(radar.accounting.counts).reduce((a:any,b:any)=>a+b,0),snapshot.protocols.length);
assert(new Set(rows.map((r:any)=>r.token_odds)).size>1);
assert.equal(radar.provenance.board_sha256,hash(boardBytes));
assert.equal(radar.provenance.main_sha256,hash(bytes(join(root,'main.ts'))));
assert.equal(radar.provenance.model_sha256,hash(bytes(join(root,'lib/v3.ts'))));
assert.equal(radar.provenance.snapshot_sha256,hash(Buffer.from(snapshotText)));
const proof=JSON.parse(text(join(out,'dashboard/proof.json')));
assert.deepEqual(proof,{...dossierProof(snapshot,radar,hash(Buffer.from(snapshotText))),provenance:radar.provenance});
const unpack=(s:string)=>s.split('.').map(s=>s==='-'?null:parseInt(s,36));
for(const key of ['loo','wf'])for(const [i,packed]of proof.value_ledger[key].entries()){
  const f=validation.value_folds[key][i];assert.deepEqual(unpack(packed),[snapshot.protocols.findIndex(p=>p.slug===f.slug),f.actual,f.baseline,f.predicted,...f.bounds]);
}
for(const [i,packed]of proof.odds_ledger.entries()){
  const a=unpack(packed),f=validation.odds_folds.loo[i],ten=validation.odds_folds.ten[i],wf=validation.odds_folds.wf.find((q:any)=>q.slug===f.slug);
  assert.equal(a[0],snapshot.protocols.findIndex(p=>p.slug===f.slug));assert.equal(a[1],f.y);
  assert(Math.abs(a[2]!/1e6-f.p)<=.500001e-6);assert(Math.abs(a[3]!/1e6-ten.p)<=.500001e-6);
  if(wf){assert(Math.abs(a[4]!/1e6-wf.p)<=.500001e-6);assert(Math.abs(a[5]!/1e6-wf.base)<=.500001e-6);}else assert.deepEqual(a.slice(4),[null,null]);
}

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
  if (file === 'model.txt') { const model=text(join(root,'lib/v3.ts'));assert.equal(source,model.slice(0,model.indexOf('const xerror'))+model.slice(model.indexOf('export const ECON'),model.indexOf('export function accountingFor'))); }
  else if (file === 'proof.json') assert.deepEqual(JSON.parse(source),proof);
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
const rebuilt=buildV3({...snapshot,protocols:snapshot.protocols.slice().reverse(),watchlist:snapshot.watchlist.slice().reverse()});
assert.deepEqual(JSON.parse(JSON.stringify(rebuilt.board)),rows,'serialized board/ranks must not depend on input order (JSON normalizes signed zero)');
assert.deepEqual(JSON.parse(JSON.stringify(rebuilt.radar.validation)),validation,'all ablations and folds must independently reproduce');

// Replace the old fixture-only DOM stub with real Puppeteer evidence from scratch.
const browserEvidence = JSON.parse(text(resolve(root, process.argv[4] ?? 'v3-evidence/capture-v3.json')));
assert.equal(browserEvidence.board_sha256, hash(boardBytes));
assert.equal(browserEvidence.data_sha256, hash(bytes(join(out, 'data.js'))));
for (const file of dashboardFiles) assert.equal(browserEvidence.dashboard_sources[file], hash(bytes(join(out, 'dashboard', file))), 'capture source must match this build');
assert.equal(browserEvidence.boardState.top, rows[0].slug);
assert.equal(browserEvidence.boardState.columns, 11);
assert.equal(browserEvidence.boardState.kpis, 6);
assert(browserEvidence.boardState.visibleRows >= 10 && browserEvidence.layout_pass);
assert.deepEqual(browserEvidence.boardState.viewport, [1280, 900]);
assert.deepEqual(browserEvidence.detailQA.failures, []);
assert.equal(browserEvidence.detailQA.details, rows.length);
assert.equal(browserEvidence.detailQA.cells, rows.length * 12);
assert.equal(browserEvidence.detailState.visibleMatrixCells, 12);
assert.equal(browserEvidence.boardState.selected,'Mid');
assert.deepEqual(browserEvidence.boardState.evidenceTables,[7,6,7]);
assert.deepEqual(browserEvidence.boardState.integrity,{totals:true,checksum:true,ledger:true,board_sha256:hash(boardBytes)});
assert.equal(browserEvidence.scenarioQA.comparisons,rows.length*4);
assert.deepEqual(browserEvidence.scenarioQA.grid.map((s:any)=>s.counts),[{FARM:0,MARGINAL:0,SKIP:198},{FARM:16,MARGINAL:86,SKIP:96},{FARM:99,MARGINAL:52,SKIP:47}]);
assert.equal(browserEvidence.controlsQA.customRows,rows.length);
assert(browserEvidence.controlsQA.slidersLive&&browserEvidence.controlsQA.emptySearch&&browserEvidence.controlsQA.category&&browserEvidence.controlsQA.sort);
assert.equal(browserEvidence.controlsQA.pricedCount,peers.length);
assert.deepEqual(Object.keys(browserEvidence.exportsQA),['radar-v3.csv','radar-v3.json','v3-evidence.json']);
assert.deepEqual(browserEvidence.errors, []);
assert.deepEqual(browserEvidence.network, []);
assert.deepEqual(browserEvidence.filterState.rows, rows.filter((r:any)=>economicCase(r,50000,.15,12).verdict==='FARM').map((r:any)=>r.slug));
for (const image of browserEvidence.captures) assert.equal(image.sha256, hash(bytes(join(out, 'screenshots', image.name))));

const missingOutput = join(root, 'build-no-screenshots-check');
assert(!existsSync(missingOutput));
const failure = spawnSync(process.execPath, ['main.ts', '--input', 'kit/input', '--output', 'build-no-screenshots-check', '--screenshots', 'does-not-exist-v3-screenshots'], { cwd: root, encoding: 'utf8' });
assert.equal(failure.status, 1);
assert(failure.stderr.includes('screenshots are required'));
assert(!existsSync(missingOutput), 'missing screenshots must fail before writing partial outputs');

console.log(JSON.stringify({
  status: 'passed', node: process.version,
  rows: rows.length, watchlist_covered: snapshot.watchlist.length, additional_candidates: radar.early_size,
  step_count: rows[0].farm_steps.length,
  min_step_characters: Math.min(...rows.flatMap((r: any) => r.farm_steps.map((s: string) => s.trim().length))),
  max_step_characters: Math.max(...rows.flatMap((r: any) => r.farm_steps.map((s: string) => s.trim().length))),
  peer_rows: peers.length, board_bytes: boardBytes.length,
  dashboard_files: dashboardFiles.length, dashboard_bytes: dashboardBytes,
  dossier_bytes: dossierBytes.length, dossier_text_bytes: Buffer.byteLength(dossier.text),
  dossier_images: dossier.images.length, dossier_sha256: hash(dossierBytes),
  vendor_identical: true, dossier_matches_kit_builder: true, deterministic_files: outputFiles.length,
  model_checks:'passed',engine:validation.selected_engine,value_loo:validation.value_loo,value_wf:validation.value_wf,
  odds_ten:validation.odds_ten,odds_wf:validation.odds_wf,coverage:validation.coverage,scenario_grid:browserEvidence.scenarioQA.grid,
  board_sha256:hash(boardBytes),data_sha256:hash(bytes(join(out,'data.js'))),
  dashboard_browser_qa:'198 details, 2376 matrix cells, 792 scenario comparisons and 3 real downloads',visible_rows:browserEvidence.boardState.visibleRows,
  missing_screenshots_fails_before_writes: true,
  screenshot_status: 'three real 1280x900 Puppeteer captures; current board/source matched',
}, null, 2));
