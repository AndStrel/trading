import { readFileSync, writeFileSync } from 'node:fs';
import { dividendUpperBound, type BoundTrade, type DividendEvent } from './research/dividend-upper-bound.js';
import { digest } from './research/verified-candles.js';

const protocolSha256 = digest(readFileSync('docs/WEEKLY_RELATIVE_STRENGTH_DIVIDEND_BOUND.md'));
if (protocolSha256 !== 'cf88b89137a1debcb4c5ad2427cb438322ce428dcca60821d8fa64357e65e4ba') {
  throw new Error('Frozen dividend-bound protocol changed');
}
const source = JSON.parse(readFileSync('.trading/weekly-relative-strength-v1.json', 'utf8')) as {
  experiment: string; protocolSha256: string; trades: BoundTrade[];
};
if (source.experiment !== 'weekly-relative-strength-v1' ||
  source.protocolSha256 !== 'debc48cead91b3dd44524f7e8cb3b07bfb454ccdb9303577eb8d3af3c39ff282' ||
  source.trades.length !== 236) throw new Error('Frozen strategy result changed');

const years: { year: number; event: DividendEvent; sourceUrl: string }[] = [
  { year: 2018, event: { recordDay: '2018-06-26', amount: 12 },
    sourceUrl: 'https://nsddata.ru/ru/news/view/466666' },
  { year: 2020, event: { recordDay: '2020-10-05', amount: 18.7 },
    sourceUrl: 'https://pdf.dfcfw.com/pdf/H2_AN202103241475580432_1.pdf' },
  { year: 2024, event: { recordDay: '2024-07-11', amount: 33.3 },
    sourceUrl: 'https://nsddata.ru/en/news/view/1156481' },
];
const results = years.map(({ year, event, sourceUrl }) => {
  const trades = source.trades.filter((trade) => trade.entryDay.startsWith(String(year)));
  return { year, event, sourceUrl,
    baseline: dividendUpperBound(trades, { ...event, amount: 0 }, 0),
    scenarios: [0, 7, 14].map((windowDays) => ({ windowDays,
      ...dividendUpperBound(trades, event, windowDays) })) };
});
const report = { experiment: 'weekly-relative-strength-dividend-upper-bound', protocolSha256,
  sourceExperiment: source.experiment, sourceProtocolSha256: source.protocolSha256,
  codeSha256: digest(Buffer.concat(['src/research-relative-dividend-bound.ts',
    'src/research/dividend-upper-bound.ts'].map((path) => readFileSync(path)))), results };
writeFileSync('.trading/weekly-relative-dividend-bound.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
