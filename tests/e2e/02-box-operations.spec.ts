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
import { SettingsModalPage } from './pages/SettingsModalPage';

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

  test('タイル右端のお気に入り操作は詳細を開かず、キーボードでも切り替えられる', async ({ page }) => {
    const tile = boxPanel.boxTiles.first();
    const favoriteZone = page.getByTestId('box-tile-fav-zone').first();
    const before = await favoriteZone.getAttribute('aria-pressed');

    // 選択ボタンの中に別の操作要素を入れない（nested interactive contentの防止）。
    await expect(tile.locator('button, [role="button"]')).toHaveCount(0);
    await favoriteZone.focus();
    await favoriteZone.press('Space');

    await expect(favoriteZone).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    await expect(boxPanel.detailPanel).toHaveCount(0);
    await tile.click();
    await expect(boxPanel.detailPanel).toBeVisible();
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

  test('計算中フィルタ: 表示中の計算スロットに登録した個体だけを表示する', async () => {
    const initialCount = await boxPanel.boxTiles.count();
    expect(initialCount).toBeGreaterThan(1);

    await boxPanel.selectBoxTile(0);
    await boxPanel.clickApplyToCalc();
    await boxPanel.toggleCalculatingFilter();

    await expect(boxPanel.calculatingFilterButton).toHaveClass(/chipBtn--on/);
    await boxPanel.expectBoxTileCount(1);

    await boxPanel.toggleCalculatingFilter();
    await boxPanel.expectBoxTileCount(initialCount);
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

    // 見た目のクラス名ではなく、操作状態としてお気に入りになったことを確認する。
    await expect(boxPanel.detailFavoriteButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('狭い画面でもタイルのアイコンを右寄せし、長い名前を省略する', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await boxPanel.selectBoxTile(0);
    await boxPanel.fillNickname('とても長いポケモンのニックネームがタイルの外へ飛び出さないことを確認');
    await boxPanel.toggleDetailFavorite();
    await boxPanel.clickApplyToCalc();

    const tile = page.locator('.boxTile--active').getByTestId('box-tile');
    const icons = tile.locator('.boxTile__iconRow');
    await expect(icons.locator('.boxTile__calcMark')).toBeVisible();
    await expect(icons.locator('.boxTile__fav')).toBeVisible();

    const layout = await tile.evaluate((element) => {
      const nameElement = element.querySelector<HTMLElement>('.boxTile__name')!;
      const iconElement = element.querySelector<HTMLElement>('.boxTile__iconRow')!;
      const tileRect = element.getBoundingClientRect();
      const nameRect = nameElement.getBoundingClientRect();
      const iconRect = iconElement.getBoundingClientRect();
      const nameStyle = getComputedStyle(nameElement);
      return {
        tileRight: tileRect.right,
        nameRight: nameRect.right,
        iconRight: iconRect.right,
        nameClientWidth: nameElement.clientWidth,
        nameScrollWidth: nameElement.scrollWidth,
        overflow: nameStyle.overflow,
        textOverflow: nameStyle.textOverflow,
        whiteSpace: nameStyle.whiteSpace,
      };
    });

    expect(layout.tileRight - layout.iconRight).toBeGreaterThanOrEqual(11);
    expect(layout.tileRight - layout.iconRight).toBeLessThanOrEqual(13);
    expect(layout.nameRight).toBeLessThanOrEqual(layout.tileRight - 11);
    expect(layout.nameScrollWidth).toBeGreaterThan(layout.nameClientWidth);
    expect(layout).toMatchObject({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
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
    // 上限は「次Lvまでの必要EXP」でポケモンのLvごとに変わる。
    // 50 は最小の Lv1→2（54EXP）にも収まるので、どのタイルを選んでもクランプされない。
    await boxPanel.fillExpRemaining(50);

    await expect(boxPanel.detailExpRemainingInput).toHaveValue('50');
  });

  test('あとEXPは次Lvまでの必要EXPでクランプされる', async () => {
    await boxPanel.selectBoxTile(0);

    await boxPanel.fillExpRemaining(999999);

    // 上限そのものはLv依存なので、丸められたこと（0 より大きく入力値より小さい）を見る
    const clamped = Number(await boxPanel.detailExpRemainingInput.inputValue());
    expect(clamped).toBeGreaterThan(0);
    expect(clamped).toBeLessThan(999999);
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

  test('睡眠計算ヒントの設定値リンクから設定を開ける', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await boxPanel.selectBoxTile(0);

    await page.getByTestId('box-detail-sleep-calc-toggle').click();
    await page.getByTestId('box-sleep-daily-hint').click();
    await expect(page.locator('.hintPopover')).toContainText('13時間まで設定できます');
    const hintSettings = page.getByTestId('box-sleep-hint-settings');
    await expect(hintSettings).toHaveCSS('box-shadow', 'none');
    await hintSettings.click();

    await settings.expectModalVisible();
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
