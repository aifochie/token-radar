// V3: fitted log cap/TVL, ridge record-classification logit, train-only residual bands.
// Fixed penalties/transforms; listing order is a snapshot diagnostic, never history.
import { ageDays, buildBoard, calibrate, farmSteps, impliedValue, isPreToken, isRankable, MODEL, stepText } from './model.ts';
import { components, median, pricedPeers, quantile } from './v2.ts';
import type { Snapshot, SnapshotProtocol as P } from './model.ts';
const clip = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const usd = (x: number) => clip(Math.round(x), 1, MODEL.max_value_usd);
const cat = (p: P) => p.category ?? 'Other';
export const family = (p: P) => p.gecko_id ?? p.slug.replace(/-(?:v\d+(?:-\d+)?|\d+-\d+)$/i, '');
const target = (p: P) => Math.log(p.mcap_usd! / p.tvl_usd);
const dot = (a: number[], b: number[]) => a.reduce((n, x, i) => n + x * b[i]!, 0);
const sigmoid = (x: number) => 1 / (1 + Math.exp(-clip(x, -30, 30)));
const mean = (a: number[]) => a.reduce((n, x) => n + x, 0) / a.length;
const rounded = (x: number) => Number(x.toFixed(6));
export const VALUE_TERMS = ['intercept', 'size curve', 'category', 'family', 'growth', 'maturity', 'completeness'];
export const ODDS_TERMS = ['intercept', 'log listed years', 'log TVL', 'growth 7d', 'chain count', 'category token share'];
export const LIMITATION = 'Single sealed cross-section. Listing-ordered walk-forward is not a historical backtest. Listing age is not token-free lifetime. Shared tokens, censoring, missing caps and selection bias remain. Term selection reuses these splits; no independent test or launch calibration.';

function valueFeatures(p: P, asOf: string, terms: string[]): Record<string, number> {
  const f: Record<string, number> = { intercept: 1 }, size = Math.log(p.tvl_usd / 1e8) / 2;
  if (terms.includes('size curve')) { f.size = size; f.size2 = size * size; }
  if (terms.includes('category')) f['category:' + cat(p)] = 1;
  if (terms.includes('family')) f['family:' + family(p)] = 1;
  const c = components(p, asOf);
  for (const term of ['growth', 'maturity', 'completeness']) if (terms.includes(term)) f[term] = Math.log(c[term as keyof typeof c]);
  return f;
}

// Weighted ridge solved by cyclic coordinate descent, with four Huber IRLS passes.
// Robust log loss serves the median multiplicative-error objective; no ratio clipping.
export function fitValue(train: P[], asOf: string, terms: string[]) {
  const fs = train.map(p => valueFeatures(p, asOf, terms));
  const names = [...new Set(fs.flatMap(f => Object.keys(f)))].sort();
  const columns = names.map(k => fs.map((f, i) => [i, f[k] ?? 0]).filter(a => a[1] !== 0));
  const penalty = names.map(k => k === 'intercept' ? 0 : k.startsWith('category:') ? 8 : k.startsWith('family:') ? 12 : 2);
  const beta = names.map(() => 0), y = train.map(target), residual = y.slice(), weights = y.map(() => 1);
  for (let pass = 0; pass < 4; pass++) {
    for (let iteration = 0; iteration < 100; iteration++) {
      let delta = 0;
      for (let j = 0; j < names.length; j++) {
        const col = columns[j]!, old = beta[j]!;
        let num = 0, den = penalty[j]!;
        for (const [i, x] of col) { num += weights[i]! * x! * (residual[i]! + x! * old); den += weights[i]! * x! * x!; }
        const next = den ? num / den : 0, d = next - old;
        beta[j] = next; delta = Math.max(delta, Math.abs(d));
        for (const [i, x] of col) residual[i]! -= x! * d;
      }
      if (delta < 1e-7) break;
    }
    for (let i = 0; i < y.length; i++) weights[i] = Math.min(1, 1.5 / Math.max(1e-12, Math.abs(residual[i]!)));
  }
  function decompose(p: P) {
    const f = valueFeatures(p, asOf, terms);
    return terms.map(term => ({ term, log_effect: names.reduce((n, k, j) => n + ((term === 'size curve' ? k === 'size' || k === 'size2' : term === 'category' || term === 'family' ? k.startsWith(term + ':') : k === term) ? beta[j]! * (f[k] ?? 0) : 0), 0) }));
  }
  const predictLog = (p: P) => { const f = valueFeatures(p, asOf, terms); return names.reduce((n, k, i) => n + beta[i]! * (f[k] ?? 0), 0); };
  const residuals = train.map(p => target(p) - predictLog(p));
  return { terms, names, beta, residuals, predictLog, decompose, predict: (p: P) => usd(p.tvl_usd * Math.exp(predictLog(p))) };
}

// Ridge logistic Newton iterations, six or fewer coefficients; pivoted linear solve.
function solve(a: number[][], b: number[]) {
  const m = a.map((r, i) => [...r, b[i]!]), n = b.length;
  for (let j = 0; j < n; j++) {
    let pivot = j;
    for (let i = j + 1; i < n; i++) if (Math.abs(m[i]![j]!) > Math.abs(m[pivot]![j]!)) pivot = i;
    [m[j], m[pivot]] = [m[pivot]!, m[j]!];
    const d = m[j]![j]!;
    if (Math.abs(d) < 1e-12) throw new Error('singular logit ridge');
    for (let k = j; k <= n; k++) m[j]![k]! /= d;
    for (let i = 0; i < n; i++) if (i !== j) { const f = m[i]![j]!; for (let k = j; k <= n; k++) m[i]![k]! -= f * m[j]![k]!; }
  }
  return m.map(r => r[n]!);
}
export function recordPopulation(s: Snapshot) {
  return s.protocols.filter(p => p.category !== 'CEX' && (isPreToken(p) || (p.mcap_usd ?? 0) > 0)).sort((a, b) => a.slug.localeCompare(b.slug));
}
const label = (p: P) => isPreToken(p) ? 0 : 1;
export function fitLogit(train: P[], asOf: string, terms: string[]) {
  const base = mean(train.map(label)), counts = new Map<string, number[]>();
  for (const p of train) { const v = counts.get(cat(p)) ?? [0, 0]; v[0]! += label(p); v[1]!++; counts.set(cat(p), v); }
  function features(p: P, training = false) {
    const [k, n] = counts.get(cat(p)) ?? [0, 0], omit = training ? 1 : 0;
    const prior = training ? (base * train.length - label(p)) / Math.max(1, train.length - 1) : base;
    const share = (k! - (training ? label(p) : 0) + 8 * prior) / (n! - omit + 8);
    const values: Record<string, number> = { intercept: 1,
      'log listed years': Math.log1p((ageDays(asOf, p.listed_at) ?? 0) / 365),
      'log TVL': Math.log(p.tvl_usd / 1e8) / 2,
      'growth 7d': Math.log1p(clip(p.change_7d ?? 0, -60, 150) / 100),
      'chain count': Math.log1p(p.chains.length), 'category token share': share };
    return terms.map(t => values[t]!);
  }
  const xs = train.map(p => features(p, true)), ys = train.map(label), d = terms.length;
  const beta = terms.map((_, i) => i ? 0 : Math.log((base + 1e-6) / (1 - base + 1e-6)));
  for (let it = 0; it < 25; it++) {
    const h = Array.from({ length: d }, () => Array(d).fill(0)), g = Array(d).fill(0);
    for (let i = 0; i < train.length; i++) {
      const x = xs[i]!, p = sigmoid(dot(x, beta)), w = Math.max(1e-7, p * (1 - p));
      for (let j = 0; j < d; j++) { g[j] += x[j]! * (ys[i]! - p); for (let k = 0; k < d; k++) h[j]![k] += w * x[j]! * x[k]!; }
    }
    for (let j = 0; j < d; j++) { const penalty = j ? 2 : 1e-6; h[j]![j] += penalty; g[j] -= penalty * beta[j]!; }
    const step = solve(h, g);
    for (let j = 0; j < d; j++) beta[j]! += clip(step[j]!, -2, 2);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return { base, terms, beta, predict: (p: P) => sigmoid(dot(features(p), beta)),
    decompose: (p: P) => features(p).map((x, i) => ({ term: terms[i], feature: x, coefficient: beta[i], log_effect: x * beta[i]! })) };
}

const xerror = (a: number, b: number) => Math.max(a / b, b / a);
function valueFolds(peers: P[], asOf: string, terms: string[], temporal: boolean) {
  return peers.flatMap(p => {
    const train = peers.filter(q => temporal ? p.listed_at && q.listed_at && q.listed_at < p.listed_at : p.slug !== q.slug);
    if (train.length < 24) return [];
    const fit = fitValue(train, asOf, terms), predicted = fit.predict(p), log = fit.predictLog(p);
    const bounds = [.1, .25, .75, .9].map(q => usd(p.tvl_usd * Math.exp(log + quantile(fit.residuals, q))));
    const baseline = impliedValue(p, asOf, calibrate({ as_of: asOf, protocols: train, floor_usd: 5e7, source: '', watchlist: [] })).implied;
    return [{ slug: p.slug, actual: p.mcap_usd!, predicted, baseline, bounds, train_n: train.length }];
  });
}
const valueScore = (f: ReturnType<typeof valueFolds>) => median(f.map(x => xerror(x.predicted, x.actual)));
function hashFold(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 10; }
function oddsFolds(pop: P[], asOf: string, terms: string[], mode: string) {
  const cache = new Map<number, ReturnType<typeof fitLogit>>();
  return pop.flatMap(p => {
    const f = hashFold(p.slug), train = pop.filter(q => mode === 'wf' ? p.listed_at && q.listed_at && q.listed_at < p.listed_at : mode === 'ten' ? hashFold(q.slug) !== f : q.slug !== p.slug);
    if (train.length < (mode === 'wf' ? 48 : 24)) return [];
    let fit = mode === 'ten' ? cache.get(f) : undefined;
    if (!fit) { fit = fitLogit(train, asOf, terms); if (mode === 'ten') cache.set(f, fit); }
    return [{ slug: p.slug, y: label(p), p: fit.predict(p), base: fit.base, train_n: train.length }];
  });
}
const brier = (f: ReturnType<typeof oddsFolds>, base = false) => mean(f.map(x => (x.y - (base ? x.base : x.p)) ** 2));

// Forward inclusion: every candidate is shown, rejected terms do not enter later fits.
export function evaluate(s: Snapshot) {
  const peers = pricedPeers(s), pop = recordPopulation(s), valueAblation: any[] = [], oddsAblation: any[] = [];
  let vt = ['intercept'], ot = ['intercept'], vs: any, os: any;
  for (const term of VALUE_TERMS) {
    const terms = term === 'intercept' ? vt : [...vt, term];
    const loo = valueFolds(peers, s.as_of, terms, false), wf = valueFolds(peers, s.as_of, terms, true);
    const row = { term, terms, loo: valueScore(loo), wf: valueScore(wf), kept: !vs || (valueScore(loo) <= vs.loo && valueScore(wf) <= vs.wf) };
    valueAblation.push(row); if (row.kept) { vt = terms; vs = row; }
  }
  for (const term of ODDS_TERMS) {
    const terms = term === 'intercept' ? ot : [...ot, term];
    const loo = oddsFolds(pop, s.as_of, terms, 'loo'), ten = oddsFolds(pop, s.as_of, terms, 'ten'), wf = oddsFolds(pop, s.as_of, terms, 'wf');
    const row = { term, terms, loo: brier(loo), ten: brier(ten), wf: brier(wf), kept: !os || (brier(loo) <= os.loo && brier(ten) <= os.ten && brier(wf) <= os.wf) };
    oddsAblation.push(row); if (row.kept) { ot = terms; os = row; }
  }
  const loo = valueFolds(peers, s.as_of, vt, false), wf = valueFolds(peers, s.as_of, vt, true);
  const ol = oddsFolds(pop, s.as_of, ot, 'loo'), ten = oddsFolds(pop, s.as_of, ot, 'ten'), ow = oddsFolds(pop, s.as_of, ot, 'wf');
  const baseline = (f: typeof loo) => median(f.map(x => xerror(x.baseline, x.actual)));
  const fitted = valueScore(loo) < baseline(loo) && valueScore(wf) < baseline(wf);
  const valueSummary = (f: typeof loo) => ({ n: f.length, fitted_x: valueScore(f), v2_x: baseline(f) });
  const oddsSummary = (f: typeof ol) => ({ n: f.length, brier: brier(f), base: brier(f, true) });
  const coverage = [loo, wf].map((folds, i) => ({ split: i ? 'walk-forward' : 'LOO', n: folds.length,
    p25_p75: folds.filter(f => f.actual >= f.bounds[1]! && f.actual <= f.bounds[2]!).length,
    p10_p90: folds.filter(f => f.actual >= f.bounds[0]! && f.actual <= f.bounds[3]!).length }));
  return { fitted, selected_engine: fitted ? 'FITTED RIDGE' : 'V2 RETAINED — FITTED FAILED GUARD', value_terms: vt, odds_terms: ot,
    value_ablation: valueAblation, odds_ablation: oddsAblation, value_loo: valueSummary(loo), value_wf: valueSummary(wf),
    odds_loo: oddsSummary(ol), odds_ten: oddsSummary(ten), odds_wf: oddsSummary(ow), coverage,
    value_folds: { loo, wf }, odds_folds: { loo: ol, ten, wf: ow }, limitation: LIMITATION,
    selection: 'Fixed forward order; keep only if neither LOO nor WF worsens (odds also ten-fold). Validation reused for selection; optimistic diagnostics.',
    warmup: { value: 24, odds: 48 }, missing_dates: { value: peers.filter(p => !p.listed_at).length, odds: pop.filter(p => !p.listed_at).length } };
}

export const ECON = { deposit: 10_000, drop_share: .07, horizon_weeks: 12, capital_apr: .05, risk_free_apr: .04,
  time_per_hour: 15, shares: [.01, .07, .15], deposits: [1000, 5000, 10000, 25000] };
export function economicCase(r: any, deposit = ECON.deposit, share = ECON.drop_share, weeks = ECON.horizon_weeks) {
  const days = weeks * 7, minutes = 70 + weeks * 7, fees = 4 * r.farm_plan.gas_budget_per_action_usd;
  const drop = r.implied_value_usd * share * deposit / (r.tvl_usd + deposit);
  const capital = deposit * ECON.capital_apr * days / 365, time = minutes / 60 * ECON.time_per_hour;
  const hurdle = deposit * ECON.risk_free_apr * days / 365, net = drop - fees - capital - time;
  return { deposit_usd: deposit, drop_share: share, horizon_weeks: weeks, expected_drop_usd: drop, fees_usd: fees,
    capital_charge_usd: capital, time_cost_usd: time, minutes, hurdle_usd: hurdle, net_usd: net, net_per_hour_usd: net / (minutes / 60),
    verdict: net <= 0 ? 'SKIP' : net > hurdle ? 'FARM' : 'MARGINAL' };
}

export function accountingFor(s: Snapshot, selected: Set<string>) {
  const groups: Record<string, string[]> = {};
  for (const p of s.protocols) {
    let group = selected.has(p.slug) ? 'ranked no-token' : !isPreToken(p) ? ((p.mcap_usd ?? 0) > 0 && p.category !== 'CEX' ? 'priced peers' : 'recorded / unpriced or CEX') :
      /^(Bridge|Canonical Bridge)$/.test(cat(p)) ? 'bridge' : /^(Liquid Staking|Liquid Restaking|Restaked BTC)$/.test(cat(p)) ? 'liquid staking / restaking' :
      p.category === 'CEX' || /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name) ? 'exchange' :
      /\b(wrapped|staked|staking)\b/i.test(p.name) || /\s(v\d+(\.\d+)?|\d+\.\d+)$/i.test(p.name) ? 'wrapped / versioned' :
      p.tvl_usd >= s.floor_usd && !s.watchlist.includes(p.slug) ? 'off-list / parent unknown' : isRankable(p) ? 'eligible outside board cap' : 'other exclusion';
    (groups[group] ??= []).push(p.slug);
  }
  return { groups, counts: Object.fromEntries(Object.entries(groups).map(([k, a]) => [k, a.length])), note: 'Mutually exclusive priority groups. parentProtocol is absent: off-list / parent unknown is a supplied-list discrepancy, not a proven parent exclusion. Below-floor parents cannot be identified.' };
}

export function buildV3(s: Snapshot) {
  const validation = evaluate(s), peers = pricedPeers(s), pop = recordPopulation(s);
  const fit = fitValue(peers, s.as_of, validation.value_terms), odds = fitLogit(pop, s.as_of, validation.odds_terms);
  const old = new Map(buildBoard(s).map(r => [r.slug, r]));
  let rows = s.protocols.filter(p => s.watchlist.includes(p.slug) || isRankable(p)).map(p => {
    const baseline = old.get(p.slug) ?? { ...p, ...impliedValue(p, s.as_of, calibrate(s)) };
    const value = validation.fitted ? fit.predict(p) : (baseline as any).implied_value_usd ?? (baseline as any).implied;
    const probability = odds.predict(p), implied = usd(value * probability), log = fit.predictLog(p);
    const bounds = [.1, .25, .75, .9].map(q => usd(p.tvl_usd * Math.exp(log + quantile(fit.residuals, q))));
    const age = ageDays(s.as_of, p.listed_at), farm = farmSteps(p, age);
    const minutes = [20, 10, 15, ECON.horizon_weeks * 7, 15, 10], types = ['VERIFY', 'BUDGET', 'ACTION', 'MONITOR', 'EXIT', 'RECORD'];
    const steps = farm.steps.map((step, i) => ({ type: types[i], text: step.text.replaceAll('$' + farm.plan.capital_budget_usd, '$10,000').replaceAll(String(farm.plan.observation_days) + ' days', '84 days'),
      cost: i === 2 || i === 4 ? `$${2 * farm.plan.gas_budget_per_action_usd} fee ceiling; $10,000 scenario capital at risk` : '$0 fees for read-only work', time: `${minutes[i]} minutes`, minutes: minutes[i] }));
    const row: any = { ...p, age_days: age, token_status: 'no token recorded', watchlist: s.watchlist.includes(p.slug), rank: 0,
      value_if_launches_usd: value, token_odds: probability, odds_label: 'priced-token record classification; not launch probability',
      implied_value_usd: implied, implied_odds_weighted_usd: implied,
      value_p10_usd: bounds[0], value_p25_usd: bounds[1], value_p75_usd: bounds[2], value_p90_usd: bounds[3],
      implied_p10_usd: usd(bounds[0]! * probability), implied_p25_usd: usd(bounds[1]! * probability), implied_p75_usd: usd(bounds[2]! * probability), implied_p90_usd: usd(bounds[3]! * probability),
      model: { engine: validation.selected_engine, decomposition: fit.decompose(p), log_multiple: log, family: family(p),
        odds_decomposition: odds.decompose(p), residual_quantiles: [.1, .25, .75, .9].map(q => quantile(fit.residuals, q)) },
      nearest_peers: peers.map(q => ({ slug: q.slug, name: q.name, category: q.category, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd, multiple: q.mcap_usd! / q.tvl_usd,
        distance: Math.abs(Math.log(q.tvl_usd / p.tvl_usd)) + (cat(q) === cat(p) ? 0 : 1) })).sort((a, b) => a.distance - b.distance || a.slug.localeCompare(b.slug)).slice(0, 6),
      farm_plan: { ...farm.plan, capital_budget_usd: ECON.deposit, observation_days: 84, total_minutes: minutes.reduce((a, b) => a + b, 0), steps }, farm_steps: steps.map(stepText) };
    const e = economicCase(row); return { ...row, economics: e, verdict: e.verdict, net_usd: e.net_usd, net_per_hour_usd: e.net_per_hour_usd };
  }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  const chosen = new Set(s.watchlist);
  for (const r of rows) { if (chosen.size >= Math.max(200, s.watchlist.length)) break; chosen.add(r.slug); }
  rows = rows.filter(r => chosen.has(r.slug)).map((r, i) => ({ ...r, rank: i + 1 }));
  const accounting = accountingFor(s, new Set(rows.map(r => r.slug)));
  const radar = { model_version: 'latent-magnet-v3', as_of: s.as_of, rows, live: peers, board_size: rows.length, watchlist_size: s.watchlist.length,
    early_size: rows.filter(r => !r.watchlist).length, universe_size: s.protocols.length, validation, accounting, econ: ECON,
    odds_model: { label: 'Priced-token record classification — NOT a launch forecast', positives: peers.length, controls: pop.length - peers.length,
      excluded: s.protocols.length - pop.length, terms: odds.terms, coefficients: odds.beta, pooled_rate: odds.base },
    value_model: { terms: fit.terms, coefficients: Object.fromEntries(fit.names.map((n, i) => [n, fit.beta[i]])), residual_quantiles: [.1, .25, .75, .9].map(q => quantile(fit.residuals, q)) } };
  return { board: rows, radar };
}

// Compact dossier ledger: all fold targets retained, indices refer to sealed slug order.
// Rich exact ledgers also remain in root data.js for browser inspection/export.
export function dossierProof(s: Snapshot, radar: ReturnType<typeof buildV3>['radar'], sha: string) {
  const v = radar.validation, index = new Map(s.protocols.map((p, i) => [p.slug, i]));
  return { snapshot_sha256: sha, engine: v.selected_engine, selection: v.selection, limitation: LIMITATION,
    value_ablation: v.value_ablation, odds_ablation: v.odds_ablation, value_loo: v.value_loo, value_wf: v.value_wf,
    odds_loo: v.odds_loo, odds_ten: v.odds_ten, odds_wf: v.odds_wf, coverage: v.coverage,
    ledger_schema: { value: '[snapshot index, actual cap, v2 cap, fitted cap, P10, P25, P75, P90]', odds: '[snapshot index, y, LOO p, ten-fold p, WF p or null, WF base or null]' },
    value_ledger: Object.fromEntries(Object.entries(v.value_folds).map(([k, fs]) => [k, fs.map(f => [index.get(f.slug), f.actual, f.baseline, f.predicted, ...f.bounds])])),
    odds_ledger: v.odds_folds.loo.map((f, i) => { const ten = v.odds_folds.ten[i]!, wf = v.odds_folds.wf.find(q => q.slug === f.slug); return [index.get(f.slug), f.y, rounded(f.p), rounded(ten.p), wf ? rounded(wf.p) : null, wf ? rounded(wf.base) : null]; }),
    odds_schema_precision: 'probabilities rounded to 6 decimals in dossier only; exact values/LOO and ten-fold bases plus training counts in data.js',
    accounting: radar.accounting.counts, economics: ECON };
}
