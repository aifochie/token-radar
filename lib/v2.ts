// Latent Magnet v2: frozen-snapshot estimates, auditable holdouts, explicit economics.
// No launch dates, eligibility, wallet allocations or future observations exist here.
import { ageDays, buildBoard as buildV1Board, calibrate, farmSteps, isPreToken, MODEL, stepText } from './model.ts';
import type { Snapshot, SnapshotProtocol } from './model.ts';

export const VERSION = 'latent-magnet-v2';
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const dollars = (x: number) => clamp(Math.round(x), 1, MODEL.max_value_usd);
export function median(xs: number[]): number {
  const a = xs.slice().sort((x, y) => x - y), n = a.length;
  if (!n) throw new Error('No priced observations: empirical estimate unavailable');
  return n % 2 ? a[n >> 1]! : (a[n / 2 - 1]! + a[n / 2]!) / 2;
}
export function quantile(xs: number[], q: number): number {
  const a = xs.slice().sort((x, y) => x - y);
  if (!a.length) throw new Error('No empirical quantile');
  return a[Math.max(0, Math.ceil(q * a.length) - 1)]!;
}
export const pricedPeers = (s: Snapshot) => s.protocols.filter(p => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0).sort((a, b) => a.slug < b.slug ? -1 : 1);
const cat = (p: SnapshotProtocol) => p.category ?? 'Other';

// A mask is a fixed ablation of the original four terms, not fitted coefficients.
// 1 = category/global blend; 2 = growth; 4 = maturity; 8 = completeness.
// All 16 masks are disclosed. A change is eligible only if NEITHER split worsens.
export function components(p: SnapshotProtocol, asOf: string) {
  const age = ageDays(asOf, p.listed_at);
  return {
    growth: Math.sqrt(1 + clamp(p.change_7d ?? 0, -60, 150) / 100),
    maturity: 0.55 + 0.45 * (1 - Math.exp(-(age ?? 180) / 365)),
    completeness: (p.change_7d === null ? 0.9 : 1) * (age === null ? 0.85 : 1) * (p.chains.length ? 1 : 0.9),
  };
}
function trainedStats(train: SnapshotProtocol[]) {
  const ratios = train.map(p => clamp(p.mcap_usd! / p.tvl_usd, 0.03, 3));
  return { global: median(ratios), train };
}
export function forecast(p: SnapshotProtocol, asOf: string, stats: ReturnType<typeof trainedStats>, mask: number) {
  const local = stats.train.filter(q => cat(q) === cat(p));
  const localMedian = local.length >= 5 ? median(local.map(q => clamp(q.mcap_usd! / q.tvl_usd, 0.03, 3))) : stats.global;
  const w = local.length >= 5 ? local.length / (local.length + 8) : 0;
  const multiple = mask & 1 ? w * localMedian + (1 - w) * stats.global : localMedian;
  const f = components(p, asOf);
  const factors = (mask & 2 ? f.growth : 1) * (mask & 4 ? f.maturity : 1) * (mask & 8 ? f.completeness : 1);
  return { point: dollars(p.tvl_usd * multiple * factors), multiple, factors };
}

// Range uses UNCLIPPED empirical cap/TVL ratios; this is peer dispersion, not CI.
// Category if >=5 priced records in TRAIN, otherwise pooled, with explicit provenance.
export function dispersion(p: SnapshotProtocol, train: SnapshotProtocol[], asOf: string, mask: number) {
  const local = train.filter(q => cat(q) === cat(p));
  const group = local.length >= 5 ? local : train;
  const ratios = group.map(q => q.mcap_usd! / q.tvl_usd);
  const f = components(p, asOf);
  const adjust = (mask & 2 ? f.growth : 1) * (mask & 4 ? f.maturity : 1) * (mask & 8 ? f.completeness : 1);
  const p25 = quantile(ratios, 0.25), p75 = quantile(ratios, 0.75);
  return { p25_usd: dollars(p.tvl_usd * p25 * adjust), p75_usd: dollars(p.tvl_usd * p75 * adjust),
    p25_multiple: p25, p75_multiple: p75, peer_count: group.length, category_count: local.length,
    source: local.length >= 5 ? 'category' : 'pooled (category <5)', adjustment: adjust };
}

export function validateModel(s: Snapshot) {
  const peers = pricedPeers(s);
  type Fold = { slug: string; actual: number; predictions: number[]; low: number; high: number };
  const loo: Fold[] = [], walk: Fold[] = [];
  for (const p of peers) {
    const splits: Array<[Fold[], SnapshotProtocol[]]> = [
      [loo, peers.filter(q => q.slug !== p.slug)],
      // A listing-order proxy only: all TVL/caps/growth were observed on ONE date.
      // Equal-date cohorts stay together; unknown dates are not imputed into this split.
      [walk, peers.filter(q => p.listed_at !== null && q.listed_at !== null && q.listed_at < p.listed_at)],
    ];
    for (const [out, train] of splits) {
      if (train.length < 24) continue; // predeclared warm-up, not an optimized threshold
      const stats = trainedStats(train), band = dispersion(p, train, s.as_of, 15);
      out.push({ slug: p.slug, actual: p.mcap_usd!, predictions: Array.from({ length: 16 }, (_, mask) => forecast(p, s.as_of, stats, mask).point), low: band.p25_usd, high: band.p75_usd });
    }
  }
  const metric = (folds: Fold[], mask: number) => median(folds.map(f => Math.max(f.predictions[mask]! / f.actual, f.actual / f.predictions[mask]!)));
  const trials = Array.from({ length: 16 }, (_, mask) => ({ mask, loo_x: metric(loo, mask), walk_x: metric(walk, mask) }));
  const baseline = trials[15]!;
  const eligible = trials.filter(t => t.loo_x <= baseline.loo_x && t.walk_x <= baseline.walk_x)
    .sort((a, b) => a.loo_x * a.walk_x - b.loo_x * b.walk_x || b.mask - a.mask);
  const chosen = eligible[0]!;
  const summary = (folds: Fold[], split: 'loo' | 'walk') => ({
    n: folds.length, v1_x: metric(folds, 15), v2_x: metric(folds, chosen.mask),
    range_hits: folds.filter(f => f.actual >= f.low && f.actual <= f.high).length,
    range_n: folds.length,
    // Full deterministic fold ledger: slug, actual, v1, v2, raw-peer P25, P75.
    // If a future snapshot chooses another mask, recompute its range before reporting.
    folds: folds.map(f => {
      const p = peers.find(p => p.slug === f.slug)!;
      const train = peers.filter(q => split === 'loo' ? q.slug !== p.slug : p.listed_at !== null && q.listed_at !== null && q.listed_at < p.listed_at);
      const band = dispersion(p, train, s.as_of, chosen.mask);
      return [f.slug, f.actual, f.predictions[15], f.predictions[chosen.mask], band.p25_usd, band.p75_usd];
    }),
  });
  const a = summary(loo, 'loo'), b = summary(walk, 'walk');
  for (const x of [a, b]) x.range_hits = x.folds.filter(f => Number(f[1]) >= Number(f[4]) && Number(f[1]) <= Number(f[5])).length;
  return {
    selected_mask: chosen.mask, guard: chosen.mask === 15 ? 'RETAIN V1: no ablation improves both split errors' : 'NON-DEGRADING ABLATION',
    metric: 'median(max(predicted/actual, actual/predicted)); lower is better',
    limitation: 'Cross-sectional snapshot diagnostics. Walk-forward is listing-ordered, not a historical backtest: caps, TVL and 7d changes are all as-of the sealed date. No token launch dates; peer records can share tokens. Ablations reuse validation, so selection is not an independent test.',
    range_definition: 'Nearest-rank P25/P75 of raw training peer cap/TVL; category >=5 else pooled; multiplied by retained growth/maturity/completeness factors. Dispersion, not a calibrated confidence interval.',
    warmup_priced_rows: 24, walk_missing_dates: peers.filter(p => p.listed_at === null).length,
    trials, leave_one_out: a, walk_forward: b,
    term_decisions: [['blend', 1], ['growth', 2], ['maturity', 4], ['completeness', 8]].map(([term, bit]) => ({ term, retained: Boolean(chosen.mask & Number(bit)), without: trials[15 ^ Number(bit)] })),
  };
}

// Odds have NO hardcoded probability. Positive labels = priced token records only.
// Controls = no-token-recorded records (not proven future non-launches). Records with
// identifiers but no positive cap are missing outcomes, excluded and counted visibly.
// Age bucket boundaries = priced-peer listing-age quartiles; pseudocount strength =
// median positive category count. Prior = pooled positives / (positives + controls).
// Hierarchy: age shrinks to pooled, category x age shrinks to that age rate.
// This is empirical prevalence-as-launch-proxy, NOT calibrated odds within any horizon.
export function fitOdds(s: Snapshot) {
  const peers = pricedPeers(s), controls = s.protocols.filter(p => isPreToken(p) && p.category !== 'CEX');
  const ages = peers.map(p => ageDays(s.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const cuts = [0.25, 0.5, 0.75].map(q => quantile(ages, q));
  const counts = [...new Set(peers.map(cat))].map(c => peers.filter(p => cat(p) === c).length);
  const strength = median(counts), base = peers.length / (peers.length + controls.length);
  const bucket = (p: SnapshotProtocol) => { const age = ageDays(s.as_of, p.listed_at); return age === null ? 'unknown' : String(cuts.filter(c => age > c).length); };
  const population = [...peers.map(p => ({ p, y: 1 })), ...controls.map(p => ({ p, y: 0 }))];
  const estimate = (p: SnapshotProtocol) => {
    const age = bucket(p), cohort = population.filter(x => bucket(x.p) === age), cell = cohort.filter(x => cat(x.p) === cat(p));
    const ageK = cohort.reduce((a, x) => a + x.y, 0), k = cell.reduce((a, x) => a + x.y, 0);
    const agePrior = (ageK + strength * base) / (cohort.length + strength);
    const probability = (k + strength * agePrior) / (cell.length + strength);
    return { probability, source: 'snapshot category x age prevalence proxy', category: cat(p), age_bucket: age, priced: k, cohort_n: cell.length, age_priced: ageK, age_n: cohort.length, prior: agePrior, strength };
  };
  return { estimate, summary: { positives: peers.length, controls: controls.length, pooled_rate: base, strength, age_cut_days: cuts,
    excluded_recorded_unpriced: s.protocols.filter(p => !isPreToken(p)).length - peers.length,
    warning: 'Prevalence proxy, not measured launch probability or horizon hazard. No-token controls are censored; priced records are survivors; missing caps and repeated token IDs bias the proxy. Horizon affects costs only.' } };
}

// All economic knobs are SCENARIOS, never claimed to be observed in the snapshot.
// 1 ppm of implied circulating cap per wallet at a $100 pilot; linearly scaled
// with pilot size, capped at 2x. No eligibility or pool size is known. Zero possible.
export const ECON = { wallet_share_at_100: 0.000001, scenario_shares: [0.0000001, 0.000001, 0.00001], deposits: [50, 100, 150, 250], reference_capital: 100, max_weight: 2, opportunity_apr: 0.05, capital_risk_rate: 0.01, time_usd_per_hour: 15, farm_surplus_per_hour: 15 };
export function economicCase(value: number, odds: number, capital: number, gas: number, days: number, minutes: number, share = ECON.wallet_share_at_100) {
  const weight = Math.min(capital / ECON.reference_capital, ECON.max_weight);
  const reward = odds * value * share * weight;
  const fees = 4 * gas, opportunity = capital * ECON.opportunity_apr * days / 365, risk = capital * ECON.capital_risk_rate;
  const hours = minutes / 60, time = hours * ECON.time_usd_per_hour;
  const cost = fees + opportunity + risk + time, net = reward - cost, rate = net / hours;
  const verdict = net <= 0 ? 'SKIP' : rate >= ECON.farm_surplus_per_hour ? 'FARM' : 'MARGINAL';
  return { verdict, expected_drop_usd: reward, wallet_share: share * weight, share_at_100: share, allocation_weight: weight,
    capital_ceiling_usd: capital, fee_per_action_usd: gas, fee_actions: 4, fee_ceiling_usd: fees, horizon_days: days, minutes,
    opportunity_cost_usd: opportunity, capital_risk_charge_usd: risk, time_cost_usd: time, total_cost_usd: cost,
    net_usd: net, net_per_hour_usd: rate, breakeven_share_at_100: cost / (odds * value * weight) };
}

function planFor(p: SnapshotProtocol, age: number | null) {
  const old = farmSteps(p, age), plan = old.plan;
  const minutes = [20, 10, 15, Math.ceil(plan.observation_days / 7) * 7, 15, 10];
  const actions = [0, 0, 2, 0, 2, 0];
  const steps = old.steps.map((step, i) => ({ text: step.text,
    cost: i === 0 || i === 3 || i === 5 ? '$0 fees for read-only work' : i === 1 ? `$${plan.capital_budget_usd} capital ceiling; no transaction in this step` : `$${actions[i]! * plan.gas_budget_per_action_usd} ceiling for ${actions[i]} actions; capital remains at risk`,
    time: `${minutes[i]} minutes${i === 3 ? ` total across ${plan.observation_days} days` : ''}`,
  }));
  return { ...plan, total_minutes: minutes.reduce((a, b) => a + b, 0), fee_actions: 4,
    steps: steps.map((s, i) => ({ ...s, minutes: minutes[i], fee_actions: actions[i] })), farm_steps: steps.map(stepText) };
}

export function buildV2(s: Snapshot) {
  const calibration = calibrate(s), validation = validateModel(s), peers = pricedPeers(s), oddsModel = fitOdds(s);
  const stats = trainedStats(peers), mask = validation.selected_mask;
  const board = buildV1Board(s, calibration).map(r => {
    const f = forecast(r, s.as_of, stats, mask), band = dispersion(r, peers, s.as_of, mask), odds = oddsModel.estimate(r), plan = planFor(r, r.age_days);
    const economics = economicCase(f.point, odds.probability, plan.capital_budget_usd, plan.gas_budget_per_action_usd, plan.observation_days, plan.total_minutes);
    const factors = components(r, s.as_of);
    return { ...r, implied_value_usd: f.point, sensitivity_low_usd: band.p25_usd, sensitivity_high_usd: band.p75_usd,
      implied_p25_usd: band.p25_usd, implied_p75_usd: band.p75_usd, value_range: band,
      token_odds: odds.probability, odds, verdict: economics.verdict, net_usd: economics.net_usd, net_per_hour_usd: economics.net_per_hour_usd, economics,
      model: { ...r.model, peer_multiple: f.multiple, growth_multiplier: mask & 2 ? factors.growth : 1, maturity_multiplier: mask & 4 ? factors.maturity : 1, completeness_multiplier: mask & 8 ? factors.completeness : 1 },
      farm_plan: plan, farm_steps: plan.farm_steps,
      nearest_peers: peers.filter(q => band.source === 'category' ? cat(q) === cat(r) : true)
        .map(q => ({ slug: q.slug, distance: Math.abs(Math.log(q.tvl_usd / r.tvl_usd)), name: q.name, category: q.category, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd, multiple: q.mcap_usd! / q.tvl_usd, age_days: ageDays(s.as_of, q.listed_at), change_7d: q.change_7d }))
        .sort((a, b) => a.distance - b.distance || (a.slug < b.slug ? -1 : 1)).slice(0, 9),
    };
  }).sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1)).map((r, i) => ({ ...r, rank: i + 1, rank_best: 1, rank_worst: 1 }));
  for (const r of board) {
    r.rank_best = 1 + board.filter(q => q.slug !== r.slug && q.implied_p25_usd > r.implied_p75_usd).length;
    r.rank_worst = 1 + board.filter(q => q.slug !== r.slug && q.implied_p75_usd > r.implied_p25_usd).length;
  }
  const accounting = { ranked_no_token: board.length, excluded_no_token: s.protocols.filter(isPreToken).length - board.length, priced: peers.length, recorded_unpriced: s.protocols.filter(p => !isPreToken(p)).length - peers.length };
  const radar = { model_version: VERSION, as_of: s.as_of, source: s.source, floor_usd: s.floor_usd, model: MODEL, calibration,
    board_size: board.length, watchlist_size: s.watchlist.length, early_size: board.filter(r => !r.watchlist).length,
    below_floor_size: board.filter(r => r.tvl_usd < s.floor_usd).length, universe_size: s.protocols.length,
    accounting, validation, odds_model: oddsModel.summary, econ: ECON, rows: board, live: peers, live_size: peers.length };
  return { board, radar };
}
