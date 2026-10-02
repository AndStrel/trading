import { readFileSync, statSync } from 'node:fs';
import { loadConfig } from './config.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { TInvestOrderClient } from './execution/tinvest-order-client.js';
import { SandboxFixtureBootstrap, fixtureAuthorization } from './execution/sandbox-fixture-bootstrap.js';
import { sandboxEndpoint } from './execution/sandbox-prepared-account.js';
// Local sandbox-only fixture tool. No strategy, order posting or live token.
let journal:ScenarioJournal|undefined;
try {
 if(process.argv[2]!==fixtureAuthorization)throw new Error();
 const path='/run/private/snapshot.json';
 if((statSync(path).mode&0o077)!==0||(statSync('/run/audit').mode&0o077)!==0)throw new Error();
 const snapshot=JSON.parse(readFileSync(path,'utf8')) as {env:NodeJS.ProcessEnv;state:Record<string,string>};
 if(snapshot.env.T_INVEST_EXECUTION_MODE!=='disabled'||snapshot.state['execution.kill_switch']!=='true'
   ||snapshot.env.T_INVEST_TRADING_TOKEN||snapshot.env.T_INVEST_LIVE_TOKEN||snapshot.env.TELEGRAM_BOT_TOKEN
   ||!snapshot.env.T_INVEST_SANDBOX_TOKEN)throw new Error();
 const config=loadConfig({...snapshot.env,T_INVEST_EXECUTION_MODE:'sandbox',T_INVEST_SANDBOX_ACCOUNT_ID:undefined});
 if(config.execution.baseUrl!==sandboxEndpoint||config.livePilot.token||config.execution.token===config.token)throw new Error();
 journal=new ScenarioJournal('/run/audit/journal.sqlite');
 journal.setExecutionKilled(true);journal.setRuntimeState('sandbox.fixture_authorization',fixtureAuthorization);
 const client=new TInvestOrderClient(config.execution.token,config.execution.baseUrl,undefined,{transport:config.transport});
 const result=await new SandboxFixtureBootstrap(config,client,journal,'/run/audit/fixture-authorized.once').prepare();
 console.log(JSON.stringify({result:result.phase==='ready'?'sandbox-fixture-ready':'sandbox-fixture-unfunded',newVirtualAccount:true,initialVirtualRub:result.phase==='ready'?1000:0,realOrders:false,ordersPosted:0}));
 if(result.phase!=='ready')process.exitCode=1;
}catch {
 journal?.setExecutionKilled(true);
 console.log(JSON.stringify({result:'sandbox-fixture-unconfirmed',automaticWriteRetry:false,realOrders:false}));process.exitCode=1;
}
