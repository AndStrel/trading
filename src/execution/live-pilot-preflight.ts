import { z } from 'zod/v4';

import type { AppConfig } from '../config.js';
import type { LivePreflightClient } from './live-preflight-client.js';

const money = z.object({
  currency: z.string(), units: z.string().regex(/^-?\d{1,12}$/),
  nano: z.number().int().min(-999_999_999).max(999_999_999),
});
const positions = z.object({
  accountId: z.string(), money: z.array(money), blocked: z.array(money).default([]),
  securities: z.array(z.unknown()).default([]), futures: z.array(z.unknown()).default([]),
  options: z.array(z.unknown()).default([]), limitsLoadingInProgress: z.boolean(),
});
const accounts = z.object({ accounts: z.array(z.object({
  id: z.string(), status: z.string(), accessLevel: z.string(), type: z.string(),
})) });

function amount(value: z.infer<typeof money>): bigint {
  const units = BigInt(value.units);
  if ((units < 0n && value.nano > 0) || (units > 0n && value.nano < 0)) throw new Error('Invalid monetary sign');
  return units * 1_000_000_000n + BigInt(value.nano);
}

export type PilotPreflightReport = {
  liveSubmissionAllowed: false;
  accountChecksPassed: boolean;
  availableCashRub: number | null;
  blockers: string[];
};

export class LivePilotPreflight {
  constructor(private readonly config: AppConfig, private readonly client: Pick<LivePreflightClient,
    'getAccounts' | 'getUserInfo' | 'getPositions' | 'getOrders' | 'getStopOrders'>) {}

  async check(): Promise<PilotPreflightReport> {
    const pilot = this.config.livePilot;
    const report: PilotPreflightReport = { liveSubmissionAllowed: false, accountChecksPassed: false, availableCashRub: null, blockers: [] };
    if (!pilot.prepare) report.blockers.push('Подготовка дневного пилота выключена.');
    if (!pilot.token) report.blockers.push('Не задан отдельный live-токен.');
    if (!pilot.accountId) report.blockers.push('Не выбран отдельный дневной счёт.');
    if (report.blockers.length === 0 && pilot.accountId) {
      try {
        // No broad broker payload is logged, persisted or sent to Telegram.
        const [accountPayload, infoPayload] = await Promise.all([this.client.getAccounts(), this.client.getUserInfo()]);
        const account = accounts.parse(accountPayload).accounts.find(item => item.id === pilot.accountId);
        if (!account || account.status !== 'ACCOUNT_STATUS_OPEN' || account.accessLevel !== 'ACCOUNT_ACCESS_LEVEL_FULL_ACCESS'
          || account.type !== 'ACCOUNT_TYPE_TINKOFF') {
          report.blockers.push('Доступ к выбранному обычному брокерскому счёту не подтверждён.');
        }
        const tariff = z.object({ tariff: z.string() }).parse(infoPayload).tariff;
        if (tariff.toLowerCase() !== 'investor') report.blockers.push('Тариф изменился: требуется повторная проверка расходов.');
        if (report.blockers.length === 0) {
          const [positionPayload, orderPayload, stopPayload] = await Promise.all([
            this.client.getPositions(pilot.accountId), this.client.getOrders(pilot.accountId), this.client.getStopOrders(pilot.accountId),
          ]);
          const snapshot = positions.parse(positionPayload);
          if (snapshot.accountId !== pilot.accountId || snapshot.limitsLoadingInProgress) throw new Error('Unconfirmed account snapshot');
          if (snapshot.securities.length || snapshot.futures.length || snapshot.options.length) report.blockers.push('На счёте уже есть позиции: автоматическое управление ими запрещено.');
          if (z.object({ orders: z.array(z.unknown()) }).parse(orderPayload).orders.length
            || z.object({ stopOrders: z.array(z.unknown()) }).parse(stopPayload).stopOrders.length) {
            report.blockers.push('На счёте есть активные заявки или стопы.');
          }
          const rubles = snapshot.money.filter(item => item.currency.toLowerCase() === 'rub');
          if (rubles.length !== 1) throw new Error('Unknown RUB cash');
          const rub = amount(rubles[0]!);
          const blocked = snapshot.blocked.reduce((sum, item) => {
            const value = amount(item);
            if (value < 0n) throw new Error('Negative blocked cash');
            if (value > 0n && item.currency.toLowerCase() !== 'rub') throw new Error('Foreign cash reservation');
            return sum + value;
          }, 0n);
          if (snapshot.money.some(item => item.currency.toLowerCase() !== 'rub' && amount(item) !== 0n)) report.blockers.push('Для изолированного пилота допускаются только рубли.');
          if (rub < 0n || blocked > rub) throw new Error('Unconfirmed free cash');
          report.availableCashRub = Number((rub - blocked) / 10_000_000n) / 100;
          if (blocked > 0n) report.blockers.push('На счёте есть заблокированные деньги.');
          if (report.availableCashRub < pilot.capitalRub) report.blockers.push('Счёт ещё не пополнен до суммы дневного пилота.');
          report.accountChecksPassed = report.blockers.length === 0;
        }
      } catch {
        report.blockers.push('Проверка брокера не завершена или ответ неполный. Счёт не признан готовым.');
      }
    }
    report.blockers.push('Live-отправка закрыта: ещё нужны защитный стоп, сверка после сбоев, учёт фактического убытка и sandbox-проверка полного цикла.');
    return report;
  }
}
