import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type MondayHourTrade = { day: string; pattern: 'U' | 'D'; netPct: number; stressPct: number };

function at(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00+03:00`);
}

function dayOf(time: string): string {
  return new Date(Date.parse(time) + 10_800_000).toISOString().slice(0, 10);
}

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function simulateMondayHour(candles: readonly Candle[]) {
  const days = new Map<string, Map<number, Candle>>();
  for (const candle of candles) {
    const day = dayOf(candle.time);
    const rows = days.get(day) ?? new Map<number, Candle>();
    rows.set(Date.parse(candle.time), candle);
    days.set(day, rows);
  }
  const trades: MondayHourTrade[] = [];
  const unresolved: { day: string; pattern: 'U' | 'D' }[] = [];
  for (const [day, rows] of [...days.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (day < '2024-01-01' || day > '2025-12-30' || new Date(`${day}T12:00:00Z`).getUTCDay() !== 1) continue;
    const open = rows.get(at(day, '10:00'));
    const mark = rows.get(at(day, '10:59'));
    if (!open || !mark || mark.close === open.open) continue;
    const pattern = mark.close > open.open ? 'U' : 'D';
    const entry = rows.get(at(day, '11:00'));
    if (!entry) {
      unresolved.push({ day, pattern });
      continue;
    }
    const exit = days.get(addDays(day, 4))?.get(at(addDays(day, 4), '17:00'));
    if (!exit) continue;
    trades.push({
      day,
      pattern,
      netPct: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.open, exit.open, traderStress),
    });
  }
  return { trades, unresolved };
}

export function mondayHourPasses(trades: readonly MondayHourTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}
