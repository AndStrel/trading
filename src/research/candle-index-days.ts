import { costScenarios, eventReturnPct, type Costs } from './trading-costs.js';
import { weekMonday } from './candle-week.js';
import type { PatternTrade } from './candle-pattern.js';
import type { DailyBar } from './weekly-trend.js';

const traderStress: Costs = { commission: 0.0005, slippage: 0.001 };

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function sign(open: number, close: number): 'U' | 'D' | null {
  if (close === open) return null;
  return close > open ? 'U' : 'D';
}

type Week = { monday: string; open: number; close: number; rows: DailyBar[] };

function weeksOf(input: readonly DailyBar[]): Map<string, Week> {
  const bars = input.filter((bar) => bar.day <= '2025-12-30');
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const groups = new Map<string, DailyBar[]>();
  for (const bar of bars) groups.set(weekMonday(bar.day), [...(groups.get(weekMonday(bar.day)) ?? []), bar]);
  return new Map([...groups.entries()].map(([monday, rows]) => [monday, {
    monday,
    open: rows[0]!.open,
    close: rows.at(-1)!.close,
    rows,
  }]));
}

export function simulateIndexDays(index: readonly DailyBar[], target: readonly DailyBar[]): PatternTrade[] {
  const indexWeeks = weeksOf(index);
  const nameWeeks = weeksOf(target);
  const trades: PatternTrade[] = [];
  for (const week of nameWeeks.values()) {
    if (week.monday < '2024-01-01' || week.monday > '2025-12-31') continue;
    const signal = nameWeeks.get(addDays(week.monday, -7));
    const indexWeek = indexWeeks.get(addDays(week.monday, -7));
    if (!signal || !indexWeek) continue;
    const indexByDay = new Map(indexWeek.rows.map((row) => [row.day, row]));
    let agree = 0;
    let compared = 0;
    for (const row of signal.rows) {
      const other = indexByDay.get(row.day);
      const left = sign(row.open, row.close);
      const right = other ? sign(other.open, other.close) : null;
      if (!left || !right) continue;
      compared += 1;
      if (left === right) agree += 1;
    }
    if (compared === 0 || agree / compared === 0.5) continue;
    trades.push({
      day: week.monday,
      pattern: agree / compared > 0.5 ? 'H' : 'L',
      netPct: eventReturnPct(week.open, week.close, costScenarios.traderBeforeSubscription),
      stressPct: eventReturnPct(week.open, week.close, traderStress),
    });
  }
  return trades;
}

export function indexDaysPasses(trades: readonly PatternTrade[], requireStress: boolean): boolean {
  if (trades.length < 20) return false;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const nets = trades.map((trade) => trade.netPct);
  const withoutBest = [...nets].sort((left, right) => right - left).slice(1).reduce((sum, value) => sum + value, 0);
  const winners = nets.filter((value) => value > 0).length;
  const stress = mean(trades.map((trade) => trade.stressPct));
  return winners / nets.length >= 0.51 && mean(nets) > 0 && withoutBest > 0 && (!requireStress || stress > 0);
}
