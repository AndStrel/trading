import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type Open15Trade = { day: string; pattern: 'U' | 'D'; netPct: number; stressPct: number };

function at(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00+03:00`);
}

function dayOf(time: string): string {
  return new Date(Date.parse(time) + 10_800_000).toISOString().slice(0, 10);
}

export function simulateOpen15(candles: readonly Candle[]) {
  const days = new Map<string, Map<number, Candle>>();
  for (const candle of candles) {
    const day = dayOf(candle.time);
    const rows = days.get(day) ?? new Map<number, Candle>();
    rows.set(Date.parse(candle.time), candle);
    days.set(day, rows);
  }
  const trades: Open15Trade[] = [];
  const unresolved: { day: string; pattern: 'U' | 'D' }[] = [];
  for (const [day, rows] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (day < '2024-01-01' || day > '2025-12-30') continue;
    if ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
    const open = rows.get(at(day, '10:00'));
    const mark = rows.get(at(day, '10:14'));
    if (!open || !mark || mark.close === open.open) continue;
    const pattern = mark.close > open.open ? 'U' : 'D';
    const entry = rows.get(at(day, '10:15'));
    const exit = rows.get(at(day, '17:00'));
    if (!entry || !exit) {
      unresolved.push({ day, pattern });
      continue;
    }
    trades.push({
      day,
      pattern,
      netPct: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.open, exit.open, traderStress),
    });
  }
  return { trades, unresolved };
}

export function open15Passes(trades: readonly Open15Trade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((a, b) => b - a).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}
