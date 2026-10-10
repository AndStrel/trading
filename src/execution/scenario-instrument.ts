import type { AppConfig } from '../config.js';
import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { isTradingStrategyId } from '../strategies/catalog.js';
import { decimalPriceNano } from './sandbox-stop-state.js';

// Immutable server-resolved metadata belongs to the original position. Changing
// the UI selection must not change lot/tick or prevent an existing protective exit.
export function scenarioInstrument(config:AppConfig,scenario:JournalScenarioRecord) {
  const snapshot = typeof scenario.snapshot==='object' && scenario.snapshot!==null ? scenario.snapshot as Record<string,unknown> : {};
  const algorithm = snapshot.tradingStrategy as {id?:unknown}|undefined;
  const metadata = snapshot.instrument as {instrumentId?:unknown;lotSize?:unknown;priceStep?:unknown}|undefined;
  const versionedScanner = snapshot.source==='intraday-scanner' && algorithm!==undefined;
  if (versionedScanner && isTradingStrategyId(algorithm?.id) && metadata?.instrumentId===scenario.instrumentId
    && metadata.lotSize===scenario.input.lotSize && Number.isSafeInteger(metadata.lotSize)
    && scenario.input.lotSize>0
    && typeof metadata.priceStep==='number' && Number.isFinite(metadata.priceStep) && metadata.priceStep>0) {
    decimalPriceNano(metadata.priceStep);
    return {instrumentId:scenario.instrumentId,lotSize:scenario.input.lotSize,priceStep:metadata.priceStep};
  }
  if (versionedScanner) throw new Error('Original scanner instrument metadata is invalid');
  const items = config.scanner.intradayWatchlist.filter(item=>item.instrumentId===scenario.instrumentId);
  if (items.length!==1 || !items[0] || items[0].lotSize!==scenario.input.lotSize) throw new Error('Original instrument lot and price tick are unavailable');
  return {instrumentId:scenario.instrumentId,lotSize:scenario.input.lotSize,priceStep:items[0].priceStep};
}
