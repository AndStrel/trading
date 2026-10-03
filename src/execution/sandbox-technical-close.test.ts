import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { SandboxSessionClose } from './sandbox-session-close.js';
import { SandboxExitService } from './sandbox-exit-service.js';
import { parseSandboxOrderState } from './sandbox-order-state.js';
import { technicalApproval, technicalPurpose } from './sandbox-technical-scope.js';
import { technicalCashAcceptanceVersion } from './sandbox-technical-cash-policy.js';
import { seedPreparedSandbox } from './sandbox-prepared.test-helper.js';
import { sandboxCloseKey } from './sandbox-session-policy.js';
import { nativeStopKey } from './sandbox-stop-state.js';
import type { SandboxCashBaseline } from './sandbox-cash-reconciliation.js';
const dirs:string[]=[];
afterEach(()=>{vi.useRealTimers();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
function fixture(options:{optIn?:boolean;baseline?:boolean}={}) {
  const at=new Date('2026-10-02T09:00:00Z');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
  const dir=mkdtempSync(join(tmpdir(),'technical-close-'));dirs.push(dir);
  const journal=new ScenarioJournal(join(dir,'journal.sqlite'));
  const prepared=seedPreparedSandbox(journal,'account');
  const config=loadConfig({T_INVEST_TOKEN:'read',T_INVEST_SANDBOX_TOKEN:'sandbox',T_INVEST_EXECUTION_MODE:'sandbox',
    T_INVEST_SANDBOX_ACCOUNT_ID:'account',T_INVEST_SANDBOX_PROTECTION_ENABLED:'true',T_INVEST_SANDBOX_LOSS_GUARD_ENABLED:'true',
    T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED:'true',T_INVEST_INTRADAY_WATCHLIST:'[{"instrumentId":"vtbr","lotSize":1,"priceStep":0.01}]'});
  const scenario=journal.record({observedAt:'2026-10-02T08:59:00Z',strategy:'intraday',decision:'candidate',instrumentId:'vtbr',
    input:{side:'long',lotSize:1,entryPrice:52,stopPrice:51,targetPrice:60,slippageRate:0.0005},blockers:[],warnings:[],
    snapshot:{purpose:technicalPurpose,authorization:technicalApproval,ticker:'VTBR',
      ...(options.optIn?{technicalCashAcceptance:{version:technicalCashAcceptanceVersion}}:{})}});
  const request=randomUUID();journal.queueExecution({scenarioId:scenario.id,mode:'sandbox',instrumentId:'vtbr',side:'long',lots:1,limitPrice:52,estimatedRiskRub:2,orderRequestId:request});
  if(options.baseline) {
    journal.setExecutionKilled(false);
    const generation=journal.getRuntimeState('execution.kill_generation')!,raw=JSON.stringify(prepared);
    const baseline:SandboxCashBaseline={version:1,accountId:'account',entryRequestId:request,cashNano:'1000000000000',
      observedFrom:'2026-10-02T08:59:00Z',observedAt:'2026-10-02T08:59:00Z',ledgerRevision:journal.getSandboxLedgerRevision(),killGeneration:generation,preparedRaw:raw};
    journal.claimExecution(scenario.id,'local-human-authorization',{from:'2026-10-01T21:00:00Z',to:'2026-10-02T21:00:00Z',now:'2026-10-02T08:59:00Z',
      maxOrders:1,maxRiskRub:20,preparedSandbox:{raw,accountId:'account',generation},cashBaseline:baseline});
  } else journal.claimExecution(scenario.id,'local-human-authorization');
  journal.markExecutionAccepted(scenario.id,'entry','fill',1);
  const state={stop:'STOP_ORDER_STATUS_ACTIVE',sold:false,sellRequest:'',zeroSell:false,unknownSell:false,sellFeesNano:160000000,
    zeroStatus:'EXECUTION_REPORT_STATUS_CANCELLED',sellNumber:0,restored:null as null|{stopId:string;requestId:string;status:string;createdAt:string}};
  const order=(sell=false)=>({orderId:sell?(state.sellNumber>1?`exit-${state.sellNumber}`:'exit'):'entry',orderRequestId:sell?(state.sellRequest||undefined):request,instrumentUid:'vtbr',
    direction:sell?'ORDER_DIRECTION_SELL':'ORDER_DIRECTION_BUY',orderType:'ORDER_TYPE_LIMIT',currency:'rub',lotsRequested:'1',lotsExecuted:sell&&state.zeroSell?'0':'1',
    executionReportStatus:sell&&state.zeroSell?(state.unknownSell?'EXECUTION_REPORT_STATUS_NEW':state.zeroStatus):'EXECUTION_REPORT_STATUS_FILL',
    stages:sell&&state.zeroSell?[]:[{tradeId:sell?'sell-trade':'buy-trade',quantity:'1',price:{currency:'rub',units:sell?'51':'52',nano:0},executionTime:sell?new Date().toISOString():'2026-10-02T08:59:01Z'}],
    executedCommission:{currency:'rub',units:'0',nano:sell?state.sellFeesNano:160000000},serviceCommission:{currency:'rub',units:'0',nano:0}});
  journal.recordExecutionReconciliation(scenario.id,parseSandboxOrderState(order(),{requestId:request,instrumentId:'vtbr',lots:1,lotSize:1},at));
  const stopRequest=randomUUID();journal.claimNativeStop({scenarioId:scenario.id,accountId:'account',requestId:stopRequest,instrumentId:'vtbr',entryRequestId:request,
    lots:1,stopNano:'51000000000',limitNano:'51000000000',createdAt:'2026-10-02T08:59:02Z',brokerStopId:null});
  journal.acknowledgeNativeStop(scenario.id,stopRequest,'stop');journal.observeNativeStop(scenario.id,{status:'STOP_ORDER_STATUS_ACTIVE',childOrderId:null});
  const observedSells=new Map<string,ReturnType<typeof order>>();
  const client={getSandboxOrderState:vi.fn(async(_a:string,id:string):Promise<unknown>=>{
      if(id===request)return order();
      if(id!==state.sellRequest&&observedSells.has(id))return observedSells.get(id)!;
      const value=order(true);observedSells.set(id,value);return value;
    }),getSandboxChildOrderState:vi.fn(async()=>order(true)),
    getSandboxPositions:vi.fn(async()=>({accountId:'account',limitsLoadingInProgress:false,money:[{currency:'rub',units:'1000',nano:0}],blocked:[],futures:[],options:[],
      securities:state.sold?[]:[{instrumentUid:'vtbr',instrumentType:'share',exchangeBlocked:false,balance:'1',blocked:'0'}]})),
    getSandboxOrders:vi.fn(async()=>({orders:[]})),getSandboxStopOrders:vi.fn(async()=>({stopOrders:[{stopOrderId:'stop',status:state.stop,
      ...(state.stop==='STOP_ORDER_STATUS_EXECUTED'?{exchangeOrderId:'exit'}:{}),instrumentUid:'vtbr',currency:'rub',direction:'STOP_ORDER_DIRECTION_SELL',orderType:'STOP_ORDER_TYPE_STOP_LIMIT',
      lotsRequested:'1',stopPrice:{currency:'rub',units:'51',nano:0},price:{currency:'rub',units:'51',nano:0},createDate:'2026-10-02T08:59:02Z'},
      ...(state.restored?[{stopOrderId:state.restored.stopId,status:state.restored.status,instrumentUid:'vtbr',currency:'rub',direction:'STOP_ORDER_DIRECTION_SELL',
        orderType:'STOP_ORDER_TYPE_STOP_LIMIT',lotsRequested:'1',stopPrice:{currency:'rub',units:'51',nano:0},price:{currency:'rub',units:'51',nano:0},createDate:state.restored.createdAt}]:[])]})),
    cancelSandboxStop:vi.fn(async(input:{stopId:string})=>{if(state.restored?.stopId===input.stopId)state.restored.status='STOP_ORDER_STATUS_CANCELED';else state.stop='STOP_ORDER_STATUS_CANCELED';}),
    postSandboxStopLimit:vi.fn(async(input:{requestId:string})=>{const stopId=`restored-stop-${(journal.getNativeStop(scenario.id)?.intent.generation??0)}`;
      state.restored={stopId,requestId:input.requestId,status:'STOP_ORDER_STATUS_ACTIVE',createdAt:new Date().toISOString()};return stopId;}),
    postSandboxSessionExit:vi.fn(async(input:{requestId:string})=>{state.sellNumber++;state.sellRequest=input.requestId;state.sold=!state.zeroSell;return state.sellNumber>1?`exit-${state.sellNumber}`:'exit';})};
  const market={getInstrumentBy:vi.fn(async()=>({instrument:{uid:'vtbr',ticker:'VTBR',classCode:'TQBR',instrumentType:'share',currency:'rub',lot:1,
    apiTradeAvailableFlag:true,sellAvailableFlag:true,minPriceIncrement:{units:'0',nano:10000000}}})),
    getTradingStatus:vi.fn(async()=>({instrumentUid:'vtbr',tradingStatus:'SECURITY_TRADING_STATUS_NORMAL_TRADING',apiTradeAvailableFlag:true,limitOrderAvailableFlag:true})),
    getOrderBook:vi.fn(async()=>({instrumentUid:'vtbr',orderbookTs:new Date().toISOString(),bids:[{price:{units:'51',nano:0},quantity:'1'}],asks:[{price:{units:'52',nano:0},quantity:'1'}]}))};
  const closer=new SandboxSessionClose(config,client,market,new SandboxExitService(config,client,journal),journal);
  return{closer,journal,scenario,state,client,market,at,request,order,config,path:join(dir,'journal.sqlite')};
}
describe('Explicit technical close with unchanged ownership guards',()=>{
  it('ordinary scheduler still does nothing at noon; explicit close sends once',async()=>{
    const f=fixture();expect(await f.closer.advance('account',f.scenario.id,f.at)).toBeNull();
    expect(await f.closer.closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'session',complete:true});
    expect(await f.closer.closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'session',complete:true});
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it('does not sell if a stop triggers during cancellation',async()=>{
    const f=fixture();f.client.cancelSandboxStop.mockImplementation(async()=>{f.state.stop='STOP_ORDER_STATUS_EXECUTED';f.state.sold=true;});
    await f.closer.closeTechnicalAcceptance('account',f.scenario.id);
    expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.client.getSandboxChildOrderState).toHaveBeenCalledOnce();
  });
  it('uncertain cancellation is never resent and never grants SELL ownership',async()=>{
    const f=fixture();f.client.cancelSandboxStop.mockRejectedValue(new Error('timeout'));
    await expect(f.closer.closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();
    await expect(f.closer.closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();
  });
  it('refuses broker ticker mismatch before canceling protection',async()=>{
    const f=fixture();f.market.getInstrumentBy.mockResolvedValue({instrument:{uid:'vtbr',ticker:'OTHER',classCode:'TQBR',instrumentType:'share',currency:'rub',lot:1,
      apiTradeAvailableFlag:true,sellAvailableFlag:true,minPriceIncrement:{units:'0',nano:10000000}}});
    await expect(f.closer.closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();expect(f.client.cancelSandboxStop).not.toHaveBeenCalled();
  });
});

function newActor(f:ReturnType<typeof fixture>) {
  const journal=new ScenarioJournal(f.path);
  return new SandboxSessionClose(f.config,f.client,f.market,new SandboxExitService(f.config,f.client,journal),journal);
}
function claimCanceled(f:ReturnType<typeof fixture>) {
  f.state.stop='STOP_ORDER_STATUS_CANCELED';
  const stop=f.journal.getNativeStop(f.scenario.id)!;
  // The durable cancellation claim starts from a confirmed ACTIVE observation.
  const claim=f.journal.claimSandboxSessionExit({scenarioId:f.scenario.id,accountId:'account',entryRequestId:f.request,
    instrumentId:'vtbr',lots:1,stopId:'stop',generation:0},f.at,'technical-acceptance');
  f.journal.observeNativeStop(f.scenario.id,{status:'STOP_ORDER_STATUS_CANCELED',childOrderId:null},nativeStopKey(stop.intent));
  const proof={accountId:'account',instrumentId:'vtbr',lots:1,lotSize:1,positionUnits:'1',checkedAt:f.at.toISOString(),
    stop:{status:'STOP_ORDER_STATUS_CANCELED' as const,childOrderId:null},noActiveOrders:true as const,noOtherActiveStops:true as const};
  return{key:sandboxCloseKey(claim.intent),proof,revision:f.journal.getSandboxLedgerRevision()};
}

describe('Opted-in technical cash acceptance restores only owned safe positions',()=>{
  it.each([{optIn:false,baseline:true},{optIn:true,baseline:false}])('does not adopt legacy/missing baseline %j',async options=>{
    const f=fixture(options);f.state.zeroSell=true;
    expect(await f.closer.closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'session',complete:false});
    expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();expect(f.journal.getSandboxSessionExit(f.scenario.id)?.phase).toBe('submitted');
    expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted');expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it.each(['EXECUTION_REPORT_STATUS_CANCELLED','EXECUTION_REPORT_STATUS_REJECTED'])('archives %s zero-fill fees, restores once and keeps entries/risk killed/reserved',async status=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;f.state.sellFeesNano=10000000;
    f.state.zeroStatus=status;
    const baseline=f.journal.getSandboxCashBaseline(f.scenario.id);
    expect(await f.closer.closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();expect(f.journal.getNativeStop(f.scenario.id)?.intent.generation).toBe(1);
    expect(f.journal.getSandboxSessionExit(f.scenario.id)?.phase).toBe('restored');
    expect(f.journal.getSandboxFailedCloseCosts(f.scenario.id)).toEqual({commissionNano:'10000000',attempts:1});
    expect(f.journal.getSandboxLossLedger().orders[0]).toMatchObject({status:'accepted',failedCloseFeesNano:'10000000',exit:null});
    expect(f.journal.getSandboxCashBaseline(f.scenario.id)).toEqual(baseline);expect(f.journal.isExecutionKilled()).toBe(true);
    expect(await f.closer.closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(await newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it('restores a proven canceled not-submitted attempt without granting another technical SELL',async()=>{
    const f=fixture({optIn:true,baseline:true});
    f.client.cancelSandboxStop.mockImplementation(async()=>{f.state.stop='STOP_ORDER_STATUS_CANCELED';throw new Error('lost ACK');});
    expect(await f.closer.closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
    expect(await newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();
    expect(f.journal.getSandboxFailedCloseCosts(f.scenario.id)).toEqual({commissionNano:'0',attempts:1});
  });
  it('does not infer canceled protection from an uncertain cancel ACK',async()=>{
    const f=fixture({optIn:true,baseline:true});f.client.cancelSandboxStop.mockRejectedValue(new Error('timeout'));
    await expect(f.closer.closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();
    await expect(newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
  });
  it('unknown/NEW SELL never authorizes restoration or another SELL',async()=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;f.state.unknownSell=true;
    expect(await f.closer.closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'session',complete:false});
    expect(await newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'session',complete:false});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
  });
  it('a lost SELL ACK is reconciled by its original request, never reposted',async()=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;
    f.client.postSandboxSessionExit.mockImplementation(async(input:{requestId:string})=>{f.state.sellRequest=input.requestId;throw new Error('lost ACK');});
    await expect(f.closer.closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
    expect(await newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it('a lost replacement-stop ACK never authorizes another protective POST',async()=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;
    f.client.postSandboxStopLimit.mockRejectedValue(new Error('lost ACK'));
    await expect(f.closer.closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();
    await expect(newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();expect(f.journal.getSandboxSessionExit(f.scenario.id)?.phase).toBe('restore-claimed');
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();
  });
  it('two actors sharing SQLite claim one replacement protective order',async()=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;
    const results=await Promise.allSettled([f.closer.closeTechnicalAcceptance('account',f.scenario.id),newActor(f).closeTechnicalAcceptance('account',f.scenario.id)]);
    expect(results.some(r=>r.status==='fulfilled'&&r.value?.kind==='restored')).toBe(true);
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it('retains exact late fee observations on the archived zero-fill attempt',async()=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;f.state.sellFeesNano=10000000;
    await f.closer.closeTechnicalAcceptance('account',f.scenario.id);
    const archived=f.journal.getSandboxCloseHistory(f.scenario.id)[0]!,revision=f.journal.getSandboxLedgerRevision();
    f.journal.refreshArchivedCloseObservation(sandboxCloseKey(archived.intent),{...archived.sellSnapshot!,commissionNano:'20000000'},f.at);
    expect(f.journal.getSandboxFailedCloseCosts(f.scenario.id)).toEqual({commissionNano:'20000000',attempts:1});
    expect(f.journal.getSandboxLedgerRevision()).not.toBe(revision);expect(f.journal.getSandboxCashReconciliation(f.scenario.id).cashProven).toBe(false);
    expect(await newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).toMatchObject({kind:'restored',complete:false});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it('a prepared identity change during awaited restoration reads refuses the protective write',async()=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;
    const held=f.client.getSandboxPositions.getMockImplementation()!;let reads=0;
    f.client.getSandboxPositions.mockImplementation(async()=>{reads++;if(reads===3)f.journal.setRuntimeState('execution.sandbox_bootstrap_v1','changed');return held();});
    await expect(f.closer.closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();
    expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();expect(f.journal.getNativeStop(f.scenario.id)?.intent.generation??0).toBe(0);
  });
  it.each(['unknown-status','partial-status','lookup-timeout'])('never restores or resubmits after %s SELL',async condition=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;
    f.client.getSandboxOrderState.mockImplementation(async(_account,id)=>{
      if(id===f.request)return f.order();
      if(condition==='lookup-timeout')throw new Error('timeout');
      return{...f.order(true),executionReportStatus:condition==='partial-status'?'EXECUTION_REPORT_STATUS_PARTIALLYFILL':'UNKNOWN'};
    });
    await expect(f.closer.closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();
    await expect(newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).rejects.toThrow();
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
  });
  it('unknown failed-SELL fees are retained as incomplete, not invented as zero',async()=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;
    f.client.getSandboxOrderState.mockImplementation(async(_account,id)=>id===f.request?f.order():{...f.order(true),serviceCommission:undefined});
    expect(await f.closer.closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(f.journal.getSandboxFailedCloseCosts(f.scenario.id)).toEqual({commissionNano:null,attempts:1});
    expect(f.journal.getSandboxCashReconciliation(f.scenario.id).cashProven).toBe(false);expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it('only a due ordinary session can consume restored protection once more, never a third SELL',async()=>{
    const f=fixture({optIn:true,baseline:true});f.state.zeroSell=true;
    expect(await f.closer.closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(await newActor(f).advance('account',f.scenario.id,f.at)).toEqual({kind:'restored',complete:false});
    const due=new Date('2026-10-02T15:30:00Z');vi.setSystemTime(due);
    expect(await newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();
    expect(await newActor(f).advance('account',f.scenario.id,due)).toEqual({kind:'restored',complete:false});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledTimes(2);expect(f.client.cancelSandboxStop).toHaveBeenCalledTimes(2);expect(f.client.postSandboxStopLimit).toHaveBeenCalledTimes(2);
    expect(f.journal.getSandboxSessionExit(f.scenario.id)).toMatchObject({phase:'restored',purpose:'session',restoreGeneration:2});
    expect(f.journal.getSandboxCloseHistory(f.scenario.id)).toHaveLength(2);
    expect(f.journal.getSandboxFailedCloseCosts(f.scenario.id)).toEqual({commissionNano:'320000000',attempts:2});
    expect(await newActor(f).advance('account',f.scenario.id,due)).toEqual({kind:'restored',complete:false});
    expect(await newActor(f).closeTechnicalAcceptance('account',f.scenario.id)).toEqual({kind:'restored',complete:false});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledTimes(2);expect(f.client.postSandboxStopLimit).toHaveBeenCalledTimes(2);
  });
  it('journal rejects account changes and a stale ledger while observing the canceled stop',()=>{
    const f=fixture({optIn:true,baseline:true}),claim=claimCanceled(f),native=f.journal.getNativeStop(f.scenario.id)!;
    const revision=f.journal.observeNativeStop(f.scenario.id,claim.proof.stop,nativeStopKey(native.intent),claim.revision);
    expect(revision).toBe(claim.revision);
    const changed={...f.journal.getExecutionSnapshot(f.scenario.id)!,commissionNano:'170000000'};
    f.journal.recordExecutionReconciliation(f.scenario.id,changed);
    expect(()=>f.journal.observeNativeStop(f.scenario.id,claim.proof.stop,nativeStopKey(native.intent),revision)).toThrow('raced');
    f.journal.setRuntimeState('execution.sandbox_account_id','other');
    expect(()=>f.journal.claimProtectionRestore(claim.key,f.journal.getSandboxLedgerRevision(),claim.proof,f.at)).toThrow();
    expect(f.journal.getNativeStop(f.scenario.id)?.intent.generation??0).toBe(0);
  });
  it.each([{optIn:false,baseline:true},{optIn:true,baseline:false}])('the atomic journal floor rejects adoption %j',options=>{
    const f=fixture(options),claim=claimCanceled(f);
    expect(()=>f.journal.claimProtectionRestore(claim.key,claim.revision,claim.proof,f.at)).toThrow();
    expect(f.journal.getNativeStop(f.scenario.id)?.intent.generation??0).toBe(0);expect(f.journal.getSandboxCloseHistory(f.scenario.id)).toHaveLength(0);
  });
  it('atomic generation/revision checks survive restart and claim restoration once',()=>{
    const f=fixture({optIn:true,baseline:true}),claim=claimCanceled(f);
    expect(()=>f.journal.claimProtectionRestore({...claim.key,generation:1},claim.revision,claim.proof,f.at)).toThrow();
    expect(()=>f.journal.claimProtectionRestore(claim.key,'0',claim.proof,f.at)).toThrow();
    const winner=f.journal.claimProtectionRestore(claim.key,claim.revision,claim.proof,f.at);
    const other=new ScenarioJournal(f.path).claimProtectionRestore(claim.key,claim.revision,claim.proof,f.at);
    expect(winner.claimed).toBe(true);expect(other.claimed).toBe(false);expect(other.record.intent.requestId).toBe(winner.record.intent.requestId);
    expect(f.journal.getSandboxCloseHistory(f.scenario.id)).toHaveLength(1);expect(f.journal.isExecutionKilled()).toBe(true);
  });
});
