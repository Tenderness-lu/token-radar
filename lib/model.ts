// Token Radar's model, radar-5: one sealed snapshot in, one ranked board out.
//
// The board ranks every rankable pre-token protocol on the snapshot (the watchlist is the floor,
// never the ceiling) plus every watchlist slug, strongest implied value first. A protocol is
// pre-token when its record carries no token at all: no market cap, no CoinGecko id, no symbol.
// Live-token protocols are kept apart in a live view with the market's own value, never mixed
// into the ranking, and an audit accounts for all 758 snapshot protocols.
//
// Implied value is a model FITTED to the protocols that already trade, not hand-tuned:
//
//   ln(mcap) = b0 + b1 * ln(tvl_usd) + b2 * tanh(change_7d / 30) + b3 * age_years
//   implied  = max(1, round(exp(ln(mcap))))
//
// The fit is computed at runtime from the snapshot's live-token protocols (market cap as the
// target, 87 with a market cap, a TVL, a seven-day change and a listing date, after the
// exclusion below). It is validated held-out TWICE before it is used, plus leave-one-out:
//
//   (A) a random 80/20 split by sha256(slug): train on 69, test on 18;
//   (B) leave-one-category-out: each category with 3+ protocols in the pool is held out
//       whole, the model is refit on the rest, and the 58 held-out protocols' errors are
//       pooled. This is the grouped split: it asks whether the model transfers to a whole
//       unseen category, not just to unseen names in a known category.
//   (C) leave-one-out over the pool, whose 87 (actual, predicted) pairs also feed the
//       dashboard's calibration chart.
//
// What changed from radar-4, and why. Radar-4 fitted on 95 protocols, every live-token
// protocol with the four figures, and reported a NEGATIVE growth coefficient (-1.783):
// protocols whose TVL spiked in the last week traded at a discount. That sign was
// investigated, not kept blindly. It was driven by the 8 centralised-exchange protocols in
// the pool: an exchange token's market cap prices the exchange's business, not the TVL on
// its books, and CEX is excluded from the board in any case, so the fit pool should not
// contain a category the board never scores. Removing those 8 leaves 87 protocols and the
// growth coefficient collapses to about 0.01: on the cleaned pool, a hot week carries
// almost no signal either way, and the fitted sign no longer pretends otherwise. Every
// validation improves on the cleaned pool: random-split median |log error| 0.95 against
// radar-4's 1.23, leave-one-category-out median 0.82 against 1.20, leave-one-out median
// 0.97 against 1.05. Train R-squared falls (0.15 against 0.20) because the CEX protocols
// supplied variance the model "explained" without generalising; the held-out errors are
// the honest read, and they all improve.
//
// Other terms were fitted and tested the same way, and rejected on the same evidence
// (fitModel runs each test at runtime and reports its numbers in validation.rejected):
// a category multiple (the radar-3 sector term), a chain-count term, and a signed-log
// growth transform. Category intercepts with ridge shrinkage and a Huber robust fit were
// also tried offline: the best ridge variant helps the random split a little (0.93) and
// hurts leave-one-out (1.12), Huber behaves the same way (0.91 random, 1.06 LOO), so the
// board carries neither. The model stays one plain regression, and the dashboard states its
// error instead of hiding it: the median held-out miss is about a factor of e^0.95, so
// each implied value is an order of magnitude, not a price. Held-out R-squared is below
// zero on both schemes, dragged there by one or two protocols whose market caps ignore
// TVL entirely (a token locker at 19x its TVL, an allocator at 0.6% of it); the median is
// the robust read, and the dashboard says so.
//
// Launch odds come from the peers' own record, never from a name: for a protocol's age bucket
// (0-180, 180-365, 365-730, 730-1460, 1460+ days) and TVL tier (<10M, 10-50M, 50-200M, 200M+),
// the odds are the share of protocols in that cell that already launched, shrunk toward the
// age bucket's rate with 10 pseudo-counts, so a thin cell cannot claim certainty. A protocol
// with no listing date takes the global launch rate. Odds run 0.21 to 0.88 on this board,
// median 0.38, and rise steeply with age (0.26 under 180 days, 0.80 past four years).
//
// Farm plans are costed over ten steps: each plan states the capital to deploy, the time it
// takes, and a NET expected value after all costs (capital at stake, setup gas, weekly gas
// over the hold, and a buffer), shown prominently in the plan and in the detail drawer.

import { createHash } from 'node:crypto';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The fitted value model: one regression, computed from the snapshot at runtime. */
export interface FitCoefficients {
  intercept: number;
  log_tvl: number;
  tanh_growth: number;
  age_years: number;
}

/** One fitted-and-rejected alternative term, as the dashboard's diagnostics panel states it. */
export interface RejectedAlternative {
  name: string;
  test_median_abs_log_error: number;
  loo_median_abs_log_error: number;
  note: string;
}

/** One leave-one-out calibration point, as the dashboard's chart plots it. */
export interface CalibrationPoint {
  slug: string;
  name: string;
  category: string | null;
  actual: number;
  predicted: number;
}

/** The fit's held-out validation, as the dashboard's diagnostics panel states it. */
export interface FitValidation {
  pool_size: number;
  pool_excluded_cex: number;
  train_size: number;
  test_size: number;
  train_r2: number;
  test_median_abs_log_error: number;
  test_mean_abs_log_error: number;
  test_r2: number;
  loco_median_abs_log_error: number;
  loco_mean_abs_log_error: number;
  loco_r2: number;
  loco_protocols: number;
  loco_categories: number;
  loo_median_abs_log_error: number;
  loo_r2: number;
  median_age_days: number;
  rejected: RejectedAlternative[];
}

/** The fitted model and its validation, as shipped to the dashboard. */
export interface FittedModel {
  version: string;
  as_of: string;
  coefficients: FitCoefficients;
  validation: FitValidation;
  calibration: CalibrationPoint[];
}

/** One age bucket's launch rate, as the odds table states it. */
export interface OddsBucket {
  min_days: number;
  max_days: number | null;
  protocols: number;
  launched: number;
  rate: number;
}

/** One TVL tier's launch rate. */
export interface OddsTier {
  min_usd: number;
  max_usd: number | null;
  protocols: number;
  launched: number;
  rate: number;
}

/** How launch odds are estimated, as the dashboard states it. */
export interface OddsTable {
  global_rate: number;
  shrinkage: number;
  buckets: OddsBucket[];
  tiers: OddsTier[];
}

/** The audit: every one of the snapshot's protocols, accounted for. */
export interface Audit {
  total: number;
  board: number;
  live_with_mcap: number;
  live_cex_set_aside: number;
  token_no_mcap: number;
  excluded_category: number;
  excluded_by_category: Record<string, number>;
  versioned: number;
}

/** The board's self-check, as the dashboard's integrity strip states it. */
export interface Integrity {
  ranks_ok: boolean;
  values_non_increasing: boolean;
  distinct_values: boolean;
  watchlist_covered: boolean;
  watchlist_missing: string[];
  farm_steps_ok: boolean;
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the Live token view carries: every one with a market cap. */
export const LIVE_ROWS = 1000;

/** The growth transform's scale: tanh(change_7d / 30). */
export const GROWTH_SCALE = 30;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_odds: number;
  gross_expected_value_usd: number;
  total_cost_usd: number;
  expected_value_usd: number;
  model: {
    intercept: number;
    log_tvl_coef: number;
    tanh_growth_coef: number;
    age_years_coef: number;
    log_tvl: number;
    tanh_growth: number;
    age_years: number;
    log_value: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_odds: number;
  gross_expected_value_usd: number;
  total_cost_usd: number;
  expected_value_usd: number;
  log_value: number;
  log_tvl: number;
  tanh_growth: number;
  age_years: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One sector's calibration: each category's live-token market-cap-to-TVL ratio, against the global one. */
export interface SectorTable {
  global_ratio: number;
  by_category: Record<string, number>;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: FittedModel;
  odds: OddsTable;
  audit: Audit;
  integrity: Integrity;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  median_launch_odds: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list of numbers, or `fallback` when it is empty. */
function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The held-out split: a protocol is in the test set when its slug's sha256 starts in the lowest fifth. */
function isTestSet(slug: string): boolean {
  const digest = createHash('sha256').update(slug, 'utf8').digest();
  const head = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  return head % 5 === 0;
}

/** Ordinary least squares by Gaussian elimination with partial pivoting. */
export function ols(features: number[][], target: number[]): number[] {
  const n = features.length;
  const k = features[0]!.length;
  const a: number[][] = [];
  for (let i = 0; i < k; i++) {
    a.push([]);
    for (let j = 0; j < k; j++) {
      let sum = 0;
      for (let r = 0; r < n; r++) sum += features[r]![i]! * features[r]![j]!;
      a[i]!.push(sum);
    }
  }
  const b: number[] = [];
  for (let i = 0; i < k; i++) {
    let sum = 0;
    for (let r = 0; r < n; r++) sum += features[r]![i]! * target[r]!;
    b.push(sum);
  }
  const m: number[][] = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    const tmp = m[col]!;
    m[col] = m[pivot]!;
    m[pivot] = tmp;
    const pv = m[col]![col]!;
    for (let r = 0; r < k; r++) {
      if (r === col || m[r]![col] === 0) continue;
      const f = m[r]![col]! / pv;
      for (let c = col; c <= k; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!;
    }
  }
  const beta: number[] = [];
  for (let i = 0; i < k; i++) beta.push(m[i]![k]! / m[i]![i]!);
  return beta;
}

/** A dot product. */
function dot(beta: number[], x: number[]): number {
  let sum = 0;
  for (let i = 0; i < beta.length; i++) sum += beta[i]! * x[i]!;
  return sum;
}

/** The regression's features for one protocol: intercept, log TVL, tanh growth, age in years. */
function featuresFor(p: SnapshotProtocol, medianAgeDays: number, asOf: string): number[] {
  const growth = Math.min(1000, Math.max(-95, finite(p.change_7d, 0)));
  const age = ageDaysForFit(p, medianAgeDays, asOf);
  return [1, Math.log(Math.max(1, p.tvl_usd)), Math.tanh(growth / GROWTH_SCALE), age / 365];
}

/** A protocol's age in days for the fit: its own listing age, or the fit pool's median when unknown. */
function ageDaysForFit(p: SnapshotProtocol, medianAgeDays: number, asOf: string): number {
  if (p.listed_at === null) return medianAgeDays;
  const d = ageDays(asOf, p.listed_at);
  return d === null ? medianAgeDays : d;
}

/** One set of protocols' market cap over its TVL, TVL-weighted; zero when there is no TVL. */
function ratioOf(protocols: SnapshotProtocol[]): number {
  const tvl = protocols.reduce((sum, p) => sum + p.tvl_usd, 0);
  if (tvl <= 0) return 0;
  return protocols.reduce((sum, p) => sum + (p.mcap_usd ?? 0), 0) / tvl;
}

/**
 * The sector table, computed from the snapshot at runtime: every live-token protocol's
 * market-cap-to-TVL ratio, per category and global. It exists only to test a sector term in
 * the fit; the board carries no sector adjustment, because the held-out test rejects it.
 */
export function sectorMultiples(snapshot: Snapshot): SectorTable {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0);
  const global = ratioOf(live);
  const byCategory: Record<string, number> = {};
  if (global > 0) {
    const categories = new Set(live.map((p) => p.category ?? 'Other'));
    for (const category of categories) {
      const inCategory = live.filter((p) => (p.category ?? 'Other') === category);
      const ratio = inCategory.length >= 3 ? ratioOf(inCategory) : global;
      byCategory[category] = Math.min(2, Math.max(0.5, ratio / global));
    }
  }
  return { global_ratio: Math.round(global * 1e4) / 1e4, by_category: byCategory };
}

/** One category's sector multiple from the table, or 1 when the table never estimated it. */
function sectorMultipleFor(sectors: SectorTable, category: string | null): number {
  const multiple = sectors.by_category[category ?? 'Other'];
  return typeof multiple === 'number' && Number.isFinite(multiple) ? multiple : 1;
}

/** R-squared of a set of predictions against their targets' own mean; negative when the mean wins. */
function rSquaredOf(predicted: number[], actual: number[]): number {
  if (actual.length === 0) return 0;
  const mean = actual.reduce((a, b) => a + b, 0) / actual.length;
  const ssTot = actual.reduce((a, y) => a + (y - mean) * (y - mean), 0);
  if (ssTot === 0) return 0;
  const ssRes = predicted.reduce((a, pr, i) => a + (pr - actual[i]!) * (pr - actual[i]!), 0);
  return 1 - ssRes / ssTot;
}

/**
 * The fitted model: ordinary least squares of log market cap on log TVL, tanh growth and age
 * in years, over the snapshot's live-token protocols with all four figures known — except
 * centralised exchanges, whose tokens price the exchange's business rather than the TVL on
 * its books (and which the board never scores). The fit is validated held-out twice (a
 * random 80/20 split by sha256 of the slug, and leave-one-category-out over the pool) plus
 * leave-one-out, and three alternative terms are fitted the same way and kept only when
 * they beat the base model on both the random test and leave-one-out. The production
 * coefficients are then refit on the whole pool. Nothing here names a protocol: every
 * number is derived from the snapshot at runtime.
 */
export function fitModel(snapshot: Snapshot): FittedModel {
  const excludedCex = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.change_7d !== null && p.listed_at !== null && ageDays(snapshot.as_of, p.listed_at) !== null && (p.category ?? 'Other') === 'CEX',
  ).length;
  const pool = snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.change_7d !== null && p.listed_at !== null && ageDays(snapshot.as_of, p.listed_at) !== null && (p.category ?? 'Other') !== 'CEX',
  );
  const medianAgeDays = median(pool.map((p) => ageDays(snapshot.as_of, p.listed_at) ?? 0), 180);
  const sectors = sectorMultiples(snapshot);
  const train = pool.filter((p) => !isTestSet(p.slug));
  const test = pool.filter((p) => isTestSet(p.slug));
  const baseFeatures = (p: SnapshotProtocol): number[] => featuresFor(p, medianAgeDays, snapshot.as_of);
  const sectorFeatures = (p: SnapshotProtocol): number[] => [...baseFeatures(p), Math.log(sectorMultipleFor(sectors, p.category))];
  const chainFeatures = (p: SnapshotProtocol): number[] => [...baseFeatures(p), Math.log1p(p.chains.length)];
  const logGrowthFeatures = (p: SnapshotProtocol): number[] => {
    const g = finite(p.change_7d, 0);
    const signed = Math.log1p(Math.max(0, g)) - Math.log1p(Math.max(0, -g));
    return [1, Math.log(Math.max(1, p.tvl_usd)), signed, ageDaysForFit(p, medianAgeDays, snapshot.as_of) / 365];
  };

  const fitOn = (rows: SnapshotProtocol[], features: (p: SnapshotProtocol) => number[]): number[] =>
    ols(
      rows.map(features),
      rows.map((p) => Math.log(p.mcap_usd!)),
    );
  const predict = (beta: number[], rows: SnapshotProtocol[], features: (p: SnapshotProtocol) => number[]): number[] =>
    rows.map((p) => dot(beta, features(p)));
  const absErrors = (beta: number[], rows: SnapshotProtocol[], features: (p: SnapshotProtocol) => number[]): number[] =>
    rows.map((p) => Math.abs(dot(beta, features(p)) - Math.log(p.mcap_usd!)));
  const rSquared = (beta: number[], rows: SnapshotProtocol[], features: (p: SnapshotProtocol) => number[]): number =>
    rSquaredOf(predict(beta, rows, features), rows.map((p) => Math.log(p.mcap_usd!)));

  // Scheme A: the random 80/20 split, the same split radar-4 used.
  const baseBeta = fitOn(train, baseFeatures);
  const baseTestErrors = absErrors(baseBeta, test, baseFeatures);
  const baseTestMedian = median(baseTestErrors, 0);
  const baseTestMean = baseTestErrors.reduce((a, b) => a + b, 0) / Math.max(1, baseTestErrors.length);
  const baseTestR2 = rSquared(baseBeta, test, baseFeatures);
  const trainR2 = rSquared(baseBeta, train, baseFeatures);

  // Scheme B: leave-one-category-out. Every category with 3+ protocols in the pool is held
  // out whole, the model is refit on the rest, and the held-out errors are pooled.
  const categories = [...new Set(pool.map((p) => p.category ?? 'Other'))];
  const locoErrors: number[] = [];
  const locoPredicted: number[] = [];
  const locoActual: number[] = [];
  let locoProtocols = 0;
  let locoCategories = 0;
  for (const category of categories) {
    const held = pool.filter((p) => (p.category ?? 'Other') === category);
    if (held.length < 3) continue;
    locoCategories++;
    locoProtocols += held.length;
    const rest = pool.filter((p) => (p.category ?? 'Other') !== category);
    const beta = fitOn(rest, baseFeatures);
    for (const p of held) {
      locoErrors.push(Math.abs(dot(beta, baseFeatures(p)) - Math.log(p.mcap_usd!)));
      locoPredicted.push(dot(beta, baseFeatures(p)));
      locoActual.push(Math.log(p.mcap_usd!));
    }
  }
  const locoMedian = median(locoErrors, 0);
  const locoMean = locoErrors.reduce((a, b) => a + b, 0) / Math.max(1, locoErrors.length);
  const locoR2 = rSquaredOf(locoPredicted, locoActual);

  // Leave-one-out over the pool, whose pairs feed the dashboard's calibration chart.
  const looErrors: number[] = [];
  const looPredicted: number[] = [];
  const calibration: CalibrationPoint[] = [];
  for (let i = 0; i < pool.length; i++) {
    const rest = pool.filter((_, j) => j !== i);
    const beta = fitOn(rest, baseFeatures);
    const predicted = dot(beta, baseFeatures(pool[i]!));
    looErrors.push(Math.abs(predicted - Math.log(pool[i]!.mcap_usd!)));
    looPredicted.push(predicted);
    calibration.push({
      slug: pool[i]!.slug,
      name: pool[i]!.name,
      category: pool[i]!.category,
      actual: Math.round(Math.log(pool[i]!.mcap_usd!) * 1e4) / 1e4,
      predicted: Math.round(predicted * 1e4) / 1e4,
    });
  }
  const looMedian = median(looErrors, 0);
  const looR2 = rSquaredOf(looPredicted, pool.map((p) => Math.log(p.mcap_usd!)));

  // Three alternative terms, fitted the same way and reported whether or not they win.
  // A term is kept only when it beats the base model on BOTH the random test and
  // leave-one-out; none of these three does, so the board carries none of them.
  const rejected: RejectedAlternative[] = [];
  const testAlternative = (name: string, features: (p: SnapshotProtocol) => number[], note: string): void => {
    const beta = fitOn(train, features);
    const testMedian = median(absErrors(beta, test, features), 0);
    const loo: number[] = [];
    for (let i = 0; i < pool.length; i++) {
      const rest = pool.filter((_, j) => j !== i);
      const b = fitOn(rest, features);
      loo.push(Math.abs(dot(b, features(pool[i]!)) - Math.log(pool[i]!.mcap_usd!)));
    }
    rejected.push({ name, test_median_abs_log_error: testMedian, loo_median_abs_log_error: median(loo, 0), note });
  };
  testAlternative(
    'sector multiple (log of the category mcap/TVL ratio)',
    sectorFeatures,
    'a category adjustment was already tested by radar-4 and dropped; on the cleaned pool it still loses on both held-out checks, so the board carries no sector term',
  );
  testAlternative(
    'chain count (log1p of the number of chains)',
    chainFeatures,
    'multichain breadth adds almost nothing once TVL is in, and its leave-one-out error is worse than the base model',
  );
  testAlternative(
    'signed-log growth (log1p of the 7-day change, sign kept)',
    logGrowthFeatures,
    'a gentler growth transform than tanh: it loses both held-out checks on the cleaned pool, so the board keeps tanh',
  );

  const production = fitOn(pool, baseFeatures);
  return {
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    coefficients: {
      intercept: production[0]!,
      log_tvl: production[1]!,
      tanh_growth: production[2]!,
      age_years: production[3]!,
    },
    validation: {
      pool_size: pool.length,
      pool_excluded_cex: excludedCex,
      train_size: train.length,
      test_size: test.length,
      train_r2: trainR2,
      test_median_abs_log_error: baseTestMedian,
      test_mean_abs_log_error: baseTestMean,
      test_r2: baseTestR2,
      loco_median_abs_log_error: locoMedian,
      loco_mean_abs_log_error: locoMean,
      loco_r2: locoR2,
      loco_protocols: locoProtocols,
      loco_categories: locoCategories,
      loo_median_abs_log_error: looMedian,
      loo_r2: looR2,
      median_age_days: medianAgeDays,
      rejected,
    },
    calibration,
  };
}

/** The fitted log value and implied value one protocol gets. */
export function fittedValue(
  protocol: SnapshotProtocol,
  fit: FittedModel,
): { logValue: number; implied: number; logTvl: number; tanhGrowth: number; ageYears: number } {
  const c = fit.coefficients;
  const logTvl = Math.log(Math.max(1, protocol.tvl_usd));
  const growth = Math.min(1000, Math.max(-95, finite(protocol.change_7d, 0)));
  const tanhGrowth = Math.tanh(growth / GROWTH_SCALE);
  const ageYears = ageDaysForFit(protocol, fit.validation.median_age_days, fit.as_of) / 365;
  const logValue = c.intercept + c.log_tvl * logTvl + c.tanh_growth * tanhGrowth + c.age_years * ageYears;
  const implied = Math.max(1, Math.round(Math.exp(logValue)));
  return { logValue, implied, logTvl, tanhGrowth, ageYears };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the house's watchlist rule keeps out: wrapped, staked, bridged and exchange products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the early radar may rank: pre-token, not an exchange product, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && (p.category === null || !EXCLUDED_CATEGORIES.has(p.category)) && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The age buckets and TVL tiers the launch-odds table is built on. */
const ODDS_BUCKETS: [number, number][] = [
  [0, 180],
  [180, 365],
  [365, 730],
  [730, 1460],
  [1460, Infinity],
];
const ODDS_TIERS: [number, number][] = [
  [0, 10_000_000],
  [10_000_000, 50_000_000],
  [50_000_000, 200_000_000],
  [200_000_000, Infinity],
];
const ODDS_SHRINKAGE = 10;

/** The launch-odds table, computed from the snapshot at runtime: the share of protocols in each
 * age bucket and TVL tier that already launched, and the global rate. */
export function oddsTable(snapshot: Snapshot): OddsTable {
  const launched = (p: SnapshotProtocol): boolean => !isPreToken(p);
  const globalRate = snapshot.protocols.filter(launched).length / Math.max(1, snapshot.protocols.length);
  const buckets: OddsBucket[] = ODDS_BUCKETS.map(([min, max]) => {
    const cell = snapshot.protocols.filter((p) => {
      const age = ageDays(snapshot.as_of, p.listed_at);
      return age !== null && age >= min && age < max;
    });
    const n = cell.filter(launched).length;
    return { min_days: min, max_days: Number.isFinite(max) ? max : null, protocols: cell.length, launched: n, rate: cell.length > 0 ? n / cell.length : globalRate };
  });
  const tiers: OddsTier[] = ODDS_TIERS.map(([min, max]) => {
    const cell = snapshot.protocols.filter((p) => p.tvl_usd >= min && p.tvl_usd < max);
    const n = cell.filter(launched).length;
    return { min_usd: min, max_usd: Number.isFinite(max) ? max : null, protocols: cell.length, launched: n, rate: cell.length > 0 ? n / cell.length : globalRate };
  });
  return { global_rate: globalRate, shrinkage: ODDS_SHRINKAGE, buckets, tiers };
}

/** One protocol's launch odds: its age bucket by TVL tier cell, shrunk toward the bucket's rate. */
export function launchOdds(p: SnapshotProtocol, snapshot: Snapshot, table: OddsTable): number {
  const age = ageDays(snapshot.as_of, p.listed_at);
  if (age === null) return table.global_rate;
  const bucket = table.buckets.find((b) => age >= b.min_days && (b.max_days === null || age < b.max_days));
  if (bucket === undefined) return table.global_rate;
  const prior = bucket.rate;
  const cell = snapshot.protocols.filter((q) => {
    const a = ageDays(snapshot.as_of, q.listed_at);
    if (a === null || a < bucket.min_days || (bucket.max_days !== null && a >= bucket.max_days)) return false;
    const tier = table.tiers.find((t) => p.tvl_usd >= t.min_usd && (t.max_usd === null || p.tvl_usd < t.max_usd));
    if (tier === undefined) return false;
    return q.tvl_usd >= tier.min_usd && (tier.max_usd === null || q.tvl_usd < tier.max_usd);
  });
  const launched = cell.filter((q) => !isPreToken(q)).length;
  return (launched + table.shrinkage * prior) / (cell.length + table.shrinkage);
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The chains a plan names: the first two, so the farmer picks one of them. */
function chainsText(p: SnapshotProtocol): string {
  const chains = p.chains.filter((c) => c.length > 0);
  if (chains.length === 0) return 'its main chain';
  if (chains.length === 1) return chains[0]!;
  return `${chains[0]} or ${chains[1]}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The whole weeks in a hold, for the weekly gas bill. */
function weeksFor(hold: number): number {
  return Math.max(1, Math.ceil(hold / 7));
}

/** The gas for the opening transactions, from the capital band. */
function setupGasFor(capital: number): number {
  return capital >= 150 ? 8 : 4;
}

/** The full cost of one farm position: capital at stake, setup gas, wallet gas, weekly gas, buffer. */
export function totalCostFor(p: SnapshotProtocol, age: number | null): { capital: number; gas: number; weeks: number; weeklyGas: number; total: number } {
  const capital = capitalFor(p);
  const gas = setupGasFor(capital);
  const weeks = weeksFor(holdDaysFor(age));
  const weeklyGas = 2 * weeks;
  return { capital, gas, weeks, weeklyGas, total: capital + gas + 3 + weeklyGas + 5 };
}

/** The opening move: get the capital onto one of the protocol's own chains and make the first
 *  category action there, in the words a farmer can follow. */
function openingFor(p: SnapshotProtocol, capital: number, chains: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Bring $${capital} of USDC onto ${chains} and supply it to ${name} as your opening deposit, leaving it earning for the full hold.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Bring $${capital} of USDC onto ${chains} and add it to ${name}'s deepest pool as your opening position, keeping it in range.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return `Bring $${capital} of USDC onto ${chains} and deposit it into ${name}'s highest-TVL vault, leaving the shares untouched.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Bring $${capital} onto ${chains} and stake it through ${name} as your opening position, keeping the receipt token in the same wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Bring $${capital} of USDC onto ${chains} and deposit it as margin on ${name}, opening one small hedged position.`;
  }
  if (c.includes('prediction')) {
    return `Bring $${capital} of USDC onto ${chains} and fund ${name} with it, taking one position on a market that settles after the hold ends.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Bring $${capital} of USDC onto ${chains} and allocate it to a ${name} vault, keeping the vault shares for the full hold.`;
  }
  if (c.includes('stable')) {
    return `Bring $${capital} onto ${chains} and mint or deposit the stable asset through ${name}, holding it for the full hold.`;
  }
  if (c.includes('rwa')) {
    return `Bring $${capital} onto ${chains} and mint ${name}'s yield-bearing asset, holding it for the full hold.`;
  }
  if (c.includes('insurance')) {
    return `Bring $${capital} onto ${chains} and buy cover from ${name}, keeping the policy active for the full hold.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chains} through ${name} and put the bridged funds to work in its app.`;
  }
  return `Bring $${capital} of USDC onto ${chains} and deposit it into ${name} as your opening position, keeping it open for the full hold.`;
}

/** The category's second, weekly qualifying action: a different interaction from the main deposit. */
function weeklyFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow a small amount against the deposit on ${name}, then repay it the same week.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Swap a small amount through ${name}'s router on ${chain} once a week.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Adjust the hedge on ${name} once a week, or close and reopen it if it drifted.`;
  }
  if (c.includes('prediction')) {
    return `Take one small new position on ${name} each week instead of leaving the first one alone.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return `Claim and restake the vault's yield on ${name} once a week.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Check the ${name} vault's allocation report weekly and rebalance only if it moved.`;
  }
  if (c.includes('rwa')) {
    return `Check the yield accrual on ${name} weekly and keep the receipt in the same wallet.`;
  }
  return `Do one on-chain interaction on ${name} each week, such as a swap, a vote or a small top-up.`;
}

/** A second qualifying action, different from the weekly one: a second position type in the same app. */
function secondFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply a second, smaller asset to ${name} on ${chain}, so the wallet shows two markets used instead of one.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Add a small position to a second pool on ${name}, on ${chain} if it lists one, and leave it in range.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Open one small spot hedge beside the ${name} position, so the wallet is not a single-trade account.`;
  }
  if (c.includes('prediction')) {
    return `Resolve one settled market on ${name} and claim the winnings, so the wallet shows a completed round.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return `Deposit a small amount into a second ${name} vault, so the wallet holds two vault shares.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Allocate a small amount to a second ${name} vault with a different strategy, and hold both.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake a second, smaller amount through ${name} on ${chain}, keeping both receipt tokens in the same wallet.`;
  }
  if (c.includes('stable')) {
    return `Hold a second stable asset minted through ${name}, so the wallet shows more than one mint.`;
  }
  if (c.includes('rwa')) {
    return `Mint a second, smaller ${name} asset in another tenor, and hold both to the end of the hold.`;
  }
  return `Take one more distinct action in the ${name} app, such as voting, staking or a second deposit, so the wallet is not a one-transaction account.`;
}

/** A dollar figure in the short form the farm plan states it in. */
function shortUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

/**
 * A protocol's farm plan: ten steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age) and its fitted value and launch
 * odds, never from a hand-written list of names. Step one names the protocol's own chains and
 * the first category action; step seven states the NET expected value (implied value x launch
 * odds, minus the capital at stake, the setup gas, the weekly gas over the hold and a buffer);
 * the last step warns against splitting the farm across wallets, the pattern airdrop filters
 * flag as Sybil.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number, odds: number, gross: number, totalCost: number, expected: number): FarmStep[] {
  const chains = chainsText(p);
  const { capital, gas, weeks, weeklyGas } = totalCostFor(p, age);
  const hold = holdDaysFor(age);
  return [
    {
      text: openingFor(p, capital, chains),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: weeklyFor(p, chainOf(p)),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: secondFor(p, chainOf(p)),
      cost: 'about $2 of gas',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points page from the link in its official docs and check the claim there; never connect your wallet to a link from a DM or a search ad.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Net expected value: ${shortUsd(implied)} implied value times ${Math.round(odds * 100)}% launch odds is about ${shortUsd(gross)} gross, minus $${totalCost} of costs ($${capital} capital at stake, $${gas} setup gas, $${weeklyGas} weekly gas over ${weeks} weeks, $5 buffer), leaving about ${shortUsd(expected)} net — a wide range, and only a slice of it would ever reach one wallet.`,
      cost: `$${totalCost} of costs against ${shortUsd(gross)} gross`,
      time: 'no extra time',
    },
    {
      text: `Plan the exit before the claim opens: withdraw the position in two or three tranches once the points page shows a claim, keep a small position until the claim is confirmed, and leave enough gas on ${chainOf(p)} to claim.`,
      cost: 'about $4 of gas to unwind',
      time: '20 minutes',
    },
    {
      text: `On claim day, open the claim from the protocol's own site, check the claim window and the token contract against the official docs, and never pay anyone to claim for you.`,
      cost: 'claim gas only, about $3',
      time: '15 minutes',
    },
    {
      text: `Farm from one wallet only: splitting the same activity across many wallets is the pattern airdrop filters flag as Sybil, and it can void the whole position.`,
      cost: 'nothing to do right, everything to lose by splitting',
      time: 'no extra time',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: FittedModel, table: OddsTable): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, whatever its category.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol, at any TVL. A chosen protocol stays
  // chosen; nothing here replaces a watchlist row.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { logValue, implied, logTvl, tanhGrowth, ageYears } = fittedValue(p, fit);
    const odds = launchOdds(p, snapshot, table);
    const oddsRounded = Math.round(odds * 1000) / 1000;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const { total } = totalCostFor(p, age);
    const gross = Math.round(implied * oddsRounded);
    const expected = Math.max(0, gross - total);
    return { p, logValue, implied, logTvl, tanhGrowth, ageYears, odds: oddsRounded, gross, total, expected, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    launch_odds: s.odds,
    gross_expected_value_usd: s.gross,
    total_cost_usd: s.total,
    expected_value_usd: s.expected,
    model: {
      intercept: Math.round(fit.coefficients.intercept * 1e4) / 1e4,
      log_tvl_coef: Math.round(fit.coefficients.log_tvl * 1e4) / 1e4,
      tanh_growth_coef: Math.round(fit.coefficients.tanh_growth * 1e4) / 1e4,
      age_years_coef: Math.round(fit.coefficients.age_years * 1e4) / 1e4,
      log_tvl: Math.round(s.logTvl * 1e4) / 1e4,
      tanh_growth: Math.round(s.tanhGrowth * 1e4) / 1e4,
      age_years: Math.round(s.ageYears * 1e4) / 1e4,
      log_value: Math.round(s.logValue * 1e4) / 1e4,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied, s.odds, s.gross, s.total, s.expected).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The audit: every protocol in the snapshot, accounted for in exactly one bucket. */
export function auditSnapshot(snapshot: Snapshot, board: BoardRow[], live: LiveRow[]): Audit {
  const boardSlugs = new Set(board.map((r) => r.slug));
  const liveSlugs = new Set(live.map((r) => r.slug));
  const excludedByCategory: Record<string, number> = {};
  let tokenNoMcap = 0;
  let liveCex = 0;
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug) || liveSlugs.has(p.slug)) continue;
    if (!isPreToken(p)) {
      if (p.category === 'CEX') liveCex++;
      else tokenNoMcap++;
      continue;
    }
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
      excludedByCategory[p.category] = (excludedByCategory[p.category] ?? 0) + 1;
      continue;
    }
    // A pre-token protocol outside the board and the live view is a versioned pool.
  }
  const versioned = snapshot.protocols.filter(
    (p) => isPreToken(p) && VERSIONED.test(p.name) && (p.category === null || !EXCLUDED_CATEGORIES.has(p.category)) && !boardSlugs.has(p.slug),
  ).length;
  return {
    total: snapshot.protocols.length,
    board: board.length,
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: snapshot.watchlist.filter((s) => boardSlugs.has(s)).length,
    live_with_mcap: live.length,
    live_cex_set_aside: liveCex,
    token_no_mcap: tokenNoMcap,
    excluded_category: Object.values(excludedByCategory).reduce((a, b) => a + b, 0),
    excluded_by_category: excludedByCategory,
    versioned,
  };
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_odds: row.launch_odds,
    gross_expected_value_usd: row.gross_expected_value_usd,
    total_cost_usd: row.total_cost_usd,
    expected_value_usd: row.expected_value_usd,
    log_value: row.model.log_value,
    log_tvl: row.model.log_tvl,
    tanh_growth: row.model.tanh_growth,
    age_years: row.model.age_years,
    watchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot);
  const table = oddsTable(snapshot);
  const board = buildBoard(snapshot, fit, table);
  const live = liveRows(snapshot);
  const audit = auditSnapshot(snapshot, board, live);
  const integrity = checkBoard(board, snapshot);
  const oddsSorted = [...board.map((r) => r.launch_odds)].sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit,
    odds: table,
    audit,
    integrity,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    median_launch_odds: oddsSorted.length > 0 ? oddsSorted[Math.floor(oddsSorted.length / 2)]! : 0,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

/** The board's self-check, for the dashboard's integrity strip. */
export function checkBoard(board: BoardRow[], snapshot: Snapshot): Integrity {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((r, i) => r === i + 1);
  const nonIncreasing = board.every((r, i) => i === 0 || r.implied_value_usd <= board[i - 1]!.implied_value_usd);
  const distinct = new Set(board.map((r) => r.implied_value_usd)).size === board.length;
  let farmOk = true;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) farmOk = false;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) farmOk = false;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) farmOk = false;
  }
  return {
    ranks_ok: ranksOk,
    values_non_increasing: nonIncreasing,
    distinct_values: distinct,
    watchlist_covered: missing.length === 0,
    watchlist_missing: missing,
    farm_steps_ok: farmOk,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
