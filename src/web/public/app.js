'use strict';
const telegram = window.Telegram?.WebApp;
const auth = telegram?.initData || '';
const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map(element => [element.id, element]));
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 });
const tradePrice = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2, maximumFractionDigits: 9 });
const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 3 });
let view = null;
let busy = false;
let access = false;
let expired = false;
let needsReconcile = false;
let dialogTrigger = null;
function setTheme(theme) {
  const dark = theme !== 'light';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  elements.theme.textContent = dark ? 'Светлая тема' : 'Тёмная тема';
  text('theme-current', dark ? 'Текущая тема: тёмная.' : 'Текущая тема: светлая.');
}
try { setTheme(localStorage.getItem('trading-kit:theme')); } catch { setTheme('dark'); }
elements.theme.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  try { localStorage.setItem('trading-kit:theme', document.documentElement.dataset.theme); } catch { /* Theme still works without storage. */ }
});
function notice(message, error = false, pending = false) {
  for (const id of ['notice', 'source-feedback']) {
    elements[id].textContent = message + (id === 'source-feedback' && needsReconcile && !expired
      ? ' Закройте это окно и нажмите «Обновить данные».' : '')
      + (id === 'source-feedback' && pending ? ' Запрос уже отправлен. Закрытие окна не отменяет действие.' : '');
    elements[id].classList.toggle('error', error);
  }
}
function controls() {
  elements['app-content'].setAttribute('aria-busy', String(busy));
  elements['source-dialog'].setAttribute('aria-busy', String(busy));
  text('source-close', busy || needsReconcile || expired ? 'Закрыть окно' : 'Отмена');
  elements.refresh.disabled = !auth || expired || busy;
  for (const id of ['scanner-toggle', 'kill', 'source-open']) elements[id].disabled = !access || busy || needsReconcile;
  elements.kill.disabled ||= Boolean(view?.execution.killed);
  elements['confirm-kill-button'].disabled = elements.kill.disabled;
  for (const source of ['server', 'computer']) {
    const status = view?.marketSources?.sources.find(item => item.id === source);
    elements['source-' + source].disabled = !access || busy || needsReconcile || !status?.configured || !status?.available || view?.marketSources?.busy;
    elements['source-' + source].setAttribute('aria-pressed', String(view?.marketSources?.selected === source));
  }
  const selection = view?.tradingSelection;
  const selectionEnabled = access && !busy && !needsReconcile && Boolean(selection);
  elements['strategy-select'].disabled = !selectionEnabled;
  elements['save-strategy'].disabled = !selectionEnabled || elements['strategy-select'].value === selection?.strategyId;
  const chosen = selectedTickers();
  const changed = selection && (chosen.length !== selection.tickers.length || chosen.some(ticker => !selection.tickers.includes(ticker)));
  elements['save-assets'].disabled = !selectionEnabled || !chosen.length || !changed;
  for (const checkbox of elements['asset-options'].querySelectorAll('input')) checkbox.disabled = !selectionEnabled;
}
function text(id, value) { elements[id].textContent = value; }
function date(value) { return value ? new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) + ' МСК' : 'Прохода ещё не было'; }
function node(tag, content, className) { const element = document.createElement(tag); element.textContent = content; if (className) element.className = className; return element; }
function selectedTickers() { return [...elements['asset-options'].querySelectorAll('input:checked')].map(input => input.value); }
function strategyDetails() {
  const descriptor = view?.strategies?.find(strategy => strategy.id === elements['strategy-select'].value);
  text('strategy-description', descriptor ? descriptor.description + ' · ' + descriptor.suitableRegime : 'Настройки ещё не подключены.');
  elements['strategy-rules'].replaceChildren(...(descriptor?.rules || []).map(rule => node('li', rule)));
}
function renderSelection(data) {
  const selection = data.tradingSelection;
  text('selection-revision', selection ? 'Настройки #' + selection.revision : 'Не подключено');
  elements['strategy-select'].replaceChildren();
  for (const descriptor of data.strategies || []) {
    const option = node('option', descriptor.name); option.value = descriptor.id;
    elements['strategy-select'].append(option);
  }
  if (selection) elements['strategy-select'].value = selection.strategyId;
  strategyDetails();
  elements['asset-options'].replaceChildren();
  for (const ticker of data.availableTickers || []) {
    const label = node('label', '', 'asset-option'); const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.value = ticker; checkbox.checked = selection?.tickers.includes(ticker) || false;
    checkbox.addEventListener('change', controls);
    label.append(checkbox, node('span', ticker)); elements['asset-options'].append(label);
  }
  if (!data.availableTickers?.length) elements['asset-options'].append(node('p', 'Список активов ещё не доступен.', 'muted'));
  text('selected-assets', selection ? 'Применены: ' + selection.tickers.join(', ') : 'Настройки ещё не подключены.');
  elements['recommendation-list'].replaceChildren();
  const recommendations = data.recommendations || [];
  text('recommendation-count', String(recommendations.length));
  if (!recommendations.length) elements['recommendation-list'].append(node('article', 'Ждём анализ выбранных активов.', 'empty'));
  const statuses = { signal: 'Есть сигнал', wait: 'Ждём условия', blocked: 'Ограничение', error: 'Требует проверки' };
  const amount = value => typeof value === 'number' && Number.isFinite(value) ? money.format(value) : 'Нет данных';
  for (const item of recommendations) {
    const card = node('article', '', 'recommendation-card'); const heading = node('div', '', 'section-head');
    heading.append(node('h3', item.ticker), node('span', statuses[item.status] || 'Требует проверки', 'tag'));
    card.append(heading, node('p', item.score + ' баллов пригодности', 'score'));
    const reasons = node('ul', '', 'strategy-rules'); for (const reason of item.reasons) reasons.append(node('li', reason)); card.append(reasons);
    const metrics = node('dl', '', 'recommendation-metrics');
    for (const [label, value] of [['Один лот', item.lotCostRub], ['Расходы плана / одного лота без сигнала', item.roundTripCostsRub],
      ['Расчётный риск', item.totalRiskRub], ['Потенциальная прибыль после расходов', item.netRewardRub],
      ['Вход', item.entryPrice], ['Стоп', item.stopPrice], ['Цель', item.targetPrice]]) {
      const valueText = ['Вход','Стоп','Цель'].includes(label) && typeof value==='number' && Number.isFinite(value) ? tradePrice.format(value) : amount(value);
      const line = node('div', ''); line.append(node('dt', label), node('dd', valueText)); metrics.append(line);
    }
    card.append(metrics); elements['recommendation-list'].append(card);
  }
}
function render(data) {
  view = data;
  renderSelection(data);
  const sourceState = data.marketSources;
  for (const source of sourceState?.sources || []) {
    const code = source.countryCode;
    const flag = typeof code === 'string' && /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(c => 127397 + c.charCodeAt(0))) : '🌐';
    text('source-' + source.id, flag + ' ' + (source.id === 'computer' ? 'Компьютер' : 'Сервер'));
  }
  text('source-summary', sourceState ? 'Выбран: ' + (sourceState.selected === 'computer' ? 'Компьютер' : 'Сервер') + (sourceState.busy ? ' · выполняется проход' : '') : 'Источники ещё не подключены.');
  text('source-checks', (sourceState?.sources || []).map(item => (item.id === 'computer' ? 'Компьютер' : 'Сервер') + ': ' + (!item.configured ? 'не подключён' : item.available ? 'API доступен' : item.checkedAt ? 'доступ не подтверждён' : 'не проверен') + (item.checkedAt ? ' · ' + date(item.checkedAt) : '')).join(' / ') || 'Проверок ещё не было.');
  text('source-dialog-summary', elements['source-summary'].textContent);
  text('source-dialog-checks', elements['source-checks'].textContent);
  text('capital', money.format(data.limits.capitalRub)); text('trade-risk', money.format(data.limits.tradeRiskRub));
  text('day-risk', money.format(data.limits.dailyRiskRub)); text('position-limit', money.format(data.limits.positionRub));
  text('commission', percent.format(data.limits.commissionRate)); text('slippage', percent.format(data.limits.slippageRate));
  text('loss-limit', money.format(data.limits.dailyLossRub)); text('updated', date(data.observedAt));
  text('mode', 'Наблюдение');
  const executor = data.execution.mode === 'sandbox' ? 'Песочница' : data.execution.mode === 'disabled' ? 'Отключён' : 'Не подтверждён';
  text('executor-state', executor);
  text('confirm-kill-mode', 'Панель: наблюдение. Исполнитель: ' + executor + '. Реальные заявки закрыты.');
  text('scanner-state', data.scanner.paused ? 'Пауза' : !data.scanner.lastScanAt ? 'Ждём данные'
    : !data.scanner.fresh ? 'Данные устарели' : data.scanner.errors ? 'Есть ошибки анализа' : 'Свежие данные');
  text('scanner-summary', 'Проверено инструментов: ' + data.scanner.scanned + ' · ошибок: ' + data.scanner.errors);
  text('scanner-date', 'Последний проход: ' + date(data.scanner.lastScanAt));
  text('scanner-toggle', data.scanner.paused ? 'Продолжить сканирование' : 'Приостановить сканирование');
  renderCandidates();
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
    card.append(node('h3', 'Песочница · сценарий #' + result.scenarioId),
      node('p', 'Продано: ' + result.soldLots + ' лот. · остаток: ' + result.remainingLots + ' лот.'),
      node('strong', result.netPnl === null ? 'Результат не подтверждён' : result.netPnl),
      node('p', result.complete ? 'Полное исполнение и пустой счёт подтверждены при сверке.' : 'Полный цикл ещё не подтверждён.'),
      node('p', 'Последняя сверка: ' + new Date(result.observedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) + ' МСК · резерв риска сохранён', 'muted'));
    elements['sandbox-results'].append(card);
  }
}
function renderCandidates() {
  if (!view) {
    text('candidate-count', 'Нет данных');
    elements['candidate-list'].replaceChildren(node('article', 'Нет подтверждённых данных. Откройте панель в Telegram и обновите данные.', 'empty'));
    return;
  }
  const query = elements['candidate-search'].value.trim().toLocaleUpperCase('ru-RU');
  const candidates = (view?.candidates || []).filter(candidate => candidate.ticker.toLocaleUpperCase('ru-RU').includes(query));
  text('candidate-count', query ? candidates.length + ' из ' + view.candidates.length : String(candidates.length));
  elements['candidate-list'].replaceChildren();
  if (!candidates.length) elements['candidate-list'].append(node('article', query ? 'В текущем списке нет кандидатов по запросу.' : 'Свежих кандидатов пока нет. Сделка не обязательна.', 'empty'));
  for (const candidate of candidates) {
    const card = node('article', ''); const heading = node('div', '', 'section-head');
    heading.append(node('h3', candidate.ticker), node('span', date(candidate.observedAt))); card.append(heading);
    const prices = node('div', '', 'candidate-prices');
    for (const [label, value] of [['Вход', candidate.entryRub], ['Стоп', candidate.stopRub], ['Цель', candidate.targetRub]]) {
      const item = node('div', ''); item.append(node('span', label), node('strong', tradePrice.format(value))); prices.append(item);
    }
    card.append(prices, node('p', 'Сценарий #' + candidate.id + ' · не разрешение на сделку', 'muted')); elements['candidate-list'].append(card);
  }
}
async function request(action, details = {}) {
  if (!auth || expired || busy || (action && (!access || needsReconcile))) return;
  busy = true; controls();
  notice(action ? 'Выполняем действие. Ждём подтверждения сервера…' : 'Обновляем данные…', false, Boolean(action));
  let acknowledged = false;
  try {
    const response = await fetch(action ? '/api/action' : '/api/view', { method: action ? 'POST' : 'GET',
      headers: { Authorization: 'tma ' + auth, ...(action ? { 'Content-Type': 'application/json' } : {}) },
      ...(action ? { body: JSON.stringify({ ...details, action }) } : {}), cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
    if (response.status === 401) { acknowledged = true; access = false; expired = true; throw new Error('Доступ истёк или не разрешён. Закройте панель и откройте её кнопкой в личном чате бота.'); }
    if (response.status === 409 && ['strategy-select', 'assets-select'].includes(action)) {
      acknowledged = true; needsReconcile = true;
      const current = await fetch('/api/view', { headers: { Authorization: 'tma ' + auth }, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
      if (current.status === 401) { access = false; expired = true; }
      if (current.ok) { render(await current.json()); access = true; needsReconcile = false; }
      throw new Error(current.ok ? 'Настройки изменились или выполняется проход. Экран обновлён; проверьте выбор перед повтором.' : 'Настройки изменились. Обновление не подтверждено; переоткройте панель или обновите данные.');
    }
    if (!response.ok) {
      acknowledged = response.status === 400 || response.status === 429;
      throw new Error(response.status === 429 ? 'Слишком много запросов. Подождите минуту.' : 'Данные не подтверждены. Попробуйте обновить экран.');
    }
    const data = await response.json(); render(data); access = true; needsReconcile = false; acknowledged = true;
    if (action?.startsWith('source-')) elements['source-dialog'].close();
    notice(action === 'kill' ? 'Новые входы запрещены. Уже открытые позиции не закрывались.'
      : ['strategy-select', 'assets-select'].includes(action) ? 'Выбор сохранён. Рекомендации появятся после нового прохода.'
        : 'Данные подтверждены сервером. Реальные заявки отключены; sandbox-контроль показан отдельно.');
  } catch (error) {
    if (!acknowledged) needsReconcile = true;
    notice(action && !acknowledged ? 'Исход действия не подтверждён. Обновите данные и проверьте состояние перед повтором.'
      : error instanceof Error ? error.message : 'Соединение прервано.', true);
  }
  finally {
    busy = false; controls();
    if (action?.startsWith('source-') && elements['source-dialog'].open && elements.notice.classList.contains('error')) {
      elements['source-close'].focus({ preventScroll: true });
    }
  }
}
for (const button of document.querySelectorAll('[data-tab]')) button.addEventListener('click', () => {
  for (const section of document.querySelectorAll('.panel')) section.hidden = section.id !== button.dataset.tab;
  for (const item of document.querySelectorAll('[data-tab]')) { if (item === button) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); }
  elements[button.dataset.tab + '-title']?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
});
elements['candidate-search'].addEventListener('input', renderCandidates);
elements.refresh.addEventListener('click', () => request());
elements['strategy-select'].addEventListener('change', () => { strategyDetails(); controls(); });
elements['save-strategy'].addEventListener('click', () => request('strategy-select', {
  strategyId: elements['strategy-select'].value, expectedRevision: view?.tradingSelection?.revision }));
elements['save-assets'].addEventListener('click', () => request('assets-select', {
  tickers: selectedTickers(), expectedRevision: view?.tradingSelection?.revision }));
for (const source of ['server', 'computer']) elements['source-' + source].addEventListener('click', () => request('source-' + source));
elements['scanner-toggle'].addEventListener('click', () => request(view?.scanner.paused ? 'resume' : 'pause'));
function openDialog(id, trigger) {
  dialogTrigger = trigger;
  if (id === 'source-dialog') text('source-feedback', '');
  elements[id].showModal();
}
for (const id of ['source-dialog', 'confirm-kill']) elements[id].addEventListener('close', () => {
  const fallback = id === 'confirm-kill' ? elements['risk-title'] : elements.refresh.disabled ? elements['overview-title'] : elements.refresh;
  (dialogTrigger?.disabled ? fallback : dialogTrigger)?.focus({ preventScroll: true });
});
elements['source-open'].addEventListener('click', () => { if (!elements['source-open'].disabled) openDialog('source-dialog', elements['source-open']); });
elements['source-close'].addEventListener('click', () => elements['source-dialog'].close());
elements.kill.addEventListener('click', () => { if (!elements.kill.disabled) openDialog('confirm-kill', elements.kill); });
elements['cancel-kill'].addEventListener('click', () => elements['confirm-kill'].close());
elements['confirm-kill-button'].addEventListener('click', () => { elements['confirm-kill'].close(); void request('kill'); });
telegram?.ready(); telegram?.expand();
controls();
if (auth) { void request(); } else { text('mode', 'Нужен вход через Telegram'); notice('Откройте панель кнопкой «Открыть Mini App» в личном чате бота. В обычном браузере данные и управление закрыты.'); }
