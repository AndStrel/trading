import type { DailyBar } from './weekly-trend.js';

function weekday(day: string): boolean {
  const value = new Date(`${day}T12:00:00Z`).getUTCDay();
  return value >= 1 && value <= 5;
}

export function pre2015IndexGapScenarios(sber: readonly DailyBar[], gazp: readonly DailyBar[],
  imoex: readonly DailyBar[]) {
  const expectedGap = '2008-02-25';
  const sberDays = sber.filter((bar) => weekday(bar.day)).map((bar) => bar.day);
  const sberDaySet = new Set(sberDays);
  const gazpDays = new Set(gazp.filter((bar) => weekday(bar.day)).map((bar) => bar.day));
  const indexDays = new Set(imoex.filter((bar) => weekday(bar.day)).map((bar) => bar.day));
  const missingGazp = sberDays.filter((day) => !gazpDays.has(day));
  const missingIndex = sberDays.filter((day) => !indexDays.has(day));
  if (missingGazp.length || missingIndex.length !== 1 || missingIndex[0] !== expectedGap ||
    !sberDays.includes(expectedGap)) throw new Error('Unexpected pre-2015 calendar gap');
  const previous = imoex.filter((bar) => bar.day < expectedGap).at(-1);
  if (!previous || !Number.isFinite(previous.close) || previous.close <= 0) {
    throw new Error('No prior index close for gap');
  }
  const imputed: DailyBar = { day: expectedGap, open: previous.close, close: previous.close,
    high: previous.close, low: previous.close, volume: 0 };
  const gazpAligned = gazp.filter((bar) => weekday(bar.day) && sberDaySet.has(bar.day));
  const carryForward = { sber: [...sber], gazp: gazpAligned,
    imoex: [...imoex, imputed].sort((a, b) => a.day.localeCompare(b.day)), imputedDay: expectedGap };
  const omitDay = { sber: sber.filter((bar) => bar.day !== expectedGap),
    gazp: gazpAligned.filter((bar) => bar.day !== expectedGap), imoex: [...imoex] };
  return { carryForward, omitDay };
}
