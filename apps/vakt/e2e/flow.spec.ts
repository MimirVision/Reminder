// The whole flow in local mode (no database): onboarding, setup, adding shifts, and the numbers on each screen.
import { expect, test, type Page } from '@playwright/test';

// The calendars open on the current month: pin the date so the tests read the same any day.
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-23T12:00:00')); });

/** In the shift sheet's calendar: only `day` (of October 2026) chosen. */
async function pickOnly(page: Page, day: number) {
  const cal = page.getByTestId('date-picker');
  for (const b of await cal.locator('button[aria-pressed="true"]').all()) await b.click();
  await cal.getByRole('button', { name: new RegExp(`\\b${day}\\. oktober`) }).click();
}

async function onboard(page: Page, opts: { others?: string[] } = {}) {
  await page.goto('/');
  await page.getByLabel('Navn').fill('Nikita');
  await page.getByLabel('Hvor jobber du').fill('Avdeling 2');
  await page.getByLabel('Timelønn').fill('300');
  await page.getByRole('button', { name: 'Neste' }).click();
  await expect(page.getByText('Kveldstillegg')).toBeVisible();
  await page.getByRole('button', { name: 'Neste' }).click();
  if (opts.others) {
    await page.getByRole('button', { name: 'Ja' }).click();
    for (const [i, name] of opts.others.entries()) {
      if (i > 0) await page.getByRole('button', { name: 'En til' }).click();
      await page.getByLabel(`Arbeidsgiver ${i + 2}`).fill(name);
    }
  } else {
    await page.getByRole('button', { name: 'Nei, bare én' }).click();
  }
  await page.getByRole('button', { name: 'Neste' }).click();
  await page.getByLabel('Månedsmål').fill('30000');
  await page.getByRole('button', { name: 'Kom i gang' }).click();
  await page.getByRole('button', { name: 'Hopp over' }).click();
}

test('onboarding, adding shifts and seeing what they pay', async ({ page }) => {
  await onboard(page);
  await expect(page.getByText('Ingen vakter i oktober ennå')).toBeVisible();

  // A weekday evening shift 15:00–22:30: 7.5 h × 300, 4 h evening and 1.5 h night supplement at 25 % (75 kr/t).
  await page.getByRole('button', { name: 'Ny vakt', exact: true }).click();
  await expect(page.getByText('Hvor jobber du?')).toHaveCount(0); // only one employer: no choice to make
  await page.getByRole('button', { name: /Kveld/ }).first().click();
  await pickOnly(page, 21);
  await expect(page.getByTestId('shift-total')).toHaveText(/2\s663 kr/);
  await page.getByRole('button', { name: 'Lagre + ny' }).click();
  // The next day, already filled in: change it to a night shift.
  await expect(page.getByTestId('date-picker').getByRole('button', { name: /\b22\. oktober/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Natt/ }).click();
  await page.getByRole('button', { name: 'Lagre vakt' }).click();

  await page.getByRole('button', { name: 'Vakter', exact: true }).click();
  await expect(page.getByText('2 vakter')).toBeVisible();

  // Editing and deleting with undo.
  await page.getByRole('button', { name: /22:00–07:45/ }).click();
  await page.getByRole('button', { name: 'Slett vakt' }).click();
  await expect(page.getByText('1 vakter')).toBeVisible();
  await page.getByRole('button', { name: 'Angre' }).click();
  await expect(page.getByText('2 vakter')).toBeVisible();

  // Everything survives a reload.
  await page.reload();
  await expect(page.getByText('2 vakter')).toBeVisible();
  await page.getByRole('button', { name: 'År' }).click();
  await expect(page.getByText('Totalt i 2026')).toBeVisible();
});

test('two departments: choose one per shift, filter, and copy a changed setup', async ({ page }) => {
  await onboard(page, { others: ['Avdeling 4'] });

  // Both are set up and ready, with the same wage.
  await page.getByRole('button', { name: 'Oppsett' }).click();
  await expect(page.getByRole('button', { name: /Avdeling 2.*300 kr\/t.*Klar/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Avdeling 4.*300 kr\/t.*Klar/ })).toBeVisible();

  // Avdeling 4 pays more per hour.
  await page.getByRole('button', { name: /Avdeling 4/ }).click();
  await page.getByLabel('Timelønn').fill('320');
  await expect(page.getByText('Slik blir det regnet ut')).toBeVisible();
  await page.getByRole('button', { name: 'Alle arbeidsgivere' }).click();
  await expect(page.getByRole('button', { name: /Avdeling 4.*320 kr\/t/ })).toBeVisible();

  // A shift at each: the sheet asks where, and each uses its own wage.
  await page.getByRole('button', { name: 'Oversikt' }).click();
  await page.getByRole('button', { name: 'Ny vakt', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Avdeling 2' }).click();
  await page.getByRole('button', { name: /Dag/ }).first().click();
  await pickOnly(page, 21);
  await expect(page.getByTestId('shift-total')).toHaveText(/2\s400 kr/); // 8 × 300
  await page.getByRole('button', { name: 'Lagre + ny' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Avdeling 4' }).click();
  await expect(page.getByTestId('shift-total')).toHaveText(/2\s560 kr/); // 8 × 320
  await page.getByRole('button', { name: 'Lagre vakt' }).click();

  // Filter: only Avdeling 4.
  await page.getByRole('button', { name: 'Vakter', exact: true }).click();
  await expect(page.getByText('2 vakter')).toBeVisible();
  await page.getByRole('group', { name: 'Vis arbeidsgiver' }).getByRole('button', { name: 'Avdeling 4' }).click();
  await expect(page.getByText('1 vakter')).toBeVisible();
  await page.getByRole('group', { name: 'Vis arbeidsgiver' }).getByRole('button', { name: 'Alle' }).click();

  // Copy Avdeling 2's setup to Avdeling 4: the wage goes back to 300.
  await page.getByRole('button', { name: 'Oppsett' }).click();
  await page.getByRole('button', { name: /Avdeling 2/ }).click();
  await page.getByRole('button', { name: /Kopier oppsettet/ }).click();
  await page.getByRole('button', { name: 'Kopier', exact: true }).click();
  await page.getByRole('button', { name: 'Alle arbeidsgivere' }).click();
  await expect(page.getByRole('button', { name: /Avdeling 4.*300 kr\/t/ })).toBeVisible();
});

test('a supplement added in setup counts on the next shift', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('vakt-local-data', JSON.stringify({
    settings: { onboarded: true, toured: true },
    employers: [{ id: 'e1', name: 'Jobben', color: '#7c3aed', wages: [{ from: '2000-01-01', hourly: 200 }], templates: [], sort: 0 }],
    supplements: [], shifts: [],
  })));
  await page.goto('/#/oppsett');
  await page.reload();
  await page.getByRole('button', { name: /Jobben/ }).click();
  await page.getByRole('button', { name: 'Legg til tillegg' }).click();
  await page.getByLabel('Navn', { exact: true }).fill('Helg');
  await page.getByLabel('Beløp').fill('50');
  await page.getByRole('button', { name: 'Helg', exact: true }).click();
  await page.getByRole('switch', { name: 'Hele døgnet' }).click();
  await page.getByRole('button', { name: 'Lagre' }).click();
  await expect(page.getByText('Helg, hele døgnet')).toBeVisible();

  await page.getByRole('button', { name: 'Ny vakt', exact: true }).click();
  await pickOnly(page, 24); // Saturday
  await page.getByLabel('Fra', { exact: true }).fill('08:00');
  await page.getByLabel('Til', { exact: true }).fill('16:00');
  await expect(page.getByTestId('shift-total')).toHaveText(/2\s000 kr/); // 8 × 200 + 8 × 50
});

test('data saved before employers existed moves to one employer', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('vakt-local-data', JSON.stringify({
    settings: { onboarded: true, toured: true, wages: [{ from: '2000-01-01', hourly: 250 }], templates: [] },
    supplements: [], shifts: [{ id: 's1', date: '2026-10-21', start_time: '08:00', end_time: '16:00', break_minutes: 0, overtime_percent: 0, note: '' }],
  })));
  await page.reload();
  await page.getByRole('button', { name: 'Oppsett' }).click();
  await expect(page.getByRole('button', { name: /Jobben min.*250 kr\/t.*1 vakter/ })).toBeVisible();
});

test('the walkthrough shows once, ends in a new shift, and can be started again', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('vakt-local-data', JSON.stringify({
    settings: { onboarded: true, name: 'Nikita' },
    employers: [{ id: 'e1', name: 'Jobben', color: '#7c3aed', wages: [{ from: '2000-01-01', hourly: 200 }], templates: [], sort: 0 }],
    supplements: [], shifts: [],
  })));
  await page.reload();
  const tour = page.getByRole('dialog', { name: 'Gjennomgang' });
  await expect(tour.getByText('Velkommen, Nikita!')).toBeVisible();
  for (const title of ['Månedens lønn', 'Bla mellom måneder', 'Legg inn en vakt', 'Alle vaktene', 'Året', 'Oppsett', 'Klar!']) {
    await tour.getByRole('button', { name: 'Neste' }).click();
    await expect(tour.getByText(title, { exact: true })).toBeVisible();
  }
  await tour.getByRole('button', { name: 'Legg inn første vakt' }).click();
  await expect(page.getByRole('dialog', { name: 'Ny vakt' })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('hero-total')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(tour).toHaveCount(0);

  await page.getByRole('button', { name: 'Oppsett' }).click();
  await page.getByRole('button', { name: 'Vis gjennomgangen igjen' }).click();
  await expect(tour.getByText('Velkommen, Nikita!')).toBeVisible();
});

test('several days at once, and adding from the calendar on Vakter', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('vakt-local-data', JSON.stringify({
    settings: { onboarded: true, toured: true },
    employers: [{ id: 'e1', name: 'Jobben', color: '#7c3aed', wages: [{ from: '2000-01-01', hourly: 200 }], templates: [{ id: 'd', name: 'Dag', start_time: '08:00', end_time: '16:00', break_minutes: 0 }], sort: 0 }],
    supplements: [], shifts: [],
  })));
  await page.reload();
  await page.getByRole('button', { name: 'Ny vakt', exact: true }).click();
  await pickOnly(page, 5);
  const cal = page.getByTestId('date-picker');
  await cal.getByRole('button', { name: /\b6\. oktober/ }).click();
  await cal.getByRole('button', { name: /\b7\. oktober/ }).click();
  await expect(page.getByTestId('shift-total')).toHaveText(/4\s800 kr/); // 3 × 8 × 200
  await page.getByRole('button', { name: 'Lagre 3 vakter' }).click();

  await page.getByRole('button', { name: 'Vakter', exact: true }).click();
  await expect(page.getByText('3 vakter', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Legg til vakt 2026-10-12' }).click();
  await expect(cal.getByRole('button', { name: /\b12\. oktober/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Lagre vakt' }).click();
  await expect(page.getByText('4 vakter', { exact: true })).toBeVisible();
});

const seed = (page: Page, extra: Record<string, unknown> = {}) => page.evaluate((x) => localStorage.setItem('vakt-local-data', JSON.stringify({
  settings: { onboarded: true, toured: true, tax_percent: 30 },
  employers: [{ id: 'e1', name: 'Jobben', color: '#7c3aed', wages: [{ from: '2000-01-01', hourly: 200 }], templates: [{ id: 'd', name: 'Dag', start_time: '08:00', end_time: '16:00', break_minutes: 0 }], sort: 0, pay_day: 12, pay_delay: 'supplements' }],
  supplements: [{ id: 'h', employer_id: 'e1', name: 'Helg', color: '#ec4899', amount_type: 'kr_per_hour', amount: 50, min_per_hour: null, days: ['sat', 'sun'], start_time: '00:00', end_time: '00:00', active: true, sort: 0 }],
  shifts: [
    { id: 's1', employer_id: 'e1', date: '2026-09-26', start_time: '08:00', end_time: '16:00', break_minutes: 0, overtime_percent: 0, note: '', status: 'worked' },
    { id: 's2', employer_id: 'e1', date: '2026-10-05', start_time: '08:00', end_time: '16:00', break_minutes: 0, overtime_percent: 0, note: '', status: 'worked' },
  ],
  ...x,
})), extra);

test('pay day, pay slip check, brutto/netto', async ({ page }) => {
  await page.goto('/');
  await seed(page);
  await page.reload();
  // October 12th: October's wage (1 600) and September's weekend supplement (400).
  await expect(page.getByText('Lønn på konto i oktober')).toBeVisible();
  await expect(page.getByTestId('payout-total')).toHaveText(/2\s000 kr/);
  await page.getByRole('button', { name: 'Sjekk mot lønnsslippen' }).click();
  await page.getByLabel('Brutto på lønnsslippen').fill('1800');
  await page.getByRole('button', { name: 'Lagre' }).click();
  await expect(page.getByTestId('slip-result')).toContainText('200 kr mindre');

  await expect(page.getByTestId('hero-total')).toHaveText(/1\s600 kr/);
  await page.getByRole('button', { name: 'Netto' }).click();
  await expect(page.getByTestId('hero-total')).toHaveText(/1\s120 kr/);
});

test('days off, a sick shift, and repeating a week', async ({ page }) => {
  await page.goto('/');
  await seed(page);
  await page.reload();
  await page.getByRole('button', { name: 'Ny vakt', exact: true }).click();
  await page.getByRole('button', { name: 'Fri / ferie' }).click();
  await pickOnly(page, 14);
  await page.getByTestId('date-picker').getByRole('button', { name: /\b15\. oktober/ }).click();
  await page.getByRole('button', { name: 'Lagre 2 dager' }).click();
  await page.getByRole('button', { name: 'Vakter', exact: true }).click();
  await expect(page.getByRole('button', { name: '2026-10-14: Ferie' })).toBeVisible();

  await page.getByRole('button', { name: /08:00–16:00/ }).first().click();
  await page.getByRole('switch', { name: 'Jeg var syk' }).click();
  await page.getByRole('button', { name: 'Lagre', exact: true }).click();
  await expect(page.getByText('· Syk')).toBeVisible();

  await page.getByRole('button', { name: 'Gjenta uker' }).click();
  await page.getByRole('button', { name: '2×' }).click();
  await page.getByRole('button', { name: 'Legg inn 2 vakter' }).click();
  await expect(page.getByText('3 vakter', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'År' }).click();
  await expect(page.getByText('Feriepenger')).toBeVisible();
});

test('iPad: a side rail instead of the bottom bar, and the walkthrough finds it', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await seed(page, { settings: { onboarded: true, toured: false } });
  await page.reload();
  const rail = page.getByRole('navigation', { name: 'Meny' });
  await expect(rail).toBeVisible();
  const tour = page.getByRole('dialog', { name: 'Gjennomgang' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'Hopp over' }).click();
  await rail.getByRole('button', { name: 'Ny vakt' }).click();
  await expect(page.getByRole('dialog', { name: 'Ny vakt' })).toBeVisible();
});

test('light, dark or auto from Oppsett, remembered after a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await seed(page);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Oppsett' }).click();
  await page.getByRole('group', { name: 'Lys eller mørk' }).getByRole('button', { name: 'Mørk' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('group', { name: 'Lys eller mørk' }).getByRole('button', { name: 'Auto' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the same shift on a day that already has it is not added twice', async ({ page }) => {
  await page.goto('/');
  await seed(page);
  await page.reload();
  await page.getByRole('button', { name: 'Ny vakt', exact: true }).click();
  await pickOnly(page, 5); // already has the 08:00 shift
  await page.getByTestId('date-picker').getByRole('button', { name: /\b6\. oktober/ }).click();
  await page.getByRole('button', { name: 'Lagre 2 vakter' }).click();
  await expect(page.getByText('(1 fantes fra før)')).toBeVisible();
  await page.getByRole('button', { name: 'Vakter', exact: true }).click();
  await expect(page.getByText('2 vakter', { exact: true })).toBeVisible();
});

test('quick entry: pick a shift type, tap the days, tap again to take one away', async ({ page }) => {
  await page.goto('/');
  await seed(page);
  await page.reload();
  await page.getByRole('button', { name: 'Vakter', exact: true }).click();
  await page.getByRole('group', { name: 'Legg inn raskt' }).getByRole('button', { name: 'Dag' }).click();
  for (const d of ['2026-10-12', '2026-10-13', '2026-10-14']) await page.getByRole('button', { name: `Legg til vakt ${d}` }).click();
  await expect(page.getByTestId('quick-added')).toHaveText(/\+3 vakter · \+4\s800 kr/);
  await page.getByRole('button', { name: /^2026-10-14: 1 vakt/ }).click(); // a second tap removes it
  await expect(page.getByTestId('quick-added')).toHaveText(/\+2 vakter/);
  await page.getByRole('group', { name: 'Legg inn raskt' }).getByRole('button', { name: 'Ferie' }).click();
  await page.getByRole('button', { name: 'Legg til vakt 2026-10-19' }).click();
  await expect(page.getByRole('button', { name: '2026-10-19: Ferie' })).toBeVisible();
  await page.getByTestId('quick-entry').getByRole('button', { name: 'Ferdig' }).click();
  await expect(page.getByText('3 vakter', { exact: true })).toBeVisible(); // the seeded October shift and two new ones
});

test('this week and the next pay day on the overview', async ({ page }) => {
  await page.goto('/');
  await seed(page, { shifts: [{ id: 's1', employer_id: 'e1', date: '2026-10-24', start_time: '08:00', end_time: '16:00', break_minutes: 0, overtime_percent: 0, note: '', status: 'worked' }] });
  await page.reload();
  await expect(page.getByTestId('week-total')).toHaveText(/2\s000 kr/); // Saturday: 1 600 + 400 weekend
  await expect(page.getByTestId('next-pay')).toContainText('Neste lønning 12. nov');
  await page.getByRole('button', { name: 'Legg til vakt 2026-10-20' }).click();
  await expect(page.getByTestId('date-picker').getByRole('button', { name: /\b20\. oktober/ })).toHaveAttribute('aria-pressed', 'true');
});

test('the pay settlement question, the Ny vakt shortcut, and the import sheet', async ({ page }) => {
  await page.goto('/');
  await seed(page);
  await page.reload();
  const card = page.getByTestId('wage-check');
  await expect(card).toContainText('Lønnsoppgjøret 2026');
  await card.getByRole('button', { name: 'Ingen endring' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('wage-check')).toHaveCount(0);

  await page.goto('/?fra=ikon#/ny'); // a fresh start from the shortcut
  await expect(page.getByRole('dialog', { name: 'Ny vakt' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Vakter', exact: true }).click();
  await page.getByRole('button', { name: 'Importer fra GAT' }).click();
  await expect(page.getByText('Import krever at du er logget inn.')).toBeVisible();
});
