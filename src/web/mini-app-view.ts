import type { AppConfig } from '../config.js';
import type { ExecutionService } from '../execution/execution-service.js';
import type { ScenarioJournal } from '../journal/scenario-journal.js';
import type { IntradayScanner } from '../scanner/intraday-scanner.js';
import { formatNanoRub } from '../execution/sandbox-round-trip.js';
import { moscowLossDay } from '../execution/sandbox-loss-policy.js';
import { STRATEGY_CATALOG, getStrategyDescriptor, isTradingStrategyId, type StrategyDescriptor, type TradingStrategyId } from '../strategies/catalog.js';
import { strategyEntryWindow } from '../strategies/entry-window.js';

export type MiniAppTradingSelection = { strategyId: TradingStrategyId; revision: number; tickers: string[] };
export type MiniAppRecommendation = {
  ticker: string; status: 'signal' | 'wait' | 'blocked' | 'error'; reasons: string[]; score: number;
  lotCostRub: number | null; roundTripCostsRub: number | null; totalRiskRub: number | null;
  netRewardRub: number | null; entryPrice: number | null; stopPrice: number | null; targetPrice: number | null;
};
type MiniAppTradingView = {
  tradingSelection?: MiniAppTradingSelection;
  strategies?: StrategyDescriptor[];
  availableTickers?: string[];
  recommendations?: MiniAppRecommendation[];
};
type ScannerView = Pick<IntradayScanner, 'isPaused' | 'getLatestReport'> & {
  getTradingSelection?(): MiniAppTradingSelection;
  getAvailableTickers?(): string[];
};
const validTicker = (value: unknown): value is string => typeof value === 'string' && /^[A-Z0-9.-]{1,16}$/.test(value);
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null
  ? value as Record<string, unknown> : null;
const finiteAmount = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

function scannerEntryWindowOpen(config: AppConfig, snapshot: Record<string, unknown> | null, observedAt: string, now: Date): boolean {
  if (snapshot?.source !== 'intraday-scanner' || snapshot.tradingStrategy === undefined) return true;
  const strategy = record(snapshot.tradingStrategy);
  if (!isTradingStrategyId(strategy?.id) || strategy.version !== getStrategyDescriptor(strategy.id).version
    || typeof strategy.referenceStartMinutes !== 'number') return false;
  const original = strategyEntryWindow(strategy.id, strategy.referenceStartMinutes, new Date(observedAt));
  const current = strategyEntryWindow(strategy.id, config.scanner.sessionStartMinutes, now);
  return Boolean(original && current && now.getTime() >= Math.max(original.entryStartMs, current.entryStartMs)
    && now.getTime() < Math.min(original.entryEndMs, current.entryEndMs));
}

function projectRecommendation(value: unknown): MiniAppRecommendation | null {
  const item = record(value);
  if (!item || !validTicker(item.ticker) || !['signal', 'wait', 'blocked', 'error'].includes(String(item.status))) return null;
  const reasons = item.status === 'error' ? ['Не удалось получить полный анализ. Обновите данные.']
    : Array.isArray(item.reasons) ? item.reasons.filter((reason): reason is string => typeof reason === 'string')
      .slice(0, 10).map(reason => (typeof item.instrumentId === 'string' && item.instrumentId.length
        ? reason.split(item.instrumentId).join('инструмент') : reason).slice(0, 300)) : [];
  return { ticker: item.ticker, status: item.status as MiniAppRecommendation['status'], reasons,
    score: Math.max(0, Math.min(100, finiteAmount(item.score) ?? 0)),
    lotCostRub: finiteAmount(item.lotCostRub), roundTripCostsRub: finiteAmount(item.roundTripCostsRub),
    totalRiskRub: finiteAmount(item.totalRiskRub), netRewardRub: finiteAmount(item.netRewardRub),
    entryPrice: finiteAmount(item.entryPrice), stopPrice: finiteAmount(item.stopPrice), targetPrice: finiteAmount(item.targetPrice) };
}

export function buildMiniAppView(config: AppConfig, scanner: ScannerView,
  execution: Pick<ExecutionService, 'mode' | 'isKilled'>, journal: ScenarioJournal, now = new Date()) {
  const report = scanner.getLatestReport();
  const age = report ? now.getTime() - Date.parse(report.observedAt) : Infinity;
  const maxAge = (config.scanner.intervalSeconds + 60) * 1000;
  const { proof, current } = journal.getSandboxLossProofState();
  const guardEnabled = config.execution.mode === 'sandbox' && config.execution.sandboxProtectionEnabled && config.execution.sandboxLossGuardEnabled;
  const proofAge = now.getTime() - Date.parse(proof?.checkedAt ?? '');
  const guardFresh = Boolean(proof && current && proof.accountId === (config.execution.accountId ?? journal.getRuntimeState('execution.sandbox_account_id'))
    && proof.day === moscowLossDay(now) && proofAge >= 0 && proofAge <= 30_000);
  const knownLoss = guardEnabled && guardFresh && proof && ['ok', 'limit'].includes(proof.status)
    && [proof.closedLossNano, proof.openLossNano, proof.maxTradeLossNano].every(value => typeof value === 'string' && /^\d{1,40}$/.test(value));
  const lossText = (amount: string) => formatNanoRub(String(-BigInt(amount))).replace(/^−/, '');
  const selection = scanner.getTradingSelection?.();
  const reportRecord = record(report);
  const matchesSelection = !selection || (reportRecord?.strategyId === selection.strategyId
    && reportRecord?.selectionRevision === selection.revision);
  const fresh = age >= 0 && age <= maxAge && matchesSelection;
  const trading: MiniAppTradingView = {};
  if (selection && isTradingStrategyId(selection.strategyId)) {
    trading.tradingSelection = { strategyId: selection.strategyId, revision: selection.revision, tickers: [...selection.tickers] };
    trading.strategies = STRATEGY_CATALOG.map(strategy => ({ ...strategy, rules: [...strategy.rules] }));
    trading.availableTickers = [...new Set(scanner.getAvailableTickers?.().filter(validTicker) ?? [])];
    const recommendations = fresh && Array.isArray(reportRecord?.recommendations)
      ? reportRecord.recommendations.map(projectRecommendation).filter((item): item is MiniAppRecommendation => item !== null) : [];
    const entryWindow = strategyEntryWindow(selection.strategyId, config.scanner.sessionStartMinutes, now);
    const entryAllowed = Boolean(entryWindow && now.getTime() >= entryWindow.entryStartMs && now.getTime() < entryWindow.entryEndMs);
    trading.recommendations = selection.tickers.map(ticker => recommendations.find(item => item.ticker === ticker)
      ?? { ticker, status: 'wait' as const, reasons: ['Ждём свежий проход для выбранной стратегии и активов.'], score: 0,
        lotCostRub: null, roundTripCostsRub: null, totalRiskRub: null, netRewardRub: null,
        entryPrice: null, stopPrice: null, targetPrice: null }).map(item => item.status === 'signal' && !entryAllowed
        ? { ...item, status: 'blocked' as const, reasons: ['Окно новых входов закрыто. Ждём новый допустимый сигнал.'],
          totalRiskRub: null, netRewardRub: null, entryPrice: null, stopPrice: null, targetPrice: null } : item);
  }
  return {
    ...trading,
    observedAt: now.toISOString(),
    scanner: { paused: scanner.isPaused(), lastScanAt: report?.observedAt ?? null,
      fresh, scanned: report?.scanned ?? 0, errors: report?.errors ?? 0 },
    execution: { mode: execution.mode(), killed: execution.isKilled(), liveSubmissionAllowed: false,
      actualPnlRub: null, lossMonitorReady: false },
    sandboxLossGuard: {
      state: !guardEnabled ? 'off' : !proof ? 'waiting' : !guardFresh ? 'stale' : knownLoss ? proof.status : 'incomplete',
      checkedAt: proof && Number.isFinite(Date.parse(proof.checkedAt)) ? proof.checkedAt : null,
      closedLoss: knownLoss ? lossText(proof.closedLossNano!) : null,
      estimatedOpenLoss: knownLoss ? lossText(proof.openLossNano!) : null,
      totalLoss: knownLoss ? lossText(String(BigInt(proof.closedLossNano!) + BigInt(proof.openLossNano!))) : null,
    },
    sandboxResults: journal.listSandboxResults().map(result => ({
      scenarioId: result.scenarioId, soldLots: result.soldLots, remainingLots: result.remainingLots,
      netPnl: result.netPnlNano === null ? null : formatNanoRub(result.netPnlNano), complete: result.complete,
      observedAt: result.observedAt, flatConfirmedAt: result.flatConfirmedAt,
    })),
    limits: { capitalRub: config.livePilot.capitalRub, tradeRiskRub: config.strategies.intraday.maxRiskRub,
      dailyRiskRub: config.execution.maxDailyRiskRub, dailyLossRub: config.livePilot.maxDailyLossRub,
      positionRub: config.strategies.intraday.maxPositionRub, commissionRate: config.commissionRate,
      slippageRate: config.scanner.slippageRate },
    candidates: journal.list(30, 'intraday').filter(item => {
      if (!scannerEntryWindowOpen(config, record(item.snapshot), item.observedAt, now)) return false;
      if (selection) {
        const snapshot = record(item.snapshot);
        const previous = record(snapshot?.tradingSelection);
        const instrument = record(snapshot?.instrument);
        const previousTickers = previous?.tickers;
        if (previous?.strategyId !== selection.strategyId || previous?.revision !== selection.revision
          || !Array.isArray(previousTickers) || previousTickers.length !== selection.tickers.length
          || !selection.tickers.every(ticker => previousTickers.includes(ticker))
          || !selection.tickers.includes(String(instrument?.ticker))) return false;
      }
      return item.decision === 'candidate'
      && now.getTime() - Date.parse(item.observedAt) >= 0
      && now.getTime() - Date.parse(item.observedAt) <= config.execution.candidateMaxAgeMinutes * 60_000;
    }).slice(0, 5)
      .map(item => {
        const snapshot = typeof item.snapshot === 'object' && item.snapshot !== null ? item.snapshot as Record<string, unknown> : {};
        const instrument = typeof snapshot.instrument === 'object' && snapshot.instrument !== null
          ? snapshot.instrument as Record<string, unknown> : {};
        const label = instrument.ticker ?? instrument.label ?? config.scanner.intradayWatchlist.find(entry => entry.instrumentId === item.instrumentId)?.label;
        return { id: item.id, ticker: typeof label === 'string' && /^[A-Z0-9.-]{1,16}$/.test(label) ? label : 'Инструмент',
          observedAt: item.observedAt, entryRub: item.input.entryPrice, stopRub: item.input.stopPrice, targetRub: item.input.targetPrice };
      }),
  };
}

export type MiniAppView = ReturnType<typeof buildMiniAppView>;
