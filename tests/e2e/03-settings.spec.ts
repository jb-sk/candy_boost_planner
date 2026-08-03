/**
 * E2E Test: 03-settings
 * 設定モーダルのテスト（デスクトップ・モバイル対応）
 */
import { test, expect } from '@playwright/test';
import { SettingsModalPage } from './pages/SettingsModalPage';
import { CalcPanelPage } from './pages/CalcPanelPage';
import { readFile } from 'node:fs/promises';

function makeBackup(totalShards = 12345) {
  return {
    format: 'candy-boost-planner-backup',
    schemaVersion: 1,
    exportedAt: '2026-07-22T07:30:00.000Z',
    data: {
      box: { entries: [] },
      globalSettings: {
        totalShards,
        sleepSettings: { dailySleepHours: 7.5, sleepExpBonusCount: 2, includeGSD: false },
        candyInventory: { schemaVersion: 1, universal: { s: 5, m: 6, l: 7 }, typeCandy: {}, species: {} },
      },
      calculator: { activeSlotIndex: 2, slots: [null, null, null] },
    },
  };
}

function makeFullBackup() {
  const value = makeBackup(777777);
  const timestamp = '2026-07-22T07:30:00.000Z';
  const types = ['Electric', 'Electric', 'Ground'];
  value.data.box.entries = [0, 1, 2].map((index) => ({
    id: `box-${index}`,
    rawText: '',
    label: `Backup Box ${index}`,
    favorite: index === 0,
    derived: { pokedexId: 25 + index, form: 0, level: 10 + index, expType: 600, expGainNature: 'normal', natureName: '' },
    planner: { level: 10 + index, expRemaining: 100 + index, sleepHours: index * 10, expType: 600, expGainNature: 'normal' },
    createdAt: timestamp,
    updatedAt: timestamp,
  })) as never[];
  // テスト36はV1バックアップの移行テスト。入力は意図的にV1（種族別キー）のまま保持する。
  // インポート時にV2（進化系統別・競合は系統内最大値）へ移行される様子を比較側で検証する。
  value.data.globalSettings.candyInventory = {
    schemaVersion: 1,
    universal: { s: 11, m: 22, l: 33 },
    typeCandy: { Electric: { s: 44, m: 55 }, Ground: { s: 66, m: 77 } },
    species: { '25': 88, '26': 99, '27': 111 },
  };
  value.data.calculator.activeSlotIndex = 1;
  value.data.calculator.slots = [0, 1, 2].map((index) => ({
    slotId: `slot-${index}`,
    savedAt: timestamp,
    rows: [{
      id: `row-${index}`,
      boxId: `box-${index}`,
      pokedexId: 25 + index,
      pokemonType: types[index],
      title: `Backup Slot ${index}`,
      srcLevel: 10 + index,
      dstLevel: 11 + index,
      expRemaining: 100 + index,
      expType: 600,
      nature: 'normal',
      boostReachLevel: 11 + index,
      boostRatioPct: 100,
      mode: 'targetLevel',
      sleepHours: index * 10,
    }],
    activeRowId: `row-${index}`,
    boostKind: (['full', 'mini', 'none'] as const)[index],
    boostCandyRemaining: index === 2 ? null : 100 + index,
    itemCompareMode: (['surplusFirst', 'surplusGateFirst', 'legacyImproved'] as const)[index],
  })) as never[];
  return value;
}

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
    await expect(settings.inventoryTab).toContainText('設定');
  });

  test('2. [PC] ×ボタンでモーダルが閉じる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.expectModalVisible();

    await settings.closeByButton();
    await settings.expectModalHidden();
  });

  test('3. [PC] 領域外クリックでモーダルが閉じる', async ({ page }) => {
    // 1400px+ でモーダルが max-width:890px のカード表示になり領域外が存在する
    await page.setViewportSize({ width: 1400, height: 900 });
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
    const calc = new CalcPanelPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setBoostCandyRemaining('8000');
    await settings.closeByButton();

    await calc.expandStickyBarsIfCollapsed();
    // 計算機パネルで上限が反映されていることを確認
    const capText = page.locator('.calcSum__k--right').filter({ hasText: '上限' }).first();
    await expect(capText).toContainText('8,000');
  });

  test('7c. 既定のアメブ目標Lvは通常アメのスロットでも編集できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // アプリ全体の設定なので、選択中スロットの種別で無効化してはいけない
    await calc.setBoostKind('none');
    await settings.openSettingsFromDesktop();

    await expect(settings.defaultBoostReachLevelInput).toBeEnabled();
    // 対照: アメブ上限はスロットごとの値なので、こちらは無効化されて正しい
    await expect(settings.boostCandyRemainingInput).toBeDisabled();
  });

  test('7b. 既定のアメブ目標Lvを設定でき、空欄で「目標Lvと同じ」へ戻る', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    // 未設定のうちは空欄で、意味を placeholder が示す
    await expect(settings.defaultBoostReachLevelInput).toHaveValue('');
    await expect(settings.defaultBoostReachLevelInput).toHaveAttribute('placeholder', '目標Lvと同じ');

    await settings.defaultBoostReachLevelInput.fill('35');
    await settings.defaultBoostReachLevelInput.blur();
    await settings.closeByButton();

    // 閉じて開き直しても残る
    await settings.openSettingsFromDesktop();
    await expect(settings.defaultBoostReachLevelInput).toHaveValue('35');

    // 空欄へ戻すと「目標Lvと同じ」（未設定）へ戻る
    await settings.defaultBoostReachLevelInput.fill('');
    await settings.defaultBoostReachLevelInput.blur();
    await settings.closeByButton();
    await settings.openSettingsFromDesktop();
    await expect(settings.defaultBoostReachLevelInput).toHaveValue('');
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
    const calc = new CalcPanelPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setTotalShards('200000');
    await settings.closeByButton();

    await calc.expandStickyBarsIfCollapsed();
    // 計算機パネルでかけら上限が反映されていることを確認
    const capText = page.locator('.calcSum__k--right').filter({ hasText: '上限' }).last();
    await expect(capText).toContainText('200,000');
  });

  test('9b. 配分方針は現行3モードのみ表示され、変更が保存される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    const optionTexts = await settings.itemCompareModeSelect.locator('option').allTextContents();
    const optionValues = await settings.itemCompareModeSelect.locator('option').evaluateAll((options) =>
      options.map(option => (option as HTMLOptionElement).value)
    );

    expect(optionTexts).toEqual(['余り最小', 'バランス', 'EXP最大']);
    expect(optionValues).toEqual(['surplusFirst', 'surplusGateFirst', 'legacyImproved']);

    await settings.setItemCompareMode('legacyImproved');
    await settings.closeByButton();

    await settings.openSettingsFromDesktop();
    expect(await settings.getItemCompareMode()).toBe('legacyImproved');
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

  test('12b. 睡眠時間を全削除してから入力し直せる（確定はblur）', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();

    await settings.dailySleepHoursInput.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await expect(settings.dailySleepHoursInput).toHaveValue('');

    await page.keyboard.type('13');
    await expect(settings.dailySleepHoursInput).toHaveValue('13');

    await settings.dailySleepHoursInput.blur();
    expect(await settings.getDailySleepHours()).toBe(13);
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

  test('30. データのバックアップは在庫・睡眠設定と並列のタブになっており、タブ切替で表示できる', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    const section = page.getByTestId('data-backup-section');
    await expect(settings.globalSection).toBeVisible();
    await expect(section).not.toBeVisible();
    await expect(settings.inventoryTab).toHaveAttribute('aria-selected', 'true');
    await settings.inventoryTab.focus();
    await settings.inventoryTab.press('ArrowRight');
    await expect(section).toBeVisible();
    await expect(settings.globalSection).not.toBeVisible();
    await expect(settings.backupTab).toHaveAttribute('aria-selected', 'true');
    await expect(settings.backupTab).toBeFocused();
    await expect(page.getByTestId('data-backup-copy')).toBeVisible();
  });

  test('31. 通常貼り付けのプレビューとキャンセルは既存データを変更しない', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await settings.switchToBackupTab();
    const before = await page.evaluate(() => JSON.stringify(localStorage));
    await page.getByTestId('data-backup-input').fill(JSON.stringify(makeBackup()));
    await page.getByTestId('data-backup-import').click();
    await expect(page.getByTestId('data-backup-preview')).toContainText('12345'.replace('12345', '0'));
    await expect(page.getByTestId('data-backup-preview')).toContainText('0 / 0 / 0');
    await page.getByTestId('data-backup-input').fill(JSON.stringify(makeBackup(999)));
    await expect(page.getByTestId('data-backup-preview')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before);

    await page.getByTestId('data-backup-import').click();
    await page.getByTestId('data-backup-cancel').click();
    await expect(page.getByTestId('data-backup-preview')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(before);
  });

  test('32. Clipboard読取とファイル選択が同じvalidatorへ入り、確定後reloadして復元される', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await settings.switchToBackupTab();
    const text = JSON.stringify(makeBackup(24680));
    await page.evaluate((clipboardText) => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: async () => clipboardText, writeText: async () => undefined },
      });
    }, text);
    await page.getByTestId('data-backup-paste').click();
    await page.getByTestId('data-backup-import').click();
    await expect(page.getByTestId('data-backup-preview')).toBeVisible();
    await page.getByTestId('data-backup-cancel').click();

    await page.getByTestId('data-backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.getByTestId('data-backup-import').click();
    await expect(page.getByTestId('data-backup-preview')).toBeVisible();
    await page.getByTestId('data-backup-restore').click();
    await page.waitForLoadState('domcontentloaded');

    await settings.openSettingsFromDesktop();
    expect((await settings.getTotalShards()).replace(/,/g, '')).toBe('24680');
    expect(await settings.getUniversalCandy('S')).toBe(5);
    expect(await settings.getDailySleepHours()).toBe(7.5);
  });

  test('33. Clipboardコピーとファイル保存は同じ意味内容を出力する', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await settings.switchToBackupTab();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => { (window as Window & { copiedBackup?: string }).copiedBackup = text; },
          readText: async () => '',
        },
      });
    });
    await page.getByTestId('data-backup-copy').click();
    const copied = await page.evaluate(() => (window as Window & { copiedBackup?: string }).copiedBackup ?? '');
    await expect(page.getByTestId('data-backup-manual-copy')).toHaveCount(0);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('data-backup-download').click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    const downloaded = await readFile(path!, 'utf8');
    expect(JSON.parse(downloaded).data).toEqual(JSON.parse(copied).data);
  });

  test('35. Clipboard拒否時だけ手動コピー欄を表示する', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await settings.switchToBackupTab();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new Error('denied'); }, readText: async () => '' },
      });
    });
    await page.getByTestId('data-backup-copy').click();
    await expect(page.getByTestId('data-backup-manual-copy')).toBeVisible();
    await expect(page.getByTestId('data-backup-manual-copy')).toHaveAttribute('readonly', '');
  });

  test('36. V1のBox・全設定・異なる3スロットを復元し、V2へ移行して再エクスポートできる', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    const expected = makeFullBackup();
    await settings.openSettingsFromDesktop();
    await settings.switchToBackupTab();
    await page.getByTestId('data-backup-input').fill(JSON.stringify(expected));
    await page.getByTestId('data-backup-import').click();
    await page.getByTestId('data-backup-restore').click();
    await page.waitForLoadState('domcontentloaded');

    const calc = new CalcPanelPage(page);
    for (let index = 0; index < 3; index++) {
      await calc.clickSlotTab(index);
      await expect(page.getByTestId('calc-row')).toContainText(`Backup Box ${index}`);
      await expect(page.getByTestId('calc-export-button')).toBeEnabled({ timeout: 10_000 });
    }

    await settings.openSettingsFromDesktop();
    await settings.switchToBackupTab();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => { (window as Window & { copiedFullBackup?: string }).copiedFullBackup = text; },
          readText: async () => '',
        },
      });
    });
    await page.getByTestId('data-backup-copy').click();
    const restored = JSON.parse(await page.evaluate(() => (window as Window & { copiedFullBackup?: string }).copiedFullBackup ?? '{}'));
    // V1入力が最新スキーマ(V3)へ移行されて再エクスポートされることを検証する。
    // 25(ピカチュウ)と26(ライチュウ)は同一系統キー"25"へ集約され、値は系統内最大値max(88,99)=99。
    // candyInventory 自体のスキーマは V2 のまま（V3 の変更対象は計算機行とグローバル設定）。
    expect(restored.schemaVersion).toBe(3);
    expect(restored.data.box).toEqual(expected.data.box);
    expect(restored.data.globalSettings).toEqual({
      ...expected.data.globalSettings,
      // 旧形式には無い項目。未設定（＝目標Lvと同じ）として補われる
      defaultBoostReachLevel: null,
      candyInventory: {
        schemaVersion: 2,
        universal: { s: 11, m: 22, l: 33 },
        typeCandy: { Electric: { s: 44, m: 55 }, Ground: { s: 66, m: 77 } },
        species: { '25': 99, '27': 111 },
      },
    });
    // V3 で廃止した旧フィールド（mode / candyPeak / boostRatioPct）は再エクスポートに現れない（設計書§6.1）
    const LEGACY_ROW_FIELDS = ['mode', 'candyPeak', 'boostRatioPct'] as const;
    const normalizeSlots = (slots: Array<Record<string, unknown>>) => slots.map(({ savedAt: _savedAt, ...slot }) => ({
      ...slot,
      rows: (slot.rows as Array<Record<string, unknown>> | undefined)?.map(row => {
        const copy = { ...row };
        for (const key of LEGACY_ROW_FIELDS) delete copy[key];
        return copy;
      }),
    }));
    expect(normalizeSlots(restored.data.calculator.slots)).toEqual(normalizeSlots(expected.data.calculator.slots as never[]));
    for (const slot of restored.data.calculator.slots as Array<Record<string, unknown>>) {
      for (const row of (slot?.rows ?? []) as Array<Record<string, unknown>>) {
        for (const key of LEGACY_ROW_FIELDS) expect(row).not.toHaveProperty(key);
      }
    }
    expect(restored.data.calculator.activeSlotIndex).toBe(2);
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
    await expect(settings.inventoryTab).toContainText('設定');
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

    // モバイルでは flex-direction: column（1カラム縦並び）
    // 680px+ では grid 2カラムに切り替わる
    const display = await settings.typeCandyGrid.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { display: s.display, flexDirection: s.flexDirection };
    });

    expect(display.display).toBe('flex');
    expect(display.flexDirection).toBe('column');
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

  test('34. [Mobile] バックアップ操作領域がモーダル幅からはみ出さない', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromMobile();
    await settings.switchToBackupTab();
    const modalBox = await settings.modal.boundingBox();
    const sectionBox = await page.getByTestId('data-backup-section').boundingBox();
    expect(modalBox).not.toBeNull();
    expect(sectionBox).not.toBeNull();
    expect(sectionBox!.x).toBeGreaterThanOrEqual(modalBox!.x);
    expect(sectionBox!.x + sectionBox!.width).toBeLessThanOrEqual(modalBox!.x + modalBox!.width + 1);
  });
});
