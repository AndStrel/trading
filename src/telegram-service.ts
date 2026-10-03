import { loadConfig } from './config.js';
import { ExecutionService } from './execution/execution-service.js';
import { TInvestOrderClient } from './execution/tinvest-order-client.js';
import { LivePilotPreflight } from './execution/live-pilot-preflight.js';
import { LivePreflightClient, liveProductionEndpoint } from './execution/live-preflight-client.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { IntradayScanner } from './scanner/intraday-scanner.js';
import { TelegramBotClient } from './telegram/client.js';
import { TelegramTradingBot } from './telegram/bot.js';
import { TInvestClient, postWithSystemCurl } from './tbank/client.js';
import { MarketSourceController } from './tbank/market-source.js';
import { createMarketRelayFetch } from './tbank/market-relay-fetch.js';
import { readEgressLocation } from './tbank/egress-location.js';
import { readFileSync } from 'node:fs';
import { createUnixRelayFetch } from './tbank/unix-relay-fetch.js';
import { createMiniAppServer } from './web/mini-app-server.js';
import { buildMiniAppView } from './web/mini-app-view.js';
import { SandboxProtectionService } from './execution/sandbox-protection-service.js';
import { SandboxExitService } from './execution/sandbox-exit-service.js';
import { SandboxLossGuard } from './execution/sandbox-loss-guard.js';
import { SandboxSessionClose } from './execution/sandbox-session-close.js';
import { SandboxSafetyMonitor } from './execution/sandbox-safety-monitor.js';

const config = loadConfig();
if (!config.telegram.token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not configured');
}

const journal = new ScenarioJournal(config.journalPath);
const tInvestClient = new TInvestClient(config.token, config.baseUrl, { transport: config.transport });
const orderClient = new TInvestOrderClient(config.execution.token, config.execution.baseUrl, undefined, { transport: config.transport });
const protection = config.execution.sandboxProtectionEnabled ? new SandboxProtectionService(config, orderClient, journal) : undefined;
const exits = config.execution.sandboxProtectionEnabled ? new SandboxExitService(config, orderClient, journal) : undefined;
const lossGuard = config.execution.sandboxLossGuardEnabled && exits ? new SandboxLossGuard(config, orderClient, tInvestClient, exits, journal) : undefined;
const sessionClose = config.execution.sandboxSessionCloseEnabled && exits ? new SandboxSessionClose(config, orderClient, tInvestClient, exits, journal) : undefined;
const execution = new ExecutionService(
  config,
  tInvestClient,
  orderClient,
  journal,
  protection,
  exits,
  lossGuard,
  sessionClose,
);
const directMarketFetch: typeof fetch = config.transport === 'fetch' ? fetch : async (input, init) => {
  if (typeof input !== 'string' || typeof init?.body !== 'string' || !config.token) throw new Error('Invalid market request');
  const response = await postWithSystemCurl({ url: input, token: config.token, body: init.body });
  return new Response(response.body, { status: response.status });
};
const localRelayUrl = process.env.T_INVEST_LOCAL_RELAY_URL;
const relaySecretPath = process.env.T_INVEST_LOCAL_RELAY_SECRET_PATH;
if (relaySecretPath && relaySecretPath !== '/run/relay/secret') throw new Error('Invalid relay secret path');
const localRelaySecret = relaySecretPath ? readFileSync(relaySecretPath, 'utf8').trim() : process.env.T_INVEST_LOCAL_RELAY_SECRET;
const relayFetch = process.env.T_INVEST_LOCAL_RELAY_SOCKET ? createUnixRelayFetch(process.env.T_INVEST_LOCAL_RELAY_SOCKET) : fetch;
if (Boolean(localRelayUrl) !== Boolean(localRelaySecret)) throw new Error('Local relay configuration is incomplete');
const computerFetch = localRelayUrl && localRelaySecret
  ? createMarketRelayFetch({ url: localRelayUrl, secret: localRelaySecret, fetchImpl: relayFetch }) : undefined;
const sources = new MarketSourceController({ server: directMarketFetch, ...(computerFetch ? { computer: computerFetch } : {}) });
const marketClient = new TInvestClient(config.token, config.baseUrl, { transport: 'fetch', fetchImpl: sources.fetch });
const scanner = new IntradayScanner(config, marketClient, journal, undefined, undefined, () => sources.acquireScan());
const tradingSelection = scanner.getTradingSelection();
process.stdout.write(JSON.stringify({event:'trading-selection-loaded',strategyId:tradingSelection.strategyId,
  selectionRevision:tradingSelection.revision,tickers:tradingSelection.tickers,
  executionMode:config.execution.mode,liveSubmissionAllowed:false})+'\n');
const probeSources = async () => {
  await Promise.all((['server', 'computer'] as const).map(async source => {
    const transport = source === 'server' ? directMarketFetch : computerFetch;
    if (!transport) return;
    try {
      const client = new TInvestClient(config.token, config.baseUrl, { transport: 'fetch', fetchImpl: transport, retryAttempts: 0, requestTimeoutMs: 15_000 });
      const payload = await client.getShares() as { instruments?: unknown };
      sources.recordHealth(source, Array.isArray(payload.instruments) && payload.instruments.length > 0);
    } catch { sources.recordHealth(source, false); }
  }));
  setTimeout(() => { void probeSources(); }, 30_000);
};
void probeSources();
const probeLocations = async () => {
  try { sources.recordLocation('server', await readEgressLocation()); } catch {}
  if (localRelayUrl && localRelaySecret) {
    try {
      const url = new URL('/egress', localRelayUrl);
      const response = await relayFetch(url, { headers: { Authorization: 'Bearer ' + localRelaySecret }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (response.ok) sources.recordLocation('computer', await response.json() as { countryCode: string; checkedAt: string });
    } catch {}
  }
  setTimeout(() => { void probeLocations(); }, 3_600_000);
};
void probeLocations();
const telegramClient = new TelegramBotClient(config.telegram.token);
const telegram = new TelegramTradingBot(
  config,
  telegramClient,
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
    marketSources: sources,
    selectMarketSource: source => { sources.select(source); scanner.invalidateSourceReport(); },
    selectTradingStrategy: (id,revision) => scanner.selectTradingStrategy(id,revision),
    selectTradingAssets: (tickers,revision) => scanner.selectTradingAssets(tickers,revision),
    action: action => { if (action === 'pause') scanner.pause(); else if (action === 'resume') scanner.resume(); else execution.kill(); },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.telegram.miniApp.port, config.telegram.miniApp.host, resolve);
  });
  process.stdout.write(JSON.stringify({ event: 'mini-app-listening', liveSubmissionAllowed: false }) + '\n');
}
if (config.execution.sandboxProtectionEnabled && config.execution.mode === 'sandbox') {
  const safety = new SandboxSafetyMonitor(config, execution, journal, telegramClient, lossGuard);
  const monitor = async () => {
    try {
      const status = await safety.tick();
      process.stdout.write(JSON.stringify({ event: 'sandbox-safety-monitor', ...status, liveSubmissionAllowed: false }) + '\n');
    } catch {
      try { execution.kill(); } catch {} // Journal failure must never imply permission to enter.
      process.stdout.write(JSON.stringify({ event: 'sandbox-safety-monitor-failed', liveSubmissionAllowed: false }) + '\n');
    }
    setTimeout(() => { void monitor(); }, 30_000);
  };
  void monitor();
}
await telegram.start();
