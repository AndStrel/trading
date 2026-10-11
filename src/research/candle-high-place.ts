import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type HighPlaceTrade = { day: string; pattern: 'E' | 'M' | 'L'; netPct: number; stressPct: number };
export type HighPlaceHole = { day: string; pattern: 'E' | 'M' | 'L' };

function at(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00+03:00`);
}

function dayOf(time: string): string {
  return new Date(Date.parse(time) + 10_800_000).toISOString().slice(0, 10);
}

function place(day: string, rows: Map<number, Candle>): 'E' | 'M' | 'L' | '' {
  const window = [...rows.entries()].filter(([time]) => time >= at(day, '10:00') && time <= at(day, '16:59'));
  if (window.length === 0) return '';
  const high = Math.max(...window.map(([, candle]) => candle.high));
  const first = window.filter(([, candle]) => candle.high === high).sort(([left], [right]) => left - right)[0]![0];
  if (first <= at(day, '11:59')) return 'E';
  if (first <= at(day, '14:59')) return 'M';
  return 'L';
}

export function simulateHighPlace(candles: readonly Candle[]) {
  const days = new Map<string, Map<number, Candle>>();
  for (const candle of candles) {
    const day = dayOf(candle.time);
    const rows = days.get(day) ?? new Map<number, Candle>();
    rows.set(Date.parse(candle.time), candle);
    days.set(day, rows);
  }
  const ordered = [...days.keys()].filter((day) => day >= '2024-01-01' && day <= '2025-12-30' && ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())).sort();
  const trades: HighPlaceTrade[] = [];
  const unresolved: HighPlaceHole[] = [];
  let index = 0;
  while (index + 5 < ordered.length) {
    const signalDay = ordered[index]!;
    const pattern = place(signalDay, days.get(signalDay)!);
    if (pattern === '') {
      index += 1;
      continue;
    }
    const entryDay = ordered[index + 1]!;
    const exitDay = ordered[index + 5]!;
    const entry = days.get(entryDay)!.get(at(entryDay, '10:00'));
    const exit = days.get(exitDay)!.get(at(exitDay, '17:00'));
    if (!entry || !exit) unresolved.push({ day: entryDay, pattern });
    else {
      trades.push({
        day: entryDay,
        pattern,
        netPct: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
        stressPct: eventReturnPct(entry.open, exit.open, traderStress),
      });
    }
    index += 6;
  }
  return { trades, unresolved };
}

export function highPlacePasses(trades: readonly HighPlaceTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}
