// Node 22, standard library only. Local run:
// node main.ts --input kit/input/snapshot.json --output .build/output --screenshots kit/starter/screenshots
// --screenshots selects existing images; it never captures or fabricates one.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier, PLAIN_NAME } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function argumentsOf(args: string[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const match = /^--(input|output|screenshots)(?:=(.*))?$/.exec(args[i]!);
    if (!match) throw new Error(`unknown argument ${args[i]}`);
    const value = match[2] ?? args[++i];
    if (!value || value.startsWith('--')) throw new Error(`--${match[1]} needs a path`);
    if (result[match[1]!]) throw new Error(`--${match[1]} was supplied twice`);
    result[match[1]!] = value;
  }
  return result;
}

function plainTree(root: string): string[] {
  if (!lstatSync(root).isDirectory()) throw new Error(`${root} is not a directory`);
  const files: string[] = [];
  function walk(dir: string, prefix: string): void {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory() && !e.name.startsWith('.')) walk(join(dir, e.name), rel);
      else if (e.isFile() && PLAIN_NAME.test(e.name)) files.push(rel);
      else throw new Error(`${join(root, rel)} is not an allowed regular file or directory`);
    }
  }
  walk(root, '');
  return files;
}

function copyTree(from: string, to: string, files: string[]): void {
  mkdirSync(to, { recursive: true });
  for (const file of files) {
    const target = join(to, file);
    mkdirSync(resolve(target, '..'), { recursive: true });
    copyFileSync(join(from, file), target);
  }
}

function run(): void {
  const args = argumentsOf(process.argv.slice(2));
  const input = resolve(args.input ?? '/input/snapshot.json');
  const inputFile = lstatSync(input).isDirectory() ? join(input, 'snapshot.json') : input;
  const out = resolve(args.output ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const dashboard = join(here, 'dashboard');
  const screenshots = resolve(args.screenshots ?? join(here, 'screenshots'));
  const within = (child: string, parent: string): boolean => child === parent || (!relative(parent, child).startsWith(`..${sep}`) && relative(parent, child) !== '..' && !relative(parent, child).startsWith(sep));
  if (within(out, dashboard) || within(out, screenshots) || within(dashboard, out) || within(screenshots, out) || within(inputFile, out)) {
    throw new Error('output must not overlap the input, dashboard source, or screenshot source');
  }
  // A fresh output prevents stale images or source files from silently entering the dossier.
  if (existsSync(out) && (!lstatSync(out).isDirectory() || readdirSync(out).length)) throw new Error('output must be an empty directory or a new path');

  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(`board refused: ${issue}`);
  const sourceFiles = plainTree(dashboard);
  if (!sourceFiles.includes('index.html') || !sourceFiles.some((p) => p.endsWith('.css')) || !sourceFiles.some((p) => p.endsWith('.js'))) throw new Error('dashboard needs index.html, CSS, and JS');
  if (!existsSync(screenshots)) throw new Error('screenshots are required by buildDossier; provide existing files with --screenshots <directory> (no images are generated)');
  const shots = plainTree(screenshots);
  if (shots.length < 3 || shots.length > 4 || shots.some((p) => basename(p) !== p || !/\.(png|jpe?g)$/i.test(p))) throw new Error('screenshots must contain 3–4 existing PNG/JPEG files at its top level');

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));
  copyTree(dashboard, join(out, 'dashboard'), sourceFiles);
  copyTree(screenshots, join(out, 'screenshots'), shots);
  const dossier = buildDossier(out, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  // The general vendor library permits 4 MiB; this competition permits only 1.5 MiB.
  if (dossier.byteLength > 1.5 * 1024 * 1024) throw new Error('competition dossier exceeds 1.5 MiB');
  writeFileSync(join(out, 'dossier.json'), dossier);
  process.stdout.write(`token radar: ${board.length} rows; ${snapshot.watchlist.length}/${snapshot.watchlist.length} watchlist covered; ${radar.early_size} additional candidates\n`);
  process.stdout.write(`token radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length} supplied images), dossier.json (${dossier.byteLength} bytes) to ${out}\n`);
  if (args.screenshots) process.stdout.write('token radar: external screenshot directory supplied; verify that these images match the generated page before submission\n');
}

try { run(); } catch (error) {
  process.stderr.write(`token radar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
