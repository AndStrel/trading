import { costScenarios, eventReturnPct, type Costs } from '../research/trading-costs.js';

export type LqdtSleeveState =
  | { status: 'empty'; cash: number }
  | {
      status: 'open';
      role: 'cash_sleeve';
      entryDay: string;
      entryPrice: number;
      units: number;
      principal: number;
      costs: Costs;
      lastMarkDay: string;
      lastMarkPrice: number;
      markedEquity: number;
    };

export type LqdtSleeveEvent =
  | { type: 'open'; day: string; openPrice: number; principal: number; costs?: Costs }
  | { type: 'mark'; day: string; markPrice: number }
  | { type: 'close'; day: string; closePrice: number };

export type LqdtSleeveResult =
  | { ok: true; state: LqdtSleeveState; refused?: undefined }
  | { ok: false; state: LqdtSleeveState; refused: string };

export const LQDT_SLEEVE_TICKER = 'LQDT';
export const MONEY_MARKET_SLEEVE_TICKERS = ['LQDT', 'SBMM'] as const;
export type MoneyMarketSleeveTicker = (typeof MONEY_MARKET_SLEEVE_TICKERS)[number];

export function assertMoneyMarketSleeveTicker(ticker: string): MoneyMarketSleeveTicker {
  if (ticker === 'LQDT' || ticker === 'SBMM') return ticker;
  throw new Error('cash sleeve ticker must be LQDT or SBMM');
}
export const LQDT_SLEEVE_DEFAULT_COSTS = costScenarios.investorBase;
const DEFAULT_COSTS = LQDT_SLEEVE_DEFAULT_COSTS;

export function moscowCalendarDay(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(at);
}

function assertMoney(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and > 0`);
}

function buyUnits(principal: number, price: number, costs: Costs): number {
  return principal / (price * (1 + costs.slippage) * (1 + costs.commission));
}

function sellProceeds(units: number, price: number, costs: Costs): number {
  return units * price * (1 - costs.slippage) * (1 - costs.commission);
}

export function emptyLqdtSleeve(cash = 1_000_000): LqdtSleeveState {
  assertMoney('cash', cash);
  return { status: 'empty', cash };
}

/** Continuous-hold cash sleeve: one open, MTM marks, no churn while open. */
export function applyLqdtSleeve(state: LqdtSleeveState, event: LqdtSleeveEvent): LqdtSleeveResult {
  if (event.type === 'open') {
    assertMoney('openPrice', event.openPrice);
    assertMoney('principal', event.principal);
    if (state.status === 'open') {
      return { ok: false, state, refused: 'sleeve-already-open-no-churn' };
    }
    if (event.principal > state.cash + 1e-9) {
      return { ok: false, state, refused: 'insufficient-cash' };
    }
    const costs = event.costs ?? DEFAULT_COSTS;
    const units = buyUnits(event.principal, event.openPrice, costs);
    const markedEquity = sellProceeds(units, event.openPrice, costs);
    return {
      ok: true,
      state: {
        status: 'open',
        role: 'cash_sleeve',
        entryDay: event.day,
        entryPrice: event.openPrice,
        units,
        principal: event.principal,
        costs,
        lastMarkDay: event.day,
        lastMarkPrice: event.openPrice,
        markedEquity,
      },
    };
  }

  if (event.type === 'mark') {
    assertMoney('markPrice', event.markPrice);
    if (state.status !== 'open') {
      return { ok: false, state, refused: 'no-open-sleeve-to-mark' };
    }
    if (event.day < state.lastMarkDay) {
      return { ok: false, state, refused: 'mark-day-before-last-mark' };
    }
    const markedEquity = sellProceeds(state.units, event.markPrice, state.costs);
    return {
      ok: true,
      state: {
        ...state,
        lastMarkDay: event.day,
        lastMarkPrice: event.markPrice,
        markedEquity,
      },
    };
  }

  assertMoney('closePrice', event.closePrice);
  if (state.status !== 'open') {
    return { ok: false, state, refused: 'no-open-sleeve-to-close' };
  }
  const cash = sellProceeds(state.units, event.closePrice, state.costs);
  return { ok: true, state: { status: 'empty', cash } };
}

export function lqdtSleeveNetReturnPct(state: Extract<LqdtSleeveState, { status: 'open' }>): number {
  return eventReturnPct(state.entryPrice, state.lastMarkPrice, state.costs);
}
