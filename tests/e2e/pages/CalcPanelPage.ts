/**
 * CalcPanel Page Object
 * 計算機パネルのセレクタと操作をまとめる
 * すべてのセレクタはdata-testidベースで統一
 */
import { type Page, type Locator, expect } from '@playwright/test';

export class CalcPanelPage {
  readonly page: Page;

  // === パネル本体 ===
  readonly panel: Locator;
  readonly panelTitle: Locator;

  // === 空状態 ===
  readonly emptyState: Locator;
  readonly emptySettingsLink: Locator;
  readonly emptyHelpLink: Locator;

  // === アクションボタン ===
  readonly exportButton: Locator;
  readonly clearButton: Locator;
  readonly undoButton: Locator;
  readonly redoButton: Locator;
  readonly settingsButton: Locator;

  // === スロットタブ ===
  readonly slotTabs: Locator;
  readonly activeSlotTab: Locator;
  readonly boostKindSelect: Locator;

  // === 計算行 ===
  readonly calcRows: Locator;

  // === サマリーとプログレスバー ===
  readonly stickySummary: Locator;
  readonly boostCandyBar: Locator;
  readonly shardsBar: Locator;
  readonly totalBoostCandyText: Locator;
  readonly totalShardsText: Locator;
  readonly universalCandyUsageText: Locator;

  // === ヒントポップオーバー ===
  readonly hintPopover: Locator;
  readonly hintOverlay: Locator;

  // === エクスポートモーダル ===
  readonly exportModal: Locator;

  constructor(page: Page) {
    this.page = page;

    // パネル本体
    this.panel = page.locator('#neo-calc');
    this.panelTitle = this.panel.locator('.panel__title');

    // 空状態
    this.emptyState = page.getByTestId('calc-empty');
    this.emptySettingsLink = page.getByTestId('calc-empty-settings-link');
    this.emptyHelpLink = page.getByTestId('calc-empty-help-link');

    // アクションボタン
    this.exportButton = page.getByTestId('calc-export-button');
    this.clearButton = page.getByTestId('calc-clear-button');
    this.undoButton = page.getByTestId('calc-undo-button');
    this.redoButton = page.getByTestId('calc-redo-button');
    this.settingsButton = page.getByTestId('settings-open-button-desktop');

    // スロットタブ（アクティブ＋非アクティブの両方を含む）
    this.slotTabs = page.getByTestId('calc-slot-tabs').locator('.slotTab');
    this.activeSlotTab = page.getByTestId('calc-slot-tab-active');
    this.boostKindSelect = page.getByTestId('calc-boost-kind-select');

    // 計算行
    this.calcRows = page.getByTestId('calc-row');

    // サマリーとプログレスバー
    this.stickySummary = page.getByTestId('calc-sticky-summary');
    this.boostCandyBar = page.getByTestId('calc-boost-candy-bar');
    this.shardsBar = page.getByTestId('calc-shards-bar');
    this.totalBoostCandyText = this.stickySummary.locator('.calcSumInline').first().locator('.calcSumInline__v');
    this.totalShardsText = this.stickySummary.locator('.calcSumInline:not(.calcSumInline--candy)').nth(1).locator('.calcSumInline__v');
    this.universalCandyUsageText = this.stickySummary.locator('.calcSumInline--candy .calcSumInline__v');

    // ヒントポップオーバー
    this.hintPopover = page.getByTestId('calc-hint-popover');
    this.hintOverlay = page.getByTestId('calc-hint-overlay');

    // エクスポートモーダル
    this.exportModal = page.getByTestId('export-overlay');
  }

  // === 計算行へのアクセス ===
  getRow(index: number): Locator {
    return this.calcRows.nth(index);
  }

  getRowByTitle(title: string): Locator {
    return this.calcRows.filter({ hasText: title });
  }

  async getRowCount(): Promise<number> {
    return await this.calcRows.count();
  }

  // === 行内のセレクタ ===
  getRowSrcLevelButton(row: Locator): Locator {
    return row.getByTestId('srcLevel').locator('button');
  }

  getRowDstLevelButton(row: Locator): Locator {
    return row.getByTestId('dstLevel').locator('button');
  }

  getRowExpRemainingInput(row: Locator): Locator {
    return row.getByTestId('expRemaining');
  }

  getRowSpeciesCandyInput(row: Locator): Locator {
    return row.getByTestId('speciesCandy');
  }

  getRowBoostReachLevelButton(row: Locator): Locator {
    return row.getByTestId('boostReachLevel').locator('button');
  }

  getRowBoostRatioSlider(row: Locator): Locator {
    return row.getByTestId('boostRatio');
  }

  getRowBoostRatioText(row: Locator): Locator {
    return row.locator('.field__sub').first();
  }

  getRowBoostCandyInput(row: Locator): Locator {
    return row.getByTestId('boostCandyCount');
  }

  getRowCandyTargetInput(row: Locator): Locator {
    return row.getByTestId('candyTarget');
  }

  getRowSleepButton1000h(row: Locator): Locator {
    return row.getByTestId('sleepBtn1000h');
  }

  getRowSleepButton2000h(row: Locator): Locator {
    return row.getByTestId('sleepBtn2000h');
  }

  getRowDeleteButton(row: Locator): Locator {
    return row.getByTestId('deleteBtn');
  }

  getRowMoveUpButton(row: Locator): Locator {
    return row.getByTestId('moveUpBtn');
  }

  getRowMoveDownButton(row: Locator): Locator {
    return row.getByTestId('moveDownBtn');
  }

  getRowDragHandle(row: Locator): Locator {
    return row.getByTestId('dragHandle');
  }

  getRowApplyToBoxButton(row: Locator): Locator {
    return row.getByTestId('applyToBoxBtn');
  }

  getRowHintButton(row: Locator): Locator {
    return row.getByTestId('hintBtn');
  }

  // === 結果行 ===
  getRowRequiredRow(row: Locator): Locator {
    return row.getByTestId('resultRowRequired');
  }

  getRowUsedRow(row: Locator): Locator {
    return row.getByTestId('resultRowReachable');
  }

  getRowCandyTargetRow(row: Locator): Locator {
    return row.getByTestId('resultRowCandyTarget');
  }

  // 結果行の展開状態
  async isRowExpanded(row: Locator): Promise<boolean> {
    const requiredRow = this.getRowRequiredRow(row);
    const hasExpanded = await requiredRow.locator('.is-expanded').count();
    return hasExpanded > 0;
  }

  async expandRow(row: Locator): Promise<void> {
    const usedRow = this.getRowUsedRow(row);
    // すでに展開されている場合はクリックしない（トグルで閉じてしまうため）
    const isAlreadyVisible = await usedRow.isVisible();
    if (isAlreadyVisible) {
      return;
    }
    const requiredRow = this.getRowRequiredRow(row);
    await requiredRow.click();
    // 到達可能行が表示されるまで待機
    await usedRow.waitFor({ state: 'visible', timeout: 5000 });
  }

  // === 結果値の取得 ===
  async getRowResultValue(row: Locator, resultType: 'required' | 'used', field: 'boost' | 'normal' | 'candy' | 'shards'): Promise<string> {
    const resultRow = resultType === 'required'
      ? this.getRowRequiredRow(row)
      : this.getRowUsedRow(row);

    let fieldKey: string;
    switch (field) {
      case 'boost': fieldKey = 'アメブ'; break;
      case 'normal': fieldKey = '通常アメ'; break;
      case 'candy': fieldKey = 'アメ合計'; break;
      case 'shards': fieldKey = 'かけら'; break;
    }

    const res = resultRow.locator('.calcRow__res').filter({ hasText: fieldKey });
    const numText = await res.locator('.calcRow__num').first().textContent();
    return numText?.trim() ?? '';
  }

  async getRowRequiredItems(row: Locator): Promise<string> {
    const requiredRow = this.getRowRequiredRow(row);
    const itemsRes = requiredRow.locator('.calcRow__res').filter({ hasText: '必要アイテム' });
    const numText = await itemsRes.locator('.calcRow__num').textContent();
    return numText?.trim() ?? '';
  }

  async getRowUsedItems(row: Locator): Promise<string> {
    const usedRow = this.getRowUsedRow(row);
    const itemsRes = usedRow.locator('.calcRow__res').filter({ hasText: '使用アイテム' });
    const numText = await itemsRes.locator('.calcRow__num').textContent();
    return numText?.trim() ?? '';
  }

  async getRowReachedLevel(row: Locator): Promise<string> {
    const usedRow = this.getRowUsedRow(row);
    const res = usedRow.locator('.calcRow__res').filter({ hasText: '到達Lv' });
    const numText = await res.locator('.calcRow__num').first().textContent();
    return numText?.trim() ?? '';
  }

  async getRowRemainingExp(row: Locator): Promise<string> {
    const usedRow = this.getRowUsedRow(row);
    const res = usedRow.locator('.calcRow__res').filter({ hasText: '残EXP' });
    const numText = await res.locator('.calcRow__num').first().textContent();
    return numText?.trim() ?? '';
  }

  async getRowSleepTime(row: Locator): Promise<string> {
    const usedRow = this.getRowUsedRow(row);
    const sleepTime = usedRow.locator('.calcRow__sleepTime');
    const text = await sleepTime.textContent();
    return text?.trim() ?? '';
  }

  // === スロットタブ操作 ===
  async getSlotTabCount(): Promise<number> {
    return await this.slotTabs.count();
  }

  async clickSlotTab(index: number): Promise<void> {
    await this.slotTabs.nth(index).click();
  }

  async setBoostKind(kind: 'full' | 'mini' | 'none'): Promise<void> {
    await this.boostKindSelect.selectOption(kind);
  }

  async getBoostKind(): Promise<string> {
    return await this.boostKindSelect.inputValue();
  }

  // === アクション操作 ===
  async clickExport(): Promise<void> {
    await this.exportButton.click();
  }

  async clickClear(): Promise<void> {
    await this.clearButton.click();
    // 確認ダイアログが表示される場合
    this.page.on('dialog', async dialog => {
      await dialog.accept();
    });
  }

  async clickUndo(): Promise<void> {
    await this.undoButton.click();
  }

  async clickRedo(): Promise<void> {
    await this.redoButton.click();
  }

  async clickSettings(): Promise<void> {
    await this.settingsButton.click();
  }

  // === 行操作 ===
  async deleteRow(row: Locator): Promise<void> {
    await this.getRowDeleteButton(row).click();
  }

  async moveRowUp(row: Locator): Promise<void> {
    await this.getRowMoveUpButton(row).click();
  }

  async moveRowDown(row: Locator): Promise<void> {
    await this.getRowMoveDownButton(row).click();
  }

  // === 検証ヘルパー ===
  async expectPanelVisible(): Promise<void> {
    await expect(this.panel).toBeVisible();
  }

  async expectEmptyStateVisible(): Promise<void> {
    await expect(this.emptyState).toBeVisible();
  }

  async expectEmptyStateHidden(): Promise<void> {
    await expect(this.emptyState).not.toBeVisible();
  }

  async expectRowCount(count: number): Promise<void> {
    await expect(this.calcRows).toHaveCount(count);
  }

  async expectRowActive(row: Locator): Promise<void> {
    await expect(row).toHaveClass(/calcRow--active/);
  }

  async expectHintVisible(): Promise<void> {
    await expect(this.hintPopover).toBeVisible();
  }

  async expectHintHidden(): Promise<void> {
    await expect(this.hintPopover).not.toBeVisible();
  }

  async expectExportModalVisible(): Promise<void> {
    await expect(this.exportModal).toBeVisible();
  }

  async expectExportModalHidden(): Promise<void> {
    await expect(this.exportModal).not.toBeVisible();
  }

  // === サマリー値の取得 ===
  async getTotalBoostCandy(): Promise<string> {
    const text = await this.totalBoostCandyText.textContent();
    return text?.trim() ?? '';
  }

  async getTotalShards(): Promise<string> {
    const text = await this.totalShardsText.textContent();
    return text?.trim() ?? '';
  }

  async getBoostCandyCap(): Promise<string> {
    const capText = this.page.getByTestId('calc-boost-candy-block').locator('.calcSum__k--right');
    const text = await capText.textContent();
    return text?.trim() ?? '';
  }

  async getShardsCap(): Promise<string> {
    const capText = this.page.getByTestId('calc-shards-block').locator('.calcSum__k--right');
    const text = await capText.textContent();
    return text?.trim() ?? '';
  }
}
