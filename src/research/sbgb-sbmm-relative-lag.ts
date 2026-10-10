import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';
import type { RelativeTrade } from './weekly-relative-strength.js';

export const sbgbSbmmBreakevenRatio =
  ((1 + costScenarios.investorBase.slippage) * (1 + costScenarios.investorBase.commission)) /
  ((1 - costScenarios.investorBase.slippage) * (1 - costScenarios.investorBase.commission));

type Position = { exitIndex: number; entryDay: string; entry: number; principal: number; shares: number };

function weekday(day: string): boolean {
  const n = new Date(`${day}T12:00:00Z`).getUTCDay();
  return n >= 1 && n <= 5;
}

function monday(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function alignWeekdayBars(left: readonly DailyBar[], right: readonly DailyBar[]): {
  left: DailyBar[];
  right: DailyBar[];
} {
  const rightByDay = new Map(right.filter((bar) => weekday(bar.day)).map((bar) => [bar.day, bar]));
  const alignedLeft: DailyBar[] = [];
  const alignedRight: DailyBar[] = [];
  for (const bar of left) {
    if (!weekday(bar.day)) continue;
    const match = rightByDay.get(bar.day);
    if (!match) continue;
    alignedLeft.push(bar);
    alignedRight.push(match);
  }
  if (alignedLeft.some((bar, index) => bar.day !== alignedRight[index]?.day)) {
    throw new Error('Aligned calendars drifted');
  }
  return { left: alignedLeft, right: alignedRight };
}

export function simulateSbgbSbmmRelativeLag(
  sbgbInput: readonly DailyBar[],
  sbmmInput: readonly DailyBar[],
  from: string,
  thru: string,
  mode: 'relative-lag' | 'relative-momentum' | 'always-long-sbgb',
) {
  if (from > thru) throw new Error('Invalid evaluation interval');
  const { left: sbgb, right: sbmm } = alignWeekdayBars(
    sbgbInput.filter((bar) => bar.day <= thru),
    sbmmInput.filter((bar) => bar.day <= thru),
  );
  if (sbgb.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || !Number.isFinite(bar.close) ||
    bar.close <= 0 || (index > 0 && bar.day <= sbgb[index - 1]!.day))) {
    throw new Error('Invalid SBGB bars');
  }
  const trades: RelativeTrade[] = [];
  const decisions: {
    day: string;
    status: string;
    sbgbRatio?: number;
    sbmmRatio?: number;
  }[] = [];
  let cash = 1_000_000;
  let positions: Position[] = [];
  let maxConcurrent = 0;
  const base = costScenarios.investorBase;
  for (let index = 0; index < sbgb.length; index++) {
    const bar = sbgb[index]!;
    const exiting = positions.filter((position) => position.exitIndex === index);
    positions = positions.filter((position) => position.exitIndex !== index);
    for (const position of exiting) {
      const proceeds = position.shares * bar.open * (1 - base.slippage) * (1 - base.commission);
      cash += proceeds;
      trades.push({
        entryDay: position.entryDay,
        exitDay: bar.day,
        entry: position.entry,
        exit: bar.open,
        principal: position.principal,
        proceeds,
        netPct: (proceeds / position.principal - 1) * 100,
        stressPct: eventReturnPct(position.entry, bar.open, costScenarios.investorStress),
      });
    }
    if (bar.day < from || (index > 0 && monday(bar.day) === monday(sbgb[index - 1]!.day))) continue;
    if (index < 21) {
      decisions.push({ day: bar.day, status: 'warmup' });
      continue;
    }
    const priorSbgb = sbgb[index - 1]!;
    const laggedSbgb = sbgb[index - 21]!;
    const priorSbmm = sbmm[index - 1]!;
    const laggedSbmm = sbmm[index - 21]!;
    if ((Date.parse(bar.day) - Date.parse(priorSbgb.day)) / 86_400_000 > 7) {
      decisions.push({ day: bar.day, status: 'stale-history' });
      continue;
    }
    const sbgbRatio = priorSbgb.close / laggedSbgb.close;
    const sbmmRatio = priorSbmm.close / laggedSbmm.close;
    const common = { day: bar.day, sbgbRatio, sbmmRatio };
    if (mode === 'relative-lag' && sbgbRatio * sbgbSbmmBreakevenRatio >= sbmmRatio) {
      decisions.push({ ...common, status: 'no-signal' });
      continue;
    }
    if (mode === 'relative-momentum' && sbgbRatio <= sbmmRatio * sbgbSbmmBreakevenRatio) {
      decisions.push({ ...common, status: 'no-signal' });
      continue;
    }
    if (positions.length >= 5) {
      decisions.push({ ...common, status: 'capacity-skip' });
      continue;
    }
    const equity = cash + positions.reduce(
      (sum, position) => sum + position.shares * bar.open * (1 - base.slippage) * (1 - base.commission),
      0,
    );
    const principal = Math.min(cash, equity / 5);
    if (principal < 1) {
      decisions.push({ ...common, status: 'cash-skip' });
      continue;
    }
    cash -= principal;
    positions.push({
      exitIndex: index + 20,
      entryDay: bar.day,
      entry: bar.open,
      principal,
      shares: principal / (bar.open * (1 + base.slippage) * (1 + base.commission)),
    });
    maxConcurrent = Math.max(maxConcurrent, positions.length);
    decisions.push({ ...common, status: 'opened' });
  }
  const last = sbgb.at(-1);
  return {
    trades,
    decisions,
    maxConcurrent,
    endingCash: cash,
    pending: positions.map(({ exitIndex: unused, ...position }) => position),
    endingLiquidationValue:
      last === undefined
        ? cash
        : cash +
          positions.reduce(
            (sum, position) => sum + position.shares * last.close * (1 - base.slippage) * (1 - base.commission),
            0,
          ),
  };
}
