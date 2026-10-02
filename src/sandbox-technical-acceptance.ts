import { closeSync, existsSync, openSync, readFileSync, statSync } from 'node:fs';
import { loadConfig } from './config.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { TInvestClient } from './tbank/client.js';
import { TInvestOrderClient } from './execution/tinvest-order-client.js';
import { ExecutionService } from './execution/execution-service.js';
import { SandboxProtectionService } from './execution/sandbox-protection-service.js';
import { SandboxExitService } from './execution/sandbox-exit-service.js';
import { SandboxLossGuard } from './execution/sandbox-loss-guard.js';
import { SandboxSessionClose } from './execution/sandbox-session-close.js';
import { assertTechnicalScope, selectTechnicalShare, technicalEntryInput, technicalApproval, technicalPurpose } from './execution/sandbox-technical-scope.js';
import { readPreparedSandbox, sandboxEndpoint } from './execution/sandbox-prepared-account.js';
import { assessLivePilotRisk } from './execution/live-pilot-risk.js';
import { sandboxBidValue } from './execution/sandbox-loss-policy.js';
import { formatNanoRub } from './execution/sandbox-round-trip.js';

// Intentionally not a bot command, not a scheduled service and not live-capable.
// Use a dedicated persistent PRIVATE audit mount. Re-running cannot BUY again.
let stage='authorization';
let activeJournal:ScenarioJournal|undefined;
try {
  const [phase,approval]=process.argv.slice(2);
  if(!['run','reconcile','recover','close'].includes(phase??'')||approval!==technicalApproval) throw new Error();
  const snapshotPath='/run/private/snapshot.json', journalPath='/run/audit/journal.sqlite';
  if((statSync(snapshotPath).mode&0o077)!==0||(statSync('/run/audit').mode&0o077)!==0)throw new Error();
  const snapshot=JSON.parse(readFileSync(snapshotPath,'utf8')) as {env:NodeJS.ProcessEnv;state:Record<string,string>};
  if(snapshot.env.T_INVEST_TRADING_TOKEN||snapshot.env.T_INVEST_LIVE_TOKEN||!snapshot.env.T_INVEST_SANDBOX_TOKEN
    || snapshot.env.TELEGRAM_BOT_TOKEN||snapshot.env.T_INVEST_EXECUTION_MODE!=='disabled'||snapshot.state['execution.kill_switch']!=='true')throw new Error();
  const prepared=readPreparedSandbox(snapshot.state['execution.sandbox_bootstrap_v1']??null,snapshot.state['execution.sandbox_account_id']??null,snapshot.env.T_INVEST_SANDBOX_ACCOUNT_ID);
  const c=loadConfig({...snapshot.env,T_INVEST_EXECUTION_MODE:'sandbox',T_INVEST_LIVE_PILOT_PREPARE:'true',
    T_INVEST_SANDBOX_PROTECTION_ENABLED:'true',T_INVEST_SANDBOX_LOSS_GUARD_ENABLED:'true',T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED:'true'});
  if(c.execution.baseUrl!==sandboxEndpoint||c.execution.token===c.token||c.livePilot.token)throw new Error();
  const market=new TInvestClient(c.token,c.baseUrl,{transport:c.transport,retryAttempts:0,requestTimeoutMs:10000});
  stage='instrument';
  const share=selectTechnicalShare(await market.getShares());
  const tickQ=share.minPriceIncrement;
  if(!tickQ||typeof tickQ.units!=='string'||!Number.isSafeInteger(tickQ.nano))throw new Error();
  const tick=BigInt(tickQ.units)*1_000_000_000n+BigInt(tickQ.nano!);if(tick<=0n)throw new Error();
  c.scanner.intradayWatchlist=[{instrumentId:share.uid,lotSize:1,priceStep:Number(tick)/1e9}];
  c.strategies.intraday.maxPositionRub=Math.min(c.strategies.intraday.maxPositionRub,70);
  c.execution.maxOrdersPerDay=1;
  const existing=existsSync(journalPath);
  if(phase==='run'&&existing)throw new Error('Existing audit must be reconciled, never repeated');
  if(phase!=='run'&&!existing)throw new Error();
  // Permanent single-attempt latch: two containers/processes cannot both BUY.
  // No broker writes or mutable journal exist before this exclusive claim.
  // It is never removed automatically, including on timeout or crash.
  if(phase==='run')closeSync(openSync('/run/audit/entry-authorized.once','wx',0o600));
  const journal=new ScenarioJournal(journalPath);
  activeJournal=journal;
  const client=new TInvestOrderClient(c.execution.token,c.execution.baseUrl,undefined,{transport:c.transport});
  const exits=new SandboxExitService(c,client,journal), protection=new SandboxProtectionService(c,client,journal);
  const loss=new SandboxLossGuard(c,client,market,exits,journal), closer=new SandboxSessionClose(c,client,market,exits,journal);
  const execution=new ExecutionService(c,market,client,journal,protection,exits,loss,closer);
  if(phase==='run') {
    for(const key of ['execution.sandbox_bootstrap_v1','execution.sandbox_account_id'])journal.setRuntimeState(key,snapshot.state[key]!);
    journal.setRuntimeState('technical.authorization',technicalApproval);
    stage='arm-read-only';await execution.armSandbox();
    stage='price';const [book,status]=await Promise.all([market.getOrderBook(share.uid,20),market.getTradingStatus(share.uid)]);
    sandboxBidValue(book,status,share.uid,1,1,new Date());
    const input=technicalEntryInput(book,tick,c.scanner.slippageRate);
    const risk=assessLivePilotRisk(c.livePilot,{...input,lots:1,commissionRate:c.commissionRate,availableCashRub:c.livePilot.capitalRub,
      reservedDailyRiskRub:0,realizedDailyLossRub:0,markedOpenLossRub:0});if(!risk.allowed)throw new Error();
    const scenario=journal.record({observedAt:new Date().toISOString(),strategy:'intraday',instrumentId:share.uid,input,decision:'candidate',blockers:[],
      warnings:['Technical acceptance only: no strategy signal or profit claim'],note:technicalPurpose,
      snapshot:{purpose:technicalPurpose,authorization:technicalApproval,ticker:'VTBR',tradePlan:{lots:1,positionRub:risk.positionRub,totalRiskRub:risk.totalRiskRub}}});
    assertTechnicalScope(scenario,1);journal.setRuntimeState('technical.scenario_id',String(scenario.id));
    stage='entry';console.log(JSON.stringify({stage,ticker:'VTBR',lots:1,limitRub:input.entryPrice,stopRub:input.stopPrice,technicalOnly:true}));
    const result=await execution.submitScenario(scenario.id,'local-human-sandbox-authorization');
    if(result.lotsExecuted!==1||result.executionStatus!=='EXECUTION_REPORT_STATUS_FILL')throw new Error();
    stage='stop';const stop=await protection.protect(prepared.accountId,scenario.id);
    if(stop.status!=='STOP_ORDER_STATUS_ACTIVE')throw new Error();
    console.log(JSON.stringify({stage,activeConfirmed:true}));
  }
  const id=Number(journal.getRuntimeState('technical.scenario_id'));if(!Number.isSafeInteger(id)||id<=0)throw new Error();
  const scenario=journal.getScenario(id);if(!scenario||scenario.instrumentId!==share.uid||journal.getRuntimeState('technical.authorization')!==technicalApproval)throw new Error();
  assertTechnicalScope(scenario,1);
  if(phase==='recover') {
    stage='reconcile-read-only';await execution.reconcileScenario(id);
    stage='stop';const stop=await protection.protect(prepared.accountId,id);
    if(!['STOP_ORDER_STATUS_ACTIVE','STOP_ORDER_STATUS_EXECUTED'].includes(stop.status))throw new Error();
    console.log(JSON.stringify({stage,activeConfirmed:stop.status==='STOP_ORDER_STATUS_ACTIVE'}));
  }
  stage=phase==='reconcile'?'reconcile-read-only':'close';
  if(phase==='reconcile')await execution.reconcileScenario(id);
  else await closer.closeTechnicalAcceptance(prepared.accountId,id);
  journal.setExecutionKilled(true);
  const result=journal.listSandboxResults().find(r=>r.scenarioId===id);
  console.log(JSON.stringify({result:result?.complete?'sandbox-round-trip-confirmed':'sandbox-incomplete',stage,flatConfirmed:result?.complete??false,
    netRub:result?.netPnlNano?formatNanoRub(result.netPnlNano):null,realOrders:false}));
  if(!result?.complete)process.exitCode=1;
}catch {
  activeJournal?.setExecutionKilled(true);
  // No raw broker payload, token, account ID or private positions in output.
  console.log(JSON.stringify({result:'sandbox-test-unconfirmed',stage,retryEntry:false,realOrders:false}));process.exitCode=1;
}
