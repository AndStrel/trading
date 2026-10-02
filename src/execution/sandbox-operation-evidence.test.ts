import { describe, expect, it, vi } from 'vitest';
import { hydrateSandboxSingleUnitOrder, sandboxOrderNeedsOperations } from './sandbox-operation-evidence.js';
import { parseSandboxOrderState, parseSandboxExitOrderState, parseSandboxSessionExitOrderState } from './sandbox-order-state.js';
import { TInvestOrderClient } from './tinvest-order-client.js';
const at='2026-10-02T09:15:49.768830Z',now=new Date('2026-10-02T09:20:00Z');
const price={currency:'rub',units:'52',nano:335000000};
function fixture(sell=false) {
  const order={orderId:'broker-id',orderRequestId:'request-id',instrumentUid:'instrument',orderDate:at,currency:'rub',direction:sell?'ORDER_DIRECTION_SELL':'ORDER_DIRECTION_BUY',
    orderType:'ORDER_TYPE_LIMIT',executionReportStatus:'EXECUTION_REPORT_STATUS_FILL',lotsRequested:'1',lotsExecuted:'1',stages:[],executedOrderPrice:price,
    executedCommission:{currency:'rub',units:'0',nano:26167500},serviceCommission:{currency:'rub',units:'0',nano:0}};
  const operation={id:'actual-operation-id',instrumentUid:'instrument',date:at,operationType:sell?'OPERATION_TYPE_SELL':'OPERATION_TYPE_BUY',state:'OPERATION_STATE_EXECUTED',currency:'rub',
    quantity:'1',quantityRest:'0',price,payment:{currency:'rub',units:sell?'52':'-52',nano:sell?335000000:-335000000},
    trades:[{tradeId:'actual-trade-id',dateTime:at,quantity:'1',price}]};
  return{order,operation};
}
describe('Actual sandbox operation fill evidence, never invented stages',()=>{
  it('hydrates a native child with empty requestId only through its exact broker identity',()=>{
    const f=fixture(true);f.order.orderRequestId='';
    expect(sandboxOrderNeedsOperations(f.order)).toBe(true);
    const hydrated=hydrateSandboxSingleUnitOrder(f.order,{operations:[f.operation]},{brokerOrderId:'broker-id'},now);
    expect(hydrated.stages).toHaveLength(1);
    expect(parseSandboxExitOrderState(hydrated,{brokerOrderId:'broker-id',instrumentId:'instrument',lots:1,lotSize:1,notBefore:'2026-10-02T09:15:00Z'},now).terminal).toBe(true);
    expect(()=>parseSandboxExitOrderState(hydrated,{brokerOrderId:'foreign',instrumentId:'instrument',lots:1,lotSize:1,notBefore:'2026-10-02T09:15:00Z'},now)).toThrow();
    expect(()=>parseSandboxSessionExitOrderState(hydrated,{requestId:'request-id',brokerOrderId:'broker-id',instrumentId:'instrument',lots:1,lotSize:1,notBefore:'2026-10-02T09:15:00Z'},now)).toThrow();
    expect(()=>parseSandboxSessionExitOrderState(hydrated,{requestId:'',brokerOrderId:'broker-id',instrumentId:'instrument',lots:1,lotSize:1,notBefore:'2026-10-02T09:15:00Z'},now)).toThrow();
    expect(()=>parseSandboxOrderState({...hydrated,direction:'ORDER_DIRECTION_BUY'},{requestId:'',instrumentId:'instrument',lots:1,lotSize:1},now)).toThrow();
    expect(()=>hydrateSandboxSingleUnitOrder(f.order,{operations:[f.operation]},{requestId:'request-id'},now)).toThrow();
    expect(()=>hydrateSandboxSingleUnitOrder(f.order,{operations:[f.operation]},{brokerOrderId:'foreign'},now)).toThrow();
  });
  it('client recovers native child stages by exact broker ID using reads only',async()=>{
    const f=fixture(true);f.order.orderRequestId='';const paths:string[]=[];
    const fetcher=vi.fn(async(url:unknown)=>{paths.push(String(url).split('/').at(-1)!);return new Response(JSON.stringify(String(url).endsWith('/GetSandboxOperations')?{operations:[f.operation]}:f.order));}) as unknown as typeof fetch;
    const client=new TInvestOrderClient('synthetic-sandbox','https://example.test/rest',fetcher);
    expect(await client.getSandboxChildOrderState('synthetic-account','broker-id')).toMatchObject({stages:[expect.objectContaining({tradeId:'actual-trade-id'})]});
    expect(paths).toEqual(['GetSandboxOrderState','GetSandboxOperations']);
  });
  it.each([false,true])('recovers actual trade for BUY/SELL=%s and preserves provenance',sell=>{
    const f=fixture(sell),hydrated=hydrateSandboxSingleUnitOrder(f.order,{operations:[f.operation]},{requestId:'request-id'},now);
    expect(hydrated.stages[0]).toMatchObject({tradeId:'actual-trade-id',executionTime:at,evidenceSource:'sandbox-operation',operationId:'actual-operation-id'});
    if(!sell)expect(parseSandboxOrderState(hydrated,{requestId:'request-id',instrumentId:'instrument',lots:1,lotSize:1},now)).toMatchObject({grossNano:'52335000000',commissionNano:'26167500',
      stages:[expect.objectContaining({tradeId:'actual-trade-id',evidenceSource:'sandbox-operation'})]});
  });
  it.each(['absent','duplicate','side','instrument','date','trade-time','price','payment','quantity','partial','empty-trades','request','broker-id','future'])('refuses %s evidence',condition=>{
    const f=fixture();let operations=[f.operation],lookup:{requestId?:string;brokerOrderId?:string}={requestId:'request-id'};
    if(condition==='absent')operations=[];
    if(condition==='duplicate')operations.push({...f.operation,id:'another-operation'});
    if(condition==='side')f.operation.operationType='OPERATION_TYPE_SELL';
    if(condition==='instrument')f.operation.instrumentUid='foreign';
    if(condition==='date')f.operation.date='2026-10-02T09:15:49.768831Z';
    if(condition==='trade-time')f.operation.trades[0]!.dateTime='2026-10-02T09:15:49.768831Z';
    if(condition==='price')f.operation.price={...price,nano:330000000};
    if(condition==='payment')f.operation.payment={...f.operation.payment,nano:-330000000};
    if(condition==='quantity')f.operation.quantity='10';
    if(condition==='partial')f.operation.quantityRest='1';
    if(condition==='empty-trades')f.operation.trades=[];
    if(condition==='request')lookup.requestId='foreign';
    if(condition==='broker-id')lookup={brokerOrderId:'foreign'};
    const checkedAt=condition==='future'?new Date('2026-10-02T09:14:00Z'):now;
    expect(()=>hydrateSandboxSingleUnitOrder(f.order,{operations},lookup,checkedAt)).toThrow();
  });
  it('does not activate fallback for partial, multi-lot, populated or missing aggregate evidence',()=>{
    const f=fixture();expect(sandboxOrderNeedsOperations(f.order)).toBe(true);
    for(const change of [{lotsRequested:'2'},{executionReportStatus:'EXECUTION_REPORT_STATUS_PARTIALLYFILL'},{stages:[{}]},{executedOrderPrice:undefined}]) {
      expect(sandboxOrderNeedsOperations({...f.order,...change})).toBe(false);
    }
  });
  it('client only reads operations, never POSTs an order, when recovering empty stages',async()=>{
    const f=fixture(),requests:Array<{url:string;body:Record<string,unknown>}>=[];
    const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{
      requests.push({url:String(url),body:JSON.parse(String(init?.body))});
      return new Response(JSON.stringify(String(url).endsWith('/GetSandboxOperations')?{operations:[f.operation]}:f.order));
    }) as unknown as typeof fetch;
    const client=new TInvestOrderClient('synthetic-sandbox','https://example.test/rest',fetcher);
    expect(await client.getSandboxOrderState('synthetic-account','request-id')).toMatchObject({stages:[expect.objectContaining({tradeId:'actual-trade-id'})]});
    expect(requests.map(r=>r.url.split('/').at(-1))).toEqual(['GetSandboxOrderState','GetSandboxOperations']);
    expect(requests[1]?.body).toMatchObject({accountId:'synthetic-account',state:'OPERATION_STATE_EXECUTED'});
  });
});
