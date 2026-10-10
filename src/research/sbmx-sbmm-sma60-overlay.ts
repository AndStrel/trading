import { costScenarios } from './trading-costs.js';
import { alignWeekdayBars } from './sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './weekly-trend.js';

export type Sleeve = 'sbmx' | 'sbmm';

function fill(open: number, side: 'buy' | 'sell', stress: boolean) {
  const costs = stress ? costScenarios.investorStress : costScenarios.investorBase;
  if (side === 'buy') return open * (1 + costs.slippage) * (1 + costs.commission);
  return open * (1 - costs.slippage) * (1 - costs.commission);
}

export function simulateSbmxSbmmSma60(input: {
  sbmx: readonly DailyBar[];
  sbmm: readonly DailyBar[];
  from: string;
  thru: string;
}) {
  if (input.from > input.thru) throw new Error('Invalid evaluation interval');
  const { left: sbmx, right: sbmm } = alignWeekdayBars(
    input.sbmx.filter((bar) => bar.day <= input.thru),
    input.sbmm.filter((bar) => bar.day <= input.thru),
  );
  const rows = sbmx.map((bar, index) => ({ day: bar.day, sbmx: bar, sbmm: sbmm[index]! }));
  let cash = 1_000_000;
  let sleeve: Sleeve | null = null;
  let units = 0;
  let switches = 0;
  let peak = 1_000_000;
  let maxDrawdownPct = 0;
  const marks: { day: string; equity: number; sleeve: Sleeve | null }[] = [];

  const openOf = (row: (typeof rows)[number], which: Sleeve) =>
    which === 'sbmx' ? row.sbmx.open : row.sbmm.open;
  const closeOf = (row: (typeof rows)[number], which: Sleeve) =>
    which === 'sbmx' ? row.sbmx.close : row.sbmm.close;

  const buy = (row: (typeof rows)[number], which: Sleeve) => {
    const price = fill(openOf(row, which), 'buy', false);
    units = cash / price;
    cash = 0;
    sleeve = which;
  };
  const sell = (row: (typeof rows)[number]) => {
    if (sleeve === null) return;
    cash += units * fill(openOf(row, sleeve), 'sell', false);
    units = 0;
    sleeve = null;
  };

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    if (row.day < input.from) continue;
    const last = index === rows.length - 1 || rows[index + 1]!.day > input.thru;
    if (last) {
      sell(row);
      marks.push({ day: row.day, equity: cash, sleeve: null });
      break;
    }
    if (sleeve === null) {
      buy(row, 'sbmm');
    } else if (index >= 60) {
      const previous = rows[index - 1]!;
      const stale = (Date.parse(row.day) - Date.parse(previous.day)) / 86_400_000 > 7;
      if (!stale) {
        const window = rows.slice(index - 60, index);
        const sma = window.reduce((sum, item) => sum + item.sbmx.close, 0) / 60;
        const want: Sleeve = previous.sbmx.close > sma ? 'sbmx' : 'sbmm';
        if (want !== sleeve) {
          sell(row);
          buy(row, want);
          switches += 1;
        }
      }
    }
    const equity = sleeve === null ? cash : units * closeOf(row, sleeve);
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100);
    marks.push({ day: row.day, equity, sleeve });
  }

  return { switches, endingLiquidationValue: cash, maxDrawdownPct, marks };
}
