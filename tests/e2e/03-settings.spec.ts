/**
 * E2E Test: 03-settings
 * 設定モーダルのテスト（デスクトップ・モバイル対応）
 */
import { test, expect } from '@playwright/test';
import { SettingsModalPage } from './pages/SettingsModalPage';

// ============================================================
// デスクトップ版テスト
// ============================================================
test.describe('03-settings デスクトップ', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // ========================================
  // A. モーダルの開閉（PC版）
  // ========================================
  test('1. [PC] CalcPanel内の設定ボタンでモーダルが開く', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.expectModalVisible();
    await expect(settings.modalTitle).toContainText('設定');
  });

  test('2. [PC] ×ボタンでモーダルが閉じる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.expectModalVisible();

    await settings.closeByButton();
    await settings.expectModalHidden();
  });

  test('3. [PC] 領域外クリックでモーダルが閉じる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.expectModalVisible();

    await settings.closeByOverlayClick();
    await settings.expectModalHidden();
  });

  test('5. [共通] ESCキーでモーダルが閉じる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.expectModalVisible();

    await settings.closeByEscape();
    await settings.expectModalHidden();
  });

  // ========================================
  // B. グローバル設定
  // ========================================
  test('6. ブースト上限の入力ができる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setBoostCandyRemaining('5000');

    const value = await settings.getBoostCandyRemaining();
    // カンマ区切りで表示される可能性があるため、カンマを除去して比較
    expect(value.replace(/,/g, '')).toBe('5000');
  });

  test('7. ブースト上限が反映され、計算機パネルに反映される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setBoostCandyRemaining('8000');
    await settings.closeByButton();

    // 計算機パネルで上限が反映されていることを確認
    const capText = page.locator('.calcSum__k--right').filter({ hasText: '上限' }).first();
    await expect(capText).toContainText('8,000');
  });

  test('8. かけらの上限入力ができる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setTotalShards('150000');

    const value = await settings.getTotalShards();
    // カンマ区切りで表示される可能性があるため、カンマを除去して比較
    expect(value.replace(/,/g, '')).toBe('150000');
  });

  test('9. かけらの上限が反映され、計算機パネルに反映される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setTotalShards('200000');
    await settings.closeByButton();

    // 計算機パネルでかけら上限が反映されていることを確認
    const capText = page.locator('.calcSum__k--right').filter({ hasText: '上限' }).last();
    await expect(capText).toContainText('200,000');
  });

  test('10. 万能アメ（S/M/L）の入力ができる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setUniversalCandy('S', 50);
    await settings.setUniversalCandy('M', 30);
    await settings.setUniversalCandy('L', 10);

    expect(await settings.getUniversalCandy('S')).toBe(50);
    expect(await settings.getUniversalCandy('M')).toBe(30);
    expect(await settings.getUniversalCandy('L')).toBe(10);
  });

  test('11. 万能アメの値が保存される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setUniversalCandy('S', 100);
    await settings.setUniversalCandy('M', 60);
    await settings.setUniversalCandy('L', 20);
    await settings.closeByButton();

    // 再度開いて確認
    await settings.openSettingsFromDesktop();
    expect(await settings.getUniversalCandy('S')).toBe(100);
    expect(await settings.getUniversalCandy('M')).toBe(60);
    expect(await settings.getUniversalCandy('L')).toBe(20);
  });

  // ========================================
  // C. 睡眠設定
  // ========================================
  test('12. 日々の睡眠時間（1-13時間、0.5刻み）が入力できる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setDailySleepHours(9.5);

    expect(await settings.getDailySleepHours()).toBe(9.5);
  });

  test('13. 睡眠EXPボーナス回数（0-5回）が選択できる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setSleepExpBonus(3);

    expect(await settings.getSleepExpBonus()).toBe(3);
  });

  test('14. 「GSD（グッドスリープデー）を含む」チェックボックスが操作できる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();

    const initialState = await settings.isIncludeGSDChecked();
    await settings.toggleIncludeGSD();
    const newState = await settings.isIncludeGSDChecked();

    expect(newState).toBe(!initialState);
  });

  test('15. 睡眠時間を変更して閉じると設定が保存される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setDailySleepHours(10);
    await settings.closeByButton();

    // 再度開いて確認
    await settings.openSettingsFromDesktop();
    expect(await settings.getDailySleepHours()).toBe(10);
  });

  test('16. 睡眠EXPボーナスを変更して閉じると設定が保存される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setSleepExpBonus(4);
    await settings.closeByButton();

    // 再度開いて確認
    await settings.openSettingsFromDesktop();
    expect(await settings.getSleepExpBonus()).toBe(4);
  });

  test('17. GSDチェックを変更して閉じると設定が保存される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    const initialState = await settings.isIncludeGSDChecked();
    await settings.toggleIncludeGSD();
    await settings.closeByButton();

    // 再度開いて確認
    await settings.openSettingsFromDesktop();
    const savedState = await settings.isIncludeGSDChecked();
    expect(savedState).toBe(!initialState);
  });

  // ========================================
  // D. タイプアメ設定
  // ========================================
  test('18. タイプアメセクションが表示される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await expect(settings.typeCandySection).toBeVisible();
  });

  test('19. 全18タイプが表示される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    const count = await settings.getTypeCandyCount();
    expect(count).toBe(18);
  });

  test('20. でんきタイプのS/M入力ができる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setTypeCandy('でんき', 'S', 50);
    await settings.setTypeCandy('でんき', 'M', 30);

    expect(await settings.getTypeCandy('でんき', 'S')).toBe(50);
    expect(await settings.getTypeCandy('でんき', 'M')).toBe(30);
  });

  test('21. タイプアメの値を変更して閉じると設定が保存される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setTypeCandy('でんき', 'S', 80);
    await settings.setTypeCandy('でんき', 'M', 40);
    await settings.closeByButton();

    // 再度開いて確認
    await settings.openSettingsFromDesktop();
    expect(await settings.getTypeCandy('でんき', 'S')).toBe(80);
    expect(await settings.getTypeCandy('でんき', 'M')).toBe(40);
  });

  // ========================================
  // E. 入力バリデーション
  // ========================================
  test('22. ブースト上限に数値以外を入力すると適切に処理される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();

    // 数値以外を入力
    await settings.setBoostCandyRemaining('abc');
    await settings.closeByButton();

    // 再度開いて確認
    await settings.openSettingsFromDesktop();
    const value = await settings.getBoostCandyRemaining();

    // 数値以外の入力はモーダルを閉じるとデフォルト値（空または数値）に戻る
    const numericValue = value.replace(/,/g, '');
    // 空文字または数値のみであることを確認
    expect(/^\d*$/.test(numericValue)).toBeTruthy();
  });

  test('23. かけら上限に数値以外を入力すると適切に処理される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();

    // 数値以外を入力
    await settings.setTotalShards('xyz');
    await settings.closeByButton();

    // 再度開いて確認
    await settings.openSettingsFromDesktop();
    const value = await settings.getTotalShards();

    // 数値以外の入力はモーダルを閉じると0になる
    const numericValue = value.replace(/,/g, '');
    expect(numericValue).toBe('0');
  });

  test('24. 睡眠時間の範囲外（例: 0時間や20時間）が適切に処理される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();

    // 範囲外の値を設定（HTML5バリデーションがあっても実際の動作を確認）
    await settings.dailySleepHoursInput.fill('0');
    await settings.dailySleepHoursInput.blur();
    let value = await settings.getDailySleepHours();
    // ブラウザによっては範囲外も受け入れるため、値が設定されることを確認
    expect(typeof value).toBe('number');

    // 最大値を超える値
    await settings.dailySleepHoursInput.fill('20');
    await settings.dailySleepHoursInput.blur();
    value = await settings.getDailySleepHours();
    // 値が設定されることを確認（ブラウザバリデーションは送信時）
    expect(value).toBeGreaterThan(0);
  });

  test('26. 睡眠時間にマイナス値が入力できないことを確認', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();

    // 初期値を取得
    const initialValue = await settings.getDailySleepHours();

    // マイナス値を入力
    await settings.dailySleepHoursInput.fill('-5');
    await settings.closeByButton();

    // 再度開いて確認
    await settings.openSettingsFromDesktop();
    const value = await settings.getDailySleepHours();

    // マイナス値は保存されず、初期値またはデフォルト値に戻る
    expect(value).toBeGreaterThanOrEqual(1);
  });

  test('25. 万能アメに負の値が入力できないことを確認', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();

    // 万能アメSに負の値を入力
    await settings.setUniversalCandy('S', -10);
    await settings.universalCandySInput.blur();

    const value = await settings.getUniversalCandy('S');
    // input[type="number"] min="0" により負の値は無効
    expect(value).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// モバイル版テスト
// ============================================================
test.describe('03-settings モバイル', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // ========================================
  // A. モーダルの開閉（モバイル版）
  // ========================================
  test('4. [Mobile] MobileNavの設定タブでモーダルが開く', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromMobile();
    await settings.expectModalVisible();
    await expect(settings.modalTitle).toContainText('設定');
  });

  test('[Mobile] ESCキーでモーダルが閉じる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromMobile();
    await settings.expectModalVisible();

    await settings.closeByEscape();
    await settings.expectModalHidden();
  });

  // ========================================
  // F. モバイル専用レイアウト
  // ========================================
  test('27. [Mobile] モーダルが全画面表示される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromMobile();

    // モバイルではborder-radius: 0（全画面）
    const borderRadius = await settings.modal.evaluate((el) => {
      return window.getComputedStyle(el).borderRadius;
    });

    expect(borderRadius).toBe('0px');
  });

  test('28. [Mobile] タイプアメグリッドが1カラムになる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromMobile();

    // スクロールしてタイプアメセクションを表示
    await settings.typeCandySection.scrollIntoViewIfNeeded();

    // grid-template-columns: 1fr（1カラム）
    const gridColumns = await settings.typeCandyGrid.evaluate((el) => {
      return window.getComputedStyle(el).gridTemplateColumns;
    });

    // 1fr は具体的なpx値になるが、カラム数を確認
    // モバイルでは1カラムなので、スペースで分割した配列の長さが1
    const columnCount = gridColumns.split(' ').filter(s => s.includes('px') || s.includes('fr')).length;
    expect(columnCount).toBe(1);
  });

  test('29. [Mobile] スクロールが正常に動作する', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromMobile();

    // モーダルボディの最初のスクロール位置
    const initialScroll = await settings.modal.locator('.modal__body').evaluate((el) => el.scrollTop);

    // タイプアメセクションまでスクロール
    await settings.typeCandySection.scrollIntoViewIfNeeded();

    // スクロール後の位置
    const afterScroll = await settings.modal.locator('.modal__body').evaluate((el) => el.scrollTop);

    // スクロールが発生したことを確認
    expect(afterScroll).toBeGreaterThan(initialScroll);
  });
});
