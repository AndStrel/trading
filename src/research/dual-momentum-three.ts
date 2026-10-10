import { costScenarios } from './trading-costs.js';
import { alignWeekdayBars } from './sbgb-sbmm-relative-lag.js';
import type { DailyBar } from './weekly-trend.js';

export type DualSleeve = 'sbmx' | 'tgld' | 'sbmm';

function fill(open: number, side: 'buy' | 'sell') {
  const costs = costScenarios.investorBase;
  if (side === 'buy') return open * (1 + costs.slippage) * (1 + costs.commission);
  return open * (1 - costs.slippage) * (1 - costs.commission);
}

export function alignThree(
  sbmx: readonly DailyBar[],
  tgld: readonly DailyBar[],
  sbmm: readonly DailyBar[],
) {
  const ab = alignWeekdayBars(sbmx, tgld);
  const ac = alignWeekdayBars(ab.left, sbmm);
  const tgldByDay = new Map(ab.right.map((bar) => [bar.day, bar]));
  const tgldAligned = ac.left.map((bar) => {
    const match = tgldByDay.get(bar.day);
    if (!match) throw new Error('TGLD calendar drifted');
    return match;
  });
  return { sbmx: ac.left, tgld: tgldAligned, sbmm: ac.right };
}

function openOf(row: { sbmx: DailyBar; tgld: DailyBar; sbmm: DailyBar }, sleeve: DualSleeve) {
  return row[sleeve].open;
}
function closeOf(row: { sbmx: DailyBar; tgld: DailyBar; sbmm: DailyBar }, sleeve: DualSleeve) {
  return row[sleeve].close;
}

export function simulateDualMomentumThree(input: {
  sbmx: readonly DailyBar[];
  tgld: readonly DailyBar[];
  sbmm: readonly DailyBar[];
  from: string;
  thru: string;
}) {
  if (input.from > input.thru) throw new Error('Invalid evaluation interval');
  const aligned = alignThree(
    input.sbmx.filter((bar) => bar.day <= input.thru),
    input.tgld.filter((bar) => bar.day <= input.thru),
    input.sbmm.filter((bar) => bar.day <= input.thru),
  );
  const rows = aligned.sbmx.map((bar, index) => ({
    day: bar.day,
    sbmx: bar,
    tgld: aligned.tgld[index]!,
    sbmm: aligned.sbmm[index]!,
  }));
  let cash = 1_000_000;
  let sleeve: DualSleeve | null = null;
  let units = 0;
  let switches = 0;
  let peak = 1_000_000;
  let maxDrawdownPct = 0;
  const marks: { day: string; equity: number; sleeve: DualSleeve | null }[] = [];

  const buy = (row: (typeof rows)[number], which: DualSleeve) => {
    units = cash / fill(openOf(row, which), 'buy');
    cash = 0;
    sleeve = which;
  };
  const sell = (row: (typeof rows)[number]) => {
    if (sleeve === null) return;
    cash += units * fill(openOf(row, sleeve), 'sell');
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
    const monthStart = index === 0 || row.day.slice(0, 7) !== rows[index - 1]!.day.slice(0, 7);
    if (sleeve === null) {
      if (monthStart && index >= 121) buy(row, 'sbmm');
    } else if (monthStart && index >= 121) {
      const previous = rows[index - 1]!;
      const stale = (Date.parse(row.day) - Date.parse(previous.day)) / 86_400_000 > 7;
      if (!stale) {
        const lagged = rows[index - 121]!;
        const ret = (which: DualSleeve) => closeOf(previous, which) / closeOf(lagged, which) - 1;
        const ranked: DualSleeve[] = ['sbmx', 'tgld', 'sbmm'];
        const winner = ranked.reduce((best, which) => (ret(which) > ret(best) ? which : best));
        const want: DualSleeve = ret(winner) > 0 ? winner : 'sbmm';
        if (want !== sleeve) {
          sell(row);
          buy(row, want);
          switches += 1;
        }
      }
    }
    if (sleeve === null) continue;
    const equity = units * closeOf(row, sleeve);
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.min(maxDrawdownPct, (equity / peak - 1) * 100);
    marks.push({ day: row.day, equity, sleeve });
  }

  const firstSignal = marks.find((mark) => mark.sleeve !== null);
  return {
    switches,
    endingLiquidationValue: cash,
    maxDrawdownPct,
    firstSignalDay: firstSignal?.day ?? null,
    marks,
  };
}
