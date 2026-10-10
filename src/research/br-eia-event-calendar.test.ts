import { describe, expect, it } from 'vitest';
import { buildBrEiaEvents, easternToMoscow } from '../research-br-eia-event-research.js';

describe('BR EIA release calendar', () => {
  it('converts U.S. standard/daylight time and delayed release times to Moscow', () => {
    expect(easternToMoscow('2025-01-08', '10:30')).toEqual({ date: '2025-01-08', minute: 18 * 60 + 30 });
    expect(easternToMoscow('2025-05-07', '10:30')).toEqual({ date: '2025-05-07', minute: 17 * 60 + 30 });
    expect(easternToMoscow('2025-09-04', '12:00')).toEqual({ date: '2025-09-04', minute: 19 * 60 });
  });

  it('has the frozen 109 unique events and preserves explicit holiday times', () => {
    const events = buildBrEiaEvents();
    expect(events).toHaveLength(109);
    expect(new Set(events.map((event) => event.date)).size).toBe(109);
    expect(events.find((event) => event.date === '2025-01-02')).toMatchObject({ releaseEastern: '11:00', signalStartMinute: 19 * 60 + 5 });
    expect(events.find((event) => event.date === '2026-05-28')).toMatchObject({ releaseEastern: '12:00', signalStartMinute: 19 * 60 + 5 });
    expect(events.some((event) => event.date === '2024-05-30')).toBe(false);
  });
});
