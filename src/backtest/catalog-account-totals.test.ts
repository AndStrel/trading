import { describe, expect, it } from 'vitest';
import { catalogAccountTotals, type CatalogAccountTrade } from './catalog-account-totals.js';

const trade = (date: string, netNano: string): CatalogAccountTrade => ({
  entryAt: `${date}T10:00:00.000Z`, status: 'closed', netNano,
});

describe('catalog model account totals', () => {
  it('keeps transaction wins separate from a monthly account loss', () => {
    const result = catalogAccountTotals([trade('2025-08-01', '1000000000')], 390);
    expect(result.winningTrades).toBe(1);
    expect(result.tradeNetNano).toBe('1000000000');
    expect(result.serviceFeeNano).toBe('390000000000');
    expect(result.accountNetNano).toBe('-389000000000');
    expect(result.withoutFiveBestAccountNetNano).toBe('-390000000000');
  });
  it('charges each original active month once, including unresolved entries', () => {
    const result = catalogAccountTotals([
      trade('2025-08-01', '1000000000000'), trade('2025-08-04', '-1'),
      trade('2025-09-01', '1'),
      { entryAt: '2026-01-05T10:00:00.000Z', status: 'unresolved', netNano: null },
    ], 390);
    expect(result.activeMonths).toEqual(['2025-08', '2025-09', '2026-01']);
    expect(result.serviceFeeNano).toBe('1170000000000');
    expect(result.accountNetNano).toBe('-170000000000');
    expect(result.unresolvedTrades).toBe(1);
    expect(result.netScope).toBe('closed-modeled-trades-only');
    expect(result.unresolvedNetExcluded).toBe(true);
    expect(result.periods.map(period => period.accountNetNano)).toEqual(['220000000000', '-390000000000']);
  });
  it('removes exactly five best closed trades using integer ordering', () => {
    const result = catalogAccountTotals([
      ...['1', '2', '3', '4', '5', '6'].map(value => trade('2026-01-05', value)),
      trade('2026-01-05', '-1'), trade('2026-01-05', '0'),
    ], 0);
    expect(result.withoutFiveBestTradeNetNano).toBe('0');
    expect(result.winningTrades).toBe(6);
    expect(result.closedTrades).toBe(8);
    expect(result.entryDates).toBe(1);
  });
  it('empty months never incur a fabricated fee or positive period', () => {
    const result = catalogAccountTotals([], 390);
    expect(result.serviceFeeNano).toBe('0');
    expect(result.periods.every(period => period.accountNetNano === '0')).toBe(true);
  });
  it.each(['2025-07-31', '2026-09-27', '2027-01-01'])('rejects out-of-protocol date %s', date => {
    expect(() => catalogAccountTotals([trade(date, '1')], 0)).toThrow('frozen');
  });
  it.each(['1.1', '1e9', '', '01', '1'.repeat(31)])('rejects invalid net %s', value => {
    expect(() => catalogAccountTotals([trade('2026-01-05', value)], 0)).toThrow('nanorubles');
  });
  it('rejects fabricated unresolved net and unknown closed net', () => {
    expect(() => catalogAccountTotals([{ ...trade('2026-01-05', '1'), status: 'unresolved' }], 0)).toThrow();
    expect(() => catalogAccountTotals([{ ...trade('2026-01-05', '1'), netNano: null }], 0)).toThrow();
  });
});
