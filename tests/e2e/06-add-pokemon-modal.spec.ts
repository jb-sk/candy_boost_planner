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

  test('レベルピッカーのタイトルに現在選択中のLvが表示される', async () => {
    await modal.srcLevelTrigger.click();
    await expect(modal.modal.locator('.levelPick__title')).toHaveText('現在Lv Lv1');
    await modal.modal.getByTestId('level-picker-popover').getByRole('button', { name: '閉じる' }).click();

    await modal.dstLevelTrigger.click();
    await expect(modal.modal.locator('.levelPick__title')).toHaveText('目標Lv Lv60');
  });

  test('レベルピッカーの左右ボタン連打でLvを調節できる', async () => {
    await modal.srcLevelTrigger.click();
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
