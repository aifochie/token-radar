import { readFileSync } from 'node:fs';
import { parseSnapshot, boardIssue } from '../lib/model.ts';
import { buildV3, dossierProof } from '../lib/v3.ts';
import { createHash } from 'node:crypto';
const input = readFileSync(new URL('../kit/input/snapshot.json', import.meta.url));
const s = parseSnapshot(input.toString()), start = performance.now();
const { board, radar } = buildV3(s), v = radar.validation;
console.log(JSON.stringify({ elapsed_seconds: (performance.now() - start) / 1000, board_issue: boardIssue(board, s),
  engine: v.selected_engine, value_loo: v.value_loo, value_wf: v.value_wf, value_ablation: v.value_ablation,
  odds_loo: v.odds_loo, odds_ten: v.odds_ten, odds_wf: v.odds_wf, odds_ablation: v.odds_ablation, coverage: v.coverage,
  rows: board.length, verdicts: Object.fromEntries(['FARM', 'MARGINAL', 'SKIP'].map(k => [k, board.filter(r => r.verdict === k).length])),
  rank1: { slug: board[0].slug, value_if_launches_usd: board[0].value_if_launches_usd, odds: board[0].token_odds, implied: board[0].implied_value_usd, net: board[0].net_usd },
  accounting: radar.accounting, proof_bytes: Buffer.byteLength(JSON.stringify(dossierProof(s, radar, createHash('sha256').update(input).digest('hex')))) }, null, 2));
