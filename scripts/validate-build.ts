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
  assert.equal(source, text(join(root, 'dashboard', file)), 'copied dashboard must match source');
  assert(dossier.text.includes(source.trimEnd()), `dossier must show ${file} whole`);
  if (file.endsWith('.css')) assert(!/https?:\/\//i.test(source));
  if (file.endsWith('.html')) {
    assert(!/\b[\w:-]+\s*=\s*["'][^"']*https?:\/\//i.test(source));
    for (const [, style] of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) assert(!/https?:\/\//i.test(style));
  }
  if (file.endsWith('.js')) assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(|(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']https?:\/\//i.test(source));
}
assert(dashboardBytes < 65_536 && dashboardBytes <= 4 * 1024 * 1024);

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
  assert(imageBytes.equals(bytes(join(root, 'kit/starter/screenshots', image.name))), 'only unchanged starter fixtures may be used during this build');
  assert(imageBytes.length <= 524_288);
  assert.equal(image.media_type, 'image/png');
  assert.equal(image.sha256, hash(imageBytes));
  assert.equal(image.base64, imageBytes.toString('base64'));
  assert(imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  assert.equal(imageBytes.toString('ascii', 12, 16), 'IHDR');
  const w = imageBytes.readUInt32BE(16), h = imageBytes.readUInt32BE(20);
  assert(Math.max(w, h) <= 1440 && Math.min(w, h) >= 800);
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
const peers = Array.from({ length: 8 }, (_, i) => ({ ...sample, slug: `peer-${i}`, gecko_id: `token-${i}`, mcap_usd: 10_000_000 }));
const calibration = calibrate({ ...snapshot, protocols: peers });
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
assert.deepEqual(buildRadar({ ...snapshot, protocols: snapshot.protocols.slice().reverse(), watchlist: snapshot.watchlist.slice().reverse() }).board, rows, 'selection and ranks must not depend on input order');
assert.deepEqual(buildBoard(snapshot), rows);

// A small DOM harness exercises real generated app code, without a browser or captures.
class Element {
  tag: string;
  attrs: Record<string, string> = {};
  children: Element[] = [];
  listeners: Record<string, Array<(event: any) => void>> = {};
  ownText = '';
  className = '';
  value = '';
  open = false;
  selectionStart = 0;
  selectionEnd = 0;
  constructor(tag: string) { this.tag = tag; }
  set textContent(value: string) { this.ownText = String(value); this.children = []; }
  get textContent(): string { return this.ownText + this.children.map((c) => c.textContent).join(''); }
  setAttribute(k: string, v: string): void { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  addEventListener(k: string, callback: (event: any) => void): void { (this.listeners[k] ??= []).push(callback); }
  appendChild(child: Element): Element { this.children.push(child); return child; }
  fire(k: string): void { for (const callback of this.listeners[k] ?? []) callback({ key: '', preventDefault() {} }); }
  focus(): void { document.activeElement = this; }
  setSelectionRange(start: number, end: number): void { this.selectionStart = start; this.selectionEnd = end; }
  showModal(): void { this.open = true; }
  close(): void { this.open = false; this.fire('close'); }
}
function all(node: Element): Element[] { return [node, ...node.children.flatMap(all)]; }
const body = new Element('body');
const app = body.appendChild(new Element('main'));
app.attrs.id = 'board';
const document = {
  body, activeElement: null as Element | null,
  createElement: (tag: string) => new Element(tag),
  createTextNode: (value: string) => { const node = new Element('#text'); node.textContent = value; return node; },
  getElementById: (id: string) => all(body).find((node) => node.attrs.id === id)!,
};
const window: any = { RADAR: radar, location: { hash: '', pathname: '/dashboard/index.html', search: '' }, addEventListener() {} };
window.history = { replaceState(_state: unknown, _title: string, url: string) { window.location.hash = url.startsWith('#') ? url : ''; } };
runInNewContext(text(join(out, 'dashboard/app.js')), { window, document, URLSearchParams }, { timeout: 2000 });
const visibleRows = () => all(app).find((node) => node.tag === 'tbody')?.children ?? [];
assert.equal(visibleRows().length, rows.length);
assert.equal(visibleRows()[0]!.attrs['data-slug'], rows[0].slug);
const clickButton = (label: string): void => { const button = all(body).find((node) => node.tag === 'button' && node.textContent === label); assert(button, `button not found: ${label}`); button.fire('click'); };
clickButton('Protocol');
assert.equal(visibleRows()[0]!.attrs['data-slug'], rows.slice().sort((a: any, b: any) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.slug < b.slug ? -1 : 1)[0].slug);
const search = document.getElementById('q');
search.value = 'Lending'; search.selectionStart = 7; search.selectionEnd = 7; search.fire('input');
assert(visibleRows().length > 0 && visibleRows().length < rows.length);
assert.equal(document.activeElement, document.getElementById('q'));
const emptySearch = document.getElementById('q');
emptySearch.value = 'no-such-protocol-xyz'; emptySearch.fire('input');
assert(app.textContent.includes('No protocol matches that filter'));
clickButton('Clear filters');
const category = document.getElementById('category');
category.value = rows[0].category || 'Other'; category.fire('change');
assert.equal(visibleRows().length, rows.filter((r: any) => (r.category || 'Other') === category.value).length);
const first = visibleRows()[0]!;
const selected = rows.find((r: any) => r.slug === first.attrs['data-slug']);
first.fire('click');
const dialog = document.getElementById('detail');
assert(dialog.open && dialog.textContent.includes(selected.name));
assert.equal(all(dialog).filter((node) => node.tag === 'li').length, selected.farm_steps.length);
assert(dialog.textContent.includes('matching board.json.'));
for (const [i, step] of all(dialog).filter((node) => node.tag === 'li').entries()) assert.equal(step.children.map((c) => c.textContent).join(' '), selected.farm_steps[i]);
clickButton('Close'); assert(!dialog.open);
clickButton('Recorded token'); assert.equal(visibleRows().length, radar.live.length);

const missingOutput = join(root, 'build-no-screenshots-check');
assert(!existsSync(missingOutput));
const failure = spawnSync(process.execPath, ['main.ts', '--input', 'kit/input', '--output', 'build-no-screenshots-check'], { cwd: root, encoding: 'utf8' });
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
  model_checks: 'passed', dashboard_dom_smoke: 'passed', missing_screenshots_fails_before_writes: true,
  screenshot_status: 'unchanged starter fixtures, not captures of this build; replacement required',
}, null, 2));
