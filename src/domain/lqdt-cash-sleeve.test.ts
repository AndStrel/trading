import { describe, expect, it } from 'vitest';
import {
  applyLqdtSleeve,
  assertMoneyMarketSleeveTicker,
  emptyLqdtSleeve,
  lqdtSleeveNetReturnPct,
  moscowCalendarDay,
} from './lqdt-cash-sleeve.js';

describe('lqdt cash sleeve', () => {
  it('opens once, marks MTM, and refuses churn while open', () => {
    const empty = emptyLqdtSleeve(1_000_000);
    const opened = applyLqdtSleeve(empty, {
      type: 'open',
      day: '2025-01-06',
      openPrice: 100,
      principal: 1_000_000,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok || opened.state.status !== 'open') throw new Error('expected open');
    expect(opened.state.role).toBe('cash_sleeve');
    expect(opened.state.units).toBeLessThan(10_000);

    const churn = applyLqdtSleeve(opened.state, {
      type: 'open',
      day: '2025-01-13',
      openPrice: 101,
      principal: 100_000,
    });
    expect(churn).toEqual({
      ok: false,
      state: opened.state,
      refused: 'sleeve-already-open-no-churn',
    });

    const marked = applyLqdtSleeve(opened.state, {
      type: 'mark',
      day: '2025-06-30',
      markPrice: 110,
    });
    expect(marked.ok).toBe(true);
    if (!marked.ok || marked.state.status !== 'open') throw new Error('expected mark');
    expect(lqdtSleeveNetReturnPct(marked.state)).toBeGreaterThan(0);

    const closed = applyLqdtSleeve(marked.state, {
      type: 'close',
      day: '2025-12-30',
      closePrice: 110,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok || closed.state.status !== 'empty') throw new Error('expected empty');
    expect(closed.state.cash).toBeGreaterThan(1_000_000);
  });

  it('allows only LQDT and SBMM as cash-sleeve tickers', () => {
    expect(assertMoneyMarketSleeveTicker('SBMM')).toBe('SBMM');
    expect(() => assertMoneyMarketSleeveTicker('SBER')).toThrow('cash sleeve ticker');
  });

  it('formats the Moscow calendar day as YYYY-MM-DD', () => {
    expect(moscowCalendarDay(new Date('2026-09-29T21:30:00Z'))).toBe('2026-09-30');
  });

  it('refuses open when principal exceeds cash', () => {
    const result = applyLqdtSleeve(emptyLqdtSleeve(50_000), {
      type: 'open',
      day: '2025-01-06',
      openPrice: 100,
      principal: 50_001,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refuse');
    expect(result.refused).toBe('insufficient-cash');
  });
});
