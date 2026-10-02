import type { AppConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import type { TInvestClient } from '../tbank/client.js';
import type { TInvestOrderClient } from './tinvest-order-client.js';
import type { SandboxExitService } from './sandbox-exit-service.js';
import { parseSandboxOrderState } from './sandbox-order-state.js';
import { assertSandboxPosition, decimalPriceNano, nanoQuotation, parseSandboxStop } from './sandbox-stop-state.js';
import { assertNoSandboxOrders, sandboxFlatCashNano } from './sandbox-flat-account.js';
import { sandboxBidValue } from './sandbox-loss-policy.js';
import { sandboxSessionCloseDue } from './sandbox-session-policy.js';
import { assertSandboxInstrument } from './sandbox-instrument.js';
import { assertTechnicalScope } from './sandbox-technical-scope.js';

type Client = Pick<TInvestOrderClient,'getSandboxOrderState'|'getSandboxPositions'|'getSandboxOrders'|'getSandboxStopOrders'|'cancelSandboxStop'|'postSandboxSessionExit'>;
type CloseResult = { kind:'session'|'native'; complete:boolean } | null;

export class SandboxSessionClose {
  private readonly inFlight = new Map<number,Promise<CloseResult>>();
  constructor(private readonly config:AppConfig,private readonly client:Client,
    private readonly market:Pick<TInvestClient,'getOrderBook'|'getTradingStatus'|'getInstrumentBy'>,
    private readonly exits:Pick<SandboxExitService,'reconcile'>,private readonly journal:ScenarioJournal) {}

  private enabled(accountId:string) {
    if(this.config.execution.mode!=='sandbox'||!this.config.execution.sandboxSessionCloseEnabled||!this.config.execution.sandboxProtectionEnabled
      ||!this.config.execution.sandboxLossGuardEnabled||!this.config.livePilot.prepare||!this.config.execution.token
      ||this.config.execution.token===this.config.token||accountId!==(this.config.execution.accountId??this.journal.getRuntimeState('execution.sandbox_account_id'))) {
      throw new Error('Isolated sandbox session close is not enabled for this account');
    }
  }

  async advance(accountId:string,scenarioId:number,fixedNow?:Date):Promise<CloseResult> {
    this.enabled(accountId);
    const pending=this.inFlight.get(scenarioId); if(pending) return pending;
    const result=this.advanceGuarded(accountId,scenarioId,fixedNow); this.inFlight.set(scenarioId,result);
    try { return await result; } finally { this.inFlight.delete(scenarioId); }
  }

  // Not exposed by Telegram/MiniApp or the automatic strategy worker.
  // Only the separately authorized, bounded, isolated acceptance runner uses it.
  async closeTechnicalAcceptance(accountId:string,scenarioId:number):Promise<CloseResult> {
    this.enabled(accountId);
    const scenario=this.journal.getScenario(scenarioId), order=this.journal.getExecutionByScenario(scenarioId);
    if(!scenario||!order||order.mode!=='sandbox') throw new Error('Technical sandbox scenario is absent');
    assertTechnicalScope(scenario,order.lots);
    const instrument=await this.market.getInstrumentBy(order.instrumentId) as {instrument?:{ticker?:string;classCode?:string}};
    if(instrument?.instrument?.ticker!=='VTBR'||instrument.instrument.classCode!=='TQBR') throw new Error('Technical instrument is not VTBR TQBR');
    const pending=this.inFlight.get(scenarioId); if(pending) return pending;
    const result=this.advanceGuarded(accountId,scenarioId,undefined,true); this.inFlight.set(scenarioId,result);
    try { return await result; } finally { this.inFlight.delete(scenarioId); }
  }

  // Explicit reconciliation and startup recovery stay READ ONLY. They cannot
  // cancel a stop or claim/post the next phase of an unfinished close intent.
  async reconcile(accountId:string,scenarioId:number,fixedNow?:Date) {
    this.enabled(accountId); const intent=this.journal.getSandboxSessionExit(scenarioId);
    if(!intent||intent.accountId!==accountId||intent.phase!=='submitted') throw new Error('Sandbox session SELL has not been claimed');
    return this.exits.reconcile(accountId,scenarioId,fixedNow);
  }

  private async advanceGuarded(accountId:string,scenarioId:number,fixedNow?:Date,technical=false):Promise<CloseResult> {
    const now=()=>fixedNow??new Date();
    try {
      const order=this.journal.getExecutionByScenario(scenarioId); const scenario=this.journal.getScenario(scenarioId);
      const native=this.journal.getNativeStop(scenarioId); const prior=this.journal.getSandboxSessionExit(scenarioId);
      if(!order||!scenario||order.mode!=='sandbox'||order.status!=='accepted'||order.side!=='long'||!order.approvedByChatId
        ||!native?.intent.brokerStopId||native.intent.accountId!==accountId) throw new Error();
      if(prior?.phase==='submitted') return {kind:'session',complete:(await this.reconcile(accountId,scenarioId,fixedNow)).complete};
      const persisted=this.journal.getExecutionSnapshot(scenarioId);
      if(!persisted?.terminal||!persisted.stages.length) throw new Error();
      const entryAt=new Date(Math.max(...persisted.stages.map(stage=>Date.parse(stage.executedAt)))).toISOString();
      if(technical) assertTechnicalScope(scenario,order.lots);
      if(!prior&&!technical&&!sandboxSessionCloseDue(entryAt,now())) return null;
      this.journal.setExecutionKilled(true); // Protective exits remain permitted; never resume entries.
      const entry=parseSandboxOrderState(await this.client.getSandboxOrderState(accountId,order.orderRequestId),
        {requestId:order.orderRequestId,instrumentId:order.instrumentId,lots:order.lots,lotSize:scenario.input.lotSize},now());
      if(!entry.terminal||entry.lotsExecuted!==native.intent.lots||entry.commissionNano===null) throw new Error();
      this.journal.recordExecutionReconciliation(scenarioId,entry);
      let stop=parseSandboxStop(await this.client.getSandboxStopOrders(accountId),native.intent,now());
      this.journal.observeNativeStop(scenarioId,stop);
      if(stop.status==='STOP_ORDER_STATUS_EXECUTED') return {kind:'native',complete:(await this.exits.reconcile(accountId,scenarioId,now())).complete};
      if(!prior) {
        if(stop.status!=='STOP_ORDER_STATUS_ACTIVE'||this.journal.getSandboxExitEvidence(scenarioId)) throw new Error();
        await this.preflight(accountId,order.instrumentId,entry.lotsExecuted,scenario.input.lotSize,fixedNow);
        const claim=this.journal.claimSandboxSessionExit({scenarioId,accountId,entryRequestId:order.orderRequestId,instrumentId:order.instrumentId,
          lots:entry.lotsExecuted,stopId:native.intent.brokerStopId},now(),technical ? 'technical-acceptance' : 'session');
        if(claim.claimed) await this.client.cancelSandboxStop({mode:'sandbox',accountId,stopId:claim.intent.stopId});
        // If another process claimed cancellation, we only READ its outcome.
        // An ACTIVE/missing stop after timeout is never permission to retry.
        stop=parseSandboxStop(await this.client.getSandboxStopOrders(accountId),native.intent,now());
        this.journal.observeNativeStop(scenarioId,stop);
        if(stop.status==='STOP_ORDER_STATUS_EXECUTED') return {kind:'native',complete:(await this.exits.reconcile(accountId,scenarioId,now())).complete};
      }
      if(stop.status!=='STOP_ORDER_STATUS_CANCELED'||stop.childOrderId!==null) throw new Error();
      const revision=this.journal.getSandboxLossLedger().revision;
      const price=await this.preflight(accountId,order.instrumentId,entry.lotsExecuted,scenario.input.lotSize,fixedNow);
      // Read the stop again after position/quote reads: a HTTP cancel ACK alone
      // does not grant ownership of the position to our separate SELL.
      const confirmed=parseSandboxStop(await this.client.getSandboxStopOrders(accountId),native.intent,now());
      if(confirmed.status!=='STOP_ORDER_STATUS_CANCELED'||confirmed.childOrderId!==null) throw new Error();
      this.journal.observeNativeStop(scenarioId,confirmed);
      const quoteAge=now().getTime()-Date.parse(price.quoteAt);
      if(quoteAge < -1_000 || quoteAge > 15_000) throw new Error();
      const claim=this.journal.claimSandboxSessionSubmission(scenarioId,revision,price.worstBidNano,now());
      if(claim.claimed) {
        const id=await this.client.postSandboxSessionExit({mode:'sandbox',accountId,instrumentId:claim.intent.instrumentId,
          requestId:claim.intent.requestId,lots:claim.intent.lots,limitNano:claim.intent.limitNano!});
        this.journal.acknowledgeSandboxSessionExit(scenarioId,claim.intent.requestId,id);
      }
      return {kind:'session',complete:(await this.reconcile(accountId,scenarioId,fixedNow)).complete};
    } catch {
      this.journal.setExecutionKilled(true);
      throw new Error('Sandbox intraday close is not confirmed; no cancellation or SELL is retried, positions and risk remain reserved');
    }
  }

  private async preflight(accountId:string,instrumentId:string,lots:number,lotSize:number,fixedNow?:Date) {
    const items=this.config.scanner.intradayWatchlist.filter(item=>item.instrumentId===instrumentId);const item=items[0];
    if(items.length!==1||!item||item.lotSize!==lotSize) throw new Error();
    const started=performance.now();
    const [positions,orders,book,status,instrument]=await Promise.all([this.client.getSandboxPositions(accountId),this.client.getSandboxOrders(accountId),
      this.market.getOrderBook(instrumentId,20),this.market.getTradingStatus(instrumentId),this.market.getInstrumentBy(instrumentId)]);
    assertSandboxInstrument(instrument,{instrumentId,lotSize,priceStep:item.priceStep});
    assertSandboxPosition(positions,accountId,instrumentId,BigInt(lots)*BigInt(lotSize));
    sandboxFlatCashNano({...positions as Record<string,unknown>,securities:[]},accountId); assertNoSandboxOrders(orders);
    const price=sandboxBidValue(book,status,instrumentId,lots,lotSize,fixedNow??new Date());
    const tick=BigInt(decimalPriceNano(item.priceStep)); nanoQuotation(price.worstBidNano);
    if(BigInt(price.worstBidNano)%tick!==0n||performance.now()-started>30_000) throw new Error();
    return price;
  }
}
