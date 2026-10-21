/**
 * 12-fine-tune.spec.ts
 * やりくりモーダル（FineTuneModal）のE2Eテスト（設計書 §12.2）
 *
 * カバー範囲:
 *   - モード1（アメブ・目標Lv）→ 適用 → 計算機の元に戻す1回で戻る
 *   - モード2（ゆずる・受け取る）、並べ替え、アメブなしのスロット
 *   - モーダル内の元に戻す・やり直す（ボタンと Ctrl+Z / Ctrl+Y）と、計算機の履歴が動かないこと
 *   - 全体をリセット、キャンセル、×の確認
 *   - スマホ幅で2段表示が崩れないこと（chromium-mobile で走る）
 */
import { test, expect, devices, type Page } from '@playwright/test';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { CalcPanelPage } from './pages/CalcPanelPage';
import { FineTuneModalPage } from './pages/FineTuneModalPage';
import { SettingsModalPage } from './pages/SettingsModalPage';

interface RowSpec {
  name: string;
  /** 目標Lv（現在Lvは 10） */
  dst: number;
  /** 種族アメの在庫 */
  candy: string;
}

interface Scenario {
  rows: RowSpec[];
  /** 夢のかけらの所持数 */
  shards: string;
  /** アメブの残り枠 */
  boostRemaining?: string;
  boostKind?: 'full' | 'none';
}

/** 全員が届く3匹。かけらもアメも潤沢。 */
const ALL_REACHED: Scenario = {
  shards: '3000000',
  rows: [
    { name: 'ピカチュウ', dst: 40, candy: '99999' },
    { name: 'イーブイ', dst: 40, candy: '99999' },
    { name: 'ヒトカゲ', dst: 60, candy: '99999' },
  ],
};

/**
 * ゆずる・受け取る用。かけらが足りず、ヒトカゲ（受け取る側）が届かない。
 * フシギダネはアメの在庫が少なく、受け取る側より上で届かない行になる。
 */
const GIVE_AND_RECEIVE: Scenario = {
  shards: '1450000',
  rows: [
    { name: 'ピカチュウ', dst: 40, candy: '99999' },
    { name: 'フシギダネ', dst: 50, candy: '100' },
    { name: 'イーブイ', dst: 40, candy: '99999' },
    { name: 'ヒトカゲ', dst: 60, candy: '99999' },
  ],
};

/**
 * アメブの枠が足りず、ヒトカゲのアメブが全アメブ点に届かない。
 * ピカチュウのアメブを減らして枠を空け、ヒトカゲのアメブを増やすと到達Lvが上がる。
 */
const BOOST_LIMITED: Scenario = {
  shards: '12000000',
  boostRemaining: '450',
  rows: [
    { name: 'ピカチュウ', dst: 40, candy: '99999' },
    { name: 'ヒトカゲ', dst: 60, candy: '600' },
  ],
};

/** 設定と計算機の行を用意する（PC幅。スマホでは数値欄がキーパッドの読み取り専用になるため、スマホ幅の検査は別のコンテキストへ引き継ぐ）。 */
async function setupScenario(page: Page, scenario: Scenario) {
  await page.goto('/');
  const box = new BoxPanelPage(page);
  const calc = new CalcPanelPage(page);
  const settings = new SettingsModalPage(page);

  await calc.clickSettings();
  await settings.setUniversalCandy('S', 0);
  await settings.setUniversalCandy('M', 0);
  await settings.setUniversalCandy('L', 0);
  await settings.setTotalShards(scenario.shards);
  await settings.setBoostCandyRemaining(scenario.boostRemaining ?? '3000');
  await settings.closeByButton();
  await calc.setBoostKind(scenario.boostKind ?? 'full');

  for (const [index, spec] of scenario.rows.entries()) {
    await box.openAddNewPanel();
    await box.fillPokemonName(spec.name);
    await box.confirmPokemonName();
    await box.clickAddToBox();
    const row = calc.getRow(index);
    await calc.setRowSrcLevel(row, 10);
    await calc.setRowDstLevel(row, spec.dst);
    await calc.setRowSpeciesCandy(row, spec.candy);
  }
  await calc.expectRowCount(scenario.rows.length);
  await calc.waitForPlannerResult();
  return { calc, fineTune: new FineTuneModalPage(page) };
}

/** 計算機の行の並び（名前）を確かめる。 */
async function expectCalcOrder(calc: CalcPanelPage, names: string[]): Promise<void> {
  await calc.expectRowCount(names.length);
  for (const [index, name] of names.entries()) {
    await expect(calc.getRow(index)).toContainText(name);
  }
}

test.describe('12-fine-tune（PC）', () => {
  test.skip(({ isMobile }) => isMobile, 'スマホ幅の検査は別の describe');

  test('モード1: アメブ▲でプレビューの到達Lvと棒が変わり、適用で計算機が変わり、計算機の元に戻す1回で戻る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, BOOST_LIMITED);
    const pikachuBefore = await calc.getRowBoostCandyInput(calc.getRow(0)).inputValue();
    const hitokageBefore = await calc.getRowBoostCandyInput(calc.getRow(1)).inputValue();

    await fineTune.open();
    await fineTune.waitForSettled();
    await fineTune.selectStep(100);
    const pikachu = fineTune.rowByName('ピカチュウ');
    const hitokage = fineTune.rowByName('ヒトカゲ');
    const levelBefore = await fineTune.reachLevel(hitokage);
    const barBefore = await fineTune.barPercent(hitokage);
    const pikachuBoost = await fineTune.boostValue(pikachu);
    const hitokageBoost = await fineTune.boostValue(hitokage);

    // ピカチュウのアメブを減らして枠を空け、ヒトカゲのアメブを増やす
    await fineTune.boostDown(pikachu);
    await fineTune.boostUp(hitokage);
    expect(await fineTune.boostValue(pikachu)).toBe(pikachuBoost - 100);
    expect(await fineTune.boostValue(hitokage)).toBe(hitokageBoost + 100);
    await expect(fineTune.calculating).toBeVisible();
    await fineTune.waitForSettled();
    // 到達Lvの表示が `Lv○ → Lv○` になり、棒が伸びる
    await expect.poll(() => fineTune.reachLevel(hitokage)).toBeGreaterThanOrEqual(levelBefore);
    await expect.poll(async () => (await fineTune.barPercent(hitokage)) ?? 0).toBeGreaterThan(barBefore ?? 0);
    await expect(hitokage.getByTestId('fine-tune-row-boost-delta')).toContainText(`${hitokageBoost} → ${hitokageBoost + 100}`);

    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expect(calc.getRowBoostCandyInput(calc.getRow(0))).toHaveValue(String(pikachuBoost - 100));
    await expect(calc.getRowBoostCandyInput(calc.getRow(1))).toHaveValue(String(hitokageBoost + 100));

    // 計算機の元に戻す1回で、適用の前へまとめて戻る
    await calc.clickUndo();
    await expect(calc.getRowBoostCandyInput(calc.getRow(0))).toHaveValue(pikachuBefore);
    await expect(calc.getRowBoostCandyInput(calc.getRow(1))).toHaveValue(hitokageBefore);
  });

  test('モード1: 全員届いているときは「〇〇のLvを上げる」が出ず、目標Lv▲を適用すると計算機の目標Lvが変わる', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();

    await expect(fineTune.diagnosis).toHaveAttribute('data-kind', 'allReachedRoom');
    await expect(page.getByTestId('fine-tune-row-recommend')).toHaveCount(0);

    const pikachu = fineTune.rowByName('ピカチュウ');
    expect(await fineTune.targetLevel(pikachu)).toBe(40);
    await fineTune.targetUp(pikachu);
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await expect(pikachu.getByTestId('fine-tune-row-target-delta')).toHaveText('40 → 41');
    await fineTune.waitForSettled();

    await fineTune.apply();
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('41');
  });

  test('モード2: 受け取る側を選ぶと届かない行が下へ動き、ゆずる側のスライダーを離すと棒が縮み、受け取る側の棒が伸びる', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, GIVE_AND_RECEIVE);
    await fineTune.open();
    await fineTune.waitForSettled();
    await fineTune.selectMode('yield');

    // 受け取る側を選ぶ前: 受け取る側の欄は案内だけで、スライダーは無い
    await expect(fineTune.receiverHint).toBeVisible();
    await expect(page.getByTestId('fine-tune-row-give')).toHaveCount(0);

    const hitokage = fineTune.rowByName('ヒトカゲ');
    await fineTune.receive(hitokage);
    await fineTune.waitForSettled();

    // 上の届かない行（フシギダネ）が受け取る側の下へ動く。上部に受け取りの欄、上の行すべてにスライダー
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'イーブイ', 'ヒトカゲ', 'フシギダネ']);
    await expect(fineTune.rowByName('フシギダネ').getByTestId('fine-tune-row-order')).toContainText('順番 2 → 4');
    await expect(fineTune.receiverName).toHaveText('受け取り：ヒトカゲ');
    const pikachu = fineTune.rowByName('ピカチュウ');
    const eevee = fineTune.rowByName('イーブイ');
    await expect(fineTune.getGiveSlider(pikachu)).toBeVisible();
    await expect(fineTune.getGiveSlider(eevee)).toBeVisible();
    await expect(page.getByTestId('fine-tune-row-give')).toHaveCount(2);
    const m0 = Number(await fineTune.getGiveSlider(pikachu).getAttribute('max'));
    expect(m0).toBeGreaterThan(100);

    const receiverBarBefore = (await fineTune.barPercent(hitokage)) ?? 0;
    const giverBarBefore = (await fineTune.barPercent(pikachu)) ?? 0;
    expect(giverBarBefore).toBe(100);

    // 動かしている間: op もプレビューの計算も起きず、ゆずる側の棒だけが縮む（受け取る側は動かない）
    await fineTune.dragGiveSlider(pikachu, 100);
    await expect(fineTune.giveHint).toBeVisible();
    await expect.poll(async () => (await fineTune.barPercent(pikachu)) ?? 100).toBeLessThan(giverBarBefore);
    await expect(pikachu.getByTestId('fine-tune-row-bar-target')).toBeVisible();
    await expect(fineTune.calculating).toHaveCount(0);
    expect(await fineTune.barPercent(hitokage)).toBe(receiverBarBefore);
    await expect(pikachu.getByTestId('fine-tune-row-give-value')).toHaveText(`${m0} → 100`);
    const liveBar = (await fineTune.barPercent(pikachu))!;

    // 離すと op が通る。動かしている間の棒と、離したあとにソルバーが返す棒が（四捨五入の範囲で）一致する
    await fineTune.releaseGiveSlider(pikachu);
    await expect(fineTune.giveHint).toHaveCount(0);
    await fineTune.waitForSettled();
    expect(Math.abs((await fineTune.barPercent(pikachu))! - liveBar)).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await fineTune.barPercent(hitokage)) ?? 0).toBeGreaterThan(receiverBarBefore);

    // 2行目のゆずる側
    const receiverBarMid = (await fineTune.barPercent(hitokage)) ?? 0;
    await fineTune.setGiveSlider(eevee, 100);
    await fineTune.waitForSettled();
    await expect.poll(async () => (await fineTune.barPercent(eevee)) ?? 100).toBeLessThan(100);
    await expect.poll(async () => (await fineTune.barPercent(hitokage)) ?? 0).toBeGreaterThanOrEqual(receiverBarMid);
    expect(await fineTune.barPercent(pikachu)).toBeLessThan(100);

    // 選択を外しても、減らした数とスライダーは残る
    await fineTune.receiverClear.click();
    await expect(fineTune.receiverName).toHaveCount(0);
    await expect(fineTune.receiverHint).toBeVisible();
    await expect(page.getByTestId('fine-tune-row-give')).toHaveCount(2);
    await expect(fineTune.getGiveSlider(pikachu)).toHaveValue('100');
    await expect(fineTune.getGiveSlider(eevee)).toHaveValue('100');
    await expect(pikachu.getByTestId('fine-tune-row-give-value')).toHaveText(`${m0} → 100`);

    // 適用: ゆずる側が個数指定の行になり、順番も計算機へ移る
    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expectCalcOrder(calc, ['ピカチュウ', 'イーブイ', 'ヒトカゲ', 'フシギダネ']);
    await expect(calc.getRowCandyTargetInput(calc.getRow(0))).toHaveValue('100');
    await expect(calc.getRowCandyTargetInput(calc.getRow(1))).toHaveValue('100');

    // 計算機の元に戻す1回で、適用の前へ戻る（順番と個数指定の両方）
    await calc.clickUndo();
    await expectCalcOrder(calc, ['ピカチュウ', 'フシギダネ', 'イーブイ', 'ヒトカゲ']);
    await expect(calc.getRowCandyTargetInput(calc.getRow(0))).toHaveValue('');
    await expect(calc.getRowCandyTargetInput(calc.getRow(2))).toHaveValue('');
  });

  test('並べ替え: ↑↓とつかんで動かす操作で行が動き、順番の札が出て、適用すると計算機の順番が変わる', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(page.getByTestId('fine-tune-row-order')).toHaveCount(0);
    // 端の行は端の向きの矢印が無効
    await expect(fineTune.rows.first().getByTestId('fine-tune-row-up')).toBeDisabled();
    await expect(fineTune.rows.last().getByTestId('fine-tune-row-down')).toBeDisabled();

    // ↑: 3番目のヒトカゲを2番目へ
    await fineTune.moveUp(fineTune.rowByName('ヒトカゲ'));
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'ヒトカゲ', 'イーブイ']);
    await expect(fineTune.rowByName('ヒトカゲ').getByTestId('fine-tune-row-order')).toHaveText('順番 3 → 2 ↑');
    await expect(fineTune.rowByName('イーブイ').getByTestId('fine-tune-row-order')).toHaveText('順番 2 → 3 ↓');

    // つかんで動かす: 先頭のピカチュウを3番目へ
    await fineTune.dragRowTo(fineTune.rowByName('ピカチュウ'), 2);
    expect(await fineTune.rowTitles()).toEqual(['ヒトカゲ', 'イーブイ', 'ピカチュウ']);
    await expect(fineTune.rowByName('ピカチュウ').getByTestId('fine-tune-row-order')).toHaveText('順番 1 → 3 ↓');
    await expect(fineTune.rowByName('ヒトカゲ').getByTestId('fine-tune-row-order')).toHaveText('順番 3 → 1 ↑');
    // イーブイは元の2番目のまま（札が消える）
    await expect(fineTune.rowByName('イーブイ').getByTestId('fine-tune-row-order')).toHaveCount(0);

    await fineTune.apply();
    await expectCalcOrder(calc, ['ヒトカゲ', 'イーブイ', 'ピカチュウ']);
  });

  test('アメブなしのスロット: アメブの列が無く、目標Lvとゆずる・受け取るが使える', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, {
      ...ALL_REACHED,
      boostKind: 'none',
      shards: '12000000',
    });
    await fineTune.open();
    await fineTune.waitForSettled();

    // アメブの列・個数欄・サマリーの残り枠が無い
    await expect(page.getByTestId('fine-tune-row-boost-input')).toHaveCount(0);
    await expect(page.getByTestId('fine-tune-row-boost-up')).toHaveCount(0);
    await expect(page.locator('.fineTuneHead__cell--boost')).toHaveCount(0);
    await expect(fineTune.summaryBoost).toHaveCount(0);

    // 目標Lv
    const pikachu = fineTune.rowByName('ピカチュウ');
    await fineTune.targetUp(pikachu);
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await fineTune.waitForSettled();

    // ゆずる・受け取る
    await fineTune.selectMode('yield');
    await fineTune.receive(fineTune.rowByName('ヒトカゲ'));
    await expect(fineTune.receiverName).toHaveText('受け取り：ヒトカゲ');
    await expect(fineTune.getGiveSlider(pikachu)).toBeVisible();
    await fineTune.setGiveSlider(pikachu, 100);
    await fineTune.waitForSettled();
    await expect(pikachu.getByTestId('fine-tune-row-give-value')).toContainText('→ 100');

    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expect(calc.getRowCandyTargetInput(calc.getRow(0))).toHaveValue('100');
  });

  test('元に戻す・やり直す: ボタンと Ctrl+Z / Ctrl+Y で1つずつ戻り進み、開いている間は計算機の履歴が動かない', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    const calcUndoEnabled = await calc.undoButton.isEnabled();
    await fineTune.open();
    await fineTune.waitForSettled();
    await expect(fineTune.undoButton).toBeDisabled();
    await expect(fineTune.redoButton).toBeDisabled();

    const pikachu = fineTune.rowByName('ピカチュウ');
    const boostBefore = await fineTune.boostValue(pikachu);
    // 別々の操作を3つ（同じものへの連続操作は1件にまとまるので、対象を変える）
    await fineTune.boostDown(pikachu);
    await fineTune.moveUp(fineTune.rowByName('ヒトカゲ'));
    await fineTune.targetUp(pikachu);
    expect(await fineTune.boostValue(pikachu)).toBe(boostBefore - 10);
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'ヒトカゲ', 'イーブイ']);

    // ボタン: 目標Lv → 並べ替え → アメブの順に戻る
    await fineTune.undoButton.click();
    expect(await fineTune.targetLevel(pikachu)).toBe(40);
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'ヒトカゲ', 'イーブイ']);
    await fineTune.undoButton.click();
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    expect(await fineTune.boostValue(pikachu)).toBe(boostBefore - 10);
    await fineTune.undoButton.click();
    expect(await fineTune.boostValue(pikachu)).toBe(boostBefore);
    await expect(fineTune.undoButton).toBeDisabled();
    await expect(fineTune.redoButton).toBeEnabled();

    // ボタンでやり直す
    await fineTune.redoButton.click();
    expect(await fineTune.boostValue(pikachu)).toBe(boostBefore - 10);
    await fineTune.redoButton.click();
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'ヒトカゲ', 'イーブイ']);
    await fineTune.redoButton.click();
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await expect(fineTune.redoButton).toBeDisabled();

    // キー: Ctrl+Z で1つずつ戻り、Ctrl+Y で進む。下書きの履歴を使い切ったあとの Ctrl+Z も計算機へ漏れない
    await page.keyboard.press('Control+z');
    expect(await fineTune.targetLevel(pikachu)).toBe(40);
    await page.keyboard.press('Control+z');
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await page.keyboard.press('Control+z');
    expect(await fineTune.boostValue(pikachu)).toBe(boostBefore);
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('Control+z');
    await expect(fineTune.undoButton).toBeDisabled();
    await page.keyboard.press('Control+y');
    expect(await fineTune.boostValue(pikachu)).toBe(boostBefore - 10);
    await page.keyboard.press('Control+y');
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'ヒトカゲ', 'イーブイ']);

    // 個数欄の中の Ctrl+Z は文字の取り消しになり、下書きは戻らない
    await fineTune.targetUp(pikachu);
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await fineTune.getHandle(pikachu).focus();
    const boostInput = pikachu.getByTestId('fine-tune-row-boost-input');
    await boostInput.click();
    await page.keyboard.type('7');
    await page.keyboard.press('Control+z');
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await expect(fineTune.undoButton).toBeEnabled();

    // 開いている間、計算機の行と元に戻すボタンは変わっていない（Ctrl+Z が漏れていない）
    await fineTune.cancel();
    await expectCalcOrder(calc, ['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('40');
    expect(await calc.undoButton.isEnabled()).toBe(calcUndoEnabled);
  });

  test('全体をリセット・キャンセル・×の確認', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    await expect(fineTune.resetButton).toBeDisabled();

    // 下書きが無ければ × はそのまま閉じる
    await fineTune.closeButton.click();
    await expect(fineTune.overlay).toHaveCount(0);

    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    await fineTune.targetUp(pikachu);
    await fineTune.moveUp(fineTune.rowByName('ヒトカゲ'));
    await expect(fineTune.resetButton).toBeEnabled();

    // 全体をリセット: 開いた直後に戻り、確認は出ない。元に戻す1回でリセットの前へ戻る
    await fineTune.resetButton.click();
    expect(await fineTune.targetLevel(pikachu)).toBe(40);
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(fineTune.resetButton).toBeDisabled();
    await expect(fineTune.applyButton).toBeDisabled();
    await fineTune.undoButton.click();
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'ヒトカゲ', 'イーブイ']);

    // 下書きがあるときの ×: 確認が出る。「戻る」で開いたまま、「破棄して閉じる」で閉じる
    await fineTune.closeButton.click();
    await expect(fineTune.discardConfirm).toBeVisible();
    await fineTune.discardConfirmNo.click();
    await expect(fineTune.discardConfirm).toHaveCount(0);
    await expect(fineTune.modal).toBeVisible();
    await fineTune.closeButton.click();
    await fineTune.discardConfirmYes.click();
    await expect(fineTune.overlay).toHaveCount(0);
    await expectCalcOrder(calc, ['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('40');

    // キャンセルは確認なしで閉じ、計算機は変わらない
    await fineTune.open();
    await fineTune.waitForSettled();
    await fineTune.targetUp(fineTune.rowByName('ピカチュウ'));
    await fineTune.cancel();
    await expectCalcOrder(calc, ['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('40');
  });
});

test.describe('12-fine-tune（スマホ幅）', () => {
  test.skip(({ isMobile }) => !isMobile, 'chromium-mobile の project だけで走る');

  test('2段表示が崩れず、横にはみ出さず、押す部品が小さすぎない', async ({ browser, baseURL }, testInfo) => {
    // 準備はPC幅の別のコンテキストで行い、保存された内容（localStorage）をスマホのコンテキストへ引き継ぐ
    // （newContext は project の端末設定を引き継ぐので、PC の端末設定で上書きする）
    const seed = await browser.newContext({
      ...devices['Desktop Chrome'],
      baseURL,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      viewport: { width: 1440, height: 900 },
      storageState: testInfo.project.use.storageState,
    });
    const seedPage = await seed.newPage();
    await setupScenario(seedPage, GIVE_AND_RECEIVE);
    // 保存はアイドル時に遅れて行われる。最後の設定まで保存されるのを待ってから引き継ぐ
    await expect.poll(() => seedPage.evaluate(() => ({
      calc: (localStorage.getItem('candy-boost-planner:calc:slots:v1') ?? '').includes('"dstLevel":60'),
      candy: ((localStorage.getItem('candy-boost-planner:candy-inventory:v2') ?? '').match(/99999/g) ?? []).length >= 3,
    }))).toEqual({ calc: true, candy: true });
    const storageState = await seed.storageState();
    await seed.close();

    const phone = await browser.newContext({
      ...devices['iPhone 13'],
      baseURL,
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      storageState,
    });
    const page = await phone.newPage();
    await page.goto('/');
    const fineTune = new FineTuneModalPage(page);
    await fineTune.open();
    await fineTune.waitForSettled();
    const viewport = page.viewportSize()!;
    expect(viewport.width).toBeLessThan(680);

    // モーダルは全画面で、横スクロールが無い
    const modalBox = (await fineTune.modal.boundingBox())!;
    expect(modalBox.x).toBeGreaterThanOrEqual(0);
    expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(viewport.width + 1);
    const overflow = await fineTune.list.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBe(0);

    // モード1とモード2のどちらでも、各行が2段（名前・棒・アメブ → 目標Lv・アメ・かけら）に収まる
    for (const mode of ['raise', 'yield'] as const) {
      await fineTune.selectMode(mode);
      if (mode === 'yield') await fineTune.receive(fineTune.rowByName('ヒトカゲ'));
      await fineTune.waitForSettled();
      const count = await fineTune.rows.count();
      expect(count).toBe(4);
      for (let i = 0; i < count; i += 1) {
        const row = fineTune.rows.nth(i);
        await row.scrollIntoViewIfNeeded();
        const rowBox = (await row.boundingBox())!;
        expect(rowBox.x).toBeGreaterThanOrEqual(0);
        expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(viewport.width + 1);

        const cell = async (name: string) => (await row.locator(`.fineTuneRow__cell--${name}`).boundingBox())!;
        const title = (await row.getByTestId('fine-tune-row-title').boundingBox())!;
        const exp = await cell('exp');
        const target = await cell('target');
        const candy = await cell('candy');
        const shards = await cell('shards');
        // 1段目（名前 → 棒）が上、2段目（目標Lv・アメ・かけら）が下
        expect(title.y).toBeLessThan(exp.y);
        expect(target.y).toBeGreaterThanOrEqual(exp.y + exp.height - 1);
        // 2段目の3つは同じ段（縦の範囲が重なる）に左から並び、画面内に収まる
        for (const other of [candy, shards]) {
          expect(other.y).toBeLessThan(target.y + target.height);
          expect(other.y + other.height).toBeGreaterThan(target.y);
        }
        expect(target.x + target.width).toBeLessThanOrEqual(candy.x + 1);
        expect(candy.x + candy.width).toBeLessThanOrEqual(shards.x + 1);
        expect(shards.x + shards.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    }

    // 押す部品（取っ手・▲▼・スライダーの ▲▼）が小さすぎない
    await fineTune.selectMode('raise');
    const first = fineTune.rows.first();
    for (const testId of ['fine-tune-row-handle', 'fine-tune-row-boost-up', 'fine-tune-row-boost-down', 'fine-tune-row-target-up']) {
      const size = (await first.getByTestId(testId).boundingBox())!;
      expect(size.height, testId).toBeGreaterThanOrEqual(30);
      expect(size.width, testId).toBeGreaterThanOrEqual(26);
    }

    // フッターの操作が画面内に収まる
    for (const button of [fineTune.cancelButton, fineTune.applyButton, fineTune.resetButton, fineTune.undoButton]) {
      const rect = (await button.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await phone.close();
  });
});
