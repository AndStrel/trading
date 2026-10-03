import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { ScenarioJournal } from './journal/scenario-journal.js';
import { IntradayScanner } from './scanner/intraday-scanner.js';
import { STRATEGY_CATALOG } from './strategies/catalog.js';
import type { TInvestClient } from './tbank/client.js';

// Offline acceptance fixture, NOT historical performance or actual broker quotes.
const quote=(price:number)=>({units:String(Math.trunc(price)),nano:Math.round((price-Math.trunc(price))*1e9)});
const reference=Date.parse('2026-09-14T06:10:00Z');
const reports=[];
for (const strategy of STRATEGY_CATALOG) {
  const directory=mkdtempSync(join(tmpdir(),'trading-strategy-smoke-'));
  try {
    const length=strategy.id==='trend-momentum-v1'?60:strategy.id==='vwap-reclaim-v1'?21:27;
    const start=strategy.id==='opening-range-breakout-v1'?reference-100*60_000:reference;
    const candles=Array.from({length},(_,index)=>{
      const close=strategy.id==='trend-momentum-v1'?100+index*0.3
        :strategy.id==='vwap-reclaim-v1'?(index===19?99:index===20?104:100):(index===length-1?104:100);
      return {time:new Date(start+index*5*60_000).toISOString(),open:quote(close),high:quote(close+3),low:quote(close-3),close:quote(close),volume:index===length-1?'200':'100',isComplete:true};
    });
    const now=new Date(start+length*5*60_000),ask=Number(candles.at(-1)!.close.units)+candles.at(-1)!.close.nano/1e9+0.01;
    const config=loadConfig({T_INVEST_TRADING_STRATEGY_ID:strategy.id,T_INVEST_INTRADAY_UNIVERSE:'watchlist',
      T_INVEST_INTRADAY_WATCHLIST:'[{"instrumentId":"synthetic-uid","label":"VTBR","lotSize":1,"priceStep":0.01}]',
      T_INVEST_SCANNER_MIN_AVERAGE_CANDLE_TURNOVER_RUB:'1000'});
    const client={getShares:async()=>({instruments:[{uid:'synthetic-uid',figi:'synthetic-figi'}]}),getCandles:async()=>({candles}),
      getOrderBook:async()=>({instrumentUid:'synthetic-uid',orderbookTs:now.toISOString(),isConsistent:true,bids:[{price:quote(ask-0.01),quantity:'100'}],asks:[{price:quote(ask),quantity:'100'}]}),
      getLastPrices:async()=>({lastPrices:[{instrumentUid:'synthetic-uid',time:now.toISOString(),price:quote(ask)}]}),
      getTradingStatus:async()=>({instrumentUid:'synthetic-uid',tradingStatus:'SECURITY_TRADING_STATUS_NORMAL_TRADING',apiTradeAvailableFlag:true,limitOrderAvailableFlag:true})} as unknown as TInvestClient;
    const scanner=new IntradayScanner(config,client,new ScenarioJournal(join(directory,'journal.sqlite')),()=>{});
    const events=await scanner.scanOnce(now);
    const recommendation=scanner.getLatestReport()?.recommendations[0];
    if (recommendation?.status!=='signal' || events[0]?.status!=='candidate-recorded') throw new Error(`Offline strategy fixture failed: ${strategy.id}`);
    reports.push({strategyId:strategy.id,status:recommendation.status,riskRub:recommendation.totalRiskRub,
      netTargetRub:recommendation.netRewardRub===null?null:Math.round(recommendation.netRewardRub*100)/100});
  } finally { rmSync(directory,{recursive:true,force:true}); }
}
process.stdout.write(JSON.stringify({synthetic:true,liveSubmissionAllowed:false,brokerRequests:0,reports})+'\n');
