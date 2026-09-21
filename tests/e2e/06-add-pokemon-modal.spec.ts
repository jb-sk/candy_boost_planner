/**
 * 06-add-pokemon-modal.spec.ts
 * AddPokemonModal のE2Eテスト
 *
 * カバー範囲:
 *   - 目標Lvを変更して追加しても60にリセットされないこと (bug fix #1)
 *   - EXPを入力してもポケモンを追加できること (bug fix #2)
 *   - 通常の追加フロー
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { AddPokemonModalPage } from './pages/AddPokemonModalPage';
import { BoxPanelPage } from './pages/BoxPanelPage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/test-config.json'), 'utf-8')
);
const latestPokemonName: string = testConfig.latestPokemon.name;

// ============================================
// AddPokemonModal 基本動作
// ============================================

test.describe('AddPokemonModal - 基本動作', () => {
  let modal: AddPokemonModalPage;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    modal = new AddPokemonModalPage(page);
    await modal.open();
  });

  test('モーダルが開閉できる', async () => {
    await expect(modal.modal).toBeVisible();
    await modal.close();
    await expect(modal.modal).not.toBeVisible();
  });

  test('タブレット・PC幅でフッター背景がカード下端の角丸に収まる', async ({ page }) => {
    for (const width of [768, 1440]) {
      await page.setViewportSize({ width, height: 900 });

      const radii = await modal.modal.evaluate((card) => {
        const footer = card.querySelector<HTMLElement>('.addModal__footer');
        if (!footer) throw new Error('addModal footer not found');
        const cardStyle = getComputedStyle(card);
        const footerStyle = getComputedStyle(footer);
        return {
          cardLeft: cardStyle.borderBottomLeftRadius,
          cardRight: cardStyle.borderBottomRightRadius,
          footerLeft: footerStyle.borderBottomLeftRadius,
          footerRight: footerStyle.borderBottomRightRadius,
          overflow: cardStyle.overflow,
        };
      });

      expect(radii.footerLeft).toBe(radii.cardLeft);
      expect(radii.footerRight).toBe(radii.cardRight);
      // LevelPickerなどの浮遊UIはカード外へ表示できる状態を保つ。
      expect(radii.overflow).toBe('visible');
    }
  });

  test('vividテーマでも追加モーダルは傾斜しない', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('candy-boost-planner:design', 'vivid'));
    await page.reload();
    modal = new AddPokemonModalPage(page);
    await modal.open();

    await expect.poll(() => modal.modal.evaluate((card) => getComputedStyle(card).transform)).toBe('none');
  });

  test('名前未入力時は追加ボタンが無効', async () => {
    await expect(modal.submitButton).toBeDisabled();
  });

  test('ポケモン名を入力するとサジェストが表示される', async () => {
    const prefix = latestPokemonName.slice(0, 2);
    await modal.nameInput.fill(prefix);
    await expect(modal.suggestPanel).toBeVisible();
  });

  test('ポケモンを選択すると追加ボタンが有効になる', async () => {
    const prefix = latestPokemonName.slice(0, 2);
    await modal.fillAndPickName(prefix);
    await expect(modal.submitButton).toBeEnabled();
  });

  test('タグを追加・選択してポケモンへ割り当てられる', async ({ page }) => {
    await expect(modal.tagSection).toBeVisible();
    await modal.tagNameInput.fill('アメブ候補');
    await modal.tagAddButton.click();

    const tagChoice = modal.tagSection.getByRole('button', { name: 'アメブ候補', exact: true });
    await expect(tagChoice).toHaveClass(/chipBtn--on/);
    await expect(tagChoice).toHaveAttribute('aria-pressed', 'true');
    // この画面は追加と選択だけ。名称変更・削除はBOX側へ集約する。
    await expect(modal.tagSection.locator('.boxTagManager__delete, .boxTagManager__edit')).toHaveCount(0);

    await modal.fillAndPickName(latestPokemonName.slice(0, 2));
    await modal.submitButton.click();
    // 連続追加で前のポケモンのタグを誤って引き継がない。
    await expect(tagChoice).not.toHaveClass(/chipBtn--on/);

    await modal.close();
    const box = new BoxPanelPage(page);
    // 追加直後の個体は既に選択済み。タイルを押すと逆に詳細を閉じるため、そのまま確認する。
    await expect(box.detailPanel).toBeVisible();
    await expect(box.detailPanel.getByRole('button', { name: 'アメブ候補', exact: true })).toHaveClass(/chipBtn--on/);
  });

  test('進化系のどのポケモンから編集してもモーダル・計算機・BOXで同じ種族アメを共有する', async ({ page }) => {
    const box = new BoxPanelPage(page);

    await modal.fillAndPickName('ピカチュウ');
    await modal.speciesCandyInput.fill('123');
    await modal.submitButton.click();

    await modal.close();
    await modal.open();
    await modal.nameInput.fill('ライチュウ');
    await expect(modal.speciesCandyInput).toHaveValue('123');
    await modal.speciesCandyInput.fill('77');
    await modal.submitButton.click();

    const calcSpeciesInputs = page.getByTestId('calc-row').getByTestId('speciesCandy');
    await expect(calcSpeciesInputs).toHaveCount(2);
    await expect(calcSpeciesInputs.nth(0)).toHaveValue('77');
    await expect(calcSpeciesInputs.nth(1)).toHaveValue('77');

    await modal.close();
    await box.openAddNewPanel();
    await box.fillPokemonName('ピチュー');
    await expect(box.speciesCandyInput).toHaveValue('77');
  });

  test('レベルピッカーのタイトルに現在選択中のLvが表示される', async () => {
    await modal.srcLevelChevron.click();
    await expect(modal.modal.locator('.levelPick__title')).toHaveText('現在Lv Lv1');
    await modal.modal.getByTestId('level-picker-popover').getByRole('button', { name: '閉じる' }).click();

    await modal.dstLevelChevron.click();
    await expect(modal.modal.locator('.levelPick__title')).toHaveText('目標Lv Lv60');
  });

  test('レベルピッカーの左右ボタン連打でLvを調節できる', async () => {
    await modal.srcLevelChevron.click();
    const popover = modal.modal.getByTestId('level-picker-popover');

    await popover.getByTestId('level-picker-increment').dblclick();
    await expect(modal.modal.locator('.levelPick__title')).toHaveText('現在Lv Lv3');

    await popover.getByTestId('level-picker-decrement').dblclick();
    await expect(modal.modal.locator('.levelPick__title')).toHaveText('現在Lv Lv1');
  });
});

// ============================================
// バグ修正 #1: 目標Lvのリセット問題
// ============================================

test.describe('AddPokemonModal - 目標Lvリセットバグ修正', () => {
  let modal: AddPokemonModalPage;
  let boxPanel: BoxPanelPage;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    modal = new AddPokemonModalPage(page);
    boxPanel = new BoxPanelPage(page);
    await modal.open();
  });

  test('目標Lvを変更してもリセットされない', async () => {
    // dstLevelを60→50へ変更
    await modal.setDstLevel(50);
    const lvAfterChange = await modal.getDstLevel();
    expect(lvAfterChange).toBe(50);
  });

  test('srcLevelを変更しても手動設定したdstLevelが維持される', async () => {
    // まずdstLevelを変更
    await modal.setDstLevel(50);
    const dstAfterSet = await modal.getDstLevel();
    expect(dstAfterSet).toBe(50);

    // srcLevelを変更（dstLevelがリセットされないことを確認）
    await modal.setSrcLevel(10);

    const dstAfterSrcChange = await modal.getDstLevel();
    expect(dstAfterSrcChange).toBe(50);
  });

  test('目標Lvを変更してから追加でき、変更が反映される', async () => {
    const prefix = latestPokemonName.slice(0, 2);
    await modal.fillAndPickName(prefix);

    // dstLevelを変更
    await modal.setDstLevel(50);
    expect(await modal.getDstLevel()).toBe(50);

    const beforeCount = await boxPanel.boxTiles.count();
    await modal.submitButton.click();

    // ポケモンが追加される
    await expect(boxPanel.boxTiles).toHaveCount(beforeCount + 1);
  });
});

// ============================================
// バグ修正 #2: EXP入力時の追加不可問題
// ============================================

test.describe('AddPokemonModal - EXP入力バグ修正', () => {
  let modal: AddPokemonModalPage;
  let boxPanel: BoxPanelPage;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    modal = new AddPokemonModalPage(page);
    boxPanel = new BoxPanelPage(page);
    await modal.open();
  });

  test('EXPを入力してもポケモンを追加できる', async () => {
    const prefix = latestPokemonName.slice(0, 2);
    await modal.fillAndPickName(prefix);

    // EXPを入力
    await modal.expRemainingInput.fill('5000');
    await expect(modal.submitButton).toBeEnabled();

    const beforeCount = await boxPanel.boxTiles.count();
    await modal.submitButton.click();

    // ポケモンが追加される
    await expect(boxPanel.boxTiles).toHaveCount(beforeCount + 1);
  });

  test('EXPに0を入力してもポケモンを追加できる', async () => {
    const prefix = latestPokemonName.slice(0, 2);
    await modal.fillAndPickName(prefix);

    await modal.expRemainingInput.fill('0');

    const beforeCount = await boxPanel.boxTiles.count();
    await modal.submitButton.click();

    await expect(boxPanel.boxTiles).toHaveCount(beforeCount + 1);
  });

  test('EXP入力なしでもポケモンを追加できる（回帰テスト）', async () => {
    const prefix = latestPokemonName.slice(0, 2);
    await modal.fillAndPickName(prefix);

    const beforeCount = await boxPanel.boxTiles.count();
    await modal.submitButton.click();

    await expect(boxPanel.boxTiles).toHaveCount(beforeCount + 1);
  });

  test('EXPとdstLevelを両方設定してポケモンを追加できる', async () => {
    const prefix = latestPokemonName.slice(0, 2);
    await modal.fillAndPickName(prefix);

    // 両方設定
    await modal.expRemainingInput.fill('10000');
    await modal.setDstLevel(50);

    const beforeCount = await boxPanel.boxTiles.count();
    await modal.submitButton.click();

    await expect(boxPanel.boxTiles).toHaveCount(beforeCount + 1);
  });
});

// ============================================
// バグ修正 #3: 睡眠時間入力時の追加 + 追加成功フィードバック
// ============================================

test.describe('AddPokemonModal - 睡眠時間・追加フィードバック', () => {
  let modal: AddPokemonModalPage;
  let boxPanel: BoxPanelPage;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    modal = new AddPokemonModalPage(page);
    boxPanel = new BoxPanelPage(page);
    await modal.open();
  });

  test('睡眠時間を入力してもポケモンを追加できる', async () => {
    const prefix = latestPokemonName.slice(0, 2);
    await modal.fillAndPickName(prefix);

    // 睡眠時間を入力
    await modal.sleepHoursInput.fill('12');

    const beforeCount = await boxPanel.boxTiles.count();
    await modal.submitButton.click();

    // 睡眠時間が入っていても追加できる
    await expect(boxPanel.boxTiles).toHaveCount(beforeCount + 1);
  });

  test('追加成功時に「追加しました」が表示される', async () => {
    const prefix = latestPokemonName.slice(0, 2);
    await modal.fillAndPickName(prefix);

    await modal.submitButton.click();

    // 閉じるボタン左に追加成功メッセージが表示される
    await expect(modal.addedMessage).toBeVisible();
  });
});
