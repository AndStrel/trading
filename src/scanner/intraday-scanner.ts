import type { AppConfig } from '../config.js';
import { analyzeCandles, type CandleAnalysis } from '../domain/candle-analysis.js';
import type { IntradayLongProposal } from '../domain/intraday-proposal.js';
import { evaluateTradingSignal, type TradingSignalInput } from '../strategies/signal-engine.js';
import { TradingSelectionController, type TradingSelection } from '../strategies/selection.js';
import type { TradingStrategyId } from '../strategies/catalog.js';
import { sandboxBidValue } from '../execution/sandbox-loss-policy.js';
import { decimalPriceNano } from '../execution/sandbox-stop-state.js';
import { quotationToNumber, type Quotation } from '../domain/money.js';
import { assessTradeScenario } from '../domain/trade-scenario.js';
import { calculateTradePlan } from '../domain/trade-plan.js';
import { assessLivePilotRisk } from '../execution/live-pilot-risk.js';
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
  status: 'paused' | 'skipped' | 'candidate-recorded' | 'candidate-suppressed' | 'error' | 'scan-completed';
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
  strategyId: TradingStrategyId;
  selectionRevision: number;
  recommendations: AssetRecommendation[];
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

export type AssetRecommendation = {
  ticker: string; instrumentId: string; status: 'signal' | 'wait' | 'blocked' | 'error';
  score: number; reasons: string[]; lotCostRub: number | null; roundTripCostsRub: number | null;
  totalRiskRub: number | null; netRewardRub: number | null;
  entryPrice: number | null; stopPrice: number | null; targetPrice: number | null;
};

type CandidateEvaluation = {
  instrument: ResolvedIntradayInstrument;
  ranking: IntradayMarketRanking;
  candleAnalysis: CandleAnalysis;
  proposal: IntradayLongProposal;
  tradePlan: ReturnType<typeof calculateTradePlan>;
  assessment: ReturnType<typeof assessTradeScenario>;
  signalInput: Omit<TradingSignalInput, 'now'>;
  lastPricesPayload: unknown;
  tradingStatusPayload: unknown;
};

type InstrumentScanResult = {
  recommendation: AssetRecommendation;
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
  private readonly selection: TradingSelectionController;
  private scanning = false;

  constructor(
    private readonly config: AppConfig,
    private readonly client: TInvestClient,
    private readonly journal: ScenarioJournal,
    private readonly log: (event: IntradayScanEvent) => void = (event) =>
      process.stdout.write(JSON.stringify(event) + '\n'),
    universe?: IntradayUniverseProvider,
    private readonly acquireSourceLease?: () => () => void,
  ) {
    this.universe = universe ?? new TInvestIntradayUniverseProvider(config, client);
    this.selection = new TradingSelectionController(config, journal);
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
    // The interval loop would otherwise stay on the paused no-op until the next
    // boundary, so enabling the scanner looked like silence.
    void this.scanOnce();
  }

  getLatestReport(): IntradayScanReport | null {
    if (this.latestReport && this.latestReport.selectionRevision !== this.selection.get().revision) this.latestReport = null;
    return this.latestReport;
  }

  getTradingSelection(): TradingSelection { return this.selection.get(); }
  getAvailableTickers(): string[] { return this.selection.availableTickers(); }
  selectTradingStrategy(id: string, expectedRevision: number): void { this.selection.selectStrategy(id, expectedRevision); this.latestReport = null; }
  selectTradingAssets(tickers: string[], expectedRevision: number): void { this.selection.selectAssets(tickers, expectedRevision); this.latestReport = null; }

  invalidateSourceReport(): void { this.latestReport = null; }

  async scanOnce(now = new Date()): Promise<IntradayScanEvent[]> {
    if (this.scanning) return [];
    this.scanning = true;
    const started = performance.now();
    let release: (() => void) | undefined;
    try { release = this.acquireSourceLease?.(); return await this.scanWithSource(now,started); }
    catch {
      this.latestReport = null;
      const event:IntradayScanEvent = {instrumentId:'scanner',observedAt:now.toISOString(),status:'error',reasons:['Сканирование недоступно; проверь настройки и источник данных']};
      await this.emit(event); return [event];
    } finally { release?.(); this.scanning = false; }
  }

  private async scanWithSource(now: Date, started:number): Promise<IntradayScanEvent[]> {
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

    const selection = this.selection.get();
    let snapshot: IntradayUniverseSnapshot;
    try {
      snapshot = await this.universe.getSnapshot(now, selection.tickers);
      snapshot = {...snapshot, instruments:snapshot.instruments.filter(instrument => selection.tickers.includes(instrument.ticker.toUpperCase()))};
    } catch (error: unknown) {
      this.latestReport = null;
      const event: IntradayScanEvent = {
        instrumentId: 'universe',
        observedAt: now.toISOString(),
        status: 'error',
        reasons: ['Каталог инструментов недоступен. Проверь соединение и read-only доступ брокера'],
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
        strategyId:selection.strategyId, selectionRevision:selection.revision,
        recommendations:selection.tickers.map(ticker => this.emptyRecommendation(ticker,'','blocked',['Инструмент не разрешён брокером или недоступен в выбранном каталоге'])),
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
          return await this.scanInstrument(instrument, new Date(now.getTime()+performance.now()-started), selection);
        } catch (error: unknown) {
          const ranking: IntradayMarketRanking = {
            ticker: instrument.ticker,
            instrumentId: instrument.instrumentId,
            score: 0,
            trend: 'insufficient_data',
            relativeVolume: null,
            averageCandleTurnoverRub: null,
            candidateReady: false,
            reasons: ['Данные инструмента недоступны или не прошли проверку'],
          };
          return {
            recommendation: this.emptyRecommendation(instrument.ticker, instrument.instrumentId, 'error', ranking.reasons),
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

    // A choice made while requests were pending must not publish/queue the old signal.
    if (!this.selection.isCurrent(selection) || this.isPaused()) { this.latestReport = null; return []; }
    // A fast worker's signal/quotes can expire while another instrument is awaited.
    for (const result of results) this.refreshCandidate(result, new Date(now.getTime()+performance.now()-started));
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
      if (!this.selection.isCurrent(selection) || this.isPaused()) { this.latestReport = null; return []; }
      const publicationNow = new Date(now.getTime()+performance.now()-started);
      if (!this.refreshCandidate(result,publicationNow)) { events.push(result.event!); continue; }
      events.push(this.recordCandidate(candidate, publicationNow, selection));
    }

    this.latestReport = {
      strategyId: selection.strategyId,
      selectionRevision: selection.revision,
      recommendations: [...results.map(result => result.recommendation), ...selection.tickers
        .filter(ticker => !snapshot.instruments.some(instrument => instrument.ticker.toUpperCase() === ticker))
        .map(ticker => this.emptyRecommendation(ticker, '', 'blocked', ['Инструмент не разрешён брокером или недоступен в выбранном каталоге']))],
      observedAt: new Date(now.getTime()+performance.now()-started).toISOString(),
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
      marketCandidates: results.filter(result=>result.candidate).length,
      recordedCandidates: events.filter((event) => event.status === 'candidate-recorded').length,
      errors: results.filter((result) => result.event?.status === 'error').length,
      topRanked: results
        .map((result) => result.ranking)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5),
    };

    for (const event of events) await this.emit(event);
    // A pass with no candidate used to write nothing. Log the summary only;
    // listeners still receive actionable events, not a message every interval.
    const report = this.latestReport;
    if (report) this.log({
      instrumentId: 'scanner',
      observedAt: report.observedAt,
      status: 'scan-completed',
      reasons: [
        `active=${report.universe.active}`,
        `scanned=${report.scanned}`,
        `recorded=${report.recordedCandidates}`,
        `errors=${report.errors}`,
      ],
    });
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
    selection: TradingSelection,
  ): Promise<InstrumentScanResult> {
    const started = performance.now();
    const currentTime = () => new Date(now.getTime()+performance.now()-started);
    const observedAt = now.toISOString();
    const msk = new Date(now.getTime()+3*60*60_000);
    const reference = Date.UTC(msk.getUTCFullYear(),msk.getUTCMonth(),msk.getUTCDate())-3*60*60_000+this.config.scanner.sessionStartMinutes*60_000;
    const from = new Date(Math.min(now.getTime() - this.config.scanner.lookbackMinutes * 60_000,
      selection.strategyId === 'trend-momentum-v1' ? now.getTime() : reference-250*60_000)).toISOString();
    const candles = await this.client.getCandles({
      instrumentId: instrument.instrumentId,
      from,
      to: observedAt,
      interval: 'CANDLE_INTERVAL_5_MIN',
    });
    const candleAnalysis = analyzeCandles(candles);
    const averageTurnoverRub = averageCandleTurnoverRub(candleAnalysis, instrument);
    const ranking: IntradayMarketRanking = {
      ticker: instrument.ticker,
      instrumentId: instrument.instrumentId,
      score: 0,
      trend: candleAnalysis.trend,
      relativeVolume: candleAnalysis.relativeVolume,
      averageCandleTurnoverRub: averageTurnoverRub === null ? null : round(averageTurnoverRub),
      candidateReady: false,
      reasons: [],
    };
    const liquid =
      averageTurnoverRub !== null &&
      averageTurnoverRub >= this.config.scanner.minAverageCandleTurnoverRub;
    const trendUp = candleAnalysis.trend === 'up';
    const volumeConfirmed =
      candleAnalysis.relativeVolume !== null && candleAnalysis.relativeVolume >= 1;
    const recommendation = this.emptyRecommendation(instrument.ticker,instrument.instrumentId,'wait',[]);
    recommendation.score = ranking.score;
    recommendation.lotCostRub = candleAnalysis.latestClose === null ? null : round(candleAnalysis.latestClose*instrument.lotSize);
    recommendation.roundTripCostsRub = recommendation.lotCostRub === null ? null : round(recommendation.lotCostRub*2*(this.config.commissionRate+this.config.scanner.slippageRate));
    const finish = (status:AssetRecommendation['status'], reasons:string[], readyForMarketCheck:boolean, candidate?:CandidateEvaluation):InstrumentScanResult => {
      recommendation.status=status; recommendation.reasons=[...reasons];
      ranking.candidateReady=Boolean(candidate); ranking.reasons=[...reasons];
      return {
        ranking, recommendation, liquid, trendUp, volumeConfirmed, readyForMarketCheck,
        ...(candidate ? {candidate} : {event:{instrumentId:instrument.instrumentId,observedAt,status:'skipped' as const,reasons}}),
      };
    };
    if (!liquid) return finish('blocked',[`Оборот ниже порога ${formatRub(this.config.scanner.minAverageCandleTurnoverRub)}`],false);

    const orderBook = await this.client.getOrderBook(instrument.instrumentId, 20);
    const signalInput: Omit<TradingSignalInput,'now'> = {
      strategyId:selection.strategyId,
      candlesPayload:candles,
      candleAnalysis,
      orderBookPayload: orderBook,
      priceStep: instrument.priceStep,
      commissionRate: this.config.commissionRate,
      slippageRate: this.config.scanner.slippageRate,
      sessionStartMinutes:this.config.scanner.sessionStartMinutes,
    };
    let evaluation = evaluateTradingSignal({...signalInput,now:currentTime()});
    let proposal = evaluation.proposal;
    // This describes deterministic condition coverage, never a win probability.
    ranking.score = (evaluation.dataValid?30:0) + (liquid?20:0) + (evaluation.signal?30:0) + (volumeConfirmed?20:0);
    recommendation.score = ranking.score;
    if (!proposal) return finish(!evaluation.dataValid || evaluation.reasons.some(reason=>/расход|стакан|отношение/.test(reason)) ? 'blocked' : 'wait',evaluation.reasons,false);

    const [lastPrices, tradingStatus] = await Promise.all([
      this.client.getLastPrices([instrument.instrumentId]),
      this.client.getTradingStatus(instrument.instrumentId),
    ]);
    evaluation = evaluateTradingSignal({...signalInput,now:currentTime()});
    proposal = evaluation.proposal;
    ranking.score = (evaluation.dataValid?30:0) + (liquid?20:0) + (evaluation.signal?30:0) + (volumeConfirmed?20:0);
    recommendation.score = ranking.score;
    if (!proposal) return finish('blocked',evaluation.reasons,false);
    const limits = this.config.strategies.intraday;
    try {
      this.assertFreshQuotes(instrument,orderBook,tradingStatus,lastPrices,currentTime());
    } catch { return finish('blocked',['Свежесть, принадлежность инструменту или доступный объём котировок не подтверждены'],true); }
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
    if (this.config.livePilot.prepare && tradePlan.lots > 0) {
      const pilotRisk = assessLivePilotRisk(this.config.livePilot, {
        side: 'long', entryPrice: proposal.entryPrice, stopPrice: proposal.stopPrice,
        targetPrice: proposal.targetPrice, lotSize: instrument.lotSize, lots: tradePlan.lots,
        commissionRate: this.config.commissionRate, slippageRate: this.config.scanner.slippageRate,
        availableCashRub: this.config.livePilot.capitalRub,
        reservedDailyRiskRub: 0, realizedDailyLossRub: 0, markedOpenLossRub: 0,
      });
      tradePlan.allowed = tradePlan.allowed && pilotRisk.allowed;
      tradePlan.reasons.push(...pilotRisk.blockers);
      tradePlan.totalRiskRub = Math.max(tradePlan.totalRiskRub, pilotRisk.totalRiskRub);
      tradePlan.netRewardRub = Math.min(tradePlan.netRewardRub, pilotRisk.netRewardRub);
      tradePlan.rewardToRisk = tradePlan.netRewardRub / tradePlan.totalRiskRub;
    }
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
      signalConfirmed: true,
    });
    recommendation.lotCostRub=round(proposal.entryPrice*instrument.lotSize);
    recommendation.roundTripCostsRub=round(tradePlan.estimatedCommissionRub+tradePlan.estimatedSlippageRub);
    recommendation.totalRiskRub=tradePlan.totalRiskRub;
    recommendation.netRewardRub=tradePlan.netRewardRub;
    recommendation.entryPrice=proposal.entryPrice; recommendation.stopPrice=proposal.stopPrice; recommendation.targetPrice=proposal.targetPrice;
    if (assessment.market.bestAskQuantity === null || assessment.market.bestAskQuantity < tradePlan.lots) {
      assessment.blockers.push('На лучшей цене покупки недостаточно лотов'); assessment.decision='blocked';
    }

    if (assessment.decision !== 'candidate') {
      return finish('blocked',[...proposal.reasons,...assessment.blockers,...assessment.warnings],true);
    }

    return finish('signal',proposal.reasons,true,{instrument,ranking,candleAnalysis,proposal,tradePlan,assessment,
      signalInput,lastPricesPayload:lastPrices,tradingStatusPayload:tradingStatus});
  }

  private assertFreshQuotes(instrument:ResolvedIntradayInstrument,orderBook:unknown,tradingStatus:unknown,lastPrices:unknown,now:Date):void {
    sandboxBidValue(orderBook,tradingStatus,instrument.instrumentId,1,instrument.lotSize,now);
    const prices = (lastPrices as {lastPrices?:{instrumentUid?:unknown;time?:unknown;price?:Quotation}[]}).lastPrices;
    const price = prices?.length===1 ? prices[0] : undefined;
    const age = typeof price?.time === 'string' ? now.getTime()-Date.parse(price.time) : NaN;
    if (price?.instrumentUid!==instrument.instrumentId || !Number.isFinite(age) || age < -1000 || age > 60_000 || quotationToNumber(price?.price)===null) throw new Error();
  }

  private refreshCandidate(result:InstrumentScanResult,now:Date):boolean {
    const candidate = result.candidate;
    if (!candidate) return false;
    const evaluation = evaluateTradingSignal({...candidate.signalInput,now});
    let reasons:string[] = evaluation.proposal ? [] : evaluation.reasons;
    if (!reasons.length) {
      try { this.assertFreshQuotes(candidate.instrument,candidate.signalInput.orderBookPayload,
        candidate.tradingStatusPayload,candidate.lastPricesPayload,now); }
      catch { reasons=['Свежесть, принадлежность инструменту или доступный объём котировок не подтверждены']; }
    }
    if (!reasons.length) return true;
    delete result.candidate;
    result.readyForMarketCheck=false;
    result.ranking.candidateReady=false;
    result.ranking.score=(evaluation.dataValid?30:0)+(result.liquid?20:0)+(result.volumeConfirmed?20:0);
    result.ranking.reasons=[...reasons];
    Object.assign(result.recommendation,{status:'blocked',reasons:[...reasons],score:result.ranking.score,
      entryPrice:null,stopPrice:null,targetPrice:null,totalRiskRub:null,netRewardRub:null});
    result.event={instrumentId:candidate.instrument.instrumentId,observedAt:now.toISOString(),status:'skipped',reasons:[...reasons]};
    return false;
  }

  private emptyRecommendation(ticker:string,instrumentId:string,status:AssetRecommendation['status'],reasons:string[]):AssetRecommendation {
    return {ticker,instrumentId,status,reasons,score:0,lotCostRub:null,roundTripCostsRub:null,totalRiskRub:null,netRewardRub:null,entryPrice:null,stopPrice:null,targetPrice:null};
  }

  private recordCandidate(candidate: CandidateEvaluation, now: Date, selection:TradingSelection): IntradayScanEvent {
    const observedAt = now.toISOString();
    const since = new Date(
      now.getTime() - this.config.scanner.candidateCooldownMinutes * 60_000,
    ).toISOString();
    if (
      this.journal.hasRecentCandidate({
        strategy: 'intraday',
        instrumentId: candidate.instrument.instrumentId,
        since,
        selectionRevision:selection.revision,
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
        tradingSelection: selection,
        tradingStrategy: {id:selection.strategyId,version:'1',referenceStartMinutes:this.config.scanner.sessionStartMinutes},
        sandboxTargetExitPolicy: {
          version:'1', enabled:this.config.execution.sandboxTargetExitEnabled === true,
          commissionRateNano:decimalPriceNano(Math.max(0.003,this.config.commissionRate)),
          slippageRateNano:this.config.scanner.slippageRate === 0 ? '0' : decimalPriceNano(this.config.scanner.slippageRate),
        },
        instrument: {
          ticker: candidate.instrument.ticker,
          label: candidate.instrument.label,
          name: candidate.instrument.name,
          instrumentId:candidate.instrument.instrumentId,
          lotSize:candidate.instrument.lotSize,
          priceStep:candidate.instrument.priceStep,
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
