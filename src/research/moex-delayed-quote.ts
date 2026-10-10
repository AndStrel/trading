export type DelayedMoexQuote = {
  source: 'moex-iss-delayed';
  instrumentId: string;
  observedAt: string;
  exchangeDate: string;
  exchangeUpdateTime: string;
  serverTime: string;
  bid: number;
  ask: number;
  spreadPct: number;
};

export function parseDelayedMoexQuote(input: {
  instrumentId: string;
  observedAt: string;
  payload: unknown;
}): DelayedMoexQuote | null {
  if (typeof input.payload !== 'object' || input.payload === null) return null;
  const marketdata = (input.payload as { marketdata?: unknown }).marketdata;
  if (typeof marketdata !== 'object' || marketdata === null) return null;
  const table = marketdata as { columns?: unknown; data?: unknown };
  if (!Array.isArray(table.columns) || !Array.isArray(table.data) || table.data.length !== 1) return null;
  const columns = table.columns as string[];
  const row = table.data[0];
  if (!Array.isArray(row)) return null;
  const field = (name: string): unknown => row[columns.indexOf(name)];
  const bid = field('BID');
  const ask = field('OFFER');
  const exchangeDate = field('TRADEDATE');
  const exchangeUpdateTime = field('UPDATETIME');
  const serverTime = field('SYSTIME');
  if (field('SECID') !== input.instrumentId ||
      typeof bid !== 'number' || typeof ask !== 'number' ||
      !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= bid ||
      typeof exchangeDate !== 'string' || typeof exchangeUpdateTime !== 'string' ||
      typeof serverTime !== 'string' || !Number.isFinite(Date.parse(input.observedAt))) return null;
  return {
    source: 'moex-iss-delayed',
    instrumentId: input.instrumentId,
    observedAt: input.observedAt,
    exchangeDate,
    exchangeUpdateTime,
    serverTime,
    bid,
    ask,
    spreadPct: ((ask - bid) / ((ask + bid) / 2)) * 100,
  };
}
