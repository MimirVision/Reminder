// What went wrong lately, kept in memory for the Health page and the problem report: what kind of thing, a short text, and when. Nothing
// from inside a message goes in here, and an address that turns up in an error text is replaced, so a report can be shared without a second look.

export interface Problem { at: number; kind: string; text: string; /** how many times in a row the same thing was written down */ count: number }

const MAX_TEXT = 240;

/** An error, or any text, as a short line with every address taken out. */
export function plain(what: unknown): string {
  let text: string;
  if (what instanceof Error) text = `${what.name}: ${what.message}`;
  else if (typeof what === 'string') text = what;
  else { try { text = JSON.stringify(what) ?? String(what); } catch { text = String(what); } }
  return text.replace(/[^\s@<>"',;()[\]]+@[^\s@<>"',;()[\]]+/g, '[address]').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

export function createDiag(opts: { now?: () => number; max?: number } = {}) {
  const now = opts.now ?? (() => Date.now());
  const max = opts.max ?? 40;
  let list: Problem[] = [];
  return {
    /** Writes a problem down. The same one again straight away is counted, not listed twice. Never throws. */
    note(kind: string, what: unknown): void {
      const text = plain(what);
      const last = list[list.length - 1];
      if (last && last.kind === kind && last.text === text) { list = [...list.slice(0, -1), { ...last, count: last.count + 1, at: now() }]; return; }
      list = [...list, { at: now(), kind, text, count: 1 }].slice(-max);
    },
    list: (): Problem[] => list.map((p) => ({ ...p })),
    clear() { list = []; },
  };
}
export type Diag = ReturnType<typeof createDiag>;
