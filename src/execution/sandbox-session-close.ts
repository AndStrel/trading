import type { AppConfig } from '../config.js';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import type { TInvestClient } from '../tbank/client.js';
import type { TInvestOrderClient } from './tinvest-order-client.js';
import type { SandboxExitService } from './sandbox-exit-service.js';
import { parseSandboxOrderState, parseSandboxSessionExitOrderState } from './sandbox-order-state.js';
import { assertSandboxPosition, decimalPriceNano, nanoQuotation, nativeStopKey, parseSandboxStop } from './sandbox-stop-state.js';
import { assertNoSandboxOrders, sandboxFlatCashNano } from './sandbox-flat-account.js';
import { sandboxBidValue } from './sandbox-loss-policy.js';
import { sandboxCloseKey, sandboxSessionCloseDue, type SandboxSessionExitIntent } from './sandbox-session-policy.js';
import { assertSandboxInstrument } from './sandbox-instrument.js';
import { assertTechnicalScope } from './sandbox-technical-scope.js';
import { scenarioInstrument } from './scenario-instrument.js';
import { isTradingStrategyId } from '../strategies/catalog.js';
import { sandboxTargetEconomics, sandboxTargetModelNet, type SandboxTargetInput, type SandboxTargetProof } from './sandbox-target-policy.js';

type Client = Pick<TInvestOrderClient,'getSandboxOrderState'|'getSandboxPositions'|'getSandboxOrders'|'getSandboxStopOrders'|'cancelSandboxStop'|'postSandboxSessionExit'|'postSandboxStopLimit'>;
type CloseResult = { kind:'session'|'native'|'target'|'restored'; complete:boolean; targetAchieved?:boolean; modelNetPnlNano?:string } | null;
function object(value:unknown):Record<string,unknown>|null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : null; }
function rateNano(rate:number) { return rate === 0 ? '0' : decimalPriceNano(rate); }

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
      if(prior?.phase==='submitted') return await this.finishSubmission(accountId,scenarioId,prior,fixedNow);
      if(prior?.phase==='restore-claimed') return await this.confirmRestoration(accountId,scenarioId,prior,fixedNow);
      const persisted=this.journal.getExecutionSnapshot(scenarioId);
      if(!persisted?.terminal||!persisted.stages.length) throw new Error();
      const entryAt=new Date(Math.max(...persisted.stages.map(stage=>Date.parse(stage.executedAt)))).toISOString();
      if(technical) assertTechnicalScope(scenario,order.lots);
      const due=sandboxSessionCloseDue(entryAt,now());
      // A restored target never gets another target attempt. At most one later
      // session attempt is permitted; a rejected session stays protected.
      if(prior?.phase==='restored' && (!due || prior.purpose==='session')) return this.confirmRestoration(accountId,scenarioId,prior,fixedNow);
      const targetInput=this.targetInput(scenarioId);
      if(!prior&&!technical&&!due&&(!this.config.execution.sandboxTargetExitEnabled||!targetInput)) return null;
      const entry=parseSandboxOrderState(await this.client.getSandboxOrderState(accountId,order.orderRequestId),
        {requestId:order.orderRequestId,instrumentId:order.instrumentId,lots:order.lots,lotSize:scenario.input.lotSize},now());
      if(!entry.terminal||entry.lotsExecuted!==native.intent.lots||entry.commissionNano===null) throw new Error();
      this.journal.recordExecutionReconciliation(scenarioId,entry);
      let stop=parseSandboxStop(await this.client.getSandboxStopOrders(accountId),native.intent,now());
      const nativeKey=nativeStopKey(native.intent);
      this.journal.observeNativeStop(scenarioId,stop,nativeKey);
      if(stop.status==='STOP_ORDER_STATUS_EXECUTED') return {kind:'native',complete:(await this.exits.reconcile(accountId,scenarioId,now())).complete};
      let intent=prior;
      if(!prior||prior.phase==='restored') {
        if(stop.status!=='STOP_ORDER_STATUS_ACTIVE'||this.journal.getSandboxExitEvidence(scenarioId)) throw new Error();
        const price=await this.preflight(accountId,scenarioId,order.instrumentId,entry.lotsExecuted,scenario.input.lotSize,fixedNow);
        const purpose=technical ? 'technical-acceptance' : due ? 'session' : 'target';
        const proof=purpose==='target' && targetInput ? sandboxTargetEconomics(entry,targetInput) : undefined;
        if(purpose==='target' && (!proof||BigInt(price.worstBidNano)<BigInt(proof.targetNano))) return null;
        this.journal.setExecutionKilled(true); // Protective exits only, never resume entries.
        const claim=this.journal.claimSandboxSessionExit({scenarioId,accountId,entryRequestId:order.orderRequestId,instrumentId:order.instrumentId,
          lots:entry.lotsExecuted,stopId:native.intent.brokerStopId,generation:nativeKey.generation},now(),purpose,proof??undefined);
        intent=claim.intent;
        if(claim.claimed) await this.client.cancelSandboxStop({mode:'sandbox',accountId,stopId:claim.intent.stopId});
        // If another process claimed cancellation, we only READ its outcome.
        // An ACTIVE/missing stop after timeout is never permission to retry.
        stop=parseSandboxStop(await this.client.getSandboxStopOrders(accountId),native.intent,now());
        this.journal.observeNativeStop(scenarioId,stop,nativeKey);
        if(stop.status==='STOP_ORDER_STATUS_EXECUTED') return {kind:'native',complete:(await this.exits.reconcile(accountId,scenarioId,now())).complete};
      }
      if(!intent||intent.phase!=='cancel-claimed') throw new Error();
      if(stop.status!=='STOP_ORDER_STATUS_CANCELED'||stop.childOrderId!==null) throw new Error();
      let proof:SandboxTargetProof|undefined;
      if(intent.purpose==='target') {
        // Refresh fees before capturing the ledger revision. Every subsequent
        // account/quote read must still belong to this unchanged revision.
        const fresh=parseSandboxOrderState(await this.client.getSandboxOrderState(accountId,order.orderRequestId),
          {requestId:order.orderRequestId,instrumentId:order.instrumentId,lots:order.lots,lotSize:scenario.input.lotSize},now());
        this.journal.recordExecutionReconciliation(scenarioId,fresh);
        const original=intent.targetProof;
        if(!original || !targetInput || BigInt(targetInput.commissionRateNano)>BigInt(original.commissionRateNano)
          || BigInt(targetInput.slippageRateNano)>BigInt(original.slippageRateNano)) throw new Error();
        proof=sandboxTargetEconomics(fresh,original)??undefined;
        if(!proof) throw new Error();
      }
      const revision=this.journal.getSandboxLossLedger().revision;
      const price=await this.preflight(accountId,scenarioId,order.instrumentId,entry.lotsExecuted,scenario.input.lotSize,fixedNow);
      // Read the stop again after position/quote reads: a HTTP cancel ACK alone
      // does not grant ownership of the position to our separate SELL.
      const confirmed=parseSandboxStop(await this.client.getSandboxStopOrders(accountId),native.intent,now());
      if(confirmed.status!=='STOP_ORDER_STATUS_CANCELED'||confirmed.childOrderId!==null) throw new Error();
      this.journal.observeNativeStop(scenarioId,confirmed,nativeKey);
      const quoteAge=now().getTime()-Date.parse(price.quoteAt);
      if(quoteAge < -1_000 || quoteAge > 15_000) throw new Error();
      if(proof&&BigInt(price.worstBidNano)<BigInt(proof.targetNano)) throw new Error();
      const claim=this.journal.claimSandboxSessionSubmission(scenarioId,revision,proof?.targetNano??price.worstBidNano,now(),sandboxCloseKey(intent),proof);
      if(claim.claimed) {
        const id=await this.client.postSandboxSessionExit({mode:'sandbox',accountId,instrumentId:claim.intent.instrumentId,
          requestId:claim.intent.requestId,lots:claim.intent.lots,limitNano:claim.intent.limitNano!});
        this.journal.acknowledgeSandboxSessionExit(scenarioId,claim.intent.requestId,id,sandboxCloseKey(claim.intent));
      }
      return await this.finishSubmission(accountId,scenarioId,claim.intent,fixedNow);
    } catch {
      this.journal.setExecutionKilled(true);
      const intent=this.journal.getSandboxSessionExit(scenarioId);
      // Safe abort of a NOT-submitted target, or a proven terminal-zero SELL.
      // Unknown/NEW/partial outcomes never permit a stop or another SELL.
      if(intent?.targetConsumed && (intent.phase==='cancel-claimed' || intent.phase==='submitted' && intent.sellSnapshot?.terminal
        && intent.sellSnapshot.lotsExecuted===0 && ['EXECUTION_REPORT_STATUS_REJECTED','EXECUTION_REPORT_STATUS_CANCELLED'].includes(intent.sellSnapshot.executionStatus))) {
        try { return await this.restoreProtection(accountId,scenarioId,intent,fixedNow); } catch { /* report unconfirmed below */ }
      }
      throw new Error('Sandbox intraday close is not confirmed; no cancellation or SELL is retried, positions and risk remain reserved');
    }
  }

  private targetInput(scenarioId:number):SandboxTargetInput|null {
    const scenario=this.journal.getScenario(scenarioId); if(!scenario||scenario.strategy!=='intraday') return null;
    const snap=object(scenario.snapshot),strategy=object(snap?.tradingStrategy),policy=object(snap?.sandboxTargetExitPolicy),instrument=object(snap?.instrument);
    if(snap?.source!=='intraday-scanner'||!isTradingStrategyId(strategy?.id)||strategy.version!=='1'||policy?.version!=='1'||policy.enabled!==true) return null;
    if(instrument?.instrumentId!==scenario.instrumentId||instrument.lotSize!==scenario.input.lotSize||typeof instrument.priceStep!=='number'
      ||typeof policy.commissionRateNano!=='string'||typeof policy.slippageRateNano!=='string'
      ||!/^(0|[1-9]\d{0,9})$/.test(policy.commissionRateNano)||!/^(0|[1-9]\d{0,9})$/.test(policy.slippageRateNano)) throw new Error();
    const fee=BigInt(rateNano(Math.max(0.003,this.config.commissionRate))),slip=BigInt(rateNano(Math.max(scenario.input.slippageRate,this.config.scanner.slippageRate)));
    return {lotSize:scenario.input.lotSize,targetNano:decimalPriceNano(scenario.input.targetPrice),stopNano:decimalPriceNano(scenario.input.stopPrice),
      tickNano:decimalPriceNano(instrument.priceStep),commissionRateNano:String(fee>BigInt(policy.commissionRateNano)?fee:BigInt(policy.commissionRateNano)),
      slippageRateNano:String(slip>BigInt(policy.slippageRateNano)?slip:BigInt(policy.slippageRateNano))};
  }

  private async finishSubmission(accountId:string,scenarioId:number,intent:SandboxSessionExitIntent,fixedNow?:Date):Promise<CloseResult> {
    const now=fixedNow??new Date(),scenario=this.journal.getScenario(scenarioId); if(!scenario||!intent.submitClaimedAt) throw new Error();
    if(intent.targetConsumed) {
      const sell=parseSandboxSessionExitOrderState(await this.client.getSandboxOrderState(accountId,intent.requestId),{
        requestId:intent.requestId,brokerOrderId:intent.brokerOrderId,instrumentId:intent.instrumentId,lots:intent.lots,
        lotSize:scenario.input.lotSize,notBefore:intent.submitClaimedAt},now);
      this.journal.recordCloseSellObservation(sandboxCloseKey(intent),sell,now);
      if(sell.terminal&&sell.lotsExecuted===0&&['EXECUTION_REPORT_STATUS_REJECTED','EXECUTION_REPORT_STATUS_CANCELLED'].includes(sell.executionStatus)) {
        return this.restoreProtection(accountId,scenarioId,this.journal.getSandboxSessionExit(scenarioId)!,fixedNow);
      }
    }
    const result=await this.exits.reconcile(accountId,scenarioId,now);
    if(intent.purpose!=='target'||!result.complete) return {kind:intent.purpose==='target'?'target':'session',complete:result.complete};
    const entry=this.journal.getExecutionSnapshot(scenarioId),exit=this.journal.getSandboxExitEvidence(scenarioId)?.snapshot,proof=intent.targetProof;
    if(!entry||!exit||!proof) throw new Error();
    const modelNetPnlNano=sandboxTargetModelNet(entry,exit,scenario.input.lotSize,proof.commissionRateNano,proof.slippageRateNano);
    return {kind:'target',complete:true,modelNetPnlNano,targetAchieved:BigInt(modelNetPnlNano)>0n&&exit.stages.every(stage=>BigInt(stage.priceNano)>=BigInt(proof.targetNano))};
  }

  private async restoreProtection(accountId:string,scenarioId:number,intent:SandboxSessionExitIntent,fixedNow?:Date):Promise<CloseResult> {
    const now=()=>fixedNow??new Date(),native=this.journal.getNativeStop(scenarioId),scenario=this.journal.getScenario(scenarioId);
    if(!native?.intent.brokerStopId||!scenario||!intent.targetConsumed) throw new Error();
    const key=nativeStopKey(native.intent),revision=this.journal.getSandboxLossLedger().revision,started=performance.now();
    const [positions,orders,stops,instrument]=await Promise.all([this.client.getSandboxPositions(accountId),this.client.getSandboxOrders(accountId),
      this.client.getSandboxStopOrders(accountId),this.market.getInstrumentBy(intent.instrumentId)]);
    const item=scenarioInstrument(this.config,scenario);
    assertSandboxInstrument(instrument,{instrumentId:intent.instrumentId,lotSize:scenario.input.lotSize,priceStep:item.priceStep});
    const units=BigInt(intent.lots)*BigInt(scenario.input.lotSize);
    assertSandboxPosition(positions,accountId,intent.instrumentId,units); assertNoSandboxOrders(orders);
    sandboxFlatCashNano({...positions as Record<string,unknown>,securities:[]},accountId);
    const stop=parseSandboxStop(stops,native.intent,now());
    if(stop.status!=='STOP_ORDER_STATUS_CANCELED'||stop.childOrderId!==null||performance.now()-started>15_000) throw new Error();
    this.journal.observeNativeStop(scenarioId,stop,key);
    const claim=this.journal.claimProtectionRestore(sandboxCloseKey(intent),revision,{accountId,instrumentId:intent.instrumentId,lots:intent.lots,
      lotSize:scenario.input.lotSize,positionUnits:String(units),checkedAt:now().toISOString(),stop,noActiveOrders:true,noOtherActiveStops:true},now());
    if(claim.claimed) {
      const next=claim.record.intent;
      const id=await this.client.postSandboxStopLimit({mode:'sandbox',accountId,instrumentId:next.instrumentId,requestId:next.requestId,
        lots:next.lots,stopNano:next.stopNano,limitNano:next.limitNano});
      this.journal.acknowledgeNativeStop(scenarioId,next.requestId,id,nativeStopKey(next));
    }
    return this.confirmRestoration(accountId,scenarioId,claim.intent,fixedNow);
  }

  private async confirmRestoration(accountId:string,scenarioId:number,intent:SandboxSessionExitIntent,fixedNow?:Date):Promise<CloseResult> {
    const now=()=>fixedNow??new Date(),native=this.journal.getNativeStop(scenarioId),scenario=this.journal.getScenario(scenarioId);
    if(!native?.intent.brokerStopId||!scenario||native.intent.generation!==intent.restoreGeneration) throw new Error();
    const key=nativeStopKey(native.intent);
    const stop=parseSandboxStop(await this.client.getSandboxStopOrders(accountId),native.intent,now());
    this.journal.observeNativeStop(scenarioId,stop,key);
    if(stop.status==='STOP_ORDER_STATUS_EXECUTED') return {kind:'native',complete:(await this.exits.reconcile(accountId,scenarioId,now())).complete};
    if(stop.status!=='STOP_ORDER_STATUS_ACTIVE'||stop.childOrderId!==null) throw new Error();
    const [positions,orders]=await Promise.all([this.client.getSandboxPositions(accountId),this.client.getSandboxOrders(accountId)]);
    assertSandboxPosition(positions,accountId,native.intent.instrumentId,BigInt(native.intent.lots)*BigInt(scenario.input.lotSize));assertNoSandboxOrders(orders);
    const confirmed=parseSandboxStop(await this.client.getSandboxStopOrders(accountId),native.intent,now());
    this.journal.observeNativeStop(scenarioId,confirmed,key);
    if(confirmed.status==='STOP_ORDER_STATUS_EXECUTED') return {kind:'native',complete:(await this.exits.reconcile(accountId,scenarioId,now())).complete};
    if(confirmed.status!=='STOP_ORDER_STATUS_ACTIVE'||confirmed.childOrderId!==null) throw new Error();
    this.journal.markProtectionRestored(sandboxCloseKey(intent),key,now());
    return {kind:'restored',complete:false};
  }

  private async preflight(accountId:string,scenarioId:number,instrumentId:string,lots:number,lotSize:number,fixedNow?:Date) {
    const scenario = this.journal.getScenario(scenarioId); if (!scenario || scenario.instrumentId!==instrumentId || scenario.input.lotSize!==lotSize) throw new Error();
    const item=scenarioInstrument(this.config,scenario);
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
