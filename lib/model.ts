// Snapshot-only valuation and farm planning. Derived from the kit's model interface;
// peer calibration, candidate selection, multipliers, and farm plans are new.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'fieldwork-peer-1';
export const MODEL = {
  target_rows: 200,
  ratio_floor: 0.03,
  ratio_cap: 3,
  fallback_multiple: 0.25,
  minimum_category_peers: 5,
  shrinkage_peers: 8,
  growth_floor: -60,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 365,
  unknown_age_days: 180,
  missing_growth_factor: 0.9,
  missing_age_factor: 0.85,
  missing_chain_factor: 0.9,
  max_value_usd: 100_000_000_000_000,
} as const;

interface PeerEstimate {
  multiple: number;
  peers: number;
  source: 'category blend' | 'global peers' | 'fallback assumption';
  sensitivity_low_factor: number;
  sensitivity_high_factor: number;
}

export interface Calibration {
  global_multiple: number;
  global_peers: number;
  global_sensitivity_low_factor: number;
  global_sensitivity_high_factor: number;
  categories: Record<string, PeerEstimate>;
}

export interface ValueBreakdown {
  peer_multiple: number;
  peer_count: number;
  peer_source: PeerEstimate['source'];
  sensitivity_low_factor: number;
  sensitivity_high_factor: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  completeness_multiplier: number;
  age_days: number | null;
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface FarmPlan {
  chain: string;
  action: string;
  capital_budget_usd: number;
  gas_budget_per_action_usd: number;
  observation_days: number;
}

export interface BoardRow extends SnapshotProtocol {
  rank: number;
  token_status: 'no token recorded';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  sensitivity_low_usd: number;
  sensitivity_high_usd: number;
  model: ValueBreakdown;
  farm_plan: FarmPlan;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: typeof MODEL;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  below_floor_size: number;
  live_size: number;
  rows: BoardRow[];
  live: SnapshotProtocol[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const compareSlug = (a: { slug: string }, b: { slug: string }): number => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
const boundedDollars = (n: number): number => clamp(Math.round(n), 1, MODEL.max_value_usd);

function dateMs(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const n = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? n : null;
}

/** Listing age is an observable proxy, not a record of a token-free lifetime. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  const a = dateMs(asOf);
  const b = dateMs(listedAt);
  return a === null || b === null ? null : Math.max(0, Math.floor((a - b) / 86_400_000));
}

/** Match the field guide: market-cap availability does not determine token status. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPER = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** parentProtocol is absent; supplied watchlist membership remains authoritative. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) && !WRAPPER.test(p.name) && !EXCHANGE.test(p.name);
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Nearest-rank quartiles of the same clamped peer set, normalized by its median. */
function peerSpread(ratios: number[]): Pick<PeerEstimate, 'sensitivity_low_factor' | 'sensitivity_high_factor'> {
  // With no observed peers there is no empirical dispersion; keep a neutral band.
  if (ratios.length === 0) return { sensitivity_low_factor: 1, sensitivity_high_factor: 1 };
  const sorted = ratios.slice().sort((a, b) => a - b);
  const center = median(sorted);
  const nearestRank = (percentile: number): number => sorted[Math.ceil(percentile * sorted.length) - 1]!;
  return {
    sensitivity_low_factor: nearestRank(0.25) / center,
    sensitivity_high_factor: nearestRank(0.75) / center,
  };
}

/** Winsorized market-cap/TVL medians; sparse categories shrink toward the universe. */
export function calibrate(snapshot: Snapshot): Calibration {
  const ratios: number[] = [];
  const groups = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === 'CEX' || p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, MODEL.ratio_floor, MODEL.ratio_cap);
    ratios.push(ratio);
    const category = p.category ?? 'Other';
    const values = groups.get(category) ?? [];
    values.push(ratio);
    groups.set(category, values);
  }
  const global = ratios.length ? median(ratios) : MODEL.fallback_multiple;
  const globalSpread = peerSpread(ratios);
  const categories: Record<string, PeerEstimate> = Object.create(null);
  for (const category of [...new Set(snapshot.protocols.map((p) => p.category ?? 'Other'))].sort()) {
    const peers = groups.get(category) ?? [];
    const useCategory = peers.length >= MODEL.minimum_category_peers;
    const weight = useCategory ? peers.length / (peers.length + MODEL.shrinkage_peers) : 0;
    categories[category] = {
      multiple: useCategory ? weight * median(peers) + (1 - weight) * global : global,
      peers: useCategory ? peers.length : ratios.length,
      source: useCategory ? 'category blend' : ratios.length ? 'global peers' : 'fallback assumption',
      ...(useCategory ? peerSpread(peers) : globalSpread),
    };
  }
  return {
    global_multiple: global, global_peers: ratios.length,
    global_sensitivity_low_factor: globalSpread.sensitivity_low_factor,
    global_sensitivity_high_factor: globalSpread.sensitivity_high_factor,
    categories,
  };
}

export function impliedValue(p: SnapshotProtocol, asOf: string, calibration: Calibration): { implied: number; model: ValueBreakdown } {
  const peer = calibration.categories[p.category ?? 'Other'] ?? {
    multiple: calibration.global_multiple,
    peers: calibration.global_peers,
    source: calibration.global_peers ? 'global peers' : 'fallback assumption',
    sensitivity_low_factor: calibration.global_sensitivity_low_factor,
    sensitivity_high_factor: calibration.global_sensitivity_high_factor,
  };
  const age = ageDays(asOf, p.listed_at);
  const growth = clamp(p.change_7d ?? 0, MODEL.growth_floor, MODEL.growth_cap);
  const growthMultiplier = Math.sqrt(1 + growth / 100);
  const maturity = MODEL.maturity_floor + MODEL.maturity_range * (1 - Math.exp(-(age ?? MODEL.unknown_age_days) / MODEL.maturity_days));
  const completeness = (p.change_7d === null ? MODEL.missing_growth_factor : 1) *
    (age === null ? MODEL.missing_age_factor : 1) * (p.chains.length ? 1 : MODEL.missing_chain_factor);
  return {
    implied: boundedDollars(p.tvl_usd * peer.multiple * growthMultiplier * maturity * completeness),
    model: {
      peer_multiple: peer.multiple,
      peer_count: peer.peers,
      peer_source: peer.source,
      sensitivity_low_factor: peer.sensitivity_low_factor,
      sensitivity_high_factor: peer.sensitivity_high_factor,
      growth_pct: growth,
      growth_multiplier: growthMultiplier,
      maturity_multiplier: maturity,
      completeness_multiplier: completeness,
      age_days: age,
    },
  };
}

function farmAction(p: SnapshotProtocol, capital: number): { kind: string; text: string; exit: string } {
  const category = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (/rwa|uncollateralized|credit/.test(category)) return {
    kind: 'eligibility-first deposit',
    text: `Check ${name}'s investor and jurisdiction requirements and redemption queue. Only if eligible, test its documented deposit with at most $${capital}; skip if the minimum is higher.`,
    exit: 'Check redemption windows before requesting a small redemption; record any lock-up or credit loss exposure.',
  };
  if (/perpetual|derivative|option|leveraged/.test(category)) return {
    kind: 'unlevered product check',
    text: `Inspect ${name}'s documented demo or unlevered deposit route. Test at most $${capital} only if withdrawals are supported; skip products requiring leverage or trades solely for points.`,
    exit: 'Cancel outstanding orders, close any exposure, and test the documented withdrawal route before withdrawing the rest.',
  };
  if (/dex|amm/.test(category)) return {
    kind: 'small spot swap',
    text: `On ${name}, inspect a liquid supported spot pair and its price impact. If the quote is acceptable, swap at most $${Math.max(5, Math.floor(capital / 5))}; record the minimum received and transaction hash.`,
    exit: 'If needed, quote a reverse swap, compare fees and slippage, and remove unused token allowances afterward.',
  };
  if (/cdp|stablecoin/.test(category)) return {
    kind: 'mint/redeem check',
    text: `Read ${name}'s collateral and redemption terms. Test at most $${capital} through a documented unlevered mint or deposit; skip any route requiring debt you cannot manage.`,
    exit: 'Test a small redemption and check fees or collateral obligations before unwinding the remaining receipt.',
  };
  if (/lend/.test(category)) return {
    kind: 'supply only',
    text: `Select an asset ${name}'s app actually accepts. Supply at most $${capital} with borrowing disabled, check available withdrawal liquidity, and record the receipt balance.`,
    exit: 'Withdraw a small amount first, then redeem the remaining supply if liquidity permits; remove unused approvals.',
  };
  if (/curator|allocator|yield|vault/.test(category)) return {
    kind: 'documented vault deposit',
    text: `Inspect ${name}'s documented vault strategy, accepted asset, fees and withdrawal queue. If an unlevered route is available, deposit at most $${capital} and record the share balance.`,
    exit: 'Request a small vault redemption, observe any queue, then unwind the remaining shares and remove unused approvals.',
  };
  if (/stak/.test(category)) return {
    kind: 'bonding check',
    text: `Read ${name}'s documented bonding, slashing and unbonding terms. Only if acceptable, test at most $${capital} of a supported asset and record the withdrawal date.`,
    exit: 'Start the documented unbonding process and account for slashing or delays before treating funds as available.',
  };
  return {
    kind: 'verify a supported action',
    text: `Find a documented user action in ${name}'s app and verify its asset, minimum and withdrawal path. If unclear, stop at research; otherwise test at most $${capital} without leverage.`,
    exit: 'Follow the documented exit for the tested action, verify the returned asset, and remove any unused spending approval.',
  };
}

/** Planning budgets, not live fee quotes, verified integrations, or promised rewards. */
export function farmSteps(p: SnapshotProtocol, age: number | null): { plan: FarmPlan; steps: FarmStep[] } {
  const chain = p.chains[0] ?? 'the documented supported chain';
  const capital = p.tvl_usd >= 1_000_000_000 ? 150 : p.tvl_usd >= 100_000_000 ? 100 : 50;
  const gas = chain === 'Ethereum' ? 20 : chain === 'Solana' ? 2 : 5;
  const days = age !== null && age < 180 ? 42 : 28;
  const action = farmAction(p, capital);
  return {
    plan: { chain, action: action.kind, capital_budget_usd: capital, gas_budget_per_action_usd: gas, observation_days: days },
    steps: [
      {
        text: `Verify ${p.name}'s official app/docs independently: deployments, assets, access and published rewards on ${p.chains.join(', ') || chain}; the snapshot proves none of these.`,
        cost: '$0 for research', time: '15–25 minutes before funding',
      },
      {
        text: `Use a wallet limited to this experiment. Reserve native transaction fees on ${chain} and check a live quote; skip if fees or the minimum exceed your budget.`,
        cost: `up to $${capital} capital at risk plus a $${gas} fee ceiling per action; estimates only`, time: '10 minutes',
      },
      {
        text: action.text,
        cost: `within the $${capital} capital ceiling, plus up to $${gas} fees and any quoted spread`, time: '10–20 minutes if the route is verified',
      },
      {
        text: `Review ${p.name} weekly for ${days} days: log balances, fees, withdrawal liquidity and changes to terms. Do not transact merely to manufacture volume; no qualifying activity or reward is established.`,
        cost: 'capital remains at risk; $0 for read-only checks, transaction fees only if needed', time: `5–10 minutes weekly for ${days} days; an observation plan, not an eligibility window`,
      },
      {
        text: action.exit,
        cost: `allow up to $${gas} per exit action, plus quoted exit fees or realized losses`, time: '10–20 minutes plus any documented queue or lock-up',
      },
      {
        text: `Retain transaction hashes, net costs and dates. Check only ${p.name}'s independently verified reward announcements; interact with a claim only if published eligibility and the transaction are understood.`,
        cost: '$0 to check; a real on-chain claim can incur gas, and rewards may be zero', time: '5 minutes to log and 10 minutes per announcement check',
      },
    ],
  };
}

export function stepText(step: FarmStep): string {
  return `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
}

export function buildBoard(snapshot: Snapshot, calibration: Calibration = calibrate(snapshot)): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols
    .filter((p) => watchlist.has(p.slug) || isRankable(p))
    .map((p) => ({ p, ...impliedValue(p, snapshot.as_of, calibration) }))
    .sort((a, b) => b.implied - a.implied || compareSlug(a.p, b.p));
  const selected = new Set(watchlist);
  for (const row of candidates) {
    if (selected.size >= Math.max(MODEL.target_rows, watchlist.size)) break;
    selected.add(row.p.slug);
  }
  return candidates.filter((row) => selected.has(row.p.slug)).map(({ p, implied, model }, i) => {
    const farm = farmSteps(p, model.age_days);
    return {
      ...p, rank: i + 1, token_status: 'no token recorded', watchlist: watchlist.has(p.slug),
      age_days: model.age_days, implied_value_usd: implied,
      sensitivity_low_usd: boundedDollars(implied * model.sensitivity_low_factor),
      sensitivity_high_usd: boundedDollars(implied * model.sensitivity_high_factor),
      model, farm_plan: farm.plan, farm_steps: farm.steps.map(stepText),
    };
  });
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot);
  const board = buildBoard(snapshot, calibration);
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || compareSlug(a, b)).slice(0, 24);
  return {
    board,
    radar: {
      as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
      model: MODEL, model_version: MODEL_VERSION, calibration,
      watchlist_size: snapshot.watchlist.length, board_size: board.length,
      early_size: board.filter((p) => !p.watchlist).length,
      below_floor_size: board.filter((p) => p.tvl_usd < snapshot.floor_usd).length,
      live_size: live.length, rows: board, live,
    },
  };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SnapshotError('snapshot must be an object');
  const o = raw as Record<string, unknown>;
  if (dateMs(o.as_of) === null) throw new SnapshotError('snapshot has an invalid as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot has no source');
  if (!Number.isSafeInteger(o.floor_usd) || (o.floor_usd as number) <= 0) throw new SnapshotError('snapshot has no positive integer floor_usd');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new SnapshotError('snapshot needs protocols and watchlist arrays');
  const slugs = new Set<string>();
  const protocols = o.protocols.map((value, i): SnapshotProtocol => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || !/^\S{1,128}$/.test(p.slug) || slugs.has(p.slug)) throw new SnapshotError(`protocol ${i} has an invalid or duplicate slug`);
    slugs.add(p.slug);
    if (typeof p.name !== 'string' || !p.name.trim()) throw new SnapshotError(`${p.slug} has no name`);
    if (!Number.isSafeInteger(p.tvl_usd) || (p.tvl_usd as number) <= 0) throw new SnapshotError(`${p.slug} has invalid TVL`);
    if (!(p.category === null || typeof p.category === 'string')) throw new SnapshotError(`${p.slug} has an invalid category`);
    if (!Array.isArray(p.chains) || p.chains.some((c) => typeof c !== 'string' || !c)) throw new SnapshotError(`${p.slug} has invalid chains`);
    for (const key of ['gecko_id', 'symbol']) {
      if (!(p[key] === null || typeof p[key] === 'string')) throw new SnapshotError(`${p.slug} has invalid ${key}`);
    }
    if (p.change_7d !== null && (typeof p.change_7d !== 'number' || !Number.isFinite(p.change_7d))) throw new SnapshotError(`${p.slug} has invalid growth`);
    // The sealed input includes negative market-cap sentinels such as -1.
    // Preserve the record; calibrate() excludes every nonpositive market cap.
    if (p.mcap_usd !== null && !Number.isSafeInteger(p.mcap_usd)) throw new SnapshotError(`${p.slug} has invalid market cap`);
    if (p.listed_at !== null && dateMs(p.listed_at) === null) throw new SnapshotError(`${p.slug} has an invalid listing date`);
    return {
      slug: p.slug, name: p.name, category: p.category as string | null, chains: p.chains as string[],
      tvl_usd: p.tvl_usd as number, change_7d: p.change_7d as number | null,
      mcap_usd: p.mcap_usd as number | null, listed_at: p.listed_at as string | null,
      gecko_id: p.gecko_id as string | null, symbol: p.symbol as string | null,
    };
  });
  const watchlist: string[] = [];
  const seen = new Set<string>();
  for (const slug of o.watchlist) {
    if (typeof slug !== 'string' || !slugs.has(slug) || seen.has(slug)) throw new SnapshotError('watchlist has a missing, duplicate, or invalid slug');
    seen.add(slug);
    watchlist.push(slug);
  }
  if (watchlist.some((slug) => !isPreToken(protocols.find((p) => p.slug === slug)!))) throw new SnapshotError('watchlist contains a recorded token');
  return { as_of: o.as_of as string, source: o.source, floor_usd: o.floor_usd as number, protocols, watchlist };
}

/** Fail before packaging if any board gate condition is violated. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board needs 100–4000 rows, got ${board.length}`;
  if (Buffer.byteLength(JSON.stringify({ rows: board })) + 1 > 8 * 1024 * 1024) return 'board exceeds 8 MiB';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!known.has(row.slug) || !/^\S{1,128}$/.test(row.slug) || seen.has(row.slug)) return `invalid or duplicate slug: ${row.slug}`;
    seen.add(row.slug);
    if (!row.name.trim()) return `${row.slug} has no name`;
    if (row.rank !== i + 1) return `rank ${i + 1} is missing or out of order`;
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > MODEL.max_value_usd) return `${row.slug} has an invalid implied value`;
    if (i && row.implied_value_usd > board[i - 1]!.implied_value_usd) return 'implied values rise with rank';
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has an invalid number of farm steps`;
    if (row.farm_steps.some((s) => typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600)) return `${row.slug} has an invalid farm step`;
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length) return `missing watchlist slugs: ${missing.join(', ')}`;
  if (new Set(board.map((p) => p.implied_value_usd)).size < 2) return 'all implied values are equal';
  return null;
}

/** Include the exact board plans in data.js; never independently regenerate them in the browser. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};\n`;
}
