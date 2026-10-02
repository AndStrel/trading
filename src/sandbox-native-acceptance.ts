import { closeSync, openSync, readFileSync, statSync } from 'node:fs';
import { loadConfig } from './config.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { TInvestClient } from './tbank/client.js';
import { TInvestOrderClient, TInvestOrderError } from './execution/tinvest-order-client.js';
import { assertSandboxPosition } from './execution/sandbox-stop-state.js';
import { assertNoSandboxOrders } from './execution/sandbox-flat-account.js';
import { z } from 'zod/v4';
import { ExecutionService } from './execution/execution-service.js';
import { SandboxProtectionService } from './execution/sandbox-protection-service.js';
import { SandboxExitService } from './execution/sandbox-exit-service.js';
import { SandboxLossGuard } from './execution/sandbox-loss-guard.js';
import { fixtureAuthorization } from './execution/sandbox-fixture-bootstrap.js';
import { readPreparedSandbox, sandboxEndpoint } from './execution/sandbox-prepared-account.js';
import { technicalApproval, technicalPurpose, technicalEntryInput, selectTechnicalShare, assertTechnicalScope } from './execution/sandbox-technical-scope.js';
import { sandboxBidValue } from './execution/sandbox-loss-policy.js';
import { assessLivePilotRisk } from './execution/live-pilot-risk.js';
import { decimalPriceNano } from './execution/sandbox-stop-state.js';
let stage='authorization',journal:ScenarioJournal|undefined;
try {
 const [phase,approval]=process.argv.slice(2);
 if(!['run','reconcile','recover','recover-stop-key','diagnose-stop-key'].includes(phase??'')||approval!==fixtureAuthorization)throw new Error();
 const path='/run/private/snapshot.json';
 if((statSync(path).mode&0o077)!==0||(statSync('/run/audit').mode&0o077)!==0)throw new Error();
 const snapshot=JSON.parse(readFileSync(path,'utf8')) as {env:NodeJS.ProcessEnv;state:Record<string,string>};
 if(snapshot.env.T_INVEST_EXECUTION_MODE!=='disabled'||snapshot.state['execution.kill_switch']!=='true'
   ||snapshot.env.T_INVEST_TRADING_TOKEN||snapshot.env.T_INVEST_LIVE_TOKEN||snapshot.env.TELEGRAM_BOT_TOKEN||!snapshot.env.T_INVEST_SANDBOX_TOKEN)throw new Error();
 journal=new ScenarioJournal('/run/audit/journal.sqlite');
 const prepared=readPreparedSandbox(journal.getRuntimeState('execution.sandbox_bootstrap_v1'),journal.getRuntimeState('execution.sandbox_account_id'));
 const config=loadConfig({...snapshot.env,T_INVEST_EXECUTION_MODE:'sandbox',T_INVEST_SANDBOX_ACCOUNT_ID:prepared.accountId,
  T_INVEST_LIVE_PILOT_PREPARE:'true',T_INVEST_SANDBOX_PROTECTION_ENABLED:'true',T_INVEST_SANDBOX_LOSS_GUARD_ENABLED:'true'});
 if(config.execution.baseUrl!==sandboxEndpoint||config.livePilot.token||config.execution.token===config.token)throw new Error();
 const market=new TInvestClient(config.token,config.baseUrl,{transport:config.transport,retryAttempts:0,requestTimeoutMs:10000});
 stage='instrument';const share=selectTechnicalShare(await market.getShares());
 const tick=BigInt(share.minPriceIncrement.units)*1_000_000_000n+BigInt(share.minPriceIncrement.nano);
 config.scanner.intradayWatchlist=[{instrumentId:share.uid,lotSize:1,priceStep:Number(tick)/1e9}];
 config.strategies.intraday.maxPositionRub=Math.min(70,config.strategies.intraday.maxPositionRub);config.execution.maxOrdersPerDay=1;
 const client=new TInvestOrderClient(config.execution.token,config.execution.baseUrl,undefined,{transport:config.transport});
 const protection=new SandboxProtectionService(config,client,journal),exits=new SandboxExitService(config,client,journal);
 const loss=new SandboxLossGuard(config,client,market,exits,journal);
 const execution=new ExecutionService(config,market,client,journal,protection,exits,loss);
 if(phase==='run') {
  if(journal.getRuntimeState('technical.scenario_id'))throw new Error();
  closeSync(openSync('/run/audit/native-entry.once','wx',0o600));
  stage='arm-read-only';await execution.armSandboxFixture();
  stage='quote';const [book,status]=await Promise.all([market.getOrderBook(share.uid,20),market.getTradingStatus(share.uid)]);
  const bid=sandboxBidValue(book,status,share.uid,1,1,new Date());
  const input=technicalEntryInput(book,tick,config.scanner.slippageRate);
  const entry=BigInt(decimalPriceNano(input.entryPrice)),trigger=entry-tick,limit=BigInt(bid.worstBidNano)<trigger?BigInt(bid.worstBidNano):trigger;
  if(trigger<=0n||limit<=0n||entry-limit>1_000_000_000n||limit%tick)throw new Error();
  input.stopPrice=Number(trigger)/1e9;
  const risk=assessLivePilotRisk(config.livePilot,{...input,stopPrice:Number(limit)/1e9,lots:1,commissionRate:config.commissionRate,availableCashRub:config.livePilot.capitalRub,reservedDailyRiskRub:0,realizedDailyLossRub:0,markedOpenLossRub:0});
  if(!risk.allowed)throw new Error();
  const scenario=journal.record({observedAt:new Date().toISOString(),strategy:'intraday',instrumentId:share.uid,input,decision:'candidate',blockers:[],warnings:['Technical native-stop test only, not a strategy signal'],snapshot:{purpose:technicalPurpose,authorization:technicalApproval,ticker:'VTBR',acceptanceCase:'native-stop',technicalStopLimitNano:String(limit),technicalTickNano:String(tick),technicalStopQuoteAt:bid.quoteAt,tradePlan:{lots:1,positionRub:risk.positionRub,totalRiskRub:risk.totalRiskRub}}});
  assertTechnicalScope(scenario,1);journal.setRuntimeState('technical.scenario_id',String(scenario.id));
  stage='buy';const result=await execution.submitScenario(scenario.id,'local-human-sandbox-authorization');
  if(result.lotsExecuted!==1||result.executionStatus!=='EXECUTION_REPORT_STATUS_FILL')throw new Error();
 }
 const id=Number(journal.getRuntimeState('technical.scenario_id')),scenario=journal.getScenario(id);
 if(!scenario||scenario.instrumentId!==share.uid)throw new Error();assertTechnicalScope(scenario,1);
 if(phase==='recover-stop-key'||phase==='diagnose-stop-key') {
  if(phase==='diagnose-stop-key') {
   const failure=JSON.parse(journal.getRuntimeState('technical.last_broker_failure')??'null') as {httpStatus?:number;brokerCode?:string;stage?:string}|null;
   if(failure?.httpStatus!==400||failure.brokerCode!=='3'||failure.stage!=='stop-key-response'
    ||!journal.getRuntimeState('technical.stop_key_recovery_claimed'))throw new Error();
  }
  // Explicit technical recovery only, not automatic retry. Replay the exact
  // original broker idempotency key and payload once, never a second intent.
  const intent=journal.getNativeStop(id)?.intent;
  const s=scenario.snapshot as {acceptanceCase?:unknown}|null;
  if(!intent||intent.brokerStopId||intent.accountId!==prepared.accountId||intent.instrumentId!==share.uid
    ||s?.acceptanceCase!=='native-stop'||intent.lots!==1
    ||journal.getRuntimeState('sandbox.fixture_authorization')!==fixtureAuthorization)throw new Error();
  const age=Date.now()-Date.parse(intent.createdAt);if(age<0||age>60*60*1000)throw new Error();
  journal.setExecutionKilled(true);stage='stop-key-preflight';
  const accounts=await client.getSandboxAccounts();
  if(accounts.filter(a=>a.id===prepared.accountId&&a.name===prepared.name).length!==1
    ||new Set(accounts.map(a=>a.id)).size!==accounts.length)throw new Error();
  await execution.reconcileScenario(id);
  for(let pass=0;pass<2;pass++) {
   const [positions,orders,stops]=await Promise.all([client.getSandboxPositions(prepared.accountId),client.getSandboxOrders(prepared.accountId),client.getSandboxStopOrders(prepared.accountId)]);
   assertSandboxPosition(positions,prepared.accountId,share.uid,1n);assertNoSandboxOrders(orders);
   z.object({stopOrders:z.array(z.unknown()).length(0)}).parse(stops);
  }
  closeSync(openSync(phase==='diagnose-stop-key'?'/run/audit/stop-code-diagnostic.once':'/run/audit/stop-key-recovery.once','wx',0o600));
  journal.setRuntimeState('technical.stop_key_recovery_claimed',new Date().toISOString());
  stage='stop-key-response';
  const brokerId=await client.postSandboxStopLimit({mode:'sandbox',accountId:intent.accountId,instrumentId:intent.instrumentId,requestId:intent.requestId,lots:intent.lots,stopNano:intent.stopNano,limitNano:intent.limitNano});
  journal.acknowledgeNativeStop(id,intent.requestId,brokerId);
 }
 if(phase!=='reconcile') {
  if(phase==='recover'){stage='entry-read-only';await execution.reconcileScenario(id);}
  stage='stop';const stop=await protection.protect(prepared.accountId,id);
  console.log(JSON.stringify({stage,status:stop.status,technicalOnly:true,realOrders:false}));
 }
 stage='native-sale-read-only';await exits.reconcile(prepared.accountId,id);
 journal.setExecutionKilled(true);const result=journal.listSandboxResults().find(r=>r.scenarioId===id);
 console.log(JSON.stringify({result:result?.complete?'native-stop-sale-confirmed':'native-stop-sale-unconfirmed',flatConfirmed:result?.complete??false,netPnlNano:result?.netPnlNano??null,realOrders:false}));
 if(!result?.complete)process.exitCode=1;
}catch (error) {
 if(error instanceof TInvestOrderError)journal?.setRuntimeState('technical.last_broker_failure',JSON.stringify({stage,httpStatus:error.httpStatus??null,brokerCode:error.brokerCode??null,outcomeUncertain:error.outcomeUncertain}));
 const brokerFailure=error instanceof TInvestOrderError?{httpStatus:error.httpStatus??null,brokerCode:error.brokerCode??null}:{};
 journal?.setExecutionKilled(true);console.log(JSON.stringify({result:'native-stop-test-unconfirmed',stage,retryEntry:false,realOrders:false,...brokerFailure}));process.exitCode=1;
}
