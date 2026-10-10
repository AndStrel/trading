import type { HistoricalMinuteCandle as Candle } from '../history/market-data-store.js';
import { costScenarios, eventReturnPct } from './trading-costs.js';
import { summarizeSignals } from './similarity-experiment.js';

export type MorningDecision = { ticker: string; day: string; signal: boolean; morningPct: number; reboundPct: number };
export type MorningTrade = MorningDecision & { entry: number; exit: number; entryAt: string; exitAt: string;
  exitDelayMinutes: number; interiorMissingMinutes: number; grossPct: number; netPct: number; stressPct: number; extremePct: number;
  investorFeeOnlyPct: number; traderBeforeSubscriptionPct: number };
export function morningReversal(ticker: string, candles: readonly Candle[], control = false) {
  const days = new Map<string, Candle[]>();
  const seen = new Set<number>();
  for (const c of candles) {
    if (!Number.isFinite(Date.parse(c.time)) || Date.parse(c.time) % 60_000 || seen.has(Date.parse(c.time)) ||
      ![c.open, c.close, c.high, c.low].every((v) => Number.isFinite(v) && v > 0) ||
      c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close)) throw new Error('Invalid/duplicate candle');
    seen.add(Date.parse(c.time));
    const day = new Date(Date.parse(c.time) + 10800_000).toISOString().slice(0, 10);
    const items = days.get(day) ?? []; items.push(c); days.set(day, items);
  }
  const trades: MorningTrade[] = [], decisions: MorningDecision[] = [];
  const blockedHistory: string[] = [], cancelled: string[] = [];
  const unclosed: { ticker: string; day: string; entry: number; entryAt: string }[] = [];
  let weekendDays = 0;
  for (const [day, rows] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if ([0, 6].includes(new Date(day).getUTCDay())) { weekendDays++; continue; }
    rows.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const time = (hhmm: string) => Date.parse(`${day}T${hhmm}:00+03:00`);
    const byTime = new Map(rows.map((c) => [Date.parse(c.time), c]));
    const past = Array.from({ length: 120 }, (_, i) => byTime.get(time('10:00') + i * 60_000));
    if (past.some((c) => !c)) { blockedHistory.push(`${ticker}:${day}`); continue; }
    const morningPct = (past[119]!.close / past[0]!.open - 1) * 100;
    const reboundPct = (past[119]!.close / past[90]!.open - 1) * 100;
    const signal = control || (morningPct <= -0.5 && reboundPct >= 0.1);
    const decision: MorningDecision = { ticker, day, signal, morningPct, reboundPct };
    decisions.push(decision);
    if (!signal) continue;
    // No future eligibility filter: failed attempts and unclosed positions are retained.
    const entry = rows.find((c) => Date.parse(c.time) >= time('12:01') && Date.parse(c.time) <= time('12:05'));
    if (!entry) { cancelled.push(`${ticker}:${day}`); continue; }
    const exit = rows.find((c) => Date.parse(c.time) >= time('17:01') && Date.parse(c.time) <= time('18:50'));
    if (!exit) { unclosed.push({ ticker, day, entry: entry.open, entryAt: entry.time }); continue; }
    let interiorMissingMinutes = 0;
    for (let t = Date.parse(entry.time); t < Date.parse(exit.time); t += 60_000) if (!byTime.has(t)) interiorMissingMinutes++;
    trades.push({ ...decision, entry: entry.open, exit: exit.open, entryAt: entry.time, exitAt: exit.time,
      exitDelayMinutes: (Date.parse(exit.time) - time('17:01')) / 60_000, interiorMissingMinutes,
      grossPct: eventReturnPct(entry.open, exit.open, costScenarios.gross),
      netPct: eventReturnPct(entry.open, exit.open, costScenarios.investorBase),
      stressPct: eventReturnPct(entry.open, exit.open, costScenarios.investorStress),
      extremePct: eventReturnPct(entry.open, exit.open, costScenarios.investorExtreme),
      investorFeeOnlyPct: eventReturnPct(entry.open, exit.open, costScenarios.investorFeeOnly),
      traderBeforeSubscriptionPct: eventReturnPct(entry.open, exit.open, costScenarios.traderBeforeSubscription),
    });
  }
  const summarize = (key: 'grossPct' | 'investorFeeOnlyPct' | 'traderBeforeSubscriptionPct') =>
    summarizeSignals(trades.map((t) => ({ ...t, netPct: t[key] })), 'netPct');
  return { decisions, trades, blockedHistory, cancelled, unclosed, weekendDays,
    base: summarizeSignals(trades, 'netPct'), stress: summarizeSignals(trades, 'stressPct'),
    extreme: summarizeSignals(trades, 'extremePct'), gross: summarize('grossPct'),
    feeOnly: summarize('investorFeeOnlyPct'), trader: summarize('traderBeforeSubscriptionPct') };
}
