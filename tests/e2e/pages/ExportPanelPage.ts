/**
 * ExportPanel Page Object
 * エクスポートオーバーレイのセレクタと操作をまとめる
 * すべてのセレクタはdata-testidベースで統一
 */
import { type Page, type Locator, expect } from '@playwright/test';

export class ExportPanelPage {
  readonly page: Page;

  // === オーバーレイ本体 ===
  readonly overlay: Locator;
  readonly sheet: Locator;

  // === ヘッダー ===
  readonly brandLabel: Locator;
  readonly monthLabel: Locator;

  // === アクションボタン ===
  readonly saveImageButton: Locator;
  readonly csvMenuButton: Locator;
  readonly csvMenu: Locator;
  readonly csvDownloadButton: Locator;
  readonly csvCopyButton: Locator;
  readonly closeButton: Locator;

  // === ステータス ===
  readonly statusMessage: Locator;

  // === サマリーカード ===
  readonly statCards: Locator;

  // === プログレスバー ===
  readonly boostBar: Locator;
  readonly shardsBar: Locator;

  // === リスト ===
  readonly listHead: Locator;
  readonly listRows: Locator;
  readonly totalRow: Locator;

  // === 万能アメランキング ===
  readonly rankingSection: Locator;
  readonly rankingTitle: Locator;
  readonly rankingTotal: Locator;
  readonly rankingItems: Locator;

  constructor(page: Page) {
    this.page = page;

    // オーバーレイ本体
    this.overlay = page.getByTestId('export-overlay');
    this.sheet = page.getByTestId('export-sheet');

    // ヘッダー
    this.brandLabel = page.getByTestId('brandLabel');
    this.monthLabel = page.getByTestId('monthLabel');

    // アクションボタン
    this.saveImageButton = page.getByTestId('saveImageButton');
    this.csvMenuButton = page.getByTestId('csvMenuButton');
    this.csvMenu = page.getByTestId('export-csv-menu');
    this.csvDownloadButton = page.getByTestId('csvDownloadButton');
    this.csvCopyButton = page.getByTestId('csvCopyButton');
    this.closeButton = page.getByTestId('closeButton');

    // ステータス
    this.statusMessage = page.getByTestId('export-status');

    // サマリーカード
    this.statCards = page.getByTestId('statCard');

    // プログレスバー
    this.boostBar = page.getByTestId('boostBar');
    this.shardsBar = page.getByTestId('shardsBar');

    // リスト
    this.listHead = page.getByTestId('listHead');
    this.listRows = page.getByTestId('listRow');
    this.totalRow = page.getByTestId('totalRow');

    // 万能アメランキング
    this.rankingSection = page.getByTestId('rankingSection');
    this.rankingTitle = page.getByTestId('export-ranking-title');
    this.rankingTotal = page.getByTestId('export-ranking-total');
    this.rankingItems = page.getByTestId('rankingItem');
  }

  // === 表示検証 ===
  async expectOverlayVisible(): Promise<void> {
    await expect(this.overlay).toBeVisible();
  }

  async expectOverlayHidden(): Promise<void> {
    await expect(this.overlay).not.toBeVisible();
  }

  // === アクション ===
  async close(): Promise<void> {
    await this.closeButton.click();
  }

  async closeByBackgroundClick(): Promise<void> {
    // オーバーレイ背景をクリック（シート外）
    await this.overlay.click({ position: { x: 10, y: 10 } });
  }

  async openCsvMenu(): Promise<void> {
    await this.csvMenuButton.click();
  }

  async clickSaveImage(): Promise<void> {
    await this.saveImageButton.click();
  }

  async clickCsvDownload(): Promise<void> {
    await this.csvDownloadButton.click();
  }

  async clickCsvCopy(): Promise<void> {
    await this.csvCopyButton.click();
  }

  // === サマリーカード値の取得 ===
  getStatCard(label: string): Locator {
    return this.statCards.filter({ hasText: label });
  }

  async getStatCardValue(label: string): Promise<string> {
    const card = this.getStatCard(label);
    const valueEl = card.locator('.statCard__value');
    const text = await valueEl.textContent();
    return text?.trim() ?? '';
  }

  // === リスト行の取得 ===
  getListRow(index: number): Locator {
    return this.listRows.nth(index);
  }

  getListRowByName(name: string): Locator {
    return this.listRows.filter({ hasText: name });
  }

  async getListRowValues(row: Locator): Promise<{
    name: string;
    srcLevel: string;
    dstLevel: string;
    boostCandy: string;
    normalCandy: string;
    totalCandy: string;
    shards: string;
  }> {
    const cols = row.locator('.exportList__col');
    const name = await cols.nth(0).locator('.exportList__name').textContent() ?? '';
    const lvWrap = cols.nth(1).locator('.exportList__lvWrap');
    const lvVals = lvWrap.locator('.exportList__lvVal');
    const srcLevel = await lvVals.nth(0).textContent() ?? '';
    const dstLevel = await lvVals.nth(1).textContent() ?? '';

    // ブーストモードの場合は6列、通常モードは4列
    const colCount = await cols.count();
    let boostCandy = '';
    let normalCandy = '';
    let totalCandy = '';
    let shards = '';

    if (colCount >= 6) {
      // ブーストモード
      boostCandy = await cols.nth(2).locator('.exportList__num').textContent() ?? '';
      normalCandy = await cols.nth(3).locator('.exportList__num').textContent() ?? '';
      totalCandy = await cols.nth(4).locator('.exportList__num').textContent() ?? '';
      shards = await cols.nth(5).locator('.exportList__num').textContent() ?? '';
    } else {
      // 通常モード
      totalCandy = await cols.nth(2).locator('.exportList__num').textContent() ?? '';
      shards = await cols.nth(3).locator('.exportList__num').textContent() ?? '';
    }

    return {
      name: name.trim(),
      srcLevel: srcLevel.trim(),
      dstLevel: dstLevel.trim(),
      boostCandy: boostCandy.trim(),
      normalCandy: normalCandy.trim(),
      totalCandy: totalCandy.trim(),
      shards: shards.trim(),
    };
  }

  async getTotalRowValues(): Promise<{
    boostCandy: string;
    normalCandy: string;
    totalCandy: string;
    shards: string;
  }> {
    const cols = this.totalRow.locator('.exportList__col');
    const colCount = await cols.count();
    let boostCandy = '';
    let normalCandy = '';
    let totalCandy = '';
    let shards = '';

    if (colCount >= 6) {
      // ブーストモード（6列: 空, 空, boost, normal, total, shards）
      boostCandy = await cols.nth(2).locator('.exportList__num').textContent() ?? '';
      normalCandy = await cols.nth(3).locator('.exportList__num').textContent() ?? '';
      totalCandy = await cols.nth(4).locator('.exportList__num').textContent() ?? '';
      shards = await cols.nth(5).locator('.exportList__num').textContent() ?? '';
    } else {
      // 通常モード
      totalCandy = await cols.nth(2).locator('.exportList__num').textContent() ?? '';
      shards = await cols.nth(3).locator('.exportList__num').textContent() ?? '';
    }

    return {
      boostCandy: boostCandy.trim(),
      normalCandy: normalCandy.trim(),
      totalCandy: totalCandy.trim(),
      shards: shards.trim(),
    };
  }

  // === ランキング値の取得 ===
  async getRankingTotalText(): Promise<string> {
    const text = await this.rankingTotal.textContent();
    return text?.trim() ?? '';
  }

  getRankingItem(index: number): Locator {
    return this.rankingItems.nth(index);
  }

  getRankingItemByName(name: string): Locator {
    return this.rankingItems.filter({ hasText: name });
  }

  async getRankingItemValues(item: Locator): Promise<{
    name: string;
    pct: string;
    items: string;
  }> {
    const name = await item.locator('.exportPie__legendName').textContent() ?? '';
    const pct = await item.locator('.exportPie__legendPct').textContent() ?? '';
    const items = await item.locator('.exportPie__legendDetail').textContent() ?? '';
    return {
      name: name.trim(),
      pct: pct.trim(),
      items: items.trim(),
    };
  }

  // === プログレスバー検証 ===
  async expectBoostBarVisible(): Promise<void> {
    await expect(this.boostBar).toBeVisible();
  }

  async expectShardsBarVisible(): Promise<void> {
    await expect(this.shardsBar).toBeVisible();
  }
}
