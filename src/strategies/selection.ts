import type { AppConfig } from '../config.js';
import type { JournalScenarioRecord, ScenarioJournal } from '../journal/scenario-journal.js';
import { DEFAULT_MOEX_LIQUID_TICKERS } from '../scanner/intraday-universe.js';
import { isTradingStrategyId, type TradingStrategyId } from './catalog.js';

export const tradingSelectionKey = 'trading.selection.v1';
export type TradingSelection = { strategyId: TradingStrategyId; revision: number; tickers: string[] };
export class SelectionConflictError extends Error {
  constructor() { super('Выбор уже изменён. Обнови экран и попробуй снова.'); }
}

export function parseTradingSelection(raw: string | null): TradingSelection | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as TradingSelection;
    if (!isTradingStrategyId(value.strategyId) || !Number.isSafeInteger(value.revision) || value.revision < 1
      || !Array.isArray(value.tickers) || value.tickers.length < 1 || value.tickers.length > 40
      || value.tickers.some(ticker => typeof ticker !== 'string' || !/^[A-Z0-9.-]{1,16}$/.test(ticker))
      || new Set(value.tickers).size !== value.tickers.length) throw new Error();
    return {strategyId:value.strategyId, revision:value.revision, tickers:[...value.tickers]};
  } catch { throw new Error('Stored trading selection is invalid; scanner is blocked'); }
}

export class TradingSelectionController {
  constructor(private readonly config: AppConfig, private readonly journal: ScenarioJournal) {
    const defaults = config.scanner.universeMode === 'watchlist'
      ? config.scanner.intradayWatchlist.map(item => (item.label ?? item.instrumentId).toUpperCase())
      : config.scanner.universeTickers.length ? config.scanner.universeTickers : [...DEFAULT_MOEX_LIQUID_TICKERS];
    // Empty watchlists are rejected by scanner.start(); retain a valid private state for diagnostics.
    const tickers = [...new Set(defaults.filter(ticker => /^[A-Z0-9.-]{1,16}$/.test(ticker)))].slice(0, config.scanner.maxInstruments);
    if (journal.getRuntimeState(tradingSelectionKey) === null && tickers.length) {
      journal.compareAndSetRuntimeState(tradingSelectionKey, null, JSON.stringify({strategyId:config.scanner.tradingStrategyId,revision:1,tickers}));
    }
  }

  availableTickers(): string[] {
    return [...new Set(this.config.scanner.universeMode === 'watchlist'
      ? this.config.scanner.intradayWatchlist.map(item => (item.label ?? item.instrumentId).toUpperCase()).filter(ticker => /^[A-Z0-9.-]{1,16}$/.test(ticker))
      : [...DEFAULT_MOEX_LIQUID_TICKERS, ...this.config.scanner.universeTickers])].sort();
  }

  get(): TradingSelection {
    const selection = parseTradingSelection(this.journal.getRuntimeState(tradingSelectionKey));
    if (!selection || selection.tickers.some(ticker => !this.availableTickers().includes(ticker))) {
      throw new Error('Trading selection is unavailable for this configuration');
    }
    return selection;
  }

  selectStrategy(strategyId: string, expectedRevision: number): void {
    if (!isTradingStrategyId(strategyId)) throw new Error('Неизвестная стратегия');
    this.update(expectedRevision, current => ({...current, strategyId}));
  }

  selectAssets(tickers: string[], expectedRevision: number): void {
    if (!Array.isArray(tickers) || !tickers.length || tickers.length > this.config.scanner.maxInstruments
      || tickers.some(ticker => typeof ticker !== 'string' || !this.availableTickers().includes(ticker))
      || new Set(tickers).size !== tickers.length) throw new Error('Неверный список активов');
    this.update(expectedRevision, current => ({...current, tickers:[...tickers].sort()}));
  }

  isCurrent(expected: TradingSelection): boolean { return JSON.stringify(this.get()) === JSON.stringify(expected); }

  private update(expectedRevision: number, change: (current:TradingSelection) => TradingSelection): void {
    const raw = this.journal.getRuntimeState(tradingSelectionKey);
    const current = this.get();
    if (!Number.isSafeInteger(expectedRevision) || current.revision !== expectedRevision) throw new SelectionConflictError();
    if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('Trading selection revision is exhausted');
    const next = {...change(current), revision:current.revision+1};
    if (!this.journal.compareAndSetRuntimeState(tradingSelectionKey, raw, JSON.stringify(next))) throw new SelectionConflictError();
  }
}

/** A selection change invalidates pending scanner entries, never reconciliation/exits. */
export function assertScenarioSelection(journal:ScenarioJournal, scenario:JournalScenarioRecord): {key:string;raw:string}|undefined {
  const snapshot = typeof scenario.snapshot === 'object' && scenario.snapshot !== null ? scenario.snapshot as Record<string,unknown> : {};
  if (snapshot.source !== 'intraday-scanner') return undefined;
  const raw = journal.getRuntimeState(tradingSelectionKey);
  if (raw === null) return undefined; // pre-migration journals remain compatible until scanner initializes selection.
  const active = parseTradingSelection(raw)!;
  const recorded = snapshot.tradingSelection as TradingSelection | undefined;
  const instrument = snapshot.instrument as {ticker?:unknown}|undefined;
  if (!recorded || recorded.strategyId !== active.strategyId || recorded.revision !== active.revision
    || typeof instrument?.ticker !== 'string' || !active.tickers.includes(instrument.ticker.toUpperCase())) {
    throw new Error('Trading selection changed; regenerate the candidate');
  }
  return {key:tradingSelectionKey, raw};
}
