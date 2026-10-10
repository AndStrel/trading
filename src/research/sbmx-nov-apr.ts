import { costScenarios, eventReturnPct } from './trading-costs.js';
import { buyAndHoldLqdt } from './weekly-lqdt-carry.js';
import type { DailyBar } from './weekly-trend.js';

function weekday(day: string): boolean {
  const n = new Date(`${day}T12:00:00Z`).getUTCDay();
  return n >= 1 && n <= 5;
}

function weekdayBars(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => weekday(bar.day));
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) {
    throw new Error('Invalid daily bars');
  }
  return bars;
}

function firstOnOrAfter(bars: readonly DailyBar[], day: string): DailyBar | undefined {
  return bars.find((bar) => bar.day >= day);
}

export type WinterTrade = {
  entryYear: number;
  status: 'trade' | 'unresolved';
  entryDay?: string;
  exitDay?: string;
  sbmxNetPct?: number;
  sbmxStressPct?: number;
  sbmmNetPct?: number;
  excessPct?: number;
};

export function simulateSbmxNovApr(
  sbmxInput: readonly DailyBar[],
  sbmmInput: readonly DailyBar[],
  entryYears: readonly number[],
) {
  const sbmx = weekdayBars(sbmxInput);
  const sbmm = weekdayBars(sbmmInput);
  const costs = costScenarios.investorBase;
  const winters: WinterTrade[] = [];
  let cash = 1_000_000;
  for (const year of entryYears) {
    if (!Number.isInteger(year) || year < 2021 || year > 2024) throw new Error('Invalid entry year');
    const entry = firstOnOrAfter(sbmx, `${year}-11-01`);
    const exit = firstOnOrAfter(sbmx, `${year + 1}-05-01`);
    const sbmmEntry = entry ? sbmm.find((bar) => bar.day === entry.day) : undefined;
    const sbmmExit = exit ? sbmm.find((bar) => bar.day === exit.day) : undefined;
    if (!entry || !exit || !sbmmEntry || !sbmmExit) {
      winters.push({
        entryYear: year,
        status: 'unresolved',
        ...(entry ? { entryDay: entry.day } : {}),
        ...(exit ? { exitDay: exit.day } : {}),
      });
      continue;
    }
    const sbmxNetPct = eventReturnPct(entry.open, exit.open, costs);
    const sbmmNetPct = eventReturnPct(sbmmEntry.open, sbmmExit.open, costs);
    const proceeds = cash * (1 + sbmxNetPct / 100);
    winters.push({
      entryYear: year,
      status: 'trade',
      entryDay: entry.day,
      exitDay: exit.day,
      sbmxNetPct,
      sbmxStressPct: eventReturnPct(entry.open, exit.open, costScenarios.investorStress),
      sbmmNetPct,
      excessPct: sbmxNetPct - sbmmNetPct,
    });
    cash = proceeds;
  }
  const trades = winters.filter((winter) => winter.status === 'trade');
  const first = trades[0];
  const last = trades.at(-1);
  const holdFrom = first?.entryDay;
  const holdThru = last?.exitDay;
  return {
    winters,
    trades,
    endingLiquidationValue: cash,
    sbmxHold: holdFrom && holdThru ? buyAndHoldLqdt(sbmx, holdFrom, holdThru).endingLiquidationValue : null,
    sbmmHold: holdFrom && holdThru ? buyAndHoldLqdt(sbmm, holdFrom, holdThru).endingLiquidationValue : null,
  };
}
