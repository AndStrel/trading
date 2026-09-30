import type { AppConfig } from '../config.js';
import type { ExecutionService } from '../execution/execution-service.js';
import type { ScenarioJournal } from '../journal/scenario-journal.js';
import type { IntradayScanner } from '../scanner/intraday-scanner.js';
import { formatNanoRub } from '../execution/sandbox-round-trip.js';
import { moscowLossDay } from '../execution/sandbox-loss-policy.js';

export function buildMiniAppView(config: AppConfig, scanner: Pick<IntradayScanner, 'isPaused' | 'getLatestReport'>,
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
  return {
    observedAt: now.toISOString(),
    scanner: { paused: scanner.isPaused(), lastScanAt: report?.observedAt ?? null,
      fresh: age >= 0 && age <= maxAge, scanned: report?.scanned ?? 0, errors: report?.errors ?? 0 },
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
    candidates: journal.list(30, 'intraday').filter(item => item.decision === 'candidate'
      && now.getTime() - Date.parse(item.observedAt) >= 0
      && now.getTime() - Date.parse(item.observedAt) <= config.execution.candidateMaxAgeMinutes * 60_000).slice(0, 5)
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
