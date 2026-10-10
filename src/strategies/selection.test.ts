import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { assertScenarioSelection, parseTradingSelection, tradingSelectionKey, TradingSelectionController } from './selection.js';
import { scenarioInstrument } from '../execution/scenario-instrument.js';

const directories:string[]=[];
function setup() {
  const directory=mkdtempSync(join(tmpdir(),'trading-selection-')); directories.push(directory);
  const journal=new ScenarioJournal(join(directory,'journal.sqlite'));
  const config=loadConfig({T_INVEST_INTRADAY_UNIVERSE_TICKERS:'VTBR,IRAO'});
  return {journal,config,controller:new TradingSelectionController(config,journal)};
}
afterEach(()=>{for(const directory of directories.splice(0)) rmSync(directory,{recursive:true,force:true});});
describe('durable trading selection',()=>{
  it('initializes safely, persists across controllers and retains original settings',()=>{
    const {journal,config,controller}=setup();
    expect(controller.get()).toEqual({strategyId:'trend-momentum-v1',revision:1,tickers:['VTBR','IRAO']});
    controller.selectStrategy('vwap-reclaim-v1',1); controller.selectAssets(['VTBR'],2);
    expect(new TradingSelectionController(config,journal).get()).toEqual({strategyId:'vwap-reclaim-v1',revision:3,tickers:['VTBR']});
  });
  it('rejects stale competing updates atomically and preserves winning state',()=>{
    const {journal,config,controller}=setup();const second=new TradingSelectionController(config,journal);
    controller.selectAssets(['SBER'],1);
    expect(()=>second.selectStrategy('vwap-reclaim-v1',1)).toThrow('уже изменён');
    expect(second.get()).toMatchObject({revision:2,tickers:['SBER'],strategyId:'trend-momentum-v1'});
    expect(journal.compareAndSetRuntimeState(tradingSelectionKey,'stale','corrupt')).toBe(false);
  });
  it.each([[],['EVIL'],['VTBR','VTBR'],['vtbr']].map(tickers=>({tickers})))('rejects invalid asset choices $tickers',({tickers})=>{
    const {controller}=setup();expect(()=>controller.selectAssets(tickers,1)).toThrow('список');expect(controller.get().revision).toBe(1);
  });
  it('rejects unknown strategies and malformed persisted state',()=>{
    const {controller,journal}=setup();expect(()=>controller.selectStrategy('best-profit',1)).toThrow('стратегия');
    journal.setRuntimeState(tradingSelectionKey,'{}');expect(()=>controller.get()).toThrow('invalid');
    expect(()=>parseTradingSelection(JSON.stringify({strategyId:'trend-momentum-v1',revision:0,tickers:['VTBR']}))).toThrow();
  });
  it('invalidates pending scanner candidates, but preserves original exit metadata',()=>{
    const {controller,journal,config}=setup();
    const record=journal.record({observedAt:'2026-10-01T10:00:00Z',strategy:'intraday',instrumentId:'vtbr-uid',
      input:{side:'long',entryPrice:60,stopPrice:59,targetPrice:65,lotSize:1,slippageRate:0.0005},decision:'candidate',blockers:[],warnings:[],
      snapshot:{source:'intraday-scanner',tradingSelection:controller.get(),tradingStrategy:{id:'trend-momentum-v1',version:'1'},
        instrument:{ticker:'VTBR',instrumentId:'vtbr-uid',lotSize:1,priceStep:0.01}}});
    expect(assertScenarioSelection(journal,record)).toMatchObject({key:tradingSelectionKey});
    controller.selectAssets(['SBER'],1);
    expect(()=>assertScenarioSelection(journal,record)).toThrow('changed');
    expect(scenarioInstrument(config,record)).toEqual({instrumentId:'vtbr-uid',lotSize:1,priceStep:0.01});
  });
  it('cannot claim a pending execution using the previous selection proof',()=>{
    const {controller,journal}=setup();const previous=journal.getRuntimeState(tradingSelectionKey)!;
    const record=journal.record({observedAt:'2026-10-01T10:00:00Z',strategy:'intraday',instrumentId:'vtbr-uid',
      input:{side:'long',entryPrice:60,stopPrice:59,targetPrice:65,lotSize:1,slippageRate:0.0005},decision:'candidate',blockers:[],warnings:[],snapshot:{}});
    journal.queueExecution({scenarioId:record.id,mode:'sandbox',orderRequestId:'request-selection',instrumentId:record.instrumentId,
      side:'long',lots:1,limitPrice:60,estimatedRiskRub:2});journal.setExecutionKilled(false);
    controller.selectStrategy('vwap-reclaim-v1',1);
    expect(()=>journal.claimExecution(record.id,'123',{from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z',now:'2026-10-01T10:00:00Z',
      maxOrders:3,maxRiskRub:60,tradingSelection:{key:tradingSelectionKey,raw:previous}})).toThrow('changed');
    expect(journal.getExecutionByScenario(record.id)?.status).toBe('pending');
  });
  it('does not replace corrupted scanner metadata with a new configuration',()=>{
    const {journal,config}=setup();
    const record=journal.record({observedAt:'2026-10-01T10:00:00Z',strategy:'intraday',instrumentId:'vtbr-uid',
      input:{side:'long',entryPrice:60,stopPrice:59,targetPrice:65,lotSize:1,slippageRate:0.0005},decision:'candidate',blockers:[],warnings:[],
      snapshot:{source:'intraday-scanner',tradingStrategy:{id:'trend-momentum-v1'},instrument:{instrumentId:'vtbr-uid',lotSize:1,priceStep:-1}}});
    config.scanner.intradayWatchlist=[{instrumentId:'vtbr-uid',label:'VTBR',lotSize:1,priceStep:0.01}];
    expect(()=>scenarioInstrument(config,record)).toThrow('metadata is invalid');
  });
});
