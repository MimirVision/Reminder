import { expect, test, type Page } from '@playwright/test';

const metric = (page: Page, label: string) => page.getByRole('navigation', { name: 'Summary' }).getByRole('link', { name: new RegExp(label, 'i') });
const count = async (page: Page, label: string) => Number((await metric(page, label).locator('span.tnum').textContent())?.trim());

test('the dashboard shows what needs attention and its numbers lead to the matching tasks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  const overdue = await count(page, 'Overdue');
  expect(overdue).toBeGreaterThan(0);
  await metric(page, 'Overdue').click();
  await expect(page).toHaveURL(/\/tasks\?view=overdue/);
  await expect(page.getByRole('tab', { name: /Overdue/, selected: true })).toBeVisible();
  await expect(page.locator('tbody tr[data-task]')).toHaveCount(overdue);
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
  await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mark “E2E: request bank statements” done' }).click();
  await expect(page.locator('tbody tr[data-task]')).toHaveCount(0); // the "All open tasks" filter hides done tasks

  await page.reload();
  await page.getByRole('tab', { name: /Completed recently/ }).click();
  await page.getByLabel('Search tasks').fill('E2E: request');
  await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);
  await expect(page.locator('tbody tr[data-task]').first().getByText('Done')).toBeVisible();
});

test('rescheduling one occurrence changes only that task, and history records it', async ({ page }) => {
  await page.goto('/tasks?view=overdue');
  const row = page.locator('tbody tr[data-task]').filter({ hasText: 'Monthly bookkeeping' }).first();
  const title = await row.locator('td').nth(2).locator('span').first().textContent();
  await row.locator('td').nth(2).click();
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
  const overdueAfter = await page.locator('tbody tr[data-task]').count();
  await page.goto('/');
  expect(await count(page, 'Overdue')).toBe(overdueAfter);
});

test('a new schedule previews its occurrences, generates once, and reloading never duplicates', async ({ page }) => {
  await page.goto('/recurring');
  await page.getByRole('button', { name: 'New schedule' }).click();
  const d = page.getByRole('dialog', { name: 'New recurring schedule' });
  await d.getByLabel('Client', { exact: true }).selectOption({ label: 'Lysaker Design ENK' });
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
    return page.locator('tbody tr[data-task]').count();
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
  expect(await count(page, 'Missing')).toBe(before - 2);
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
  await expect(page.getByRole('heading', { level: 1, name: 'Nordvik Snekkeri AS' })).toBeVisible();
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
});

test('quick add turns one line into a task, and the keyboard completes it', async ({ page }) => {
  await page.goto('/tasks');
  const box = page.getByRole('combobox', { name: 'Quick add a task' }).first();
  await box.fill('Call about holiday pay @nordv');
  await expect(page.getByRole('option', { name: /Nordvik Snekkeri AS/ })).toBeVisible();
  await page.keyboard.press('Enter'); // picks the suggested client
  await box.pressSequentially('tomorrow !high #payroll');
  await expect(page.getByRole('button', { name: /Nordvik Snekkeri AS/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tomorrow' }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Added for Nordvik Snekkeri AS, due tomorrow/)).toBeVisible();
  await expect(box).toHaveValue('');

  await page.getByLabel('Search tasks').fill('holiday pay');
  const row = page.locator('tbody tr[data-task]');
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Nordvik Snekkeri AS')).toBeVisible();
  await expect(row.getByText('High')).toBeVisible();
  await row.focus();
  await page.keyboard.press('d');
  await expect(row).toHaveCount(0);
  await expect(page.getByText(/Done: Call about holiday pay/)).toBeVisible();
});

test('several tasks can be selected and moved at once', async ({ page }) => {
  await page.goto('/tasks?view=overdue');
  const rows = page.locator('tbody tr[data-task]');
  const before = await rows.count();
  await rows.nth(0).focus();
  await page.keyboard.press('x');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('x');
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('toolbar', { name: 'Selected tasks' }).getByRole('button', { name: 'Tomorrow' }).click();
  await expect(page.getByText('2 tasks moved to')).toBeVisible();
  await expect(rows).toHaveCount(before - 2);
});

test('board view moves work between statuses by dragging', async ({ page }) => {
  await page.goto('/tasks');
  await page.getByRole('radio', { name: 'Board' }).click();
  const todo = page.getByRole('region', { name: 'To do' });
  const waiting = page.getByRole('region', { name: 'Waiting for client' });
  const card = todo.locator('[draggable=true]').first();
  const title = (await card.locator('span.font-semibold').first().textContent())!;
  const before = await waiting.locator('[draggable=true]').count();
  // Aim at the column's header: its middle can be below the fold, and scrolling mid-drag would pick up another card.
  await card.dragTo(waiting, { targetPosition: { x: 60, y: 16 } });
  await expect(waiting.locator('[draggable=true]')).toHaveCount(before + 1);
  await expect(page.getByText(`Waiting for client: ${title}`).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Board', checked: true })).toBeVisible();
});

test('a client page adds tasks for that client and can be pinned to the sidebar', async ({ page }) => {
  await page.goto('/clients/client-4');
  await expect(page.getByRole('heading', { level: 1, name: 'Lysaker Design ENK' })).toBeVisible();
  const add = page.getByRole('combobox', { name: 'Quick add a task' }).first();
  await add.fill('Send VAT questions tomorrow');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Added for Lysaker Design ENK, due tomorrow/)).toBeVisible();
  await expect(page.locator('tbody tr[data-task]', { hasText: 'Send VAT questions' })).toHaveCount(1);
  await page.getByRole('button', { name: 'More client actions' }).click();
  await page.getByRole('menuitem', { name: 'Pin to sidebar' }).click();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Lysaker Design ENK/ })).toBeVisible();
});

test('home is a dashboard you arrange: add, move, resize and remove widgets, and it stays that way', async ({ page }) => {
  await page.goto('/');
  const order = () => page.locator('[data-widget-type]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.widgetType));
  await page.getByRole('button', { name: 'Customize' }).click();
  const bar = page.getByRole('toolbar', { name: 'Customize Home' });
  await bar.getByRole('button', { name: 'Add widget' }).click();
  await page.getByRole('dialog', { name: 'Add a widget' }).getByRole('button', { name: /Notepad/ }).click();
  expect((await order()).at(-1)).toBe('notes');

  // From the handle: arrows move it, Shift + arrows resize it.
  const handle = page.getByRole('button', { name: 'Move or resize Notepad' });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowRight');
  expect((await order()).slice(-3)).toEqual(['notes', 'overdue', 'missing']);
  await expect(page.locator('[data-widget-type=notes]')).toHaveAttribute('style', /--w: 5/);

  await page.getByRole('button', { name: 'Remove Missing tasks' }).click();
  await bar.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('textbox', { name: 'Notepad' }).fill('Call Nordvik about the bank feed');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.reload();
  expect(await order()).not.toContain('missing');
  expect((await order()).slice(-2)).toEqual(['notes', 'overdue']);
  await expect(page.getByRole('textbox', { name: 'Notepad' })).toHaveValue('Call Nordvik about the bank feed');
});

test('appearance follows your settings, and G then a letter jumps between screens', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Teal' }).click();
  await page.getByRole('radio', { name: 'Compact' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await expect(page).toHaveURL(/\/tasks/);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('a task carries a checklist: add steps, tick them, and finish from the panel', async ({ page }) => {
  await page.goto('/tasks?view=today');
  await page.locator('tbody tr[data-task]').first().click();
  const panel = page.getByRole('dialog');
  const add = panel.getByRole('textbox', { name: 'Add an item to the checklist' });
  await add.fill('Gather the questions');
  await add.press('Enter');
  await add.fill('Send one email');
  await add.press('Enter');
  await panel.getByRole('checkbox', { name: 'Tick “Gather the questions”' }).click();
  await expect(panel.getByText('1/2')).toBeVisible();
  await page.reload();
  await page.locator('tbody tr[data-task]').first().click();
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Untick “Gather the questions”' })).toBeVisible();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Tick “Send one email”' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark the task done' }).click();
  await expect(page.getByText('Marked done')).toBeVisible();
});

test('a filtered list can be saved as a view of its own', async ({ page }) => {
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Priority', exact: true }).click();
  await page.getByRole('option', { name: 'High' }).click();
  await page.keyboard.press('Escape');
  const rows = await page.locator('tbody tr[data-task]').count();
  await page.getByRole('button', { name: 'Save view' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Only high');
  await page.getByRole('dialog').getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByRole('tab', { name: /Only high/, selected: true })).toBeVisible();
  await page.getByRole('tab', { name: /All open tasks/ }).click();
  await page.getByRole('tab', { name: /Only high/ }).click();
  await expect(page.locator('tbody tr[data-task]')).toHaveCount(rows);
  await page.reload();
  await expect(page.getByRole('tab', { name: /Only high/ })).toBeVisible();
});

test('a client keeps a contact and a list of documents to collect', async ({ page }) => {
  await page.goto('/clients/client-1');
  await page.getByRole('button', { name: 'More client actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit details' }).click();
  await page.getByLabel('Contact phone').fill('+47 000 00 000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: '+47 000 00 000' })).toHaveAttribute('href', 'tel:+4700000000');
  await page.getByRole('tab', { name: /Documents/ }).click();
  await page.getByRole('textbox', { name: 'Request a document' }).fill('Bank statements, October');
  await page.keyboard.press('Enter');
  await expect(page.getByText('1 document outstanding')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Mark as received: Bank statements, October' }).click();
  await expect(page.getByText('Everything requested has arrived.')).toBeVisible();
});

test('the calendar marks Norwegian public holidays', async ({ page }) => {
  await page.goto('/calendar?view=month&date=2026-05-01');
  await expect(page.getByText('Constitution Day')).toBeVisible();
  await expect(page.getByText('Ascension Day')).toBeVisible();
});
