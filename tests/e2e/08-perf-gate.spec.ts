import { expect, test, type Page } from '@playwright/test';

function capturePerfLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', message => {
    if (message.type() === 'info' && message.text().startsWith('[perf] ')) {
      logs.push(message.text());
    }
  });
  return logs;
}

async function updateCandyInventory(page: Page): Promise<void> {
  await page.locator('[data-testid="calc-empty-settings-link"]').click();
  const input = page.locator('[data-testid="settings-universal-candy-s-input"]');
  await input.fill('123');
  await input.blur();
  await page.waitForTimeout(650);
}

test.describe('runtime performance gate', () => {
  test('通常URLではperfログと検算TSVを無効化する', async ({ page }) => {
    const perfLogs = capturePerfLogs(page);
    await page.goto('/');

    await expect(page.locator('[data-testid="calc-debug-export-button"]')).toHaveCount(0);
    await updateCandyInventory(page);
    expect(perfLogs).toEqual([]);
  });

  test('?perf=1ではperfログと検算TSVを有効化する', async ({ page }) => {
    const perfLogs = capturePerfLogs(page);
    await page.goto('/?perf=1');

    await expect(page.locator('[data-testid="calc-debug-export-button"]')).toBeVisible();
    await updateCandyInventory(page);
    expect(perfLogs.length).toBeGreaterThan(0);
  });
});
