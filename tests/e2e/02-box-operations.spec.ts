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

  test('検索で選択中のポケモンが対象外になったら、解除後も詳細を再表示しない', async () => {
    await boxPanel.boxTiles.first().click();
    await expect(boxPanel.detailPanel).toBeVisible();

    await boxPanel.fillSearch('一致しない検索語');
    await expect(boxPanel.detailPanel).toHaveCount(0);

    await boxPanel.clickSearchClear();
    await expect(boxPanel.boxTiles.first()).toBeVisible();
    await expect(boxPanel.detailPanel).toHaveCount(0);
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

  test('Blueテーマでは選択中フィルターを濃い青と白文字で示す', async ({ page }) => {
    await page.locator('.design-switch-select').selectOption('blue');
    await boxPanel.toggleFavoriteFilter();

    await expect(boxPanel.favoriteFilterButton).toHaveClass(/chipBtn--on/);
    await expect(boxPanel.favoriteFilterButton).toHaveCSS('background-color', 'rgb(0, 110, 170)');
    await expect(boxPanel.favoriteFilterButton).toHaveCSS('border-color', 'rgb(0, 110, 170)');
    await expect(boxPanel.favoriteFilterButton).toHaveCSS('color', 'rgb(255, 255, 255)');
  });

  test('タイル右上のお気に入り操作は詳細を開かず、右下は通常選択になる', async ({ page }) => {
    const tile = boxPanel.boxTiles.first();
    const favoriteZone = page.getByTestId('box-tile-fav-zone').first();
    const before = await favoriteZone.getAttribute('aria-pressed');

    // 選択ボタンの中に別の操作要素を入れない（nested interactive contentの防止）。
    await expect(tile.locator('button, [role="button"]')).toHaveCount(0);
    const [tileBox, zoneBox] = await Promise.all([tile.boundingBox(), favoriteZone.boundingBox()]);
    expect(tileBox).not.toBeNull();
    expect(zoneBox).not.toBeNull();
    expect(zoneBox!.x + zoneBox!.width).toBeCloseTo(tileBox!.x + tileBox!.width, 0);
    expect(zoneBox!.y).toBeCloseTo(tileBox!.y, 0);
    expect(zoneBox!.width).toBeCloseTo(tileBox!.width * 0.2 - 4, 0);
    expect(zoneBox!.height).toBeLessThanOrEqual(28);

    // 右下はお気に入り領域ではなく、通常どおり詳細を開く。
    await tile.click({ position: { x: tileBox!.width - 5, y: tileBox!.height - 5 } });
    await expect(boxPanel.detailPanel).toBeVisible();
    await expect(favoriteZone).toHaveAttribute('aria-pressed', before ?? 'false');
    await tile.click();
    await expect(boxPanel.detailPanel).toHaveCount(0);

    // 右上はクリックでもキーボードでもお気に入りだけを切り替える。
    await favoriteZone.click();
    await expect(favoriteZone).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    await expect(boxPanel.detailPanel).toHaveCount(0);
    await favoriteZone.focus();
    await favoriteZone.press('Space');
    await expect(favoriteZone).toHaveAttribute('aria-pressed', before ?? 'false');
    await expect(boxPanel.detailPanel).toHaveCount(0);
  });

  test('タイル長押しで計算機への追加と削除を切り替え、通常クリックを発火しない', async ({ page }) => {
    const tile = boxPanel.boxTiles.first();
    const tileBox = await tile.boundingBox();
    expect(tileBox).not.toBeNull();
    const point = {
      clientX: tileBox!.x + tileBox!.width / 2,
      clientY: tileBox!.y + tileBox!.height / 2,
    };

    // スクロール相当の移動は長押しとして扱わない。
    await tile.dispatchEvent('pointerdown', { pointerId: 6, pointerType: 'touch', isPrimary: true, button: 0, ...point });
    await tile.dispatchEvent('pointermove', { pointerId: 6, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.clientX, clientY: point.clientY + 20 });
    await page.waitForTimeout(350);
    await tile.dispatchEvent('pointerup', { pointerId: 6, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.clientX, clientY: point.clientY + 20 });
    await expect(tile.locator('.boxTile__calcMark')).toHaveCount(0);

    // タッチ長押しで追加。
    await tile.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, ...point });
    await expect(tile.locator('..')).toHaveClass(/boxTile--pressing/);
    await page.waitForTimeout(350);
    await tile.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, ...point });
    await expect(tile.locator('.boxTile__calcMark')).toBeVisible();
    // iOSがpointerup後に遅延合成するclickでも詳細を開かない。
    await page.waitForTimeout(100);
    await tile.dispatchEvent('click');
    await expect(boxPanel.detailPanel).toHaveCount(0);

    // マウス長押しで削除。pointerup後のclickは詳細選択へ流さない。
    await tile.hover();
    await page.mouse.down();
    await expect(tile.locator('..')).not.toHaveClass(/boxTile--pressing/);
    await page.waitForTimeout(350);
    const calcFollowingInlineStyle = await page.getByTestId('calc-following').evaluate((element) => ({
      transform: element.style.transform,
      transition: element.style.transition,
    }));
    expect(calcFollowingInlineStyle).toEqual({ transform: '', transition: '' });
    await page.mouse.up();
    await expect(tile.locator('.boxTile__calcMark')).toHaveCount(0);
    await expect(boxPanel.detailPanel).toHaveCount(0);

    // 長押し完了後も、次の通常クリックは従来どおり詳細を開く。
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

  test('カスタムタグを管理・付与・絞り込みし、削除をUndoで復元できる', async ({ page }) => {
    await page.locator('.design-switch-select').selectOption('blue');
    const initialCount = await boxPanel.boxTiles.count();
    const filters = page.getByTestId('box-custom-tag-filters');
    await page.getByTestId('box-tag-manager-toggle').click();
    const manager = page.getByTestId('box-tag-manager');

    await page.getByTestId('box-tag-name-input').fill('アメブ候補');
    await page.getByTestId('box-tag-add').click();
    await expect(filters.getByRole('button', { name: 'アメブ候補', exact: true })).toBeVisible();

    await page.getByTestId('box-tag-name-input').fill('睡眠候補');
    await page.getByTestId('box-tag-add').click();
    await expect(manager.locator('.boxTagManager__usage')).toHaveText(['0匹', '0匹']);
    await expect(manager.locator('.boxTagManager__usage').first()).toHaveCSS('margin-right', '6px');
    await manager.locator('.boxTagManager__name').filter({ hasText: '睡眠候補' }).click();
    const renameInput = manager.locator('.boxTagManager__edit input');
    // 1回のタップで入力できる（入力欄にフォーカスが移っている）
    await expect(renameInput).toBeFocused();
    await renameInput.fill('睡眠で上げる');
    await manager.locator('.boxTagManager__edit').getByRole('button', { name: '保存' }).click();
    await expect(filters.getByRole('button', { name: '睡眠で上げる', exact: true })).toBeVisible();

    const [newNameBox, addButtonBox, existingNameBox, deleteButtonBox] = await Promise.all([
      page.getByTestId('box-tag-name-input').boundingBox(),
      page.getByTestId('box-tag-add').boundingBox(),
      manager.locator('.boxTagManager__name').first().boundingBox(),
      manager.locator('.boxTagManager__delete').first().boundingBox(),
    ]);
    expect(newNameBox).not.toBeNull();
    expect(addButtonBox).not.toBeNull();
    expect(existingNameBox).not.toBeNull();
    expect(deleteButtonBox).not.toBeNull();
    expect(existingNameBox!.width).toBeCloseTo(newNameBox!.width, 0);
    expect(deleteButtonBox!.x).toBeCloseTo(addButtonBox!.x, 0);
    expect(addButtonBox!.height).toBeCloseTo(newNameBox!.height, 0);
    expect(deleteButtonBox!.height).toBeCloseTo(existingNameBox!.height, 0);
    await expect(page.getByTestId('box-tag-name-input')).toHaveCSS('box-shadow', 'none');
    await expect(manager.locator('.boxTagManager__name').first()).toHaveCSS('box-shadow', 'none');
    await expect(page.getByTestId('box-tag-add')).not.toHaveCSS('box-shadow', 'none');
    await expect(manager.locator('.boxTagManager__delete').first()).not.toHaveCSS('box-shadow', 'none');

    await boxPanel.selectBoxTile(0);
    const detailTag = boxPanel.detailPanel.getByRole('button', { name: 'アメブ候補', exact: true });
    await detailTag.click();
    await expect(detailTag).toHaveClass(/chipBtn--on/);

    await filters.getByRole('button', { name: 'アメブ候補', exact: true }).click();
    await expect(filters.getByRole('button', { name: 'アメブ候補', exact: true })).toHaveClass(/chipBtn--on/);
    await boxPanel.expectBoxTileCount(1);
    await filters.getByRole('button', { name: 'アメブ候補', exact: true }).click();
    await boxPanel.expectBoxTileCount(initialCount);

    const tagItem = manager.locator('.boxTagManager__item').filter({ hasText: 'アメブ候補' });
    await tagItem.locator('.boxTagManager__delete').click();
    await expect(tagItem.locator('.boxTagManager__confirm')).toContainText('1匹のポケモンがタグを使用中です。');
    await expect(tagItem.locator('.boxTagManager__confirm')).toContainText('元に戻すボタンで戻せます');
    await tagItem.locator('.boxTagManager__confirm').getByRole('button', { name: 'タグを削除' }).click();
    await expect(filters.getByRole('button', { name: 'アメブ候補', exact: true })).toHaveCount(0);
    await expect(boxPanel.undoButton).toBeFocused();

    await boxPanel.undoButton.click();
    await expect(filters.getByRole('button', { name: 'アメブ候補', exact: true })).toBeVisible();
    await expect(boxPanel.detailPanel.getByRole('button', { name: 'アメブ候補', exact: true })).toHaveClass(/chipBtn--on/);

    await page.setViewportSize({ width: 375, height: 667 });
    await page.getByTestId('mobile-nav-box').click();
    await expect(manager).toBeVisible();
    const widths = await manager.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
      documentClient: document.documentElement.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    expect(widths.documentScroll).toBeLessThanOrEqual(widths.documentClient);
  });

  test('タグ管理で取っ手をドラッグ・上下キーで並べ替えられ、Undoで戻せる', async ({ page }) => {
    const filters = page.getByTestId('box-custom-tag-filters');
    await page.getByTestId('box-tag-manager-toggle').click();
    const manager = page.getByTestId('box-tag-manager');
    for (const name of ['タグA', 'タグB', 'タグC']) {
      await page.getByTestId('box-tag-name-input').fill(name);
      await page.getByTestId('box-tag-add').click();
    }
    const names = manager.locator('.boxTagManager__nameText');
    await expect(names).toHaveText(['タグA', 'タグB', 'タグC']);

    // タグC の取っ手をタグA の上までドラッグする
    const handleC = manager.locator('.boxTagManager__item').filter({ hasText: 'タグC' }).locator('.boxTagManager__handle');
    const firstItem = await manager.locator('.boxTagManager__item').first().boundingBox();
    const itemB = await manager.locator('.boxTagManager__item').nth(1).boundingBox();
    const itemC = await manager.locator('.boxTagManager__item').nth(2).boundingBox();
    const handleBox = await handleC.boundingBox();
    const handleY = handleBox!.y + handleBox!.height / 2;
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleY);
    await page.mouse.down();
    // 行の中心が上の行に差し掛かっただけで入れ替わる（上の行の中心まで動かさなくてよい）
    const cToBBottom = itemC!.y + itemC!.height / 2 - (itemB!.y + itemB!.height);
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleY - cToBBottom - 2, { steps: 4 });
    await expect(names).toHaveText(['タグA', 'タグC', 'タグB']);
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, firstItem!.y + 2, { steps: 8 });
    // 離す前から、離したときの並びが見える
    await expect(names).toHaveText(['タグC', 'タグA', 'タグB']);
    await page.mouse.up();
    await expect(names).toHaveText(['タグC', 'タグA', 'タグB']);
    // 絞り込みのチップも同じ順になる
    await expect(filters.locator('.chipBtn__text')).toContainText(['タグC', 'タグA', 'タグB']);

    // 上下キーでも1つずつ動かせる。フォーカスは同じタグの取っ手に残る
    const handleA = manager.locator('.boxTagManager__item').filter({ hasText: 'タグA' }).locator('.boxTagManager__handle');
    await handleA.focus();
    await page.keyboard.press('ArrowDown');
    await expect(names).toHaveText(['タグC', 'タグB', 'タグA']);
    await expect(manager.locator('.boxTagManager__item').filter({ hasText: 'タグA' }).locator('.boxTagManager__handle')).toBeFocused();

    // Undo は1操作ずつ戻る
    await boxPanel.undoButton.click();
    await expect(names).toHaveText(['タグC', 'タグA', 'タグB']);
    await boxPanel.undoButton.click();
    await expect(names).toHaveText(['タグA', 'タグB', 'タグC']);
  });

  test('Pointer Events の無い端末でも、タグ管理の取っ手をタッチでドラッグして並べ替えられる', async ({ page }) => {
    await page.getByTestId('box-tag-manager-toggle').click();
    const manager = page.getByTestId('box-tag-manager');
    for (const name of ['タグA', 'タグB', 'タグC']) {
      await page.getByTestId('box-tag-name-input').fill(name);
      await page.getByTestId('box-tag-add').click();
    }
    const names = manager.locator('.boxTagManager__nameText');
    const handleC = manager.locator('.boxTagManager__item').filter({ hasText: 'タグC' }).locator('.boxTagManager__handle');
    const firstItemTop = (await manager.locator('.boxTagManager__item').first().boundingBox())!.y;

    // 古い iOS Safari（13 未満）と同じく PointerEvent が無い状態で、touch イベントだけを送る
    const dispatchTouch = (type: 'touchstart' | 'touchmove' | 'touchend', clientY?: number) =>
      handleC.evaluate((element, { type, clientY }) => {
        if (type === 'touchstart') Object.defineProperty(window, 'PointerEvent', { configurable: true, value: undefined });
        const rect = element.getBoundingClientRect();
        const touch = new Touch({
          identifier: 3,
          target: element,
          clientX: rect.left + rect.width / 2,
          clientY: clientY ?? rect.top + rect.height / 2,
        });
        const target = type === 'touchstart' ? element : document;
        target.dispatchEvent(new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch],
        }));
      }, { type, clientY });

    await dispatchTouch('touchstart');
    await dispatchTouch('touchmove', firstItemTop + 2);
    await expect(names).toHaveText(['タグC', 'タグA', 'タグB']);
    await dispatchTouch('touchend', firstItemTop + 2);
    await expect(names).toHaveText(['タグC', 'タグA', 'タグB']);
    await expect(manager.locator('.boxTagManager__item--dragging')).toHaveCount(0);
  });

  test('検索・フィルターで表示中の個体だけにタグを一括登録し、Undoできる', async ({ page }) => {
    const initialCount = await boxPanel.boxTiles.count();
    await page.getByTestId('box-tag-manager-toggle').click();
    await page.getByTestId('box-tag-name-input').fill('一括対象');
    await page.getByTestId('box-tag-add').click();
    const managerToggle = page.getByTestId('box-tag-manager-toggle');
    const bulkToggle = page.getByTestId('box-tag-bulk-toggle');
    await expect(managerToggle).toHaveClass(/boxCustomTagFilters__manage--open/);
    await expect(managerToggle).toHaveCSS('background-color', 'rgb(1, 87, 155)');
    await bulkToggle.click();
    await expect(bulkToggle).toHaveClass(/boxCustomTagFilters__manage--open/);
    await expect(bulkToggle).toHaveCSS('background-color', 'rgb(1, 87, 155)');
    await expect(managerToggle).not.toHaveClass(/boxCustomTagFilters__manage--open/);

    const firstVisibleName = (await boxPanel.boxTiles.first().locator('.boxTile__name').innerText()).trim();
    await boxPanel.fillSearch(firstVisibleName);
    const targetCount = await boxPanel.boxTiles.count();
    expect(targetCount).toBeGreaterThan(0);
    expect(targetCount).toBeLessThan(initialCount);
    await expect(page.getByTestId('box-tag-bulk')).toContainText(`表示中の${targetCount}匹のポケモンへタグを一括登録`);
    await expect(page.getByTestId('box-tag-bulk-apply')).toHaveText('一括登録');
    await page.getByTestId('box-tag-bulk-apply').click();
    await expect(page.getByTestId('box-tag-bulk')).toContainText(`${targetCount}匹に登録しました。`);

    await boxPanel.clickSearchClear();
    const tagFilter = page.getByTestId('box-custom-tag-filters').getByRole('button', { name: '一括対象', exact: true });
    await tagFilter.click();
    await boxPanel.expectBoxTileCount(targetCount);

    await boxPanel.undoButton.click();
    await boxPanel.expectBoxTileCount(0);
    await tagFilter.click();
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

  test('タグの結合はORがデフォルトでANDへ切り替えられる', async () => {
    await boxPanel.openAdvancedSettings();

    await expect(boxPanel.tagJoinSelect).toBeVisible();
    await expect(boxPanel.tagJoinSelect).toHaveValue('or');
    await boxPanel.tagJoinSelect.selectOption('and');
    await expect(boxPanel.tagJoinSelect).toHaveValue('and');
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

  test('ボックスから削除すると計算機からも削除される', async ({ page }) => {
    const initialCount = await boxPanel.boxTiles.count();

    await boxPanel.selectBoxTile(0);
    await boxPanel.clickApplyToCalc();
    await expect(page.getByTestId('calc-row')).toHaveCount(1);
    await boxPanel.clickDeleteFromBox();
    await expect(boxPanel.deleteLinkedConfirm).toBeVisible();
    await expect(boxPanel.deleteLinkedConfirm).toContainText('計算機側は元に戻せません');
    await boxPanel.confirmLinkedDelete();

    // 1匹減っている
    await boxPanel.expectBoxTileCount(initialCount - 1);
    await expect(page.getByTestId('calc-row')).toHaveCount(0);
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

  test('ボックス全消去が動作し、ボックス由来の計算行も削除する', async ({ page }) => {
    // 確認は `window.confirm` ではなく、押した場所に出るインライン確認。
    // 「やめる」では何も起きない。
    const beforeCount = await boxPanel.boxTiles.count();
    await boxPanel.selectBoxTile(0);
    await boxPanel.clickApplyToCalc();
    await expect(page.getByTestId('calc-row')).toHaveCount(1);
    await expect(boxPanel.clearAllBoxButton).toBeEnabled();
    await boxPanel.clearAllBoxButton.click();
    await expect(boxPanel.clearConfirm).toBeVisible();
    await boxPanel.clearConfirmNoButton.click();
    await expect(boxPanel.clearConfirm).toBeHidden();
    await boxPanel.expectBoxTileCount(beforeCount);

    await boxPanel.clickClearAllBox();

    // 全て消える
    await boxPanel.expectBoxTileCount(0);
    await expect(page.getByTestId('calc-row')).toHaveCount(0);
  });

  test('全消去の確認は Escape で閉じ、フォーカスが元のボタンへ戻る', async ({ page }) => {
    const beforeCount = await boxPanel.boxTiles.count();
    await boxPanel.clearAllBoxButton.click();
    await expect(boxPanel.clearConfirm).toBeVisible();
    // 開いた直後は肯定ボタンへフォーカスが移っている。
    await expect(boxPanel.clearConfirmYesButton).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(boxPanel.clearConfirm).toBeHidden();
    await boxPanel.expectBoxTileCount(beforeCount);
    await expect(boxPanel.clearAllBoxButton).toBeFocused();

    // 確認の外へフォーカスを移してからでも Escape で閉じること。
    // 要素スコープの keydown だとここでイベントが確認まで届かない。
    await boxPanel.clearAllBoxButton.click();
    await expect(boxPanel.clearConfirm).toBeVisible();
    await boxPanel.searchInput.click();
    await expect(boxPanel.clearConfirmYesButton).not.toBeFocused();
    await page.keyboard.press('Escape');
    await expect(boxPanel.clearConfirm).toBeHidden();
    await boxPanel.expectBoxTileCount(beforeCount);
  });

  test('全消去は 元に戻す→やり直す→元に戻す を繰り返しても復元できる', async () => {
    const beforeCount = await boxPanel.boxTiles.count();
    expect(beforeCount).toBeGreaterThan(0);

    await boxPanel.clickClearAllBox();
    await boxPanel.expectBoxTileCount(0);

    await boxPanel.clickUndo();
    await boxPanel.expectBoxTileCount(beforeCount);

    await boxPanel.clickRedo();
    await boxPanel.expectBoxTileCount(0);

    // ここが壊れていた。逆操作の中身が空で積まれ、戻せなくなっていた。
    await boxPanel.clickUndo();
    await boxPanel.expectBoxTileCount(beforeCount);

    // もう一往復しても崩れないこと。
    await boxPanel.clickRedo();
    await boxPanel.expectBoxTileCount(0);
    await boxPanel.clickUndo();
    await boxPanel.expectBoxTileCount(beforeCount);
  });

  test('全消去後はフォーカスが「元に戻す」へ移る', async () => {
    await boxPanel.clickClearAllBox();
    await boxPanel.expectBoxTileCount(0);
    await expect(boxPanel.undoButton).toBeFocused();
  });

  test('確認表示中にボックスが空になっても、件数が戻ったとき確認が復活しない', async ({ page }) => {
    await boxPanel.clearAllBoxButton.click();
    await expect(boxPanel.clearConfirm).toBeVisible();

    // 確認を出したまま、隣の「元に戻す」でボックスを空にする。
    await boxPanel.undoButton.click();
    await boxPanel.expectBoxTileCount(0);
    await expect(boxPanel.clearConfirm).toBeHidden();

    // 件数を戻す。「やり直す」ではボックスが戻らない（別件の既存バグ）ので、
    // 確実に件数が増える再インポートで確かめる。
    await boxPanel.openImportPanel();
    await boxPanel.fillImportText(importData.importText);
    await boxPanel.clickImport();
    await expect(boxPanel.boxTiles.first()).toBeVisible();

    // 押していない確認が生えてこないこと。
    await expect(boxPanel.clearConfirm).toBeHidden();
    await expect(page.getByTestId('box-clear-confirm-yes')).toHaveCount(0);
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
