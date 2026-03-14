/**
 * AddPokemonModal Page Object
 * 計算機からポケモンを追加するモーダルのセレクタと操作をまとめる
 */
import { type Page, type Locator, expect } from '@playwright/test';

export class AddPokemonModalPage {
  readonly page: Page;

  // === モーダルを開くボタン（CalcPanel内） ===
  readonly openModalButton: Locator;

  // === モーダル本体 ===
  readonly modal: Locator;
  readonly nameInput: Locator;
  readonly suggestPanel: Locator;
  readonly expRemainingInput: Locator;
  readonly speciesCandyInput: Locator;
  readonly submitButton: Locator;
  readonly closeButton: Locator;

  // === レベルピッカー（srcLevel / dstLevel） ===
  readonly srcLevelTrigger: Locator;
  readonly dstLevelTrigger: Locator;
  readonly levelPopover: Locator;
  readonly levelIncrementButton: Locator;
  readonly levelRangeInput: Locator;

  constructor(page: Page) {
    this.page = page;

    // モーダルを開くボタン（計算機パネル）
    this.openModalButton = page.getByTestId('calc-add-pokemon-btn');

    // モーダル本体
    this.modal = page.locator('.addModal');
    this.nameInput = page.getByTestId('add-modal-name-input');
    this.suggestPanel = page.locator('.addModal .suggest__panel');
    this.expRemainingInput = page.getByTestId('add-modal-exp-remaining');
    this.speciesCandyInput = page.getByTestId('add-modal-species-candy');
    this.submitButton = page.getByTestId('add-modal-submit');
    this.closeButton = page.locator('.addModal .btn--ghost');

    // LevelPicker内のトリガーボタン（モーダル内に2つある: src/dst）
    this.srcLevelTrigger = this.modal.getByTestId('level-picker-trigger').nth(0);
    this.dstLevelTrigger = this.modal.getByTestId('level-picker-trigger').nth(1);
    this.levelPopover = page.getByTestId('level-picker-popover');
    this.levelIncrementButton = this.levelPopover.getByTestId('level-picker-increment');
    this.levelRangeInput = this.levelPopover.locator('input[type=range]');
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

  /** srcLevelピッカーを開いてrangeスライダーで値を設定する */
  async setSrcLevel(level: number) {
    await this.srcLevelTrigger.click();
    await expect(this.levelPopover).toBeVisible();
    await this.levelRangeInput.fill(String(level));
    await this.page.keyboard.press('Escape');
  }

  /** dstLevelピッカーを開いてrangeスライダーで値を設定する */
  async setDstLevel(level: number) {
    await this.dstLevelTrigger.click();
    await expect(this.levelPopover).toBeVisible();
    // rangeスライダーに直接値をセットしてinputイベントを発火
    await this.levelRangeInput.fill(String(level));
    // ポップオーバーを閉じる
    await this.page.keyboard.press('Escape');
  }
}