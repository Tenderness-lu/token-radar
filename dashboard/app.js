// Token Radar's dashboard, radar-8. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a top-ten strip by farm expected value, a
// per-protocol detail drawer with the model's own inputs and farm plan, and the live-token
// protocols set aside below. No network: every byte it shows is in data.js.
// The page recomputes every row's value from the fit (logValueOf, same linear model as
// lib/model.ts); the drawer says whether the recompute matches the board value. Farm steps are
// generated here too, from the same inputs as lib/model.ts, and must match the model's steps
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

  // The fitted value model, recomputed from the row: the same rule lib/model.ts uses,
  // with the kept model's beta and feature shape from data.js, so page and board never drift.
  function ageYearsOf(row) {
    return (row.age_days === null || row.age_days === undefined ? fit.validation.median_age_days : row.age_days) / 365;
  }
  function modelInputsOf(row) {
    var growth = Math.min(1000, Math.max(-95, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    return {
      logTvl: Math.log(Math.max(1, row.tvl_usd)),
      tanhGrowth: Math.tanh(growth / 30),
      ageYears: ageYearsOf(row)
    };
  }
  function logValueOf(row) {
    var terms = valueTermsOf(row);
    var sum = 0;
    for (var i = 0; i < terms.length; i++) sum += terms[i][1];
    return sum;
  }
  /** The value's term-by-term breakdown for the detail drawer: the kept model's four terms. */
  function valueTermsOf(row) {
    var beta = fit.beta || [c.intercept, c.log_tvl, c.tanh_growth, c.age_years];
    var inp = modelInputsOf(row);
    return [
      ['ln(TVL) = ln(' + fmtUsd(row.tvl_usd) + ') x ' + beta[1].toFixed(3), beta[1] * inp.logTvl],
      ['tanh(7d ' + fmtPct(row.change_7d) + ' / 30) x ' + beta[2].toFixed(3), beta[2] * inp.tanhGrowth],
      ['age ' + inp.ageYears.toFixed(1) + ' years x ' + beta[3].toFixed(3), beta[3] * inp.ageYears],
      ['intercept', beta[0]]
    ];
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the opening move, the capital, the hold and every cost and time. No name is special-cased.
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
  function secondFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply a second, smaller asset to ' + name + ' on ' + chain + ', so the wallet shows two markets used instead of one.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Add a small position to a second pool on ' + name + ', on ' + chain + ' if it lists one, and leave it in range.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Open one small spot hedge beside the ' + name + ' position, so the wallet is not a single-trade account.';
    if (c.indexOf('prediction') >= 0) return 'Resolve one settled market on ' + name + ' and claim the winnings, so the wallet shows a completed round.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit a small amount into a second ' + name + ' vault, so the wallet holds two vault shares.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Allocate a small amount to a second ' + name + ' vault with a different strategy, and hold both.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake a second, smaller amount through ' + name + ' on ' + chain + ', keeping both receipt tokens in the same wallet.';
    if (c.indexOf('stable') >= 0) return 'Hold a second stable asset minted through ' + name + ', so the wallet shows more than one mint.';
    if (c.indexOf('rwa') >= 0) return 'Mint a second, smaller ' + name + ' asset in another tenor, and hold both to the end of the hold.';
    return 'Take one more distinct action in the ' + name + ' app, such as voting, staking or a second deposit, so the wallet is not a one-transaction account.';
  }
  function totalCostFor(p) {
    var capital = capitalFor(p);
    var gas = capital >= 150 ? 8 : 4;
    var hold = holdDaysFor(p.age_days);
    var weeks = Math.max(1, Math.ceil(hold / 7));
    var weeklyGas = 2 * weeks;
    return { capital: capital, gas: gas, weeks: weeks, weeklyGas: weeklyGas, total: capital + gas + 3 + weeklyGas + 5 };
  }
  function farmSteps(p) {
    var chains = chainsText(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var cost = totalCostFor(p);
    var gross = p.gross_expected_value_usd;
    return [
      { text: openingFor(p, capital, chains), cost: '$' + capital + ' of capital and about $' + cost.gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: weeklyFor(p, chainOf(p)), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: secondFor(p, chainOf(p)), cost: 'about $2 of gas', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days, so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points page from the link in its official docs and check the claim there; never connect your wallet to a link from a DM or a search ad.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Net expected value: ' + shortUsd(p.implied_value_usd) + ' implied value times ' + Math.round(p.launch_odds * 100) + '% launch odds is about ' + shortUsd(gross) + ' gross, minus $' + cost.total + ' of costs ($' + capital + ' capital at stake, $' + cost.gas + ' setup gas, $' + cost.weeklyGas + ' weekly gas over ' + cost.weeks + ' weeks, $5 buffer), leaving about ' + shortUsd(p.expected_value_usd) + ' net — a wide range, and only a slice of it would ever reach one wallet.', cost: '$' + cost.total + ' of costs against ' + shortUsd(gross) + ' gross', time: 'no extra time' },
      { text: 'Plan the exit before the claim opens: withdraw the position in two or three tranches once the points page shows a claim, keep a small position until the claim is confirmed, and leave enough gas on ' + chainOf(p) + ' to claim.', cost: 'about $4 of gas to unwind', time: '20 minutes' },
      { text: "On claim day, open the claim from the protocol's own site, check the claim window and the token contract against the official docs, and never pay anyone to claim for you.", cost: 'claim gas only, about $3', time: '15 minutes' },
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
      else if (key === 'gross') { av = a.gross_expected_value_usd; bv = b.gross_expected_value_usd; }
      else if (key === 'cost') { av = a.total_cost_usd; bv = b.total_cost_usd; }
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
          ', not a made-up multiple: log market cap on log TVL, growth and age, held out and validated. The board ranks ',
          h('b', { text: String(DATA.board_size) + ' protocols' }),
          ', gives each a launch probability from its peers and a farm plan with its cost and expected value. The strongest, ',
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
      h('div', { class: 'kpi-item' }, h('b', { text: v.test_median_abs_log_error.toFixed(2) }), h('span', { text: 'test error (median |log error|)' })),
      h('div', { class: 'kpi-item' }, h('b', { text: Math.round(DATA.median_launch_odds * 100) + '%' }), h('span', { text: 'median launch odds' }))
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
      h('p', { class: 'audit', text: 'All ' + audit.total + ' accounted for: ' + audit.board + ' on the board, ' + audit.live_with_mcap + ' live, ' + audit.live_cex_set_aside + ' exchanges, ' + audit.token_no_mcap + ' token but no market cap, ' + audit.excluded_category + ' excluded by category, ' + audit.versioned + ' versioned.' })
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

  /** The ten best farms by expected value, above the full board: the board ranks by
   * implied value, this strip ranks by what a farm is worth after its costs. */
  function topEvStrip() {
    var top = DATA.rows.slice().sort(function (a, b) { return b.expected_value_usd - a.expected_value_usd; }).slice(0, 10);
    return h('section', { class: 'panel top-ev', 'aria-label': 'Top ten farms by expected value' },
      h('h2', { text: 'Top 10 farms by expected value' }),
      h('p', { class: 'sub', text: 'Implied value times launch odds, minus farm costs.' }),
      h('ol', { class: 'top-ev-list' }, top.map(function (r, i) {
        return h('li', null,
          h('button', { type: 'button', onclick: function () { openDetail(r.slug); } },
            h('b', { text: (i + 1) + '. ' + r.name }),
            h('span', { class: 'num', text: fmtUsd(r.expected_value_usd) + ' net EV' }),
            h('span', { class: 'sub', text: fmtUsd(r.implied_value_usd) + ' implied · ' + Math.round(r.launch_odds * 100) + '% odds' })
          )
        );
      }))
    );
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
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
        h('td', { class: 'num', text: '$' + r.total_cost_usd }),
        h('td', { class: 'num', text: fmtUsd(r.gross_expected_value_usd) }),
        h('td', null, h('span', { class: 'status', text: r.watchlist ? 'watchlist' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Sort by Farm net EV to rank by worth after costs; Farm cost is capital plus gas, Farm reward the gross expected value. Select a row for its model, odds and plan.' }),
          h('thead', null, h('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('odds', 'Launch odds'),
            sortHeader('expected', 'Farm net EV'),
            sortHeader('cost', 'Farm cost'),
            sortHeader('gross', 'Farm reward'),
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
      h('p', { class: 'sub', text: 'These protocols already have a token, so they are not farmable and not on the board. They are listed so the reader can check the fitted model against real market caps.' }),
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Already trading: market cap is a fact, not a model. Set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'Mcap / TVL' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function fmtSigned(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(digits === undefined ? 3 : digits);
  }

  function calibrationChart() {
    var pts = fit.calibration || [];
    var W = 640, H = 400, padL = 46, padB = 38, padT = 14, padR = 14;
    var xs = pts.map(function (p) { return p.predicted; });
    var ys = pts.map(function (p) { return p.actual; });
    var lo = Math.floor(Math.min.apply(null, xs.concat(ys))) - 1;
    var hi = Math.ceil(Math.max.apply(null, xs.concat(ys))) + 1;
    function X(v) { return padL + (v - lo) / (hi - lo) * (W - padL - padR); }
    function Y(v) { return H - padB - (v - lo) / (hi - lo) * (H - padT - padB); }
    var s = '';
    s += '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Leave-one-out calibration: predicted against actual log market cap for the ' + pts.length + ' fitted protocols">';
    s += '<line x1="' + X(lo) + '" y1="' + Y(lo) + '" x2="' + X(hi) + '" y2="' + Y(hi) + '" stroke="#f0b23e" stroke-width="1.5" stroke-dasharray="5 4"/>';
    for (var t = Math.ceil(lo); t <= hi; t += 1) {
      s += '<line x1="' + X(t) + '" y1="' + (H - padB) + '" x2="' + X(t) + '" y2="' + padT + '" stroke="#26333f" stroke-width="1"/>';
      s += '<line x1="' + padL + '" y1="' + Y(t) + '" x2="' + (W - padR) + '" y2="' + Y(t) + '" stroke="#26333f" stroke-width="1"/>';
      s += '<text x="' + X(t) + '" y="' + (H - padB + 16) + '" fill="#8fa1af" font-size="11" text-anchor="middle">' + t + '</text>';
      s += '<text x="' + (padL - 8) + '" y="' + (Y(t) + 4) + '" fill="#8fa1af" font-size="11" text-anchor="end">' + t + '</text>';
    }
    pts.forEach(function (p) {
      var err = Math.abs(p.predicted - p.actual);
      var fill = err > 1.5 ? '#e0705f' : '#f0b23e';
      s += '<circle cx="' + X(p.predicted).toFixed(1) + '" cy="' + Y(p.actual).toFixed(1) + '" r="3.2" fill="' + fill + '"><title>' + p.name + ' (' + (p.category || 'Other') + '): actual ' + p.actual.toFixed(2) + ', predicted ' + p.predicted.toFixed(2) + '</title></circle>';
    });
    s += '<text x="' + (W / 2) + '" y="' + (H - 6) + '" fill="#8fa1af" font-size="12" text-anchor="middle">predicted ln(market cap)</text>';
    s += '<text x="14" y="' + (H / 2) + '" fill="#8fa1af" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (H / 2) + ')">actual ln(market cap)</text>';
    s += '</svg>';
    var host = h('div', { class: 'calib' });
    host.innerHTML = s;
    return host;
  }

  /** The fitted equation as one line. The kept model is the four-term regression (or
   * its ridge twin, which has the same shape); a future kept shape writes its own line here. */
  function formulaText() {
    var beta = fit.beta || [c.intercept, c.log_tvl, c.tanh_growth, c.age_years];
    var f = function (n) { return (n >= 0 ? '+ ' : '- ') + Math.abs(n).toFixed(3); };
    var ridge = fit.features && fit.features.indexOf('ridge-') === 0 ? ' (ridge lambda ' + fit.features.slice(6) + ')' : '';
    return 'ln(implied value) = ' + beta[0].toFixed(3) + ' ' + f(beta[1]) + ' ln(TVL) ' + f(beta[2]) + ' tanh(7d growth / 30) ' + f(beta[3]) + ' age in years' + ridge;
  }

  /** The model's terms for the panel table: the kept model's four terms. */
  function modelTermRows() {
    var beta = fit.beta || [c.intercept, c.log_tvl, c.tanh_growth, c.age_years];
    return [
      ['intercept', beta[0], 'The level: at TVL $1, flat growth, age zero, the price would be e^' + beta[0].toFixed(2) + '.'],
      ['ln(TVL)', beta[1], 'Doubling TVL lifts the fitted value by about ' + Math.round((Math.pow(2, beta[1]) - 1) * 100) + '% (sub-linear).'],
      ['tanh(7d growth / 30)', beta[2], 'A hot week carries almost no signal. Radar-4 read -1.78 here; that was the exchange tokens in its pool.'],
      ['age in years', beta[3], 'Each extra year shaves about ' + Math.round((1 - Math.exp(beta[3])) * 100) + '% off, once TVL is in: an old tokenless protocol is discounted.']
    ];
  }


  /** What the five-split search decided, in one short sentence. */
  function fiveSplitNote() {
    var v = fit.validation;
    var rows = v.five_split || [];
    if (!rows.length) return 'No stability search was run for this model.';
    var kept = rows.filter(function (s) { return s.kept; })[0];
    if (kept) return 'Kept: ' + kept.name + ' — ' + kept.wins + ' of 5 wins, ' + kept.rank_moves_over_10 + ' rows moved >10 ranks. The base model is retired, not hidden.';
    var best = rows.slice().sort(function (a, b) { return b.wins - a.wins || a.mean_median - b.mean_median; })[0];
    return 'No candidate cleared both bars; the board keeps the base model. Closest: ' + best.name + ' (' + best.wins + ' of 5 wins, ' + best.rank_moves_over_10 + ' rows moved). One split can flatter a fragile term.';
  }

  /** The radar-8 fit-pool test, in one sentence. */
  function poolNote() {
    var pc = fit.validation.pool_comparison;
    if (!pc) return '';
    if (pc.kept_wide) return 'Fit pool: ' + pc.pool_dated_size + ' dated, plus ' + pc.pool_imputed_age + ' age-imputed — the wide pool won ' + pc.wins + ' of 5 splits and moved ' + pc.rank_moves_over_10 + ' rows, clearing both bars, so the board carries the ' + pc.pool_wide_size + '-protocol fit.';
    return 'Fit pool: ' + pc.pool_dated_size + ' dated protocols. The wide pool (' + pc.pool_wide_size + ', ' + pc.pool_imputed_age + ' age-imputed) won ' + pc.wins + ' of 5 splits and moved ' + pc.rank_moves_over_10 + ' rows >10 ranks, so the board keeps the ' + pc.pool_dated_size + '.';
  }

  function modelPanel() {
    var v = fit.validation;
    var odds = DATA.odds;
    var ov = odds.validation;
    var oddsTerms = [
      ['intercept', odds.coefficients[0], 'The level: age zero, TVL $1, flat growth, reference category ' + odds.reference_category + '.'],
      ['age in years', odds.coefficients[1], 'Older protocols launch more often.'],
      ['ln(TVL)', odds.coefficients[2], 'Size barely moves the odds once age is in.'],
      ['tanh(7d growth / 30)', odds.coefficients[3], 'A hot week argues against a launch, age and size held fixed.']
    ];
    odds.categories.forEach(function (cat, i) {
      oddsTerms.push([cat + ' (vs ' + odds.reference_category + ')', odds.coefficients[4 + i], 'Shift in log-odds vs ' + odds.reference_category + '.']);
    });
    if (odds.features === 'extended') {
      var nCat = odds.categories.length;
      oddsTerms.push(['log1p(chain count)', odds.coefficients[4 + nCat], 'More chains, higher odds.']);
      odds.categories.forEach(function (cat, i) {
        oddsTerms.push([cat + ' x age (vs ' + odds.reference_category + ')', odds.coefficients[5 + nCat + i], 'How fast this category\u2019s launch rate rises with age vs ' + odds.reference_category + '.']);
      });
    }
    var termRows = modelTermRows();
    var validRows = [
      ['Random 80/20 split', v.train_size + ' train / ' + v.test_size + ' test, by slug hash', v.test_median_abs_log_error, v.test_mean_abs_log_error, v.test_r2],
      ['Leave-one-category-out', v.loco_protocols + ' held out, ' + v.loco_categories + ' categories', v.loco_median_abs_log_error, v.loco_mean_abs_log_error, v.loco_r2],
      ['Leave-one-out', v.pool_size + ' refits', v.loo_median_abs_log_error, null, v.loo_r2]
    ];
    return h('section', { class: 'panel model', id: 'model-panel' },
      h('h2', { text: 'How the implied value is fitted — and how it is checked' }),
      h('p', { class: 'sub', text: 'One linear regression, fitted at runtime on the ' + v.pool_size + ' live-token protocols with a market cap, a TVL, a 7-day change and a listing date' + (v.pool_imputed_age ? ', plus ' + v.pool_imputed_age + ' more tested with age imputed at the pool median and not kept (see below)' : '') + '. Exchanges are set aside (' + v.pool_excluded_cex + '): an exchange token prices the exchange, not its TVL. The target is log market cap; the board uses the same fit for every row.' }),
      h('div', { class: 'formula' },
        h('div', null, h('b', { text: formulaText() }))
      ),
      h('div', { class: 'diag' },
        h('div', null,
          h('h3', { text: 'Every term, fitted' }),
          h('table', { class: 'diag-table' },
            h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Term' }), h('th', { scope: 'col', text: 'Coefficient' }), h('th', { scope: 'col', text: 'What it says' }))),
            h('tbody', null, termRows.map(function (r) {
              return h('tr', null, h('td', { class: 'num', text: r[0] }), h('td', { class: 'num', text: fmtSigned(r[1]) }), h('td', { text: r[2] }));
            }))
          )
        ),
        h('div', null,
          h('h3', { text: 'Held out twice, plus leave-one-out' }),
          h('table', { class: 'diag-table' },
            h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Check' }), h('th', { scope: 'col', text: 'Median |log error|' }), h('th', { scope: 'col', text: 'Mean |log error|' }), h('th', { scope: 'col', text: 'R²' }))),
            h('tbody', null, validRows.map(function (r) {
              return h('tr', null,
                h('td', null, h('b', { text: r[0] }), h('div', { class: 'sub', text: r[1] })),
                h('td', { class: 'num', text: r[2].toFixed(2) }),
                h('td', { class: 'num', text: r[3] === null ? '—' : r[3].toFixed(2) }),
                h('td', { class: 'num', text: fmtSigned(r[4], 2) })
              );
            }))
          ),
          h('p', { class: 'note', text: 'Train R² ' + v.train_r2.toFixed(2) + '. Held-out R² is near or below zero: one or two protocols carry market caps that ignore TVL (a locker at 19x, an allocator at 0.6%); squares let those two dominate, so the median is the robust read. ' + (fit.features === 'base' ? 'Unchanged from radar-5: same four terms, same pool, same medians (0.95 / 0.82 / 0.97). Radar-6 tried fourteen alternatives and kept none; radar-7 re-tested the close calls on five splits and kept none; radar-8 tested a wider fit pool and kept the 87 — see below.' : 'The kept model is ' + v.kept_model + ': it cleared the five-split search below, so these medians are its own.') })
        )
      ),
      h('div', null,
        h('h3', { text: 'Five-split stability search: would a richer model survive five splits?' }),
        h('p', { class: 'sub', text: 'Each candidate is fitted on four hash quintiles and tested on the fifth, five times over. It replaces the base only on four of five split wins AND fewer than 20 of 203 rows moved by more than ten ranks. Base split medians: ' + (v.five_split && v.five_split.length ? v.five_split[0].base_medians.map(function (m) { return m.toFixed(2); }).join(' / ') : '—') + '.' }),
        h('table', { class: 'diag-table' },
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Candidate' }), h('th', { scope: 'col', text: 'Split medians' }), h('th', { scope: 'col', text: 'Wins' }), h('th', { scope: 'col', text: 'Rows moved' }), h('th', { scope: 'col', text: 'Kept?' }))),
          h('tbody', null, (v.five_split || []).map(function (s) {
            return h('tr', null,
              h('td', null, h('b', { text: s.name })),
              h('td', { class: 'num', text: s.split_medians.map(function (m) { return m.toFixed(2); }).join(' / ') }),
              h('td', { class: 'num', text: s.wins + ' / 5' }),
              h('td', { class: 'num', text: String(s.rank_moves_over_10) }),
              h('td', { class: 'num', text: s.kept ? 'kept' : 'no' })
            );
          }))
        ),
        h('p', { class: 'note', text: fiveSplitNote() }),
        h('p', { class: 'note', text: poolNote() })
      ),
      h('div', null,
        h('h3', { text: 'Calibration: leave-one-out predictions vs actual market caps' }),
        calibrationChart(),
        h('p', { class: 'note', text: 'Each dot is one of the ' + v.pool_size + ' fitted protocols, predicted by a model that never saw it. The dashed line is perfect calibration; dots off it are market caps the snapshot cannot explain. Red dots miss by more than 1.5 in log terms (about 4.5x).' })
      ),
      h('div', null,
        h('h3', { text: 'Terms that were fitted and dropped' }),
        h('ul', { class: 'rejected' }, v.rejected.map(function (r) {
          return h('li', null, h('b', { text: r.name + ': ' }), 'random-split median ' + r.test_median_abs_log_error.toFixed(2) + ', leave-one-category-out median ' + r.loco_median_abs_log_error.toFixed(2) + ', leave-one-out median ' + r.loo_median_abs_log_error.toFixed(2) + ' — ' + r.note + '.');
        }))
      ),
      h('div', null,
        h('h3', { text: 'Launch odds: a logistic model, not a table' }),
        h('p', { class: 'sub', text: 'Radar-5 read odds off an age-by-TVL table. Radar-6 fits one logistic regression on launch over all 758 protocols, with age, log TVL, 7-day growth and category. Radar-7 adds chain count and a category-by-age interaction, kept only when the five-fold Brier improves: ' + (odds.features === 'extended' ? 'it does, ' + ov.five_fold_extended_logistic_brier.toFixed(3) + ' against the plain logistic\u2019s ' + ov.five_fold_logistic_brier.toFixed(3) + ', so the board carries the extended odds.' : 'it does not (' + ov.five_fold_extended_logistic_brier.toFixed(3) + ' against the plain logistic\u2019s ' + ov.five_fold_logistic_brier.toFixed(3) + '), so the board keeps the plain logistic odds.') }),
        h('table', { class: 'diag-table' },
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Term' }), h('th', { scope: 'col', text: 'Coefficient' }), h('th', { scope: 'col', text: 'What it says' }))),
          h('tbody', null, oddsTerms.map(function (r) {
            return h('tr', null, h('td', { class: 'num', text: r[0] }), h('td', { class: 'num', text: fmtSigned(r[1]) }), h('td', { text: r[2] }));
          }))
        ),
        h('table', { class: 'diag-table' },
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Odds model' }), h('th', { scope: 'col', text: 'Brier (fixed)' }), h('th', { scope: 'col', text: 'Brier (5-fold)' }), h('th', { scope: 'col', text: 'Log loss' }))),
          h('tbody', null,
            h('tr', null, h('td', null, h('b', { text: 'Logistic' })), h('td', { class: 'num', text: ov.logistic_brier.toFixed(3) }), h('td', { class: 'num', text: ov.five_fold_logistic_brier.toFixed(3) }), h('td', { class: 'num', text: ov.logistic_logloss.toFixed(3) })),
            h('tr', null, h('td', null, h('b', { text: 'Extended logistic' })), h('td', { class: 'num', text: ov.extended_logistic_brier.toFixed(3) }), h('td', { class: 'num', text: ov.five_fold_extended_logistic_brier.toFixed(3) }), h('td', { class: 'num', text: ov.extended_logistic_logloss.toFixed(3) })),
            h('tr', null, h('td', null, h('b', { text: 'Old table' })), h('td', { class: 'num', text: ov.table_brier.toFixed(3) }), h('td', { class: 'num', text: ov.five_fold_table_brier.toFixed(3) }), h('td', { class: 'num', text: ov.table_logloss.toFixed(3) }))
          )
        ),
        h('p', { class: 'note', text: 'Lower Brier is better. The board carries the ' + (odds.features === 'extended' ? 'extended' : 'plain') + ' logistic (five-fold Brier ' + (odds.features === 'extended' ? ov.five_fold_extended_logistic_brier.toFixed(3) : ov.five_fold_logistic_brier.toFixed(3)) + ', old table ' + ov.five_fold_table_brier.toFixed(3) + ', global rate ' + ov.global_brier.toFixed(3) + ' fixed). No listing date takes the pool median age (' + Math.round(odds.median_age_days) + ' days), the same imputation as the fit.' })
      ),
      h('p', { class: 'sub', text: 'The model is rough — the median held-out miss is about a factor of ' + Math.exp(v.test_median_abs_log_error).toFixed(1) + 'x — so treat each implied value as an order of magnitude, not a price.' })
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
        valueTermsOf(row).map(function (t) {
          return h('div', null, h('span', { text: t[0] }), h('b', { class: 'num', text: t[1].toFixed(2) }));
        }),
        h('div', null, h('span', { text: 'ln(implied value)' }), h('b', { class: 'num', text: logVal.toFixed(2) })),
        h('div', null, h('span', { text: 'implied value' }), h('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        h('div', null, h('span', { text: 'launch odds, from peers' }), h('b', { class: 'num', text: Math.round(row.launch_odds * 100) + '%' })),
        h('div', null, h('span', { text: 'gross expected value' }), h('b', { class: 'num', text: fmtUsd(row.gross_expected_value_usd) })),
        h('div', null, h('span', { text: 'total farm costs' }), h('b', { class: 'num', text: '$' + row.total_cost_usd })),
        h('div', { class: 'net-ev' }, h('span', { text: 'net expected value, after all costs' }), h('b', { class: 'num', text: fmtUsd(row.expected_value_usd) }))
      ),
      h('p', { class: 'note', text: 'Model ' + fit.version + ': the same fit scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' Odds are logistic on all 758 protocols.' })
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
    shell.appendChild(topEvStrip());
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
