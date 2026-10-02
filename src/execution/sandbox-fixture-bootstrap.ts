import { closeSync, openSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import type { AppConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import type { TInvestOrderClient } from './tinvest-order-client.js';
import { sandboxEndpoint, sandboxBootstrapKey, sandboxAccountKey } from './sandbox-prepared-account.js';
import { assertNoSandboxOrders, sandboxFlatCashNano } from './sandbox-flat-account.js';
export const fixtureAuthorization='SANDBOX TEST SUITE AUTHORIZED';
const key='sandbox.fixture_bootstrap_v1';
const stateSchema=z.object({version:z.literal(1),endpoint:z.literal(sandboxEndpoint),nonce:z.uuid(),name:z.string(),
  accountId:z.string().nullable(),phase:z.enum(['open-claimed','opened','payin-claimed','ready'])});
type Client=Pick<TInvestOrderClient,'getSandboxAccounts'|'openSandboxAccount'|'sandboxPayIn'|'getSandboxPositions'|'getSandboxOrders'|'getSandboxStopOrders'>;

// Separate test fixture, never refill or erase the original account/history.
// Permanent filesystem latch plus write-ahead phases: uncertain writes are
// reconciled by READS only, never repeated after restart or timeout.
export class SandboxFixtureBootstrap {
  constructor(private readonly config:AppConfig,private readonly client:Client,private readonly journal:ScenarioJournal,private readonly latchPath:string) {}
  private enabled() {
    if(this.config.execution.mode!=='sandbox'||this.config.execution.baseUrl!==sandboxEndpoint||!this.config.execution.token
      ||this.config.execution.token===this.config.token||this.config.execution.token===this.config.livePilot.token
      ||this.journal.getRuntimeState('sandbox.fixture_authorization')!==fixtureAuthorization)throw new Error('Sandbox fixture authorization is absent');
  }
  async prepare() {
    this.enabled();this.journal.setExecutionKilled(true);
    if(this.journal.getRuntimeState(key))return this.reconcile();
    closeSync(openSync(this.latchPath,'wx',0o600));
    const nonce=randomUUID(),state={version:1 as const,endpoint:sandboxEndpoint,nonce,name:`daily-pilot-${nonce}`,accountId:null as string|null,phase:'open-claimed' as 'open-claimed'|'opened'|'payin-claimed'|'ready'};
    this.journal.setRuntimeState(key,JSON.stringify(state));
    const accountId=await this.client.openSandboxAccount(state.name);
    state.accountId=accountId;state.phase='opened';this.journal.setRuntimeState(key,JSON.stringify(state));
    await this.assertOwned(state);await this.assertFlat(accountId,0n);
    state.phase='payin-claimed';this.journal.setRuntimeState(key,JSON.stringify(state));
    await this.client.sandboxPayIn(accountId,1000);
    return this.reconcile();
  }
  async reconcile() {
    this.enabled();this.journal.setExecutionKilled(true);
    const state=stateSchema.parse(JSON.parse(this.journal.getRuntimeState(key)??'null'));
    if(state.name!==`daily-pilot-${state.nonce}`)throw new Error('Fixture name mismatch');
    const accounts=await this.client.getSandboxAccounts(),matches=accounts.filter(a=>a.name===state.name);
    if(matches.length!==1||new Set(accounts.map(a=>a.id)).size!==accounts.length||!matches[0]?.id
      ||(state.accountId!==null&&state.accountId!==matches[0].id))throw new Error('Fixture ownership is not confirmed');
    state.accountId=matches[0].id;
    if(state.phase==='open-claimed'||state.phase==='opened') {
      await this.assertFlat(state.accountId,0n);state.phase='opened';this.journal.setRuntimeState(key,JSON.stringify(state));return state;
    }
    await this.assertFlat(state.accountId,1000_000_000_000n);
    state.phase='ready';this.journal.setRuntimeState(key,JSON.stringify(state));
    this.journal.setRuntimeState(sandboxBootstrapKey,JSON.stringify(state));this.journal.setRuntimeState(sandboxAccountKey,state.accountId);
    this.journal.setRuntimeState('sandbox.fixture_ready','true');return state;
  }
  private async assertOwned(state:{name:string;accountId:string|null}) {
    const accounts=await this.client.getSandboxAccounts(),matches=accounts.filter(a=>a.id===state.accountId&&a.name===state.name);
    if(matches.length!==1||new Set(accounts.map(a=>a.id)).size!==accounts.length)throw new Error('Fixture ownership is not confirmed');
  }
  private async assertFlat(accountId:string,cash:bigint) {
    const [p,orders,stops]=await Promise.all([this.client.getSandboxPositions(accountId),this.client.getSandboxOrders(accountId),this.client.getSandboxStopOrders(accountId)]);
    assertNoSandboxOrders(orders);z.object({stopOrders:z.array(z.unknown()).length(0)}).parse(stops);
    if(cash===0n) {
      // An explicitly empty monetary list on a NEW zero-cash fixture is valid,
      // but never accepted as missing data or used for funded-account arming.
      const zero=z.object({accountId:z.literal(accountId),limitsLoadingInProgress:z.literal(false),blocked:z.array(z.unknown()).length(0),
        securities:z.array(z.unknown()).length(0),futures:z.array(z.unknown()).length(0),options:z.array(z.unknown()).length(0),
        money:z.array(z.object({currency:z.literal('rub'),units:z.literal('0').default('0'),nano:z.literal(0).default(0)})).max(1)});
      zero.parse(p);
    }else if(sandboxFlatCashNano(p,accountId)!==cash)throw new Error('Fixture funding is not confirmed');
  }
}
