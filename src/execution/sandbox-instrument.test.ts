import { describe,expect,it } from 'vitest';
import { assertSandboxInstrument } from './sandbox-instrument.js';
const expected={instrumentId:'local-share',lotSize:10,priceStep:0.01};
const metadata=()=>({instrument:{uid:'local-share',instrumentType:'share',currency:'rub',lot:10,
  apiTradeAvailableFlag:true,sellAvailableFlag:true,buyAvailableFlag:true,minPriceIncrement:{units:'0',nano:10000000}}});
describe('Sandbox closing broker metadata',()=>{
  it('requires exact broker RUB share, lot and price tick before an entry',()=>expect(()=>assertSandboxInstrument(metadata(),expected,true)).not.toThrow());
  it('can exit when new buying is unavailable but selling is confirmed',()=>{
    const data=metadata();data.instrument.buyAvailableFlag=false;
    expect(()=>assertSandboxInstrument(data,expected)).not.toThrow();expect(()=>assertSandboxInstrument(data,expected,true)).toThrow();
  });
  it.each(['wrong-uid','wrong-lot','wrong-tick','etf','future','currency','no-api','no-sell','missing'])('rejects %s before side effects',condition=>{
    const data=metadata();if(condition==='wrong-uid')data.instrument.uid='other';if(condition==='wrong-lot')data.instrument.lot=1;
    if(condition==='wrong-tick')data.instrument.minPriceIncrement.nano=1000000;if(condition==='etf')data.instrument.instrumentType='etf';
    if(condition==='future')data.instrument.instrumentType='futures';if(condition==='currency')data.instrument.currency='usd';
    if(condition==='no-api')data.instrument.apiTradeAvailableFlag=false;if(condition==='no-sell')data.instrument.sellAvailableFlag=false;
    expect(()=>assertSandboxInstrument(condition==='missing'?{}:data,expected,true)).toThrow('Broker');
  });
});
