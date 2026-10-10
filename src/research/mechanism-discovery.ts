import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { eventReturnPct, costScenarios } from './trading-costs.js';

export type MorningFrame = { ticker: string; day: string; ret: number; firstRet: number; rebound: number;
  firstRange: number; firstHigh: number; lastClose: number; firstVolume: number; lastVolume: number };
export type Mechanism = 'relative-lag' | 'selling-exhaustion' | 'compression-breakout' | 'control';
export const mechanisms: Mechanism[] = ['relative-lag', 'selling-exhaustion', 'compression-breakout', 'control'];
export function morningFrame(ticker: string, day: string, byTime: ReadonlyMap<number, Candle>): MorningFrame | null {
  const start = Date.parse(`${day}T10:00:00+03:00`);
  const past: Candle[] = [];
  for (let i = 0; i < 120; i++) { const c = byTime.get(start + i * 60_000); if (!c) return null; past.push(c); }
  const first = past.slice(0, 90), last = past.slice(90);
  const high = Math.max(...first.map((c) => c.high)), low = Math.min(...first.map((c) => c.low));
  return { ticker, day, ret: past[119]!.close / past[0]!.open - 1, firstRet: first[89]!.close / first[0]!.open - 1,
    rebound: last[29]!.close / last[0]!.open - 1, firstRange: high / low - 1, firstHigh: high,
    lastClose: last[29]!.close, firstVolume: first.reduce((s, c) => s + c.volume, 0), lastVolume: last.reduce((s, c) => s + c.volume, 0) };
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
export function median(values: number[]) { const v = [...values].sort((a, b) => a - b); if (!v.length) throw new Error('Empty median');
  return v.length % 2 ? v[Math.floor(v.length / 2)]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2; }
export function mechanismSignals(self: MorningFrame, other: MorningFrame, history: [MorningFrame, MorningFrame][]) {
  // Caller order is not trusted; no current/future feature can enter historical norms.
  const past = history.filter(([a, b]) => a.day === b.day && a.day < self.day && a.ticker === self.ticker && b.ticker === other.ticker)
    .sort(([a], [b]) => a.day.localeCompare(b.day)).slice(-60);
  if (self.day !== other.day || past.length < 60 || new Set(past.map(([a]) => a.day)).size !== 60) return null;
  const xs = past.map(([, b]) => b.ret), ys = past.map(([a]) => a.ret), mx = mean(xs), my = mean(ys);
  const variance = mean(xs.map((x) => (x - mx) ** 2));
  const beta = variance > 1e-12 ? mean(xs.map((x, i) => (x - mx) * (ys[i]! - my))) / variance : 0;
  const alpha = my - beta * mx, sigma = Math.sqrt(mean(ys.map((y, i) => (y - alpha - beta * xs[i]!) ** 2)));
  const recent = past.slice(-20).map(([a]) => a);
  const volume = median(recent.map((a) => a.firstVolume)), lastVolume = median(recent.map((a) => a.lastVolume));
  const range = median(recent.map((a) => a.firstRange));
  return { signals: {
    'relative-lag': variance > 1e-12 && sigma > 1e-8 && self.ret - alpha - beta * other.ret <= -1.5 * sigma && other.ret >= 0.005 && self.rebound >= 0.001,
    'selling-exhaustion': volume > 0 && self.firstRet <= -0.005 && self.firstVolume >= 2 * volume && self.rebound >= 0.001,
    'compression-breakout': range > 0 && lastVolume > 0 && self.firstRange <= 0.5 * range && self.lastClose > self.firstHigh && self.lastVolume >= 1.5 * lastVolume,
    control: true,
  }, norms: { alpha, beta, sigma, firstVolumeMedian: volume, lastVolumeMedian: lastVolume, rangeMedian: range, historyEnd: past.at(-1)![0].day } };
}

export type DiscoveryTrade = { ticker: string; day: string; entryAt: string; exitAt: string; entry: number; exit: number;
  net: number; stress: number; trader: number; gross: number; oracleNet: number | null };
export function executeDiscovery(frame: MorningFrame, byTime: ReadonlyMap<number, Candle>) {
  const start = Date.parse(`${frame.day}T12:01:00+03:00`), plannedExit = Date.parse(`${frame.day}T17:01:00+03:00`);
  let entry: Candle | undefined, exit: Candle | undefined;
  for (let i = 0; i <= 4 && !entry; i++) entry = byTime.get(start + i * 60_000);
  if (!entry) return { status: 'cancelled' as const, ticker: frame.ticker, day: frame.day };
  for (let i = 0; i <= 109 && !exit; i++) exit = byTime.get(plannedExit + i * 60_000);
  if (!exit) return { status: 'unclosed' as const, ticker: frame.ticker, day: frame.day, entryAt: entry.time, entry: entry.open };
  let peak = entry.open, complete = Date.parse(exit.time) === plannedExit;
  for (let t = Date.parse(entry.time); t < plannedExit; t += 60_000) {
    const c = byTime.get(t); if (!c) complete = false; else peak = Math.max(peak, c.high);
  }
  const trade: DiscoveryTrade = { ticker: frame.ticker, day: frame.day, entryAt: entry.time, exitAt: exit.time,
    entry: entry.open, exit: exit.open, net: eventReturnPct(entry.open, exit.open, costScenarios.investorBase),
    stress: eventReturnPct(entry.open, exit.open, costScenarios.investorStress),
    trader: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
    gross: eventReturnPct(entry.open, exit.open, costScenarios.gross),
    oracleNet: complete ? eventReturnPct(entry.open, Math.max(peak, exit.open), costScenarios.investorBase) : null };
  return { status: 'closed' as const, trade };
}
export function discoveryStats(trades: DiscoveryTrade[], metric: 'net' | 'stress' | 'trader' | 'gross' = 'net') {
  const values = trades.map((t) => t[metric]), wins = values.filter((v) => v > 0), losses = values.filter((v) => v < 0);
  const sum = values.reduce((s, v) => s + v, 0), positive = wins.reduce((s, v) => s + v, 0), negative = -losses.reduce((s, v) => s + v, 0);
  const sums = (key: 'day' | 'ticker') => { const grouped = new Map<string, number>();
    for (const t of trades) grouped.set(t[key], (grouped.get(t[key]) ?? 0) + t[metric]); return [...grouped.values()]; };
  const days = sums('day'), tickers = sums('ticker');
  return { count: trades.length, days: days.length, winRate: values.length ? wins.length / values.length : null,
    meanNetPct: values.length ? mean(values) : null, meanWinPct: wins.length ? mean(wins) : null,
    meanLossPct: losses.length ? mean(losses) : null, profitFactor: negative ? positive / negative : null,
    positiveSumPct: positive, negativeSumPct: negative,
    withoutBestDaySumPct: sum - (days.length ? Math.max(...days) : 0), withoutBestTickerSumPct: sum - (tickers.length ? Math.max(...tickers) : 0) };
}
export function blockIntervals(trades: DiscoveryTrade[]) {
  const grouped = new Map<string, DiscoveryTrade[]>();
  for (const t of trades) { const a = grouped.get(t.day) ?? []; a.push(t); grouped.set(t.day, a); }
  const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  if (groups.length < 5) return null;
  let seed = 42; const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const averages: number[] = [], rates: number[] = [];
  for (let run = 0; run < 1000; run++) {
    let n = 0, wins = 0, total = 0;
    for (let days = 0; days < groups.length;) {
      const start = Math.floor(random() * groups.length);
      for (let j = 0; j < 5 && days < groups.length; j++, days++) for (const t of groups[(start + j) % groups.length]!) {
        n++; total += t.net; if (t.net > 0) wins++;
      }
    }
    averages.push(total / n); rates.push(wins / n);
  }
  const interval = (v: number[]) => { v.sort((a, b) => a - b); return [v[24]!, v[974]!] as const; };
  return { meanNetPct: interval(averages), winRate: interval(rates), warning: 'Descriptive discovery bootstrap, not selection-adjusted or independent evidence.' };
}
