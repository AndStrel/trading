import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { TInvestClient } from '../tbank/client.js';
import { IntradayScanner } from './intraday-scanner.js';

const temporaryDirectories: string[] = [];

function quotation(value: number) {
  return { units: String(Math.trunc(value)), nano: Math.round((value % 1) * 1_000_000_000) };
}

function candles() {
  return {
    candles: Array.from({ length: 60 }, (_, index) => {
      const close = 100 + index * 0.1;
      return {
        open: quotation(close - 0.1),
        high: quotation(close + 0.2),
        low: quotation(close - 0.2),
        close: quotation(close),
        volume: index === 59 ? '200' : '100',
        time: new Date(Date.UTC(2026, 8, 14, 8, index * 5)).toISOString(),
        isComplete: true,
      };
    }),
  };
}

function createJournal() {
  const directory = mkdtempSync(join(tmpdir(), 'andstrel-scanner-'));
  temporaryDirectories.push(directory);
  return new ScenarioJournal(join(directory, 'journal.sqlite'));
}

const scanAt = '2026-09-14T13:00:00.000Z';

function marketBook(time = scanAt, instrumentUid = 'sber', ask = 106.01) {
  return { instrumentUid, orderbookTs: time, isConsistent: true,
    bids: [{ price: quotation(ask - 0.01), quantity: '1000' }],
    asks: [{ price: quotation(ask), quantity: '1000' }] };
}

function scannerFixture(env: NodeJS.ProcessEnv = {}) {
  const config = loadConfig({ T_INVEST_LIVE_PILOT_PREPARE: 'false', T_INVEST_COMMISSION_RATE: '0.0005',
    T_INVEST_TOKEN: 'fixture-token', T_INVEST_INTRADAY_UNIVERSE: 'watchlist',
    T_INVEST_SCANNER_MIN_AVERAGE_CANDLE_TURNOVER_RUB: '1000',
    INTRADAY_MAX_POSITION_RUB: '500', INTRADAY_MAX_RISK_RUB: '20',
    T_INVEST_INTRADAY_WATCHLIST: '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]', ...env });
  const client = {
    getShares: vi.fn(async () => ({ instruments: [{ uid: 'sber', figi: 'BBG004730N88' }] })),
    getCandles: vi.fn(async (_request:Parameters<TInvestClient['getCandles']>[0]) => candles()),
    getOrderBook: vi.fn(async () => marketBook()),
    getLastPrices: vi.fn(async () => ({ lastPrices: [{ instrumentUid: 'sber', time: scanAt, price: quotation(106.01) }] })),
    getTradingStatus: vi.fn(async () => ({ instrumentUid: 'sber', tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
      apiTradeAvailableFlag: true, limitOrderAvailableFlag: true })),
  };
  const journal = createJournal();
  const log = vi.fn();
  const scanner = new IntradayScanner(config, client as unknown as TInvestClient, journal, log);
  return { config, client, journal, scanner, log };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function shiftCandleTimes(payload:ReturnType<typeof candles>, latest:string) {
  const shift=Date.parse(latest)-Date.parse(payload.candles.at(-1)!.time);
  return {candles:payload.candles.map(candle=>({...candle,time:new Date(Date.parse(candle.time)+shift).toISOString()}))};
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('IntradayScanner', () => {
  it('records one candidate from a qualifying long setup and then applies cooldown', async () => {
    const config = loadConfig({
      // Legacy low-cost fixture proves scanner/cooldown mechanics, not pilot admission.
      T_INVEST_LIVE_PILOT_PREPARE: 'false',
      T_INVEST_COMMISSION_RATE: '0.0005',
      T_INVEST_TOKEN: 'test-token',
      T_INVEST_INTRADAY_UNIVERSE: 'watchlist',
      T_INVEST_SCANNER_MIN_AVERAGE_CANDLE_TURNOVER_RUB: '1000',
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01}]',
    });
    const client = {
      getShares: async () => ({ instruments: [{ uid: 'sber', figi: 'BBG004730N88' }] }),
      getCandles: async () => candles(),
      getOrderBook: async () => ({
        instrumentUid:'sber', orderbookTs:'2026-09-14T13:00:00.000Z',
        isConsistent: true,
        bids: [{ price: quotation(106), quantity: '1000' }],
        asks: [{ price: quotation(106.01), quantity: '1000' }],
      }),
      getLastPrices: async () => ({ lastPrices: [{ instrumentUid:'sber', time:'2026-09-14T13:00:00.000Z', price: quotation(106.01) }] }),
      getTradingStatus: async () => ({
        instrumentUid:'sber',
        tradingStatus: 'SECURITY_TRADING_STATUS_NORMAL_TRADING',
        apiTradeAvailableFlag: true,
        limitOrderAvailableFlag: true,
      }),
    } as unknown as TInvestClient;
    const journal = createJournal();
    const scanner = new IntradayScanner(config, client, journal, () => undefined);
    const now = new Date('2026-09-14T13:00:00.000Z');

    const first = await scanner.scanOnce(now);
    // A new scanner pass needs fresh executable quotes, not the first pass's book.
    client.getOrderBook = async () => ({instrumentUid:'sber',orderbookTs:'2026-09-14T13:05:00.000Z',isConsistent:true,
      bids:[{price:quotation(106),quantity:'1000'}],asks:[{price:quotation(106.01),quantity:'1000'}]});
    client.getLastPrices = async () => ({lastPrices:[{instrumentUid:'sber',time:'2026-09-14T13:05:00.000Z',price:quotation(106.01)}]});
    const second = await scanner.scanOnce(new Date('2026-09-14T13:05:00.000Z'));

    expect(first[0]).toMatchObject({ status: 'candidate-recorded', instrumentId: 'sber' });
    expect(second[0]).toMatchObject({ status: 'candidate-suppressed', instrumentId: 'sber' });
    expect(journal.list(10, 'intraday')).toHaveLength(1);
    expect(scanner.getLatestReport()).toMatchObject({
      scanned: 1,
      liquid: 1,
      trendUp: 1,
      volumeConfirmed: 1,
      marketCandidates: 1,
      recordedCandidates: 0,
      topRanked: [expect.objectContaining({ ticker: 'SBER', candidateReady: true })],
    });
  });

  it.each(['candles', 'order-book'])('discards an old strategy after selection switches during awaited %s', async stage => {
    const fixture = scannerFixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    if (stage === 'candles') fixture.client.getCandles.mockImplementation(async () => {
      entered.resolve(); await release.promise; return candles();
    });
    else fixture.client.getOrderBook.mockImplementation(async () => {
      entered.resolve(); await release.promise; return marketBook();
    });
    const listener = vi.fn();
    fixture.scanner.addEventListener(listener);
    const scan = fixture.scanner.scanOnce(new Date(scanAt));
    await entered.promise;
    fixture.scanner.selectTradingStrategy('vwap-reclaim-v1', fixture.scanner.getTradingSelection().revision);
    release.resolve();
    expect(await scan).toEqual([]);
    expect(fixture.journal.list(10)).toEqual([]);
    expect(fixture.scanner.getLatestReport()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(fixture.log).not.toHaveBeenCalled();
    expect(fixture.scanner.getTradingSelection().strategyId).toBe('vwap-reclaim-v1');
  });

  it('does not launch a duplicate scan while the first candle request is unresolved', async () => {
    const fixture = scannerFixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    fixture.client.getCandles.mockImplementation(async () => { entered.resolve(); await release.promise; return candles(); });
    const first = fixture.scanner.scanOnce(new Date(scanAt));
    await entered.promise;
    expect(await fixture.scanner.scanOnce(new Date(scanAt))).toEqual([]);
    expect(fixture.client.getShares).toHaveBeenCalledTimes(1);
    expect(fixture.client.getCandles).toHaveBeenCalledTimes(1);
    release.resolve();
    expect(await first).toEqual([expect.objectContaining({ status: 'candidate-recorded' })]);
    expect(fixture.journal.list(10)).toHaveLength(1);
  });

  it('accepts genuinely fresh quotes after the universe request consumed time', async () => {
    const fixture = scannerFixture();
    let elapsed = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    try {
      fixture.client.getShares.mockImplementation(async () => {
        elapsed = 2000;
        return { instruments: [{ uid: 'sber', figi: 'BBG004730N88' }] };
      });
      const quoteAt = '2026-09-14T13:00:02.000Z';
      fixture.client.getOrderBook.mockResolvedValue(marketBook(quoteAt));
      fixture.client.getLastPrices.mockResolvedValue({ lastPrices: [{ instrumentUid: 'sber', time: quoteAt, price: quotation(106.01) }] });
      expect(await fixture.scanner.scanOnce(new Date(scanAt))).toEqual([expect.objectContaining({ status: 'candidate-recorded' })]);
      expect(fixture.scanner.getLatestReport()!.recommendations[0]!.status).toBe('signal');
    } finally { clock.mockRestore(); }
  });

  it.each(['candles','order-book','last-price','status'])('does not admit a signal across 16:40 after delayed %s', async stage => {
    const fixture=scannerFixture();
    const scanTime='2026-09-14T13:39:59.000Z';
    const quoteTime='2026-09-14T13:40:01.000Z';
    let elapsed=0;
    const clock=vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
    try {
      fixture.client.getCandles.mockImplementation(async()=>{
        if(stage==='candles') elapsed=2000;
        return shiftCandleTimes(candles(),'2026-09-14T13:30:00.000Z');
      });
      fixture.client.getOrderBook.mockImplementation(async()=>{
        if(stage==='order-book') elapsed=2000;
        return marketBook(quoteTime);
      });
      fixture.client.getLastPrices.mockImplementation(async()=>{
        if(stage==='last-price') elapsed=2000;
        return {lastPrices:[{instrumentUid:'sber',time:quoteTime,price:quotation(106.01)}]};
      });
      const status=await fixture.client.getTradingStatus();
      fixture.client.getTradingStatus.mockImplementation(async()=>{
        if(stage==='status') elapsed=2000;
        return status;
      });
      const events=await fixture.scanner.scanOnce(new Date(scanTime));
      expect(events).toEqual([expect.objectContaining({status:'skipped'})]);
      expect(fixture.journal.list(10)).toEqual([]);
      const report=fixture.scanner.getLatestReport()!;
      expect(report.recommendations[0]!.status).not.toBe('signal');
      expect(report.recommendations[0]!.reasons.join(' ')).toContain('Вне настроенного окна');
      expect(report.topRanked[0]!.candidateReady).toBe(false);
    } finally {clock.mockRestore();}
  });

  it.each(['candles','status'])('expires the 150-minute ORB window after delayed %s', async stage=>{
    const fixture=scannerFixture({T_INVEST_TRADING_STRATEGY_ID:'opening-range-breakout-v1'});
    const scanTime='2026-09-14T08:39:59.000Z';
    const quoteTime='2026-09-14T08:40:01.000Z';
    const reference=Date.parse('2026-09-14T06:10:00.000Z');
    const payload={candles:Array.from({length:43},(_,index)=>{
      const close=index===42?102:100;
      return {time:new Date(reference+(index-14)*5*60_000).toISOString(),open:quotation(close),
        high:quotation(close+1),low:quotation(close-1),close:quotation(close),volume:index===42?'200':'100',isComplete:true};
    })};
    let elapsed=0;
    const clock=vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
    try {
      fixture.client.getCandles.mockImplementation(async()=>{if(stage==='candles')elapsed=2000;return payload;});
      fixture.client.getOrderBook.mockResolvedValue(marketBook(quoteTime,'sber',102.01));
      fixture.client.getLastPrices.mockResolvedValue({lastPrices:[{instrumentUid:'sber',time:quoteTime,price:quotation(102.01)}]});
      const status=await fixture.client.getTradingStatus();
      fixture.client.getTradingStatus.mockImplementation(async()=>{if(stage==='status')elapsed=2000;return status;});
      await fixture.scanner.scanOnce(new Date(scanTime));
      expect(fixture.journal.list(10)).toEqual([]);
      expect(fixture.scanner.getLatestReport()!.recommendations[0]!.reasons.join(' ')).toMatch(/Окно первого пробоя завершено|Вне настроенного окна/);
      expect(fixture.scanner.getLatestReport()!.topRanked[0]!.candidateReady).toBe(false);
    } finally {clock.mockRestore();}
  });

  it.each(['candles','last-price'])('rechecks the ten-minute closed-candle lifetime after delayed %s',async stage=>{
    const fixture=scannerFixture();
    const scanTime='2026-09-14T13:09:59.000Z';
    const quoteTime='2026-09-14T13:10:01.000Z';
    let elapsed=0;
    const clock=vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
    try {
      fixture.client.getCandles.mockImplementation(async()=>{if(stage==='candles')elapsed=2000;return candles();});
      fixture.client.getOrderBook.mockResolvedValue(marketBook(quoteTime));
      fixture.client.getLastPrices.mockImplementation(async()=>{
        if(stage==='last-price')elapsed=2000;
        return {lastPrices:[{instrumentUid:'sber',time:quoteTime,price:quotation(106.01)}]};
      });
      await fixture.scanner.scanOnce(new Date(scanTime));
      expect(fixture.journal.list(10)).toEqual([]);
      expect(fixture.scanner.getLatestReport()!.recommendations[0]!).toMatchObject({status:'blocked',entryPrice:null});
      expect(fixture.scanner.getLatestReport()!.recommendations[0]!.reasons.join(' ')).toContain('старше 10 минут');
    } finally {clock.mockRestore();}
  });

  it.each(['cutoff','candle-lifetime','quote-lifetime'])('rechecks %s before publishing an earlier worker in a delayed batch',async boundary=>{
    const fixture=scannerFixture({T_INVEST_SCANNER_MAX_CONCURRENT_REQUESTS:'1',
      T_INVEST_INTRADAY_WATCHLIST:'[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01},{"instrumentId":"vtbr","label":"VTBR","lotSize":1,"priceStep":0.01}]'});
    const scanTime=boundary==='cutoff'?'2026-09-14T13:39:59.000Z'
      :boundary==='candle-lifetime'?'2026-09-14T13:09:59.000Z':scanAt;
    const firstPayload=boundary==='cutoff'?shiftCandleTimes(candles(),'2026-09-14T13:30:00.000Z'):candles();
    let elapsed=0;
    const clock=vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
    try {
      fixture.client.getShares.mockResolvedValue({instruments:[{uid:'sber',figi:'BBG004730N88'},{uid:'vtbr',figi:'FIXTURE-VTBR'}]});
      fixture.client.getCandles.mockImplementation(async request=>{
        if(request.instrumentId==='sber') return firstPayload;
        elapsed=boundary==='quote-lifetime'?31_000:2000;
        return {candles:[]};
      });
      fixture.client.getOrderBook.mockResolvedValue(marketBook(scanTime));
      fixture.client.getLastPrices.mockResolvedValue({lastPrices:[{instrumentUid:'sber',time:scanTime,price:quotation(106.01)}]});
      const events=await fixture.scanner.scanOnce(new Date(scanTime));
      expect(events.every(event=>event.status!=='candidate-recorded')).toBe(true);
      expect(fixture.journal.list(10)).toEqual([]);
      const report=fixture.scanner.getLatestReport()!;
      expect(report).toMatchObject({marketCandidates:0,recordedCandidates:0});
      expect(report.recommendations.find(item=>item.ticker==='SBER')).toMatchObject({status:'blocked',entryPrice:null,stopPrice:null,targetPrice:null});
      expect(report.topRanked.find(item=>item.ticker==='SBER')!.candidateReady).toBe(false);
      expect(report.recommendations.find(item=>item.ticker==='SBER')!.reasons.join(' ')).toMatch(
        boundary==='cutoff'?/Вне настроенного окна/:boundary==='candle-lifetime'?/старше 10 минут/:/Свежесть/);
    } finally {clock.mockRestore();}
  });

  it.each(['stale-book', 'foreign-book', 'stale-last', 'foreign-last', 'insufficient-ask'])(
    'blocks %s quotes and does not leave the instrument marked ready', async kind => {
      const fixture = scannerFixture();
      if (kind === 'stale-book') fixture.client.getOrderBook.mockResolvedValue(marketBook('2026-09-14T12:59:00.000Z'));
      if (kind === 'foreign-book') fixture.client.getOrderBook.mockResolvedValue(marketBook(scanAt, 'another-instrument'));
      if (kind === 'stale-last') fixture.client.getLastPrices.mockResolvedValue({ lastPrices: [{ instrumentUid: 'sber', time: '2026-09-14T12:58:00.000Z', price: quotation(106.01) }] });
      if (kind === 'foreign-last') fixture.client.getLastPrices.mockResolvedValue({ lastPrices: [{ instrumentUid: 'another-instrument', time: scanAt, price: quotation(106.01) }] });
      if (kind === 'insufficient-ask') {
        const book = marketBook(); book.asks[0]!.quantity = '1'; fixture.client.getOrderBook.mockResolvedValue(book);
      }
      const events = await fixture.scanner.scanOnce(new Date(scanAt));
      expect(events).toEqual([expect.objectContaining({ status: 'skipped' })]);
      expect(fixture.journal.list(10)).toEqual([]);
      expect(fixture.scanner.getLatestReport()).toMatchObject({ marketCandidates: 0, recordedCandidates: 0,
        topRanked: [expect.objectContaining({ ticker: 'SBER', candidateReady: false })],
        recommendations: [expect.objectContaining({ ticker: 'SBER', status: 'blocked' })] });
    },
  );

  it('explains why an otherwise qualifying whole lot does not fit the capital limit', async () => {
    const fixture = scannerFixture({ INTRADAY_MAX_POSITION_RUB: '50' });
    await fixture.scanner.scanOnce(new Date(scanAt));
    const report = fixture.scanner.getLatestReport()!;
    expect(report.recommendations[0]).toMatchObject({ status: 'blocked', lotCostRub: 106.01 });
    expect(report.recommendations[0]!.reasons.join(' ')).toContain('No whole lot fits');
    expect(report.topRanked[0]!.candidateReady).toBe(false);
    expect(fixture.journal.list(10)).toEqual([]);
  });

  it('reports the cost barrier without manufacturing a distant target or recording a signal', async () => {
    const fixture = scannerFixture({ T_INVEST_COMMISSION_RATE: '0.1' });
    await fixture.scanner.scanOnce(new Date(scanAt));
    const report = fixture.scanner.getLatestReport()!;
    expect(report.recommendations[0]!.status).not.toBe('signal');
    expect(report.recommendations[0]!.targetPrice).toBeNull();
    expect(report.recommendations[0]!.reasons.join(' ')).toMatch(/расход|cost/i);
    expect(report.topRanked[0]!.candidateReady).toBe(false);
    expect(fixture.journal.list(10)).toEqual([]);
  });

  it('keeps a selected but unavailable asset visible with a blocked recommendation', async () => {
    const fixture = scannerFixture({ T_INVEST_INTRADAY_WATCHLIST: '[{"instrumentId":"sber","label":"SBER","lotSize":1,"priceStep":0.01},{"instrumentId":"vtbr","label":"VTBR","lotSize":1,"priceStep":0.001}]' });
    await fixture.scanner.scanOnce(new Date(scanAt));
    const report = fixture.scanner.getLatestReport()!;
    expect(report.recommendations).toEqual([
      expect.objectContaining({ ticker: 'SBER', status: 'signal' }),
      expect.objectContaining({ ticker: 'VTBR', status: 'blocked', entryPrice: null }),
    ]);
    expect(report.recommendations[1]!.reasons.join(' ')).toContain('недоступен');
    expect(fixture.client.getCandles).toHaveBeenCalledTimes(1);
  });

  it('includes blocked recommendations even if all selected assets are unavailable', async () => {
    const fixture = scannerFixture();
    fixture.client.getShares.mockResolvedValue({ instruments: [] });
    await fixture.scanner.scanOnce(new Date(scanAt));
    expect(fixture.scanner.getLatestReport()).toMatchObject({ scanned: 0, marketCandidates: 0,
      recommendations: [expect.objectContaining({ ticker: 'SBER', status: 'blocked' })] });
    expect(fixture.client.getCandles).not.toHaveBeenCalled();
  });

  it.each(['universe', 'instrument'])('does not expose arbitrary %s broker errors in events or reports', async source => {
    const fixture = scannerFixture();
    const secret = 'arbitrary-broker-secret-and-account';
    if (source === 'universe') fixture.client.getShares.mockRejectedValue(new Error(secret));
    else fixture.client.getCandles.mockRejectedValue(new Error(secret));
    const events = await fixture.scanner.scanOnce(new Date(scanAt));
    expect(events[0]!.status).toBe('error');
    expect(JSON.stringify({ events, report: fixture.scanner.getLatestReport(), log: fixture.log.mock.calls })).not.toContain(secret);
    expect(fixture.journal.list(10)).toEqual([]);
  });

  it('records a VWAP reclaim with 21 valid reference-session bars without requiring an unrelated 50-bar trend', async () => {
    const fixture = scannerFixture({ T_INVEST_TRADING_STRATEGY_ID: 'vwap-reclaim-v1' });
    const reference = Date.parse('2026-09-14T06:10:00.000Z');
    const now = '2026-09-14T07:55:00.000Z';
    fixture.client.getCandles.mockResolvedValue({ candles: Array.from({ length: 21 }, (_, index) => {
      const close = index === 19 ? 99 : index === 20 ? 101 : 100;
      return { time: new Date(reference + index * 5 * 60_000).toISOString(), open: quotation(close),
        high: quotation(close + 1), low: quotation(close - 1), close: quotation(close),
        volume: index === 20 ? '200' : '100', isComplete: true };
    }) });
    fixture.client.getOrderBook.mockResolvedValue(marketBook(now, 'sber', 101.01));
    fixture.client.getLastPrices.mockResolvedValue({ lastPrices: [{ instrumentUid: 'sber', time: now, price: quotation(101.01) }] });
    expect(await fixture.scanner.scanOnce(new Date(now))).toEqual([expect.objectContaining({ status: 'candidate-recorded' })]);
    const report = fixture.scanner.getLatestReport()!;
    expect(report.recommendations[0]).toMatchObject({ status: 'signal', ticker: 'SBER' });
    expect(fixture.journal.list(10)[0]!.snapshot).toMatchObject({ tradingStrategy: { id: 'vwap-reclaim-v1', version: '1', referenceStartMinutes:550 } });
  });
});
