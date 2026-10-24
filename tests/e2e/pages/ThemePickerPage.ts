/**
 * ThemePicker Page Object
 * ヘッダーのテーマ選択（自作ドロップダウン DesignSwitcher.vue）の操作をまとめる
 */
import { type Page, type Locator, expect } from '@playwright/test';

export class ThemePickerPage {
  readonly trigger: Locator;
  readonly list: Locator;
  readonly options: Locator;

  constructor(page: Page) {
    this.trigger = page.getByTestId('theme-select-trigger');
    this.list = page.getByTestId('theme-select-list');
    this.options = page.getByTestId('theme-select-option');
  }

  option(id: string): Locator {
    return this.list.locator(`[data-value="${id}"]`);
  }

  /** 一覧を開いて選び、テーマの読み込み（切り替え中はボタンが押せない）が終わるまで待つ */
  async select(id: string): Promise<void> {
    await this.trigger.click();
    await this.option(id).click();
    await this.expectValue(id);
    await expect(this.trigger).toBeEnabled();
  }

  async expectValue(id: string): Promise<void> {
    await expect(this.trigger).toHaveAttribute('data-value', id);
  }

  /** 選べるテーマの id（一覧を開いて読み、閉じる） */
  async themeIds(): Promise<string[]> {
    await this.trigger.click();
    const ids = await this.options.evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.value ?? ''));
    await this.trigger.press('Escape');
    await expect(this.list).toHaveCount(0);
    return ids;
  }
}
