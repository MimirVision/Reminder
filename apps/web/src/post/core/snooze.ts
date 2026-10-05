// Snooze is kept on this phone: the message stays in the mailbox, Post just hides it from the inbox until the time comes.
// Honest limit (shown in the UI): nothing rings when it returns, it is waiting when you open Post.

export interface Preset { id: 'later' | 'tomorrow' | 'weekend' | 'monday' | 'nextweek'; at: Date }

const at = (d: Date, h: number, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** The choices the snooze sheet offers, in order. "Later today" only exists before 16:00 (otherwise it would be tonight). */
export function presets(now: Date): Preset[] {
  const out: Preset[] = [];
  if (now.getHours() < 16) out.push({ id: 'later', at: at(now, 18) });
  out.push({ id: 'tomorrow', at: at(addDays(now, 1), 8) });
  const dow = now.getDay(); // 0 = Sunday
  const toSat = (6 - dow + 7) % 7 || 7;
  if (dow !== 6 && dow !== 0) out.push({ id: 'weekend', at: at(addDays(now, toSat), 9) });
  const toMon = (1 - dow + 7) % 7 || 7;
  out.push({ id: 'nextweek', at: at(addDays(now, toMon), 8) });
  return out;
}

export const isSnoozed = (until: string | null | undefined, now: Date) => !!until && new Date(until).getTime() > now.getTime();
