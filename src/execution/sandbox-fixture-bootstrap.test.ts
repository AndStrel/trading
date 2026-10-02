import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { SandboxFixtureBootstrap, fixtureAuthorization } from './sandbox-fixture-bootstrap.js';
import { sandboxEndpoint, sandboxBootstrapKey } from './sandbox-prepared-account.js';
const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),'fixture-test-'));dirs.push(dir);
  const journal=new ScenarioJournal(join(dir,'journal.sqlite'));
  journal.setRuntimeState('sandbox.fixture_authorization',fixtureAuthorization);
  const config=loadConfig({T_INVEST_EXECUTION_MODE:'sandbox',T_INVEST_SANDBOX_TOKEN:'sandbox-only',T_INVEST_BASE_URL:sandboxEndpoint});
  let name='',cash='0';
  const client={
    openSandboxAccount:vi.fn(async(n:string)=>{name=n;return 'owned';}),
    getSandboxAccounts:vi.fn(async()=>[{id:'original',name:'untouched'},{id:'owned',name}]),
    sandboxPayIn:vi.fn(async()=>{cash='1000';}),
    getSandboxPositions:vi.fn(async()=>({accountId:'owned',limitsLoadingInProgress:false,money:[{currency:'rub',units:cash,nano:0}],blocked:[],securities:[],futures:[],options:[]})),
    getSandboxOrders:vi.fn(async()=>({orders:[]})),getSandboxStopOrders:vi.fn(async()=>({stopOrders:[]})),
  };
  return {journal,client,config,runner:new SandboxFixtureBootstrap(config,client,journal,join(dir,'once'))};
}
it('funds only a new owned fixture once and preserves unrelated accounts',async()=>{
 const f=fixture();expect((await f.runner.prepare()).phase).toBe('ready');
 await f.runner.prepare();expect(f.client.openSandboxAccount).toHaveBeenCalledTimes(1);
 expect(f.client.sandboxPayIn).toHaveBeenCalledExactlyOnceWith('owned',1000);
 expect(f.journal.getRuntimeState(sandboxBootstrapKey)).not.toBeNull();
 expect(f.journal.getRuntimeState('execution.kill_switch')).toBe('true');
});
it('never repeats an uncertain account creation',async()=>{
 const f=fixture();f.client.openSandboxAccount.mockImplementationOnce(async()=>{throw new Error('timeout');});
 await expect(f.runner.prepare()).rejects.toThrow();await expect(f.runner.prepare()).rejects.toThrow();
 expect(f.client.openSandboxAccount).toHaveBeenCalledTimes(1);expect(f.client.sandboxPayIn).not.toHaveBeenCalled();
});
it('reconciles an applied but uncertain funding without a second payment',async()=>{
 const f=fixture();const apply=f.client.sandboxPayIn.getMockImplementation()!;
 f.client.sandboxPayIn.mockImplementationOnce(async()=>{await apply();throw new Error('timeout');});
 await expect(f.runner.prepare()).rejects.toThrow();expect((await f.runner.prepare()).phase).toBe('ready');
 expect(f.client.sandboxPayIn).toHaveBeenCalledTimes(1);
});
it('never retries an unapplied uncertain funding',async()=>{
 const f=fixture();f.client.sandboxPayIn.mockImplementationOnce(async()=>{throw new Error('timeout');});
 await expect(f.runner.prepare()).rejects.toThrow();await expect(f.runner.prepare()).rejects.toThrow();
 expect(f.client.sandboxPayIn).toHaveBeenCalledTimes(1);
});
it('does not fund an unconfirmed or nonflat account',async()=>{
 const f=fixture();f.client.getSandboxPositions.mockResolvedValueOnce({accountId:'foreign',limitsLoadingInProgress:false,money:[],blocked:[],securities:[],futures:[],options:[]});
 await expect(f.runner.prepare()).rejects.toThrow();expect(f.client.sandboxPayIn).not.toHaveBeenCalled();
});
it('rejects absent authorization before any writes',async()=>{
 const f=fixture();f.journal.setRuntimeState('sandbox.fixture_authorization','');
 await expect(f.runner.prepare()).rejects.toThrow();expect(f.client.openSandboxAccount).not.toHaveBeenCalled();
});
it('does not refill a fixture after its balance changes',async()=>{
 const f=fixture();await f.runner.prepare();f.client.getSandboxPositions.mockResolvedValueOnce({accountId:'owned',limitsLoadingInProgress:false,money:[{currency:'rub',units:'999',nano:0}],blocked:[],securities:[],futures:[],options:[]});
 await expect(f.runner.prepare()).rejects.toThrow();expect(f.client.sandboxPayIn).toHaveBeenCalledTimes(1);
});
