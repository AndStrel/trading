import type { AppConfig } from '../config.js';
import { ScenarioJournal, type SandboxSafetyReason } from '../journal/scenario-journal.js';
import type { TelegramClient } from '../telegram/client.js';
import type { ExecutionService } from './execution-service.js';
import type { SandboxLossGuard } from './sandbox-loss-guard.js';
type SafetyReport = {checked:boolean;reason:SandboxSafetyReason|null;delivered:number;deliveryFailed:number;noPrivateRecipient:boolean;
  maintenance:Awaited<ReturnType<ExecutionService['protectOutstanding']>>|null;loss:{status:'ok'|'incomplete'|'limit';checkedAt:string}|null};

const descriptions: Record<SandboxSafetyReason,string> = {
  'protection-unconfirmed':'Защита или закрытие позиции не подтверждены.',
  'loss-incomplete':'Полная оценка потерь и комиссий не подтверждена.',
  'loss-limit':'Достигнут предел потерь песочницы.',
  'monitor-unavailable':'Монитор не смог завершить достоверную сверку.',
};
export function sandboxSafetyAlertText(reason:SandboxSafetyReason,checkedAt:string):string {
  if(!descriptions[reason]||!Number.isFinite(Date.parse(checkedAt)))throw new Error('Invalid sandbox alert text');
  return ['⚠️ ПЕСОЧНИЦА — требуется проверка оператора',descriptions[reason],
    'Новые входы заблокированы. Возможна открытая позиция без подтверждённой защиты.',
    'Проверь счёт, ордера и стопы. Не повторяй продажу и не снимай блокировку до сверки.',
    `Последняя проверка: ${new Date(checkedAt).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})} МСК.`,
    'Это предупреждение sandbox, не подтверждение реальных сделок или прибыли.'].join('\n');
}

// Wraps the EXISTING opt-in sandbox maintenance cycle. Notification delivery
// never invokes broker writes, retries an order or clears execution kill.
export class SandboxSafetyMonitor {
  private pending:Promise<SafetyReport>|undefined;
  constructor(private readonly config:AppConfig,private readonly execution:Pick<ExecutionService,'isReady'|'protectOutstanding'>,
    private readonly journal:ScenarioJournal,private readonly client:Pick<TelegramClient,'sendMessage'>,
    private readonly lossGuard?:Pick<SandboxLossGuard,'assess'>) {}

  async tick(fixedNow?:Date) {
    if(this.config.execution.mode!=='sandbox'||!this.config.execution.sandboxProtectionEnabled) {
      return {checked:false,reason:null,delivered:0,deliveryFailed:0,noPrivateRecipient:false,maintenance:null,loss:null};
    }
    if(this.pending)return this.pending;
    this.pending=this.run(fixedNow);
    try{return await this.pending;}finally{this.pending=undefined;}
  }

  private async run(fixedNow?:Date):Promise<SafetyReport> {
    const now=()=>fixedNow??new Date();const started=performance.now();let reason:SandboxSafetyReason|null=null;
    let maintenance:SafetyReport['maintenance']=null;let loss:SafetyReport['loss']=null;
    try {
      if(!this.execution.isReady())throw new Error();
      const status=await this.execution.protectOutstanding();
      if(![status.active,status.triggered,status.closed,status.unconfirmed].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=20)
        ||typeof status.morePending!=='boolean')throw new Error();
      maintenance={active:status.active,triggered:status.triggered,closed:status.closed,unconfirmed:status.unconfirmed,morePending:status.morePending};
      if(status.unconfirmed>0||status.morePending)reason='protection-unconfirmed';
      if(this.config.execution.sandboxLossGuardEnabled) {
        const account=this.config.execution.accountId??this.journal.getRuntimeState('execution.sandbox_account_id');
        if(!this.lossGuard||!account)throw new Error();
        const report=await this.lossGuard.assess(account);const age=now().getTime()-Date.parse(report.checkedAt);
        if(!Number.isFinite(age)||age<0||age>30_000)throw new Error();
        if(report.status==='limit')reason='loss-limit';
        else if(report.status==='incomplete'&&!reason)reason='loss-incomplete';
        else if(!['ok','incomplete','limit'].includes(report.status))throw new Error();
        loss={status:report.status,checkedAt:new Date(report.checkedAt).toISOString()};
      }
      if(performance.now()-started>60_000)throw new Error();
    } catch { reason='monitor-unavailable'; }
    this.journal.recordSandboxSafetyCheck(reason,now());
    const recipients=[...new Set(this.config.telegram.allowedChatIds.filter(id=>/^[1-9]\d{0,19}$/.test(id)))];
    let delivered=0;let deliveryFailed=0;
    for(const chatId of recipients) {
      try {
        const notice=this.journal.claimSandboxSafetyNotice(chatId,now());if(!notice)continue;
        const url=this.config.telegram.miniApp.enabled?this.config.telegram.miniApp.url:undefined;
        await this.client.sendMessage(chatId,sandboxSafetyAlertText(notice.reason,notice.checkedAt),url?{replyMarkup:{inline_keyboard:[[{text:'Панель',web_app:{url}}]]}}:undefined);
        if(this.journal.acknowledgeSandboxSafetyNotice(chatId,notice,now()))delivered++;else deliveryFailed++;
      } catch { deliveryFailed++; } // No exception text, token, recipient or broker ID is logged.
    }
    return {checked:true,reason,delivered,deliveryFailed,noPrivateRecipient:reason!==null&&recipients.length===0,maintenance,loss};
  }
}
