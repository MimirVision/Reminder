import { describe, expect, it } from 'vitest';
import { formatDuration, layoutDay, meetingErrors, parseTime, sortMeetings, toMinutes } from './meetings';

describe('meeting times', () => {
  it('reads what people type', () => {
    expect(['9', '930', '9:30', '09.30', '14', '1405', '24', '9:75', 'soon'].map(parseTime)).toEqual(['09:00', '09:30', '09:30', '09:30', '14:00', '14:05', null, null, null]);
    expect(toMinutes('13:45')).toBe(825);
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(90)).toBe('1 h 30 min');
  });

  it('checks a meeting ends after it starts', () => {
    expect(meetingErrors({ title: 'Call', start: '10:00', end: '09:00' }).time).toMatch(/end after/);
    expect(meetingErrors({ title: ' ', start: '10:00', end: '11:00' })).toEqual({ title: expect.any(String), time: null });
  });

  it('lays overlapping meetings side by side and lets separate ones use the full width', () => {
    const l = layoutDay([
      { id: 'a', start: '09:00', end: '10:00' }, { id: 'b', start: '09:30', end: '10:30' },
      { id: 'c', start: '10:00', end: '11:00' }, { id: 'd', start: '13:00', end: '14:00' },
    ]);
    expect(l.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(l.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(l.get('c')).toEqual({ lane: 0, lanes: 2 });
    expect(l.get('d')).toEqual({ lane: 0, lanes: 1 });
  });

  it('sorts by day, then time', () => {
    expect(sortMeetings([{ date: '2026-10-20', start: '09:00', end: '10:00' }, { date: '2026-10-19', start: '15:00', end: '16:00' }, { date: '2026-10-19', start: '08:00', end: '09:00' }])
      .map((m) => `${m.date} ${m.start}`)).toEqual(['2026-10-19 08:00', '2026-10-19 15:00', '2026-10-20 09:00']);
  });
});
