// Swipe a row: right to finish, left to delete. Pure decision logic, unit tested.
export type SwipeAction = 'done' | 'delete' | null;

export const SWIPE_COMMIT = 96; // px past which letting go does the action

/** Row offset while dragging: follows the finger, with resistance past the commit point. */
export function swipeOffset(dx: number, commit = SWIPE_COMMIT): number {
  const a = Math.abs(dx);
  const eased = a <= commit ? a : commit + (a - commit) * 0.35;
  return Math.sign(dx) * Math.min(eased, commit * 1.6);
}

/** What letting go means. A quick flick counts even if short; a mostly vertical drag is a scroll, not a swipe. */
export function swipeResult(dx: number, dy: number, ms: number, commit = SWIPE_COMMIT): SwipeAction {
  if (Math.abs(dy) > Math.abs(dx) * 0.8) return null;
  const fast = ms < 250 && Math.abs(dx) > 48;
  if (Math.abs(dx) < commit && !fast) return null;
  return dx > 0 ? 'done' : 'delete';
}

/** Whether a drag has turned into a horizontal swipe yet (so the page can stop scrolling under it). */
export const isHorizontal = (dx: number, dy: number) => Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.4;

/**
 * A hard, quick flick to the left across the row of tabs (Primary ... All) jumps to the last tab, which is All, like swiping all the way in iOS
 * Mail. Anything slower, shorter, mostly vertical, or to the right is just the row of tabs scrolling under the finger and changes nothing.
 * Returns the new index, or null when it stays where it is.
 */
export const FLICK_MIN_PX = 170;
export const FLICK_MIN_SPEED = 1.1; // px per ms, over the whole touch
export function tabSwipe(dx: number, dy: number, ms: number, index: number, count: number): number | null {
  if (count < 2 || index >= count - 1 || ms <= 0) return null;
  if (dx > -FLICK_MIN_PX || Math.abs(dy) > Math.abs(dx) * 0.4 || -dx / ms < FLICK_MIN_SPEED) return null;
  return count - 1;
}
