import { createHmac, timingSafeEqual } from 'node:crypto';

// No cookies, URL tokens or initDataUnsafe. A signed Telegram identity is
// additionally checked against private-chat IDs already authorized for this bot.
export function verifyTelegramInitData(raw: string, token: string, allowedPrivateIds: string[], now = new Date()): string | null {
  if (!token || raw.length === 0 || raw.length > 8192 || /[\r\n]/.test(raw)) return null;
  try {
    const fields = new URLSearchParams(raw);
    const keys = [...fields.keys()];
    if (new Set(keys).size !== keys.length) return null;
    const hash = fields.get('hash');
    const date = fields.get('auth_date');
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash) || !date || !/^\d{1,12}$/.test(date)) return null;
    const age = now.getTime() / 1000 - Number(date);
    if (!Number.isFinite(age) || age < -30 || age > 300) return null;
    fields.delete('hash');
    const check = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, value]) => `${key}=${value}`).join('\n');
    const key = createHmac('sha256', 'WebAppData').update(token).digest();
    const expected = createHmac('sha256', key).update(check).digest();
    if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
    const user = JSON.parse(fields.get('user') ?? 'null') as { id?: unknown; is_bot?: unknown } | null;
    if (!user || !Number.isSafeInteger(user.id) || Number(user.id) <= 0 || user.is_bot === true) return null;
    const id = String(user.id);
    return allowedPrivateIds.some(item => /^\d+$/.test(item) && item === id) ? id : null;
  } catch { return null; }
}
