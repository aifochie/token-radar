// Offline renderer for the token radar board. Values, breakdowns, and farm steps
// all come from the same board produced in lib/model.ts; no network or duplicate plans.
(function () {
  'use strict';
  var app = document.getElementById('board');
  var DATA = window.RADAR;
  if (!DATA) {
    app.textContent = 'Run main.ts and open the generated output/dashboard/index.html beside output/data.js.';
    app.setAttribute('aria-busy', 'false');
    return;
  }
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) { return n === null ? 'unknown' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(n) { return n === null ? 'unknown' : n >= 365 ? (n / 365).toFixed(1) + 'y' : n + 'd'; }
  function impliedOf(row) {
    return Math.min(DATA.model.max_value_usd, Math.max(1, Math.round(row.tvl_usd * row.model.peer_multiple * row.model.growth_multiplier * row.model.maturity_multiplier * row.model.completeness_multiplier)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var children = Array.isArray(arguments[i]) ? arguments[i] : [arguments[i]];
      children.forEach(function (c) {
        if (c !== null && c !== undefined) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function readHash() {
    var p = new URLSearchParams(window.location.hash.slice(1));
    state.q = p.get('q') || '';
    state.category = p.get('category') || 'all';
    state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.selected) p.set('p', state.selected);
    var hash = p.toString();
    window.history.replaceState(null, '', hash ? '#' + hash : window.location.pathname + window.location.search);
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    var source = state.tab === 'live' ? DATA.live : DATA.rows;
    return source.filter(function (r) {
      return (state.category === 'all' || (r.category || 'Other') === state.category) &&
        (!q || [r.name, r.slug, r.category, r.chains.join(' ')].join(' ').toLowerCase().indexOf(q) >= 0);
    });
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      function value(r) {
        if (state.sort === 'name') return r.name.toLowerCase();
        if (state.sort === 'tvl') return r.tvl_usd;
        if (state.sort === 'growth') return r.change_7d;
        if (state.sort === 'age') return r.age_days;
        return r.implied_value_usd;
      }
      var av = value(a), bv = value(b);
      if (av === null && bv !== null) return 1;
      if (bv === null && av !== null) return -1;
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function fact(label, value) { return el('div', { class: 'fact' }, el('span', { text: label }), el('b', { text: value })); }
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Fieldwork / Token Radar' })),
      el('div', { class: 'top-meta' }, el('span', { text: 'Frozen snapshot ' + DATA.as_of }), el('span', { text: DATA.model_version })));
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' protocols. One transparent value model.' }),
        el('p', { text: 'Every watchlist entry, plus ' + DATA.early_size + ' additional candidates ranked from the sealed snapshot. Each records no token in this data. Compare the implied launch values, inspect the assumptions, then review a conditional farm plan.' })),
      el('div', { class: 'facts' },
        fact('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
        fact('Additional candidates below $' + Math.round(DATA.floor_usd / 1e6) + 'M', String(DATA.below_floor_size)),
        fact('Token-bearing valuation peers', String(DATA.calibration.global_peers)),
        fact('Recorded-token examples kept separate', String(DATA.live_size))));
  }
  function controls() {
    var categories = Array.from(new Set((state.tab === 'live' ? DATA.live : DATA.rows).map(function (r) { return r.category || 'Other'; }))).sort();
    if (categories.indexOf(state.category) < 0 && state.category !== 'all') categories.push(state.category);
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () {
      var start = search.selectionStart, end = search.selectionEnd;
      state.q = search.value; writeHash(); render();
      var next = document.getElementById('q');
      next.focus(); next.setSelectionRange(start, end);
    });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }), categories.map(function (c) { return el('option', { value: c, text: c }); }));
    select.value = state.category;
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    function tab(key, label) { return el('button', { type: 'button', 'aria-pressed': String(state.tab === key), text: label,
      onclick: function () { state.tab = key; state.category = 'all'; writeHash(); render(); } }); }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Snapshot token status' }), el('div', { class: 'tabs' }, tab('pre-token', 'No token recorded'), tab('live', 'Recorded token'))),
      el('span', { class: 'count', 'aria-live': 'polite', text: rows().length + ' rows shown' }));
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col', 'aria-sort': state.sort === key ? state.dir === -1 ? 'descending' : 'ascending' : 'none' },
      el('button', { type: 'button', text: label + (state.sort === key ? state.dir < 0 ? ' ↓' : ' ↑' : ''), onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        render();
      } }));
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (!list.length) return empty();
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; }));
    var body = el('tbody');
    list.forEach(function (r) {
      body.appendChild(el('tr', { 'data-slug': r.slug, 'data-selected': String(state.selected === r.slug), tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains.slice(0, 2).join(', ') || 'chain unknown') }), el('span', { class: 'sub', text: r.watchlist ? 'Watchlist' : 'Additional candidate' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' }, el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(1, Math.round(r.implied_value_usd / max * 100)) + '%' })), el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
        el('td', null, el('span', { class: 'status', text: r.token_status }))));
    });
    return el('div', { class: 'panel table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'Default order: highest implied value first. Select any row for its assumptions and farm steps.' }),
      el('thead', null, el('tr', null, sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'), sortHeader('age', 'Listed age'), sortHeader('implied', 'Implied value'), el('th', { scope: 'col', text: 'Token record' }))), body));
  }
  function empty() {
    return el('div', { class: 'panel empty' }, el('h2', { text: 'No protocol matches that filter' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } }));
  }
  function liveTable() {
    var list = rows();
    if (!list.length) return empty();
    return el('div', { class: 'panel table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'Recorded token identifiers; snapshot market caps are separate from modeled launch values.' }),
      el('thead', null, el('tr', null, ['Protocol', 'Category', 'TVL', 'Recorded market cap', 'Symbol'].map(function (s) { return el('th', { scope: 'col', text: s }); }))),
      el('tbody', null, list.map(function (r) { return el('tr', null,
        el('td', { text: r.name }), el('td', { text: r.category || 'Other' }), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(r.mcap_usd !== null && r.mcap_usd > 0 ? r.mcap_usd : null) }), el('td', { text: r.symbol || 'unreported' })); }))));
  }
  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'A peer-calibrated scenario, with visible assumptions' }),
      el('p', { class: 'sub', text: 'Market-cap / TVL ratios from ' + DATA.calibration.global_peers + ' token-bearing snapshot rows are clipped to ' + m.ratio_floor + '–' + m.ratio_cap + ' and median-aggregated. Global median: ' + DATA.calibration.global_multiple.toFixed(4) + '×. A category with at least ' + m.minimum_category_peers + ' peers blends its median with the global median, weighted n / (n + ' + m.shrinkage_peers + '). Sparse categories use the global median; an empty peer universe uses ' + m.fallback_multiple + '×.' }),
      el('div', { class: 'formula', text: 'implied = round(TVL × peer multiple × sqrt(1 + clamp(7d growth, −60, 150) / 100) × (0.55 + 0.45 × (1 − exp(−listed age / 365))) × completeness)' }),
      el('p', { class: 'sub', text: 'Missing growth uses 0% and a 0.90 factor; missing age uses 180 days and a 0.85 factor; missing chains apply 0.90. Age is days since listing as of ' + DATA.as_of + ', not a known token-free history. Mandatory watchlist entries are retained; other eligible rows are selected by implied value, with slug tie-breaks.' }),
      el('p', { class: 'sub', text: 'Peer rows can share token economics, and TVL is not revenue. Sensitivity factors are the nearest-rank 25th and 75th percentiles divided by the median of the clamped peer ratios: category peers for category blends, all peers for global estimates. They describe peer dispersion, not a confidence interval; with no peers both factors are 1. The snapshot contains no verified integrations, fees, reward programs or eligibility. Farm budgets are conditional planning assumptions; token launch timing and rewards remain unknown.' }),
      el('p', { class: 'sub', text: 'Capital ceilings remain $150 for TVL of at least $1B, $100 for TVL of at least $100M, and $50 below $100M. This planning convention scales the size of a small pilot position with protocol size; higher TVL does not establish safety, eligibility, or rewards.' }));
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  document.body.appendChild(dialog);
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function equation(label, value) { return el('div', null, el('span', { text: label }), el('b', { class: 'num', text: value })); }
  function openDetail(slug) {
    var r = DATA.rows.find(function (row) { return row.slug === slug; });
    if (!r) return;
    state.selected = slug; writeHash(); dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null, el('span', { class: 'brand-name', text: 'Rank ' + r.rank + ' / ' + DATA.board_size }), el('h2', { id: 'detail-title', text: r.name }), el('p', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains.join(', ') || 'chain unknown') })),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value: ' + fmtUsd(r.implied_value_usd) }),
      el('div', { class: 'equation' },
        equation('TVL', fmtUsd(r.tvl_usd)), equation('Peer multiple (' + r.model.peer_source + ')', r.model.peer_multiple.toFixed(4) + '×'),
        equation(r.model.peer_source === 'category blend' ? 'Category peer rows' : r.model.peer_source === 'global peers' ? 'Global peer rows' : 'Observed peer rows', String(r.model.peer_count)), equation('7d TVL change', fmtPct(r.change_7d)),
        equation('Age since listing', fmtAge(r.age_days)), equation('Growth multiplier', r.model.growth_multiplier.toFixed(4) + '×'),
        equation('Maturity multiplier', r.model.maturity_multiplier.toFixed(4) + '×'), equation('Completeness multiplier', r.model.completeness_multiplier.toFixed(4) + '×'),
        equation('Sensitivity (' + r.model.sensitivity_low_factor.toFixed(2) + 'x-' + r.model.sensitivity_high_factor.toFixed(2) + 'x)', fmtUsd(r.sensitivity_low_usd) + '–' + fmtUsd(r.sensitivity_high_usd))),
      el('p', { class: 'sub', text: 'The stored factors recompute to ' + fmtUsd(impliedOf(r)) + (impliedOf(r) === r.implied_value_usd ? ', matching board.json.' : '; mismatch: regenerate the output.') + ' This scenario estimates value if present records hold; it does not predict a launch.' })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Conditional farm plan' }),
      el('p', { class: 'notice', text: r.farm_plan.action + ' · capital ceiling ' + fmtUsd(r.farm_plan.capital_budget_usd) + ' · ' + r.farm_plan.observation_days + '-day observation plan. Verify the route before spending; rewards may be zero.' }),
      el('ol', { class: 'steps' }, r.farm_steps.map(function (s) {
        var split = s.indexOf(' Cost: ');
        return el('li', null, el('b', { text: split < 0 ? s : s.slice(0, split) }), el('span', { class: 'cost', text: split < 0 ? '' : s.slice(split + 1) }));
      }))));
    if (!dialog.open) dialog.showModal();
  }
  function render() {
    app.textContent = '';
    app.appendChild(el('div', { class: 'shell' }, header(), lede(), controls(),
      el('p', { class: 'notice', text: 'Frozen research data · no live feeds · no token or reward issuance is confirmed by this model.' }),
      state.tab === 'live' ? liveTable() : boardTable(), state.tab === 'live' ? null : modelPanel()));
    app.setAttribute('aria-busy', 'false');
  }
  readHash(); render();
  if (state.selected) openDetail(state.selected);
  window.addEventListener('hashchange', function () { readHash(); render(); if (state.selected) openDetail(state.selected); else if (dialog.open) dialog.close(); });
})();
