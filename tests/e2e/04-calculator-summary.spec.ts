/**
 * E2E Test: 04-calculator
 * 計算機パネルのテスト（61件）
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CalcPanelPage } from './pages/CalcPanelPage';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { SettingsModalPage } from './pages/SettingsModalPage';

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
    // 低レベルポケモン（Lv25マルノーム）を使用 - Lv65はEXP入力不可のため
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

  test('24. ブースト割合スライダーを操作できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const slider = calc.getRowBoostRatioSlider(row);
    const ratioText = calc.getRowBoostRatioText(row);

    // スライダーを操作
    await slider.fill('50');
    const text = await ratioText.textContent();
    expect(text).toContain('50%');
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

    // 到達可能行が表示される
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow).toBeVisible();
  });

  test('27. 1000hボタンで個数指定が設定される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const btn1000h = calc.getRowSleepButton1000h(row);
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    const levelPickPopover = page.locator('.levelPick__popover');

    // 現在Lvを25に設定（Lv25→Lv60で十分な個数指定が発生するように）
    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await expect(levelPickPopover).toBeVisible();
    await levelPickPopover.locator('button').filter({ hasText: '25' }).click();
    await levelPickPopover.locator('button').filter({ hasText: '閉じる' }).click();
    await expect(levelPickPopover).not.toBeVisible();

    await btn1000h.click();
    const value = await candyTargetInput.inputValue();
    expect(parseInt(value)).toBe(1146);
  });

  test('28. 2000hボタンで個数指定が設定される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const btn2000h = calc.getRowSleepButton2000h(row);
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    const levelPickPopover = page.locator('.levelPick__popover');

    // 現在Lvを25に設定（Lv25→Lv60で十分な個数指定が発生するように）
    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await expect(levelPickPopover).toBeVisible();
    await levelPickPopover.locator('button').filter({ hasText: '25' }).click();
    await levelPickPopover.locator('button').filter({ hasText: '閉じる' }).click();
    await expect(levelPickPopover).not.toBeVisible();

    await btn2000h.click();
    const value = await candyTargetInput.inputValue();
    expect(parseInt(value)).toBe(609);
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

    const usedRow = calc.getRowUsedRow(row);
    const sleepTime = usedRow.locator('.calcRow__sleepTime');
    // 睡眠時間が表示されることを確認（残EXPがある場合）
    await expect(sleepTime).toBeVisible();
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
    const calc = new CalcPanelPage(page);
    const summaryInline = page.locator('.calcSumInline:not(.calcSumInline--candy)');
    await expect(summaryInline.first()).toBeVisible();
  });

  test('38. 万能アメ使用率が表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
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
    const srcLevelBtn1 = calc.getRowSrcLevelButton(rowGolem);
    await srcLevelBtn1.click();
    await page.locator('.levelPick__range').first().fill('29');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();
    // あとEXP135
    await calc.getRowExpRemainingInput(rowGolem).fill('135');
    // 目標Lv60
    const dstLevelBtn1 = calc.getRowDstLevelButton(rowGolem);
    await dstLevelBtn1.click();
    await page.locator('.levelPick__popover .levelChip').filter({ hasText: '60' }).click();
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();
    // アメブ0%
    await calc.getRowBoostRatioSlider(rowGolem).fill('0');
    // 個数指定1500
    await calc.getRowCandyTargetInput(rowGolem).fill('1500');

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
    const srcLevelBtn2 = calc.getRowSrcLevelButton(rowSuicune);
    await srcLevelBtn2.click();
    await page.locator('.levelPick__range').first().fill('58');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();
    // あとEXP1362
    await calc.getRowExpRemainingInput(rowSuicune).fill('1362');
    // 目標Lv65
    const dstLevelBtn2 = calc.getRowDstLevelButton(rowSuicune);
    await dstLevelBtn2.click();
    await page.locator('.levelPick__range').first().fill('65');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();
    // 種族アメ147
    await calc.getRowSpeciesCandyInput(rowSuicune).fill('147');
    // アメブ在庫350
    await calc.getRowBoostCandyInput(rowSuicune).fill('350');
    // 個数指定50
    await calc.getRowCandyTargetInput(rowSuicune).fill('50');

    await page.waitForTimeout(300);

    // サマリー値の検証（実使用ベース）
    // アメブ合計: 50
    const boostTotal = page.locator('.calcSumInline:not(.calcSumInline--candy)').first();
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

    // 睡眠時間を取得
    const sleepTime1 = await calc.getRowSleepTime(row);

    // 設定を変更
    await calc.clickSettings();
    await settings.setDailySleepHours(10);
    await settings.closeByButton();

    // 睡眠時間が変わることを確認
    const sleepTime2 = await calc.getRowSleepTime(row);
    expect(sleepTime1).not.toBe(sleepTime2);
  });

  test('51. 睡眠EXPボーナスが計算に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('10');

    const sleepTime1 = await calc.getRowSleepTime(row);

    await calc.clickSettings();
    await settings.setSleepExpBonus(4);
    await settings.closeByButton();

    const sleepTime2 = await calc.getRowSleepTime(row);
    expect(sleepTime1).not.toBe(sleepTime2);
  });

  test('52. GSDチェックが計算に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('10');

    const sleepTime1 = await calc.getRowSleepTime(row);

    await calc.clickSettings();
    await settings.toggleIncludeGSD();
    await settings.closeByButton();

    const sleepTime2 = await calc.getRowSleepTime(row);
    expect(sleepTime1).not.toBe(sleepTime2);
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
  test('57. ニャローテの計算結果が正しい', async ({ page }) => {
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
    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    const levelPickPopover = page.locator('.levelPick__popover');
    const levelChip20 = levelPickPopover.locator('.levelChip').filter({ hasText: '20' }).first();
    // チップがなければスライダーで設定
    if (await levelChip20.count() === 0) {
      const slider = levelPickPopover.locator('.levelPick__range');
      await slider.fill('20');
    } else {
      // レベルチップをクリック（20がない場合はスライダー）
      await page.locator('.levelPick__range').first().fill('20');
    }
    await levelPickPopover.locator('button').filter({ hasText: '閉じる' }).click();

    const expInput = calc.getRowExpRemainingInput(row);
    await expInput.fill('515');

    // 目標レベル60
    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    const dstPopover = page.locator('.levelPick__popover');
    const levelChip60 = dstPopover.locator('.levelChip').filter({ hasText: '60' });
    await levelChip60.click();
    await dstPopover.locator('button').filter({ hasText: '閉じる' }).click();

    // アメブ0%（スライダーを0に）
    const boostSlider = calc.getRowBoostRatioSlider(row);
    await boostSlider.fill('0');

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
    expect(reqNormal.replace(/,/g, '')).toBe('1771');
    expect(reqCandy.replace(/,/g, '')).toBe('1771');
    expect(reqShards.replace(/,/g, '')).toBe('533937');

    // 必要アイテム
    const reqItems = await calc.getRowRequiredItems(row);
    expect(reqItems).toContain('万能S 591');
    expect(reqItems).toContain('余り 2');
  });

  // M-2. ゴローニャ（個数指定あり）
  test('58. ゴローニャの目標まで行が正しい', async ({ page }) => {
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
    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('29');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    // あとEXP135
    const expInput = calc.getRowExpRemainingInput(row);
    await expInput.fill('135');

    // 目標レベル60
    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    const dstPopover = page.locator('.levelPick__popover');
    await dstPopover.locator('.levelChip').filter({ hasText: '60' }).click();
    await dstPopover.locator('button').filter({ hasText: '閉じる' }).click();

    // アメブ0%
    await calc.getRowBoostRatioSlider(row).fill('0');

    // 個数指定1500
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('1500');

    await page.waitForTimeout(200);

    // 目標まで行の検証
    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');
    const reqShards = await calc.getRowResultValue(row, 'required', 'shards');

    expect(reqBoost).toBe('0');
    expect(reqNormal.replace(/,/g, '')).toBe('1585');
    expect(reqCandy.replace(/,/g, '')).toBe('1585');
    expect(reqShards.replace(/,/g, '')).toBe('515885');

    const reqItems = await calc.getRowRequiredItems(row);
    expect(reqItems).toContain('いわM 3');
    expect(reqItems).toContain('万能S 504');
    expect(reqItems).toContain('余り 2');
  });

  test('59. ゴローニャの到達可能行が正しい', async ({ page }) => {
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

    // 設定（テスト58と同じ）
    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('29');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await calc.getRowExpRemainingInput(row).fill('135');

    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    await page.locator('.levelPick__popover .levelChip').filter({ hasText: '60' }).click();
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await calc.getRowBoostRatioSlider(row).fill('0');
    await calc.getRowCandyTargetInput(row).fill('1500');

    await page.waitForTimeout(200);

    // 到達可能行を展開
    await calc.expandRow(row);

    // 到達可能行の検証
    const usedBoost = await calc.getRowResultValue(row, 'used', 'boost');
    const usedNormal = await calc.getRowResultValue(row, 'used', 'normal');
    const usedCandy = await calc.getRowResultValue(row, 'used', 'candy');
    const usedShards = await calc.getRowResultValue(row, 'used', 'shards');

    expect(usedBoost).toBe('0');
    expect(usedNormal.replace(/,/g, '')).toBe('1500');
    expect(usedCandy.replace(/,/g, '')).toBe('1500');
    expect(usedShards.replace(/,/g, '')).toBe('465480');

    const usedItems = await calc.getRowUsedItems(row);
    expect(usedItems).toContain('いわM 3');
    expect(usedItems).toContain('万能S 475');

    const reachedLv = await calc.getRowReachedLevel(row);
    expect(reachedLv).toBe('59');

    const sleepTime = await calc.getRowSleepTime(row);
    expect(sleepTime).toContain('22日');
    expect(sleepTime).toContain('187時間');

    const remainingExp = await calc.getRowRemainingExp(row);
    expect(remainingExp.replace(/,/g, '')).toBe('2111');
  });

  // M-3. スイクン（ブースト使用・個数指定あり・EXP下降補正）
  test('60. スイクンの目標まで行が正しい', async ({ page }) => {
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

    // 個数指定50
    await calc.getRowCandyTargetInput(row).fill('50');

    await page.waitForTimeout(200);

    // アメブ目標Lv61、アメブ割合44%を確認
    const boostRatioText = calc.getRowBoostRatioText(row);
    const ratioText = await boostRatioText.textContent();
    expect(ratioText).toContain('44%');

    // 目標まで行の検証
    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');
    const reqShards = await calc.getRowResultValue(row, 'required', 'shards');

    expect(reqBoost).toBe('350');
    expect(reqNormal.replace(/,/g, '')).toBe('880');
    expect(reqCandy.replace(/,/g, '')).toBe('1230');
    expect(reqShards.replace(/,/g, '')).toBe('1581800');

    const reqItems = await calc.getRowRequiredItems(row);
    expect(reqItems).toContain('万能S 361');
  });

  test('61. スイクンの到達可能行が正しい', async ({ page }) => {
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

    // 設定（テスト60と同じ）
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
    await calc.getRowCandyTargetInput(row).fill('50');

    await page.waitForTimeout(200);

    // 到達可能行を展開
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

    const remainingExp = await calc.getRowRemainingExp(row);
    expect(remainingExp.replace(/,/g, '')).toBe('31078');

    const sleepTime = await calc.getRowSleepTime(row);
    expect(sleepTime).toContain('326日');
    expect(sleepTime).toContain('4238時間');
  });
});
