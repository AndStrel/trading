import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

export type FlowKind = 'expiration' | 'turn-of-month' | 'non-quarter-second-thursday';
export type FlowTrade = {
  kind: FlowKind;
  anchorDay: string;
  year: number;
  status: 'trade' | 'unresolved';
  entryDay?: string;
  exitDay?: string;
  sbmxNetPct?: number;
  sbmxStressPct?: number;
  sbmmNetPct?: number;
  excessPct?: number;
};

const sampleFrom = '2021-10-05';
const sampleThru = '2025-12-30';

function weekday(day: string): boolean {
  const n = new Date(`${day}T12:00:00Z`).getUTCDay();
  return n >= 1 && n <= 5;
}

export function thirdThursday(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Invalid calendar month');
  }
  const date = new Date(Date.UTC(year, month - 1, 1));
  while (date.getUTCDay() !== 4) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
}

export function secondThursday(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  while (date.getUTCDay() !== 4) date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

function sharedBars(sbmxInput: readonly DailyBar[], sbmmInput: readonly DailyBar[]): DailyBar[] {
  const sbmmDays = new Set(sbmmInput.filter((bar) => weekday(bar.day)).map((bar) => bar.day));
  const bars = sbmxInput.filter((bar) => weekday(bar.day) && bar.day >= sampleFrom && bar.day <= sampleThru && sbmmDays.has(bar.day));
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || (index > 0 && bar.day <= bars[index - 1]!.day))) {
    throw new Error('Invalid SBMX bars');
  }
  return bars;
}

function sbmmOn(input: readonly DailyBar[]): Map<string, DailyBar> {
  const map = new Map<string, DailyBar>();
  for (const bar of input) {
    if (!weekday(bar.day) || bar.day < sampleFrom || bar.day > sampleThru) continue;
    if (!Number.isFinite(bar.open) || bar.open <= 0) throw new Error('Invalid SBMM bar');
    map.set(bar.day, bar);
  }
  return map;
}

function tradeAt(
  kind: FlowKind,
  anchorDay: string,
  year: number,
  sbmx: readonly DailyBar[],
  sbmm: Map<string, DailyBar>,
  anchorIndex: number,
): FlowTrade {
  const entry = sbmx[anchorIndex - 2];
  const exit = sbmx[anchorIndex + 1];
  const sbmmEntry = entry ? sbmm.get(entry.day) : undefined;
  const sbmmExit = exit ? sbmm.get(exit.day) : undefined;
  if (anchorIndex < 2 || !entry || !exit || !sbmmEntry || !sbmmExit) {
    return { kind, anchorDay, year, status: 'unresolved', ...(entry ? { entryDay: entry.day } : {}), ...(exit ? { exitDay: exit.day } : {}) };
  }
  const costs = costScenarios.investorBase;
  const sbmxNetPct = eventReturnPct(entry.open, exit.open, costs);
  const sbmmNetPct = eventReturnPct(sbmmEntry.open, sbmmExit.open, costs);
  return {
    kind,
    anchorDay,
    year,
    status: 'trade',
    entryDay: entry.day,
    exitDay: exit.day,
    sbmxNetPct,
    sbmxStressPct: eventReturnPct(entry.open, exit.open, costScenarios.investorStress),
    sbmmNetPct,
    excessPct: sbmxNetPct - sbmmNetPct,
  };
}

function anchored(
  kind: FlowKind,
  anchors: readonly string[],
  sbmx: readonly DailyBar[],
  sbmm: Map<string, DailyBar>,
): FlowTrade[] {
  return anchors.map((anchorDay) => {
    const anchorIndex = sbmx.findIndex((bar) => bar.day === anchorDay);
    const year = Number(anchorDay.slice(0, 4));
    if (anchorIndex < 0) return { kind, anchorDay, year, status: 'unresolved' as const };
    return tradeAt(kind, anchorDay, year, sbmx, sbmm, anchorIndex);
  });
}

export function simulateStructuralFlows(sbmxInput: readonly DailyBar[], sbmmInput: readonly DailyBar[]) {
  const sbmx = sharedBars(sbmxInput, sbmmInput);
  const sbmm = sbmmOn(sbmmInput);
  const expirationAnchors: string[] = [];
  const controlAnchors: string[] = [];
  for (let year = 2021; year <= 2025; year += 1) {
    for (const month of [3, 6, 9, 12]) expirationAnchors.push(thirdThursday(year, month));
    for (let month = 1; month <= 12; month += 1) {
      if (month % 3 !== 0) controlAnchors.push(secondThursday(year, month));
    }
  }
  const expiration = anchored('expiration', expirationAnchors.filter((day) => day >= sampleFrom && day <= sampleThru), sbmx, sbmm);
  const control = anchored('non-quarter-second-thursday', controlAnchors.filter((day) => day >= sampleFrom && day <= sampleThru), sbmx, sbmm);
  const turnOfMonth: FlowTrade[] = [];
  for (let year = 2021; year <= 2025; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const prefix = `${year}-${String(month).padStart(2, '0')}`;
      const anchorDay = `${prefix}-01`;
      if (anchorDay > sampleThru || `${prefix}-28` < sampleFrom) continue;
      const entryIndex = sbmx.findIndex((bar) => bar.day >= anchorDay && bar.day.startsWith(prefix));
      if (entryIndex < 0) {
        turnOfMonth.push({ kind: 'turn-of-month', anchorDay, year, status: 'unresolved' });
        continue;
      }
      const entry = sbmx[entryIndex]!;
      const exit = sbmx[entryIndex + 3];
      const sbmmEntry = sbmm.get(entry.day);
      const sbmmExit = exit ? sbmm.get(exit.day) : undefined;
      if (!exit || !sbmmEntry || !sbmmExit || exit.day > sampleThru) {
        turnOfMonth.push({ kind: 'turn-of-month', anchorDay, year, status: 'unresolved', entryDay: entry.day, ...(exit ? { exitDay: exit.day } : {}) });
        continue;
      }
      const sbmxNetPct = eventReturnPct(entry.open, exit.open, costScenarios.investorBase);
      const sbmmNetPct = eventReturnPct(sbmmEntry.open, sbmmExit.open, costScenarios.investorBase);
      turnOfMonth.push({
        kind: 'turn-of-month',
        anchorDay,
        year,
        status: 'trade',
        entryDay: entry.day,
        exitDay: exit.day,
        sbmxNetPct,
        sbmxStressPct: eventReturnPct(entry.open, exit.open, costScenarios.investorStress),
        sbmmNetPct,
        excessPct: sbmxNetPct - sbmmNetPct,
      });
    }
  }
  return { expiration, turnOfMonth, control };
}

export function flowGateReasons(trades: readonly FlowTrade[], minTrades: number): string[] {
  const reasons: string[] = [];
  const completed = trades.filter((trade) => trade.status === 'trade');
  if (completed.length < minTrades) reasons.push('too-few-trades');
  const periodFails = (from: number, thru: number, label: string) => {
    const period = completed.filter((trade) => trade.year >= from && trade.year <= thru);
    if (period.length < 4) reasons.push(`too-few-${label}`);
    const meanNet = mean(period.map((trade) => trade.sbmxNetPct!));
    const meanExcess = mean(period.map((trade) => trade.excessPct!));
    if (meanNet === null || meanNet <= 0 || meanExcess === null || meanExcess <= 0) reasons.push(`failed-${label}-mean`);
  };
  periodFails(2021, 2023, 'discovery');
  periodFails(2024, 2025, 'validation');
  const nets = completed.map((trade) => trade.sbmxNetPct!);
  const winners = nets.filter((value) => value > 0).length;
  if (completed.length === 0 || winners / completed.length < 0.51) reasons.push('failed-win-rate');
  const meanNet = mean(nets);
  const meanStress = mean(completed.map((trade) => trade.sbmxStressPct!));
  const meanExcess = mean(completed.map((trade) => trade.excessPct!));
  if (meanNet === null || meanNet <= 0 || meanStress === null || meanStress <= 0 || meanExcess === null || meanExcess <= 0) {
    reasons.push('failed-combined-mean');
  }
  const gains = nets.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = nets.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0);
  const profitFactorPasses = losses === 0 ? gains > 0 && winners === completed.length : gains / losses > 1;
  if (!profitFactorPasses) reasons.push('failed-profit-factor');
  if (completed.length < 4) reasons.push('too-few-for-leave-best-three');
  else {
    const trimmed = [...nets].sort((a, b) => b - a).slice(3);
    if (trimmed.reduce((sum, value) => sum + value, 0) <= 0) reasons.push('failed-without-best-three');
  }
  return reasons;
}

export function controlBlocksSpecificity(reasons: readonly string[]): boolean {
  if (reasons.includes('too-few-trades') || reasons.includes('too-few-discovery') || reasons.includes('too-few-validation')) return true;
  const meansFailed = reasons.includes('failed-discovery-mean') || reasons.includes('failed-validation-mean') || reasons.includes('failed-combined-mean');
  return !meansFailed;
}

function mean(values: number[]): number | null {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
