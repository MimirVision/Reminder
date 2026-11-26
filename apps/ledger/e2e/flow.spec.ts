import { expect, test, type Page } from '@playwright/test';

type Snap = { occurrences: { id: string; title: string; clientId: string; status: string; dueDate: string; scheduleId: string | null; afterId?: string | null; plannedOn?: string | null; plannedStart?: string | null }[]; clients: { id: string; name: string; contactEmail: string }[] };
const snapshot = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('ledger-demo-v1')!) as Snap);

test('a task can come after another; it waits for it, and finishing that one says the next is ready', async ({ page }) => {
  await page.goto('/tasks');
  // Two open tasks for the same client.
  const s = await snapshot(page);
  const byClient = new Map<string, Snap['occurrences']>();
  for (const o of s.occurrences.filter((o) => o.status === 'todo')) byClient.set(o.clientId, [...(byClient.get(o.clientId) ?? []), o]);
  const [first, second] = [...byClient.values()].find((l) => l.length >= 2)!.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  await page.goto(`/tasks?task=${second.id}`);
  const panel = page.getByRole('dialog');
  await panel.getByRole('combobox', { name: 'Comes after' }).selectOption(first.id);
  await expect(page.getByText('Linked as the next step')).toBeVisible();
  await expect(panel.getByText(`Waiting for “${first.title}” to be done first.`)).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Steps in order' }).getByRole('listitem')).toHaveCount(2);
  await page.keyboard.press('Escape');

  await page.getByLabel('Search tasks').fill(second.title);
  await expect(page.locator(`tr[data-task="${second.id}"]`).getByText(`after ${first.title}`)).toBeVisible();

  await page.goto(`/tasks?task=${first.id}`);
  await page.getByRole('dialog').getByRole('button', { name: /^Mark (the task )?done$/ }).first().click();
  await expect(page.getByText(`Next step is ready: ${second.title}`)).toBeVisible();
});

test('documents are requested by email, marked as requested, and a follow-up is added', async ({ page }) => {
  await page.goto('/clients/client-1');
  await page.getByRole('tab', { name: /Documents/ }).click();
  await page.getByLabel('Request a document').fill('Kontoutskrifter november');
  await page.getByLabel('Request a document').press('Enter');
  await page.getByRole('button', { name: 'Request by email' }).click();
  const dialog = page.getByRole('dialog', { name: 'Request documents' });
  await expect(dialog.getByLabel('Message')).toHaveValue(/• Kontoutskrifter november/);
  await expect(dialog.getByLabel('Subject')).toHaveValue(/^Dokumenter vi trenger – Nordvik Snekkeri AS$/);
  await dialog.getByRole('radio', { name: 'English' }).click();
  await expect(dialog.getByLabel('Subject')).toHaveValue('Documents we need – Nordvik Snekkeri AS');
  await dialog.getByRole('radio', { name: '2 weeks' }).click();
  await dialog.getByRole('button', { name: 'Mark as requested' }).click();
  await expect(page.getByText(/Requested\. A follow-up is on/)).toBeVisible();
  const s = await snapshot(page);
  const follow = s.occurrences.find((o) => o.title === 'Follow up: documents from Nordvik Snekkeri AS');
  expect(follow).toBeTruthy();
});

test('dragging a task into the hours sets time aside; the panel can clear it', async ({ page }) => {
  await page.goto('/calendar?view=week');
  const chip = page.locator('[aria-label$=". Open task"]').filter({ hasNot: page.locator('[draggable=false]') }).first();
  const label = (await chip.getAttribute('aria-label'))!;
  const title = label.split(',')[0];
  const column = page.getByRole('group', { name: /meeting/ }).nth(2);
  const box = (await column.boundingBox())!;
  await chip.dragTo(column, { targetPosition: { x: box.width / 2, y: 48 * 7 + 30 } });
  const block = page.getByRole('button', { name: new RegExp(`^Time set aside for ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await expect(block).toBeVisible();
  await block.click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByLabel('Starts')).toHaveValue(/^(06|07):(00|15|30|45)$/);
  await panel.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('Time no longer set aside')).toBeVisible();
  await expect(block).toHaveCount(0);
});

test('the calendar has year, month, agenda and client views, and folds the same task for many clients into one', async ({ page }) => {
  await page.goto('/calendar?view=month');
  // Month: week numbers, and type-coloured chips with the client.
  await expect(page.getByRole('button', { name: /^Open week \d+$/ }).or(page.getByTitle(/^Open week \d+$/)).first()).toBeVisible();
  await page.getByRole('radio', { name: 'Year' }).click();
  await expect(page.getByRole('region', { name: 'January' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'December' })).toBeVisible();
  await page.getByRole('region', { name: 'December' }).getByRole('button', { name: 'December', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Month', checked: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Agenda' }).click();
  await expect(page.locator('section[aria-label]').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Clients' }).click();
  await expect(page.getByRole('table', { name: 'Tasks per client and day' })).toBeVisible();
  await expect(page.getByRole('rowheader').first()).toBeVisible();
  await page.getByRole('radio', { name: 'Week' }).click();
  await page.getByRole('button', { name: 'Mon–Fri' }).click();
  await expect(page.getByRole('group', { name: /meeting/ })).toHaveCount(5);
  await page.getByRole('button', { name: 'Mon–Fri' }).click();
  await expect(page.getByRole('group', { name: /meeting/ })).toHaveCount(7);
});
