import { describe, expect, it } from 'vitest';
import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { assertTechnicalScope, selectTechnicalShare, technicalEntryInput, technicalApproval, technicalPurpose, technicalStopLimit, nativeTechnicalStopPrices } from './sandbox-technical-scope.js';
const scenario = (): JournalScenarioRecord => ({id:1,recordedAt:new Date().toISOString(),observedAt:new Date().toISOString(),
  strategy:'intraday',decision:'candidate',instrumentId:'synthetic',blockers:[],warnings:[],
  input:{side:'long',lotSize:1,entryPrice:70,stopPrice:69,targetPrice:80,slippageRate:0.0005},
  snapshot:{purpose:technicalPurpose,authorization:technicalApproval,ticker:'VTBR'}});
describe('Human bounded technical acceptance scope',()=>{
  it('puts technical trigger below ask, BID and the actual last trade; limit one tick lower',()=>{
    const now=new Date('2026-10-02T11:00:00Z'),last={lastPrices:[{instrumentUid:'vtbr',time:now.toISOString(),price:{units:'51',nano:870000000}}]};
    expect(nativeTechnicalStopPrices(51880000000n,51875000000n,5000000n,last,'vtbr',now)).toMatchObject({trigger:51865000000n,limit:51860000000n});
    expect(()=>nativeTechnicalStopPrices(51880000000n,51875000000n,5000000n,last,'foreign',now)).toThrow();
    expect(()=>nativeTechnicalStopPrices(51880000000n,51875000000n,5000000n,last,'vtbr',new Date('2026-10-02T11:00:16Z'))).toThrow();
    expect(()=>nativeTechnicalStopPrices(70000000001n,51875000000n,5000000n,last,'vtbr',now)).toThrow();
    expect(()=>nativeTechnicalStopPrices(51880000000n,51875000000n,5000000n,last,'vtbr',new Date(NaN))).toThrow();
    expect(()=>nativeTechnicalStopPrices(51880000000n,51875000000n,5000000n,{lastPrices:[last.lastPrices[0],last.lastPrices[0]]},'vtbr',now)).toThrow();
  });
  it('keeps ordinary stop price unchanged',()=>expect(technicalStopLimit(scenario(),1,new Date())).toBe('69000000000'));
  it.each(['valid','stale','future','above-trigger','unticked','too-wide','unauthorized','invalid-clock'])('bounds native technical stop limit: %s',kind=>{
    const now=new Date('2026-10-02T10:00:00.000Z'),s=scenario();s.input.stopPrice=69.995;
    const snap={purpose:technicalPurpose,authorization:technicalApproval,ticker:'VTBR',acceptanceCase:'native-stop',technicalStopLimitNano:'69990000000',technicalTickNano:'5000000',technicalStopQuoteAt:now.toISOString()};
    if(kind==='stale')snap.technicalStopQuoteAt='2026-10-02T09:59:40.000Z';
    if(kind==='future')snap.technicalStopQuoteAt='2026-10-02T10:00:02.000Z';
    if(kind==='above-trigger')snap.technicalStopLimitNano='70000000000';
    if(kind==='unticked')snap.technicalStopLimitNano='69990000001';
    if(kind==='too-wide')snap.technicalStopLimitNano='68000000000';
    if(kind==='unauthorized')snap.authorization='';s.snapshot=snap;
    if(kind==='valid')expect(technicalStopLimit(s,1,now)).toBe('69990000000');else expect(()=>technicalStopLimit(s,1,kind==='invalid-clock'?new Date(NaN):now)).toThrow();
  });
  it.each([1,'1'])('parses REST whole-lot quantity %s and exact prices',quantity=>{
    expect(technicalEntryInput({asks:[{price:{units:'52',nano:340000000},quantity}]},5000000n,0.0005)).toMatchObject({entryPrice:52.34,stopPrice:51.34,lotSize:1});
  });
  it.each(['0','1.5','bad',-1])('rejects malformed/empty depth quantity %s',quantity=>{
    expect(()=>technicalEntryInput({asks:[{price:{units:'52',nano:340000000},quantity}]},5000000n,0.0005)).toThrow();
  });
  it('never rounds an above-cap price down or invents a price tick',()=>{
    expect(()=>technicalEntryInput({asks:[{price:{units:'70',nano:1},quantity:'1'}]},1n,0.0005)).toThrow();
    expect(()=>technicalEntryInput({asks:[{price:{units:'52',nano:1},quantity:'1'}]},5000000n,0.0005)).toThrow();
  });
  const share={uid:'synthetic',ticker:'VTBR',classCode:'TQBR',lot:1,minPriceIncrement:{units:'0',nano:5000000}};
  it('validates only target metadata, not unrelated delisted shares',()=>{
    expect(selectTechnicalShare({instruments:[{ticker:'OTHER',classCode:'TQBR'},share]})).toEqual(share);
  });
  it.each(['duplicate','missing-tick','wrong-lot','no-vtbr'])('rejects %s metadata',condition=>{
    const instruments=condition==='duplicate'?[share,share]:condition==='missing-tick'?[{...share,minPriceIncrement:undefined}]:
      condition==='wrong-lot'?[{...share,lot:10}]:[];
    expect(()=>selectTechnicalShare({instruments})).toThrow();
  });
  it('accepts the exact inclusive cap using integer money',()=>expect(()=>assertTechnicalScope(scenario(),1)).not.toThrow());
  it.each(['over-cap','wrong-lot','two-lots','wrong-ticker','no-approval','ordinary-strategy','short','bad-stop'])('rejects %s',condition=>{
    const s=scenario();let lots=1;
    if(condition==='over-cap')s.input.entryPrice=70.000000001;
    if(condition==='wrong-lot')s.input.lotSize=10;
    if(condition==='two-lots')lots=2;
    if(condition==='wrong-ticker')s.snapshot={purpose:technicalPurpose,authorization:technicalApproval,ticker:'SBER'};
    if(condition==='no-approval')s.snapshot={purpose:technicalPurpose,ticker:'VTBR'};
    if(condition==='ordinary-strategy')s.snapshot={};
    if(condition==='short')s.input.side='short';
    if(condition==='bad-stop')s.input.stopPrice=70;
    expect(()=>assertTechnicalScope(s,lots)).toThrow();
  });
});
