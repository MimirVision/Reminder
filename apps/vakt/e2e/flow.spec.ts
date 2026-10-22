// The whole first-time flow in local mode (no database): onboarding, adding shifts, and the numbers on each screen.
import { expect, test } from '@playwright/test';

test('onboarding, adding shifts and seeing what they pay', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Navn').fill('Sara');
  await page.getByLabel('Timelønn').fill('300');
  await page.getByRole('button', { name: 'Neste' }).click();
  await expect(page.getByText('Kveldstillegg')).toBeVisible();
  await page.getByRole('button', { name: 'Neste' }).click();
  await page.getByLabel('Månedsmål').fill('30000');
  await page.getByRole('button', { name: 'Kom i gang' }).click();

  await expect(page.getByTestId('motivation')).toContainText('første vakt');

  // A weekday evening shift 15:00–22:30: 7.5 h × 300, 4 h evening and 1.5 h night supplement at 25 % (75 kr/t).
  await page.getByRole('button', { name: 'Ny vakt', exact: true }).click();
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

test('a supplement added in settings counts on the next shift', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('vakt-local-data', JSON.stringify({
    settings: { onboarded: true, wages: [{ from: '2000-01-01', hourly: 200 }], templates: [] }, supplements: [], shifts: [],
  })));
  await page.goto('/#/innstillinger');
  await page.reload();
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
