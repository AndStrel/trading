import type { AppConfig, IntradayWatchlistItem } from '../config.js';
import { analyzeCandles } from '../domain/candle-analysis.js';
import { proposeIntradayLong } from '../domain/intraday-proposal.js';
import { assessTradeScenario } from '../domain/trade-scenario.js';
import { calculateTradePlan } from '../domain/trade-plan.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { TInvestClient } from '../tbank/client.js';

export type IntradayScanEvent = {
  instrumentId: string;
  observedAt: string;
  status: 'paused' | 'skipped' | 'candidate-recorded' | 'candidate-suppressed' | 'error';
  reasons: string[];
  scenarioId?: number;
};

export type IntradayScanEventListener = (event: IntradayScanEvent) => void | Promise<void>;

function skippedReasons(input: {
  trend: string;
  relativeVolume: number | null;
  atr: number | null;
}): string[] {
  const reasons: string[] = [];
  if (input.trend !== 'up') reasons.push('Five-minute trend is not up');
  if (input.relativeVolume === null || input.relativeVolume < 1) {
    reasons.push('Relative volume is below 1.0');
  }
  if (input.atr === null || input.atr <= 0) reasons.push('ATR is unavailable');
  return reasons;
}

export class IntradayScanner {
  private readonly listeners: IntradayScanEventListener[] = [];

  constructor(
    private readonly config: AppConfig,
    private readonly client: TInvestClient,
    private readonly journal: ScenarioJournal,
    private readonly log: (event: IntradayScanEvent) => void = (event) =>
      process.stdout.write(JSON.stringify(event) + '\n'),
  ) {}

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

    const events: IntradayScanEvent[] = [];

    for (const instrument of this.config.scanner.intradayWatchlist) {
      try {
        events.push(await this.scanInstrument(instrument, now));
      } catch (error: unknown) {
        events.push({
          instrumentId: instrument.instrumentId,
          observedAt: now.toISOString(),
          status: 'error',
          reasons: [error instanceof Error ? error.message : 'Unknown scanner error'],
        });
      }
    }

    for (const event of events) await this.emit(event);
    return events;
  }

  start(): void {
    if (this.config.scanner.intradayWatchlist.length === 0) {
      throw new Error('T_INVEST_INTRADAY_WATCHLIST is empty; scanner will not start');
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
    instrument: IntradayWatchlistItem,
    now: Date,
  ): Promise<IntradayScanEvent> {
    const observedAt = now.toISOString();
    const from = new Date(now.getTime() - this.config.scanner.lookbackMinutes * 60_000).toISOString();
    const candles = await this.client.getCandles({
      instrumentId: instrument.instrumentId,
      from,
      to: observedAt,
      interval: 'CANDLE_INTERVAL_5_MIN',
    });
    const candleAnalysis = analyzeCandles(candles);
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
        instrumentId: instrument.instrumentId,
        observedAt,
        status: 'skipped',
        reasons: skippedReasons({
          trend: candleAnalysis.trend,
          relativeVolume: candleAnalysis.relativeVolume,
          atr: candleAnalysis.averageTrueRange14,
        }),
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
        instrumentId: instrument.instrumentId,
        observedAt,
        status: 'skipped',
        reasons: [...proposal.reasons, ...assessment.blockers, ...assessment.warnings],
      };
    }

    const since = new Date(
      now.getTime() - this.config.scanner.candidateCooldownMinutes * 60_000,
    ).toISOString();
    if (
      this.journal.hasRecentCandidate({
        strategy: 'intraday',
        instrumentId: instrument.instrumentId,
        since,
      })
    ) {
      return {
        instrumentId: instrument.instrumentId,
        observedAt,
        status: 'candidate-suppressed',
        reasons: ['A candidate for this instrument was already recorded within the cooldown window'],
      };
    }

    const record = this.journal.record({
      observedAt,
      strategy: 'intraday',
      instrumentId: instrument.instrumentId,
      input: {
        side: 'long',
        entryPrice: proposal.entryPrice,
        stopPrice: proposal.stopPrice,
        targetPrice: proposal.targetPrice,
        lotSize: instrument.lotSize,
        slippageRate: this.config.scanner.slippageRate,
      },
      decision: assessment.decision,
      blockers: assessment.blockers,
      warnings: assessment.warnings,
      snapshot: {
        source: 'intraday-scanner',
        proposal,
        input: {
          side: 'long',
          entryPrice: proposal.entryPrice,
          stopPrice: proposal.stopPrice,
          targetPrice: proposal.targetPrice,
          lotSize: instrument.lotSize,
          slippageRate: this.config.scanner.slippageRate,
        },
        tradePlan,
        candleAnalysis,
        market: assessment.market,
      },
    });

    return {
      instrumentId: instrument.instrumentId,
      observedAt,
      status: 'candidate-recorded',
      scenarioId: record.id,
      reasons: proposal.reasons,
    };
  }
}
