import type { AppConfig } from '../config.js';
import { analyzeCandles, type CandleAnalysis } from '../domain/candle-analysis.js';
import { proposeIntradayLong } from '../domain/intraday-proposal.js';
import { assessTradeScenario } from '../domain/trade-scenario.js';
import { calculateTradePlan } from '../domain/trade-plan.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { TInvestClient } from '../tbank/client.js';
import {
  TInvestIntradayUniverseProvider,
  type IntradayUniverseProvider,
  type IntradayUniverseSnapshot,
  type ResolvedIntradayInstrument,
} from './intraday-universe.js';

export type IntradayScanEvent = {
  instrumentId: string;
  observedAt: string;
  status: 'paused' | 'skipped' | 'candidate-recorded' | 'candidate-suppressed' | 'error';
  reasons: string[];
  scenarioId?: number;
};

export type IntradayMarketRanking = {
  ticker: string;
  instrumentId: string;
  score: number;
  trend: CandleAnalysis['trend'];
  relativeVolume: number | null;
  averageCandleTurnoverRub: number | null;
  candidateReady: boolean;
  reasons: string[];
};

export type IntradayScanReport = {
  observedAt: string;
  universe: {
    source: IntradayUniverseSnapshot['source'];
    refreshedAt: string;
    requested: number;
    active: number;
    missingTickers: string[];
  };
  scanned: number;
  liquid: number;
  trendUp: number;
  volumeConfirmed: number;
  readyForMarketCheck: number;
  marketCandidates: number;
  recordedCandidates: number;
  errors: number;
  topRanked: IntradayMarketRanking[];
};

export type IntradayScanEventListener = (event: IntradayScanEvent) => void | Promise<void>;

type CandidateEvaluation = {
  instrument: ResolvedIntradayInstrument;
  ranking: IntradayMarketRanking;
  candleAnalysis: CandleAnalysis;
  proposal: NonNullable<ReturnType<typeof proposeIntradayLong>>;
  tradePlan: ReturnType<typeof calculateTradePlan>;
  assessment: ReturnType<typeof assessTradeScenario>;
};

type InstrumentScanResult = {
  ranking: IntradayMarketRanking;
  liquid: boolean;
  trendUp: boolean;
  volumeConfirmed: boolean;
  readyForMarketCheck: boolean;
  candidate?: CandidateEvaluation;
  event?: IntradayScanEvent;
};

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatRub(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000_000) return `${round(value / 1_000_000)} млн ₽`;
  if (value >= 1_000) return `${round(value / 1_000)} тыс. ₽`;
  return `${round(value)} ₽`;
}

function averageCandleTurnoverRub(
  candleAnalysis: CandleAnalysis,
  instrument: ResolvedIntradayInstrument,
): number | null {
  if (
    candleAnalysis.averageVolume20 === null ||
    candleAnalysis.latestClose === null ||
    candleAnalysis.averageVolume20 <= 0 ||
    candleAnalysis.latestClose <= 0
  ) {
    return null;
  }
  return candleAnalysis.averageVolume20 * candleAnalysis.latestClose * instrument.lotSize;
}

function scoreScreening(input: {
  candleAnalysis: CandleAnalysis;
  averageTurnoverRub: number | null;
  minTurnoverRub: number;
}): number {
  const { candleAnalysis, averageTurnoverRub, minTurnoverRub } = input;
  if (candleAnalysis.status !== 'ok') return 0;

  const trendScore =
    candleAnalysis.trend === 'up' ? 40 : candleAnalysis.trend === 'flat' ? 15 : 0;
  const relativeVolume = candleAnalysis.relativeVolume ?? 0;
  const volumeScore = Math.min(30, Math.max(0, (relativeVolume - 0.5) * 30));
  const turnoverScore =
    averageTurnoverRub !== null && averageTurnoverRub >= minTurnoverRub
      ? Math.min(20, 10 + Math.log10(averageTurnoverRub / minTurnoverRub) * 10)
      : 0;
  const volatility = candleAnalysis.volatilityPct ?? 0;
  const volatilityScore = volatility >= 0.03 && volatility <= 2 ? 10 : 0;

  return Math.round(Math.min(100, trendScore + volumeScore + turnoverScore + volatilityScore));
}

function screeningReasons(input: {
  candleAnalysis: CandleAnalysis;
  averageTurnoverRub: number | null;
  minTurnoverRub: number;
}): string[] {
  const { candleAnalysis, averageTurnoverRub, minTurnoverRub } = input;
  const reasons: string[] = [];
  if (candleAnalysis.status !== 'ok') reasons.push('Недостаточно полных 5-минутных свечей');
  reasons.push(`Тренд 5м: ${candleAnalysis.trend}`);
  reasons.push(
    `Относительный объём: ${
      candleAnalysis.relativeVolume === null ? '—' : `${round(candleAnalysis.relativeVolume)}x`
    }`,
  );
  reasons.push(`Средний оборот 5м: ${formatRub(averageTurnoverRub)}`);
  if (averageTurnoverRub === null || averageTurnoverRub < minTurnoverRub) {
    reasons.push(`Оборот ниже порога ${formatRub(minTurnoverRub)}`);
  }
  return reasons;
}

function readinessReasons(input: {
  candleAnalysis: CandleAnalysis;
  averageTurnoverRub: number | null;
  minTurnoverRub: number;
}): string[] {
  const { candleAnalysis, averageTurnoverRub, minTurnoverRub } = input;
  const reasons: string[] = [];
  if (candleAnalysis.status !== 'ok') reasons.push('Недостаточно данных для 5-минутного тренда');
  if (averageTurnoverRub === null || averageTurnoverRub < minTurnoverRub) {
    reasons.push(`Средний оборот 5м ниже ${formatRub(minTurnoverRub)}`);
  }
  if (candleAnalysis.trend !== 'up') reasons.push('Пятиминутный тренд не восходящий');
  if (candleAnalysis.relativeVolume === null || candleAnalysis.relativeVolume < 1) {
    reasons.push('Относительный объём ниже 1.0');
  }
  if (candleAnalysis.averageTrueRange14 === null || candleAnalysis.averageTrueRange14 <= 0) {
    reasons.push('ATR недоступен');
  }
  return reasons;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  iteratee: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await iteratee(values[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export class IntradayScanner {
  private readonly listeners: IntradayScanEventListener[] = [];
  private readonly universe: IntradayUniverseProvider;
  private latestReport: IntradayScanReport | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly client: TInvestClient,
    private readonly journal: ScenarioJournal,
    private readonly log: (event: IntradayScanEvent) => void = (event) =>
      process.stdout.write(JSON.stringify(event) + '\n'),
    universe?: IntradayUniverseProvider,
  ) {
    this.universe = universe ?? new TInvestIntradayUniverseProvider(config, client);
  }

  addEventListener(listener: IntradayScanEventListener): void {
    this.listeners.push(listener);
  }

  isPaused(): boolean {
    return this.journal.isScannerPaused('intraday');
  }

  pause(): void {
    this.journal.setScannerPaused('intraday', true);
  }

  resume(): void {
    this.journal.setScannerPaused('intraday', false);
  }

  getLatestReport(): IntradayScanReport | null {
    return this.latestReport;
  }

  async scanOnce(now = new Date()): Promise<IntradayScanEvent[]> {
    if (this.isPaused()) {
      const event: IntradayScanEvent = {
        instrumentId: 'scanner',
        observedAt: now.toISOString(),
        status: 'paused',
        reasons: ['Intraday scanner is paused by an authorized operator'],
      };
      await this.emit(event);
      return [event];
    }

    let snapshot: IntradayUniverseSnapshot;
    try {
      snapshot = await this.universe.getSnapshot(now);
    } catch (error: unknown) {
      const event: IntradayScanEvent = {
        instrumentId: 'universe',
        observedAt: now.toISOString(),
        status: 'error',
        reasons: [error instanceof Error ? error.message : 'Unable to refresh intraday universe'],
      };
      await this.emit(event);
      return [event];
    }

    if (snapshot.instruments.length === 0) {
      const event: IntradayScanEvent = {
        instrumentId: 'universe',
        observedAt: now.toISOString(),
        status: 'error',
        reasons: ['Intraday universe contains no eligible instruments'],
      };
      this.latestReport = {
        observedAt: now.toISOString(),
        universe: {
          source: snapshot.source,
          refreshedAt: snapshot.refreshedAt,
          requested: snapshot.requestedTickers.length,
          active: 0,
          missingTickers: snapshot.missingTickers,
        },
        scanned: 0,
        liquid: 0,
        trendUp: 0,
        volumeConfirmed: 0,
        readyForMarketCheck: 0,
        marketCandidates: 0,
        recordedCandidates: 0,
        errors: 1,
        topRanked: [],
      };
      await this.emit(event);
      return [event];
    }

    const results = await mapWithConcurrency(
      snapshot.instruments,
      this.config.scanner.maxConcurrentRequests,
      async (instrument) => {
        try {
          return await this.scanInstrument(instrument, now);
        } catch (error: unknown) {
          const ranking: IntradayMarketRanking = {
            ticker: instrument.ticker,
            instrumentId: instrument.instrumentId,
            score: 0,
            trend: 'insufficient_data',
            relativeVolume: null,
            averageCandleTurnoverRub: null,
            candidateReady: false,
            reasons: [error instanceof Error ? error.message : 'Unknown scanner error'],
          };
          return {
            ranking,
            liquid: false,
            trendUp: false,
            volumeConfirmed: false,
            readyForMarketCheck: false,
            event: {
              instrumentId: instrument.instrumentId,
              observedAt: now.toISOString(),
              status: 'error',
              reasons: ranking.reasons,
            },
          } satisfies InstrumentScanResult;
        }
      },
    );

    const candidates = results
      .flatMap((result) => (result.candidate ? [result.candidate] : []))
      .sort((left, right) => right.ranking.score - left.ranking.score);
    const selectedIds = new Set(
      candidates
        .slice(0, this.config.scanner.maxCandidatesPerScan)
        .map((candidate) => candidate.instrument.instrumentId),
    );
    const events: IntradayScanEvent[] = [];

    for (const result of results) {
      if (result.event) {
        events.push(result.event);
        continue;
      }
      const candidate = result.candidate;
      if (!candidate) continue;
      if (!selectedIds.has(candidate.instrument.instrumentId)) {
        events.push({
          instrumentId: candidate.instrument.instrumentId,
          observedAt: now.toISOString(),
          status: 'candidate-suppressed',
          reasons: ['Candidate is below the per-scan ranking limit'],
        });
        continue;
      }
      events.push(this.recordCandidate(candidate, now));
    }

    this.latestReport = {
      observedAt: now.toISOString(),
      universe: {
        source: snapshot.source,
        refreshedAt: snapshot.refreshedAt,
        requested: snapshot.requestedTickers.length,
        active: snapshot.instruments.length,
        missingTickers: snapshot.missingTickers,
      },
      scanned: results.length,
      liquid: results.filter((result) => result.liquid).length,
      trendUp: results.filter((result) => result.trendUp).length,
      volumeConfirmed: results.filter((result) => result.volumeConfirmed).length,
      readyForMarketCheck: results.filter((result) => result.readyForMarketCheck).length,
      marketCandidates: candidates.length,
      recordedCandidates: events.filter((event) => event.status === 'candidate-recorded').length,
      errors: results.filter((result) => result.event?.status === 'error').length,
      topRanked: results
        .map((result) => result.ranking)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5),
    };

    for (const event of events) await this.emit(event);
    return events;
  }

  start(): void {
    if (
      this.config.scanner.universeMode === 'watchlist' &&
      this.config.scanner.intradayWatchlist.length === 0
    ) {
      throw new Error('T_INVEST_INTRADAY_WATCHLIST is empty while watchlist mode is selected');
    }

    void this.scanOnce();
    const intervalMs = this.config.scanner.intervalSeconds * 1_000;
    const scheduleNext = () => {
      const now = Date.now();
      const nextRun = Math.floor(now / intervalMs + 1) * intervalMs + 5_000;
      const delay = Math.max(1_000, nextRun - now);
      setTimeout(async () => {
        await this.scanOnce();
        scheduleNext();
      }, delay);
    };
    scheduleNext();
  }

  private async emit(event: IntradayScanEvent): Promise<void> {
    this.log(event);
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Unknown event listener error';
        process.stderr.write(`Intraday scanner event listener failed: ${detail}\n`);
      }
    }
  }

  private async scanInstrument(
    instrument: ResolvedIntradayInstrument,
    now: Date,
  ): Promise<InstrumentScanResult> {
    const observedAt = now.toISOString();
    const from = new Date(now.getTime() - this.config.scanner.lookbackMinutes * 60_000).toISOString();
    const candles = await this.client.getCandles({
      instrumentId: instrument.instrumentId,
      from,
      to: observedAt,
      interval: 'CANDLE_INTERVAL_5_MIN',
    });
    const candleAnalysis = analyzeCandles(candles);
    const averageTurnoverRub = averageCandleTurnoverRub(candleAnalysis, instrument);
    const readiness = readinessReasons({
      candleAnalysis,
      averageTurnoverRub,
      minTurnoverRub: this.config.scanner.minAverageCandleTurnoverRub,
    });
    const ranking: IntradayMarketRanking = {
      ticker: instrument.ticker,
      instrumentId: instrument.instrumentId,
      score: scoreScreening({
        candleAnalysis,
        averageTurnoverRub,
        minTurnoverRub: this.config.scanner.minAverageCandleTurnoverRub,
      }),
      trend: candleAnalysis.trend,
      relativeVolume: candleAnalysis.relativeVolume,
      averageCandleTurnoverRub: averageTurnoverRub === null ? null : round(averageTurnoverRub),
      candidateReady: readiness.length === 0,
      reasons: screeningReasons({
        candleAnalysis,
        averageTurnoverRub,
        minTurnoverRub: this.config.scanner.minAverageCandleTurnoverRub,
      }),
    };
    const liquid =
      averageTurnoverRub !== null &&
      averageTurnoverRub >= this.config.scanner.minAverageCandleTurnoverRub;
    const trendUp = candleAnalysis.trend === 'up';
    const volumeConfirmed =
      candleAnalysis.relativeVolume !== null && candleAnalysis.relativeVolume >= 1;

    if (readiness.length > 0) {
      return {
        ranking,
        liquid,
        trendUp,
        volumeConfirmed,
        readyForMarketCheck: false,
        event: {
          instrumentId: instrument.instrumentId,
          observedAt,
          status: 'skipped',
          reasons: readiness,
        },
      };
    }

    const orderBook = await this.client.getOrderBook(instrument.instrumentId, 20);
    const proposal = proposeIntradayLong({
      candleAnalysis,
      orderBookPayload: orderBook,
      priceStep: instrument.priceStep,
      commissionRate: this.config.commissionRate,
      slippageRate: this.config.scanner.slippageRate,
    });
    if (!proposal) {
      return {
        ranking,
        liquid,
        trendUp,
        volumeConfirmed,
        readyForMarketCheck: true,
        event: {
          instrumentId: instrument.instrumentId,
          observedAt,
          status: 'skipped',
          reasons: ['Не удалось построить план входа по текущему стакану'],
        },
      };
    }

    const [lastPrices, tradingStatus] = await Promise.all([
      this.client.getLastPrices([instrument.instrumentId]),
      this.client.getTradingStatus(instrument.instrumentId),
    ]);
    const limits = this.config.strategies.intraday;
    const tradePlan = calculateTradePlan({
      side: 'long',
      entryPrice: proposal.entryPrice,
      stopPrice: proposal.stopPrice,
      targetPrice: proposal.targetPrice,
      lotSize: instrument.lotSize,
      slippageRate: this.config.scanner.slippageRate,
      commissionRate: this.config.commissionRate,
      maxRiskRub: limits.maxRiskRub,
      maxPositionRub: limits.maxPositionRub,
    });
    const assessment = assessTradeScenario({
      side: 'long',
      entryPrice: proposal.entryPrice,
      maxSpreadPct: limits.maxSpreadPct,
      maxEntryDeviationPct: limits.maxEntryDeviationPct,
      allowShort: false,
      tradePlan,
      candleAnalysis,
      lastPricesPayload: lastPrices,
      orderBookPayload: orderBook,
      tradingStatusPayload: tradingStatus,
    });

    if (assessment.decision !== 'candidate') {
      return {
        ranking,
        liquid,
        trendUp,
        volumeConfirmed,
        readyForMarketCheck: true,
        event: {
          instrumentId: instrument.instrumentId,
          observedAt,
          status: 'skipped',
          reasons: [...proposal.reasons, ...assessment.blockers, ...assessment.warnings],
        },
      };
    }

    return {
      ranking,
      liquid,
      trendUp,
      volumeConfirmed,
      readyForMarketCheck: true,
      candidate: { instrument, ranking, candleAnalysis, proposal, tradePlan, assessment },
    };
  }

  private recordCandidate(candidate: CandidateEvaluation, now: Date): IntradayScanEvent {
    const observedAt = now.toISOString();
    const since = new Date(
      now.getTime() - this.config.scanner.candidateCooldownMinutes * 60_000,
    ).toISOString();
    if (
      this.journal.hasRecentCandidate({
        strategy: 'intraday',
        instrumentId: candidate.instrument.instrumentId,
        since,
      })
    ) {
      return {
        instrumentId: candidate.instrument.instrumentId,
        observedAt,
        status: 'candidate-suppressed',
        reasons: ['A candidate for this instrument was already recorded within the cooldown window'],
      };
    }

    const record = this.journal.record({
      observedAt,
      strategy: 'intraday',
      instrumentId: candidate.instrument.instrumentId,
      input: {
        side: 'long',
        entryPrice: candidate.proposal.entryPrice,
        stopPrice: candidate.proposal.stopPrice,
        targetPrice: candidate.proposal.targetPrice,
        lotSize: candidate.instrument.lotSize,
        slippageRate: this.config.scanner.slippageRate,
      },
      decision: candidate.assessment.decision,
      blockers: candidate.assessment.blockers,
      warnings: candidate.assessment.warnings,
      snapshot: {
        source: 'intraday-scanner',
        instrument: {
          ticker: candidate.instrument.ticker,
          label: candidate.instrument.label,
          name: candidate.instrument.name,
        },
        screening: candidate.ranking,
        proposal: candidate.proposal,
        input: {
          side: 'long',
          entryPrice: candidate.proposal.entryPrice,
          stopPrice: candidate.proposal.stopPrice,
          targetPrice: candidate.proposal.targetPrice,
          lotSize: candidate.instrument.lotSize,
          slippageRate: this.config.scanner.slippageRate,
        },
        tradePlan: candidate.tradePlan,
        candleAnalysis: candidate.candleAnalysis,
        market: candidate.assessment.market,
      },
    });

    return {
      instrumentId: candidate.instrument.instrumentId,
      observedAt,
      status: 'candidate-recorded',
      scenarioId: record.id,
      reasons: candidate.proposal.reasons,
    };
  }
}
