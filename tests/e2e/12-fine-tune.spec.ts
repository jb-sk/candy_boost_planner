/**
 * 12-fine-tune.spec.ts
 * シンプル（FineTuneModal）のE2Eテスト
 *
 * カバー範囲:
 *   - 表の欄を押して調整バーで動かす（アメブ）・目標Lvの欄からその場で Lvピッカーを開いて動かす → 適用 → 計算機の元に戻す1回で戻る
 *   - 「全体のLvを伸ばす」（全員のアメブをまとめて動かす）と、伸ばせないときに押せない見た目になること、並べ替え、アメブなしのスロット
 *   - 目標Lvに届く最小限のアメブ個数: アメが足りない行も入れられ、警告の色と要るアメの数が出ること（計算機と同じ）
 *   - アメの数を変えた行（個数指定）でもアメブを動かせること（計算機と同じ）
 *   - 名前をつかんで並べ替えること（PC はマウスで押したまま動かす、スマホは長押し）と、設定欄から計算機の設定を開くこと
 *   - 行の詳細（名前を押したとき）: EXP補正の印と、現在Lv・あとEXP・アメ在庫の編集（適用で計算機・ボックス・在庫へ移る）
 *   - モーダル内の元に戻す・やり直す（ボタンと Ctrl+Z / Ctrl+Y）と、計算機の履歴が動かないこと
 *   - Escape と × の確認
 *   - 調整バーの高さが、どの欄を選んでも変わらないこと（PC幅・スマホ幅）
 *   - スマホ幅で行が1行に収まり、調整バーを開いても全員が見えること、目標Lvの Lvピッカーが画面内に開くこと（chromium-mobile で走る）
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
  /** 万能アメの在庫（省くと0） */
  universal?: { s: number; m: number; l: number };
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

/**
 * アメ節約・かけら節約で結果が分かれる（本物のソルバーで確かめた組み合わせ）。ピカチュウは全アメブ点まで入れても種族アメが足りず、
 * イーブイはアメブ0で種族アメが足りない（どちらも万能アメ無し）。開いてからピカチュウを全アメブ点、イーブイを0にする。
 * イーブイが自分のアメブを増やすと届き、増やす量が多いほどアメが少なくかけらが多い
 */
const SAVING_SPLIT: Scenario = {
  shards: '100000000',
  rows: [
    { name: 'ピカチュウ', dst: 25, candy: '20' },
    { name: 'イーブイ', dst: 20, candy: '100' },
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
  await settings.setUniversalCandy('S', scenario.universal?.s ?? 0);
  await settings.setUniversalCandy('M', scenario.universal?.m ?? 0);
  await settings.setUniversalCandy('L', scenario.universal?.l ?? 0);
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

/**
 * 何も選んでいないとき・各欄（睡眠・アメブ・アメ・行の詳細）を選んだときで、調整バーとモーダルの高さが同じ。
 * 届かない行（ヒトカゲ・フシギダネ）を選ぶので、詳細に足りないものが出る状態も含む。
 */
async function expectEditorHeightConstant(fineTune: FineTuneModalPage): Promise<void> {
  const editorHeight = async () => (await fineTune.editor.boundingBox())!.height;
  const modalHeight = async () => (await fineTune.modal.boundingBox())!.height;
  await fineTune.expectIdle();
  const editor = await editorHeight();
  const modal = await modalHeight();
  const choices: Array<[string, 'row' | 'sleep' | 'boost' | 'candy']> = [
    ['ヒトカゲ', 'sleep'],
    ['ヒトカゲ', 'boost'],
    ['フシギダネ', 'candy'],
    ['フシギダネ', 'row'],
    ['イーブイ', 'boost'],
  ];
  for (const [name, field] of choices) {
    await fineTune.select(fineTune.rowByName(name), field);
    await expect(fineTune.editor).toHaveAttribute('data-field', field);
    await fineTune.waitForSettled();
    expect(await editorHeight(), `${name} ${field}`).toBeCloseTo(editor, 0);
    expect(await modalHeight(), `${name} ${field}`).toBeCloseTo(modal, 0);
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
    // 何も選んでいないときも操作の場所は出ていて、押せないボタンだけ（「数字を押して調整」の案内は出さない）。見出しは無く、サマリーが × と同じ段にある
    await fineTune.expectIdle();
    await expect(fineTune.editor).not.toContainText('数字を押して調整');
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

  test('目標Lv: 欄を押すと調整バーを開かずに、その場で計算機と同じ Lvピッカーが開き、動かした目標Lvが計算機へ移る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();

    const pikachu = fineTune.rowByName('ピカチュウ');
    const targetCell = fineTune.cell(pikachu, 'target');
    expect(await fineTune.targetLevel(pikachu)).toBe(40);
    // 欄を押すとピッカーが開き、調整バーは何も選んでいないまま（設定欄）。開いている間は欄を塗る
    await fineTune.openTargetPicker(pikachu);
    const picker = fineTune.targetPicker;
    await fineTune.expectIdle();
    await expect(targetCell).toHaveClass(/fineTuneRow__cell--on/);
    await expect(targetCell).toHaveAttribute('aria-expanded', 'true');
    // 見出しは計算機の目標Lvピッカーと同じ（現在Lvからの矢印）
    await expect(picker).toContainText('目標Lv: Lv10 → Lv40');
    // 吹き出しはモーダルの中に収まる（一覧の枠で切れない）
    const modalBox = (await fineTune.modal.boundingBox())!;
    const pickerBox = (await picker.boundingBox())!;
    expect(pickerBox.x).toBeGreaterThanOrEqual(modalBox.x);
    expect(pickerBox.y).toBeGreaterThanOrEqual(modalBox.y);
    expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(modalBox.x + modalBox.width + 1);
    expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(modalBox.y + modalBox.height + 1);

    // ▶ で1つ上げる
    await picker.getByTestId('level-picker-increment').click();
    expect(await fineTune.targetLevel(pikachu)).toBe(41);
    await expect(targetCell).toHaveClass(/fineTuneRow__cell--changed/);
    await expect(picker).toContainText('目標Lv: Lv10 → Lv41');
    // Lv の丸いボタン
    await picker.locator('.levelChip', { hasText: /^\s*60\s*$/ }).click();
    expect(await fineTune.targetLevel(pikachu)).toBe(60);
    // 現在Lv（10）は下の端。◀ は押せない
    await picker.locator('.levelChip', { hasText: /^\s*10\s*$/ }).click();
    expect(await fineTune.targetLevel(pikachu)).toBe(10);
    await expect(picker.getByTestId('level-picker-decrement')).toBeDisabled();
    // スライダー
    await picker.locator('input[type="range"]').fill('45');
    expect(await fineTune.targetLevel(pikachu)).toBe(45);
    // 欄をもう一度押すと閉じる。調整バーは何も選んでいないまま
    await targetCell.click();
    await expect(picker).toBeHidden();
    await expect(targetCell).not.toHaveClass(/fineTuneRow__cell--on/);
    await fineTune.expectIdle();
    await fineTune.waitForSettled();

    // ほかの欄の調整バーを開いたまま目標Lvを動かせる。調整バーはそのまま
    await fineTune.select(pikachu, 'boost');
    await fineTune.openTargetPicker(pikachu);
    await expect(fineTune.editor).toHaveAttribute('data-field', 'boost');
    // Escape は、まずピッカーだけを閉じる（調整バーの選択は残る）
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(fineTune.editor).toHaveAttribute('data-field', 'boost');
    // 外を押しても閉じる
    await fineTune.openTargetPicker(pikachu);
    await fineTune.editorName.click();
    await expect(picker).toBeHidden();
    // 一覧が実際にスクロールしても閉じる（スクロールバー・キーボードの経路。画面に固定した吹き出しが欄から離れて残らない）
    await fineTune.openTargetPicker(pikachu);
    await fineTune.list.dispatchEvent('scroll');
    await expect(picker).toBeHidden();

    await fineTune.apply();
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('45');
  });

  test('目標Lv: 睡眠だけで届くLvまで下げても目標Lvの欄は消えず、さらに下げても上げ直してもよい（計算機と同じ）', async ({ page }) => {
    const { fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    await fineTune.chooseSleep(pikachu, 'h2000');
    await fineTune.waitForSettled();

    // 現在Lv10 → 12 は睡眠だけで届く。アメブは動かせなくなるが、目標Lvは動かせる（ピッカーは開いたまま）
    await fineTune.openTargetPicker(pikachu);
    const range = fineTune.targetPicker.locator('input[type="range"]');
    await range.fill('12');
    expect(await fineTune.targetLevel(pikachu)).toBe(12);
    await fineTune.waitForSettled();
    await expect(fineTune.targetPicker).toBeVisible();
    await expect(fineTune.cell(pikachu, 'target')).not.toHaveClass(/fineTuneRow__cell--locked/);
    await expect(fineTune.cell(pikachu, 'boost')).toHaveClass(/fineTuneRow__cell--locked/);

    // さらに下げられる
    await range.fill('11');
    expect(await fineTune.targetLevel(pikachu)).toBe(11);
    // 上げ直すと、アメが要るようになりアメブも動かせる
    await range.fill('60');
    expect(await fineTune.targetLevel(pikachu)).toBe(60);
    await fineTune.closeTargetPicker();
    await fineTune.waitForSettled();
    await expect(fineTune.cell(pikachu, 'boost')).not.toHaveClass(/fineTuneRow__cell--locked/);
  });

  test('入口: すべて睡眠（アメを使わない睡眠目標）の行だけでもシンプルを出し、目標Lvを動かせる（アメブは動かせない）', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, { ...ALL_REACHED, rows: ALL_REACHED.rows.slice(0, 1) });
    await calc.chooseSleepTarget(calc.getRow(0), { base: 'sleep', stock: false });
    await calc.waitForPlannerResult();
    await expect(fineTune.openButton).toBeVisible();
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    await expect(fineTune.cell(pikachu, 'target')).not.toHaveClass(/fineTuneRow__cell--locked/);
    await expect(fineTune.cell(pikachu, 'boost')).toHaveClass(/fineTuneRow__cell--locked/);
    await fineTune.setValue(pikachu, 'target', 30);
    expect(await fineTune.targetLevel(pikachu)).toBe(30);
    await fineTune.waitForSettled();
    await fineTune.apply();
    await expect(calc.getRowDstLevelInput(calc.getRow(0))).toHaveValue('30');
  });

  test('目標Lv: Lvピッカーのスライダーを1回ドラッグした分は、元に戻す1回でまとめて戻る', async ({ page }) => {
    const { fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    await fineTune.openTargetPicker(pikachu);
    const range = fineTune.targetPicker.locator('input[type="range"]');
    const box = (await range.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 4, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(box.x + 4 + ((box.width - 8) * i) / 10, y);
      // 1秒より長く止めても割れない
      if (i === 5) await page.waitForTimeout(1200);
    }
    await page.mouse.up();
    expect(await fineTune.targetLevel(pikachu)).toBe(70);
    await fineTune.closeTargetPicker();

    await fineTune.undoButton.click();
    expect(await fineTune.targetLevel(pikachu)).toBe(40);
    await expect(fineTune.undoButton).toBeDisabled();
  });

  test('調整バー: どの欄を選んでも（何も選んでいなくても）調整バーとモーダルの高さが変わらない', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, GIVE_AND_RECEIVE);
    // 睡眠の詳細（睡眠到達Lv）と足りないもの（かけら・アメ）が出る行もそろえる
    await calc.chooseSleepTarget(calc.getRow(3), { base: 'napIsland', stock: true, ticket: true });
    await calc.waitForPlannerResult();
    // 入口の名前は「シンプル」
    await expect(fineTune.openButton).toHaveText('シンプル');
    await fineTune.open();
    await fineTune.waitForSettled();
    // 選んだ行は薄い下地だけで、左の色の帯は付けない
    const hitokageRow = fineTune.rowByName('ヒトカゲ');
    await fineTune.select(hitokageRow, 'sleep');
    await expect(hitokageRow).toHaveClass(/fineTuneRow--selected/);
    expect(await hitokageRow.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
    await page.keyboard.press('Escape');
    // PC幅の睡眠の欄は詰めた幅でも「おひるね島🎫🍬」が欄からはみ出さない
    const napCell = fineTune.cell(fineTune.rowByName('ヒトカゲ'), 'sleep');
    await expect(napCell).toContainText('おひるね島');
    expect(await napCell.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await expectEditorHeightConstant(fineTune);
  });

  test('全体のLvを伸ばす: 万能アメの残りが変われば、小窓の残りの段に S・M・L の前 → 後を出す（行ごとには出さない）', async ({ page }) => {
    // ヒトカゲ1匹。種族アメ 300 個と万能アメ L 30 個で、かけらが足りず届かない。アメブを減らすとかけらが浮き、万能アメを多く使って届く。
    // 計算機はアメブを余りの都合で減らさないので、今の配り方はアメブ802個・L6個（余り98）で余りゲートを破っている。
    // そのため余り最小でも、届く配り方（余り47）を採る（S69 は今がゲートを守っているときだけ効く）
    const { fineTune } = await setupScenario(page, {
      shards: '1000000',
      universal: { s: 0, m: 0, l: 30 },
      rows: [{ name: 'ヒトカゲ', dst: 60, candy: '300' }],
    });
    await fineTune.open();
    await fineTune.waitForSettled();
    await fineTune.raise();
    await expect(fineTune.raiseReport).toBeVisible();
    const universal = fineTune.raiseReport.locator('[data-testid="fine-tune-raise-report-remaining-item"][data-item="universalRemaining"]');
    await expect(universal.locator('.fineTuneReport__remK')).toHaveText('万能アメ残り');
    await expect(universal.locator('.fineTuneReport__remB')).toHaveText(/^S0 M0 L\d+$/);
    await expect(universal.locator('.fineTuneReport__remAfter')).toHaveText(/^S0 M0 L\d+$/);
    expect(await universal.locator('.fineTuneReport__remB').innerText()).not.toBe(await universal.locator('.fineTuneReport__remAfter').innerText());
    // S・M・L を1つの増減にできないので、増減の札は空
    await expect(universal.locator('.fineTuneReport__remD')).toHaveText('');
    // 表に万能アメの列は無い
    await expect(fineTune.raiseReport.getByRole('columnheader')).toHaveText(['ポケモン', '到達Lv', 'あとEXP', 'アメブ', 'アメ合計', 'かけら']);
  });

  test('全体のLvを伸ばす: 小窓のキャンセルで押す前の下書きへ戻って閉じ、やり直すでまた入る', async ({ page }) => {
    const { fineTune } = await setupScenario(page, GIVE_AND_RECEIVE);
    await fineTune.open();
    await fineTune.waitForSettled();
    const boosts = async () => Promise.all((await fineTune.rows.all()).map((row) => fineTune.boostValue(row)));
    const boostsBefore = await boosts();
    await fineTune.raise();
    await expect(fineTune.raiseReport).toBeVisible();
    // キャンセルは OK の左。文字だけのボタン
    await expect(fineTune.raiseReportCancel).toHaveText('キャンセル');
    const [cancelBox, okBox] = await Promise.all([fineTune.raiseReportCancel.boundingBox(), fineTune.raiseReportOk.boundingBox()]);
    expect(cancelBox!.x + cancelBox!.width).toBeLessThanOrEqual(okBox!.x);
    const boostsAfter = await boosts();
    expect(boostsAfter).not.toEqual(boostsBefore);
    await fineTune.raiseReportCancel.click();
    await expect(fineTune.raiseReport).toBeHidden();
    await expect(fineTune.modal).toBeVisible();
    await expect(fineTune.raiseButton).toBeFocused();
    expect(await boosts()).toEqual(boostsBefore);
    await expect(fineTune.applyButton).toBeDisabled();
    await expect(fineTune.undoButton).toBeDisabled();
    await fineTune.redoButton.click();
    expect(await boosts()).toEqual(boostsAfter);
  });

  test('全体のLvを伸ばす: 1回押すと全員のアメブがまとまって変わり、届く行が増え、元に戻す1回で戻り、適用で計算機へ移る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, GIVE_AND_RECEIVE);
    const calcBoostsBefore = await Promise.all(GIVE_AND_RECEIVE.rows.map((_, i) => calc.getRowBoostCandyInput(calc.getRow(i)).inputValue()));
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
    // 届かない行と動かす行があるので、押せる見た目。文言は「LvUp!」とキラキラ
    await expect(fineTune.raiseButton).not.toHaveAttribute('aria-disabled', 'true');
    await expect(fineTune.raiseButton).toHaveText('LvUp!');
    await expect(fineTune.raiseButton.locator('svg')).toBeVisible();

    const reachLevelBefore = await fineTune.cellNumber(hitokage, 'reach');
    await fineTune.raise();
    // 伸びたときはトーストでなく小窓で、変わった行ごとの増減を出す。見出しはLvが上がった行（ヒトカゲだけ）。OK にフォーカスする
    await expect(fineTune.raiseReport).toBeVisible();
    await expect(fineTune.raiseReportTitle).toHaveText('ヒトカゲの到達Lvが上がりました');
    await expect(fineTune.raiseReportOk).toBeFocused();
    // かけら節約は裏で求め、求め終えると「計算中」のタブは無くなる（求めている間も、求め終えても OK のフォーカスは動かない）
    await expect(fineTune.raiseReport.locator('[data-pending="true"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(fineTune.raiseReportOk).toBeFocused();
    await expect(page.locator('.appToast', { hasText: '到達Lvが上がりました' })).toHaveCount(0);
    // 届いていた行は届いたまま、届く行が増える。ヒトカゲが届く
    expect(await fineTune.reachedCount()).toBeGreaterThan(reachedBefore);
    await expect(pikachu).toHaveAttribute('data-reached', 'true');
    await expect(hitokage).toHaveAttribute('data-reached', 'true');
    const boostsAfter = await boosts();
    // 動かした行（届いていた上の行の端数のためには動かさない）
    const changed = boostsAfter.findIndex((n, i) => n !== boostsBefore[i]!);
    expect(changed).toBeGreaterThanOrEqual(0);
    await expect(fineTune.applyButton).toBeEnabled();

    // 小窓: 表の形で、アメブが変わった行は表と同じ増減が出る。ヒトカゲは届くLvが目標Lvまで上がり、行に下地が付く
    const names = GIVE_AND_RECEIVE.rows.map((r) => r.name);
    for (const [i, name] of names.entries()) {
      const reportRow = fineTune.raiseReportRows.filter({ hasText: name });
      const d = boostsAfter[i]! - boostsBefore[i]!;
      if (d === 0) {
        await expect(reportRow.locator('[data-item="boost"][data-changed="true"]')).toHaveCount(0);
        continue;
      }
      await expect(fineTune.raiseReportItem(reportRow, 'boost')).toHaveText(`${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('ja-JP')}`);
    }
    const hitokageReport = fineTune.raiseReportRows.filter({ hasText: 'ヒトカゲ' });
    await expect(fineTune.raiseReportItem(hitokageReport, 'level')).toHaveText(`${reachLevelBefore} → 60`);
    // 到達Lvの右の列は、あとEXP。到達Lvが変わった行は後の値だけ（Lvが同じ行だけ「前 → 後」）
    const hitokageExpLeft = fineTune.raiseReportItem(hitokageReport, 'expLeft');
    await expect(hitokageExpLeft).toHaveText(/^[\d,]+$/);
    const expLeftAfter = await hitokageExpLeft.innerText();
    // Lvが同じでもあとEXPが変わった行（前後とも目標に届き、端数だけ違う行など）は「前 → 後」
    for (const row of await fineTune.raiseReportRows.all()) {
      const expLeft = fineTune.raiseReportItem(row, 'expLeft');
      if (await row.getAttribute('data-level') === 'same' && await expLeft.getAttribute('data-changed') === 'true') {
        await expect(expLeft).toHaveText(/^[\d,—]+ → [\d,—]+$/);
      }
    }
    await expect(hitokageReport).toHaveAttribute('data-level', 'up');
    await expect(hitokageReport).toHaveAttribute('data-reach', 'better');
    await expect(hitokageReport).toHaveClass(/fineTuneReport__row--raised/);
    // 列の見出しは1回だけで、どの行も5つの値を見出しと同じ列に置く（変わらなかった増減は「—」、Lvが変わらない行は到達Lvだけ）。
    // 値の右端は列の見出しの右端とそろう
    const headers = fineTune.raiseReport.getByRole('columnheader');
    await expect(headers).toHaveText(['ポケモン', '到達Lv', 'あとEXP', 'アメブ', 'アメ合計', 'かけら']);
    const headerEdges = (await headers.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)))).slice(1);
    for (const row of await fineTune.raiseReportRows.all()) {
      const items = row.getByTestId('fine-tune-raise-report-item');
      await expect(items).toHaveCount(5);
      for (const key of ['boost', 'candy', 'shards'] as const) {
        const item = fineTune.raiseReportItem(row, key);
        if (await item.getAttribute('data-changed') === 'false') await expect(item).toHaveText('—変わらず');
      }
      if (await row.getAttribute('data-level') === 'same') await expect(fineTune.raiseReportItem(row, 'level')).toHaveText(/^\d+$/);
      expect(await items.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)))).toEqual(headerEdges);
    }
    // 残りは前 → 後と増減。後の値は上部のサマリーと同じ
    const shardsRemaining = fineTune.raiseReport.locator('[data-testid="fine-tune-raise-report-remaining-item"][data-item="shardsRemaining"]');
    await expect(shardsRemaining).toContainText(` → ${await fineTune.summaryShards.innerText()}`);
    // 残りの段は、前の値の右端・後の値の右端・増減の札の左右の端が行をまたいでそろう（→ と数字の桁が縦に並ぶ）
    const remainingEdges = await fineTune.raiseReport.locator('[data-testid="fine-tune-raise-report-remaining-item"]').evaluateAll((els) => els.map((el) => {
      const edge = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
      const before = edge('.fineTuneReport__remB');
      const after = edge('.fineTuneReport__remAfter');
      const delta = edge('.fineTuneReport__remD');
      return [before.right, after.right, delta.left, delta.right].map((n) => Math.round(n));
    }));
    expect(remainingEdges.length).toBeGreaterThanOrEqual(2);
    for (const edges of remainingEdges) expect(edges).toEqual(remainingEdges[0]);
    // Escape は小窓だけを閉じ（シンプルは閉じない・確認も出さない）、フォーカスを「全体のLvを伸ばす」へ戻す
    await page.keyboard.press('Escape');
    await expect(fineTune.raiseReport).toBeHidden();
    await expect(fineTune.modal).toBeVisible();
    await expect(fineTune.discardConfirm).toBeHidden();
    await expect(fineTune.raiseButton).toBeFocused();
    // 小窓のあとEXP は、操作パネルの詳細「到達Lv 60（あとEXP ○○）」と同じ数字
    await fineTune.select(hitokage, 'boost');
    await expect(fineTune.editorInfo).toContainText(`到達Lv 60（あとEXP ${expLeftAfter}）`);
    await page.keyboard.press('Escape');
    await fineTune.expectIdle();

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
    await expect(calc.getRowBoostCandyInput(calc.getRow(changed))).toHaveValue(String(boostsAfter[changed]));
    await calc.clickUndo();
    await expect(calc.getRowBoostCandyInput(calc.getRow(changed))).toHaveValue(calcBoostsBefore[changed]!);
  });

  test('全体のLvを伸ばす: 全員届いていれば、そう知らせて下書きを変えない', async ({ page }) => {
    const { fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    // 伸ばす行が無いので押せない見た目。押すと理由だけ出る（ツールチップはスマホで出ないので付けない）
    await expect(fineTune.raiseButton).toHaveAttribute('aria-disabled', 'true');
    await expect(fineTune.raiseButton).not.toHaveAttribute('title');
    await fineTune.raise();
    await expect(page.locator('.appToast')).toContainText('全員が目標Lvに届いています');
    await expect(fineTune.applyButton).toBeDisabled();
    await expect(fineTune.undoButton).toBeDisabled();
  });

  test('全体のLvを伸ばす: アメが足りず伸ばせないときは理由を出し、ふつうのトーストより長く表示し、どこかを押すとすぐ消える', async ({ page }) => {
    // フシギダネだけで、種族アメが足りない（万能アメも無い）。アメブを動かしても伸びない
    const { fineTune } = await setupScenario(page, { shards: '12000000', rows: [{ name: 'フシギダネ', dst: 50, candy: '100' }] });
    await fineTune.open();
    await fineTune.waitForSettled();
    // 見込みはモデルで判断しないので、動かす行があれば押せる見た目。押すとモデルで伸びないと分かり（解かない）、
    // 理由を出して、この下書きのあいだは押せない見た目になる
    await expect(fineTune.raiseButton).not.toHaveAttribute('aria-disabled', 'true');
    await fineTune.raise();
    const toast = page.locator('.appToast', { hasText: 'アメが足りないため' });
    await expect(toast).toBeVisible();
    await expect(fineTune.raiseButton).toHaveAttribute('aria-disabled', 'true');
    // ふつうのトーストは 2 秒で消える。理由のトーストは 3 秒後も出ている
    await page.waitForTimeout(3000);
    await expect(toast).toBeVisible();
    // 画面のどこかを押すと、残りの時間を待たずにすぐ消える
    await fineTune.list.click({ position: { x: 5, y: 5 } });
    await expect(toast).toBeHidden({ timeout: 1000 });
    await expect(fineTune.applyButton).toBeDisabled();
    // 理由の説明は長いので折り返す
    await fineTune.raise();
    await expect(page.locator('.appToast--wrap', { hasText: 'アメが足りないため' })).toBeVisible();
  });

  test('全体のLvを伸ばす: アメ節約・かけら節約で結果が分かれるときは小窓にタブを出し、替えると下書きも替わる。元に戻す1回で押す前へ戻る', async ({ page }) => {
    const { fineTune } = await setupScenario(page, SAVING_SPLIT);
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    const eevee = fineTune.rowByName('イーブイ');
    await fineTune.setValue(pikachu, 'boost', 99999);
    await fineTune.setValue(eevee, 'boost', 0);
    await page.keyboard.press('Escape');
    await fineTune.waitForSettled();
    await expect(eevee).toHaveAttribute('data-reached', 'false');

    await fineTune.raise();
    await expect(fineTune.raiseReport).toBeVisible();
    const candyTab = fineTune.raiseReportTab('candy');
    const shardsTab = fineTune.raiseReportTab('shards');
    await expect(candyTab).toHaveText('アメ節約');
    // かけら節約は小窓を出してから裏で求める。求め終えるまでは押せない「計算中」のタブで、違う結果なら押せるタブになる
    await expect(shardsTab).toHaveText('かけら節約', { timeout: 20_000 });
    await expect(shardsTab).not.toHaveAttribute('aria-disabled', 'true');
    // はじめはアメ節約が入っている
    await expect(candyTab).toHaveAttribute('aria-selected', 'true');
    await expect(eevee).toHaveAttribute('data-reached', 'true');
    const candyBoost = await fineTune.boostValue(eevee);
    const candyUsed = fineTune.raiseReportRemaining('candyUsed');
    const shardsRemaining = fineTune.raiseReportRemaining('shardsRemaining');
    await expect(candyUsed).toBeVisible();
    const shardsRemainingByCandy = await shardsRemaining.innerText();
    // かけら節約に替えると、イーブイのアメブが少なくなり（アメを多く、かけらを少なく使う）、届いたまま。
    // 在庫のアメ（120 個）を使い切るので、アメ合計は伸ばす前と同じで、増減の無い段は出ない。かけらの残りはアメ節約より多い
    await shardsTab.click();
    await expect(shardsTab).toHaveAttribute('aria-selected', 'true');
    await expect(candyUsed).toHaveCount(0);
    await expect(shardsRemaining).not.toHaveText(shardsRemainingByCandy);
    expect(await fineTune.boostValue(eevee)).toBeLessThan(candyBoost);
    await expect(eevee).toHaveAttribute('data-reached', 'true');
    await expect(fineTune.calculating).toHaveCount(0);
    // ← → でも替えられ、フォーカスも移る
    await shardsTab.press('ArrowLeft');
    await expect(candyTab).toHaveAttribute('aria-selected', 'true');
    await expect(candyTab).toBeFocused();
    expect(await fineTune.boostValue(eevee)).toBe(candyBoost);
    await fineTune.closeRaiseReport();
    // タブを何度替えても、元に戻す1回で押す前（イーブイのアメブ0）へ戻る
    await fineTune.undoButton.click();
    expect(await fineTune.boostValue(eevee)).toBe(0);
  });

  test('行の詳細: 「LvUp!でアメブ固定」を入れると表のアメブに錠が出て、全体のLvを伸ばすがそのポケモンのアメブを動かさない。計算機へは書かない', async ({ page }) => {
    const { fineTune } = await setupScenario(page, BOOST_LIMITED);
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    const hitokage = fineTune.rowByName('ヒトカゲ');
    const boostBefore = await fineTune.boostValue(pikachu);
    await fineTune.select(pikachu, 'row');
    await expect(fineTune.boostLockSwitch).toHaveText('LvUp!でアメブ固定');
    await expect(fineTune.boostLockSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(fineTune.boostLockMark(pikachu)).toHaveCount(0);
    await fineTune.boostLockSwitch.click();
    await expect(fineTune.boostLockSwitch).toHaveAttribute('aria-checked', 'true');
    await expect(fineTune.boostLockMark(pikachu)).toBeVisible();
    await expect(fineTune.cell(pikachu, 'boost')).toHaveAttribute('aria-label', /LvUp!で固定$/);
    // 開いている間だけの印なので、計算機へ書くものは無い（OK は押せないまま。計算し直さない）
    await expect(fineTune.applyButton).toBeDisabled();
    await expect(fineTune.calculating).toHaveCount(0);

    // ピカチュウを固定したので、ピカチュウのアメブは動かない（動かせるのはヒトカゲだけで、枠が足りず伸びないこともある）
    await page.keyboard.press('Escape');
    await fineTune.raise();
    if (await fineTune.raiseReport.isVisible()) await fineTune.closeRaiseReport();
    expect(await fineTune.boostValue(pikachu)).toBe(boostBefore);

    // 外すと、ピカチュウのアメブを減らして枠を空け、ヒトカゲへ回す
    await fineTune.select(pikachu, 'row');
    await fineTune.boostLockSwitch.click();
    await expect(fineTune.boostLockSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(fineTune.boostLockMark(pikachu)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await fineTune.raise();
    await expect(fineTune.raiseReport).toBeVisible();
    await fineTune.closeRaiseReport();
    expect(await fineTune.boostValue(pikachu)).toBeLessThan(boostBefore);

    // 個数指定の行は LvUp! が元から動かさないので、スイッチを出さない
    await fineTune.adjust(hitokage, 'candy', -10);
    await fineTune.select(hitokage, 'row');
    await expect(fineTune.boostLockSwitch).toHaveCount(0);
  });

  test('睡眠: 目標の右隣の睡眠の列に睡眠目標が出て、調整バーで 200h〜2000h・睡眠・おひるね島とアメ在庫・チケットを選べ、適用で計算機へ移る', async ({ page }) => {
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

    // 睡眠（計算機の「睡眠🍬」と同じ呼び名）＋ アメ在庫 → 🍬 の印
    await fineTune.sleepOption('sleep').click();
    await expect(fineTune.sleepOption('sleep')).toHaveText('睡眠');
    await expect(fineTune.cell(hitokage, 'sleep')).toHaveText('睡眠');
    await expect(fineTune.sleepTicketToggle).toBeDisabled();
    await fineTune.sleepStockToggle.click();
    await expect(fineTune.sleepStockToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(fineTune.cell(hitokage, 'sleep')).toHaveText('睡眠🍬');
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

  test('リセット: 選んだポケモンを開いた時点の状態へまるごと戻し、選んだままにする。欄を移って戻っても戻せる。ほかの行の変更は残る', async ({ page }) => {
    const { fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    const eevee = fineTune.rowByName('イーブイ');
    const boost = await fineTune.boostValue(pikachu);
    const eeveeBoost = await fineTune.boostValue(eevee);
    await fineTune.adjust(eevee, 'boost', -10);

    // 変えるまではリセットできない（ほかの行を変えても、このポケモンは開いた時点のまま）
    await fineTune.select(pikachu, 'boost');
    await expect(fineTune.resetEditButton).toBeDisabled();
    await fineTune.step(-10);
    await fineTune.step(-100);
    expect(await fineTune.boostValue(pikachu)).toBe(boost - 110);
    await fineTune.resetEditButton.click();
    expect(await fineTune.boostValue(pikachu)).toBe(boost);
    // 選んだまま。続けて動かして、また開いた時点へ戻せる
    await expect(fineTune.editor).toHaveAttribute('data-row-id', (await pikachu.getAttribute('data-row-id'))!);
    await expect(fineTune.editor).toHaveAttribute('data-field', 'boost');
    await expect(fineTune.resetEditButton).toBeDisabled();
    await fineTune.step(1);
    await fineTune.resetEditButton.click();
    expect(await fineTune.boostValue(pikachu)).toBe(boost);
    expect(await fineTune.boostValue(eevee)).toBe(eeveeBoost - 10);

    // 睡眠を変えてアメブを押し、睡眠へ戻っても、開いた時点へ戻せる
    await fineTune.chooseSleep(pikachu, 'h500');
    await fineTune.select(pikachu, 'boost');
    await expect(fineTune.resetEditButton).toBeEnabled();
    await fineTune.select(pikachu, 'sleep');
    await expect(fineTune.resetEditButton).toBeEnabled();
    await fineTune.resetEditButton.click();
    await expect(fineTune.cell(pikachu, 'sleep')).toHaveText('-');
    await expect(fineTune.sleepOption('none')).toHaveAttribute('aria-pressed', 'true');
    await expect(fineTune.resetEditButton).toBeDisabled();

    // どの欄で押しても、このポケモンの変更はまとめて戻る（目標Lvと睡眠を変えて、睡眠の欄で押す）
    await fineTune.setValue(pikachu, 'target', 60);
    await fineTune.chooseSleep(pikachu, 'h500');
    await fineTune.resetEditButton.click();
    expect(await fineTune.targetLevel(pikachu)).toBe(40);
    await expect(fineTune.cell(pikachu, 'sleep')).toHaveText('-');
    // アメの数（個数指定）も戻り、アメブを動かせる行に戻る
    const candy = await fineTune.candyValue(pikachu);
    await fineTune.adjust(pikachu, 'candy', -100);
    await fineTune.resetEditButton.click();
    expect(await fineTune.candyValue(pikachu)).toBe(candy);
    await expect(fineTune.editor).toHaveAttribute('data-field', 'candy');
    await expect(fineTune.cell(pikachu, 'boost')).toHaveClass(/fineTuneRow__cell--input/);
    // ほかの行の変更は残る
    expect(await fineTune.boostValue(eevee)).toBe(eeveeBoost - 10);

    // リセットも元に戻す1回で取り消せる
    await fineTune.chooseSleep(pikachu, 'h500');
    await fineTune.resetEditButton.click();
    await fineTune.undoButton.click();
    await expect(fineTune.cell(pikachu, 'sleep')).toHaveText('500h');
  });

  test('アメブ: 「目標Lvに届く最小限のアメブ個数」で手持ちのアメから最小限のアメブになり、再割当で自動の値に戻る', async ({ page }) => {
    const { fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    const auto = await fineTune.boostValue(pikachu);
    expect(auto).toBeGreaterThan(0);

    // 自動の値のときは再割当できない。手で動かすと再割当でき、押すと自動の値へ戻る
    await fineTune.select(pikachu, 'boost');
    await expect(fineTune.boostResetButton).toHaveText('再割当');
    await expect(fineTune.boostResetButton).toBeDisabled();
    await fineTune.step(-10);
    expect(await fineTune.boostValue(pikachu)).toBe(auto - 10);
    await expect(fineTune.boostResetButton).toBeEnabled();
    await fineTune.boostResetButton.click();
    expect(await fineTune.boostValue(pikachu)).toBe(auto);
    await expect(fineTune.boostResetButton).toBeDisabled();

    // 目標Lvに届く最小限のアメブ個数: 種族アメが十分あるので、アメブを使わずに届く（0 個）。もう一度押すと外れて自動の値へ戻る
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

  test('アメブ: アメブ目標Lv（現在Lv・目標Lvと同じ形の Lv の欄）を選ぶとアメブがそのLvまでの数になり、適用で計算機のアメブ目標Lvへ移る。何も変えていない間は OK が押せない', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    // 何も変えていない間は OK を押せず、薄く出す
    await expect(fineTune.applyButton).toHaveText('OK');
    await expect(fineTune.applyButton).toBeDisabled();
    expect(Number(await fineTune.applyButton.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1);

    const pikachu = fineTune.rowByName('ピカチュウ');
    const auto = await fineTune.boostValue(pikachu);
    await fineTune.select(pikachu, 'boost');
    // アメブ目標Lvは目標Lv（40）まで。3つの Lv の欄は同じ形（高さがそろう）
    await expect(fineTune.levelInput('boostLevel')).toHaveValue('40');
    const boostLevelBox = (await fineTune.levelField('boostLevel').boundingBox())!;

    // 手でアメブを減らしてから、アメブ目標Lvで 30 を選ぶ。個数は自動に戻り、Lv30 までの数になる
    await fineTune.step(-10);
    await expect(fineTune.boostResetButton).toBeEnabled();
    // 手で入れた個数が届くLv
    const manualLevel = await fineTune.levelInput('boostLevel').inputValue();
    await fineTune.typeLevel('boostLevel', 30);
    await expect(fineTune.levelInput('boostLevel')).toHaveValue('30');
    const toLv30 = await fineTune.boostValue(pikachu);
    expect(toLv30).toBeGreaterThan(0);
    expect(toLv30).toBeLessThan(auto - 10);
    await expect(fineTune.boostResetButton).toBeDisabled();
    await expect(fineTune.applyButton).toBeEnabled();
    expect(Number(await fineTune.applyButton.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
    // ▾ の Lvピッカーでも選べる
    await fineTune.levelField('boostLevel').getByTestId('level-picker-chevron').click();
    const picker = fineTune.levelField('boostLevel').getByTestId('level-picker-popover');
    await expect(picker).toBeVisible();
    await picker.locator('.levelChip', { hasText: /^\s*25\s*$/ }).click();
    await expect(fineTune.levelInput('boostLevel')).toHaveValue('25');
    expect(await fineTune.boostValue(pikachu)).toBeLessThan(toLv30);
    await fineTune.levelField('boostLevel').getByTestId('level-picker-chevron').click();
    await expect(picker).toBeHidden();
    await fineTune.typeLevel('boostLevel', 30);
    expect(await fineTune.boostValue(pikachu)).toBe(toLv30);
    // 目標Lvより上は目標Lvも上がる（計算機と同じ）
    await fineTune.typeLevel('boostLevel', 45);
    expect(await fineTune.targetLevel(pikachu)).toBe(45);
    // 続けて動かしたアメブ目標Lvは、元に戻す1回で動かす前（手で入れた個数）へ戻る（アメブの個数・目標Lvと同じまとめ方）
    await fineTune.undoButton.click();
    expect(await fineTune.targetLevel(pikachu)).toBe(40);
    await expect(fineTune.levelInput('boostLevel')).toHaveValue(manualLevel);
    expect(await fineTune.boostValue(pikachu)).toBe(auto - 10);
    await fineTune.typeLevel('boostLevel', 30);
    expect(await fineTune.boostValue(pikachu)).toBe(toLv30);

    // 現在Lvの Lv の欄も、アメブ目標Lvと同じ高さ
    await fineTune.select(pikachu, 'row');
    expect((await fineTune.levelField('srcLevel').boundingBox())!.height).toBeCloseTo(boostLevelBox.height, 0);

    await fineTune.waitForSettled();
    await fineTune.apply();
    await expect(calc.getRowBoostReachLevelInput(calc.getRow(0))).toHaveValue('30');
    // 計算機のアメブ目標Lvピッカーと同じく、アメブ個数は自動（欄は空で、薄く出る数が Lv30 までの数）
    await expect(calc.getRowBoostCandyInput(calc.getRow(0))).toHaveValue('');
    await expect(calc.getRowBoostCandyInput(calc.getRow(0))).toHaveAttribute('placeholder', String(toLv30));
  });

  test('アメブ: アメが足りず最小限のアメブにしても届かない行も、計算機と同じく入れられる。入れると警告の色になり、要るアメの数を詳細に出し、アメブは元のまま。外しても入れ直せる', async ({ page }) => {
    const { fineTune } = await setupScenario(page, GIVE_AND_RECEIVE);
    await fineTune.open();
    await fineTune.waitForSettled();
    // フシギダネは種族アメが 100 個しかなく、Lv50 へは最小限のアメブにしても届かない
    const fushigi = fineTune.rowByName('フシギダネ');
    await fineTune.select(fushigi, 'boost');
    // 名前は計算機の設定と同じ「目標Lvに届く最小限のアメブ個数」。PC幅は1行（スマホ幅は2行。スマホ幅の describe で見る）
    await expect.poll(() => fineTune.minimizeButton.evaluate((el) => (el as HTMLElement).innerText)).toBe('目標Lvに届く最小限のアメブ個数');
    expect(await fineTune.minimizeButton.locator('.fineTuneEditor__stackPart').evaluateAll((parts) => new Set(parts.map((p) => Math.round(p.getBoundingClientRect().top))).size)).toBe(1);
    await expect(fineTune.minimizeButton).not.toHaveAttribute('aria-disabled', 'true');
    await expect(fineTune.minimizeButton).not.toHaveAttribute('title');
    // アメブを手で入れておく（入れても届かない間は、この個数をそのまま使う）
    await fineTune.typeValue(120);
    await fineTune.waitForSettled();
    // 押すと入り、警告の色になる。計算機の個数指定の最小アメブ計算と同じ文言の札が詳細に出る（トーストは出さない。同じ警告が二重になるため）
    await fineTune.minimizeButton.click();
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(fineTune.minimizeButton).toHaveAttribute('data-warn', 'true');
    await expect(fineTune.minimizeButton).toHaveClass(/fineTuneEditor__tool--warn/);
    await fineTune.waitForSettled();
    await expect(fineTune.editorInfo.locator('.fineTuneEditor__info--danger', { hasText: '個以上のアメが必要です' })).toBeVisible();
    await expect(page.locator('.appToast', { hasText: '個以上のアメが必要です' })).toHaveCount(0);
    // アメが足りず届かない間は、手で入れたアメブをそのまま使う（0 にならない）
    expect(await fineTune.boostValue(fushigi)).toBe(120);
    await expect(fineTune.applyButton).toBeEnabled();
    // 外しても、もう一度入れられる（入らなくなる不具合の回帰）
    await fineTune.minimizeButton.click();
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'false');
    await expect(fineTune.minimizeButton).not.toHaveAttribute('data-warn');
    await fineTune.minimizeButton.click();
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(fineTune.minimizeButton).toHaveAttribute('data-warn', 'true');
    // ピカチュウは種族アメが十分あるので、入れても警告の色にならない
    await fineTune.select(fineTune.rowByName('ピカチュウ'), 'boost');
    await fineTune.minimizeButton.click();
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(fineTune.minimizeButton).toHaveClass(/fineTuneEditor__tool--on/);
    await expect(fineTune.minimizeButton).not.toHaveAttribute('data-warn');
  });

  test('アメブ: 計算機で最小限のアメブを入れてアメが足りない行は、開いたときから警告の色で、外して入れ直せる', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, GIVE_AND_RECEIVE);
    // 計算機でフシギダネ（2行目）の最小限のアメブを入れる（アメが足りないので計算機には警告が出る）
    await calc.setRowMinimizeBoost(calc.getRow(1), true);
    await calc.waitForPlannerResult();
    await fineTune.open();
    await fineTune.waitForSettled();
    await fineTune.select(fineTune.rowByName('フシギダネ'), 'boost');
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(fineTune.minimizeButton).toHaveAttribute('data-warn', 'true');
    await expect(fineTune.editorInfo).toContainText('個以上のアメが必要です');
    await fineTune.minimizeButton.click();
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'false');
    await fineTune.minimizeButton.click();
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(fineTune.minimizeButton).toHaveAttribute('data-warn', 'true');
  });

  test('行の詳細: 名前を押すと EXP補正の印が出て、現在Lv・あとEXP・アメ在庫を打てる。適用で計算機へ移り、計算機の元に戻す1回で全部戻る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, GIVE_AND_RECEIVE);
    // フシギダネ（2行目）は EXP↑（▲▲）
    await calc.setRowNature(calc.getRow(1), '▲▲');
    await calc.waitForPlannerResult();
    const srcBefore = await calc.getRowSrcLevelInput(calc.getRow(1)).inputValue();
    const expBefore = await calc.getRowExpRemainingInput(calc.getRow(1)).inputValue();
    await fineTune.open();
    await fineTune.waitForSettled();
    const fushigi = fineTune.rowByName('フシギダネ');
    const reachBefore = await fineTune.reachPoint(fushigi);

    await fineTune.select(fushigi, 'row');
    await expect(fineTune.editor.getByTestId('fine-tune-editor-nature')).toHaveText('▲▲');
    await expect(fineTune.levelInput('srcLevel')).toHaveValue('10');
    await expect(fineTune.rowProp('stock')).toHaveValue('100');

    // アメ在庫を増やすと、アメが足りなかったフシギダネが伸びる
    await fineTune.typeRowProp('stock', 5000);
    await expect(fineTune.rowProp('stock')).toHaveValue('5000');
    await fineTune.waitForSettled();
    expect(await fineTune.reachPoint(fushigi)).toBeGreaterThan(reachBefore);
    await expect(fineTune.resetEditButton).toBeEnabled();

    // 現在Lvを上げると、あとEXPは「次Lvまで全部」に戻る。あとEXPも打てる
    await fineTune.typeLevel('srcLevel', 15);
    await expect(fineTune.levelInput('srcLevel')).toHaveValue('15');
    const toNext = Number(await fineTune.rowProp('exp').inputValue());
    expect(toNext).toBeGreaterThan(100);
    await fineTune.typeRowProp('exp', 100);
    await expect(fineTune.rowProp('exp')).toHaveValue('100');
    // 範囲の外は端に収まる（次Lvまで全部）
    await fineTune.typeRowProp('exp', 999_999);
    await expect(fineTune.rowProp('exp')).toHaveValue(String(toNext));
    await fineTune.typeRowProp('exp', 100);
    await fineTune.waitForSettled();

    // リセットで、開いた時点（在庫も）へ戻り、もう一度入れ直せる
    await fineTune.resetEditButton.click();
    await expect(fineTune.levelInput('srcLevel')).toHaveValue('10');
    await expect(fineTune.rowProp('stock')).toHaveValue('100');
    await expect(fineTune.applyButton).toBeDisabled();
    await fineTune.typeRowProp('stock', 5000);
    await fineTune.typeLevel('srcLevel', 15);
    await fineTune.typeRowProp('exp', 100);
    await fineTune.waitForSettled();

    // 適用: 計算機の現在Lv・あとEXP・アメ在庫が変わる
    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expect(calc.getRowSrcLevelInput(calc.getRow(1))).toHaveValue('15');
    await expect(calc.getRowExpRemainingInput(calc.getRow(1))).toHaveValue('100');
    await expect(calc.getRowSpeciesCandyInput(calc.getRow(1))).toHaveValue('5000');
    // 計算機の元に戻す1回で、現在Lv・あとEXP・アメ在庫が全部戻る
    await calc.clickUndo();
    await calc.waitForPlannerResult();
    await expect(calc.getRowSrcLevelInput(calc.getRow(1))).toHaveValue(srcBefore);
    await expect(calc.getRowExpRemainingInput(calc.getRow(1))).toHaveValue(expBefore);
    await expect(calc.getRowSpeciesCandyInput(calc.getRow(1))).toHaveValue('100');
  });

  test('行の詳細: ニックネームを変えると表の名前が変わり、空にすると種族名。適用で計算機とボックスの名前が変わり、計算機の元に戻す1回で戻る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    const box = new BoxPanelPage(page);
    await fineTune.open();
    const eevee = fineTune.rowByName('イーブイ');
    await fineTune.select(eevee, 'row');
    // 開いた時点はニックネームが無く（種族名の表示）、空の欄に種族名を薄く出す
    await expect(fineTune.nicknameInput).toHaveValue('');
    await expect(fineTune.nicknameInput).toHaveAttribute('placeholder', 'イーブイ');

    // 日本語の変換を確定する Enter（変換中）では確定しない（欄を離れず、表の名前も変わらない）。ふつうの Enter で確定する
    await fineTune.nicknameInput.fill('ブイちゃん');
    await fineTune.nicknameInput.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true, cancelable: true });
    await expect(fineTune.nicknameInput).toBeFocused();
    await expect(fineTune.rowByName('イーブイ')).toHaveCount(1);
    await fineTune.nicknameInput.press('Enter');
    await expect(fineTune.nicknameInput).not.toBeFocused();
    await expect(fineTune.rowByName('ブイちゃん')).toHaveCount(1);
    await expect(fineTune.resetEditButton).toBeEnabled();
    await expect(fineTune.applyButton).toBeEnabled();
    // 空に戻すと種族名に戻り、何も変えていない扱いになる
    await fineTune.typeNickname('');
    await expect(fineTune.rowByName('イーブイ')).toHaveCount(1);
    await expect(fineTune.applyButton).toBeDisabled();
    // 下書きの元に戻すで、変えた名前に戻る
    await fineTune.undoButton.click();
    await expect(fineTune.rowByName('ブイちゃん')).toHaveCount(1);

    await fineTune.apply();
    await expect(calc.getRow(1)).toContainText('ブイちゃん');
    await box.selectBoxTile(1);
    await expect(box.detailNicknameInput).toHaveValue('ブイちゃん');
    // 計算機の元に戻す1回で、ボックスの名前も戻る
    await calc.clickUndo();
    await expect(calc.getRow(1)).toContainText('イーブイ');
    await expect(box.detailNicknameInput).toHaveValue('');
  });

  test('行の詳細: 計算機から削除すると表から外れ、元に戻すで戻る。適用で計算機から外れ（ボックスには残る）、計算機の元に戻す1回で戻る。最後の1匹は外せない', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    const box = new BoxPanelPage(page);
    await fineTune.open();
    await fineTune.select(fineTune.rowByName('イーブイ'), 'row');
    await fineTune.removeButton.click();
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'ヒトカゲ']);
    // 選択が外れ、操作パネルは設定欄に戻る
    await expect(fineTune.editor).not.toHaveAttribute('data-row-id', /.+/);
    await fineTune.undoButton.click();
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(fineTune.applyButton).toBeDisabled();
    await fineTune.redoButton.click();
    await fineTune.waitForSettled();

    await fineTune.apply();
    await calc.waitForPlannerResult();
    await expectCalcOrder(calc, ['ピカチュウ', 'ヒトカゲ']);
    await box.expectBoxTileCount(3);
    await calc.clickUndo();
    await expectCalcOrder(calc, ['ピカチュウ', 'イーブイ', 'ヒトカゲ']);

    // 最後の1匹は外せない（ボタンを押せない）
    await fineTune.open();
    for (const name of ['ピカチュウ', 'イーブイ']) {
      await fineTune.select(fineTune.rowByName(name), 'row');
      await fineTune.removeButton.click();
    }
    await fineTune.select(fineTune.rowByName('ヒトカゲ'), 'row');
    await expect(fineTune.removeButton).toBeDisabled();
  });

  test('アメ: 欄を押して数を変えると個数指定になり、計算機と同じくアメブも別に動かせる。元の数に戻すと戻る。目標Lvは個数指定を上書きする。適用で計算機の個数指定へ移る', async ({ page }) => {
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
    // 目標Lvもアメブも、計算機と同じく動かせる（目標Lvは個数指定を上書きする。アメブはアメの数の内訳）
    await expect(fineTune.cell(pikachu, 'target')).not.toHaveClass(/fineTuneRow__cell--locked/);
    await expect(fineTune.cell(pikachu, 'boost')).not.toHaveClass(/fineTuneRow__cell--locked/);
    await fineTune.waitForSettled();
    // 個数指定の行は、目標Lvがアメの数で決まる（計算機と同じ）。減らしたので目標Lvが下がる
    expect(await fineTune.targetLevel(pikachu)).toBeLessThan(40);

    // 要る数より多くもできる（目標Lvより先まで上がる）
    await fineTune.setValue(pikachu, 'candy', candy + 50);
    expect(await fineTune.candyValue(pikachu)).toBe(candy + 50);
    // 元の数に戻すと個数指定が外れ、開いた時点の行に戻る
    await fineTune.typeValue(candy);
    await expect(fineTune.applyButton).toBeDisabled();

    // アメの数を変えた行でアメブを動かす。アメの数はそのまま。個数指定の行は最小限のアメブにできない（理由を出す）
    await fineTune.typeValue(candy - 20);
    const boostBefore = await fineTune.boostValue(pikachu);
    await fineTune.select(pikachu, 'boost');
    await expect(fineTune.editor).toHaveAttribute('data-field', 'boost');
    await fineTune.step(-10);
    expect(await fineTune.boostValue(pikachu)).toBe(boostBefore - 10);
    expect(await fineTune.candyValue(pikachu)).toBe(candy - 20);
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-disabled', 'true');
    // 押せない見た目でも押せる（理由を出す）。Playwright は aria-disabled を押せない扱いにするので force で押す
    await fineTune.minimizeButton.click({ force: true });
    await expect(page.locator('.appToast')).toContainText('個数指定の行は「目標Lvに届く最小限のアメブ個数」にできません');
    await expect(fineTune.minimizeButton).toHaveAttribute('aria-pressed', 'false');

    // アメの数を変えたあとに目標Lvを選ぶと、個数指定が外れてその目標Lvになる（計算機と同じ）
    await fineTune.setValue(pikachu, 'target', 45);
    expect(await fineTune.targetLevel(pikachu)).toBe(45);
    await fineTune.undoButton.click();
    expect(await fineTune.candyValue(pikachu)).toBe(candy - 20);
    expect(await fineTune.boostValue(pikachu)).toBe(boostBefore - 10);

    await fineTune.select(pikachu, 'candy');
    await fineTune.typeValue(candy - 30);
    await fineTune.waitForSettled();
    await fineTune.apply();
    await calc.waitForPlannerResult();
    // 計算機には、個数指定とアメブ個数が別々に入る
    await expect(calc.getRowCandyTargetInput(calc.getRow(0))).toHaveValue(String(candy - 30));
    await expect(calc.getRowBoostCandyInput(calc.getRow(0))).toHaveValue(String(boostBefore - 10));
  });

  test('ポケモンが不明: 行の詳細に、ボックスで図鑑のポケモンと再リンクする直し方を出す。再リンクすると出なくなる', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, { shards: '3000000', rows: [{ name: 'ピカチュウ', dst: 40, candy: '99999' }] });
    // 図鑑に無い名前は、ニックネームだけで種族不明の個体として登録される（ボックスに「種族不明のため仮設定」と出るもの）
    const box = new BoxPanelPage(page);
    await box.openAddNewPanel();
    await box.fillPokemonName('');
    await page.getByPlaceholder('例: ピカチュウA / 推し個体').fill('なぞの個体');
    await box.addToBoxButton.click();
    await calc.expectRowCount(2);
    await calc.waitForPlannerResult();

    await fineTune.open();
    await fineTune.waitForSettled();
    const unknown = fineTune.rowByName('なぞの個体');
    await expect(unknown).toHaveClass(/fineTuneRow--excluded/);
    await fineTune.select(unknown, 'row');
    // 文言の中のゼロ幅スペース（折り返してよい位置）は除いて比べる
    await expect.poll(() => fineTune.editorNote.evaluate((el) => (el.textContent ?? '').replace(/\u200B/g, '')))
      .toBe('不明なポケモンです。ポケモンボックスでポケモン図鑑と再リンクしてください。');
    // 説明は2行の段に収まる（切れない）
    expect(await fineTune.editorNote.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
    await fineTune.closeButton.click();
    await expect(fineTune.overlay).toHaveCount(0);

    // ボックスで再リンクすると、計算機の行にも伝わり、説明は出なくなる
    const tileTexts = await box.boxTiles.allTextContents();
    const tileIndex = tileTexts.findIndex((text) => text.includes('なぞの個体'));
    expect(tileIndex).toBeGreaterThanOrEqual(0);
    // 追加した直後はその個体の詳細が開いている（もう一度押すと閉じる）ので、開いていないときだけ押す
    if (await box.detailPanel.count() === 0) await box.selectBoxTile(tileIndex);
    await box.expectDetailPanelVisible();
    await expect(box.detailPanel).toContainText('なぞの個体');
    await box.detailRelinkInput.fill('ピカチュウ');
    await box.detailRelinkButton.click();
    await calc.waitForPlannerResult();
    await fineTune.open();
    await fineTune.waitForSettled();
    const relinked = fineTune.rowByName('なぞの個体');
    await expect(relinked).not.toHaveClass(/fineTuneRow--excluded/);
    await fineTune.select(relinked, 'row');
    await expect(fineTune.editorNote).toHaveCount(0);
  });

  test('並べ替え: 取っ手の ↑↓ キーとつかんで動かす操作で行が動き、適用すると計算機の順番が変わる', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    expect(await fineTune.rowTitles()).toEqual(['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
    await expect(page.getByTestId('fine-tune-row-handle')).toHaveCount(3);
    // PC幅は取っ手のグリップが印になるので、見出しの ⌃⌄ は出さない
    await expect(page.getByTestId('fine-tune-head-reorder-icon')).toBeHidden();

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

    // 名前をマウスで押したまま動かしても並べ替えられる。離したときに行の詳細は開かない
    await fineTune.dragRowByNameWithMouse(fineTune.rowByName('イーブイ'), 0);
    expect(await fineTune.rowTitles()).toEqual(['イーブイ', 'ヒトカゲ', 'ピカチュウ']);
    await fineTune.expectIdle();
    // 名前をふつうに押せば、行の詳細が開く（並べ替えにならない）
    await fineTune.rowByName('ヒトカゲ').getByTestId('fine-tune-row-name').click();
    await expect(fineTune.editor).toHaveAttribute('data-field', 'row');
    expect(await fineTune.rowTitles()).toEqual(['イーブイ', 'ヒトカゲ', 'ピカチュウ']);

    await fineTune.apply();
    await expectCalcOrder(calc, ['イーブイ', 'ヒトカゲ', 'ピカチュウ']);
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
    await fineTune.select(pikachu, 'boost');
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

  test('設定欄: 何も選んでいないときは設定欄（既定のアメブ目標Lv・最小限のアメブ・かけら・万能アメ）を出し、変えるとプレビューに効き、リセットで戻り、適用で計算機の設定へ移る', async ({ page }) => {
    const { calc, fineTune } = await setupScenario(page, ALL_REACHED);
    await fineTune.open();
    await fineTune.waitForSettled();
    const pikachu = fineTune.rowByName('ピカチュウ');
    const boost = await fineTune.boostValue(pikachu);

    // 刻みのボタンは出さず、設定欄を出す
    await fineTune.expectIdle();
    await expect(fineTune.editor.getByTestId('fine-tune-editor-step')).toHaveCount(0);
    await expect(fineTune.editor.getByTestId('fine-tune-editor-settings-label')).toHaveText('設定');
    await expect(fineTune.setting('shards')).toHaveValue('3,000,000');
    await expect(fineTune.levelInput('defaultBoostLevel')).toHaveValue('');
    await expect(fineTune.levelInput('defaultBoostLevel')).toHaveAttribute('placeholder', '目標Lvと同じ');
    await expect(fineTune.resetEditButton).toBeDisabled();

    // 既定のアメブ目標Lv: 自動の行をすぐ新しい既定で配り直す
    await fineTune.typeLevel('defaultBoostLevel', 20);
    await fineTune.waitForSettled();
    expect(await fineTune.boostValue(pikachu)).toBeLessThan(boost);
    // 空欄で確定すると「目標Lvと同じ」へ戻り、アメブも戻る
    await fineTune.typeLevel('defaultBoostLevel', '');
    await fineTune.waitForSettled();
    await expect(fineTune.levelInput('defaultBoostLevel')).toHaveValue('');
    expect(await fineTune.boostValue(pikachu)).toBe(boost);
    await expect(fineTune.applyButton).toBeDisabled();

    // かけらを減らすと、届かない行が出る。押した欄は打った値で置き換わる（区切りの前の数字に足さない）
    const reachedBefore = await fineTune.reachedCount();
    await fineTune.typeSetting('shards', 1000);
    await expect(fineTune.setting('shards')).toHaveValue('1,000');
    await fineTune.waitForSettled();
    expect(await fineTune.reachedCount()).toBeLessThan(reachedBefore);
    await fineTune.typeSetting('s', 5);
    await expect(fineTune.setting('s')).toHaveValue('5');
    // 既定のアメブ目標Lvは、目標Lvに届く最小限のアメブ個数がオンの間は控えの値なので破線で出す（押せなくはしない）
    const defaultLevelInput = fineTune.levelInput('defaultBoostLevel');
    expect(await defaultLevelInput.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid');
    await fineTune.settingsMinimizeButton.click();
    await expect(fineTune.settingsMinimizeButton).toHaveAttribute('aria-checked', 'true');
    await expect(fineTune.levelField('defaultBoostLevel')).toHaveAttribute('data-fallback', 'true');
    expect(await defaultLevelInput.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
    await expect(defaultLevelInput).toBeEnabled();

    // リセットで設定を開いた時点へ戻す
    await expect(fineTune.resetEditButton).toBeEnabled();
    await fineTune.resetEditButton.click();
    await expect(fineTune.setting('shards')).toHaveValue('3,000,000');
    await expect(fineTune.setting('s')).toHaveValue('0');
    await expect(fineTune.settingsMinimizeButton).toHaveAttribute('aria-checked', 'false');
    await expect(fineTune.applyButton).toBeDisabled();

    // 適用: 計算機の設定・在庫が変わり、計算機の元に戻す1回で戻る
    await fineTune.typeSetting('shards', 2_500_000);
    await fineTune.typeSetting('m', 7);
    await fineTune.typeLevel('defaultBoostLevel', 35);
    await fineTune.waitForSettled();
    await fineTune.apply();
    await calc.waitForPlannerResult();
    const settings = new SettingsModalPage(page);
    await calc.clickSettings();
    expect(await settings.getTotalShards()).toBe('2,500,000');
    expect(await settings.getUniversalCandy('M')).toBe(7);
    await expect(page.getByTestId('settings-default-boost-reach-input')).toHaveValue('35');
    await settings.closeByButton();
    await calc.clickUndo();
    await calc.clickSettings();
    expect(await settings.getTotalShards()).toBe('3,000,000');
    expect(await settings.getUniversalCandy('M')).toBe(0);
    await expect(page.getByTestId('settings-default-boost-reach-input')).toHaveValue('');
    await settings.closeByButton();
  });

  test('設定欄: 「その他の設定はこちら」でシンプルを閉じて計算機の設定を開く。下書きがあれば捨ててよいか確かめる', async ({ page }) => {
    const { fineTune } = await setupScenario(page, ALL_REACHED);
    const settings = new SettingsModalPage(page);
    const link = fineTune.editor.getByTestId('fine-tune-editor-more-settings');
    await fineTune.open();
    await fineTune.waitForSettled();
    await expect(fineTune.editorInfo).toHaveText('その他の設定はこちら');

    // 下書きが無ければ、そのまま閉じて設定を開く
    await link.click();
    await expect(fineTune.overlay).toHaveCount(0);
    await expect(settings.modal).toBeVisible();
    await settings.closeByButton();

    // 下書きがあれば確かめる。やめるとシンプルに残り、下書きもそのまま
    await fineTune.open();
    await fineTune.waitForSettled();
    await fineTune.typeSetting('s', 5);
    await link.click();
    await expect(fineTune.discardConfirm).toBeVisible();
    await expect(fineTune.discardConfirm).toContainText('変更を破棄して設定を開きますか？');
    await expect(fineTune.discardConfirmYes).toHaveText('破棄して開く');
    await fineTune.discardConfirmNo.click();
    await expect(fineTune.discardConfirm).toBeHidden();
    await expect(fineTune.setting('s')).toHaveValue('5');
    await expect(settings.modal).toBeHidden();
    // 破棄して開くと、シンプルを閉じて設定を開く（下書きは計算機に入らない）
    await link.click();
    await fineTune.discardConfirmYes.click();
    await expect(fineTune.overlay).toHaveCount(0);
    await expect(settings.modal).toBeVisible();
    expect(await settings.getUniversalCandy('S')).toBe(0);
    await settings.closeByButton();
  });

  test('閉じる: Escape は先に調整バーを閉じ、下書きがあれば × と Escape で確認が出る。キャンセルは確認なしで変更を捨てて閉じる', async ({ page }) => {
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
    // 同じ欄をもう一度押すと選択が外れ、調整バーは設定欄に戻る（場所は出たまま）
    await fineTune.select(pikachu, 'sleep');
    await fineTune.cell(pikachu, 'sleep').click();
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

    // 適用の隣のキャンセル: この画面での変更（目標Lv・アメブ・並べ替え）をすべて捨てて、確認なしで閉じる
    await fineTune.open();
    await fineTune.waitForSettled();
    await fineTune.adjust(fineTune.rowByName('ピカチュウ'), 'target', 1);
    await fineTune.adjust(fineTune.rowByName('イーブイ'), 'boost', -10);
    await fineTune.moveUp(fineTune.rowByName('ヒトカゲ'));
    await fineTune.cancelButton.click();
    await expect(fineTune.discardConfirm).toHaveCount(0);
    await expect(fineTune.overlay).toHaveCount(0);
    await expectCalcOrder(calc, ['ピカチュウ', 'イーブイ', 'ヒトカゲ']);
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
    // 伸ばしたときの小窓は横幅いっぱいで（モバイル幅）、画面の中に収まり、OK で閉じる
    const reportBox = (await fineTune.raiseReport.boundingBox())!;
    expect(reportBox.x).toBeGreaterThanOrEqual(0);
    expect(reportBox.x).toBeLessThanOrEqual(1);
    expect(reportBox.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(reportBox.x + reportBox.width).toBeLessThanOrEqual(viewport.width);
    expect(reportBox.y + reportBox.height).toBeLessThanOrEqual(viewport.height);
    // 小窓の表: 列の見出し・値は欄からはみ出さない（見出し「ポケモン」はモバイル幅では読み上げだけなので測らない）。名前は値の上の段
    const reportCells = () => fineTune.raiseReport.locator('[role="columnheader"]:not(.fineTuneReport__h--name), [data-testid="fine-tune-raise-report-item"]');
    expect(await reportCells().count()).toBeGreaterThanOrEqual(10);
    const clippedCells = () => reportCells().evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent));
    expect(await clippedCells()).toEqual([]);
    const firstReportRow = fineTune.raiseReportRows.first();
    const nameBox = (await firstReportRow.getByRole('rowheader').boundingBox())!;
    const levelBox = (await fineTune.raiseReportItem(firstReportRow, 'level').boundingBox())!;
    expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(levelBox.y + 1);
    // いちばん長い値（あとEXP は1Lvぶんの最大 7,161、かけらは7桁）を入れても、390px・375px・360px・320px の列に入る。
    // 表示を確かめるためだけに文字を差し替える（閉じると作り直される）
    await fineTune.raiseReport.evaluate((root) => {
      const longest: Record<string, string> = { level: '61 → 64', expLeft: '7,161 → 1,234', boost: '−3,500', candy: '+1,234', shards: '−3,456,789' };
      for (const el of root.querySelectorAll<HTMLElement>('[data-testid="fine-tune-raise-report-item"]')) el.textContent = longest[el.dataset.item!]!;
    });
    for (const width of [viewport.width, 375, 360, 320]) {
      await page.setViewportSize({ width, height: viewport.height });
      expect(await clippedCells(), `${width}px`).toEqual([]);
    }
    await page.setViewportSize(viewport);
    await fineTune.closeRaiseReport();
    await fineTune.select(fineTune.rowByName('ヒトカゲ'), 'boost');
    // 「目標Lvに届く最小限のアメブ個数」はスマホ幅では2行（PC幅は1行）
    expect(await fineTune.minimizeButton.locator('.fineTuneEditor__stackPart').evaluateAll((parts) => new Set(parts.map((p) => Math.round(p.getBoundingClientRect().top))).size)).toBe(2);
    // 伸ばしたあとのヒトカゲはアメブを減らしてかけらを浮かせている（0 のこともある）ので、増やす向きで動かす
    await fineTune.step(100);
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
    // blue テーマ（既定）でも、シンプルのボタンに影を付けない
    expect(await fineTune.stepButton(-100).evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
    expect(await fineTune.applyButton.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
    for (const part of editorParts) {
      const size = (await part.boundingBox())!;
      expect(size.height).toBeGreaterThanOrEqual(minHeight);
      expect(size.width).toBeGreaterThanOrEqual(minWidth);
      expect(size.x + size.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    const first = fineTune.rows.first();
    for (const testId of ['fine-tune-row-name', 'fine-tune-row-target', 'fine-tune-row-sleep', 'fine-tune-row-boost', 'fine-tune-row-candy']) {
      const size = (await first.getByTestId(testId).boundingBox())!;
      expect(size.height, testId).toBeGreaterThanOrEqual(minHeight);
    }
    // スマホ幅では取っ手を出さない（名前の列を広く取り、名前を長押ししてつかむ）。代わりに見出しの「ポケモン」の左に ⌃⌄ の印
    await expect(first.getByTestId('fine-tune-row-handle')).toBeHidden();
    await expect(page.getByTestId('fine-tune-head-reorder-icon')).toBeVisible();

    // フッターの操作が画面内に収まり、1段に並ぶ。「LvUp!」のキラキラはどの幅でも出し、文字は欄からはみ出さない
    async function expectFooterInOneRow(width: number): Promise<void> {
      const footerTops: number[] = [];
      for (const button of [fineTune.applyButton, fineTune.cancelButton, fineTune.raiseButton, fineTune.undoButton, fineTune.redoButton]) {
        const rect = (await button.boundingBox())!;
        footerTops.push(rect.y + rect.height / 2);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
        expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      expect(Math.max(...footerTops) - Math.min(...footerTops), `${width}px`).toBeLessThan(4);
      await expect(fineTune.raiseButton.locator('svg')).toBeVisible();
      expect(await fineTune.raiseButton.evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px`).toBeLessThanOrEqual(0);
    }
    await expectFooterInOneRow(viewport.width);
    // 320px（初代 iPhone SE）でも同じ
    await page.setViewportSize({ width: 320, height: viewport.height });
    await expectFooterInOneRow(320);
    await page.setViewportSize(viewport);

    // 行の詳細の2段目: 「LvUp!でアメブ固定」と「計算機から削除」が重ならずに画面内に並び、名前は2行で切れない（320px でも）
    await fineTune.select(fineTune.rowByName('ピカチュウ'), 'row');
    async function expectLockFits(width: number): Promise<void> {
      const lock = (await fineTune.boostLockSwitch.boundingBox())!;
      const remove = (await fineTune.removeButton.boundingBox())!;
      expect(lock.x, `${width}px`).toBeGreaterThanOrEqual(0);
      expect(lock.x + lock.width, `${width}px`).toBeLessThanOrEqual(remove.x);
      expect(remove.x + remove.width, `${width}px`).toBeLessThanOrEqual(width + 1);
      const label = fineTune.boostLockSwitch.locator('.fineTuneEditor__switchLabel');
      expect(await label.evaluate((el) => el.scrollWidth - el.clientWidth), `${width}px`).toBeLessThanOrEqual(0);
      expect(await label.locator('.fineTuneEditor__stackPart').evaluateAll((parts) => new Set(parts.map((p) => Math.round(p.getBoundingClientRect().top))).size)).toBe(2);
    }
    await expectLockFits(viewport.width);
    await page.setViewportSize({ width: 320, height: viewport.height });
    await expectLockFits(320);
    await page.setViewportSize(viewport);

    // 調整バーの高さは、どの欄を選んでも変わらない（Escape で選択を外し、何も選んでいない状態から測る）
    await page.keyboard.press('Escape');
    await expectEditorHeightConstant(fineTune);

    // 目標Lvは欄をタップすると、調整バーを開かずに Lvピッカーが画面内に開く（テンキーは出ない）
    await page.keyboard.press('Escape');
    await fineTune.expectIdle();
    const eevee = fineTune.rowByName('イーブイ');
    await fineTune.cell(eevee, 'target').tap();
    const picker = fineTune.targetPicker;
    await expect(picker).toBeVisible();
    await fineTune.expectIdle();
    await expect(page.getByTestId('numeric-keypad')).toBeHidden();
    const pickerBox = (await picker.boundingBox())!;
    expect(pickerBox.x).toBeGreaterThanOrEqual(0);
    expect(pickerBox.y).toBeGreaterThanOrEqual(0);
    expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(viewport.height + 1);
    for (let i = 0; i < 5; i += 1) await picker.getByTestId('level-picker-increment').tap();
    expect(await fineTune.targetLevel(eevee)).toBe(45);
    // 一覧をスクロールしようとすると閉じる（画面に固定した吹き出しが欄から離れて残らない）
    await fineTune.swipeOnName(fineTune.rows.nth(0), 30);
    await expect(picker).toBeHidden();
    await fineTune.expectIdle();

    // 名前を長押ししてから動かすと並べ替えられる。指を離したときに行の詳細は開かない
    const before = await fineTune.rowTitles();
    await fineTune.longPressDragRowByName(fineTune.rowByName(before[0]!), 2);
    expect(await fineTune.rowTitles()).toEqual([before[1], before[2], before[0], before[3]]);
    await fineTune.expectIdle();
    // 名前をタップすると行の詳細が開く（並べ替えにならない）
    await fineTune.rows.nth(1).getByTestId('fine-tune-row-name').tap();
    await expect(fineTune.editor).toHaveAttribute('data-field', 'row');
    await expect(fineTune.reorderNav).toBeHidden();
    // 名前に指を置いてすぐ動かすのは一覧のスクロール。並べ替えも行の詳細も起きない
    // （スクロールの勢いが残っている間のタップは、ブラウザがスクロールを止めるだけにするので、これを最後に置く）
    await page.keyboard.press('Escape');
    await fineTune.expectIdle();
    await fineTune.swipeOnName(fineTune.rows.nth(1), -30);
    await expect(fineTune.reorderNav).toBeHidden();
    expect(await fineTune.rowTitles()).toEqual([before[1], before[2], before[0], before[3]]);
    await fineTune.expectIdle();
    await phone.close();
  });
});
