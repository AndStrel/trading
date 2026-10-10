import {
  SI_BASE_COSTS,
  SI_STRESS_COSTS,
  siTradeReturn,
  type SiCandle,
  type SiSide,
} from './si-first-hour.js';

export type BrDaySnapshot = {
  date: string;
  contract: string;
  candles: readonly SiCandle[];
};

export type BrWeekAnchor = {
  isoWeek: string;
  contract: string;
  firstDate: string;
  lastDate: string;
  entry: number;
  exit: number;
};

export type BrWeeklyMomentumDecision = {
  signalWeek: string;
  tradeWeek: string;
  contract: string;
  status: 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade' | 'skipped_gap';
  priorMove?: number;
  side?: SiSide;
  entryDate?: string;
  exitDate?: string;
  entry?: number;
  exit?: number;
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

/** Exact base break-even gross move for SI_BASE_COSTS (futures Investor model). */
export function brWeeklyBreakEvenMove(): number {
  const { commission, slippage } = SI_BASE_COSTS;
  return (1 + slippage) * (1 + commission) / ((1 - slippage) * (1 - commission)) - 1;
}

export function isoWeekKey(date: string): string {
  const utc = new Date(`${date}T12:00:00Z`);
  // ISO week: Thursday-based year, week starts Monday.
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function minuteOpen(candles: readonly SiCandle[], date: string, hhmm: string): number | undefined {
  const hit = candles.find((candle) => candle.time === `${date} ${hhmm}:00`);
  return hit?.open;
}

export function buildBrWeekAnchors(days: readonly BrDaySnapshot[]): BrWeekAnchor[] {
  const byWeek = new Map<string, BrDaySnapshot[]>();
  for (const day of days) {
    if (day.candles.length === 0) continue;
    const key = isoWeekKey(day.date);
    const bucket = byWeek.get(key) ?? [];
    bucket.push(day);
    byWeek.set(key, bucket);
  }
  const anchors: BrWeekAnchor[] = [];
  for (const [isoWeek, bucket] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    bucket.sort((a, b) => a.date.localeCompare(b.date));
    const first = bucket[0]!;
    const last = bucket.at(-1)!;
    if (first.contract !== last.contract) continue;
    if (bucket.some((day) => day.contract !== first.contract)) continue;
    const entry = minuteOpen(first.candles, first.date, '11:01');
    const exit = minuteOpen(last.candles, last.date, '16:55');
    if (entry === undefined || exit === undefined || entry <= 0 || exit <= 0) continue;
    anchors.push({
      isoWeek,
      contract: first.contract,
      firstDate: first.date,
      lastDate: last.date,
      entry,
      exit,
    });
  }
  return anchors;
}

export function evaluateBrWeeklyMomentum(anchors: readonly BrWeekAnchor[]): BrWeeklyMomentumDecision[] {
  const threshold = brWeeklyBreakEvenMove();
  const decisions: BrWeeklyMomentumDecision[] = [];
  for (let index = 0; index + 1 < anchors.length; index += 1) {
    const signal = anchors[index]!;
    const trade = anchors[index + 1]!;
    // Require contiguous ISO weeks: trade week key must be the next calendar ISO week with an anchor.
    // If an intervening week existed but lacked anchors, treat as skipped_gap (not a win).
    const signalMs = Date.parse(`${signal.firstDate}T12:00:00Z`);
    const tradeMs = Date.parse(`${trade.firstDate}T12:00:00Z`);
    const dayGap = (tradeMs - signalMs) / 86_400_000;
    if (dayGap < 5 || dayGap > 12) {
      decisions.push({
        signalWeek: signal.isoWeek,
        tradeWeek: trade.isoWeek,
        contract: signal.contract,
        status: 'skipped_gap',
      });
      continue;
    }
    if (signal.contract !== trade.contract) {
      decisions.push({
        signalWeek: signal.isoWeek,
        tradeWeek: trade.isoWeek,
        contract: signal.contract,
        status: 'skipped_gap',
      });
      continue;
    }
    const priorMove = signal.exit / signal.entry - 1;
    if (!Number.isFinite(priorMove) || Math.abs(priorMove) <= threshold) {
      decisions.push({
        signalWeek: signal.isoWeek,
        tradeWeek: trade.isoWeek,
        contract: trade.contract,
        status: 'cash',
        priorMove,
      });
      continue;
    }
    const side: SiSide = priorMove > 0 ? 'long' : 'short';
    if (!(trade.entry > 0)) {
      decisions.push({
        signalWeek: signal.isoWeek,
        tradeWeek: trade.isoWeek,
        contract: trade.contract,
        status: 'cancelled_entry',
        priorMove,
        side,
      });
      continue;
    }
    if (!(trade.exit > 0)) {
      decisions.push({
        signalWeek: signal.isoWeek,
        tradeWeek: trade.isoWeek,
        contract: trade.contract,
        status: 'unresolved_exit',
        priorMove,
        side,
        entryDate: trade.firstDate,
        entry: trade.entry,
      });
      continue;
    }
    decisions.push({
      signalWeek: signal.isoWeek,
      tradeWeek: trade.isoWeek,
      contract: trade.contract,
      status: 'trade',
      priorMove,
      side,
      entryDate: trade.firstDate,
      exitDate: trade.lastDate,
      entry: trade.entry,
      exit: trade.exit,
      gross: siTradeReturn(side, trade.entry, trade.exit, { commission: 0, slippage: 0 }),
      baseNet: siTradeReturn(side, trade.entry, trade.exit, SI_BASE_COSTS),
      stressNet: siTradeReturn(side, trade.entry, trade.exit, SI_STRESS_COSTS),
    });
  }
  return decisions;
}

export function summarizeBrWeeklyMomentum(decisions: readonly BrWeeklyMomentumDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const base = trades.map((trade) => trade.baseNet!);
  const stress = trades.map((trade) => trade.stressNet!);
  const winners = base.filter((value) => value > 0).length;
  const positive = base.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = base.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
  const sum = base.reduce((total, value) => total + value, 0);
  return {
    decisions: decisions.length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    skippedGap: decisions.filter((decision) => decision.status === 'skipped_gap').length,
    cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
    unresolvedExit: decisions.filter((decision) => decision.status === 'unresolved_exit').length,
    trades: trades.length,
    winners,
    winRate: trades.length ? winners / trades.length : null,
    meanGross: trades.length
      ? trades.reduce((total, trade) => total + trade.gross!, 0) / trades.length
      : null,
    meanBaseNet: trades.length ? sum / trades.length : null,
    meanStressNet: trades.length ? stress.reduce((total, value) => total + value, 0) / trades.length : null,
    sumBaseNet: sum,
    profitFactor: negative > 0 ? positive / negative : (positive > 0 && trades.length ? null : 0),
    withoutBestWeekSum: trades.length ? sum - Math.max(...base, 0) : null,
  };
}
