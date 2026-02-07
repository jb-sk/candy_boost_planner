/**
 * 01-onboarding.spec.ts
 * 新規追加・インポート機能のE2Eテスト
 *
 * POM（Page Object Model）採用
 * - セレクタは BoxPanelPage に集約
 * - デザイン変更時は Page Object のみ修正
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

// 最新ポケモン名（test-config.jsonで設定）
const latestPokemonName: string = testConfig.latestPokemon.name;

// インポートテスト用データ
const importData = testConfig.importData;

/**
 * 最新ポケモン名の頭文字を取得
 * 例: "ツボツボ" → "ツボ", "ハルクジラ" → "ハル"
 */
function getSearchPrefix(name: string): string {
  return name.slice(0, 2);
}

// ============================================
// 新規追加パネル
// ============================================

test.describe('新規追加パネル', () => {
  let boxPanel: BoxPanelPage;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    boxPanel = new BoxPanelPage(page);
  });

  test('開閉が正常に動作する', async () => {
    // 初期状態: 閉じている
    await expect(boxPanel.addNewPanel).not.toHaveAttribute('open', '');

    // 開く
    await boxPanel.addNewSummary.click();
    await expect(boxPanel.addNewPanel).toHaveAttribute('open', '');

    // 閉じる
    await boxPanel.addNewSummary.click();
    await expect(boxPanel.addNewPanel).not.toHaveAttribute('open', '');
  });

  test('ポケモン名のサジェストが表示される（ツボ→ツボツボ）', async () => {
    await boxPanel.openAddNewPanel();
    await boxPanel.fillPokemonName('ツボ');

    await boxPanel.expectSuggestVisible();
    await boxPanel.expectSuggestContains('ツボツボ');
  });

  test(`最新ポケモン「${latestPokemonName}」がサジェストされる`, async () => {
    await boxPanel.openAddNewPanel();

    const searchPrefix = getSearchPrefix(latestPokemonName);
    await boxPanel.fillPokemonName(searchPrefix);

    await boxPanel.expectSuggestVisible();
    await boxPanel.expectSuggestContains(latestPokemonName);
  });

  test('とくいとEXPタイプはポケモン名が入力されるとグレーアウト', async () => {
    await boxPanel.openAddNewPanel();

    // 初期状態: 操作可能
    await expect(boxPanel.specialtySelect).toBeEnabled();
    await expect(boxPanel.expTypeSelect).toBeEnabled();

    // ポケモン名を入力して確定
    await boxPanel.fillPokemonName('ピカチュウ');
    await boxPanel.confirmPokemonName();

    // ポケモン名が確定すると disabled になる
    await expect(boxPanel.specialtySelect).toBeDisabled();
    await expect(boxPanel.expTypeSelect).toBeDisabled();
  });

  test('レベルピッカーが操作できる', async () => {
    await boxPanel.openAddNewPanel();

    await expect(boxPanel.levelField).toBeVisible();
    await expect(boxPanel.levelTriggerButton).toBeVisible();

    // 初期値を取得
    const initialLevel = await boxPanel.getLevelValue();
    expect(initialLevel).toBeTruthy();

    // ポップオーバーを開く
    await boxPanel.openLevelPicker();

    // +ボタンでレベルを上げる
    await boxPanel.incrementLevel();

    // レベルが上がったことを確認
    const newLevel = await boxPanel.getLevelValue();
    expect(newLevel).toBe(initialLevel + 1);
  });

  test('EXP性格補正が選択できる', async () => {
    await boxPanel.openAddNewPanel();

    await expect(boxPanel.natureField).toBeVisible();
    await expect(boxPanel.natureTrigger).toBeVisible();

    // ドロップダウンを開く
    await boxPanel.openNatureDropdown();

    // 3つのオプションが存在する
    await expect(boxPanel.natureOptions).toHaveCount(3);

    // 2番目のオプション（↑）を選択
    await boxPanel.selectNatureOption(1);
  });

  test('食材タイプが選択できる', async () => {
    await boxPanel.openAddNewPanel();

    // ポケモン名を入力して確定
    await boxPanel.fillPokemonName('ピカチュウ');
    await boxPanel.confirmPokemonName();

    await expect(boxPanel.ingredientSelect).toBeVisible();

    // 初期値を取得
    const initialValue = await boxPanel.ingredientSelect.inputValue();

    // 別の値を選択
    await boxPanel.ingredientSelect.selectOption({ index: 1 });

    // 値が変わったことを確認
    const newValue = await boxPanel.ingredientSelect.inputValue();
    expect(newValue).not.toBe(initialValue);
  });

  test('サブスキルが選択できる', async () => {
    await boxPanel.openAddNewPanel();

    await expect(boxPanel.subSkillSection).toBeVisible();
    await expect(boxPanel.subSkillSelects).toHaveCount(5);

    // Lv10のセレクトで値を選択
    const lv10Select = boxPanel.subSkillSelects.first();
    await expect(lv10Select).toBeVisible();

    // 選択肢が存在することを確認
    const options = lv10Select.locator('option');
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(1);

    // 値を選択
    await lv10Select.selectOption({ index: 1 });

    // 値が設定されたことを確認
    const selectedValue = await lv10Select.inputValue();
    expect(selectedValue).not.toBe('');
  });
});

// ============================================
// インポートパネル
// ============================================

test.describe('インポートパネル', () => {
  let boxPanel: BoxPanelPage;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    boxPanel = new BoxPanelPage(page);
  });

  test('開閉が正常に動作する', async () => {
    // 初期状態: 閉じている
    await expect(boxPanel.importPanel).not.toHaveAttribute('open', '');

    // 開く
    await boxPanel.importSummary.click();
    await expect(boxPanel.importPanel).toHaveAttribute('open', '');

    // 閉じる
    await boxPanel.importSummary.click();
    await expect(boxPanel.importPanel).not.toHaveAttribute('open', '');
  });

  test('テキストエリアに貼り付けて取り込みできる', async () => {
    await boxPanel.openImportPanel();

    await boxPanel.fillImportText(importData.singlePokemon);
    await boxPanel.clickImport();

    // BOXにポケモンが追加される
    await boxPanel.expectBoxTileCount(1);
  });

  test('貼り付けボタンが存在する', async () => {
    await boxPanel.openImportPanel();
    await expect(boxPanel.pasteButton).toBeVisible();
  });

  test('ファイルから読み込みが存在する', async () => {
    await boxPanel.openImportPanel();
    await expect(boxPanel.fileInput).toBeAttached();
  });

  test('クリアボタンでテキストがクリアされる', async () => {
    await boxPanel.openImportPanel();

    await boxPanel.fillImportText('テスト文字列');
    await boxPanel.clickClear();

    await expect(boxPanel.importTextarea).toHaveValue('');
  });

  test('複数ポケモンを一括インポートできる', async () => {
    await boxPanel.openImportPanel();

    await boxPanel.fillImportText(importData.importText);
    await boxPanel.clickImport();

    // インポートデータの行数分がBOXに追加される
    const expectedCount = importData.importText.split('\n').length;
    await boxPanel.expectBoxTileCount(expectedCount);
  });
});
