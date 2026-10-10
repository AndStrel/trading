import type { JournalScenarioRecord } from '../journal/scenario-journal.js';
import { decimalPriceNano } from './sandbox-stop-state.js';
import { z } from 'zod/v4';

export const technicalApproval = 'SANDBOX VTBR 1 LOT MAX 70 RUB BUY STOP CLOSE';
export const technicalPurpose = 'sandbox-technical-acceptance-v1';

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
