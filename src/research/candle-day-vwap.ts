import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };
export type DayVwapTrade = { day: string; pattern: 'U' | 'D'; netPct: number; stressPct: number };
export type DayVwapHole = { day: string; pattern: 'U' | 'D' };

function at(day: string, hhmm: string): number {
  return Date.parse(`${day}T${hhmm}:00+03:00`);
}

function dayOf(time: string): string {
  return new Date(Date.parse(time) + 10_800_000).toISOString().slice(0, 10);
}

function side(day: string, rows: Map<number, Candle>): 'U' | 'D' | '' {
  const end = rows.get(at(day, '16:59'));
  const window = [...rows.values()].filter((candle) => {
    const time = Date.parse(candle.time);
    return time >= at(day, '10:00') && time <= at(day, '16:59');
  });
  if (!end || window.length === 0) return '';
  let weighted = 0;
  let volume = 0;
  for (const candle of window) {
    if (!Number.isFinite(candle.volume) || candle.volume < 0 || !Number.isFinite(candle.high) || !Number.isFinite(candle.low) || !Number.isFinite(candle.close)) {
      throw new Error('Invalid minute candle');
    }
    weighted += ((candle.high + candle.low + candle.close) / 3) * candle.volume;
    volume += candle.volume;
  }
  if (volume === 0) return '';
  const vwap = weighted / volume;
  if (end.close === vwap) return '';
  return end.close > vwap ? 'U' : 'D';
}

export function simulateDayVwap(candles: readonly Candle[]) {
  const days = new Map<string, Map<number, Candle>>();
  for (const candle of candles) {
    const day = dayOf(candle.time);
    const rows = days.get(day) ?? new Map<number, Candle>();
    rows.set(Date.parse(candle.time), candle);
    days.set(day, rows);
  }
  const ordered = [...days.keys()].filter((day) => day >= '2024-01-01' && day <= '2025-12-30' && ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())).sort();
  const trades: DayVwapTrade[] = [];
  const unresolved: DayVwapHole[] = [];
  let index = 0;
  while (index + 5 < ordered.length) {
    const signalDay = ordered[index]!;
    const pattern = side(signalDay, days.get(signalDay)!);
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

export function dayVwapPasses(trades: readonly DayVwapTrade[], requireStress: boolean): boolean {
  if (trades.length < 8) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}
