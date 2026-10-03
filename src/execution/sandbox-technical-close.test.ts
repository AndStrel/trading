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
const dirs:string[]=[];
afterEach(()=>{vi.useRealTimers();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
function fixture() {
  const at=new Date('2026-10-02T09:00:00Z');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);
  const dir=mkdtempSync(join(tmpdir(),'technical-close-'));dirs.push(dir);
  const journal=new ScenarioJournal(join(dir,'journal.sqlite'));
  const config=loadConfig({T_INVEST_TOKEN:'read',T_INVEST_SANDBOX_TOKEN:'sandbox',T_INVEST_EXECUTION_MODE:'sandbox',
    T_INVEST_SANDBOX_ACCOUNT_ID:'account',T_INVEST_SANDBOX_PROTECTION_ENABLED:'true',T_INVEST_SANDBOX_LOSS_GUARD_ENABLED:'true',
    T_INVEST_SANDBOX_SESSION_CLOSE_ENABLED:'true',T_INVEST_INTRADAY_WATCHLIST:'[{"instrumentId":"vtbr","lotSize":1,"priceStep":0.01}]'});
  const scenario=journal.record({observedAt:'2026-10-02T08:59:00Z',strategy:'intraday',decision:'candidate',instrumentId:'vtbr',
    input:{side:'long',lotSize:1,entryPrice:52,stopPrice:51,targetPrice:60,slippageRate:0.0005},blockers:[],warnings:[],
    snapshot:{purpose:technicalPurpose,authorization:technicalApproval,ticker:'VTBR'}});
  const request=randomUUID();journal.queueExecution({scenarioId:scenario.id,mode:'sandbox',instrumentId:'vtbr',side:'long',lots:1,limitPrice:52,estimatedRiskRub:2,orderRequestId:request});
  journal.claimExecution(scenario.id,'local-human-authorization');journal.markExecutionAccepted(scenario.id,'entry','fill',1);
  const state={stop:'STOP_ORDER_STATUS_ACTIVE',sold:false,sellRequest:''};
  const order=(sell=false)=>({orderId:sell?'exit':'entry',orderRequestId:sell?(state.sellRequest||undefined):request,instrumentUid:'vtbr',
    direction:sell?'ORDER_DIRECTION_SELL':'ORDER_DIRECTION_BUY',orderType:'ORDER_TYPE_LIMIT',currency:'rub',lotsRequested:'1',lotsExecuted:'1',executionReportStatus:'EXECUTION_REPORT_STATUS_FILL',
    stages:[{tradeId:sell?'sell-trade':'buy-trade',quantity:'1',price:{currency:'rub',units:sell?'51':'52',nano:0},executionTime:sell?at.toISOString():'2026-10-02T08:59:01Z'}],
    executedCommission:{currency:'rub',units:'0',nano:160000000},serviceCommission:{currency:'rub',units:'0',nano:0}});
  journal.recordExecutionReconciliation(scenario.id,parseSandboxOrderState(order(),{requestId:request,instrumentId:'vtbr',lots:1,lotSize:1},at));
  const stopRequest=randomUUID();journal.claimNativeStop({scenarioId:scenario.id,accountId:'account',requestId:stopRequest,instrumentId:'vtbr',entryRequestId:request,
    lots:1,stopNano:'51000000000',limitNano:'51000000000',createdAt:'2026-10-02T08:59:02Z',brokerStopId:null});
  journal.acknowledgeNativeStop(scenario.id,stopRequest,'stop');journal.observeNativeStop(scenario.id,{status:'STOP_ORDER_STATUS_ACTIVE',childOrderId:null});
  const client={getSandboxOrderState:vi.fn(async(_a:string,id:string)=>order(id!==request)),getSandboxChildOrderState:vi.fn(async()=>order(true)),
    getSandboxPositions:vi.fn(async()=>({accountId:'account',limitsLoadingInProgress:false,money:[{currency:'rub',units:'1000',nano:0}],blocked:[],futures:[],options:[],
      securities:state.sold?[]:[{instrumentUid:'vtbr',instrumentType:'share',exchangeBlocked:false,balance:'1',blocked:'0'}]})),
    getSandboxOrders:vi.fn(async()=>({orders:[]})),getSandboxStopOrders:vi.fn(async()=>({stopOrders:[{stopOrderId:'stop',status:state.stop,
      ...(state.stop==='STOP_ORDER_STATUS_EXECUTED'?{exchangeOrderId:'exit'}:{}),instrumentUid:'vtbr',currency:'rub',direction:'STOP_ORDER_DIRECTION_SELL',orderType:'STOP_ORDER_TYPE_STOP_LIMIT',
      lotsRequested:'1',stopPrice:{currency:'rub',units:'51',nano:0},price:{currency:'rub',units:'51',nano:0},createDate:'2026-10-02T08:59:02Z'}]})),
    cancelSandboxStop:vi.fn(async()=>{state.stop='STOP_ORDER_STATUS_CANCELED';}),
    postSandboxStopLimit:vi.fn(),
    postSandboxSessionExit:vi.fn(async(input:{requestId:string})=>{state.sellRequest=input.requestId;state.sold=true;return 'exit';})};
  const market={getInstrumentBy:vi.fn(async()=>({instrument:{uid:'vtbr',ticker:'VTBR',classCode:'TQBR',instrumentType:'share',currency:'rub',lot:1,
    apiTradeAvailableFlag:true,sellAvailableFlag:true,minPriceIncrement:{units:'0',nano:10000000}}})),
    getTradingStatus:vi.fn(async()=>({instrumentUid:'vtbr',tradingStatus:'SECURITY_TRADING_STATUS_NORMAL_TRADING',apiTradeAvailableFlag:true,limitOrderAvailableFlag:true})),
    getOrderBook:vi.fn(async()=>({instrumentUid:'vtbr',orderbookTs:at.toISOString(),bids:[{price:{units:'51',nano:0},quantity:'1'}],asks:[{price:{units:'52',nano:0},quantity:'1'}]}))};
  const closer=new SandboxSessionClose(config,client,market,new SandboxExitService(config,client,journal),journal);
  return{closer,journal,scenario,state,client,market,at};
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
