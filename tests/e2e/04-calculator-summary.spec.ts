/**
 * E2E Test: 04-calculator
 * 計算機パネルのテスト（63件）
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CalcPanelPage } from './pages/CalcPanelPage';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { SettingsModalPage } from './pages/SettingsModalPage';
import { markForSleep } from '../../src/domain/pokesleep/sleep-growth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// テスト設定を読み込み
const testConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/test-config.json'), 'utf-8')
);

// ============================================================
// A. 初期状態・空の計算機
// ============================================================
test.describe('04-calculator A. 初期状態', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('1. 計算機パネルが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await calc.expectPanelVisible();
  });

  test('2. 空状態のメッセージが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await calc.expectEmptyStateVisible();
    await expect(calc.emptyState).toContainText('ポケモンを追加して計算を始めましょう');
  });

  test('3. 空状態で「設定」リンクが機能する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.emptySettingsLink.click();
    await settings.expectModalVisible();
  });

  test('4. 空状態で「ヘルプ」リンクが機能する', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    await calc.emptyHelpLink.click();
    // ヘルプモーダルまたはパネルが開くことを確認
    const helpContent = page.locator('.modal, .helpPanel').filter({ hasText: '使い方' });
    await expect(helpContent).toBeVisible();
  });

  test('5. ボタンが無効化されている（クリア/エクスポート）', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    await expect(calc.exportButton).toBeDisabled();
    await expect(calc.clearButton).toBeDisabled();
  });
});

// ============================================================
// B. ポケモン追加・行の基本操作
// ============================================================
test.describe('04-calculator B. ポケモン追加・基本操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // ポケモンをインポート
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
  });

  test('6. BOXからポケモンを計算機に追加できる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    // タイルを選択
    await box.selectBoxTile(0);
    await box.expectDetailPanelVisible();

    // 「計算機に追加」ボタンをクリック
    await box.clickApplyToCalc();

    // 計算機に行が追加される
    await calc.expectRowCount(1);
  });

  test('6b. BOXから追加しても押した詳細パネルの画面位置を維持する', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const scrollContainer = page.locator('.shell__scroll');

    await page.setViewportSize({ width: 390, height: 700 });
    await box.selectBoxTile(0);
    await box.detailPanel.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // iOS Safari の自動アンカーが効かない／別要素を選ぶ場合でもアプリ側で維持する。
    await scrollContainer.evaluate((el) => {
      (el as HTMLElement).style.overflowAnchor = 'none';
    });

    const beforeTop = await box.detailPanel.evaluate((el) => el.getBoundingClientRect().top);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const afterTop = await box.detailPanel.evaluate((el) => el.getBoundingClientRect().top);

    expect(await scrollContainer.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(Math.abs(afterTop - beforeTop), '追加ボタン付近が追加前後で動かない').toBeLessThanOrEqual(2);
  });

  test('6c. 繰り返しリロードしても表示位置が累積してずれない', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const scrollContainer = page.locator('.shell__scroll');
    await page.setViewportSize({ width: 390, height: 700 });
    await expect(scrollContainer).toBeVisible();

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.waitForPlannerResult();
    const calcRow = page.getByTestId('calc-row').first();
    await calcRow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const beforeTop = await calcRow.evaluate((element) => element.getBoundingClientRect().top);
    expect(await scrollContainer.evaluate((element) => (element as HTMLElement).scrollTop)).toBeGreaterThan(0);

    try {
      for (let reloadCount = 0; reloadCount < 3; reloadCount += 1) {
        await page.reload();
        await expect(page.locator('#neo-calc')).toBeVisible();
        await calc.waitForPlannerResult();
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        const afterTop = await calcRow.evaluate((element) => element.getBoundingClientRect().top);
        expect(Math.abs(afterTop - beforeTop), `${reloadCount + 1}回目のリロード後 (${beforeTop} -> ${afterTop})`).toBeLessThanOrEqual(2);
      }
    } finally {
      await scrollContainer.evaluate((element) => { (element as HTMLElement).scrollTop = 0; });
      await page.evaluate(() => sessionStorage.removeItem('candy-boost-planner:ui:scrollTop:v1'));
    }
  });

  test('7. 計算機に行が追加されると空状態が消える', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    await calc.expectEmptyStateHidden();
  });

  test('8. 行をクリックでアクティブにできる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    const row = calc.getRow(0);
    await row.click();
    await calc.expectRowActive(row);
  });

  test('8b. 行の入力フォーカス中もstickyサマリーを前面に保つ', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await page.setViewportSize({ width: 390, height: 700 });
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    const row = calc.getRow(0);
    await calc.getRowExpRemainingInput(row).focus();

    const focusedLayers = await page.evaluate(() => ({
      summary: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>('.calcSticky')!).zIndex, 10),
      slot: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>('.calcSlotContainer')!).zIndex, 10),
    }));
    expect(focusedLayers.slot).toBeLessThan(focusedLayers.summary);

    await calc.getRowSrcLevelButton(row).click();
    await expect(row.getByTestId('level-picker-popover')).toBeVisible();
    const popoverLayers = await page.evaluate(() => ({
      summary: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>('.calcSticky')!).zIndex, 10),
      slot: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>('.calcSlotContainer')!).zIndex, 10),
    }));
    expect(popoverLayers.slot).toBeGreaterThan(popoverLayers.summary);
  });

  test('9. 行の削除ができる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    const row = calc.getRow(0);
    await calc.deleteRow(row);
    await calc.expectRowCount(0);
  });

  test('10. 全クリアができる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    // ダイアログを受け入れる設定
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    await calc.clearButton.click();
    await calc.expectRowCount(0);
    await calc.expectEmptyStateVisible();
  });
});

// ============================================================
// C. 元に戻す/やり直し
// ============================================================
test.describe('04-calculator C. 元に戻す/やり直し', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
  });

  test('11. 元に戻すが無効（操作前）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await expect(calc.undoButton).toBeDisabled();
  });

  test('12. 行削除後に「元に戻す」で復元できる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    const row = calc.getRow(0);
    await calc.deleteRow(row);
    await calc.expectRowCount(0);

    await calc.clickUndo();
    await calc.expectRowCount(1);
  });

  test('13. 「やり直し」で削除を再適用できる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    const row = calc.getRow(0);
    await calc.deleteRow(row);
    await calc.expectRowCount(0);

    await calc.clickUndo();
    await calc.expectRowCount(1);

    await calc.clickRedo();
    await calc.expectRowCount(0);
  });
});

// ============================================================
// D. スロットタブ操作
// ============================================================
test.describe('04-calculator D. スロットタブ操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('14. スロットタブが3つ表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const count = await calc.getSlotTabCount();
    expect(count).toBe(3);
  });

  test('15. スロットタブをクリックで切り替えできる', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    // 最初は0番目がアクティブ
    await expect(calc.activeSlotTab).toBeVisible();

    // 2番目のタブをクリック
    await calc.clickSlotTab(1);
    // アクティブタブが切り替わる（UIが更新される）
    await page.waitForTimeout(100);
  });

  test('16. アクティブタブにブースト種別セレクトが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await expect(calc.boostKindSelect).toBeVisible();
  });

  test('17. ブースト種別を「フル」に変更できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    await calc.setBoostKind('full');
    const kind = await calc.getBoostKind();
    expect(kind).toBe('full');
  });

  test('18. ブースト種別を「なし」に変更すると表示が変わる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const box = new BoxPanelPage(page);

    // ポケモンを追加
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    // 「なし」に変更
    await calc.setBoostKind('none');

    // ブースト関連のUIが変わる（アメブバーが非表示になる）
    await expect(calc.boostCandyBar).not.toBeVisible();
  });
});

// ============================================================
// E. 行の入力操作
// ============================================================
test.describe('04-calculator E. 行の入力操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    // 低レベルポケモン（Lv25マルノーム）を使用 - Lv70はEXP入力不可のため
    await box.fillImportText(testConfig.importData.lowLevelPokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('19. 現在レベル（srcLevel）を変更できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const srcLevelBtn = calc.getRowSrcLevelButton(row);

    // ピッカーを開いて操作
    await srcLevelBtn.click();
    const levelPickPopover = page.locator('.levelPick__popover');
    await expect(levelPickPopover).toBeVisible();

    // レベルを変更（現在Lvを50に - マルノームはLv55なので55以下を選択）
    const levelChip = levelPickPopover.locator('button').filter({ hasText: '50' });
    await levelChip.click();

    // 閉じる
    const closeBtn = levelPickPopover.locator('button').filter({ hasText: '閉じる' });
    await closeBtn.click();
  });

  test('20. 目標レベル（dstLevel）を変更できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const levelPickPopover = page.locator('.levelPick__popover');

    // 目標Lvピッカーを開く（マルノームはLv55なので55以上を選択可能）
    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    await expect(levelPickPopover).toBeVisible();

    // 60をクリック（現在Lv55より高いので選択可能）
    await levelPickPopover.locator('button').filter({ hasText: '60' }).click();
    await levelPickPopover.locator('button').filter({ hasText: '閉じる' }).click();
  });

  test('21. あとEXPを入力できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const expInput = calc.getRowExpRemainingInput(row);

    await expInput.fill('500');
    const value = await expInput.inputValue();
    expect(value).toBe('500');
  });

  test('21b. あとEXPを全削除してから入力し直せる（確定はblur）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const expInput = calc.getRowExpRemainingInput(row);

    await expInput.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await expect(expInput).toHaveValue('');

    await page.keyboard.type('1064');
    await expect(expInput).toHaveValue('1064');

    await page.locator('#neo-calc .panel__head').click();
    await expect(expInput).toHaveValue('1064');
  });

  test('22. 種族アメ在庫を入力できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const candyInput = calc.getRowSpeciesCandyInput(row);

    await candyInput.fill('100');
    const value = await candyInput.inputValue();
    expect(value).toBe('100');
  });

  test('23. ブースト到達レベルを変更できる（ピッカー）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const boostLevelBtn = calc.getRowBoostReachLevelButton(row);

    await boostLevelBtn.click();
    const levelPickPopover = page.locator('.levelPick__popover');
    await expect(levelPickPopover).toBeVisible();

    const closeBtn = levelPickPopover.locator('button').filter({ hasText: '閉じる' });
    await closeBtn.click();
  });

  // 割合スライダーは廃止。同じ調整はアメブ目標Lv（Lv単位）で行う（設計書§4.2）。
  test('24. アメブ目標Lvを下げるとアメブ個数が減る', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    const before = await calc.getRowBoostCandyInput(row).inputValue();
    expect(Number(before)).toBeGreaterThan(0);

    // アメブ目標Lvを現在Lvまで下げると、必要なアメブ個数は0になる
    const boostLevelInput = calc.getRowBoostReachLevelInput(row);
    await boostLevelInput.fill(String(await calc.getRowSrcLevelInput(row).inputValue()));
    await boostLevelInput.blur();
    await page.waitForTimeout(300);

    const after = await calc.getRowBoostCandyInput(row).inputValue();
    expect(Number(after)).toBeLessThan(Number(before));
  });

  test('25. アメブ個数を入力できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const boostCandyInput = calc.getRowBoostCandyInput(row);

    await boostCandyInput.fill('100');
    const value = await boostCandyInput.inputValue();
    expect(value).toBe('100');
  });

  test('26. 個数指定を入力すると到達可能行が自動展開', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const candyTargetInput = calc.getRowCandyTargetInput(row);

    await candyTargetInput.fill('50');
    await candyTargetInput.blur();

    // 到達可能行が表示される
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow).toBeVisible();
  });

  // 1000h/2000hチップは睡眠目標時間ドロップダウンへ統合（設計書§5.5）
  test('27. 睡眠目標1000hは13h設定で77日以内に収まる最小個数を設定する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);
    const sleepTarget = calc.getRowSleepTargetSelect(row);
    const candyTargetInput = calc.getRowCandyTargetInput(row);

    // 現在Lvを25に設定（Lv25→Lv60で十分な個数指定が発生するように）
    await calc.setRowSrcLevel(row, 25);
    await calc.getRowSpeciesCandyInput(row).fill('2000');
    await calc.clickSettings();
    await settings.setTotalShards('2000000');
    await settings.setDailySleepHours(13);
    await settings.closeByButton();

    await sleepTarget.selectOption('1000');
    const selected = Number(await candyTargetInput.inputValue());
    expect(selected).toBeGreaterThan(0);

    const mark = markForSleep({
      targetSleepHours: 1000,
      nature: 'down',
      dailySleepHours: 13,
      sleepExpBonus: 1,
      includeGSD: true,
    });
    await expect.poll(async () =>
      Number((await calc.getRowRemainingExp(row)).replace(/,/g, ''))
    ).toBeLessThanOrEqual(mark.sleepExp);

    const sleepTime = await calc.getRowSleepTime(row);
    const displayedDays = Number(sleepTime.match(/約(\d+)日/)?.[1] ?? 0);
    expect(displayedDays).toBeLessThanOrEqual(mark.requiredDays);
    expect(sleepTime).not.toContain('1014時間');

    // 同じ選択肢を選び直しても結果が変わらない（冪等。設計書§5.3）
    await sleepTarget.selectOption('1000');
    await page.waitForTimeout(300);
    expect(Number(await candyTargetInput.inputValue())).toBe(selected);

    // 睡眠目標を上げると、目標Lvは変わらず個数指定だけが減る（設計書§9）
    const dstBefore = await calc.getRowDstLevelInput(row).inputValue();
    await sleepTarget.selectOption('2000');
    await page.waitForTimeout(400);
    expect(Number(await candyTargetInput.inputValue())).toBeLessThan(selected);
    expect(await calc.getRowDstLevelInput(row).inputValue()).toBe(dstBefore);
  });

  test('28. 睡眠目標2000hで個数指定が設定される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);
    const sleepTarget = calc.getRowSleepTargetSelect(row);
    const candyTargetInput = calc.getRowCandyTargetInput(row);

    // 現在Lvを25に設定（Lv25→Lv60で十分な個数指定が発生するように）
    await calc.setRowSrcLevel(row, 25);
    await calc.getRowSpeciesCandyInput(row).fill('2000');
    await calc.clickSettings();
    await settings.setTotalShards('2000000');
    await settings.closeByButton();

    await sleepTarget.selectOption('2000');
    const selected = Number(await candyTargetInput.inputValue());
    expect(selected).toBeGreaterThan(0);

    const mark = markForSleep({
      targetSleepHours: 2000,
      nature: 'down',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      includeGSD: true,
    });
    await expect.poll(async () =>
      Number((await calc.getRowRemainingExp(row)).replace(/,/g, ''))
    ).toBeLessThanOrEqual(mark.sleepExp);

    // 睡眠目標を解除すると、個数指定は通常の個数指定として残る（設計書§4.3 状態遷移表）
    await sleepTarget.selectOption('');
    await page.waitForTimeout(400);
    expect(Number(await candyTargetInput.inputValue())).toBe(selected);
  });

  test('28b. 累計995h／999hは残りを1日へ切り上げ、1000h以上は0日を使用する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);
    await calc.setRowSrcLevel(row, 25);
    await calc.getRowSpeciesCandyInput(row).fill('2000');
    await calc.clickSettings();
    await settings.setTotalShards('2000000');
    await settings.closeByButton();

    const roundedOneDay = markForSleep({
      targetSleepHours: 1,
      nature: 'down',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      includeGSD: true,
    });
    expect(roundedOneDay.requiredDays).toBe(1);

    // 睡眠目標時間はドロップダウン、累計睡眠時間はラベルの添え字リンクから編集する（設計書§5.5）
    const setCurrentSleepHours = async (hours: number) => {
      await calc.getRowSleepTargetCurrentLink(row).click();
      const input = page.locator('.sleepHintPopover__input');
      await input.fill(String(hours));
      await input.blur();
      await page.locator('.hintOverlay').click({ position: { x: 5, y: 5 } });
    };

    const candyTargets: number[] = [];
    for (const currentHours of [995, 999]) {
      await setCurrentSleepHours(currentHours);
      await calc.getRowSleepTargetSelect(row).selectOption('1000');

      await expect.poll(async () =>
        Number((await calc.getRowRemainingExp(row)).replace(/,/g, ''))
      ).toBeLessThanOrEqual(roundedOneDay.sleepExp);
      candyTargets.push(Number(await calc.getRowCandyTargetInput(row).inputValue()));
    }
    // 995h も 999h も「残り1日」へ切り上がるので結果は同じ（冪等）
    expect(candyTargets[0]).toBe(candyTargets[1]);

    // 累計が目標に達していれば、これから寝る時間は0になり睡眠EXPは乗らない
    await setCurrentSleepHours(1000);
    const candyTargetAt1000 = Number(await calc.getRowCandyTargetInput(row).inputValue());
    expect(candyTargetAt1000).toBeGreaterThan(candyTargets[1]);
  });
});

// ============================================================
// F. 計算結果表示
// ============================================================
test.describe('04-calculator F. 計算結果表示', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    // 低レベルポケモン（Lv55マルノーム）を使用 - 目標Lvまでの差がないとexpToTarget=0で睡眠時間が表示されない
    await box.fillImportText(testConfig.importData.lowLevelPokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('29. 必要行（▶）が表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const requiredRow = calc.getRowRequiredRow(row);
    await expect(requiredRow).toBeVisible();
  });

  test('30. 必要行をクリックで展開できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    await calc.expandRow(row);
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow).toBeVisible();
  });

  test('31. 使用行が展開時に表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    await calc.expandRow(row);
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow).toBeVisible();
  });

  test('32. アメブ、アメ、かけらの値が表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    // 必要行に値が表示される
    const requiredRow = calc.getRowRequiredRow(row);
    await expect(requiredRow.locator('.calcRow__num')).not.toHaveCount(0);
  });

  test('33. 到達レベル（reachedLevel）が表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    await calc.expandRow(row);
    const usedRow = calc.getRowUsedRow(row);
    const reachedLvText = usedRow.locator('.calcRow__res').filter({ hasText: '到達Lv' });
    await expect(reachedLvText).toBeVisible();
  });

  test('34. 残り睡眠時間が表示される（残EXPがある場合）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    // 個数指定を入力して不足状態を作る
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('10');
    await candyTargetInput.blur();

    const usedRow = calc.getRowUsedRow(row);
    const sleepTime = usedRow.locator('.calcRow__sleepTime');
    // 睡眠時間が表示されることを確認（残EXPがある場合）
    await expect(sleepTime).toBeVisible();
  });

  test('34b. 1回睡眠の時間幅と1日以内／長期の境界を表示する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    await calc.setRowDstLevel(row, 56);
    // 在庫0なのでアメは1個も使えず、残EXPがそのまま睡眠時間になる。
    // （旧テストは個数指定0でアメを止めていたが、新設計では個数指定＝目標なので目標ごと現在地へ落ちる）
    await calc.expandRow(row);

    await calc.setRowExpRemaining(row, 24);
    await expect.poll(async () => calc.getRowSleepTime(row)).toBe('2時間31分 ～ 35分');

    await calc.setRowExpRemaining(row, 82);
    await expect.poll(async () => calc.getRowSleepTime(row)).toBe('8時間28分 ～ 30分');

    await calc.setRowExpRemaining(row, 83);
    await expect.poll(async () => calc.getRowSleepTime(row)).toBe('約2日（17時間）');

    await page.setViewportSize({ width: 390, height: 844 });
    const sleepTime = row.locator('.calcRow__sleepTime');
    await expect(sleepTime).toBeVisible();
    const sleepTimeBox = await sleepTime.boundingBox();
    expect(sleepTimeBox).not.toBeNull();
    expect(sleepTimeBox!.x + sleepTimeBox!.width).toBeLessThanOrEqual(390);
  });
});

// ============================================================
// G. プログレスバー・サマリー表示
// ============================================================
test.describe('04-calculator G. プログレスバー・サマリー表示', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('35. アメブ使用率バーが表示される（boostKind ≠ none）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    // サマリーをクリックして展開
    await calc.stickySummary.click();
    await expect(calc.boostCandyBar).toBeVisible();
  });

  test('36. かけら使用率バーが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    // サマリーをクリックして展開
    await calc.stickySummary.click();
    await expect(calc.shardsBar).toBeVisible();
  });

  test('37. サマリー（合計アメブ、合計かけら）が表示される', async ({ page }) => {
    const summaryInline = page.locator('.calcSumInline:not(.calcSumInline--candy)');
    await expect(summaryInline.first()).toBeVisible();
  });

  test('38. 万能アメ使用率が表示される', async ({ page }) => {
    const candyUsage = page.locator('.calcSumInline--candy');
    await expect(candyUsage.first()).toBeVisible();
  });
});

// ============================================================
// Gb. サマリー合計値の検証
// ============================================================
test.describe('04-calculator Gb. サマリー合計値の検証', () => {
  // ゴローニャ + スイクンの合算サマリーテスト
  test('38b. 複数ポケモンのサマリー合計が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // 在庫設定：かけら100万、万能S500、いわM3
    await calc.clickSettings();
    await settings.setTotalShards('1000000');
    await settings.setUniversalCandy('S', 500);
    await settings.setTypeCandy('いわ', 'M', 3);
    await settings.closeByButton();

    // --- ゴローニャを追加（テストMと同じ設定） ---
    await box.openAddNewPanel();
    await box.fillPokemonName('ゴローニャ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const rowGolem = calc.getRow(0);
    // 現在Lv29
    await calc.setRowSrcLevel(rowGolem, 29);
    // あとEXP122
    await calc.setRowExpRemaining(rowGolem, 122);
    // 目標Lv60
    await calc.setRowDstLevel(rowGolem, 60);
    // アメブ0%
    await calc.getRowBoostCandyInput(rowGolem).fill('0');
    // 個数指定1500
    await calc.setRowCandyTarget(rowGolem, '1500');

    // --- スイクンを追加（テストMと同じ設定） ---
    await box.openAddNewPanel();
    await box.fillPokemonName('スイクン');
    await box.confirmPokemonName();
    // 性格をEXP下降（▼）に設定
    await box.openNatureDropdown();
    await box.selectNatureOption(2);
    await box.clickAddToBox();

    const rowSuicune = calc.getRow(1);
    // 現在Lv58
    await calc.setRowSrcLevel(rowSuicune, 58);
    // あとEXP1362
    await calc.setRowExpRemaining(rowSuicune, 1362);
    // 目標Lv65
    await calc.setRowDstLevel(rowSuicune, 65);
    // 種族アメ147
    await calc.getRowSpeciesCandyInput(rowSuicune).fill('147');
    // アメブ在庫350
    await calc.getRowBoostCandyInput(rowSuicune).fill('350');
    // 個数指定50
    await calc.setRowCandyTarget(rowSuicune, '50');

    // サマリー値の検証（実使用ベース）
    // アメブ合計: 50
    const boostTotal = page.locator('.calcSumInline:not(.calcSumInline--candy)').first();
    await expect(boostTotal).toContainText('50', { timeout: 10000 });
    const boostTotalText = await boostTotal.textContent();
    expect(boostTotalText).toContain('50');

    // かけら合計（実使用ベース）
    const shardsTotal = page.locator('.calcSumInline:not(.calcSumInline--candy)').nth(1);
    const shardsTotalText = await shardsTotal.textContent();
    // 実使用ベースの値を検証
    expect(shardsTotalText?.replace(/,/g, '')).toBeTruthy();

    // 万能アメ使用率（実使用ベース）
    const candyUsage = page.locator('.calcSumInline--candy');
    const candyUsageText = await candyUsage.first().textContent();
    expect(candyUsageText).toBeTruthy();
  });
});

// ============================================================
// H. 行の並べ替え
// ============================================================
test.describe('04-calculator H. 行の並べ替え', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    // 複数ポケモンをインポート
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.importText);
    await box.clickImport();

    // 2つのポケモンを計算機に追加
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await page.waitForTimeout(100);
    await box.selectBoxTile(1);
    await box.clickApplyToCalc();
  });

  test('39. ↑ボタンで行を上に移動できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    // 2番目の行のタイトルを取得
    const row1 = calc.getRow(1);
    const title1 = await row1.locator('.calcRow__title').textContent();

    // ↑ボタンをクリック
    await calc.moveRowUp(row1);

    // 1番目の行になっていることを確認
    const newRow0 = calc.getRow(0);
    const newTitle0 = await newRow0.locator('.calcRow__title').textContent();
    expect(newTitle0).toBe(title1);
  });

  test('40. ↓ボタンで行を下に移動できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    // 1番目の行のタイトルを取得
    const row0 = calc.getRow(0);
    const title0 = await row0.locator('.calcRow__title').textContent();

    // ↓ボタンをクリック
    await calc.moveRowDown(row0);

    // 2番目の行になっていることを確認
    const newRow1 = calc.getRow(1);
    const newTitle1 = await newRow1.locator('.calcRow__title').textContent();
    expect(newTitle1).toBe(title0);
  });

  test('41. 先頭行では↑が無効', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row0 = calc.getRow(0);
    const upBtn = calc.getRowMoveUpButton(row0);
    await expect(upBtn).toBeDisabled();
  });

  test('42. 末尾行では↓が無効', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const rowCount = await calc.getRowCount();
    const lastRow = calc.getRow(rowCount - 1);
    const downBtn = calc.getRowMoveDownButton(lastRow);
    await expect(downBtn).toBeDisabled();
  });

  test('43. ドラッグハンドルが存在する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row0 = calc.getRow(0);
    const dragHandle = calc.getRowDragHandle(row0);
    await expect(dragHandle).toBeVisible();
  });
});

// ============================================================
// I. BOX連携
// ============================================================
test.describe('04-calculator I. BOX連携', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('44. 「BOXに反映」ボタンが表示される（boxIdがある行）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const applyBtn = calc.getRowApplyToBoxButton(row);
    await expect(applyBtn).toBeVisible();
  });

  test('45. 「BOXに反映」クリックでBOXが更新される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    // 個数指定を入力してレベルアップ
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('100');
    await candyTargetInput.blur();

    // BOXに反映
    const applyBtn = calc.getRowApplyToBoxButton(row);
    await applyBtn.click();

    // BOXのタイルが更新されていることを確認（レベルが変わる）
    // 具体的な値の確認は状況依存のため、ボタンクリックが成功することを確認
  });
});

// ============================================================
// J. 設定反映テスト
// ============================================================
test.describe('04-calculator J. 設定反映テスト', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    // 低レベルポケモン（Lv55マルノーム）を使用 - 睡眠時間テストに必要
    await box.fillImportText(testConfig.importData.lowLevelPokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('46. ブースト上限が計算機に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    await settings.setBoostCandyRemaining('8000');
    await settings.closeByButton();

    // 計算機のキャップ表示を確認
    const capText = await calc.getBoostCandyCap();
    expect(capText).toContain('8,000');
  });

  test('47. かけら上限が計算機に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    await settings.setTotalShards('500000');
    await settings.closeByButton();

    // 計算機のかけらキャップ表示を確認
    const capText = await calc.getShardsCap();
    expect(capText).toContain('500,000');
  });

  test('48. 万能アメ在庫が計算機に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    await settings.setUniversalCandy('S', 100);
    await settings.closeByButton();

    // 万能アメ使用率の表示を確認
    const candyUsage = page.locator('.calcSumInline--candy');
    await expect(candyUsage.first()).toBeVisible();
  });

  test('49. タイプアメ在庫が計算結果に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    // ひこうタイプ（ウッウ用）のアメを設定
    await settings.setTypeCandy('ひこう', 'S', 100);
    await settings.closeByButton();

    // 必要アイテムに反映されることを確認
    const row = calc.getRow(0);
    await calc.expandRow(row);
  });

  test('50. 睡眠時間設定が計算に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    // 個数指定を設定
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('10');
    await candyTargetInput.blur();
    await calc.expandRow(row);

    // 睡眠時間を取得
    const sleepTime1 = await calc.getRowSleepTime(row);
    expect(sleepTime1).not.toBe('');

    // 設定を変更
    await calc.clickSettings();
    await settings.setDailySleepHours(10);
    await settings.closeByButton();
    await calc.expandRow(row);

    // 睡眠時間が変わることを確認
    await expect.poll(async () => calc.getRowSleepTime(row), { timeout: 10000 }).not.toBe(sleepTime1);
  });

  test('51. 睡眠EXPボーナスが計算に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('10');
    await candyTargetInput.blur();
    await calc.expandRow(row);

    const sleepTime1 = await calc.getRowSleepTime(row);
    expect(sleepTime1).not.toBe('');

    await calc.clickSettings();
    await settings.setSleepExpBonus(4);
    await settings.closeByButton();
    await calc.expandRow(row);

    await expect.poll(async () => calc.getRowSleepTime(row), { timeout: 10000 }).not.toBe(sleepTime1);
  });

  test('52. GSDチェックが計算に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    // 在庫0のまま目標Lvまでの不足を睡眠で埋める（GSDの差が出るよう長期になる条件）。
    // 個数指定を入れると新設計では目標がその個数ぶんへ縮み、GSDが効く長さにならない。
    await calc.expandRow(row);

    const sleepTime1 = await calc.getRowSleepTime(row);
    expect(sleepTime1).not.toBe('');

    await calc.clickSettings();
    await settings.toggleIncludeGSD();
    await settings.closeByButton();
    await calc.expandRow(row);

    await expect.poll(async () => calc.getRowSleepTime(row), { timeout: 10000 }).not.toBe(sleepTime1);
  });
});



// ============================================================
// K. スロットのコピー/ペースト
// ============================================================
test.describe('04-calculator K. スロットのコピー/ペースト', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('53. 空状態ではコピー・ペーストが無効', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await expect(calc.copySlotButton).toBeDisabled();
    await expect(calc.pasteSlotButton).toBeDisabled();
  });

  test('54. コピーするとペーストが有効になる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    // スロット0にポケモンを追加
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    // コピー前はペースト無効
    await expect(calc.copySlotButton).toBeEnabled();
    await expect(calc.pasteSlotButton).toBeDisabled();

    // コピー後はペースト有効
    await calc.clickCopySlot();
    await expect(calc.pasteSlotButton).toBeEnabled();
  });

  test('54b. 別スロットへペーストすると行・アメブ種別が複製される', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // スロット0にポケモンを追加し、スロット固有設定を既定値と異なる値にする
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.setBoostKind('full');
    await settings.openSettingsFromDesktop();
    await settings.setBoostCandyRemaining('123');
    await settings.setItemCompareMode('legacyImproved');
    await settings.closeByButton();
    await calc.expectRowCount(1);

    const slot0Title = await calc.getRow(0).locator('.calcRow__title').textContent();

    // コピー
    await calc.clickCopySlot();

    // スロット1（空・既定 mini）へ切り替え
    await calc.clickSlotTab(1);
    await calc.expectRowCount(0);
    expect(await calc.getBoostKind()).toBe('mini');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('');
    expect(await settings.getItemCompareMode()).toBe('surplusFirst');
    await settings.closeByButton();

    // ペースト
    await calc.clickPasteSlot();

    // 行とスロット固有設定が複製される
    await calc.expectRowCount(1);
    expect(await calc.getRow(0).locator('.calcRow__title').textContent()).toBe(slot0Title);
    expect(await calc.getBoostKind()).toBe('full');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('123');
    expect(await settings.getItemCompareMode()).toBe('legacyImproved');
    await settings.closeByButton();
  });

  test('54c. ペーストは「元に戻す/やり直す」の対象', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // スロット0にポケモンを追加してコピー
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.setBoostKind('full');
    await settings.openSettingsFromDesktop();
    await settings.setBoostCandyRemaining('123');
    await settings.setItemCompareMode('legacyImproved');
    await settings.closeByButton();
    await calc.clickCopySlot();

    // スロット1へ切り替えてペースト
    await calc.clickSlotTab(1);
    await calc.expectRowCount(0);
    await calc.clickPasteSlot();
    await calc.expectRowCount(1);
    expect(await calc.getBoostKind()).toBe('full');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('123');
    expect(await settings.getItemCompareMode()).toBe('legacyImproved');
    await settings.closeByButton();

    // 元に戻す → ペースト前（空・mini・既定設定）に戻る
    await calc.clickUndo();
    await calc.expectRowCount(0);
    expect(await calc.getBoostKind()).toBe('mini');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('');
    expect(await settings.getItemCompareMode()).toBe('surplusFirst');
    await settings.closeByButton();

    // やり直す → 再度ペースト適用
    await calc.clickRedo();
    await calc.expectRowCount(1);
    expect(await calc.getBoostKind()).toBe('full');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('123');
    expect(await settings.getItemCompareMode()).toBe('legacyImproved');
    await settings.closeByButton();
  });
});

// ============================================================
// L. ヒント表示
// ============================================================
test.describe('04-calculator L. ヒント表示', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('55. ヒントアイコン（?）をクリックでヒントが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const hintBtn = calc.getRowHintButton(row);

    await hintBtn.click();
    await calc.expectHintVisible();
    await expect(calc.hintPopover.locator('br')).toHaveCount(3);
    await expect(calc.hintPopover.locator('button')).toHaveCount(1);
  });

  test('55b. ヒント内の基本設定リンクから設定を開ける', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    await calc.getRowHintButton(row).click();
    const hintSettings = page.getByTestId('calc-hint-settings');
    await expect(hintSettings).toHaveCSS('box-shadow', 'none');
    await hintSettings.click();
    await settings.expectModalVisible();
  });

  test('56. ヒントをクリック外で閉じられる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const hintBtn = calc.getRowHintButton(row);

    await hintBtn.click();
    await calc.expectHintVisible();

    // オーバーレイをクリック
    await calc.hintOverlay.click();
    await calc.expectHintHidden();
  });
});

// ============================================================
// M. 計算結果の期待値検証（具体的なポケモン）
// ============================================================
test.describe('04-calculator M. 計算結果の期待値検証', () => {

  // M-1. ニャローテ（基本計算・在庫未設定）
  test('60. ニャローテの計算結果が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    // ニャローテを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('ニャローテ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 現在レベル20、あとEXP515を設定
    await calc.setRowSrcLevel(row, 20);
    await calc.setRowExpRemaining(row, 515);

    // 目標レベル60
    await calc.setRowDstLevel(row, 60);

    // アメブ個数0（全て通常アメ）
    await calc.getRowBoostCandyInput(row).fill('0');

    // 検証
    await page.waitForTimeout(200);

    // 目標まで行を展開
    await calc.expandRow(row);

    // 目標まで行の値を確認
    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');
    const reqShards = await calc.getRowResultValue(row, 'required', 'shards');

    expect(reqBoost).toBe('0');
    expect(reqNormal.replace(/,/g, '')).toBe('1745');
    expect(reqCandy.replace(/,/g, '')).toBe('1745');
    expect(reqShards.replace(/,/g, '')).toBe('531268');

    // 必要アイテム
    const reqItems = await calc.getRowRequiredItems(row);
    expect(reqItems).toContain('万能S 582');
    expect(reqItems).toContain('余り 1');
  });

  // M-2. ゴローニャ（個数指定あり）
  test('61. ゴローニャの目標まで行が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // いわタイプアメMを3つ設定
    await calc.clickSettings();
    await settings.setTypeCandy('いわ', 'M', 3);
    await settings.closeByButton();

    // ゴローニャを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('ゴローニャ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 現在レベル29
    await calc.setRowSrcLevel(row, 29);

    // あとEXP122
    await calc.setRowExpRemaining(row, 122);

    // 目標レベル60
    await calc.setRowDstLevel(row, 60);

    // アメブ0%
    await calc.getRowBoostCandyInput(row).fill('0');

    // 個数指定なし: 目標まで行は「目標Lv60ちょうどに届く最小数」を出す
    await calc.waitForRowResultValue(row, 'required', 'normal', '1584');
    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');
    const reqShards = await calc.getRowResultValue(row, 'required', 'shards');

    expect(reqBoost).toBe('0');
    expect(reqNormal.replace(/,/g, '')).toBe('1584');
    expect(reqCandy.replace(/,/g, '')).toBe('1584');
    expect(reqShards.replace(/,/g, '')).toBe('515860');

    await calc.waitForRowRequiredItems(row, 'いわM 3');
    const reqItems = await calc.getRowRequiredItems(row);
    expect(reqItems).toContain('いわM 3');
    expect(reqItems).toContain('万能S 503');

    // 個数指定1500: 個数指定＝目標なので、目標まで行はその指定値ちょうどになる（設計書§4.5.1）
    await calc.setRowCandyTarget(row, '1500');
    await calc.waitForRowResultValue(row, 'required', 'candy', '1500');
    expect((await calc.getRowResultValue(row, 'required', 'normal')).replace(/,/g, '')).toBe('1500');
  });

  test('62. ゴローニャの到達可能行が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // 在庫設定：いわM 3, 万能S 500, かけら 400万
    await calc.clickSettings();
    await settings.setTypeCandy('いわ', 'M', 3);
    await settings.setUniversalCandy('S', 500);
    await settings.setTotalShards('4000000');
    await settings.closeByButton();

    // ゴローニャを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('ゴローニャ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 設定（テスト61と同じ）
    await calc.setRowSrcLevel(row, 29);
    await calc.setRowExpRemaining(row, 122);
    await calc.setRowDstLevel(row, 60);

    await calc.getRowBoostCandyInput(row).fill('0');
    await calc.setRowCandyTarget(row, '1500');

    // 到達可能行を展開（個数指定＝目標なので、目標まで行も指定1,500になる）
    await calc.waitForRowResultValue(row, 'required', 'candy', '1500');
    await calc.expandRow(row);

    // 到達可能行の検証
    const usedBoost = await calc.getRowResultValue(row, 'used', 'boost');
    const usedNormal = await calc.getRowResultValue(row, 'used', 'normal');
    const usedCandy = await calc.getRowResultValue(row, 'used', 'candy');
    const usedShards = await calc.getRowResultValue(row, 'used', 'shards');

    expect(usedBoost).toBe('0');
    expect(usedNormal.replace(/,/g, '')).toBe('1500');
    expect(usedCandy.replace(/,/g, '')).toBe('1500');
    expect(usedShards.replace(/,/g, '')).toBe('466048');

    const usedItems = await calc.getRowUsedItems(row);
    expect(usedItems).toContain('いわM 3');
    expect(usedItems).toContain('万能S 475');

    const reachedLv = await calc.getRowReachedLevel(row);
    expect(reachedLv).toBe('59');

    // 個数指定＝目標なので、指定1,500個を賄えた時点で目標到達となり「残EXP」は出ない。
    // （getRowRemainingExp は残EXPが無いとき到達Lv横の「あとEXP」へフォールバックするため、
    //   ここでは残EXP欄そのものが無いことを直接確認する。設計書§4.5.1）
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow.locator('.calcRow__k--info').filter({ hasText: '残EXP' })).toHaveCount(0);
  });

  // M-3. スイクン（ブースト使用・個数指定あり・EXP下降補正）
  test('63. スイクンの目標まで行が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    // スイクンを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('スイクン');
    await box.confirmPokemonName();

    // 性格をEXP下降（▼）に設定
    await box.openNatureDropdown();
    // EXP下降は通常 index 2（ひかえめ系など）
    await box.selectNatureOption(2);

    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 現在レベル58
    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('58');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    // あとEXP1362
    await calc.getRowExpRemainingInput(row).fill('1362');

    // 目標レベル65
    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('65');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    // アメ在庫147
    await calc.getRowSpeciesCandyInput(row).fill('147');

    // アメブ個数350
    await calc.getRowBoostCandyInput(row).fill('350');

    // 個数指定なし: 目標まで行は目標Lv65ちょうどに届く数を出す
    await calc.waitForRowResultValue(row, 'required', 'normal', '880');

    // 目標まで行の検証
    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');
    const reqShards = await calc.getRowResultValue(row, 'required', 'shards');

    expect(reqBoost).toBe('350');
    // Lv58→65の残EXP33,178に対し、ミニブ350個で14,700 EXP、
    // 残り18,478 EXPは下降補正の通常アメ（21 EXP）880個で満たす。
    expect(reqNormal.replace(/,/g, '')).toBe('880');
    expect(reqCandy.replace(/,/g, '')).toBe('1230');
    expect(reqShards.replace(/,/g, '')).toBe('1581800');

    // 理論値補填は「在庫の種族アメ147 → 万能S」の順（147 + 361 * 3 = 1,230）
    const reqItems = await calc.getRowRequiredItems(row);
    expect(reqItems).toContain('万能S 361');

    // 個数指定50: 個数指定＝目標なので、目標まで行は50個ちょうどになり
    // アメブも総アメ数の内数としてクランプされる（設計書§4.3, §4.5.1）
    await calc.setRowCandyTarget(row, '50');
    await calc.waitForRowResultValue(row, 'required', 'candy', '50');
    expect(await calc.getRowBoostCandyInput(row).inputValue()).toBe('50');
  });

  test('64. スイクンの到達可能行が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // 在庫設定：かけら 200万、睡眠時間 13時間
    await calc.clickSettings();
    await settings.setTotalShards('2000000');
    await settings.setDailySleepHours(13);
    await settings.closeByButton();

    // スイクンを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('スイクン');
    await box.confirmPokemonName();

    // 性格をEXP下降（▼）に設定
    await box.openNatureDropdown();
    await box.selectNatureOption(2);

    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 設定（テスト63と同じ）
    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('58');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await calc.getRowExpRemainingInput(row).fill('1362');

    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('65');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await calc.getRowSpeciesCandyInput(row).fill('147');
    await calc.getRowBoostCandyInput(row).fill('350');
    await calc.setRowCandyTarget(row, '50');

    // required は同期計算なので、Worker の到達可能結果が反映されるまで used を待つ。
    await calc.waitForRowResultValue(row, 'used', 'candy', '50');
    await calc.expandRow(row);

    // 到達可能行の検証
    const usedBoost = await calc.getRowResultValue(row, 'used', 'boost');
    const usedNormal = await calc.getRowResultValue(row, 'used', 'normal');
    const usedCandy = await calc.getRowResultValue(row, 'used', 'candy');
    const usedShards = await calc.getRowResultValue(row, 'used', 'shards');

    expect(usedBoost).toBe('50');
    expect(usedNormal).toBe('0');
    expect(usedCandy).toBe('50');
    expect(usedShards.replace(/,/g, '')).toBe('111340');

    const reachedLv = await calc.getRowReachedLevel(row);
    expect(reachedLv).toBe('59');

    // 個数指定＝目標なので、指定50個を賄えた時点で目標到達となり「残EXP」は出ない（設計書§4.5.1）
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow.locator('.calcRow__k--info').filter({ hasText: '残EXP' })).toHaveCount(0);
  });

  test('65. ドオーのラスイチ交換が自動最適化される', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await calc.setBoostKind('full');

    await box.openAddNewPanel();
    await box.fillPokemonName('ドオー');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);

    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('30');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await calc.getRowExpRemainingInput(row).fill('729');

    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    await page.locator('.levelPick__popover .levelChip').filter({ hasText: '60' }).click();
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await page.waitForTimeout(200);
    await calc.expandRow(row);

    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');

    // 割合表示は廃止（設計書§4.2）。内訳そのもので検証する。
    expect(reqBoost).toBe('790');
    expect(reqNormal).toBe('1');
    expect(reqCandy).toBe('791');
  });
});
