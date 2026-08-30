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
  readonly copySlotButton: Locator;
  readonly pasteSlotButton: Locator;
  readonly reassignBoostButton: Locator;

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
    this.copySlotButton = page.getByTestId('calc-copy-slot-button');
    this.pasteSlotButton = page.getByTestId('calc-paste-slot-button');
    this.reassignBoostButton = page.getByTestId('calc-reassign-boost-button');

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
    return row.getByTestId('srcLevel').getByTestId('level-picker-chevron');
  }

  getRowDstLevelButton(row: Locator): Locator {
    return row.getByTestId('dstLevel').getByTestId('level-picker-chevron');
  }

  /** レベルピッカーを開く。`which` は data-testid。 */
  async openLevelPicker(row: Locator, which: 'dstLevel' | 'boostReachLevel'): Promise<void> {
    await row.getByTestId(which).getByTestId('level-picker-chevron').click();
    await row.getByTestId(which).locator('.levelPick__title').waitFor();
  }

  /**
   * レベルピッカー内の不足ラベル。無ければ ''。
   * 目標Lvは アメ不足 / かけら不足、アメブ目標Lvは アメブ不足 を担当する。
   * planner は debounce されるため、呼び出し側で expect.poll すること。
   */
  async getLevelPickerShortageText(row: Locator, which: 'dstLevel' | 'boostReachLevel'): Promise<string> {
    const label = row.getByTestId(which).locator('.levelPick__shortage');
    return (await label.count()) === 0 ? '' : ((await label.textContent()) ?? '').trim();
  }

  getRowSrcLevelInput(row: Locator): Locator {
    return row.getByTestId('srcLevel').getByTestId('level-picker-trigger');
  }

  getRowDstLevelInput(row: Locator): Locator {
    return row.getByTestId('dstLevel').getByTestId('level-picker-trigger');
  }

  getRowExpRemainingInput(row: Locator): Locator {
    return row.getByTestId('expRemaining');
  }

  getRowSpeciesCandyInput(row: Locator): Locator {
    return row.getByTestId('speciesCandy');
  }

  async setRowSpeciesCandy(row: Locator, value: string | number): Promise<void> {
    const input = this.getRowSpeciesCandyInput(row);
    await input.fill(String(value));
    await input.blur();
  }

  getRowBoostReachLevelButton(row: Locator): Locator {
    return row.getByTestId('boostReachLevel').getByTestId('level-picker-chevron');
  }

  getRowBoostReachLevelInput(row: Locator): Locator {
    return row.getByTestId('boostReachLevel').getByTestId('level-picker-trigger');
  }

  getRowBoostCandyInput(row: Locator): Locator {
    return row.getByTestId('boostCandyCount');
  }

  async setRowBoostCandy(row: Locator, value: string | number): Promise<void> {
    const input = this.getRowBoostCandyInput(row);
    await input.fill(String(value));
    await input.blur();
  }

  getRowCandyTargetInput(row: Locator): Locator {
    return row.getByTestId('candyTarget');
  }

  getRowNatureTrigger(row: Locator): Locator {
    return row.getByTestId('nature-select-trigger');
  }

  async setRowNature(row: Locator, label: '-' | '▲▲' | '▼▼'): Promise<void> {
    await this.getRowNatureTrigger(row).click();
    const dropdown = this.page.getByTestId('nature-select-dropdown');
    await expect(dropdown).toBeVisible();
    await dropdown.getByRole('button', { name: label, exact: true }).dispatchEvent('mousedown');
    await expect(dropdown).not.toBeVisible();
  }

  /**
   * アメ個数指定を入力して確定する。
   * 入力欄は Enter / フォーカスアウトで確定するため、fill だけでは反映されない。
   */
  async setRowCandyTarget(row: Locator, value: string | number): Promise<void> {
    const input = this.getRowCandyTargetInput(row);
    await input.fill(String(value));
    await input.blur();
  }

  /** 睡眠目標のドロップダウン（未設定 / 200h / 500h / 1000h / 2000h / すべて睡眠）。 */
  getRowSleepTargetSelect(row: Locator): Locator {
    return row.getByTestId('sleepTargetHours');
  }

  /** 累計睡眠時間の編集ポップオーバーを開くラベル添え字リンク。 */
  getRowSleepTargetCurrentLink(row: Locator): Locator {
    return row.getByTestId('sleepTargetCurrentHours');
  }

  async setRowSrcLevel(row: Locator, level: number): Promise<void> {
    const input = this.getRowSrcLevelInput(row);
    await input.fill(String(level));
    await input.blur();
    await expect(input).toHaveValue(String(level));
  }

  async setRowDstLevel(row: Locator, level: number): Promise<void> {
    const input = this.getRowDstLevelInput(row);
    await input.fill(String(level));
    await input.blur();
    await expect(input).toHaveValue(String(level));
  }

  async setRowBoostReachLevel(row: Locator, level: number): Promise<void> {
    const input = this.getRowBoostReachLevelInput(row);
    await input.fill(String(level));
    await input.blur();
    await expect(input).toHaveValue(String(level));
  }

  async setRowExpRemaining(row: Locator, value: number): Promise<void> {
    const input = this.getRowExpRemainingInput(row);
    await input.fill(String(value));
    await input.blur();
    await expect(input).toHaveValue(String(value));
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

  /**
   * 「目標まで」の値を持つ行を返す。
   * 目標まで行が出ていないときは到達可能行と同値なので、到達可能行を返す。
   */
  async getRowTargetRow(row: Locator): Promise<Locator> {
    const requiredRow = this.getRowRequiredRow(row);
    return (await requiredRow.count()) > 0 ? requiredRow : this.getRowUsedRow(row);
  }

  // === 結果値の取得 ===
  async getRowResultValue(row: Locator, resultType: 'required' | 'used', field: 'boost' | 'normal' | 'candy' | 'shards'): Promise<string> {
    const reachableValue = row.getByTestId(`result-reachable-${field}-value`);
    let value = reachableValue;
    if (resultType === 'required') {
      const requiredValue = row.getByTestId(`result-required-${field}-value`);
      // 目標まで行は到達可能行と値が違う場合だけ存在する。再計算中に一時的に消える場合も
      // 待機を止めず、画面と同じ規則で常設の到達可能値へフォールバックする。
      if (await requiredValue.count() > 0) value = requiredValue;
    }
    const numText = await value.textContent();
    return numText?.trim() ?? '';
  }

  async waitForRowResultValue(
    row: Locator,
    resultType: 'required' | 'used',
    field: 'boost' | 'normal' | 'candy' | 'shards',
    expected: string,
    timeout = 10000
  ): Promise<void> {
    await expect.poll(async () => {
      const value = await this.getRowResultValue(row, resultType, field);
      return value.replace(/,/g, '');
    }, { timeout }).toBe(expected.replace(/,/g, ''));
  }

  async waitForPlannerResult(timeout = 10000): Promise<void> {
    await expect(this.calcRows.first()).toBeVisible({ timeout });
    await expect(this.exportButton).toBeEnabled({ timeout });
  }

  async getRowRequiredItems(row: Locator): Promise<string> {
    const targetRow = await this.getRowTargetRow(row);
    const text = await targetRow.textContent();
    return text?.replace(/余り(\d+)/g, '余り $1').trim() ?? '';
  }

  async waitForRowRequiredItems(row: Locator, pattern: string | RegExp, timeout = 10000): Promise<void> {
    await expect.poll(async () => this.getRowRequiredItems(row), { timeout }).toMatch(pattern);
  }

  async getRowUsedItems(row: Locator): Promise<string> {
    const usedRow = this.getRowUsedRow(row);
    const numText = await usedRow.getByTestId('result-reachable-items-value').textContent();
    return numText?.trim() ?? '';
  }

  async getRowReachedLevel(row: Locator): Promise<string> {
    const usedRow = this.getRowUsedRow(row);
    const numText = await usedRow.getByTestId('result-reachable-level-value').textContent();
    return numText?.trim() ?? '';
  }

  /** 睡眠込みの着地点（「約60.9」）。出ていない行では空文字。 */
  async getRowSleepReachLevel(row: Locator): Promise<string> {
    const usedRow = this.getRowUsedRow(row);
    const value = usedRow.getByTestId('result-sleep-reached-level-value');
    if (await value.count() === 0) return '';
    const numText = await value.textContent();
    return numText?.trim() ?? '';
  }

  async getRowRemainingExp(row: Locator): Promise<string> {
    const usedRow = this.getRowUsedRow(row);
    const remainingValue = usedRow.getByTestId('result-remaining-exp-value');
    if (await remainingValue.count() > 0) {
      const numText = await remainingValue.textContent();
      return numText?.trim() ?? '';
    }
    const text = await usedRow.textContent();
    return text?.match(/あとEXP\s*([0-9,]+)/)?.[1]?.trim()
      ?? '';
  }

  async getRowSleepTime(row: Locator): Promise<string> {
    const usedRow = this.getRowUsedRow(row);
    const sleepTime = usedRow.getByTestId('result-sleep-time');
    if (await sleepTime.count() === 0) return '';
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
    if (await this.calcRows.count() > 0) {
      await this.waitForPlannerResult();
    }
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

  async clickCopySlot(): Promise<void> {
    await this.copySlotButton.click();
  }

  async clickPasteSlot(): Promise<void> {
    await this.pasteSlotButton.click();
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

  /**
   * 上限ラベル付きプログレスバーは折りたたみ内（stickyExpanded）のため、非表示ならサマリーを開く
   */
  async expandStickyBarsIfCollapsed(): Promise<void> {
    const shardsBlock = this.page.getByTestId('calc-shards-block');
    if (!(await shardsBlock.isVisible().catch(() => false))) {
      await this.stickySummary.click();
      await shardsBlock.waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  async getBoostCandyCap(): Promise<string> {
    await this.expandStickyBarsIfCollapsed();
    const capText = this.page.getByTestId('calc-boost-candy-block').locator('.calcSum__k--right');
    const text = await capText.textContent();
    return text?.trim() ?? '';
  }

  async getShardsCap(): Promise<string> {
    await this.expandStickyBarsIfCollapsed();
    const capText = this.page.getByTestId('calc-shards-block').locator('.calcSum__k--right');
    const text = await capText.textContent();
    return text?.trim() ?? '';
  }
}
