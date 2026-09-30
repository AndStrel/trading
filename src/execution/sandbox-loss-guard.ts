import { z } from 'zod/v4';
import type { AppConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import type { TInvestClient } from '../tbank/client.js';
import type { TInvestOrderClient } from './tinvest-order-client.js';
import type { SandboxExitService } from './sandbox-exit-service.js';
import { parseSandboxOrderState } from './sandbox-order-state.js';
import { analyzeSandboxRoundTrip } from './sandbox-round-trip.js';
import { assertNoActiveSandboxStops, decimalPriceNano, parseSandboxStop } from './sandbox-stop-state.js';
import { assertNoSandboxOrders, sandboxFlatCashNano } from './sandbox-flat-account.js';
import { moscowLossDay, sandboxBidValue, sandboxClosedDayLoss, sandboxMarkedTradeLoss, type SandboxLossAssessment } from './sandbox-loss-policy.js';

type ReadClient = Pick<TInvestOrderClient, 'getSandboxOrderState' | 'getSandboxPositions' | 'getSandboxOrders' | 'getSandboxStopOrders'>;
const nonnegative = z.union([z.number(), z.string().regex(/^\d{1,13}$/)]).transform(Number).pipe(z.number().int().min(0).max(1_000_000_000_000));
const cash = z.object({ currency: z.string().transform(s => s.toLowerCase()).pipe(z.literal('rub')), units: z.string().regex(/^\d{1,12}$/),
  nano: z.number().int().min(0).max(999999999) });
const positions = z.object({ accountId: z.string(), limitsLoadingInProgress: z.literal(false), money: z.array(cash).length(1), blocked: z.array(cash),
  futures: z.array(z.unknown()).length(0), options: z.array(z.unknown()).length(0), securities: z.array(z.object({ instrumentUid: z.string(),
    balance: nonnegative, blocked: nonnegative, exchangeBlocked: z.literal(false), instrumentType: z.literal('share') })).length(1) });
const orderBook = z.object({ orders: z.array(z.object({ orderId: z.string().min(1) })).max(50) });
const stopBook = z.object({ stopOrders: z.array(z.object({ stopOrderId: z.string().min(1), status: z.enum([
  'STOP_ORDER_STATUS_ACTIVE', 'STOP_ORDER_STATUS_EXECUTED', 'STOP_ORDER_STATUS_CANCELED', 'STOP_ORDER_STATUS_EXPIRED',
]) }).passthrough()).max(1000) });

export class SandboxLossGuard {
  constructor(private readonly config: AppConfig, private readonly client: ReadClient,
    private readonly market: Pick<TInvestClient, 'getOrderBook' | 'getTradingStatus'>,
    private readonly exits: Pick<SandboxExitService, 'reconcile'>, private readonly journal: ScenarioJournal) {}

  async assess(accountId: string, fixedNow?: Date) {
    if (this.config.execution.mode !== 'sandbox' || !this.config.execution.sandboxLossGuardEnabled || !this.config.execution.sandboxProtectionEnabled
      || !this.config.livePilot.prepare || !this.config.execution.token || this.config.execution.token === this.config.token
      || this.config.livePilot.maxDailyLossRub <= 0 || this.config.livePilot.maxDailyLossRub > 60
      || this.config.livePilot.maxTradeRiskRub <= 0 || this.config.livePilot.maxTradeRiskRub > 20
      || accountId !== (this.config.execution.accountId ?? this.journal.getRuntimeState('execution.sandbox_account_id'))) {
      throw new Error('Isolated sandbox loss guard is not enabled for this account');
    }
    const now = () => fixedNow ?? new Date();
    const started = performance.now();
    try {
      const initial = this.journal.getSandboxLossLedger(); if (initial.morePending) throw new Error();
      const rawStops = stopBook.parse(await this.client.getSandboxStopOrders(accountId));
      const known = new Set(initial.orders.map(order => order.native?.intent.brokerStopId).filter((id): id is string => Boolean(id)));
      if (known.size !== initial.orders.length || rawStops.stopOrders.some(stop => stop.status === 'STOP_ORDER_STATUS_ACTIVE' && !known.has(stop.stopOrderId))) throw new Error();
      for (const order of initial.orders) {
        if (order.status !== 'accepted' || order.side !== 'long' || !order.approved || !order.native
          || order.native.intent.accountId !== accountId || !order.native.intent.brokerStopId) throw new Error();
        const entry = parseSandboxOrderState(await this.client.getSandboxOrderState(accountId, order.requestId), {
          requestId: order.requestId, instrumentId: order.instrumentId, lots: order.lots, lotSize: order.lotSize,
        }, now());
        if (!entry.terminal || entry.lotsExecuted <= 0 || entry.lotsExecuted !== order.native.intent.lots || entry.commissionNano === null) throw new Error();
        this.journal.recordExecutionReconciliation(order.scenarioId, entry);
        // Other acknowledged ACTIVE stops may belong to another covered row;
        // each is checked in its own iteration. Unknown active stops never pass.
        const scoped = { stopOrders: rawStops.stopOrders.filter(stop => stop.status !== 'STOP_ORDER_STATUS_ACTIVE'
          || stop.stopOrderId === order.native!.intent.brokerStopId) };
        const stop = parseSandboxStop(scoped, order.native.intent, now());
        this.journal.observeNativeStop(order.scenarioId, stop);
        if (stop.status === 'STOP_ORDER_STATUS_EXECUTED') await this.exits.reconcile(accountId, order.scenarioId, now());
        else if (stop.status !== 'STOP_ORDER_STATUS_ACTIVE' || order.exit) throw new Error();
      }
      const ledger = this.journal.getSandboxLossLedger();
      if (ledger.morePending || JSON.stringify(ledger.orders.map(o => o.scenarioId)) !== JSON.stringify(initial.orders.map(o => o.scenarioId))) throw new Error();
      const closed: Array<{ complete: boolean; closedAt: string | null; netPnlNano: string | null }> = [];
      const open: typeof ledger.orders = []; let maxTradeLoss = 0n;
      for (const order of ledger.orders) {
        if (!order.entry || order.entry.commissionNano === null) throw new Error();
        if (order.exit) {
          const result = analyzeSandboxRoundTrip(order.entry, order.exit.snapshot, order.lotSize);
          if (result.fullySold) {
            const complete = Boolean(order.exit.flatConfirmedAt && result.netPnlNano !== null);
            closed.push({ ...result, complete });
          } else {
            if (order.exit.snapshot.terminal || order.exit.snapshot.commissionNano === null) throw new Error();
            open.push(order);
          }
        } else open.push(order);
      }
      if (open.length > 1) throw new Error();
      const [held, activeOrders, latestStops] = await Promise.all([this.client.getSandboxPositions(accountId),
        this.client.getSandboxOrders(accountId), this.client.getSandboxStopOrders(accountId)]);
      let openLoss = 0n;
      if (!open.length) {
        sandboxFlatCashNano(held, accountId); assertNoSandboxOrders(activeOrders); assertNoActiveSandboxStops(latestStops);
      } else {
        const order = open[0]!; const entry = order.entry!; const exit = order.exit?.snapshot ?? null;
        const remaining = entry.lotsExecuted - (exit?.lotsExecuted ?? 0);
        const p = positions.parse(held); const share = p.securities[0]!;
        if (p.accountId !== accountId || share.instrumentUid !== order.instrumentId
          || BigInt(share.balance) + BigInt(share.blocked) !== BigInt(remaining) * BigInt(order.lotSize)
          || p.blocked.some(money => BigInt(money.units) * 1_000_000_000n + BigInt(money.nano) !== 0n)) throw new Error();
        const ids = orderBook.parse(activeOrders).orders.map(item => item.orderId);
        if (new Set(ids).size !== ids.length || ids.some(id => id !== order.native!.observation?.childOrderId)) throw new Error();
        if (exit && !exit.terminal && !ids.includes(exit.brokerOrderId)) throw new Error();
        if (share.blocked > 0 && (!exit || exit.terminal || !ids.includes(exit.brokerOrderId))) throw new Error();
        const stop = parseSandboxStop(latestStops, order.native!.intent, now());
        if (stop.status !== order.native!.observation?.status || stop.childOrderId !== order.native!.observation?.childOrderId) throw new Error();
        const [bid, status] = await Promise.all([this.market.getOrderBook(order.instrumentId, 20), this.market.getTradingStatus(order.instrumentId)]);
        const mark = sandboxBidValue(bid, status, order.instrumentId, remaining, order.lotSize, now());
        openLoss = BigInt(sandboxMarkedTradeLoss(entry, exit, mark.grossNano, order.lotSize, this.config.commissionRate,
          Math.max(this.config.scanner.slippageRate, order.slippageRate)).lossNano);
        if (openLoss > maxTradeLoss) maxTradeLoss = openLoss;
      }
      if (performance.now() - started > 30_000) throw new Error();
      const checked = now(); const closedLoss = sandboxClosedDayLoss(closed, checked);
      for (const result of closed) {
        if (moscowLossDay(new Date(result.closedAt!)) === moscowLossDay(checked)) {
          const pnl = BigInt(result.netPnlNano!); if (pnl < -maxTradeLoss) maxTradeLoss = -pnl;
        }
      }
      const status = closedLoss + openLoss >= BigInt(decimalPriceNano(this.config.livePilot.maxDailyLossRub))
        || maxTradeLoss >= BigInt(decimalPriceNano(this.config.livePilot.maxTradeRiskRub)) ? 'limit' : 'ok';
      return this.journal.recordSandboxLossAssessment(accountId, ledger.revision, { status, checkedAt: checked.toISOString(), day: moscowLossDay(checked),
        closedLossNano: String(closedLoss), openLossNano: String(openLoss), maxTradeLossNano: String(maxTradeLoss) });
    } catch {
      this.journal.setExecutionKilled(true); const checked = now();
      const incomplete: SandboxLossAssessment = { status: 'incomplete', checkedAt: checked.toISOString(), day: moscowLossDay(checked),
        closedLossNano: null, openLossNano: null, maxTradeLossNano: null };
      const ledger = this.journal.getSandboxLossLedger();
      return this.journal.recordSandboxLossAssessment(accountId, ledger.revision, incomplete);
    }
  }
}
