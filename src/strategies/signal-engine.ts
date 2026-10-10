import { analyzeCandles, type CandleAnalysis } from '../domain/candle-analysis.js';
import { proposeIntradayLong, type IntradayLongProposal } from '../domain/intraday-proposal.js';
import { getStrategyDescriptor, type TradingStrategyId } from './catalog.js';
import { MAX_SUPPORTED_PRICE, priceToNano, roundPriceToTick } from '../domain/price-tick.js';
import { strategyEntryWindow } from './entry-window.js';

const BAR_MS = 5 * 60_000;

type Candle = { open: number; high: number; low: number; close: number; volume: number; time: number };

export type TradingSignalInput = {
  strategyId: TradingStrategyId;
  candlesPayload: unknown;
  candleAnalysis: CandleAnalysis;
  orderBookPayload: unknown;
  priceStep: number;
  commissionRate: number;
  slippageRate: number;
  now: Date;
  /** Strategy reference-window start in Moscow minutes, independent of exchange opening hours. */
  sessionStartMinutes: number;
};

export type TradingSignalEvaluation = {
  strategyId: TradingStrategyId;
  version: string;
  signal: boolean;
  reasons: string[];
  proposal: IntradayLongProposal | null;
  dataValid: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function quotedPrice(value: unknown): number | null {
  const quote = record(value);
  if (!quote || !['string', 'number'].includes(typeof quote.units) || typeof quote.nano !== 'number'
    || (typeof quote.units === 'string' && !/^\d+$/.test(quote.units))) return null;
  const units = Number(quote.units);
  const nano = quote.nano;
  if (!Number.isSafeInteger(units) || units < 0 || !Number.isInteger(nano) || nano < 0 || nano >= 1_000_000_000) return null;
  const price = units + nano / 1_000_000_000;
  return Number.isFinite(price) && price > 0 && price <= MAX_SUPPORTED_PRICE ? price : null;
}

function normalize(payload: unknown, now: number): { candles: Candle[]; reason: string | null } {
  const values = record(payload)?.candles;
  if (!Array.isArray(values) || values.length === 0) return { candles: [], reason: 'Нет пятиминутных свечей' };
  const candles: Candle[] = [];
  let previousTime = -Infinity;
  for (const value of values) {
    const item = record(value);
    const time = typeof item?.time === 'string' ? Date.parse(item.time) : NaN;
    if (!Number.isFinite(time) || time % BAR_MS !== 0 || time > now || time <= previousTime) {
      return { candles: [], reason: 'Время свечей должно быть уникальным, возрастающим, пятиминутным и не из будущего' };
    }
    previousTime = time;
    if (item?.isComplete === false) continue;
    if (item?.isComplete !== true || time + BAR_MS > now) {
      return { candles: [], reason: 'Закрытие свечи не подтверждено' };
    }
    const open = quotedPrice(item.open);
    const high = quotedPrice(item.high);
    const low = quotedPrice(item.low);
    const close = quotedPrice(item.close);
    const volume = typeof item.volume === 'number' || typeof item.volume === 'string' ? Number(item.volume) : NaN;
    if (open === null || high === null || low === null || close === null || low > high
      || open < low || open > high || close < low || close > high
      || !Number.isSafeInteger(volume) || volume < 0) {
      return { candles: [], reason: 'Невалидные цены OHLC или объём свечи' };
    }
    candles.push({ open, high, low, close, volume, time });
  }
  const latest = candles.at(-1);
  if (!latest || now - (latest.time + BAR_MS) > 10 * 60_000) {
    return { candles: [], reason: 'Последняя закрытая свеча старше 10 минут или отсутствует' };
  }
  return { candles, reason: null };
}

function contiguous(candles: readonly Candle[]): boolean {
  return candles.every((candle, index) => index === 0 || candle.time - candles[index - 1]!.time === BAR_MS);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function atr14(candles: readonly Candle[]): number | null {
  if (candles.length < 15) return null;
  const values = candles.slice(-15);
  if (!contiguous(values)) return null;
  return average(values.slice(1).map((candle, index) => Math.max(candle.high - candle.low,
    Math.abs(candle.high - values[index]!.close), Math.abs(candle.low - values[index]!.close))));
}

function relativeVolume(candles: readonly Candle[]): number | null {
  const values = candles.slice(-21);
  if (values.length < 21 || !contiguous(values)) return null;
  const baseline = average(values.slice(0, -1).map(candle => candle.volume));
  return baseline > 0 ? values.at(-1)!.volume / baseline : null;
}

function sessionVwap(candles: readonly Candle[]): number | null {
  const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);
  if (totalVolume <= 0) return null;
  return candles.reduce((sum, candle) => sum + ((candle.high + candle.low + candle.close) / 3) * candle.volume, 0) / totalVolume;
}

function fixedAtrProposal(input: TradingSignalInput, candles: readonly Candle[], reasons: string[]): IntradayLongProposal | null {
  const atr = atr14(candles);
  const asks = record(input.orderBookPayload)?.asks;
  if (atr === null || atr <= 0 || !Array.isArray(asks)) return null;
  const levels = asks.map(level => {
    const item = record(level);
    const price = quotedPrice(item?.price);
    const quantity = typeof item?.quantity === 'number' || typeof item?.quantity === 'string' ? Number(item.quantity) : NaN;
    return price !== null && Number.isSafeInteger(quantity) && quantity > 0 ? price : null;
  }).filter((price): price is number => price !== null);
  if (levels.length === 0) return null;
  const entryPrice = roundPriceToTick(Math.min(...levels), input.priceStep, 'ceil');
  if (entryPrice - atr * 1.5 <= 0 || entryPrice + atr * 4 > MAX_SUPPORTED_PRICE) return null;
  const stopPrice = roundPriceToTick(entryPrice - atr * 1.5, input.priceStep, 'floor');
  // Rounding down does not increase the advertised target distance beyond 4 ATR.
  const targetPrice = roundPriceToTick(entryPrice + atr * 4, input.priceStep, 'floor');
  const costs = entryPrice * 2 * (input.commissionRate + input.slippageRate);
  const risk = entryPrice - stopPrice;
  const reward = targetPrice - entryPrice;
  if (stopPrice <= 0 || risk <= 0 || reward <= costs || (reward - costs) / (risk + costs) < 2) return null;
  return { entryPrice, stopPrice, targetPrice, reasons: [...reasons,
    'Стоп: 1,5 ATR14; цель: 4 ATR14', 'Чистое отношение доходности к риску после расходов не ниже 2'] };
}

export function evaluateTradingSignal(input: TradingSignalInput): TradingSignalEvaluation {
  const descriptor = getStrategyDescriptor(input.strategyId);
  const result = (dataValid: boolean, reasons: string[], proposal: IntradayLongProposal | null = null): TradingSignalEvaluation => ({
    strategyId: input.strategyId, version: descriptor.version, dataValid, signal: proposal !== null,
    reasons, proposal,
  });
  const now = input.now.getTime();
  const window = strategyEntryWindow(input.strategyId, input.sessionStartMinutes, input.now);
  if (!window || !Number.isFinite(input.priceStep) || input.priceStep <= 0
    || [input.commissionRate, input.slippageRate].some(value => !Number.isFinite(value) || value < 0)) {
    return result(false, ['Некорректная конфигурация времени, цены или расходов']);
  }
  try { priceToNano(input.priceStep); }
  catch { return result(false, ['Шаг цены должен быть положительным и точно представимым в нанорублях']); }
  const normalized = normalize(input.candlesPayload, now);
  if (normalized.reason) return result(false, [normalized.reason]);
  const sessionStart = window.referenceStartMs;
  if (now < window.entryStartMs || now >= window.entryEndMs) return result(true, [
    input.strategyId === 'opening-range-breakout-v1' && now >= window.entryEndMs
      ? 'Окно первого пробоя завершено' : 'Вне настроенного окна новых внутридневных входов',
  ]);
  const session = normalized.candles.filter(candle => candle.time >= sessionStart);
  if (session.length === 0) return result(false, ['Нет закрытых свечей текущего окна']);
  if (!contiguous(session)) return result(false, ['В текущем окне есть пропуски закрытых пятиминутных свечей']);
  if (input.strategyId !== 'trend-momentum-v1' && session[0]!.time !== sessionStart) {
    return result(false, ['Начало настроенного текущего окна отсутствует']);
  }

  if (input.strategyId === 'trend-momentum-v1') {
    const trendWindow = normalized.candles.slice(-50);
    if (trendWindow.length < 50) return result(true, ['Нужно 50 закрытых свечей для SMA20 и SMA50']);
    if (!contiguous(trendWindow)) return result(false, ['В окне тренда есть пропуски пятиминутных свечей']);
    // Recompute from the validated payload: a caller-supplied summary is not signal evidence.
    const analysis = analyzeCandles(input.candlesPayload);
    const reasons = [];
    if (analysis.trend !== 'up') reasons.push('SMA20 не подтверждает восходящий тренд относительно SMA50');
    if (analysis.relativeVolume === null || analysis.relativeVolume < 1) reasons.push('Относительный объём ниже 1');
    if (reasons.length) return result(true, reasons);
    const proposal = proposeIntradayLong({ candleAnalysis: analysis, orderBookPayload: input.orderBookPayload,
      priceStep: input.priceStep, commissionRate: input.commissionRate, slippageRate: input.slippageRate });
    return result(true, proposal?.reasons ?? ['Текущий стакан, ATR или расходы не позволяют построить план тренда'], proposal);
  }

  const volume = relativeVolume(normalized.candles);
  if (volume === null) return result(true, ['Нужно 21 последовательная закрытая свеча для проверки объёма']);
  if (volume < 1) return result(true, ['Относительный объём ниже 1']);
  let reasons: string[];
  if (input.strategyId === 'opening-range-breakout-v1') {
    if (session.length < 7) return result(true, ['Начальный 30-минутный диапазон ещё не завершён']);
    const opening = session.slice(0, 6);
    if (opening[0]!.time !== sessionStart || opening[5]!.time !== sessionStart + 25 * 60_000) {
      return result(false, ['Первые шесть свечей настроенного окна доступны не полностью']);
    }
    const rangeHigh = Math.max(...opening.map(candle => candle.high));
    const latest = session.at(-1)!;
    const previous = session.at(-2)!;
    if (session.slice(6, -1).some(candle => candle.close > rangeHigh)) return result(true, ['Первый пробой диапазона уже произошёл']);
    if (latest.close <= rangeHigh || previous.close > rangeHigh) return result(true, ['Нет первого подтверждённого закрытием пробоя диапазона']);
    reasons = ['Первое закрытие выше максимума первых шести свечей настроенного окна', 'Относительный объём не ниже 1'];
  } else {
    if (session.length < 21) return result(true, ['Нужно 21 закрытая свеча текущего окна для возврата выше VWAP']);
    if (session[0]!.time !== sessionStart) return result(false, ['VWAP нельзя восстановить: начало текущего окна отсутствует']);
    const previousSession = session.slice(0, -1);
    const priorVwap = sessionVwap(previousSession);
    const currentVwap = sessionVwap(session);
    const latest = session.at(-1)!;
    const previous = session.at(-2)!;
    if (priorVwap === null || currentVwap === null || previous.close > priorVwap || latest.close <= currentVwap
      || currentVwap <= priorVwap) return result(true, ['Нет подтверждённого возврата выше растущего VWAP текущего окна']);
    const sma20 = average(session.slice(-20).map(candle => candle.close));
    const previousSma20 = average(previousSession.slice(-20).map(candle => candle.close));
    if (sma20 < previousSma20) return result(true, ['SMA20 продолжает снижаться']);
    reasons = ['Закрытие вернулось выше растущего VWAP текущего окна', 'SMA20 не снижается', 'Относительный объём не ниже 1'];
  }
  const proposal = fixedAtrProposal(input, normalized.candles, reasons);
  return result(true, proposal ? reasons : [...reasons, 'ATR, текущий стакан или расходы не позволяют чистое отношение доходности к риску 2'], proposal);
}

export const evaluateStrategySignal = evaluateTradingSignal;
