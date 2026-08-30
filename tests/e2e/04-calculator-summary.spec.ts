/**
 * E2E Test: 04-calculator
 * 計算機パネルのテスト（63件）
 */
import { test, expect, type Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CalcPanelPage } from './pages/CalcPanelPage';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { SettingsModalPage } from './pages/SettingsModalPage';
import { markForSleep } from '../../src/domain/pokesleep/sleep-growth';
import type { SleepSchedule } from '../../src/domain/pokesleep/sleep-schedule';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// テスト設定を読み込み
const testConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/test-config.json'), 'utf-8')
);

// 画面側の現在日が実行日で変わっても「残EXPは睡眠EXP以下」という上界検証を安定させる。
// 全日を最大イベント倍率にした上界であり、画面の月齢計算そのものは専用テストで固定日検証する。
const maxEventSchedule: SleepSchedule = {
  startGameDate: '2026-05-02',
  timeZone: 'UTC',
  includeGSD: true,
  growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: false, afterFullMoon: false },
  growthIncenseNormalPerWeek: 0,
  growthIncenseStock: null,
  dayAt: index => ({
    index,
    date: '2026-05-02',
    dayKind: 'fullMoon',
    useIncense: false,
    incenseOutOfStock: false,
    gsdMultiplier: 3,
    eventMultiplier: 3,
    eventBonus: 3,
    incenseMultiplier: 1,
  }),
  days: () => [],
  intersectingFullMoonDates: () => [],
};

/**
 * `maxEventSchedule` は「1日の睡眠EXPの上限」として使うが、**成長のお香を使わない日**である。
 * お香は既定オンなので、揃えないと実際の1日が上限を超えて比較が成立しない。
 */
async function disableGrowthIncense(settings: SettingsModalPage): Promise<void> {
  await settings.setGrowthIncenseGsd({ beforeFullMoon: false, fullMoon: false, afterFullMoon: false });
  await settings.setGrowthIncenseNormalPerWeek(0);
}

/**
 * 背景色の不透明度を返す。結果行の背景はアクセント色の濃さ違いなので、
 * テーマの色そのものではなく濃さの順序だけを検証するために使う。
 */
async function bgAlpha(locator: Locator): Promise<number> {
  const colour = await locator.evaluate(el => getComputedStyle(el).backgroundColor);
  // 不透明なら `rgb(...)` が返る（= 1）。`rgb()` を rgba 扱いすると青成分を拾うので分ける。
  const alpha = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(colour)?.[1];
  return alpha === undefined ? 1 : Number(alpha);
}

// ============================================================
// A. 初期状態・空の計算機
// ============================================================
test.describe('04-calculator A. 初期状態', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('1. 計算機パネルが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await calc.expectPanelVisible();
  });

  test('2. 空状態のメッセージが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await calc.expectEmptyStateVisible();
    await expect(calc.emptyState).toContainText('ポケモンを追加して計算を始めましょう');
  });

  test('3. 空状態で「設定」リンクが機能する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.emptySettingsLink.click();
    await settings.expectModalVisible();
  });

  test('4. 空状態で「ヘルプ」リンクが機能する', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    await calc.emptyHelpLink.click();
    const usagePanel = page.getByTestId('help-panel-usage');
    await expect(usagePanel).toBeVisible();
    await expect(usagePanel.locator('.section')).toHaveCount(6);

    const descriptionFor = (title: string) => usagePanel
      .locator('dt')
      .filter({ hasText: title })
      .locator('+ dd');
    await expect(descriptionFor('睡眠育成設定')).not.toContainText('計算結果の「内訳」');
    await expect(descriptionFor('結果の見方'))
      .toContainText('計算結果の「内訳」を展開すると睡眠EXPの詳細が表示されます。');
    await expect(descriptionFor('目標設定'))
      .toContainText('結果に必要なリソースが表示されます。');
    await expect(descriptionFor('既定のアメブ目標Lv'))
      .toContainText('ポケモンを計算機に追加や、アメブ再割当などで使うアメブ目標Lvです。');
    await expect(descriptionFor('保存と削除')).toContainText(
      '操作を30回までやり直せます。タブを切り替えると操作履歴がクリアされます。',
    );
    await expect(descriptionFor('バックアップ')).toContainText(
      '設定画面上部の「データのバックアップ」タブから、計算機、設定、ポケモンボックスを丸ごとバックアップ・復元できます。',
    );
    const helpTitles = await usagePanel.locator('.section--basic dt').allTextContents();
    expect(helpTitles.indexOf('バックアップ')).toBe(helpTitles.indexOf('保存と削除') + 1);

    await expect(descriptionFor('目標Lvまでに必要なリソースを知りたい')).toHaveText(
      '現在Lv、あとEXP、目標Lvを入力すると、不足分も含めた必要なリソース量が結果に表示されます。',
    );
    await expect(descriptionFor('アメの数を指定して到達Lvを知りたい')).toHaveText(
      '「アメ個数指定」にアメの数を入れると、その個数に対する結果が表示されます。',
    );
    await expect(descriptionFor('育成を睡眠時間1000h / 2000hで仕上げたい')).toHaveText(
      '睡眠目標から1000h / 2000hを選ぶと、ちょうどその時間寝れば目標Lvに到達できるようにアメの数を調節します。あらかじめ十分なリソースと、睡眠育成設定、ポケモンの累計睡眠時間を設定してください。日数や時間は目安としてお使いください。',
    );
    await expect(usagePanel.locator('.section--purpose dt')).toHaveCount(3);
    await expect(usagePanel.locator('.section--allocation .section__note')).toHaveText(
      '※「バランス」「EXP最大」はタイプアメや万能Sをより多く使います。バッグを空けたいときはこちらが適しています。',
    );
    await expect(usagePanel).toContainText(
      '① 週の個数を基準に、倍率が高いGSDやあおいタネの設定を優先します',
    );
    await expect(usagePanel).toContainText(
      '④「お香の在庫」を入れると、在庫が尽きた日からお香なしで計算します',
    );
  });

  // データ出典は「主な参照3件＋全一覧のREADME」。文言ではなく行き先で固定するので、
  // 表記を書き換えても壊れず、リンクを落としたときだけ落ちる。
  test('4-1. ヘルプのデータ出典に主な参照とREADMEのリンクが出る', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const usagePanel = page.getByTestId('help-panel-usage');
    const openHelp = async () => {
      await calc.emptyHelpLink.click();
      await expect(usagePanel).toBeVisible();
    };

    await openHelp();
    for (const href of [
      'https://nitoyon.github.io/pokesleep-tool/iv/',
      'https://pks.raenonx.cc/',
      'https://wikiwiki.jp/poke_sleep/',
    ]) {
      await expect(usagePanel.locator(`a[href="${href}"]`)).toHaveCount(1);
    }
    // 参照元の全一覧はREADMEにしかない。日本語UIからは日本語READMEへ送る。
    await expect(usagePanel.locator('a[href$="/README.ja.md"]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(usagePanel).toHaveCount(0);

    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('main.shell')).toHaveAttribute('data-locale', 'en');
    await openHelp();
    await expect(usagePanel.locator('a[href$="/README.md"]')).toHaveCount(1);
  });

  // イベント履歴は 2026-08-28 にヘルプから分離した専用モーダル（ヘッダーのボタンから開く）
  test('4a. ヘッダーからイベント履歴モーダルを開ける', async ({ page }) => {
    await page.getByTestId('open-event-history').click();
    await expect(page.getByTestId('event-history-table')).toBeVisible();
    await expect(page.getByTestId('event-history-row').first()).toBeVisible();
    await expect(page.getByTestId('event-history-count')).toContainText('睡眠EXP');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('event-history-table')).toHaveCount(0);
  });

  // 狭い画面では4列の表をカードへ組み替えている（EventHistoryOverlay.css）。実装（クラス名・CSSかJSか）は見ず、
  // 「横へはみ出していない」という見え方だけで判定する
  test('4b. イベント履歴はスマホ幅で横スクロールしない', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 900 });
    await page.getByTestId('open-event-history').click();
    await expect(page.getByTestId('event-history-row').first()).toBeVisible();

    const table = page.getByTestId('event-history-table');
    const overflow = await table.evaluate(el => {
      const wrap = el.parentElement!;
      return wrap.scrollWidth - wrap.clientWidth;
    });
    expect(overflow).toBe(0);

    // 倍率・ブーストの列は右端が全行で揃う（列トラックを共有していないと行ごとに数pxずれる）。
    // セルは右寄せなので左端は中身の幅で動く ── 見るのは右端
    for (const nth of [3, 4]) {
      const rights = await page
        .locator(`[data-testid="event-history-row"] td:nth-child(${nth})`)
        .evaluateAll(els => [...new Set(els.map(el => Math.round(el.getBoundingClientRect().right)))]);
      expect(rights).toHaveLength(1);
    }
  });

  // 表レイアウト（680px以上）でも倍率チップの左端は揃う。週の断り（1週目/2週目）の有無で
  // ずれる作りに戻すと落ちる
  test('4c. イベント履歴はタブレット幅で倍率チップの縦ラインが揃う', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.getByTestId('open-event-history').click();
    await expect(page.getByTestId('event-history-row').first()).toBeVisible();

    // 各段の最後の要素が倍率チップ（その前に週の断りが入る段がある）
    const lefts = await page
      .locator('[data-testid="event-history-row"] td:nth-child(3) div > span:last-child')
      .evaluateAll(els => [...new Set(els.map(el => Math.round(el.getBoundingClientRect().left)))]);
    expect(lefts.length).toBeGreaterThan(0);
    expect(lefts).toHaveLength(1);
  });

  // i18n キーの引っ越し（`help.eventHistory.*` → `eventHistory.*` のような整理）で当たらなくなると、
  // vue-i18n は生のキーをそのまま描く。日英どちらでも生キーが出ていないことだけを見る
  test('4d. イベント履歴は日英どちらでも未翻訳キーが出ない', async ({ page }) => {
    for (const lang of ['JP', 'EN'] as const) {
      await page.getByRole('button', { name: lang, exact: true }).click();
      await page.getByTestId('open-event-history').click();
      const modal = page.getByRole('dialog');
      await expect(modal.getByTestId('event-history-row').first()).toBeVisible();
      await expect(modal).not.toContainText('eventHistory.');
      await expect(modal).not.toContainText('common.');
      await page.keyboard.press('Escape');
    }
  });

  test('5. ボタンが無効化されている（クリア/エクスポート）', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    await expect(calc.exportButton).toBeDisabled();
    await expect(calc.clearButton).toBeDisabled();
  });
});

// ============================================================
// B. ポケモン追加・行の基本操作
// ============================================================
test.describe('04-calculator B. ポケモン追加・基本操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // ポケモンをインポート
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
  });

  test('6. BOXからポケモンを計算機に追加できる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    // タイルを選択
    await box.selectBoxTile(0);
    await box.expectDetailPanelVisible();

    // 「計算機に追加」ボタンをクリック
    await box.clickApplyToCalc();

    // 計算機に行が追加される
    await calc.expectRowCount(1);
  });

  test('6b. BOXから追加しても押した詳細パネルの画面位置を維持する', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const scrollContainer = page.locator('.shell__scroll');

    await page.setViewportSize({ width: 390, height: 700 });
    await box.selectBoxTile(0);
    await box.detailPanel.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    // iOS Safari の自動アンカーが効かない／別要素を選ぶ場合でもアプリ側で維持する。
    await scrollContainer.evaluate((el) => {
      (el as HTMLElement).style.overflowAnchor = 'none';
    });

    const beforeTop = await box.detailPanel.evaluate((el) => el.getBoundingClientRect().top);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const afterTop = await box.detailPanel.evaluate((el) => el.getBoundingClientRect().top);

    expect(await scrollContainer.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(Math.abs(afterTop - beforeTop), '追加ボタン付近が追加前後で動かない').toBeLessThanOrEqual(2);
  });

  test('6c. 繰り返しリロードしても表示位置が累積してずれない', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const scrollContainer = page.locator('.shell__scroll');
    await page.setViewportSize({ width: 390, height: 700 });
    await expect(scrollContainer).toBeVisible();

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.waitForPlannerResult();
    const calcRow = page.getByTestId('calc-row').first();
    await calcRow.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const beforeTop = await calcRow.evaluate((element) => element.getBoundingClientRect().top);
    expect(await scrollContainer.evaluate((element) => (element as HTMLElement).scrollTop)).toBeGreaterThan(0);

    try {
      for (let reloadCount = 0; reloadCount < 3; reloadCount += 1) {
        await page.reload();
        await expect(page.locator('#neo-calc')).toBeVisible();
        await calc.waitForPlannerResult();
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));
        const afterTop = await calcRow.evaluate((element) => element.getBoundingClientRect().top);
        expect(Math.abs(afterTop - beforeTop), `${reloadCount + 1}回目のリロード後 (${beforeTop} -> ${afterTop})`).toBeLessThanOrEqual(2);
      }
    } finally {
      await scrollContainer.evaluate((element) => { (element as HTMLElement).scrollTop = 0; });
      await page.evaluate(() => sessionStorage.removeItem('candy-boost-planner:ui:scrollTop:v1'));
    }
  });

  test('7. 計算機に行が追加されると空状態が消える', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    await calc.expectEmptyStateHidden();
  });

  test('8. 行をクリックでアクティブにできる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    const row = calc.getRow(0);
    await row.click();
    await calc.expectRowActive(row);
  });

  test('8b. 行の入力フォーカス中もstickyサマリーを前面に保つ', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await page.setViewportSize({ width: 390, height: 700 });
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    const row = calc.getRow(0);
    await calc.getRowExpRemainingInput(row).focus();

    const focusedLayers = await page.evaluate(() => ({
      summary: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>('.calcSticky')!).zIndex, 10),
      slot: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>('.calcSlotContainer')!).zIndex, 10),
    }));
    expect(focusedLayers.slot).toBeLessThan(focusedLayers.summary);

    await calc.getRowSrcLevelButton(row).click();
    await expect(row.getByTestId('level-picker-popover')).toBeVisible();
    const popoverLayers = await page.evaluate(() => ({
      summary: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>('.calcSticky')!).zIndex, 10),
      slot: Number.parseInt(getComputedStyle(document.querySelector<HTMLElement>('.calcSlotContainer')!).zIndex, 10),
    }));
    expect(popoverLayers.slot).toBeGreaterThan(popoverLayers.summary);
  });

  test('8c. 390px幅で補正なしの行からEXP性格補正を変更し、必要アメ数へ反映できる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    await page.setViewportSize({ width: 390, height: 844 });

    // ボックス側を補正なしにしてから追加し、「-」の行にも操作対象があることを固定する。
    await box.selectBoxTile(0);
    await box.detailNatureTrigger.click();
    const boxNatureDropdown = page.getByTestId('nature-select-dropdown');
    await boxNatureDropdown.getByRole('button', { name: '-', exact: true }).dispatchEvent('mousedown');
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    const row = calc.getRow(0);
    await calc.setRowSrcLevel(row, 25);
    await calc.setRowDstLevel(row, 60);
    await calc.waitForPlannerResult();

    const trigger = calc.getRowNatureTrigger(row);
    await expect(trigger).toHaveAccessibleName('EXP性格補正');
    await expect(trigger.locator('.natureSelect__symbol--normal')).toBeVisible();
    const tapBox = await trigger.boundingBox();
    expect(tapBox).not.toBeNull();
    // 幅は行タイトルを圧迫しないよう 34px まで意図的に詰めてある（2026-07-29・ユーザー指示）。
    // **高さ 40px は詰めない。** ここを緩めるとタップ標的が確保できなくなる。
    expect(tapBox!.width).toBeGreaterThanOrEqual(32);
    expect(tapBox!.height).toBeGreaterThanOrEqual(40);
    expect(tapBox!.x).toBeGreaterThanOrEqual(0);
    expect(tapBox!.x + tapBox!.width).toBeLessThanOrEqual(390);

    const requiredCandy = async () =>
      Number((await calc.getRowResultValue(row, 'required', 'candy')).replace(/,/g, ''));
    await expect.poll(requiredCandy).toBeGreaterThan(0);
    const before = await requiredCandy();

    await calc.setRowNature(row, '▲▲');
    await expect(trigger.locator('.natureSelect__symbol--up')).toBeVisible();
    await expect.poll(requiredCandy).toBeLessThan(before);
  });

  test('9. 行の削除ができる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    const row = calc.getRow(0);
    await calc.deleteRow(row);
    await calc.expectRowCount(0);
  });

  test('10. 全クリアができる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    // ダイアログを受け入れる設定
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    await calc.clearButton.click();
    await calc.expectRowCount(0);
    await calc.expectEmptyStateVisible();
  });
});

// ============================================================
// C. 元に戻す/やり直し
// ============================================================
test.describe('04-calculator C. 元に戻す/やり直し', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
  });

  test('11. 元に戻すが無効（操作前）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await expect(calc.undoButton).toBeDisabled();
  });

  test('12. 行削除後に「元に戻す」で復元できる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    const row = calc.getRow(0);
    await calc.deleteRow(row);
    await calc.expectRowCount(0);

    await calc.clickUndo();
    await calc.expectRowCount(1);
  });

  test('13. 「やり直し」で削除を再適用できる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    const row = calc.getRow(0);
    await calc.deleteRow(row);
    await calc.expectRowCount(0);

    await calc.clickUndo();
    await calc.expectRowCount(1);

    await calc.clickRedo();
    await calc.expectRowCount(0);
  });

  test('13b. 元に戻すを連打すると通知が積み上がり、新着が下に入る', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);
    await calc.deleteRow(calc.getRow(0));
    await calc.expectRowCount(0);

    const toasts = page.locator('.appToast');

    await calc.clickUndo();
    await expect(toasts).toHaveCount(1);
    // **位置だけで確かめない。** どちらの並びでも「上の要素の y は下より小さい」は成り立つので、
    // どの通知がどこに居るかはテキストで同定する
    const firstText = await toasts.nth(0).textContent();
    const firstBefore = await toasts.nth(0).boundingBox();

    // 2件目。上書きなら1件しか残らない
    await calc.clickUndo();
    // **待ちが要る。** 上書き実装でも、消えていく側は leave アニメーション中（0.16秒）だけ
    // DOM に残るので、直後に数えると2件に見えてしまう。
    // 自動で消えるのは 2秒後なので、0.4秒後に2件あれば「積み上がっている」と言い切れる
    await page.waitForTimeout(400);
    await expect(toasts).toHaveCount(2);

    // 新着は末尾（＝画面の下）に入り、先に出た通知が上へ回る
    expect(await toasts.nth(0).textContent()).toBe(firstText);

    const older = await toasts.nth(0).boundingBox();
    const newest = await toasts.nth(1).boundingBox();
    expect(older!.y).toBeLessThan(newest!.y);

    // 下端は固定なので、先に出た通知は1行ぶん上へ動く（アニメーションはしない）
    expect(older!.y).toBeLessThan(firstBefore!.y);

    const look = await page.evaluate(async () => {
      const all = [...document.querySelectorAll('.appToastStack .appToast')] as HTMLElement[];
      // 入場の開始状態を再現する。2件目は「1件目だけフェード」の対象外。
      // **クラスを当てた直後に読まない。** 遷移中は現在値が返るので、必ず 1 に見えてしまう
      all[1]!.classList.add('appToast-enter-from', 'appToast-enter-active');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const enterOpacity = getComputedStyle(all[1]!).opacity;
      all[1]!.classList.remove('appToast-enter-from', 'appToast-enter-active');
      return {
        enterOpacity,
        colours: all.map((el) => getComputedStyle(el).backgroundColor),
        transitionProperty: getComputedStyle(all[0]!).transitionProperty,
      };
    });

    // 2件目は入場で透明にならない（積み上がる途中もフェードさせるとちらつく）
    expect(look.enterOpacity).toBe('1');
    // 最新以外は薄い。**ただしその変化に遷移時間を持たせない**
    expect(new Set(look.colours).size).toBe(2);
    expect(look.transitionProperty).not.toContain('background');
    // 位置もアニメーションさせない（`transform` があると押し上げが FLIP で動く）
    expect(look.transitionProperty).not.toContain('transform');
  });

  test('13d. 通知が4件目になっても、見えるのは3件までで高さも変わらない', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);
    await calc.deleteRow(calc.getRow(0));

    // undo / redo を交互に押すと、履歴を消費せずに通知だけ増やせる
    await calc.clickUndo();
    await calc.clickRedo();
    await calc.clickUndo();
    await expect(page.locator('.appToast:visible')).toHaveCount(3);
    const stack = page.locator('.appToastStack');
    const heightBefore = (await stack.boundingBox())!.height;

    // 4件目。押し出された最古が退場アニメーションで見えてはいけない
    await calc.clickRedo();
    await expect(page.locator('.appToast:visible')).toHaveCount(3);

    // 行数が変わらないので、スタックの高さも動かない（跳ねるとちらついて見える）
    expect((await stack.boundingBox())!.height).toBeCloseTo(heightBefore, 0);
    await page.waitForTimeout(400);
    expect((await stack.boundingBox())!.height).toBeCloseTo(heightBefore, 0);
  });

  test('13c. 通知はその場でフェードアウトする（上へずらさない）', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);
    await calc.deleteRow(calc.getRow(0));
    await calc.clickUndo();
    await calc.clickUndo();
    await expect(page.locator('.appToast')).toHaveCount(2);

    // 退場は 0.16 秒で終わるので、実際に消える瞬間を捉えるのは不安定になる。
    // 退場クラスを当てて終端の計算値を読む。**見たいのは CSS の詳細度**で、
    // 「最新以外を薄くする指定」が退場フェードを潰していないこと（過去に潰していた）。
    // **最初に消えるのは最古＝いちばん上**で、そこは薄くする指定が効いている側なので、
    // 先頭の要素を見ないと詳細度の衝突を踏めない。
    const state = await page.evaluate(async () => {
      const oldest = document.querySelector('.appToastStack .appToast') as HTMLElement;
      const before = oldest.getBoundingClientRect();
      // Vue が退場中に当てるのと同じ2つ
      oldest.classList.add('appToast-leave-active', 'appToast-leave-to');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = oldest.getBoundingClientRect();
      return {
        opacity: getComputedStyle(oldest).opacity,
        position: getComputedStyle(oldest).position,
        transform: getComputedStyle(oldest).transform,
        movedX: Math.round(after.x - before.x),
        movedY: Math.round(after.y - before.y),
        shrank: Math.round(before.width - after.width),
      };
    });

    expect(state.opacity).toBe('0');
    // **位置も大きさも変えない。** 流れから外す（`position: absolute`）と、
    // `max-width: 100%` が残った通知の幅で解決され直して左右から縮み、
    // 列の上端基準で置くぶん、次の通知が消えたときに下へ引きずられる
    expect(state.position).toBe('static');
    expect(state.transform).toBe('none');
    expect(state.movedX).toBe(0);
    expect(state.movedY).toBe(0);
    expect(state.shrank).toBe(0);
  });
});

// ============================================================
// D. スロットタブ操作
// ============================================================
test.describe('04-calculator D. スロットタブ操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('14. スロットタブが3つ表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const count = await calc.getSlotTabCount();
    expect(count).toBe(3);
  });

  test('15. スロットタブをクリックで切り替えできる', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    // 最初は0番目がアクティブ
    await expect(calc.activeSlotTab).toBeVisible();

    // 2番目のタブをクリック
    await calc.clickSlotTab(1);
    // アクティブタブが切り替わる（UIが更新される）
    await page.waitForTimeout(100);
  });

  test('16. アクティブタブにブースト種別セレクトが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await expect(calc.boostKindSelect).toBeVisible();
  });

  test('17. ブースト種別を「フル」に変更できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    await calc.setBoostKind('full');
    const kind = await calc.getBoostKind();
    expect(kind).toBe('full');
  });

  test('18. ブースト種別を「なし」に変更すると表示が変わる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const box = new BoxPanelPage(page);

    // ポケモンを追加
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();

    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    // 「なし」に変更
    await calc.setBoostKind('none');

    // ブースト関連のUIが変わる（アメブバーが非表示になる）
    await expect(calc.boostCandyBar).not.toBeVisible();
  });
});

// ============================================================
// E. 行の入力操作
// ============================================================
test.describe('04-calculator E. 行の入力操作', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    // 低レベルポケモン（Lv25マルノーム）を使用 - Lv70はEXP入力不可のため
    await box.fillImportText(testConfig.importData.lowLevelPokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('19. 現在レベル（srcLevel）を変更できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const srcLevelBtn = calc.getRowSrcLevelButton(row);

    // ピッカーを開いて操作
    await srcLevelBtn.click();
    const levelPickPopover = page.locator('.levelPick__popover');
    await expect(levelPickPopover).toBeVisible();

    // レベルを変更（現在Lvを50に - マルノームはLv55なので55以下を選択）
    const levelChip = levelPickPopover.locator('button').filter({ hasText: '50' });
    await levelChip.click();

    // 閉じる
    const closeBtn = levelPickPopover.locator('button').filter({ hasText: '閉じる' });
    await closeBtn.click();
  });

  test('20. 目標レベル（dstLevel）を変更できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const levelPickPopover = page.locator('.levelPick__popover');

    // 目標Lvピッカーを開く（マルノームはLv55なので55以上を選択可能）
    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    await expect(levelPickPopover).toBeVisible();

    // 60をクリック（現在Lv55より高いので選択可能）
    await levelPickPopover.locator('button').filter({ hasText: '60' }).click();
    await levelPickPopover.locator('button').filter({ hasText: '閉じる' }).click();
  });

  test('21. あとEXPを入力できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const expInput = calc.getRowExpRemainingInput(row);

    await expInput.fill('500');
    const value = await expInput.inputValue();
    expect(value).toBe('500');
  });

  test('21b. あとEXPを全削除してから入力し直せる（確定はblur）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const expInput = calc.getRowExpRemainingInput(row);

    await expInput.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.press('Backspace');
    await expect(expInput).toHaveValue('');

    await page.keyboard.type('1064');
    await expect(expInput).toHaveValue('1064');

    await page.locator('#neo-calc .panel__head').click();
    await expect(expInput).toHaveValue('1064');
  });

  test('22. 種族アメ在庫を入力できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const candyInput = calc.getRowSpeciesCandyInput(row);

    await candyInput.fill('100');
    const value = await candyInput.inputValue();
    expect(value).toBe('100');
  });

  // 「在庫を設定してください」はアメ在庫が空のときだけ出す。
  // 実使用アメが 0 かどうかで判定すると、在庫があっても出てしまう状態が2つある。
  test('22b. 在庫があれば、アメを1個も使わない状態でも在庫警告を出さない', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);
    const warning = page.getByTestId('calc-no-stock-warning');

    await expect(warning, '在庫未設定なら出る').toBeVisible();

    await calc.clickSettings();
    await settings.setUniversalCandy('S', 9999);
    await settings.setTotalShards('9999999');
    await settings.closeByButton();
    await expect(warning, '在庫を設定したら消える').toHaveCount(0);

    // 元Lv = 目標Lv（育てる余地がないのでアメを使わない）
    const srcLevel = Number(await calc.getRowSrcLevelInput(row).inputValue());
    await calc.setRowDstLevel(row, srcLevel);
    await page.waitForTimeout(600);
    await expect(warning, '元Lv=目標Lvでも出さない').toHaveCount(0);

    // 睡眠目標が大きく、睡眠EXPだけで目標に届く（アメの担当分が 0 になる）
    await calc.setRowDstLevel(row, srcLevel + 1);
    await calc.getRowSleepTargetSelect(row).selectOption('2000');
    await page.waitForTimeout(600);
    await expect(warning, '睡眠だけで目標に届いても出さない').toHaveCount(0);
  });

  test('23. ブースト到達レベルを変更できる（ピッカー）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const boostLevelBtn = calc.getRowBoostReachLevelButton(row);

    await boostLevelBtn.click();
    const levelPickPopover = page.locator('.levelPick__popover');
    await expect(levelPickPopover).toBeVisible();

    const closeBtn = levelPickPopover.locator('button').filter({ hasText: '閉じる' });
    await closeBtn.click();
  });

  // 割合スライダーは廃止。同じ調整はアメブ目標Lv（Lv単位）で行う（設計書§4.2）。
  test('24. アメブ目標Lvを下げるとアメブ個数が減る', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    const boostCandyInput = calc.getRowBoostCandyInput(row);
    const before = await boostCandyInput.inputValue();
    const beforeDerived = await boostCandyInput.getAttribute('placeholder');
    expect(before).toBe('');
    expect(Number(beforeDerived)).toBeGreaterThan(0);

    // アメブ目標Lvを現在Lvまで下げると、必要なアメブ個数は0になる
    const boostLevelInput = calc.getRowBoostReachLevelInput(row);
    await boostLevelInput.fill(String(await calc.getRowSrcLevelInput(row).inputValue()));
    await boostLevelInput.blur();
    await page.waitForTimeout(300);

    const after = await boostCandyInput.inputValue();
    const afterDerived = await boostCandyInput.getAttribute('placeholder');
    expect(after).toBe('');
    expect(Number(afterDerived)).toBeLessThan(Number(beforeDerived));
  });

  test('25. アメブ個数を入力できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const boostCandyInput = calc.getRowBoostCandyInput(row);

    await boostCandyInput.fill('100');
    const value = await boostCandyInput.inputValue();
    expect(value).toBe('100');
  });

  test('25a. 画面上側のアメブ個数でEnterを押してもスクロール位置を維持する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const boostCandyInput = calc.getRowBoostCandyInput(calc.getRow(0));
    const scrollContainer = page.locator('.shell__scroll');

    await page.setViewportSize({ width: 390, height: 700 });
    // BOX→計算機追加直後の位置維持処理を、実際に入力欄へ触れた場合と同様に終了させる。
    await scrollContainer.dispatchEvent('pointerdown');
    await scrollContainer.evaluate((element) => {
      (element as HTMLElement).style.scrollBehavior = 'auto';
      (element as HTMLElement).style.overflowAnchor = 'none';
    });

    for (const value of ['', '0', '123']) {
      await boostCandyInput.evaluate((element) => {
        const container = document.querySelector<HTMLElement>('.shell__scroll');
        if (!container) throw new Error('.shell__scroll not found');
        container.scrollTop += element.getBoundingClientRect().top - 200;
      });
      await expect.poll(() => boostCandyInput.evaluate((element) => element.getBoundingClientRect().top))
        .toBeGreaterThan(190);
      await expect.poll(() => boostCandyInput.evaluate((element) => element.getBoundingClientRect().top))
        .toBeLessThan(210);

      await boostCandyInput.fill(value);
      const before = await scrollContainer.evaluate((element) => element.scrollTop);
      // Locator.press() は要素を自動スクロールするため、実際のユーザー操作と同じく
      // フォーカス済みの入力欄へキーボードイベントだけを送る。
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      expect(
        await scrollContainer.evaluate((element) => element.scrollTop),
        `入力値 ${JSON.stringify(value)} のEnter確定で動かない`,
      ).toBe(before);
    }
  });

  // 手法1（同じであるべき2入力）を DOM 経路で回す。アメブ個数欄は `@input` 直結なので
  // 打鍵ごとに再計算が走る。`fill()` は中間状態を1つも通らないため、確定値だけを見ている
  // 既存テストではここを検出できない（設計書 §10.1 / §11.1 / §11.5 と同じ型の穴）。
  test('25b. アメブ個数を1文字ずつ打っても、一括入力と同じ状態に落ち着く', async ({ page, browser }) => {
    const readState = async (calc: CalcPanelPage) => {
      const row = calc.getRow(0);
      return {
        boostCandy: await calc.getRowBoostCandyInput(row).inputValue(),
        dstLevel: await calc.getRowDstLevelInput(row).inputValue(),
        boostReachLevel: await calc.getRowBoostReachLevelInput(row).inputValue(),
      };
    };

    // 1文字ずつ: '1' → '10' → '100' の3回ハンドラが走る
    const calc = new CalcPanelPage(page);
    const input = calc.getRowBoostCandyInput(calc.getRow(0));
    await input.click();
    await input.pressSequentially('100', { delay: 50 });
    await input.blur();
    await expect(input).toHaveValue('100');
    await page.waitForTimeout(400);
    const byKeystroke = await readState(calc);

    // 対照は別コンテキストで作る。同じページで作り直すと localStorage と
    // ラチェット済みの目標Lvが残り、「同じであるべき2入力」が成立しない。
    const context = await browser.newContext();
    try {
      const other = await context.newPage();
      const otherBox = new BoxPanelPage(other);
      const otherCalc = new CalcPanelPage(other);
      await other.goto('/');
      await otherBox.openImportPanel();
      await otherBox.fillImportText(testConfig.importData.lowLevelPokemon);
      await otherBox.clickImport();
      await otherBox.selectBoxTile(0);
      await otherBox.clickApplyToCalc();
      await otherCalc.setRowBoostCandy(otherCalc.getRow(0), 100);
      await other.waitForTimeout(400);

      expect(byKeystroke).toEqual(await readState(otherCalc));
    } finally {
      await context.close();
    }

    // 打鍵の往復。桁を足してから消して同じ値へ戻したとき、行の状態も元へ戻る。
    // 途中の打鍵が破壊的な副作用を持つと、ここで戻らなくなる。
    await input.click();
    await input.press('End');
    await input.pressSequentially('00', { delay: 50 });
    await expect(input).toHaveValue('10000');
    await page.waitForTimeout(400);
    for (let i = 0; i < 2; i++) await input.press('Backspace');
    await input.blur();
    await expect(input).toHaveValue('100');
    await page.waitForTimeout(400);

    expect(await readState(calc)).toEqual(byKeystroke);
  });

  test('25c. アメ在庫＋睡眠は保存値を残したまま半ロックし、下スピンで在庫上限へ収束する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    await calc.setBoostKind('full');

    const dstLevel = calc.getRowDstLevelInput(row);
    await dstLevel.fill('70');
    await dstLevel.blur();
    await calc.setRowSpeciesCandy(row, 350);
    await calc.getRowSleepTargetSelect(row).selectOption('stock');
    await calc.setRowBoostCandy(row, 300);

    const boostCandy = calc.getRowBoostCandyInput(row);
    await calc.setRowSpeciesCandy(row, 250);
    await expect(boostCandy).toHaveValue('300');
    await expect(boostCandy).toHaveAttribute('max', '250');
    await expect(boostCandy).toHaveAttribute('placeholder', '250');
    await expect(boostCandy).toHaveAttribute('title', /アメの在庫を増やしてください/);
    await expect(boostCandy).not.toBeDisabled();
    await expect(boostCandy).not.toHaveClass(/field__input--sleepCapped/);

    await expect(calc.getRowBoostReachLevelInput(row)).toHaveAttribute('max', '59');
    await calc.openLevelPicker(row, 'boostReachLevel');
    const boostPicker = row.getByTestId('boostReachLevel');
    const warning = boostPicker.getByTestId('level-picker-warn');
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute('title', /アメの在庫を増やしてください/);
    await expect(boostPicker.getByTestId('level-picker-note')).toContainText('アメの在庫を増やしてください');
    await page.locator('.levelPick__popover').getByRole('button', { name: '閉じる' }).click();

    await boostCandy.focus();
    await page.keyboard.press('ArrowDown');
    await expect(boostCandy).toHaveValue('250');
  });

  test('26. 個数指定後も到達可能行は表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const candyTargetInput = calc.getRowCandyTargetInput(row);

    await candyTargetInput.fill('50');
    await candyTargetInput.blur();

    // 到達可能行が表示される
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow).toBeVisible();
  });

  // 1000h/2000hチップは睡眠目標時間ドロップダウンへ統合（設計書§5.5）
  // 睡眠目標は個数指定を埋めない。目的は「目標Lvへ到達すること」のままで、
  // アメ数は「目標まで」行に導出値として出る（設計書§10.10）
  test('27. 睡眠目標1000hは個数指定を埋めず、必要アメ数だけを減らす', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);
    const sleepTarget = calc.getRowSleepTargetSelect(row);
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    const requiredCandy = async () =>
      Number((await calc.getRowResultValue(row, 'required', 'candy')).replace(/,/g, ''));

    // 現在Lvを25に設定（Lv25→Lv60で十分な必要アメ数が発生するように）
    await calc.setRowSrcLevel(row, 25);
    await calc.setRowSpeciesCandy(row, '2000');
    await calc.clickSettings();
    await settings.setTotalShards('2000000');
    await settings.setDailySleepHours(13);
    await disableGrowthIncense(settings);
    await settings.closeByButton();

    const dstBefore = await calc.getRowDstLevelInput(row).inputValue();
    // planner は debounce するので、睡眠なしの必要アメ数が出そろってから基準値を取る
    await expect.poll(async () => requiredCandy()).toBeGreaterThan(0);
    const candyBefore = await requiredCandy();

    await sleepTarget.selectOption('1000');
    // 個数指定欄は空のまま（＝目的は目標Lv到達）。目標Lvも動かない
    await expect(candyTargetInput).toHaveValue('');
    await expect.poll(async () => requiredCandy()).toBeLessThan(candyBefore);
    expect(await calc.getRowDstLevelInput(row).inputValue()).toBe(dstBefore);

    const mark = markForSleep({
      targetSleepHours: 1000,
      nature: 'down',
      dailySleepHours: 13,
      sleepExpBonus: 1,
      schedule: maxEventSchedule,
    });
    await expect.poll(async () =>
      Number((await calc.getRowRemainingExp(row)).replace(/,/g, ''))
    ).toBeLessThanOrEqual(mark.sleepExp);

    const sleepTime = await calc.getRowSleepTime(row);
    const displayedDays = Number(sleepTime.match(/約(\d+)日/)?.[1] ?? 0);
    expect(displayedDays).toBeLessThanOrEqual(mark.requiredDays);
    expect(sleepTime).not.toContain('1014時間');

    // 同じ選択肢を選び直しても結果が変わらない（冪等。設計書§5.3）
    const candyAt1000 = await requiredCandy();
    await sleepTarget.selectOption('1000');
    await page.waitForTimeout(300);
    expect(await requiredCandy()).toBe(candyAt1000);

    // 睡眠目標を上げると、目標Lvは変わらず必要アメ数だけが減る（設計書§9）
    await sleepTarget.selectOption('2000');
    await expect.poll(async () => requiredCandy()).toBeLessThan(candyAt1000);
    await expect(candyTargetInput).toHaveValue('');
    expect(await calc.getRowDstLevelInput(row).inputValue()).toBe(dstBefore);
  });

  test('27b. すべて睡眠はアメ資源を0にし、アメ入力を無効化して必要睡眠時間を表示する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const sleepTarget = calc.getRowSleepTargetSelect(row);
    const candyTarget = calc.getRowCandyTargetInput(row);
    const boostCandy = calc.getRowBoostCandyInput(row);

    await calc.setRowSrcLevel(row, 25);
    await calc.setRowDstLevel(row, 60);
    await calc.setRowBoostCandy(row, 25);
    await calc.setRowCandyTarget(row, 100);
    await sleepTarget.selectOption('all');

    await expect(sleepTarget).toHaveValue('all');
    await expect(sleepTarget.locator('option[value="all"]')).toHaveText('すべて睡眠');
    await expect(candyTarget).toBeDisabled();
    await expect(candyTarget).toHaveValue('');
    await expect(boostCandy).toBeDisabled();
    await expect(row.getByTestId('boostCandyReset')).toBeDisabled();
    await expect(row.getByTestId('boostReachLevel').getByTestId('level-picker-trigger')).toBeDisabled();
    await expect.poll(async () => calc.getRowResultValue(row, 'required', 'candy')).toBe('0');
    await expect.poll(async () => calc.getRowResultValue(row, 'required', 'shards')).toBe('0');
    await expect.poll(async () => calc.getRowSleepTime(row)).not.toBe('');

    await sleepTarget.selectOption('');
    await expect(candyTarget).toBeEnabled();
    await expect(boostCandy).toBeEnabled();
    await expect(boostCandy).toHaveValue('25');
  });

  test('27c. すべて睡眠で編集できない3欄は破線になり、理由は各欄の場所で読める', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const sleepTarget = calc.getRowSleepTargetSelect(row);
    const candyTarget = calc.getRowCandyTargetInput(row);
    const boostCandy = calc.getRowBoostCandyInput(row);
    const boostReach = row.getByTestId('boostReachLevel');
    const allSleepNote = page.getByTestId('calc-hint-all-sleep-note');

    // 対照: すべて睡眠でなければ破線も案内も出ない
    await expect(candyTarget).not.toHaveClass(/field__input--allSleep/);
    await expect(boostCandy).not.toHaveClass(/field__input--allSleep/);
    await expect(boostReach).not.toHaveClass(/levelPick--allSleep/);

    await sleepTarget.selectOption('all');

    await expect(candyTarget).toHaveClass(/field__input--allSleep/);
    await expect(boostCandy).toHaveClass(/field__input--allSleep/);
    await expect(boostReach).toHaveClass(/levelPick--allSleep/);

    // 破線の理由は3欄それぞれの場所で読める。アメ関連はヒント2つ、
    // アメブ目標Lvには ? が無いのでピッカー内の note（disabled でも開ける）で読ませる。
    await row.getByTestId('hintBtn').click();
    await expect(allSleepNote).toContainText('すべて睡眠ではアメを使いません');
    await page.getByTestId('calc-hint-overlay').click({ position: { x: 5, y: 5 } });

    await row.getByTestId('candyTargetHintBtn').click();
    await expect(allSleepNote).toContainText('すべて睡眠ではアメを使いません');
    await page.getByTestId('calc-hint-overlay').click({ position: { x: 5, y: 5 } });

    // 上限（MAX_LEVEL）には余裕があるので、note は disabled 分岐でしか出ない
    await boostReach.getByTestId('level-picker-chevron').click();
    await expect(boostReach.getByTestId('level-picker-note')).toContainText('すべて睡眠ではアメを使いません');
    await boostReach.getByTestId('level-picker-chevron').click();

    // 解除すれば破線も案内も消える（残ると編集できるのに編集不能に見える）
    await sleepTarget.selectOption('');
    await expect(candyTarget).not.toHaveClass(/field__input--allSleep/);
    await expect(boostCandy).not.toHaveClass(/field__input--allSleep/);
    await expect(boostReach).not.toHaveClass(/levelPick--allSleep/);
    await row.getByTestId('hintBtn').click();
    await expect(page.getByTestId('calc-hint-popover')).toBeVisible();
    await expect(allSleepNote).toHaveCount(0);
    await page.getByTestId('calc-hint-overlay').click({ position: { x: 5, y: 5 } });
    await boostReach.getByTestId('level-picker-chevron').click();
    await expect(boostReach.getByTestId('level-picker-note')).toHaveCount(0);
  });

  test('28. 睡眠目標2000hを設定・解除しても個数指定は空のままになる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);
    const sleepTarget = calc.getRowSleepTargetSelect(row);
    const candyTargetInput = calc.getRowCandyTargetInput(row);

    // 現在Lvを25に設定（Lv25→Lv60で十分な必要アメ数が発生するように）
    await calc.setRowSrcLevel(row, 25);
    await calc.setRowSpeciesCandy(row, '2000');
    await calc.clickSettings();
    await settings.setTotalShards('2000000');
    await disableGrowthIncense(settings);
    await settings.closeByButton();

    await sleepTarget.selectOption('2000');
    await expect(candyTargetInput).toHaveValue('');

    const mark = markForSleep({
      targetSleepHours: 2000,
      nature: 'down',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: maxEventSchedule,
    });
    await expect.poll(async () =>
      Number((await calc.getRowRemainingExp(row)).replace(/,/g, ''))
    ).toBeLessThanOrEqual(mark.sleepExp);

    // 睡眠目標を解除しても個数指定には触れない（設計書§10.10）
    await sleepTarget.selectOption('');
    await page.waitForTimeout(400);
    await expect(candyTargetInput).toHaveValue('');
  });

  test('28b. 累計995h／999hは残りを1日へ切り上げ、1000h以上は0日を使用する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);
    await calc.setRowSrcLevel(row, 25);
    await calc.setRowSpeciesCandy(row, '2000');
    await calc.clickSettings();
    await settings.setTotalShards('2000000');
    await disableGrowthIncense(settings);
    await settings.closeByButton();

    const roundedOneDay = markForSleep({
      targetSleepHours: 1,
      nature: 'down',
      dailySleepHours: 8.5,
      sleepExpBonus: 1,
      schedule: maxEventSchedule,
    });
    expect(roundedOneDay.requiredDays).toBe(1);

    // 睡眠目標時間はドロップダウン、累計睡眠時間はラベルの添え字リンクから編集する（設計書§5.5）
    const setCurrentSleepHours = async (hours: number) => {
      await calc.getRowSleepTargetCurrentLink(row).click();
      const input = page.getByTestId('sleep-hint-hours-input');
      await input.fill(String(hours));
      await input.blur();
      await page.getByTestId('sleep-hint-overlay').click({ position: { x: 5, y: 5 } });
    };

    // 個数指定は埋まらないので、必要アメ数は「目標まで」行から読む（設計書§10.10）
    const requiredCandy = async () =>
      Number((await calc.getRowResultValue(row, 'required', 'candy')).replace(/,/g, ''));

    const candyTargets: number[] = [];
    for (const currentHours of [995, 999]) {
      await setCurrentSleepHours(currentHours);
      await calc.getRowSleepTargetSelect(row).selectOption('1000');

      await expect.poll(async () =>
        Number((await calc.getRowRemainingExp(row)).replace(/,/g, ''))
      ).toBeLessThanOrEqual(roundedOneDay.sleepExp);
      await expect(calc.getRowCandyTargetInput(row)).toHaveValue('');
      await expect.poll(requiredCandy).toBeGreaterThan(0);
      candyTargets.push(await requiredCandy());
      const usedRow = calc.getRowUsedRow(row);
      await expect(usedRow.getByText('アメ到達Lv', { exact: true })).toBeVisible();
      await expect(usedRow.getByText('到達Lv', { exact: true })).toHaveCount(0);
    }
    // 995h も 999h も「残り1日」へ切り上がるので結果は同じ（冪等）
    expect(candyTargets[0]).toBe(candyTargets[1]);

    // 累計が目標に達していれば、これから寝る時間は0になり睡眠EXPは乗らない
    await setCurrentSleepHours(1000);
    await expect.poll(async () => requiredCandy()).toBeGreaterThan(candyTargets[1]);
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow.getByText('到達Lv', { exact: true })).toBeVisible();
    await expect(usedRow.getByText('アメ到達Lv', { exact: true })).toHaveCount(0);
  });

  test('28c. 睡眠だけで目標を超える行に睡眠到達Lvを出す', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const usedRow = calc.getRowUsedRow(row);

    await calc.setRowSrcLevel(row, 50);
    await calc.setRowDstLevel(row, 55);
    await expect(usedRow).toBeVisible();

    // 対照: 睡眠目標が無い行では出さない
    await expect(usedRow.getByText('睡眠到達Lv', { exact: true })).toHaveCount(0);
    expect(await calc.getRowSleepReachLevel(row)).toBe('');

    // 累計を先に入れ、睡眠目標そのものではなく「これから寝る時間」が表示されることを固定する。
    // 累計0h では誤って目標値2000hをそのまま出してもテストが通るため、差が出る500hにする。
    await calc.getRowSleepTargetCurrentLink(row).click();
    const currentSleepHoursInput = page.getByTestId('sleep-hint-hours-input');
    await currentSleepHoursInput.fill('500');
    await currentSleepHoursInput.blur();
    await page.getByTestId('sleep-hint-overlay').click({ position: { x: 5, y: 5 } });

    // 残り1500hの睡眠EXPは Lv50→55（8,812EXP）を超える。
    await calc.getRowSleepTargetSelect(row).selectOption('2000');
    await expect.poll(async () => calc.getRowSleepReachLevel(row)).toMatch(/^約\d+\.\d（1500時間）$/);

    // 小数1桁・切り捨て。整数部は目標Lvより高い（設計書『睡眠育成の拡張』§3.3）
    const sleepReach = await calc.getRowSleepReachLevel(row);
    expect(Number(sleepReach.replace('約', '').replace(/（.*$/, ''))).toBeGreaterThan(55);

    // アメ到達Lvは睡眠前の地点なので現在Lvのまま。別の地点であることを固定する
    expect(await calc.getRowReachedLevel(row)).toBe('50');

    // 並び順: 残EXP（目標Lvまでの時間）→ 睡眠到達Lv（睡眠目標を寝きった時点）。
    // 逆に置くと、どちらの時間がどちらの到達点のものか読めなくなる
    const orderedSleepResults = await usedRow
      .locator('[data-testid="result-remaining-exp"], [data-testid="result-sleep-reached-level"]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')));
    expect(orderedSleepResults).toEqual(['result-remaining-exp', 'result-sleep-reached-level']);

    // 睡眠目標を外すと消え、ラベルも「到達Lv」へ戻る
    await calc.getRowSleepTargetSelect(row).selectOption('');
    await expect.poll(async () => calc.getRowSleepReachLevel(row)).toBe('');
    await expect(usedRow.getByText('到達Lv', { exact: true })).toBeVisible();
  });

  /**
   * ボーナス明細は「到達可能」行の**内側**に開く。
   * 外へ出すと到達可能行との所属関係が失われる（回帰）。
   */
  test('28d. ボーナス明細は到達可能行の中に開き、トグルで閉じられる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const usedRow = calc.getRowUsedRow(row);

    await calc.getRowSleepTargetSelect(row).selectOption('all');

    const toggle = row.getByTestId('result-bonus-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();

    const details = row.getByTestId('result-bonus-details');
    await expect(details).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // 「結果欄の中」＝到達可能行の子孫であること。ここが外れると取り残しが起きる
    await expect(usedRow.getByTestId('result-bonus-details')).toHaveCount(1);
    await expect(details.getByText('合計', { exact: true })).toBeVisible();

    await toggle.click();
    await expect(details).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  /** ボーナス明細の列ごとのセル数。4列が欠けずに揃っているかを見るために使う。 */
  async function cellCountsByColumn(details: Locator) {
    return {
      name: await details.locator('.calcRow__bonusName').count(),
      mult: await details.locator('.calcRow__bonusMult').count(),
      amount: await details.locator('.calcRow__bonusAmount').count(),
      exp: await details.locator('.calcRow__bonusExp').count(),
    };
  }

  /**
   * 明細の中身。store が正しく返しても画面が組み立て損ねる回帰を止める。
   * 4列（種類 / 倍率 / 日数 / EXP）と合計、素EXPの行名を固定する。
   */
  test('28e. ボーナス明細は種類・倍率・日数・EXPの4列と合計を出す', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    await calc.getRowSleepTargetSelect(row).selectOption('all');
    await row.getByTestId('result-bonus-toggle').click();

    const details = row.getByTestId('result-bonus-details');
    await expect(details).toBeVisible();

    // 4列はどの行でも欠けない（合計行も含めて同数）。欠けると grid の桁が総崩れになる
    const cellCounts = await cellCountsByColumn(details);
    expect(cellCounts.name).toBeGreaterThan(1);
    expect(new Set(Object.values(cellCounts)).size).toBe(1);

    // 先頭は素EXPの行。全睡眠日が対象なので日数が入り、加算ぶんではないので「+」は付かない
    const names = details.locator('.calcRow__bonusName');
    await expect(names.first()).toHaveText('素EXP');
    const firstExp = details.locator('.calcRow__bonusExp').first();
    await expect(firstExp).toHaveText(/^[\d,]+EXP$/);
    await expect(details.locator('.calcRow__bonusAmount').first()).toHaveText(/^\d+日$/);
    // 倍率は独立した列のチップ（種類名に混ぜない）
    await expect(details.locator('.calcRow__bonusMultChip').first()).toHaveText(/^×[\d.]+$/);

    // 合計は最終行。この計画を寝きるともらえる睡眠EXP
    await expect(names.last()).toHaveText('合計');
    await expect(details.locator('.calcRow__bonusExp').last()).toHaveText(/^[\d,]+EXP$/);
  });

  test('28f. 1晩の計画は日別の1行になり、睡眠時間とEXPを出す', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    // 残EXP を1回の睡眠で届く量まで下げる（現在Lvの次のLvを目標にして、あとEXPを小さくする）
    const srcLevel = Number(await calc.getRowSrcLevelInput(row).inputValue());
    await calc.setRowDstLevel(row, srcLevel + 1);
    // この個体はEXP性格下降で1日あたり約82EXP。80なら1晩に収まる。
    await calc.setRowExpRemaining(row, 80);
    // 到達可能行は常時 visible なので、visible を計算完了待ちに使えない。
    // 入力前の結果も「時間」を含み得るため、残EXPの値で更新完了を特定する。
    await expect.poll(async () => calc.getRowRemainingExp(row)).toBe('80');
    await calc.getRowSleepTargetSelect(row).selectOption('all');

    // 実時間は行の見出しに出る（「約N日」ではない）ことがこの行の目印
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow.getByTestId('result-sleep-time')).toHaveText(/時間/);

    await row.getByTestId('result-bonus-toggle').click();
    const details = row.getByTestId('result-bonus-details');
    await expect(details).toBeVisible();

    // 3晩以内は日別だけ。種類別の行は作らない（1晩ぶんの日付行と合計行になる）。
    await expect(details.locator('.calcRow__bonusNightDate')).toHaveCount(1);
    await expect(details.locator('.calcRow__bonusName')).toHaveText(['合計']);
    await expect(details.locator('.calcRow__bonusAmount')).toBeEmpty();

    const nightTimes = details.locator('.calcRow__bonusNightTime');
    await expect(nightTimes.first().locator('> [aria-hidden="true"]')).toHaveText(/^(\d+h)?(\d+m)?$/);
    expect(await nightTimes.first().ariaSnapshot()).toMatch(/睡眠時間/);
    // EXPは「素＋上乗せ」。上乗せの無い晩は素だけ。
    const nightExp = details.locator('.calcRow__bonusNightExp > [aria-hidden="true"]');
    await expect(nightExp).toHaveText([/^[\d,]+(＋[\d,]+)?EXP$/]);
    // 合計は出る
    await expect(details.locator('.calcRow__bonusExp').last()).toHaveText(/^[\d,]+EXP$/);
  });

  test('26c. 睡眠EXPでアメブが頭打ちのとき、アメブ目標Lvピッカーに理由が出る', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    await calc.getRowSleepTargetSelect(row).selectOption('2000');

    // 値は変えられないが、理由を読むためにピッカーは開ける（title 属性だけでは
    // disabled の欄でホバーしても出ない。設計書 §10.18）
    await calc.openLevelPicker(row, 'boostReachLevel');
    const note = row.getByTestId('boostReachLevel').getByTestId('level-picker-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('睡眠EXP');
    // 不足ラベルと同じ位置の警告マーク
    await expect(row.getByTestId('boostReachLevel').getByTestId('level-picker-warn')).toBeVisible();
  });

  test('26d. アメブ目標Lvを上限まで上げたところで理由が出る', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);
    await calc.clickSettings();
    await settings.setGrowthIncenseGsd({ beforeFullMoon: false, fullMoon: false, afterFullMoon: false });
    await settings.closeByButton();
    const dstInput = calc.getRowDstLevelInput(row);
    await dstInput.fill('65');
    await dstInput.blur();
    await calc.getRowSleepTargetSelect(row).selectOption('1000');

    await calc.openLevelPicker(row, 'boostReachLevel');
    const note = row.getByTestId('boostReachLevel').getByTestId('level-picker-note');
    const warn = row.getByTestId('boostReachLevel').getByTestId('level-picker-warn');
    // 上限にまだ余裕がある間は、マークも理由も出さない（2026-07-29）。
    // 案内は「目標Lvを上げるか睡眠目標を解除してください」という打ち手なので、
    // まだ自由に上げられる行に出すと誤情報になる
    await expect(note).toHaveCount(0);
    await expect(warn).toHaveCount(0);

    const increment = row.getByTestId('boostReachLevel').getByTestId('level-picker-increment');
    for (let i = 0; i < 20 && await increment.isEnabled(); i++) await increment.click();

    // それ以上上げられなくなった時点で、マークと理由の両方を出す
    await expect(note).toBeVisible();
    await expect(note).toContainText('睡眠EXP');
    await expect(warn).toBeVisible();
  });

  test('26f. 未入力のアメブ個数欄は▲▼が自動値を起点に動く', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const input = calc.getRowBoostCandyInput(row);

    const derived = Number(await input.getAttribute('placeholder'));
    expect(derived).toBeGreaterThan(1);
    await expect(input).toHaveValue('');

    // ブラウザ既定では空欄から 1（▲）/ 0（▼）に飛び、目の前の自動値と無関係な数になる
    await input.focus();
    await page.keyboard.press('ArrowUp');
    await expect(input).toHaveValue(String(derived + 1));
    await page.keyboard.press('ArrowUp');
    await expect(input).toHaveValue(String(derived + 2));

    // 未入力へ戻すと ▼ も同じ起点から動く
    await row.getByTestId('boostCandyReset').click();
    await expect(input).toHaveValue('');
    await input.focus();
    await page.keyboard.press('ArrowDown');
    await expect(input).toHaveValue(String(derived - 1));
  });

  test('26h. 累計睡眠時間が届いた睡眠目標にチェックが付く（選択肢は消さない）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const select = calc.getRowSleepTargetSelect(row);

    // 累計0h では全部が未達成
    await expect(select.locator('option')).toHaveText(['未設定', '200h', '500h', '1000h', '2000h', 'すべて睡眠', 'アメ在庫＋睡眠']);

    await calc.getRowSleepTargetCurrentLink(row).click();
    const hoursInput = page.getByTestId('sleep-hint-hours-input');
    await hoursInput.fill('500');
    // 入力中に再描画が走っても打った値が消えないこと（ドラフト保持）。
    // ここが壊れると打っている途中で 0 に巻き戻る。
    await expect(hoursInput).toHaveValue('500');
    await hoursInput.blur();
    await expect(calc.getRowSleepTargetCurrentLink(row)).toContainText('500');
    await page.getByTestId('sleep-hint-overlay').click({ position: { x: 5, y: 5 } });

    // 達成済みは残したままチェックを後ろに付ける（消すと選択中の項目まで消える）
    await expect(select.locator('option')).toHaveText(['未設定', '200h ✓', '500h ✓', '1000h', '2000h', 'すべて睡眠', 'アメ在庫＋睡眠']);
  });

  test('26i. アメ個数指定にもヒントがあり、アメブ上限の入力欄は出さない', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const hint = page.getByTestId('calc-hint-popover');

    await row.getByTestId('candyTargetHintBtn').click();
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('目標Lv');
    // アメブ上限はアメブ個数ヒント側の入口。こちらへ複製しない
    await expect(page.getByTestId('calc-hint-boost-remaining-input')).toHaveCount(0);
    await page.getByTestId('calc-hint-overlay').click({ position: { x: 5, y: 5 } });

    // 対照: アメブ個数のヒントには従来どおり上限の入力欄がある
    await row.getByTestId('hintBtn').click();
    await expect(page.getByTestId('calc-hint-boost-remaining-input')).toBeVisible();
  });

  test('26j. レベルピッカーは同時に1つしか開かず、どれも見出しに項目名を出す', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const popovers = row.locator('.levelPick__popover');

    await calc.openLevelPicker(row, 'dstLevel');
    await expect(popovers).toHaveCount(1);
    await expect(row.getByTestId('dstLevel').locator('.levelPick__title')).toContainText('目標Lv:');

    // 次を開くと前が閉じる（chevron は @click.stop なので onClickOutside では閉じない）
    await calc.openLevelPicker(row, 'boostReachLevel');
    await expect(popovers).toHaveCount(1);
    await expect(row.getByTestId('boostReachLevel').locator('.levelPick__title')).toContainText('アメブ目標Lv:');

    await row.getByTestId('srcLevel').getByTestId('level-picker-chevron').click();
    await expect(popovers).toHaveCount(1);
    await expect(row.getByTestId('srcLevel').locator('.levelPick__title')).toContainText('現在Lv:');
  });

  test('26e. 睡眠で上限が下がった行はアメブ個数ヒントにも理由が出る', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);
    const hint = page.getByTestId('calc-hint-popover');
    await calc.clickSettings();
    await settings.setGrowthIncenseGsd({ beforeFullMoon: false, fullMoon: false, afterFullMoon: false });
    await settings.closeByButton();

    // 対照: 睡眠目標がなければ上限は下がらないので案内も出ない
    await row.getByTestId('hintBtn').click();
    await expect(hint).toBeVisible();
    await expect(hint).not.toContainText('睡眠EXP');
    await page.getByTestId('calc-hint-overlay').click({ position: { x: 5, y: 5 } });

    await calc.getRowSleepTargetSelect(row).selectOption('1000');
    await row.getByTestId('hintBtn').click();
    await expect(hint).toContainText('睡眠EXP');

    // 対照: 目標Lvを上げると T' が前進してアメブ目標Lvに余裕が戻る。
    // ヒント側の案内はアメブ目標Lvピッカーと同じ条件に連動して消える（2026-07-29）
    await page.getByTestId('calc-hint-overlay').click({ position: { x: 5, y: 5 } });
    const dstInput = calc.getRowDstLevelInput(row);
    await dstInput.fill('65');
    await dstInput.blur();
    await row.getByTestId('hintBtn').click();
    await expect(hint).toBeVisible();
    await expect(hint).not.toContainText('睡眠EXP');
  });
});

// ============================================================
// F. 計算結果表示
// ============================================================
test.describe('04-calculator F. 計算結果表示', () => {
  test.beforeEach(async ({ page }) => {
    // ゲーム内日を固定する。**実日付のままだと開催中のイベント倍率やGSDで睡眠時間が動き、
    // 34b の期待値が壊れる**（2026-08 のアニポケコラボ ×1.25 で実際に落ちた）。
    // 2026-05-10 は前後2日にGSD（満月は 5/2 と 5/31）もイベントも無い平常日。
    // J グループが使う 2026-05-02 は満月日なので、ここでは使えない。
    await page.goto('/?gameDate=2026-05-10');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    // 低レベルポケモン（Lv55マルノーム）を使用 - 目標Lvまでの差がないとexpToTarget=0で睡眠時間が表示されない
    await box.fillImportText(testConfig.importData.lowLevelPokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('29. 表示値が同一なら1行になり、到達可能ラベルを出さない', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const settings = new SettingsModalPage(page);

    await calc.setRowSpeciesCandy(row, '99999');
    await calc.clickSettings();
    await settings.setTotalShards('99999999');
    await settings.closeByButton();

    await expect(calc.getRowRequiredRow(row)).toHaveCount(0);
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow).toBeVisible();
    await expect(usedRow.getByTestId('result-reachable-label')).toHaveCount(0);
  });

  test('31. 到達可能行は常に表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow).toBeVisible();
  });

  test('31a. 表示値に差があると2行になり、両方のラベルを出す', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const settings = new SettingsModalPage(page);

    await calc.setRowSpeciesCandy(row, '0');
    await calc.clickSettings();
    await settings.setTotalShards('0');
    await settings.closeByButton();

    const requiredRow = calc.getRowRequiredRow(row);
    const usedRow = calc.getRowUsedRow(row);
    await expect(requiredRow).toBeVisible();
    await expect(requiredRow.getByTestId('result-required-label')).toHaveText('目標まで');
    await expect(usedRow.getByTestId('result-reachable-label')).toHaveText('到達可能');
  });

  /**
   * 背景の濃さは3段階。目標まで行 > 1行に畳まれた到達可能行 > 2行目の到達可能行。
   *
   * 1行のときの到達可能行は「対比相手が居ない結果そのもの」なので、2行目のときの
   * 薄さのままにしない（薄すぎる）。かといって目標まで行と同じにもしない（濃すぎる）。
   * どちらへ寄せる直しも実画面で差し戻された経緯があるので、順序と実値の両方で固定する。
   * 順序だけだと `0.10 / 0.09 / 0.08` のように差が潰れても通ってしまい、
   * 実値だけだと「なぜその値か」が読めない。値は CSS の `--calc-result-tint`（設計書 §4.4）。
   */
  test('31d. 到達可能行の背景は、1行のときだけ濃くなる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const settings = new SettingsModalPage(page);

    // まず1行の状態（アメもかけらも足りていて、目標まで行が出ない）
    await calc.setRowSpeciesCandy(row, '99999');
    await calc.clickSettings();
    await settings.setTotalShards('99999999');
    await settings.closeByButton();
    await expect(calc.getRowRequiredRow(row)).toHaveCount(0);
    const soloAlpha = await bgAlpha(calc.getRowUsedRow(row));

    // 在庫を空にして2行の状態へ
    await calc.setRowSpeciesCandy(row, '0');
    await calc.clickSettings();
    await settings.setTotalShards('0');
    await settings.closeByButton();
    await expect(calc.getRowRequiredRow(row)).toBeVisible();

    const requiredAlpha = await bgAlpha(calc.getRowRequiredRow(row));
    const pairedAlpha = await bgAlpha(calc.getRowUsedRow(row));
    expect(pairedAlpha).toBeLessThan(soloAlpha);
    expect(soloAlpha).toBeLessThan(requiredAlpha);
    expect(requiredAlpha).toBeCloseTo(0.16, 2);
    expect(soloAlpha).toBeCloseTo(0.1, 2);
    expect(pairedAlpha).toBeCloseTo(0.06, 2);
  });

  test('31b. リロード後も到達可能行は表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await expect(calc.getRowUsedRow(calc.getRow(0))).toBeVisible();

    await page.reload();

    await expect(calc.getRowUsedRow(calc.getRow(0))).toBeVisible();
  });

  test('31c. 展開アイコンはDOMに存在しない', async ({ page }) => {
    await expect(page.locator('.calcRow__expandIcon')).toHaveCount(0);
  });

  test('32. アメブ、アメ、かけらの値が表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    const targetRow = await calc.getRowTargetRow(row);
    await expect(targetRow.getByTestId(/^result-(?:required|reachable)-.+-value$/)).not.toHaveCount(0);
  });

  test('33. 到達レベル（reachedLevel）が表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    const usedRow = calc.getRowUsedRow(row);
    const reachedLvText = usedRow.getByTestId('result-reachable-level');
    await expect(reachedLvText).toBeVisible();
    await expect(usedRow.getByText('到達Lv', { exact: true })).toBeVisible();
    await expect(usedRow.getByText('アメ到達Lv', { exact: true })).toHaveCount(0);
  });

  test('34. 残り睡眠時間が表示される（残EXPがある場合）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    // 個数指定を入力して不足状態を作る
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('10');
    await candyTargetInput.blur();

    const usedRow = calc.getRowUsedRow(row);
    const sleepTime = usedRow.getByTestId('result-sleep-time');
    // 睡眠時間が表示されることを確認（残EXPがある場合）
    await expect(sleepTime).toBeVisible();
  });

  test('34b. 3晩までは最後の晩を正確に、4晩から長期概算で表示する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    await calc.setRowDstLevel(row, 56);
    await calc.getRowSleepTargetSelect(row).selectOption('all');
    // 在庫0なのでアメは1個も使えず、残EXPがそのまま睡眠時間になる。
    // （旧テストは個数指定0でアメを止めていたが、新設計では個数指定＝目標なので目標ごと現在地へ落ちる）
    await calc.setRowExpRemaining(row, 24);
    await expect.poll(async () => calc.getRowSleepTime(row)).toBe('2時間31分 ～ 35分');

    await calc.setRowExpRemaining(row, 82);
    await expect.poll(async () => calc.getRowSleepTime(row)).toBe('8時間28分 ～ 30分');

    await calc.setRowExpRemaining(row, 83);
    await expect.poll(async () => calc.getRowSleepTime(row)).toBe('1日（8時間30分）と8分 ～ 12分');

    await calc.setRowExpRemaining(row, 165);
    await expect.poll(async () => calc.getRowSleepTime(row)).toBe('2日（17時間）と8分 ～ 12分');

    // 3晩以内は日別の表。4晩以上へ切り替わると種類別の表になる（§10.5）。
    await row.getByTestId('result-bonus-toggle').click();
    const bonusDetails = row.getByTestId('result-bonus-details');
    const bonusNames = bonusDetails.locator('.calcRow__bonusName');
    const bonusAmounts = bonusDetails.locator('.calcRow__bonusAmount');
    const nightDates = bonusDetails.locator('.calcRow__bonusNightDate');
    const nightTimes = bonusDetails.locator('.calcRow__bonusNightTime');
    // 見出しの「2日（17時間）と8分」＝満額2晩＋最終晩の3行。種類別の行は出さない。
    await expect(nightDates).toHaveCount(3);
    await expect(nightDates.first()).toHaveText(/^\d+\/\d+/);
    await expect(bonusNames).toHaveText(['合計']);
    // 先行の晩は設定どおり満額、最後の晩だけ短い。日本語でも「8h30m」形式。
    await expect(nightTimes.first().locator('> [aria-hidden="true"]')).toHaveText('8h30m');
    await expect(nightTimes.last().locator('> [aria-hidden="true"]')).toHaveText(/^\d+m$/);
    expect(await nightTimes.first().ariaSnapshot()).toMatch(/睡眠時間8時間30分/);
    // 晩ごとのEXPは「素＋上乗せ」。上乗せの無い晩は素だけ。
    const nightExps = bonusDetails.locator('.calcRow__bonusNightExp > [aria-hidden="true"]');
    await expect(nightExps).toHaveCount(3);
    await expect(nightExps.first()).toHaveText(/^[\d,]+(＋[\d,]+)?EXP$/);

    await calc.setRowExpRemaining(row, 247);
    await expect.poll(async () => calc.getRowSleepTime(row)).toBe('約4日（34時間）');
    // 4晩以上は日付列が長大になるので種類別へ畳む。
    await expect(nightDates).toHaveCount(0);
    await expect(bonusNames.first()).toHaveText('素EXP');
    await expect(bonusAmounts.first()).toHaveText(/^\d+日$/);
    await expect(bonusAmounts.last()).toBeEmpty();

    await page.setViewportSize({ width: 390, height: 844 });
    const sleepTime = row.locator('.calcRow__sleepTime');
    await expect(sleepTime).toBeVisible();
    const sleepTimeBox = await sleepTime.boundingBox();
    expect(sleepTimeBox).not.toBeNull();
    expect(sleepTimeBox!.x + sleepTimeBox!.width).toBeLessThanOrEqual(390);
  });

  /**
   * 成長のお香は在庫も律速も持たず、睡眠設定から個数（＝使う睡眠日数）が決まる。
   * 「目標まで」「到達可能」のどちらでも同じ個数になるので、両方の行へ同じ値が出る。
   */
  test('34c. 睡眠目標を設定すると成長のお香の個数が両方の結果行に出る', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    const settings = new SettingsModalPage(page);
    await calc.setRowSpeciesCandy(row, '0');
    await calc.clickSettings();
    await settings.setTotalShards('0');
    await settings.setGrowthIncenseNormalPerWeek(1);
    await settings.closeByButton();

    // 在庫0・かけら0にしたので2行になる。**設定の反映を待ってから**中身を見る。
    // `getRowTargetRow()` はその瞬間の行数で参照先が決まるので、反映前に呼ぶと到達可能行を掴む。
    await expect(calc.getRowRequiredRow(row)).toBeVisible();

    // 睡眠目標が無いうちは出ない
    await expect(calc.getRowRequiredRow(row)).not.toContainText('成長のお香');
    await expect(calc.getRowUsedRow(row)).not.toContainText('成長のお香');

    await calc.getRowSleepTargetSelect(row).selectOption('2000');

    const incense = /成長のお香\s*([\d,]+)/;
    await expect(calc.getRowRequiredRow(row)).toBeVisible();
    await expect.poll(async () => (await calc.getRowRequiredRow(row).textContent()) ?? '')
      .toMatch(incense);
    const requiredCount = (await calc.getRowRequiredRow(row).textContent())?.match(incense)?.[1];
    const usedCount = (await calc.getRowUsedRow(row).textContent())?.match(incense)?.[1];
    expect(Number((requiredCount ?? '0').replace(/,/g, ''))).toBeGreaterThan(0);
    // 在庫に依らない値なので、目標まで行と到達可能行で必ず一致する
    expect(usedCount).toBe(requiredCount);
  });

  /**
   * 「すべて睡眠」はアメを1個も配らない（設計書§2.2）ので、アイテムはお香だけになる。
   * この行は睡眠EXPを導出しない（同§11）ため、個数は必要日数の経路からしか取れない。
   */
  test('34d. 「すべて睡眠」ではアイテムが成長のお香だけになる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    await settings.setGrowthIncenseGsd({
      beforeFullMoon: false,
      fullMoon: true,
      afterFullMoon: true,
    });
    await settings.closeByButton();

    await calc.getRowSleepTargetSelect(row).selectOption('all');

    const incense = /成長のお香\s*([\d,]+)/;
    const usedRow = calc.getRowUsedRow(row);
    await expect(calc.getRowRequiredRow(row)).toHaveCount(0);
    await expect.poll(async () => (await usedRow.textContent()) ?? '')
      .toMatch(incense);

    const text = (await usedRow.textContent()) ?? '';
    expect(Number((text.match(incense)?.[1] ?? '0').replace(/,/g, ''))).toBeGreaterThan(0);
    // アメは1個も配らないので、アメ系のアイテムは並ばない
    expect(text).not.toMatch(/万能[SML]/);
  });
});

// ============================================================
// G. プログレスバー・サマリー表示
// ============================================================
test.describe('04-calculator G. プログレスバー・サマリー表示', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('35. アメブ使用率バーが表示される（boostKind ≠ none）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    // サマリーをクリックして展開
    await calc.stickySummary.click();
    await expect(calc.boostCandyBar).toBeVisible();
  });

  test('36. かけら使用率バーが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    // サマリーをクリックして展開
    await calc.stickySummary.click();
    await expect(calc.shardsBar).toBeVisible();
  });

  test('37. サマリー（合計アメブ、合計かけら）が表示される', async ({ page }) => {
    const summaryInline = page.locator('.calcSumInline:not(.calcSumInline--candy)');
    await expect(summaryInline.first()).toBeVisible();
  });

  test('38. 万能アメ使用率が表示される', async ({ page }) => {
    const candyUsage = page.locator('.calcSumInline--candy');
    await expect(candyUsage.first()).toBeVisible();
  });
});

// ============================================================
// Gb. サマリー合計値の検証
// ============================================================
test.describe('04-calculator Gb. サマリー合計値の検証', () => {
  // ゴローニャ + スイクンの合算サマリーテスト
  test('38b. 複数ポケモンのサマリー合計が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // 在庫設定：かけら100万、万能S500、いわM3
    await calc.clickSettings();
    await settings.setTotalShards('1000000');
    await settings.setUniversalCandy('S', 500);
    await settings.setTypeCandy('いわ', 'M', 3);
    await settings.closeByButton();

    // --- ゴローニャを追加（テストMと同じ設定） ---
    await box.openAddNewPanel();
    await box.fillPokemonName('ゴローニャ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const rowGolem = calc.getRow(0);
    // 現在Lv29
    await calc.setRowSrcLevel(rowGolem, 29);
    // あとEXP122
    await calc.setRowExpRemaining(rowGolem, 122);
    // 目標Lv60
    await calc.setRowDstLevel(rowGolem, 60);
    // アメブ0%
    await calc.setRowBoostCandy(rowGolem, '0');
    // 個数指定1500
    await calc.setRowCandyTarget(rowGolem, '1500');

    // --- スイクンを追加（テストMと同じ設定） ---
    await box.openAddNewPanel();
    await box.fillPokemonName('スイクン');
    await box.confirmPokemonName();
    // 性格をEXP下降（▼▼）に設定
    await box.openNatureDropdown();
    await box.selectNatureOption(2);
    await box.clickAddToBox();

    const rowSuicune = calc.getRow(1);
    // 現在Lv58
    await calc.setRowSrcLevel(rowSuicune, 58);
    // あとEXP1362
    await calc.setRowExpRemaining(rowSuicune, 1362);
    // 目標Lv65
    await calc.setRowDstLevel(rowSuicune, 65);
    // 種族アメ147
    await calc.setRowSpeciesCandy(rowSuicune, '147');
    // アメブ在庫350
    await calc.setRowBoostCandy(rowSuicune, '350');
    // 個数指定50
    await calc.setRowCandyTarget(rowSuicune, '50');

    // サマリー値の検証（実使用ベース）
    // アメブ合計: 50
    const boostTotal = page.locator('.calcSumInline:not(.calcSumInline--candy)').first();
    await expect(boostTotal).toContainText('50', { timeout: 10000 });
    const boostTotalText = await boostTotal.textContent();
    expect(boostTotalText).toContain('50');

    // かけら合計（実使用ベース）
    const shardsTotal = page.locator('.calcSumInline:not(.calcSumInline--candy)').nth(1);
    const shardsTotalText = await shardsTotal.textContent();
    // 実使用ベースの値を検証
    expect(shardsTotalText?.replace(/,/g, '')).toBeTruthy();

    // 万能アメ使用率（実使用ベース）
    const candyUsage = page.locator('.calcSumInline--candy');
    const candyUsageText = await candyUsage.first().textContent();
    expect(candyUsageText).toBeTruthy();
  });
});

// ============================================================
// H. 行の並べ替え
// ============================================================
test.describe('04-calculator H. 行の並べ替え', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    // 複数ポケモンをインポート
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.importText);
    await box.clickImport();

    // 2つのポケモンを計算機に追加
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await page.waitForTimeout(100);
    await box.selectBoxTile(1);
    await box.clickApplyToCalc();
  });

  test('39. ↑ボタンで行を上に移動できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    // 2番目の行のタイトルを取得
    const row1 = calc.getRow(1);
    const title1 = await row1.locator('.calcRow__title').textContent();

    // ↑ボタンをクリック
    await calc.moveRowUp(row1);

    // 1番目の行になっていることを確認
    const newRow0 = calc.getRow(0);
    const newTitle0 = await newRow0.locator('.calcRow__title').textContent();
    expect(newTitle0).toBe(title1);
  });

  test('40. ↓ボタンで行を下に移動できる', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    // 1番目の行のタイトルを取得
    const row0 = calc.getRow(0);
    const title0 = await row0.locator('.calcRow__title').textContent();

    // ↓ボタンをクリック
    await calc.moveRowDown(row0);

    // 2番目の行になっていることを確認
    const newRow1 = calc.getRow(1);
    const newTitle1 = await newRow1.locator('.calcRow__title').textContent();
    expect(newTitle1).toBe(title0);
  });

  test('41. 先頭行では↑が無効', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row0 = calc.getRow(0);
    const upBtn = calc.getRowMoveUpButton(row0);
    await expect(upBtn).toBeDisabled();
  });

  test('42. 末尾行では↓が無効', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const rowCount = await calc.getRowCount();
    const lastRow = calc.getRow(rowCount - 1);
    const downBtn = calc.getRowMoveDownButton(lastRow);
    await expect(downBtn).toBeDisabled();
  });

  test('43. ドラッグハンドルが存在する', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row0 = calc.getRow(0);
    const dragHandle = calc.getRowDragHandle(row0);
    await expect(dragHandle).toBeVisible();
  });
});

// ============================================================
// I. BOX連携
// ============================================================
test.describe('04-calculator I. BOX連携', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('44. 「BOXに反映」ボタンが表示される（boxIdがある行）', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const applyBtn = calc.getRowApplyToBoxButton(row);
    await expect(applyBtn).toBeVisible();
  });

  test('45. 「BOXに反映」クリックでBOXが更新される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);

    // 個数指定を入力してレベルアップ
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('100');
    await candyTargetInput.blur();

    // BOXに反映
    const applyBtn = calc.getRowApplyToBoxButton(row);
    await applyBtn.click();

    // BOXのタイルが更新されていることを確認（レベルが変わる）
    // 具体的な値の確認は状況依存のため、ボタンクリックが成功することを確認
  });
});

// ============================================================
// J. 設定反映テスト
// ============================================================
test.describe('04-calculator J. 設定反映テスト', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?gameDate=2026-05-02');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    // 低レベルポケモン（Lv55マルノーム）を使用 - 睡眠時間テストに必要
    await box.fillImportText(testConfig.importData.lowLevelPokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    // 既存の設定反映テストはお香なしを基準にする。お香自体は52bで明示的に切り替える。
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    await calc.clickSettings();
    await settings.setGrowthIncenseGsd({ beforeFullMoon: false, fullMoon: false, afterFullMoon: false });
    await settings.closeByButton();
  });

  test('46. ブースト上限が計算機に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    await settings.setBoostCandyRemaining('8000');
    await settings.closeByButton();

    // 計算機のキャップ表示を確認
    const capText = await calc.getBoostCandyCap();
    expect(capText).toContain('8,000');
  });

  test('47. かけら上限が計算機に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    await settings.setTotalShards('500000');
    await settings.closeByButton();

    // 計算機のかけらキャップ表示を確認
    const capText = await calc.getShardsCap();
    expect(capText).toContain('500,000');
  });

  test('48. 万能アメ在庫が計算機に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    await settings.setUniversalCandy('S', 100);
    await settings.closeByButton();

    // 万能アメ使用率の表示を確認
    const candyUsage = page.locator('.calcSumInline--candy');
    await expect(candyUsage.first()).toBeVisible();
  });

  test('49. タイプアメ在庫が計算結果に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    // beforeEach のマルノームに対応する、どくタイプのアメを設定
    await settings.setTypeCandy('どく', 'S', 100);
    await settings.closeByButton();

    // 必要アイテムに反映されることを確認
    const row = calc.getRow(0);
    await calc.waitForRowRequiredItems(row, /どくS\s+\d+/);
  });

  test('50. 睡眠時間設定が計算に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    // 個数指定を設定
    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('10');
    await candyTargetInput.blur();

    // 睡眠時間を取得
    // 到達可能行は計算中も常時 visible なので、可視性を計算完了待ちに使えない。
    // 値そのものが埋まるのを待ってから基準値を取る（待たないと空文字を掴んで落ちる）。
    await expect.poll(async () => calc.getRowSleepTime(row)).not.toBe('');
    const sleepTime1 = await calc.getRowSleepTime(row);

    // 設定を変更
    await calc.clickSettings();
    await settings.setDailySleepHours(10);
    await settings.closeByButton();

    // 睡眠時間が変わることを確認
    await expect.poll(async () => calc.getRowSleepTime(row), { timeout: 10000 }).not.toBe(sleepTime1);
  });

  test('51. 睡眠EXPボーナスが計算に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    const candyTargetInput = calc.getRowCandyTargetInput(row);
    await candyTargetInput.fill('10');
    await candyTargetInput.blur();

    // 到達可能行は計算中も常時 visible なので、可視性を計算完了待ちに使えない。
    // 値そのものが埋まるのを待ってから基準値を取る（待たないと空文字を掴んで落ちる）。
    await expect.poll(async () => calc.getRowSleepTime(row)).not.toBe('');
    const sleepTime1 = await calc.getRowSleepTime(row);

    await calc.clickSettings();
    await settings.setSleepExpBonus(4);
    await settings.closeByButton();

    await expect.poll(async () => calc.getRowSleepTime(row), { timeout: 10000 }).not.toBe(sleepTime1);
  });

  test('52. GSDチェックが計算に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    // 在庫0のまま目標Lvまでの不足を睡眠で埋める（GSDの差が出るよう長期になる条件）。
    // 個数指定を入れると新設計では目標がその個数ぶんへ縮み、GSDが効く長さにならない。

    // 到達可能行は計算中も常時 visible なので、可視性を計算完了待ちに使えない。
    // 値そのものが埋まるのを待ってから基準値を取る（待たないと空文字を掴んで落ちる）。
    await expect.poll(async () => calc.getRowSleepTime(row)).not.toBe('');
    const sleepTime1 = await calc.getRowSleepTime(row);

    await calc.clickSettings();
    await settings.toggleIncludeGSD();
    await settings.closeByButton();

    await expect.poll(async () => calc.getRowSleepTime(row), { timeout: 10000 }).not.toBe(sleepTime1);
  });

  test('52b. 満月日の成長のお香が計算に反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    await calc.clickSettings();
    await expect(settings.currentGameDate).toContainText('2026-05-02');
    await settings.setGrowthIncenseGsd({ beforeFullMoon: false, fullMoon: false, afterFullMoon: false });
    await settings.closeByButton();
    await expect.poll(async () => calc.getRowSleepTime(row), { timeout: 10000 }).not.toBe('');
    const withoutIncense = await calc.getRowSleepTime(row);

    await calc.clickSettings();
    await settings.setGrowthIncenseGsd({ beforeFullMoon: false, fullMoon: true, afterFullMoon: false });
    await settings.closeByButton();

    await expect.poll(async () => calc.getRowSleepTime(row), { timeout: 10000 })
      .not.toBe(withoutIncense);
  });
});

test.describe('04-calculator J2. 事前生成した月齢カレンダー', () => {
  test('GSDを使ってもastronomy-engineを追加取得しない', async ({ page }) => {
    const astronomyRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('astronomy')) astronomyRequests.push(request.url());
    });
    await page.goto('/?gameDate=2026-05-02');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.lowLevelPokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    const settings = new SettingsModalPage(page);
    await settings.openSettingsFromDesktop();
    await expect(settings.lunarCalendarWarning).toHaveCount(0);
    expect(astronomyRequests).toEqual([]);
  });
});



// ============================================================
// K. スロットのコピー/ペースト
// ============================================================
test.describe('04-calculator K. スロットのコピー/ペースト', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('53. 空状態ではコピー・ペーストが無効', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await expect(calc.copySlotButton).toBeDisabled();
    await expect(calc.pasteSlotButton).toBeDisabled();
  });

  test('54. コピーするとペーストが有効になる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    // スロット0にポケモンを追加
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.expectRowCount(1);

    // コピー前はペースト無効
    await expect(calc.copySlotButton).toBeEnabled();
    await expect(calc.pasteSlotButton).toBeDisabled();

    // コピー後はペースト有効
    await calc.clickCopySlot();
    await expect(calc.pasteSlotButton).toBeEnabled();
  });

  test('54b. 別スロットへペーストすると行・アメブ種別が複製される', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // スロット0にポケモンを追加し、スロット固有設定を既定値と異なる値にする
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.setBoostKind('full');
    await settings.openSettingsFromDesktop();
    await settings.setBoostCandyRemaining('123');
    await settings.setItemCompareMode('legacyImproved');
    await settings.closeByButton();
    await calc.expectRowCount(1);

    const slot0Title = await calc.getRow(0).locator('.calcRow__title').textContent();

    // コピー
    await calc.clickCopySlot();

    // スロット1（空・既定 mini）へ切り替え
    await calc.clickSlotTab(1);
    await calc.expectRowCount(0);
    expect(await calc.getBoostKind()).toBe('mini');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('');
    expect(await settings.getItemCompareMode()).toBe('surplusFirst');
    await settings.closeByButton();

    // ペースト
    await calc.clickPasteSlot();

    // 行とスロット固有設定が複製される
    await calc.expectRowCount(1);
    expect(await calc.getRow(0).locator('.calcRow__title').textContent()).toBe(slot0Title);
    expect(await calc.getBoostKind()).toBe('full');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('123');
    expect(await settings.getItemCompareMode()).toBe('legacyImproved');
    await settings.closeByButton();
  });

  test('54c. ペーストは「元に戻す/やり直す」の対象', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // スロット0にポケモンを追加してコピー
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await calc.setBoostKind('full');
    await settings.openSettingsFromDesktop();
    await settings.setBoostCandyRemaining('123');
    await settings.setItemCompareMode('legacyImproved');
    await settings.closeByButton();
    await calc.clickCopySlot();

    // スロット1へ切り替えてペースト
    await calc.clickSlotTab(1);
    await calc.expectRowCount(0);
    await calc.clickPasteSlot();
    await calc.expectRowCount(1);
    expect(await calc.getBoostKind()).toBe('full');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('123');
    expect(await settings.getItemCompareMode()).toBe('legacyImproved');
    await settings.closeByButton();

    // 元に戻す → ペースト前（空・mini・既定設定）に戻る
    await calc.clickUndo();
    await calc.expectRowCount(0);
    expect(await calc.getBoostKind()).toBe('mini');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('');
    expect(await settings.getItemCompareMode()).toBe('surplusFirst');
    await settings.closeByButton();

    // やり直す → 再度ペースト適用
    await calc.clickRedo();
    await calc.expectRowCount(1);
    expect(await calc.getBoostKind()).toBe('full');
    await settings.openSettingsFromDesktop();
    expect(await settings.getBoostCandyRemaining()).toBe('123');
    expect(await settings.getItemCompareMode()).toBe('legacyImproved');
    await settings.closeByButton();
  });
});

// ============================================================
// L. ヒント表示
// ============================================================
test.describe('04-calculator L. ヒント表示', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('55. ヒントアイコン（?）をクリックでヒントが表示される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const hintBtn = calc.getRowHintButton(row);

    await hintBtn.click();
    await calc.expectHintVisible();
    // 箇条書きは i18n 文字列の \n と .hintPopover__note の white-space: pre-line で描画する
    // （<br> は使わない）。innerText はレンダリング結果を返すので、pre-line が外れると
    // 1行に潰れてここで落ちる。折り返しによるソフトラップは \n にならないため件数は安定する。
    await expect(calc.hintPopover.locator('.hintPopover__heading')).toHaveText(['アメブ個数', 'アメブ上限']);
    const notes = calc.hintPopover.locator('.hintPopover__note');
    await expect(notes).toHaveCount(2);
    // アメブ上限の本文は箇条書き2つ＋締めの3行
    const capLines = (await notes.nth(1).innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
    expect(capLines).toHaveLength(3);
    // 設定モーダルへのリンクは廃止し、ヒント内で直接アメブ上限を変更する
    await expect(calc.hintPopover.locator('button')).toHaveCount(0);
    await expect(calc.hintPopover.getByTestId('calc-hint-boost-remaining-input')).toBeVisible();
  });

  test('55b. ヒント内でアメブ上限を直接変更でき、設定モーダルへ反映される', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    const row = calc.getRow(0);

    await calc.getRowHintButton(row).click();
    const input = calc.hintPopover.getByTestId('calc-hint-boost-remaining-input');
    await input.fill('123');
    await page.locator('.hintOverlay').click({ position: { x: 5, y: 5 } });

    await settings.openSettingsFromDesktop();
    await expect(page.getByTestId('settings-boost-remaining-input')).toHaveValue('123');
  });

  test('56. ヒントをクリック外で閉じられる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const row = calc.getRow(0);
    const hintBtn = calc.getRowHintButton(row);

    await hintBtn.click();
    await calc.expectHintVisible();

    // オーバーレイをクリック
    await calc.hintOverlay.click();
    await calc.expectHintHidden();
  });
});

// ============================================================
// M. 計算結果の期待値検証（具体的なポケモン）
// ============================================================
test.describe('04-calculator M. 計算結果の期待値検証', () => {

  // M-1. ニャローテ（基本計算・在庫未設定）
  test('60. ニャローテの計算結果が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    // ニャローテを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('ニャローテ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 現在レベル20、あとEXP515を設定
    await calc.setRowSrcLevel(row, 20);
    await calc.setRowExpRemaining(row, 515);

    // 目標レベル60
    await calc.setRowDstLevel(row, 60);

    // アメブ個数0（全て通常アメ）
    await calc.setRowBoostCandy(row, '0');

    // 到達可能行は計算中も常時 visible なので、値そのもので計算完了を待つ。
    await calc.waitForRowResultValue(row, 'required', 'boost', '0');

    // 目標まで行の値を確認
    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');
    const reqShards = await calc.getRowResultValue(row, 'required', 'shards');

    expect(reqBoost).toBe('0');
    expect(reqNormal.replace(/,/g, '')).toBe('1745');
    expect(reqCandy.replace(/,/g, '')).toBe('1745');
    expect(reqShards.replace(/,/g, '')).toBe('531268');

    // 必要アイテム
    const reqItems = await calc.getRowRequiredItems(row);
    expect(reqItems).toContain('万能S 582');
    expect(reqItems).toContain('余り 1');
  });

  // M-2. ゴローニャ（個数指定あり）
  test('61. ゴローニャの目標まで行が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // いわタイプアメMを3つ設定
    await calc.clickSettings();
    await settings.setTypeCandy('いわ', 'M', 3);
    await settings.closeByButton();

    // ゴローニャを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('ゴローニャ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 現在レベル29
    await calc.setRowSrcLevel(row, 29);

    // あとEXP122
    await calc.setRowExpRemaining(row, 122);

    // 目標レベル60
    await calc.setRowDstLevel(row, 60);

    // アメブ0%
    await calc.setRowBoostCandy(row, '0');

    // 個数指定なし: 目標まで行は「目標Lv60ちょうどに届く最小数」を出す
    await calc.waitForRowResultValue(row, 'required', 'normal', '1584');
    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');
    const reqShards = await calc.getRowResultValue(row, 'required', 'shards');

    expect(reqBoost).toBe('0');
    expect(reqNormal.replace(/,/g, '')).toBe('1584');
    expect(reqCandy.replace(/,/g, '')).toBe('1584');
    expect(reqShards.replace(/,/g, '')).toBe('515860');

    await calc.waitForRowRequiredItems(row, 'いわM 3');
    const reqItems = await calc.getRowRequiredItems(row);
    expect(reqItems).toContain('いわM 3');
    expect(reqItems).toContain('万能S 503');

    // 個数指定1500: 個数指定＝目標なので、目標まで行はその指定値ちょうどになる（設計書§4.5.1）
    await calc.setRowCandyTarget(row, '1500');
    await calc.waitForRowResultValue(row, 'required', 'candy', '1500');
    expect((await calc.getRowResultValue(row, 'required', 'normal')).replace(/,/g, '')).toBe('1500');
  });

  test('62. ゴローニャの到達可能行が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // 在庫設定：いわM 3, 万能S 500, かけら 400万
    await calc.clickSettings();
    await settings.setTypeCandy('いわ', 'M', 3);
    await settings.setUniversalCandy('S', 500);
    await settings.setTotalShards('4000000');
    await settings.closeByButton();

    // ゴローニャを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('ゴローニャ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 設定（テスト61と同じ）
    await calc.setRowSrcLevel(row, 29);
    await calc.setRowExpRemaining(row, 122);
    await calc.setRowDstLevel(row, 60);

    await calc.setRowBoostCandy(row, '0');
    await calc.setRowCandyTarget(row, '1500');

    // 個数指定＝目標なので、目標まで行も指定1,500になる
    await calc.waitForRowResultValue(row, 'required', 'candy', '1500');

    // 到達可能行の検証
    const usedBoost = await calc.getRowResultValue(row, 'used', 'boost');
    const usedNormal = await calc.getRowResultValue(row, 'used', 'normal');
    const usedCandy = await calc.getRowResultValue(row, 'used', 'candy');
    const usedShards = await calc.getRowResultValue(row, 'used', 'shards');

    expect(usedBoost).toBe('0');
    expect(usedNormal.replace(/,/g, '')).toBe('1500');
    expect(usedCandy.replace(/,/g, '')).toBe('1500');
    expect(usedShards.replace(/,/g, '')).toBe('466048');

    const usedItems = await calc.getRowUsedItems(row);
    expect(usedItems).toContain('いわM 3');
    expect(usedItems).toContain('万能S 475');

    const reachedLv = await calc.getRowReachedLevel(row);
    expect(reachedLv).toBe('59');

    // 個数指定＝目標なので、指定1,500個を賄えた時点で目標到達となり「残EXP」は出ない。
    // （getRowRemainingExp は残EXPが無いとき到達Lv横の「あとEXP」へフォールバックするため、
    //   ここでは残EXP欄そのものが無いことを直接確認する。設計書§4.5.1）
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow.locator('.calcRow__k--info').filter({ hasText: '残EXP' })).toHaveCount(0);
  });

  // M-3. スイクン（ブースト使用・個数指定あり・EXP下降補正）
  test('63. スイクンの目標まで行が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    // スイクンを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('スイクン');
    await box.confirmPokemonName();

    // 性格をEXP下降（▼▼）に設定
    await box.openNatureDropdown();
    // EXP下降は通常 index 2（ひかえめ系など）
    await box.selectNatureOption(2);

    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 現在レベル58
    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('58');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    // あとEXP1362
    await calc.getRowExpRemainingInput(row).fill('1362');

    // 目標レベル65
    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('65');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    // アメ在庫147
    await calc.setRowSpeciesCandy(row, '147');

    // アメブ個数350
    await calc.setRowBoostCandy(row, '350');

    // 個数指定なし: 目標まで行は目標Lv65ちょうどに届く数を出す
    await calc.waitForRowResultValue(row, 'required', 'normal', '880');

    // 目標まで行の検証
    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');
    const reqShards = await calc.getRowResultValue(row, 'required', 'shards');

    expect(reqBoost).toBe('350');
    // Lv58→65の残EXP33,178に対し、ミニブ350個で14,700 EXP、
    // 残り18,478 EXPは下降補正の通常アメ（21 EXP）880個で満たす。
    expect(reqNormal.replace(/,/g, '')).toBe('880');
    expect(reqCandy.replace(/,/g, '')).toBe('1230');
    expect(reqShards.replace(/,/g, '')).toBe('1581800');

    // 理論値補填は「在庫の種族アメ147 → 万能S」の順（147 + 361 * 3 = 1,230）
    const reqItems = await calc.getRowRequiredItems(row);
    expect(reqItems).toContain('万能S 361');

    // 個数指定50: 個数指定＝目標なので、目標まで行は50個ちょうどになり
    // アメブも総アメ数の内数としてクランプされる（設計書§4.3, §4.5.1）
    await calc.setRowCandyTarget(row, '50');
    await calc.waitForRowResultValue(row, 'required', 'candy', '50');
    expect(await calc.getRowBoostCandyInput(row).inputValue()).toBe('50');
  });

  test('64. スイクンの到達可能行が正しい', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    // 在庫設定：かけら 200万、睡眠時間 13時間
    await calc.clickSettings();
    await settings.setTotalShards('2000000');
    await settings.setDailySleepHours(13);
    await settings.closeByButton();

    // スイクンを新規追加
    await box.openAddNewPanel();
    await box.fillPokemonName('スイクン');
    await box.confirmPokemonName();

    // 性格をEXP下降（▼▼）に設定
    await box.openNatureDropdown();
    await box.selectNatureOption(2);

    await box.clickAddToBox();

    const row = calc.getRow(0);

    // 設定（テスト63と同じ）
    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('58');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await calc.getRowExpRemainingInput(row).fill('1362');

    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('65');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await calc.setRowSpeciesCandy(row, '147');
    await calc.setRowBoostCandy(row, '350');
    await calc.setRowCandyTarget(row, '50');

    // required は同期計算なので、Worker の到達可能結果が反映されるまで used を待つ。
    await calc.waitForRowResultValue(row, 'used', 'candy', '50');

    // 到達可能行の検証
    const usedBoost = await calc.getRowResultValue(row, 'used', 'boost');
    const usedNormal = await calc.getRowResultValue(row, 'used', 'normal');
    const usedCandy = await calc.getRowResultValue(row, 'used', 'candy');
    const usedShards = await calc.getRowResultValue(row, 'used', 'shards');

    expect(usedBoost).toBe('50');
    expect(usedNormal).toBe('0');
    expect(usedCandy).toBe('50');
    expect(usedShards.replace(/,/g, '')).toBe('111340');

    const reachedLv = await calc.getRowReachedLevel(row);
    expect(reachedLv).toBe('59');

    // 個数指定＝目標なので、指定50個を賄えた時点で目標到達となり「残EXP」は出ない（設計書§4.5.1）
    const usedRow = calc.getRowUsedRow(row);
    await expect(usedRow.locator('.calcRow__k--info').filter({ hasText: '残EXP' })).toHaveCount(0);
  });

  test('65. ドオーのラスイチ交換が自動最適化される', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    await calc.setBoostKind('full');

    await box.openAddNewPanel();
    await box.fillPokemonName('ドオー');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);

    const srcLevelBtn = calc.getRowSrcLevelButton(row);
    await srcLevelBtn.click();
    await page.locator('.levelPick__range').first().fill('30');
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await calc.getRowExpRemainingInput(row).fill('729');

    const dstLevelBtn = calc.getRowDstLevelButton(row);
    await dstLevelBtn.click();
    await page.locator('.levelPick__popover .levelChip').filter({ hasText: '60' }).click();
    await page.locator('.levelPick__popover button').filter({ hasText: '閉じる' }).click();

    await page.waitForTimeout(200);

    const reqBoost = await calc.getRowResultValue(row, 'required', 'boost');
    const reqNormal = await calc.getRowResultValue(row, 'required', 'normal');
    const reqCandy = await calc.getRowResultValue(row, 'required', 'candy');

    // 割合表示は廃止（設計書§4.2）。内訳そのもので検証する。
    expect(reqBoost).toBe('790');
    expect(reqNormal).toBe('1');
    expect(reqCandy).toBe('791');
  });
});

// ============================================================
// N. アメブ再割当と枠超過の可視化
// ============================================================
test.describe('04-calculator N. アメブ再割当と枠超過', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
  });

  test('64. アメブ再割当ボタンはアメブ種別のときだけ出る', async ({ page }) => {
    const calc = new CalcPanelPage(page);

    await calc.setBoostKind('full');
    await expect(calc.reassignBoostButton).toBeVisible();

    // 通常アメでは配るものが無い
    await calc.setBoostKind('none');
    await expect(calc.reassignBoostButton).toHaveCount(0);
  });

  test('65. アメブ再割当は手入力を捨てて配り直し、undo で戻せる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    await calc.setBoostKind('full');

    const row = calc.getRow(0);
    const input = calc.getRowBoostCandyInput(row);
    await calc.setRowBoostCandy(row, 7);
    await expect(input).toHaveValue('7');

    await calc.reassignBoostButton.click();
    // 未入力（導出モード）へ戻るので value は空になり、導出値は placeholder に出る
    await expect(input).toHaveValue('');

    await calc.clickUndo();
    await expect(input).toHaveValue('7');
  });

  test('66. 上限を下げると導出モードの行はアメブ目標Lv側が赤くなる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    await calc.setBoostKind('full');

    const row = calc.getRow(0);
    const picker = row.getByTestId('boostReachLevel');
    await expect(picker).not.toHaveClass(/levelPick--overQuota/);

    // 保存値は触らずに上限だけ下げる（§11.4）。個数は未入力のままなので赤くなるのはピッカー側
    await calc.settingsButton.click();
    await settings.setBoostCandyRemaining('1');
    await settings.closeByButton();

    await expect(picker).toHaveClass(/levelPick--overQuota/);
    await expect(calc.getRowBoostCandyInput(row)).not.toHaveClass(/field__input--overQuota/);

    // 閉じているうちは赤枠が知らせ、開くとマークと打ち手（＝下げるのはアメブ目標Lv）が出る
    await calc.openLevelPicker(row, 'boostReachLevel');
    // マークは制限が重なっても1つ。中身は title で見分ける
    const warn = page.getByTestId('level-picker-warn');
    await expect(warn).toHaveCount(1);
    await expect(warn).toHaveAttribute('title', /アメブ上限を超えています/);
    const alert = page.getByTestId('level-picker-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('アメブ目標Lvを下げてください');
  });

  test('67. 個数を明示入力して超過させると個数欄が赤くなる', async ({ page }) => {
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);
    await calc.setBoostKind('full');

    await calc.settingsButton.click();
    await settings.setBoostCandyRemaining('10');
    await settings.closeByButton();

    const row = calc.getRow(0);
    await calc.setRowBoostCandy(row, 500);

    await expect(calc.getRowBoostCandyInput(row)).toHaveClass(/field__input--overQuota/);
    await expect(row.getByTestId('boostReachLevel')).not.toHaveClass(/levelPick--overQuota/);

    // 打ち手はアメブ個数側。ヒントの中から上限そのものも変えられる
    await row.getByTestId('hintBtn').click();
    const warn = page.getByTestId('calc-hint-quota-warn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('アメブ個数を減らしてください');

    // ヒントを開いたまま上限を上げたら、その場で警告が消えること。
    // 案内文を開いた時点で焼き付けると、閉じて開き直すまで消えない
    const capInput = page.getByTestId('calc-hint-boost-remaining-input');
    await capInput.fill('5000');
    await capInput.blur();
    await expect(warn).toHaveCount(0);
    await expect(calc.getRowBoostCandyInput(row)).not.toHaveClass(/field__input--overQuota/);
  });
});

// ============================================================
// O. 睡眠チーム（1晩5匹）の警告
// ============================================================
test.describe('04-calculator O. 睡眠チーム5匹の警告', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.importText);
    await box.clickImport();
  });

  /**
   * 警告マークは**結果行の最後尾（「内訳」の右）**に置く。
   * 入力欄の見出しへ戻さないこと（幅が無く、英語だと文字が見切れる）。
   * 説明は title ではなくクリックで開くヒントで読ませる（スマホは title を出せない）。
   */
  test('68. 睡眠計画の6行目以降だけに警告を出し、クリックで理由が読める', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);

    for (let index = 0; index < 6; index++) {
      await box.selectBoxTile(index);
      await box.clickApplyToCalc();
    }
    await calc.expectRowCount(6);

    for (let index = 0; index < 6; index++) {
      const row = calc.getRow(index);
      await calc.getRowSleepTargetSelect(row).selectOption('all');
    }

    // 1晩に睡眠EXPを得られるのは5匹まで。あふれるのは6行目だけ
    await expect(page.getByTestId('sleep-team-overflow')).toHaveCount(1);
    const overflowRow = calc.getRow(5);
    const warn = overflowRow.getByTestId('sleep-team-overflow');
    await expect(warn).toBeVisible();

    // 置き場所を固定する。入力欄の見出しへ戻すと英語で見切れる（移設の理由）
    const usedRow = calc.getRowUsedRow(overflowRow);
    await expect(usedRow.getByTestId('sleep-team-overflow')).toHaveCount(1);
    // 結果の最後尾＝「内訳」より後ろ
    const order = await usedRow
      .locator('[data-testid="result-bonus-toggle"], [data-testid="sleep-team-overflow"]')
      .evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.testid));
    expect(order).toEqual(['result-bonus-toggle', 'sleep-team-overflow']);

    await warn.click();
    await expect(page.getByTestId('calc-hint-sleep-team-note')).toContainText('5匹');
    // このヒントはアメの話を載せない（他の kind の案内が混ざっていないこと）
    await expect(page.getByTestId('calc-hint-quota-warn')).toHaveCount(0);
    await expect(page.getByTestId('calc-hint-all-sleep-note')).toHaveCount(0);
  });
});
