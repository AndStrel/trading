import { costScenarios, eventReturnPct } from './trading-costs.js';
import type { DailyBar } from './weekly-trend.js';
import type { RelativeTrade } from './weekly-relative-strength.js';

type Position = { entryIndex: number; exitIndex: number; entryDay: string; entry: number;
  principal: number; shares: number };

function weekday(day: string): boolean {
  const value = new Date(`${day}T12:00:00Z`).getUTCDay();
  return value >= 1 && value <= 5;
}

function week(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function simulateWeeklyMarketRegime(sberInput: readonly DailyBar[], gazpInput: readonly DailyBar[],
  imoexInput: readonly DailyBar[]) {
  const sber = sberInput.filter((bar) => weekday(bar.day));
  const gazp = gazpInput.filter((bar) => weekday(bar.day));
  const indexBars = imoexInput.filter((bar) => weekday(bar.day));
  const indexByDay = new Map(indexBars.map((bar) => [bar.day, bar]));
  if (indexByDay.size !== indexBars.length) throw new Error('Duplicate index date');
  if (sber.length !== gazp.length || sber.some((bar, index) => bar.day !== gazp[index]?.day ||
    !indexByDay.has(bar.day))) throw new Error('Market calendars differ');
  const imoex = sber.map((bar) => indexByDay.get(bar.day)!);
  for (const bars of [sber, gazp, imoex]) {
    if (bars.some((bar, index) => !Number.isFinite(bar.open) || bar.open <= 0 ||
      !Number.isFinite(bar.close) || bar.close <= 0 ||
      (index > 0 && bar.day <= bars[index - 1]!.day))) throw new Error('Invalid daily bars');
  }
  const trades: RelativeTrade[] = [];
  const decisions: { day: string; status: string; trend?: boolean; relative?: boolean;
    market?: boolean }[] = [];
  let cash = 1_000_000;
  let positions: Position[] = [];
  let maxConcurrent = 0;
  for (let index = 0; index < sber.length; index++) {
    const bar = sber[index]!;
    const exits = positions.filter((position) => position.exitIndex === index);
    positions = positions.filter((position) => position.exitIndex !== index);
    for (const position of exits) {
      const proceeds = position.shares * bar.open * (1 - costScenarios.investorBase.slippage) *
        (1 - costScenarios.investorBase.commission);
      cash += proceeds;
      trades.push({ entryDay: position.entryDay, exitDay: bar.day, entry: position.entry,
        exit: bar.open, principal: position.principal, proceeds,
        netPct: (proceeds / position.principal - 1) * 100,
        stressPct: eventReturnPct(position.entry, bar.open, costScenarios.investorStress) });
    }
    if (index > 0 && week(bar.day) === week(sber[index - 1]!.day)) continue;
    const previous = sber[index - 1], lagged = sber[index - 253];
    const baseSber = sber[index - 64], baseGazp = gazp[index - 64];
    if (!previous || !lagged || !baseSber || !baseGazp || index < 200) {
      decisions.push({ day: bar.day, status: 'warmup' }); continue;
    }
    if ((Date.parse(bar.day) - Date.parse(previous.day)) / 86_400_000 > 7) {
      decisions.push({ day: bar.day, status: 'stale-history' }); continue;
    }
    const trend = previous.close > lagged.close;
    const relative = previous.close / baseSber.close > gazp[index - 1]!.close / baseGazp.close;
    const indexCloses = imoex.slice(index - 200, index).map((candidate) => candidate.close);
    const market = imoex[index - 1]!.close >
      indexCloses.reduce((total, close) => total + close, 0) / 200;
    if (!trend || !relative || !market) {
      decisions.push({ day: bar.day, status: 'no-signal', trend, relative, market }); continue;
    }
    if (positions.length >= 5) {
      decisions.push({ day: bar.day, status: 'capacity-skip', trend, relative, market }); continue;
    }
    const equity = cash + positions.reduce((total, position) => total + position.shares * bar.open *
      (1 - costScenarios.investorBase.slippage) * (1 - costScenarios.investorBase.commission), 0);
    const principal = Math.min(cash, equity / 5);
    if (principal < 1) {
      decisions.push({ day: bar.day, status: 'cash-skip', trend, relative, market }); continue;
    }
    cash -= principal;
    positions.push({ entryIndex: index, exitIndex: index + 20, entryDay: bar.day, entry: bar.open,
      principal, shares: principal / (bar.open * (1 + costScenarios.investorBase.slippage) *
        (1 + costScenarios.investorBase.commission)) });
    maxConcurrent = Math.max(maxConcurrent, positions.length);
    decisions.push({ day: bar.day, status: 'opened', trend, relative, market });
  }
  const lastOpen = sber.at(-1)?.open;
  return { trades, decisions, maxConcurrent, endingCash: cash,
    pending: positions.map(({ entryIndex: unused, exitIndex: unusedExit, ...position }) => position),
    endingLiquidationValue: lastOpen === undefined ? cash : cash + positions.reduce((total, position) =>
      total + position.shares * lastOpen * (1 - costScenarios.investorBase.slippage) *
      (1 - costScenarios.investorBase.commission), 0) };
}
