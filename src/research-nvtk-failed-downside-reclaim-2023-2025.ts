import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import { MarketDataStore, type HistoricalMinuteCandle } from './history/market-data-store.js';
import {
  collectFailedDownsideReclaims,
  FAILED_DOWNSIDE_RECLAIM_COSTS,
  type FailedDownsideReclaimEvent,
} from './research/orb-failed-downside-reclaim.js';
import { getMoexNvtkOrdinaryWeekdaySchedule } from './research/nvtk-failed-break-calendar.js';

export const NVTK_FAILED_BREAK_TRANSFER_ID = 'orb-failed-downside-reclaim-nvtk-transfer-2023-2025-v1' as const;

const EXPECTED_ARCHIVE_SHA256: Record<number, string> = {
  2023: 'd9a209720bb861ff0cd0d46c54f6d32bb6b9c2a3d504aec6ea7b69056b5f0317',
  2024: 'ff0b6dbe4ae6be5b93930545ffea848d150f67bfb3b3ba476e1f80a6672ea587',
  2025: '10b03ac3e6d7f7a6c54bc6255f4eed317d6e5e3c301d6c6fe7f7e095f12aed73',
};

function summarize(events: FailedDownsideReclaimEvent[], scenario: 'investor' | 'traderLike') {
  const signals = events;
  const eligible = signals.filter((event) => event.eligible[scenario]);
  const completedSignals = signals.filter((event) => event.exit[scenario].netReturnPct !== null);
  const completedEligible = eligible.filter((event) => event.exit[scenario].netReturnPct !== null);
  const netReturns = (items: FailedDownsideReclaimEvent[]) => items.map((event) => event.exit[scenario].netReturnPct)
    .filter((value): value is number => value !== null);
  const diagnostic = netReturns(completedSignals);
  const accepted = netReturns(completedEligible);
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    signals: signals.length,
    eligibleTrades: eligible.length,
    completedEligibleTrades: accepted.length,
    eligibleNetWinners: accepted.filter((value) => value > 0).length,
    eligibleNetWinRate: accepted.length ? accepted.filter((value) => value > 0).length / accepted.length : null,
    eligibleMeanNetPct: mean(accepted),
    diagnosticCompletedSignals: completedSignals.length,
    diagnosticNetWinners: diagnostic.filter((value) => value > 0).length,
    diagnosticNetWinRate: diagnostic.length ? diagnostic.filter((value) => value > 0).length / diagnostic.length : null,
    diagnosticMeanNetPct: mean(diagnostic),
    diagnosticGrossMeanPct: mean(completedSignals.map((event) => event.exit[scenario].marketReturnPct)
      .filter((value): value is number => value !== null)),
    exitReasons: completedSignals.reduce<Record<string, number>>((counts, event) => {
      const reason = event.exit[scenario].reason;
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {}),
  };
}

export function runNvtkFailedDownsideReclaimTransfer() {
  const config = loadConfig();
  const store = new MarketDataStore(config.marketDataPath);
  const archives: Array<{
    year: number;
    instrumentId: string;
    archiveSha256: string;
    storedCandleCount: number;
    invalidRowCount: number;
    lotSize: number | null;
    priceStep: number | null;
    source: string;
  }> = [];
  const candles: HistoricalMinuteCandle[] = [];
  for (const year of [2023, 2024, 2025]) {
    const archive = store.listArchiveImports(year).find((item) => item.ticker === 'NVTK');
    if (!archive || archive.storedCandleCount === 0) throw new Error(`NVTK ${year} archive is required`);
    if (archive.source !== 'moex') throw new Error(`NVTK ${year} archive must use MOEX candles`);
    if (archive.archiveSha256 !== EXPECTED_ARCHIVE_SHA256[year]) throw new Error(`NVTK ${year} archive SHA-256 differs from the frozen protocol`);
    if (archive.lotSize === null || archive.priceStep === null) throw new Error(`NVTK ${year} metadata is incomplete`);
    archives.push({
      year,
      instrumentId: archive.instrumentId,
      archiveSha256: archive.archiveSha256,
      storedCandleCount: archive.storedCandleCount,
      invalidRowCount: archive.invalidRowCount,
      lotSize: archive.lotSize,
      priceStep: archive.priceStep,
      source: archive.source,
    });
    const yearCandles = store.listMinuteCandles({
      instrumentId: archive.instrumentId,
      from: `${year}-01-01T00:00:00.000Z`,
      to: `${year + 1}-01-01T00:00:00.000Z`,
    });
    for (const candle of yearCandles) candles.push(candle);
  }

  const report = collectFailedDownsideReclaims({
    ticker: 'NVTK',
    instrumentId: archives[0]!.instrumentId,
    candles,
    priceStep: archives[0]!.priceStep!,
    scheduleForSession: ({ sessionDate }) => getMoexNvtkOrdinaryWeekdaySchedule({ sessionDate }),
  });
  const byYear = (year: number) => report.events.filter((event) => event.sessionDate.startsWith(`${year}-`));
  return {
    status: 'ok' as const,
    strategyId: NVTK_FAILED_BREAK_TRANSFER_ID,
    costs: FAILED_DOWNSIDE_RECLAIM_COSTS,
    archives,
    dataQuality: report.dataQuality,
    summaries: {
      investor: summarize(report.events, 'investor'),
      traderLike: summarize(report.events, 'traderLike'),
      byYear: Object.fromEntries([2023, 2024, 2025].map((year) => [year, {
        investor: summarize(byYear(year), 'investor'),
        traderLike: summarize(byYear(year), 'traderLike'),
      }])),
    },
    events: report.events,
  };
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  try {
    console.log(JSON.stringify(runNvtkFailedDownsideReclaimTransfer()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unknown NVTK failed-downside reclaim transfer error');
    process.exitCode = 1;
  }
}
