// Small, auditable forecasters trained in the browser on observed series.
// They are honest baselines: every model is scored out-of-sample against
// persistence / a linear trend, and the skill is shown, not assumed.

export interface OniRow { year: number; month: number; oni: number }

/** Ridge regression by normal equations; column 0 is the unpenalised intercept. */
export function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let r = 0; r < X.length; r++) for (let i = 0; i < p; i++) { A[i][p] += X[r][i] * y[r]; for (let j = 0; j < p; j++) A[i][j] += X[r][i] * X[r][j]; }
  for (let i = 1; i < p; i++) A[i][i] += lambda;
  for (let c = 0; c < p; c++) {
    let pivot = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r;
    if (Math.abs(A[pivot][c]) < 1e-12) throw new Error('Singular design matrix: not enough varied data.');
    [A[c], A[pivot]] = [A[pivot], A[c]];
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j <= p; j++) A[r][j] -= k * A[c][j];
    }
  }
  return A.map((row, i) => row[p] / row[i]);
}

const rmse = (e: number[]) => Math.sqrt(e.reduce((s, v) => s + v * v, 0) / Math.max(1, e.length));
const LAGS = 12;

function features(oni: number[], rows: OniRow[], t: number): number[] {
  const f = [1];
  for (let l = 0; l < LAGS; l++) f.push(oni[t - l]);
  const phase = 2 * Math.PI * (rows[t].month - 1) / 12;
  f.push(Math.sin(phase), Math.cos(phase));
  return f;
}

export interface HorizonModel { horizon: number; weights: number[]; rmse: number; persistenceRmse: number; climatologyRmse: number; skillVsPersistence: number; testCount: number }
export interface EnsoForecaster { horizons: HorizonModel[]; trainedOn: number; testFrom: string; forecast: { horizon: number; month: string; oni: number; phase: 'El Nino' | 'La Nina' | 'Neutral' }[] }

const phaseOf = (v: number) => (v >= 0.5 ? 'El Nino' : v <= -0.5 ? 'La Nina' : 'Neutral') as 'El Nino' | 'La Nina' | 'Neutral';
const addMonths = (r: OniRow, h: number) => { const i = r.year * 12 + (r.month - 1) + h; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; };

export function trainEnsoForecaster(rows: OniRow[], horizons = [1, 3, 6], lambda = 5): EnsoForecaster {
  if (rows.length < 240) throw new Error('At least 20 years of monthly ONI are needed to train and test a forecaster.');
  const oni = rows.map((r) => r.oni);
  const split = Math.floor(rows.length * 0.8);
  const models: HorizonModel[] = horizons.map((h) => {
    const build = (from: number, to: number) => {
      const X: number[][] = []; const y: number[] = []; const idx: number[] = [];
      for (let t = Math.max(LAGS - 1, from); t + h < to; t++) { X.push(features(oni, rows, t)); y.push(oni[t + h]); idx.push(t); }
      return { X, y, idx };
    };
    // Training targets stop at the split, so no test-period value leaks into the fit.
    const train = build(0, split);
    const test = build(split, rows.length);
    const w = ridgeFit(train.X, train.y, lambda);
    const pred = test.X.map((x) => x.reduce((s, v, i) => s + v * w[i], 0));
    const clim = new Map<number, number[]>();
    train.idx.forEach((t, i) => { const m = rows[t + h].month; clim.set(m, [...(clim.get(m) ?? []), train.y[i]]); });
    const climMean = (m: number) => { const a = clim.get(m) ?? [0]; return a.reduce((s, v) => s + v, 0) / a.length; };
    const model = rmse(test.y.map((v, i) => v - pred[i]));
    const persistence = rmse(test.y.map((v, i) => v - oni[test.idx[i]]));
    const climatology = rmse(test.y.map((v, i) => v - climMean(rows[test.idx[i] + h].month)));
    return { horizon: h, weights: w, rmse: model, persistenceRmse: persistence, climatologyRmse: climatology, skillVsPersistence: 1 - model / persistence, testCount: test.y.length };
  });
  // Operational forecast: refit each horizon on all data, apply to the latest months.
  const last = rows.length - 1;
  const forecast = horizons.map((h) => {
    const X: number[][] = []; const y: number[] = [];
    for (let t = LAGS - 1; t + h < rows.length; t++) { X.push(features(oni, rows, t)); y.push(oni[t + h]); }
    const w = ridgeFit(X, y, lambda);
    const value = features(oni, rows, last).reduce((s, v, i) => s + v * w[i], 0);
    return { horizon: h, month: addMonths(rows[last], h), oni: value, phase: phaseOf(value) };
  });
  return { horizons: models, trainedOn: split, testFrom: `${rows[split].year}-${String(rows[split].month).padStart(2, '0')}`, forecast };
}

export interface TrendPoint { year: number; value: number }
export interface TrendModel { degree: number; predict: (year: number) => number; sigma: number; cutoff: number; backtestRmse: number; linearBacktestRmse: number; n: number; projection: { year: number; value: number; low: number; high: number }[] }

function polyFit(points: TrendPoint[], degree: number, centre: number) {
  const X = points.map((p) => Array.from({ length: degree + 1 }, (_, d) => ((p.year - centre) / 50) ** d));
  const w = ridgeFit(X, points.map((p) => p.value), 1e-9);
  return (year: number) => w.reduce((s, c, d) => s + c * ((year - centre) / 50) ** d, 0);
}

/** Quadratic warming trend, walk-forward checked against a straight line on years after the cutoff. */
export function trainWarmingTrend(points: TrendPoint[], horizonYear: number, minYear = 1970): TrendModel {
  const data = points.filter((p) => p.year >= minYear && Number.isFinite(p.value)).sort((a, b) => a.year - b.year);
  if (data.length < 12) throw new Error('At least 12 observed annual points are needed to fit a trend.');
  const centre = data[Math.floor(data.length / 2)].year;
  const cut = Math.floor(data.length * 0.75);
  const train = data.slice(0, cut);
  const test = data.slice(cut);
  const quad = polyFit(train, 2, centre);
  const line = polyFit(train, 1, centre);
  const backtestRmse = rmse(test.map((p) => p.value - quad(p.year)));
  const linearBacktestRmse = rmse(test.map((p) => p.value - line(p.year)));
  const predict = polyFit(data, 2, centre);
  // Use the larger of in-sample and out-of-sample error so the band is never narrower than the backtest showed.
  const sigma = Math.max(rmse(data.map((p) => p.value - predict(p.year))), backtestRmse);
  const lastYear = data[data.length - 1].year;
  const projection: TrendModel['projection'] = [];
  for (let y = lastYear; y <= Math.max(lastYear, horizonYear); y += 2) {
    const reach = y - lastYear;
    const spread = 1.96 * Math.sqrt(sigma * sigma + (0.006 * reach) ** 2); // widens with extrapolation distance (a heuristic, not a formal prediction interval)
    projection.push({ year: y, value: predict(y), low: predict(y) - spread, high: predict(y) + spread });
  }
  return { degree: 2, predict, sigma, cutoff: data[cut].year, backtestRmse, linearBacktestRmse, n: data.length, projection };
}
