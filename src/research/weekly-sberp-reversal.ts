import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

function monday(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
function dayGap(a: string, b: string): number {
  return (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000;
}
export function simulateWeeklySberpReversal(input: readonly DailyBar[], mode: 'reversal' | 'always-long') {
  const bars = input.filter((bar) => {
    const n = new Date(`${bar.day}T12:00:00Z`).getUTCDay();
    return n >= 1 && n <= 5;
  });
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
    !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  const weeks: { week: string; first: DailyBar; last: DailyBar }[] = [];
  for (const bar of bars) {
    const week = monday(bar.day);
    const latest = weeks.at(-1);
    if (latest?.week === week) latest.last = bar;
    else weeks.push({ week, first: bar, last: bar });
  }
  const trades: { entryDay: string; exitDay: string; entry: number; exit: number;
    principal: number; proceeds: number; netPct: number; stressPct: number }[] = [];
  const decisions: { day: string; previousWeekReturnPct: number | null; status: string }[] = [];
  let cash = 1_000_000;
  for (let i = 2; i < weeks.length - 1; i++) {
    const before = weeks[i - 2]!, prior = weeks[i - 1]!, current = weeks[i]!, next = weeks[i + 1]!;
    const priorReturn = (prior.last.close / before.last.close - 1) * 100;
    if (dayGap(before.first.day, prior.first.day) > 14 ||
      dayGap(prior.first.day, current.first.day) > 14) {
      decisions.push({ day: current.first.day, previousWeekReturnPct: priorReturn, status: 'stale-week' });
      continue;
    }
    if (mode === 'reversal' && priorReturn > -1.5) {
      decisions.push({ day: current.first.day, previousWeekReturnPct: priorReturn, status: 'no-signal' });
      continue;
    }
    const entry = current.first.open, exit = next.first.open, principal = cash;
    const shares = principal / (entry * (1 + costScenarios.investorBase.slippage) *
      (1 + costScenarios.investorBase.commission));
    const proceeds = shares * exit * (1 - costScenarios.investorBase.slippage) *
      (1 - costScenarios.investorBase.commission);
    trades.push({ entryDay: current.first.day, exitDay: next.first.day, entry, exit,
      principal, proceeds, netPct: (proceeds / principal - 1) * 100,
      stressPct: eventReturnPct(entry, exit, costScenarios.investorStress) });
    cash = proceeds;
    decisions.push({ day: current.first.day, previousWeekReturnPct: priorReturn, status: 'opened' });
  }
  return { trades, decisions, pending: [], endingCash: cash, endingLiquidationValue: cash };
}
