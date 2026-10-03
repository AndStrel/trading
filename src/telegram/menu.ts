import type { TelegramReplyKeyboard } from './client.js';

const commands = new Map([
  ['📊 Статус', '/status'], ['🔎 Рынок', '/market'], ['📋 Кандидаты', '/candidates'],
  ['🧭 Стратегии', '/strategies'], ['💡 Рекомендации', '/recommendations'], ['🎯 Активы', '/assets'],
  ['🛡 Лимиты', '/pilot'], ['⏸ Пауза', '/pause'], ['▶ Продолжить', '/resume'],
  ['⛔ Запретить входы', '/kill'], ['📦 Поручения', '/orders'], ['📱 Мини-приложение', '/app'],
]);

export function menuCommand(text: string): string | undefined { return commands.get(text.trim()); }
export function tradingMenu(): TelegramReplyKeyboard {
  return { keyboard: [
    [{ text: '📊 Статус' }, { text: '🔎 Рынок' }],
    [{ text: '🧭 Стратегии' }, { text: '🎯 Активы' }],
    [{ text: '💡 Рекомендации' }, { text: '📋 Кандидаты' }],
    [{ text: '🛡 Лимиты' }],
    [{ text: '⏸ Пауза' }, { text: '▶ Продолжить' }],
    [{ text: '📦 Поручения' }, { text: '⛔ Запретить входы' }],
    [{ text: '📱 Мини-приложение' }],
  ], is_persistent: true, resize_keyboard: true, input_field_placeholder: 'Выберите действие кнопкой' };
}
