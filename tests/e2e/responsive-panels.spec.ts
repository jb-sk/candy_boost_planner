import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { CalcPanelPage } from './pages/CalcPanelPage';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/test-config.json'), 'utf-8'),
) as { importData: { singlePokemon: string } };

test.describe('responsive panel tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#neo-calc')).toBeVisible();
    await expect(page.locator('#neo-box')).toBeAttached();
  });

  test('1400px未満は選択したパネルだけを表示する', async ({ page }) => {
    const calcTab = page.getByRole('tab', { name: '計算機' });
    const boxTab = page.getByRole('tab', { name: 'ポケモンボックス' });

    await expect(calcTab).toHaveAttribute('aria-selected', 'true');
    await expect(boxTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#neo-calc')).toBeVisible();
    await expect(page.locator('#neo-box')).toBeHidden();

    await boxTab.click();
    await expect(boxTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#neo-calc')).toBeHidden();
    await expect(page.locator('#neo-box')).toBeVisible();
  });

  test('全テーマ共通でモバイル・タブレットのパネル外枠を表示しない', async ({ page }) => {
    const themeSelect = page.locator('.design-switch-select');
    const calcPanel = page.locator('#neo-calc');
    const boxPanel = page.locator('#neo-box');

    for (const theme of ['blue', 'booklet', 'candy', 'cyberpunk', 'dark', 'green', 'vivid']) {
      await themeSelect.selectOption(theme);
      await expect(themeSelect).toHaveValue(theme);
      for (const panel of [calcPanel, boxPanel]) {
        await expect(panel).toHaveCSS('border-top-width', '0px');
        await expect(panel).toHaveCSS('border-right-width', '0px');
        await expect(panel).toHaveCSS('border-bottom-width', '0px');
        await expect(panel).toHaveCSS('border-left-width', '0px');
        await expect(panel).toHaveCSS('border-radius', '0px');
        await expect(panel).toHaveCSS('box-shadow', 'none');
      }
    }

    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(calcPanel).not.toHaveCSS('border-top-width', '0px');
  });

  test('bookletの外枠用タブ装飾はモバイル・タブレットだけ非表示にする', async ({ page }) => {
    const themeSelect = page.locator('.design-switch-select');
    await themeSelect.selectOption('booklet');
    await expect(themeSelect).toHaveValue('booklet');

    const decorationDisplay = () => page.locator('.hero').evaluate(
      element => getComputedStyle(element, '::before').display,
    );
    await expect.poll(decorationDisplay).toBe('none');

    await page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(decorationDisplay).toBe('block');
  });

  test('全テーマ共通でタブバーの影を消し、選択背景をナビ内に収める', async ({ page }) => {
    const themeSelect = page.locator('.design-switch-select');
    const nav = page.locator('.mobileNav');
    const navButtons = page.locator('.mobileNav button');
    await expect(navButtons).toHaveCount(4);
    for (const theme of ['blue', 'booklet', 'candy', 'cyberpunk', 'dark', 'green', 'vivid']) {
      await themeSelect.selectOption(theme);
      await expect(themeSelect).toHaveValue(theme);
      await expect(themeSelect).toBeEnabled();
      await expect(nav).toHaveCSS('box-shadow', 'none');
      const navSurface = await nav.evaluate(element => {
        const style = getComputedStyle(element);
        const channels = style.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
        return {
          alpha: channels.length === 4 ? channels[3] : 1,
          backdropFilter: style.backdropFilter,
        };
      });
      expect(navSurface.alpha).toBe(1);
      expect(navSurface.backdropFilter).toBe('none');
      for (const button of await navButtons.all()) {
        await expect(button).toHaveCSS('box-shadow', 'none');
      }
    }

    const calcTab = page.getByRole('tab', { name: '計算機' });
    const box = await calcTab.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await expect(calcTab).toHaveCSS('transform', 'none');
    await page.mouse.up();

    const navBox = await nav.boundingBox();
    const tabBox = await calcTab.boundingBox();
    expect(navBox).not.toBeNull();
    expect(tabBox).not.toBeNull();
    expect(navBox!.height).toBeCloseTo(36, 1);
    expect(tabBox!.y).toBeCloseTo(navBox!.y, 1);
    expect(tabBox!.y + tabBox!.height).toBeLessThanOrEqual(navBox!.y + navBox!.height);
  });

  test('サマリーの文字幅を開閉シェブロンで消費しない', async ({ page }) => {
    const summary = page.getByTestId('calc-sticky-summary');
    const body = summary.locator('.calcSticky__summaryBody');
    const toggle = summary.locator('.calcSticky__toggle');

    const [summaryBox, bodyBox] = await Promise.all([summary.boundingBox(), body.boundingBox()]);
    expect(summaryBox).not.toBeNull();
    expect(bodyBox).not.toBeNull();
    expect(bodyBox!.x).toBeCloseTo(summaryBox!.x, 1);
    expect(bodyBox!.width).toBeCloseTo(summaryBox!.width, 1);
    await expect(toggle).toHaveCSS('position', 'absolute');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('calc-shards-bar')).toBeVisible();
  });

  test('矢印・Home・Endキーでタブを切り替えられる', async ({ page }) => {
    const calcTab = page.getByRole('tab', { name: '計算機' });
    const boxTab = page.getByRole('tab', { name: 'ポケモンボックス' });

    await calcTab.focus();
    await calcTab.press('ArrowRight');
    await expect(boxTab).toBeFocused();
    await expect(page.locator('#neo-box')).toBeVisible();

    await boxTab.press('Home');
    await expect(calcTab).toBeFocused();
    await expect(page.locator('#neo-calc')).toBeVisible();

    await calcTab.press('End');
    await expect(boxTab).toBeFocused();
  });

  test('hero通過後は上部に固定し、サマリーをその下に表示する', async ({ page }) => {
    await page.locator('#neo-calc').evaluate((panel) => {
      const spacer = document.createElement('div');
      spacer.style.height = '1400px';
      panel.appendChild(spacer);
    });
    await page.evaluate(() => window.scrollTo(0, 600));

    const nav = page.locator('.mobileNav');
    const home = page.locator('.mobileNav__home');
    const calcTab = page.getByRole('tab', { name: '計算機' });
    const summary = page.getByTestId('calc-sticky-summary');
    const [navBox, homeBox, calcBox, summaryBox] = await Promise.all([
      nav.boundingBox(),
      home.boundingBox(),
      calcTab.boundingBox(),
      summary.boundingBox(),
    ]);
    expect(navBox).not.toBeNull();
    expect(homeBox).not.toBeNull();
    expect(calcBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    expect(navBox!.y).toBeCloseTo(0, 0);
    expect(homeBox!.y + homeBox!.height / 2).toBeCloseTo(
      calcBox!.y + calcBox!.height / 2,
      0,
    );
    expect(summaryBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height - 1);
  });

  test('hero表示中から選択中タブを押してもナビとパネルの間を空けない', async ({ page }) => {
    for (const selector of ['#neo-calc', '#neo-box']) {
      await page.locator(selector).evaluate((panel) => {
        const spacer = document.createElement('div');
        spacer.style.height = '1400px';
        panel.appendChild(spacer);
      });
    }

    const nav = page.locator('.mobileNav');
    const calcPanel = page.locator('#neo-calc');
    await page.getByRole('tab', { name: '計算機' }).click();

    const [navBox, calcBox] = await Promise.all([nav.boundingBox(), calcPanel.boundingBox()]);
    expect(navBox).not.toBeNull();
    expect(calcBox).not.toBeNull();
    expect(navBox!.y).toBeCloseTo(0, 0);
    expect(Math.abs(calcBox!.y - (navBox!.y + navBox!.height))).toBeLessThanOrEqual(1);

    await page.getByRole('tab', { name: 'ポケモンボックス' }).click();
    await page.getByRole('tab', { name: 'ポケモンボックス' }).click();
    const [boxNavBox, boxPanelBox] = await Promise.all([
      nav.boundingBox(),
      page.locator('#neo-box').boundingBox(),
    ]);
    expect(boxNavBox).not.toBeNull();
    expect(boxPanelBox).not.toBeNull();
    expect(Math.abs(boxPanelBox!.y - (boxNavBox!.y + boxNavBox!.height))).toBeLessThanOrEqual(1);
  });

  test('1399pxと1400pxの境界でタブ表示と2列表示を切り替える', async ({ page }) => {
    await page.setViewportSize({ width: 1399, height: 844 });
    await expect(page.locator('.mobileNav__panelTabs')).toBeVisible();
    await expect(page.locator('#neo-calc')).toBeVisible();
    await expect(page.locator('#neo-box')).toBeHidden();

    await page.setViewportSize({ width: 1400, height: 844 });
    await expect(page.locator('.mobileNav__panelTabs')).toBeHidden();
    await expect(page.locator('#neo-calc')).toBeVisible();
    await expect(page.locator('#neo-box')).toBeVisible();
    await expect(page.locator('#neo-calc')).not.toHaveAttribute('role', 'tabpanel');
    await expect(page.locator('#neo-box')).not.toHaveAttribute('role', 'tabpanel');

    await page.setViewportSize({ width: 1399, height: 844 });
    await expect(page.locator('#neo-calc')).toBeVisible();
    await expect(page.locator('#neo-box')).toBeHidden();
  });

  test('PC幅でstickyサマリーを開閉してもdocumentスクロールとBOX位置を動かさない', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 844 });
    const calcPanel = page.locator('#neo-calc');
    const boxPanel = page.locator('#neo-box');
    const toggle = page.locator('.calcSticky__toggle');

    await calcPanel.evaluate((panel) => {
      const spacer = document.createElement('div');
      spacer.style.height = '1400px';
      panel.appendChild(spacer);
    });
    await boxPanel.evaluate((panel) => {
      const spacer = document.createElement('div');
      spacer.style.height = '1400px';
      panel.appendChild(spacer);
    });
    const calcTop = await calcPanel.evaluate(
      panel => panel.getBoundingClientRect().top + window.scrollY,
    );
    await page.evaluate(y => window.scrollTo(0, y), calcTop + 240);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    const beforeOpen = await page.evaluate(() => window.scrollY);
    const boxBeforeOpen = await boxPanel.evaluate(panel => panel.getBoundingClientRect().top);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(beforeOpen, 0);
    expect(await boxPanel.evaluate(panel => panel.getBoundingClientRect().top)).toBeCloseTo(boxBeforeOpen, 0);

    const beforeClose = await page.evaluate(() => window.scrollY);
    const boxBeforeClose = await boxPanel.evaluate(panel => panel.getBoundingClientRect().top);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(beforeClose, 0);
    expect(await boxPanel.evaluate(panel => panel.getBoundingClientRect().top)).toBeCloseTo(boxBeforeClose, 0);
  });

  test('BOXから追加してもBOXを維持し、明示操作で計算機へ移れる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    await page.getByRole('tab', { name: 'ポケモンボックス' }).click();

    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();

    await expect(page.locator('#neo-box')).toBeVisible();
    await expect(page.locator('#neo-calc')).toBeHidden();
    await expect(calc.calcRows).toHaveCount(1);

    await page.getByTestId('box-detail-view-calc').click();
    await expect(page.locator('#neo-calc')).toBeVisible();
    await expect(page.locator('#neo-box')).toBeHidden();
  });

  test('上部ナビで切り替えてもパネルごとのdocument位置を復元する', async ({ page }) => {
    await page.locator('#neo-calc').evaluate((panel) => {
      const spacer = document.createElement('div');
      spacer.style.height = '1400px';
      panel.appendChild(spacer);
    });
    await page.locator('#neo-box').evaluate((panel) => {
      const spacer = document.createElement('div');
      spacer.style.height = '1400px';
      panel.appendChild(spacer);
    });

    const calcTop = await page.locator('#neo-calc').evaluate(
      panel => panel.getBoundingClientRect().top + window.scrollY,
    );
    await page.evaluate(y => window.scrollTo(0, y), calcTop + 240);
    await page.getByTestId('mobile-nav-box').click();

    const boxTop = await page.locator('#neo-box').evaluate(
      panel => panel.getBoundingClientRect().top + window.scrollY,
    );
    await page.evaluate(y => window.scrollTo(0, y), boxTop + 160);
    await page.getByTestId('mobile-nav-calc').click();

    const restoredOffset = await page.locator('#neo-calc').evaluate((panel) => {
      const documentTop = panel.getBoundingClientRect().top + window.scrollY;
      return window.scrollY - documentTop;
    });
    expect(restoredOffset).toBeCloseTo(240, 0);
  });
});
