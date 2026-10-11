import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';

export type AfternoonTrade = { day: string; pattern: 'U' | 'D'; netPct: number; stressPct: number };
const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function at(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00+03:00`);
}

function dayOf(time: string): string {
  return new Date(Date.parse(time) + 10_800_000).toISOString().slice(0, 10);
}

export function simulateAfternoon(candles: readonly Candle[]) {
  const days = new Map<string, Map<number, Candle>>();
  for (const candle of candles) {
    const stamp = Date.parse(candle.time);
    if (!Number.isFinite(stamp)) throw new Error('Invalid candle time');
    const day = dayOf(candle.time);
    const rows = days.get(day) ?? new Map<number, Candle>();
    rows.set(stamp, candle);
    days.set(day, rows);
  }
  const trades: AfternoonTrade[] = [];
  const unresolved: { day: string; pattern: 'U' | 'D' }[] = [];
  for (const [day, rows] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (day < '2024-01-01' || day > '2025-12-30') continue;
    if ([0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) continue;
    const open = rows.get(at(day, '10:00'));
    const morning = rows.get(at(day, '11:59'));
    if (!open || !morning) continue;
    const move = morning.close / open.open - 1;
    if (move === 0) continue;
    const entry = rows.get(at(day, '12:00'));
    const exit = rows.get(at(day, '17:00'));
    if (!entry || !exit) {
      unresolved.push({ day, pattern: move > 0 ? 'U' : 'D' });
      continue;
    }
    const pattern = move > 0 ? 'U' : 'D';
    trades.push({
      day,
      pattern,
      netPct: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.open, exit.open, traderStress),
    });
  }
  return { trades, unresolved };
}
