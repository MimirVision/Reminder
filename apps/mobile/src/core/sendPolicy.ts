// What to do when sending a queued to-do fails. Pure, unit tested.

/** True when the failure was the connection (try again later), not the server refusing the to-do. */
export function isNetworkMessage(msg: string): boolean {
  return /network request failed|failed to fetch|networkerror|load failed|fetch failed|timed? ?out|offline|internet connection|not connected|econn|enotfound|aborted/i.test(msg);
}

/** The optional extras a newer app sends; an older database may not have their columns. */
export const OPTIONAL_COLUMNS = ['assignee_id', 'pinned', 'notes', 'checklist', 'priority', 'remind_before', 'tags', 'duration_min', 'remind_travel', 'place_trigger'] as const;

/** The same to-do with only the basics (text, place, date, time, repeat), so it is saved even before the database upgrade is run. */
export function basicsOnly<T extends Record<string, unknown>>(item: T): Omit<T, (typeof OPTIONAL_COLUMNS)[number]> {
  const out: Record<string, unknown> = { ...item };
  for (const k of OPTIONAL_COLUMNS) delete out[k];
  return out as Omit<T, (typeof OPTIONAL_COLUMNS)[number]>;
}

/** A short, readable reason for a refused to-do ("Could not find the 'tags' column..." means the upgrade has not been run). */
export function refusalHint(msg: string): 'upgrade' | 'other' {
  return /column|schema cache|does not exist/i.test(msg) ? 'upgrade' : 'other';
}
