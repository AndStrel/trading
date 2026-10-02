import { z } from 'zod/v4';
const id=z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/);
const currency=z.string().transform(value=>value.toLowerCase()).pipe(z.literal('rub'));
const money=z.object({currency,units:z.string().regex(/^-?\d{1,12}$/),nano:z.number().int().min(-999999999).max(999999999)});
const quantity=z.union([z.number(),z.string().regex(/^\d{1,7}$/)]).transform(Number).pipe(z.number().int().min(0).max(1000000));
const operation=z.object({id,operationType:z.enum(['OPERATION_TYPE_INPUT','OPERATION_TYPE_BUY','OPERATION_TYPE_SELL','OPERATION_TYPE_BROKER_FEE']),
 state:z.literal('OPERATION_STATE_EXECUTED'),currency,date:z.iso.datetime({offset:true}),
 payment:money,quantity,quantityRest:quantity,instrumentUid:z.string().max(256)});
const unsigned=z.string().regex(/^\d{1,16}$/);
const signedNano=(m:z.infer<typeof money>)=>{
 const units=BigInt(m.units),fraction=BigInt(m.nano);
 if((units>0n&&fraction<0n)||(units<0n&&fraction>0n))throw new Error('Contradictory money signs');
 return units*1_000_000_000n+fraction;
};
export type SandboxCashExpected={instrumentId:string;buyGrossNano:string;sellGrossNano:string;buyCommissionNano:string;sellCommissionNano:string;buyAt:string;sellAt:string;buyOperationId:string;sellOperationId:string};
// ACCOUNT-AGGREGATE evidence for a sealed one-unit fixture only. Fee operations
// need not identify a parent trade: never pretend that they do. No ledger
// mutation, fee overwrite, tolerance, rounding or reservation release here.
export function reconcileSandboxFixtureCash(payload:unknown,cashNano:string,expected:SandboxCashExpected,now=new Date()) {
 try {
  const rows=z.object({operations:z.array(operation).length(5)}).parse(payload).operations;
  const buyGross=BigInt(unsigned.parse(expected.buyGrossNano)),sellGross=BigInt(unsigned.parse(expected.sellGrossNano));
  const fillFees=BigInt(unsigned.parse(expected.buyCommissionNano))+BigInt(unsigned.parse(expected.sellCommissionNano));
  const cash=BigInt(unsigned.parse(cashNano));
  if(!Number.isFinite(now.getTime())||buyGross<=0n||sellGross<=0n||new Set(rows.map(r=>r.id)).size!==5)throw new Error();
  const funding=rows.filter(r=>r.operationType==='OPERATION_TYPE_INPUT'),buys=rows.filter(r=>r.operationType==='OPERATION_TYPE_BUY'),
   sells=rows.filter(r=>r.operationType==='OPERATION_TYPE_SELL'),fees=rows.filter(r=>r.operationType==='OPERATION_TYPE_BROKER_FEE');
  if(funding.length!==1||buys.length!==1||sells.length!==1||fees.length!==2)throw new Error();
  const fund=funding[0]!,buy=buys[0]!,sell=sells[0]!;
  // Existing snapshots canonicalize trade timestamps to milliseconds. The
  // actual provenance IDs, not a same-millisecond match, establish identity.
  const buyAt=Date.parse(z.iso.datetime({offset:true}).parse(expected.buyAt)),sellAt=Date.parse(z.iso.datetime({offset:true}).parse(expected.sellAt));
  if(signedNano(fund.payment)!==1000_000_000_000n||fund.quantity!==0||fund.quantityRest!==0
   ||buy.instrumentUid!==expected.instrumentId||sell.instrumentUid!==expected.instrumentId
   ||buy.id!==id.parse(expected.buyOperationId)||sell.id!==id.parse(expected.sellOperationId)
   ||buy.quantity!==1||sell.quantity!==1||buy.quantityRest!==0||sell.quantityRest!==0
   ||signedNano(buy.payment)!==-buyGross||signedNano(sell.payment)!==sellGross
   ||Date.parse(buy.date)!==buyAt||Date.parse(sell.date)!==sellAt||Date.parse(buy.date)<Date.parse(fund.date)||Date.parse(sell.date)<Date.parse(buy.date)
   ||rows.some(r=>Date.parse(r.date)<Date.parse(fund.date)||Date.parse(r.date)>now.getTime()+1000)
   ||fees.some(r=>r.quantity!==0||r.quantityRest!==0||signedNano(r.payment)>=0n))throw new Error();
  const chargedFees=-fees.reduce((sum,r)=>sum+signedNano(r.payment),0n);
  const expectedFromOperations=rows.reduce((sum,r)=>sum+signedNano(r.payment),0n);
  const fillNet=sellGross-buyGross-fillFees,operationsNet=sellGross-buyGross-chargedFees;
  const cashVsOperations=cash-expectedFromOperations,cashVsFills=cash-(1000_000_000_000n+fillNet),feeDifference=chargedFees-fillFees;
  const conservativeNet=sellGross-buyGross-(chargedFees>fillFees?chargedFees:fillFees);
  return {exactMatched:cashVsOperations===0n&&cashVsFills===0n&&feeDifference===0n,
   basis:'sealed-fixture-account-aggregate' as const,operationCount:5,fillNetNano:String(fillNet),operationsNetNano:String(operationsNet),
   conservativeNetNano:String(conservativeNet),reportedFillFeesNano:String(fillFees),chargedOperationFeesNano:String(chargedFees),
   feeDifferenceNano:String(feeDifference),cashVsOperationsNano:String(cashVsOperations),cashVsFillsNano:String(cashVsFills)};
 }catch{throw new Error('Complete sealed sandbox fixture cash evidence is not confirmed');}
}
