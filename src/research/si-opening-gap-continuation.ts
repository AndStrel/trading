import { SI_BASE_COSTS, SI_STRESS_COSTS, siTradeReturn, type SiCandle, type SiSide } from './si-first-hour.js';

export type GapDecision = {
  date: string;
  contract: string;
  status: 'excluded' | 'cash' | 'unresolved' | 'trade';
  reason?: string;
  side?: SiSide;
  gap?: number;
  entry?: number;
  exit?: number;
  exitReason?: 'stop' | 'target' | 'time';
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

export function evaluateSiOpeningGap(input: {
  date: string;
  contract: string;
  previousDate: string;
  previousContract: string;
  previousCandles: readonly SiCandle[];
  candles: readonly SiCandle[];
}): GapDecision {
  const { date, contract } = input;
  const base = { date, contract };
  if (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${input.previousDate}T00:00:00Z`) !== 86_400_000 ||
      contract !== input.previousContract) return { ...base, status: 'excluded', reason: 'nonconsecutive_or_contract_roll' };
  if (input.previousCandles.length !== 421 || input.candles.length !== 421) {
    return { ...base, status: 'excluded', reason: 'incomplete_source' };
  }
  const previous = new Map(input.previousCandles.map((candle) => [candle.time, candle]));
  const current = new Map(input.candles.map((candle) => [candle.time, candle]));
  const previousClose = previous.get(`${input.previousDate} 16:55:00`)?.close;
  const todayOpen = current.get(`${date} 10:00:00`)?.open;
  if (previousClose === undefined || todayOpen === undefined) return { ...base, status: 'unresolved', reason: 'reference_missing' };
  const gap = todayOpen / previousClose - 1;
  if (gap === 0) return { ...base, status: 'cash', gap };
  const side: SiSide = gap > 0 ? 'long' : 'short';
  const entry = current.get(`${date} 10:05:00`)?.open;
  if (entry === undefined) return { ...base, status: 'unresolved', reason: 'entry_missing', side, gap };
  const stop = side === 'long' ? entry * 0.995 : entry * 1.005;
  const target = side === 'long' ? entry * 1.01 : entry * 0.99;
  let exit: number | undefined;
  let exitReason: 'stop' | 'target' | 'time' = 'time';
  for (let minute = 605; minute <= 1014; minute += 1) {
    const stamp = `${date} ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
    const candle = current.get(stamp);
    if (!candle) return { ...base, status: 'unresolved', reason: 'holding_minute_missing', side, gap, entry };
    const stopHit = side === 'long' ? candle.low <= stop : candle.high >= stop;
    const targetHit = side === 'long' ? candle.high >= target : candle.low <= target;
    if (stopHit || targetHit) {
      exit = stopHit ? (side === 'long' ? Math.min(stop, candle.open) : Math.max(stop, candle.open)) : target;
      exitReason = stopHit ? 'stop' : 'target';
      break;
    }
  }
  if (exit === undefined) {
    exit = current.get(`${date} 16:55:00`)?.open;
    exitReason = 'time';
  }
  if (exit === undefined) return { ...base, status: 'unresolved', reason: 'exit_missing', side, gap, entry };
  return {
    ...base, status: 'trade', side, gap, entry, exit, exitReason,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
  };
}

export function summarizeSiOpeningGap(decisions: readonly GapDecision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const sum = (key: 'gross' | 'baseNet' | 'stressNet') => trades.reduce((total, trade) => total + trade[key]!, 0);
  const blocks = (items: readonly GapDecision[]) => {
    const completed = items.filter((decision) => decision.status === 'trade');
    return { trades: completed.length, winners: completed.filter((trade) => trade.baseNet! > 0).length,
      meanBaseNet: completed.length ? completed.reduce((sum, trade) => sum + trade.baseNet!, 0) / completed.length : null };
  };
  return {
    decisions: decisions.length,
    excluded: decisions.filter((decision) => decision.status === 'excluded').length,
    cash: decisions.filter((decision) => decision.status === 'cash').length,
    unresolved: decisions.filter((decision) => decision.status === 'unresolved').length,
    trades: trades.length,
    dates: new Set(trades.map((trade) => trade.date)).size,
    winners: trades.filter((trade) => trade.baseNet! > 0).length,
    winRate: trades.length ? trades.filter((trade) => trade.baseNet! > 0).length / trades.length : null,
    meanGross: trades.length ? sum('gross') / trades.length : null,
    meanBaseNet: trades.length ? sum('baseNet') / trades.length : null,
    sumBaseNet: sum('baseNet'),
    meanStressNet: trades.length ? sum('stressNet') / trades.length : null,
    byBlock: {
      marchMay: blocks(decisions.filter((decision) => decision.date <= '2026-05-31')),
      juneSeptember: blocks(decisions.filter((decision) => decision.date >= '2026-06-01')),
    },
    byContract: Object.fromEntries([...new Set(decisions.map((decision) => decision.contract))].map((contract) => [contract, blocks(decisions.filter((decision) => decision.contract === contract))])),
  };
}
