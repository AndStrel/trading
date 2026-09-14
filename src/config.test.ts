import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses conservative scenario guardrails by default', () => {
    const config = loadConfig({});

    expect(config.journalPath).toBe('.trading/journal.sqlite');
    expect(config.scanner.intervalSeconds).toBe(300);
    expect(config.scanner.slippageRate).toBe(0.0005);
    expect(config.scanner.intradayWatchlist).toEqual([]);
    expect(config.strategies.intraday.maxSpreadPct).toBe(0.3);
    expect(config.strategies.intraday.maxEntryDeviationPct).toBe(0.5);
    expect(config.strategies.intraday.allowShort).toBe(false);
    expect(config.strategies.swing.maxSpreadPct).toBe(0.5);
    expect(config.strategies.swing.maxEntryDeviationPct).toBe(1);
    expect(config.strategies.swing.allowShort).toBe(false);
  });

  it('parses an explicit intraday scanner watchlist', () => {
    const config = loadConfig({
      T_INVEST_INTRADAY_WATCHLIST:
        '[{"instrumentId":"e6123145-9665-43e0-8413-cd61b8aa9b13","lotSize":1,"priceStep":0.01}]',
    });

    expect(config.scanner.intradayWatchlist).toEqual([
      { instrumentId: 'e6123145-9665-43e0-8413-cd61b8aa9b13', lotSize: 1, priceStep: 0.01 },
    ]);
  });

  it('requires an explicit configuration value to enable short scenarios', () => {
    const config = loadConfig({
      INTRADAY_ALLOW_SHORT: 'true',
      SWING_ALLOW_SHORT: 'false',
    });

    expect(config.strategies.intraday.allowShort).toBe(true);
    expect(config.strategies.swing.allowShort).toBe(false);
  });
});
