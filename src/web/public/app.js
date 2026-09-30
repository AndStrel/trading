'use strict';
const telegram = window.Telegram?.WebApp;
const auth = telegram?.initData || '';
const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 3 });
let view = null;
let busy = false;
let access = false;
function notice(text, error = false) { elements.notice.textContent = text; elements.notice.classList.toggle('error', error); }
function controls() { for (const id of ['refresh', 'scanner-toggle', 'kill']) elements[id].disabled = !access || busy; }
function text(id, value) { elements[id].textContent = value; }
function date(value) { return value ? new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) + ' МСК' : 'Прохода ещё не было'; }
function node(tag, content, className) { const element = document.createElement(tag); element.textContent = content; if (className) element.className = className; return element; }
function render(data) {
  view = data;
  text('capital', money.format(data.limits.capitalRub)); text('trade-risk', money.format(data.limits.tradeRiskRub));
  text('day-risk', money.format(data.limits.dailyRiskRub)); text('position-limit', money.format(data.limits.positionRub));
  text('commission', percent.format(data.limits.commissionRate)); text('slippage', percent.format(data.limits.slippageRate));
  text('loss-limit', money.format(data.limits.dailyLossRub)); text('updated', date(data.observedAt));
  text('mode', 'Наблюдение · реальные заявки закрыты');
  text('scanner-state', data.scanner.paused ? 'Пауза' : data.scanner.fresh && !data.scanner.errors ? 'Свежие данные' : 'Требует проверки');
  text('scanner-summary', 'Проверено инструментов: ' + data.scanner.scanned + ' · ошибок: ' + data.scanner.errors);
  text('scanner-date', 'Последний проход: ' + date(data.scanner.lastScanAt));
  text('scanner-toggle', data.scanner.paused ? 'Продолжить сканирование' : 'Приостановить сканирование');
  text('candidate-count', String(data.candidates.length));
  elements['candidate-list'].replaceChildren();
  if (!data.candidates.length) elements['candidate-list'].append(node('article', 'Свежих кандидатов пока нет. Сделка не обязательна.', 'empty'));
  for (const candidate of data.candidates) {
    const card = node('article', ''); const heading = node('div', '', 'section-head');
    heading.append(node('h3', candidate.ticker), node('span', date(candidate.observedAt))); card.append(heading);
    const prices = node('div', '', 'candidate-prices');
    for (const [label, value] of [['Вход', candidate.entryRub], ['Стоп', candidate.stopRub], ['Цель', candidate.targetRub]]) {
      const item = node('div', ''); item.append(node('span', label), node('strong', money.format(value))); prices.append(item);
    }
    card.append(prices, node('p', 'Сценарий #' + candidate.id + ' · не разрешение на сделку', 'muted')); elements['candidate-list'].append(card);
  }
  text('kill', data.execution.killed ? 'Новые входы уже запрещены' : 'Запретить новые входы');
  const guard = data.sandboxLossGuard;
  const guardLabels = { off: 'Выключен', waiting: 'Ждём сверки', stale: 'Данные устарели', ok: 'Проверено', limit: 'Лимит достигнут', incomplete: 'Не подтверждён' };
  text('sandbox-loss-state', guardLabels[guard?.state] || 'Не подтверждён');
  text('sandbox-closed-loss', guard?.closedLoss ?? 'Не подтверждены');
  text('sandbox-open-loss', guard?.estimatedOpenLoss ?? 'Не подтверждена');
  text('sandbox-total-loss', guard?.totalLoss ?? 'Не подтверждена');
  text('sandbox-loss-date', guard?.checkedAt ? 'Последняя проверка: ' + new Date(guard.checkedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК' : 'Проверок ещё не было.');
  elements['sandbox-results'].replaceChildren();
  if (!data.sandboxResults?.length) elements['sandbox-results'].append(node('article', 'Сверенных продаж в песочнице пока нет.', 'empty'));
  for (const result of data.sandboxResults || []) {
    const card = node('article', '');
    card.append(node('h3', 'Sandbox · сценарий #' + result.scenarioId),
      node('p', 'Продано: ' + result.soldLots + ' лот. · остаток: ' + result.remainingLots + ' лот.'),
      node('strong', result.netPnl === null ? 'Результат не подтверждён' : result.netPnl),
      node('p', result.complete ? 'Полное исполнение и пустой счёт подтверждены при сверке.' : 'Полный цикл ещё не подтверждён.'),
      node('p', 'Последняя сверка: ' + new Date(result.observedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК · резерв риска сохранён', 'muted'));
    elements['sandbox-results'].append(card);
  }
}
async function request(action) {
  if (!auth || busy) return;
  busy = true; controls();
  try {
    const response = await fetch(action ? '/api/action' : '/api/view', { method: action ? 'POST' : 'GET',
      headers: { Authorization: 'tma ' + auth, ...(action ? { 'Content-Type': 'application/json' } : {}) },
      ...(action ? { body: JSON.stringify({ action }) } : {}), cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
    if (response.status === 401) { access = false; throw new Error('Доступ истёк или не разрешён. Закройте панель и откройте её кнопкой в личном чате бота.'); }
    if (!response.ok) throw new Error(response.status === 429 ? 'Слишком много запросов. Подождите минуту.' : 'Данные не подтверждены. Попробуйте обновить экран.');
    const data = await response.json(); access = true; render(data);
    notice(action === 'kill' ? 'Новые входы запрещены. Уже открытые позиции не закрывались.' : 'Данные подтверждены сервером. Монитор фактического убытка ещё не подключён.');
  } catch (error) { notice(error instanceof Error ? error.message : 'Соединение прервано.', true); }
  finally { busy = false; controls(); }
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
  for (const section of document.querySelectorAll('.panel')) section.hidden = section.id !== button.dataset.tab;
  for (const item of document.querySelectorAll('[data-tab]')) { if (item === button) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); }
});
elements.refresh.addEventListener('click', () => request());
elements['scanner-toggle'].addEventListener('click', () => request(view?.scanner.paused ? 'resume' : 'pause'));
elements.kill.addEventListener('click', () => elements['confirm-kill'].showModal());
elements['cancel-kill'].addEventListener('click', () => elements['confirm-kill'].close());
elements['confirm-kill-button'].addEventListener('click', () => { elements['confirm-kill'].close(); void request('kill'); });
telegram?.ready(); telegram?.expand();
if (auth) { void request(); } else { text('mode', 'Нужен вход через Telegram'); notice('Откройте панель кнопкой «Открыть Mini App» в личном чате бота. В обычном браузере данные и управление закрыты.'); }
