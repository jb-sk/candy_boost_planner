import { test, expect, type Page } from '@playwright/test';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { CalcPanelPage } from './pages/CalcPanelPage';
import { SettingsModalPage } from './pages/SettingsModalPage';

test.describe('07-level-planner-inventory', () => {
  test('在庫不足では目標まで行だけが万能Sを補填して赤字になり、到達可能行は在庫を超えない', async ({ page }) => {
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    await settings.setUniversalCandy('S', 10);
    await settings.setUniversalCandy('M', 0);
    await settings.setUniversalCandy('L', 0);
    await settings.setTypeCandy('でんき', 'S', 0);
    await settings.setTypeCandy('でんき', 'M', 0);
    await settings.setTotalShards('99999999');
    await settings.closeByButton();

    await calc.setBoostKind('none');
    await box.openAddNewPanel();
    await box.fillPokemonName('ピカチュウ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);
    await calc.setRowSrcLevel(row, 10);
    await calc.setRowDstLevel(row, 60);
    await calc.setRowSpeciesCandy(row, '0');
    await page.waitForTimeout(200);

    const requiredItems = calc.getRowRequiredRow(row).locator('.calcRow__res').filter({ hasText: '必要アイテム' });
    const targetUniversalS = requiredItems.locator('.calcRow__num--danger').filter({ hasText: '万能S' });
    await expect(targetUniversalS).toBeVisible();

    const targetMatch = (await targetUniversalS.textContent())?.match(/万能S\s+([\d,]+)/);
    expect(targetMatch).not.toBeNull();
    expect(Number((targetMatch?.[1] ?? '0').replace(/,/g, ''))).toBeGreaterThan(10);

    await calc.expandRow(row);
    const usedItems = await calc.getRowUsedItems(row);
    const usedMatch = usedItems.match(/万能S\s+([\d,]+)/);
    expect(usedMatch).not.toBeNull();
    expect(Number((usedMatch?.[1] ?? '0').replace(/,/g, ''))).toBeLessThanOrEqual(10);
  });

  // Lv10→60 の1行を作る。`shards` で律速要因を切り替える。
  // shortage.candyToTarget / dreamShardShortage は「他の制約を理論値に置いた」独立仮定の値なので
  // どちらの設定でも両方とも非0になる。表示に出るのは律速要因の1つだけ。
  async function setupSingleRow(page: Page, shards: string) {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.clickSettings();
    await settings.setUniversalCandy('S', 10);
    await settings.setUniversalCandy('M', 0);
    await settings.setUniversalCandy('L', 0);
    await settings.setTypeCandy('でんき', 'S', 0);
    await settings.setTypeCandy('でんき', 'M', 0);
    await settings.setTotalShards(shards);
    await settings.closeByButton();

    await calc.setBoostKind('none');
    await box.openAddNewPanel();
    await box.fillPokemonName('ピカチュウ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);
    await calc.setRowSrcLevel(row, 10);
    await calc.setRowDstLevel(row, 60);
    await calc.setRowSpeciesCandy(row, '0');
    return { calc, row };
  }

  /** かけらが極端に少なく、かけらが律速になる行 */
  const setupShardsLimitedRow = (page: Page) => setupSingleRow(page, '1000');
  /** かけらは潤沢で、アメが律速になる行 */
  const setupCandyLimitedRow = (page: Page) => setupSingleRow(page, '99999999');

  test('かけら律速の行では不足表示がかけら不足だけになる', async ({ page }) => {
    // 画面へ出すのは limitingFactor に一致する1つだけ（かけら）。設計書§10.12
    await page.goto('/');
    const { calc, row } = await setupShardsLimitedRow(page);

    // 不足表示の置き場所は「到達可能」行だけ
    await calc.expandRow(row);
    const usedRow = calc.getRowUsedRow(row);
    await expect.poll(async () => (await usedRow.textContent()) ?? '').toContain('かけら不足');
    expect(await usedRow.textContent()).not.toContain('アメ不足');
  });

  test('目標まで行には不足を表示しない（折りたたみ・展開のどちらでも）', async ({ page }) => {
    // 「目標まで」は在庫を無視した理論値の行。不足は在庫と突き合わせた結果なので
    // 「到達可能」行だけが持つ。過去に「折りたたみ時だけ出す」形で何度も復活したため固定する。
    await page.goto('/');
    const { calc, row } = await setupShardsLimitedRow(page);

    const requiredRow = calc.getRowRequiredRow(row);
    // まず不足自体が発生していることを確かめる（条件が緩んで空振りするのを防ぐ）
    await calc.expandRow(row);
    await expect.poll(async () => (await calc.getRowUsedRow(row).textContent()) ?? '').toContain('かけら不足');

    for (const label of ['アメ不足', 'アメブ不足', 'かけら不足']) {
      expect(await requiredRow.textContent()).not.toContain(label);
    }

    // 折りたたんでも出さない（`!isExpanded(r.id)` 条件付きでの復活を防ぐ）
    await calc.collapseRow(row);
    for (const label of ['アメ不足', 'アメブ不足', 'かけら不足']) {
      expect(await requiredRow.textContent()).not.toContain(label);
    }
  });

  test('レベルピッカーは律速要因を文字で示す（かけら律速）', async ({ page }) => {
    // 🍬アイコン1種だった頃は、かけら律速の行でマークが消えて「不足が悪化したのに表示が減る」
    // 状態になっていた。律速に応じてラベルが入れ替わる形にする。設計書§10.15
    await page.goto('/');
    const { calc, row } = await setupShardsLimitedRow(page);
    await calc.openLevelPicker(row, 'dstLevel');
    await expect.poll(async () => calc.getLevelPickerShortageText(row, 'dstLevel')).toBe('かけら不足');
  });

  test('レベルピッカーは律速要因を文字で示す（アメ律速）', async ({ page }) => {
    await page.goto('/');
    const { calc, row } = await setupCandyLimitedRow(page);
    await calc.openLevelPicker(row, 'dstLevel');
    await expect.poll(async () => calc.getLevelPickerShortageText(row, 'dstLevel')).toBe('アメ不足');
  });

  test('アメブ不足はアメブ目標Lvピッカーに出し、目標Lvピッカーには出さない', async ({ page }) => {
    // ピッカーは自分が操作する対象の不足を担当する。設計書§10.15
    // アメブ枠不足は目標到達の可否と切り離した指標なので、律速要因とは別に判定する。
    await page.goto('/');
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    const settings = new SettingsModalPage(page);

    await calc.setBoostKind('full');
    await calc.clickSettings();
    await settings.setUniversalCandy('S', 0);
    await settings.setUniversalCandy('M', 0);
    await settings.setUniversalCandy('L', 0);
    await settings.setTotalShards('99999999');
    await settings.setBoostCandyRemaining('10');
    await settings.closeByButton();

    await box.openAddNewPanel();
    await box.fillPokemonName('ピカチュウ');
    await box.confirmPokemonName();
    await box.clickAddToBox();

    const row = calc.getRow(0);
    await calc.setRowSrcLevel(row, 10);
    await calc.setRowDstLevel(row, 60);
    // アメ・かけらは潤沢にして、アメブ枠だけを絞る
    await calc.setRowSpeciesCandy(row, '99999');
    // 残枠10に対して200個を手入力する（在庫超過の指定は許される。§D-2）
    const boostInput = calc.getRowBoostCandyInput(row);
    await boostInput.fill('200');
    await boostInput.blur();

    await calc.openLevelPicker(row, 'boostReachLevel');
    await expect.poll(async () => calc.getLevelPickerShortageText(row, 'boostReachLevel')).toBe('アメブ不足');
    expect(await calc.getLevelPickerShortageText(row, 'dstLevel')).toBe('');
  });

  test('赤字は律速要因の項目だけに付く', async ({ page }) => {
    // 赤の意味は「この資源が足りない」ではなく「今これが効いている」。設計書§10.15
    await page.goto('/');
    const { calc, row } = await setupShardsLimitedRow(page);
    await calc.expandRow(row);

    const usedRow = calc.getRowUsedRow(row);
    // 「かけら」の使用量と「アメ」の使用量。不足チップ（かけら不足）と取り違えないよう、
    // ラベルが完全一致する項目だけを拾う。
    const resByLabel = (label: string) =>
      usedRow.locator('.calcRow__res').filter({ has: page.locator('.calcRow__k', { hasText: new RegExp(`^${label}$`) }) });
    const shardsRes = resByLabel('かけら');
    const candyRes = resByLabel('アメ');
    await expect(shardsRes).toHaveCount(1);
    await expect(candyRes).toHaveCount(1);

    // かけら律速なので、赤くなるのは「かけら」の使用量だけ。アメは赤くしない
    await expect(shardsRes.locator('.calcRow__num--danger')).toHaveCount(1);
    await expect(candyRes.locator('.calcRow__num--danger')).toHaveCount(0);
  });
});
