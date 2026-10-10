export type DelayedStockQuote = {
  ticker: 'TMON' | 'TGLD' | 'T';
  board: 'TQBR';
  observedAtUtc: string;
  sourceSystemTimeMsk: string;
  sourceUpdateTimeMsk: string;
  bid: number;
  ask: number;
  bidDepth: number | null;
  askDepth: number | null;
  spreadBps: number;
  source: 'MOEX_ISS_DELAYED';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function parseDelayedStockQuote(input: {
  ticker: DelayedStockQuote['ticker'];
  observedAtUtc: string;
  payload: unknown;
}): DelayedStockQuote | null {
  const { ticker, observedAtUtc, payload } = input;
  if (!Number.isFinite(Date.parse(observedAtUtc)) || !isRecord(payload) || !isRecord(payload.marketdata)) return null;
  const { columns, data } = payload.marketdata;
  if (!Array.isArray(columns) || !Array.isArray(data) || data.length !== 1 ||
      !columns.every((column) => typeof column === 'string') || !Array.isArray(data[0])) return null;
  const row = data[0] as unknown[];
  const value = (field: string) => row[columns.indexOf(field)];
  const bid = value('BID');
  const ask = value('OFFER');
  const sourceSystemTimeMsk = value('SYSTIME');
  const sourceUpdateTimeMsk = value('UPDATETIME');
  if (value('SECID') !== ticker || value('BOARDID') !== 'TQBR' || value('TRADINGSTATUS') !== 'T' ||
      !finitePositive(bid) || !finitePositive(ask) || bid >= ask ||
      typeof sourceSystemTimeMsk !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sourceSystemTimeMsk) ||
      typeof sourceUpdateTimeMsk !== 'string' || !/^\d{2}:\d{2}:\d{2}$/.test(sourceUpdateTimeMsk)) return null;
  const bidDepthRaw = value('BIDDEPTH');
  const askDepthRaw = value('OFFERDEPTH');
  const bidDepth = finitePositive(bidDepthRaw) ? bidDepthRaw : null;
  const askDepth = finitePositive(askDepthRaw) ? askDepthRaw : null;
  return { ticker, board: 'TQBR', observedAtUtc, sourceSystemTimeMsk, sourceUpdateTimeMsk,
    bid, ask, bidDepth, askDepth, spreadBps: (ask - bid) / ((ask + bid) / 2) * 10_000,
    source: 'MOEX_ISS_DELAYED' };
}
