import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tgld2026DaySpecs, readCachedTgldDay } from './research-tgld-2026-feasibility.js';
import { tgldLongReturn } from './research/tgld-gold-lag.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Trade = { status: string; entry?: number; exit?: number };

function pairedSensitivity(name: string, expectedSha256: string) {
  const source = readFileSync(join(process.cwd(), '.trading', name));
  if (hash(source) !== expectedSha256) throw new Error(`Changed report ${name}`);
  const decisions = (JSON.parse(source.toString('utf8')) as { decisions: Trade[] }).decisions;
  const trades = decisions.filter((decision) => decision.status === 'trade');
  if (trades.some((trade) => trade.entry === undefined || trade.exit === undefined)) throw new Error(`Missing trade price ${name}`);
  const scenario = (slippagePerSide: number) => {
    const values = trades.map((trade) => tgldLongReturn(trade.entry!, trade.exit!, slippagePerSide));
    return { slippagePerSide, trades: values.length, netWinners: values.filter((value) => value > 0).length,
      meanNet: values.reduce((total, value) => total + value, 0) / values.length };
  };
  return { source: name, sourceSha256: expectedSha256,
    zeroAdverse: scenario(0), oneTickAdverse: scenario(0.000001), base: scenario(0.001) };
}

let observedPrices = 0;
let offCentGrid = 0;
for (const spec of tgld2026DaySpecs()) {
  for (const candle of readCachedTgldDay(spec).candles) {
    for (const price of [candle.open, candle.close, candle.high, candle.low]) {
      observedPrices += 1;
      if (Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) offCentGrid += 1;
    }
  }
}
const report = { purpose: 'post-result paired execution sensitivity, not a new strategy or validation',
  priceGrid: { observedPrices, offCentGrid, currentMoexMinStepRub: 0.01 },
  studies: [pairedSensitivity('tgld-gold-lag-v1.json', 'bd5c38ab007523dd0a457674dcf821767113a2002a94fb5deed1449704d5db85'),
    pairedSensitivity('tgld-inav-lag-v1.json', '9f1854aa1639aad41dc2d074bec7844309b27528b55d68ba13726bfb916c72df')] };
const body = `${JSON.stringify(report, null, 2)}\n`;
const output = join(process.cwd(), '.trading', 'tgld-tick-floor.json');
writeFileSync(output, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ output, sha256: hash(body), report })}\n`);
