import { createHash } from 'node:crypto';

import type { HistoricalMinuteCandle } from '../history/market-data-store.js';
import type { FetchLike } from '../tbank/client.js';

export type MoexInstrument = {
  ticker: string;
  instrumentId: string;
  lotSize: number;
  priceStep: number;
};

export type MoexMinuteHistory = MoexInstrument & {
  archiveSha256: string;
  candles: HistoricalMinuteCandle[];
  rawRowCount: number;
  invalidRowCount: number;
  duplicateRowCount: number;
};

export type MoexIssHistoryClientOptions = {
  fetchImpl?: FetchLike;
  retryAttempts?: number;
  retryDelayMs?: number;
  pageDelayMs?: number;
  requestTimeoutMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

type IssBlock = {
  columns?: unknown;
  data?: unknown;
};

const defaultBaseUrl = 'https://iss.moex.com/iss';
const defaultRetryAttempts = 3;
const defaultRetryDelayMs = 500;
const defaultRequestTimeoutMs = 30_000;
const maxPages = 2_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function parseBlock(payload: unknown, name: string): { columns: string[]; data: unknown[][] } {
  const record = asRecord(payload);
  const block = asRecord(record?.[name]) as IssBlock | null;
  if (!block || !Array.isArray(block.columns) || !Array.isArray(block.data)) {
    throw new Error(`MOEX ISS response does not contain a valid ${name} block`);
  }
  const columns = block.columns.map((column) => (typeof column === 'string' ? column.toUpperCase() : ''));
  if (columns.some((column) => !column)) throw new Error(`MOEX ISS ${name} columns are invalid`);
  const data = block.data.filter((row): row is unknown[] => Array.isArray(row));
  if (data.length !== block.data.length) throw new Error(`MOEX ISS ${name} rows are invalid`);
  return { columns, data };
}

function columnIndex(columns: readonly string[], name: string): number {
  const index = columns.indexOf(name);
  if (index < 0) throw new Error(`MOEX ISS response is missing ${name} column`);
  return index;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseMoexTime(value: unknown, year: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  if (!match || Number(match[1]) !== year) return null;
  // MOEX ISS candle timestamps are Moscow exchange time. Since the supported
  // fallback range starts after 2014, Europe/Moscow is UTC+03 without DST.
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isValidCandle(candle: HistoricalMinuteCandle): boolean {
  return (
    candle.open > 0 &&
    candle.high > 0 &&
    candle.low > 0 &&
    candle.close > 0 &&
    candle.high >= candle.low &&
    candle.open >= candle.low &&
    candle.open <= candle.high &&
    candle.close >= candle.low &&
    candle.close <= candle.high &&
    Number.isSafeInteger(candle.volume) &&
    candle.volume >= 0
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export class MoexIssHistoryClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: FetchLike;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly pageDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(baseUrl = defaultBaseUrl, options: MoexIssHistoryClientOptions = {}) {
    this.baseUrl = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (this.baseUrl.protocol !== 'https:') throw new Error('MOEX ISS base URL must use HTTPS');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryAttempts = Math.max(1, Math.floor(options.retryAttempts ?? defaultRetryAttempts));
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? defaultRetryDelayMs);
    this.pageDelayMs = Math.max(0, options.pageDelayMs ?? 100);
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? defaultRequestTimeoutMs);
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  private async getJson(path: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(path.replace(/^\//, ''), this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json', 'User-Agent': 'AndStrel.trading-mcp' },
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < this.retryAttempts) {
            await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
            continue;
          }
          throw new Error(`MOEX ISS HTTP ${response.status}`);
        }
        return (await response.json()) as unknown;
      } catch (error) {
        if (attempt < this.retryAttempts) {
          await this.sleep(this.retryDelayMs * 2 ** (attempt - 1));
          continue;
        }
        const detail = error instanceof Error ? error.message : 'unknown network failure';
        throw new Error(`MOEX ISS request failed: ${detail}`);
      }
    }
    throw new Error('MOEX ISS request exhausted retry attempts');
  }

  async getInstrument(ticker: string): Promise<MoexInstrument> {
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,16}$/.test(normalizedTicker)) throw new Error('MOEX ticker is invalid');
    const payload = await this.getJson(
      `engines/stock/markets/shares/boards/TQBR/securities/${encodeURIComponent(normalizedTicker)}.json`,
      {
        'iss.meta': 'off',
        'iss.only': 'securities',
        'securities.columns': 'SECID,LOTSIZE,MINSTEP',
      },
    );
    const block = parseBlock(payload, 'securities');
    const secIdIndex = columnIndex(block.columns, 'SECID');
    const lotSizeIndex = columnIndex(block.columns, 'LOTSIZE');
    const priceStepIndex = columnIndex(block.columns, 'MINSTEP');
    const row = block.data.find((candidate) => candidate[secIdIndex] === normalizedTicker);
    const lotSize = finiteNumber(row?.[lotSizeIndex]);
    const priceStep = positiveNumber(row?.[priceStepIndex]);
    if (!row || lotSize === null || !Number.isSafeInteger(lotSize) || lotSize <= 0 || priceStep === null) {
      throw new Error(`MOEX ISS did not return valid TQBR metadata for ${normalizedTicker}`);
    }
    return {
      ticker: normalizedTicker,
      instrumentId: `MOEX:TQBR:${normalizedTicker}`,
      lotSize,
      priceStep,
    };
  }

  async getMinuteHistory(ticker: string, year: number): Promise<MoexMinuteHistory> {
    const currentYear = new Date().getUTCFullYear();
    if (!Number.isInteger(year) || year < 2015 || year > currentYear) {
      throw new Error(`MOEX ISS fallback year must be an integer from 2015 through ${currentYear}`);
    }
    const instrument = await this.getInstrument(ticker);
    const candlesByTime = new Map<string, HistoricalMinuteCandle>();
    let rawRowCount = 0;
    let invalidRowCount = 0;
    let duplicateRowCount = 0;
    let start = 0;
    let completed = false;

    for (let page = 0; page < maxPages; page += 1) {
      const payload = await this.getJson(
        `engines/stock/markets/shares/boards/TQBR/securities/${encodeURIComponent(instrument.ticker)}/candles.json`,
        {
          'iss.meta': 'off',
          'iss.only': 'candles',
          'candles.columns': 'open,close,high,low,volume,begin',
          interval: '1',
          from: `${year}-01-01 00:00:00`,
          till: `${year}-12-31 23:59:59`,
          start: String(start),
        },
      );
      const block = parseBlock(payload, 'candles');
      if (block.data.length === 0) {
        completed = true;
        break;
      }
      const openIndex = columnIndex(block.columns, 'OPEN');
      const closeIndex = columnIndex(block.columns, 'CLOSE');
      const highIndex = columnIndex(block.columns, 'HIGH');
      const lowIndex = columnIndex(block.columns, 'LOW');
      const volumeIndex = columnIndex(block.columns, 'VOLUME');
      const beginIndex = columnIndex(block.columns, 'BEGIN');

      rawRowCount += block.data.length;
      for (const row of block.data) {
        const time = parseMoexTime(row[beginIndex], year);
        const open = positiveNumber(row[openIndex]);
        const close = positiveNumber(row[closeIndex]);
        const high = positiveNumber(row[highIndex]);
        const low = positiveNumber(row[lowIndex]);
        const volume = finiteNumber(row[volumeIndex]);
        if (time === null || open === null || close === null || high === null || low === null || volume === null) {
          invalidRowCount += 1;
          continue;
        }
        const candle: HistoricalMinuteCandle = {
          instrumentId: instrument.instrumentId,
          time,
          open,
          high,
          low,
          close,
          volume,
        };
        if (!isValidCandle(candle)) {
          invalidRowCount += 1;
          continue;
        }
        if (candlesByTime.has(time)) duplicateRowCount += 1;
        candlesByTime.set(time, candle);
      }
      start += block.data.length;
      if (this.pageDelayMs > 0) await this.sleep(this.pageDelayMs);
    }

    if (!completed) throw new Error(`MOEX ISS pagination exceeded ${maxPages} pages`);
    const candles = [...candlesByTime.values()].sort((left, right) => left.time.localeCompare(right.time));
    if (candles.length === 0) throw new Error(`MOEX ISS returned no valid minute candles for ${instrument.ticker} in ${year}`);
    const digest = createHash('sha256');
    digest.update(`moex-iss:TQBR:${instrument.ticker}:${year}\n`);
    for (const candle of candles) {
      digest.update(`${candle.time},${candle.open},${candle.high},${candle.low},${candle.close},${candle.volume}\n`);
    }

    return {
      ...instrument,
      archiveSha256: digest.digest('hex'),
      candles,
      rawRowCount,
      invalidRowCount,
      duplicateRowCount,
    };
  }
}
