// Turns a deadline list exported from another system (Excel or CSV) into Ledger tasks: which column is what, which
// client each row belongs to, its due date, period, status and type. Pure, so every rule is tested; the dialog in
// components/ImportTasks.tsx only shows the plan and carries it out.
//
// Columns are recognised in Norwegian and English ("Gjøremål", "Kunde", "Frist", "Periode", "Status", "Beskrivelse",
// "Oppdrag", ...). Running the same file again does not double anything: a row that is already in Ledger (same client,
// task and period) is left alone, or gets its new due date if the file moved it.
import { endOfMonth, fromParts, isISODate, type ISODate } from './dates';
import { isSheetDate, serialToDate, type Cell } from './sheet';
import { isOpen, type Client, type Occurrence, type Priority, type TaskStatus, type TaskType } from './types';

export type Field = 'title' | 'client' | 'reference' | 'due' | 'period' | 'status' | 'description' | 'type' | 'priority' | 'tags';

export const FIELDS: { id: Field; label: string; help: string; required?: boolean }[] = [
  { id: 'title', label: 'Task', help: 'What to do, e.g. “Skattemelding merverdiavgift”.', required: true },
  { id: 'client', label: 'Client', help: 'The client’s name. Matched to your clients; new ones can be created.', required: true },
  { id: 'due', label: 'Due date', help: 'The deadline (frist).', required: true },
  { id: 'period', label: 'Period', help: 'Which month, term or year the task is for, e.g. 11.2026.' },
  { id: 'status', label: 'Status', help: 'Ikke startet, Påbegynt, Fullført, … become To do, In progress, Done.' },
  { id: 'description', label: 'Notes', help: 'Kept as the task’s notes.' },
  { id: 'type', label: 'Assignment', help: 'Helps choose the task type (VAT, payroll, …); can also become a tag.' },
  { id: 'reference', label: 'Client number', help: 'Matched to the client’s reference before the name.' },
  { id: 'priority', label: 'Priority', help: 'Høy, Haster, Lav, … become High, Urgent, Low.' },
  { id: 'tags', label: 'Tags', help: 'Separated by commas.' },
];

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const HEADERS: Record<Field, string[]> = {
  title: ['gjøremål', 'oppgave', 'oppgavenavn', 'aktivitet', 'arbeidsoppgave', 'task', 'task name', 'title', 'tittel', 'to do', 'todo', 'hva'],
  client: ['kunde', 'kundenavn', 'klient', 'klientnavn', 'client', 'client name', 'customer', 'customer name', 'firma', 'selskap', 'company'],
  reference: ['kunde id', 'kundeid', 'kundenr', 'kundenummer', 'klientnr', 'klientnummer', 'client id', 'client number', 'customer id', 'customer number', 'reference', 'ref', 'referanse', 'org nr', 'orgnr', 'organisasjonsnummer'],
  due: ['frist', 'fristdato', 'forfall', 'forfallsdato', 'leveringsfrist', 'innleveringsfrist', 'due', 'due date', 'deadline', 'dato', 'date'],
  period: ['periode', 'period', 'termin', 'regnskapsperiode', 'gjelder periode'],
  status: ['status', 'tilstand', 'state'],
  description: ['beskrivelse', 'description', 'notat', 'notater', 'notes', 'note', 'kommentar', 'kommentarer', 'comment', 'comments', 'detaljer', 'details'],
  type: ['oppdrag', 'oppdragstype', 'tjeneste', 'tjenesteområde', 'oppgavetype', 'assignment', 'service', 'type', 'task type'],
  priority: ['prioritet', 'priority'],
  tags: ['tags', 'tagger', 'etiketter', 'merkelapper', 'labels'],
};

/** Columns that are deliberately not imported, and why (shown in the dialog). */
const IGNORED: [RegExp, string][] = [
  [/ansvarlig|utfører|utforer|kvalitetssikrer|saksbehandler|medarbeider|tildelt|assignee|owner|responsible|reviewer|performer/, 'People: Ledger is just for you, so who does or checks a task isn’t kept.'],
  [/sist endret|endret av|opprettet|created|modified|updated|changed/, 'Change history from the other system.'],
  [/kategori|avdeling|kontor|office|department|category/, 'Not used in Ledger.'],
];

export type Mapping = Record<Field, number | null>;

/** The row that holds the column names: the first of the top ten with at least two names Ledger knows. */
export function findHeaderRow(rows: Cell[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const known = (rows[i] ?? []).filter((c) => typeof c === 'string' && fieldFor(c) !== null).length;
    if (known >= 2) return i;
  }
  return 0;
}

function fieldFor(header: string): Field | null {
  const h = norm(header);
  if (!h) return null;
  for (const f of Object.keys(HEADERS) as Field[]) if (HEADERS[f].includes(h)) return f;
  // "Frist (dato)", "Kunde navn": a known name at the start.
  for (const f of Object.keys(HEADERS) as Field[]) if (HEADERS[f].some((s) => s.length >= 4 && h.startsWith(`${s} `))) return f;
  return null;
}

/** Which column holds which field, from the column names. Each column is used once. */
export function guessMapping(header: Cell[]): Mapping {
  const m = Object.fromEntries(FIELDS.map((f) => [f.id, null])) as Mapping;
  header.forEach((c, i) => {
    if (typeof c !== 'string') return;
    const f = fieldFor(c);
    if (f && m[f] === null) m[f] = i;
  });
  return m;
}

/** Why a column is not imported, or null when it is (or could be). */
export function ignoredReason(header: string): string | null {
  const h = norm(header);
  return IGNORED.find(([re]) => re.test(h))?.[1] ?? null;
}

export function cellText(c: Cell | undefined): string {
  if (c === null || c === undefined) return '';
  if (isSheetDate(c)) { const [y, m, d] = c.date.split('-'); return `${+d}.${+m}.${y}`; }
  return String(c).replace(/\s+/g, ' ').trim();
}

/** A due date from a date cell, an Excel serial number, or text such as 19.11.2026, 19.11.26, 2026-11-19 or 19/11/2026. */
export function parseDue(c: Cell | undefined): ISODate | null {
  if (c === null || c === undefined) return null;
  if (isSheetDate(c)) return isISODate(c.date) ? c.date : null;
  if (typeof c === 'number') return c > 20000 && c < 80000 ? serialToDate(c).date : null;
  const s = String(c).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:$|[\s,T])/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12 && s.includes('/')) [d, mo] = [mo, d]; // 11/19/2026, written the American way
    return valid(y, mo, d);
  }
  return null;
}
function valid(y: number, m: number, d: number): ISODate | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const iso = fromParts(y, m, 1);
  return d > +endOfMonth(iso).slice(8) ? null : fromParts(y, m, d);
}

const MONTHS: Record<string, number> = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mar: 3, mars: 3, march: 3, apr: 4, april: 4, mai: 5, may: 5,
  jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, november: 11, des: 12, dec: 12, desember: 12, december: 12,
};
export interface Period { start: ISODate; end: ISODate }
const months = (y: number, from: number, to: number): Period | null =>
  y < 2000 || y > 2100 || from < 1 || to > 12 || from > to ? null : { start: fromParts(y, from, 1), end: endOfMonth(fromParts(y, to, 1)) };

/**
 * The period a task is for: 11.2026, 2026-11, nov 2026, 2026 (a year), Q1 2027 / 1. kvartal 2027, or a VAT term:
 * 1. termin 2027 / T1 2027 (January–February).
 */
export function parsePeriod(c: Cell | undefined): Period | null {
  if (c === null || c === undefined) return null;
  if (isSheetDate(c)) { const [y, m] = c.date.split('-').map(Number); return months(y, m, m); }
  if (typeof c === 'number') return Number.isInteger(c) && c >= 2000 && c <= 2100 ? months(c, 1, 12) : null;
  const s = norm(String(c));
  let m = /^(\d{1,2}) (\d{4})$/.exec(s) ?? null; // 11.2026 and 11/2026 (punctuation became spaces)
  if (m) return months(+m[2], +m[1], +m[1]);
  if ((m = /^(\d{4}) (\d{1,2})$/.exec(s))) return months(+m[1], +m[2], +m[2]);
  if ((m = /^(\d{4})$/.exec(s))) return months(+m[1], 1, 12);
  if ((m = /^([a-zæøå]+) (\d{4})$/.exec(s)) && MONTHS[m[1]]) return months(+m[2], MONTHS[m[1]], MONTHS[m[1]]);
  if ((m = /^(?:q|k)([1-4]) (\d{4})$/.exec(s) ?? /^([1-4]) (?:kvartal|quarter) (\d{4})$/.exec(s))) return months(+m[2], +m[1] * 3 - 2, +m[1] * 3);
  if ((m = /^t([1-6]) (\d{4})$/.exec(s) ?? /^([1-6]) termin (\d{4})$/.exec(s))) return months(+m[2], +m[1] * 2 - 1, +m[1] * 2);
  return null;
}

const STATUSES: [RegExp, TaskStatus][] = [
  [/^(avbrutt|kansellert|annullert|utgår|utgatt|ikke aktuell|cancel+ed|canceled|skipped)/, 'cancelled'],
  [/^(fullført|fullfort|ferdig|utført|utfort|avsluttet|levert|innsendt|godkjent|done|complete|completed|finished|closed)/, 'done'],
  [/^(venter|avventer|hos kunde|waiting|on hold|blocked)/, 'waiting'],
  [/^(påbegynt|pabegynt|startet|under arbeid|pågår|pagar|i gang|in progress|started|ongoing)/, 'in_progress'],
  [/^(ikke startet|ikke påbegynt|ny|åpen|apen|planlagt|not started|to do|todo|open|new|planned)/, 'todo'],
];
/** A status from the other system, or null when it isn't recognised (the task is then To do). */
export function parseStatus(text: string): TaskStatus | null {
  const s = norm(text);
  if (!s) return 'todo';
  return STATUSES.find(([re]) => re.test(s))?.[1] ?? null;
}

const TYPES: [RegExp, TaskType][] = [
  [/merverdiavgift|\bmva\b|\bvat\b/, 'vat'],
  [/lønn|lonn|a melding|\baga\b|arbeidsgiveravgift|feriepenger|sammenstillingsoppgave|årsoppgave|arsoppgave|payroll|salary/, 'payroll'],
  [/årsregnskap|arsregnskap|årsoppgjør|arsoppgjor|revisor|annual|year end/, 'annual'],
  [/skatt|aksjonærregister|aksjonaerregister|\btax\b/, 'tax'],
  [/kvalitetssikring|rapportering|periode lukket|saldoliste|tilleggsposteringer|avstemming|report/, 'reporting'],
  [/bokføring|bokforing|regnskap|bilag|bookkeeping|accounting/, 'bookkeeping'],
  [/oppfølging|oppfolging|purring|follow up/, 'follow_up'],
];
/** The task type from the task's name, else from its assignment (Oppdrag). */
export function guessType(title: string, assignment = ''): TaskType {
  for (const text of [title, assignment]) {
    const s = norm(text);
    const hit = s && TYPES.find(([re]) => re.test(s));
    if (hit) return hit[1];
  }
  return 'other';
}

export function parsePriority(text: string): Priority {
  const s = norm(text);
  if (/^(kritisk|haster|akutt|urgent|critical)/.test(s)) return 'urgent';
  if (/^(høy|hoy|viktig|high)/.test(s)) return 'high';
  if (/^(lav|low)/.test(s)) return 'low';
  return 'normal';
}

const LEGAL_FORMS = /\s+(as|asa|enk|da|ans|sa|ba|nuf|ks|ltd|ab|aps|oy|gmbh|inc|llc)$/;
/** A client name for matching: case, punctuation and the company form (AS, ENK, …) don't matter. */
export const clientKey = (name: string) => norm(name).replace(LEGAL_FORMS, '').trim();

export type ClientMatch = { clientId: string; how: 'reference' | 'name' | 'similar' } | null;
export function matchClient(name: string, reference: string, clients: Pick<Client, 'id' | 'name' | 'reference' | 'status'>[]): ClientMatch {
  const pick = (list: typeof clients) => list.find((c) => c.status === 'active') ?? list[0];
  if (reference) {
    const r = pick(clients.filter((c) => c.reference && c.reference.trim().toLowerCase() === reference.toLowerCase()));
    if (r) return { clientId: r.id, how: 'reference' };
  }
  const exact = pick(clients.filter((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()));
  if (exact) return { clientId: exact.id, how: 'name' };
  const key = clientKey(name);
  const similar = key ? pick(clients.filter((c) => clientKey(c.name) === key)) : undefined;
  return similar ? { clientId: similar.id, how: 'similar' } : null;
}

// ---- the plan ------------------------------------------------------------------------------------------------

export interface FileClient { key: string; name: string; reference: string; rows: number; match: ClientMatch }
export type ClientAction = { kind: 'existing'; clientId: string } | { kind: 'create' } | { kind: 'skip' };

export interface ImportRow {
  row: number; clientKey: string; title: string; description: string; dueDate: ISODate; period: Period | null;
  status: TaskStatus; taskType: TaskType; priority: Priority; tags: string[];
}
export interface Planned extends ImportRow { clientId: string | null }
export interface Update { row: number; task: Occurrence; patch: { dueDate?: ISODate; status?: TaskStatus; description?: string } }

export interface Plan {
  rows: number;
  creates: Planned[];
  updates: Update[];
  unchanged: number;
  /** Rows not imported, with the reason. */
  skipped: { row: number; reason: string }[];
  before: number;
  unknownStatuses: string[];
  clients: FileClient[];
}

export interface Options {
  /** Leave out tasks due before this date (e.g. today). */
  skipBefore: ISODate | null;
  /** Leave out tasks the file marks done or cancelled. */
  skipClosed: boolean;
  /** Add the assignment (Oppdrag) as a tag. */
  assignmentTag: boolean;
}

const sameTitle = (a: string, b: string) => norm(a) === norm(b);

/** Reads every data row: what the task is, for which client, when. Independent of the choices made in the dialog. */
export function readRows(rows: Cell[][], headerRow: number, m: Mapping, clients: Pick<Client, 'id' | 'name' | 'reference' | 'status'>[]) {
  const out: ImportRow[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const fileClients = new Map<string, FileClient>();
  const unknown = new Set<string>();
  const get = (r: Cell[], f: Field) => (m[f] === null ? null : r[m[f]!] ?? null);
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every((c) => cellText(c) === '')) continue;
    const row = i + 1; // as numbered in Excel
    const title = cellText(get(r, 'title')).slice(0, 200);
    const name = cellText(get(r, 'client'));
    const ref = cellText(get(r, 'reference'));
    if (!title) { skipped.push({ row, reason: 'No task name' }); continue; }
    if (!name && !ref) { skipped.push({ row, reason: 'No client' }); continue; }
    const dueCell = get(r, 'due');
    const dueDate = parseDue(dueCell);
    if (!dueDate) { skipped.push({ row, reason: cellText(dueCell) ? `Due date “${cellText(dueCell)}” not understood` : 'No due date' }); continue; }
    const statusText = cellText(get(r, 'status'));
    const status = parseStatus(statusText);
    if (status === null) unknown.add(statusText);
    const assignment = cellText(get(r, 'type'));
    const key = ref ? `ref:${ref.toLowerCase()}` : `name:${clientKey(name) || name.toLowerCase()}`;
    const fc = fileClients.get(key) ?? { key, name: name || ref, reference: ref, rows: 0, match: matchClient(name, ref, clients) };
    fc.rows++;
    fileClients.set(key, fc);
    const tags = cellText(get(r, 'tags')).split(/[,;]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    out.push({
      row, clientKey: key, title, description: String(get(r, 'description') ?? '').trim().slice(0, 10000), dueDate,
      period: parsePeriod(get(r, 'period')), status: status ?? 'todo', taskType: guessType(title, assignment),
      priority: parsePriority(cellText(get(r, 'priority'))), tags: [...new Set([...tags, ...(assignment ? [`oppdrag:${assignment.toLowerCase()}`] : [])])],
    });
  }
  const list = [...fileClients.values()].sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  return { rows: out, skipped, clients: list, unknownStatuses: [...unknown] };
}

/** The default for each client in the file: the matching client, or create it. */
export const defaultActions = (clients: FileClient[]): Record<string, ClientAction> =>
  Object.fromEntries(clients.map((c) => [c.key, c.match ? { kind: 'existing', clientId: c.match.clientId } : { kind: 'create' }]));

/** What importing would do, given the choices: tasks to create, tasks already there to update, and what is left out. */
export function buildPlan(read: ReturnType<typeof readRows>, actions: Record<string, ClientAction>, existing: Occurrence[], o: Options): Plan {
  const creates: Planned[] = [];
  const updates: Update[] = [];
  const skipped = [...read.skipped];
  let unchanged = 0, before = 0;
  const seen = new Set<string>();
  for (const r of read.rows) {
    const action = actions[r.clientKey] ?? { kind: 'create' };
    if (action.kind === 'skip') { skipped.push({ row: r.row, reason: 'Client left out' }); continue; }
    // The assignment tag is kept only when asked for, and then as just the assignment's name.
    const tags = r.tags.flatMap((t) => (t.startsWith('oppdrag:') ? (o.assignmentTag ? [t.slice(8).slice(0, 40)] : []) : [t])).slice(0, 20);
    const item: ImportRow = { ...r, tags };
    const clientId = action.kind === 'existing' ? action.clientId : null;
    const id = `${r.clientKey}|${norm(r.title)}|${r.period?.start ?? r.dueDate}`;
    if (seen.has(id)) { skipped.push({ row: r.row, reason: 'Same task twice in the file' }); continue; }
    seen.add(id);
    const closed = !isOpen(r.status);
    const already = clientId ? existing.find((t) => t.clientId === clientId && sameTitle(t.title, r.title)
      && (r.period && t.periodStart ? t.periodStart === r.period.start : t.dueDate === r.dueDate)) : undefined;
    if (already) {
      const patch: Update['patch'] = {};
      if (isOpen(already.status)) {
        if (already.dueDate !== r.dueDate && !closed) patch.dueDate = r.dueDate;
        if (closed) patch.status = r.status; // closed in the other system: close it here too (never reopened)
      }
      if (!already.description && r.description) patch.description = r.description;
      if (Object.keys(patch).length) updates.push({ row: r.row, task: already, patch }); else unchanged++;
      continue;
    }
    if (o.skipClosed && closed) { skipped.push({ row: r.row, reason: 'Done or cancelled in the file' }); continue; }
    if (o.skipBefore && r.dueDate < o.skipBefore) { before++; continue; }
    creates.push({ ...item, clientId });
  }
  return { rows: read.rows.length + read.skipped.length, creates, updates, unchanged, skipped: skipped.sort((a, b) => a.row - b.row), before, unknownStatuses: read.unknownStatuses, clients: read.clients };
}
