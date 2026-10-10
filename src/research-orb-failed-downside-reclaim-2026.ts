import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import { MarketDataStore } from './history/market-data-store.js';
import { getMoexEquities2026SessionSchedule } from './backtest/orb-rvol-calendar.js';
import {
  collectFailedDownsideReclaims,
  FAILED_DOWNSIDE_RECLAIM_COSTS,
  ORB_FAILED_DOWNSIDE_RECLAIM_ID,
  type FailedDownsideReclaimEvent,
} from './research/orb-failed-downside-reclaim.js';

const FROZEN_ARCHIVE_SHA256 = '071a696ec0319ab49b4d826b4c1784db161e9610ccdee922f756cc3c18ffe194';

function outcomeSummary(events: FailedDownsideReclaimEvent[], scenario: 'investor' | 'traderLike') {
  const trades = events.filter((event) => event.eligible[scenario]);
  const returns = trades.map((event) => event.exit[scenario].netReturnPct).filter((value): value is number => value !== null);
  const exits = trades.filter((event) => event.exit[scenario].netReturnPct !== null);
  return {
    eligibleTrades: trades.length,
    completedTrades: exits.length,
    netWinners: returns.filter((value) => value > 0).length,
    netWinRate: exits.length ? returns.filter((value) => value > 0).length / exits.length : null,
    meanNetReturnPct: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
    unresolvedTrades: trades.length - exits.length,
    exitReasons: trades.reduce<Record<string, number>>((counts, event) => {
      const reason = event.exit[scenario].reason;
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export function runFailedDownsideReclaim2026() {
  const config = loadConfig();
  const store = new MarketDataStore(config.marketDataPath);
  const archive = store.listArchiveImports(2026).find((item) => item.ticker === 'SBER');
  if (!archive || archive.storedCandleCount === 0) throw new Error('The SBER 2026 archive is required');
  if (archive.source !== 'moex') throw new Error('The frozen SBER 2026 protocol requires the MOEX archive');
  if (archive.archiveSha256 !== FROZEN_ARCHIVE_SHA256) throw new Error('SBER 2026 archive SHA-256 differs from the frozen protocol');
  if (archive.lotSize === null || archive.priceStep === null) throw new Error('SBER 2026 lot size and price step are required');

  const candles = store.listMinuteCandles({
    instrumentId: archive.instrumentId,
    from: '2026-01-01T00:00:00.000Z',
    to: '2027-01-01T00:00:00.000Z',
  });
  const report = collectFailedDownsideReclaims({
    ticker: 'SBER',
    instrumentId: archive.instrumentId,
    candles,
    priceStep: archive.priceStep,
    scheduleForSession: ({ sessionDate }) => getMoexEquities2026SessionSchedule({ sessionDate }),
  });
  return {
    status: 'ok' as const,
    strategyId: ORB_FAILED_DOWNSIDE_RECLAIM_ID,
    archive: {
      ticker: archive.ticker,
      instrumentId: archive.instrumentId,
      archiveSha256: archive.archiveSha256,
      storedCandleCount: archive.storedCandleCount,
      invalidRowCount: archive.invalidRowCount,
      lotSize: archive.lotSize,
      priceStep: archive.priceStep,
      importedAt: archive.importedAt,
    },
    costs: FAILED_DOWNSIDE_RECLAIM_COSTS,
    dataQuality: report.dataQuality,
    summaries: {
      investor: outcomeSummary(report.events, 'investor'),
      traderLike: outcomeSummary(report.events, 'traderLike'),
    },
    events: report.events,
  };
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    console.log(JSON.stringify(runFailedDownsideReclaim2026()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unknown failed-downside reclaim research error');
    process.exitCode = 1;
  }
}
