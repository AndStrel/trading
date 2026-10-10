export type Observation = {
  ticker: string; day: string; observedAt: string; availableAt: string; vector: number[];
  terminalAt: string | null; forwardReturnPct: number | null;
};

export function analoguePrediction(target: Observation, priorDays: readonly Observation[][]): number | null {
  const closest: { distance: number; value: number }[] = [];
  for (const day of priorDays.slice(-60)) {
    let best: { distance: number; value: number } | null = null;
    for (const record of day) {
      if (record.ticker !== target.ticker || record.day >= target.day || record.availableAt >= target.availableAt ||
        record.terminalAt === null || record.terminalAt > target.availableAt || record.forwardReturnPct === null) continue;
      if (record.vector.length !== target.vector.length) throw new Error('Feature dimension mismatch');
      let distance = 0;
      for (let i = 0; i < target.vector.length; i++) distance += (record.vector[i]! - target.vector[i]!) ** 2;
      if (best === null || distance < best.distance) best = { distance, value: record.forwardReturnPct };
    }
    if (best) closest.push(best);
  }
  closest.sort((a, b) => a.distance - b.distance);
  if (closest.length < 20) return null;
  return closest.slice(0, 20).reduce((sum, row) => sum + row.value, 0) / 20;
}

export function netReturnPct(entry: number, exit: number, slippage: number): number {
  if (entry <= 0 || exit <= 0 || !Number.isFinite(entry + exit)) throw new Error('Invalid price');
  const commission = 0.0005;
  return (exit * (1 - slippage) * (1 - commission) / (entry * (1 + slippage) * (1 + commission)) - 1) * 100;
}

export type SignalResult = { ticker: string; day: string; entryAt: string; predictedPct: number;
  entry: number; exit: number; grossPct: number; netPct: number; stressPct: number; extremePct: number };

export function summarizeSignals(trades: readonly Pick<SignalResult, 'day' | 'ticker' | 'netPct' | 'stressPct' | 'extremePct'>[], metric: 'netPct' | 'stressPct' | 'extremePct') {
  const total = trades.reduce((sum, t) => sum + t[metric], 0);
  const positive = trades.reduce((sum, t) => sum + Math.max(0, t[metric]), 0);
  const negative = trades.reduce((sum, t) => sum - Math.min(0, t[metric]), 0);
  const groups = (field: 'day' | 'ticker') => {
    const sums = new Map<string, number>();
    for (const t of trades) sums.set(t[field], (sums.get(t[field]) ?? 0) + t[metric]);
    return [...sums.entries()].sort((a, b) => b[1] - a[1]);
  };
  const days = groups('day'), tickers = groups('ticker');
  return { trades: trades.length, days: days.length, averageNetPct: trades.length ? total / trades.length : null,
    profitFactor: negative > 0 ? positive / negative : null,
    positiveSumPct: positive, negativeSumPct: negative,
    sumEventReturnsPct: total, withoutBestDaySumPct: total - (days[0]?.[1] ?? 0),
    withoutBestTickerSumPct: total - (tickers[0]?.[1] ?? 0) };
}
