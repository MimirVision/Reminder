import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';
import { detectExpected, needsReview } from '../lib/missing';
import { liveSchedules, planGeneration } from '../lib/generation';
import { DemoRepo } from './demoRepo';

describe('demo seed', () => {
  for (const today of ['2026-10-16', '2027-01-03', '2028-02-29', '2026-03-29']) {
    it(`is consistent on ${today}`, async () => {
      const s = buildSeed(today);
      expect(s.clients.length).toBeGreaterThanOrEqual(15);
      expect(s.clients.length).toBeLessThanOrEqual(25);
      // Fully generated already: nothing left to create.
      expect(planGeneration(liveSchedules(s.schedules, s.clients), s.pauses, s.occurrences, today)).toEqual([]);
      const keys = s.occurrences.filter((o) => o.scheduleId).map((o) => `${o.scheduleId}|${o.periodKey}`);
      expect(new Set(keys).size).toBe(keys.length);
      const items = detectExpected({ ...s, schedules: liveSchedules(s.schedules, s.clients) }, today);
      const review = needsReview(items);
      expect(review.length).toBeGreaterThanOrEqual(2);
      expect(review.length).toBeLessThanOrEqual(8);
      expect(review.every((i) => i.state === 'missing')).toBe(true);
      expect(items.some((i) => i.state === 'exception')).toBe(true);
      expect(s.occurrences.some((o) => o.status !== 'done' && o.status !== 'cancelled' && o.dueDate < today)).toBe(true);
      expect(s.occurrences.some((o) => o.dueDate === today)).toBe(true);
    });
  }

  it('demo repo generation is idempotent and enforces the same rules as the database', async () => {
    const repo = new DemoRepo(null, { today: '2026-10-16' });
    const before = (await repo.load()).occurrences.length;
    await repo.generate();
    await repo.generate();
    const snap = await repo.load();
    const keys = snap.occurrences.filter((o) => o.scheduleId).map((o) => `${o.scheduleId}|${o.periodKey}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(snap.occurrences.length).toBeGreaterThanOrEqual(before);
    const scheduled = snap.occurrences.find((o) => o.scheduleId)!;
    await expect(repo.deleteOccurrence(scheduled.id)).rejects.toThrow(/cancelled/);
    const withTasks = snap.schedules.find((s) => snap.occurrences.some((o) => o.scheduleId === s.id))!;
    await expect(repo.updateSchedule(withTasks.id, { interval: 3, frequency: 'quarterly' })).rejects.toThrow(/cannot change/);
    await expect(repo.deleteClient(withTasks.clientId)).rejects.toThrow(/Archive/);
    await repo.updateOccurrence(scheduled.id, { status: 'done' });
    expect((await repo.load()).occurrences.find((o) => o.id === scheduled.id)?.completedAt).not.toBeNull();
  });
});
