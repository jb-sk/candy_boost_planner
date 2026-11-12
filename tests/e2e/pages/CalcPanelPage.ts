/**
 * CalcPanel Page Object
 * 計算機パネルのセレクタと操作をまとめる
 * すべてのセレクタはdata-testidベースで統一
 */
import { type Page, type Locator, expect } from '@playwright/test';

/** 睡眠目標の選び方（`src/domain/sleep-target.ts` の `SleepTargetChoice` と同じ形） */
export type SleepTargetChoiceInput =
  | { base: 'none' }
  | { base: 'hours'; hours: number }
  | { base: 'sleep'; stock: boolean }
  | { base: 'napIsland'; stock: boolean; ticket: boolean };

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
  readonly undoButton: Locator;
  readonly redoButton: Locator;
  readonly settingsButton: Locator;
  readonly reassignBoostButton: Locator;

  // === スロットタブ ===
  readonly slotTabs: Locator;
  readonly activeSlotTab: Locator;
  // 選択中のタブのメニュー（アメブの種類・コピー・ペースト・クリア）。行は開いている間だけある
  readonly slotMenuTrigger: Locator;
  readonly slotMenu: Locator;
  readonly slotMenuKinds: Locator;
  readonly slotMenuCopy: Locator;
  readonly slotMenuPaste: Locator;
  readonly slotMenuClear: Locator;

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
    // 元に戻す・やり直すはスマホ・タブレットは上部のナビ、PC は画面下中央の帯にある。見えている方を使う
    this.undoButton = page.getByTestId('history-undo-button').filter({ visible: true });
    this.redoButton = page.getByTestId('history-redo-button').filter({ visible: true });
    this.settingsButton = page.getByTestId('settings-open-button-desktop');
    this.reassignBoostButton = page.getByTestId('calc-reassign-boost-button');

    // スロットタブ（アクティブ＋非アクティブの両方を含む）
    this.slotTabs = page.getByTestId('calc-slot-tabs').locator('.slotTab');
    this.activeSlotTab = page.getByTestId('calc-slot-tab-active');
    this.slotMenuTrigger = page.getByTestId('calc-slot-menu-trigger');
    this.slotMenu = page.getByTestId('calc-slot-menu');
    this.slotMenuKinds = page.getByTestId('calc-slot-menu-kind');
    this.slotMenuCopy = page.getByTestId('calc-slot-menu-copy');
    this.slotMenuPaste = page.getByTestId('calc-slot-menu-paste');
    this.slotMenuClear = page.getByTestId('calc-slot-menu-clear');

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

  /** 睡眠目標のドロップダウンを開くトリガー。閉じたときの表示（`睡眠🍬` など）がテキストになる。 */
  getRowSleepTargetSelect(row: Locator): Locator {
    return row.getByTestId('sleepTargetHours');
  }

  /** 開いている睡眠目標の一覧（`body` 直下。同時に開けるのは1つ）。 */
  getSleepTargetDropdown(): Locator {
    return this.page.getByTestId('sleep-target-dropdown');
  }

  /** 睡眠目標の一覧を開く。 */
  async openSleepTarget(row: Locator): Promise<void> {
    await this.getRowSleepTargetSelect(row).click();
    await expect(this.getSleepTargetDropdown()).toBeVisible();
  }

  /** 開いている睡眠目標の一覧を Esc で閉じる（選択は変えない）。 */
  async closeSleepTarget(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.getSleepTargetDropdown()).toHaveCount(0);
  }

  /**
   * 睡眠目標を選ぶ（一覧を開く → チェックを合わせる → 行の名前を押す。一覧は閉じる）。
   * 選び方は画面と同じ形（`SleepTargetChoice`）。
   */
  async chooseSleepTarget(row: Locator, choice: SleepTargetChoiceInput): Promise<void> {
    await this.openSleepTarget(row);
    const dropdown = this.getSleepTargetDropdown();
    if (choice.base === 'sleep') {
      // 選んでいない行のチェックでも、その行が選ばれてチェックが反映される
      await dropdown.getByTestId('sleep-target-stock-check').setChecked(choice.stock);
    }
    if (choice.base === 'napIsland') {
      await dropdown.getByTestId('sleep-target-nap-stock-check').setChecked(choice.stock);
      await dropdown.getByTestId('sleep-target-nap-ticket-check').setChecked(choice.ticket);
    }
    const option = choice.base === 'none' ? 'none'
      : choice.base === 'hours' ? `h${choice.hours}`
      : choice.base === 'sleep' ? 'sleep'
      : 'nap';
    await dropdown.locator(`[data-option="${option}"]`).click();
    await expect(dropdown).toHaveCount(0);
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

  getRowHintButton(row: Locator): Locator {
    return row.getByTestId('hintBtn');
  }

  /** アメブ個数の ? を開き、このポケモンだけの「目標Lvに届く最小限のアメブ個数にする」を入れる／外して閉じる */
  async setRowMinimizeBoost(row: Locator, on: boolean): Promise<void> {
    await this.getRowHintButton(row).click();
    await this.expectHintVisible();
    await this.hintPopover.getByTestId('row-minimize-boost-checkbox').setChecked(on);
    await this.hintOverlay.click({ position: { x: 5, y: 5 } });
    await this.expectHintHidden();
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

  /** 選択中のタブのメニューを開く（開いていればそのまま） */
  async openSlotMenu(): Promise<void> {
    if (!(await this.slotMenu.isVisible())) await this.slotMenuTrigger.click();
    await expect(this.slotMenu).toBeVisible();
  }

  async closeSlotMenu(): Promise<void> {
    if (await this.slotMenu.isVisible()) await this.slotMenuTrigger.press('Escape');
    await expect(this.slotMenu).toHaveCount(0);
  }

  slotMenuKind(kind: 'full' | 'mini' | 'none'): Locator {
    return this.slotMenu.locator(`[data-testid="calc-slot-menu-kind"][data-value="${kind}"]`);
  }

  async setBoostKind(kind: 'full' | 'mini' | 'none'): Promise<void> {
    await this.openSlotMenu();
    await this.slotMenuKind(kind).click();
    await expect(this.slotMenu).toHaveCount(0);
    await expect(this.slotMenuTrigger).toHaveAttribute('data-value', kind);
  }

  async getBoostKind(): Promise<string> {
    return (await this.slotMenuTrigger.getAttribute('data-value')) ?? '';
  }

  // === アクション操作 ===
  async clickExport(): Promise<void> {
    if (await this.calcRows.count() > 0) {
      await this.waitForPlannerResult();
    }
    await this.exportButton.click();
  }

  /** 選択中のタブのメニューからクリアする（確認は出ない。元に戻すで戻せる） */
  async clickClear(): Promise<void> {
    await this.openSlotMenu();
    await this.slotMenuClear.click();
    await expect(this.slotMenu).toHaveCount(0);
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
    await this.openSlotMenu();
    await this.slotMenuCopy.click();
    await expect(this.slotMenu).toHaveCount(0);
  }

  async clickPasteSlot(): Promise<void> {
    await this.openSlotMenu();
    await this.slotMenuPaste.click();
    await expect(this.slotMenu).toHaveCount(0);
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
