// Token Radar's dashboard, radar-4. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan, and the live-token protocols set aside below.
// No network: every byte it shows is in data.js.
//
// The page recomputes every row's value from the fit: logValueOf below is the same linear model as
// lib/model.ts, with the coefficients data.js carries. The detail drawer says whether the recompute
// matches the board value, so a reader can see the model rather than take it on trust.
//
// The farm steps are generated here too, from the same inputs as lib/model.ts: chain count, capital
// band, hold days and the row's launch odds and expected value. They are not copied from the board
// file, so the plan logic stays visible in the source, and the text must match the model's steps
// character for character (the build's tests compare them).
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', sort: 'implied', dir: -1, selected: null, watchlistOnly: false };
  var fit = DATA.fit;
  var c = fit.coefficients;

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The fitted value model, recomputed from the row: ln(implied value) = 7.951 + 0.464 ln(TVL)
  // - 1.783 tanh(growth/60) - 0.078 age in years. No sector term: the fit's held-out test says a
  // sector multiple makes it worse, so the board carries none.
  function ageYearsOf(row) {
    return (row.age_days === null || row.age_days === undefined ? fit.validation.median_age_days : row.age_days) / 365;
  }
  function logValueOf(row) {
    var growth = Math.min(1000, Math.max(-95, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var tanhGrowth = Math.tanh(growth / 60);
    return c.intercept + c.log_tvl * Math.log(Math.max(1, row.tvl_usd)) + c.tanh_growth * tanhGrowth + c.age_years * ageYearsOf(row);
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(Math.exp(logValueOf(row))));
  }

  // A tiny element helper: h('div', {class: 'x', text: 'y'}, child, child).
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the opening move, the capital, the hold and every cost and time, and step six states
  // the rough expected value from the row's implied value and launch odds. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function chainsText(p) {
    var chains = (p.chains || []).filter(function (c) { return c.length > 0; });
    if (chains.length === 0) return 'its main chain';
    if (chains.length === 1) return chains[0];
    return chains[0] + ' or ' + chains[1];
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5000000000) return 250;
    if (p.tvl_usd >= 1000000000) return 150;
    if (p.tvl_usd >= 100000000) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function openingFor(p, capital, chains) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Bring $' + capital + ' of USDC onto ' + chains + ' and supply it to ' + name + ' as your opening deposit, leaving it earning for the full hold.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Bring $' + capital + ' of USDC onto ' + chains + " and add it to " + name + "'s deepest pool as your opening position, keeping it in range.";
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Bring $' + capital + ' of USDC onto ' + chains + ' and deposit it into ' + name + "'s highest-TVL vault, leaving the shares untouched.";
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Bring $' + capital + ' onto ' + chains + ' and stake it through ' + name + ' as your opening position, keeping the receipt token in the same wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Bring $' + capital + ' of USDC onto ' + chains + ' and deposit it as margin on ' + name + ', opening one small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Bring $' + capital + ' of USDC onto ' + chains + ' and fund ' + name + ' with it, taking one position on a market that settles after the hold ends.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Bring $' + capital + ' of USDC onto ' + chains + ' and allocate it to a ' + name + ' vault, keeping the vault shares for the full hold.';
    if (c.indexOf('stable') >= 0) return 'Bring $' + capital + ' onto ' + chains + ' and mint or deposit the stable asset through ' + name + ', holding it for the full hold.';
    if (c.indexOf('rwa') >= 0) return 'Bring $' + capital + ' onto ' + chains + " and mint " + name + "'s yield-bearing asset, holding it for the full hold.";
    if (c.indexOf('insurance') >= 0) return 'Bring $' + capital + ' onto ' + chains + ' and buy cover from ' + name + ', keeping the policy active for the full hold.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC into ' + chains + ' through ' + name + ' and put the bridged funds to work in its app.';
    return 'Bring $' + capital + ' of USDC onto ' + chains + ' and deposit it into ' + name + ' as your opening position, keeping it open for the full hold.';
  }
  function weeklyFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow a small amount against the deposit on ' + name + ', then repay it the same week.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return "Swap a small amount through " + name + "'s router on " + chain + ' once a week.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Adjust the hedge on ' + name + ' once a week, or close and reopen it if it drifted.';
    if (c.indexOf('prediction') >= 0) return 'Take one small new position on ' + name + ' each week instead of leaving the first one alone.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return "Claim and restake the vault's yield on " + name + ' once a week.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return "Check the " + name + " vault's allocation report weekly and rebalance only if it moved.";
    if (c.indexOf('rwa') >= 0) return 'Check the yield accrual on ' + name + ' weekly and keep the receipt in the same wallet.';
    return 'Do one on-chain interaction on ' + name + ' each week, such as a swap, a vote or a small top-up.';
  }
  function shortUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chains = chainsText(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: openingFor(p, capital, chains), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: weeklyFor(p, chainOf(p)), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days, so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points page from the link in its official docs and check the claim there; never connect your wallet to a link from a DM or a search ad.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Rough expected value: ' + shortUsd(p.implied_value_usd) + ' implied value times ' + Math.round(p.launch_odds * 100) + '% launch odds is about ' + shortUsd(p.expected_value_usd) + ', minus about $' + (capital + gas + 5) + ' of capital and gas, a wide range, and only a slice of it would ever reach one wallet.', cost: 'about $' + (capital + gas + 5) + ' at stake', time: 'no extra time' },
      { text: 'Farm from one wallet only: splitting the same activity across many wallets is the pattern airdrop filters flag as Sybil, and it can void the whole position.', cost: 'nothing to do right, everything to lose by splitting', time: 'no extra time' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('w') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    if (state.watchlistOnly) params.set('w', '1');
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.launch_odds; bv = b.launch_odds; }
      else if (key === 'expected') { av = a.expected_value_usd; bv = b.expected_value_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }), h('span', { class: 'brand-name', text: 'TOKEN RADAR' })),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: fit.version + ' model, fitted at runtime' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    var v = fit.validation;
    return h('section', { class: 'lede' },
      h('div', null,
        h('h1', { text: 'Which tokenless protocols are worth farming, and what is each one worth?' }),
        h('p', null,
          'Every protocol without a token is scored by a value model ',
          h('b', { text: 'fitted to the ' + v.pool_size + ' live-token protocols in this snapshot' }),
          ', not by a made-up multiple: log market cap on log TVL, 7-day growth and age, with held-out validation. The board ranks ',
          h('b', { text: String(DATA.board_size) + ' protocols' }),
          ', gives each one a launch probability from its peers, and a farm plan that states its cost and its expected value. The strongest, ',
          h('b', { text: top ? top.name : '—' }),
          ', carries an implied value of ',
          h('b', { text: top ? fmtUsd(top.implied_value_usd) : '—' }),
          '.'
        )
      ),
      h('div', { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.audit.watchlist_covered + ' / ' + DATA.audit.watchlist_size })),
        h('div', { class: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
        h('div', { class: 'fact' }, h('span', { text: 'Fitted model, test error' }), h('b', { text: 'median |log error| ' + v.test_median_abs_log_error.toFixed(2) })),
        h('div', { class: 'fact' }, h('span', { text: 'Median launch odds' }), h('b', { text: Math.round(DATA.median_launch_odds * 100) + '%' })),
        h('div', { class: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function kpiStrip() {
    var v = fit.validation;
    var audit = DATA.audit;
    return h('section', { class: 'kpi', 'aria-label': 'Board at a glance' },
      h('div', { class: 'kpi-item' }, h('b', { text: String(DATA.board_size) }), h('span', { text: 'protocols ranked' })),
      h('div', { class: 'kpi-item' }, h('b', { text: audit.watchlist_covered + ' / ' + audit.watchlist_size }), h('span', { text: 'watchlist covered' })),
      h('div', { class: 'kpi-item' }, h('b', { text: v.test_median_abs_log_error.toFixed(2) }), h('span', { text: 'fitted model test error (median |log error|)' })),
      h('div', { class: 'kpi-item' }, h('b', { text: Math.round(DATA.median_launch_odds * 100) + '%' }), h('span', { text: 'median launch odds' })),
      h('div', { class: 'kpi-item' }, h('b', { text: String(audit.live_with_mcap) }), h('span', { text: 'live protocols set aside below' }))
    );
  }

  function integrityStrip() {
    var integ = DATA.integrity;
    var audit = DATA.audit;
    function check(ok, label) {
      return h('span', { class: 'check ' + (ok ? 'ok' : 'bad'), text: (ok ? '✓ ' : '✗ ') + label });
    }
    return h('div', null,
      h('section', { class: 'integrity', 'aria-label': 'Board self-checks' },
        check(integ.ranks_ok, 'ranks 1..' + DATA.board_size),
        check(integ.values_non_increasing, 'values non-increasing'),
        check(integ.distinct_values, 'values distinct'),
        check(integ.watchlist_covered, 'watchlist ' + audit.watchlist_covered + '/' + audit.watchlist_size),
        check(integ.farm_steps_ok, 'farm steps 3-12, 20-600 chars')
      ),
      h('p', { class: 'audit', text: 'All ' + audit.total + ' snapshot protocols are accounted for: ' + audit.board + ' on the board, ' + audit.live_with_mcap + ' live with a market cap set aside below, ' + audit.live_cex_set_aside + ' centralised exchanges set aside, ' + audit.token_no_mcap + ' with a token but no usable market cap, ' + audit.excluded_category + ' excluded by category (wrapped, staked, bridge or derivative), ' + audit.versioned + ' versioned names set aside.' })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return h('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var watch = h('button', { type: 'button', class: 'chip', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchlistOnly = !state.watchlistOnly; writeHash(); render(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), select),
      h('div', { class: 'field' }, h('span', { class: 'sub', text: 'Scope' }), watch),
      h('span', { class: 'count', text: visibleRows().length + ' rows shown' })
    );
  }

  function sortHeader(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = (DATA.rows[0] && DATA.rows[0].implied_value_usd) || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = h('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null, h('div', { class: 'name' },
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: growth }),
        h('td', { class: 'num', text: fmtAge(r.age_days) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        h('td', { class: 'num', text: Math.round(r.launch_odds * 100) + '%' }),
        h('td', { class: 'num', text: fmtUsd(r.expected_value_usd) }),
        h('td', null, h('span', { class: 'status', text: r.watchlist ? 'watchlist' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, launch odds and farm plan.' }),
          h('thead', null, h('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('odds', 'Launch odds'),
            sortHeader('expected', 'Expected value'),
            h('th', { scope: 'col', text: 'Status' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', { class: 'num', text: (r.mcap_usd / Math.max(1, r.tvl_usd)).toFixed(1) + 'x' }),
        h('td', null, h('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return h('section', { class: 'panel model' },
      h('h2', { text: 'Already launched: ' + DATA.live.length + ' live protocols with a market cap' }),
      h('p', { class: 'sub', text: 'These protocols already have a token, so they are not farmable and they are not on the board. They are listed here so the reader can check the fitted model against real market caps, and so every snapshot protocol is accounted for.' }),
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Mcap / TVL' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var v = fit.validation;
    return h('section', { class: 'panel model' },
      h('h2', { text: 'How the implied value is fitted' }),
      h('p', { class: 'sub', text: 'The model is a linear regression fitted at runtime on the ' + v.pool_size + ' live-token protocols that have a market cap, a TVL, a 7-day change and a listing date. The target is log market cap; the fit reports its own held-out numbers, and the board uses the same fit for every row.' }),
      h('div', { class: 'formula' },
        h('div', null, h('b', { text: 'ln(implied value)' }), ' = ' + c.intercept.toFixed(3) + ' + ' + c.log_tvl.toFixed(3) + ' ln(TVL) + ' + c.tanh_growth.toFixed(3) + ' tanh(7d growth / 60) + ' + c.age_years.toFixed(3) + ' age in years'),
        h('div', null, h('b', { text: 'fit' }), ': ' + v.train_size + ' train / ' + v.test_size + ' test (80/20 by slug hash). Train R² ' + v.train_r2.toFixed(3) + '. Test median |log error| ' + v.test_median_abs_log_error.toFixed(2) + ', test mean ' + v.test_mean_abs_log_error.toFixed(2) + ', leave-one-out median ' + v.loo_median_abs_log_error.toFixed(2) + '.'),
        h('div', null, h('b', { text: 'sector' }), ': a category multiple was tested the same way and dropped: its test median |log error| ' + v.sector_test_median_abs_log_error.toFixed(2) + ' is worse than ' + v.test_median_abs_log_error.toFixed(2) + ' without it, so the board carries no sector adjustment.')
      ),
      h('p', { class: 'sub', text: 'Growth enters with a negative sign: among live protocols, a fast 7-day TVL jump relative to market cap reads as a hot week, not a higher steady value. Age is near zero. The model is rough — the median test miss is about a factor of ' + Math.exp(v.test_median_abs_log_error).toFixed(1) + 'x — so treat each implied value as an order of magnitude, not a price.' })
    );
  }

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var growth = row.change_7d === null || row.change_7d === undefined ? 0 : Math.min(1000, Math.max(-95, row.change_7d));
    var tanhGrowth = Math.tanh(growth / 60);
    var ageYears = ageYearsOf(row);
    var logVal = logValueOf(row);
    dialog.appendChild(h('div', { class: 'detail-head' },
      h('div', null,
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Implied value, fitted' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'ln(TVL) = ln(' + fmtUsd(row.tvl_usd) + ') x ' + c.log_tvl.toFixed(3) }), h('b', { class: 'num', text: (c.log_tvl * Math.log(Math.max(1, row.tvl_usd))).toFixed(2) })),
        h('div', null, h('span', { text: 'tanh(7d ' + fmtPct(row.change_7d) + ' / 60) x ' + c.tanh_growth.toFixed(3) }), h('b', { class: 'num', text: (c.tanh_growth * tanhGrowth).toFixed(2) })),
        h('div', null, h('span', { text: 'age ' + ageYears.toFixed(1) + ' years x ' + c.age_years.toFixed(3) }), h('b', { class: 'num', text: (c.age_years * ageYears).toFixed(2) })),
        h('div', null, h('span', { text: 'intercept' }), h('b', { class: 'num', text: c.intercept.toFixed(3) })),
        h('div', null, h('span', { text: 'ln(implied value)' }), h('b', { class: 'num', text: logVal.toFixed(2) })),
        h('div', null, h('span', { text: 'implied value' }), h('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        h('div', null, h('span', { text: 'launch odds, from peers' }), h('b', { class: 'num', text: Math.round(row.launch_odds * 100) + '%' })),
        h('div', null, h('span', { text: 'expected value, net of costs' }), h('b', { class: 'num', text: fmtUsd(row.expected_value_usd) }))
      ),
      h('p', { class: 'note', text: 'Model ' + fit.version + ': the same fit scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' Odds come from the launch record of protocols with a similar age and TVL, not from a guess: older, larger peers launch more often.' })
    ));
    dialog.appendChild(h('section', { class: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { class: 'cost', text: tail }));
      })),
      h('p', { class: 'note', text: 'TVL ' + fmtUsd(row.tvl_usd) + ' · 7d ' + fmtPct(row.change_7d) + ' · listed ' + fmtAge(row.age_days) + ' ago · ' + row.chains.length + ' chains.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(kpiStrip());
    shell.appendChild(integrityStrip());
    shell.appendChild(controls());
    shell.appendChild(boardTable());
    shell.appendChild(modelPanel());
    shell.appendChild(liveTable());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
