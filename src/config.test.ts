import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses conservative scenario guardrails by default', () => {
    const config = loadConfig({});

    expect(config.strategies.intraday.maxSpreadPct).toBe(0.3);
    expect(config.strategies.intraday.maxEntryDeviationPct).toBe(0.5);
    expect(config.strategies.intraday.allowShort).toBe(false);
    expect(config.strategies.swing.maxSpreadPct).toBe(0.5);
    expect(config.strategies.swing.maxEntryDeviationPct).toBe(1);
    expect(config.strategies.swing.allowShort).toBe(false);
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
