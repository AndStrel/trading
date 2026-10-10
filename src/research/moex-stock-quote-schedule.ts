const MOSCOW_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Moscow',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function scheduledQuoteMinute(now: Date): string | null {
  const parts = Object.fromEntries(MOSCOW_CLOCK.formatToParts(now).map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || weekday === 6 || minuteOfDay < 10 * 60 + 15 || minuteOfDay > 17 * 60 + 20) return null;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
