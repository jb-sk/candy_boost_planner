/**
 * 11-focus-trap.spec.ts
 * useFocusTrap（モーダルへのフォーカスの閉じ込め）のE2Eテスト。chromium と chromium-mobile の両方で走る。
 *
 * カバー範囲:
 *   - 開くと器にフォーカスし、入力欄にはフォーカスしない
 *   - 最後の要素で Tab → 最初へ、最初で Shift+Tab → 最後へ
 *   - 外へ出たフォーカスは器へ戻る
 *   - 閉じると開く前の要素へ戻る
 *   - 追加モーダルは今までどおり名前欄へフォーカスする
 *   - かんたんモードにも同じ検査（開く・端から端へ回る・外へ出たら戻る・閉じたら戻る）
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { SettingsModalPage } from './pages/SettingsModalPage';
import { AddPokemonModalPage } from './pages/AddPokemonModalPage';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { FineTuneModalPage } from './pages/FineTuneModalPage';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 設定モーダルの入口ボタン（幅によって置き場所が違う） */
async function openSettings(page: Page, isMobile: boolean): Promise<{ settings: SettingsModalPage; opener: Locator }> {
  const settings = new SettingsModalPage(page);
  const opener = isMobile ? settings.mobileSettingsButton : settings.desktopSettingsButton;
  await opener.focus();
  if (isMobile) await settings.openSettingsFromMobile();
  else await settings.openSettingsFromDesktop();
  return { settings, opener };
}

test.describe('useFocusTrap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('開くと器にフォーカスし、入力欄にはフォーカスしない', async ({ page, isMobile }) => {
    const { settings } = await openSettings(page, isMobile);
    await expect(settings.modal).toBeFocused();
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    expect(tag).toBe('DIV');
  });

  test('最後の要素で Tab を押すと最初へ、最初の要素で Shift+Tab を押すと最後へ回る', async ({ page, isMobile }) => {
    const { settings } = await openSettings(page, isMobile);
    const items = settings.modal.locator(FOCUSABLE).locator('visible=true');
    const first = items.first();
    const last = items.last();

    await last.focus();
    await expect(last).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
  });

  test('器から Shift+Tab を押しても外へ出ず、最後の要素へ行く', async ({ page, isMobile }) => {
    const { settings } = await openSettings(page, isMobile);
    await expect(settings.modal).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const last = settings.modal.locator(FOCUSABLE).locator('visible=true').last();
    await expect(last).toBeFocused();
  });

  test('外へ出たフォーカスは器へ戻る', async ({ page, isMobile }) => {
    const { settings, opener } = await openSettings(page, isMobile);
    await opener.focus();
    await expect(settings.modal).toBeFocused();
  });

  test('閉じると開く前の要素へフォーカスが戻る', async ({ page, isMobile }) => {
    const { settings, opener } = await openSettings(page, isMobile);
    await settings.closeByButton();
    await expect(opener).toBeFocused();
  });

  test('モーダルより上に Teleport された一覧（性格の選択肢）へ入ったフォーカスは器へ戻さない', async ({ page }) => {
    const modal = new AddPokemonModalPage(page);
    await modal.open();
    await modal.modal.getByTestId('nature-select-trigger').click();
    const dropdown = page.getByTestId('nature-select-dropdown');
    await expect(dropdown).toBeVisible();
    await dropdown.getByTestId('nature-select-option').first().focus();
    await expect(dropdown.getByTestId('nature-select-option').first()).toBeFocused();
  });

  test('追加モーダルは開いたとき名前欄へフォーカスする（今までの動き）', async ({ page }) => {
    const modal = new AddPokemonModalPage(page);
    await modal.open();
    await expect(modal.nameInput).toBeFocused();

    // 名前欄が先頭ではないので、最後の要素から Tab で最初へ回ることも確かめる
    const items = modal.modal.locator(FOCUSABLE).locator('visible=true');
    await items.last().focus();
    await page.keyboard.press('Tab');
    await expect(items.first()).toBeFocused();
  });
});

test.describe('useFocusTrap（かんたんモード）', () => {
  /** 1匹を足して計算機から開く（スマホ幅では FineTuneModalPage.open が計算機のタブへ移る）。 */
  async function openFineTune(page: Page) {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openAddNewPanel();
    await box.fillPokemonName('ピカチュウ');
    await box.confirmPokemonName();
    await box.clickAddToBox();
    const fineTune = new FineTuneModalPage(page);
    await fineTune.open();
    return fineTune;
  }

  test('開くと器にフォーカスし、入力欄にはフォーカスしない', async ({ page }) => {
    const fineTune = await openFineTune(page);
    await expect(fineTune.modal).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('DIV');
  });

  test('最後の要素で Tab を押すと最初へ、最初の要素で Shift+Tab を押すと最後へ回り、器から Shift+Tab しても外へ出ない', async ({ page }) => {
    const fineTune = await openFineTune(page);
    const items = fineTune.modal.locator(FOCUSABLE).locator('visible=true');
    const first = items.first();
    const last = items.last();

    await last.focus();
    await expect(last).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();

    await fineTune.modal.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
  });

  test('外へ出たフォーカスは器へ戻る', async ({ page }) => {
    const fineTune = await openFineTune(page);
    await fineTune.openButton.focus();
    await expect(fineTune.modal).toBeFocused();
  });

  test('閉じると開く前の要素（入口のボタン）へフォーカスが戻る', async ({ page }) => {
    const fineTune = await openFineTune(page);
    await fineTune.closeButton.click();
    await expect(fineTune.overlay).toHaveCount(0);
    await expect(fineTune.openButton).toBeFocused();
  });
});
