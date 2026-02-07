/**
 * 02-box-operations.spec.ts
 * BOX操作のE2Eテスト
 *
 * 前提: インポートでポケモンを追加した状態でテストを実行
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BoxPanelPage } from './pages/BoxPanelPage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// テスト設定を読み込み
const testConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/test-config.json'), 'utf-8')
);

const latestPokemonName: string = testConfig.latestPokemon.name;
const importData = testConfig.importData;

function getSearchPrefix(name: string): string {
  return name.slice(0, 2);
}

// ============================================
// 検索・フィルタ
// ============================================

test.describe('検索・フィルタ', () => {
  let boxPanel: BoxPanelPage;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    boxPanel = new BoxPanelPage(page);

    // テストデータをインポート
    await boxPanel.openImportPanel();
    await boxPanel.fillImportText(importData.importText);
    await boxPanel.clickImport();
  });

  test('検索に最新ポケモンを入力してクリアできる', async () => {
    const searchPrefix = getSearchPrefix(latestPokemonName);

    // 検索入力
    await boxPanel.fillSearch(searchPrefix);
    await expect(boxPanel.searchInput).toHaveValue(searchPrefix);

    // クリアボタンで検索をクリア
    await boxPanel.clickSearchClear();
    await expect(boxPanel.searchInput).toHaveValue('');
  });

  test('とくいフィルタ: お気に入りボタンが動作する', async () => {
    await expect(boxPanel.favoriteFilterButton).toBeVisible();
    await boxPanel.toggleFavoriteFilter();

    // トグル状態が変わる（chipBtn--on クラス）
    await expect(boxPanel.favoriteFilterButton).toHaveClass(/chipBtn--on/);

    // 再度クリックでオフ
    await boxPanel.toggleFavoriteFilter();
    await expect(boxPanel.favoriteFilterButton).not.toHaveClass(/chipBtn--on/);
  });

  test('とくいフィルタ: きのみ、食材、スキル、オールが動作する', async () => {
    // きのみ
    await boxPanel.toggleBerryFilter();
    await expect(boxPanel.berryFilterButton).toHaveClass(/chipBtn--on/);
    await boxPanel.toggleBerryFilter();

    // 食材
    await boxPanel.toggleIngredientFilter();
    await expect(boxPanel.ingredientFilterButton).toHaveClass(/chipBtn--on/);
    await boxPanel.toggleIngredientFilter();

    // スキル
    await boxPanel.toggleSkillFilter();
    await expect(boxPanel.skillFilterButton).toHaveClass(/chipBtn--on/);
    await boxPanel.toggleSkillFilter();

    // オール
    await boxPanel.toggleAllFilter();
    await expect(boxPanel.allFilterButton).toHaveClass(/chipBtn--on/);
    await boxPanel.toggleAllFilter();
  });

  test('フィルタリング設定の開閉が動作する', async () => {
    // boxAdvancedパネルの開閉を確認
    // 最初に閉じた状態にする
    if (await boxPanel.advancedSettingsPanel.getAttribute('open') !== null) {
      await boxPanel.closeAdvancedSettings();
    }

    // 閉じている状態を確認
    await expect(boxPanel.advancedSettingsPanel).not.toHaveAttribute('open', '');

    // 開く
    await boxPanel.openAdvancedSettings();

    // 閉じる
    await boxPanel.closeAdvancedSettings();
  });

  test('フィルタ間の結合AND/ORが切り替えられる', async () => {
    await boxPanel.openAdvancedSettings();

    await expect(boxPanel.filterJoinSelect).toBeVisible();

    // AND → OR
    await boxPanel.filterJoinSelect.selectOption('or');
    await expect(boxPanel.filterJoinSelect).toHaveValue('or');

    // OR → AND
    await boxPanel.filterJoinSelect.selectOption('and');
    await expect(boxPanel.filterJoinSelect).toHaveValue('and');
  });

  test('サブスキルフィルタAND/ORが切り替えられる', async () => {
    await boxPanel.openAdvancedSettings();

    await expect(boxPanel.subSkillJoinSelect).toBeVisible();

    // デフォルトはAND
    await expect(boxPanel.subSkillJoinSelect).toHaveValue('and');

    // AND → OR
    await boxPanel.subSkillJoinSelect.selectOption('or');
    await expect(boxPanel.subSkillJoinSelect).toHaveValue('or');
  });
});

// ============================================
// BOX詳細パネル
// ============================================

test.describe('BOX詳細パネル', () => {
  let boxPanel: BoxPanelPage;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    boxPanel = new BoxPanelPage(page);

    // テストデータをインポート
    await boxPanel.openImportPanel();
    await boxPanel.fillImportText(importData.importText);
    await boxPanel.clickImport();
  });

  test('ポケモンタイルをクリックすると詳細パネルが開く', async () => {
    // 詳細パネルは初期状態で非表示
    await boxPanel.expectDetailPanelHidden();

    // タイルをクリック
    await boxPanel.selectBoxTile(0);

    // 詳細パネルが表示される
    await boxPanel.expectDetailPanelVisible();
  });

  test('計算するボタンが存在する', async () => {
    await boxPanel.selectBoxTile(0);
    await expect(boxPanel.applyToCalcButton).toBeVisible();
  });

  test('ボックスから削除ボタンが動作する', async () => {
    const initialCount = await boxPanel.boxTiles.count();

    await boxPanel.selectBoxTile(0);
    await boxPanel.clickDeleteFromBox();

    // 1匹減っている
    await boxPanel.expectBoxTileCount(initialCount - 1);
  });

  test('元に戻す・やり直すが動作する', async () => {
    const initialCount = await boxPanel.boxTiles.count();

    // 削除
    await boxPanel.selectBoxTile(0);
    await boxPanel.clickDeleteFromBox();
    await boxPanel.expectBoxTileCount(initialCount - 1);

    // 元に戻す（Undoボタンが有効になるまで少し待つ）
    await expect(boxPanel.undoButton).toBeEnabled();
    await boxPanel.clickUndo();
    await boxPanel.expectBoxTileCount(initialCount);

    // やり直す
    await expect(boxPanel.redoButton).toBeEnabled();
    await boxPanel.clickRedo();
    await boxPanel.expectBoxTileCount(initialCount - 1);
  });

  test('ボックス全消去が動作する', async ({ page }) => {
    // confirmダイアログをAcceptする設定
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await expect(boxPanel.clearAllBoxButton).toBeEnabled();
    await boxPanel.clickClearAllBox();

    // 全て消える
    await boxPanel.expectBoxTileCount(0);
  });

  test('ニックネームが編集できる', async () => {
    await boxPanel.selectBoxTile(0);

    await expect(boxPanel.detailNicknameInput).toBeVisible();
    await boxPanel.fillNickname('テストニックネーム');

    // 値が設定されていることを確認
    await expect(boxPanel.detailNicknameInput).toHaveValue('テストニックネーム');
  });

  test('お気に入りボタンが動作する', async () => {
    await boxPanel.selectBoxTile(0);

    await expect(boxPanel.detailFavoriteButton).toBeVisible();
    await boxPanel.toggleDetailFavorite();

    // トグル状態が変わる
    await expect(boxPanel.detailFavoriteButton).toHaveClass(/chipBtn--on/);
  });

  test('アメ在庫が編集できる', async () => {
    await boxPanel.selectBoxTile(0);

    await expect(boxPanel.detailCandyInput).toBeVisible();
    await boxPanel.fillCandyStock(100);

    await expect(boxPanel.detailCandyInput).toHaveValue('100');
  });

  test('レベルピッカーが使用できる', async () => {
    await boxPanel.selectBoxTile(0);

    await expect(boxPanel.detailLevelTrigger).toBeVisible();
    await boxPanel.openDetailLevelPicker();

    // ポップオーバーが開く
    await expect(boxPanel.levelPopover).toBeVisible();
  });

  test('あとEXPが編集できる', async () => {
    await boxPanel.selectBoxTile(0);

    await expect(boxPanel.detailExpRemainingInput).toBeVisible();
    await boxPanel.fillExpRemaining(5000);

    await expect(boxPanel.detailExpRemainingInput).toHaveValue('5000');
  });

  test('EXP性格補正が編集できる', async () => {
    await boxPanel.selectBoxTile(0);

    await expect(boxPanel.detailNatureTrigger).toBeVisible();
    await boxPanel.detailNatureTrigger.click();

    // ドロップダウンが開く
    await expect(boxPanel.natureDropdown).toBeVisible();
  });

  test('とくいとEXPタイプはグレーアウトで操作できない（リンク済み）', async () => {
    await boxPanel.selectBoxTile(0);

    // リンク済みの場合、静的表示になる
    await expect(boxPanel.detailSpecialtyDisplay).toBeVisible();
    await expect(boxPanel.detailExpTypeDisplay).toBeVisible();
  });

  test('食材タイプが操作できる', async () => {
    await boxPanel.selectBoxTile(0);

    await expect(boxPanel.detailIngredientSelect).toBeVisible();

    const initialValue = await boxPanel.detailIngredientSelect.inputValue();
    await boxPanel.detailIngredientSelect.selectOption({ index: 1 });
    const newValue = await boxPanel.detailIngredientSelect.inputValue();

    expect(newValue).not.toBe(initialValue);
  });

  test('サブスキルが操作できる', async () => {
    await boxPanel.selectBoxTile(0);

    await expect(boxPanel.detailSubSkillSelects.first()).toBeVisible();

    const lv10Select = boxPanel.detailSubSkillSelects.first();
    await lv10Select.selectOption({ index: 1 });

    const selectedValue = await lv10Select.inputValue();
    expect(selectedValue).not.toBe('');
  });
});

// ============================================
// 再リンク
// ============================================

test.describe('再リンク', () => {
  let boxPanel: BoxPanelPage;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    boxPanel = new BoxPanelPage(page);

    // テストデータをインポート
    await boxPanel.openImportPanel();
    await boxPanel.fillImportText(importData.importText);
    await boxPanel.clickImport();
  });

  test('再リンク入力でサジェストが表示される', async () => {
    await boxPanel.selectBoxTile(0);

    const searchPrefix = getSearchPrefix(latestPokemonName);
    await boxPanel.fillRelinkName(searchPrefix);

    // サジェストパネルが表示される
    await expect(boxPanel.detailRelinkSuggestPanel).toBeVisible();
  });

  test('再リンクボタンが存在する', async () => {
    await boxPanel.selectBoxTile(0);

    await expect(boxPanel.detailRelinkButton).toBeVisible();
  });
});
