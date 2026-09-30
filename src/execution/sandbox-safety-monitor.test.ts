import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {loadConfig} from '../config.js';
import {ScenarioJournal} from '../journal/scenario-journal.js';
import {SandboxSafetyMonitor,sandboxSafetyAlertText} from './sandbox-safety-monitor.js';

const at=new Date('2026-10-01T12:00:00.000Z');const dirs:string[]=[];
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function setup() {
  const dir=mkdtempSync(join(tmpdir(),'trading-safety-'));dirs.push(dir);const path=join(dir,'journal.sqlite');const journal=new ScenarioJournal(path);
  const config=loadConfig({T_INVEST_TOKEN:'local-read',T_INVEST_TRADING_TOKEN:'local-sandbox',T_INVEST_EXECUTION_MODE:'sandbox',
    T_INVEST_SANDBOX_PROTECTION_ENABLED:'true',T_INVEST_SANDBOX_LOSS_GUARD_ENABLED:'true',T_INVEST_SANDBOX_ACCOUNT_ID:'private-local-account',
    TELEGRAM_BOT_TOKEN:'local-bot-token',TELEGRAM_ALLOWED_CHAT_IDS:'42,-9,42',TELEGRAM_MINI_APP_ENABLED:'true',TELEGRAM_MINI_APP_URL:'https://example.test/'});
  const execution={isReady:vi.fn().mockReturnValue(true),protectOutstanding:vi.fn().mockResolvedValue({active:0,triggered:0,closed:0,unconfirmed:0,morePending:false})};
  const guard={assess:vi.fn().mockResolvedValue({status:'ok',checkedAt:at.toISOString(),day:'2026-10-01',closedLossNano:'0',openLossNano:'0',maxTradeLossNano:'0'})};
  const client={sendMessage:vi.fn().mockResolvedValue(undefined)};
  const monitor=new SandboxSafetyMonitor(config,execution,journal,client,guard);
  return {config,execution,guard,client,journal,path,monitor};
}

describe('Sandbox safety monitor delivery and isolation',()=>{
  it.each(['disabled','protection-off'])('does nothing at all when %s',async condition=>{
    const f=setup();if(condition==='disabled')f.config.execution.mode='disabled';else f.config.execution.sandboxProtectionEnabled=false;
    const record=vi.spyOn(f.journal,'recordSandboxSafetyCheck');
    expect(await f.monitor.tick(at)).toMatchObject({checked:false,delivered:0});
    expect(record).not.toHaveBeenCalled();expect(f.execution.protectOutstanding).not.toHaveBeenCalled();expect(f.guard.assess).not.toHaveBeenCalled();expect(f.client.sendMessage).not.toHaveBeenCalled();
  });
  it('healthy checks stay quiet and never clear a durable kill',async()=>{
    const f=setup();expect(await f.monitor.tick(at)).toMatchObject({checked:true,reason:null,delivered:0});
    expect(f.journal.isExecutionKilled()).toBe(true);expect(f.client.sendMessage).not.toHaveBeenCalled();
  });
  it.each(['protection','more-pending','loss-incomplete','loss-limit','not-ready','failed','stale-guard','invalid-counts'])
    ('kills entries and privately alerts on %s',async condition=>{
      const f=setup();f.journal.setExecutionKilled(false);
      if(condition==='protection')f.execution.protectOutstanding.mockResolvedValue({active:0,triggered:0,closed:0,unconfirmed:1,morePending:false});
      if(condition==='more-pending')f.execution.protectOutstanding.mockResolvedValue({active:0,triggered:0,closed:0,unconfirmed:0,morePending:true});
      if(condition==='invalid-counts')f.execution.protectOutstanding.mockResolvedValue({active:NaN,triggered:0,closed:0,unconfirmed:0,morePending:false});
      if(condition.startsWith('loss-'))f.guard.assess.mockResolvedValue({status:condition==='loss-limit'?'limit':'incomplete',checkedAt:at.toISOString(),day:'2026-10-01',closedLossNano:'0',openLossNano:'0',maxTradeLossNano:'0'});
      if(condition==='not-ready')f.execution.isReady.mockReturnValue(false);
      if(condition==='failed')f.execution.protectOutstanding.mockRejectedValue(new Error('private-local-order private-token'));
      if(condition==='stale-guard')f.guard.assess.mockResolvedValue({status:'ok',checkedAt:new Date(at.getTime()-30_001).toISOString(),day:'2026-10-01',closedLossNano:'0',openLossNano:'0',maxTradeLossNano:'0'});
      expect(await f.monitor.tick(at)).toMatchObject({delivered:1,deliveryFailed:0});expect(f.journal.isExecutionKilled()).toBe(true);
      expect(f.client.sendMessage).toHaveBeenCalledExactlyOnceWith('42',expect.stringContaining('ПЕСОЧНИЦА'),{replyMarkup:{inline_keyboard:[[{text:'Панель',web_app:{url:f.config.telegram.miniApp.url}}]]}});
      const text=f.client.sendMessage.mock.calls[0]?.[1] as string;
      for(const secret of ['private-local-account','private-local-order','private-token','local-sandbox','local-read'])expect(text).not.toContain(secret);
      expect(text).toContain('Новые входы заблокированы');
    });
  it('persists delivery across repeat checks and service restart',async()=>{
    const f=setup();f.execution.protectOutstanding.mockRejectedValue(new Error('private'));
    expect(await f.monitor.tick(at)).toMatchObject({delivered:1});
    expect(await f.monitor.tick(at)).toMatchObject({delivered:0});
    expect(await new SandboxSafetyMonitor(f.config,f.execution,new ScenarioJournal(f.path),f.client,f.guard).tick(at)).toMatchObject({delivered:0});
    expect(f.client.sendMessage).toHaveBeenCalledOnce();
  });
  it('coalesces concurrent ticks in one process',async()=>{
    const f=setup();f.execution.protectOutstanding.mockRejectedValue(new Error('private'));
    await Promise.all([f.monitor.tick(at),f.monitor.tick(at)]);
    expect(f.execution.protectOutstanding).toHaveBeenCalledOnce();expect(f.client.sendMessage).toHaveBeenCalledOnce();
  });
  it('two separate actors sharing SQLite cannot concurrently deliver the same notice',async()=>{
    const f=setup();f.execution.protectOutstanding.mockRejectedValue(new Error('private'));
    const other=new SandboxSafetyMonitor(f.config,f.execution,new ScenarioJournal(f.path),f.client,f.guard);
    await Promise.all([f.monitor.tick(at),other.tick(at)]);expect(f.client.sendMessage).toHaveBeenCalledOnce();
  });
  it('retries failed/unknown delivery no sooner than five minutes, without losing the incident',async()=>{
    const f=setup();f.execution.protectOutstanding.mockRejectedValue(new Error('private'));f.client.sendMessage.mockRejectedValueOnce(new Error('private-timeout'));
    expect(await f.monitor.tick(at)).toMatchObject({delivered:0,deliveryFailed:1});
    expect(await new SandboxSafetyMonitor(f.config,f.execution,new ScenarioJournal(f.path),f.client,f.guard).tick(new Date(at.getTime()+299_999))).toMatchObject({delivered:0});
    expect(f.client.sendMessage).toHaveBeenCalledOnce();
    expect(await f.monitor.tick(new Date(at.getTime()+300_000))).toMatchObject({delivered:1});expect(f.client.sendMessage).toHaveBeenCalledTimes(2);
  });
  it('a successful check ends deduplication but does not clear kill; a new incident alerts again',async()=>{
    const f=setup();f.execution.protectOutstanding.mockRejectedValueOnce(new Error('private'));
    await f.monitor.tick(at);expect(await f.monitor.tick(at)).toMatchObject({reason:null,delivered:0});
    expect(f.journal.isExecutionKilled()).toBe(true);f.execution.protectOutstanding.mockRejectedValueOnce(new Error('private'));
    expect(await f.monitor.tick(at)).toMatchObject({delivered:1});expect(f.client.sendMessage).toHaveBeenCalledTimes(2);
  });
  it('does not broadcast private execution warnings to a group or invent an authorized recipient',async()=>{
    const f=setup();f.config.telegram.allowedChatIds=['-9'];f.execution.protectOutstanding.mockRejectedValue(new Error('private'));
    expect(await f.monitor.tick(at)).toMatchObject({reason:'monitor-unavailable',noPrivateRecipient:true,delivered:0});
    expect(f.client.sendMessage).not.toHaveBeenCalled();expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it('without Mini App URL sends a plain private warning, not a broken button',async()=>{
    const f=setup();f.config.telegram.miniApp.enabled=false;f.execution.protectOutstanding.mockRejectedValue(new Error('private'));
    await f.monitor.tick(at);expect(f.client.sendMessage).toHaveBeenCalledWith('42',expect.any(String),undefined);
  });
  it.each(['guard-missing','account-missing','future-guard'])('never calls an incomplete monitor cycle healthy: %s',async condition=>{
    const f=setup();if(condition==='account-missing')delete f.config.execution.accountId;
    if(condition==='future-guard')f.guard.assess.mockResolvedValue({status:'ok',checkedAt:new Date(at.getTime()+1).toISOString(),day:'2026-10-01',closedLossNano:'0',openLossNano:'0',maxTradeLossNano:'0'});
    const monitor=new SandboxSafetyMonitor(f.config,f.execution,f.journal,f.client,condition==='guard-missing'?undefined:f.guard);
    expect(await monitor.tick(at)).toMatchObject({reason:'monitor-unavailable',delivered:1});expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it('an unexpectedly long maintenance cycle is not a healthy check',async()=>{
    const f=setup();vi.spyOn(performance,'now').mockReturnValueOnce(0).mockReturnValue(60_001);
    expect(await f.monitor.tick(at)).toMatchObject({reason:'monitor-unavailable',delivered:1});
  });
});

describe('Atomic private safety notice journal',()=>{
  it('cannot claim stale/future/resolved checks or arbitrary/group recipients',()=>{
    const f=setup();f.journal.recordSandboxSafetyCheck('protection-unconfirmed',at);
    expect(f.journal.claimSandboxSafetyNotice('42',new Date(at.getTime()+60_001))).toBeNull();
    expect(f.journal.claimSandboxSafetyNotice('42',new Date(at.getTime()-1))).toBeNull();
    expect(()=>f.journal.claimSandboxSafetyNotice('-9',at)).toThrow();expect(()=>f.journal.claimSandboxSafetyNotice('secret',at)).toThrow();
    f.journal.recordSandboxSafetyCheck(null,at);expect(f.journal.claimSandboxSafetyNotice('42',at)).toBeNull();
  });
  it('lease expiry needs a fresh observation and late acknowledgement cannot acknowledge a new lease',()=>{
    const f=setup();f.journal.recordSandboxSafetyCheck('loss-incomplete',at);const old=f.journal.claimSandboxSafetyNotice('42',at)!;
    const later=new Date(at.getTime()+300_001);expect(f.journal.claimSandboxSafetyNotice('42',later)).toBeNull();
    f.journal.recordSandboxSafetyCheck('loss-incomplete',later);const current=f.journal.claimSandboxSafetyNotice('42',later)!;
    expect(current.attemptId).not.toBe(old.attemptId);expect(f.journal.acknowledgeSandboxSafetyNotice('42',old,later)).toBe(false);
    expect(f.journal.acknowledgeSandboxSafetyNotice('42',current,new Date(later.getTime()-1))).toBe(false);
    expect(f.journal.acknowledgeSandboxSafetyNotice('42',current,later)).toBe(true);expect(f.journal.claimSandboxSafetyNotice('42',later)).toBeNull();
  });
  it('an abandoned claim after crash is recovered only after lease expiry',()=>{
    const f=setup();f.journal.recordSandboxSafetyCheck('monitor-unavailable',at);f.journal.claimSandboxSafetyNotice('42',at);
    const other=new ScenarioJournal(f.path);expect(other.claimSandboxSafetyNotice('42',at)).toBeNull();
    const later=new Date(at.getTime()+300_000);other.recordSandboxSafetyCheck('monitor-unavailable',later);expect(other.claimSandboxSafetyNotice('42',later)).not.toBeNull();
  });
  it('does not overwrite incident state when clock regresses and does not accept arbitrary reason text',()=>{
    const f=setup();f.journal.recordSandboxSafetyCheck('monitor-unavailable',at);
    expect(()=>f.journal.recordSandboxSafetyCheck(null,new Date(at.getTime()-1))).toThrow('clock');
    expect(()=>f.journal.recordSandboxSafetyCheck('private payload' as 'monitor-unavailable',at)).toThrow();
    expect(f.journal.claimSandboxSafetyNotice('42',at)).not.toBeNull();
    expect(()=>sandboxSafetyAlertText('loss-limit','private-date')).toThrow();
  });
  it('bounds delivery ownership to 50 private recipients for an incident',()=>{
    const f=setup();f.journal.recordSandboxSafetyCheck('monitor-unavailable',at);
    for(let id=1;id<=50;id++)expect(f.journal.claimSandboxSafetyNotice(String(id),at)).not.toBeNull();
    expect(()=>f.journal.claimSandboxSafetyNotice('51',at)).toThrow('recipient limit');
    expect(f.journal.claimSandboxSafetyNotice('1',at)).toBeNull();
  });
});
