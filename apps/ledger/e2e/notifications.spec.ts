import { expect, test, type Page } from '@playwright/test';

// The browser's Notification API, faked: headless Chromium can't show real ones. It records what Ledger shows.
async function fakeNotifications(page: Page, granted = false) {
  await page.addInitScript((g) => {
    const shown: { title: string; body?: string; tag?: string }[] = [];
    (window as unknown as { __shown: typeof shown }).__shown = shown;
    class FakeNotification {
      // Kept for the tab's session, like a real permission.
      static get permission(): NotificationPermission { return g || sessionStorage.getItem('fake-permission') ? 'granted' : 'default'; }
      static async requestPermission() { sessionStorage.setItem('fake-permission', 'granted'); return 'granted' as const; }
      onclick: (() => void) | null = null;
      constructor(title: string, opts: { body?: string; tag?: string } = {}) { shown.push({ title, ...opts }); }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });
    if (g) localStorage.setItem('ledger-notify-device', 'local');
  }, granted);
}
const shown = (page: Page) => page.evaluate(() => (window as unknown as { __shown: { title: string; body?: string }[] }).__shown);

test('notifications are turned on from the Home prompt, and a test arrives', async ({ page }) => {
  await fakeNotifications(page);
  await page.goto('/');
  const prompt = page.getByRole('region', { name: 'Notifications' });
  await expect(prompt.getByText(/Get reminders on this computer/)).toBeVisible();
  await expect(prompt.getByText(/On the day at 08:00 for tasks, 15 min before for meetings/)).toBeVisible();
  await prompt.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('Notifications are on. In the demo they appear while Ledger is open.')).toBeVisible();
  await expect(prompt).toBeHidden();

  await page.goto('/settings');
  await expect(page.getByText(/On while Ledger is open/)).toBeVisible();
  await page.getByRole('button', { name: 'Send a test' }).click();
  await expect.poll(() => shown(page)).toContainEqual(expect.objectContaining({ title: 'Ledger notifications work' }));
  await page.getByRole('button', { name: 'Turn off here' }).click();
  await expect(page.getByRole('button', { name: 'Turn on for this device' })).toBeVisible();
});

test('the default reminders are chosen in Settings and kept', async ({ page }) => {
  await page.goto('/settings');
  const tasks = page.getByRole('group', { name: 'Task notifications' });
  await expect(tasks.getByRole('button', { name: 'On the day' })).toHaveAttribute('aria-pressed', 'true');
  await tasks.getByRole('button', { name: '3 days' }).click();
  await expect(page.getByText('On the day and 3 days before at 08:00')).toBeVisible();
  await page.getByLabel('Time task notifications arrive').fill('07:30');
  await page.getByLabel('Time task notifications arrive').blur();
  await expect(page.getByText('Task notifications arrive at 07:30')).toBeVisible();
  const meetings = page.getByRole('group', { name: 'Meeting notifications' });
  await meetings.getByRole('button', { name: '1 hour' }).click();
  await page.getByRole('radio', { name: 'Hide names' }).click();

  await page.reload();
  await expect(page.getByRole('group', { name: 'Task notifications' }).getByRole('button', { name: '3 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Time task notifications arrive')).toHaveValue('07:30');
  await expect(page.getByRole('group', { name: 'Meeting notifications' }).getByRole('button', { name: '1 hour' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('radio', { name: 'Hide names' })).toHaveAttribute('aria-checked', 'true');
});

test('a task and a meeting can have their own earlier notifications', async ({ page }) => {
  await page.goto('/tasks');
  await page.locator('tbody tr[data-task]').first().locator('td').nth(2).click();
  const panel = page.getByRole('dialog');
  const picker = panel.getByRole('button', { name: /^Notifications:/ });
  await expect(picker).toContainText('On the day at 08:00 (');
  await picker.click();
  await page.getByRole('group', { name: 'Notifications' }).getByRole('button', { name: '1 week' }).click();
  await expect(page.getByText('Notifications saved')).toBeVisible();
  await expect(picker).toContainText('On the day and 1 week before at 08:00');
  await page.getByRole('button', { name: /Use the default/ }).click();
  await expect(picker).toContainText('On the day at 08:00 (');
  await page.keyboard.press('Escape');

  await page.goto('/calendar');
  await page.getByRole('button', { name: 'New meeting' }).click();
  const dialog = page.getByRole('dialog', { name: 'New meeting' });
  await dialog.getByLabel('Title').fill('E2E: VAT review');
  await dialog.getByRole('button', { name: /^Notifications:/ }).click();
  await page.getByRole('group', { name: 'Notifications' }).getByRole('button', { name: '1 day' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: /^Notifications:/ })).toContainText('15 min before and 1 day before');
  await dialog.getByRole('button', { name: 'Book meeting' }).click();
  await expect(page.getByText(/Meeting booked/)).toBeVisible();
  const saved = await page.evaluate(() => (JSON.parse(localStorage.getItem('ledger-demo-v1')!) as { meetings: { title: string; notifyMinutes?: number[] }[] })
    .meetings.find((m) => m.title === 'E2E: VAT review')?.notifyMinutes);
  expect(saved).toEqual([1440, 15]);
});

test('a notification’s link opens the task', async ({ page }) => {
  await page.goto('/');
  const task = await page.evaluate(() => (JSON.parse(localStorage.getItem('ledger-demo-v1')!) as { occurrences: { id: string; title: string; status: string }[] })
    .occurrences.find((o) => o.status === 'todo')!);
  await page.goto(`/tasks?task=${task.id}`);
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue(task.title);
  await expect(page).not.toHaveURL(/task=/);
});

test('while Ledger is open, reminders that fall due are shown', async ({ page }) => {
  await fakeNotifications(page, true);
  await page.goto('/');
  // Make the daily task reminder fall a minute ago, so the tasks due today are announced right away.
  await page.evaluate(() => {
    const snap = JSON.parse(localStorage.getItem('ledger-demo-v1')!);
    const d = new Date(Date.now() - 60_000);
    snap.workspace.settings.notifications = { taskTime: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
    snap.workspace.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    localStorage.setItem('ledger-demo-v1', JSON.stringify(snap));
  });
  await page.reload();
  await expect.poll(() => shown(page)).toContainEqual(expect.objectContaining({ title: expect.stringMatching(/due today/i) }));
  const first = (await shown(page)).length;
  // Not again after a reload: each reminder is shown once.
  await page.reload();
  await page.waitForTimeout(1000);
  expect((await shown(page)).length).toBe(0);
  expect(first).toBeGreaterThan(0);
});
