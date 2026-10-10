import { costScenarios } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

export type PortfolioTrade = { entryDay: string; exitDay: string; entry: number;
  principal: number; proceeds: number };
export type PendingPortfolioTrade = { entryDay: string; entry: number;
  principal: number; shares: number };
type Position = { id: number; shares: number };

function weekday(day: string): boolean {
  const n = new Date(`${day}T12:00:00Z`).getUTCDay();
  return n >= 1 && n <= 5;
}

function weekMonday(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function auditWeeklyPortfolio(input: readonly DailyBar[], trades: readonly PortfolioTrade[],
  pending: readonly PendingPortfolioTrade[], expectedEndingCash: number) {
  const bars = input.filter((bar) => weekday(bar.day));
  if (bars.some((bar, index) => !Number.isFinite(bar.close) || bar.close <= 0 ||
    (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily source');
  const dates = new Set(bars.map((bar) => bar.day));
  const entries = new Map<string, { id: number; shares: number; principal: number }[]>();
  const exits = new Map<string, { id: number; proceeds: number }[]>();
  const all = [
    ...trades.map((trade) => ({ ...trade, pending: false as const })),
    ...pending.map((trade) => ({ ...trade, pending: true as const })),
  ];
  all.forEach((trade, id) => {
    if (!dates.has(trade.entryDay) || !Number.isFinite(trade.entry) || trade.entry <= 0 ||
      !Number.isFinite(trade.principal) || trade.principal <= 0) throw new Error('Invalid portfolio entry');
    const shares = trade.pending ? trade.shares : trade.principal /
      (trade.entry * (1 + costScenarios.investorBase.slippage) *
        (1 + costScenarios.investorBase.commission));
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('Invalid share count');
    entries.set(trade.entryDay, [...(entries.get(trade.entryDay) ?? []), { id, shares,
      principal: trade.principal }]);
    if (!trade.pending) {
      if (!dates.has(trade.exitDay) || trade.exitDay <= trade.entryDay ||
        !Number.isFinite(trade.proceeds) || trade.proceeds < 0) throw new Error('Invalid portfolio exit');
      exits.set(trade.exitDay, [...(exits.get(trade.exitDay) ?? []), { id, proceeds: trade.proceeds }]);
    }
  });
  const positions = new Map<number, Position>();
  const daily: { day: string; equity: number; cash: number; openPositions: number;
    drawdownPct: number; active: boolean }[] = [];
  let cash = 1_000_000, peak = cash, maxDrawdownPct = 0;
  let peakDay = bars[0]?.day ?? null, drawdownPeakDay: string | null = null;
  let troughDay: string | null = null;
  for (const bar of bars) {
    const dayExits = exits.get(bar.day) ?? [], dayEntries = entries.get(bar.day) ?? [];
    const active = positions.size > 0 || dayExits.length > 0 || dayEntries.length > 0;
    for (const exit of dayExits) {
      if (!positions.delete(exit.id)) throw new Error('Exit without open position');
      cash += exit.proceeds;
    }
    for (const entry of dayEntries) {
      if (positions.has(entry.id)) throw new Error('Duplicate portfolio entry');
      cash -= entry.principal;
      if (cash < -0.01) throw new Error('Portfolio spent more than available cash');
      positions.set(entry.id, { id: entry.id, shares: entry.shares });
    }
    const equity = cash + [...positions.values()].reduce((total, position) =>
      total + position.shares * bar.close * (1 - costScenarios.investorBase.slippage) *
        (1 - costScenarios.investorBase.commission), 0);
    if (equity > peak) { peak = equity; peakDay = bar.day; }
    const drawdownPct = (equity / peak - 1) * 100;
    if (drawdownPct < maxDrawdownPct) {
      maxDrawdownPct = drawdownPct;
      drawdownPeakDay = peakDay;
      troughDay = bar.day;
    }
    daily.push({ day: bar.day, equity, cash, openPositions: positions.size, drawdownPct, active });
  }
  if (Math.abs(cash - expectedEndingCash) > 0.01 || positions.size !== pending.length) {
    throw new Error('Reconstructed portfolio does not match source ledger');
  }
  const weeks: { week: string; lastDay: string; equity: number; returnPct: number; active: boolean }[] = [];
  let currentWeek: string | null = null, last: typeof daily[number] | null = null;
  let weekActive = false, previousEquity = 1_000_000;
  const finalize = () => {
    if (currentWeek === null || last === null) return;
    weeks.push({ week: currentWeek, lastDay: last.day, equity: last.equity,
      returnPct: (last.equity / previousEquity - 1) * 100, active: weekActive });
    previousEquity = last.equity;
  };
  for (const day of daily) {
    const week = weekMonday(day.day);
    if (week !== currentWeek) {
      finalize();
      currentWeek = week;
      weekActive = false;
    }
    last = day;
    weekActive ||= day.active;
  }
  finalize();
  const activeWeeks = weeks.filter((week) => week.active);
  const positiveActiveWeeks = activeWeeks.filter((week) => week.returnPct > 0).length;
  const yearEnds = new Map<number, number>();
  for (const week of weeks) yearEnds.set(Number(week.lastDay.slice(0, 4)), week.equity);
  const byYear = [...yearEnds].map(([year, endingEquity], index, entries) => {
    const prior = index > 0 ? entries[index - 1]![1] : 1_000_000;
    const yearWeeks = activeWeeks.filter((week) => Number(week.lastDay.slice(0, 4)) === year);
    return { year, endingEquity, returnPct: (endingEquity / prior - 1) * 100,
      activeWeeks: yearWeeks.length, positiveActiveWeeks: yearWeeks.filter((week) => week.returnPct > 0).length };
  });
  return { daily, weeks, endingCash: cash, endingCloseLiquidationValue: daily.at(-1)?.equity ?? cash,
    maxDrawdownPct, drawdownPeakDay, troughDay, activeWeeks: activeWeeks.length,
    positiveActiveWeeks, activeWeekWinRate: activeWeeks.length ? positiveActiveWeeks / activeWeeks.length : null,
    allObservedWeeks: weeks.length, worstFiveActiveWeeks: [...activeWeeks].sort((a, b) => a.returnPct - b.returnPct).slice(0, 5),
    byYear };
}
