/**
 * E2E Test: 05-export
 * エクスポートオーバーレイのテスト（32件）
 */
import { test, expect, type Download } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CalcPanelPage } from './pages/CalcPanelPage';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { SettingsModalPage } from './pages/SettingsModalPage';
import { ExportPanelPage } from './pages/ExportPanelPage';
import { EXPORT_NATURE_MARK_PATH } from '../../src/export/exportNatureMark';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// テスト設定を読み込み
const testConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/test-config.json'), 'utf-8')
);

// ============================================================
// PNG 構造検証ヘルパー（fbl03 Phase 0）
// ============================================================
async function readDownloadBuffer(download: Download): Promise<Buffer> {
  const p = await download.path();
  expect(p, 'download.path() must resolve to a saved file').toBeTruthy();
  return fs.readFileSync(p as string);
}

/**
 * PNG signature と IHDR の width/height を検証し寸法を返す。
 * OS を跨ぐ全 byte hash は font rasterize 差で不安定なため、構造だけを合否条件にする。
 */
function assertValidPng(buf: Buffer): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const head = Array.from(buf.subarray(0, 8));
  expect(head, 'PNG signature 89 50 4E 47 0D 0A 1A 0A').toEqual(signature);
  // 8byte signature + 4byte length + "IHDR"
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect(width, 'IHDR width > 0').toBeGreaterThan(0);
  expect(height, 'IHDR height > 0').toBeGreaterThan(0);
  return { width, height };
}

// ============================================================
// セットアップヘルパー: ゴローニャ＋スイクン条件
// ============================================================
async function setupGolemSuicuneCondition(page: import('@playwright/test').Page) {
  const box = new BoxPanelPage(page);
  const calc = new CalcPanelPage(page);
  const settings = new SettingsModalPage(page);

  // 在庫設定：かけら4,000,000、万能S500、いわM3、アメブ残り350
  await calc.clickSettings();
  await settings.setTotalShards('4000000');
  await settings.setUniversalCandy('S', 500);
  await settings.setTypeCandy('いわ', 'M', 3);
  await settings.setBoostCandyRemaining('350');
  await settings.closeByButton();

  // --- ゴローニャを追加 ---
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
  await calc.setRowBoostCandy(rowGolem, '0');
  // 個数指定1500
  await calc.setRowCandyTarget(rowGolem, '1500');

  // --- スイクンを追加（EXP▼▼） ---
  await box.openAddNewPanel();
  await box.fillPokemonName('スイクン');
  await box.confirmPokemonName();
  // 性格をEXP下降（▼▼）に設定
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
  await calc.setRowSpeciesCandy(rowSuicune, '147');
  // アメブ在庫350
  await calc.setRowBoostCandy(rowSuicune, '350');
  // 個数指定50
  await calc.setRowCandyTarget(rowSuicune, '50');

  await page.waitForTimeout(300);
}

// ============================================================
// A. エクスポートオーバーレイの開閉
// ============================================================
test.describe('05-export A. オーバーレイの開閉', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('1. エクスポートボタンクリックでオーバーレイが開く', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const exportPanel = new ExportPanelPage(page);

    await calc.clickExport();
    await exportPanel.expectOverlayVisible();
  });

  test('1b. 1行の日本語は元の余白、英語の2行列見出しは狭い余白で中央に揃う', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const exportPanel = new ExportPanelPage(page);
    await calc.clickExport();

    let head = page.getByTestId('listHead');
    let firstCell = head.locator('.exportList__col').first();
    await expect(firstCell).toHaveCSS('padding-top', '10px');
    await expect(firstCell).toHaveCSS('padding-bottom', '10px');

    await exportPanel.close();
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('main.shell')).toHaveAttribute('data-locale', 'en');
    await calc.clickExport();

    head = page.getByTestId('listHead');
    firstCell = head.locator('.exportList__col').first();
    await expect(firstCell).toHaveCSS('align-items', 'center');
    await expect(firstCell).toHaveCSS('padding-top', '10px');
    await expect(firstCell).toHaveCSS('padding-bottom', '10px');
    const multilineCells = head.locator('.exportList__col--multiline');
    await expect(multilineCells).toHaveCount(2);
    await expect(multilineCells.first()).toHaveCSS('padding-top', '6px');
    await expect(multilineCells.first()).toHaveCSS('padding-bottom', '6px');

    const centerDelta = await firstCell.evaluate((cell) => {
      const cellRect = cell.getBoundingClientRect();
      const textNode = cell.firstChild;
      if (!textNode) return Number.POSITIVE_INFINITY;
      const textRange = document.createRange();
      textRange.selectNodeContents(cell);
      const textRect = textRange.getBoundingClientRect();
      return Math.abs(
        cellRect.top + cellRect.height / 2 - (textRect.top + textRect.height / 2),
      );
    });
    expect(centerDelta).toBeLessThanOrEqual(1);
  });

  test('1c. スマホ幅ではLvヘッダーを隠してデータ列と揃える', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await new CalcPanelPage(page).clickExport();

    const head = page.getByTestId('listHead');
    await expect(head.locator('.exportList__lvHead')).toBeHidden();
    await expect(head.locator('.exportList__col:visible')).toHaveCount(5);
  });

  test('2. 閉じるボタンでオーバーレイが閉じる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const exportPanel = new ExportPanelPage(page);

    await calc.clickExport();
    await exportPanel.expectOverlayVisible();

    await exportPanel.close();
    await exportPanel.expectOverlayHidden();
  });

  test('3. 背景クリックでオーバーレイが閉じる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const exportPanel = new ExportPanelPage(page);

    await calc.clickExport();
    await exportPanel.expectOverlayVisible();

    await exportPanel.closeByBackgroundClick();
    await exportPanel.expectOverlayHidden();
  });

  test('3b. タブレット・PC幅で開閉しても背景の位置が動かない', async ({ page }) => {
    await page.locator('.shell__scroll').evaluate((shell) => {
      const spacer = document.createElement('div');
      spacer.style.height = '1000px';
      shell.appendChild(spacer);
    });

    const exportPanel = new ExportPanelPage(page);
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 768 });
      const exportButton = page.getByTestId('calc-export-button');
      await expect(exportButton).toBeEnabled();
      // scrollToは入力イベントを発火しないため、実操作相当のpointerdownを先に通知する。
      await exportButton.dispatchEvent('pointerdown', { pointerId: 1 });
      await page.evaluate(() => window.scrollTo(0, 240));

      const calcPanel = page.locator('#neo-calc');
      const before = await calcPanel.boundingBox();
      const scrollbarWidth = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
      expect(before).not.toBeNull();

      await exportButton.evaluate((button: HTMLButtonElement) => button.click());
      await exportPanel.expectOverlayVisible();
      await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('fixed');

      const whileOpen = await calcPanel.boundingBox();
      expect(whileOpen).not.toBeNull();
      expect(whileOpen!.x).toBeCloseTo(before!.x, 1);
      expect(whileOpen!.y).toBeCloseTo(before!.y, 1);
      expect(whileOpen!.width).toBeCloseTo(before!.width, 1);
      expect(await page.evaluate(() => Number.parseFloat(document.body.style.paddingRight) || 0))
        .toBe(scrollbarWidth);

      await exportPanel.close();
      await exportPanel.expectOverlayHidden();
      await expect.poll(() => page.evaluate(() => document.body.style.position)).toBe('');
      const afterClose = await calcPanel.boundingBox();
      expect(afterClose).not.toBeNull();
      expect(afterClose!.x).toBeCloseTo(before!.x, 1);
      expect(afterClose!.y).toBeCloseTo(before!.y, 1);
      expect(afterClose!.width).toBeCloseTo(before!.width, 1);
      expect(await page.evaluate(() => document.body.style.paddingRight)).toBe('');
    }
  });
});

// ============================================================
// B. 画像出力
// ============================================================
test.describe('05-export B. 画像出力', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    const calc = new CalcPanelPage(page);
    await calc.clickExport();
  });

  test('4. 「画像を保存」ボタンが表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await expect(exportPanel.saveImageButton).toBeVisible();
  });

  // fbl03 Phase 0: download を必須にし、PNG 構造まで検証する。
  // 旧テストは download が無くても通る偽陽性だったため厳格化した。
  // Canvas 直接描画へ切替後に安定して通ることを必須条件とする。
  test('5. 「画像を保存」で PNG が download され、署名と寸法が有効', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);

    const download = await exportPanel.saveImageAndWaitDownload();
    expect(download.suggestedFilename()).toContain('CandyBoost-Planner');
    expect(download.suggestedFilename().endsWith('.png')).toBe(true);

    const buf = await readDownloadBuffer(download);
    assertValidPng(buf);
  });

  // fbl03 Phase 0: 同一 overlay をリロードせず連続 3 回保存できること。
  // 旧 DOM capture 経路は連続保存で状態破損・reload するため、この必須テストで検出する。
  test('5b. 同一 overlay で連続 3 回 download でき、毎回有効な PNG', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);

    for (let i = 0; i < 3; i++) {
      const download = await exportPanel.saveImageAndWaitDownload();
      const buf = await readDownloadBuffer(download);
      assertValidPng(buf);
      // overlay は開いたまま操作可能であること
      await expect(exportPanel.saveImageButton).toBeEnabled();
    }
  });

  // fbl03 Phase 0: 保存が export sheet の DOM を破壊しないこと。
  test('5c. 保存前後で sheet の DOM と capture iframe が変化しない', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);

    const before = await exportPanel.getSheetSnapshot();
    const iframeBefore = await exportPanel.countCaptureIframes();

    const download = await exportPanel.saveImageAndWaitDownload();
    assertValidPng(await readDownloadBuffer(download));

    const after = await exportPanel.getSheetSnapshot();
    const iframeAfter = await exportPanel.countCaptureIframes();

    // 親要素・class・inline style・scrollTop が保存前後で不変
    expect(after.parentTag).toBe(before.parentTag);
    expect(after.className).toBe(before.className);
    expect(after.styleAttr).toBe(before.styleAttr);
    expect(after.overlayScrollTop).toBe(before.overlayScrollTop);

    // capture iframe が残留・増加しない（新 renderer では 0 件）
    expect(iframeAfter.html2canvas).toBe(0);
    expect(iframeAfter.bodyIframes).toBeLessThanOrEqual(iframeBefore.bodyIframes);

    // 保存後も overlay を操作できる（CSV メニュー開閉・close）
    await exportPanel.openCsvMenu();
    await expect(exportPanel.csvMenu).toBeVisible();
    await exportPanel.sheet.click();
    await expect(exportPanel.csvMenu).not.toBeVisible();
    await exportPanel.close();
    await exportPanel.expectOverlayHidden();
  });

  test('6. 「画像を保存」ボタンは初期状態で有効', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await expect(exportPanel.saveImageButton).toBeEnabled();
  });

  test('6b. 長押し保存ビューアの案内が狭い画面でも上端に隠れない', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await page.setViewportSize({ width: 390, height: 500 });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: undefined,
      });
    });

    await exportPanel.clickSaveImage();

    const viewer = page.getByTestId('export-save-viewer');
    const hint = viewer.locator('.exportSaveViewer__hint');
    const preview = viewer.locator('.exportSaveViewer__img');
    // CI の低速環境では webfont 読込と Canvas 生成に5秒以上かかる場合がある。
    await expect(viewer).toBeVisible({ timeout: 15_000 });
    await expect(hint).toBeVisible();
    await expect(preview).toHaveCSS('border-radius', '0px');
    await expect(preview).toHaveCSS('box-shadow', 'none');

    const hintBox = await hint.boundingBox();
    expect(hintBox, '長押し保存の案内に表示領域がある').not.toBeNull();
    expect(hintBox!.y, '長押し保存の案内が viewport 上端より下にある').toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// C. CSV出力
// ============================================================
test.describe('05-export C. CSV出力', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    const calc = new CalcPanelPage(page);
    await calc.clickExport();
  });

  test('7. CSV▾ボタンが表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await expect(exportPanel.csvMenuButton).toBeVisible();
  });

  test('8. CSV▾クリックでメニューが開く', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);

    await exportPanel.openCsvMenu();
    await expect(exportPanel.csvMenu).toBeVisible();
  });

  test('9. 「ダウンロード」ボタンが機能する', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);

    await exportPanel.openCsvMenu();

    // ダウンロードイベントを待つ
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
    await exportPanel.clickCsvDownload();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('CandyBoost-Planner');
    expect(download.suggestedFilename()).toContain('.csv');
  });

  test('10. 「コピー」ボタンが機能する', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);

    // クリップボードAPIの権限を付与
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await exportPanel.openCsvMenu();
    await exportPanel.clickCsvCopy();

    // ステータスメッセージが表示される
    await expect(exportPanel.statusMessage).toBeVisible();
  });

  test('11. コピー成功時にステータスメッセージが表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await exportPanel.openCsvMenu();
    await exportPanel.clickCsvCopy();

    // ステータスメッセージに「コピー」が含まれる
    await expect(exportPanel.statusMessage).toContainText('コピー');
  });

  test('12. メニュー外クリックでメニューが閉じる', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);

    await exportPanel.openCsvMenu();
    await expect(exportPanel.csvMenu).toBeVisible();

    // シート内をクリック（メニュー外）
    await exportPanel.sheet.click();
    await expect(exportPanel.csvMenu).not.toBeVisible();
  });
});

// ============================================================
// D. サマリー表示
// ============================================================
test.describe('05-export D. サマリー表示', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    const calc = new CalcPanelPage(page);
    await calc.clickExport();
  });

  test('13. ブランドラベルが正しく表示される（フル）', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    // デフォルトはフルなので「ポケモンスリープ アメブースト計画」が表示される
    await expect(exportPanel.brandLabel).toContainText('ポケモンスリープ');
  });

  test('14. 月ラベルが正しく表示される（YYYY年M月）', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const now = new Date();
    const expectedMonth = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    await expect(exportPanel.monthLabel).toContainText(expectedMonth);
  });

  test('15. サマリーカード（アメブ合計等）が表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await expect(exportPanel.statCards.first()).toBeVisible();
    const cardCount = await exportPanel.statCards.count();
    expect(cardCount).toBeGreaterThanOrEqual(3);
  });

  test('16. プログレスバーが表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await exportPanel.expectBoostBarVisible();
    await exportPanel.expectShardsBarVisible();
  });

  test('17. 使用率が正しく表示される', async ({ page }) => {
    // プログレスバーのヘッダーに使用率が表示される
    const barHead = page.locator('.exportBarHead').first();
    await expect(barHead).toContainText('%');
  });
});

// ============================================================
// E. リスト表示
// ============================================================
test.describe('05-export E. リスト表示', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    const calc = new CalcPanelPage(page);
    await calc.clickExport();
  });

  test('18. ポケモンリストが表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await expect(exportPanel.listHead).toBeVisible();
    const rowCount = await exportPanel.listRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
  });

  test('19. 各行にポケモン名・Lv・アメ・かけらが表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const row = exportPanel.getListRow(0);
    const values = await exportPanel.getListRowValues(row);

    await expect(exportPanel.listHead.locator('.exportList__col')).toHaveCount(6);
    await expect(row.locator('.exportList__col')).toHaveCount(6);
    await expect(exportPanel.listHead).not.toContainText('アイテム');
    await expect(exportPanel.listHead).not.toContainText('calc.candySupply');
    expect(values.name).toBeTruthy();
    expect(values.srcLevel).toBeTruthy();
    expect(values.dstLevel).toBeTruthy();
  });

  test('20. 合計行が表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await expect(exportPanel.totalRow).toBeVisible();
  });

  test('21. 合計行の値が計算機の値と一致する', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const totalValues = await exportPanel.getTotalRowValues();

    // 合計行に値が存在することを確認
    expect(totalValues.totalCandy).toBeTruthy();
    expect(totalValues.shards).toBeTruthy();
  });

  test('22. ブーストなしモードではブーストカラムが非表示', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const exportPanel = new ExportPanelPage(page);

    // オーバーレイを閉じて設定変更
    await exportPanel.close();
    await calc.setBoostKind('none');
    await calc.clickExport();

    // ヘッダーにアメブカラムがないことを確認
    await expect(exportPanel.listHead).not.toContainText('アメブ');
    await expect(exportPanel.listHead.locator('.exportList__col')).toHaveCount(4);
    await expect(exportPanel.getListRow(0).locator('.exportList__col')).toHaveCount(4);
  });

  test('23. 不足カラムが存在しないことを確認する', async ({ page }) => {
    // 実使用化により不足列は廃止された
    const exportPanel = new ExportPanelPage(page);

    await expect(exportPanel.listHead).toBeVisible();
    await expect(exportPanel.listHead).not.toContainText('アメ不足');
    await expect(exportPanel.listHead).not.toContainText('かけら不足');
  });
});

// ============================================================
// F. 万能アメランキング
// ============================================================
test.describe('05-export F. 万能アメランキング', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await setupGolemSuicuneCondition(page);

    const calc = new CalcPanelPage(page);
    await calc.clickExport();
  });

  test('24. 万能アメ使用時にランキングが表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await expect(exportPanel.rankingSection).toBeVisible();
  });

  test('24b. 英語ではランキングではなく万能アメ消費量として表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const calc = new CalcPanelPage(page);
    await exportPanel.close();
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('main.shell')).toHaveAttribute('data-locale', 'en');
    await calc.clickExport();
    await expect(exportPanel.rankingTitle).toHaveText('Handy Candy Usage');
  });

  test('25. ランキングにポケモン名と使用率が表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const item = exportPanel.getRankingItem(0);
    const values = await exportPanel.getRankingItemValues(item);

    expect(values.name).toBeTruthy();
    expect(values.pct).toContain('%');
  });

  test('26. ランキングの合計が正しく表示される', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const totalText = await exportPanel.getRankingTotalText();
    expect(totalText).toContain('万能アメ');
  });

  test('26b. EXP性格補正マークがスマホ幅でも表示される', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const natureBadge = page.locator('.exportList__badge--down').first();
    await expect(natureBadge).toBeVisible();
    await expect(natureBadge).toHaveAttribute('role', 'img');
    await expect(natureBadge).toHaveAttribute('aria-label', '▼▼');
    const natureMark = natureBadge.locator('.exportList__badgeMark');
    await expect(natureMark).toBeVisible();
    await expect(natureMark).toHaveCSS('width', '18px');
    await expect(natureMark).toHaveCSS('height', '6px');
    await expect(natureBadge).toHaveCSS('padding', '4px');
    await expect(natureMark).toHaveAttribute('viewBox', '0 0 20 7');
    await expect(natureMark.locator('path')).toHaveAttribute('d', EXPORT_NATURE_MARK_PATH.down);
    const badgeBackground = await natureBadge.evaluate((element) => {
      const style = getComputedStyle(element, '::before');
      return { color: style.backgroundColor, opacity: style.opacity };
    });
    expect(badgeBackground.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(badgeBackground.opacity).toBe('0.11');

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(natureMark).toHaveCSS('width', '22px');
    await expect(natureMark).toHaveCSS('height', '8px');
    await expect(natureBadge).toHaveCSS('padding', '5px');
  });
});

// ============================================================
// G. 計算機との整合性検証（ゴローニャ＋スイクン）
// ============================================================
test.describe('05-export G. 計算機との整合性検証', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await setupGolemSuicuneCondition(page);

    const calc = new CalcPanelPage(page);
    await calc.clickExport();
  });

  test('27. サマリーカード：アメブ合計が50', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const value = await exportPanel.getStatCardValue('アメブ合計');
    expect(value).toBe('50');
  });

  test('28. サマリーカード：通常アメ合計が1,500', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const value = await exportPanel.getStatCardValue('通常アメ合計');
    expect(value.replace(/,/g, '')).toBe('1500');
  });

  test('29. サマリーカード：アメブ未使用が300（赤字）', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const card = exportPanel.getStatCard('アメブ未使用');
    const value = await card.locator('.statCard__value').textContent();
    expect(value?.trim()).toBe('300');

    // 赤字（danger）であることを確認
    const valueEl = card.locator('.statCard__value');
    await expect(valueEl).toHaveClass(/statCard__value--danger/);
  });

  test('30. サマリーカード：かけら合計が577,388', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const value = await exportPanel.getStatCardValue('かけら合計');
    expect(value.replace(/,/g, '')).toBe('577388');
  });

  test('31. 合計行：アメ合計が1,550', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    const totalValues = await exportPanel.getTotalRowValues();
    expect(totalValues.totalCandy.replace(/,/g, '')).toBe('1550');
  });

  test('32. 万能アメランキング：ゴローニャ100%、万能S475、タイプM3', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);

    // ランキング合計の確認
    const totalText = await exportPanel.getRankingTotalText();
    expect(totalText).toContain('475');

    // ゴローニャの行を確認
    const golemItem = exportPanel.getRankingItemByName('ゴローニャ');
    const values = await exportPanel.getRankingItemValues(golemItem);

    expect(values.pct).toBe('100%');
    expect(values.items).toContain('S475');
    expect(values.items).toContain('M3');
  });

  test('32a. DOMはシステムフォント、画像用タイポグラフィとは太さと文字幅だけを揃える', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await expect(exportPanel.sheet).toHaveCSS('font-family', /system-ui/);
    await expect(exportPanel.rankingTitle).toHaveCSS('font-family', /system-ui/);

    await expect(page.locator('.exportBrand__plan')).toHaveCSS('font-weight', '800');
    await expect(page.locator('.exportMonth__year')).toHaveCSS('font-weight', '650');
    await expect(page.locator('.exportMonth__month')).toHaveCSS('font-weight', '800');
    await expect(page.locator('.statCard__value').first()).toHaveCSS('font-weight', '750');
    await expect(page.locator('.exportList__name').first()).toHaveCSS('font-weight', '650');
    await expect(page.locator('.exportList__num').first()).toHaveCSS('font-weight', '550');
    await expect(page.locator('.statCard__value').first()).toHaveCSS('transform', 'matrix(0.97, 0, 0, 1, 0, 0)');
  });

  test('32b. Greenの育成プラン横棒はテーマ固有の色と濃さを使う', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('candy-boost-planner:design', 'green'));
    await page.reload();
    await new CalcPanelPage(page).clickExport();

    const fills = page.locator('.exportBar__fill');
    await expect(fills.nth(0)).toHaveCSS('background-color', 'rgba(132, 202, 100, 0.76)');
    await expect(fills.nth(1)).toHaveCSS('background-color', 'rgba(255, 173, 102, 0.76)');
  });

  test('33. CSVに実使用アイテム内訳が含まれる', async ({ page }) => {
    const exportPanel = new ExportPanelPage(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await exportPanel.openCsvMenu();
    await exportPanel.clickCsvCopy();
    const csv = await page.evaluate(() => navigator.clipboard.readText());

    expect(csv).toContain('アイテム');
    expect(csv).toContain('タM3');
    expect(csv).toContain('万S475');
    expect(csv).toContain(',▼▼,');
  });
});
