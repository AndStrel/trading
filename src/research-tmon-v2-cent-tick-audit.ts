import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCachedTmonDay, tmon2025Weekdays } from './research-tmon-2025-source.js';
import { readCachedTmon2026Day, tmon2026Weekdays } from './research-tmon-2026-source.js';
import { tmonLongReturn, type TmonV2Decision } from './research/tmon-intraday-v2.js';

const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const originalPath = join(process.cwd(), '.trading', 'tmon-v2-results.json');
const originalBody = readFileSync(originalPath);
const originalSha256 = hash(originalBody);
if (originalSha256 !== 'c0c1653d656109896499268c2807dcaf83ab3a3a5b8dec110effe717d8e55f90') {
  throw new Error('Original frozen TMON v2 report changed');
}
const original = JSON.parse(originalBody.toString('utf8')) as {
  year2025: { decisions: TmonV2Decision[] };
  year2026: { decisions: TmonV2Decision[] };
};

function priceGrid(dates: string[], readDay: (date: string) => { candles: {
  open: number; high: number; low: number; close: number;
}[] }) {
  let prices = 0;
  let offCent = 0;
  for (const date of dates) {
    for (const candle of readDay(date).candles) {
      for (const price of [candle.open, candle.high, candle.low, candle.close]) {
        prices += 1;
        if (Math.abs(price * 100 - Math.round(price * 100)) > 1e-6) offCent += 1;
      }
    }
  }
  return { dates: dates.length, prices, offCent };
}

function period(decisions: TmonV2Decision[]) {
  const trades = decisions.filter((decision) => decision.status === 'trade');
  if (trades.some((trade) => !trade.entry || !trade.exit)) throw new Error('Trade missing entry or exit');
  const result = trades.map((trade) => ({ date: trade.date,
    originalBaseNet: trade.baseNet,
    baseNet: tmonLongReturn(trade.entry!, trade.exit!, 0.00005, 0.01),
    stressNet: tmonLongReturn(trade.entry!, trade.exit!, 0.0001, 0.01),
    severeNet: tmonLongReturn(trade.entry!, trade.exit!, 0.0003, 0.01),
  }));
  const summarize = (key: 'baseNet' | 'stressNet' | 'severeNet') => {
    const values = result.map((row) => row[key]);
    return { winners: values.filter((value) => value > 0).length,
      winRate: values.length ? values.filter((value) => value > 0).length / values.length : null,
      mean: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null,
      withoutBestFiveSum: values.length > 5 ? [...values].sort((a, b) => b - a).slice(5)
        .reduce((total, value) => total + value, 0) : null };
  };
  return { trades: result.length, base: summarize('baseNet'), stress: summarize('stressNet'),
    severe: summarize('severeNet'), decisions: result };
}

const grid2025 = priceGrid(tmon2025Weekdays(), readCachedTmonDay);
const grid2026 = priceGrid(tmon2026Weekdays(), readCachedTmon2026Day);
if (grid2025.offCent || grid2026.offCent) throw new Error('TMON trade-price archive is not on a cent grid');
const year2025 = period(original.year2025.decisions);
const year2026 = period(original.year2026.decisions);
if (year2025.trades !== 184 || year2026.trades !== 152) throw new Error('Original trade counts changed');

const report = { originalSha256, tickRub: 0.01, noNewSignals: true,
  priceGrid: { year2025: grid2025, year2026: grid2026 }, year2025, year2026 };
const body = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = join(process.cwd(), '.trading', 'tmon-v2-cent-tick-audit.json');
writeFileSync(outputPath, body, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ outputPath, sha256: hash(body),
  priceGrid: report.priceGrid,
  year2025: { trades: year2025.trades, base: year2025.base, stress: year2025.stress },
  year2026: { trades: year2026.trades, base: year2026.base, stress: year2026.stress } })}\n`);
