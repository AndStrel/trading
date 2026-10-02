import { expect,it } from 'vitest';
import { reconcileSandboxFixtureCash } from './sandbox-cash-reconciliation.js';
const now=new Date('2026-10-02T11:30:00Z');
function fixture(){
 const expected={instrumentId:'synthetic',buyGrossNano:'51900000000',sellGrossNano:'51895000000',buyCommissionNano:'25950000',sellCommissionNano:'25947500',buyAt:'2026-10-02T11:21:27Z',sellAt:'2026-10-02T11:22:31Z',buyOperationId:'buy',sellOperationId:'sell'};
 const row=(id:string,operationType:string,date:string,units:string,nano:number,quantity:string)=>({id,operationType,date,payment:{currency:'rub',units,nano},quantity,quantityRest:'0',instrumentUid:'synthetic',currency:'rub',state:'OPERATION_STATE_EXECUTED'});
 const operations=[row('fund','OPERATION_TYPE_INPUT','2026-10-02T11:21:07Z','1000',0,'0'),row('buy','OPERATION_TYPE_BUY',expected.buyAt,'-51',-900000000,'1'),
 row('fee-buy','OPERATION_TYPE_BROKER_FEE',expected.buyAt,'0',-25950000,'0'),row('sell','OPERATION_TYPE_SELL',expected.sellAt,'51',895000000,'1'),
 row('fee-sell','OPERATION_TYPE_BROKER_FEE',expected.sellAt,'0',-25948000,'0')];
 return {expected,operations};
}
it('keeps fill fees, operation fees and cash distinct; no tolerance or optimistic overwrite',()=>{
 const f=fixture();expect(reconcileSandboxFixtureCash(f,'999943103000',f.expected,now)).toMatchObject({exactMatched:false,fillNetNano:'-56897500',operationsNetNano:'-56898000',conservativeNetNano:'-56898000',feeDifferenceNano:'500',cashVsOperationsNano:'1000',cashVsFillsNano:'500'});
});
it('matches only if all sources match exactly',()=>{
 const upper=fixture();upper.operations[0]!.currency='RUB';upper.operations[0]!.payment.currency='RUB';
 expect(reconcileSandboxFixtureCash(upper,'999943103000',upper.expected,now).exactMatched).toBe(false);
 const f=fixture();f.operations[4]!.payment.nano=-25947500;
 expect(reconcileSandboxFixtureCash(f,'999943102500',f.expected,now).exactMatched).toBe(true);
});
it('uses actual provenance ID across timestamp canonicalization, never a temporal neighbour',()=>{
 const f=fixture();f.operations[1]!.date='2026-10-02T11:21:27.000001Z';
 expect(reconcileSandboxFixtureCash(f,'999943103000',f.expected,now).exactMatched).toBe(false);
 f.operations[1]!.id='same-millisecond-foreign';expect(()=>reconcileSandboxFixtureCash(f,'999943103000',f.expected,now)).toThrow();
});
it.each(['missing-fee','extra','duplicate','foreign','wrong-funding','wrong-payment','future','before-funding','positive-fee','mixed-sign','unknown-type','invalid-clock','wrong-time','foreign-operation'])('rejects incomplete or contradictory evidence: %s',kind=>{
 const f=fixture();
 if(kind==='missing-fee')f.operations.pop();if(kind==='extra')f.operations.push({...f.operations[0]!,id:'extra'});
 if(kind==='duplicate')f.operations[4]!.id='fee-buy';if(kind==='foreign')f.operations[1]!.instrumentUid='foreign';
 if(kind==='wrong-funding')f.operations[0]!.payment.units='2000';if(kind==='wrong-payment')f.operations[1]!.payment.nano=-899000000;
 if(kind==='future')f.operations[4]!.date='2026-10-02T11:31:00Z';if(kind==='before-funding')f.operations[4]!.date='2026-10-02T11:20:00Z';
 if(kind==='positive-fee')f.operations[4]!.payment.nano=25948000;if(kind==='mixed-sign'){f.operations[1]!.payment.units='51';f.operations[1]!.payment.nano=-900000000;}
 if(kind==='unknown-type')f.operations[4]!.operationType='OPERATION_TYPE_TAX';if(kind==='wrong-time')f.expected.buyAt='2026-10-02T11:21:28Z';
 if(kind==='foreign-operation')f.expected.buyOperationId='foreign';
 expect(()=>reconcileSandboxFixtureCash(f,'999943103000',f.expected,kind==='invalid-clock'?new Date(NaN):now)).toThrow();
});
