import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

// A deadline list as a practice system exports it (fictional clients and people), written as a real .xlsx.
type C = string | { date: string } | null;
const HEADER = ['Gjøremål', 'Kunde', 'Kunde-ID', 'Oppdrag', 'Oppdragsansvarlig', 'Periode', 'Frist', 'Utfører', 'Status', 'Sist endret', 'Beskrivelse', 'Kategori'];
const r = (task: string, client: string, oppdrag: string, period: string, due: string, status = 'Ikke startet', desc = ''): C[] =>
  [task, client, null, oppdrag, 'Kari Nordmann', period, { date: due }, 'Ola Nordmann', status, { date: '2026-09-01' }, desc, 'Kontor Nord'];
const ROWS: C[][] = [
  HEADER,
  r('E2E Lønnskjøring', 'Nordvik Snekkeri AS', 'Lønn', '11.2026', '2026-11-19', 'Ikke startet', 'Kjør lønn i lønnssystemet.'),
  r('E2E Skattemelding merverdiavgift', 'nordvik snekkeri', 'Regnskap', '10.2026', '2026-12-10'),
  r('E2E Bokføring og regnskapsarbeid', 'Testfjord Revisjon AS', 'Regnskap', '11.2026', '2026-12-03', 'Påbegynt'),
  r('E2E Årsregnskap', 'Testfjord Revisjon AS', 'Årsoppgjør', '12.2026', '2027-06-30'),
  r('E2E A-melding', 'Testfjord Revisjon AS', 'Lønn', '10.2026', '2026-11-05', 'Fullført'),
];

function xlsx(rows: C[][]): Buffer {
  const strings: string[] = [];
  const serial = (iso: string) => (Date.parse(`${iso}T23:59:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const body = rows.map((row, ri) => `<row r="${ri + 1}">${row.map((c, ci) => {
    const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
    if (c === null) return '';
    if (typeof c === 'object') return `<c r="${ref}" s="1"><v>${serial(c.date)}</v></c>`;
    strings.push(c);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  }).join('')}</row>`).join('');
  return Buffer.from(zipSync({
    'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/styles.xml': strToU8('<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="[$-7c14]d\\.M\\.yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'),
    'xl/sharedStrings.xml': strToU8(`<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${body}</sheetData></worksheet>`),
  }));
}
const FILE = { name: 'Frister.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx(ROWS) };

async function chooseFile(page: Page) {
  await page.getByRole('button', { name: 'Import tasks from Excel or CSV' }).click();
  await page.getByLabel('Choose a file to import').setInputFiles(FILE);
}

test('a deadline list from Excel becomes tasks for the right clients, and importing it again adds nothing', async ({ page }) => {
  await page.goto('/tasks');
  await chooseFile(page);
  const dialog = page.getByRole('dialog', { name: 'Import tasks' });
  // The finished A-melding is left out by default; the rest go to two clients, one of them new.
  await expect(dialog.getByText('4 tasks for 2 clients')).toBeVisible();
  await expect(dialog.getByText('1 new client')).toBeVisible();
  await expect(dialog.getByLabel('Client for Nordvik Snekkeri AS')).toHaveValue(/.+/);
  await expect(dialog.getByLabel('Client for Testfjord Revisjon AS')).toHaveValue('create');
  await dialog.getByRole('button', { name: /^Columns/ }).click();
  await expect(dialog.getByLabel('Column for Due date')).toHaveValue('6');
  await expect(dialog.getByText('People: Ledger is just for you')).toHaveCount(2);
  const preview = dialog.getByRole('table');
  await expect(preview.getByRole('row').nth(1)).toContainText('E2E Lønnskjøring');
  await expect(preview.getByRole('row').nth(1)).toContainText('Payroll');
  await expect(preview.getByRole('row').nth(1)).toContainText('November 2026');
  await expect(preview.getByText('E2E Bokføring og regnskapsarbeid').locator('..')).toContainText('In progress');

  await dialog.getByRole('button', { name: 'Import 4 tasks' }).click();
  const done = page.getByRole('dialog', { name: 'Import finished' });
  await expect(done.getByText('4 tasks imported')).toBeVisible();
  await expect(done.getByText(/1 new client was added/)).toBeVisible();
  await done.getByRole('button', { name: 'Close', exact: true }).last().click(); // already on My Tasks: no "Open My Tasks" here

  await page.getByLabel('Search tasks').fill('E2E');
  await expect(page.locator('tbody tr[data-task]')).toHaveCount(4);
  const vat = page.locator('tbody tr[data-task]').filter({ hasText: 'E2E Skattemelding merverdiavgift' });
  await expect(vat).toContainText('Nordvik Snekkeri AS');
  await expect(vat).toContainText('October 2026');
  await vat.locator('td').nth(2).click();
  await expect(page.getByRole('dialog').getByLabel('Tags, separated by commas')).toHaveValue('regnskap');
  await page.keyboard.press('Escape');

  // The same file again: nothing new.
  await chooseFile(page);
  await expect(dialog.getByText('Nothing new to import')).toBeVisible();
  await expect(dialog.getByText('4 already in Ledger, unchanged')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('an import can be undone, and a file dropped on Ledger opens the import', async ({ page }) => {
  await page.goto('/');
  const clientsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('ledger-demo-v1')!).clients.length);
  // Drop the file on the page.
  const transfer = await page.evaluateHandle(({ bytes, name }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], name));
    return dt;
  }, { bytes: [...FILE.buffer], name: FILE.name });
  await page.dispatchEvent('main', 'dragover', { dataTransfer: transfer });
  await page.dispatchEvent('main', 'drop', { dataTransfer: transfer });
  const dialog = page.getByRole('dialog', { name: 'Import tasks' });
  await expect(dialog.getByText('Frister.xlsx')).toBeVisible();
  await dialog.getByLabel('Client for Testfjord Revisjon AS').selectOption('skip');
  await expect(dialog.getByText('2 tasks for 1 client')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2 tasks' }).click();
  await page.getByRole('dialog', { name: 'Import finished' }).getByRole('button', { name: 'Undo import' }).click();
  await expect(page.getByText('Import undone')).toBeVisible();
  const after = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('ledger-demo-v1')!);
    return { e2e: s.occurrences.filter((o: { title: string }) => o.title.startsWith('E2E')).length, clients: s.clients.length };
  });
  expect(after).toEqual({ e2e: 0, clients: clientsBefore });
});
