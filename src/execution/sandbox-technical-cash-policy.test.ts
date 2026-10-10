import { describe, expect, it } from 'vitest';
import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { sandboxEndpoint } from './sandbox-prepared-account.js';
import type { SandboxCashBaseline } from './sandbox-cash-reconciliation.js';
import { technicalApproval, technicalPurpose } from './sandbox-technical-scope.js';
import { hasTechnicalCashRestorationBaseline, isTechnicalCashAcceptance, technicalCashAcceptanceVersion } from './sandbox-technical-cash-policy.js';

const scenario=():JournalScenarioRecord=>({id:1,recordedAt:'2026-10-02T08:59:00Z',observedAt:'2026-10-02T08:59:00Z',
  strategy:'intraday',decision:'candidate',instrumentId:'vtbr',blockers:[],warnings:[],
  input:{side:'long',lotSize:1,entryPrice:52,stopPrice:51,targetPrice:62,slippageRate:0.0005},
  snapshot:{purpose:technicalPurpose,authorization:technicalApproval,ticker:'VTBR',technicalCashAcceptance:{version:technicalCashAcceptanceVersion}}});
const baseline=():SandboxCashBaseline=>({version:1,accountId:'account',entryRequestId:'entry-request',cashNano:'1000000000000',
  observedFrom:'2026-10-02T08:59:00Z',observedAt:'2026-10-02T08:59:00Z',ledgerRevision:'1',killGeneration:'generation',
  preparedRaw:JSON.stringify({version:1,endpoint:sandboxEndpoint,phase:'ready',nonce:'00000000-0000-4000-8000-000000000001',
    name:'daily-pilot-00000000-0000-4000-8000-000000000001',accountId:'account'})});
const expected={accountId:'account',entryRequestId:'entry-request'};

describe('Explicit technical cash acceptance policy',()=>{
  it('requires the versioned opt-in in addition to the existing narrow authorization',()=>{
    expect(isTechnicalCashAcceptance(scenario(),1)).toBe(true);
    expect(hasTechnicalCashRestorationBaseline(scenario(),1,baseline(),expected)).toBe(true);
  });
  it.each([undefined,null,[],{},'1',{version:1},{version:'2'},{version:'1',enabled:true}])('refuses legacy or malformed opt-in %j',policy=>{
    const value=scenario();value.snapshot={...(value.snapshot as object),technicalCashAcceptance:policy};
    expect(isTechnicalCashAcceptance(value,1)).toBe(false);
    expect(hasTechnicalCashRestorationBaseline(value,1,baseline(),expected)).toBe(false);
  });
  it.each(['approval','purpose','ticker','lots','side','cap','stop'])('never broadens the existing %s guard',condition=>{
    const value=scenario();let lots=1;
    if(condition==='approval')value.snapshot={...(value.snapshot as object),authorization:'other'};
    if(condition==='purpose')value.snapshot={...(value.snapshot as object),purpose:'other'};
    if(condition==='ticker')value.snapshot={...(value.snapshot as object),ticker:'SBER'};
    if(condition==='lots')lots=2;
    if(condition==='side')value.input.side='short';
    if(condition==='cap')value.input.entryPrice=70.000000001;
    if(condition==='stop')value.input.stopPrice=52;
    expect(isTechnicalCashAcceptance(value,lots)).toBe(false);
  });
  it('refuses missing baseline or mismatched account/entry/prepared identity',()=>{
    expect(hasTechnicalCashRestorationBaseline(scenario(),1,null,expected)).toBe(false);
    expect(hasTechnicalCashRestorationBaseline(scenario(),1,{...baseline(),accountId:'other'},expected)).toBe(false);
    expect(hasTechnicalCashRestorationBaseline(scenario(),1,{...baseline(),entryRequestId:'other'},expected)).toBe(false);
    expect(hasTechnicalCashRestorationBaseline(scenario(),1,{...baseline(),preparedRaw:'{}'},expected)).toBe(false);
    const wrongPrepared=JSON.parse(baseline().preparedRaw) as Record<string,unknown>;wrongPrepared.accountId='other';
    expect(hasTechnicalCashRestorationBaseline(scenario(),1,{...baseline(),preparedRaw:JSON.stringify(wrongPrepared)},expected)).toBe(false);
  });
});
