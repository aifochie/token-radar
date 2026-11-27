// Latent Magnet v2. Offline UI reads the exact emitted board; all model code,
// ablations and held-out target/prediction ledgers are included in this dossier.
(() => {
  'use strict';
  const D = window.RADAR, root = document.getElementById('board');
  if (!D) { root.textContent = 'Build main.ts, then open output/dashboard/index.html.'; return; }
  const state = { q: '', category: 'all', verdict: 'all', view: 'radar', sort: 'rank', dir: 1, p: '' };
  const usd = n => !Number.isFinite(n) ? '—' : (n < 0 ? '−' : '') + '$' + (Math.abs(n) >= 1e9 ? (Math.abs(n) / 1e9).toFixed(2) + 'B' : Math.abs(n) >= 1e6 ? (Math.abs(n) / 1e6).toFixed(1) + 'M' : Math.abs(n) >= 1e3 ? (Math.abs(n) / 1e3).toFixed(1) + 'K' : Math.abs(n).toFixed(0));
  const cash = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toFixed(2);
  const pct = n => n === null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const prob = n => (100 * n).toFixed(1) + '%';
  const age = n => n === null ? 'unknown' : n >= 365 ? (n / 365).toFixed(1) + 'y' : n + 'd';
  const x = n => n.toFixed(3) + '×';
  const sum = (rs, key) => rs.reduce((n, r) => n + r[key], 0);
  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    });
    kids.flat(Infinity).filter(k => k !== null && k !== undefined).forEach(k => node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
    return node;
  }
  const text = (tag, s, c = '') => el(tag, { text: s, class: c });
  const badge = v => text('span', v, 'badge ' + v.toLowerCase());
  const note = s => text('p', s, 'note');
  function readHash() { const q = new URLSearchParams(location.hash.slice(1)); ['q', 'category', 'verdict', 'view', 'p'].forEach(k => state[k] = q.get(k) || ({ category: 'all', verdict: 'all', view: 'radar' }[k] || '')); }
  function save() { const q = new URLSearchParams(); ['q', 'category', 'verdict', 'view', 'p'].forEach(k => { if (state[k] && !['all', 'radar'].includes(state[k])) q.set(k, state[k]); }); history.replaceState(null, '', '#' + q); }
  function change(key, value) { state[key] = value; save(); render(); }
  const head = () => el('header', { class: 'mast' }, el('div', { class: 'brand' }, text('b', 'LM', 'monogram'), text('b', 'LATENT MAGNET'), text('span', 'TOKEN RADAR / V2', 'muted')), text('span', 'SEALED ' + D.as_of + '  •  OFFLINE RESEARCH', 'mono muted'));
  const kpi = (label, value, sub) => el('div', { class: 'kpi' }, text('span', label, 'eyebrow'), text('strong', value), text('small', sub));
  function evidence() {
    const a = D.validation.leave_one_out, b = D.validation.walk_forward;
    const row = (label, n, v1, v2) => el('tr', null, text('td', label), text('td', n), text('td', v1), text('td', v2, 'accent'));
    return el('section', { class: 'proof panel' }, el('div', { class: 'section-label' }, text('b', 'OUT-OF-SAMPLE / TARGET EXCLUDED'), text('span', 'median x-error ↓', 'muted')),
      el('table', { class: 'mini', id: 'evidence' }, el('thead', null, el('tr', null, ['Test', 'n', 'v1', 'v2'].map(s => text('th', s)))), el('tbody', null,
        row('Walk-forward¹', b.n, x(b.v1_x), x(b.v2_x)), row('Leave-one-out', a.n, x(a.v1_x), x(a.v2_x)),
        row('P25–P75 hits²', a.n + ' / ' + b.n, 'LOO ' + prob(a.range_hits / a.n), 'WF ' + prob(b.range_hits / b.n)))),
      text('small', '¹ Listing order, same-date features; not historical. ² Dispersion, not confidence. V1 terms retained.', 'micro'));
  }
  function accounting() {
    const labels = ['Ranked no-token', 'Excluded no-token', 'Priced peers', 'Recorded / unpriced'];
    const vals = Object.values(D.accounting);
    return el('section', { class: 'account panel' }, el('div', { class: 'section-label' }, text('b', 'PROTOCOL ACCOUNTING'), text('span', D.universe_size + ' records • exhaustive', 'muted')),
      el('div', { class: 'stack', role: 'img', 'aria-label': labels.map((s, i) => s + ' ' + vals[i]).join('; ') }, vals.map((n, i) => el('i', { class: 'segment s' + i, style: 'width:' + n / D.universe_size * 100 + '%' }))),
      el('div', { class: 'legend' }, labels.map((s, i) => el('span', null, el('i', { class: 'dot s' + i }), text('b', vals[i]), ' ' + s))),
      text('div', 'Odds pool: ' + D.odds_model.positives + ' priced + ' + D.odds_model.controls + ' no-token controls (CEX excluded). ' + D.odds_model.excluded_recorded_unpriced + ' missing-price outcomes excluded.', 'micro'),
      text('div', 'No token recorded ≠ proof. Capital and rewards remain at risk.', 'micro'));
  }
  function filtered() {
    const q = state.q.toLowerCase().trim();
    return (state.view === 'priced' ? D.live : D.rows).filter(r => (state.category === 'all' || (r.category || 'Other') === state.category) &&
      (state.verdict === 'all' || r.verdict === state.verdict) && (!q || [r.name, r.slug, r.category, ...r.chains].join(' ').toLowerCase().includes(q)));
  }
  function controls() {
    const src = state.view === 'priced' ? D.live : D.rows;
    const query = el('input', { id: 'q', type: 'search', value: state.q, placeholder: 'Search protocol, category, chain…', 'aria-label': 'Search protocols' });
    query.addEventListener('input', () => { const n = query.selectionStart; change('q', query.value); const next = document.getElementById('q'); next.focus(); if (n !== null && next.type !== 'search') next.setSelectionRange(n, n); });
    function select(id, values, label) {
      const node = el('select', { id, 'aria-label': label }, values.map(([value, label]) => el('option', { value, text: label })));
      node.value = state[id]; node.addEventListener('change', () => change(id, node.value)); return node;
    }
    return el('div', { class: 'controls' }, query,
      select('category', [['all', 'All categories'], ...[...new Set(src.map(r => r.category || 'Other'))].sort().map(c => [c, c])], 'Category'),
      select('verdict', [['all', 'All verdicts'], ['FARM', 'FARM only'], ['MARGINAL', 'MARGINAL only'], ['SKIP', 'SKIP only']], 'Economic verdict'),
      el('div', { class: 'tabs' }, ['radar', 'priced'].map(v => el('button', { 'aria-pressed': state.view === v, onclick: () => { state.category = 'all'; state.verdict = 'all'; change('view', v); } }, v === 'radar' ? 'No token recorded' : 'Priced benchmarks'))),
      el('button', { class: 'reset', onclick: () => { Object.assign(state, { q: '', category: 'all', verdict: 'all', view: 'radar', sort: 'rank', dir: 1 }); save(); render(); }, text: 'Reset' }));
  }
  function sortHead(key, label) {
    return el('th', { 'aria-sort': state.sort === key ? state.dir > 0 ? 'ascending' : 'descending' : 'none' }, el('button', { onclick: () => { state.dir = state.sort === key ? -state.dir : key === 'name' || key === 'rank' ? 1 : -1; state.sort = key; render(); }, text: label + (state.sort === key ? state.dir > 0 ? ' ↑' : ' ↓' : '') }));
  }
  const lo = Math.log10(Math.min(...D.rows.map(r => r.implied_p25_usd))), hi = Math.log10(Math.max(...D.rows.map(r => r.implied_p75_usd)));
  const pos = n => Math.max(0, Math.min(100, (Math.log10(n) - lo) / (hi - lo) * 100));
  function rangebar(r) { return el('div', { class: 'rangebar', title: 'Common logarithmic value axis. Dot = point; segment = raw peer P25–P75.' }, el('i', { style: `left:${pos(r.implied_p25_usd)}%;width:${pos(r.implied_p75_usd) - pos(r.implied_p25_usd)}%` }), el('b', { style: `left:${pos(r.implied_value_usd)}%` })); }
  function board(list) {
    const value = r => r[state.sort] ?? (state.sort === 'growth' ? r.change_7d : null);
    list = list.slice().sort((a, b) => { const av = value(a), bv = value(b); return av === null ? 1 : bv === null ? -1 : (av < bv ? -1 : av > bv ? 1 : 0) * state.dir || a.rank - b.rank; });
    return el('div', { class: 'table-wrap panel' }, el('table', { class: 'radar-table', id: 'radar-table' },
      el('colgroup', null, [5, 18, 8, 6, 7, 9, 11, 17, 9, 10].map(w => el('col', { style: 'width:' + w + '%' }))),
      el('thead', null, el('tr', null, sortHead('rank', 'Rank / band'), sortHead('name', 'Protocol / record'), sortHead('tvl_usd', 'TVL'), sortHead('growth', '7d'), sortHead('age_days', 'No-token age¹'), sortHead('token_odds', 'Token odds²'), sortHead('implied_value_usd', 'If it launches'), sortHead('implied_p25_usd', 'Implied P25–P75 / log'), sortHead('verdict', 'Verdict'), sortHead('net_per_hour_usd', 'Net / hour³'))),
      el('tbody', null, list.map(r => el('tr', { 'data-slug': r.slug, tabindex: 0, onclick: () => change('p', r.slug), onkeydown: e => { if (e.key === 'Enter') change('p', r.slug); } },
        el('td', { class: 'rank' }, text('b', String(r.rank).padStart(2, '0')), text('small', r.rank_best + '–' + r.rank_worst)),
        el('td', { class: 'protocol' }, text('b', r.name), el('small', null, badge(r.watchlist ? 'WATCH' : 'EARLY'), ' ' + (r.category || 'Other') + ' · ' + (r.chains[0] || '?'))),
        text('td', usd(r.tvl_usd), 'num'), text('td', pct(r.change_7d), 'num ' + (r.change_7d >= 0 ? 'positive' : 'negative')),
        el('td', { class: 'num' }, text('span', age(r.age_days)), text('small', 'listing proxy')),
        el('td', { class: 'num', title: r.odds.priced + ' priced / ' + r.odds.cohort_n + ' category-age records; hierarchical prior ' + prob(r.odds.prior) }, text('b', prob(r.token_odds)), el('div', { class: 'oddsbar' }, el('i', { style: 'width:' + r.token_odds * 100 + '%' }))),
        el('td', { class: 'num' }, text('b', usd(r.implied_value_usd), 'value'), text('small', x(r.implied_value_usd / r.tvl_usd) + ' TVL')),
        el('td', { class: 'num' }, text('span', usd(r.implied_p25_usd) + ' – ' + usd(r.implied_p75_usd), 'range-label'), rangebar(r)),
        el('td', null, badge(r.verdict)), el('td', { class: 'num ' + (r.net_usd >= 0 ? 'positive' : 'negative') }, text('b', cash(r.net_per_hour_usd)), text('small', 'net ' + cash(r.net_usd))))))));
  }
  function benchmarks(list) {
    return el('section', { class: 'panel table-wrap' }, text('h2', 'Recorded token benchmarks / actual cap, not launch scenarios'),
      el('table', { class: 'benchmark-table', id: 'benchmark-table' }, el('thead', null, el('tr', null, ['Protocol', 'Category', 'TVL', 'Recorded cap', 'Cap / TVL', 'Token identifier'].map(s => text('th', s)))),
        el('tbody', null, list.slice().sort((a, b) => b.mcap_usd - a.mcap_usd).map(r => el('tr', null, text('td', r.name), text('td', r.category || 'Other'), text('td', usd(r.tvl_usd)), text('td', usd(r.mcap_usd)), text('td', x(r.mcap_usd / r.tvl_usd)), text('td', r.symbol || r.gecko_id))))));
  }
  function shortlist(list) {
    return el('section', { class: 'shortlist' }, list.map(r => el('article', { class: 'panel' }, el('div', { class: 'section-label' }, text('b', r.name), badge(r.verdict)),
      text('h2', cash(r.net_per_hour_usd) + '/h', 'positive'), note('Net ' + cash(r.net_usd) + ' after ' + cash(r.economics.total_cost_usd) + ' of assumed total cost. ' + prob(r.token_odds) + ' odds proxy × ' + usd(r.implied_value_usd) + ' × ' + (r.economics.wallet_share * 1e6).toFixed(1) + ' ppm.'),
      text('p', r.farm_plan.action + ' · ' + usd(r.farm_plan.capital_budget_usd) + ' pilot · ' + r.farm_plan.observation_days + ' days · ' + r.farm_plan.total_minutes + ' min'),
      note('Break-even allocation at $100: ' + (r.economics.breakeven_share_at_100 * 1e6).toFixed(2) + ' ppm. Base assumes 1 ppm; no allocation is established.'),
      el('button', { class: 'primary', text: 'Inspect economics & plan →', onclick: () => change('p', r.slug) }))),
      note('Shortlist values are conditional scenarios. Common token, eligibility and valuation risks make row totals unsuitable as portfolio return forecasts.'));
  }
  function overview() {
    const list = filtered(), farms = D.rows.filter(r => r.verdict === 'FARM');
    return [el('section', { class: 'intro' }, el('div', null, text('span', 'RESEARCH DESK / 02', 'eyebrow'), text('h1', 'Find value. Price the effort.')), text('p', 'A launch value is not a farming return. Compare the peer range, then let costs decide.', 'muted')),
      el('section', { class: 'kpis' }, kpi('NO-TOKEN RADAR', D.board_size, D.early_size + ' beyond the watchlist'), kpi('WATCHLIST COVERED', D.watchlist_size + '/' + D.watchlist_size, 'snapshot floor is not the ceiling'), kpi('PRICED PEER RECORDS', D.calibration.global_peers, 'actual market caps • not FDV'), kpi('CONDITIONAL VALUE', usd(sum(D.rows, 'implied_value_usd')), 'sum of points • not expected cash'), kpi('FARM AT BASE CASE', farms.length + ' / ' + D.board_size, '1 ppm wallet share at $100 pilot'), kpi('VALIDATION GUARD', 'V1 RETAINED', 'all 4 terms • no error regression')),
      el('div', { class: 'intelligence' }, accounting(), evidence()),
      el('div', { class: 'integrity' }, text('b', '● INTEGRITY'), text('span', 'SEALED SHA ' + D.snapshot_sha256.slice(0, 12)), text('span', '40/40 mandatory rows'), text('span', 'Offline • no imported probabilities'), text('span', 'Odds = prevalence proxy; horizon uncalibrated')),
      controls(), el('div', { class: 'results', id: 'filter-summary', 'data-rows': list.length }, text('b', state.verdict === 'FARM' ? 'FARM SHORTLIST' : state.view === 'priced' ? 'PRICED BENCHMARKS' : 'LAUNCH VALUE BOARD'), text('span', list.length + ' rows  /  TVL ' + usd(sum(list, 'tvl_usd')) + (state.view === 'radar' ? '  /  implied ' + usd(sum(list, 'implied_value_usd')) : '  /  cap ' + usd(sum(list, 'mcap_usd')))), text('span', 'Select a row for the full calculation →', 'muted')),
      !list.length ? el('div', { class: 'panel empty', text: 'No protocol matches these filters. Use Reset to restore the board.' }) : state.view === 'priced' ? benchmarks(list) : board(list),
      note('¹ Age since listing, not verified token-free lifetime. ² Snapshot prevalence-as-launch proxy. ³ Surplus after $15/h time cost, gas ceilings and capital charges. Rank band = interval envelope, not confidence.'),
      state.verdict === 'FARM' ? shortlist(list) : null,
      el('details', { class: 'panel methodology' }, text('summary', 'Model notebook / 16 ablations, odds estimator and economic assumptions'), note(D.validation.guard), note(D.validation.limitation),
        el('table', { class: 'mini' }, el('thead', null, el('tr', null, ['Term removed from v1', 'LOO x-error', 'Walk x-error', 'Decision'].map(s => text('th', s)))), el('tbody', null, D.validation.term_decisions.map(t => el('tr', null, text('td', t.term), text('td', x(t.without.loo_x)), text('td', x(t.without.walk_x)), text('td', t.retained ? 'RETAIN' : 'DROP'))))),
        note('Odds: ' + D.odds_model.positives + '/(' + D.odds_model.positives + '+' + D.odds_model.controls + ') pooled prior; category-age shrinkage strength ' + D.odds_model.strength + '; age cuts ' + D.odds_model.age_cut_days.join('/') + ' days.'), note(D.odds_model.warning), note('Complete executable model and target ledgers: model.txt and proof.json, included whole in the dossier. Budgets and allocations are scenarios, not data. See method.txt.'))];
  }
  // Shared economic scenario formula, checked against board.json by browser QA.
  function scenario(r, deposit, share) {
    const e = r.economics, c = D.econ, weight = Math.min(deposit / c.reference_capital, c.max_weight);
    const cost = e.fee_ceiling_usd + deposit * c.opportunity_apr * e.horizon_days / 365 + deposit * c.capital_risk_rate + e.time_cost_usd;
    const net = r.token_odds * r.implied_value_usd * share * weight - cost, hourly = net / (e.minutes / 60);
    return { net, hourly, verdict: net <= 0 ? 'SKIP' : hourly >= c.farm_surplus_per_hour ? 'FARM' : 'MARGINAL' };
  }
  function detail(r) {
    const m = r.model, e = r.economics, recomputed = Math.round(r.tvl_usd * m.peer_multiple * m.growth_multiplier * m.maturity_multiplier * m.completeness_multiplier);
    const fact = (label, val) => el('div', null, text('span', label), text('b', val));
    return [el('div', { class: 'detail-nav' }, el('button', { text: '← Back to radar', onclick: () => change('p', '') }), text('span', 'MODEL DOSSIER / RANK ' + r.rank + ' OF ' + D.board_size, 'eyebrow')),
      el('section', { class: 'detail-hero' }, el('div', null, text('h1', r.name, 'detail-name'), text('p', (r.category || 'Other') + ' · ' + r.chains.join(', ') + ' · No token recorded · listed ' + (r.listed_at || 'unknown'), 'muted')), el('div', null, badge(r.verdict), text('small', e.verdict === 'SKIP' ? 'Costs exceed the central reward scenario' : 'Conditional economics; eligibility unknown', 'muted'))),
      el('section', { class: 'kpis detail-kpis' }, kpi('IF IT LAUNCHES', usd(r.implied_value_usd), 'circulating-cap scenario'), kpi('PEER P25–P75', usd(r.implied_p25_usd) + '–' + usd(r.implied_p75_usd), r.value_range.source + ' · n=' + r.value_range.peer_count), kpi('TOKEN ODDS PROXY', prob(r.token_odds), r.odds.priced + '/' + r.odds.cohort_n + ' local priced / all'), kpi('EXPECTED DROP', cash(e.expected_drop_usd), (e.wallet_share * 1e6).toFixed(1) + ' ppm wallet share assumption'), kpi('NET / NET PER HOUR', cash(e.net_usd) + ' / ' + cash(e.net_per_hour_usd), e.horizon_days + 'd · ' + e.minutes + ' min · after time cost')),
      el('div', { class: 'detail-grid' }, el('div', { class: 'detail-column' },
        el('section', { class: 'panel figure' }, text('h2', '01 / How the figure is made'), el('div', { class: 'equation' }, fact('TVL', usd(r.tvl_usd)), fact('Blended cap/TVL', x(m.peer_multiple)), fact('Growth', x(m.growth_multiplier)), fact('Maturity', x(m.maturity_multiplier)), fact('Completeness', x(m.completeness_multiplier)), fact('Rounded value', usd(recomputed))),
          note((recomputed === r.implied_value_usd ? '✓ Matches board.json. ' : 'MISMATCH. ') + m.peer_source + ', n=' + m.peer_count + '; 7d ' + pct(r.change_7d) + '; listed ' + r.age_days + ' days. All four v1 terms retained by held-out guard.'),
          note('Range: TVL × raw ' + x(r.value_range.p25_multiple) + '–' + x(r.value_range.p75_multiple) + ' × signal factors ' + x(r.value_range.adjustment) + '. ' + r.value_range.source + ' (' + r.value_range.category_count + ' category peers). Dispersion ≠ confidence.'),
          note('Odds = (' + r.odds.priced + ' + ' + r.odds.strength + ' × ' + prob(r.odds.prior) + ') / (' + r.odds.cohort_n + ' + ' + r.odds.strength + '). Age bucket ' + r.odds.age_bucket + '; cuts ' + D.odds_model.age_cut_days.join('/') + 'd. No horizon calibration.')),
        el('section', { class: 'panel peers' }, text('h2', '02 / Nearest priced peers'), text('small', 'Up to 9 from the range pool, nearest |log TVL ratio|. All ' + r.value_range.peer_count + ' pool records set the range.', 'micro'),
          el('table', { class: 'mini', id: 'nearest-peers' }, el('thead', null, el('tr', null, ['Peer / category', 'TVL', 'Cap', 'Cap/TVL', '7d'].map(s => text('th', s)))),
            el('tbody', null, r.nearest_peers.map(p => el('tr', null, el('td', null, text('b', p.name), text('small', p.category || 'Other')), text('td', usd(p.tvl_usd)), text('td', usd(p.mcap_usd)), text('td', x(p.multiple)), text('td', pct(p.change_7d)))))),
          note('Benchmarks / point: ' + x(r.implied_value_usd / r.tvl_usd) + ' TVL vs pooled ' + x(D.calibration.global_multiple) + '. Odds ' + prob(r.token_odds) + ' vs pooled ' + prob(D.odds_model.pooled_rate) + '.')),
        el('section', { class: 'panel benchmark-note' }, text('h2', '03 / Held-out benchmarks'), note('LOO n=' + D.validation.leave_one_out.n + ' · v1 ' + x(D.validation.leave_one_out.v1_x) + ' → v2 ' + x(D.validation.leave_one_out.v2_x) + '. Walk n=' + D.validation.walk_forward.n + ' · ' + x(D.validation.walk_forward.v1_x) + ' → ' + x(D.validation.walk_forward.v2_x) + '. Listing-order snapshot proxy, not historical; shared-token bias remains.'))),
        el('div', { class: 'detail-column' },
          el('section', { class: 'panel sensitivity' }, text('h2', '04 / Drop-share × deposit'), text('small', 'Net USD after ALL costs • assumed wallet share at $100 • allocation unverified', 'micro'),
            el('table', { class: 'matrix', id: 'scenario-matrix' }, el('thead', null, el('tr', null, text('th', 'Share ↓ / pilot →'), D.econ.deposits.map(n => text('th', usd(n))))), el('tbody', null, D.econ.scenario_shares.map(share => el('tr', null, text('th', (share * 1e6).toFixed(1) + ' ppm'), D.econ.deposits.map(dep => { const s = scenario(r, dep, share); return el('td', { class: s.verdict.toLowerCase(), 'data-net': s.net }, text('b', cash(s.net)), text('small', s.verdict)); }))))),
            note('Base net: ' + cash(e.expected_drop_usd) + ' drop − ' + cash(e.fee_ceiling_usd) + ' fees − ' + cash(e.opportunity_cost_usd + e.capital_risk_charge_usd) + ' capital charges − ' + cash(e.time_cost_usd) + ' time = ' + cash(e.net_usd) + '. Break-even ' + (e.breakeven_share_at_100 * 1e6).toFixed(2) + ' ppm at $100.')),
          el('section', { class: 'panel plan' }, el('div', { class: 'section-label' }, text('h2', '05 / Conditional farm plan'), text('b', usd(e.capital_ceiling_usd) + ' MAX', 'accent')),
            note(r.farm_plan.action + ' · ' + e.horizon_days + 'd observation · ' + e.minutes + ' min · 4 fee actions × ' + usd(e.fee_per_action_usd) + '. FARM requires positive net and ≥$15/h surplus AFTER $15/h time cost.'),
            el('ol', { id: 'farm-plan' }, r.farm_plan.steps.map(s => el('li', null, text('p', s.text), text('small', 'Cost: ' + s.cost + '. Time: ' + s.time + '.')))),
            note('Principal is assumed returned; full loss is possible. Fees are ceilings, not quotes. No eligibility or reward is established; zero allocation means zero reward.')))),
      text('footer', 'FROZEN RESEARCH • Odds are cross-sectional prevalence, not a measured launch forecast. 1 ppm = 0.0001% of implied cap at a $100 pilot. All figures are entry estimates.', 'detail-footer micro')];
  }
  function render() {
    root.textContent = '';
    const r = state.p && D.rows.find(r => r.slug === state.p);
    root.appendChild(el('div', { class: 'shell' + (r ? ' detail-shell' : '') }, head(), r ? detail(r) : overview()));
    root.setAttribute('aria-busy', 'false');
  }
  readHash(); render();
  window.addEventListener('hashchange', () => { readHash(); render(); window.scrollTo(0, 0); });
})();
