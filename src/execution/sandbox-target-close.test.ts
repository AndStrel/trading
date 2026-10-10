import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { SandboxSessionClose } from './sandbox-session-close.js';
import { SandboxExitService } from './sandbox-exit-service.js';
import { SandboxLossGuard } from './sandbox-loss-guard.js';
import { ExecutionService } from './execution-service.js';
import { parseSandboxOrderState } from './sandbox-order-state.js';
import { seedPreparedSandbox } from './sandbox-prepared.test-helper.js';
import { sandboxEndpoint } from './sandbox-prepared-account.js';
import { nativeStopKey } from './sandbox-stop-state.js';

const at=new Date('2026-10-01T12:00:00Z'),entryAt='2026-10-01T11:00:00Z',stopAt='2026-10-01T11:01:00Z';
const dirs:string[]=[];
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true});});
function fixture(policy=true) {
  const dir=mkdtempSync(join(tmpdir(),'trading-target-'));dirs.push(dir);const path=join(dir,'journal.sqlite'),journal=new ScenarioJournal(path);
  seedPreparedSandbox(journal,'local-account');
  const config=loadConfig({T_INVEST_TOKEN:'local-read',T_INVEST_TRADING_TOKEN:'local-sandbox',T_INVEST_EXECUTION_MODE:'sandbox',
    T_INVEST_BASE_URL:sandboxEndpoint,T_INVEST_SANDBOX_ACCOUNT_ID:'local-account',T_INVEST_SANDBOX_PROTECTION_ENABLED:'true',
    T_INVEST_SANDBOX_LOSS_GUARD_ENABLED:'true',T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED:'true',T_INVEST_SANDBOX_TARGET_EXIT_ENABLED:'true'});
  const scenario=journal.record({observedAt:entryAt,strategy:'intraday',instrumentId:'local-share',decision:'candidate',blockers:[],warnings:[],
    input:{side:'long',entryPrice:10,stopPrice:9.9,targetPrice:11,lotSize:10,slippageRate:0.0005},
    snapshot:{source:'intraday-scanner',tradingStrategy:{id:'trend-momentum-v1',version:'1'},
      instrument:{instrumentId:'local-share',ticker:'VTBR',lotSize:10,priceStep:0.01},
      sandboxTargetExitPolicy:{version:'1',enabled:policy,commissionRateNano:'3000000',slippageRateNano:'500000'},tradePlan:{lots:5,positionRub:500,totalRiskRub:9}}});
  const order=journal.queueExecution({scenarioId:scenario.id,mode:'sandbox',instrumentId:scenario.instrumentId,side:'long',lots:5,
    limitPrice:10,estimatedRiskRub:9,orderRequestId:randomUUID()});
  const state={stop:'STOP_ORDER_STATUS_ACTIVE',newStop:'STOP_ORDER_STATUS_ACTIVE',newStopId:'',newStopCreated:'',sold:0,
    sellRequest:'',sellId:'local-sell',sellStatus:'EXECUTION_REPORT_STATUS_FILL',sellNano:11_000_000_000n,sellFeeNano:2_000_000_000n as bigint|null,
    buyFeeNano:2_000_000_000n,bidNano:11_200_000_000n,bidLots:5,lookupFails:false,clock:at};
  const money=(nano:bigint)=>({currency:'rub',units:String(nano/1_000_000_000n),nano:Number(nano%1_000_000_000n)});
  const buy=()=>({orderId:'local-buy',orderRequestId:order.orderRequestId,instrumentUid:scenario.instrumentId,direction:'ORDER_DIRECTION_BUY',
    orderType:'ORDER_TYPE_LIMIT',currency:'rub',lotsRequested:'5',lotsExecuted:'5',executionReportStatus:'EXECUTION_REPORT_STATUS_FILL',
    stages:[{tradeId:'buy-fill',quantity:'5',price:money(10_000_000_000n),executionTime:entryAt}],
    executedCommission:money(state.buyFeeNano),serviceCommission:money(0n)});
  const sell=(native=false)=>({orderId:native?'local-child':state.sellId,orderRequestId:native?undefined:state.sellRequest,instrumentUid:scenario.instrumentId,
    direction:'ORDER_DIRECTION_SELL',orderType:'ORDER_TYPE_LIMIT',currency:'rub',lotsRequested:'5',lotsExecuted:String(state.sold),executionReportStatus:state.sellStatus,
    stages:state.sold?[{tradeId:native?'native-fill':'sell-fill',quantity:String(state.sold),price:money(state.sellNano),executionTime:state.clock.toISOString()}]:[],
    executedCommission:money(state.sellFeeNano??0n),serviceCommission:state.sellFeeNano===null?undefined:money(0n)});
  const stop=(id:string,status:string,created:string)=>({stopOrderId:id,status,instrumentUid:scenario.instrumentId,currency:'rub',
    direction:'STOP_ORDER_DIRECTION_SELL',orderType:'STOP_ORDER_TYPE_STOP_LIMIT',lotsRequested:'5',stopPrice:money(9_900_000_000n),price:money(9_900_000_000n),
    createDate:created,...(status==='STOP_ORDER_STATUS_EXECUTED'?{exchangeOrderId:'local-child'}:{})});
  const stops=()=>({stopOrders:[stop('local-stop',state.stop,stopAt),...(state.newStopId?[stop(state.newStopId,state.newStop,state.newStopCreated)]:[])]});
  const held=()=>({accountId:'local-account',limitsLoadingInProgress:false,securities:state.sold===5?[]:[{instrumentUid:scenario.instrumentId,
    instrumentType:'share',exchangeBlocked:false,balance:String((5-state.sold)*10),blocked:'0'}],futures:[],options:[],money:[money(1_000_000_000_000n)],blocked:[]});
  const book=()=>({instrumentUid:scenario.instrumentId,orderbookTs:state.clock.toISOString(),bids:[{price:money(state.bidNano),quantity:String(state.bidLots)}],
    asks:[{price:money(state.bidNano+10_000_000n),quantity:'5'}]});
  journal.claimExecution(scenario.id,'42');journal.markExecutionAccepted(scenario.id,'local-buy','fill',5);
  journal.recordExecutionReconciliation(scenario.id,parseSandboxOrderState(buy(),{requestId:order.orderRequestId,instrumentId:scenario.instrumentId,lots:5,lotSize:10},at));
  const stopRequest=randomUUID();journal.claimNativeStop({scenarioId:scenario.id,accountId:'local-account',requestId:stopRequest,instrumentId:scenario.instrumentId,
    entryRequestId:order.orderRequestId,lots:5,stopNano:'9900000000',limitNano:'9900000000',createdAt:stopAt,brokerStopId:null});
  journal.acknowledgeNativeStop(scenario.id,stopRequest,'local-stop');journal.observeNativeStop(scenario.id,{status:'STOP_ORDER_STATUS_ACTIVE',childOrderId:null});
  const client={getSandboxOrderState:vi.fn(async(_account:string,request:string)=>{
    if(request===order.orderRequestId)return buy();if(state.lookupFails)throw new Error('unknown private outcome');
    if(request!==state.sellRequest)throw new Error('wrong UUID');return sell();}),getSandboxChildOrderState:vi.fn(async()=>sell(true)),
    getSandboxPositions:vi.fn(async()=>held()),getSandboxOrders:vi.fn(async()=>({orders:[]})),getSandboxStopOrders:vi.fn(async()=>stops()),
    cancelSandboxStop:vi.fn(async()=>{state.stop='STOP_ORDER_STATUS_CANCELED';if(state.newStopId)state.newStop='STOP_ORDER_STATUS_CANCELED';}),
    postSandboxSessionExit:vi.fn(async(input:{requestId:string})=>{state.sellRequest=input.requestId;state.sold=5;return state.sellId;}),
    postLimitOrder:vi.fn(),getSandboxAccounts:vi.fn(),
    postSandboxStopLimit:vi.fn(async()=>{state.newStopId='restored-stop-'+String((journal.getNativeStop(scenario.id)?.intent.generation??0));
      state.newStop='STOP_ORDER_STATUS_ACTIVE';state.newStopCreated=state.clock.toISOString();return state.newStopId;})};
  const market={getInstrumentBy:vi.fn(async()=>({instrument:{uid:scenario.instrumentId,instrumentType:'share',currency:'rub',lot:10,
    apiTradeAvailableFlag:true,sellAvailableFlag:true,buyAvailableFlag:true,minPriceIncrement:{units:'0',nano:10000000}}})),
    getOrderBook:vi.fn(async()=>book()),getTradingStatus:vi.fn(async()=>({instrumentUid:scenario.instrumentId,tradingStatus:'SECURITY_TRADING_STATUS_NORMAL_TRADING',
      apiTradeAvailableFlag:true,limitOrderAvailableFlag:true}))};
  const exits=new SandboxExitService(config,client,journal),closer=new SandboxSessionClose(config,client,market,exits,journal);
  const rejectSell=()=>client.postSandboxSessionExit.mockImplementation(async(input:{requestId:string})=>{
    state.sellRequest=input.requestId;state.sold=0;state.sellStatus='EXECUTION_REPORT_STATUS_REJECTED';return state.sellId;});
  return {path,journal,config,scenario,order,state,buy,sell,stops,held,book,client,market,exits,closer,rejectSell};
}

describe('Opt-in immutable sandbox target exit',()=>{
  it('sells once at the original target floor, not an optimistic displayed bid',async()=>{
    const f=fixture();expect(await f.closer.advance('local-account',f.scenario.id,at)).toMatchObject({kind:'target',complete:true,targetAchieved:true});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({limitNano:'11000000000',lots:5}));
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
    expect(f.journal.getSandboxSessionExit(f.scenario.id)).toMatchObject({purpose:'target',targetConsumed:true,phase:'submitted'});
    expect(f.journal.listSandboxResults()[0]).toMatchObject({complete:true,netPnlNano:String(550n*1_000_000_000n-500n*1_000_000_000n-4n*1_000_000_000n)});
    expect(f.journal.isExecutionKilled()).toBe(true);
  });
  it.each(['flag-off','policy-off','not-reached','cost-invalid'])('keeps the original native stop when %s',async reason=>{
    const f=fixture(reason!=='policy-off');if(reason==='flag-off')f.config.execution.sandboxTargetExitEnabled=false;
    if(reason==='not-reached')f.state.bidNano=10_990_000_000n;if(reason==='cost-invalid')f.state.buyFeeNano=30_000_000_000n;
    expect(await f.closer.advance('local-account',f.scenario.id,at)).toBeNull();
    expect(f.client.cancelSandboxStop).not.toHaveBeenCalled();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
  });
  it.each(['stale','thin','wrong-tick','foreign-order','foreign-stop'])('rejects %s evidence before cancellation',async reason=>{
    const f=fixture();if(reason==='stale')f.market.getOrderBook.mockResolvedValue({...f.book(),orderbookTs:entryAt});
    if(reason==='thin')f.state.bidLots=4;if(reason==='wrong-tick')f.state.bidNano+=1n;
    if(reason==='foreign-order')f.client.getSandboxOrders.mockResolvedValue({orders:[{orderId:'foreign'}]} as never);
    if(reason==='foreign-stop')f.client.getSandboxStopOrders.mockResolvedValue({stopOrders:[...f.stops().stopOrders,{stopOrderId:'foreign',status:'STOP_ORDER_STATUS_ACTIVE'}]} as never);
    await expect(f.closer.advance('local-account',f.scenario.id,at)).rejects.toThrow('not confirmed');
    expect(f.client.cancelSandboxStop).not.toHaveBeenCalled();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
  });
  it.each(['fade','late-fee'])('restores the original stop after %s invalidates an unsubmitted target',async reason=>{
    const f=fixture();f.client.cancelSandboxStop.mockImplementation(async()=>{f.state.stop='STOP_ORDER_STATUS_CANCELED';
      if(reason==='fade')f.state.bidNano=10_900_000_000n;else f.state.buyFeeNano=30_000_000_000n;});
    expect(await f.closer.advance('local-account',f.scenario.id,at)).toEqual({kind:'restored',complete:false});
    expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
    expect(f.journal.getNativeStop(f.scenario.id)?.intent).toMatchObject({generation:1,stopNano:'9900000000',limitNano:'9900000000',lots:5});
    expect(f.journal.getSandboxSessionExit(f.scenario.id)?.phase).toBe('restored');
    expect(await f.closer.advance('local-account',f.scenario.id,at)).toEqual({kind:'restored',complete:false});expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it('restores after exact rejected zero SELL even while that attempt fees are unknown',async()=>{
    const f=fixture();f.rejectSell();f.state.sellFeeNano=null;
    expect(await f.closer.advance('local-account',f.scenario.id,at)).toEqual({kind:'restored',complete:false});
    expect(f.journal.getSandboxCloseHistory(f.scenario.id)[0]?.sellSnapshot).toMatchObject({terminal:true,lotsExecuted:0,commissionNano:null});
    expect(f.journal.getSandboxFailedCloseCosts(f.scenario.id)).toMatchObject({commissionNano:null,attempts:1});
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toBeNull();
    expect(await new SandboxLossGuard(f.config,f.client,f.market,f.exits,f.journal).assess('local-account',at)).toMatchObject({status:'incomplete'});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it.each(['unknown','new','partial'])('never restores or resends when SELL is %s',async reason=>{
    const f=fixture();f.client.postSandboxSessionExit.mockImplementation(async(input:{requestId:string})=>{f.state.sellRequest=input.requestId;
      f.state.sold=reason==='partial'?2:0;f.state.sellStatus=reason==='partial'?'EXECUTION_REPORT_STATUS_PARTIALLYFILL':'EXECUTION_REPORT_STATUS_NEW';
      if(reason==='unknown'){f.state.lookupFails=true;throw new Error('private timeout');}return f.state.sellId;});
    if(reason==='unknown')await expect(f.closer.advance('local-account',f.scenario.id,at)).rejects.toThrow();
    else expect(await f.closer.advance('local-account',f.scenario.id,at)).toMatchObject({complete:false});
    try {await f.closer.advance('local-account',f.scenario.id,at);}catch{}
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
  });
  it('an uncertain restored stop POST cannot be adopted by price or sent twice',async()=>{
    const f=fixture();f.rejectSell();f.client.postSandboxStopLimit.mockRejectedValue(new Error('private timeout'));
    await expect(f.closer.advance('local-account',f.scenario.id,at)).rejects.toThrow('not confirmed');
    const other=new SandboxSessionClose(f.config,f.client,f.market,f.exits,new ScenarioJournal(f.path));
    await expect(other.advance('local-account',f.scenario.id,at)).rejects.toThrow('not confirmed');
    expect(f.journal.getNativeStop(f.scenario.id)?.intent).toMatchObject({generation:1,brokerStopId:null});
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();
  });
  it('two SQLite actors cannot cancel, sell or restore twice',async()=>{
    const f=fixture();f.rejectSell();const otherJournal=new ScenarioJournal(f.path),other=new SandboxSessionClose(f.config,f.client,f.market,new SandboxExitService(f.config,f.client,otherJournal),otherJournal);
    const results=await Promise.allSettled([f.closer.advance('local-account',f.scenario.id,at),other.advance('local-account',f.scenario.id,at)]);
    expect(results.some(result=>result.status==='fulfilled')).toBe(true);expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it('old native observations cannot overwrite restored generation and worker counts it active, not closed',async()=>{
    const f=fixture(),old=nativeStopKey(f.journal.getNativeStop(f.scenario.id)!.intent);f.rejectSell();await f.closer.advance('local-account',f.scenario.id,at);
    expect(()=>f.journal.observeNativeStop(f.scenario.id,{status:'STOP_ORDER_STATUS_CANCELED',childOrderId:null},old)).toThrow();
    const service=new ExecutionService(f.config,f.market,f.client,f.journal,{protect:vi.fn(),preflightForEntry:vi.fn()},f.exits,undefined,f.closer);
    expect(await service.protectOutstanding(at)).toMatchObject({active:1,closed:0,unconfirmed:0});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
  it('a native trigger during cancellation wins and forbids an independent SELL',async()=>{
    const f=fixture();f.client.cancelSandboxStop.mockImplementation(async()=>{f.state.stop='STOP_ORDER_STATUS_EXECUTED';f.state.sold=5;f.state.sellNano=9_900_000_000n;});
    expect(await f.closer.advance('local-account',f.scenario.id,at)).toMatchObject({kind:'native',complete:true});
    expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.client.postSandboxStopLimit).not.toHaveBeenCalled();
  });
  it('flat virtual fills below the target are not reported as an achieved profitable target',async()=>{
    const f=fixture();f.state.sellNano=9_900_000_000n;
    expect(await f.closer.advance('local-account',f.scenario.id,at)).toMatchObject({kind:'target',complete:true,targetAchieved:false});
  });
  it('a restored target permits one later session exit with a NEW UUID and retains failed attempt costs',async()=>{
    const f=fixture();f.rejectSell();await f.closer.advance('local-account',f.scenario.id,at);
    const oldRequest=f.state.sellRequest,oldSell=structuredClone(f.sell());
    f.state.clock=new Date('2026-10-01T15:30:00Z');f.state.bidNano=9_900_000_000n;f.state.sellNano=9_900_000_000n;
    f.client.getSandboxOrderState.mockImplementation(async(_a:string,id:string)=>id===f.order.orderRequestId?f.buy():id===oldRequest?oldSell:f.sell());
    f.client.postSandboxSessionExit.mockImplementation(async(input:{requestId:string})=>{
      f.state.sellRequest=input.requestId;f.state.sold=5;f.state.sellStatus='EXECUTION_REPORT_STATUS_FILL';return 'later-session';});
    f.state.sellId='later-session';
    expect(await f.closer.advance('local-account',f.scenario.id,f.state.clock)).toEqual({kind:'session',complete:true});
    expect(f.state.sellRequest).not.toBe(oldRequest);expect(f.client.postSandboxSessionExit).toHaveBeenCalledTimes(2);
    expect(f.journal.listSandboxResults()[0]).toMatchObject({complete:true,failedCloseAttempts:1,failedCloseFeesNano:'2000000000',
      netPnlNano:String(495n*1_000_000_000n-500n*1_000_000_000n-6n*1_000_000_000n)});
    expect(await f.closer.advance('local-account',f.scenario.id,f.state.clock)).toMatchObject({kind:'session',complete:true});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledTimes(2);
  });
  it('a rejected later session restores a second generation but never repeats that session attempt',async()=>{
    const f=fixture();f.rejectSell();await f.closer.advance('local-account',f.scenario.id,at);
    const oldRequest=f.state.sellRequest,oldSell=structuredClone(f.sell());
    f.state.clock=new Date('2026-10-01T15:30:00Z');
    f.client.getSandboxOrderState.mockImplementation(async(_a:string,id:string)=>id===f.order.orderRequestId?f.buy():id===oldRequest?oldSell:f.sell());
    expect(await f.closer.advance('local-account',f.scenario.id,f.state.clock)).toEqual({kind:'restored',complete:false});
    expect(f.journal.getNativeStop(f.scenario.id)?.intent.generation).toBe(2);
    expect(f.journal.getSandboxSessionExit(f.scenario.id)).toMatchObject({purpose:'session',phase:'restored',targetConsumed:true});
    expect(await f.closer.advance('local-account',f.scenario.id,f.state.clock)).toEqual({kind:'restored',complete:false});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledTimes(2);expect(f.client.cancelSandboxStop).toHaveBeenCalledTimes(2);
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledTimes(2);expect(f.journal.getSandboxCloseHistory(f.scenario.id)).toHaveLength(2);
  });
  it('a restored stop trigger is reconciled read-only with archived target costs',async()=>{
    const f=fixture();f.rejectSell();await f.closer.advance('local-account',f.scenario.id,at);
    f.state.newStop='STOP_ORDER_STATUS_EXECUTED';f.state.sold=5;f.state.sellStatus='EXECUTION_REPORT_STATUS_FILL';f.state.sellNano=9_900_000_000n;
    const archived=f.journal.getSandboxCloseHistory(f.scenario.id)[0]!.sellSnapshot!;
    const original=f.client.getSandboxOrderState.getMockImplementation()!;
    f.client.getSandboxOrderState.mockImplementation(async(a:string,id:string)=>id===f.state.sellRequest?{
      ...f.sell(),orderId:archived.brokerOrderId,lotsExecuted:'0',executionReportStatus:'EXECUTION_REPORT_STATUS_REJECTED',stages:[]}:original(a,id));
    expect(await f.closer.advance('local-account',f.scenario.id,at)).toMatchObject({kind:'native',complete:true});
    expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();
    expect(f.journal.listSandboxResults()[0]).toMatchObject({failedCloseAttempts:1,failedCloseFeesNano:'2000000000',complete:true});
  });
  it('a journal fee race during second preflight aborts SELL and restores instead of adopting the new revision',async()=>{
    const f=fixture();let reads=0;f.market.getOrderBook.mockImplementation(async()=>{
      if(++reads===2){f.state.buyFeeNano+=1_000_000_000n;f.journal.recordExecutionReconciliation(f.scenario.id,
        parseSandboxOrderState(f.buy(),{requestId:f.order.orderRequestId,instrumentId:f.scenario.instrumentId,lots:5,lotSize:10},at));}return f.book();});
    expect(await f.closer.advance('local-account',f.scenario.id,at)).toEqual({kind:'restored',complete:false});
    expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.client.postSandboxStopLimit).toHaveBeenCalledOnce();
  });
});
