export type SiContract = 'SiU5' | 'SiZ5';
export type SiSide = 'long' | 'short';
export type SiCandle = {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
};
export type SiDecision = {
  date: string;
  contract: SiContract;
  status: 'no_session' | 'no_candles' | 'missing_history' | 'cash' | 'cancelled_entry' | 'unresolved_exit' | 'trade';
  firstHourReturn?: number;
  side?: SiSide;
  entry?: number;
  exit?: number;
  gross?: number;
  baseNet?: number;
  stressNet?: number;
  missingHoldingMinutes?: number;
};

export const SI_BASE_COSTS = { commission: 0.001, slippage: 0.0005 } as const;
export const SI_STRESS_COSTS = { commission: 0.001, slippage: 0.001 } as const;

export function siContractForDate(date: string): SiContract | null {
  if (date >= '2025-07-01' && date <= '2025-09-10') return 'SiU5';
  if (date >= '2025-09-11' && date <= '2025-12-10') return 'SiZ5';
  return null;
}

export function parseSiCandlePage(payload: unknown, date: string,
  window: { from: string; to: string } = { from: '10:00', to: '17:00' }): SiCandle[] {
  if (!payload || typeof payload !== 'object') throw new Error('MOEX page must be an object');
  const block = (payload as Record<string, unknown>).candles;
  if (!block || typeof block !== 'object') throw new Error('MOEX candles block is missing');
  const columns = (block as Record<string, unknown>).columns;
  const data = (block as Record<string, unknown>).data;
  if (!Array.isArray(columns) || !Array.isArray(data)) throw new Error('MOEX candles columns/data are invalid');
  const names = columns.map((column) => String(column).toLowerCase());
  const indexes = ['open', 'close', 'high', 'low', 'volume', 'begin'].map((name) => {
    const index = names.indexOf(name);
    if (index < 0) throw new Error(`MOEX candles missing ${name}`);
    return index;
  });
  const result: SiCandle[] = [];
  for (const row of data) {
    if (!Array.isArray(row)) throw new Error('MOEX candle row is invalid');
    const [openIndex, closeIndex, highIndex, lowIndex, volumeIndex, timeIndex] = indexes;
    if ([openIndex, closeIndex, highIndex, lowIndex, volumeIndex, timeIndex].some((index) => index === undefined)) {
      throw new Error('MOEX candle indexes are invalid');
    }
    const open = Number(row[openIndex!]);
    const close = Number(row[closeIndex!]);
    const high = Number(row[highIndex!]);
    const low = Number(row[lowIndex!]);
    const volume = Number(row[volumeIndex!]);
    const time = row[timeIndex!];
    if (
      typeof time !== 'string' ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(time) ||
      !time.startsWith(`${date} `) ||
      time.slice(11, 16) < window.from || time.slice(11, 16) > window.to ||
      ![open, close, high, low].every((price) => Number.isFinite(price) && price > 0) ||
      low > Math.min(open, close) || high < Math.max(open, close) || high < low ||
      !Number.isSafeInteger(volume) || volume < 0
    ) throw new Error(`MOEX candle invalid for ${date}`);
    result.push({ time, open, close, high, low, volume });
  }
  return result;
}

export function validateSiDayCandles(candles: readonly SiCandle[], date: string): void {
  let previous = '';
  for (const candle of candles) {
    if (!candle.time.startsWith(`${date} `) || candle.time <= previous) {
      throw new Error(`MOEX candles unsorted, duplicated, or outside ${date}`);
    }
    previous = candle.time;
  }
}

export function siTradeReturn(
  side: SiSide,
  entry: number,
  exit: number,
  costs: { commission: number; slippage: number },
): number {
  if (![entry, exit].every((value) => Number.isFinite(value) && value > 0)) throw new Error('Invalid price');
  if (![costs.commission, costs.slippage].every((value) => Number.isFinite(value) && value >= 0 && value < 1)) {
    throw new Error('Invalid trading costs');
  }
  const sell = side === 'long' ? exit * (1 - costs.slippage) : entry * (1 - costs.slippage);
  const buy = side === 'long' ? entry * (1 + costs.slippage) : exit * (1 + costs.slippage);
  return (sell - buy - costs.commission * (sell + buy)) / entry;
}

export function evaluateSiDay(date: string, contract: SiContract, candles: readonly SiCandle[]): SiDecision {
  validateSiDayCandles(candles, date);
  if (candles.length === 0) return { date, contract, status: 'no_candles' };
  const firstHour = candles.filter((candle) => candle.time.slice(11, 16) >= '10:00' && candle.time.slice(11, 16) <= '10:59');
  if (firstHour.length !== 60 || firstHour[0]?.time !== `${date} 10:00:00` || firstHour[59]?.time !== `${date} 10:59:00`) {
    return { date, contract, status: 'missing_history' };
  }
  const firstHourReturn = firstHour[59]!.close / firstHour[0]!.open - 1;
  const side = firstHourReturn >= 0.003 ? 'long' : firstHourReturn <= -0.003 ? 'short' : null;
  if (!side) return { date, contract, status: 'cash', firstHourReturn };
  const entry = candles.find((candle) => candle.time === `${date} 11:01:00`)?.open;
  if (entry === undefined) return { date, contract, status: 'cancelled_entry', firstHourReturn, side };
  const exit = candles.find((candle) => candle.time === `${date} 17:00:00`)?.open;
  if (exit === undefined) return { date, contract, status: 'unresolved_exit', firstHourReturn, side, entry };
  const holdingMinutes = candles.filter((candle) => candle.time.slice(11, 16) >= '11:01' && candle.time.slice(11, 16) <= '17:00').length;
  return {
    date, contract, status: 'trade', firstHourReturn, side, entry, exit,
    gross: siTradeReturn(side, entry, exit, { commission: 0, slippage: 0 }),
    baseNet: siTradeReturn(side, entry, exit, SI_BASE_COSTS),
    stressNet: siTradeReturn(side, entry, exit, SI_STRESS_COSTS),
    missingHoldingMinutes: 360 - holdingMinutes,
  };
}

export function summarizeSiTrades(decisions: readonly SiDecision[]): {
  decisions: number;
  signals: number;
  trades: number;
  missingHistory: number;
  noCandles: number;
  noSessions: number;
  cancelledEntry: number;
  unresolvedExit: number;
  winners: number;
  winRate: number | null;
  meanGross: number | null;
  meanBaseNet: number | null;
  meanStressNet: number | null;
  meanWin: number | null;
  meanLoss: number | null;
  sumBaseNet: number;
  profitFactor: number | null;
  withoutBestDaySum: number | null;
} {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  const values = trades.map((trade) => trade.baseNet!);
  const positive = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negative = values.filter((value) => value < 0).reduce((sum, value) => sum - value, 0);
  const sumBaseNet = values.reduce((sum, value) => sum + value, 0);
  return {
    decisions: decisions.length,
    signals: decisions.filter((decision) => decision.side !== undefined).length,
    trades: trades.length,
    missingHistory: decisions.filter((decision) => decision.status === 'missing_history').length,
    noCandles: decisions.filter((decision) => decision.status === 'no_candles').length,
    noSessions: decisions.filter((decision) => decision.status === 'no_session').length,
    cancelledEntry: decisions.filter((decision) => decision.status === 'cancelled_entry').length,
    unresolvedExit: decisions.filter((decision) => decision.status === 'unresolved_exit').length,
    winners: values.filter((value) => value > 0).length,
    winRate: values.length ? values.filter((value) => value > 0).length / values.length : null,
    meanGross: trades.length ? trades.reduce((sum, trade) => sum + trade.gross!, 0) / trades.length : null,
    meanBaseNet: values.length ? sumBaseNet / values.length : null,
    meanStressNet: trades.length ? trades.reduce((sum, trade) => sum + trade.stressNet!, 0) / trades.length : null,
    meanWin: values.some((value) => value > 0) ? positive / values.filter((value) => value > 0).length : null,
    meanLoss: values.some((value) => value < 0) ? -negative / values.filter((value) => value < 0).length : null,
    sumBaseNet,
    profitFactor: negative > 0 ? positive / negative : null,
    withoutBestDaySum: values.length ? sumBaseNet - Math.max(...values) : null,
  };
}
