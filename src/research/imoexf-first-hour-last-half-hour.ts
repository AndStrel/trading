export type MoexMinuteCandle = {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  begin: string;
};

export type SessionWindows = {
  signalStart: string;
  signalEnd: string;
  exitStart: string;
  exitEnd: string;
};

export type ScoredTrade = {
  direction: 'long' | 'short';
  signalReturn: number;
  entryReference: number;
  exitReference: number;
  entryExecution: number;
  exitExecution: number;
  grossRub: number;
  brokerCommissionRub: number;
  exchangeFeeRub: number;
  netRub: number;
  netReturn: number;
};

const TICK = 0.5;
const RUB_PER_POINT = 10;
const BROKER_RATE = 0.001;
const MOEX_FEE_PER_SIDE = 1.5;
const EXPECTED_COLUMNS = ['open', 'close', 'high', 'low', 'value', 'volume', 'begin', 'end'];

export function sessionWindows(date: string): SessionWindows {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date ${date}`);
  const start = date >= '2026-09-14' ? '09:00' : '10:00';
  const [startHour] = start.split(':').map(Number);
  const signalEnd = `${String(startHour).padStart(2, '0')}:59`;
  if (date < '2026-03-23') {
    return { signalStart: start, signalEnd, exitStart: '18:15', exitEnd: '18:44' };
  }
  return { signalStart: start, signalEnd, exitStart: '18:30', exitEnd: '18:59' };
}

export function parseMoexCandles(body: string): MoexMinuteCandle[] {
  let json: unknown;
  try { json = JSON.parse(body); } catch { throw new Error('Invalid MOEX ISS JSON'); }
  if (!json || typeof json !== 'object' || !('candles' in json)) throw new Error('MOEX ISS response has no candles table');
  const table = (json as { candles?: { columns?: unknown; data?: unknown } }).candles;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.data)) throw new Error('Malformed MOEX candles table');
  const columns = table.columns as unknown[];
  for (const column of EXPECTED_COLUMNS) if (!columns.includes(column)) throw new Error(`Missing MOEX candle column ${column}`);
  const index = Object.fromEntries(EXPECTED_COLUMNS.map((column) => [column, columns.indexOf(column)])) as Record<string, number>;
  return table.data.map((raw, rowIndex) => {
    if (!Array.isArray(raw)) throw new Error(`Malformed MOEX candle row ${rowIndex}`);
    const value = (name: string): unknown => {
      const columnIndex = index[name];
      if (columnIndex === undefined) throw new Error(`Missing MOEX candle column ${name}`);
      return raw[columnIndex];
    };
    const open = value('open'); const close = value('close'); const high = value('high');
    const low = value('low'); const volume = value('volume'); const begin = value('begin');
    if (![open, close, high, low, volume].every((item) => typeof item === 'number' && Number.isFinite(item))) {
      throw new Error(`Non-numeric MOEX candle row ${rowIndex}`);
    }
    if (typeof begin !== 'string') throw new Error(`Invalid MOEX candle timestamp ${rowIndex}`);
    return { open: open as number, close: close as number, high: high as number, low: low as number,
      volume: volume as number, begin };
  });
}

function minuteOfDay(begin: string, date: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):00$/.exec(begin);
  if (!match || match[1] !== date) return null;
  return Number(match[2]) * 60 + Number(match[3]);
}

function onTick(price: number, tickSize: number): boolean {
  return price > 0 && Math.abs(price / tickSize - Math.round(price / tickSize)) < 1e-8;
}

export function validateWindow(candles: MoexMinuteCandle[], date: string, start: string, end: string, tickSize = TICK): boolean {
  if (!Number.isFinite(tickSize) || tickSize <= 0) throw new Error('Invalid candle tick size');
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const first = startHour! * 60 + startMinute!;
  const last = endHour! * 60 + endMinute!;
  const expectedCount = last - first + 1;
  if (expectedCount <= 0 || candles.length !== expectedCount) return false;
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i]!;
    if (minuteOfDay(candle.begin, date) !== first + i || candle.volume <= 0) return false;
    if (![candle.open, candle.close, candle.high, candle.low].every((price) => onTick(price, tickSize))) return false;
    if (candle.low > Math.min(candle.open, candle.close) || candle.high < Math.max(candle.open, candle.close) || candle.low > candle.high) return false;
  }
  return true;
}

export function signalReturn(signalCandles: MoexMinuteCandle[]): number {
  if (signalCandles.length === 0 || signalCandles[0]!.open <= 0) throw new Error('Signal window is empty or invalid');
  return signalCandles.at(-1)!.close / signalCandles[0]!.open - 1;
}

export function scoreTrade(
  signalCandles: MoexMinuteCandle[], exitCandles: MoexMinuteCandle[], adverseTicksPerSide: 1 | 2,
): ScoredTrade {
  const signal = signalReturn(signalCandles);
  if (signal === 0) throw new Error('Zero signal must remain in cash');
  if (exitCandles.length === 0) throw new Error('Exit window is empty');
  const direction = signal > 0 ? 1 : -1;
  const entryReference = exitCandles[0]!.open;
  const exitReference = exitCandles.at(-1)!.close;
  const adversePoints = adverseTicksPerSide * TICK;
  const entryExecution = entryReference + (direction * adversePoints);
  const exitExecution = exitReference - (direction * adversePoints);
  const grossRub = (exitExecution - entryExecution) * direction * RUB_PER_POINT;
  const brokerCommissionRub = (Math.abs(entryExecution) + Math.abs(exitExecution)) * RUB_PER_POINT * BROKER_RATE;
  const exchangeFeeRub = 2 * MOEX_FEE_PER_SIDE;
  const netRub = grossRub - brokerCommissionRub - exchangeFeeRub;
  const notional = entryReference * RUB_PER_POINT;
  return {
    direction: direction > 0 ? 'long' : 'short', signalReturn: signal,
    entryReference, exitReference, entryExecution, exitExecution, grossRub,
    brokerCommissionRub, exchangeFeeRub, netRub, netReturn: netRub / notional,
  };
}

export function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day >= 1 && day <= 5;
}
