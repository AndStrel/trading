export type BoundTrade = { entryDay: string; exitDay: string; entry: number; netPct: number };
export type DividendEvent = { recordDay: string; amount: number };

function shiftedDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid dividend date');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dividendUpperBound(trades: readonly BoundTrade[], event: DividendEvent, windowDays: number) {
  if (!Number.isInteger(windowDays) || windowDays < 0 || !Number.isFinite(event.amount) || event.amount < 0) {
    throw new Error('Invalid bound scenario');
  }
  const lower = shiftedDay(event.recordDay, -windowDays);
  const upper = shiftedDay(event.recordDay, windowDays);
  let credited = 0, winners = 0, sumNetPct = 0;
  for (const trade of trades) {
    if (!(trade.entryDay <= trade.exitDay) || !Number.isFinite(trade.entry) || trade.entry <= 0 ||
      !Number.isFinite(trade.netPct)) throw new Error('Invalid trade');
    const intersects = trade.entryDay <= upper && trade.exitDay >= lower;
    const addedPct = intersects ? 100 * event.amount / (trade.entry * 1.0005 * 1.003) : 0;
    if (intersects) credited++;
    const netPct = trade.netPct + addedPct;
    if (netPct > 0) winners++;
    sumNetPct += netPct;
  }
  return { trades: trades.length, credited, winners,
    winRate: trades.length ? winners / trades.length : null,
    meanNetPct: trades.length ? sumNetPct / trades.length : null };
}
