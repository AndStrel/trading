import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { breakEvenGrossPct, costScenarios, eventReturnPct, type Costs } from './trading-costs.js';

export type HourlyKind = 'hourly-continuation' | 'hourly-fade';
export type ScalpV2Trade = {
  ticker: string;
  day: string;
  entryAt: string;
  exitAt: string;
  entry: number;
  exit: number;
  netPct: number;
  stressPct: number;
};

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
const defaultHours = [11, 12, 13, 14, 15, 16, 17];

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
    seen.add(stamp);
    const day = moscowDay(candle.time);
    const rows = days.get(day) ?? new Map<number, Candle>();
    rows.set(stamp, candle);
    days.set(day, rows);
  }
  return days;
}

function trade(ticker: string, day: string, entryAt: number, exitAt: number, entry: number, exit: number): ScalpV2Trade {
  return {
    ticker,
    day,
    entryAt: new Date(entryAt).toISOString(),
    exitAt: new Date(exitAt).toISOString(),
    entry,
    exit,
    netPct: eventReturnPct(entry, exit, costScenarios.traderBeforeSubscription),
    stressPct: eventReturnPct(entry, exit, traderStress),
  };
}

export function simulateHourlyHold(ticker: string, candles: readonly Candle[], kind: HourlyKind, clockHours: readonly number[] = defaultHours) {
  const trades: ScalpV2Trade[] = [];
  const unresolved: string[] = [];
  let sessionDays = 0;
  for (const [day, rows] of [...groupDays(candles).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
    if (!rows.has(at(day, '10:00'))) continue;
    sessionDays += 1;
    let dayOpen = true;
    for (const hour of clockHours) {
      if (!dayOpen) break;
      const entryAt = at(day, `${hour}:00`);
      const priorOpen = rows.get(entryAt - 60 * 60_000);
      const priorClose = rows.get(entryAt - 60_000);
      if (!priorOpen || !priorClose) continue;
      const move = priorClose.close / priorOpen.open - 1;
      const signal = kind === 'hourly-continuation' ? move > 0 : move < 0;
      if (!signal) continue;
      const entry = rows.get(entryAt);
      const exit = rows.get(entryAt + 20 * 60_000);
      if (!entry || !exit) {
        unresolved.push(`${ticker}:${day}`);
        dayOpen = false;
        break;
      }
      trades.push(trade(ticker, day, entryAt, entryAt + 20 * 60_000, entry.open, exit.open));
    }
  }
  return { trades, unresolved, sessionDays };
}

export function simulateSberLag(sber: readonly Candle[], gazp: readonly Candle[]) {
  const left = groupDays(sber);
  const right = groupDays(gazp);
  const hurdle = breakEvenGrossPct(costScenarios.traderBeforeSubscription) / 100;
  const trades: ScalpV2Trade[] = [];
  const unresolved: string[] = [];
  let sessionDays = 0;
  const days = [...left.keys()].filter((day) => right.has(day)).sort();
  for (const day of days) {
    if ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
    const sberRows = left.get(day)!;
    const gazpRows = right.get(day)!;
    if (!sberRows.has(at(day, '10:00')) || !gazpRows.has(at(day, '10:00'))) continue;
    sessionDays += 1;
    let busyUntil = 0;
    let dayOpen = true;
    for (let stamp = at(day, '10:04'); stamp <= at(day, '18:29') && dayOpen; stamp += 60_000) {
      if (stamp < busyUntil) continue;
      const move = (rows: Map<number, Candle>) => {
        for (let step = 0; step <= 4; step += 1) if (!rows.has(stamp - step * 60_000)) return null;
        return rows.get(stamp)!.close / rows.get(stamp - 4 * 60_000)!.open - 1;
      };
      const sberMove = move(sberRows);
      const gazpMove = move(gazpRows);
      if (sberMove === null || gazpMove === null || sberMove - gazpMove > -hurdle) continue;
      const entryAt = stamp + 60_000;
      const exitAt = entryAt + 10 * 60_000;
      const entry = sberRows.get(entryAt);
      const exit = sberRows.get(exitAt);
      if (!entry || !exit) {
        unresolved.push(`SBER:${day}`);
        dayOpen = false;
        break;
      }
      trades.push(trade('SBER', day, entryAt, exitAt, entry.open, exit.open));
      busyUntil = exitAt;
    }
  }
  return { trades, unresolved, sessionDays };
}
