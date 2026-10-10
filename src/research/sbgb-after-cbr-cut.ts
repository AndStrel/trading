import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';

export type CbrRatePoint = { day: string; rate: number };
export type CbrMove = 'cut' | 'hike' | 'hold';

function weekday(day: string): boolean {
  const n = new Date(`${day}T12:00:00Z`).getUTCDay();
  return n >= 1 && n <= 5;
}

export function parseCbrKeyrateTable(markdownOrHtml: string): CbrRatePoint[] {
  const rows: CbrRatePoint[] = [];
  const pattern = /(\d{2})\.(\d{2})\.(\d{4})\D+(\d+),(\d{2})/g;
  for (const match of markdownOrHtml.matchAll(pattern)) {
    const day = `${match[3]}-${match[2]}-${match[1]}`;
    const rate = Number(`${match[4]}.${match[5]}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('Invalid CBR key-rate row');
    }
    rows.push({ day, rate });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.day <= rows[i - 1]!.day) throw new Error('Duplicate or unsorted CBR key-rate day');
  }
  if (rows.length < 2000) throw new Error(`CBR key-rate series too short: ${rows.length}`);
  return rows;
}

export function classifyScheduledCut(rates: readonly CbrRatePoint[], decisionDay: string): CbrMove | 'unresolved' {
  const ordered = [...rates].sort((a, b) => a.day.localeCompare(b.day));
  const onDay = ordered.find((row) => row.day === decisionDay);
  const after = ordered.find((row) => row.day > decisionDay);
  if (!onDay || !after) return 'unresolved';
  if (after.rate < onDay.rate) return 'cut';
  if (after.rate > onDay.rate) return 'hike';
  return 'hold';
}

function weekdayBars(input: readonly DailyBar[]): DailyBar[] {
  const bars = input.filter((bar) => weekday(bar.day));
  if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 || (index > 0 && bar.day <= bars[index - 1]!.day))) {
    throw new Error('Invalid daily bars');
  }
  return bars;
}

function sessionAfter(bars: readonly DailyBar[], day: string): DailyBar | undefined {
  return bars.find((bar) => bar.day > day);
}

function sessionPlus(bars: readonly DailyBar[], entryDay: string, holdSessions: number): DailyBar | undefined {
  const index = bars.findIndex((bar) => bar.day === entryDay);
  if (index < 0) return undefined;
  return bars[index + holdSessions];
}

export type CutEventResult = {
  decisionDay: string;
  move: CbrMove | 'unresolved';
  status: 'trade' | 'cash' | 'unresolved' | 'skipped-open';
  entryDay?: string;
  exitDay?: string;
  sbgbNetPct?: number;
  sbgbStressPct?: number;
  sbmmNetPct?: number;
  excessPct?: number;
};

export function simulateSbgbAfterCbrCut(input: {
  rates: readonly CbrRatePoint[];
  decisions: readonly string[];
  sbgb: readonly DailyBar[];
  sbmm: readonly DailyBar[];
  from: string;
  thru: string;
  requiredMove?: CbrMove;
}): CutEventResult[] {
  const requiredMove = input.requiredMove ?? 'cut';
  const sbgb = weekdayBars(input.sbgb);
  const sbmm = weekdayBars(input.sbmm);
  const costs = costScenarios.investorBase;
  const out: CutEventResult[] = [];
  let openUntil: string | null = null;
  for (const decisionDay of input.decisions) {
    if (decisionDay < input.from || decisionDay > input.thru) continue;
    const move = classifyScheduledCut(input.rates, decisionDay);
    if (move !== requiredMove) {
      out.push({ decisionDay, move, status: move === 'unresolved' ? 'unresolved' : 'cash' });
      continue;
    }
    if (openUntil && decisionDay <= openUntil) {
      out.push({ decisionDay, move, status: 'skipped-open' });
      continue;
    }
    const entry = sessionAfter(sbgb, decisionDay);
    if (!entry || entry.day > input.thru) {
      out.push({ decisionDay, move, status: 'unresolved' });
      continue;
    }
    const exit = sessionPlus(sbgb, entry.day, 20);
    const sbmmEntry = sbmm.find((bar) => bar.day === entry.day);
    const sbmmExit = exit ? sbmm.find((bar) => bar.day === exit.day) : undefined;
    if (!exit || !sbmmEntry || !sbmmExit) {
      out.push({ decisionDay, move, status: 'unresolved', entryDay: entry.day });
      continue;
    }
    const sbgbNetPct = eventReturnPct(entry.open, exit.open, costs);
    const sbgbStressPct = eventReturnPct(entry.open, exit.open, costScenarios.investorStress);
    const sbmmNetPct = eventReturnPct(sbmmEntry.open, sbmmExit.open, costs);
    out.push({
      decisionDay,
      move,
      status: 'trade',
      entryDay: entry.day,
      exitDay: exit.day,
      sbgbNetPct,
      sbgbStressPct,
      sbmmNetPct,
      excessPct: sbgbNetPct - sbmmNetPct,
    });
    openUntil = exit.day;
  }
  return out;
}
