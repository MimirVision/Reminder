import { afterEach, describe, expect, it } from 'vitest';
import { localISODate, minutesNow, setWorkspaceTimeZone } from './dates';

describe('the workspace time zone', () => {
  afterEach(() => setWorkspaceTimeZone(undefined));

  it('puts a moment on the workspace’s date, not the computer’s', () => {
    // 01:30 in Oslo on 25 Nov is still 24 Nov in New York.
    const moment = new Date('2026-11-25T00:30:00Z');
    setWorkspaceTimeZone('Europe/Oslo');
    expect(localISODate(moment)).toBe('2026-11-25');
    setWorkspaceTimeZone('America/New_York');
    expect(localISODate(moment)).toBe('2026-11-24');
  });

  it('gives the time of day in the workspace’s zone', () => {
    setWorkspaceTimeZone('Europe/Oslo');
    expect(minutesNow(new Date('2026-11-25T08:15:00Z'))).toBe(9 * 60 + 15);
    setWorkspaceTimeZone('America/New_York');
    expect(minutesNow(new Date('2026-11-25T08:15:00Z'))).toBe(3 * 60 + 15);
  });

  it('ignores an unknown zone instead of failing', () => {
    setWorkspaceTimeZone('Not/AZone');
    const d = new Date(2026, 10, 25, 12, 0);
    expect(localISODate(d)).toBe('2026-11-25');
  });
});
