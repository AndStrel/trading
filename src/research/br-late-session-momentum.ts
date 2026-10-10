import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, type SiCandle, type SiSide } from './si-first-hour.js';

export type BrLateDecision = {
  date: string;
  contract: string;
  status: 'excluded' | 'cash' | 'unresolved' | 'trade';
  reason?: string;
  signalReturn?: number;
  side?: SiSide;
  entry?: number;
  exit?: number;
  exitReason?: 'stop' | 'target' | 'time';
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

function at(date: string, minute: number): string {
  return `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
}

export function evaluateBrLateMomentum(input: {
  date: string;
  contract: string;
  baseCandles: readonly SiCandle[];
  lateCandles: readonly SiCandle[];
}): BrLateDecision {
  const { date, contract } = input;
  const base = { date, contract };
  const early = new Map(input.baseCandles.map((candle) => [candle.time, candle]));
  const late = new Map(input.lateCandles.map((candle) => [candle.time, candle]));
  for (let minute = 960; minute <= 1019; minute += 1) {
    if (!early.has(at(date, minute))) return { ...base, status: 'excluded', reason: 'signal_minute_missing' };
  }
  const first = early.get(at(date, 960))!.open;
  const last = early.get(at(date, 1019))!.close;
  const signalReturn = last / first - 1;
  if (signalReturn === 0) return { ...base, status: 'cash', signalReturn };
  const side: SiSide = signalReturn > 0 ? 'long' : 'short';
  // Require the complete late window, including its 17:00 boundary candle.
  for (let minute = 1020; minute <= 1135; minute += 1) {
    if (!late.has(at(date, minute))) return { ...base, status: 'unresolved', reason: 'late_minute_missing', signalReturn, side };
  }
  const entry = late.get(at(date, 1021))!.open;
  const stop = side === 'long' ? entry * 0.992 : entry * 1.008;
  const target = side === 'long' ? entry * 1.015 : entry * 0.985;
  let exit: number | undefined;
  let exitReason: 'stop' | 'target' | 'time' = 'time';
  for (let minute = 1021; minute <= 1134; minute += 1) {
    const candle = late.get(at(date, minute))!;
    const stopHit = side === 'long' ? candle.low <= stop : candle.high >= stop;
    const targetHit = side === 'long' ? candle.high >= target : candle.low <= target;
    if (stopHit || targetHit) {
      exit = stopHit ? (side === 'long' ? Math.min(stop, candle.open) : Math.max(stop, candle.open)) : target;
      exitReason = stopHit ? 'stop' : 'target';
      break;
    }
  }
  if (exit === undefined) exit = late.get(at(date, 1135))!.open;
  return { ...base, status: 'trade', signalReturn, side, entry, exit, exitReason,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS) };
}

export function summarizeBrLateMomentum(decisions: readonly BrLateDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const sum = (key: 'gross' | 'baseNet' | 'stressNet') => trades.reduce((total, trade) => total + trade[key]!, 0);
  const block = (items: readonly BrLateDecision[]) => {
    const completed = items.filter((decision) => decision.status === 'trade');
    return { trades: completed.length, winners: completed.filter((trade) => trade.baseNet! > 0).length,
      meanBaseNet: completed.length ? completed.reduce((total, trade) => total + trade.baseNet!, 0) / completed.length : null };
  };
  return { decisions: decisions.length, excluded: decisions.filter((decision) => decision.status === 'excluded').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    unresolved: decisions.filter((decision) => decision.status === 'unresolved').length,
    trades: trades.length, dates: new Set(trades.map((trade) => trade.date)).size,
    grossWinners: trades.filter((trade) => trade.gross! > 0).length,
    winners: trades.filter((trade) => trade.baseNet! > 0).length,
    winRate: trades.length ? trades.filter((trade) => trade.baseNet! > 0).length / trades.length : null,
    meanGross: trades.length ? sum('gross') / trades.length : null,
    meanBaseNet: trades.length ? sum('baseNet') / trades.length : null,
    sumBaseNet: sum('baseNet'), meanStressNet: trades.length ? sum('stressNet') / trades.length : null,
    byBlock: { marchMay: block(decisions.filter((decision) => decision.date <= '2026-05-31')),
      juneSeptember: block(decisions.filter((decision) => decision.date >= '2026-06-01')) },
    byContract: Object.fromEntries([...new Set(decisions.map((decision) => decision.contract))].map((contract) => [contract, block(decisions.filter((decision) => decision.contract === contract))])) };
}
