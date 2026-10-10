import type { HistoricalMinuteCandle } from '../history/market-data-store.js';

type Reference = { time?: string; isComplete?: boolean; volume?: string;
  open?: { value?: string }; high?: { value?: string }; low?: { value?: string }; close?: { value?: string } };

/** Accept only exact independent OHLC/volume corroboration, never inferred prices. */
export function reconcileMoexDay(input: {
  instrumentId: string; lotSize: number; columns: string[]; rows: unknown[][]; reference: Reference[];
}) {
  const index = (name: string) => {
    const i = input.columns.indexOf(name);
    if (i < 0) throw new Error(`Missing MOEX column ${name}`);
    return i;
  };
  const timeIndex = index('begin'), volumeIndex = index('volume'), valueIndex = index('value');
  const refs = new Map(input.reference.map((c) => [new Date(c.time!).toISOString(), c]));
  if (refs.size !== input.reference.length || refs.size !== input.rows.length) throw new Error('Source timestamp coverage differs');
  const seen = new Set<string>();
  const corrections: { time: string; rawVolume: number; normalizedLots: number }[] = [];
  const candles: HistoricalMinuteCandle[] = input.rows.map((row) => {
    const time = new Date(`${String(row[timeIndex]).replace(' ', 'T')}+03:00`).toISOString();
    const ref = refs.get(time);
    if (!ref?.isComplete || seen.has(time)) throw new Error(`Missing/incomplete/duplicate reference at ${time}`);
    seen.add(time);
    const prices = Object.fromEntries(['open', 'high', 'low', 'close'].map((key) => {
      const value = Number(row[index(key)]);
      if (!Number.isFinite(value) || value <= 0 || value !== Number(ref[key as 'open']?.value)) throw new Error(`Price mismatch at ${time}`);
      return [key, value];
    })) as Pick<HistoricalMinuteCandle, 'open' | 'high' | 'low' | 'close'>;
    const lots = Number(ref.volume), rawVolume = Number(row[volumeIndex]), turnover = Number(row[valueIndex]);
    if (!Number.isSafeInteger(lots) || lots < 0 || !Number.isSafeInteger(rawVolume) || rawVolume < 0 ||
      !Number.isSafeInteger(input.lotSize) || input.lotSize <= 0) throw new Error('Invalid volume/lot size');
    const units = lots * input.lotSize;
    const tolerance = Math.max(1e-6, Math.abs(turnover) * 1e-10);
    if (!Number.isFinite(turnover) || turnover < prices.low * units - tolerance || turnover > prices.high * units + tolerance) {
      throw new Error(`Turnover does not corroborate volume at ${time}`);
    }
    if (rawVolume !== units) {
      if (rawVolume !== lots) throw new Error(`Unexplained volume mismatch at ${time}`);
      corrections.push({ time, rawVolume, normalizedLots: lots });
    }
    return { instrumentId: input.instrumentId, time, ...prices, volume: lots };
  });
  return { candles: candles.sort((a, b) => a.time.localeCompare(b.time)), corrections };
}
