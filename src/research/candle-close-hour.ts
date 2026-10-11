import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type CloseHourTrade = { day: string; pattern: 'U' | 'D'; netPct: number; stressPct: number };

function at(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00+03:00`);
}

function dayOf(time: string): string {
  return new Date(Date.parse(time) + 10_800_000).toISOString().slice(0, 10);
}

export function simulateCloseHour(candles: readonly Candle[]) {
  const days = new Map<string, Map<number, Candle>>();
  for (const candle of candles) {
    const day = dayOf(candle.time);
    const rows = days.get(day) ?? new Map<number, Candle>();
    rows.set(Date.parse(candle.time), candle);
    days.set(day, rows);
  }
  const ordered = [...days.keys()].filter((day) => day >= '2024-01-01' && day <= '2025-12-30' && ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())).sort();
  const trades: CloseHourTrade[] = [];
  const unresolved: { day: string; pattern: 'U' | 'D' }[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const prior = days.get(ordered[index - 1]!)!;
    const current = days.get(ordered[index]!)!;
    const start = prior.get(at(ordered[index - 1]!, '16:00'));
    const end = prior.get(at(ordered[index - 1]!, '16:59'));
    if (!start || !end || end.close === start.open) continue;
    const pattern = end.close > start.open ? 'U' : 'D';
    const entry = current.get(at(ordered[index]!, '10:00'));
    const exit = current.get(at(ordered[index]!, '17:00'));
    if (!entry || !exit) {
      unresolved.push({ day: ordered[index]!, pattern });
      continue;
    }
    trades.push({
      day: ordered[index]!,
      pattern,
      netPct: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(entry.open, exit.open, traderStress),
    });
  }
  return { trades, unresolved };
}

export function closeHourPasses(trades: readonly CloseHourTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((a, b) => b - a).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}
