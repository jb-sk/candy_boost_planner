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
  readonly closeButton: Locator;
  readonly defaultBoostReachLevelInput: Locator;

  // === タブ ===
  readonly inventoryTab: Locator;
  readonly backupTab: Locator;

  // === グローバル設定セクション ===
  readonly globalSection: Locator;
  readonly boostCandyRemainingInput: Locator;
  readonly itemCompareModeSelect: Locator;
  readonly totalShardsInput: Locator;

  // 万能アメ
  readonly universalCandySInput: Locator;
  readonly universalCandyMInput: Locator;
  readonly universalCandyLInput: Locator;

  // === 睡眠設定セクション ===
  readonly sleepSection: Locator;
  readonly dailySleepHoursInput: Locator;
  readonly sleepExpBonusSelect: Locator;
  readonly sleepExpBonusUnit: Locator;
  readonly includeGSDCheckbox: Locator;
  readonly projectedEventsCheckbox: Locator;
  readonly blueSeedWeekdaySelect: Locator;
  readonly blueSeedIncenseDaysSelect: Locator;
  readonly blueSeedIncenseDaysUnit: Locator;
  readonly growthIncenseNormalHintButton: Locator;
  readonly growthIncenseGsdHintButton: Locator;
  readonly growthIncenseStockHintButton: Locator;
  readonly projectedEventsHintButton: Locator;
  readonly blueSeedWeekdayHintButton: Locator;
  readonly blueSeedIncenseDaysHintButton: Locator;
  readonly hintPopover: Locator;
  readonly lunarCalendarWarning: Locator;
  readonly timeZoneInput: Locator;
  readonly timeZoneError: Locator;
  readonly currentGameDate: Locator;
  readonly growthIncenseGsdBeforeCheckbox: Locator;
  readonly growthIncenseGsdFullMoonCheckbox: Locator;
  readonly growthIncenseGsdAfterCheckbox: Locator;
  readonly growthIncenseNormalSelect: Locator;
  readonly growthIncenseNormalUnit: Locator;
  readonly growthIncenseStockInput: Locator;
  readonly growthIncenseStockUnit: Locator;

  // === タイプアメ設定セクション ===
  readonly typeCandySection: Locator;
  readonly typeCandyGrid: Locator;

  // === 設定リセットセクション ===
  readonly resetSection: Locator;
  readonly resetButton: Locator;
  readonly resetConfirm: Locator;
  readonly resetConfirmQuestion: Locator;
  readonly resetConfirmNote: Locator;
  readonly resetConfirmYesButton: Locator;
  readonly resetConfirmNoButton: Locator;

  // === 設定ボタン ===
  readonly desktopSettingsButton: Locator;
  readonly mobileSettingsButton: Locator;

  constructor(page: Page) {
    this.page = page;

    // モーダル本体
    this.overlay = page.getByTestId('settings-overlay');
    this.modal = page.getByTestId('settings-modal');
    this.closeButton = page.getByTestId('settings-modal-close');

    // タブ
    this.inventoryTab = page.getByTestId('settings-tab-inventory');
    this.backupTab = page.getByTestId('settings-tab-backup');

    // グローバル設定
    this.globalSection = page.getByTestId('settings-global-section');
    this.boostCandyRemainingInput = page.getByTestId('settings-boost-remaining-input');
    this.defaultBoostReachLevelInput = page.getByTestId('settings-default-boost-reach-input');
    this.itemCompareModeSelect = page.getByTestId('settings-item-compare-mode-select');
    this.totalShardsInput = page.getByTestId('settings-total-shards-input');

    // 万能アメ（S/M/L）
    this.universalCandySInput = page.getByTestId('settings-universal-candy-s-input');
    this.universalCandyMInput = page.getByTestId('settings-universal-candy-m-input');
    this.universalCandyLInput = page.getByTestId('settings-universal-candy-l-input');

    // 睡眠設定
    this.sleepSection = page.getByTestId('settings-sleep-section');
    this.dailySleepHoursInput = page.getByTestId('settings-daily-sleep-hours-input');
    this.sleepExpBonusSelect = page.getByTestId('settings-sleep-exp-bonus-select');
    this.sleepExpBonusUnit = page.getByTestId('settings-sleep-exp-bonus-unit');
    this.includeGSDCheckbox = page.getByTestId('settings-include-gsd-checkbox');
    this.projectedEventsCheckbox = page.getByTestId('settings-use-projected-events');
    this.blueSeedWeekdaySelect = page.getByTestId('blue-seed-weekday');
    this.blueSeedIncenseDaysSelect = page.getByTestId('blue-seed-incense-days');
    this.blueSeedIncenseDaysUnit = page.getByTestId('settings-blue-seed-incense-days-unit');
    this.growthIncenseNormalHintButton = page.getByTestId('settings-hint-btn-growthIncenseNormal');
    this.growthIncenseGsdHintButton = page.getByTestId('settings-hint-btn-growthIncenseGsd');
    this.growthIncenseStockHintButton = page.getByTestId('settings-hint-btn-growthIncenseStock');
    this.projectedEventsHintButton = page.getByTestId('settings-hint-btn-projectedEvents');
    this.blueSeedWeekdayHintButton = page.getByTestId('settings-hint-btn-blueSeed');
    this.blueSeedIncenseDaysHintButton = page.getByTestId('settings-hint-btn-blueSeedIncense');
    this.hintPopover = page.getByTestId('settings-hint-popover');
    this.lunarCalendarWarning = page.getByTestId('settings-lunar-calendar-warning');
    this.timeZoneInput = page.getByTestId('settings-time-zone-input');
    this.timeZoneError = page.getByTestId('settings-time-zone-error');
    this.currentGameDate = page.getByTestId('settings-current-game-date');
    this.growthIncenseGsdBeforeCheckbox = page.getByTestId('settings-growth-incense-gsd-beforeFullMoon');
    this.growthIncenseGsdFullMoonCheckbox = page.getByTestId('settings-growth-incense-gsd-fullMoon');
    this.growthIncenseGsdAfterCheckbox = page.getByTestId('settings-growth-incense-gsd-afterFullMoon');
    this.growthIncenseNormalSelect = page.getByTestId('settings-growth-incense-normal-select');
    this.growthIncenseNormalUnit = page.getByTestId('settings-growth-incense-normal-unit');
    this.growthIncenseStockInput = page.getByTestId('settings-growth-incense-stock-input');
    this.growthIncenseStockUnit = page.getByTestId('settings-growth-incense-stock-unit');

    // タイプアメ設定
    this.typeCandySection = page.getByTestId('settings-type-candy-section');
    this.typeCandyGrid = page.getByTestId('settings-type-candy-grid');

    // 設定リセット
    this.resetSection = page.getByTestId('settings-reset-section');
    this.resetButton = page.getByTestId('settings-reset-button');
    this.resetConfirm = page.getByTestId('settings-reset-confirm');
    this.resetConfirmQuestion = page.locator('#settings-reset-confirm-question');
    this.resetConfirmNote = page.locator('#settings-reset-confirm-note');
    this.resetConfirmYesButton = page.getByTestId('settings-reset-confirm-yes');
    this.resetConfirmNoButton = page.getByTestId('settings-reset-confirm-no');

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

  // === タブ切り替え ===
  async switchToBackupTab() {
    await this.backupTab.click();
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
    await this.boostCandyRemainingInput.blur();
  }

  async getBoostCandyRemaining(): Promise<string> {
    return await this.boostCandyRemainingInput.inputValue();
  }

  async setItemCompareMode(mode: 'surplusFirst' | 'surplusGateFirst' | 'legacyImproved') {
    await this.itemCompareModeSelect.selectOption(mode);
  }

  async getItemCompareMode(): Promise<string> {
    return await this.itemCompareModeSelect.inputValue();
  }

  async setTotalShards(value: string) {
    await this.totalShardsInput.fill(value);
    await this.totalShardsInput.blur();
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
    await input.blur();
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

  async setTimeZone(timeZone: string) {
    await this.timeZoneInput.fill(timeZone);
    await this.timeZoneInput.blur();
  }

  async setGrowthIncenseGsd(days: { beforeFullMoon: boolean; fullMoon: boolean; afterFullMoon: boolean }) {
    for (const [checkbox, checked] of [
      [this.growthIncenseGsdBeforeCheckbox, days.beforeFullMoon],
      [this.growthIncenseGsdFullMoonCheckbox, days.fullMoon],
      [this.growthIncenseGsdAfterCheckbox, days.afterFullMoon],
    ] as const) {
      await checkbox.setChecked(checked);
    }
  }

  async setGrowthIncenseNormalPerWeek(count: number) {
    await this.growthIncenseNormalSelect.selectOption(String(count));
  }

  /** 空文字で「無制限」。0 は「1個も使わない」なので区別して入れられるようにする。 */
  async setGrowthIncenseStock(value: string) {
    await this.growthIncenseStockInput.fill(value);
    await this.growthIncenseStockInput.blur();
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
    await input.blur();
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

  /** リセットはその場のインライン確認を挟む（`window.confirm` は使っていない）。 */
  async resetSettings() {
    await this.resetButton.click();
    await this.resetConfirmYesButton.click();
  }

  // === 検証ヘルパー ===
  async expectModalVisible() {
    await expect(this.modal).toBeVisible();
  }

  async expectModalHidden() {
    await expect(this.modal).not.toBeVisible();
  }
}
