/**
 * SettingsModal Page Object
 * 設定モーダルのセレクタと操作をまとめる
 * すべてのセレクタはdata-testidベースで統一
 */
import { type Page, type Locator, expect } from '@playwright/test';

/** 日本語タイプ名→英語タイプ名のマッピング */
const TypeNameJaToEn: Record<string, string> = {
  'ノーマル': 'Normal',
  'ほのお': 'Fire',
  'みず': 'Water',
  'でんき': 'Electric',
  'くさ': 'Grass',
  'こおり': 'Ice',
  'かくとう': 'Fighting',
  'どく': 'Poison',
  'じめん': 'Ground',
  'ひこう': 'Flying',
  'エスパー': 'Psychic',
  'むし': 'Bug',
  'いわ': 'Rock',
  'ゴースト': 'Ghost',
  'ドラゴン': 'Dragon',
  'あく': 'Dark',
  'はがね': 'Steel',
  'フェアリー': 'Fairy',
};

/** タイプ名を英語に正規化（日本語でも英語でも受け付ける） */
function normalizeTypeName(name: string): string {
  return TypeNameJaToEn[name] ?? name;
}

export class SettingsModalPage {
  readonly page: Page;

  // === モーダル本体 ===
  readonly overlay: Locator;
  readonly modal: Locator;
  readonly modalTitle: Locator;
  readonly closeButton: Locator;

  // === グローバル設定セクション ===
  readonly globalSection: Locator;
  readonly boostCandyRemainingInput: Locator;
  readonly totalShardsInput: Locator;

  // 万能アメ
  readonly universalCandySInput: Locator;
  readonly universalCandyMInput: Locator;
  readonly universalCandyLInput: Locator;

  // === 睡眠設定セクション ===
  readonly sleepSection: Locator;
  readonly dailySleepHoursInput: Locator;
  readonly sleepExpBonusSelect: Locator;
  readonly includeGSDCheckbox: Locator;

  // === タイプアメ設定セクション ===
  readonly typeCandySection: Locator;
  readonly typeCandyGrid: Locator;

  // === 設定ボタン ===
  readonly desktopSettingsButton: Locator;
  readonly mobileSettingsButton: Locator;

  constructor(page: Page) {
    this.page = page;

    // モーダル本体
    this.overlay = page.getByTestId('settings-overlay');
    this.modal = page.getByTestId('settings-modal');
    this.modalTitle = page.getByTestId('settings-modal-title');
    this.closeButton = page.getByTestId('settings-modal-close');

    // グローバル設定
    this.globalSection = page.getByTestId('settings-global-section');
    this.boostCandyRemainingInput = page.getByTestId('settings-boost-remaining-input');
    this.totalShardsInput = page.getByTestId('settings-total-shards-input');

    // 万能アメ（S/M/L）
    this.universalCandySInput = page.getByTestId('settings-universal-candy-s-input');
    this.universalCandyMInput = page.getByTestId('settings-universal-candy-m-input');
    this.universalCandyLInput = page.getByTestId('settings-universal-candy-l-input');

    // 睡眠設定
    this.sleepSection = page.getByTestId('settings-sleep-section');
    this.dailySleepHoursInput = page.getByTestId('settings-daily-sleep-hours-input');
    this.sleepExpBonusSelect = page.getByTestId('settings-sleep-exp-bonus-select');
    this.includeGSDCheckbox = page.getByTestId('settings-include-gsd-checkbox');

    // タイプアメ設定
    this.typeCandySection = page.getByTestId('settings-type-candy-section');
    this.typeCandyGrid = page.getByTestId('settings-type-candy-grid');

    // 設定ボタン
    this.desktopSettingsButton = page.getByTestId('settings-open-button-desktop');
    this.mobileSettingsButton = page.getByTestId('settings-open-button-mobile');
  }

  // === PC版設定ボタン（CalcPanel内） ===
  async openSettingsFromDesktop() {
    await this.desktopSettingsButton.click();
    await this.modal.waitFor({ state: 'visible' });
  }

  // === モバイル版設定ボタン（MobileNav） ===
  async openSettingsFromMobile() {
    await this.mobileSettingsButton.click();
    await this.modal.waitFor({ state: 'visible' });
  }

  // === 閉じる ===
  async closeByButton() {
    await this.closeButton.click();
    await this.modal.waitFor({ state: 'hidden' });
  }

  async closeByEscape() {
    await this.page.keyboard.press('Escape');
    await this.modal.waitFor({ state: 'hidden' });
  }

  async closeByOverlayClick() {
    // オーバーレイの左上をクリック（モーダル外）
    await this.overlay.click({ position: { x: 10, y: 10 } });
    await this.modal.waitFor({ state: 'hidden' });
  }

  // === グローバル設定の操作 ===
  async setBoostCandyRemaining(value: string) {
    await this.boostCandyRemainingInput.fill(value);
  }

  async getBoostCandyRemaining(): Promise<string> {
    return await this.boostCandyRemainingInput.inputValue();
  }

  async setTotalShards(value: string) {
    await this.totalShardsInput.fill(value);
  }

  async getTotalShards(): Promise<string> {
    return await this.totalShardsInput.inputValue();
  }

  async setUniversalCandy(size: 'S' | 'M' | 'L', value: number) {
    const input = size === 'S'
      ? this.universalCandySInput
      : size === 'M'
      ? this.universalCandyMInput
      : this.universalCandyLInput;

    await input.fill(value.toString());
  }

  async getUniversalCandy(size: 'S' | 'M' | 'L'): Promise<number> {
    const input = size === 'S'
      ? this.universalCandySInput
      : size === 'M'
      ? this.universalCandyMInput
      : this.universalCandyLInput;

    const value = await input.inputValue();
    return parseInt(value) || 0;
  }

  // === 睡眠設定の操作 ===
  async setDailySleepHours(hours: number) {
    await this.dailySleepHoursInput.fill(hours.toString());
  }

  async getDailySleepHours(): Promise<number> {
    const value = await this.dailySleepHoursInput.inputValue();
    return parseFloat(value) || 8.5;
  }

  async setSleepExpBonus(count: number) {
    await this.sleepExpBonusSelect.selectOption(count.toString());
  }

  async getSleepExpBonus(): Promise<number> {
    const value = await this.sleepExpBonusSelect.inputValue();
    return parseInt(value) || 0;
  }

  async toggleIncludeGSD() {
    await this.includeGSDCheckbox.click();
  }

  async isIncludeGSDChecked(): Promise<boolean> {
    return await this.includeGSDCheckbox.isChecked();
  }

  // === タイプアメ設定の操作 ===
  /**
   * タイプアメの値を設定
   * @param typeName タイプ名（日本語「でんき」または英語「Electric」どちらでも可）
   * @param size S または M
   * @param value 設定する値
   */
  async setTypeCandy(typeName: string, size: 'S' | 'M', value: number) {
    const normalizedName = normalizeTypeName(typeName);
    const testId = `settings-type-candy-${normalizedName}-${size.toLowerCase()}-input`;
    const input = this.page.getByTestId(testId);
    await input.fill(value.toString());
  }

  /**
   * タイプアメの値を取得
   * @param typeName タイプ名（日本語「でんき」または英語「Electric」どちらでも可）
   * @param size S または M
   */
  async getTypeCandy(typeName: string, size: 'S' | 'M'): Promise<number> {
    const normalizedName = normalizeTypeName(typeName);
    const testId = `settings-type-candy-${normalizedName}-${size.toLowerCase()}-input`;
    const input = this.page.getByTestId(testId);
    const value = await input.inputValue();
    return parseInt(value) || 0;
  }

  /**
   * タイプアメの行数（タイプ数）を取得
   */
  async getTypeCandyCount(): Promise<number> {
    return await this.page.locator('[data-testid^="settings-type-row-"]').count();
  }

  // === 検証ヘルパー ===
  async expectModalVisible() {
    await expect(this.modal).toBeVisible();
  }

  async expectModalHidden() {
    await expect(this.modal).not.toBeVisible();
  }
}
