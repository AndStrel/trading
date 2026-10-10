import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, type SiCandle, type SiSide } from './si-first-hour.js';

export type MainMomentumDecision = {
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

export function evaluateSiMainMomentum(input: {
  date: string;
  contract: string;
  signalCandles: readonly SiCandle[];
  holdingCandles: readonly SiCandle[];
}): MainMomentumDecision {
  const { date, contract } = input;
  const base = { date, contract };
  if (input.signalCandles.length !== 60 || input.holdingCandles.length !== 421) {
    return { ...base, status: 'excluded', reason: 'incomplete_source' };
  }
  const signal = new Map(input.signalCandles.map((candle) => [candle.time, candle]));
  const holding = new Map(input.holdingCandles.map((candle) => [candle.time, candle]));
  const first = signal.get(`${date} 09:00:00`)?.open;
  const last = signal.get(`${date} 09:59:00`)?.close;
  if (first === undefined || last === undefined) return { ...base, status: 'unresolved', reason: 'signal_endpoint_missing' };
  const signalReturn = last / first - 1;
  if (signalReturn === 0) return { ...base, status: 'cash', signalReturn };
  const side: SiSide = signalReturn > 0 ? 'long' : 'short';
  const entry = holding.get(`${date} 10:01:00`)?.open;
  if (entry === undefined) return { ...base, status: 'unresolved', reason: 'entry_missing', side, signalReturn };
  const stop = side === 'long' ? entry * 0.995 : entry * 1.005;
  const target = side === 'long' ? entry * 1.01 : entry * 0.99;
  let exit: number | undefined;
  let exitReason: 'stop' | 'target' | 'time' = 'time';
  for (let minute = 601; minute <= 1014; minute += 1) {
    const stamp = `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
    const candle = holding.get(stamp);
    if (!candle) return { ...base, status: 'unresolved', reason: 'holding_minute_missing', side, signalReturn, entry };
    const stopHit = side === 'long' ? candle.low <= stop : candle.high >= stop;
    const targetHit = side === 'long' ? candle.high >= target : candle.low <= target;
    if (stopHit || targetHit) {
      exit = stopHit ? (side === 'long' ? Math.min(stop, candle.open) : Math.max(stop, candle.open)) : target;
      exitReason = stopHit ? 'stop' : 'target';
      break;
    }
  }
  if (exit === undefined) exit = holding.get(`${date} 16:55:00`)?.open;
  if (exit === undefined) return { ...base, status: 'unresolved', reason: 'exit_missing', side, signalReturn, entry };
  return { ...base, status: 'trade', signalReturn, side, entry, exit, exitReason,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS) };
}

export function summarizeSiMainMomentum(decisions: readonly MainMomentumDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const sum = (key: 'gross' | 'baseNet' | 'stressNet') => trades.reduce((total, trade) => total + trade[key]!, 0);
  const block = (items: readonly MainMomentumDecision[]) => {
    const completed = items.filter((decision) => decision.status === 'trade');
    return { trades: completed.length, winners: completed.filter((trade) => trade.baseNet! > 0).length,
      meanBaseNet: completed.length ? completed.reduce((total, trade) => total + trade.baseNet!, 0) / completed.length : null };
  };
  return { decisions: decisions.length, excluded: decisions.filter((decision) => decision.status === 'excluded').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    unresolved: decisions.filter((decision) => decision.status === 'unresolved').length,
    trades: trades.length, dates: new Set(trades.map((trade) => trade.date)).size,
    winners: trades.filter((trade) => trade.baseNet! > 0).length,
    winRate: trades.length ? trades.filter((trade) => trade.baseNet! > 0).length / trades.length : null,
    meanGross: trades.length ? sum('gross') / trades.length : null,
    meanBaseNet: trades.length ? sum('baseNet') / trades.length : null,
    sumBaseNet: sum('baseNet'), meanStressNet: trades.length ? sum('stressNet') / trades.length : null,
    byBlock: { marchMay: block(decisions.filter((decision) => decision.date <= '2026-05-31')),
      juneSeptember: block(decisions.filter((decision) => decision.date >= '2026-06-01')) },
    byContract: Object.fromEntries([...new Set(decisions.map((decision) => decision.contract))].map((contract) => [contract, block(decisions.filter((decision) => decision.contract === contract))])) };
}
