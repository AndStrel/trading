import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { SandboxSessionClose } from './sandbox-session-close.js';
import { SandboxExitService } from './sandbox-exit-service.js';
import { SandboxLossGuard } from './sandbox-loss-guard.js';
import { ExecutionService } from './execution-service.js';
import { parseSandboxOrderState } from './sandbox-order-state.js';
import { sandboxSessionCloseDue, sandboxSessionEntryAllowed } from './sandbox-session-policy.js';

const now = new Date('2026-10-01T15:30:00.000Z'); const entryAt='2026-10-01T11:00:00.000Z'; const stopAt='2026-10-01T11:01:00.000Z';
const dirs:string[]=[];
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();for(const dir of dirs.splice(0)) rmSync(dir,{recursive:true,force:true});});
function setup() {
  const dir=mkdtempSync(join(tmpdir(),'trading-session-'));dirs.push(dir);const path=join(dir,'journal.sqlite');const journal=new ScenarioJournal(path);
  const config=loadConfig({T_INVEST_TOKEN:'local-read',T_INVEST_TRADING_TOKEN:'local-trading',T_INVEST_EXECUTION_MODE:'sandbox',
    T_INVEST_SANDBOX_ACCOUNT_ID:'local-account',T_INVEST_SANDBOX_PROTECTION_ENABLED:'true',T_INVEST_SANDBOX_LOSS_GUARD_ENABLED:'true',
    T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED:'true',T_INVEST_INTRADAY_WATCHLIST:'[{"instrumentId":"local-instrument","lotSize":10,"priceStep":0.01}]'});
  const scenario=journal.record({observedAt:entryAt,strategy:'intraday',instrumentId:'local-instrument',
    input:{side:'long',entryPrice:10,stopPrice:9.9,targetPrice:11,lotSize:10,slippageRate:0.0005},decision:'candidate',blockers:[],warnings:[],
    snapshot:{tradePlan:{lots:5,positionRub:500,totalRiskRub:9}}});
  const order=journal.queueExecution({scenarioId:scenario.id,mode:'sandbox',instrumentId:scenario.instrumentId,side:'long',lots:5,
    limitPrice:10,estimatedRiskRub:9,orderRequestId:randomUUID()});
  const state={stop:'STOP_ORDER_STATUS_ACTIVE',sold:0,requestId:null as string|null,terminal:true,sellFeesKnown:true,lookupFails:false};
  const buy=()=>({orderId:'local-entry',orderRequestId:order.orderRequestId,instrumentUid:scenario.instrumentId,direction:'ORDER_DIRECTION_BUY',orderType:'ORDER_TYPE_LIMIT',
    currency:'rub',lotsRequested:'5',lotsExecuted:'5',executionReportStatus:'EXECUTION_REPORT_STATUS_FILL',
    stages:[{tradeId:'local-buy',quantity:'5',price:{currency:'rub',units:'10',nano:0},executionTime:entryAt}],
    executedCommission:{currency:'rub',units:'1',nano:500000000},serviceCommission:{currency:'rub',units:'0',nano:500000000}});
  const sell=(native=false)=>({orderId:native?'local-child':'local-session-sell',orderRequestId:state.requestId??undefined,
    instrumentUid:scenario.instrumentId,direction:'ORDER_DIRECTION_SELL',orderType:'ORDER_TYPE_LIMIT',currency:'rub',lotsRequested:'5',lotsExecuted:String(state.sold),
    executionReportStatus:state.terminal?(state.sold===5?'EXECUTION_REPORT_STATUS_FILL':'EXECUTION_REPORT_STATUS_CANCELLED'):'EXECUTION_REPORT_STATUS_PARTIALLYFILL',
    stages:state.sold?[{tradeId:'local-sell',quantity:String(state.sold),price:{currency:'rub',units:'9',nano:900000000},executionTime:now.toISOString()}]:[],
    executedCommission:{currency:'rub',units:'1',nano:500000000},serviceCommission:state.sellFeesKnown?{currency:'rub',units:'0',nano:500000000}:undefined});
  const stops=()=>({stopOrders:[{stopOrderId:'local-stop',status:state.stop,...(state.stop==='STOP_ORDER_STATUS_EXECUTED'?{exchangeOrderId:'local-child'}:{}),
    instrumentUid:scenario.instrumentId,currency:'rub',direction:'STOP_ORDER_DIRECTION_SELL',orderType:'STOP_ORDER_TYPE_STOP_LIMIT',lotsRequested:'5',
    stopPrice:{currency:'rub',units:'9',nano:900000000},price:{currency:'rub',units:'9',nano:900000000},createDate:stopAt}]});
  const held=()=>({accountId:'local-account',limitsLoadingInProgress:false,securities:state.sold===5?[]:[{instrumentUid:scenario.instrumentId,instrumentType:'share',
    exchangeBlocked:false,balance:String((5-state.sold)*10),blocked:'0'}],futures:[],options:[],money:[{currency:'rub',units:'1000',nano:0}],blocked:[]});
  const book=()=>({instrumentUid:scenario.instrumentId,orderbookTs:now.toISOString(),bids:[{price:{units:'9',nano:900000000},quantity:'5'}],asks:[{price:{units:'10',nano:0},quantity:'5'}]});
  journal.claimExecution(scenario.id,'42');journal.markExecutionAccepted(scenario.id,'local-entry','accepted',5);
  journal.recordExecutionReconciliation(scenario.id,parseSandboxOrderState(buy(),{requestId:order.orderRequestId,instrumentId:scenario.instrumentId,lots:5,lotSize:10},now));
  const id=randomUUID();journal.claimNativeStop({scenarioId:scenario.id,accountId:'local-account',requestId:id,instrumentId:scenario.instrumentId,
    entryRequestId:order.orderRequestId,lots:5,stopNano:'9900000000',limitNano:'9900000000',createdAt:stopAt,brokerStopId:null});
  journal.acknowledgeNativeStop(scenario.id,id,'local-stop');journal.observeNativeStop(scenario.id,{status:'STOP_ORDER_STATUS_ACTIVE',childOrderId:null});
  const client={getSandboxOrderState:vi.fn().mockImplementation(async (_account:string,request:string)=>{
    if(request===order.orderRequestId)return buy();if(state.lookupFails)throw new Error('private not found');
    if(request!==state.requestId)throw new Error('unknown UUID');return sell();}),
    getSandboxChildOrderState:vi.fn().mockImplementation(async()=>sell(true)),getSandboxStopOrders:vi.fn().mockImplementation(async()=>stops()),
    getSandboxPositions:vi.fn().mockImplementation(async()=>held()),getSandboxOrders:vi.fn().mockResolvedValue({orders:[]}),
    cancelSandboxStop:vi.fn().mockImplementation(async()=>{state.stop='STOP_ORDER_STATUS_CANCELED';}),
    postSandboxSessionExit:vi.fn().mockImplementation(async(input:{requestId:string})=>{state.requestId=input.requestId;state.sold=5;return 'local-session-sell';}),
    postLimitOrder:vi.fn(),postSandboxStopLimit:vi.fn(),openSandboxAccount:vi.fn(),sandboxPayIn:vi.fn(),getSandboxAccounts:vi.fn()};
  const market={getInstrumentBy:vi.fn().mockResolvedValue({instrument:{uid:scenario.instrumentId,instrumentType:'share',currency:'rub',lot:10,
    apiTradeAvailableFlag:true,sellAvailableFlag:true,buyAvailableFlag:true,minPriceIncrement:{units:'0',nano:10000000}}}),
    getOrderBook:vi.fn().mockImplementation(async()=>book()),getTradingStatus:vi.fn().mockResolvedValue({instrumentUid:scenario.instrumentId,
    tradingStatus:'SECURITY_TRADING_STATUS_NORMAL_TRADING',apiTradeAvailableFlag:true,limitOrderAvailableFlag:true})};
  const exits=new SandboxExitService(config,client,journal);const closer=new SandboxSessionClose(config,client,market,exits,journal);
  const noOtherWrites=()=>{for(const fn of[client.postLimitOrder,client.postSandboxStopLimit,client.openSandboxAccount,client.sandboxPayIn])expect(fn).not.toHaveBeenCalled();};
  return{path,journal,config,scenario,order,state,buy,sell,stops,held,book,client,market,exits,closer,noOtherWrites};
}

describe('Conservative sandbox session window',()=>{
  it.each([['2026-10-01T07:04:59Z',false],['2026-10-01T07:05:00Z',true],['2026-10-01T14:59:59Z',true],
    ['2026-10-01T15:00:00Z',false],['2026-10-03T08:00:00Z',false]])('entry clock %s => %s',(at,allowed)=>expect(sandboxSessionEntryAllowed(new Date(at))).toBe(allowed));
  it('does not reset an unclosed position at midnight or ignore a weekend carry',()=>{
    expect(sandboxSessionCloseDue(entryAt,new Date('2026-10-01T15:29:59Z'))).toBe(false);
    expect(sandboxSessionCloseDue(entryAt,now)).toBe(true);expect(sandboxSessionCloseDue(entryAt,new Date('2026-10-02T07:00:00Z'))).toBe(true);
    expect(sandboxSessionCloseDue(entryAt,new Date('2026-10-03T08:00:00Z'))).toBe(true);
    expect(()=>sandboxSessionCloseDue('bad',now)).toThrow();expect(()=>sandboxSessionCloseDue('2026-10-02T08:00:00Z',now)).toThrow();
  });
});

describe('Durable sandbox end-of-day exit ownership',()=>{
  it('cancels only the known stop and posts one whole-position FOK SELL, then reads fees and flat account',async()=>{
    const f=setup();expect(await f.closer.advance('local-account',f.scenario.id,now)).toEqual({kind:'session',complete:true});
    expect(f.client.cancelSandboxStop).toHaveBeenCalledExactlyOnceWith({mode:'sandbox',accountId:'local-account',stopId:'local-stop'});
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({mode:'sandbox',accountId:'local-account',instrumentId:f.scenario.instrumentId,
      lots:5,limitNano:'9900000000',requestId:f.journal.getSandboxSessionExit(f.scenario.id)?.requestId}));
    expect(f.journal.listSandboxResults()[0]).toMatchObject({fullySold:true,complete:true,netPnlNano:'-9000000000'});
    expect(new ScenarioJournal(f.path).getSandboxSessionExit(f.scenario.id)?.phase).toBe('submitted');
    expect(f.journal.isExecutionKilled()).toBe(true);expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted');f.noOtherWrites();
    expect(await new SandboxLossGuard(f.config,f.client,f.market,f.exits,f.journal).assess('local-account',now)).toMatchObject({status:'ok',closedLossNano:'9000000000',openLossNano:'0'});
  });
  it('does nothing before the deadline and does not clear an existing kill',async()=>{
    const f=setup();expect(await f.closer.advance('local-account',f.scenario.id,new Date('2026-10-01T15:29:59Z'))).toBeNull();
    expect(f.client.getSandboxOrderState).not.toHaveBeenCalled();expect(f.client.cancelSandboxStop).not.toHaveBeenCalled();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();
    expect(f.journal.isExecutionKilled()).toBe(true);f.noOtherWrites();
  });
  it('coalesces duplicate local calls and never repeats writes after a restart',async()=>{
    const f=setup();const results=await Promise.all([f.closer.advance('local-account',f.scenario.id,now),f.closer.advance('local-account',f.scenario.id,now)]);
    expect(results).toEqual([{kind:'session',complete:true},{kind:'session',complete:true}]);
    const other=new SandboxSessionClose(f.config,f.client,f.market,f.exits,new ScenarioJournal(f.path));
    expect(await other.advance('local-account',f.scenario.id,now)).toMatchObject({complete:true});
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();f.noOtherWrites();
  });
  it('two separate actors sharing SQLite still claim at most one cancellation and SELL',async()=>{
    const f=setup();const other=new SandboxSessionClose(f.config,f.client,f.market,f.exits,new ScenarioJournal(f.path));
    const results=await Promise.allSettled([f.closer.advance('local-account',f.scenario.id,now),other.advance('local-account',f.scenario.id,now)]);
    expect(results.some(result=>result.status==='fulfilled')).toBe(true);expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();
    expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();f.noOtherWrites();
  });
  it.each(['already-triggered','triggered-during-cancel'])('reads the native child after %s, never posts a competing SELL',async condition=>{
    const f=setup();if(condition==='already-triggered'){f.state.stop='STOP_ORDER_STATUS_EXECUTED';f.state.sold=5;}
    else f.client.cancelSandboxStop.mockImplementation(async()=>{f.state.stop='STOP_ORDER_STATUS_EXECUTED';f.state.sold=5;});
    expect(await f.closer.advance('local-account',f.scenario.id,now)).toEqual({kind:'native',complete:true});
    expect(f.client.getSandboxChildOrderState).toHaveBeenCalledWith('local-account','local-child');
    expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.client.cancelSandboxStop).toHaveBeenCalledTimes(condition==='already-triggered'?0:1);f.noOtherWrites();
  });
  it('unknown cancellation with ACTIVE stop cannot be retried or interpreted as canceled',async()=>{
    const f=setup();f.client.cancelSandboxStop.mockRejectedValue(new Error('private timeout'));
    await expect(f.closer.advance('local-account',f.scenario.id,now)).rejects.toThrow('not confirmed');
    await expect(f.closer.advance('local-account',f.scenario.id,now)).rejects.toThrow('not confirmed');
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();
    expect(f.journal.getSandboxSessionExit(f.scenario.id)?.phase).toBe('cancel-claimed');expect(f.journal.isExecutionKilled()).toBe(true);f.noOtherWrites();
  });
  it('recovers a timed-out cancellation only by confirming exact CANCELED stop, then submits once',async()=>{
    const f=setup();f.client.cancelSandboxStop.mockImplementation(async()=>{f.state.stop='STOP_ORDER_STATUS_CANCELED';throw new Error('private timeout');});
    await expect(f.closer.advance('local-account',f.scenario.id,now)).rejects.toThrow();
    expect(await f.closer.advance('local-account',f.scenario.id,now)).toMatchObject({complete:true});
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();f.noOtherWrites();
  });
  it('an uncertain SELL is looked up by the same UUID without repeating either write',async()=>{
    const f=setup();f.client.postSandboxSessionExit.mockImplementation(async(input:{requestId:string})=>{f.state.requestId=input.requestId;f.state.sold=5;throw new Error('private timeout');});
    await expect(f.closer.advance('local-account',f.scenario.id,now)).rejects.toThrow();
    expect(f.journal.getSandboxSessionExit(f.scenario.id)?.brokerOrderId).toBeNull();
    expect(await f.closer.reconcile('local-account',f.scenario.id,now)).toMatchObject({complete:true});
    expect(f.client.getSandboxOrderState).toHaveBeenCalledWith('local-account',f.journal.getSandboxSessionExit(f.scenario.id)?.requestId);
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();f.noOtherWrites();
  });
  it('crash between SELL claim and network never grants permission to submit again',async()=>{
    const f=setup();const claim=f.journal.claimSandboxSessionExit({scenarioId:f.scenario.id,accountId:'local-account',entryRequestId:f.order.orderRequestId,
      instrumentId:f.scenario.instrumentId,lots:5,stopId:'local-stop'},now);f.state.stop='STOP_ORDER_STATUS_CANCELED';
    f.journal.observeNativeStop(f.scenario.id,{status:'STOP_ORDER_STATUS_CANCELED',childOrderId:null});
    f.journal.claimSandboxSessionSubmission(f.scenario.id,f.journal.getSandboxLossLedger().revision,'9900000000',now);f.state.lookupFails=true;
    expect(claim.claimed).toBe(true);await expect(f.closer.advance('local-account',f.scenario.id,now)).rejects.toThrow();
    expect(f.client.cancelSandboxStop).not.toHaveBeenCalled();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();
    expect(f.journal.getExecutionByScenario(f.scenario.id)?.status).toBe('accepted');f.noOtherWrites();
  });
  it.each(['stale-book','thin-book','wrong-tick','unknown-instrument','holding-mismatch','active-order','foreign-stop','missing-buy-fees','unowned-canceled-stop','unsupported-type','broker-lot'])
    ('blocks %s before any closing write',async condition=>{
      const f=setup();
      if(condition==='stale-book')f.market.getOrderBook.mockResolvedValue({...f.book(),orderbookTs:'2026-10-01T15:29:00Z'});
      if(condition==='thin-book')f.market.getOrderBook.mockResolvedValue({...f.book(),bids:[]});
      if(condition==='wrong-tick')f.config.scanner.intradayWatchlist[0]!.priceStep=0.07;
      if(condition==='unknown-instrument')f.config.scanner.intradayWatchlist=[];
      if(condition==='holding-mismatch')f.client.getSandboxPositions.mockResolvedValue({...f.held(),securities:[]});
      if(condition==='active-order')f.client.getSandboxOrders.mockResolvedValue({orders:[{orderId:'foreign'}]});
      if(condition==='foreign-stop')f.client.getSandboxStopOrders.mockResolvedValue({stopOrders:[...f.stops().stopOrders,{stopOrderId:'foreign',status:'STOP_ORDER_STATUS_ACTIVE'}]});
      if(condition==='missing-buy-fees')f.client.getSandboxOrderState.mockResolvedValue({...f.buy(),serviceCommission:undefined});
      if(condition==='unowned-canceled-stop')f.state.stop='STOP_ORDER_STATUS_CANCELED';
      if(condition==='unsupported-type')f.market.getInstrumentBy.mockResolvedValue({instrument:{uid:f.scenario.instrumentId,instrumentType:'etf'}});
      if(condition==='broker-lot')f.market.getInstrumentBy.mockResolvedValue({instrument:{uid:f.scenario.instrumentId,instrumentType:'share',currency:'rub',lot:1,
        apiTradeAvailableFlag:true,sellAvailableFlag:true,buyAvailableFlag:true,minPriceIncrement:{units:'0',nano:10000000}}});
      await expect(f.closer.advance('local-account',f.scenario.id,now)).rejects.toThrow('not confirmed');
      expect(f.client.cancelSandboxStop).not.toHaveBeenCalled();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();expect(f.journal.isExecutionKilled()).toBe(true);f.noOtherWrites();
    });
  it.each(['partial','zero','missing-sell-fees'])('does not invent a full close or resend when result is %s',async condition=>{
    const f=setup();f.client.postSandboxSessionExit.mockImplementation(async(input:{requestId:string})=>{f.state.requestId=input.requestId;
      f.state.sold=condition==='partial'?2:condition==='zero'?0:5;f.state.sellFeesKnown=condition!=='missing-sell-fees';return 'local-session-sell';});
    expect(await f.closer.advance('local-account',f.scenario.id,now)).toEqual({kind:'session',complete:false});
    expect(await f.closer.advance('local-account',f.scenario.id,now)).toEqual({kind:'session',complete:false});
    expect(f.journal.listSandboxResults()[0]?.netPnlNano).toBeNull();expect(f.journal.isExecutionKilled()).toBe(true);
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();f.noOtherWrites();
  });
  it('late fee evidence after quote reads invalidates the submission revision',async()=>{
    const f=setup();const bid=f.market.getOrderBook.getMockImplementation()!;
    f.market.getOrderBook.mockImplementationOnce(bid).mockImplementation(async()=>{
      f.journal.recordExecutionReconciliation(f.scenario.id,parseSandboxOrderState({...f.buy(),executedCommission:{currency:'rub',units:'2',nano:500000000}},
        {requestId:f.order.orderRequestId,instrumentId:f.scenario.instrumentId,lots:5,lotSize:10},now));return f.book();});
    await expect(f.closer.advance('local-account',f.scenario.id,now)).rejects.toThrow();
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();f.noOtherWrites();
  });
  it.each(['holding-changed','new-order'])('does not sell after cancellation if %s',async condition=>{
    const f=setup();f.client.cancelSandboxStop.mockImplementation(async()=>{
      f.state.stop='STOP_ORDER_STATUS_CANCELED';
      if(condition==='holding-changed')f.client.getSandboxPositions.mockResolvedValue({...f.held(),securities:[]});
      else f.client.getSandboxOrders.mockResolvedValue({orders:[{orderId:'foreign'}]});
    });
    await expect(f.closer.advance('local-account',f.scenario.id,now)).rejects.toThrow('not confirmed');
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();
    expect(f.journal.getSandboxSessionExit(f.scenario.id)?.phase).toBe('cancel-claimed');expect(f.journal.isExecutionKilled()).toBe(true);f.noOtherWrites();
  });
  it('rejects a quote aged by the last stop read before claiming SELL',async()=>{
    const f=setup();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
    let reads=0;f.client.getSandboxStopOrders.mockImplementation(async()=>{
      if(++reads===3)vi.setSystemTime(new Date(now.getTime()+15_001));
      return f.stops();
    });
    await expect(f.closer.advance('local-account',f.scenario.id)).rejects.toThrow('not confirmed');
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();
    expect(f.journal.getSandboxSessionExit(f.scenario.id)?.phase).toBe('cancel-claimed');expect(f.journal.isExecutionKilled()).toBe(true);f.noOtherWrites();
  });
  it.each(['wrong-request','wrong-id','before-submit','regressed-fees','wrong-stop'])('does not adopt %s sale evidence or resend',async condition=>{
    const f=setup();await f.closer.advance('local-account',f.scenario.id,now);
    const before=f.journal.getSandboxExitEvidence(f.scenario.id);
    if(condition==='wrong-stop')f.state.stop='STOP_ORDER_STATUS_EXECUTED';
    const original=f.client.getSandboxOrderState.getMockImplementation()!;
    f.client.getSandboxOrderState.mockImplementation(async(account:string,request:string)=>{
      const result=await original(account,request);if(request===f.order.orderRequestId)return result;
      return {...result,...(condition==='wrong-request'?{orderRequestId:randomUUID()}:{}),...(condition==='wrong-id'?{orderId:'other'}:{}),
        ...(condition==='regressed-fees'?{executedCommission:{currency:'rub',units:'0',nano:0}}:{}),
        ...(condition==='before-submit'?{stages:result.stages.map((stage:Record<string,unknown>)=>({...stage,executionTime:'2026-10-01T15:29:59Z'}))}:{} )};
    });
    await expect(f.closer.reconcile('local-account',f.scenario.id,now)).rejects.toThrow();
    expect(f.journal.getSandboxExitEvidence(f.scenario.id)).toEqual(before);
    expect(f.client.cancelSandboxStop).toHaveBeenCalledOnce();expect(f.client.postSandboxSessionExit).toHaveBeenCalledOnce();f.noOtherWrites();
  });
  it('cannot claim a close in the journal before the same-day deadline',()=>{
    const f=setup();expect(()=>f.journal.claimSandboxSessionExit({scenarioId:f.scenario.id,accountId:'local-account',entryRequestId:f.order.orderRequestId,
      instrumentId:f.scenario.instrumentId,lots:5,stopId:'local-stop'},new Date('2026-10-01T15:29:59Z'))).toThrow();
    expect(f.journal.getSandboxSessionExit(f.scenario.id)).toBeNull();
  });
  it('never enters outside the window or when closing module is missing',async()=>{
    const f=setup();f.journal.setExecutionKilled(false);
    const protection={protect:vi.fn(),preflightForEntry:vi.fn()};
    for(const at of [now,new Date('2026-10-01T08:00:00Z')]){
      const service=new ExecutionService(f.config,f.market,f.client,f.journal,protection,f.exits);
      await expect(service.submitScenario(f.scenario.id,'42',at)).rejects.toThrow('window');
    }
    expect(f.client.postLimitOrder).not.toHaveBeenCalled();expect(f.market.getOrderBook).not.toHaveBeenCalled();f.noOtherWrites();
  });
  it('rechecks the entry cutoff after a slow loss preflight, before claiming a new order',async()=>{
    const f=setup();vi.useFakeTimers({toFake:['Date']});const start=new Date('2026-10-01T14:59:50Z');vi.setSystemTime(start);f.journal.setExecutionKilled(false);
    const candidate=f.journal.record({observedAt:start.toISOString(),strategy:'intraday',instrumentId:f.scenario.instrumentId,input:f.scenario.input,
      decision:'candidate',blockers:[],warnings:[],snapshot:f.scenario.snapshot});
    f.market.getOrderBook.mockImplementation(async()=>({...f.book(),orderbookTs:new Date().toISOString(),bids:[{price:{units:'9',nano:990000000},quantity:'100'}]}));
    const guard={assess:vi.fn().mockImplementation(async()=>{vi.setSystemTime(new Date('2026-10-01T15:00:01Z'));
      return f.journal.recordSandboxLossAssessment('local-account',f.journal.getSandboxLossLedger().revision,{status:'ok',checkedAt:new Date().toISOString(),
        day:'2026-10-01',closedLossNano:'0',openLossNano:'0',maxTradeLossNano:'0'});})};
    const service=new ExecutionService(f.config,f.market,f.client,f.journal,{protect:vi.fn(),preflightForEntry:vi.fn().mockResolvedValue(undefined)},f.exits,guard,f.closer);
    await expect(service.submitScenario(candidate.id,'42',start)).rejects.toThrow('window ended');
    expect(f.journal.getExecutionByScenario(candidate.id)?.status).toBe('pending');f.noOtherWrites();
  });
  it.each(['disabled','flag-off','protection-off','loss-guard-off','same-token','wrong-account'])('does not even read broker data when %s',async condition=>{
    const f=setup();if(condition==='disabled')f.config.execution.mode='disabled';if(condition==='flag-off')f.config.execution.sandboxSessionCloseEnabled=false;
    if(condition==='protection-off')f.config.execution.sandboxProtectionEnabled=false;if(condition==='loss-guard-off')f.config.execution.sandboxLossGuardEnabled=false;
    if(condition==='same-token')f.config.execution.token=f.config.token!;
    await expect(f.closer.advance(condition==='wrong-account'?'other':'local-account',f.scenario.id,now)).rejects.toThrow('not enabled');
    expect(f.client.getSandboxOrderState).not.toHaveBeenCalled();expect(f.client.cancelSandboxStop).not.toHaveBeenCalled();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();f.noOtherWrites();
  });
  it('worker routes due position into the closer; explicit reconciliation/startup recovery still only read',async()=>{
    const f=setup();const protection={protect:vi.fn(),preflightForEntry:vi.fn()};
    const service=new ExecutionService(f.config,f.market,f.client,f.journal,protection,f.exits,undefined,f.closer);
    expect(await service.protectOutstanding(now)).toMatchObject({closed:1,unconfirmed:0});expect(protection.protect).not.toHaveBeenCalled();
    f.client.cancelSandboxStop.mockClear();f.client.postSandboxSessionExit.mockClear();
    expect((await service.reconcileScenario(f.scenario.id,now)).sandboxExit).toMatchObject({complete:true});
    expect(await service.recoverOutstanding(20,now)).toMatchObject({confirmed:1,unconfirmed:0});
    expect(f.client.cancelSandboxStop).not.toHaveBeenCalled();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();f.noOtherWrites();
  });
  it('before deadline the worker maintains native protection, not a separate SELL',async()=>{
    const f=setup();const protection={protect:vi.fn().mockResolvedValue({status:'STOP_ORDER_STATUS_ACTIVE',lots:5,positionClosed:false}),preflightForEntry:vi.fn()};
    const service=new ExecutionService(f.config,f.market,f.client,f.journal,protection,f.exits,undefined,f.closer);
    expect(await service.protectOutstanding(new Date('2026-10-01T15:29:59Z'))).toMatchObject({active:1,closed:0,unconfirmed:0});
    expect(protection.protect).toHaveBeenCalledOnce();expect(f.client.cancelSandboxStop).not.toHaveBeenCalled();expect(f.client.postSandboxSessionExit).not.toHaveBeenCalled();f.noOtherWrites();
  });
  it.each(['missing','wrong-lot','off-tick','duplicate'])('entry cannot outrun %s closing metadata',async condition=>{
    const f=setup();f.journal.setExecutionKilled(false);const at=new Date('2026-10-01T08:00:00Z');
    if(condition==='missing')f.config.scanner.intradayWatchlist=[];
    if(condition==='wrong-lot')f.config.scanner.intradayWatchlist[0]!.lotSize=1;
    if(condition==='off-tick')f.config.scanner.intradayWatchlist[0]!.priceStep=0.07;
    if(condition==='duplicate')f.config.scanner.intradayWatchlist.push({...f.config.scanner.intradayWatchlist[0]!});
    const service=new ExecutionService(f.config,f.market,f.client,f.journal,{protect:vi.fn(),preflightForEntry:vi.fn()},f.exits,undefined,f.closer);
    const candidate=f.journal.record({observedAt:at.toISOString(),strategy:'intraday',instrumentId:f.scenario.instrumentId,input:f.scenario.input,
      decision:'candidate',blockers:[],warnings:[],snapshot:f.scenario.snapshot});
    await expect(service.submitScenario(candidate.id,'42',at)).rejects.toThrow('tick');
    expect(f.market.getOrderBook).not.toHaveBeenCalled();f.noOtherWrites();
  });
});
