import { readFileSync, writeFileSync } from 'node:fs';
import { auditWeeklyPortfolio, type PortfolioTrade, type PendingPortfolioTrade } from './research/weekly-portfolio-risk.js';
import { digest } from './research/verified-candles.js';
import type { DailyBar } from './research/weekly-trend.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_PORTFOLIO_RISK_AUDIT.md'));
if (protocolSha256 !== 'cbd9a6d6724648258149e44ccfe4cd205a040a902fe4073733e282d11e49aee6') {
  throw new Error('Frozen portfolio audit protocol changed');
}
const source = JSON.parse(readFileSync('.trading/sber-daily-2015-2025.json', 'utf8')) as {
  rowsSha256: string; rows: DailyBar[];
};
if (source.rowsSha256 !== '07fa1ee1facc96812b196a910525238e1257113906d7abc2187a16fc141093ab' ||
  source.rows.length !== 2827 || digest(JSON.stringify(source.rows)) !== source.rowsSha256) {
  throw new Error('Frozen SBER source changed');
}
type Journal = { experiment: string; protocolSha256: string; sourceSha256: unknown;
  trades: PortfolioTrade[]; pending: PendingPortfolioTrade[]; endingCash: number };
const inputs = [
  { file: '.trading/weekly-relative-strength-v1.json', experiment: 'weekly-relative-strength-v1',
    protocol: 'debc48cead91b3dd44524f7e8cb3b07bfb454ccdb9303577eb8d3af3c39ff282', trades: 236 },
  { file: '.trading/weekly-market-regime-v1.json', experiment: 'weekly-market-regime-v1',
    protocol: '326d83fc918b6f42e92531b3a187a4ed4805fe262765dcd9816a546a2c443953', trades: 187 },
];
const comparisons = inputs.map((item) => {
  const journal = JSON.parse(readFileSync(item.file, 'utf8')) as Journal;
  if (journal.experiment !== item.experiment || journal.protocolSha256 !== item.protocol ||
    journal.trades.length !== item.trades) throw new Error(`Frozen journal changed: ${item.file}`);
  const audit = auditWeeklyPortfolio(source.rows, journal.trades, journal.pending, journal.endingCash);
  return { experiment: item.experiment, journalProtocolSha256: journal.protocolSha256, ...audit };
});
const report = { experiment: 'weekly-portfolio-risk-audit', protocolSha256,
  sourceSha256: source.rowsSha256,
  codeSha256: digest(Buffer.concat(['src/research-weekly-portfolio-risk.ts',
    'src/research/weekly-portfolio-risk.ts'].map((path) => readFileSync(path)))), comparisons };
writeFileSync('.trading/weekly-portfolio-risk-audit.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ ...report, comparisons: comparisons.map(({ daily: unusedDaily, weeks: unusedWeeks,
  ...summary }) => summary) }, null, 2));
