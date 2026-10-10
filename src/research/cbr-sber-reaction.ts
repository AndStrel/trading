import { siTradeReturn, type SiCandle, type SiSide } from './si-first-hour.js';

export type CbrEventKind = 'rate_release' | 'press_conference';
export type CbrWindowStatus = 'trade' | 'flat' | 'missing_candles';

export type CbrSberWindow = {
  date: string;
  kind: CbrEventKind;
  status: CbrWindowStatus;
  missingTimes: string[];
  side?: SiSide;
  signalReturn?: number;
  entryAvailable?: boolean;
  exitAvailable?: boolean;
  entry?: number;
  exit?: number;
  gross?: number;
  baseNet?: number;
  stressNet?: number;
};

export const CBR_DECISION_DATES = [
  '2015-01-30', '2015-03-13', '2015-04-30', '2015-06-15', '2015-07-31', '2015-09-11', '2015-10-30', '2015-12-11',
  '2016-01-29', '2016-03-18', '2016-04-29', '2016-06-10', '2016-07-29', '2016-09-16', '2016-10-28', '2016-12-16',
  '2017-02-03', '2017-03-24', '2017-04-28', '2017-06-16', '2017-07-28', '2017-09-15', '2017-10-27', '2017-12-15',
  '2018-02-09', '2018-03-23', '2018-04-27', '2018-06-15', '2018-07-27', '2018-09-14', '2018-10-26', '2018-12-14',
  '2019-02-08', '2019-03-22', '2019-04-26', '2019-06-14', '2019-07-26', '2019-09-06', '2019-10-25', '2019-12-13',
  '2020-02-07', '2020-03-20', '2020-04-24', '2020-06-19', '2020-07-24', '2020-09-18', '2020-10-23', '2020-12-18',
  '2021-02-12', '2021-03-19', '2021-04-23', '2021-06-11', '2021-07-23', '2021-09-10', '2021-10-22', '2021-12-17',
  '2022-02-11', '2022-03-18', '2022-04-29', '2022-06-10', '2022-07-22', '2022-09-16', '2022-10-28', '2022-12-16',
  '2023-02-10', '2023-03-17', '2023-04-28', '2023-06-09', '2023-07-21', '2023-09-15', '2023-10-27', '2023-12-15',
  '2024-02-16', '2024-03-22', '2024-04-26', '2024-06-07', '2024-07-26', '2024-09-13', '2024-10-25', '2024-12-20',
  '2025-02-14', '2025-03-21', '2025-04-25', '2025-06-06', '2025-07-25', '2025-09-12', '2025-10-24', '2025-12-19',
  '2026-02-13', '2026-03-20', '2026-04-24', '2026-06-19', '2026-07-24', '2026-09-11',
] as const;

export const CBR_UNSCHEDULED_DECISION_DATES = [
  '2022-02-28', '2022-04-08', '2022-05-26', '2023-08-15',
] as const;

export const CBR_WINDOWS = [
  { kind: 'rate_release', startMinute: 13 * 60 + 30 },
  { kind: 'press_conference', startMinute: 15 * 60 },
] as const satisfies readonly { kind: CbrEventKind; startMinute: number }[];

export const CBR_EQUITY_COSTS = {
  base: { commission: 0.003, slippage: 0.0005 },
  stress: { commission: 0.003, slippage: 0.001 },
} as const;

export function cbrWindowMinuteTimes(startMinute: number): string[] {
  if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute + 35 >= 24 * 60) {
    throw new Error('Invalid event window start minute');
  }
  return [
    ...Array.from({ length: 5 }, (_, index) => startMinute + index),
    startMinute + 5,
    startMinute + 35,
  ].map((minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`);
}

function validCandle(candle: SiCandle | undefined): candle is SiCandle {
  return !!candle && [candle.open, candle.close, candle.high, candle.low, candle.volume].every(Number.isFinite) &&
    candle.open > 0 && candle.close > 0 && candle.low > 0 && candle.high >= candle.low &&
    candle.open >= candle.low && candle.open <= candle.high && candle.close >= candle.low && candle.close <= candle.high &&
    Number.isSafeInteger(candle.volume) && candle.volume >= 0;
}

export function evaluateCbrSberWindow(
  date: string,
  kind: CbrEventKind,
  startMinute: number,
  candlesByLocalTime: ReadonlyMap<string, SiCandle>,
): CbrSberWindow {
  const times = cbrWindowMinuteTimes(startMinute);
  const required = times.map((time) => `${date} ${time}`);
  const missingSignalTimes = required.slice(0, 5).filter((time) => !validCandle(candlesByLocalTime.get(time)));
  if (missingSignalTimes.length > 0) return { date, kind, status: 'missing_candles', missingTimes: missingSignalTimes };

  const signalFirst = candlesByLocalTime.get(required[0]!)!;
  const signalLast = candlesByLocalTime.get(required[4]!)!;
  const signalReturn = signalLast.close / signalFirst.open - 1;
  const side: SiSide | undefined = signalReturn === 0 ? undefined : signalReturn > 0 ? 'long' : 'short';
  const entryCandle = candlesByLocalTime.get(required[5]!);
  const exitCandle = candlesByLocalTime.get(required[6]!);
  const entryAvailable = validCandle(entryCandle);
  const exitAvailable = validCandle(exitCandle);
  const missingTradeTimes = required.slice(5).filter((time) => !validCandle(candlesByLocalTime.get(time)));
  if (missingTradeTimes.length > 0) return {
    date, kind, status: 'missing_candles', missingTimes: missingTradeTimes, signalReturn,
    ...(side ? { side } : {}), entryAvailable, exitAvailable,
    ...(entryAvailable && entryCandle ? { entry: entryCandle.open } : {}),
    ...(exitAvailable && exitCandle ? { exit: exitCandle.open } : {}),
  };
  if (!side) return { date, kind, status: 'flat', missingTimes: [], signalReturn, entryAvailable, exitAvailable };

  const entry = entryCandle!.open;
  const exit = exitCandle!.open;
  const gross = (side === 'long' ? 1 : -1) * (exit / entry - 1);
  return {
    date, kind, status: 'trade', missingTimes: [], side, signalReturn, entry, exit, gross,
    baseNet: siTradeReturn(side, entry, exit, CBR_EQUITY_COSTS.base),
    stressNet: siTradeReturn(side, entry, exit, CBR_EQUITY_COSTS.stress),
  };
}

export function summarizeCbrSberWindows(windows: readonly CbrSberWindow[]) {
  const trades = windows.filter((window) => window.status === 'trade');
  const base = trades.map((trade) => trade.baseNet!);
  const gross = trades.map((trade) => trade.gross!);
  const stress = trades.map((trade) => trade.stressNet!);
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  const positives = base.filter((value) => value > 0);
  const negatives = base.filter((value) => value < 0);
  const grossPositives = gross.filter((value) => value > 0);
  const stressPositives = stress.filter((value) => value > 0);
  const dates = [...new Set(trades.map((trade) => trade.date))];
  const byDate = dates.map((date) => {
    const daily = trades.filter((trade) => trade.date === date);
    return { date, trades: daily.length, baseNet: sum(daily.map((trade) => trade.baseNet!)) };
  });
  const baseSum = sum(base);
  const bestFive = [...base].sort((a, b) => b - a).slice(0, 5);
  return {
    windows: windows.length,
    trades: trades.length,
    dates: dates.length,
    missingWindows: windows.filter((window) => window.status === 'missing_candles').length,
    flatWindows: windows.filter((window) => window.status === 'flat').length,
    longTrades: trades.filter((trade) => trade.side === 'long').length,
    shortTrades: trades.filter((trade) => trade.side === 'short').length,
    grossWinners: grossPositives.length,
    grossWinRate: trades.length ? grossPositives.length / trades.length : null,
    winners: positives.length,
    winRate: trades.length ? positives.length / trades.length : null,
    meanGross: trades.length ? sum(gross) / trades.length : null,
    meanBaseNet: trades.length ? baseSum / trades.length : null,
    sumBaseNet: baseSum,
    meanStressNet: trades.length ? sum(stress) / trades.length : null,
    sumStressNet: sum(stress),
    stressWinners: stressPositives.length,
    profitFactor: negatives.length ? sum(positives) / -sum(negatives) : positives.length ? Number.POSITIVE_INFINITY : null,
    baseSumWithoutBestFive: baseSum - sum(bestFive),
    positiveDateClusters: byDate.filter((day) => day.baseNet > 0).length,
    meanDateClusterNet: byDate.length ? sum(byDate.map((day) => day.baseNet)) / byDate.length : null,
    dateClusters: byDate,
  };
}

export function cbrSberAdmission(input: {
  all: ReturnType<typeof summarizeCbrSberWindows>;
  byYear: Record<string, ReturnType<typeof summarizeCbrSberWindows>>;
  byBlock: Record<string, ReturnType<typeof summarizeCbrSberWindows>>;
  coverageByYear: Record<string, number>;
  unresolvedEntered: number;
}) {
  const yearsPass = Object.values(input.byYear).every((year) => year.trades > 0 && year.meanBaseNet! > 0 &&
    year.sumBaseNet > 0 && year.meanStressNet! > 0 && year.profitFactor! > 1);
  const blocksPass = Object.values(input.byBlock).every((block) => block.trades > 0 && block.sumBaseNet > 0);
  const coveragePass = Object.values(input.coverageByYear).every((coverage) => coverage >= 0.9);
  return input.all.trades >= 100 && input.all.dates >= 50 && input.all.winRate! >= 0.51 &&
    input.all.meanBaseNet! > 0 && input.all.sumBaseNet > 0 && input.all.meanStressNet! > 0 &&
    input.all.profitFactor! > 1 && input.all.baseSumWithoutBestFive > 0 && yearsPass && blocksPass &&
    coveragePass && input.unresolvedEntered === 0;
}
