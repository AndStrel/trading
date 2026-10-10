import { describe, expect, it, vi } from 'vitest';
import { TelegramBotClient } from './client.js';
import { menuCommand, tradingMenu } from './menu.js';

describe('Telegram button menu', () => {
  it('offers safe navigation and only maps exact known labels', () => {
    expect(menuCommand('📊 Статус')).toBe('/status');
    expect(menuCommand('🧭 Стратегии')).toBe('/strategies');
    expect(menuCommand('💡 Рекомендации')).toBe('/recommendations');
    expect(menuCommand('🎯 Активы')).toBe('/assets');
    expect(menuCommand(' ⛔ Запретить входы ')).toBe('/kill');
    expect(menuCommand('📊 Статус arbitrary')).toBeUndefined();
    expect(tradingMenu().keyboard.flat().map(item => item.text).join(' ')).not.toMatch(/купить|продать|LIVE|arm|approve/i);
  });
  it('sends a persistent keyboard or a signed-data-compatible inline launch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"ok":true,"result":{}}', { status: 200 }));
    const client = new TelegramBotClient('test-token', fetcher);
    await client.sendMessage('42', 'Меню', { replyMarkup: tradingMenu() });
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.reply_markup.is_persistent).toBe(true);
    expect(body.reply_markup.resize_keyboard).toBe(true);
    await client.sendMessage('42', 'Панель', { replyMarkup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url: 'https://bot.brewnote.net' } }]] } });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://bot.brewnote.net');
  });
});
