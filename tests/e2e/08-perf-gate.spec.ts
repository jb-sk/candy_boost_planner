import { expect, test, type Page } from '@playwright/test';
import { SettingsModalPage } from './pages/SettingsModalPage';

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

  test('デバッグ用の現在日時はURLへ保存され、解除で消える', async ({ page }) => {
    const button = page.locator('[data-testid="calc-debug-now-button"]');
    const value = page.locator('[data-testid="calc-debug-now-value"]');

    // 通常URLでは出さない。
    await page.goto('/');
    await expect(button).toHaveCount(0);

    // 実在しない日付も空値も無かったことにし、URLからも消す。
    await page.goto('/?perf=1&now=2026-02-29T12:00');
    await expect(button).toHaveText('日時変更');
    await expect(page).toHaveURL(/\?perf=1$/);

    await page.goto('/?perf=1&now=');
    await expect(button).toHaveText('日時変更');
    await expect(page).toHaveURL(/\?perf=1$/);

    // Safari（iOSを含む）に showPicker() は無いので、未設定のあいだは入力欄が
    // ボタン全面を覆い、タップがそのままネイティブピッカーになることに頼っている。
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    const topTestId = await page.evaluate(
      ([x, y]: [number, number]) => document.elementFromPoint(x, y)?.getAttribute('data-testid') ?? null,
      [box!.x + box!.width / 2, box!.y + box!.height / 2] as [number, number],
    );
    expect(topTestId).toBe('calc-debug-now-input');

    // 有効な値はリロードを跨いで復元される。
    await page.goto('/?perf=1&now=2026-08-28T03:30');
    await expect(button).toHaveText('日時解除');
    await expect(value).toHaveText('2026-08-28 03:30');

    // 解除するとURLからも消える。
    await button.click();
    await expect(value).toHaveCount(0);
    await expect(page).toHaveURL(/\?perf=1$/);

    // ネイティブのピッカーは自動操作できないので、入力欄のchangeを直接起こす。
    await page.locator('[data-testid="calc-debug-now-input"]').evaluate(el => {
      (el as HTMLInputElement).value = '2026-08-28T13:19';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(value).toHaveText('2026-08-28 13:19');
    await expect(page).toHaveURL(/now=2026-08-28T13(%3A|:)19/);

    // 保存されたURLは本当のリロードでも復元される。
    await page.reload();
    await expect(value).toHaveText('2026-08-28 13:19');
  });

  test('デバッグ用の現在日時は?gameDate=より優先し、解除で戻る', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    // AM4:00より前なので、ゲーム内日は前日の 2026-08-27 になる。
    await page.goto('/?perf=1&gameDate=2026-05-02&now=2026-08-28T03:30');
    await settings.openSettingsFromDesktop();
    await expect(settings.currentGameDate).toContainText('2026-08-27');
    await settings.closeByButton();

    // 解除すると ?gameDate= の固定日へ戻る。
    await page.locator('[data-testid="calc-debug-now-button"]').click();
    await settings.openSettingsFromDesktop();
    await expect(settings.currentGameDate).toContainText('2026-05-02');
  });
});
