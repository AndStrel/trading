import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { STRATEGY_CATALOG } from '../strategies/catalog.js';

class Element {
  textContent = ''; className = ''; value = ''; type = ''; checked = false; disabled = false; hidden = false;
  dataset: Record<string, string> = {}; children: Element[] = [];
  listeners = new Map<string, () => void>(); attributes = new Map<string, string>();
  classList = { toggle: vi.fn() };
  constructor(readonly tagName: string, readonly id = '') {}
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren(...items: Element[]) { this.children = [...items]; }
  addEventListener(name: string, handler: () => void) { this.listeners.set(name, handler); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  showModal() {} close() {}
  querySelectorAll(selector: string): Element[] {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? all : all.filter(item => item.tagName === 'input' && (selector !== 'input:checked' || item.checked));
  }
  // Rendering must never interpret untrusted names/reasons as markup.
  set innerHTML(_value: string) { throw new Error('Unsafe markup rendering'); }
}

function harness(fetch: ReturnType<typeof vi.fn>) {
  const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1]!, new Element('div', match[1]!)]));
  const tabs = ['overview', 'trading', 'candidates', 'risk'].map(id => {
    const element = new Element('button'); element.dataset.tab = id; return element;
  });
  const document = { createElement: (tag: string) => new Element(tag), querySelectorAll: (selector: string) =>
    selector === '[id]' ? [...elements.values()] : selector === '[data-tab]' ? tabs
      : selector === '.panel' ? ['overview', 'trading', 'candidates', 'risk'].map(id => elements.get(id)!) : [] };
  const context = createContext({ window: { Telegram: { WebApp: { initData: 'fixture-auth', ready() {}, expand() {} } } },
    document, fetch, Intl, AbortSignal });
  runInContext(readFileSync(new URL('./public/app.js', import.meta.url), 'utf8'), context);
  return { elements, tabs };
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
