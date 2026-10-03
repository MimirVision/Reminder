// How long a to-do takes: the choices, how to say it, and when it ends. Pure, unit tested.
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120, 180] as const;

/** "45 min", "1 h", "1 h 30 min" (the same in English and Norwegian). */
export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "18:00" + 45 minutes = "18:45" (wraps past midnight). */
export function endClock(time: string, min: number): string {
  const [h, m] = time.split(':').map(Number);
  const t = ((h || 0) * 60 + (m || 0) + min) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
