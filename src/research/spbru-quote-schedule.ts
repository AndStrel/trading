const moscowClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** All calendar days: TMON@/SPBRU may trade on weekends; status is checked by the caller. */
export function scheduledSpbruQuoteMinute(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid capture clock');
  const parts = Object.fromEntries(moscowClock.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (hour < 10 || hour > 22 || minute % 5 !== 0 || (hour === 10 && minute < 5) ||
      (hour === 22 && minute > 55)) return null;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}+03:00`;
}
