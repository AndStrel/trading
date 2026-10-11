import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { breakEvenGrossPct, costScenarios, eventReturnPct, type Costs } from './trading-costs.js';

export type DriveTrade = {
  day: string;
  entryAt: string;
  exitAt: string;
  entry: number;
  exit: number;
  netPct: number;
  stressPct: number;
};

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function at(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00+03:00`);
}

function groupDays(candles: readonly Candle[]): Map<string, Map<number, Candle>> {
  const days = new Map<string, Map<number, Candle>>();
  for (const candle of candles) {
    const stamp = Date.parse(candle.time);
    if (!Number.isFinite(stamp)) throw new Error('Invalid candle time');
    const day = new Date(stamp + 10_800_000).toISOString().slice(0, 10);
    const rows = days.get(day) ?? new Map<number, Candle>();
    rows.set(stamp, candle);
    days.set(day, rows);
  }
  return days;
}

function slots(): string[] {
  const clocks: string[] = [];
  for (let minutes = 10 * 60 + 30; minutes <= 16 * 60 + 15; minutes += 15) {
    clocks.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  return clocks;
}

export function simulateOpeningDrive(candles: readonly Candle[]) {
  const hurdle = breakEvenGrossPct(costScenarios.traderBeforeSubscription) / 100;
  const trades: DriveTrade[] = [];
  const unresolved: string[] = [];
  let sessionDays = 0;
  for (const [day, rows] of [...groupDays(candles).entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
    const openCandle = rows.get(at(day, '10:00'));
    const driveCandle = rows.get(at(day, '10:29'));
    if (!openCandle || !driveCandle) continue;
    sessionDays += 1;
    const drive = driveCandle.close / openCandle.open - 1;
    if (drive <= hurdle) continue;
    let dayOpen = true;
    for (const clock of slots()) {
      if (!dayOpen) break;
      const entryAt = at(day, clock);
      const previous = rows.get(entryAt - 60_000);
      if (!previous || previous.close <= openCandle.open) continue;
      const entry = rows.get(entryAt);
      const exit = rows.get(entryAt + 15 * 60_000);
      if (!entry || !exit) {
        unresolved.push(day);
        dayOpen = false;
        break;
      }
      trades.push({
        day,
        entryAt: new Date(entryAt).toISOString(),
        exitAt: new Date(entryAt + 15 * 60_000).toISOString(),
        entry: entry.open,
        exit: exit.open,
        netPct: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
        stressPct: eventReturnPct(entry.open, exit.open, traderStress),
      });
    }
  }
  return { trades, unresolved, sessionDays };
}

export function openingDriveGateReasons(trades: readonly DriveTrade[], sessionDays: number, unresolved: number): string[] {
  const reasons: string[] = [];
  if (unresolved !== 0) reasons.push('unresolved');
  if (trades.length < 500) reasons.push('too-few-trades');
  if (sessionDays === 0 || trades.length / sessionDays < 2) reasons.push('below-two-trades-per-session-day');
  const winners = trades.filter((trade) => trade.netPct > 0).length;
  if (trades.length === 0 || winners / trades.length < 0.51) reasons.push('failed-win-rate');
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanNet = mean(trades.map((trade) => trade.netPct));
  const meanStress = mean(trades.map((trade) => trade.stressPct));
  if (meanNet === null || meanNet <= 0 || meanStress === null || meanStress <= 0) reasons.push('failed-mean');
  const byDay = new Map<string, number>();
  for (const trade of trades) byDay.set(trade.day, (byDay.get(trade.day) ?? 0) + trade.netPct);
  const days = [...byDay.values()].sort((a, b) => b - a);
  if (days.length <= 5 || days.slice(5).reduce((sum, value) => sum + value, 0) <= 0) reasons.push('failed-without-best-five-days');
  return reasons;
}
