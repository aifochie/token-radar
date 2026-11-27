import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { economicCase } from '../lib/v3.ts';
const out = resolve(process.argv[2] ?? 'v3-preview'), context: any = { window: {} };
runInNewContext(readFileSync(join(out, 'data.js'), 'utf8'), context);
const d = context.window.RADAR;
const files = Object.fromEntries(readdirSync(join(out, 'dashboard')).map(f => [f, readFileSync(join(out, 'dashboard', f)).length]));
console.log(JSON.stringify({ source_files: files, total: Object.values(files).reduce((a, b) => a + b, 0),
  scenarios: [[10000,.07],[50000,.15],[50000,.25]].map(([dep, share]) => ({deposit:dep,share,counts:Object.fromEntries(['FARM','MARGINAL','SKIP'].map(k=>[k,d.rows.filter((r:any)=>economicCase(r,dep,share,12).verdict===k).length]))})),
  provenance:d.provenance, source_sha256:createHash('sha256').update(readFileSync('lib/v3.ts')).digest('hex') }, null, 2));
