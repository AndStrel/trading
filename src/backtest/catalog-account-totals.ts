const RUB = 1_000_000_000n;

export type CatalogAccountTrade = {
  entryAt: string;
  status: 'closed' | 'unresolved';
  netNano: string | null;
};

export type CatalogAccountTotals = {
  assumption: 'calendar-month-with-entry-not-actual-billing';
  netScope: 'closed-modeled-trades-only';
  unresolvedNetExcluded: boolean;
  monthlyFeeRub: 0 | 390;
  activeMonths: string[];
  closedTrades: number;
  unresolvedTrades: number;
  winningTrades: number;
  entryDates: number;
  tradeNetNano: string;
  serviceFeeNano: string;
  accountNetNano: string;
  withoutFiveBestTradeNetNano: string;
  withoutFiveBestAccountNetNano: string;
  periods: Array<{ year: '2025' | '2026'; tradeNetNano: string; serviceFeeNano: string; accountNetNano: string }>;
};

function net(value: string): bigint {
  if (!/^-?(0|[1-9]\d{0,29})$/.test(value)) throw new Error('Invalid modeled net nanorubles');
  return BigInt(value);
}

/** Account-level approximation, never a broker cash-flow reconciliation. */
export function catalogAccountTotals(
  trades: readonly CatalogAccountTrade[], monthlyFeeRub: 0 | 390,
): CatalogAccountTotals {
  if ((monthlyFeeRub !== 0 && monthlyFeeRub !== 390) || trades.length > 1_000_000) {
    throw new Error('Unsupported model fee or bounded trade count');
  }
  const months = new Set<string>();
  const dates = new Set<string>();
  const values: bigint[] = [];
  const byYear = new Map<string, bigint>([['2025', 0n], ['2026', 0n]]);
  let unresolved = 0;
  for (const trade of trades) {
    const time = Date.parse(trade.entryAt);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== trade.entryAt
      || time < Date.parse('2025-08-01T00:00:00.000Z') || time >= Date.parse('2026-09-27T00:00:00.000Z')) {
      throw new Error('Trade is outside the frozen catalog replay period');
    }
    months.add(trade.entryAt.slice(0, 7));
    dates.add(trade.entryAt.slice(0, 10));
    if (trade.status === 'unresolved') {
      if (trade.netNano !== null) throw new Error('Unresolved trade cannot have a final net');
      unresolved += 1;
    } else if (trade.status === 'closed' && trade.netNano !== null) {
      const value = net(trade.netNano);
      values.push(value);
      const year = trade.entryAt.slice(0, 4);
      byYear.set(year, byYear.get(year)! + value);
    } else {
      throw new Error('A closed trade requires known modeled net');
    }
  }
  const activeMonths = [...months].sort();
  const tradeNet = values.reduce((sum, value) => sum + value, 0n);
  const monthlyFee = BigInt(monthlyFeeRub) * RUB;
  const serviceFee = BigInt(months.size) * monthlyFee;
  const bestFive = [...values].sort((a, b) => a > b ? -1 : a < b ? 1 : 0)
    .slice(0, 5).reduce((sum, value) => sum + value, 0n);
  return {
    assumption: 'calendar-month-with-entry-not-actual-billing', netScope: 'closed-modeled-trades-only',
    unresolvedNetExcluded: unresolved > 0, monthlyFeeRub, activeMonths,
    closedTrades: values.length, unresolvedTrades: unresolved,
    winningTrades: values.filter(value => value > 0n).length, entryDates: dates.size,
    tradeNetNano: tradeNet.toString(), serviceFeeNano: serviceFee.toString(),
    accountNetNano: (tradeNet - serviceFee).toString(),
    withoutFiveBestTradeNetNano: (tradeNet - bestFive).toString(),
    // Charges remain on the original cohort, not silently removed with its best trades.
    withoutFiveBestAccountNetNano: (tradeNet - bestFive - serviceFee).toString(),
    periods: (['2025', '2026'] as const).map(year => {
      const periodFee = BigInt(activeMonths.filter(month => month.startsWith(year)).length) * monthlyFee;
      return { year, tradeNetNano: byYear.get(year)!.toString(), serviceFeeNano: periodFee.toString(),
        accountNetNano: (byYear.get(year)! - periodFee).toString() };
    }),
  };
}
