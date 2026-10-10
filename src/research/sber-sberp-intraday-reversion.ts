export type PairCandle = {
  begin: string;
  open: number;
  close: number;
};

export type PairBar = {
  begin: string;
  sber: PairCandle;
  sberp: PairCandle;
  spread: number;
};

export type PairCosts = {
  commissionPerSide: number;
  slippagePerSide: number;
};

export type PairTrade = {
  date: string;
  entryTime: string;
  exitTime: string;
  side: 'long_sberp_short_sber' | 'short_sberp_long_sber';
  entrySber: number;
  entrySberp: number;
  exitSber: number;
  exitSberp: number;
  exitReason: 'reversion' | 'adverse_expansion' | 'time';
  grossReturn: number;
  baseNetReturn: number;
  stressNetReturn: number;
};

export type PairAttempt = {
  date: string;
  signalTime: string;
  zScore: number;
  status: 'cancelled_entry' | 'unresolved_exit' | 'trade';
  trade?: PairTrade;
};

export type PairDayResult = {
  date: string;
  synchronizedBars: PairBar[];
  attempts: PairAttempt[];
};

const WINDOW_BARS = 6;
const ENTRY_FROM_MINUTE = 11 * 60;
const ENTRY_TO_MINUTE = 16 * 60 + 30;
const ENTRY_Z = 2;
const EXIT_Z = 0.5;
const STOP_Z = 4;
const MAX_HOLDING_BARS = 6;
const TEN_MINUTES_MS = 10 * 60_000;
export const BASE_PAIR_COSTS: PairCosts = { commissionPerSide: 0.003, slippagePerSide: 0.0005 };
export const STRESS_PAIR_COSTS: PairCosts = { commissionPerSide: 0.003, slippagePerSide: 0.001 };

function assertPrice(value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Pair candle prices must be positive and finite');
}

function isoMillis(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid MOEX candle timestamp: ${value}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

function minuteOfDay(value: string): number {
  return Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));
}

function nextTenMinute(value: string): string {
  const timestamp = isoMillis(value) + TEN_MINUTES_MS;
  const date = new Date(timestamp);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)}`;
}

export function joinPairCandles(sber: readonly PairCandle[], sberp: readonly PairCandle[]): PairBar[] {
  const sberByTime = new Map(sber.map((bar) => [bar.begin, bar]));
  const sberpByTime = new Map(sberp.map((bar) => [bar.begin, bar]));
  const joined: PairBar[] = [];
  for (const [begin, first] of sberByTime) {
    const second = sberpByTime.get(begin);
    if (!second) continue;
    assertPrice(first.open);
    assertPrice(first.close);
    assertPrice(second.open);
    assertPrice(second.close);
    joined.push({ begin, sber: first, sberp: second, spread: Math.log(second.close / first.close) });
  }
  return joined.sort((a, b) => a.begin.localeCompare(b.begin));
}

function trailingZ(bars: readonly PairBar[], index: number): number | null {
  if (index < WINDOW_BARS) return null;
  const window = bars.slice(index - WINDOW_BARS, index);
  if (window.some((bar, offset) => offset > 0 && nextTenMinute(window[offset - 1]!.begin) !== bar.begin)) return null;
  const mean = window.reduce((sum, bar) => sum + bar.spread, 0) / WINDOW_BARS;
  const variance = window.reduce((sum, bar) => sum + (bar.spread - mean) ** 2, 0) / WINDOW_BARS;
  const standardDeviation = Math.sqrt(variance);
  if (standardDeviation === 0) return null;
  return (bars[index]!.spread - mean) / standardDeviation;
}

function legNetReturn(direction: 1 | -1, entry: number, exit: number, costs: PairCosts): number {
  const adverseEntry = entry * (1 + direction * costs.slippagePerSide);
  const adverseExit = exit * (1 - direction * costs.slippagePerSide);
  const directionalGross = direction * (adverseExit / adverseEntry - 1);
  const commission = costs.commissionPerSide * (adverseEntry + adverseExit) / entry;
  return directionalGross - commission;
}

function makeTrade(
  date: string,
  entryBar: PairBar,
  exitBar: PairBar,
  side: PairTrade['side'],
  exitReason: PairTrade['exitReason'],
): PairTrade {
  const sberpDirection: 1 | -1 = side === 'long_sberp_short_sber' ? 1 : -1;
  const sberDirection: 1 | -1 = side === 'long_sberp_short_sber' ? -1 : 1;
  const grossReturn = (sberpDirection * (exitBar.sberp.open / entryBar.sberp.open - 1) +
    sberDirection * (exitBar.sber.open / entryBar.sber.open - 1)) / 2;
  const net = (costs: PairCosts) => (legNetReturn(sberpDirection, entryBar.sberp.open, exitBar.sberp.open, costs) +
    legNetReturn(sberDirection, entryBar.sber.open, exitBar.sber.open, costs)) / 2;
  return {
    date,
    entryTime: entryBar.begin,
    exitTime: exitBar.begin,
    side,
    entrySber: entryBar.sber.open,
    entrySberp: entryBar.sberp.open,
    exitSber: exitBar.sber.open,
    exitSberp: exitBar.sberp.open,
    exitReason,
    grossReturn,
    baseNetReturn: net(BASE_PAIR_COSTS),
    stressNetReturn: net(STRESS_PAIR_COSTS),
  };
}

export function evaluatePairDay(date: string, bars: readonly PairBar[]): PairDayResult {
  const sorted = [...bars].sort((a, b) => a.begin.localeCompare(b.begin));
  const attempts: PairAttempt[] = [];
  let index = WINDOW_BARS;
  while (index < sorted.length) {
    const bar = sorted[index]!;
    if (bar.begin.slice(0, 10) !== date) { index += 1; continue; }
    const minute = minuteOfDay(bar.begin);
    if (minute < ENTRY_FROM_MINUTE || minute > ENTRY_TO_MINUTE) { index += 1; continue; }
    const zScore = trailingZ(sorted, index);
    if (zScore === null || Math.abs(zScore) < ENTRY_Z) { index += 1; continue; }

    const entryTime = nextTenMinute(bar.begin);
    const entryIndex = index + 1;
    const entryBar = sorted[entryIndex];
    if (!entryBar || entryBar.begin !== entryTime || entryBar.begin.slice(0, 10) !== date) {
      attempts.push({ date, signalTime: bar.begin, zScore, status: 'cancelled_entry' });
      index = entryIndex + 1;
      continue;
    }

    const side: PairTrade['side'] = zScore < 0 ? 'long_sberp_short_sber' : 'short_sberp_long_sber';
    let finished = false;
    for (let holding = 0; holding < MAX_HOLDING_BARS; holding += 1) {
      const markIndex = entryIndex + holding;
      const markBar = sorted[markIndex];
      if (!markBar || markBar.begin.slice(0, 10) !== date) break;
      const holdingZ = trailingZ(sorted, markIndex);
      const reason = holdingZ !== null && Math.abs(holdingZ) <= EXIT_Z ? 'reversion'
        : holdingZ !== null && Math.abs(holdingZ) >= STOP_Z ? 'adverse_expansion'
          : holding === MAX_HOLDING_BARS - 1 ? 'time' : null;
      if (!reason) continue;
      const expectedExitTime = nextTenMinute(markBar.begin);
      const exitBar = sorted[markIndex + 1];
      if (!exitBar || exitBar.begin !== expectedExitTime || exitBar.begin.slice(0, 10) !== date) {
        attempts.push({ date, signalTime: bar.begin, zScore, status: 'unresolved_exit' });
      } else {
        const trade = makeTrade(date, entryBar, exitBar, side, reason);
        attempts.push({ date, signalTime: bar.begin, zScore, status: 'trade', trade });
      }
      index = markIndex + 2;
      finished = true;
      break;
    }
    if (!finished) {
      attempts.push({ date, signalTime: bar.begin, zScore, status: 'unresolved_exit' });
      index = entryIndex + MAX_HOLDING_BARS + 1;
    }
  }
  return { date, synchronizedBars: sorted, attempts };
}
