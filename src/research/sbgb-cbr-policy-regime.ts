import { costScenarios } from './trading-costs.js';
import { classifyScheduledCut, type CbrRatePoint } from './sbgb-after-cbr-cut.js';
import { alignWeekdayBars } from './sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './weekly-trend.js';

export type Sleeve = 'sbgb' | 'sbmm';

function fill(open: number, side: 'buy' | 'sell', stress: boolean) {
  const costs = stress ? costScenarios.investorStress : costScenarios.investorBase;
  if (side === 'buy') return open * (1 + costs.slippage) * (1 + costs.commission);
  return open * (1 - costs.slippage) * (1 - costs.commission);
}

export function simulateSbgbCbrPolicyRegime(input: {
  sbgb: readonly DailyBar[];
  sbmm: readonly DailyBar[];
  rates: readonly CbrRatePoint[];
  scheduled: readonly string[];
  unscheduled: readonly string[];
  from: string;
  thru: string;
}) {
  if (input.from > input.thru) throw new Error('Invalid evaluation interval');
  const { left: sbgb, right: sbmm } = alignWeekdayBars(
    input.sbgb.filter((bar) => bar.day <= input.thru),
    input.sbmm.filter((bar) => bar.day <= input.thru),
  );
  const bars = sbgb.map((bar, index) => ({ day: bar.day, sbgb: bar, sbmm: sbmm[index]! }));
  const execute = new Map<string, Sleeve>();
  const consider = (day: string, target: Sleeve) => {
    if (day < input.from || day > input.thru) return;
    const next = bars.find((bar) => bar.day > day);
    if (next && next.day <= input.thru) execute.set(next.day, target);
  };
  for (const day of input.scheduled) {
    const move = classifyScheduledCut(input.rates, day);
    if (move === 'cut') consider(day, 'sbgb');
    else if (move === 'hike') consider(day, 'sbmm');
  }
  for (const day of input.unscheduled) consider(day, 'sbmm');

  let cash = 1_000_000;
  let sleeve: Sleeve | null = null;
  let units = 0;
  let switches = 0;
  let peak = 1_000_000;
  let maxDrawdownPct = 0;
  const marks: { day: string; equity: number; sleeve: Sleeve | null }[] = [];

  const openOf = (row: (typeof bars)[number], which: Sleeve) =>
    which === 'sbgb' ? row.sbgb.open : row.sbmm.open;
  const closeOf = (row: (typeof bars)[number], which: Sleeve) =>
    which === 'sbgb' ? row.sbgb.close : row.sbmm.close;

  const buy = (row: (typeof bars)[number], which: Sleeve, stress: boolean) => {
    const price = fill(openOf(row, which), 'buy', stress);
    units = cash / price;
    cash = 0;
    sleeve = which;
  };
  const sell = (row: (typeof bars)[number], stress: boolean) => {
    if (sleeve === null) return;
    cash += units * fill(openOf(row, sleeve), 'sell', stress);
    units = 0;
    sleeve = null;
  };

  for (let index = 0; index < bars.length; index++) {
    const row = bars[index]!;
    if (row.day < input.from) continue;
    const last = index === bars.length - 1 || bars[index + 1]!.day > input.thru;
    if (last) {
      sell(row, false);
      marks.push({ day: row.day, equity: cash, sleeve: null });
      break;
    }
    if (sleeve === null) {
      buy(row, 'sbmm', false);
    } else {
      const target = execute.get(row.day);
      if (target !== undefined && target !== sleeve) {
        sell(row, false);
        buy(row, target, false);
        switches += 1;
      }
    }
    const equity = sleeve === null ? cash : units * closeOf(row, sleeve);
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100);
    marks.push({ day: row.day, equity, sleeve });
  }

  return {
    switches,
    endingLiquidationValue: cash,
    maxDrawdownPct,
    marks,
  };
}
