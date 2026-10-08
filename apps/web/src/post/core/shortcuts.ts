// Keyboard shortcuts for the computer layout, in the familiar mail-app letters. Pure, so the mapping is tested.

export type ShortcutAction = 'next' | 'prev' | 'open' | 'archive' | 'delete' | 'reply' | 'replyAll' | 'compose' | 'search' | 'close' | 'unread' | 'flag' | 'snooze' | 'help' | 'undo' | 'refresh';

export interface KeyInfo { key: string; ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean; typing?: boolean; sheetOpen?: boolean }

export const SHORTCUT_HELP: [string, string][] = [
  ['j / ↓', 'Next message'], ['k / ↑', 'Previous message'], ['Enter / o', 'Open the first message'], ['e', 'Archive'], ['#  / Delete', 'Delete'],
  ['r', 'Reply'], ['a', 'Reply all'], ['c', 'Write a new message'], ['/', 'Search'], ['u / Esc', 'Back to the list'], ['Shift+U', 'Mark as unread'],
  ['s', 'Flag'], ['z', 'Snooze'], ['Ctrl+Z', 'Undo'], ['g', 'Refresh'], ['?', 'Show this list'],
];

/** What a key press means. Nothing while typing in a field, nothing with Ctrl/Cmd/Alt held (so the browser's own shortcuts keep working), except undo. */
export function shortcutFor(k: KeyInfo): ShortcutAction | null {
  if (k.typing) return null;
  if ((k.ctrl || k.meta) && !k.alt && k.key.toLowerCase() === 'z' && !k.shift) return 'undo';
  if (k.ctrl || k.meta || k.alt) return null;
  if (k.sheetOpen) return k.key === 'Escape' ? 'close' : null;
  switch (k.key) {
    case 'j': case 'ArrowDown': return 'next';
    case 'k': case 'ArrowUp': return 'prev';
    case 'Enter': case 'o': return 'open';
    case 'e': return 'archive';
    case '#': case 'Delete': return 'delete';
    case 'r': return 'reply';
    case 'a': return 'replyAll';
    case 'c': return 'compose';
    case '/': return 'search';
    case 'u': case 'Escape': return 'close';
    case 'U': return 'unread';
    case 's': return 'flag';
    case 'z': return 'snooze';
    case 'g': return 'refresh';
    case '?': return 'help';
    default: return null;
  }
}
