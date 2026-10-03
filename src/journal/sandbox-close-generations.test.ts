import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ScenarioJournal } from './scenario-journal.js';
import { seedPreparedSandbox } from '../execution/sandbox-prepared.test-helper.js';
import { nativeStopKey } from '../execution/sandbox-stop-state.js';
import { sandboxCloseKey, type SandboxProtectionRestoreProof } from '../execution/sandbox-session-policy.js';
import { sandboxTargetEconomics } from '../execution/sandbox-target-policy.js';
import type { SandboxOrderSnapshot } from '../execution/sandbox-order-state.js';

const entryAt='2026-10-01T11:00:00.000Z', stopAt='2026-10-01T11:01:00.000Z';
const now=new Date('2026-10-01T11:02:00.000Z'), due=new Date('2026-10-01T15:30:00.000Z');
const dirs:string[]=[];
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});

function setup(snapshotPatch: Record<string,unknown> = {}) {
  const dir=mkdtempSync(join(tmpdir(),'trading-generations-'));dirs.push(dir);
  const path=join(dir,'journal.sqlite'), journal=new ScenarioJournal(path);seedPreparedSandbox(journal,'local-account');
  const scenario=journal.record({observedAt:entryAt,strategy:'intraday',instrumentId:'local-instrument',
    input:{side:'long',entryPrice:10,stopPrice:9.9,targetPrice:11,lotSize:10,slippageRate:0.0005},decision:'candidate',blockers:[],warnings:[],
    snapshot:{source:'intraday-scanner',tradingStrategy:{id:'trend-momentum-v1',version:'1'},
      instrument:{instrumentId:'local-instrument',lotSize:10,priceStep:0.01},
      sandboxTargetExitPolicy:{version:'1',enabled:true,commissionRateNano:'3000000',slippageRateNano:'500000'},
      tradePlan:{lots:5,positionRub:500,totalRiskRub:9},...snapshotPatch}});
  const order=journal.queueExecution({scenarioId:scenario.id,mode:'sandbox',instrumentId:scenario.instrumentId,side:'long',lots:5,
    limitPrice:10,estimatedRiskRub:9,orderRequestId:randomUUID()});
  journal.claimExecution(scenario.id,'42');journal.markExecutionAccepted(scenario.id,'local-entry','accepted',5);
  const entry:SandboxOrderSnapshot={brokerOrderId:'local-entry',executionStatus:'EXECUTION_REPORT_STATUS_FILL',terminal:true,
    lotsExecuted:5,grossNano:'500000000000',commissionNano:'2000000000',
    stages:[{tradeId:'local-buy',lots:5,priceNano:'10000000000',executedAt:entryAt}]};
  journal.recordExecutionReconciliation(scenario.id,entry);
  const requestId=randomUUID();journal.claimNativeStop({scenarioId:scenario.id,accountId:'local-account',requestId,
    instrumentId:scenario.instrumentId,entryRequestId:order.orderRequestId,lots:5,stopNano:'9900000000',limitNano:'9900000000',createdAt:stopAt,brokerStopId:null});
  journal.acknowledgeNativeStop(scenario.id,requestId,'local-stop');
  journal.observeNativeStop(scenario.id,{status:'STOP_ORDER_STATUS_ACTIVE',childOrderId:null});
  const proof=()=>sandboxTargetEconomics(journal.getSandboxLossLedger().orders[0]!.entry!,
    {lotSize:10,targetNano:'11000000000',stopNano:'9900000000',tickNano:'10000000',commissionRateNano:'3000000',slippageRateNano:'500000'})!;
  const close=(purpose:'target'|'session'='target',at=now)=>{
    const native=journal.getNativeStop(scenario.id)!.intent;
    return journal.claimSandboxSessionExit({scenarioId:scenario.id,accountId:native.accountId,entryRequestId:native.entryRequestId,
      instrumentId:native.instrumentId,lots:native.lots,stopId:native.brokerStopId!,generation:nativeStopKey(native).generation},at,purpose,purpose==='target'?proof():undefined);
  };
  const cancel=()=>journal.observeNativeStop(scenario.id,{status:'STOP_ORDER_STATUS_CANCELED',childOrderId:null},nativeStopKey(journal.getNativeStop(scenario.id)!.intent));
  const restoreProof=(at=now):SandboxProtectionRestoreProof=>({accountId:'local-account',instrumentId:scenario.instrumentId,lots:5,
    lotSize:10,positionUnits:'50',checkedAt:at.toISOString(),noActiveOrders:true,noOtherActiveStops:true,
    stop:{status:'STOP_ORDER_STATUS_CANCELED',childOrderId:null}});
  const restore=(at=now)=>journal.claimProtectionRestore(sandboxCloseKey(journal.getSandboxSessionExit(scenario.id)!),
    journal.getSandboxLossLedger().revision,restoreProof(at),at);
  const submit=(at=now)=>journal.claimSandboxSessionSubmission(scenario.id,journal.getSandboxLossLedger().revision,
    journal.getSandboxSessionExit(scenario.id)!.purpose==='target'?'11000000000':'9900000000',at,
    sandboxCloseKey(journal.getSandboxSessionExit(scenario.id)!),journal.getSandboxSessionExit(scenario.id)!.purpose==='target'?proof():undefined);
  const activate=(at=now)=>{
    const native=journal.getNativeStop(scenario.id)!.intent;
    journal.acknowledgeNativeStop(scenario.id,native.requestId,`local-stop-${nativeStopKey(native).generation}`,nativeStopKey(native));
    const key=nativeStopKey(journal.getNativeStop(scenario.id)!.intent);
    journal.observeNativeStop(scenario.id,{status:'STOP_ORDER_STATUS_ACTIVE',childOrderId:null},key);
    journal.markProtectionRestored(sandboxCloseKey(journal.getSandboxSessionExit(scenario.id)!),key,at);
  };
  return{path,journal,scenario,order,entry,proof,close,cancel,restoreProof,restore,submit,activate};
}
function zero(commissionNano:string|null='0'):SandboxOrderSnapshot{return{brokerOrderId:'local-target-sell',
  executionStatus:'EXECUTION_REPORT_STATUS_REJECTED',terminal:true,lotsExecuted:0,grossNano:'0',commissionNano,stages:[]};}
function sold(lots=5,at=due,brokerOrderId='local-child'):SandboxOrderSnapshot{return{brokerOrderId,
  executionStatus:lots===5?'EXECUTION_REPORT_STATUS_FILL':'EXECUTION_REPORT_STATUS_PARTIALLYFILL',terminal:lots===5,
  lotsExecuted:lots,grossNano:String(9_900_000_000n*BigInt(lots)*10n),commissionNano:'1000000000',
  stages:[{tradeId:'local-sell',lots,priceNano:'9900000000',executedAt:at.toISOString()}]};}

describe('Atomic sandbox protection generations',()=>{
  it('two journal actors share one target cancel ownership and one SELL ownership',()=>{
    const f=setup(),other=new ScenarioJournal(f.path),first=f.close();
    const native=f.journal.getNativeStop(f.scenario.id)!.intent;
    const second=other.claimSandboxSessionExit({scenarioId:f.scenario.id,accountId:native.accountId,entryRequestId:native.entryRequestId,
      instrumentId:native.instrumentId,lots:native.lots,stopId:native.brokerStopId!,generation:0},now,'target',f.proof());
    expect(first.claimed).toBe(true);expect(second).toMatchObject({claimed:false,intent:{requestId:first.intent.requestId}});
    f.cancel();expect(f.submit().claimed).toBe(true);
    expect(other.claimSandboxSessionSubmission(f.scenario.id,other.getSandboxLossLedger().revision,'11000000000',now,
      sandboxCloseKey(first.intent),f.proof()).claimed).toBe(false);
  });
  it('one no-submit restore wins over a stale SELL claim and survives a separate SQLite actor',()=>{
    const f=setup();const close=f.close().intent, key=sandboxCloseKey(close);f.cancel();
    const revision=f.journal.getSandboxLossLedger().revision;
    const first=f.restore(), other=new ScenarioJournal(f.path);
    expect(first.claimed).toBe(true);expect(first.record.intent).toMatchObject({generation:1,brokerStopId:null});
    expect(first.record.intent.requestId).not.toBe(f.journal.getSandboxCloseHistory(f.scenario.id)[0]!.native.intent.requestId);
    expect(other.claimProtectionRestore(key,revision,f.restoreProof(),now)).toMatchObject({claimed:false,record:{intent:{generation:1}}});
    expect(()=>other.claimSandboxSessionSubmission(f.scenario.id,other.getSandboxLossLedger().revision,'11000000000',now,key,f.proof())).toThrow('no longer');
    expect(f.journal.getSandboxFailedCloseCosts(f.scenario.id)).toEqual({commissionNano:'0',attempts:1});
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toBeNull();expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it('unknown new stop ACK cannot be reclaimed, acknowledged without a generation key, or marked ACTIVE',()=>{
    const f=setup();const old=nativeStopKey(f.journal.getNativeStop(f.scenario.id)!.intent);f.close();f.cancel();f.restore();
    const current=f.journal.getNativeStop(f.scenario.id)!.intent;
    expect(()=>f.journal.claimNativeStop({...current,requestId:randomUUID()})).toThrow();
    expect(()=>f.journal.acknowledgeNativeStop(f.scenario.id,current.requestId,'new-stop')).toThrow('generation');
    expect(()=>f.journal.acknowledgeNativeStop(f.scenario.id,current.requestId,'new-stop',old)).toThrow('generation');
    expect(()=>f.journal.observeNativeStop(f.scenario.id,{status:'STOP_ORDER_STATUS_ACTIVE',childOrderId:null})).toThrow();
    expect(()=>f.journal.observeNativeStop(f.scenario.id,{status:'STOP_ORDER_STATUS_EXECUTED',childOrderId:'old-child'},old)).toThrow();
    expect(()=>f.journal.markProtectionRestored(sandboxCloseKey(f.journal.getSandboxSessionExit(f.scenario.id)!),nativeStopKey(current),now)).toThrow('ACTIVE');
    f.activate();expect(f.journal.getSandboxSessionExit(f.scenario.id)?.phase).toBe('restored');
    expect(()=>f.journal.observeNativeStop(f.scenario.id,{status:'STOP_ORDER_STATUS_EXECUTED',childOrderId:'old-child'},old)).toThrow('generation');
    expect(()=>f.journal.observeNativeStop(f.scenario.id,{status:'STOP_ORDER_STATUS_ACTIVE',childOrderId:null})).toThrow('generation');
  });
  it.each(['no-observation','NEW','partial','filled'])('forbids restoration while SELL is %s',condition=>{
    const f=setup();f.close();f.cancel();f.submit();
    const key=sandboxCloseKey(f.journal.getSandboxSessionExit(f.scenario.id)!);
    if(condition==='NEW')f.journal.recordCloseSellObservation(key,{...zero(),executionStatus:'EXECUTION_REPORT_STATUS_NEW',terminal:false},now);
    if(condition==='partial')f.journal.recordCloseSellObservation(key,sold(2,now,'local-target-sell'),now);
    if(condition==='filled')f.journal.recordCloseSellObservation(key,sold(5,now,'local-target-sell'),now);
    expect(()=>f.restore()).toThrow('Unknown or nonzero');
    expect(f.journal.getNativeStop(f.scenario.id)!.intent.generation??0).toBe(0);
    expect(f.journal.getSandboxCloseHistory(f.scenario.id)).toEqual([]);
  });
  it.each([null,'0','500000000'])('terminal zero SELL restores physically even if fee is %s',fees=>{
    const f=setup();f.close();f.cancel();f.submit();const key=sandboxCloseKey(f.journal.getSandboxSessionExit(f.scenario.id)!);
    f.journal.recordCloseSellObservation(key,zero(fees),now);expect(f.restore().claimed).toBe(true);
    expect(f.journal.getSandboxFailedCloseCosts(f.scenario.id)).toEqual({commissionNano:fees,attempts:1});
    expect(f.journal.getSandboxLossLedger().orders[0]).toMatchObject({failedCloseFeesNano:fees,failedCloseAttempts:1});
  });
  it.each(['revision','stale','future','position','orders','stops','instrument','child'])('rejects %s restoration proof without pointer/history mutation',condition=>{
    const f=setup();f.close();f.cancel();const key=sandboxCloseKey(f.journal.getSandboxSessionExit(f.scenario.id)!);
    const proof={...f.restoreProof()} as SandboxProtectionRestoreProof;let revision=f.journal.getSandboxLossLedger().revision;
    if(condition==='revision')revision='stale';if(condition==='stale')proof.checkedAt=new Date(now.getTime()-15_001).toISOString();
    if(condition==='future')proof.checkedAt=new Date(now.getTime()+1).toISOString();if(condition==='position')proof.positionUnits='49';
    if(condition==='orders')proof.noActiveOrders=false as unknown as true;if(condition==='stops')proof.noOtherActiveStops=false as unknown as true;
    if(condition==='instrument')proof.instrumentId='foreign';if(condition==='child')proof.stop={status:'STOP_ORDER_STATUS_CANCELED',childOrderId:'child'};
    expect(()=>f.journal.claimProtectionRestore(key,revision,proof,now)).toThrow('not confirmed');
    expect(f.journal.getNativeStop(f.scenario.id)!.intent.generation??0).toBe(0);expect(f.journal.getSandboxCloseHistory(f.scenario.id)).toEqual([]);
  });
  it('allows one fresh session attempt after target restoration, never another target or session loop',()=>{
    const f=setup();const targetKey=sandboxCloseKey(f.close().intent);f.cancel();f.restore();f.activate();
    expect(()=>f.close()).toThrow();const session=f.close('session',due);expect(session.claimed).toBe(true);
    expect(session.intent).toMatchObject({generation:1,purpose:'session',targetConsumed:true});expect(session.intent.requestId).not.toBe(targetKey.requestId);
    expect(()=>f.journal.claimSandboxSessionSubmission(f.scenario.id,f.journal.getSandboxLossLedger().revision,'11000000000',due,targetKey,f.proof())).toThrow('identity');
    expect(()=>f.journal.acknowledgeSandboxSessionExit(f.scenario.id,targetKey.requestId,'old-sell',targetKey)).toThrow('identity');
    expect(()=>f.journal.recordCloseSellObservation(targetKey,zero(),due)).toThrow('identity');
    f.cancel();f.submit(due);f.journal.recordCloseSellObservation(sandboxCloseKey(session.intent),zero(),due);f.restore(due);f.activate(due);
    expect(f.journal.getNativeStop(f.scenario.id)!.intent.generation).toBe(2);
    expect(()=>f.close('session',due)).toThrow('Only one');expect(()=>f.close('target',due)).toThrow('Only one');
    expect(f.journal.getSandboxCloseHistory(f.scenario.id).map(item=>item.intent.purpose)).toEqual(['target','session']);
  });
  it('does not introduce restoration retries for the original legacy/session protocol',()=>{
    const f=setup();f.close('session',due);f.cancel();expect(()=>f.restore(due)).toThrow('not confirmed');
    expect(f.journal.getSandboxSessionExit(f.scenario.id)?.targetConsumed).toBe(false);
  });
  it('an old zero SELL fee can arrive after a new native child without overwriting protection or counting twice',()=>{
    const f=setup();const oldClose=sandboxCloseKey(f.close().intent);f.cancel();f.submit();f.journal.recordCloseSellObservation(oldClose,zero(null),now);
    f.restore();f.activate();const native=nativeStopKey(f.journal.getNativeStop(f.scenario.id)!.intent);
    f.journal.observeNativeStop(f.scenario.id,{status:'STOP_ORDER_STATUS_EXECUTED',childOrderId:'local-child'},native);
    expect(()=>f.journal.recordSandboxExitEvidence(f.scenario.id,sold(),due.toISOString(),due)).toThrow();
    expect(()=>f.journal.recordSandboxExitEvidence(f.scenario.id,sold(),due.toISOString(),due,
      nativeStopKey(f.journal.getSandboxCloseHistory(f.scenario.id)[0]!.native.intent))).toThrow();
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toBeNull();
    const result=f.journal.recordSandboxExitEvidence(f.scenario.id,sold(),due.toISOString(),due,native);
    expect(result).toMatchObject({fullySold:true,netPnlNano:null,complete:false,failedCloseFeesNano:null});
    const originalArchive=f.journal.getSandboxCloseHistory(f.scenario.id)[0]!, before=f.journal.getSandboxLossLedger().revision;
    f.journal.refreshArchivedCloseObservation(oldClose,zero('1000000000'),due);
    expect(f.journal.getSandboxLossLedger().revision).not.toBe(before);
    expect(f.journal.getSandboxCloseHistory(f.scenario.id)[0]!.intent).toEqual(originalArchive.intent);
    expect(f.journal.getNativeStop(f.scenario.id)!.intent).toMatchObject({generation:1,brokerStopId:'local-stop-1'});
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)!.snapshot).toEqual(sold());
    expect(f.journal.listSandboxResults()[0]).toMatchObject({netPnlNano:'-9000000000',complete:true,failedCloseFeesNano:'1000000000'});
    const revision=f.journal.getSandboxLossLedger().revision;f.journal.refreshArchivedCloseObservation(oldClose,zero('1000000000'),due);
    expect(f.journal.getSandboxLossLedger().revision).toBe(revision);expect(f.journal.listSandboxResults()[0]?.netPnlNano).toBe('-9000000000');
    expect(()=>f.journal.refreshArchivedCloseObservation(oldClose,{...zero(),brokerOrderId:'foreign'},due)).toThrow('identity');
    expect(()=>f.journal.refreshArchivedCloseObservation(oldClose,sold(1,due,'local-target-sell'),due)).toThrow('identity');
    expect(()=>f.journal.refreshArchivedCloseObservation(oldClose,zero('0'),due)).toThrow();
  });
});

describe('Immutable target claim economics',()=>{
  it.each([{source:'manual'},{tradingStrategy:{id:'unknown',version:'1'}},{tradingStrategy:{id:'trend-momentum-v1',version:1}},
    {sandboxTargetExitPolicy:{version:'1',enabled:false,commissionRateNano:'3000000',slippageRateNano:'500000'}},
    {sandboxTargetExitPolicy:{version:'1',enabled:true,commissionRateNano:'4000000',slippageRateNano:'500000'}},
    {instrument:{instrumentId:'local-instrument',lotSize:10,priceStep:0.03}}])('rejects unconfirmed original metadata %#',patch=>{
    const f=setup(patch);expect(()=>f.close()).toThrow();expect(f.journal.getSandboxSessionExit(f.scenario.id)).toBeNull();
  });
  it('recomputes fee evidence at the atomic SELL claim and never lowers the exact target floor',()=>{
    const f=setup();const original=f.proof(), key=sandboxCloseKey(f.close().intent);f.cancel();
    f.journal.recordExecutionReconciliation(f.scenario.id,{...f.entry,commissionNano:'3000000000'});
    expect(()=>f.journal.claimSandboxSessionSubmission(f.scenario.id,f.journal.getSandboxLossLedger().revision,'11000000000',now,key,original)).toThrow('invalid');
    expect(()=>f.journal.claimSandboxSessionSubmission(f.scenario.id,f.journal.getSandboxLossLedger().revision,'10990000000',now,key,f.proof())).toThrow('exact price');
    const result=f.submit();expect(result.claimed).toBe(true);expect(result.intent.targetProof!.entryCommissionNano).toBe('3000000000');
    expect(result.intent.targetProof!.targetNano).toBe(original.targetNano);expect(result.intent.targetProof!.netTargetNano).not.toBe(original.netTargetNano);
  });
  it('refuses changed immutable model rates even if refreshed arithmetic would still be economic',()=>{
    const f=setup();const key=sandboxCloseKey(f.close().intent);f.cancel();
    const changed=sandboxTargetEconomics(f.entry,{...f.proof(),commissionRateNano:'4000000'})!;
    expect(()=>f.journal.claimSandboxSessionSubmission(f.scenario.id,f.journal.getSandboxLossLedger().revision,'11000000000',now,key,changed)).toThrow('Immutable');
    expect(f.journal.getSandboxSessionExit(f.scenario.id)?.phase).toBe('cancel-claimed');
  });
});
