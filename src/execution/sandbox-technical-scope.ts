import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { decimalPriceNano } from './sandbox-stop-state.js';
import { z } from 'zod/v4';

export const technicalApproval = 'SANDBOX VTBR 1 LOT MAX 70 RUB BUY STOP CLOSE';
export const technicalPurpose = 'sandbox-technical-acceptance-v1';

export function nativeTechnicalStopPrices(entry:bigint,bid:bigint,tick:bigint,lastPayload:unknown,instrumentId:string,now:Date) {
  const rows=z.object({lastPrices:z.array(z.unknown()).max(1000)}).parse(lastPayload).lastPrices;
  const identity=z.object({instrumentUid:z.string()});
  const matches=rows.filter(row=>{const p=identity.safeParse(row);return p.success&&p.data.instrumentUid===instrumentId;});
  if(matches.length!==1)throw new Error('Unique last trade is required');
  const last=z.object({time:z.iso.datetime({offset:true}),price:z.object({units:z.string().regex(/^\d{1,12}$/).default('0'),nano:z.number().int().min(0).max(999999999).default(0)})}).parse(matches[0]);
  const age=now.getTime()-Date.parse(last.time),price=BigInt(last.price.units)*1_000_000_000n+BigInt(last.price.nano);
  if(!Number.isFinite(age)||age< -1000||age>15000||price<=0n||tick<=0n||price%tick||entry%tick||bid%tick)throw new Error('Fresh tick-valid last trade is required');
  const reference=[entry,bid,price].reduce((a,b)=>a<b?a:b),trigger=reference-tick,limit=trigger-tick;
  if(limit<=0n||entry-limit>1_000_000_000n||entry>70_000_000_000n)throw new Error('Bounded native technical stop prices required');
  return {trigger,limit,lastTradeAt:last.time,lastTradeNano:String(price)};
}

export function technicalStopLimit(scenario:JournalScenarioRecord,lots:number,now:Date):string {
  const s=scenario.snapshot as Record<string,unknown>|null;
  const stop=decimalPriceNano(scenario.input.stopPrice);
  if(s?.acceptanceCase!=='native-stop')return stop;
  assertTechnicalScope(scenario,lots);
  const data=z.object({technicalStopLimitNano:z.string().regex(/^\d{1,12}$/),technicalTickNano:z.string().regex(/^\d{1,12}$/),technicalStopQuoteAt:z.iso.datetime({offset:true})}).parse(s);
  const limit=BigInt(data.technicalStopLimitNano),tick=BigInt(data.technicalTickNano),entry=BigInt(decimalPriceNano(scenario.input.entryPrice));
  const age=now.getTime()-Date.parse(data.technicalStopQuoteAt);
  if(!Number.isFinite(age)||limit<=0n||tick<=0n||limit>BigInt(stop)||limit%tick||entry-limit>1_000_000_000n||age< -1000||age>15000)throw new Error('Native technical limit is not confirmed');
  return String(limit);
}

export function technicalEntryInput(payload:unknown,tick:bigint,slippageRate:number) {
  if(tick<=0n)throw new Error('Positive price tick required');
  const quote=z.object({units:z.string().regex(/^\d+$/).default('0'),nano:z.number().int().min(0).max(999999999).default(0)});
  const quantity=z.union([z.number(),z.string().regex(/^\d{1,13}$/)]).transform(Number).pipe(z.number().int().positive().max(1_000_000_000_000));
  const asks=z.object({asks:z.array(z.object({price:quote,quantity})).min(1)}).parse(payload).asks;
  const prices=asks.map(level=>BigInt(level.price.units)*1_000_000_000n+BigInt(level.price.nano));
  const entry=prices.reduce((a,b)=>a<b?a:b);
  if(entry<=0n||entry>70_000_000_000n||entry%tick)throw new Error('One-lot price cap or tick not confirmed');
  const distance=((1_000_000_000n+tick-1n)/tick)*tick;
  if(entry<=distance)throw new Error('Positive protective stop required');
  return {side:'long' as const,entryPrice:Number(entry)/1e9,stopPrice:Number(entry-distance)/1e9,
    // Synthetic upper price exercises arithmetic only, NOT a profit forecast.
    targetPrice:Number(entry+10n*distance)/1e9,lotSize:1,slippageRate};
}

export function selectTechnicalShare(payload:unknown) {
  const all=z.object({instruments:z.array(z.unknown())}).parse(payload).instruments;
  const identity=z.object({ticker:z.string(),classCode:z.string()});
  const matches=all.filter(item=>{
    const parsed=identity.safeParse(item);
    return parsed.success&&parsed.data.ticker==='VTBR'&&parsed.data.classCode==='TQBR';
  });
  if(matches.length!==1)throw new Error('Unique VTBR TQBR instrument is not confirmed');
  return z.object({uid:z.string().min(1),ticker:z.literal('VTBR'),classCode:z.literal('TQBR'),lot:z.literal(1),
    minPriceIncrement:z.object({units:z.string().regex(/^\d+$/).default('0'),nano:z.number().int().min(0).max(999999999).default(0)})}).parse(matches[0]);
}

// This is a technical candidate in a PRIVATE isolated journal, never a
// strategy signal or a forecast. Admission/risk/stop/exit guards still apply.
export function assertTechnicalScope(scenario: JournalScenarioRecord, lots: number): void {
  const snapshot = scenario.snapshot as { purpose?: unknown; authorization?: unknown; ticker?: unknown } | null;
  if (snapshot?.purpose !== technicalPurpose || snapshot.authorization !== technicalApproval || snapshot.ticker !== 'VTBR'
    || scenario.strategy !== 'intraday' || scenario.decision !== 'candidate' || scenario.input.side !== 'long'
    || lots !== 1 || scenario.input.lotSize !== 1
    || BigInt(decimalPriceNano(scenario.input.entryPrice)) > 70_000_000_000n
    || BigInt(decimalPriceNano(scenario.input.stopPrice)) >= BigInt(decimalPriceNano(scenario.input.entryPrice))) {
    throw new Error('Explicit one-lot VTBR sandbox technical scope is not confirmed');
  }
}
