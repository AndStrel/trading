import { costScenarios, eventReturnPct } from './trading-costs.js';

type Candle = { time: string; open: number };
export type WeeklyCalendarRow = {
  week: string;
  entryAt: string | null;
  exitAt: string | null;
  entry: number | null;
  exit: number | null;
  status: 'closed' | 'skipped';
  reason: string | null;
  grossPct: number | null;
  netPct: number | null;
  stressPct: number | null;
};

function moscowDate(time: string) {
  const ms = Date.parse(time);
  if (!Number.isFinite(ms)) throw new Error(`Invalid candle time: ${time}`);
  return new Date(ms + 3 * 60 * 60_000);
}

function weekMonday(date: Date) {
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}

export function weeklyCalendarRows(candles: Iterable<Candle>): WeeklyCalendarRow[] {
  const weeks = new Map<string, { entry?: Candle; exit?: Candle }>();
  for (const candle of candles) {
    const local = moscowDate(candle.time);
    const week = weekMonday(local);
    if (week < '2023-01-01' || week > '2025-12-31') continue;
    const day = local.getUTCDay();
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    let record = weeks.get(week);
    if (!record) { record = {}; weeks.set(week, record); }
    if (day === 2 && minute === 10 * 60 + 5) {
      if (record.entry) throw new Error(`Duplicate Tuesday entry candle: ${week}`);
      record.entry = candle;
    }
    if (day === 5 && minute === 17 * 60 + 30) {
      if (record.exit) throw new Error(`Duplicate Friday exit candle: ${week}`);
      record.exit = candle;
    }
  }
  return [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, { entry, exit }]) => {
    const valid = entry && exit && Number.isFinite(entry.open) && Number.isFinite(exit.open) && entry.open > 0 && exit.open > 0;
    return {
      week, entryAt: entry?.time ?? null, exitAt: exit?.time ?? null,
      entry: entry?.open ?? null, exit: exit?.open ?? null,
      status: valid ? 'closed' : 'skipped',
      reason: valid ? null : !entry ? 'missing-tuesday-entry' : !exit ? 'missing-friday-exit' : 'invalid-price',
      grossPct: valid ? eventReturnPct(entry.open, exit.open, costScenarios.gross) : null,
      netPct: valid ? eventReturnPct(entry.open, exit.open, costScenarios.investorBase) : null,
      stressPct: valid ? eventReturnPct(entry.open, exit.open, costScenarios.investorStress) : null,
    };
  });
}

export function weeklyCalendarStats(rows: WeeklyCalendarRow[]) {
  const closed = rows.filter((r) => r.status === 'closed');
  const values = closed.map((r) => r.netPct!);
  const wins = values.filter((v) => v > 0);
  const losses = values.filter((v) => v < 0);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const positive = sum(wins), negative = -sum(losses);
  return {
    weeks: rows.length, trades: closed.length, skipped: rows.length - closed.length,
    winners: wins.length, winRate: closed.length ? wins.length / closed.length : null,
    meanNetPct: closed.length ? sum(values) / closed.length : null,
    profitFactor: negative > 0 ? positive / negative : null,
    compoundedNetPct: closed.length ? (values.reduce((capital, v) => capital * (1 + v / 100), 1) - 1) * 100 : null,
    stressWinRate: closed.length ? closed.filter((r) => r.stressPct! > 0).length / closed.length : null,
    stressMeanNetPct: closed.length ? sum(closed.map((r) => r.stressPct!)) / closed.length : null,
  };
}
