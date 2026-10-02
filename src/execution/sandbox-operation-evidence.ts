import { z } from 'zod/v4';
const id=z.string().min(1).max(256);
const quantity=z.union([z.number(),z.string().regex(/^\d{1,7}$/)]).transform(Number).pipe(z.number().int().min(0).max(1_000_000));
const money=z.object({currency:z.literal('rub'),units:z.string().regex(/^\d{1,12}$/).default('0'),nano:z.number().int().min(0).max(999999999).default(0)});
const signedMoney=z.object({currency:z.literal('rub'),units:z.string().regex(/^-?\d{1,12}$/).default('0'),nano:z.number().int().min(-999999999).max(999999999).default(0)});
const timestamp=z.iso.datetime({offset:true});
const orderSchema=z.object({orderId:id,orderRequestId:z.union([id,z.literal('')]).optional(),instrumentUid:id,orderDate:timestamp,currency:z.literal('rub'),
  direction:z.enum(['ORDER_DIRECTION_BUY','ORDER_DIRECTION_SELL']),orderType:z.literal('ORDER_TYPE_LIMIT'),
  executionReportStatus:z.literal('EXECUTION_REPORT_STATUS_FILL'),lotsRequested:quantity.pipe(z.literal(1)),lotsExecuted:quantity.pipe(z.literal(1)),
  stages:z.array(z.unknown()).length(0),executedOrderPrice:money});
const operationSchema=z.object({id, instrumentUid:id,date:timestamp,operationType:z.enum(['OPERATION_TYPE_BUY','OPERATION_TYPE_SELL']),
  state:z.literal('OPERATION_STATE_EXECUTED'),currency:z.literal('rub'),quantity:quantity.pipe(z.literal(1)),quantityRest:quantity.pipe(z.literal(0)),price:money,payment:signedMoney,
  trades:z.array(z.object({tradeId:id,dateTime:timestamp,quantity:quantity.pipe(z.literal(1)),price:money})).length(1)});
const nano=(m:{units:string;nano:number})=>BigInt(m.units)*1_000_000_000n+BigInt(m.nano);

// Narrow read-only recovery for the actual sandbox API: a filled one-unit
// order may omit stages. NEVER synthesize a trade ID, price or fill timestamp.
// Require the real operation/trade, exact orderDate, UID, side, quantity,
// cash payment and executed total, plus unique matching operation identity.
export function sandboxOrderNeedsOperations(payload:unknown):boolean {
  return orderSchema.safeParse(payload).success;
}
export function hydrateSandboxSingleUnitOrder(payload:unknown,operations:unknown,lookup:{requestId?:string;brokerOrderId?:string},now=new Date()) {
  try {
    const order=orderSchema.parse(payload);
    if((lookup.requestId&&order.orderRequestId!==lookup.requestId)||(lookup.brokerOrderId&&order.orderId!==lookup.brokerOrderId)
      ||(!lookup.requestId&&!lookup.brokerOrderId)||!Number.isFinite(now.getTime())||Date.parse(order.orderDate)>now.getTime()+1000)throw new Error();
    const type=order.direction==='ORDER_DIRECTION_BUY'?'OPERATION_TYPE_BUY':'OPERATION_TYPE_SELL';
    const identity=z.object({instrumentUid:id,date:timestamp,operationType:z.string()});
    const matches=z.object({operations:z.array(z.unknown()).max(1000)}).parse(operations).operations.filter(item=>{
      const parsed=identity.safeParse(item);return parsed.success&&parsed.data.instrumentUid===order.instrumentUid&&parsed.data.date===order.orderDate&&parsed.data.operationType===type;
    });
    if(matches.length!==1)throw new Error();
    const operation=operationSchema.parse(matches[0]),trade=operation.trades[0]!;
    const gross=nano(order.executedOrderPrice),payment=nano(operation.payment);
    if(gross<=0n||nano(operation.price)!==gross||nano(trade.price)!==gross||trade.dateTime!==order.orderDate
      ||payment!==(type==='OPERATION_TYPE_BUY'?-gross:gross))throw new Error();
    return {...payload as Record<string,unknown>,stages:[{tradeId:trade.tradeId,price:trade.price,quantity:trade.quantity,executionTime:trade.dateTime,
      evidenceSource:'sandbox-operation',operationId:operation.id}]};
  }catch{throw new Error('Unique sandbox operation and execution trade are not confirmed');}
}
