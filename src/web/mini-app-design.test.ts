import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./public/app.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const rootTokens = /:root\s*\{([^}]+)\}/.exec(css)?.[1] ?? '';
const lightTokens = /\[data-theme="light"\]\s*\{([^}]+)\}/.exec(css)?.[1] ?? '';

describe('Mini App authored design-system contract', () => {
  it('uses the exact ink-and-copper theme tokens, retaining copper as the sole accent', () => {
    for (const token of [
      '--bg: oklch(0.233 0.025 260)', '--surface: oklch(0.28 0.026 260)',
      '--fg: oklch(0.945 0.01 240)', '--muted: oklch(0.728 0.022 250)',
      '--border: oklch(0.408 0.025 260)', '--accent: oklch(0.75 0.081 53)',
      '--accent-secondary: var(--accent)', '--on-accent: oklch(0.233 0.025 260)',
      '--focus: var(--accent)',
    ]) expect(rootTokens).toContain(token);
    for (const token of [
      '--bg: oklch(0.969 0.008 250)', '--surface: oklch(0.989 0.003 250)',
      '--fg: oklch(0.233 0.025 260)', '--muted: oklch(0.49 0.026 260)',
      '--border: oklch(0.83 0.018 250)', '--focus: var(--fg)',
    ]) expect(lightTokens).toContain(token);
    expect(lightTokens).not.toMatch(/--accent\s*:/);
    expect(css).toMatch(/\.primary[^{}]*\{[^}]*color:\s*var\(--on-accent\)/);
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient|text-shadow/i);
  });

  it('retains the authored font families, numeric alignment, geometry and accessible touch minimum', () => {
    expect(rootTokens).toContain('--font-display: Georgia, "Times New Roman", serif');
    expect(rootTokens).toContain('--font-body: Inter, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif');
    expect(rootTokens).toContain('--radius: 8px');
    expect(rootTokens).toContain('--line: 1px');
    expect(rootTokens).toContain('--control-height: 44px');
    expect(rootTokens).toContain('--duration: 150ms');
    expect(css).toContain('font-variant-numeric: tabular-nums');
    expect(css).toContain('width: min(100%, 560px)');
    expect(css).toContain('min-height: var(--control-height)');
    expect(css).toContain('outline: 3px solid var(--focus)');
    expect(css).toContain('outline-offset: 3px');
    expect(css).toMatch(/\.capital\s*\{[^}]*var\(--font-body\)/);
  });

  it('supports Telegram safe areas and respects reduced motion with an instant panel reset instead of scrolling a heading into view', () => {
    expect(html).toContain('viewport-fit=cover');
    for (const direction of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain('env(safe-area-inset-' + direction);
      expect(css).toContain('--tg-safe-area-inset-' + direction);
      expect(css).toContain('--tg-content-safe-area-inset-' + direction);
    }
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('transition: none !important');
    expect(css).toContain('animation: none !important');
    expect(js).not.toMatch(/scrollIntoView/);
    expect(js).toContain("window.scrollTo({ top: 0, behavior: 'instant' })");
    expect(js).not.toMatch(/behavior\s*:\s*['"]smooth['"]/);
  });

  it('preserves named sections, labelled controls and source identity markers with one primary action per panel', () => {
    expect(html).toMatch(/<html\b[^>]*lang="ru"[^>]*data-theme="dark"/);
    expect(html).toMatch(/<main\b[^>]*id="app-content"[^>]*aria-busy="false"/);
    for (const id of ['overview', 'trading', 'candidates', 'risk']) {
      expect(html).toMatch(new RegExp('<section\\b[^>]*id="' + id + '"[^>]*aria-labelledby="' + id + '-title"'));
      expect(html).toMatch(new RegExp('<h1\\b[^>]*id="' + id + '-title"[^>]*tabindex="-1"'));
      const panel = new RegExp('<section\\b[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</section>').exec(html)?.[1] ?? '';
      expect([...panel.matchAll(/<button\b[^>]*class="[^"]*\bprimary\b/g)]).toHaveLength(id === 'candidates' ? 0 : 1);
    }
    for (const id of ['theme-toggle', 'bottom-navigation', 'balance-card', 'source-dialog', 'algorithm-select',
      'strategy-save', 'asset-options', 'candidate-search', 'risk-summary', 'block-dialog']) {
      expect(html).toContain('data-od-id="' + id + '"');
    }
    expect(html).toContain('for="strategy-select"');
    expect(html).toContain('for="candidate-search"');
    expect(html).toContain('aria-describedby="candidate-search-help"');
    expect(html).toMatch(/<button\b[^>]*id="theme"[^>]*aria-describedby="theme-current"/);
    const themeButton = /<button\b[^>]*id="theme"[^>]*>/.exec(html)?.[0] ?? '';
    expect(themeButton).not.toMatch(/aria-pressed|aria-label/);
    expect(html).toMatch(/<span\b[^>]*id="theme-current"[^>]*class="sr-only"/);
    expect(html).toMatch(/<dialog\b[^>]*id="source-dialog"[^>]*aria-labelledby="source-title"[^>]*aria-describedby="source-explanation"/);
    expect(html).toMatch(/<p\b[^>]*id="source-feedback"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(html).toMatch(/<dialog\b[^>]*id="confirm-kill"[^>]*aria-labelledby="confirm-kill-title"[^>]*aria-describedby="confirm-kill-explanation"/);
    const navigation = /<nav\b[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    expect([...navigation.matchAll(/data-tab="/g)]).toHaveLength(4);
    expect([...navigation.matchAll(/<svg\b/g)]).toHaveLength(4);
    for (const label of ['Обзор', 'Стратегия', 'Кандидаты', 'Риски']) expect(navigation).toContain('<span>' + label + '</span>');
  });

  it('does not add remote fonts, prototype data, credentials or trading actions to the production page', () => {
    const remote = [...html.matchAll(/(?:src|href)="(https?:\/\/[^\"]+)"/g)].map(match => match[1]);
    expect(remote).toEqual(['https://telegram.org/js/telegram-web-app.js']);
    expect(html).not.toMatch(/<img\b|@font-face|fonts\.google|localStorage/i);
    expect(css).not.toMatch(/@import|@font-face|url\(\s*['"]?https?:/i);
    expect(js).not.toMatch(/localStorage\.(?:setItem|getItem)\('(?!trading-kit:theme')/);
    expect(js).not.toMatch(/postOrder|order-submit|\/api\/orders|live-arm|sandbox-arm/);
    expect(html).toContain('не баланс брокерского счёта');
    expect(html).toContain('Баллы — не вероятность прибыли');
    expect(html).toContain('не заработанные деньги');
    expect(html).toContain('Наблюдение ≠ доказанная прибыльность');
  });
});
