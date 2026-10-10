import { describe, expect, it } from 'vitest';
import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { assertTechnicalScope, selectTechnicalShare, technicalEntryInput, technicalApproval, technicalPurpose } from './sandbox-technical-scope.js';
const scenario = (): JournalScenarioRecord => ({id:1,recordedAt:new Date().toISOString(),observedAt:new Date().toISOString(),
  strategy:'intraday',decision:'candidate',instrumentId:'synthetic',blockers:[],warnings:[],
  input:{side:'long',lotSize:1,entryPrice:70,stopPrice:69,targetPrice:80,slippageRate:0.0005},
  snapshot:{purpose:technicalPurpose,authorization:technicalApproval,ticker:'VTBR'}});
describe('Human bounded technical acceptance scope',()=>{
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
