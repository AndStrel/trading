// Optional browser acceptance. Uses only fictional local dependencies and never a broker/.env.
// Build first. Supply a Playwright module path if it is not installed in this checkout.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMiniAppServer } from '../dist/web/mini-app-server.js';
import { STRATEGY_CATALOG } from '../dist/strategies/catalog.js';

const { chromium } = await import(process.argv[2] || 'playwright');
const output = process.argv[3] || mkdtempSync(join(tmpdir(), 'trading-design-'));
mkdirSync(output, { recursive: true });
const now = new Date('2026-10-03T10:00:00Z');
const token = 'fictional-local-browser-fixture-not-a-broker-token';
const fields = new URLSearchParams({ auth_date: String(now.getTime() / 1000), user: JSON.stringify({ id: 777 }) });
const check = [...fields].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + '=' + v).join('\n');
const secret = createHmac('sha256', 'WebAppData').update(token).digest();
fields.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
const initData = fields.toString();
const recommendation = (ticker, status) => ({ ticker, status, score: status === 'signal' ? 80 : 30,
  reasons: status === 'signal' ? ['Локальная фикстура: условия правила выполнены; это не рыночный сигнал.']
    : ['Локальная фикстура: ждём подтверждение правила.'], lotCostRub: 55, roundTripCostsRub: 0.4,
  totalRiskRub: status === 'signal' ? 10 : null, netRewardRub: status === 'signal' ? 20 : null,
  entryPrice: status === 'signal' ? 4.1235 : null, stopPrice: status === 'signal' ? 4.10 : null,
  targetPrice: status === 'signal' ? 4.2345 : null });
const initial = () => ({ observedAt: now.toISOString(),
  limits: { capitalRub: 1000, tradeRiskRub: 20, dailyRiskRub: 60, dailyLossRub: 60,
    positionRub: 990, commissionRate: 0.003, slippageRate: 0.0005 },
  scanner: { paused: false, fresh: true, errors: 0, scanned: 2, lastScanAt: now.toISOString() },
  execution: { mode: 'disabled', killed: false, liveSubmissionAllowed: false, actualPnlRub: null, lossMonitorReady: false },
  sandboxLossGuard: { state: 'waiting', checkedAt: null, closedLoss: null, estimatedOpenLoss: null, totalLoss: null },
  sandboxResults: [], strategies: STRATEGY_CATALOG,
  tradingSelection: { strategyId: STRATEGY_CATALOG[0].id, revision: 1, tickers: ['VTBR', 'SBER'] },
  availableTickers: ['VTBR', 'SBER', 'IRAO'],
  recommendations: [recommendation('VTBR', 'signal'), recommendation('SBER', 'wait')],
  candidates: [{ id: 1, ticker: 'VTBR', observedAt: now.toISOString(), entryRub: 4.1235, stopRub: 4.10, targetRub: 4.2345 }],
});
let fixture = initial();
let selectedSource = 'server';
const dependencies = {
  token, origin: '', allowedPrivateIds: ['777'], now: () => now, view: () => structuredClone(fixture),
  action(action) { if (action === 'kill') fixture.execution.killed = true;
    else fixture.scanner.paused = action === 'pause'; },
  marketSources: { view: () => ({ selected: selectedSource, busy: false, sources: [
    { id: 'server', configured: true, available: true, countryCode: 'RU', checkedAt: now.toISOString() },
    { id: 'computer', configured: true, available: false, countryCode: 'DE', checkedAt: now.toISOString() },
  ] }) },
  selectMarketSource(source) { if (source !== 'server') throw new Error('Unavailable fixture source'); selectedSource = source; },
  selectTradingStrategy(strategyId, revision) {
    assert.equal(revision, fixture.tradingSelection.revision);
    fixture.tradingSelection = { ...fixture.tradingSelection, strategyId, revision: revision + 1 };
    fixture.recommendations = fixture.tradingSelection.tickers.map(ticker => recommendation(ticker, 'wait'));
    fixture.candidates = [];
  },
  selectTradingAssets(tickers, revision) {
    assert.equal(revision, fixture.tradingSelection.revision);
    fixture.tradingSelection = { ...fixture.tradingSelection, tickers, revision: revision + 1 };
    fixture.recommendations = tickers.map(ticker => recommendation(ticker, 'wait')); fixture.candidates = [];
  },
};
const server = createMiniAppServer(dependencies);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
dependencies.origin = origin;
const browser = await chromium.launch({ headless: true, ...(process.argv[4] ? { executablePath: process.argv[4] } : {}) });
const results = [];
const errors = [];
const contrasts = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    contentType: 'text/javascript', body: 'window.Telegram={WebApp:{initData:' + JSON.stringify(initData) + ',ready(){},expand(){}}};',
  }));
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin) || url === 'https://telegram.org/js/telegram-web-app.js') return route.fallback();
    errors.push('Unexpected external request: ' + url); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Данные подтверждены'));
  // Screenshot provenance is explicit. This element exists only in this test browser DOM.
  await page.evaluate(() => { const banner = document.createElement('p'); banner.className = 'notice';
    banner.textContent = 'Локальная тестовая фикстура · не брокерские данные'; document.querySelector('.app').prepend(banner); });
  // Includes every named width in preview/spacing-tokens.html plus nearby mobile/layout boundaries.
  const widths = [360, 375, 390, 414, 430, 480, 560, 600, 768, 820, 1024, 1366, 1440, 1920];
  for (const theme of ['dark', 'light']) {
    if (await page.getAttribute('html', 'data-theme') !== theme) await page.locator('#theme').click();
    assert.equal(await page.getByRole('button', { name: theme === 'dark' ? 'Светлая тема' : 'Тёмная тема', exact: true }).count(), 1);
    const contrast = await page.evaluate(theme => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const painter = canvas.getContext('2d');
      const rgb = value => { painter.fillStyle = value; painter.fillRect(0, 0, 1, 1); return [...painter.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const luminance = color => rgb(color).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const ratio = (a, b) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); };
      const style = getComputedStyle(document.body);
      const token = name => style.getPropertyValue(name);
      return { theme, main: ratio(token('--fg'), token('--bg')), muted: ratio(token('--muted'), token('--surface')),
        primary: ratio(token('--on-accent'), token('--accent')), control: ratio(token('--control-border'), token('--bg')),
        focus: ratio(token('--focus'), token('--bg')) };
    }, theme);
    for (const key of ['main', 'muted', 'primary']) assert.ok(contrast[key] >= 4.5, JSON.stringify(contrast));
    for (const key of ['control', 'focus']) assert.ok(contrast[key] >= 3, JSON.stringify(contrast));
    contrasts.push(contrast);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      for (const tab of ['overview', 'trading', 'candidates', 'risk']) {
        await page.locator('[data-tab="' + tab + '"]').click();
        const result = await page.evaluate(({ theme, width, tab }) => {
          const app = document.querySelector('.app');
          const panel = document.getElementById(tab);
          const overflow = document.documentElement.scrollWidth > innerWidth;
          const primary = [...panel.querySelectorAll('.primary')].filter(el => el.getClientRects().length);
          const controls = [...document.querySelectorAll('button,select,input:not([type="checkbox"]),.asset-option')]
            .filter(el => el.getClientRects().length && !el.closest('dialog:not([open])'));
          const small = controls.filter(el => el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)
            .map(el => el.id || el.className);
          const clippedLabels = [...document.querySelectorAll('nav button')].filter(button =>
            button.querySelector('span').getBoundingClientRect().width > button.getBoundingClientRect().width).map(button => button.dataset.tab);
          return { theme, width, tab, overflow, clippedLabels, appWidth: app.getBoundingClientRect().width,
            primary: primary.length, small, focused: document.activeElement.id,
            displayFont: getComputedStyle(panel.querySelector('h1')).fontFamily,
            radius: getComputedStyle(panel.querySelector('article')).borderRadius };
        }, { theme, width, tab });
        assert.equal(result.overflow, false, JSON.stringify(result));
        assert.deepEqual(result.clippedLabels, [], JSON.stringify(result));
        assert.ok(result.appWidth <= 560, JSON.stringify(result));
        assert.ok(result.primary <= 1, JSON.stringify(result));
        assert.deepEqual(result.small, [], JSON.stringify(result));
        assert.equal(result.focused, tab + '-title');
        assert.ok(result.displayFont.startsWith('Georgia'));
        assert.equal(result.radius, '8px');
        results.push(result);
        if (width === 390 || width === 1920) {
          await page.screenshot({ path: join(output, theme + '-' + tab + '-' + width + '.png'), fullPage: true });
        }
      }
      await page.locator('[data-tab="overview"]').click();
      await page.locator('#source-open').click();
      assert.equal(await page.locator('#source-dialog').evaluate(el => el.open), true);
      assert.equal(await page.locator('#source-computer').isDisabled(), true);
      const sourceRect = await page.locator('#source-dialog').boundingBox();
      assert.ok(sourceRect.x >= 0 && sourceRect.x + sourceRect.width <= width);
      if (width === 390) await page.screenshot({ path: join(output, theme + '-source-dialog.png') });
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'source-open');
      await page.locator('[data-tab="risk"]').click();
      await page.locator('#kill').click();
      const killRect = await page.locator('#confirm-kill').boundingBox();
      assert.ok(killRect.x >= 0 && killRect.x + killRect.width <= width);
      if (width === 390) await page.screenshot({ path: join(output, theme + '-kill-dialog.png') });
      await page.locator('#cancel-kill').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'kill');
    }
  }
  // A failed source request stays inside the modal; feedback and recovery are accessible there.
  await page.locator('[data-tab="overview"]').click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  assert.ok(await page.evaluate(() => scrollY) > 0);
  await page.locator('[data-tab="trading"]').click();
  assert.equal(await page.evaluate(() => scrollY), 0);
  const headingTop = await page.locator('#trading-title').evaluate(el => el.getBoundingClientRect().top);
  assert.ok(headingTop >= 0 && headingTop < 844);
  await page.locator('[data-tab="overview"]').click();
  for (const status of [400, 503, 401]) {
    await page.route(origin + '/api/action', route => route.fulfill({ status, contentType: 'application/json', body: '{}' }));
    await page.locator('#source-open').click(); await page.locator('#source-server').click();
    await page.waitForFunction(() => document.getElementById('source-feedback').classList.contains('error'));
    assert.equal(await page.locator('#source-feedback').isVisible(), true);
    assert.equal(await page.locator('#source-dialog').getAttribute('aria-busy'), 'false');
    await page.waitForFunction(() => document.activeElement.id === 'source-close');
    if (status === 503) assert.match(await page.locator('#source-feedback').textContent(), /Исход действия не подтверждён.*Закройте это окно/);
    if (status === 401) assert.match(await page.locator('#source-feedback').textContent(), /Доступ истёк/);
    await page.locator('#source-close').click();
    await page.waitForFunction(expired => document.activeElement.id === (expired ? 'overview-title' : document.getElementById('source-open').disabled ? 'refresh' : 'source-open'), status === 401);
    await page.unroute(origin + '/api/action');
    if (status === 401) {
      assert.equal(await page.locator('#refresh').isDisabled(), true);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Данные подтверждены'));
    } else if (status === 503) {
      assert.equal(await page.locator('#source-open').isDisabled(), true);
      await page.locator('#refresh').click();
      await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Данные подтверждены'));
    }
  }
  // Server-backed interactions with fictional, isolated dependencies.
  await page.locator('[data-tab="trading"]').click();
  await page.locator('#strategy-select').selectOption('vwap-reclaim-v1');
  await page.locator('#save-strategy').click();
  await page.waitForFunction(() => document.getElementById('selection-revision').textContent === 'Настройки #2');
  assert.match(await page.locator('#notice').textContent(), /Выбор сохранён/);
  await page.locator('[data-tab="overview"]').click();
  await page.locator('#scanner-toggle').click();
  await page.waitForFunction(() => document.getElementById('scanner-state').textContent === 'Пауза');
  await page.locator('[data-tab="risk"]').click();
  await page.locator('#kill').click(); await page.locator('#confirm-kill-button').click();
  await page.waitForFunction(() => document.getElementById('kill').textContent === 'Новые входы уже запрещены');
  await page.waitForFunction(() => document.activeElement.id === 'risk-title');
  assert.equal(await page.locator('#kill').isDisabled(), true);
  assert.equal(fixture.execution.liveSubmissionAllowed, false);
  const unauthenticated = await context.request.get(origin + '/api/view');
  assert.equal(unauthenticated.status(), 401);
  assert.equal((await context.request.post(origin + '/api/action', { headers: { Authorization: 'tma ' + initData, Origin: origin },
    data: { action: 'buy' } })).status(), 400);
  // Persisted light theme after a reload, no auth/data saved to storage.
  if (await page.getAttribute('html', 'data-theme') !== 'light') await page.locator('#theme').click();
  await page.reload(); await page.waitForFunction(() => document.getElementById('notice').textContent.includes('Данные подтверждены'));
  assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ['trading-kit:theme']);
  await context.close();
  // Safe-area + long financial values + stale/empty states, rendered by the same production assets.
  fixture = { ...initial(), limits: { ...initial().limits, capitalRub: 999999999999.99, positionRub: 999999999999.99 },
    scanner: { ...initial().scanner, fresh: false, errors: 1 },
    recommendations: [{ ...recommendation('VERYLONGTICKER16', 'blocked'), reasons: ['Локальная фикстура: ' + 'ПричинаБезПробелов'.repeat(18)],
      lotCostRub: 999999999999.99, roundTripCostsRub: 999999999999.99 }],
    candidates: [{ ...initial().candidates[0], ticker: 'VERYLONGTICKER16', entryRub: 4.123456789, targetRub: 0.000000001 }],
    sandboxLossGuard: { state: 'stale', checkedAt: now.toISOString(),
      closedLoss: null, estimatedOpenLoss: null, totalLoss: null } };
  const safeContext = await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: 'reduce' });
  await safeContext.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'window.Telegram={WebApp:{initData:' + JSON.stringify(initData) + ',ready(){},expand(){}}};' }));
  const safePage = await safeContext.newPage();
  safePage.on('pageerror', error => errors.push(error.message));
  await safePage.goto(origin); await safePage.waitForFunction(() => document.getElementById('notice').textContent.includes('Данные подтверждены'));
  await safePage.evaluate(() => { const root = document.documentElement;
    for (const [name, value] of Object.entries({ '--tg-safe-area-inset-top': '24px', '--tg-content-safe-area-inset-top': '32px',
      '--tg-safe-area-inset-bottom': '34px', '--tg-content-safe-area-inset-bottom': '16px' })) root.style.setProperty(name, value);
  });
  const insets = await safePage.evaluate(() => ({ top: parseFloat(getComputedStyle(document.querySelector('.app')).paddingTop),
    bottom: parseFloat(getComputedStyle(document.querySelector('nav')).paddingBottom),
    overflow: document.documentElement.scrollWidth > innerWidth }));
  assert.equal(insets.top, 80); assert.equal(insets.bottom, 58); assert.equal(insets.overflow, false);
  assert.equal(await safePage.locator('#sandbox-loss-state').textContent(), 'Данные устарели');
  assert.equal(await safePage.locator('#scanner-state').textContent(), 'Данные устарели');
  for (const tab of ['overview', 'trading', 'candidates', 'risk']) {
    await safePage.locator('[data-tab="' + tab + '"]').click();
    assert.equal(await safePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'long-value overflow: ' + tab);
  }
  await safePage.locator('[data-tab="candidates"]').click();
  assert.match(await safePage.locator('#candidate-list').textContent(), /4,123456789/);
  assert.match(await safePage.locator('#candidate-list').textContent(), /0,000000001/);
  await safeContext.close();
  if (process.argv[5]) {
    const referenceContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    const reference = await referenceContext.newPage();
    await reference.goto(pathToFileURL(join(process.argv[5], 'ui_kits/app/index.html')).href);
    await reference.screenshot({ path: join(output, 'source-kit-dark-390.png'), fullPage: true });
    await reference.locator('#theme').click();
    await reference.screenshot({ path: join(output, 'source-kit-light-390.png'), fullPage: true });
    await referenceContext.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(output, 'browser-results.json'), JSON.stringify({ fixture: 'fictional local only',
    cases: results.length, widths, themes: ['dark', 'light'], dialogs: widths.length * 4,
    serverBackedActions: ['strategy-select', 'pause', 'kill'], sourceErrors: [400, 503, 401],
    safeArea: insets, longValues: true, contrasts, errors, results }, null, 2));
  console.log(JSON.stringify({ ok: true, cases: results.length, dialogs: widths.length * 4, output }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
