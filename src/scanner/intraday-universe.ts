import type { AppConfig, IntradayWatchlistItem } from '../config.js';
import { quotationToNumber, type Quotation } from '../domain/money.js';
import type { TInvestClient } from '../tbank/client.js';

// The broker API exposes instruments and their trading parameters, but does not expose a
// "top liquid shares" screener. This audited core avoids scanning every illiquid share while
// the API refresh keeps UID, lot and price increment current.
export const DEFAULT_MOEX_LIQUID_TICKERS = [
  'SBER',
  'SBERP',
  'GAZP',
  'LKOH',
  'ROSN',
  'NVTK',
  'TATN',
  'TATNP',
  'SNGS',
  'SNGSP',
  'GMKN',
  'PLZL',
  'CHMF',
  'NLMK',
  'MTSS',
  'MGNT',
  'MOEX',
  'AFLT',
  'ALRS',
  'HYDR',
  'IRAO',
  'RUAL',
  'PHOR',
  'RTKM',
  'TRNFP',
  'VTBR',
] as const;

export type ResolvedIntradayInstrument = IntradayWatchlistItem & {
  ticker: string;
  name?: string;
};

export type IntradayUniverseSnapshot = {
  source: 'moex-liquid' | 'watchlist';
  refreshedAt: string;
  requestedTickers: string[];
  missingTickers: string[];
  instruments: ResolvedIntradayInstrument[];
};

export type IntradayUniverseProvider = {
  getSnapshot(now: Date): Promise<IntradayUniverseSnapshot>;
};

type SharePayload = {
  uid?: unknown;
  ticker?: unknown;
  name?: unknown;
  classCode?: unknown;
  currency?: unknown;
  lot?: unknown;
  minPriceIncrement?: Quotation;
  apiTradeAvailableFlag?: unknown;
  forQualInvestorFlag?: unknown;
  otcFlag?: unknown;
  blockedTcaFlag?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function parseShares(payload: unknown): SharePayload[] {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.instruments)) {
    throw new Error('T-Invest shares response does not contain an instruments array');
  }

  return response.instruments.filter(
    (instrument): instrument is SharePayload => asRecord(instrument) !== null,
  );
}

function toResolvedInstrument(share: SharePayload): ResolvedIntradayInstrument | null {
  const uid = typeof share.uid === 'string' ? share.uid.trim() : '';
  const ticker = typeof share.ticker === 'string' ? share.ticker.trim().toUpperCase() : '';
  const classCode = typeof share.classCode === 'string' ? share.classCode.trim().toUpperCase() : '';
  const currency = typeof share.currency === 'string' ? share.currency.trim().toUpperCase() : '';
  const lotSize = typeof share.lot === 'number' ? share.lot : Number(share.lot);
  const priceStep = quotationToNumber(share.minPriceIncrement);

  if (
    !uid ||
    !ticker ||
    classCode !== 'TQBR' ||
    currency !== 'RUB' ||
    !Number.isInteger(lotSize) ||
    lotSize <= 0 ||
    priceStep === null ||
    priceStep <= 0 ||
    share.apiTradeAvailableFlag !== true ||
    share.forQualInvestorFlag === true ||
    share.otcFlag === true ||
    share.blockedTcaFlag === true
  ) {
    return null;
  }

  const name = typeof share.name === 'string' && share.name.trim() ? share.name.trim() : undefined;
  return {
    instrumentId: uid,
    label: ticker,
    ticker,
    ...(name ? { name } : {}),
    lotSize,
    priceStep,
  };
}

function watchlistSnapshot(config: AppConfig, now: Date): IntradayUniverseSnapshot {
  return {
    source: 'watchlist',
    refreshedAt: now.toISOString(),
    requestedTickers: config.scanner.intradayWatchlist.map((item) => item.label ?? item.instrumentId),
    missingTickers: [],
    instruments: config.scanner.intradayWatchlist.map((item) => ({
      ...item,
      ticker: item.label ?? item.instrumentId,
    })),
  };
}

export class TInvestIntradayUniverseProvider implements IntradayUniverseProvider {
  private cached: IntradayUniverseSnapshot | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly client: Pick<TInvestClient, 'getShares'>,
  ) {}

  async getSnapshot(now: Date): Promise<IntradayUniverseSnapshot> {
    if (this.config.scanner.universeMode === 'watchlist') {
      return watchlistSnapshot(this.config, now);
    }

    const refreshAgeMs = this.config.scanner.universeRefreshMinutes * 60_000;
    if (
      this.cached &&
      now.getTime() - new Date(this.cached.refreshedAt).getTime() < refreshAgeMs
    ) {
      return this.cached;
    }

    const requestedTickers =
      this.config.scanner.universeTickers.length > 0
        ? this.config.scanner.universeTickers
        : [...DEFAULT_MOEX_LIQUID_TICKERS];
    const shares = parseShares(await this.client.getShares());
    const byTicker = new Map<string, ResolvedIntradayInstrument>();

    for (const share of shares) {
      const instrument = toResolvedInstrument(share);
      if (instrument && !byTicker.has(instrument.ticker)) {
        byTicker.set(instrument.ticker, instrument);
      }
    }

    const instruments = requestedTickers
      .map((ticker) => byTicker.get(ticker))
      .filter((instrument): instrument is ResolvedIntradayInstrument => instrument !== undefined)
      .slice(0, this.config.scanner.maxInstruments);
    const presentTickers = new Set(instruments.map((instrument) => instrument.ticker));

    this.cached = {
      source: 'moex-liquid',
      refreshedAt: now.toISOString(),
      requestedTickers,
      missingTickers: requestedTickers.filter((ticker) => !presentTickers.has(ticker)),
      instruments,
    };
    return this.cached;
  }
}
