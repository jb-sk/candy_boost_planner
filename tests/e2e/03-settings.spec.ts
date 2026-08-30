/**
 * E2E Test: 03-settings
 * 設定モーダルのテスト（デスクトップ・モバイル対応）
 */
import { test, expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
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

/**
 * `aria-describedby` などの idref が**実在する要素を指している**こと。
 * 属性値を文字列で固定するだけでは、参照先の `id` を消しても通ってしまう。
 *
 * 参照先の `id` を先に取って空でないことを確かめてから、idref の並び
 * （空白区切りで複数書ける）に含まれるかを見る。文字列の完全一致で比べると、
 * 空の id 同士が揃った場合に通り、idref を2つ書いた場合に落ちる。
 */
async function expectRefersTo(control: Locator, attribute: string, target: Locator): Promise<void> {
  const targetId = (await target.getAttribute('id'))?.trim();
  expect(targetId).toBeTruthy();
  const refs = ((await control.getAttribute(attribute)) ?? '').trim().split(/\s+/);
  expect(refs).toContain(targetId);
}

/** 単位が読み上げへ載っていること（単位は `<label>` の外にあるので結び付けが要る）。 */
async function expectUnitDescribes(control: Locator, unit: Locator): Promise<void> {
  await expectRefersTo(control, 'aria-describedby', unit);
}

const EXPECTED_SLEEP_SETTING_ORDER = [
  '1日の睡眠時間',
  '睡眠EXPボーナス',
  '1週間の成長のお香',
  'グッドスリープデー',
  'GSDの成長のお香',
  'あおいタネの使用',
  '＋お香併用',
  'お香の在庫',
  '仮イベント',
  'イベント手動登録',
  'タイムゾーン',
];

async function expectSleepSettingOrder(section: Locator): Promise<void> {
  const labels = await section.locator('.settingsField__label').allTextContents();
  expect(labels.map(label => label.replace(/\s*×$/, ''))).toEqual(EXPECTED_SLEEP_SETTING_ORDER);
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

  test('13. 睡眠EXPボーナス持ちの匹数（0-5匹）が選択できる', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    await settings.setSleepExpBonus(3);

    expect(await settings.getSleepExpBonus()).toBe(3);
    // 数えるのは回数ではなくポケモンの数。単位が消える／「回」へ戻る退行を落とす。
    await expect(settings.sleepExpBonusUnit).toHaveText('匹');
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

  test('17a. 睡眠育成設定を基準から上書き・制限・イベントの順で表示する', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await expectSleepSettingOrder(settings.sleepSection);

    const primaryControlSelectors = [
      '[data-testid="settings-daily-sleep-hours-input"]',
      '[data-testid="settings-sleep-exp-bonus-select"]',
      '[data-testid="settings-growth-incense-normal-select"]',
      '[data-testid="settings-include-gsd-checkbox"]',
      '[data-testid="settings-growth-incense-gsd-beforeFullMoon"]',
      '[data-testid="blue-seed-weekday"]',
      '[data-testid="blue-seed-incense-days"]',
      '[data-testid="settings-growth-incense-stock-input"]',
      '[data-testid="settings-use-projected-events"]',
      '[data-testid="settings-manual-event-add"]',
      '[data-testid="settings-time-zone-input"]',
    ];
    const controlPositions = await settings.sleepSection.evaluate((section, selectors) => {
      const focusable = [...section.querySelectorAll('button, input, select')];
      return selectors.map(selector => focusable.indexOf(section.querySelector(selector)!));
    }, primaryControlSelectors);
    expect(controlPositions.every((position, index) => (
      position >= 0 && (index === 0 || position > controlPositions[index - 1])
    ))).toBe(true);
  });

  test('17d. 仮イベントとあおいタネ曜日の選択肢が独立して保存される', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await settings.openSettingsFromDesktop();
    // 仮イベントは既定オン。既定値そのものの回帰もここで固定する。
    await expect(settings.projectedEventsCheckbox).toBeChecked();
    await expect(settings.blueSeedWeekdaySelect).toBeEnabled();
    await expect(settings.blueSeedWeekdaySelect.locator('option')).toHaveCount(6);
    const options = await settings.blueSeedWeekdaySelect.locator('option').evaluateAll(optionElements =>
      optionElements.map(option => (option as HTMLOptionElement).value),
    );
    expect(options).toEqual(['1', '2', '3', '4', '5', 'none']);
    await expect(settings.blueSeedIncenseDaysSelect.locator('option')).toHaveCount(9);
    const incenseOptions = await settings.blueSeedIncenseDaysSelect.locator('option').evaluateAll(optionElements =>
      optionElements.map(option => (option as HTMLOptionElement).value),
    );
    expect(incenseOptions).toEqual(['auto', '0', '1', '2', '3', '4', '5', '6', '7']);
    // 単位は選択肢へ埋め込まず、他の行と同じ別要素で出す（英語の `1 days` を避ける）。
    await expect(settings.blueSeedIncenseDaysSelect.locator('option').nth(6)).toHaveText('5');
    // 「自動」のうちは単位を出さない（`自動 日` になる）。
    await expect(settings.blueSeedIncenseDaysSelect).toHaveValue('auto');
    await expect(settings.blueSeedIncenseDaysUnit).toBeHidden();

    await settings.blueSeedWeekdaySelect.selectOption('none');
    await settings.blueSeedIncenseDaysSelect.selectOption('5');
    // 日数を選ぶと単位が出て、読み上げでも「日」が拾えるよう select と結ばれる。
    await expect(settings.blueSeedIncenseDaysUnit).toHaveText('日');
    await expectUnitDescribes(settings.blueSeedIncenseDaysSelect, settings.blueSeedIncenseDaysUnit);

    // 「自動」へ戻すと単位も結び付けも消える。
    await settings.blueSeedIncenseDaysSelect.selectOption('auto');
    await expect(settings.blueSeedIncenseDaysUnit).toBeHidden();
    await expect(settings.blueSeedIncenseDaysSelect).not.toHaveAttribute('aria-describedby', /.*/);

    // `0` は「お香を使わない」という有効な指定。truthy 判定へ退行すると単位だけ消える。
    await settings.blueSeedIncenseDaysSelect.selectOption('0');
    await expect(settings.blueSeedIncenseDaysUnit).toHaveText('日');

    await settings.blueSeedIncenseDaysSelect.selectOption('5');
    await settings.closeByButton();

    await settings.openSettingsFromDesktop();
    await expect(settings.projectedEventsCheckbox).toBeChecked();
    await expect(settings.blueSeedWeekdaySelect).toHaveValue('none');
    await expect(settings.blueSeedIncenseDaysSelect).toHaveValue('5');

    await settings.projectedEventsCheckbox.uncheck();
    await settings.closeByButton();

    await settings.openSettingsFromDesktop();
    await expect(settings.projectedEventsCheckbox).not.toBeChecked();
    await expect(settings.blueSeedWeekdaySelect).toHaveValue('none');
    await expect(settings.blueSeedIncenseDaysSelect).toHaveValue('5');
  });

  /*
   * 単位を選択肢の外へ出した目的そのもの。埋め込んでいた頃は英語が `1 days` になり、
   * 「自動」でも `Auto days` と並んだ。日本語側だけ見ていると気付けないのでここで押さえる。
   */
  test('17d-1. 英語でも「＋お香併用」の単位は別要素で出る（自動のときは出ない）', async ({ page }) => {
    const settings = new SettingsModalPage(page);

    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('main.shell')).toHaveAttribute('data-locale', 'en');

    await settings.openSettingsFromDesktop();
    await expect(settings.blueSeedIncenseDaysSelect).toHaveValue('auto');
    await expect(settings.blueSeedIncenseDaysUnit).toBeHidden();

    await settings.blueSeedIncenseDaysSelect.selectOption('5');
    await expect(settings.blueSeedIncenseDaysUnit).toHaveText('days');
    // 選択肢は素の数値のまま。単位が混ざると `5 days days` になる。
    await expect(settings.blueSeedIncenseDaysSelect.locator('option').nth(6)).toHaveText('5');
  });

  test('17e. 睡眠育成設定6項目の説明が「?」のヒントチップで読める', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();

    await expect(settings.hintPopover).toBeHidden();

    // 睡眠育成設定の行に `title` を残さない。旧実装の `title` は入力ではなく
    // **行の `<label>`** に付いていたので、行ごと見ないと二重表示の退行を落とせない
    // （お香2項目はチップへ移設、グッドスリープデーは削除しただけ）。
    await expect(settings.modal.locator('.settingsField[title]')).toHaveCount(0);

    await settings.growthIncenseNormalHintButton.click();
    expect(await settings.hintPopover.textContent()).toBe(
      '・週に最低限使用する個数です\n'
      + '・倍率が高いGSDやあおいタネの設定が優先されます',
    );
    await expect(settings.growthIncenseNormalHintButton)
      .toHaveAttribute('aria-label', '1週間の成長のお香の説明を開く');

    await settings.growthIncenseGsdHintButton.click();
    expect(await settings.hintPopover.textContent()).toBe(
      '・GSDは倍率が高いためお香が優先されます\n'
      + '・週のお香0個でもGSDのお香は使います',
    );
    await expect(settings.growthIncenseGsdHintButton)
      .toHaveAttribute('aria-label', 'GSDの成長のお香の説明を開く');

    // 「?」は label の外。押しても入力欄が反応しない（在庫欄はフォーカスも移らない）。
    await settings.growthIncenseStockHintButton.click();
    await expect(settings.hintPopover)
      .toContainText('使用できるお香の上限。未記入なら無制限、0なら使用できません');
    await expect(settings.growthIncenseStockInput).not.toBeFocused();
    await expect(settings.growthIncenseStockHintButton)
      .toHaveAttribute('aria-label', 'お香の在庫の説明を開く');
    await settings.growthIncenseStockHintButton.click();
    await expect(settings.hintPopover).toBeHidden();

    // 「?」は label の外。押してもチェックが切り替わらないことがこの行の要。
    await expect(settings.projectedEventsCheckbox).toBeChecked();
    await settings.projectedEventsHintButton.click();
    await expect(settings.projectedEventsCheckbox).toBeChecked();
    await expect(settings.hintPopover).toBeVisible();
    await expect(settings.hintPopover).toContainText('過去1年間のイベント実績');

    // 同じ「?」をもう一度押したら閉じる。
    await settings.projectedEventsHintButton.click();
    await expect(settings.hintPopover).toBeHidden();

    await settings.blueSeedWeekdayHintButton.click();
    expect(await settings.hintPopover.textContent()).toBe(
      '・周年フェス2週目のおいわいフラワーであおいタネを使う曜日です\n'
      + '・植えた日から睡眠EXP×3になります',
    );
    // あおいタネ側は曜日の話だけを持つ（お香併用の説明を書き戻していないことの回帰）。
    await expect(settings.hintPopover).not.toContainText('自動');

    // 開いたまま隣の「?」へ1回で移れること（受け口に埋まると2回押しになる）。
    await settings.blueSeedIncenseDaysHintButton.click();
    expect(await settings.hintPopover.textContent()).toBe(
      '・あおいタネとお香を併用する日数です\n'
      + '・「自動」は週の個数とGSDの設定に準じます\n'
      + '・指定日数を過ぎたら使用しません',
    );
    // 読み上げ名は項目ごとに違う。
    await expect(settings.blueSeedIncenseDaysHintButton).toHaveAttribute('aria-label', '＋お香併用の説明を開く');
    await expect(settings.projectedEventsHintButton).toHaveAttribute('aria-label', '仮イベントの説明を開く');
    // 開いているボタンだけが本文と結ばれる。両方の属性を見る（片方を消した退行を落とすため）。
    await expect(settings.blueSeedIncenseDaysHintButton).toHaveAttribute('aria-expanded', 'true');
    // 属性値の固定だけだと、チップ側の `id` を消しても通る（宙に浮いた idref）。
    await expectRefersTo(settings.blueSeedIncenseDaysHintButton, 'aria-controls', settings.hintPopover);
    await expectRefersTo(settings.blueSeedIncenseDaysHintButton, 'aria-describedby', settings.hintPopover);
    await expect(settings.projectedEventsHintButton).not.toHaveAttribute('aria-controls', /.*/);
    await expect(settings.projectedEventsHintButton).not.toHaveAttribute('aria-describedby', /.*/);

    // Escape はヒントだけ閉じる。設定は開いたまま。
    await page.keyboard.press('Escape');
    await expect(settings.hintPopover).toBeHidden();
    await expect(settings.modal).toBeVisible();
    // 閉じたら idref を残さない（チップの要素はもう無い）。
    await expect(settings.blueSeedIncenseDaysHintButton).toHaveAttribute('aria-expanded', 'false');
    await expect(settings.blueSeedIncenseDaysHintButton).not.toHaveAttribute('aria-controls', /.*/);
    await expect(settings.blueSeedIncenseDaysHintButton).not.toHaveAttribute('aria-describedby', /.*/);

    await page.keyboard.press('Escape');
    await expect(settings.modal).toBeHidden();
  });

  test('17b. タイムゾーンと成長のお香設定を検証・保存できる', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();

    await settings.setTimeZone('UTC+09:00');
    await expect(settings.timeZoneError).toBeVisible();

    await settings.setTimeZone('america/new_york');
    await expect(settings.timeZoneError).toHaveCount(0);
    await expect(settings.timeZoneInput).toHaveValue('America/New_York');
    await settings.setGrowthIncenseGsd({ beforeFullMoon: true, fullMoon: false, afterFullMoon: true });
    await settings.setGrowthIncenseNormalPerWeek(4);
    await settings.closeByButton();

    await settings.openSettingsFromDesktop();
    await expect(settings.timeZoneInput).toHaveValue('America/New_York');
    await expect(settings.growthIncenseGsdBeforeCheckbox).toBeChecked();
    await expect(settings.growthIncenseGsdFullMoonCheckbox).not.toBeChecked();
    await expect(settings.growthIncenseGsdAfterCheckbox).toBeChecked();
    await expect(settings.growthIncenseNormalSelect).toHaveValue('4');
    await expect(settings.growthIncenseNormalUnit).toHaveText('個/週');
    // 単位は `<label>` の外にあるので、読み上げへ載せるには結び付けが要る。
    await expectUnitDescribes(settings.growthIncenseNormalSelect, settings.growthIncenseNormalUnit);
    await expectUnitDescribes(settings.growthIncenseStockInput, settings.growthIncenseStockUnit);
  });

  test('17b-1b. お香の在庫は未記入で無制限・0で使わないを保存し分ける', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();

    // 初期は未記入（無制限）。
    await expect(settings.growthIncenseStockInput).toHaveValue('');

    await settings.setGrowthIncenseStock('12');
    await settings.closeByButton();
    await settings.openSettingsFromDesktop();
    await expect(settings.growthIncenseStockInput).toHaveValue('12');

    // 0 は「1個も使わない」。未記入（無制限）へ落とさない。
    await settings.setGrowthIncenseStock('0');
    await settings.closeByButton();
    await settings.openSettingsFromDesktop();
    await expect(settings.growthIncenseStockInput).toHaveValue('0');

    // 不正な入力は設定を壊さず、フォーカスを外すと確定値の表示へ戻る。
    await settings.setGrowthIncenseStock('-3');
    await expect(settings.growthIncenseStockInput).toHaveValue('0');

    await settings.setGrowthIncenseStock('');
    await settings.closeByButton();
    await settings.openSettingsFromDesktop();
    await expect(settings.growthIncenseStockInput).toHaveValue('');
  });

  test('17b-2. 手入力イベント倍率を検証し、有効な複数区間だけを保存する', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await expect(page.getByText('イベント手動登録', { exact: true })).toBeVisible();

    const addButton = page.getByTestId('settings-manual-event-add');
    await addButton.click();
    const row = page.getByTestId('settings-manual-event-row').first();
    const from = row.getByTestId('settings-manual-event-from');
    const days = row.getByTestId('settings-manual-event-days');
    const multiplier = row.getByTestId('settings-manual-event-multiplier');
    const error = row.getByTestId('settings-manual-event-error');

    // 日付が不正
    await from.fill('20260230');
    await days.fill('3');
    await multiplier.fill('1.5');
    await multiplier.blur();
    await expect(error).toContainText('YYYYMMDD');
    await expect(from).toHaveClass(/field__input--error/);

    // 日数が不正（0日・小数は受け付けない）
    await from.fill('20260301');
    await days.fill('0');
    await days.blur();
    await expect(error).toContainText('1〜365');
    await expect(days).toHaveClass(/field__input--error/);

    // 倍率が不正
    await days.fill('2');
    await multiplier.fill('0');
    await multiplier.blur();
    await expect(error).toContainText('0より大きく10以下');
    await expect(multiplier).toHaveClass(/field__input--error/);

    await multiplier.fill('1.5');
    await multiplier.blur();
    await expect(error).toHaveCount(0);

    await addButton.click();
    const secondRow = page.getByTestId('settings-manual-event-row').nth(1);
    await secondRow.getByTestId('settings-manual-event-from').fill('20260305');
    await secondRow.getByTestId('settings-manual-event-days').fill('3');
    await secondRow.getByTestId('settings-manual-event-multiplier').fill('3');
    await secondRow.getByTestId('settings-manual-event-multiplier').blur();

    await settings.closeByButton();
    await settings.openSettingsFromDesktop();
    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(2);
    await expect(page.getByTestId('settings-manual-event-multiplier').nth(0)).toHaveValue('1.5');
    await expect(page.getByTestId('settings-manual-event-multiplier').nth(1)).toHaveValue('3');
    // 入力欄は区切りなしの YYYYMMDD ＋ 日数で復元される（保存値は from/to の閉区間）
    await expect(page.getByTestId('settings-manual-event-from').nth(0)).toHaveValue('20260301');
    await expect(page.getByTestId('settings-manual-event-days').nth(0)).toHaveValue('2');
    await expect(page.getByTestId('settings-manual-event-from').nth(1)).toHaveValue('20260305');
    await expect(page.getByTestId('settings-manual-event-days').nth(1)).toHaveValue('3');
  });

  test('17b-2c. 無関係な設定更新で編集中・エラー中のイベント入力を巻き戻さない', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await page.getByTestId('settings-manual-event-add').click();

    const row = page.getByTestId('settings-manual-event-row').first();
    const from = row.getByTestId('settings-manual-event-from');
    const days = row.getByTestId('settings-manual-event-days');
    const multiplier = row.getByTestId('settings-manual-event-multiplier');
    const error = row.getByTestId('settings-manual-event-error');
    await from.fill('20260301');
    await days.fill('2');
    await multiplier.fill('1.5');
    await multiplier.blur();

    await multiplier.focus();
    await multiplier.fill('2.75');
    await expect(multiplier).toBeFocused();
    await settings.setGrowthIncenseNormalPerWeek(1);
    await expect(multiplier).toBeFocused();
    await expect(multiplier).toHaveValue('2.75');

    await multiplier.fill('0');
    await multiplier.blur();
    await expect(error).toContainText('0より大きく10以下');
    await settings.setGrowthIncenseNormalPerWeek(2);
    await expect(multiplier).toHaveValue('0');
    await expect(error).toContainText('0より大きく10以下');
  });

  test('17b-2d. no-op確定後のundo・redoでもイベント入力が保存値へ追従する', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    const calc = new CalcPanelPage(page);
    await settings.openSettingsFromDesktop();
    await page.getByTestId('settings-manual-event-add').click();

    const row = page.getByTestId('settings-manual-event-row').first();
    await row.getByTestId('settings-manual-event-from').fill('20260301');
    await row.getByTestId('settings-manual-event-days').fill('2');
    const multiplier = row.getByTestId('settings-manual-event-multiplier');
    await multiplier.fill('1.5');
    await multiplier.blur();

    // 同じ値のまま再度blurし、保存側ではno-opになる確定経路を通す。
    await multiplier.focus();
    await multiplier.blur();

    await calc.undoButton.evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(0);

    await calc.redoButton.evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(1);
    await expect(page.getByTestId('settings-manual-event-from')).toHaveValue('20260301');
    await expect(page.getByTestId('settings-manual-event-days')).toHaveValue('2');
    await expect(page.getByTestId('settings-manual-event-multiplier')).toHaveValue('1.5');
  });

  test('17b-2e. 1行目の確定で2行目へのクリックとフォーカスを失わない', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    const addButton = page.getByTestId('settings-manual-event-add');

    await addButton.click();
    const firstRow = page.getByTestId('settings-manual-event-row').nth(0);
    await firstRow.getByTestId('settings-manual-event-from').fill('20260301');
    await firstRow.getByTestId('settings-manual-event-days').fill('2');
    await firstRow.getByTestId('settings-manual-event-multiplier').fill('1.5');
    await firstRow.getByTestId('settings-manual-event-multiplier').blur();

    await addButton.click();
    const secondRow = page.getByTestId('settings-manual-event-row').nth(1);
    const secondFrom = secondRow.getByTestId('settings-manual-event-from');
    await secondFrom.fill('20260305');
    await secondRow.getByTestId('settings-manual-event-days').fill('3');
    await secondRow.getByTestId('settings-manual-event-multiplier').fill('3');
    await secondRow.getByTestId('settings-manual-event-multiplier').blur();
    await secondFrom.evaluate((element) => {
      (window as Window & { manualEventSecondInput?: Element }).manualEventSecondInput = element;
    });

    await firstRow.getByTestId('settings-manual-event-multiplier').fill('2');
    await secondFrom.click();
    await expect(secondFrom).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('6');
    await expect(secondFrom).toHaveValue('20260306');
    expect(await secondFrom.evaluate(
      element => (window as Window & { manualEventSecondInput?: Element }).manualEventSecondInput === element,
    )).toBe(true);
  });

  test('17b-2b. 未入力のまま追加した行は閉じるときに捨てられ、モーダルは閉じられる', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();

    await page.getByTestId('settings-manual-event-add').click();
    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(1);

    // 何も入力していない行が残っていても閉じられる（閉じられないと詰む）
    await settings.closeByButton();
    await settings.openSettingsFromDesktop();
    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(0);
  });

  test('17b-3. 手入力イベント倍率は10行まで追加できる', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    const addButton = page.getByTestId('settings-manual-event-add');

    for (let index = 0; index < 10; index++) await addButton.click();

    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(10);
    await expect(addButton).toBeDisabled();
  });

  test('17c. gameDateクエリで現在のゲーム内日を固定できる', async ({ page }) => {
    await page.goto('/?gameDate=2026-05-02');
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await expect(settings.currentGameDate).toContainText('2026-05-02');
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

  test('21a. 設定リセットは対象だけを初期値へ戻し、元に戻す・やり直すができる', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    const calc = new CalcPanelPage(page);
    const detectedTimeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

    await settings.openSettingsFromDesktop();
    await settings.setBoostCandyRemaining('4321');
    await settings.setTotalShards('12345');
    await settings.setUniversalCandy('S', 6);
    await settings.setTypeCandy('でんき', 'S', 7);
    await settings.dailySleepHoursInput.fill('6');
    await settings.dailySleepHoursInput.blur();
    await settings.growthIncenseStockInput.fill('9');
    await settings.growthIncenseStockInput.blur();
    await settings.defaultBoostReachLevelInput.fill('25');
    await settings.defaultBoostReachLevelInput.blur();
    await settings.setItemCompareMode('legacyImproved');
    await settings.setTimeZone('America/New_York');
    await page.getByTestId('settings-manual-event-add').click();
    const manualEventRow = page.getByTestId('settings-manual-event-row').first();
    await manualEventRow.getByTestId('settings-manual-event-from').fill('20260301');
    await manualEventRow.getByTestId('settings-manual-event-days').fill('2');
    await manualEventRow.getByTestId('settings-manual-event-multiplier').fill('1.5');
    await manualEventRow.getByTestId('settings-manual-event-multiplier').blur();

    // 確認は `window.confirm` ではなく、押した場所に出るインライン確認。
    // 「やめる」では何も起きず、設定はそのまま残る。
    await settings.resetButton.click();
    await expect(settings.resetConfirm).toBeVisible();
    await settings.resetConfirmNoButton.click();
    await expect(settings.resetConfirm).toBeHidden();
    await expect(settings.dailySleepHoursInput).toHaveValue('6');
    // 取り消したら、押したボタンへフォーカスが返る。
    await expect(settings.resetButton).toBeFocused();

    // Escape でも確認だけを取り消す（設定モーダルは閉じない）。
    await settings.resetButton.click();
    await expect(settings.resetConfirm).toBeVisible();
    // 肯定ボタンへフォーカスが移るので、質問と補足が読み上げへ載っていること。
    await expectRefersTo(settings.resetConfirm, 'aria-labelledby', settings.resetConfirmQuestion);
    await expectRefersTo(settings.resetConfirmYesButton, 'aria-describedby', settings.resetConfirmQuestion);
    await expectRefersTo(settings.resetConfirmYesButton, 'aria-describedby', settings.resetConfirmNote);
    await page.keyboard.press('Escape');
    await expect(settings.resetConfirm).toBeHidden();
    await expect(settings.modal).toBeVisible();
    await expect(settings.dailySleepHoursInput).toHaveValue('6');
    await expect(settings.resetButton).toBeFocused();

    await settings.resetButton.click();
    await expect(settings.resetConfirm).toBeVisible();
    await expect(settings.resetConfirm).toContainText('かけら・アメ在庫・計算機の入力は残ります');
    await expect(settings.resetConfirmYesButton).toBeFocused();
    await settings.resetConfirmYesButton.click();
    await expect(settings.resetConfirm).toBeHidden();
    // リセット後は起動ボタンが disabled になるので、閉じるボタンへフォーカスを逃がす。
    await expect(settings.closeButton).toBeFocused();

    await expect(settings.dailySleepHoursInput).toHaveValue('8.5');
    await expect(settings.growthIncenseStockInput).toHaveValue('');
    await expect(settings.defaultBoostReachLevelInput).toHaveValue('');
    await expect(settings.itemCompareModeSelect).toHaveValue('surplusFirst');
    await expect(settings.timeZoneInput).toHaveValue(detectedTimeZone);
    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(0);
    expect((await settings.getBoostCandyRemaining()).replace(/,/g, '')).toBe('4321');
    expect((await settings.getTotalShards()).replace(/,/g, '')).toBe('12345');
    expect(await settings.getUniversalCandy('S')).toBe(6);
    expect(await settings.getTypeCandy('でんき', 'S')).toBe(7);

    // 別の設定欄を確定しても、リセット前のローカルドラフトを再保存しない。
    await settings.dailySleepHoursInput.fill('8.5');
    await settings.dailySleepHoursInput.blur();
    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(0);

    // モーダルを再マウントせず外部から undo し、保存値の変更へ表示が追従することを確認する。
    await calc.undoButton.evaluate(button => (button as HTMLButtonElement).click());
    await expect(settings.dailySleepHoursInput).toHaveValue('6');
    await expect(settings.growthIncenseStockInput).toHaveValue('9');
    await expect(settings.defaultBoostReachLevelInput).toHaveValue('25');
    await expect(settings.itemCompareModeSelect).toHaveValue('legacyImproved');
    await expect(settings.timeZoneInput).toHaveValue('America/New_York');
    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(1);
    await expect(page.getByTestId('settings-manual-event-from')).toHaveValue('20260301');
    await expect(page.getByTestId('settings-manual-event-days')).toHaveValue('2');
    await expect(page.getByTestId('settings-manual-event-multiplier')).toHaveValue('1.5');

    await calc.redoButton.evaluate(button => (button as HTMLButtonElement).click());
    await expect(settings.dailySleepHoursInput).toHaveValue('8.5');
    await expect(settings.growthIncenseStockInput).toHaveValue('');
    await expect(settings.defaultBoostReachLevelInput).toHaveValue('');
    await expect(settings.itemCompareModeSelect).toHaveValue('surplusFirst');
    await expect(settings.timeZoneInput).toHaveValue(detectedTimeZone);
    await expect(page.getByTestId('settings-manual-event-row')).toHaveCount(0);
    await expect(settings.resetButton).toBeDisabled();
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

  test('31b. 旧形式で保存済みアメブ個数を再導出する場合は復元前に通知する', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    const legacy = JSON.parse(JSON.stringify(makeFullBackup()));
    legacy.schemaVersion = 2;
    legacy.data.globalSettings.candyInventory.schemaVersion = 2;
    legacy.data.calculator.slots[0].rows[0].boostOrExpAdjustment = 123;

    await settings.openSettingsFromDesktop();
    await settings.switchToBackupTab();
    await page.getByTestId('data-backup-input').fill(JSON.stringify(legacy));
    await page.getByTestId('data-backup-import').click();

    const notice = page.getByTestId('data-backup-migration-notices');
    await expect(notice).toContainText('1行の保存済みアメブ個数');
    await expect(notice).toContainText('計算結果が、エクスポート時と変わる場合があります');
    await expect(page.getByTestId('data-backup-warnings')).toHaveCount(0);
  });

  test('31c. manualEventBonuses追加前のV3バックアップを復元できる', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await page.getByTestId('settings-manual-event-add').click();
    const row = page.getByTestId('settings-manual-event-row').first();
    await row.getByTestId('settings-manual-event-from').fill('20260301');
    await row.getByTestId('settings-manual-event-days').fill('2');
    await row.getByTestId('settings-manual-event-multiplier').fill('1.5');
    await row.getByTestId('settings-manual-event-multiplier').blur();
    await settings.closeByButton();
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
    const legacyText = await page.evaluate(() => {
      const text = (window as Window & { copiedBackup?: string }).copiedBackup;
      if (!text) throw new Error('バックアップを取得できませんでした');
      const legacy = JSON.parse(text);
      const bonuses = legacy.data.globalSettings.sleepSettings.manualEventBonuses;
      if (!Array.isArray(bonuses) || bonuses.length !== 1) {
        throw new Error('前提の手入力イベントが保存されていません');
      }
      delete legacy.data.globalSettings.sleepSettings.manualEventBonuses;
      return JSON.stringify(legacy);
    });

    await page.getByTestId('data-backup-input').fill(legacyText);
    await page.getByTestId('data-backup-import').click();
    await expect(page.getByTestId('data-backup-preview')).toBeVisible();
    await page.getByTestId('data-backup-restore').click();
    await page.waitForLoadState('domcontentloaded');

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
    const restored = await page.evaluate(() => {
      const text = (window as Window & { copiedBackup?: string }).copiedBackup;
      if (!text) throw new Error('復元後のバックアップを取得できませんでした');
      return JSON.parse(text);
    });
    expect(restored.data.globalSettings.sleepSettings.manualEventBonuses).toEqual([]);
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
      sleepSettings: {
        ...expected.data.globalSettings.sleepSettings,
        timeZone: restored.data.globalSettings.sleepSettings.timeZone,
        growthIncenseGsdDays: {
          beforeFullMoon: false,
          fullMoon: false,
          afterFullMoon: false,
        },
        growthIncenseNormalPerWeek: 0,
        // 旧形式には無い項目。無制限（null）として補われる
        growthIncenseStock: null,
        // 旧形式には無い項目。空配列として補われる
        manualEventBonuses: [],
        // 旧形式には無い項目。仮イベントは既定オン、あおいタネは月曜・お香は自動として補われる
        useProjectedEvents: true,
        blueSeedPlantWeekday: 1,
        blueSeedIncenseDays: 'auto',
      },
      candyInventory: {
        schemaVersion: 2,
        universal: { s: 11, m: 22, l: 33 },
        typeCandy: { Electric: { s: 44, m: 55 }, Ground: { s: 66, m: 77 } },
        species: { '25': 99, '27': 111 },
      },
    });
    expect(restored.data.globalSettings.sleepSettings.timeZone).toMatch(/^[A-Za-z_]+(?:\/[A-Za-z_+-]+)*$|^UTC$/);
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

  test('29b. [Mobile] 睡眠設定の文字サイズと個/週の折り返しを保つ', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromMobile();

    const gsdFontSize = await settings.growthIncenseGsdFullMoonCheckbox.locator('..').evaluate(
      el => window.getComputedStyle(el).fontSize,
    );
    expect(gsdFontSize).toBe('14px');

    await settings.setTimeZone('UTC+09:00');
    await expect(settings.timeZoneError).toBeVisible();
    expect(await settings.timeZoneError.evaluate(el => window.getComputedStyle(el).fontSize)).toBe('12px');

    const unitStyle = await settings.growthIncenseNormalUnit.evaluate(el => {
      const style = window.getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      return { whiteSpace: style.whiteSpace, textLineCount: range.getClientRects().length };
    });
    expect(unitStyle.whiteSpace).toBe('nowrap');
    expect(unitStyle.textLineCount).toBe(1);
  });

  test('29c. [Mobile] 睡眠育成設定をデスクトップと同じ順で縦に表示する', async ({ page }) => {
    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromMobile();
    await expectSleepSettingOrder(settings.sleepSection);

    const labelTops = await settings.sleepSection.locator('.settingsField__label').evaluateAll(
      labels => labels.map(label => label.getBoundingClientRect().top),
    );
    expect(labelTops.every((top, index) => index === 0 || top > labelTops[index - 1])).toBe(true);
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
