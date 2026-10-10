import { describe, expect, it, vi, afterEach } from 'vitest';
import { checkTechnicalSandboxPreflight, claimTechnicalSandboxAttempt } from './sandbox-technical-preflight.js';
import { sandboxEndpoint } from './sandbox-prepared-account.js';

afterEach(() => vi.useRealTimers());
function fixture() {
  const prepared = { version: 1 as const, endpoint: sandboxEndpoint as typeof sandboxEndpoint, phase: 'ready' as const,
    nonce: '11111111-1111-4111-8111-111111111111', accountId: 'private-account',
    name: 'daily-pilot-11111111-1111-4111-8111-111111111111' };
  const client = { getSandboxAccounts: vi.fn(async () => [{ id: prepared.accountId, name: prepared.name }]),
    getSandboxPositions: vi.fn(async () => ({ accountId: prepared.accountId, limitsLoadingInProgress: false,
      securities: [], futures: [], options: [], blocked: [], money: [{ currency: 'rub', units: '1000', nano: 0 }] })),
    getSandboxOrders: vi.fn(async () => ({ orders: [] })), getSandboxStopOrders: vi.fn(async () => ({ stopOrders: [] as unknown[] })) };
  return { client, prepared, expectedInitialCashNano: '1000000000000', clock: () => new Date('2026-10-05T08:00:00Z') };
}
describe('Read-only technical preflight before permanent attempt', () => {
  it.each(['2026-10-03T08:00:00Z', '2026-10-04T08:00:00Z', '2026-10-05T07:04:59Z', '2026-10-05T15:00:00Z'])(
    'closed window %s performs zero requests and zero claims', async (at) => {
      const f = fixture(), claim = vi.fn(); f.clock = () => new Date(at);
      expect(await checkTechnicalSandboxPreflight(f)).toMatchObject({ ready: false, reason: 'entry-window-closed', brokerWrites: false });
      await expect(claimTechnicalSandboxAttempt(f, claim)).rejects.toThrow('no attempt was claimed');
      for (const method of Object.values(f.client)) expect(method).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
    });
  it('reads only four metadata/account methods once and then permits one local claim', async () => {
    const f = fixture(), claim = vi.fn(() => 'latched');
    expect(await claimTechnicalSandboxAttempt(f, claim)).toBe('latched');
    for (const method of Object.values(f.client)) expect(method).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
  });
  it('projects flags only and cannot reveal names, account IDs or balances', async () => {
    const report = await checkTechnicalSandboxPreflight(fixture());
    expect(report).toMatchObject({ ready: true, initialCashConfirmed: true, stopHistoryEmpty: true, liveSubmissionAllowed: false });
    const text = JSON.stringify(report);
    for (const marker of ['private-account', 'daily-pilot-', '1000000000000', '1000']) expect(text).not.toContain(marker);
  });
  it('does not erase prior cash loss, canceled stop or another account by declaring them fresh', async () => {
    const cash = fixture(); cash.client.getSandboxPositions.mockResolvedValue({ accountId: 'private-account', limitsLoadingInProgress: false,
      securities: [], futures: [], options: [], blocked: [], money: [{ currency: 'rub', units: '999', nano: 0 }] });
    expect(await checkTechnicalSandboxPreflight(cash)).toMatchObject({ ready: false, initialCashConfirmed: false });
    const stops = fixture(); stops.client.getSandboxStopOrders.mockResolvedValue({ stopOrders: [{ status: 'STOP_ORDER_STATUS_CANCELED' }] });
    expect(await checkTechnicalSandboxPreflight(stops)).toMatchObject({ ready: false, stopHistoryEmpty: false });
    const accounts = fixture(); accounts.client.getSandboxAccounts.mockResolvedValue([{ id: 'other', name: 'other' }]);
    expect(await checkTechnicalSandboxPreflight(accounts)).toMatchObject({ ready: false, accountVerified: false });
    expect(accounts.client.getSandboxPositions).not.toHaveBeenCalled();
  });
  it('refuses a pending order, malformed positions, private broker exception and invalid input', async () => {
    const variants = [fixture(), fixture(), fixture(), fixture()];
    variants[0]!.client.getSandboxOrders.mockResolvedValue({ orders: [{}] } as never);
    variants[1]!.client.getSandboxPositions.mockResolvedValue({ accountId: 'different' } as never);
    variants[2]!.client.getSandboxAccounts.mockRejectedValue(new Error('private-token private-account'));
    variants[3]!.expectedInitialCashNano = 'invalid-private-value';
    for (const f of variants) {
      const claim = vi.fn(); await expect(claimTechnicalSandboxAttempt(f, claim)).rejects.toThrow('no attempt was claimed');
      expect(claim).not.toHaveBeenCalled(); expect(JSON.stringify(await checkTechnicalSandboxPreflight(f))).not.toContain('private');
    }
  });
  it('rechecks the window after awaited reads and immediately before claim', async () => {
    const f = fixture(); let at = '2026-10-05T14:59:59Z'; f.clock = () => new Date(at);
    f.client.getSandboxPositions.mockImplementation(async () => { at = '2026-10-05T15:00:00Z'; return {
      accountId: 'private-account', limitsLoadingInProgress: false, securities: [], futures: [], options: [], blocked: [],
      money: [{ currency: 'rub', units: '1000', nano: 0 }] }; });
    const claim = vi.fn(); await expect(claimTechnicalSandboxAttempt(f, claim)).rejects.toThrow('no attempt was claimed');
    expect(claim).not.toHaveBeenCalled();
  });
  it('bounds a transport that never settles, without a claim', async () => {
    vi.useFakeTimers(); const f = fixture(), claim = vi.fn();
    f.client.getSandboxAccounts.mockImplementation(() => new Promise(() => {}));
    const pending = claimTechnicalSandboxAttempt(f, claim); const assertion = expect(pending).rejects.toThrow('no attempt was claimed');
    await vi.advanceTimersByTimeAsync(30_000); await assertion; expect(claim).not.toHaveBeenCalled();
  });
});
