import { readFileSync, writeFileSync } from 'node:fs';
import { digest, loadVerifiedCandles } from './research/verified-candles.js';
import { weeklyCalendarRows, weeklyCalendarStats } from './research/weekly-calendar.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_CALENDAR_V1.md'));
const sources = loadVerifiedCandles();
const rows = weeklyCalendarRows(sources.filter((s) => s.ticker === 'SBER').flatMap((s) => s.data));
const years = [2023, 2024, 2025].map((year) => ({
  year, ...weeklyCalendarStats(rows.filter((r) => r.week.startsWith(String(year)))),
}));
const combined = weeklyCalendarStats(rows);
const reasons: string[] = [];
if (combined.trades < 100 || combined.weeks < 50) reasons.push('insufficient-trades-or-weeks');
if (combined.winRate === null || combined.winRate < 0.51 || combined.meanNetPct === null ||
  combined.meanNetPct <= 0 || combined.profitFactor === null || combined.profitFactor <= 1) reasons.push('failed-combined-gate');
if (years.filter((y) => y.year >= 2024).some((y) => y.winRate === null || y.winRate < 0.51 ||
  y.meanNetPct === null || y.meanNetPct <= 0 || y.profitFactor === null || y.profitFactor <= 1)) reasons.push('failed-yearly-gate');
const report = {
  hypothesis: 'weekly-calendar-v1', protocolSha256,
  codeSha256: digest(Buffer.concat(['src/research-weekly-calendar.ts', 'src/research/weekly-calendar.ts',
    'src/research/trading-costs.ts', 'src/research/verified-candles.ts'].map((p) => readFileSync(p)))),
  interpretation: 'Discovery on previously studied history; model execution only, before taxes and dividends.',
  sources: sources.filter((s) => s.ticker === 'SBER').map(({ data: unused, ...source }) => source),
  status: reasons.length ? 'rejected-in-discovery' : 'requires-independent-test-not-tradeable', reasons,
  combined, years, rows,
};
writeFileSync('.trading/weekly-calendar-v1.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, rows: rows.length }, null, 2));
