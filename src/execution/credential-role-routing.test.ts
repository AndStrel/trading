import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { TInvestClient } from '../tbank/client.js';
import { LivePreflightClient, liveProductionEndpoint } from './live-preflight-client.js';
import { TInvestOrderClient } from './tinvest-order-client.js';

function responses() {
  return vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"accounts":[]}'));
}

describe('resolved credential routing to broker clients', () => {
  it('sends each isolated role only through its intended read surface', async () => {
    const config = loadConfig({
      T_INVEST_TOKEN: 'synthetic-read',
      T_INVEST_TRADING_TOKEN: 'synthetic-production',
      T_INVEST_TRADING_TOKEN_ROLE: 'live',
      T_INVEST_SANDBOX_TOKEN: 'synthetic-sandbox',
      T_INVEST_LIVE_CAPITAL_RUB: '500',
    });
    const fetcher = responses();
    await new TInvestClient(config.token, config.baseUrl, { fetchImpl: fetcher, retryAttempts: 1 }).getAccounts();
    await new LivePreflightClient(config.livePilot.token, liveProductionEndpoint, 'fetch', fetcher).getAccounts();
    await new TInvestOrderClient(config.execution.token, config.execution.baseUrl, fetcher).getSandboxAccounts();

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), new Headers(init?.headers).get('Authorization')])).toEqual([
      [liveProductionEndpoint + '/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts', 'Bearer synthetic-read'],
      [liveProductionEndpoint + '/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts', 'Bearer synthetic-production'],
      [config.execution.baseUrl + '/tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxAccounts', 'Bearer synthetic-sandbox'],
    ]);
    expect(config.execution.mode).toBe('disabled');
  });

  it('cannot send a production credential to sandbox when its dedicated role is absent', async () => {
    const config = loadConfig({
      T_INVEST_TOKEN: 'synthetic-read',
      T_INVEST_TRADING_TOKEN: 'synthetic-production',
      T_INVEST_TRADING_TOKEN_ROLE: 'live',
    });
    const fetcher = responses();
    await expect(new TInvestOrderClient(config.execution.token, config.execution.baseUrl, fetcher)
      .getSandboxAccounts()).rejects.toThrow('Sandbox credential is not configured');
    expect(fetcher).not.toHaveBeenCalled();
    await new LivePreflightClient(config.livePilot.token, liveProductionEndpoint, 'fetch', fetcher).getAccounts();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer synthetic-production');
  });

  it('does not convert a legacy sandbox token into a production credential implicitly', async () => {
    const config = loadConfig({ T_INVEST_TRADING_TOKEN: 'synthetic-legacy-sandbox' });
    const fetcher = responses();
    await expect(new LivePreflightClient(config.livePilot.token, liveProductionEndpoint, 'fetch', fetcher)
      .getAccounts()).rejects.toThrow('Production preflight credential is not configured');
    expect(fetcher).not.toHaveBeenCalled();
    await new TInvestOrderClient(config.execution.token, config.execution.baseUrl, fetcher).getSandboxAccounts();
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer synthetic-legacy-sandbox');
  });
});
