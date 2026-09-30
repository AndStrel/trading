import { loadConfig } from './config.js';
import { ExecutionService } from './execution/execution-service.js';
import { TInvestOrderClient } from './execution/tinvest-order-client.js';
import { LivePilotPreflight } from './execution/live-pilot-preflight.js';
import { LivePreflightClient, liveProductionEndpoint } from './execution/live-preflight-client.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { IntradayScanner } from './scanner/intraday-scanner.js';
import { TelegramBotClient } from './telegram/client.js';
import { TelegramTradingBot } from './telegram/bot.js';
import { TInvestClient } from './tbank/client.js';
import { createMiniAppServer } from './web/mini-app-server.js';
import { buildMiniAppView } from './web/mini-app-view.js';
import { SandboxProtectionService } from './execution/sandbox-protection-service.js';
import { SandboxExitService } from './execution/sandbox-exit-service.js';
import { SandboxLossGuard } from './execution/sandbox-loss-guard.js';

const config = loadConfig();
if (!config.telegram.token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not configured');
}

const journal = new ScenarioJournal(config.journalPath);
const tInvestClient = new TInvestClient(config.token, config.baseUrl, { transport: config.transport });
const orderClient = new TInvestOrderClient(config.execution.token, config.baseUrl, undefined, { transport: config.transport });
const protection = config.execution.sandboxProtectionEnabled ? new SandboxProtectionService(config, orderClient, journal) : undefined;
const exits = config.execution.sandboxProtectionEnabled ? new SandboxExitService(config, orderClient, journal) : undefined;
const lossGuard = config.execution.sandboxLossGuardEnabled && exits ? new SandboxLossGuard(config, orderClient, tInvestClient, exits, journal) : undefined;
const execution = new ExecutionService(
  config,
  tInvestClient,
  orderClient,
  journal,
  protection,
  exits,
  lossGuard,
);
const scanner = new IntradayScanner(config, tInvestClient, journal);
const telegram = new TelegramTradingBot(
  config,
  new TelegramBotClient(config.telegram.token),
  scanner,
  journal,
  undefined,
  undefined,
  execution,
  new LivePilotPreflight(config, new LivePreflightClient(config.livePilot.token, liveProductionEndpoint, config.transport)),
);

// Safe startup read-back, captured by the EXISTING deployment log. This proves
// effective settings only, not transport health, strategy edge or live readiness.
process.stdout.write(JSON.stringify({
  event: 'daily-pilot-profile-loaded',
  capitalRub: config.livePilot.capitalRub,
  maxTradeRiskRub: config.strategies.intraday.maxRiskRub,
  maxDailyRiskRub: config.execution.maxDailyRiskRub,
  maxPositionRub: config.strategies.intraday.maxPositionRub,
  commissionRate: config.commissionRate,
  executionMode: config.execution.mode,
  liveSubmissionAllowed: false,
  liveTokenPresent: Boolean(config.livePilot.token),
  liveAccountConfigured: Boolean(config.livePilot.accountId),
}) + '\n');
scanner.addEventListener((event) => telegram.notifyScannerEvent(event));
if (execution.isReady()) {
  // Bounded read-only recovery runs even with kill active. Never repeats POST,
  // creates/funds an account, or interprets an incomplete lookup as no order.
  const recovery = await execution.recoverOutstanding();
  process.stdout.write(JSON.stringify({ event: 'sandbox-recovery', ...recovery, liveSubmissionAllowed: false }) + '\n');
}
scanner.start();
if (config.telegram.miniApp.enabled) {
  const server = createMiniAppServer({
    token: config.telegram.token, origin: config.telegram.miniApp.url!, allowedPrivateIds: config.telegram.allowedChatIds,
    view: () => buildMiniAppView(config, scanner, execution, journal),
    action: action => { if (action === 'pause') scanner.pause(); else if (action === 'resume') scanner.resume(); else execution.kill(); },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.telegram.miniApp.port, config.telegram.miniApp.host, resolve);
  });
  process.stdout.write(JSON.stringify({ event: 'mini-app-listening', liveSubmissionAllowed: false }) + '\n');
}
if (config.execution.sandboxProtectionEnabled && config.execution.mode === 'sandbox') {
  const monitor = async () => {
    try {
      if (execution.isReady()) {
        const status = await execution.protectOutstanding();
        process.stdout.write(JSON.stringify({ event: 'sandbox-native-stop-monitor', ...status, liveSubmissionAllowed: false }) + '\n');
        const accountId = config.execution.accountId ?? journal.getRuntimeState('execution.sandbox_account_id');
        if (lossGuard && accountId) {
          const report = await lossGuard.assess(accountId);
          process.stdout.write(JSON.stringify({ event: 'sandbox-loss-guard', status: report.status, day: report.day, checkedAt: report.checkedAt,
            liveSubmissionAllowed: false }) + '\n');
        }
      }
    } catch { process.stdout.write(JSON.stringify({ event: 'sandbox-native-stop-monitor-failed', liveSubmissionAllowed: false }) + '\n'); }
    setTimeout(() => { void monitor(); }, 30_000);
  };
  void monitor();
}
await telegram.start();
