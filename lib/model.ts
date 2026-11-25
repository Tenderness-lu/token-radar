// Token Radar's model, radar-7: one sealed snapshot in, one ranked board out.
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
// What changed from radar-6, and why. Radar-6 tried fourteen alternatives on ONE hash
// split and kept none, but two were close calls that deserved a fairer test, so radar-7
// re-runs the search on FIVE hash splits (each hash quintile held out in turn) and keeps
// a candidate only when it wins the median |log error| on at least four of the five
// splits AND moves fewer than twenty of the 203 board rows by more than ten ranks.
// Candidates: ridge shrinkage at lambda 1, 3, 10 and 30; the interaction-plus-quadratic
// terms with ridge shrinkage; per-category TVL slopes; and a ratio regression on
// log(mcap/TVL). The search table is in the panel, kept or rejected, so a reader can
// see the model survived a stability test rather than a single split.
//
// What radar-7 DOES change is the dossier's evidence and the launch odds. The dossier
// text now opens with a worked valuation: one watchlist protocol priced term by term
// from its TVL to its implied value, then a top-ten table by expected value (implied
// value times launch odds). The board already carried each row's farm net expected
// value; the dashboard now labels that column "Farm net EV" and sorts on it. Launch
// odds try two more features — how many chains a protocol runs on, and a category-by-
// age interaction — and keep them only when the five-fold Brier score improves on the
// radar-6 logistic's 0.202.
//
// What radar-8 changes. First, the fit pool: the fit has always used only the dated
// live-token protocols (87). Thirty-two more live non-CEX protocols carry a market
// cap but no listing date, so their age is imputed at the pool median (990 days) and
// they are excluded from the fit. Radar-8 tests fitting on all 119 against the
// 87-only fit, on the same five-split protocol: the same held-out quintile (dated
// protocols only, so the test set is identical for both pools) plus the board rank
// moves. The wide pool is kept only when it wins at least four of five splits AND
// moves fewer than twenty board rows by more than ten ranks; otherwise the 87-pool
// fit stays and the comparison is reported honestly in the panel. Second, the
// dossier text was nearly full (64,195 of 65,536 bytes), so radar-8 trims the
// panel prose and the rejected-terms notes, then adds two short sections: the
// model's limits and how to use the radar. Third, the dashboard gains a top-ten
// strip by expected value and farm cost and reward columns on the board table.

// The fit reports its own held-out numbers, and the board uses the same fit for every
// row. Held-out R-squared is below zero on both schemes, dragged there by one or two
// protocols whose market caps ignore TVL entirely (a token locker at 19x its TVL, an
// allocator at 0.6% of it); the median is the robust read, and the dashboard says so.
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
  loco_median_abs_log_error: number;
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

/** One candidate in the five-split stability search, as the panel states it. */
export interface FiveSplitCandidate {
  name: string;
  split_medians: number[];
  base_medians: number[];
  wins: number;
  mean_median: number;
  rank_moves_over_10: number;
  kept: boolean;
}

/** The fit-pool comparison (radar-8): the dated-only pool against the wide pool that
 * also takes the live protocols with no listing date, age imputed at the median. */
export interface PoolComparison {
  pool_dated_size: number;
  pool_wide_size: number;
  pool_imputed_age: number;
  pool_dated_medians: number[];
  pool_wide_medians: number[];
  wins: number;
  rank_moves_over_10: number;
  kept_wide: boolean;
}

/** The fit's held-out validation, as the dashboard's diagnostics panel states it. */
export interface FitValidation {
  pool_size: number;
  pool_excluded_cex: number;
  /** Live protocols in the kept pool whose listing date is missing, age imputed. */
  pool_imputed_age: number;
  /** The radar-8 fit-pool comparison: dated-only vs wide pool, five splits. */
  pool_comparison: PoolComparison;
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
  /** The five-split stability search: every candidate, whether it was kept or not. */
  five_split: FiveSplitCandidate[];
  /** Which model's coefficients the board carries: 'base' or a candidate's name. */
  kept_model: string;
}

/** The fitted model and its validation, as shipped to the dashboard. */
export interface FittedModel {
  version: string;
  as_of: string;
  coefficients: FitCoefficients;
  validation: FitValidation;
  calibration: CalibrationPoint[];
  /** The kept model's feature shape: 'base', 'ridge-<lambda>', 'jq-ridge-<lambda>',
   *  'category-slopes' or 'ratio'. The dashboard recomputes rows from this plus `beta`. */
  features: string;
  /** The kept model's full coefficient vector, in its feature order. */
  beta: number[];
  /** The kept model's feature parameters: the centring mean and the slope categories. */
  feature_params: { mean_log_tvl: number; categories: string[]; reference_category: string };
}

/** The launch-odds model's held-out validation: Brier score and log loss on the fixed
 * 80/20 split and the five-fold mean, for the logistic model, the old age-by-TVL table,
 * and the global launch rate alone. Lower Brier is better. The extended logistic adds
 * chain count and a category-by-age interaction; it is kept only when its five-fold
 * Brier beats the plain logistic's. */
export interface OddsValidation {
  test_size: number;
  table_brier: number;
  logistic_brier: number;
  table_logloss: number;
  logistic_logloss: number;
  global_brier: number;
  five_fold_table_brier: number;
  five_fold_logistic_brier: number;
  extended_logistic_brier: number;
  extended_logistic_logloss: number;
  five_fold_extended_logistic_brier: number;
}

/** The logistic launch-odds model: one regression per protocol, fitted at runtime on all
 * 758 snapshot protocols. Coefficients run [intercept, age in years, ln(TVL),
 * tanh(7d growth / 30), then one per dummy category]; the reference category (the most
 * common one) carries no dummy. The extended shape appends log1p(chain count), then one
 * age-by-category interaction per dummy category. A protocol with no listing date takes
 * the pool's median age, the same imputation the fit uses. */
export interface LogisticOdds {
  reference_category: string;
  categories: string[];
  coefficients: number[];
  median_age_days: number;
  validation: OddsValidation;
  /** 'base' or 'extended': which feature shape the production coefficients use. */
  features: string;
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
export const MODEL_VERSION = 'radar-8';

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
  odds: LogisticOdds;
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

/** The held-out split: a protocol's hash quintile, 0 to 4, from its slug's sha256. */
function hashQuintile(slug: string): number {
  const digest = createHash('sha256').update(slug, 'utf8').digest();
  const head = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
  return head % 5;
}

/** The held-out split: a protocol is in the test set when its slug's sha256 starts in the lowest fifth. */
function isTestSet(slug: string): boolean {
  return hashQuintile(slug) === 0;
}

/** A square linear system by Gaussian elimination with partial pivoting. */
export function solveLinear(matrix: number[][], vector: number[]): number[] {
  const k = matrix.length;
  const m: number[][] = matrix.map((row, i) => [...row, vector[i]!]);
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

/**
 * Ordinary least squares, with an optional ridge penalty on every coefficient but the
 * intercept and optional per-row weights (weighted least squares). Plain OLS is the
 * ridge-0, weights-null case.
 */
export function ols(features: number[][], target: number[], ridge = 0, weights: number[] | null = null): number[] {
  const n = features.length;
  const k = features[0]!.length;
  const a: number[][] = [];
  for (let i = 0; i < k; i++) {
    a.push([]);
    for (let j = 0; j < k; j++) {
      let sum = 0;
      for (let r = 0; r < n; r++) {
        const w = weights === null ? 1 : weights[r]!;
        sum += w * features[r]![i]! * features[r]![j]!;
      }
      if (ridge !== 0 && i === j && i > 0) sum += ridge;
      a[i]!.push(sum);
    }
  }
  const b: number[] = [];
  for (let i = 0; i < k; i++) {
    let sum = 0;
    for (let r = 0; r < n; r++) {
      const w = weights === null ? 1 : weights[r]!;
      sum += w * features[r]![i]! * target[r]!;
    }
    b.push(sum);
  }
  return solveLinear(a, b);
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
 * leave-one-out, and fourteen alternatives are fitted the same way and kept only when
 * they beat the base model on BOTH the random test and leave-one-out: a sector multiple,
 * a chain-count term, a signed-log growth transform, a quadratic log-TVL term, a
 * log-TVL-by-age interaction, both together, a gentler growth transform (tanh/60 and raw
 * growth), log age, ridge shrinkage, a MAD-trimmed fit, a winsorised target, weighted
 * least squares and least-absolute-deviations. None of them wins both checks, so the
 * production coefficients are the plain four-term regression refit on the whole pool.
 * Nothing here names a protocol: every number is derived from the snapshot at runtime.
 */
export function fitModel(snapshot: Snapshot): FittedModel {
  const excludedCex = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.change_7d !== null && p.listed_at !== null && ageDays(snapshot.as_of, p.listed_at) !== null && (p.category ?? 'Other') === 'CEX',
  ).length;
  const poolDated = snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.change_7d !== null && p.listed_at !== null && ageDays(snapshot.as_of, p.listed_at) !== null && (p.category ?? 'Other') !== 'CEX',
  );
  const medianAgeDays = median(poolDated.map((p) => ageDays(snapshot.as_of, p.listed_at) ?? 0), 180);
  const sectors = sectorMultiples(snapshot);
  const baseFeatures = (p: SnapshotProtocol): number[] => featuresFor(p, medianAgeDays, snapshot.as_of);
  const fitOn = (rows: SnapshotProtocol[], features: (p: SnapshotProtocol) => number[]): number[] =>
    ols(
      rows.map(features),
      rows.map((p) => Math.log(p.mcap_usd!)),
    );
  // The radar-8 fit-pool test: the wide pool also takes the live non-CEX protocols
  // with no listing date (their age is imputed at the pool median by featuresFor).
  // Each split is scored on the dated pool's quintile, identical for both pools, so
  // the only difference is whether the imputed-age protocols were in the training
  // data. The wide pool is kept only on four of five split wins AND fewer than
  // twenty board rows moved by more than ten ranks.
  const poolWide = snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.change_7d !== null && (p.category ?? 'Other') !== 'CEX',
  );
  const poolDatedMedians: number[] = [];
  const poolWideMedians: number[] = [];
  for (let q = 0; q < 5; q++) {
    const held = poolDated.filter((p) => hashQuintile(p.slug) === q);
    const betaDated = fitOn(
      poolDated.filter((p) => hashQuintile(p.slug) !== q),
      baseFeatures,
    );
    const betaWide = fitOn(
      poolWide.filter((p) => hashQuintile(p.slug) !== q),
      baseFeatures,
    );
    poolDatedMedians.push(median(held.map((p) => Math.abs(dot(betaDated, baseFeatures(p)) - Math.log(p.mcap_usd!))), 0));
    poolWideMedians.push(median(held.map((p) => Math.abs(dot(betaWide, baseFeatures(p)) - Math.log(p.mcap_usd!))), 0));
  }
  const poolWins = poolWideMedians.filter((m, q) => m < poolDatedMedians[q]!).length;
  const poolRankSet = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) poolRankSet.set(slug, p);
  }
  for (const p of snapshot.protocols) if (!poolRankSet.has(p.slug) && isRankable(p)) poolRankSet.set(p.slug, p);
  const orderByBeta = (beta: number[]): Map<string, number> => {
    const slugs = [...poolRankSet.keys()].sort((a, b) => {
      const va = Math.max(1, Math.round(Math.exp(dot(beta, baseFeatures(poolRankSet.get(a)!)))));
      const vb = Math.max(1, Math.round(Math.exp(dot(beta, baseFeatures(poolRankSet.get(b)!)))));
      return vb - va || (a < b ? -1 : a > b ? 1 : 0);
    });
    return new Map(slugs.map((s, i) => [s, i + 1]));
  };
  const rankDated = orderByBeta(fitOn(poolDated, baseFeatures));
  const rankWide = orderByBeta(fitOn(poolWide, baseFeatures));
  let poolRankMoves = 0;
  for (const slug of poolRankSet.keys()) if (Math.abs(rankWide.get(slug)! - rankDated.get(slug)!) > 10) poolRankMoves++;
  const keepWidePool = poolWins >= 4 && poolRankMoves < 20;
  const pool = keepWidePool ? poolWide : poolDated;
  const poolComparison: PoolComparison = {
    pool_dated_size: poolDated.length,
    pool_wide_size: poolWide.length,
    pool_imputed_age: poolWide.length - poolDated.length,
    pool_dated_medians: poolDatedMedians.map((v) => Math.round(v * 1e4) / 1e4),
    pool_wide_medians: poolWideMedians.map((v) => Math.round(v * 1e4) / 1e4),
    wins: poolWins,
    rank_moves_over_10: poolRankMoves,
    kept_wide: keepWidePool,
  };
  const train = pool.filter((p) => !isTestSet(p.slug));
  const test = pool.filter((p) => isTestSet(p.slug));
  const sectorFeatures = (p: SnapshotProtocol): number[] => [...baseFeatures(p), Math.log(sectorMultipleFor(sectors, p.category))];
  const chainFeatures = (p: SnapshotProtocol): number[] => [...baseFeatures(p), Math.log1p(p.chains.length)];
  const logGrowthFeatures = (p: SnapshotProtocol): number[] => {
    const g = finite(p.change_7d, 0);
    const signed = Math.log1p(Math.max(0, g)) - Math.log1p(Math.max(0, -g));
    return [1, Math.log(Math.max(1, p.tvl_usd)), signed, ageDaysForFit(p, medianAgeDays, snapshot.as_of) / 365];
  };

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

  // The five-split stability search (radar-7): every candidate is scored on FIVE hash
  // splits — each hash quintile held out in turn — and kept only when it wins the
  // median |log error| on at least four of the five AND moves fewer than twenty of the
  // board's rows by more than ten ranks. A single split can flatter a fragile term;
  // five splits and a rank-movement cap cannot. The candidates:
  // ridge shrinkage at lambda 1, 3, 10 and 30 on the base four terms; the
  // interaction-plus-quadratic terms with ridge shrinkage; per-category TVL slopes;
  // and a ratio regression on log(mcap/TVL).
  interface ModelSpec {
    name: string;
    features: (p: SnapshotProtocol) => number[];
    fitWith: (rows: SnapshotProtocol[]) => number[];
    targetOf: (p: SnapshotProtocol) => number;
    predictOf: (beta: number[], p: SnapshotProtocol) => number;
  }
  const logMcap = (p: SnapshotProtocol): number => Math.log(p.mcap_usd!);
  const dotPredict = (features: (p: SnapshotProtocol) => number[]) => (beta: number[], p: SnapshotProtocol): number => dot(beta, features(p));
  const plainFit = (features: (p: SnapshotProtocol) => number[], ridge = 0) => (rows: SnapshotProtocol[]): number[] =>
    ols(
      rows.map(features),
      rows.map(logMcap),
      ridge,
    );
  const baseSpec: ModelSpec = {
    name: 'base',
    features: baseFeatures,
    fitWith: plainFit(baseFeatures),
    targetOf: logMcap,
    predictOf: dotPredict(baseFeatures),
  };
  const meanLnTvl = pool.reduce((s, p) => s + Math.log(Math.max(1, p.tvl_usd)), 0) / Math.max(1, pool.length);
  const quadFeatures = (p: SnapshotProtocol): number[] => {
    const d = Math.log(Math.max(1, p.tvl_usd)) - meanLnTvl;
    return [...baseFeatures(p), d * d];
  };
  const interFeatures = (p: SnapshotProtocol): number[] => {
    const d = Math.log(Math.max(1, p.tvl_usd)) - meanLnTvl;
    return [...baseFeatures(p), d * ageDaysForFit(p, medianAgeDays, snapshot.as_of) / 365];
  };
  const jqFeatures = (p: SnapshotProtocol): number[] => {
    const d = Math.log(Math.max(1, p.tvl_usd)) - meanLnTvl;
    const a = ageDaysForFit(p, medianAgeDays, snapshot.as_of) / 365;
    return [...baseFeatures(p), d * a, d * d];
  };
  // Per-category TVL slopes: the reference category keeps the plain slope, every other
  // category with 5+ protocols in the pool gets its own slope shift.
  const poolCategoryCounts = new Map<string, number>();
  for (const p of pool) poolCategoryCounts.set(p.category ?? 'Other', (poolCategoryCounts.get(p.category ?? 'Other') ?? 0) + 1);
  const slopeCategories = [...poolCategoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, n]) => n >= 5)
    .map(([c]) => c);
  const slopeReference = slopeCategories[0] ?? 'Other';
  const slopeFeatures = (p: SnapshotProtocol): number[] => {
    const base = baseFeatures(p);
    const dummies = slopeCategories.slice(1).map((c) => ((p.category ?? 'Other') === c ? Math.log(Math.max(1, p.tvl_usd)) : 0));
    return [...base, ...dummies];
  };
  const ratioFeatures = (p: SnapshotProtocol): number[] => {
    const base = baseFeatures(p);
    return [base[0]!, base[2]!, base[3]!];
  };
  const ratioTarget = (p: SnapshotProtocol): number => Math.log(p.mcap_usd! / Math.max(1, p.tvl_usd));
  const ratioPredict = (beta: number[], p: SnapshotProtocol): number => Math.log(Math.max(1, p.tvl_usd)) + dot(beta, ratioFeatures(p));
  const candidateSpecs: ModelSpec[] = [
    { name: 'ridge lambda 1', features: baseFeatures, fitWith: plainFit(baseFeatures, 1), targetOf: logMcap, predictOf: dotPredict(baseFeatures) },
    { name: 'ridge lambda 3', features: baseFeatures, fitWith: plainFit(baseFeatures, 3), targetOf: logMcap, predictOf: dotPredict(baseFeatures) },
    { name: 'ridge lambda 10', features: baseFeatures, fitWith: plainFit(baseFeatures, 10), targetOf: logMcap, predictOf: dotPredict(baseFeatures) },
    { name: 'ridge lambda 30', features: baseFeatures, fitWith: plainFit(baseFeatures, 30), targetOf: logMcap, predictOf: dotPredict(baseFeatures) },
    { name: 'interaction plus quadratic, ridge 3', features: jqFeatures, fitWith: plainFit(jqFeatures, 3), targetOf: logMcap, predictOf: dotPredict(jqFeatures) },
    { name: 'per-category TVL slopes', features: slopeFeatures, fitWith: plainFit(slopeFeatures), targetOf: logMcap, predictOf: dotPredict(slopeFeatures) },
    { name: 'ratio regression on log(mcap/TVL)', features: ratioFeatures, fitWith: (rows) => ols(rows.map(ratioFeatures), rows.map(ratioTarget)), targetOf: ratioTarget, predictOf: ratioPredict },
  ];
  /** One candidate's median |log error| on each of the five hash splits. */
  const splitMedians = (spec: ModelSpec): number[] => {
    const medians: number[] = [];
    for (let q = 0; q < 5; q++) {
      const held = pool.filter((p) => hashQuintile(p.slug) === q);
      const rest = pool.filter((p) => hashQuintile(p.slug) !== q);
      const beta = spec.fitWith(rest);
      medians.push(median(held.map((p) => Math.abs(spec.predictOf(beta, p) - Math.log(p.mcap_usd!))), 0));
    }
    return medians;
  };
  /** How many of the board's rows a candidate moves by more than ten ranks, against the base model. */
  const rankMoves = (spec: ModelSpec): number => {
    const rankSet = new Map<string, SnapshotProtocol>();
    for (const slug of snapshot.watchlist) {
      const p = snapshot.protocols.find((q) => q.slug === slug);
      if (p !== undefined) rankSet.set(slug, p);
    }
    for (const p of snapshot.protocols) if (!rankSet.has(p.slug) && isRankable(p)) rankSet.set(p.slug, p);
    const betaBase = baseSpec.fitWith(pool);
    const betaCand = spec.fitWith(pool);
    const orderOf = (beta: number[], predict: (b: number[], p: SnapshotProtocol) => number): Map<string, number> => {
      const slugs = [...rankSet.keys()].sort((a, b) => {
        const va = Math.max(1, Math.round(Math.exp(predict(beta, rankSet.get(a)!))));
        const vb = Math.max(1, Math.round(Math.exp(predict(beta, rankSet.get(b)!))));
        return vb - va || (a < b ? -1 : a > b ? 1 : 0);
      });
      return new Map(slugs.map((s, i) => [s, i + 1]));
    };
    const rBase = orderOf(betaBase, baseSpec.predictOf);
    const rCand = orderOf(betaCand, spec.predictOf);
    let moves = 0;
    for (const slug of rankSet.keys()) if (Math.abs(rCand.get(slug)! - rBase.get(slug)!) > 10) moves++;
    return moves;
  };
  const baseMedians = splitMedians(baseSpec);
  const fiveSplit: FiveSplitCandidate[] = [];
  for (const spec of candidateSpecs) {
    const medians = splitMedians(spec);
    const wins = medians.filter((m, q) => m < baseMedians[q]!).length;
    const mean = medians.reduce((a, b) => a + b, 0) / 5;
    fiveSplit.push({
      name: spec.name,
      split_medians: medians.map((v) => Math.round(v * 1e4) / 1e4),
      base_medians: baseMedians.map((v) => Math.round(v * 1e4) / 1e4),
      wins,
      mean_median: Math.round(mean * 1e4) / 1e4,
      rank_moves_over_10: rankMoves(spec),
      kept: false,
    });
  }
  // Keep the best candidate that clears both bars; otherwise the base model stays.
  let keptSpec = baseSpec;
  let bestMean = Infinity;
  for (let i = 0; i < fiveSplit.length; i++) {
    const row = fiveSplit[i]!;
    if (row.wins >= 4 && row.rank_moves_over_10 < 20 && row.mean_median < bestMean) {
      bestMean = row.mean_median;
      keptSpec = candidateSpecs[i]!;
    }
  }
  for (const row of fiveSplit) row.kept = keptSpec.name === row.name;
  const keptModelName = keptSpec === baseSpec ? 'base' : keptSpec.name;

  /**
   * The full validation of one feature shape, for the kept model: the fixed 80/20 split,
   * leave-one-category-out and leave-one-out, with the calibration pairs. Only run when
   * the kept model is not the base one; the base numbers above are reused otherwise.
   */
  const validateSpec = (spec: ModelSpec): { train_r2: number; test_median: number; test_mean: number; test_r2: number; loco_median: number; loco_mean: number; loco_r2: number; loo_median: number; loo_r2: number; calibration: CalibrationPoint[] } => {
    const betaTrain = spec.fitWith(train);
    const testErrs = test.map((p) => Math.abs(spec.predictOf(betaTrain, p) - Math.log(p.mcap_usd!)));
    const locoErrs: number[] = [];
    const locoPred: number[] = [];
    const locoAct: number[] = [];
    for (const category of categories) {
      const held = pool.filter((p) => (p.category ?? 'Other') === category);
      if (held.length < 3) continue;
      const rest = pool.filter((p) => (p.category ?? 'Other') !== category);
      const b = spec.fitWith(rest);
      for (const p of held) {
        locoErrs.push(Math.abs(spec.predictOf(b, p) - Math.log(p.mcap_usd!)));
        locoPred.push(spec.predictOf(b, p));
        locoAct.push(Math.log(p.mcap_usd!));
      }
    }
    const looErrs: number[] = [];
    const looPred: number[] = [];
    const calib: CalibrationPoint[] = [];
    for (let i = 0; i < pool.length; i++) {
      const rest = pool.filter((_, j) => j !== i);
      const b = spec.fitWith(rest);
      const pred = spec.predictOf(b, pool[i]!);
      looErrs.push(Math.abs(pred - Math.log(pool[i]!.mcap_usd!)));
      looPred.push(pred);
      calib.push({
        slug: pool[i]!.slug,
        name: pool[i]!.name,
        category: pool[i]!.category,
        actual: Math.round(Math.log(pool[i]!.mcap_usd!) * 1e4) / 1e4,
        predicted: Math.round(pred * 1e4) / 1e4,
      });
    }
    return {
      train_r2: rSquaredOf(train.map((p) => spec.predictOf(betaTrain, p)), train.map((p) => Math.log(p.mcap_usd!))),
      test_median: median(testErrs, 0),
      test_mean: testErrs.reduce((a, b) => a + b, 0) / Math.max(1, testErrs.length),
      test_r2: rSquaredOf(test.map((p) => spec.predictOf(betaTrain, p)), test.map((p) => Math.log(p.mcap_usd!))),
      loco_median: median(locoErrs, 0),
      loco_mean: locoErrs.reduce((a, b) => a + b, 0) / Math.max(1, locoErrs.length),
      loco_r2: rSquaredOf(locoPred, locoAct),
      loo_median: median(looErrs, 0),
      loo_r2: rSquaredOf(looPred, pool.map((p) => Math.log(p.mcap_usd!))),
      calibration: calib,
    };
  };
  const keptValidation =
    keptSpec === baseSpec
      ? null
      : validateSpec(keptSpec);
  const productionBeta = keptSpec.fitWith(pool);
  const keptCalibration = keptValidation === null ? calibration : keptValidation.calibration;

  // The radar-6 alternatives, fitted the same way and reported whether or not they win.
  // A term is kept only when it beats the base model on BOTH the random test and
  // leave-one-out; none of these does, so the radar-6 list stands as a record of what
  // was tried. Radar-7's own search is the five-split table above, which re-tests the
  // close calls (ridge, interaction plus quadratic) on five splits with a rank-movement
  // cap before any of them may replace the base model.
  // The feature variants change what the regression sees; the fit variants change how it
  // is fitted. Each one is scored on the random test, leave-one-category-out and
  // leave-one-out, all at runtime.
  const tanh60Features = (p: SnapshotProtocol): number[] => {
    const g = finite(p.change_7d, 0);
    return [1, Math.log(Math.max(1, p.tvl_usd)), Math.tanh(Math.min(1000, Math.max(-95, g)) / 60), ageDaysForFit(p, medianAgeDays, snapshot.as_of) / 365];
  };
  const rawGrowthFeatures = (p: SnapshotProtocol): number[] => {
    const g = finite(p.change_7d, 0);
    return [1, Math.log(Math.max(1, p.tvl_usd)), Math.min(1000, Math.max(-95, g)) / 100, ageDaysForFit(p, medianAgeDays, snapshot.as_of) / 365];
  };
  const logAgeFeatures = (p: SnapshotProtocol): number[] => {
    const base = baseFeatures(p);
    return [base[0]!, base[1]!, base[2]!, Math.log1p(ageDaysForFit(p, medianAgeDays, snapshot.as_of) / 365)];
  };
  const madOf = (values: number[]): number => {
    const med = median(values, 0);
    return median(values.map((v) => Math.abs(v - med)), 0) || 1e-9;
  };
  const fitRidge = (rows: SnapshotProtocol[]): number[] =>
    ols(
      rows.map(baseFeatures),
      rows.map((p) => Math.log(p.mcap_usd!)),
      3,
    );
  const fitTrimmed = (rows: SnapshotProtocol[]): number[] => {
    const first = ols(
      rows.map(baseFeatures),
      rows.map((p) => Math.log(p.mcap_usd!)),
    );
    const resid = rows.map((p) => Math.log(p.mcap_usd!) - dot(first, baseFeatures(p)));
    const thr = 2.5 * 1.4826 * madOf(resid);
    const kept = rows.filter((_, i) => Math.abs(resid[i]!) <= thr);
    return ols(
      kept.map(baseFeatures),
      kept.map((p) => Math.log(p.mcap_usd!)),
    );
  };
  const fitWls = (rows: SnapshotProtocol[]): number[] => {
    const weights = rows.map((p) => Math.sqrt(p.tvl_usd));
    const mean = weights.reduce((a, b) => a + b, 0) / Math.max(1, weights.length);
    return ols(
      rows.map(baseFeatures),
      rows.map((p) => Math.log(p.mcap_usd!)),
      0,
      weights.map((w) => w / mean),
    );
  };
  const fitLad = (rows: SnapshotProtocol[]): number[] => {
    let beta = ols(
      rows.map(baseFeatures),
      rows.map((p) => Math.log(p.mcap_usd!)),
    );
    for (let iter = 0; iter < 60; iter++) {
      const weights = rows.map((p) => 1 / Math.max(0.05, Math.abs(Math.log(p.mcap_usd!) - dot(beta, baseFeatures(p)))));
      beta = ols(
        rows.map(baseFeatures),
        rows.map((p) => Math.log(p.mcap_usd!)),
        0,
        weights,
      );
    }
    return beta;
  };
  const fitWinsorized = (rows: SnapshotProtocol[]): number[] => {
    const first = ols(
      rows.map(baseFeatures),
      rows.map((p) => Math.log(p.mcap_usd!)),
    );
    const resid = rows.map((p) => Math.log(p.mcap_usd!) - dot(first, baseFeatures(p)));
    const thr = 2.5 * 1.4826 * madOf(resid);
    const target = rows.map((p, i) => dot(first, baseFeatures(p)) + Math.min(thr, Math.max(-thr, resid[i]!)));
    return ols(rows.map(baseFeatures), target);
  };

  const rejected: RejectedAlternative[] = [];
  const testAlternative = (
    name: string,
    features: (p: SnapshotProtocol) => number[],
    note: string,
    fitWith: (rows: SnapshotProtocol[]) => number[] = (rows) => fitOn(rows, features),
  ): void => {
    const beta = fitWith(train);
    const testMedian = median(absErrors(beta, test, features), 0);
    const loo: number[] = [];
    for (let i = 0; i < pool.length; i++) {
      const rest = pool.filter((_, j) => j !== i);
      const b = fitWith(rest);
      loo.push(Math.abs(dot(b, features(pool[i]!)) - Math.log(pool[i]!.mcap_usd!)));
    }
    const locoErr: number[] = [];
    for (const category of categories) {
      const held = pool.filter((p) => (p.category ?? 'Other') === category);
      if (held.length < 3) continue;
      const rest = pool.filter((p) => (p.category ?? 'Other') !== category);
      const b = fitWith(rest);
      for (const p of held) locoErr.push(Math.abs(dot(b, features(p)) - Math.log(p.mcap_usd!)));
    }
    rejected.push({
      name,
      test_median_abs_log_error: testMedian,
      loo_median_abs_log_error: median(loo, 0),
      loco_median_abs_log_error: median(locoErr, 0),
      note,
    });
  };
  testAlternative(
    'sector multiple (log of the category mcap/TVL ratio)',
    sectorFeatures,
    'tested by radar-4 and dropped; still loses both held-out checks',
  );
  testAlternative(
    'chain count (log1p of the number of chains)',
    chainFeatures,
    'adds almost nothing once TVL is in; leave-one-out is worse',
  );
  testAlternative(
    'signed-log growth (log1p of the 7-day change, sign kept)',
    logGrowthFeatures,
    'loses both held-out checks; the board keeps tanh',
  );
  testAlternative(
    'quadratic log TVL ((ln TVL - mean)^2)',
    quadFeatures,
    'curvature near zero (about -0.02); loses leave-one-out',
  );
  testAlternative(
    'log TVL by age interaction ((ln TVL - mean) x age in years)',
    interFeatures,
    'wins leave-one-category-out and leave-one-out, loses the fixed 80/20 test',
  );
  testAlternative(
    'interaction plus quadratic',
    jqFeatures,
    'closest call of radar-6: wins all three fixed medians by a hair, loses two of five splits, moves 88 rows, growth coefficient 0.008 to 0.142',
  );
  testAlternative(
    'tanh(7d growth / 60)',
    tanh60Features,
    'wins the random test by a hair, loses leave-one-out; growth is noise either way',
  );
  testAlternative(
    'raw growth (7-day change / 100)',
    rawGrowthFeatures,
    'same story as tanh/60',
  );
  testAlternative(
    'log age (log1p of age in years)',
    logAgeFeatures,
    'loses on every check; age stays linear in years',
  );
  testAlternative(
    'ridge shrinkage (lambda 3)',
    baseFeatures,
    keptModelName === 'ridge lambda 3'
      ? 'helps leave-one-out a touch; on five splits it clears both bars, so radar-7 keeps the ridge-3 fit'
      : 'helps leave-one-out a touch, hurts the random test; five splits re-test it at lambda 1, 3, 10 and 30',
    fitRidge,
  );
  // The five protocols the MAD trim drops, named so the panel can say what it tried.
  const trimBetaFull = fitOn(pool, baseFeatures);
  const trimResidFull = pool.map((p) => Math.log(p.mcap_usd!) - dot(trimBetaFull, baseFeatures(p)));
  const trimThrFull = 2.5 * 1.4826 * madOf(trimResidFull);
  const trimmedNames = pool
    .filter((_, i) => Math.abs(trimResidFull[i]!) > trimThrFull)
    .map((p) => {
      const ratio = p.mcap_usd! / p.tvl_usd;
      return `${p.slug} at ${ratio >= 1 ? ratio.toFixed(0) : ratio.toFixed(3)}x its TVL`;
    })
    .join(', ');
  testAlternative(
    'MAD-trimmed fit (drop |residual| over 2.5 MAD)',
    baseFeatures,
    `dropping ${trimmedNames} makes every held-out check worse; the outliers stay in and are named here`,
    fitTrimmed,
  );
  testAlternative(
    'winsorised target (clip residuals to 2.5 MAD)',
    baseFeatures,
    'helps nothing held-out; the board fits the caps as they are',
    fitWinsorized,
  );
  testAlternative(
    'weighted least squares (weight sqrt(TVL))',
    baseFeatures,
    'loses on every check; every protocol counts once',
    fitWls,
  );
  testAlternative(
    'least absolute deviations (median regression)',
    baseFeatures,
    'loses on every check, including the median error it targets',
    fitLad,
  );

  // The production coefficients: the kept model's refit on the whole pool. The
  // four-field coefficients stay the model's base terms (for the ratio model the log-TVL
  // coefficient is 1 by construction); the full beta and the feature shape travel beside
  // them so the dashboard recomputes rows exactly.
  const featureName =
    keptSpec === baseSpec
      ? 'base'
      : keptSpec.name === 'ridge lambda 1'
        ? 'ridge-1'
        : keptSpec.name === 'ridge lambda 3'
          ? 'ridge-3'
          : keptSpec.name === 'ridge lambda 10'
            ? 'ridge-10'
            : keptSpec.name === 'ridge lambda 30'
              ? 'ridge-30'
              : keptSpec.name === 'interaction plus quadratic, ridge 3'
                ? 'jq-ridge-3'
                : keptSpec.name === 'per-category TVL slopes'
                  ? 'category-slopes'
                  : 'ratio';
  const coefficients: FitCoefficients =
    featureName === 'ratio'
      ? {
          intercept: productionBeta[0]!,
          log_tvl: 1,
          tanh_growth: productionBeta[1]!,
          age_years: productionBeta[2]!,
        }
      : {
          intercept: productionBeta[0]!,
          log_tvl: productionBeta[1]!,
          tanh_growth: productionBeta[2]!,
          age_years: productionBeta[3]!,
        };
  const val =
    keptValidation === null
      ? {
          train_r2: trainR2,
          test_median_abs_log_error: baseTestMedian,
          test_mean_abs_log_error: baseTestMean,
          test_r2: baseTestR2,
          loco_median_abs_log_error: locoMedian,
          loco_mean_abs_log_error: locoMean,
          loco_r2: locoR2,
          loo_median_abs_log_error: looMedian,
          loo_r2: looR2,
        }
      : {
          train_r2: keptValidation.train_r2,
          test_median_abs_log_error: keptValidation.test_median,
          test_mean_abs_log_error: keptValidation.test_mean,
          test_r2: keptValidation.test_r2,
          loco_median_abs_log_error: keptValidation.loco_median,
          loco_mean_abs_log_error: keptValidation.loco_mean,
          loco_r2: keptValidation.loco_r2,
          loo_median_abs_log_error: keptValidation.loo_median,
          loo_r2: keptValidation.loo_r2,
        };
  return {
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    coefficients,
    validation: {
      pool_size: pool.length,
      pool_excluded_cex: excludedCex,
      pool_imputed_age: keepWidePool ? poolWide.length - poolDated.length : 0,
      pool_comparison: poolComparison,
      train_size: train.length,
      test_size: test.length,
      train_r2: val.train_r2,
      test_median_abs_log_error: val.test_median_abs_log_error,
      test_mean_abs_log_error: val.test_mean_abs_log_error,
      test_r2: val.test_r2,
      loco_median_abs_log_error: val.loco_median_abs_log_error,
      loco_mean_abs_log_error: val.loco_mean_abs_log_error,
      loco_r2: val.loco_r2,
      loco_protocols: locoProtocols,
      loco_categories: locoCategories,
      loo_median_abs_log_error: val.loo_median_abs_log_error,
      loo_r2: val.loo_r2,
      median_age_days: medianAgeDays,
      rejected,
      five_split: fiveSplit,
      kept_model: keptModelName,
    },
    calibration: keptCalibration,
    features: featureName,
    beta: productionBeta,
    feature_params: { mean_log_tvl: meanLnTvl, categories: slopeCategories.slice(1), reference_category: slopeReference },
  };
}

/** Predicted log market cap for one protocol under the kept model's feature shape.
 * The dashboard's page recomputes rows from the same rule, with the same beta and
 * parameters, so the two can never drift apart. */
export function predictLogValue(protocol: SnapshotProtocol, fit: FittedModel): number {
  const beta = fit.beta;
  const params = fit.feature_params;
  const logTvl = Math.log(Math.max(1, protocol.tvl_usd));
  const growth = Math.min(1000, Math.max(-95, finite(protocol.change_7d, 0)));
  const tanhGrowth = Math.tanh(growth / GROWTH_SCALE);
  const ageYears = ageDaysForFit(protocol, fit.validation.median_age_days, fit.as_of) / 365;
  switch (fit.features) {
    case 'ratio':
      return logTvl + beta[0]! + beta[1]! * tanhGrowth + beta[2]! * ageYears;
    case 'jq-ridge-3': {
      const d = logTvl - params.mean_log_tvl;
      return beta[0]! + beta[1]! * logTvl + beta[2]! * tanhGrowth + beta[3]! * ageYears + beta[4]! * d * ageYears + beta[5]! * d * d;
    }
    case 'category-slopes': {
      const cat = protocol.category ?? 'Other';
      const idx = params.categories.indexOf(cat);
      const slope = beta[1]! + (idx >= 0 ? beta[4 + idx]! : 0);
      return beta[0]! + slope * logTvl + beta[2]! * tanhGrowth + beta[3]! * ageYears;
    }
    default:
      return beta[0]! + beta[1]! * logTvl + beta[2]! * tanhGrowth + beta[3]! * ageYears;
  }
}

/** The fitted log value and implied value one protocol gets. */
export function fittedValue(
  protocol: SnapshotProtocol,
  fit: FittedModel,
): { logValue: number; implied: number; logTvl: number; tanhGrowth: number; ageYears: number } {
  const logTvl = Math.log(Math.max(1, protocol.tvl_usd));
  const growth = Math.min(1000, Math.max(-95, finite(protocol.change_7d, 0)));
  const tanhGrowth = Math.tanh(growth / GROWTH_SCALE);
  const ageYears = ageDaysForFit(protocol, fit.validation.median_age_days, fit.as_of) / 365;
  const logValue = predictLogValue(protocol, fit);
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

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-Math.min(30, Math.max(-30, x))));
}

/**
 * One protocol's launch-odds features: an intercept, age in years, log TVL, tanh
 * 7-day growth, and one dummy per category but the reference (the most common
 * category, which carries no dummy). A protocol with no listing date takes the pool's
 * median age, the same imputation the fit uses.
 */
function oddsFeatures(p: SnapshotProtocol, snapshot: Snapshot, medianAgeDays: number, categories: string[]): number[] {
  const growth = Math.min(1000, Math.max(-95, finite(p.change_7d, 0)));
  const dummies = categories.slice(1).map((c) => ((p.category ?? 'Other') === c ? 1 : 0));
  return [1, ageDaysForFit(p, medianAgeDays, snapshot.as_of) / 365, Math.log(Math.max(1, p.tvl_usd)), Math.tanh(growth / GROWTH_SCALE), ...dummies];
}

/**
 * The extended launch-odds features (radar-7): the base terms, plus how many chains
 * a protocol runs on, plus one age-by-category interaction per dummy category, so a
 * category's launch rate may rise with age at its own pace. Kept only when the
 * five-fold Brier score improves on the plain logistic's.
 */
function oddsFeaturesExtended(p: SnapshotProtocol, snapshot: Snapshot, medianAgeDays: number, categories: string[]): number[] {
  const base = oddsFeatures(p, snapshot, medianAgeDays, categories);
  const ageYears = ageDaysForFit(p, medianAgeDays, snapshot.as_of) / 365;
  const interactions = categories.slice(1).map((c) => ((p.category ?? 'Other') === c ? ageYears : 0));
  return [...base, Math.log1p(p.chains.length), ...interactions];
}

/**
 * A logistic regression by iteratively reweighted least squares: 60 rounds, a ridge
 * penalty of 1 on every coefficient but the intercept, weights clamped so a near-certain
 * protocol cannot blow up the working response.
 */
function fitLogistic(
  rows: SnapshotProtocol[],
  snapshot: Snapshot,
  medianAgeDays: number,
  categories: string[],
  features: (p: SnapshotProtocol, snapshot: Snapshot, medianAgeDays: number, categories: string[]) => number[] = oddsFeatures,
): number[] {
  const X = rows.map((p) => features(p, snapshot, medianAgeDays, categories));
  const y = rows.map((p) => (isPreToken(p) ? 0 : 1));
  let beta = new Array(X[0]!.length).fill(0);
  for (let iter = 0; iter < 60; iter++) {
    const weights: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const eta = dot(beta, X[i]!);
      const mu = logistic(eta);
      const w = Math.max(mu * (1 - mu), 1e-4);
      weights.push(w);
      z.push(eta + Math.min(10, Math.max(-10, (y[i]! - mu) / w)));
    }
    beta = ols(X, z, 1, weights);
  }
  return beta;
}

function brierAndLogloss(predicted: number[], actual: number[]): { brier: number; logloss: number } {
  const n = predicted.length;
  let brier = 0;
  let logloss = 0;
  for (let i = 0; i < n; i++) {
    const pr = Math.min(0.999, Math.max(0.001, predicted[i]!));
    brier += (predicted[i]! - actual[i]!) ** 2;
    logloss += actual[i]! === 1 ? -Math.log(pr) : -Math.log(1 - pr);
  }
  return { brier: brier / n, logloss: logloss / n };
}

/**
 * The radar-5 odds table, recomputed from a given population: the share of protocols in
 * a protocol's age-bucket by TVL-tier cell that already launched, shrunk toward the
 * bucket's rate with 10 pseudo-counts. A protocol with no listing date takes the
 * population's launch rate. It survives only as the baseline the logistic model must
 * beat.
 */
function tableOddsOn(p: SnapshotProtocol, population: SnapshotProtocol[], snapshot: Snapshot): number {
  const launchedCount = population.filter((q) => !isPreToken(q)).length;
  const age = ageDays(snapshot.as_of, p.listed_at);
  if (age === null) return launchedCount / Math.max(1, population.length);
  const bucket = ODDS_BUCKETS.find(([min, max]) => age >= min && age < max)!;
  const tier = ODDS_TIERS.find(([min, max]) => p.tvl_usd >= min && p.tvl_usd < max)!;
  const inBucket = population.filter((q) => {
    const a = ageDays(snapshot.as_of, q.listed_at);
    return a !== null && a >= bucket[0] && a < bucket[1];
  });
  const bucketRate = inBucket.filter((q) => !isPreToken(q)).length / Math.max(1, inBucket.length);
  const cell = inBucket.filter((q) => q.tvl_usd >= tier[0] && q.tvl_usd < tier[1]);
  const cellLaunched = cell.filter((q) => !isPreToken(q)).length;
  return (cellLaunched + ODDS_SHRINKAGE * bucketRate) / (cell.length + ODDS_SHRINKAGE);
}

/**
 * The logistic model against the old table, held out. The fixed split trains on the
 * 80% and scores the 20% test set (the same sha256 split the value model uses); the
 * five-fold pass holds out each hash quintile in turn. Both are reported so the panel
 * can say which odds the board carries and why. The extended logistic (chain count
 * plus category-by-age interactions) is scored the same way and kept only when its
 * five-fold Brier beats the plain logistic's.
 */
function validateOdds(snapshot: Snapshot, medianAgeDays: number, categories: string[]): OddsValidation {
  const protocols = snapshot.protocols;
  const globalRate = protocols.filter((p) => !isPreToken(p)).length / protocols.length;
  const test = protocols.filter((p) => isTestSet(p.slug));
  const train = protocols.filter((p) => !isTestSet(p.slug));
  const logisticTrain = fitLogistic(train, snapshot, medianAgeDays, categories);
  const extendedTrain = fitLogistic(train, snapshot, medianAgeDays, categories, oddsFeaturesExtended);
  const testActual = test.map((p) => (isPreToken(p) ? 0 : 1));
  const table = brierAndLogloss(
    test.map((p) => tableOddsOn(p, train, snapshot)),
    testActual,
  );
  const log = brierAndLogloss(
    test.map((p) => logistic(dot(logisticTrain, oddsFeatures(p, snapshot, medianAgeDays, categories)))),
    testActual,
  );
  const ext = brierAndLogloss(
    test.map((p) => logistic(dot(extendedTrain, oddsFeaturesExtended(p, snapshot, medianAgeDays, categories)))),
    testActual,
  );
  const global = brierAndLogloss(
    test.map(() => globalRate),
    testActual,
  );
  let fiveTable = 0;
  let fiveLog = 0;
  let fiveExt = 0;
  for (let q = 0; q < 5; q++) {
    const held = protocols.filter((p) => hashQuintile(p.slug) === q);
    const rest = protocols.filter((p) => hashQuintile(p.slug) !== q);
    const beta = fitLogistic(rest, snapshot, medianAgeDays, categories);
    const betaExt = fitLogistic(rest, snapshot, medianAgeDays, categories, oddsFeaturesExtended);
    const actual = held.map((p) => (isPreToken(p) ? 0 : 1));
    fiveTable += brierAndLogloss(
      held.map((p) => tableOddsOn(p, rest, snapshot)),
      actual,
    ).brier;
    fiveLog += brierAndLogloss(
      held.map((p) => logistic(dot(beta, oddsFeatures(p, snapshot, medianAgeDays, categories)))),
      actual,
    ).brier;
    fiveExt += brierAndLogloss(
      held.map((p) => logistic(dot(betaExt, oddsFeaturesExtended(p, snapshot, medianAgeDays, categories)))),
      actual,
    ).brier;
  }
  return {
    test_size: test.length,
    table_brier: table.brier,
    logistic_brier: log.brier,
    table_logloss: table.logloss,
    logistic_logloss: log.logloss,
    global_brier: global.brier,
    five_fold_table_brier: fiveTable / 5,
    five_fold_logistic_brier: fiveLog / 5,
    extended_logistic_brier: ext.brier,
    extended_logistic_logloss: ext.logloss,
    five_fold_extended_logistic_brier: fiveExt / 5,
  };
}

/**
 * The logistic launch-odds model: the eight most common categories, the most common as
 * the reference, the regression fitted on all 758 snapshot protocols and validated
 * against the radar-5 table on held-out splits. The extended shape (chain count plus
 * category-by-age interactions) replaces the plain one only when its five-fold Brier
 * beats the plain logistic's.
 */
export function fitLaunchOdds(snapshot: Snapshot): LogisticOdds {
  const counts = new Map<string, number>();
  for (const p of snapshot.protocols) counts.set(p.category ?? 'Other', (counts.get(p.category ?? 'Other') ?? 0) + 1);
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => c);
  const reference = categories[0]!;
  const medianAgeDays = median(
    snapshot.protocols.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((d): d is number => d !== null),
    0,
  );
  const validation = validateOdds(snapshot, medianAgeDays, categories);
  const keepExtended = validation.five_fold_extended_logistic_brier < validation.five_fold_logistic_brier;
  const coefficients = keepExtended
    ? fitLogistic(snapshot.protocols, snapshot, medianAgeDays, categories, oddsFeaturesExtended)
    : fitLogistic(snapshot.protocols, snapshot, medianAgeDays, categories);
  return { reference_category: reference, categories: categories.slice(1), coefficients, median_age_days: medianAgeDays, validation, features: keepExtended ? 'extended' : 'base' };
}

/** The launch odds for one protocol: the fitted logistic model's probability. */
export function launchOdds(p: SnapshotProtocol, snapshot: Snapshot, model: LogisticOdds): number {
  const categories = [model.reference_category, ...model.categories];
  const features = model.features === 'extended' ? oddsFeaturesExtended : oddsFeatures;
  return logistic(dot(model.coefficients, features(p, snapshot, model.median_age_days, categories)));
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
export function buildBoard(snapshot: Snapshot, fit: FittedModel, oddsModel: LogisticOdds): BoardRow[] {
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
    const odds = launchOdds(p, snapshot, oddsModel);
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
  const odds = fitLaunchOdds(snapshot);
  const board = buildBoard(snapshot, fit, odds);
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
    odds,
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
