import { describe, expect, it } from 'vitest';
import { verifyTelegramInitData } from './telegram-auth.js';
import { signedData } from './telegram-auth.fixture.js';

const now = new Date('2026-09-30T19:00:00Z');
describe('Mini App Telegram authentication', () => {
  it('validates signed initData and a private-chat allowlist', () => {
    expect(verifyTelegramInitData(signedData(), 'test-bot-token', ['42'], now)).toBe('42');
    expect(verifyTelegramInitData(signedData(), 'another-bot-token', ['42'], now)).toBeNull();
    expect(verifyTelegramInitData(signedData(), 'test-bot-token', ['7', '-42'], now)).toBeNull();
  });
  it('rejects forged identities, duplicate fields, missing signatures and oversized data', () => {
    const original = signedData();
    expect(verifyTelegramInitData(original.replace('Test', 'Forged'), 'test-bot-token', ['42'], now)).toBeNull();
    expect(verifyTelegramInitData(original + '&user=%7B%22id%22%3A42%7D', 'test-bot-token', ['42'], now)).toBeNull();
    expect(verifyTelegramInitData('user=%7B%22id%22%3A42%7D', 'test-bot-token', ['42'], now)).toBeNull();
    expect(verifyTelegramInitData('x'.repeat(8193), 'test-bot-token', ['42'], now)).toBeNull();
  });
  it('rejects expired/future data, non-user identities and non-safe IDs', () => {
    for (const fields of [
      { auth_date: String(now.getTime() / 1000 - 301) },
      { auth_date: String(now.getTime() / 1000 + 31) },
      { user: JSON.stringify({ id: 42, is_bot: true }) },
      { user: JSON.stringify({ id: '42' }) },
      { user: JSON.stringify({ id: -42 }) },
      { user: JSON.stringify({ id: 9007199254740992 }) },
      { user: 'invalid' },
    ]) expect(verifyTelegramInitData(signedData('test-bot-token', fields), 'test-bot-token', ['42'], now)).toBeNull();
  });
  it('includes all signed fields, including signature and Unicode, in the HMAC input', () => {
    const data = signedData('test-bot-token', { signature: 'sample-signature', user: JSON.stringify({ id: 42, first_name: 'Тест & + = ☕' }) });
    expect(verifyTelegramInitData(data, 'test-bot-token', ['42'], now)).toBe('42');
    expect(verifyTelegramInitData(data.replace('sample-signature', 'tampered'), 'test-bot-token', ['42'], now)).toBeNull();
  });
});
