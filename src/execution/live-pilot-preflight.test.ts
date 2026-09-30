import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../config.js';
import { LivePilotPreflight } from './live-pilot-preflight.js';

const config = loadConfig({ T_INVEST_LIVE_TOKEN: 'live-secret', T_INVEST_LIVE_ACCOUNT_ID: 'daily-private-id' });
function broker() {
  return {
    getAccounts: vi.fn().mockResolvedValue({ accounts: [{ id: 'daily-private-id', status: 'ACCOUNT_STATUS_OPEN', accessLevel: 'ACCOUNT_ACCESS_LEVEL_FULL_ACCESS', type: 'ACCOUNT_TYPE_TINKOFF' }] }),
    getUserInfo: vi.fn().mockResolvedValue({ tariff: 'investor', userId: 'private-user' }),
    getPositions: vi.fn().mockResolvedValue({ accountId: 'daily-private-id', money: [{ currency: 'rub', units: '1000', nano: 0 }], blocked: [], securities: [], futures: [], options: [], limitsLoadingInProgress: false }),
    getOrders: vi.fn().mockResolvedValue({ orders: [] }),
    getStopOrders: vi.fn().mockResolvedValue({ stopOrders: [] }),
  };
}
describe('daily live preparation readiness', () => {
  it('never marks live submission ready even when the account checks pass', async () => {
    const report = await new LivePilotPreflight(config, broker()).check();
    expect(report).toMatchObject({ liveSubmissionAllowed: false, accountChecksPassed: true, availableCashRub: 1000 });
    expect(report.blockers).toHaveLength(1);
    expect(report.blockers[0]).toContain('sandbox');
    expect(JSON.stringify(report)).not.toContain('private');
    expect(JSON.stringify(report)).not.toContain('secret');
  });
  it('does not call the broker without separate configuration', async () => {
    const client = broker();
    const report = await new LivePilotPreflight(loadConfig({}), client).check();
    expect(report.accountChecksPassed).toBe(false);
    expect(client.getAccounts).not.toHaveBeenCalled();
  });
  it.each([
    { money: [] }, { money: [{ currency: 'rub', units: '999', nano: 0 }] },
    { blocked: [{ currency: 'rub', units: '1', nano: 0 }] },
    { securities: [{}] }, { futures: [{}] }, { options: [{}] },
    { limitsLoadingInProgress: true }, { accountId: 'wrong-account' },
    { money: [{ currency: 'rub', units: '-10', nano: 0 }] },
    { money: [{ currency: 'rub', units: '1000', nano: 0 }, { currency: 'usd', units: '1', nano: 0 }] },
  ])('does not accept unsafe positions %j', async change => {
    const client = broker();
    const valid = await client.getPositions();
    client.getPositions.mockResolvedValue({ ...valid, ...change });
    const report = await new LivePilotPreflight(config, client).check();
    expect(report.accountChecksPassed).toBe(false);
    expect(report.liveSubmissionAllowed).toBe(false);
  });
  it('blocks active orders and stops', async () => {
    const client = broker();
    client.getStopOrders.mockResolvedValue({ stopOrders: [{ stopOrderId: 'private-stop' }] });
    const report = await new LivePilotPreflight(config, client).check();
    expect(report.accountChecksPassed).toBe(false);
    expect(report.blockers.join(';')).toContain('активные');
  });
  it('redacts error contents and fails closed on malformed snapshots', async () => {
    const client = broker();
    client.getAccounts.mockRejectedValue(new Error('private account live-secret'));
    const report = await new LivePilotPreflight(config, client).check();
    expect(report.accountChecksPassed).toBe(false);
    expect(JSON.stringify(report)).not.toContain('private');
    expect(JSON.stringify(report)).not.toContain('secret');
    client.getAccounts.mockResolvedValue({});
    expect((await new LivePilotPreflight(config, client).check()).accountChecksPassed).toBe(false);
  });
});
