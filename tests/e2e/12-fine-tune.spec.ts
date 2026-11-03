/**
 * 12-fine-tune.spec.ts
 * かんたん（FineTuneModal）のE2Eテスト
 *
 * カバー範囲:
 *   - 表の欄を押して調整バーで動かす（アメブ・目標Lv）→ 適用 → 計算機の元に戻す1回で戻る
 *   - 「全体のLvを伸ばす」（全員のアメブをまとめて動かす）、並べ替え、アメブなしのスロット
 *   - モーダル内の元に戻す・やり直す（ボタンと Ctrl+Z / Ctrl+Y）と、計算機の履歴が動かないこと
 *   - Escape と × の確認
 *   - スマホ幅で行が1行に収まり、調整バーを開いても全員が見えること（chromium-mobile で走る）
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
 * 全体のLvを伸ばす用。かけらが足りず、ヒトカゲが届かない。フシギダネはアメの在庫が少なく届かない。
 * アメの余っている上の行（ピカチュウ・イーブイ）のアメブを減らすと、浮いたかけらでヒトカゲが届く。
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

  // アメブの種類を変えると残り枠が既定に戻るので、種類を先に決めてから設定する
  await calc.setBoostKind(scenario.boostKind ?? 'full');
  await calc.clickSettings();
  await settings.setUniversalCandy('S', 0);
  await settings.setUniversalCandy('M', 0);
  await settings.setUniversalCandy('L', 0);
  await settings.setTotalShards(scenario.shards);
  // アメブなしの種類には残り枠の欄が無い
  if ((scenario.boostKind ?? 'full') !== 'none') await settings.setBoostCandyRemaining(scenario.boostRemaining ?? '3000');
  await settings.closeByButton();

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

  test('アメブ: 欄を押して刻みで動かすとプレビューの到達点が変わり、適用で計算機が変わり、計算機の元に戻す1回で戻る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, BOOST_LIMITED);
    const pikachuBefore = await calc.getRowBoostCandyInput(calc.getRow(0)).inputValue();
    const hitokageBefore = await calc.getRowBoostCandyInput(calc.getRow(1)).inputValue();

    await fineTune.open();
    await fineTune.waitForSettled();
    // 何も選んでいないときも操作の場所は出ていて、案内と押せないボタンだけ。見出しは無く、サマリーが × と同じ段にある
    await fineTune.expectIdle();
    await expect(fineTune.modal.locator('.modal__title')).toHaveCount(0);
    await expect(fineTune.summaryBoost).toBeVisible();
    const pikachu = fineTune.rowByName('ピカチュウ');
    const hitokage = fineTune.rowByName('ヒトカゲ');
    const pointBefore = await fineTune.reachPoint(hitokage);
    const pikachuBoost = await fineTune.boostValue(pikachu);
    const hitokageBoost = await fineTune.boostValue(hitokage);

    // ピカチュウのアメブを減らして枠を空け、ヒトカゲのアメブを増やす
    await fineTune.adjust(pikachu, 'boost', -100);
    await expect(fineTune.editorName).toHaveText('ピカチュウ');
    await expect(fineTune.editorInput).toHaveValue(String(pikachuBoost - 100));
    await fineTune.adjust(hitokage, 'boost', 100);
    await expect(fineTune.editorName).toHaveText('ヒトカゲ');
    expect(await fineTune.boostValue(pikachu)).toBe(pikachuBoost - 100);
    expect(await fineTune.boostValue(hitokage)).toBe(hitokageBoost + 100);
    await expect(fineTune.editorChange).toHaveText(`${hitokageBoost} → ${hitokageBoost + 100}`);
    await expect(fineTune.calculating).toBeVisible();
    await fineTune.waitForSettled();
    // 到達点が伸び、到達の欄が変わった印になる
    await expect.poll(() => fineTune.reachPoint(hitokage)).toBeGreaterThan(pointBefore);
    await expect(fineTune.cell(hitokage, 'reach')).toHaveClass(/fineTuneRow__cell--changed/);

    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expect(calc.getRowBoostCandyInput(calc.getRow(0))).toHaveValue(String(pikachuBoost - 100));
    await expect(calc.getRowBoostCandyInput(calc.getRow(1))).toHaveValue(String(hitokageBoost + 100));

    // 計算機の元に戻す1回で、適用の前へまとめて戻る
    await calc.clickUndo();
    await expect(calc.getRowBoostCandyInput(calc.getRow(0))).toHaveValue(pikachuBefore);
    await expect(calc.getRowBoostCandyInput(calc.getRow(1))).toHaveValue(hitokageBefore);
  });

  test('目標Lv: 全員届いているときは「〇〇のLvを上げる」が出ず、刻みと個数欄で動かした目標Lvが計算機へ移る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    await expect(page.getByTestId('fine-tune-row-recommend-mark')).toHaveCount(0);

    const pikachu = fineTune.rowByName('ピカチュウ');
    expect(await fineTune.targetLevel(pikachu)).toBe(40);
    await fineTune.adjust(pikachu, 'target', 1);
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await expect(fineTune.editorChange).toHaveText('40 → 41');
    await expect(fineTune.cell(pikachu, 'target')).toHaveClass(/fineTuneRow__cell--changed/);
    // 全員届いているので、おすすめは出ない
    await expect(fineTune.editorRecommend).toHaveCount(0);

    // 個数欄で打つ。範囲の外は端に収まる（現在Lv 10 より下は 10）
    await fineTune.typeValue(45);
    expect(await fineTune.targetLevel(pikachu)).toBe(45);
    await fineTune.typeValue(3);
    expect(await fineTune.targetLevel(pikachu)).toBe(10);
    await expect(fineTune.stepButton(-1)).toBeDisabled();
    await fineTune.typeValue(45);
    await fineTune.waitForSettled();

    await fineTune.apply();
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('45');
  });

  test('全体のLvを伸ばす: 1回押すと全員のアメブがまとまって変わり、届く行が増え、元に戻す1回で戻り、適用で計算機へ移る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, GIVE_AND_RECEIVE);
    const calcBoostBefore = await calc.getRowBoostCandyInput(calc.getRow(0)).inputValue();
    await fineTune.open();
    await fineTune.waitForSettled();

    const pikachu = fineTune.rowByName('ピカチュウ');
    const hitokage = fineTune.rowByName('ヒトカゲ');
    await expect(pikachu).toHaveAttribute('data-reached', 'true');
    await expect(hitokage).toHaveAttribute('data-reached', 'false');
    const reachedBefore = await fineTune.reachedCount();
    const boosts = async () => Promise.all((await fineTune.rows.all()).map((row) => fineTune.boostValue(row)));
    const boostsBefore = await boosts();
    // アメ1個あたりのかけら（使うかけら ÷ 使うアメ）
    expect(await fineTune.cellNumber(pikachu, 'shardsPerCandy')).toBeGreaterThan(0);

    await fineTune.raise();
    await expect(page.locator('.appToast')).toContainText('全体のLvを伸ばしました');
    // 届いていた行は届いたまま、届く行が増える。ヒトカゲが届く
    expect(await fineTune.reachedCount()).toBeGreaterThan(reachedBefore);
    await expect(pikachu).toHaveAttribute('data-reached', 'true');
    await expect(hitokage).toHaveAttribute('data-reached', 'true');
    const boostsAfter = await boosts();
    expect(boostsAfter.filter((n, i) => n !== boostsBefore[i]!).length).toBeGreaterThanOrEqual(1);
    await expect(fineTune.applyButton).toBeEnabled();

    // 元に戻す1回で押す前へ戻り、やり直すでまた入る
    await fineTune.undoButton.click();
    expect(await boosts()).toEqual(boostsBefore);
    await expect(fineTune.applyButton).toBeDisabled();
    await fineTune.redoButton.click();
    expect(await boosts()).toEqual(boostsAfter);
    await fineTune.waitForSettled();

    // 適用: 計算機のアメブが変わり、計算機の元に戻す1回で戻る
    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expect(calc.getRowBoostCandyInput(calc.getRow(0))).toHaveValue(String(boostsAfter[0]));
    await calc.clickUndo();
    await expect(calc.getRowBoostCandyInput(calc.getRow(0))).toHaveValue(calcBoostBefore);
  });

  test('全体のLvを伸ばす: 全員届いていれば、そう知らせて下書きを変えない', async ({ page }) => {
    const { fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    await fineTune.raise();
    await expect(page.locator('.appToast')).toContainText('全員が目標Lvに届いています');
    await expect(fineTune.applyButton).toBeDisabled();
    await expect(fineTune.undoButton).toBeDisabled();
  });

  test('全体のLvを伸ばす: アメが足りず伸ばせないときは理由を出し、ふつうのトーストより長く表示する', async ({ page }) => {
    // フシギダネだけで、種族アメが足りない（万能アメも無い）。アメブを動かしても伸びない
    const { fineTune } = await setupScenario(page, { shards: '12000000', rows: [{ name: 'フシギダネ', dst: 50, candy: '100' }] });
    await fineTune.open();
    await fineTune.waitForSettled();
    await fineTune.raise();
    const toast = page.locator('.appToast', { hasText: 'アメが足りないため' });
    await expect(toast).toBeVisible();
    // ふつうのトーストは 2 秒で消える。理由のトーストは 4 秒後も出ている
    await page.waitForTimeout(4000);
    await expect(toast).toBeVisible();
    await expect(toast).toBeHidden({ timeout: 4000 });
    await expect(fineTune.applyButton).toBeDisabled();
  });

  test('睡眠: 目標の右隣の睡眠の列に睡眠目標が出て、調整バーで 200h〜2000h・全て・おひるね島とアメ在庫・チケットを選べ、適用で計算機へ移る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    const hitokage = fineTune.rowByName('ヒトカゲ');
    const pikachu = fineTune.rowByName('ピカチュウ');
    // 列の並び: 目標 → 睡眠 → 到達。睡眠目標の無い行は「-」
    const head = (await fineTune.list.locator('.fineTuneHead .fineTuneHead__cell').allTextContents()).map((s) => s.trim());
    expect(head.slice(2, 5)).toEqual(['目標', '睡眠', '到達']);
    await expect(fineTune.cell(pikachu, 'sleep')).toHaveText('-');

    // 時間: 1000h。到達はアメで届くLv（睡眠のぶん目標より下）、詳細は「到達Lv（あとEXP）」と「睡眠到達Lv」
    await fineTune.chooseSleep(hitokage, 'h1000');
    await expect(fineTune.cell(hitokage, 'sleep')).toHaveText('1000h');
    await expect(fineTune.cell(hitokage, 'sleep')).toHaveClass(/fineTuneRow__cell--changed/);
    await expect(fineTune.editorChange).toHaveText('未設定 → 1000h');
    await expect(fineTune.sleepStockToggle).toBeDisabled();
    await fineTune.waitForSettled();
    const reach = await fineTune.cellNumber(hitokage, 'reach');
    expect(reach).toBeLessThan(60);
    await expect(fineTune.editorInfo).toContainText(`到達Lv ${reach}（あとEXP`);
    await expect(fineTune.editorInfo).toContainText('睡眠到達Lv');

    // 全て ＋ アメ在庫 → 🍬 の印
    await fineTune.sleepOption('sleep').click();
    await expect(fineTune.cell(hitokage, 'sleep')).toHaveText('全て');
    await expect(fineTune.sleepTicketToggle).toBeDisabled();
    await fineTune.sleepStockToggle.click();
    await expect(fineTune.sleepStockToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(fineTune.cell(hitokage, 'sleep')).toHaveText('全て🍬');
    // おひるね島へ移るとアメ在庫を持ち越し、チケットを足すと 🎫🍬
    await fineTune.sleepOption('nap').click();
    await fineTune.sleepTicketToggle.click();
    // PC幅では「おひるね島」、狭い幅では「島」と出す（見えている文字で比べる）
    await expect.poll(() => fineTune.cell(hitokage, 'sleep').evaluate((el) => (el as HTMLElement).innerText.replace(/\s/g, ''))).toBe('おひるね島🎫🍬');
    await fineTune.waitForSettled();

    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expect(calc.getRowSleepTargetSelect(calc.getRow(2))).toContainText('おひるね島');
    await expect(calc.getRowSleepTargetSelect(calc.getRow(2))).toContainText('🎫🍬');
  });

  test('アメブ: 最小アメブで手持ちのアメから最小限のアメブになり、リセットで自動の値に戻る', async ({ page }) => {
    const { fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    const auto = await fineTune.boostValue(pikachu);
    expect(auto).toBeGreaterThan(0);

    // 自動の値のときはリセットできない。手で動かすとリセットでき、押すと自動の値へ戻る
    await fineTune.select(pikachu, 'boost');
    await expect(fineTune.boostResetButton).toBeDisabled();
    await fineTune.step(-10);
    expect(await fineTune.boostValue(pikachu)).toBe(auto - 10);
    await expect(fineTune.boostResetButton).toBeEnabled();
    await fineTune.boostResetButton.click();
    expect(await fineTune.boostValue(pikachu)).toBe(auto);
    await expect(fineTune.boostResetButton).toBeDisabled();

    // 最小アメブ: 種族アメが十分あるので、アメブを使わずに届く（0 個）。もう一度押すと外れて自動の値へ戻る
    await fineTune.minimizeButton.click();
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'true');
    expect(await fineTune.boostValue(pikachu)).toBeLessThan(auto);
    await fineTune.waitForSettled();
    await expect(pikachu).toHaveAttribute('data-reached', 'true');
    await fineTune.minimizeButton.click();
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'false');
    expect(await fineTune.boostValue(pikachu)).toBe(auto);
    // 元に戻すで1つずつ戻る
    await fineTune.undoButton.click();
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('アメ: 欄を押して数を変えると個数指定になり、目標Lv・アメブは動かせず、元の数に戻すと戻る。適用で計算機の個数指定へ移る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    const candy = await fineTune.candyValue(pikachu);
    // 今のLvでアメ1個に要るかけら（Lv10 から上げるアメの値段）
    expect(await fineTune.cellNumber(pikachu, 'shardsPerCandy')).toBeGreaterThan(0);

    await fineTune.select(pikachu, 'candy');
    // アメの欄では注意書きを出さない
    await expect(fineTune.editorNote).toHaveCount(0);
    await fineTune.step(-100);
    expect(await fineTune.candyValue(pikachu)).toBe(candy - 100);
    await expect(fineTune.editorChange).toHaveText(`${candy} → ${candy - 100}`);
    await expect(fineTune.cell(pikachu, 'target')).toHaveClass(/fineTuneRow__cell--locked/);
    await expect(fineTune.cell(pikachu, 'boost')).toHaveClass(/fineTuneRow__cell--locked/);
    await fineTune.waitForSettled();
    // 個数指定の行は、目標Lvがアメの数で決まる（計算機と同じ）。減らしたので目標Lvが下がる
    expect(await fineTune.targetLevel(pikachu)).toBeLessThan(40);
    // 動かせない欄を押すと、行の詳細と理由が出る
    await fineTune.cell(pikachu, 'boost').click();
    await expect(fineTune.editor).toHaveAttribute('data-field', 'row');
    await expect(fineTune.editorNote).toContainText('アメの数を変えているため');

    // 要る数より多くもできる（目標Lvより先まで上がる）
    await fineTune.setValue(pikachu, 'candy', candy + 50);
    expect(await fineTune.candyValue(pikachu)).toBe(candy + 50);
    // 元の数に戻すと個数指定が外れ、目標Lv・アメブを動かせる
    await fineTune.typeValue(candy);
    await expect(fineTune.cell(pikachu, 'boost')).toHaveClass(/fineTuneRow__cell--input/);
    await expect(fineTune.applyButton).toBeDisabled();

    await fineTune.typeValue(candy - 30);
    await fineTune.waitForSettled();
    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expect(calc.getRowCandyTargetInput(calc.getRow(0))).toHaveValue(String(candy - 30));
  });

  test('並べ替え: 取っ手の ↑↓ キーとつかんで動かす操作で行が動き、適用すると計算機の順番が変わる', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(page.getByTestId('fine-tune-row-handle')).toHaveCount(3);

    // 端の行で端の向きのキーは何もしない
    await fineTune.moveUp(fineTune.rows.first());
    await fineTune.moveDown(fineTune.rows.last());
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(fineTune.undoButton).toBeDisabled();

    // ↑ キー: 3番目のヒトカゲを2番目へ
    await fineTune.moveUp(fineTune.rowByName('ヒトカゲ'));
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'ヒトカゲ', 'イーブイ']);

    // つかんで動かす: 先頭のピカチュウを3番目へ
    await fineTune.dragRowTo(fineTune.rowByName('ピカチュウ'), 2);
    expect(await fineTune.rowTitles()).toEqual(['ヒトカゲ', 'イーブイ', 'ピカチュウ']);

    await fineTune.apply();
    await expectCalcOrder(calc, ['ヒトカゲ', 'イーブイ', 'ピカチュウ']);
  });

  test('アメブなしのスロット: アメブの列と「全体のLvを伸ばす」が無く、目標Lvを動かせる', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, {
      ...ALL_REACHED,
      boostKind: 'none',
      shards: '12000000',
    });
    await fineTune.open();
    await fineTune.waitForSettled();

    // アメブの列・サマリーの残り枠・全体のLvを伸ばすが無い
    await expect(page.getByTestId('fine-tune-row-boost')).toHaveCount(0);
    await expect(fineTune.summaryBoost).toHaveCount(0);
    await expect(fineTune.raiseButton).toHaveCount(0);

    // 目標Lv
    const pikachu = fineTune.rowByName('ピカチュウ');
    await fineTune.adjust(pikachu, 'target', 1);
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await fineTune.waitForSettled();

    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('41');
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
    await fineTune.adjust(pikachu, 'boost', -10);
    await fineTune.moveUp(fineTune.rowByName('ヒトカゲ'));
    await fineTune.adjust(pikachu, 'target', 1);
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
    await fineTune.getHandle(pikachu).focus();
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
    await fineTune.adjust(pikachu, 'target', 1);
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await fineTune.editorInput.click();
    await page.keyboard.press('End');
    await page.keyboard.type('7');
    await page.keyboard.press('Control+z');
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await expect(fineTune.undoButton).toBeEnabled();

    // 開いている間、計算機の行と元に戻すボタンは変わっていない（Ctrl+Z が漏れていない）
    await fineTune.discardAndClose();
    await expectCalcOrder(calc, ['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('40');
    expect(await calc.undoButton.isEnabled()).toBe(calcUndoEnabled);
  });

  test('閉じる: Escape は先に調整バーを閉じ、下書きがあれば × と Escape で確認が出る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();

    // 下書きが無ければ × はそのまま閉じる
    await fineTune.closeButton.click();
    await expect(fineTune.overlay).toHaveCount(0);

    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    await fineTune.adjust(pikachu, 'target', 1);
    await expect(fineTune.applyButton).toBeEnabled();
    // 同じ欄をもう一度押すと選択が外れ、調整バーは案内だけに戻る（場所は出たまま）
    await fineTune.cell(pikachu, 'target').click();
    await fineTune.expectIdle();
    await fineTune.select(pikachu, 'boost');

    // Escape: 1回目は選択だけ外し、2回目は確認を出す
    await page.keyboard.press('Escape');
    await fineTune.expectIdle();
    await expect(fineTune.modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(fineTune.discardConfirm).toBeVisible();
    await fineTune.discardConfirmNo.click();
    await expect(fineTune.discardConfirm).toHaveCount(0);
    await expect(fineTune.modal).toBeVisible();

    // × の確認で「破棄して閉じる」
    await fineTune.closeButton.click();
    await expect(fineTune.discardConfirm).toBeVisible();
    await fineTune.discardConfirmYes.click();
    await expect(fineTune.overlay).toHaveCount(0);
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('40');
  });
});

test.describe('12-fine-tune（スマホ幅）', () => {
  test.skip(({ isMobile }) => !isMobile, 'chromium-mobile の project だけで走る');

  test('行が1行に収まり、調整バーを開いても全員が見え、押す部品が小さすぎない', async ({ browser, baseURL }, testInfo) => {
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
    const { calc: seedCalc } = await setupScenario(seedPage, GIVE_AND_RECEIVE);
    // 睡眠の列も出す（列が一番多く、スマホ幅で一番狭い並び）
    await seedCalc.chooseSleepTarget(seedCalc.getRow(2), { base: 'hours', hours: 1000 });
    await seedCalc.waitForPlannerResult();
    // 保存はアイドル時に遅れて行われる。最後の設定まで保存されるのを待ってから引き継ぐ
    await expect.poll(() => seedPage.evaluate(() => ({
      calc: (localStorage.getItem('candy-boost-planner:calc:slots:v1') ?? '').includes('"sleepTargetHours":1000'),
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
    // 押す部品の大きさの基準（計算機の行の ↑↓ より小さくしない）。モーダルの裏では測れないので、開く前に測る
    const calc = new CalcPanelPage(page);
    const calcRow = calc.getRow(1);
    await calcRow.scrollIntoViewIfNeeded();
    const calcUp = (await calc.getRowMoveUpButton(calcRow).boundingBox())!;
    const calcDown = (await calc.getRowMoveDownButton(calcRow).boundingBox())!;
    const minHeight = Math.min(calcUp.height, calcDown.height);
    const minWidth = Math.min(calcUp.width, calcDown.width);
    expect(minHeight).toBeGreaterThan(0);
    expect(minWidth).toBeGreaterThan(0);
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

    /** 全行が1行（名前と数字の欄が同じ高さ）で、画面内に左から順に並び、スクロールせずに見えている */
    async function expectCompactRows(): Promise<void> {
      const count = await fineTune.rows.count();
      expect(count).toBe(4);
      const listBox = (await fineTune.list.boundingBox())!;
      for (let i = 0; i < count; i += 1) {
        const row = fineTune.rows.nth(i);
        const rowBox = (await row.boundingBox())!;
        expect(rowBox.x).toBeGreaterThanOrEqual(0);
        expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(rowBox.height).toBeLessThan(56);
        expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
        const boxes = [];
        for (const testId of ['fine-tune-row-name', 'fine-tune-row-target', 'fine-tune-row-sleep', 'fine-tune-row-reach', 'fine-tune-row-boost', 'fine-tune-row-candy', 'fine-tune-row-shards-per-candy']) {
          boxes.push((await row.getByTestId(testId).boundingBox())!);
        }
        for (let j = 1; j < boxes.length; j += 1) {
          const [a, b] = [boxes[j - 1]!, boxes[j]!];
          expect(a.y < b.y + b.height && a.y + a.height > b.y).toBe(true);
          expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1);
        }
        expect(boxes[boxes.length - 1]!.x + boxes[boxes.length - 1]!.width).toBeLessThanOrEqual(viewport.width + 1);
        // 数字の欄の文字が欄からはみ出していない
        for (const testId of ['fine-tune-row-sleep', 'fine-tune-row-boost', 'fine-tune-row-candy', 'fine-tune-row-shards-per-candy']) {
          const clipped = await row.getByTestId(testId).evaluate((el) => el.scrollWidth - el.clientWidth);
          expect(clipped, testId).toBeLessThanOrEqual(0);
        }
      }
    }

    await expect(fineTune.rows.first().getByTestId('fine-tune-row-sleep')).toBeVisible();
    // 何も選んでいなくても操作の場所は画面内に出ている
    await fineTune.expectIdle();
    expect((await fineTune.editorIdle.boundingBox())!.y + 44).toBeLessThanOrEqual(viewport.height);
    await expectCompactRows();
    // 全体のLvを伸ばしてから、アメブの調整バーを開いた状態（一覧が縮む）でも崩れない
    await fineTune.raise();
    await fineTune.select(fineTune.rowByName('ヒトカゲ'), 'boost');
    await fineTune.step(-100);
    await fineTune.waitForSettled();
    await expectCompactRows();

    // 調整バーの押す部品が、計算機の行の ↑↓ より小さくない。表の数字の欄も高さは下回らない
    const editorParts = [
      fineTune.stepButton(-100),
      fineTune.stepButton(-1),
      fineTune.stepButton(1),
      fineTune.stepButton(100),
      fineTune.editorInput,
    ];
    for (const part of editorParts) {
      const size = (await part.boundingBox())!;
      expect(size.height).toBeGreaterThanOrEqual(minHeight);
      expect(size.width).toBeGreaterThanOrEqual(minWidth);
      expect(size.x + size.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    const first = fineTune.rows.first();
    for (const testId of ['fine-tune-row-handle', 'fine-tune-row-target', 'fine-tune-row-sleep', 'fine-tune-row-boost', 'fine-tune-row-candy']) {
      const size = (await first.getByTestId(testId).boundingBox())!;
      expect(size.height, testId).toBeGreaterThanOrEqual(minHeight);
    }

    // フッターの操作が画面内に収まる
    for (const button of [fineTune.applyButton, fineTune.raiseButton, fineTune.undoButton, fineTune.redoButton]) {
      const rect = (await button.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await phone.close();
  });
});
