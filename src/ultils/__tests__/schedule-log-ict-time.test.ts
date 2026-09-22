import moment from 'moment';
import { buildScheduleLogIctDateTime, normalizeScheduleClock } from '../schedule-log-ict-time';

describe('buildScheduleLogIctDateTime', () => {
  it('writes naive ICT wall, not ISO-Z', () => {
    const now = moment.utc('2026-09-21T09:05:10.000Z');
    expect(buildScheduleLogIctDateTime('16:05:00', now)).toBe('2026-09-21 16:05:00');
    expect(buildScheduleLogIctDateTime('16:07', now)).toBe('2026-09-21 16:07:00');
  });

  it('does not emit a trailing Z', () => {
    const value = buildScheduleLogIctDateTime('08:00:00', moment.utc('2026-09-22T01:00:00.000Z'));
    expect(value).toBe('2026-09-22 08:00:00');
    expect(value.includes('Z')).toBe(false);
    expect(value.includes('T')).toBe(false);
  });
});

describe('normalizeScheduleClock', () => {
  it('pads HH:mm to HH:mm:ss', () => {
    expect(normalizeScheduleClock('16:05')).toBe('16:05:00');
  });
});
