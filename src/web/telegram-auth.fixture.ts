import { createHmac } from 'node:crypto';

export function signedData(token = 'test-bot-token', fields: Record<string, string> = {}) {
  const data = new URLSearchParams({ query_id: 'test-query', user: JSON.stringify({ id: 42, first_name: 'Test' }),
    auth_date: String(new Date('2026-09-30T19:00:00Z').getTime() / 1000), ...fields });
  const check = [...data].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  data.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return data.toString();
}
