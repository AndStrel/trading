import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { netReturnPct, summarizeSignals, type SignalResult } from './similarity-experiment.js';

const MINUTE = 60_000;
export type HourlySample = { ticker: string; day: string; decisionAt: string; terminalAt: string;
  features: number[]; outcome: { entry: number; exit: number } | null };

// Future completeness never affects feature eligibility or inference.
export function hourlySamples(ticker: string, candles: readonly Candle[]) {
  const byTime = new Map<number, Candle>();
  const dates = new Set<string>();
  for (const c of candles) {
    const t = Date.parse(c.time);
    if (!Number.isFinite(t) || t % MINUTE || byTime.has(t) ||
      ![c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
      c.low <= 0 || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) ||
      c.volume < 0 || !Number.isSafeInteger(c.volume)) throw new Error('Invalid/duplicate minute candle');
    byTime.set(t, c);
    dates.add(new Date(t + 3 * 3600_000).toISOString().slice(0, 10));
  }
  const window = (start: number, length: number) => {
    const result: Candle[] = [];
    for (let i = 0; i < length; i++) {
      const c = byTime.get(start + i * MINUTE);
      if (!c) return null;
      result.push(c);
    }
    return result;
  };
  const samples: HourlySample[] = [];
  let missingHistory = 0;
  for (const day of [...dates].sort()) for (let hour = 12; hour <= 17; hour++) {
    const decision = Date.parse(`${day}T${hour}:00:00+03:00`);
    const past = window(decision - 120 * MINUTE, 120);
    if (!past) { missingHistory++; continue; }
    const previous = past.slice(0, 60), recent = past.slice(60);
    const range = (x: Candle[]) => Math.max(...x.map((c) => c.high)) / Math.min(...x.map((c) => c.low)) - 1;
    const volume = (x: Candle[]) => x.reduce((s, c) => s + c.volume, 0);
    const high = Math.max(...past.map((c) => c.high)), low = Math.min(...past.map((c) => c.low));
    const features = [recent[59]!.close / recent[0]!.open - 1, previous[59]!.close / previous[0]!.open - 1,
      range(recent), range(previous), Math.log((volume(recent) + 1) / (volume(previous) + 1)),
      high === low ? 0.5 : (recent[59]!.close - low) / (high - low)];
    const future = window(decision + MINUTE, 60);
    samples.push({ ticker, day, decisionAt: new Date(decision).toISOString(),
      terminalAt: new Date(decision + 61 * MINUTE).toISOString(), features,
      outcome: future ? { entry: future[0]!.open, exit: future[59]!.close } : null });
  }
  return { samples, observedDays: dates.size, missingHistory };
}

export type ModelKind = 'logistic' | 'mlp';
export type TrendModel = { kind: ModelKind; mean: number[]; scale: number[];
  hidden: number[][]; hiddenBias: number[]; weights: number[]; bias: number };
const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, x))));
const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i]!, 0);
function scaled(model: TrendModel, features: number[]) {
  if (features.length !== model.mean.length || features.some((v) => !Number.isFinite(v))) throw new Error('Invalid features');
  return features.map((v, i) => Math.max(-5, Math.min(5, (v - model.mean[i]!) / model.scale[i]!)));
}
function activation(model: TrendModel, x: number[]) {
  return model.kind === 'logistic' ? x : model.hidden.map((w, j) => Math.tanh(dot(w, x) + model.hiddenBias[j]!));
}
export function predictTrend(model: TrendModel, features: number[]) {
  return sigmoid(dot(model.weights, activation(model, scaled(model, features))) + model.bias);
}

export function fitTrend(kind: ModelKind, samples: readonly HourlySample[], cutoff: string): TrendModel {
  // Do not accept caller-provided test labels, even accidentally.
  const training = samples.filter((s) => s.decisionAt < cutoff && s.terminalAt < cutoff && s.outcome !== null);
  if (training.length < 200) throw new Error('Insufficient completed training history');
  const labels = training.map((s) => Number(s.outcome!.exit > s.outcome!.entry));
  if (!labels.includes(0) || !labels.includes(1)) throw new Error('Both training classes required');
  if (training.some((s) => s.features.length !== 6 || s.features.some((v) => !Number.isFinite(v)))) throw new Error('Invalid training features');
  const mean = Array.from({ length: 6 }, (_, j) => training.reduce((sum, s) => sum + s.features[j]!, 0) / training.length);
  const scale = mean.map((m, j) => Math.sqrt(training.reduce((sum, s) => sum + (s.features[j]! - m) ** 2, 0) / training.length) || 1);
  let seed = 42;
  const randomWeight = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return (seed / 4294967296 - 0.5) * 0.4; };
  const model: TrendModel = { kind, mean, scale,
    hidden: kind === 'mlp' ? Array.from({ length: 6 }, () => Array.from({ length: 6 }, randomWeight)) : [],
    hiddenBias: kind === 'mlp' ? Array(6).fill(0) as number[] : [],
    weights: Array.from({ length: 6 }, () => kind === 'mlp' ? randomWeight() : 0), bias: 0 };
  const inputs = training.map((s) => scaled(model, s.features));
  for (let epoch = 0; epoch < 300; epoch++) {
    const dw = model.weights.map(() => 0), dh = model.hidden.map((w) => w.map(() => 0));
    const dbh = model.hiddenBias.map(() => 0);
    let db = 0;
    inputs.forEach((x, i) => {
      const a = activation(model, x), error = sigmoid(dot(model.weights, a) + model.bias) - labels[i]!;
      db += error;
      for (let j = 0; j < dw.length; j++) {
        dw[j] = dw[j]! + error * a[j]!;
        if (kind === 'mlp') {
          const delta = error * model.weights[j]! * (1 - a[j]! ** 2);
          dbh[j] = dbh[j]! + delta;
          for (let k = 0; k < x.length; k++) dh[j]![k] = dh[j]![k]! + delta * x[k]!;
        }
      }
    });
    model.bias -= 0.05 * db / inputs.length;
    for (let j = 0; j < dw.length; j++) {
      model.weights[j] = model.weights[j]! - 0.05 * (dw[j]! / inputs.length + 0.001 * model.weights[j]!);
      if (kind === 'mlp') {
        model.hiddenBias[j] = model.hiddenBias[j]! - 0.05 * dbh[j]! / inputs.length;
        for (let k = 0; k < 6; k++) model.hidden[j]![k] = model.hidden[j]![k]! -
          0.05 * (dh[j]![k]! / inputs.length + 0.001 * model.hidden[j]![k]!);
      }
    }
  }
  return model;
}

export function evaluateHourly(samples: readonly HourlySample[], probability: (features: number[]) => number, threshold: number) {
  const trades: (Omit<SignalResult, 'predictedPct'> & { probabilityUp: number })[] = [], incomplete: string[] = [];
  const predictions = samples.map((s) => {
    const p = probability(s.features);
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('Invalid prediction');
    const signal = p > threshold;
    if (signal) {
      if (!s.outcome) incomplete.push(`${s.ticker}:${s.decisionAt}`);
      else {
        const { entry, exit } = s.outcome;
        trades.push({ ticker: s.ticker, day: s.day,
          entryAt: new Date(Date.parse(s.decisionAt) + MINUTE).toISOString(),
          probabilityUp: p, entry, exit, grossPct: (exit / entry - 1) * 100,
          netPct: netReturnPct(entry, exit, 0.0005), stressPct: netReturnPct(entry, exit, 0.001),
          extremePct: netReturnPct(entry, exit, 0.0015) });
      }
    }
    return { ticker: s.ticker, decisionAt: s.decisionAt, probabilityUp: p, signal, complete: s.outcome !== null };
  });
  return { predictions, trades, incomplete, base: summarizeSignals(trades, 'netPct'),
    stress: summarizeSignals(trades, 'stressPct'), extreme: summarizeSignals(trades, 'extremePct') };
}

export function primaryGate(results: ReturnType<typeof evaluateHourly>[]) {
  const combined = summarizeSignals(results.flatMap((r) => r.trades), 'netPct');
  const reasons: string[] = [];
  if (results.some((r) => r.incomplete.length)) reasons.push('incomplete-signals');
  if (combined.trades < 100 || combined.days < 50) reasons.push('insufficient-signals-or-dates');
  if (results.some((r) => [r.base, r.stress].some((m) => m.averageNetPct === null || m.averageNetPct <= 0 ||
    m.positiveSumPct <= m.negativeSumPct || m.withoutBestDaySumPct <= 0 || m.withoutBestTickerSumPct <= 0))) reasons.push('nonpositive-or-fragile-year');
  return { status: reasons.length ? 'rejected-at-primary-gate' : 'eligible-for-portfolio-test', reasons, combined };
}
