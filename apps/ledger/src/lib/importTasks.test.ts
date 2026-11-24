import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  buildPlan, clientKey, defaultActions, findHeaderRow, guessMapping, guessType, ignoredReason, matchClient, parseDue, parsePeriod, parseStatus,
  readRows, type Options,
} from './importTasks';
import { periodText } from './recurrence';
import { readCsv, readXlsx, type Cell } from './sheet';
import type { Occurrence } from './types';

// A deadline list like the ones accounting systems export. Fictional clients and people.
const HEADER = ['Gjøremål', 'Kunde', 'Kunde-ID', 'Oppdrag', 'Oppdragsansvarlig', 'Periode', 'Frist', 'Utfører', 'Kvalitetssikrer', 'Status', 'Sist endret', 'Sist endret av', 'Beskrivelse', 'Kategori'];
const D = (date: string) => ({ date, time: '23:59' });
const row = (task: string, client: string, oppdrag: string, period: string, due: string, status = 'Ikke startet', desc = ''): Cell[] =>
  [task, client, null, oppdrag, 'Kari Nordmann', period, D(due), 'Ola Nordmann', null, status, D('2026-09-01'), '', desc, 'Kontor Nord'];
const SHEET: Cell[][] = [
  HEADER,
  row('Lønnskjøring', 'Fjordlys Regnskap AS', 'Lønn', '11.2026', '2026-11-19', 'Ikke startet', 'Kjør lønn i lønnssystemet.'),
  row('Skattemelding merverdiavgift', 'Fjordlys Regnskap AS', 'Regnskap', '10.2026', '2026-12-10'),
  row('Bokføring og regnskapsarbeid', 'Nordlys Bygg AS', 'Regnskap', '11.2026', '2026-12-03', 'Påbegynt'),
  row('Årsregnskap', 'Nordlys Bygg', 'Årsoppgjør', '12.2026', '2027-06-30'),
  row('A-melding', 'Havbris Fiskeoppdrett', 'Lønn', '11.2026', '2026-12-07', 'Fullført'),
  row('Aksjonærregisteroppgave', 'Havbris Fiskeoppdrett', 'Årsoppgjør', '12.2025', '2026-10-01'),
  [null, null, null, null, null, null, null],
  row('', 'Nordlys Bygg AS', 'Regnskap', '11.2026', '2026-12-03'),
  ['Regnskapsperiode lukket', 'Nordlys Bygg AS', null, 'Regnskap', null, '11.2026', 'snart', null, null, 'Ikke startet'],
];

/** Writes rows as a real .xlsx (shared strings, a custom date format), the way Excel does. */
function xlsx(rows: Cell[][]): Uint8Array {
  const strings: string[] = [];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const col = (i: number) => String.fromCharCode(65 + i);
  const serial = (iso: string, time: string | null) => (Date.parse(`${iso}T${time ?? '00:00'}:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    const ref = `${col(ci)}${ri + 1}`;
    if (c === null) return '';
    if (typeof c === 'object' && 'date' in c) return `<c r="${ref}" s="1"><v>${serial(c.date, c.time)}</v></c>`;
    if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
    strings.push(String(c));
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  }).join('')}</row>`).join('');
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/styles.xml': strToU8('<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="[$-7c14]d\\.M\\.yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${body}</sheetData></worksheet>`),
  });
}

const clients = [
  { id: 'c1', name: 'Fjordlys Regnskap AS', reference: null, status: 'active' as const },
  { id: 'c2', name: 'Nordlys Bygg AS', reference: '1002', status: 'active' as const },
];
const OPTS: Options = { skipBefore: null, skipClosed: false, assignmentTag: false };

describe('reading the file', () => {
  it('reads an Excel workbook, with its dates as dates', () => {
    const rows = readXlsx(xlsx(SHEET));
    expect(rows[0]).toEqual(HEADER);
    expect(rows[1][6]).toEqual({ date: '2026-11-19', time: '23:59' });
    expect(rows[1][0]).toBe('Lønnskjøring');
    expect(rows[1][2]).toBeNull();
    expect(rows).toHaveLength(SHEET.length);
  });

  it('reads CSV with semicolons and quotes', () => {
    expect(readCsv('﻿Gjøremål;Kunde;Frist\r\n"Lønn; november";"Fjordlys ""Nord"" AS";19.11.2026\r\n')).toEqual([
      ['Gjøremål', 'Kunde', 'Frist'], ['Lønn; november', 'Fjordlys "Nord" AS', '19.11.2026'],
    ]);
  });

  it('finds the columns by name and says why some are left out', () => {
    expect(findHeaderRow([['Frister'], [], HEADER])).toBe(2);
    const m = guessMapping(HEADER);
    expect(m).toEqual({ title: 0, client: 1, reference: 2, type: 3, period: 5, due: 6, status: 9, description: 12, priority: null, tags: null });
    expect(guessMapping(['Task', 'Customer', 'Due date', 'Notes'])).toMatchObject({ title: 0, client: 1, due: 2, description: 3 });
    expect(ignoredReason('Oppdragsansvarlig')).toMatch(/People/);
    expect(ignoredReason('Sist endret av')).toMatch(/history/);
    expect(ignoredReason('Kategori')).toMatch(/Not used/);
  });
});

describe('values', () => {
  it('understands due dates in the usual forms', () => {
    expect(parseDue({ date: '2026-11-19', time: '23:59' })).toBe('2026-11-19');
    expect(parseDue('19.11.2026')).toBe('2026-11-19');
    expect(parseDue('19.11.26')).toBe('2026-11-19');
    expect(parseDue('2026-11-19')).toBe('2026-11-19');
    expect(parseDue('19/11/2026 23:59')).toBe('2026-11-19');
    expect(parseDue('11/19/2026')).toBe('2026-11-19');
    expect(parseDue(46345)).toBe('2026-11-19');
    expect(parseDue('31.02.2026')).toBeNull();
    expect(parseDue('snart')).toBeNull();
  });

  it('understands periods: months, years, quarters and VAT terms', () => {
    expect(parsePeriod('11.2026')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(parsePeriod('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(parsePeriod('nov. 2026')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(parsePeriod('2025')).toEqual({ start: '2025-01-01', end: '2025-12-31' });
    expect(parsePeriod('Q2 2027')).toEqual({ start: '2027-04-01', end: '2027-06-30' });
    expect(parsePeriod('3. termin 2027')).toEqual({ start: '2027-05-01', end: '2027-06-30' });
    expect(parsePeriod('13.2026')).toBeNull();
    expect(periodText('2026-11-01', '2026-11-30')).toBe('November 2026');
    expect(periodText('2027-05-01', '2027-06-30')).toBe('May–Jun 2027');
    expect(periodText('2025-01-01', '2025-12-31')).toBe('2025');
  });

  it('maps statuses and task types from Norwegian accounting terms', () => {
    expect(['Ikke startet', 'Påbegynt', 'Venter på kunde', 'Fullført', 'Avbrutt', ''].map(parseStatus)).toEqual(['todo', 'in_progress', 'waiting', 'done', 'cancelled', 'todo']);
    expect(parseStatus('Til vurdering')).toBeNull();
    const t = (title: string, a = '') => guessType(title, a);
    expect([t('Skattemelding merverdiavgift', 'Regnskap'), t('Lønnskjøring'), t('A-melding'), t('Betalingsgrunnlag aga sendt kunde'),
      t('Årsregnskap godkjent'), t('Sende til revisor'), t('Skatteoppgjør kontrollert'), t('Aksjonærregisteroppgave'),
      t('Kvalitetssikring av rapporteringsgrunnlaget'), t('Bokføring og regnskapsarbeid'), t('Møte', 'Lønn'), t('Møte')])
      .toEqual(['vat', 'payroll', 'payroll', 'payroll', 'annual', 'annual', 'tax', 'tax', 'reporting', 'bookkeeping', 'payroll', 'other']);
  });

  it('matches clients by number, then name, ignoring case, punctuation and AS', () => {
    expect(clientKey('Nordlys Bygg AS')).toBe(clientKey('nordlys bygg'));
    expect(matchClient('Fjordlys Regnskap AS', '', clients)).toEqual({ clientId: 'c1', how: 'name' });
    expect(matchClient('NORDLYS BYGG', '', clients)).toEqual({ clientId: 'c2', how: 'similar' });
    expect(matchClient('Annet navn', '1002', clients)).toEqual({ clientId: 'c2', how: 'reference' });
    expect(matchClient('Havbris Fiskeoppdrett', '', clients)).toBeNull();
  });
});

describe('the plan', () => {
  const read = () => readRows(SHEET, 0, guessMapping(HEADER), clients);

  it('turns each row into a task for the right client, and explains rows it can’t use', () => {
    const r = read();
    expect(r.clients.map((c) => [c.name, c.rows, c.match?.clientId ?? null])).toEqual([
      ['Fjordlys Regnskap AS', 2, 'c1'], ['Havbris Fiskeoppdrett', 2, null], ['Nordlys Bygg AS', 2, 'c2'],
    ]);
    expect(r.skipped).toEqual([{ row: 9, reason: 'No task name' }, { row: 10, reason: 'Due date “snart” not understood' }]);
    const plan = buildPlan(r, defaultActions(r.clients), [], OPTS);
    expect(plan.creates).toHaveLength(6);
    expect(plan.creates[0]).toMatchObject({
      title: 'Lønnskjøring', clientId: 'c1', dueDate: '2026-11-19', status: 'todo', taskType: 'payroll', priority: 'normal',
      period: { start: '2026-11-01', end: '2026-11-30' }, description: 'Kjør lønn i lønnssystemet.', tags: [],
    });
    expect(plan.creates.find((c) => c.title === 'A-melding')).toMatchObject({ clientId: null, status: 'done' }); // a new client
    expect(plan.creates.find((c) => c.title === 'Bokføring og regnskapsarbeid')?.status).toBe('in_progress');
  });

  it('can leave out old or finished tasks, add the assignment as a tag, and leave out a client', () => {
    const r = read();
    const plan = buildPlan(r, { ...defaultActions(r.clients), 'name:fjordlys regnskap': { kind: 'skip' } }, [],
      { skipBefore: '2026-11-18', skipClosed: true, assignmentTag: true });
    expect(plan.creates.map((c) => c.title)).toEqual(['Bokføring og regnskapsarbeid', 'Årsregnskap']);
    expect(plan.creates[0].tags).toEqual(['regnskap']);
    expect(plan.before).toBe(1);
    expect(plan.skipped.map((s) => s.reason)).toEqual(['Client left out', 'Client left out', 'Done or cancelled in the file', 'No task name', 'Due date “snart” not understood']);
  });

  it('does not double anything when the same file is imported again, and takes new due dates from it', () => {
    const r = read();
    const task = (o: Partial<Occurrence>): Occurrence => ({
      id: 'x', workspaceId: 'w', clientId: 'c1', scheduleId: null, title: 'Lønnskjøring', description: '', taskType: 'payroll', periodKey: null,
      periodStart: '2026-11-01', periodEnd: '2026-11-30', dueDate: '2026-11-19', scheduledDueDate: null, status: 'todo', priority: 'normal', tags: [],
      completedAt: null, checklist: [], waitingSince: null, createdAt: '', updatedAt: '', ...o,
    });
    const existing = [task({ description: 'Mine egne notater' }), task({ id: 'y', title: 'Skattemelding merverdiavgift', periodStart: '2026-10-01', periodEnd: '2026-10-31', dueDate: '2026-12-01' })];
    const plan = buildPlan(r, defaultActions(r.clients), existing, OPTS);
    expect(plan.unchanged).toBe(1);
    expect(plan.updates).toEqual([{ row: 3, task: existing[1], patch: { dueDate: '2026-12-10' } }]);
    expect(plan.creates).toHaveLength(4);
  });

  it('skips a row that appears twice', () => {
    const r = readRows([HEADER, SHEET[1], SHEET[1]], 0, guessMapping(HEADER), clients);
    const plan = buildPlan(r, defaultActions(r.clients), [], OPTS);
    expect(plan.creates).toHaveLength(1);
    expect(plan.skipped).toEqual([{ row: 3, reason: 'Same task twice in the file' }]);
  });
});

describe('import edge cases', () => {
  it('finds the CSV separator when a title line comes before the header', () => {
    const rows = readCsv('Fristliste november 2026\nKunde,Gjøremål,Frist\nFjordlys AS,Lønnskjøring,19.11.2026\n');
    expect(rows[1]).toEqual(['Kunde', 'Gjøremål', 'Frist']);
    expect(findHeaderRow(rows)).toBe(1);
  });

  it('keeps Excel row numbers when an empty row is written as <row/>', () => {
    const data = zipSync({
      'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"/><row r="2"><c r="A2" t="inlineStr"><is><t>Gjøremål</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>Lønn</t></is></c></row></sheetData></worksheet>'),
    });
    const rows = readXlsx(data);
    expect(rows).toEqual([[], ['Gjøremål'], ['Lønn']]);
  });

  it('never matches an archived client', () => {
    expect(matchClient('Fjordlys Regnskap AS', '', [{ id: 'old', name: 'Fjordlys Regnskap AS', reference: null, status: 'archived' }])).toBeNull();
  });
});
