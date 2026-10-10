import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { STRATEGY_CATALOG } from '../strategies/catalog.js';

type Handler = (event?: { preventDefault(): void }) => unknown;
type FocusState = { activeElement: Element | null };

class Element {
  textContent = ''; className = ''; value = ''; type = ''; checked = false; disabled = false; hidden = false;
  dataset: Record<string, string> = {}; children: Element[] = [];
  listeners = new Map<string, Handler>(); attributes = new Map<string, string>();
  classList = {
    toggle: vi.fn((token: string, force?: boolean) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      const add = force ?? !classes.has(token);
      if (add) classes.add(token); else classes.delete(token);
      this.className = [...classes].join(' ');
      return add;
    }),
    add: (...tokens: string[]) => tokens.forEach(token => this.classList.toggle(token, true)),
    remove: (...tokens: string[]) => tokens.forEach(token => this.classList.toggle(token, false)),
    contains: (token: string) => this.className.split(/\s+/).includes(token),
  };
  focus = vi.fn((_options?: { preventScroll?: boolean }) => { if (!this.disabled) this.owner.activeElement = this; });
  scrollIntoView = vi.fn();
  constructor(readonly tagName: string, readonly id = '', private readonly owner: FocusState = { activeElement: null }) {}
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren(...items: Element[]) { this.children = [...items]; }
  addEventListener(name: string, handler: Handler) { this.listeners.set(name, handler); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  get open() { return this.hasAttribute('open'); }
  showModal() { this.setAttribute('open', ''); }
  close() { if (!this.open) return; this.removeAttribute('open'); queueMicrotask(() => { void this.listeners.get('close')?.(); }); }
  click() { if (!this.disabled) { this.focus(); void this.listeners.get('click')?.(); } }
  querySelector(selector: string): Element | null { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): Element[] {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return all;
    return all.filter(item => selector.startsWith('#') ? item.id === selector.slice(1)
      : selector.startsWith('.') ? item.classList.contains(selector.slice(1))
        : selector === 'input:checked' ? item.tagName === 'input' && item.checked : item.tagName === selector);
  }
  // Rendering must never interpret untrusted names/reasons as markup.
  set innerHTML(_value: string) { throw new Error('Unsafe markup rendering'); }
}

function harness(fetch: ReturnType<typeof vi.fn>, options: { auth?: string; savedTheme?: string; storageThrows?: boolean } = {}) {
  const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
  const focusState: FocusState = { activeElement: null };
  const elements = new Map([...html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\sid="([^"]+)"[^>]*)>/g)].map(match => {
    const element = new Element(match[1]!, match[3]!, focusState);
    const attrs = match[2]!;
    element.textContent = html.slice(match.index + match[0].length).split('<', 1)[0]?.trim() ?? '';
    element.className = /\bclass="([^"]*)"/.exec(attrs)?.[1] ?? '';
    element.disabled = /(?:^|\s)disabled(?:\s|$|=)/.test(attrs);
    element.hidden = /(?:^|\s)hidden(?:\s|$|=)/.test(attrs);
    for (const attr of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) element.setAttribute(attr[1]!, attr[2]!);
    return [element.id, element] as const;
  }));
  const tabs = ['overview', 'trading', 'candidates', 'risk'].map(id => {
    const element = new Element('button', '', focusState); element.dataset.tab = id;
    if (id === 'overview') element.setAttribute('aria-current', 'page');
    return element;
  });
  const documentElement = new Element('html', '', focusState);
  const body = new Element('body', '', focusState);
  const document = { documentElement, body, get activeElement() { return focusState.activeElement; },
    createElement: (tag: string) => new Element(tag, '', focusState), getElementById: (id: string) => elements.get(id) ?? null,
    querySelector: (selector: string) => selector === 'main' ? elements.get('app-content') ?? null
      : selector.startsWith('#') ? elements.get(selector.slice(1)) ?? null : null,
    querySelectorAll: (selector: string) => selector === '[id]' ? [...elements.values()] : selector === '[data-tab]' ? tabs
      : selector === '.panel' ? ['overview', 'trading', 'candidates', 'risk'].map(id => elements.get(id)!) : [] };
  const localStorage = { getItem: vi.fn((_key: string) => {
    if (options.storageThrows) throw new Error('Storage unavailable');
    return options.savedTheme ?? null;
  }), setItem: vi.fn((_key: string, _value: string) => {
    if (options.storageThrows) throw new Error('Storage unavailable');
  }) };
  const scrollTo = vi.fn();
  const window = { Telegram: { WebApp: { initData: options.auth ?? 'fixture-auth', ready() {}, expand() {} } },
    localStorage, scrollTo };
  const context = createContext({ window, document, fetch, Intl, AbortSignal, Error, localStorage });
  runInContext(readFileSync(new URL('./public/app.js', import.meta.url), 'utf8'), context);
  return { elements, tabs, document, localStorage, scrollTo };
}

function data(revision = 1, strategyId = 'trend-momentum-v1', tickers = ['VTBR']) {
  return { observedAt: '2026-10-03T10:00:00Z', limits: { capitalRub: 1000, tradeRiskRub: 20, dailyRiskRub: 60,
    positionRub: 990, commissionRate: 0.003, slippageRate: 0.0005, dailyLossRub: 60 },
    scanner: { paused: false, fresh: true, errors: 0, scanned: 1, lastScanAt: '2026-10-03T10:00:00Z' },
    execution: { killed: true }, candidates: [], sandboxResults: [], sandboxLossGuard: { state: 'off' },
    tradingSelection: { strategyId, revision, tickers }, availableTickers: ['VTBR', 'SBER'],
    strategies: STRATEGY_CATALOG.map(strategy => ({ ...strategy, description: '<img src=x onerror=alert(1)>' })),
    recommendations: tickers.map(ticker => ({ ticker, status: 'wait', reasons: ['<b>Нет сигнала</b>'], score: 40,
      lotCostRub: 55, roundTripCostsRub: 0.4, totalRiskRub: null, netRewardRub: null,
      entryPrice: null, stopPrice: null, targetPrice: null })) };
}
const response = (status: number, value?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => value });
const ready = async (elements: Map<string, Element>) => vi.waitFor(() => expect(elements.get('selection-revision')?.textContent).toBe('Настройки #1'));
const chooseStrategy = (elements: Map<string, Element>) => {
  elements.get('strategy-select')!.value = 'vwap-reclaim-v1';
  elements.get('strategy-select')!.listeners.get('change')!();
};
const metricValues = (elements: Map<string, Element>) => {
  const metrics = elements.get('recommendation-list')!.children[0]!.children.find(element => element.tagName === 'dl')!.children;
  return Object.fromEntries(metrics.map(line => [line.children[0]!.textContent, line.children[1]!.textContent]));
};

describe('Mini App browser selection flow', () => {
  it('preserves fractional price ticks while rounding cash costs to kopecks', async () => {
    const fixture = {
      ...data(1, 'trend-momentum-v1', ['IRAO']),
      recommendations: [{ ...data().recommendations[0]!, ticker: 'IRAO',
        entryPrice: 4.1235, stopPrice: 4.10, targetPrice: 4.2345, roundTripCostsRub: 1.235 }],
      candidates: [{ id: 1, ticker: 'IRAO', observedAt: '2026-10-03T10:00:00Z',
        entryRub: 4.1235, stopRub: 4.10, targetRub: 4.2345 }],
    };
    const { elements } = harness(vi.fn().mockResolvedValue(response(200, fixture)));
    await vi.waitFor(() => expect(elements.get('recommendation-count')?.textContent).toBe('1'));
    const metrics = elements.get('recommendation-list')!.children[0]!.children
      .find(element => element.tagName === 'dl')!.children;
    const values = Object.fromEntries(metrics.map(line => [line.children[0]!.textContent, line.children[1]!.textContent]));
    expect(values['Вход']).toContain('4,1235');
    expect(values['Стоп']).toContain('4,10');
    expect(values['Цель']).toContain('4,2345');
    expect(values['Расходы плана / одного лота без сигнала']).toContain('1,24');
    const prices = elements.get('candidate-list')!.children[0]!.children
      .find(element => element.className === 'candidate-prices')!.children;
    expect(prices[0]!.children[1]!.textContent).toContain('4,1235');
    expect(prices[2]!.children[1]!.textContent).toContain('4,2345');
  });

  it('sends the current revision and refreshes a conflicting strategy change without submitting an order', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, data()))
      .mockResolvedValueOnce(response(409)).mockResolvedValueOnce(response(200, data(2, 'vwap-reclaim-v1', ['SBER'])));
    const { elements, tabs } = harness(fetch);
    await vi.waitFor(() => expect(elements.get('selection-revision')?.textContent).toBe('Настройки #1'));
    expect(elements.get('strategy-description')?.textContent).toContain('<img src=x onerror=alert(1)>');
    tabs[1]!.listeners.get('click')!();
    expect(elements.get('trading')?.hidden).toBe(false); expect(elements.get('overview')?.hidden).toBe(true);
    const select = elements.get('strategy-select')!; select.value = 'vwap-reclaim-v1'; select.listeners.get('change')!();
    expect(elements.get('save-strategy')?.disabled).toBe(false);
    elements.get('save-strategy')!.listeners.get('click')!();
    await vi.waitFor(() => expect(elements.get('selection-revision')?.textContent).toBe('Настройки #2'));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/action', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ strategyId: 'vwap-reclaim-v1', expectedRevision: 1, action: 'strategy-select' }),
      credentials: 'omit', headers: { Authorization: 'tma fixture-auth', 'Content-Type': 'application/json' },
    }));
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/view', '/api/action', '/api/view']);
    expect(select.value).toBe('vwap-reclaim-v1');
    expect(elements.get('selected-assets')?.textContent).toBe('Применены: SBER');
    expect(elements.get('notice')?.textContent).toContain('Настройки изменились');
    expect(elements.get('notice')?.classList.contains('error')).toBe(true);
  });
  it('applies asset checkbox choices and renders every selected asset as a recommendation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, data()))
      .mockResolvedValueOnce(response(200, data(2, 'trend-momentum-v1', ['VTBR', 'SBER'])));
    const { elements } = harness(fetch);
    await vi.waitFor(() => expect(elements.get('selected-assets')?.textContent).toBe('Применены: VTBR'));
    const boxes = elements.get('asset-options')!.querySelectorAll('input');
    boxes.find(box => box.value === 'SBER')!.checked = true;
    boxes.find(box => box.value === 'SBER')!.listeners.get('change')!();
    expect(elements.get('save-assets')?.disabled).toBe(false);
    elements.get('save-assets')!.listeners.get('click')!();
    await vi.waitFor(() => expect(elements.get('recommendation-count')?.textContent).toBe('2'));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/action', expect.objectContaining({
      body: JSON.stringify({ tickers: ['VTBR', 'SBER'], expectedRevision: 1, action: 'assets-select' }),
    }));
    expect(elements.get('recommendation-list')?.children).toHaveLength(2);
    expect(elements.get('save-assets')?.disabled).toBe(true);
  });
});

describe('Mini App theme and accessible navigation', () => {
  it('starts dark and persists only the non-sensitive theme choice', () => {
    const { elements, document, localStorage } = harness(vi.fn(), { auth: '' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(elements.get('theme')?.disabled).toBe(false);
    expect(elements.get('theme')?.getAttribute('aria-pressed')).toBeNull();
    expect(elements.get('theme')?.getAttribute('aria-label')).toBeNull();
    expect(elements.get('theme')?.getAttribute('aria-describedby')).toBe('theme-current');
    expect(elements.get('theme')?.textContent).toBe('Светлая тема');
    expect(elements.get('theme-current')?.textContent).toContain('тёмная');
    elements.get('theme')!.click();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(elements.get('theme')?.getAttribute('aria-pressed')).toBeNull();
    expect(elements.get('theme')?.getAttribute('aria-label')).toBeNull();
    expect(elements.get('theme')?.textContent).toBe('Тёмная тема');
    expect(elements.get('theme-current')?.textContent).toContain('светлая');
    expect(localStorage.setItem).toHaveBeenCalledWith('trading-kit:theme', 'light');
    elements.get('theme')!.click();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.setItem).toHaveBeenLastCalledWith('trading-kit:theme', 'dark');
    expect(localStorage.getItem.mock.calls.every(([key]) => key === 'trading-kit:theme')).toBe(true);
    expect(localStorage.setItem.mock.calls.every(([key]) => key === 'trading-kit:theme')).toBe(true);
  });

  it.each(['light', 'dark'])('restores the previously selected %s theme', savedTheme => {
    const { elements, document } = harness(vi.fn(), { auth: '', savedTheme });
    expect(document.documentElement.dataset.theme).toBe(savedTheme);
    expect(elements.get('theme')?.getAttribute('aria-pressed')).toBeNull();
    expect(elements.get('theme')?.getAttribute('aria-label')).toBeNull();
    expect(elements.get('theme')?.textContent).toBe(savedTheme === 'dark' ? 'Светлая тема' : 'Тёмная тема');
    expect(elements.get('theme-current')?.textContent).toContain(savedTheme === 'dark' ? 'тёмная' : 'светлая');
  });

  it('ignores invalid stored themes and still switches when browser storage is unavailable', () => {
    const invalid = harness(vi.fn(), { auth: '', savedTheme: 'system-credentials' });
    expect(invalid.document.documentElement.dataset.theme).toBe('dark');
    const unavailable = harness(vi.fn(), { auth: '', storageThrows: true });
    expect(unavailable.document.documentElement.dataset.theme).toBe('dark');
    unavailable.elements.get('theme')!.click();
    expect(unavailable.document.documentElement.dataset.theme).toBe('light');
  });

  it('keeps private actions disabled without authentication while navigation and theme remain usable', () => {
    const fetch = vi.fn();
    const { elements, tabs } = harness(fetch, { auth: '' });
    for (const id of ['refresh', 'scanner-toggle', 'kill', 'source-open', 'source-server', 'source-computer',
      'strategy-select', 'save-strategy', 'save-assets', 'confirm-kill-button']) {
      expect(elements.get(id)?.disabled, id).toBe(true);
    }
    expect(elements.get('theme')?.disabled).toBe(false);
    expect(tabs.every(tab => !tab.disabled)).toBe(true);
    elements.get('scanner-toggle')!.click();
    elements.get('kill')!.click();
    elements.get('source-open')!.click();
    expect(elements.get('source-dialog')?.open).toBe(false);
    expect(elements.get('confirm-kill')?.open).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('focuses each selected heading, resets the new panel to the top instantly and marks only the selected navigation item', () => {
    const { elements, tabs, document, scrollTo } = harness(vi.fn(), { auth: '' });
    for (const [index, tab] of tabs.entries()) {
      tab.click();
      const selected = tab.dataset.tab!;
      expect(document.activeElement).toBe(elements.get(selected + '-title'));
      expect(elements.get(selected + '-title')?.focus).toHaveBeenLastCalledWith({ preventScroll: true });
      expect(scrollTo).toHaveBeenCalledTimes(index + 1);
      expect(scrollTo).toHaveBeenNthCalledWith(index + 1, { top: 0, behavior: 'instant' });
      for (const panel of ['overview', 'trading', 'candidates', 'risk']) {
        expect(elements.get(panel)?.hidden).toBe(panel !== selected);
      }
      for (const item of tabs) expect(item.getAttribute('aria-current')).toBe(item === tab ? 'page' : null);
    }
    expect(scrollTo).toHaveBeenCalledTimes(tabs.length);
    for (const element of elements.values()) expect(element.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('Mini App confirmed state and safe mutation feedback', () => {
  it('allows an explicit refresh after an initial network failure without exposing private actions', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce(response(200, data()));
    const { elements } = harness(fetch);
    await vi.waitFor(() => expect(elements.get('notice')?.classList.contains('error')).toBe(true));
    expect(elements.get('refresh')?.disabled).toBe(false);
    expect(elements.get('scanner-toggle')?.disabled).toBe(true);
    expect(elements.get('source-open')?.disabled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    elements.get('refresh')!.click();
    await ready(elements);
    expect(elements.get('scanner-toggle')?.disabled).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('filters candidates locally, distinguishes no matches from no data, and preserves the current query on refresh', async () => {
    const fixture = { ...data(), candidates: [
      { id: 1, ticker: 'SBER', observedAt: '2026-10-03T10:00:00Z', entryRub: 300, stopRub: 297, targetRub: 306 },
      { id: 2, ticker: 'VTBR', observedAt: '2026-10-03T10:00:00Z', entryRub: 55, stopRub: 54, targetRub: 57 },
    ] };
    const fetch = vi.fn().mockResolvedValue(response(200, fixture));
    const { elements } = harness(fetch);
    await ready(elements);
    const search = elements.get('candidate-search')!;
    search.value = ' sbe '; search.listeners.get('input')!();
    expect(elements.get('candidate-count')?.textContent).toBe('1 из 2');
    expect(elements.get('candidate-list')?.children).toHaveLength(1);
    expect(elements.get('candidate-list')!.children[0]!.children[0]!.children[0]!.textContent).toBe('SBER');
    expect(fetch).toHaveBeenCalledTimes(1);
    elements.get('refresh')!.click();
    await vi.waitFor(() => expect(elements.get('refresh')?.disabled).toBe(false));
    expect(search.value).toBe(' sbe ');
    expect(elements.get('candidate-count')?.textContent).toBe('1 из 2');
    search.value = 'GAZP'; search.listeners.get('input')!();
    expect(elements.get('candidate-count')?.textContent).toBe('0 из 2');
    expect(elements.get('candidate-list')!.children[0]!.textContent).toContain('нет кандидатов по запросу');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not present the unauthenticated local search as a completed analysis with zero candidates', () => {
    const fetch = vi.fn();
    const { elements } = harness(fetch, { auth: '' });
    const search = elements.get('candidate-search')!;
    search.value = 'SBER'; search.listeners.get('input')!();
    expect(elements.get('candidate-count')?.textContent).toBe('Нет данных');
    expect(elements.get('candidate-list')!.children[0]!.textContent).toContain('Нет подтверждённых данных');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows unknown recommendation amounts as no data while retaining actual zero values', async () => {
    const fixture = data();
    fixture.recommendations[0]!.roundTripCostsRub = 0;
    const { elements } = harness(vi.fn().mockResolvedValue(response(200, fixture)));
    await ready(elements);
    const values = metricValues(elements);
    expect(values['Расчётный риск']).toBe('Нет данных');
    expect(values['Потенциальная прибыль после расходов']).toBe('Нет данных');
    expect(values['Вход']).toBe('Нет данных');
    expect(values['Стоп']).toBe('Нет данных');
    expect(values['Цель']).toBe('Нет данных');
    expect(values['Расходы плана / одного лота без сигнала']).toContain('0,00');
  });

  it('disables an already-applied entry ban and does not offer a redundant confirmation', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, data()));
    const { elements } = harness(fetch);
    await ready(elements);
    expect(elements.get('kill')?.disabled).toBe(true);
    expect(elements.get('kill')?.textContent).toBe('Новые входы уже запрещены');
    elements.get('kill')!.click();
    expect(elements.get('confirm-kill')?.open).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('restores trigger focus after cancelling the entry-ban dialog and makes no request', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { ...data(), execution: { killed: false } }));
    const { elements, document } = harness(fetch);
    await ready(elements);
    elements.get('kill')!.click();
    expect(elements.get('confirm-kill')?.open).toBe(true);
    expect(elements.get('confirm-kill-mode')?.textContent.toLowerCase()).toContain('наблюдение');
    elements.get('cancel-kill')!.click();
    expect(elements.get('confirm-kill')?.open).toBe(false);
    await vi.waitFor(() => expect(document.activeElement).toBe(elements.get('kill')));
    expect(elements.get('kill')?.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('submits an entry ban once, waits for confirmation, and never claims that positions were closed', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, { ...data(), execution: { killed: false } }))
      .mockResolvedValueOnce(response(200, data()));
    const { elements } = harness(fetch);
    await ready(elements);
    elements.get('kill')!.click();
    elements.get('confirm-kill-button')!.click();
    elements.get('confirm-kill-button')!.click();
    await vi.waitFor(() => expect(elements.get('kill')?.disabled).toBe(true));
    await vi.waitFor(() => expect(elements.get('notice')?.textContent).toContain('Новые входы запрещены'));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/action', expect.objectContaining({ body: JSON.stringify({ action: 'kill' }) }));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(elements.get('notice')?.textContent).toContain('Уже открытые позиции не закрывались');
  });

  it('exposes only configured and available source actions and restores focus on closing the source dialog', async () => {
    const fixture = { ...data(), marketSources: { selected: 'server', busy: false, sources: [
      { id: 'server', configured: true, available: true, countryCode: 'RU', checkedAt: '2026-10-03T10:00:00Z' },
      { id: 'computer', configured: true, available: false, countryCode: 'DE', checkedAt: '2026-10-03T10:00:00Z' },
    ] } };
    const fetch = vi.fn().mockResolvedValue(response(200, fixture));
    const { elements, document } = harness(fetch);
    await ready(elements);
    elements.get('source-open')!.click();
    expect(elements.get('source-dialog')?.open).toBe(true);
    expect(elements.get('source-server')?.disabled).toBe(false);
    expect(elements.get('source-computer')?.disabled).toBe(true);
    elements.get('source-computer')!.click();
    expect(fetch).toHaveBeenCalledTimes(1);
    elements.get('source-close')!.click();
    expect(elements.get('source-dialog')?.open).toBe(false);
    await vi.waitFor(() => expect(document.activeElement).toBe(elements.get('source-open')));
    expect(elements.get('source-open')?.focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it('keeps an unconfigured source disabled even if an inconsistent fixture reports it available', async () => {
    const fixture = { ...data(), marketSources: { selected: 'server', busy: false, sources: [
      { id: 'server', configured: true, available: true }, { id: 'computer', configured: false, available: true },
    ] } };
    const { elements } = harness(vi.fn().mockResolvedValue(response(200, fixture)));
    await ready(elements);
    expect(elements.get('source-computer')?.disabled).toBe(true);
  });

  it('keeps the source chooser open until a successful server response acknowledges the new source', async () => {
    const sourceState = { selected: 'server', busy: false, sources: [
      { id: 'server', configured: true, available: true }, { id: 'computer', configured: true, available: true },
    ] };
    let resolveMutation!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>(resolve => { resolveMutation = resolve; });
    const fetch = vi.fn().mockResolvedValueOnce(response(200, { ...data(), marketSources: sourceState })).mockReturnValueOnce(pending);
    const { elements, document } = harness(fetch);
    await ready(elements);
    elements.get('source-open')!.click();
    elements.get('source-computer')!.click();
    expect(elements.get('source-dialog')?.open).toBe(true);
    expect(elements.get('source-dialog')?.getAttribute('aria-busy')).toBe('true');
    expect(elements.get('source-feedback')?.textContent).toContain('Ждём подтверждения сервера');
    expect(elements.get('source-summary')?.textContent).toContain('Сервер');
    expect(elements.get('source-computer')?.disabled).toBe(true);
    expect(elements.get('source-server')?.disabled).toBe(true);
    resolveMutation(response(200, { ...data(), marketSources: { ...sourceState, selected: 'computer' } }));
    await vi.waitFor(() => expect(elements.get('source-dialog')?.open).toBe(false));
    expect(elements.get('source-dialog')?.getAttribute('aria-busy')).toBe('false');
    expect(elements.get('source-summary')?.textContent).toContain('Компьютер');
    expect(elements.get('source-computer')?.getAttribute('aria-pressed')).toBe('true');
    expect(elements.get('source-server')?.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(elements.get('source-open'));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/action', expect.objectContaining({ body: JSON.stringify({ action: 'source-computer' }) }));
  });

  it('does not close the source dialog or claim a selected source when the server rejects the choice', async () => {
    const sourceState = { selected: 'server', busy: false, sources: [
      { id: 'server', configured: true, available: true }, { id: 'computer', configured: true, available: true },
    ] };
    const fetch = vi.fn().mockResolvedValueOnce(response(200, { ...data(), marketSources: sourceState })).mockResolvedValueOnce(response(400));
    const { elements, document } = harness(fetch);
    await ready(elements);
    elements.get('source-open')!.click();
    elements.get('source-computer')!.click();
    await vi.waitFor(() => expect(elements.get('notice')?.classList.contains('error')).toBe(true));
    expect(elements.get('source-dialog')?.open).toBe(true);
    expect(elements.get('source-dialog')?.getAttribute('aria-busy')).toBe('false');
    expect(elements.get('source-feedback')?.textContent).toBe(elements.get('notice')?.textContent);
    expect(elements.get('source-feedback')?.classList.contains('error')).toBe(true);
    expect(elements.get('source-close')?.textContent).toBe('Отмена');
    expect(document.activeElement).toBe(elements.get('source-close'));
    expect(elements.get('source-close')?.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(elements.get('source-summary')?.textContent).toContain('Сервер');
    expect(elements.get('source-computer')?.getAttribute('aria-pressed')).toBe('false');
    expect(elements.get('notice')?.textContent).not.toContain('Данные подтверждены');
  });

  it('explains that closing a pending source dialog does not cancel an already-sent action and still applies the acknowledged response', async () => {
    const sourceState = { selected: 'server', busy: false, sources: [
      { id: 'server', configured: true, available: true }, { id: 'computer', configured: true, available: true },
    ] };
    let resolveMutation!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>(resolve => { resolveMutation = resolve; });
    const fetch = vi.fn().mockResolvedValueOnce(response(200, { ...data(), marketSources: sourceState })).mockReturnValueOnce(pending);
    const { elements } = harness(fetch);
    await ready(elements);
    elements.get('source-open')!.click();
    elements.get('source-computer')!.click();
    expect(elements.get('source-dialog')?.getAttribute('aria-busy')).toBe('true');
    expect(elements.get('source-close')?.textContent).toBe('Закрыть окно');
    expect(elements.get('source-feedback')?.textContent).toContain('Запрос уже отправлен');
    expect(elements.get('source-feedback')?.textContent).toContain('Закрытие окна не отменяет действие');
    elements.get('source-close')!.click();
    expect(elements.get('source-dialog')?.open).toBe(false);
    const sentRequest = fetch.mock.calls[1]![1] as { signal: AbortSignal };
    expect(sentRequest.signal.aborted).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    resolveMutation(response(200, { ...data(), marketSources: { ...sourceState, selected: 'computer' } }));
    await vi.waitFor(() => expect(elements.get('source-summary')?.textContent).toContain('Компьютер'));
    expect(elements.get('source-dialog')?.open).toBe(false);
    expect(elements.get('source-dialog')?.getAttribute('aria-busy')).toBe('false');
    expect(elements.get('notice')?.textContent).toContain('Данные подтверждены');
    expect(elements.get('source-computer')?.getAttribute('aria-pressed')).toBe('true');
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/view', '/api/action']);
  });

  it.each(['timeout', 'server-error'])('announces an unknown source %s outcome inside the modal and returns focus to explicit refresh on close', async kind => {
    const sourceState = { selected: 'server', busy: false, sources: [
      { id: 'server', configured: true, available: true }, { id: 'computer', configured: true, available: true },
    ] };
    const fetch = vi.fn().mockResolvedValueOnce(response(200, { ...data(), marketSources: sourceState }));
    if (kind === 'timeout') {
      const failure = new Error('Request timed out'); failure.name = 'TimeoutError'; fetch.mockRejectedValueOnce(failure);
    } else fetch.mockResolvedValueOnce(response(503));
    const { elements, document } = harness(fetch);
    await ready(elements);
    elements.get('source-open')!.click();
    elements.get('source-computer')!.click();
    await vi.waitFor(() => expect(elements.get('source-feedback')?.textContent).toContain('Исход действия не подтверждён'));
    expect(elements.get('source-feedback')?.textContent).toContain('Закройте это окно');
    expect(elements.get('source-feedback')?.textContent).toContain('Обновить данные');
    expect(elements.get('source-feedback')?.classList.contains('error')).toBe(true);
    expect(elements.get('source-dialog')?.open).toBe(true);
    expect(elements.get('source-dialog')?.getAttribute('aria-busy')).toBe('false');
    expect(elements.get('source-open')?.disabled).toBe(true);
    expect(elements.get('source-close')?.textContent).toBe('Закрыть окно');
    expect(elements.get('refresh')?.disabled).toBe(false);
    expect(document.activeElement).toBe(elements.get('source-close'));
    elements.get('source-close')!.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(elements.get('refresh')));
    expect(elements.get('refresh')?.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shows expired-access instructions in the source modal and focuses the overview heading when all private controls are revoked', async () => {
    const sourceState = { selected: 'server', busy: false, sources: [
      { id: 'server', configured: true, available: true }, { id: 'computer', configured: true, available: true },
    ] };
    const fetch = vi.fn().mockResolvedValueOnce(response(200, { ...data(), marketSources: sourceState })).mockResolvedValueOnce(response(401));
    const { elements, document } = harness(fetch);
    await ready(elements);
    elements.get('source-open')!.click();
    elements.get('source-computer')!.click();
    await vi.waitFor(() => expect(elements.get('source-feedback')?.textContent).toContain('Доступ истёк'));
    expect(elements.get('source-feedback')?.textContent).toContain('Закройте панель и откройте');
    expect(elements.get('source-feedback')?.textContent).not.toContain('нажмите «Обновить данные»');
    expect(elements.get('refresh')?.disabled).toBe(true);
    expect(elements.get('source-open')?.disabled).toBe(true);
    expect(elements.get('source-close')?.textContent).toBe('Закрыть окно');
    expect(document.activeElement).toBe(elements.get('source-close'));
    elements.get('source-close')!.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(elements.get('overview-title')));
    expect(elements.get('overview-title')?.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns focus to the risk heading after confirming an entry ban when the original trigger becomes disabled', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, { ...data(), execution: { killed: false } }))
      .mockResolvedValueOnce(response(200, data()));
    const { elements, tabs, document } = harness(fetch);
    await ready(elements);
    tabs[3]!.click();
    elements.get('kill')!.click();
    elements.get('confirm-kill-button')!.click();
    await vi.waitFor(() => expect(elements.get('notice')?.textContent).toContain('Новые входы запрещены'));
    expect(elements.get('kill')?.disabled).toBe(true);
    expect(document.activeElement).toBe(elements.get('risk-title'));
    expect(elements.get('risk-title')?.focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['sandbox', 'Песочница'], ['disabled', 'Отключён'], ['unknown', 'Не подтверждён'],
  ])('shows the confirmed executor mode %s separately from observation mode and never claims real execution is enabled', async (mode, label) => {
    const fixture = { ...data(), execution: { killed: false, mode } };
    const { elements } = harness(vi.fn().mockResolvedValue(response(200, fixture)));
    await ready(elements);
    expect(elements.get('executor-state')?.textContent).toBe(label);
    elements.get('kill')!.click();
    expect(elements.get('confirm-kill')?.open).toBe(true);
    expect(elements.get('confirm-kill-mode')?.textContent).toContain('Панель: наблюдение');
    expect(elements.get('confirm-kill-mode')?.textContent).toContain('Исполнитель: ' + label);
    expect(elements.get('confirm-kill-mode')?.textContent).toContain('Реальные заявки закрыты');
    if (mode === 'sandbox') expect(elements.get('confirm-kill-mode')?.textContent).not.toContain('Отключён');
  });

  it.each([
    [{ paused: true }, 'Пауза'],
    [{ lastScanAt: null }, 'Ждём данные'],
    [{ fresh: false }, 'Данные устарели'],
    [{ errors: 1 }, 'Есть ошибки анализа'],
    [{}, 'Свежие данные'],
  ])('describes the scanner state without treating absence, stale data and analysis errors as the same status', async (scannerOverrides, label) => {
    const fixture = { ...data(), scanner: { ...data().scanner, ...scannerOverrides } };
    const { elements } = harness(vi.fn().mockResolvedValue(response(200, fixture)));
    await ready(elements);
    expect(elements.get('scanner-state')?.textContent).toBe(label);
  });

  it('marks pending requests busy and prevents a repeated mutation before the server responds', async () => {
    let resolveMutation!: (value: ReturnType<typeof response>) => void;
    const pending = new Promise<ReturnType<typeof response>>(resolve => { resolveMutation = resolve; });
    const fetch = vi.fn().mockResolvedValueOnce(response(200, data())).mockReturnValueOnce(pending);
    const { elements } = harness(fetch);
    await ready(elements);
    chooseStrategy(elements);
    elements.get('save-strategy')!.click();
    expect(elements.get('app-content')?.getAttribute('aria-busy')).toBe('true');
    for (const id of ['refresh', 'save-strategy', 'save-assets', 'scanner-toggle', 'source-open']) {
      expect(elements.get(id)?.disabled, id).toBe(true);
    }
    expect(elements.get('notice')?.textContent).not.toContain('Выбор сохранён');
    elements.get('save-strategy')!.click();
    expect(fetch).toHaveBeenCalledTimes(2);
    resolveMutation(response(200, data(2, 'vwap-reclaim-v1')));
    await vi.waitFor(() => expect(elements.get('app-content')?.getAttribute('aria-busy')).toBe('false'));
    expect(elements.get('notice')?.textContent).toContain('Выбор сохранён');
    expect(elements.get('save-strategy')?.disabled).toBe(true);
  });

  it('revokes all private controls after expired authorization without discarding navigation or theme', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, data())).mockResolvedValueOnce(response(401));
    const { elements, tabs } = harness(fetch);
    await ready(elements);
    elements.get('refresh')!.click();
    await vi.waitFor(() => expect(elements.get('notice')?.textContent).toContain('Доступ истёк'));
    for (const id of ['refresh', 'scanner-toggle', 'kill', 'source-open', 'source-server', 'source-computer',
      'strategy-select', 'save-strategy', 'save-assets', 'confirm-kill-button']) {
      expect(elements.get(id)?.disabled, id).toBe(true);
    }
    expect(elements.get('notice')?.classList.contains('error')).toBe(true);
    expect(elements.get('theme')?.disabled).toBe(false);
    expect(tabs.every(tab => !tab.disabled)).toBe(true);
    elements.get('scanner-toggle')!.click();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not replace the acknowledged selection or announce success when a mutation is rejected', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, data())).mockResolvedValueOnce(response(400));
    const { elements } = harness(fetch);
    await ready(elements);
    chooseStrategy(elements);
    elements.get('save-strategy')!.click();
    await vi.waitFor(() => expect(elements.get('notice')?.classList.contains('error')).toBe(true));
    expect(elements.get('selection-revision')?.textContent).toBe('Настройки #1');
    expect(elements.get('selected-assets')?.textContent).toBe('Применены: VTBR');
    expect(elements.get('notice')?.textContent).not.toContain('Выбор сохранён');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['network', 'timeout'])('requires a confirmed refresh after an unknown %s mutation outcome and never retries automatically', async kind => {
    const failure = new Error(kind === 'timeout' ? 'Request timed out' : 'Connection interrupted');
    failure.name = kind === 'timeout' ? 'TimeoutError' : 'TypeError';
    const fetch = vi.fn().mockResolvedValueOnce(response(200, data())).mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(response(200, data(2, 'vwap-reclaim-v1')));
    const { elements } = harness(fetch);
    await ready(elements);
    chooseStrategy(elements);
    elements.get('save-strategy')!.click();
    await vi.waitFor(() => expect(elements.get('notice')?.textContent).toContain('Исход действия не подтверждён'));
    expect(elements.get('notice')?.textContent).toMatch(/Обновите данные.*перед повтором/);
    expect(elements.get('notice')?.classList.contains('error')).toBe(true);
    expect(elements.get('save-strategy')?.disabled).toBe(true);
    expect(elements.get('scanner-toggle')?.disabled).toBe(true);
    expect(elements.get('refresh')?.disabled).toBe(false);
    elements.get('save-strategy')!.click();
    elements.get('scanner-toggle')!.click();
    expect(fetch).toHaveBeenCalledTimes(2);
    elements.get('refresh')!.click();
    await vi.waitFor(() => expect(elements.get('selection-revision')?.textContent).toBe('Настройки #2'));
    expect(elements.get('scanner-toggle')?.disabled).toBe(false);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/view', '/api/action', '/api/view']);
  });

  it('keeps mutations blocked when conflict reconciliation cannot load current settings', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(200, data())).mockResolvedValueOnce(response(409))
      .mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200, data(2)));
    const { elements } = harness(fetch);
    await ready(elements);
    chooseStrategy(elements);
    elements.get('save-strategy')!.click();
    await vi.waitFor(() => expect(elements.get('app-content')?.getAttribute('aria-busy')).toBe('false'));
    expect(elements.get('notice')?.classList.contains('error')).toBe(true);
    expect(elements.get('notice')?.textContent).not.toContain('Выбор сохранён');
    expect(elements.get('save-strategy')?.disabled).toBe(true);
    expect(elements.get('scanner-toggle')?.disabled).toBe(true);
    expect(elements.get('refresh')?.disabled).toBe(false);
    expect(elements.get('selection-revision')?.textContent).toBe('Настройки #1');
    elements.get('refresh')!.click();
    await vi.waitFor(() => expect(elements.get('selection-revision')?.textContent).toBe('Настройки #2'));
    expect(elements.get('scanner-toggle')?.disabled).toBe(false);
  });
});
