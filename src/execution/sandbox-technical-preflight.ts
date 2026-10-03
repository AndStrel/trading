import type { TInvestOrderClient } from './tinvest-order-client.js';
import { sandboxFlatCashNano, assertNoSandboxOrders } from './sandbox-flat-account.js';
import { readPreparedSandbox } from './sandbox-prepared-account.js';
import { sandboxSessionEntryAllowed } from './sandbox-session-policy.js';

type Client = Pick<TInvestOrderClient, 'getSandboxAccounts' | 'getSandboxPositions' | 'getSandboxOrders' | 'getSandboxStopOrders'>;
type Input = {
  client: Client;
  prepared: ReturnType<typeof readPreparedSandbox>;
  expectedInitialCashNano: string;
  clock?: () => Date;
};

export type TechnicalSandboxPreflightReport = {
  scope: 'sandbox-technical-preflight'; ready: boolean;
  reason: 'entry-window-closed' | 'input-invalid' | 'accounts-unconfirmed' | 'account-books-unconfirmed' | 'reads-expired' | null;
  entryWindowOpen: boolean | null; accountVerified: boolean | null; flatConfirmed: boolean | null;
  initialCashConfirmed: boolean | null; ordersEmpty: boolean | null; stopHistoryEmpty: boolean | null;
  brokerWrites: false; liveSubmissionAllowed: false;
};

/** No journal, latch, arming, broker mutation, retry, funding or time override. */
export async function checkTechnicalSandboxPreflight(input: Input): Promise<TechnicalSandboxPreflightReport> {
  const report: TechnicalSandboxPreflightReport = { scope: 'sandbox-technical-preflight', ready: false, reason: null,
    entryWindowOpen: null, accountVerified: null, flatConfirmed: null, initialCashConfirmed: null,
    ordersEmpty: null, stopHistoryEmpty: null, brokerWrites: false, liveSubmissionAllowed: false };
  const clock = input.clock ?? (() => new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stage: Exclude<TechnicalSandboxPreflightReport['reason'], null> = 'input-invalid';
  try {
    report.entryWindowOpen = sandboxSessionEntryAllowed(clock());
    if (!report.entryWindowOpen) { report.reason = 'entry-window-closed'; return report; }
    if (!/^[1-9]\d{0,39}$/.test(input.expectedInitialCashNano)) throw new Error();
    const prepared = readPreparedSandbox(JSON.stringify(input.prepared), input.prepared.accountId);
    const started = performance.now(), first = clock().getTime();
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error()), 30_000); });
    const bounded = <T>(value: Promise<T>): Promise<T> => Promise.race([value, deadline]);
    stage = 'accounts-unconfirmed';
    const accounts = await bounded(input.client.getSandboxAccounts());
    report.accountVerified = accounts.length === 1 && accounts[0]?.id === prepared.accountId
      && (accounts[0].name === null || accounts[0].name === prepared.name);
    if (!report.accountVerified) throw new Error();
    stage = 'account-books-unconfirmed';
    const [positions, orders, stops] = await bounded(Promise.all([
      input.client.getSandboxPositions(prepared.accountId), input.client.getSandboxOrders(prepared.accountId),
      input.client.getSandboxStopOrders(prepared.accountId),
    ]));
    const cash = sandboxFlatCashNano(positions, prepared.accountId);
    report.flatConfirmed = true;
    report.initialCashConfirmed = cash === BigInt(input.expectedInitialCashNano);
    assertNoSandboxOrders(orders); report.ordersEmpty = true;
    const history = (stops as { stopOrders?: unknown } | null)?.stopOrders;
    report.stopHistoryEmpty = Array.isArray(history) && history.length === 0;
    if (!report.initialCashConfirmed || !report.stopHistoryEmpty) throw new Error();
    stage = 'reads-expired';
    const last = clock().getTime(), elapsed = performance.now() - started;
    if (!Number.isFinite(last) || last < first || last - first > 30_000 || elapsed < 0 || elapsed >= 30_000) throw new Error();
    report.entryWindowOpen = sandboxSessionEntryAllowed(clock());
    if (!report.entryWindowOpen) { report.reason = 'entry-window-closed'; return report; }
    report.ready = true;
    return report;
  } catch { report.reason = stage; return report; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

/** The real runner uses this gate BEFORE its permanent single-attempt latch. */
export async function claimTechnicalSandboxAttempt<T>(input: Input, claim: () => T): Promise<T> {
  const report = await checkTechnicalSandboxPreflight(input);
  const clock = input.clock ?? (() => new Date());
  if (!report.ready || !sandboxSessionEntryAllowed(clock())) {
    throw new Error('Technical sandbox preflight is not ready; no attempt was claimed');
  }
  return claim();
}
