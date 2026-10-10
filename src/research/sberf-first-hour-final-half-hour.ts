import {
  isWeekday,
  parseMoexCandles,
  sessionWindows,
  signalReturn,
  validateWindow,
  type MoexMinuteCandle,
} from './imoexf-first-hour-last-half-hour.js';

export { isWeekday, parseMoexCandles, sessionWindows, signalReturn, validateWindow };
export type { MoexMinuteCandle };

const TICK = 0.01;
const LOT = 100;
const MOEX_FEE_PER_SIDE_RUB = 8.38;
const INVESTOR_BROKER_RATE = 0.001;

export type SberfTrade = {
  direction: 'long' | 'short';
  signalReturn: number;
  entryReference: number;
  exitReference: number;
  entryExecution: number;
  exitExecution: number;
  grossRub: number;
  brokerCommissionRub: number;
  exchangeFeeRub: number;
  netRub: number;
  netReturn: number;
};

export function scoreSberfTrade(
  signalCandles: MoexMinuteCandle[],
  exitCandles: MoexMinuteCandle[],
  adverseTicksPerSide: 1 | 2,
): SberfTrade {
  const signal = signalReturn(signalCandles);
  if (signal === 0) throw new Error('Zero signal must remain in cash');
  if (exitCandles.length === 0) throw new Error('Exit window is empty');
  const direction = signal > 0 ? 1 : -1;
  const entryReference = exitCandles[0]!.open;
  const exitReference = exitCandles.at(-1)!.close;
  const adversePrice = adverseTicksPerSide * TICK;
  const entryExecution = entryReference + direction * adversePrice;
  const exitExecution = exitReference - direction * adversePrice;
  const grossRub = (exitExecution - entryExecution) * direction * LOT;
  const brokerCommissionRub = (Math.abs(entryExecution) + Math.abs(exitExecution)) * LOT * INVESTOR_BROKER_RATE;
  const exchangeFeeRub = 2 * MOEX_FEE_PER_SIDE_RUB;
  const netRub = grossRub - brokerCommissionRub - exchangeFeeRub;
  return {
    direction: direction > 0 ? 'long' : 'short', signalReturn: signal,
    entryReference, exitReference, entryExecution, exitExecution, grossRub,
    brokerCommissionRub, exchangeFeeRub, netRub, netReturn: netRub / (entryReference * LOT),
  };
}

export function sberfCostDisclosure() {
  return { brokerCommissionRatePerSide: INVESTOR_BROKER_RATE, exchangeFeeRubPerSide: MOEX_FEE_PER_SIDE_RUB,
    lotShares: LOT, tickRubPerShare: TICK, tickValueRubPerContract: LOT * TICK };
}
