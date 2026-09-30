import { loadConfig } from './config.js';
import { LivePilotPreflight } from './execution/live-pilot-preflight.js';
import { LivePreflightClient } from './execution/live-preflight-client.js';

// Safe deployment read-back: only explicit numeric settings and boolean readiness.
// No environment dump, IDs, tokens, holdings, account names or raw broker payloads.
const config = loadConfig();
const report = await new LivePilotPreflight(config,
  new LivePreflightClient(config.livePilot.token, config.baseUrl, config.transport)).check();
process.stdout.write(JSON.stringify({
  executionMode: config.execution.mode,
  pilotPreparing: config.livePilot.prepare,
  capitalRub: config.livePilot.capitalRub,
  maxTradeRiskRub: config.strategies.intraday.maxRiskRub,
  maxPositionRub: config.strategies.intraday.maxPositionRub,
  maxDailyRiskRub: config.execution.maxDailyRiskRub,
  maxDailyLossRub: config.livePilot.maxDailyLossRub,
  commissionRate: config.commissionRate,
  liveTokenPresent: Boolean(config.livePilot.token),
  liveAccountConfigured: Boolean(config.livePilot.accountId),
  accountChecksPassed: report.accountChecksPassed,
  liveSubmissionAllowed: report.liveSubmissionAllowed,
  blockers: report.blockers,
}, null, 2) + '\n');
