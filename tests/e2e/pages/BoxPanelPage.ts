/**
 * BoxPanel Page Object
 * 新規追加・インポート・BOX操作のセレクタと操作をまとめる
 * すべてのセレクタはdata-testidベースで統一
 */
import { type Page, type Locator, expect } from '@playwright/test';

export class BoxPanelPage {
  readonly page: Page;

  // === 新規追加パネル ===
  readonly addNewPanel: Locator;
  readonly addNewSummary: Locator;
  readonly nameInput: Locator;
  readonly suggestPanel: Locator;
  readonly suggestItems: Locator;
  readonly levelField: Locator;
  readonly levelTriggerButton: Locator;
  readonly levelPopover: Locator;
  readonly levelPlusButton: Locator;
  readonly natureField: Locator;
  readonly natureTrigger: Locator;
  readonly natureDropdown: Locator;
  readonly natureOptions: Locator;
  readonly ingredientSelect: Locator;
  readonly specialtySelect: Locator;
  readonly expTypeSelect: Locator;
  readonly subSkillSection: Locator;
  readonly subSkillSelects: Locator;
  readonly addToBoxButton: Locator;
  readonly addToCalcCheckbox: Locator;

  // === インポートパネル ===
  readonly importPanel: Locator;
  readonly importSummary: Locator;
  readonly importTextarea: Locator;
  readonly importButton: Locator;
  readonly pasteButton: Locator;
  readonly fileInput: Locator;
  readonly clearButton: Locator;

  // === BOXリスト・検索・フィルタ ===
  readonly boxTiles: Locator;
  readonly searchInput: Locator;
  readonly searchClearButton: Locator;
  readonly favoriteFilterButton: Locator;
  readonly berryFilterButton: Locator;
  readonly ingredientFilterButton: Locator;
  readonly skillFilterButton: Locator;
  readonly allFilterButton: Locator;
  readonly advancedSettingsPanel: Locator;
  readonly advancedSettingsSummary: Locator;
  readonly filterJoinSelect: Locator;
  readonly subSkillJoinSelect: Locator;
  readonly subSkillFilterList: Locator;
  readonly subSkillClearButton: Locator;
  readonly undoButton: Locator;
  readonly redoButton: Locator;
  readonly clearAllBoxButton: Locator;

  // === BOX詳細パネル ===
  readonly detailPanel: Locator;
  readonly detailNicknameInput: Locator;
  readonly detailFavoriteButton: Locator;
  readonly detailRelinkInput: Locator;
  readonly detailRelinkButton: Locator;
  readonly detailRelinkSuggestPanel: Locator;
  readonly detailLevelTrigger: Locator;
  readonly detailExpRemainingInput: Locator;
  readonly detailNatureTrigger: Locator;
  readonly detailSpecialtyDisplay: Locator;
  readonly detailExpTypeDisplay: Locator;
  readonly detailIngredientSelect: Locator;
  readonly detailSubSkillSelects: Locator;
  readonly applyToCalcButton: Locator;
  readonly deleteFromBoxButton: Locator;

  constructor(page: Page) {
    this.page = page;

    // 新規追加パネル
    this.addNewPanel = page.getByTestId('box-add-panel');
    this.addNewSummary = page.getByTestId('box-add-summary');
    this.nameInput = page.getByTestId('box-add-name-input');
    this.suggestPanel = page.getByTestId('box-add-suggest-panel');
    this.suggestItems = this.suggestPanel.getByTestId('box-add-suggest-item');

    // レベルピッカー（新規追加用）
    this.levelField = page.getByTestId('box-add-level-field');
    this.levelTriggerButton = page.getByTestId('level-picker-trigger').first();
    this.levelPopover = page.getByTestId('level-picker-popover');
    this.levelPlusButton = page.getByTestId('level-picker-increment').first();

    // 性格選択（新規追加用）
    this.natureField = page.getByTestId('box-add-nature-field');
    this.natureTrigger = page.getByTestId('nature-select-trigger').first();
    this.natureDropdown = page.getByTestId('nature-select-dropdown');
    this.natureOptions = this.natureDropdown.getByTestId('nature-select-option');

    // セレクト類（新規追加用）
    this.ingredientSelect = page.getByTestId('box-add-ingredient-select');
    this.specialtySelect = page.getByTestId('box-add-specialty-select');
    this.expTypeSelect = page.getByTestId('box-add-exptype-select');

    this.subSkillSection = page.getByTestId('box-add-subskills');
    this.subSkillSelects = this.subSkillSection.locator('select');

    // 「ボックスに追加」ボタンと「計算機に追加」チェックボックス
    this.addToBoxButton = page.getByTestId('box-add-submit');
    this.addToCalcCheckbox = page.getByTestId('box-add-to-calc-checkbox');

    // インポートパネル
    this.importPanel = page.getByTestId('box-import-panel');
    this.importSummary = page.getByTestId('box-import-summary');
    this.importTextarea = page.getByTestId('box-import-textarea');
    this.importButton = page.getByTestId('box-import-submit');
    this.pasteButton = page.getByTestId('box-import-paste');
    this.fileInput = page.getByTestId('box-import-file-input');
    this.clearButton = page.getByTestId('box-import-clear');

    // BOXリスト
    this.boxTiles = page.getByTestId('box-tile');

    // 検索
    this.searchInput = page.getByTestId('box-search-input');
    this.searchClearButton = page.getByTestId('box-search-clear');

    // とくいフィルタ
    this.favoriteFilterButton = page.getByTestId('box-filter-favorite');
    this.berryFilterButton = page.getByTestId('box-filter-berry');
    this.ingredientFilterButton = page.getByTestId('box-filter-ingredient');
    this.skillFilterButton = page.getByTestId('box-filter-skill');
    this.allFilterButton = page.getByTestId('box-filter-all');

    // フィルタリング設定
    this.advancedSettingsPanel = page.getByTestId('box-advanced-panel');
    this.advancedSettingsSummary = page.getByTestId('box-advanced-summary');
    this.filterJoinSelect = page.getByTestId('box-filter-join-select');
    this.subSkillJoinSelect = page.getByTestId('box-subskill-join-select');
    this.subSkillFilterList = page.getByTestId('box-subskill-filter-list');
    this.subSkillClearButton = page.getByTestId('box-subskill-clear');

    // Undo/Redo/Clear
    this.undoButton = page.getByTestId('box-undo');
    this.redoButton = page.getByTestId('box-redo');
    this.clearAllBoxButton = page.getByTestId('box-clear-all');

    // BOX詳細パネル
    this.detailPanel = page.getByTestId('box-detail-panel');
    this.detailNicknameInput = page.getByTestId('box-detail-nickname-input');
    this.detailFavoriteButton = page.getByTestId('box-detail-favorite');
    this.detailRelinkInput = page.getByTestId('box-detail-relink-input');
    this.detailRelinkButton = page.getByTestId('box-detail-relink-button');
    this.detailRelinkSuggestPanel = page.getByTestId('box-detail-relink-suggest-panel');
    this.detailLevelTrigger = page.getByTestId('level-picker-trigger').nth(1);
    this.detailExpRemainingInput = page.getByTestId('box-detail-exp-remaining-input');
    this.detailNatureTrigger = page.getByTestId('nature-select-trigger').nth(1);
    this.detailSpecialtyDisplay = page.getByTestId('box-detail-specialty-display');
    this.detailExpTypeDisplay = page.getByTestId('box-detail-exptype-display');
    this.detailIngredientSelect = page.getByTestId('box-detail-ingredient-select');
    this.detailSubSkillSelects = page.getByTestId('box-detail-subskills').locator('select');
    this.applyToCalcButton = page.getByTestId('box-detail-calc');
    this.deleteFromBoxButton = page.getByTestId('box-detail-delete');
  }

  // === 新規追加パネル操作 ===

  async openAddNewPanel() {
    const isOpen = await this.addNewPanel.getAttribute('open');
    if (isOpen === null) {
      await this.addNewSummary.click();
    }
    // nameInputが表示されるまで待機
    await this.nameInput.waitFor({ state: 'visible' });
  }

  async closeAddNewPanel() {
    const isOpen = await this.addNewPanel.getAttribute('open');
    if (isOpen !== null) {
      await this.addNewSummary.click();
    }
    await this.nameInput.waitFor({ state: 'hidden' });
  }

  async fillPokemonName(name: string) {
    await this.nameInput.fill(name);
    await this.nameInput.focus();
  }

  async confirmPokemonName() {
    await this.nameInput.press('Tab');
  }

  /**
   * 「ボックスに追加」ボタンをクリック
   * デフォルトで「計算機に追加」チェックボックスが有効なので、計算機にも自動追加される
   */
  async clickAddToBox() {
    await this.addToBoxButton.click();
    // ボックスにタイルが追加されるまで待機
    await this.boxTiles.first().waitFor({ state: 'visible' });
  }

  /**
   * 「計算機に追加」チェックボックスの状態を変更
   */
  async setAddToCalcCheckbox(checked: boolean) {
    const isChecked = await this.addToCalcCheckbox.isChecked();
    if (isChecked !== checked) {
      await this.addToCalcCheckbox.click();
    }
  }

  async expectSuggestVisible() {
    await expect(this.suggestPanel).toBeVisible();
  }

  async expectSuggestContains(name: string) {
    await expect(this.suggestItems.filter({ hasText: name })).toBeVisible();
  }

  // レベルピッカー操作
  async openLevelPicker() {
    await this.levelTriggerButton.click();
    await expect(this.levelPopover).toBeVisible();
  }

  async getLevelValue(): Promise<number> {
    const text = await this.levelTriggerButton.textContent();
    return Number(text?.replace(/[^0-9]/g, ''));
  }

  async incrementLevel() {
    await expect(this.levelPlusButton).toBeVisible();
    await this.levelPlusButton.click();
  }

  // 性格選択操作
  async openNatureDropdown() {
    await this.natureTrigger.click();
    await expect(this.natureDropdown).toBeVisible();
  }

  async selectNatureOption(index: number) {
    await this.natureOptions.nth(index).click();
    await expect(this.natureDropdown).not.toBeVisible();
  }

  // === インポートパネル操作 ===

  async openImportPanel() {
    if (!(await this.importPanel.getAttribute('open'))) {
      await this.importSummary.click();
    }
    await expect(this.importPanel).toHaveAttribute('open', '');
  }

  async closeImportPanel() {
    if (await this.importPanel.getAttribute('open')) {
      await this.importSummary.click();
    }
    await expect(this.importPanel).not.toHaveAttribute('open', '');
  }

  async fillImportText(text: string) {
    await this.importTextarea.fill(text);
  }

  async clickImport() {
    await this.importButton.click();
  }

  async clickClear() {
    await this.clearButton.click();
  }

  async expectBoxTileCount(count: number) {
    await expect(this.boxTiles).toHaveCount(count);
  }

  // === 検索操作 ===

  async fillSearch(text: string) {
    await this.searchInput.fill(text);
  }

  async clickSearchClear() {
    await this.searchClearButton.click();
  }

  // === フィルタ操作 ===

  async toggleFavoriteFilter() {
    await this.favoriteFilterButton.click();
  }

  async toggleBerryFilter() {
    await this.berryFilterButton.click();
  }

  async toggleIngredientFilter() {
    await this.ingredientFilterButton.click();
  }

  async toggleSkillFilter() {
    await this.skillFilterButton.click();
  }

  async toggleAllFilter() {
    await this.allFilterButton.click();
  }

  async openAdvancedSettings() {
    const isOpen = await this.advancedSettingsPanel.getAttribute('open');
    if (isOpen === null) {
      await this.advancedSettingsSummary.click();
    }
    await expect(this.advancedSettingsPanel).toHaveAttribute('open', '');
  }

  async closeAdvancedSettings() {
    const isOpen = await this.advancedSettingsPanel.getAttribute('open');
    if (isOpen !== null) {
      await this.advancedSettingsSummary.click();
    }
    await expect(this.advancedSettingsPanel).not.toHaveAttribute('open', '');
  }

  /**
   * サブスキルフィルタのチェックボックスを操作
   * @param subSkillNameEn サブスキルの英語名（例: 'Berry Finding S'）
   */
  async toggleSubSkillFilter(subSkillNameEn: string) {
    const checkbox = this.page.getByTestId(`box-subskill-filter-${subSkillNameEn}`);
    await checkbox.click();
  }

  // === BOXタイル操作 ===

  async selectBoxTile(index: number) {
    await this.boxTiles.nth(index).click();
  }

  async expectDetailPanelVisible() {
    await expect(this.detailPanel).toBeVisible();
  }

  async expectDetailPanelHidden() {
    await expect(this.detailPanel).not.toBeVisible();
  }

  // === 詳細パネル操作 ===

  async fillNickname(name: string) {
    await this.detailNicknameInput.fill(name);
    await this.detailNicknameInput.press('Tab');
  }

  async toggleDetailFavorite() {
    await this.detailFavoriteButton.click();
  }

  async fillRelinkName(name: string) {
    await this.detailRelinkInput.fill(name);
    await this.detailRelinkInput.focus();
  }

  async clickRelinkButton() {
    await this.detailRelinkButton.click();
  }

  async openDetailLevelPicker() {
    await this.detailLevelTrigger.click();
  }

  async fillExpRemaining(value: number) {
    await this.detailExpRemainingInput.fill(String(value));
  }

  async clickApplyToCalc() {
    await this.applyToCalcButton.click();
  }

  async clickDeleteFromBox() {
    await this.deleteFromBoxButton.click();
  }

  async clickClearAllBox() {
    await this.clearAllBoxButton.click();
  }

  async clickUndo() {
    await this.undoButton.click();
  }

  async clickRedo() {
    await this.redoButton.click();
  }
}
