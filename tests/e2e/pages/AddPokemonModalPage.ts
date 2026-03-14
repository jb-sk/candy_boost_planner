/**
 * AddPokemonModal Page Object
 * 計算機からポケモンを追加するモーダルのセレクタと操作をまとめる
 */
import { type Page, type Locator, expect } from '@playwright/test';

export class AddPokemonModalPage {
  readonly page: Page;

  // === モーダルを開くボタン（calc-add-pokemon-btn or calc-empty-add-btn） ===
  readonly openModalButton: Locator;

  // === モーダル本体 ===
  readonly modal: Locator;
  readonly nameInput: Locator;
  readonly suggestPanel: Locator;
  readonly expRemainingInput: Locator;
  readonly speciesCandyInput: Locator;
  readonly submitButton: Locator;
  readonly closeButton: Locator;

  // === レベルピッカートリガー（srcLevel / dstLevel） ===
  readonly srcLevelTrigger: Locator;
  readonly dstLevelTrigger: Locator;

  constructor(page: Page) {
    this.page = page;

    // モーダルを開くボタン（行あり: calc-add-pokemon-btn / 空状態: calc-empty-add-btn）
    this.openModalButton = page.getByTestId('calc-add-pokemon-btn').or(page.getByTestId('calc-empty-add-btn'));

    // モーダル本体
    this.modal = page.locator('.addModal');
    this.nameInput = page.getByTestId('add-modal-name-input');
    this.suggestPanel = page.locator('.addModal .suggest__panel');
    this.expRemainingInput = page.getByTestId('add-modal-exp-remaining');
    this.speciesCandyInput = page.getByTestId('add-modal-species-candy');
    this.submitButton = page.getByTestId('add-modal-submit');
    // モーダルヘッダーの閉じるボタン（addModal__head 直下）
    this.closeButton = page.locator('.addModal__head .btn--ghost');

    // LevelPicker内のトリガーボタン（モーダル内に2つある: src/dst）
    this.srcLevelTrigger = this.modal.getByTestId('level-picker-trigger').nth(0);
    this.dstLevelTrigger = this.modal.getByTestId('level-picker-trigger').nth(1);
  }

  /** モーダルを開く */
  async open() {
    await this.openModalButton.click();
    await expect(this.modal).toBeVisible();
    await expect(this.nameInput).toBeVisible();
  }

  /** モーダルを閉じる */
  async close() {
    await this.closeButton.click();
    await expect(this.modal).not.toBeVisible();
  }

  /** ポケモン名を入力してサジェストから選択 */
  async fillAndPickName(name: string) {
    await this.nameInput.fill(name);
    await expect(this.suggestPanel).toBeVisible();
    await this.suggestPanel.locator('.suggest__item').first().click();
  }

  /** 現在の目標Lvのテキストを数値で取得 */
  async getDstLevel(): Promise<number> {
    const text = await this.dstLevelTrigger.textContent();
    return Number(text?.replace(/[^0-9]/g, ''));
  }

  /** 現在の現在Lvのテキストを数値で取得 */
  async getSrcLevel(): Promise<number> {
    const text = await this.srcLevelTrigger.textContent();
    return Number(text?.replace(/[^0-9]/g, ''));
  }

  /**
   * srcLevelピッカーを開いてrangeスライダーで値を設定する。
   * Playwright の fill() は input イベントを発火しないため dispatchEvent で手動発火し、
   * ポップオーバー内の閉じるボタンで確実に閉じる。
   */
  async setSrcLevel(level: number) {
    await this.srcLevelTrigger.click();
    const popover = this.modal.getByTestId('level-picker-popover').first();
    await expect(popover).toBeVisible();
    const rangeInput = popover.locator('input[type=range]');
    await rangeInput.fill(String(level));
    await rangeInput.dispatchEvent('input');
    await popover.getByRole('button', { name: '閉じる' }).click();
    await expect(popover).not.toBeVisible();
  }

  /**
   * dstLevelピッカーを開いてrangeスライダーで値を設定する。
   * Playwright の fill() は input イベントを発火しないため dispatchEvent で手動発火し、
   * ポップオーバー内の閉じるボタンで確実に閉じる。
   */
  async setDstLevel(level: number) {
    await this.dstLevelTrigger.click();
    const popover = this.modal.getByTestId('level-picker-popover').first();
    await expect(popover).toBeVisible();
    const rangeInput = popover.locator('input[type=range]');
    await rangeInput.fill(String(level));
    await rangeInput.dispatchEvent('input');
    await popover.getByRole('button', { name: '閉じる' }).click();
    await expect(popover).not.toBeVisible();
  }
}