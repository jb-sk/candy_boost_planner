import { test, expect } from '@playwright/test';
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
    await calc.getRowSpeciesCandyInput(row).fill('0');
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
});
