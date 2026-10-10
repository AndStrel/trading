import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tLongReturn, type TMorningDecision } from './research/t-morning-strength.js';
import { siTradeReturn, type SiSide } from './research/si-first-hour.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const readVerified = (relative: string, expected: string): unknown => {
  const body = readFileSync(join(process.cwd(), relative));
  if (hash(body) !== expected) throw new Error(`Changed research report ${relative}`);
  return JSON.parse(body.toString('utf8')) as unknown;
};
const tReport = readVerified('.trading/t-morning-strength-v1-2025.json',
  '42032f10fc3d94b1b7b2c45880530d6348df6dcaef7390b792f153109745be31') as { decisions: TMorningDecision[]; summary: { unresolvedExit: number } };
const siReport = readVerified('.trading/si-us-session-continuation-v1.json',
  'b85f6061ec1f23c487ccdf5ad7f531dedcf2a0bc7bbd10da853bb306d0644ba5') as {
    decisions: { status: string; side?: SiSide; entry?: number; exit?: number }[];
    summary: { unresolved: number; entered: number };
  };

const summarize = (values: number[]) => ({ trades: values.length, wins: values.filter((value) => value > 0).length,
  mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  withoutBestFiveSum: [...values].sort((a, b) => b - a).slice(5).reduce((sum, value) => sum + value, 0) });

const tTrades = tReport.decisions.filter((decision) => decision.status === 'trade');
if (tTrades.length !== 56 || tReport.summary.unresolvedExit !== 1) throw new Error('T report coverage changed');
const tTrader = {
  base: summarize(tTrades.map((trade) => tLongReturn(trade.entry!, trade.exit!, 0.0005, 0.0005, 0.02))),
  stress: summarize(tTrades.map((trade) => tLongReturn(trade.entry!, trade.exit!, 0.001, 0.0005, 0.02))),
  unresolved: tReport.summary.unresolvedExit,
  activeMonths: new Set(tTrades.map((trade) => trade.date.slice(0, 7))).size,
  monthlyFeeRubIfNotWaived: 390,
};
const siTrades = siReport.decisions.filter((decision) => decision.status === 'trade');
if (siTrades.length !== 132 || siReport.summary.unresolved !== 1 || siReport.summary.entered !== 133) {
  throw new Error('Si report coverage changed');
}
const siCase = (commission: number, slippage: number) => {
  const result = summarize(siTrades.map((trade) => siTradeReturn(trade.side!, trade.entry!, trade.exit!,
    { commission, slippage })));
  return { ...result, optimisticWinsIncludingUnresolved: result.wins + siReport.summary.unresolved,
    optimisticWinFraction: (result.wins + siReport.summary.unresolved) / siReport.summary.entered };
};
const siCosts = { investorZeroSlippage: siCase(0.001, 0),
  optimisticPremiumMinimum: siCase(0.00015, 0.0005),
  zeroBrokerFeeBaseSlippage: siCase(0, 0.0005) };

const report = { note: 'Post-hoc cost sensitivity of rejected fixed rules; not an independent strategy test',
  tTrader, siCosts,
  officialTariff: 'https://www.tbank.ru/invest/help/brokerage/account/get-bs/tariff/' };
const body = `${JSON.stringify(report, null, 2)}\n`;
const path = join(process.cwd(), '.trading', 'cost-feasibility-counterfactual.json');
writeFileSync(path, body, { mode: 0o600 });
process.stdout.write(JSON.stringify({ path, sha256: hash(body), tTrader, siCosts }) + '\n');
