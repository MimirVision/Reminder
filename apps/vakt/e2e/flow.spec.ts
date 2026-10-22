// The whole flow in local mode (no database): onboarding, setup, adding shifts, and the numbers on each screen.
import { expect, test, type Page } from '@playwright/test';

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
}

test('onboarding, adding shifts and seeing what they pay', async ({ page }) => {
  await onboard(page);
  await expect(page.getByTestId('motivation')).toContainText('første vakt');

  // A weekday evening shift 15:00–22:30: 7.5 h × 300, 4 h evening and 1.5 h night supplement at 25 % (75 kr/t).
  await page.getByRole('button', { name: 'Ny vakt', exact: true }).click();
  await expect(page.getByText('Hvor jobber du?')).toHaveCount(0); // only one employer: no choice to make
  await page.getByRole('button', { name: /Kveld/ }).first().click();
  await page.getByLabel('Dato').fill('2026-10-21');
  await expect(page.getByTestId('shift-total')).toHaveText(/2\s663 kr/);
  await page.getByRole('button', { name: 'Lagre + ny' }).click();
  // The next day, already filled in: change it to a night shift.
  await expect(page.getByLabel('Dato')).toHaveValue('2026-10-22');
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
  await page.getByLabel('Dato').fill('2026-10-21');
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
    settings: { onboarded: true },
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
  await page.getByLabel('Dato').fill('2026-10-24'); // Saturday
  await page.getByLabel('Fra', { exact: true }).fill('08:00');
  await page.getByLabel('Til', { exact: true }).fill('16:00');
  await expect(page.getByTestId('shift-total')).toHaveText(/2\s000 kr/); // 8 × 200 + 8 × 50
});

test('data saved before employers existed moves to one employer', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('vakt-local-data', JSON.stringify({
    settings: { onboarded: true, wages: [{ from: '2000-01-01', hourly: 250 }], templates: [] },
    supplements: [], shifts: [{ id: 's1', date: '2026-10-21', start_time: '08:00', end_time: '16:00', break_minutes: 0, overtime_percent: 0, note: '' }],
  })));
  await page.reload();
  await page.getByRole('button', { name: 'Oppsett' }).click();
  await expect(page.getByRole('button', { name: /Jobben min.*250 kr\/t.*1 vakter/ })).toBeVisible();
});
