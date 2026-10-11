import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';

export type ScalpKind = 'five-minute-continuation' | 'five-minute-fade' | 'vwap-reclaim';
export type ScalpTrade = {
  ticker: string;
  day: string;
  kind: ScalpKind;
  entryAt: string;
  exitAt: string;
  entry: number;
  exit: number;
  reason: 'target' | 'stop' | 'time';
  netPct: number;
  stressPct: number;
};

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
const targetFactor = 1.003;
const stopFactor = 0.998;

export type ScalpBounds = { sessionEnd?: string; lastSignal?: string };

function moscowDay(time: string): string {
  return new Date(Date.parse(time) + 10_800_000).toISOString().slice(0, 10);
}

function at(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00+03:00`);
}

function groupDays(candles: readonly Candle[]): Map<string, Map<number, Candle>> {
  const days = new Map<string, Map<number, Candle>>();
  const seen = new Set<number>();
  for (const candle of candles) {
    const stamp = Date.parse(candle.time);
    if (!Number.isFinite(stamp) || stamp % 60_000 || seen.has(stamp)) throw new Error('Invalid or duplicate candle');
    if (![candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error('Invalid candle price');
    }
    if (candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close)) {
      throw new Error('Candle range does not contain open and close');
    }
    seen.add(stamp);
    const day = moscowDay(candle.time);
    const rows = days.get(day) ?? new Map<number, Candle>();
    rows.set(stamp, candle);
    days.set(day, rows);
  }
  return days;
}

function fiveMinuteReturn(rows: Map<number, Candle>, stamp: number): number | null {
  for (let step = 0; step <= 4; step += 1) if (!rows.has(stamp - step * 60_000)) return null;
  const start = rows.get(stamp - 4 * 60_000)!;
  const end = rows.get(stamp)!;
  return end.close / start.open - 1;
}

export function simulateScalp(ticker: string, candles: readonly Candle[], kind: ScalpKind, bounds: ScalpBounds = {}) {
  const trades: ScalpTrade[] = [];
  const unresolved: string[] = [];
  let sessionDays = 0;
  for (const [day, rows] of [...groupDays(candles).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
    const open = at(day, '10:00');
    if (!rows.has(open)) continue;
    sessionDays += 1;
    let pv = 0;
    let volume = 0;
    let previousClose: number | null = null;
    let previousVwap: number | null = null;
    let position: { entry: number; entryAt: number; stop: number; target: number; timeStop: number } | null = null;
    const sessionEnd = at(day, bounds.sessionEnd ?? '18:40');
    const lastSignal = at(day, bounds.lastSignal ?? '18:19');
    let dayOpen = true;
    for (let stamp = open; stamp <= sessionEnd && dayOpen; stamp += 60_000) {
      const candle = rows.get(stamp);
      if (position && stamp >= position.entryAt && stamp < position.timeStop) {
        if (!candle) {
          unresolved.push(`${ticker}:${day}`);
          dayOpen = false;
          break;
        }
        const stopHit = candle.low <= position.stop;
        const targetHit = candle.high >= position.target;
        if (stopHit || targetHit) {
          const exit = stopHit ? Math.min(candle.open, position.stop) : position.target;
          trades.push(fill(ticker, day, kind, position.entry, position.entryAt, exit, stamp, stopHit ? 'stop' : 'target'));
          position = null;
        }
      } else if (position && stamp === position.timeStop) {
        if (!candle) {
          unresolved.push(`${ticker}:${day}`);
          dayOpen = false;
          break;
        }
        trades.push(fill(ticker, day, kind, position.entry, position.entryAt, candle.open, stamp, 'time'));
        position = null;
      }
      if (!candle) {
        previousClose = null;
        previousVwap = null;
        continue;
      }
      const typical = (candle.high + candle.low + candle.close) / 3;
      if (candle.volume > 0) {
        pv += typical * candle.volume;
        volume += candle.volume;
      }
      const vwap = volume > 0 ? pv / volume : null;
      if (!position && stamp >= open + 4 * 60_000 && stamp <= lastSignal) {
        const move = fiveMinuteReturn(rows, stamp);
        const signal = kind === 'five-minute-continuation' ? move !== null && move >= 0.0015
          : kind === 'five-minute-fade' ? move !== null && move <= -0.003
            : previousClose !== null && previousVwap !== null && vwap !== null && previousClose < previousVwap && candle.close > vwap;
        const entryCandle = rows.get(stamp + 60_000);
        if (signal && entryCandle && stamp + 60_000 <= lastSignal + 60_000 && stamp + 16 * 60_000 <= sessionEnd) {
          position = {
            entry: entryCandle.open,
            entryAt: stamp + 60_000,
            stop: entryCandle.open * stopFactor,
            target: entryCandle.open * targetFactor,
            timeStop: stamp + 16 * 60_000,
          };
        }
      }
      previousClose = candle.close;
      previousVwap = vwap;
    }
    if (position && dayOpen) unresolved.push(`${ticker}:${day}`);
  }
  return { trades, unresolved, sessionDays };
}

function fill(ticker: string, day: string, kind: ScalpKind, entry: number, entryAt: number, exit: number, exitAt: number, reason: ScalpTrade['reason']): ScalpTrade {
  return {
    ticker,
    day,
    kind,
    entryAt: new Date(entryAt).toISOString(),
    exitAt: new Date(exitAt).toISOString(),
    entry,
    exit,
    reason,
    netPct: eventReturnPct(entry, exit, costScenarios.traderBeforeSubscription),
    stressPct: eventReturnPct(entry, exit, traderStress),
  };
}

export function scalpGateReasons(trades: readonly { day: string; netPct: number; stressPct: number }[], sessionDays: number, unresolved: number): string[] {
  const reasons: string[] = [];
  if (unresolved !== 0) reasons.push('unresolved');
  if (trades.length < 500) reasons.push('too-few-trades');
  if (sessionDays === 0 || trades.length / sessionDays < 2) reasons.push('below-two-trades-per-session-day');
  const nets = trades.map((trade) => trade.netPct);
  const winners = nets.filter((value) => value > 0).length;
  if (trades.length === 0 || winners / trades.length < 0.51) reasons.push('failed-win-rate');
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanNet = mean(nets);
  const meanStress = mean(trades.map((trade) => trade.stressPct));
  if (meanNet === null || meanNet <= 0 || meanStress === null || meanStress <= 0) reasons.push('failed-mean');
  for (const year of [2024, 2025]) {
    const yearMean = mean(trades.filter((trade) => trade.day.startsWith(String(year))).map((trade) => trade.netPct));
    if (yearMean === null || yearMean <= 0) reasons.push(`failed-${year}`);
  }
  const byDay = new Map<string, number>();
  for (const trade of trades) byDay.set(trade.day, (byDay.get(trade.day) ?? 0) + trade.netPct);
  const days = [...byDay.values()].sort((a, b) => b - a);
  if (days.length <= 5 || days.slice(5).reduce((sum, value) => sum + value, 0) <= 0) reasons.push('failed-without-best-five-days');
  return reasons;
}
