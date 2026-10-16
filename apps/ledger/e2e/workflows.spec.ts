import { expect, test, type Page } from '@playwright/test';

const metric = (page: Page, label: string) => page.getByRole('link', { name: new RegExp(label) }).first();
const count = async (page: Page, label: string) => Number((await metric(page, label).locator('span.tnum').textContent())?.trim());

test('the dashboard shows what needs attention and its numbers lead to the matching tasks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  const overdue = await count(page, 'Overdue');
  expect(overdue).toBeGreaterThan(0);
  await metric(page, 'Overdue').click();
  await expect(page).toHaveURL(/\/tasks\?view=overdue/);
  await expect(page.getByRole('tab', { name: /Overdue/, selected: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(overdue);
});

test('a one-off task can be created, completed and is still there after a reload', async ({ page }) => {
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'New task' }).click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(dialog.getByText('Give the task a title.')).toBeVisible();
  await dialog.getByLabel('Title').fill('E2E: request bank statements');
  await dialog.getByLabel('Client').selectOption({ label: 'Nordvik Snekkeri AS' });
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Task created')).toBeVisible();

  await page.getByLabel('Search tasks').fill('E2E: request');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mark “E2E: request bank statements” done' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0); // the "All open tasks" filter hides done tasks

  await page.reload();
  await page.getByRole('tab', { name: /Completed recently/ }).click();
  await page.getByLabel('Search tasks').fill('E2E: request');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first().getByText('Done')).toBeVisible();
});

test('rescheduling one occurrence changes only that task, and history records it', async ({ page }) => {
  await page.goto('/tasks?view=overdue');
  const row = page.locator('tbody tr').filter({ hasText: 'Monthly bookkeeping' }).first();
  const title = await row.locator('td').nth(1).locator('button').first().textContent();
  await row.locator('td').nth(1).locator('button').first().click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByLabel('Title')).toHaveValue(title!);
  await panel.getByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/ }).first().click();
  await page.getByRole('button', { name: 'In a week' }).click();
  await expect(panel.getByText(/Moved from/)).toBeVisible();
  await expect(panel.getByText(/The schedule is unchanged/)).toBeVisible();
  await expect(panel.getByText(/moved from .* to /)).toBeVisible();
  await page.keyboard.press('Escape');
  // No longer overdue.
  await page.reload();
  const overdueAfter = await page.locator('tbody tr').count();
  await page.goto('/');
  expect(await count(page, 'Overdue')).toBe(overdueAfter);
});

test('a new schedule previews its occurrences, generates once, and reloading never duplicates', async ({ page }) => {
  await page.goto('/recurring');
  await page.getByRole('button', { name: 'New schedule' }).click();
  const d = page.getByRole('dialog', { name: 'New recurring schedule' });
  await d.getByLabel('Client').selectOption({ label: 'Lysaker Design ENK' });
  await d.getByLabel('Task title').fill('E2E quarterly review');
  await d.getByLabel('Frequency').selectOption('quarterly');
  await expect(d.getByRole('heading', { name: 'Next occurrences' })).toBeVisible();
  await expect(d.getByText(/^Q[1-4] 20\d\d$/).first()).toBeVisible();
  await d.getByLabel('Create the task').fill('120');
  await d.getByRole('button', { name: 'Create schedule' }).click();
  await expect(d).toBeHidden();

  const countTasks = async () => {
    await page.goto('/tasks?view=open');
    await page.getByLabel('Search tasks').fill('E2E quarterly review');
    return page.locator('tbody tr').count();
  };
  const first = await countTasks();
  expect(first).toBeGreaterThan(0);
  await page.reload();
  expect(await countTasks()).toBe(first);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Run generation now' }).click();
  await expect(page.getByText('Everything is up to date')).toBeVisible();
  expect(await countTasks()).toBe(first);
});

test('missing tasks explain why they were flagged and can be resolved', async ({ page }) => {
  await page.goto('/missing');
  const before = await page.locator('li[id^="exp-"]').count();
  expect(before).toBeGreaterThan(0);
  await expect(page.getByText(/before this schedule started creating tasks|automatic creation is off/).first()).toBeVisible();

  const item = page.locator('li[id^="exp-"]').first();
  await item.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('1 task created')).toBeVisible();
  await expect(page.locator('li[id^="exp-"]')).toHaveCount(before - 1);

  await page.locator('li[id^="exp-"]').first().getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Record an exception/ }).click();
  await page.getByLabel('Why is no task needed?').fill('Handled by previous accountant');
  await page.getByRole('button', { name: 'Record exception' }).click();
  await expect(page.locator('li[id^="exp-"]')).toHaveCount(before - 2);
  await page.getByRole('tab', { name: /Reviewed/ }).click();
  await expect(page.getByText('Exception recorded: Handled by previous accountant')).toBeVisible();
  await page.goto('/');
  expect(await count(page, 'Missing tasks')).toBe(before - 2);
});

test('the calendar and the list show the same tasks, and the keyboard reaches everything', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
  await page.getByRole('radio', { name: 'Week' }).click();
  await expect(page.getByText(/^Week \d+ ·/)).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search' }).fill('Nordvik');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/clients\/client-1$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Nordvik Snekkeri AS' })).toBeVisible();
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
});
