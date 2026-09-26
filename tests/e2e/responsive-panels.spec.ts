import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { CalcPanelPage } from './pages/CalcPanelPage';
import { SettingsModalPage } from './pages/SettingsModalPage';
import { AddPokemonModalPage } from './pages/AddPokemonModalPage';

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
    await page.getByTestId('mobile-nav-calc').click();

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

    await page.getByTestId('mobile-nav-calc').click();
    await expect(page.locator('#neo-calc')).toBeVisible();
    await expect(page.locator('#neo-box')).toBeHidden();
  });

  test('計算機のヒントを開いている間にナビを押すと、切り替えずにヒントだけ閉じる', async ({ page }) => {
    const box = new BoxPanelPage(page);
    const calc = new CalcPanelPage(page);
    await page.getByRole('tab', { name: 'ポケモンボックス' }).click();
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await box.clickApplyToCalc();
    await page.getByTestId('mobile-nav-calc').click();
    await expect(calc.calcRows).toHaveCount(1);

    // ヒントは body 直下にあり、CalcPanel は v-show で隠れるだけ。ナビで切り替わると
    // ヒントだけが別パネルの上に残るので、受け口がナビも覆って押下を受け止める。
    const popover = page.getByTestId('sleep-hint-popover');
    await calc.getRowSleepTargetCurrentLink(calc.getRow(0)).click();
    await expect(popover).toBeVisible();
    const nav = (await page.getByTestId('mobile-nav-box').boundingBox())!;
    await page.mouse.click(nav.x + nav.width / 2, nav.y + nav.height / 2);
    await expect(popover).toHaveCount(0);
    await expect(page.locator('#neo-calc')).toBeVisible();
    await expect(page.locator('#neo-box')).toBeHidden();
  });

  test('ボックスのヒントも計算機と同じく、スクロールし始めたら閉じ、開いている間は対象に付いて動く', async ({ page }) => {
    const box = new BoxPanelPage(page);
    await page.getByRole('tab', { name: 'ポケモンボックス' }).click();
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    await page.getByTestId('box-detail-sleep-calc-toggle').click();
    const hintButton = page.getByTestId('box-sleep-daily-hint');
    const popover = page.getByTestId('box-hint-popover');

    // ページ座標で置くので、ページがスクロールしても対象との位置関係は変わらない（画面に残らない）
    await hintButton.tap();
    await expect(popover).toBeVisible();
    // 開いた直後は仮の位置（top: 0）で、大きさを測ってから対象の近くへ置く。置き終わってから測る
    await expect(popover).not.toHaveAttribute('style', /top: 0px/);
    // ヒントと対象は同じ瞬間に測る（別々に測ると、その間のスクロールでずれる）
    const gap = () => page.evaluate(() => {
      const hint = document.querySelector('[data-testid="box-hint-popover"]')!.getBoundingClientRect();
      const button = document.querySelector('[data-testid="box-sleep-daily-hint"]')!.getBoundingClientRect();
      return hint.top - button.top;
    });
    const gapBefore = await gap();
    await page.evaluate(() => window.scrollBy(0, 40));
    expect(Math.abs((await gap()) - gapBefore)).toBeLessThan(1);

    const drag = (dy: number) => page.evaluate((dy) => {
      const touch = (y: number) => new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
      window.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(300)] }));
      window.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(300 - dy)] }));
    }, dy);
    await drag(5);
    await expect(popover).toBeVisible();
    await drag(15);
    await expect(popover).toHaveCount(0);

    await hintButton.tap();
    await expect(popover).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 })));
    await expect(popover).toHaveCount(0);
  });

  test('Pointer Events が無い端末（iOS 12 など）でも、タイルの長押しで計算機への追加・削除を切り替える', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as { PointerEvent?: unknown }).PointerEvent;
    });
    await page.reload();
    const box = new BoxPanelPage(page);
    await page.getByRole('tab', { name: 'ポケモンボックス' }).click();
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    const tile = box.boxTiles.first();
    const mark = tile.locator('.boxTile__calcMark');

    // iOS 12 と同じく pointer のイベントを出さず、touch だけを送る
    const touch = (type: string, dy = 0) => tile.evaluate((element, [type, dy]) => {
      const rect = element.getBoundingClientRect();
      const point = new Touch({ identifier: 3, target: element, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 + (dy as number) });
      const active = type === 'touchend' || type === 'touchcancel' ? [] : [point];
      element.dispatchEvent(new TouchEvent(type as string, { bubbles: true, cancelable: true, touches: active, targetTouches: active, changedTouches: [point] }));
    }, [type, dy] as const);

    // スクロール相当の移動は長押しとして扱わない
    await touch('touchstart');
    await touch('touchmove', 20);
    await page.waitForTimeout(350);
    await touch('touchend', 20);
    await expect(mark).toHaveCount(0);

    // 長押しで追加。離した後に iOS が合成する click では詳細を開かない
    await touch('touchstart');
    await expect(tile.locator('..')).toHaveClass(/boxTile--pressing/);
    await page.waitForTimeout(350);
    await touch('touchend');
    await expect(mark).toBeVisible();
    await tile.dispatchEvent('click');
    await expect(box.detailPanel).toHaveCount(0);

    // 指を離した直後に iOS が合成する mousedown は、押し続けても長押しにしない（二重に切り替わらない）
    await tile.dispatchEvent('mousedown', { button: 0 });
    await page.waitForTimeout(350);
    await tile.dispatchEvent('mouseup', { button: 0 });
    await expect(mark).toBeVisible();

    // もう一度長押しで削除
    await page.waitForTimeout(600);
    await touch('touchstart');
    await page.waitForTimeout(350);
    await touch('touchend');
    await expect(mark).toHaveCount(0);

    // 途中で取り消された（touchcancel）押し込みは長押しにしない
    await touch('touchstart');
    await touch('touchcancel');
    await page.waitForTimeout(350);
    await expect(mark).toHaveCount(0);
    await expect(tile.locator('..')).not.toHaveClass(/boxTile--pressing/);
  });

  test('Pointer Events が無い端末（iOS 12 など）でも、スロットタブを指でドラッグして並べ替えられる', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as { PointerEvent?: unknown }).PointerEvent;
    });
    await page.reload();
    const calc = new CalcPanelPage(page);
    await calc.clickSlotTab(1);
    await calc.setBoostKind('full');
    await calc.clickSlotTab(0);
    const second = (await calc.slotTabs.nth(1).textContent())!.trim();
    const third = (await calc.slotTabs.nth(2).textContent())!.trim();
    expect(second).not.toBe(third);

    const to = (await calc.slotTabs.nth(2).boundingBox())!;
    // iOS 12 と同じく pointer のイベントを出さず、touch だけを送る（touch のイベントは指を置いたタブに届き続ける）
    await calc.slotTabs.nth(1).evaluate((element, toX) => {
      const rect = element.getBoundingClientRect();
      const y = rect.top + rect.height / 2;
      const at = (x: number) => new Touch({ identifier: 5, target: element, clientX: x, clientY: y });
      const send = (type: string, touch: Touch, active: Touch[]) => element.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, touches: active, targetTouches: active, changedTouches: [touch],
      }));
      const start = at(rect.left + rect.width / 2);
      send('touchstart', start, [start]);
      const middle = at(rect.left + rect.width / 2 + 20);
      send('touchmove', middle, [middle]);
      const end = at(toX);
      send('touchmove', end, [end]);
      send('touchend', end, []);
    }, to.x + to.width / 2);
    await expect(calc.slotTabs.nth(1)).toHaveText(third);
    await expect(calc.slotTabs.nth(2)).toHaveText(second);
    await expect(calc.slotTabs.nth(0)).toHaveAttribute('data-testid', 'calc-slot-tab-active');
  });

  test('iOS では小さい文字の選択欄（テーマ・スロットタブ）のフォーカスで拡大しないよう、viewport に maximum-scale=1 を足す', async ({ page }) => {
    // この project は iPhone の UA（devices['iPhone 13']）
    expect(await page.evaluate(() => navigator.userAgent)).toMatch(/iPhone/);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1');
  });

  test('一番下までスクロールしても、最後のボタンは Safari がツールバーを出すのに使う下端の帯（約 64px）に入らない', async ({ page }) => {
    const modal = new AddPokemonModalPage(page);
    await modal.open();
    await modal.fillAndPickName('ピカ');
    await modal.submitButton.click();
    await modal.close();
    const addButton = page.getByTestId('calc-add-pokemon-btn');
    await expect(addButton).toBeVisible();
    // 閉じた直後はアプリがスクロール位置を戻すので、一番下へのスクロールと測定を同じ瞬間に行い、落ち着くまで繰り返す
    await expect.poll(() => addButton.evaluate((element) => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return window.innerHeight - element.getBoundingClientRect().bottom;
    })).toBeGreaterThanOrEqual(64);
  });

  test('性格補正のドロップダウンは、外側を押すか、スクロールしようとすると閉じる（Safari はボタンにフォーカスを入れない）', async ({ page }) => {
    // Safari と同じく、ボタンを押してもフォーカスが入らない（blur が起きない）ようにする
    await page.evaluate(() => {
      document.addEventListener('mousedown', (ev) => {
        if (ev.target instanceof Element && ev.target.closest('button')) ev.preventDefault();
      }, true);
    });
    const box = new BoxPanelPage(page);
    await page.getByRole('tab', { name: 'ポケモンボックス' }).click();
    await box.openImportPanel();
    await box.fillImportText(testConfig.importData.singlePokemon);
    await box.clickImport();
    await box.selectBoxTile(0);
    const dropdown = page.getByTestId('nature-select-dropdown');

    await box.detailNatureTrigger.tap();
    await expect(dropdown).toBeVisible();
    await page.locator('.boxDetail__title').tap();
    await expect(dropdown).toHaveCount(0);

    // トリガーをもう一度押すと閉じる
    await box.detailNatureTrigger.tap();
    await expect(dropdown).toBeVisible();
    await box.detailNatureTrigger.tap();
    await expect(dropdown).toHaveCount(0);

    await box.detailNatureTrigger.tap();
    await expect(dropdown).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 })));
    await expect(dropdown).toHaveCount(0);

    // 選べば閉じて値が変わる
    await box.detailNatureTrigger.tap();
    await dropdown.getByTestId('nature-select-option').nth(1).dispatchEvent('mousedown');
    await expect(dropdown).toHaveCount(0);
  });

  test.describe('タッチ端末のテンキー', () => {
    test.beforeEach(async ({ page }) => {
      const box = new BoxPanelPage(page);
      const calc = new CalcPanelPage(page);
      await page.getByRole('tab', { name: 'ポケモンボックス' }).click();
      await box.openImportPanel();
      await box.fillImportText(testConfig.importData.singlePokemon);
      await box.clickImport();
      await box.selectBoxTile(0);
      await box.clickApplyToCalc();
      await page.getByTestId('mobile-nav-calc').click();
      await expect(calc.calcRows).toHaveCount(1);
    });

    test('preventScroll が効かない端末（iOS 14 以前）でも、欄を押してページがスクロールしない', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const input = calc.getRowCandyTargetInput(calc.getRow(0));
      // 古い iOS と同じく、focus の指定（preventScroll）を読まずに欄が見える位置までスクロールする focus にする。
      // 対応の確認はアプリの読み込み時に行うので、差し替えてから読み直す（計算機の行は保存から戻る）
      await page.addInitScript(() => {
        const nativeFocus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function focusIgnoringOptions(this: HTMLElement) {
          nativeFocus.call(this);
        };
      });
      await page.reload();
      await expect(calc.calcRows).toHaveCount(1);
      await page.getByTestId('mobile-nav-calc').click();
      // 欄が画面の下の外にある状態で押す（そのままの focus なら欄が見えるまでスクロールする）
      await page.evaluate(() => {
        const field = document.querySelector('[data-testid="calc-row"] [data-testid="candyTarget"]') as HTMLElement;
        window.scrollTo(0, 0);
        const below = field.getBoundingClientRect().top - window.innerHeight;
        if (below < 50) document.body.style.paddingTop = `${50 - below}px`;
      });
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await input.dispatchEvent('click');
      await expect(page.getByTestId('numeric-keypad')).toBeVisible();
      await expect(input).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    });

    test('入力補助バーなどで見えている範囲が縮んだら、確定ボタンが見える位置へ置き直す', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const input = calc.getRowCandyTargetInput(calc.getRow(0));
      // iOS は欄のフォーカスの後に入力補助バーを出し、visualViewport だけが縮む（window.innerHeight は変わらない）
      await page.evaluate(() => {
        const fake = new EventTarget() as EventTarget & { width: number; height: number; offsetLeft: number; offsetTop: number };
        Object.assign(fake, { width: window.innerWidth, height: window.innerHeight, offsetLeft: 0, offsetTop: 0 });
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
      });
      await input.tap();
      const keypad = page.getByTestId('numeric-keypad');
      await expect(keypad).toBeVisible();

      const visibleBottom = await page.evaluate(() => {
        const viewport = window.visualViewport as unknown as EventTarget & { height: number };
        viewport.height = window.innerHeight - 150;
        viewport.dispatchEvent(new Event('resize'));
        return viewport.height;
      });
      await expect.poll(async () => (await page.getByTestId('numeric-keypad-confirm').boundingBox())!.y
        + (await page.getByTestId('numeric-keypad-confirm').boundingBox())!.height).toBeLessThanOrEqual(visibleBottom);
    });

    test('OSのキーボードを出さず、テンキーで打った値を確定で保存する', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const input = calc.getRowCandyTargetInput(calc.getRow(0));
      const keypad = page.getByTestId('numeric-keypad');

      // readonly なら OS のキーボードは出ない（iOS はキーボード表示でページをスクロールする）
      await expect(input).toHaveJSProperty('readOnly', true);
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await input.tap();
      await expect(keypad).toBeVisible();
      await expect(keypad).toContainText('アメ個数指定');
      for (const key of ['1', '0', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await expect(page.getByTestId('numeric-keypad-display')).toHaveText('100');
      // キーを押しても入力欄のフォーカスは外れない（外れると1桁ごとに確定する）
      await expect(input).toBeFocused();

      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(keypad).toHaveCount(0);
      await expect(input).not.toBeFocused();
      await expect(input).toHaveValue('100');
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    });

    test('アメブ個数は C の位置がリセットで、自動計算へ戻せる', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const input = calc.getRow(0).getByTestId('boostCandyCount');
      const keypad = page.getByTestId('numeric-keypad');

      const display = page.getByTestId('numeric-keypad-display');
      const placeholder = page.getByTestId('numeric-keypad-placeholder');

      // 追加時はアメブ枠が足りず残数が確定している。目標Lvを下げ、枠に収まる自動計算の状態にする
      const src = Number(await calc.getRowSrcLevelInput(calc.getRow(0)).inputValue());
      await calc.getRowDstLevelInput(calc.getRow(0)).tap();
      for (const key of String(src + 1)) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await calc.getRow(0).getByTestId('boostCandyReset').click();
      await expect(input).toHaveValue('');
      const auto = (await input.getAttribute('placeholder'))!;
      expect(Number(auto)).toBeGreaterThan(0);

      // 未入力の欄では、自動計算の値を表示欄に薄く出す
      await input.tap();
      await expect(page.getByTestId('numeric-keypad-clear')).toHaveCount(0);
      await expect(placeholder).toHaveText(auto);
      await page.getByTestId('numeric-keypad-key-5').tap();
      await expect(placeholder).toHaveCount(0);
      await expect(display).toHaveText('5');
      await expect(page.getByTestId('numeric-keypad-auto-chip')).toHaveCount(0);
      // 打ってから消した空欄にも出す（空欄で確定すると自動計算へ戻る）。「自動」の札と、リセット直後と同じ下地
      await expect(display).not.toHaveClass(/numKeypad__display--fresh/);
      await page.getByTestId('numeric-keypad-backspace').tap();
      await expect(placeholder).toHaveText(auto);
      await expect(page.getByTestId('numeric-keypad-auto-chip')).toHaveText('自動');
      await expect(display).toHaveClass(/numKeypad__display--fresh/);
      await page.getByTestId('numeric-keypad-key-5').tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(input).toHaveValue('5');

      // 入力済みの欄では出さない。リセットは打ちかけの値を確定せず、自動計算へ戻す
      await input.tap();
      await expect(placeholder).toHaveCount(0);
      await page.getByTestId('numeric-keypad-key-7').tap();
      await page.getByTestId('numeric-keypad-reset').tap();
      // テンキーは閉じず、リセット後の値（未入力＝自動計算の値を薄く）を出す
      await expect(keypad).toBeVisible();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('');
      await expect(input).toHaveAttribute('placeholder', auto);
      await expect(placeholder).toHaveText(auto);
      await expect(page.getByTestId('numeric-keypad-auto-chip')).toBeVisible();
      await expect(display).toHaveClass(/numKeypad__display--fresh/);
      // リセットは確定した操作なので、閉じるで打つ前の 5 へ戻らない
      await page.getByTestId('numeric-keypad-close').tap();
      await expect(keypad).toHaveCount(0);
      await expect(input).toHaveValue('');

      // リセットのあとも続けて打てる
      await input.tap();
      await page.getByTestId('numeric-keypad-key-7').tap();
      await page.getByTestId('numeric-keypad-reset').tap();
      await expect(placeholder).toHaveText(auto);
      await page.getByTestId('numeric-keypad-key-8').tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(input).toHaveValue('8');

      // 消して確定しても自動計算へ戻る（0 にはならない）
      await input.tap();
      await page.getByTestId('numeric-keypad-backspace').tap();
      await expect(placeholder).toHaveText(auto);
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(input).toHaveValue('');
      await expect(input).toHaveAttribute('placeholder', auto);
    });

    test('テンキーの外のボタンを押しても閉じるだけで、ほかの入力欄は直接開き直す', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const row = calc.getRow(0);
      const keypad = page.getByTestId('numeric-keypad');

      // ほかの入力欄を押すと、そちらのテンキーがそのまま開く
      await calc.getRowCandyTargetInput(row).tap();
      await expect(keypad).toContainText('アメ個数指定');
      await row.getByTestId('boostCandyCount').tap();
      await expect(keypad).toContainText('アメブ個数');
      await expect(row.getByTestId('boostCandyCount')).toBeFocused();
      await page.getByTestId('numeric-keypad-close').tap();

      // 縁から見えている削除ボタンを押しても、テンキーが閉じるだけで行は消えない
      await calc.getRowCandyTargetInput(row).tap();
      await expect(keypad).toBeVisible();
      await calc.getRowDeleteButton(row).tap();
      await expect(keypad).toHaveCount(0);
      await expect(calc.calcRows).toHaveCount(1);

      // 捨てるのはその指の click だけ。次のタップは効く（削除は確認なしなので、ヒントの ? で確かめる）
      await row.getByTestId('hintBtn').first().tap();
      await expect(page.getByTestId('calc-hint-popover')).toBeVisible();
      await page.getByTestId('calc-hint-overlay').tap({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('calc-hint-popover')).toHaveCount(0);

      // 選択欄（テーマ）も入力欄として通す。捨てると1回目がテンキーを閉じるだけになり、2回押す必要がある
      const themeSelect = page.locator('.design-switch-select');
      await page.evaluate(() => {
        const w = window as unknown as { __themeClicks: number };
        w.__themeClicks = 0;
        document.querySelector('.design-switch-select')!.addEventListener('click', () => { w.__themeClicks++; });
      });
      await calc.getRowCandyTargetInput(row).tap();
      await expect(keypad).toBeVisible();
      await themeSelect.tap();
      await expect(keypad).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __themeClicks: number }).__themeClicks)).toBe(1);
    });

    test('アメブ個数の ? のアメブ上限も、規定値を「デフォルト」の札付きで薄く出す', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const field = calc.getRow(0).locator('.field', { has: page.getByTestId('boostCandyCount') });
      await field.getByTestId('hintBtn').tap();
      const input = page.getByTestId('calc-hint-boost-remaining-input');
      const remainingDefault = (await input.getAttribute('placeholder'))!;
      expect(remainingDefault).not.toBe('');
      await input.tap();
      await expect(page.getByTestId('numeric-keypad-auto-chip')).toHaveText('デフォルト');
      await expect(page.getByTestId('numeric-keypad-placeholder')).toHaveText(remainingDefault);
      await expect(page.getByTestId('numeric-keypad-reset')).toHaveCount(0);
    });

    test('押したときのフォーカスはスクロールなしで入れる', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const input = calc.getRowCandyTargetInput(calc.getRow(0));
      await input.scrollIntoViewIfNeeded();

      // iOS は readonly の欄でも、ブラウザ任せのフォーカスではキーボードがある前提でページを動かす。
      // mousedown の既定動作（フォーカス移動）を止め、preventScroll 付きで入れ直していること
      await page.evaluate(() => {
        const w = window as unknown as { __focusCalls: unknown[]; __mousedownPrevented: boolean[] };
        w.__focusCalls = [];
        w.__mousedownPrevented = [];
        const original = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function (options?: FocusOptions) {
          w.__focusCalls.push(options ?? null);
          return original.call(this, options);
        };
        document.addEventListener('mousedown', (ev) => {
          setTimeout(() => w.__mousedownPrevented.push(ev.defaultPrevented));
        });
      });
      await input.tap();
      await expect(page.getByTestId('numeric-keypad')).toBeVisible();
      await expect(input).toBeFocused();
      const { focusCalls, prevented } = await page.evaluate(() => {
        const w = window as unknown as { __focusCalls: unknown[]; __mousedownPrevented: boolean[] };
        return { focusCalls: w.__focusCalls, prevented: w.__mousedownPrevented };
      });
      expect(prevented).toEqual([true]);
      expect(focusCalls).toEqual([{ preventScroll: true }]);
    });

    test('最初の数字で置き換え、閉じるで元の値に戻す', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const trigger = calc.getRow(0).getByTestId('srcLevel').getByTestId('level-picker-trigger');
      const before = await trigger.inputValue();
      expect(before).not.toBe('');

      await trigger.tap();
      await page.getByTestId('numeric-keypad-key-3').tap();
      await expect(page.getByTestId('numeric-keypad-display')).toHaveText('3');
      await page.getByTestId('numeric-keypad-backspace').tap();
      await expect(page.getByTestId('numeric-keypad-display')).toHaveText('');
      await page.getByTestId('numeric-keypad-close').tap();
      await expect(page.getByTestId('numeric-keypad')).toHaveCount(0);
      await expect(trigger).toHaveValue(before);

      // レベルピッカーの欄も確定で反映される
      await trigger.tap();
      for (const key of ['3', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(trigger).toHaveValue('30');
    });

    test('ヒント内の欄もテンキーで打て、外側を押すと確定してヒントが閉じる', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const link = calc.getRowSleepTargetCurrentLink(calc.getRow(0));
      await link.click();
      const input = page.getByTestId('sleep-hint-hours-input');
      await input.tap();
      // 上下どちらにも収まらない位置でも、確定ボタンまで画面内に出す。下端の 64px は空ける
      // （iOS Safari は縮んだツールバー付近のタップをツールバー展開に使い、一度で押せない）
      const pad = await page.getByTestId('numeric-keypad').boundingBox();
      expect(pad!.y + pad!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 64);
      // テンキーを押してもヒントは閉じない（テンキーはヒントの外の body 直下にある）
      for (const key of ['1', '2', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await expect(page.getByTestId('sleep-hint-popover')).toBeVisible();
      await expect(input).toHaveValue('120');

      // 外側を押して閉じても、テンキーで書いた値が確定されること
      await page.getByTestId('sleep-hint-overlay').tap({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('numeric-keypad')).toHaveCount(0);
      await expect(page.getByTestId('sleep-hint-popover')).toHaveCount(0);
      await expect(link).toContainText('120');
    });

    test('最小アメブ計算の目標Lvもテンキーで入力できる', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const row = calc.getRow(0);
      const candyTarget = calc.getRowCandyTargetInput(row);
      await candyTarget.tap();
      for (const key of ['1', '0', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();

      await row.getByTestId('candyTargetHintBtn').click();
      const trigger = page.getByTestId('candy-target-min-boost-level').getByTestId('level-picker-trigger');
      await trigger.tap();
      await expect(page.getByTestId('numeric-keypad')).toContainText('目標Lv');
      // 下限は現在Lvの1つ上。それより小さい値は下限へ丸める（レベルピッカーと同じ）
      const min = Number(await calc.getRow(0).getByTestId('srcLevel').getByTestId('level-picker-trigger').inputValue()) + 1;
      await page.getByTestId('numeric-keypad-key-1').tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(trigger).toHaveValue(String(min));

      await trigger.tap();
      for (const key of ['7', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(trigger).toHaveValue('70');
      await expect(page.getByTestId('calc-hint-popover')).toBeVisible();
    });

    test('最小アメブ計算の目標Lvはスライダーを指で動かしても、ピッカーとヒントが閉じない', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      const row = calc.getRow(0);
      const candyTarget = calc.getRowCandyTargetInput(row);
      await candyTarget.tap();
      for (const key of ['1', '0', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();

      await row.getByTestId('candyTargetHintBtn').click();
      const picker = page.getByTestId('candy-target-min-boost-level');
      await picker.getByTestId('level-picker-chevron').tap();
      const range = picker.locator('input[type="range"]');
      await expect(range).toBeVisible();

      // つまみを横へ 40px 動かす（スクロールで閉じるしきい値 10px を超える）
      await range.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        const at = (x: number) => new Touch({ identifier: 9, target: element, clientX: x, clientY: y });
        const send = (type: string, touch: Touch, active: Touch[]) => element.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true, touches: active, targetTouches: active, changedTouches: [touch],
        }));
        const start = at(rect.left + rect.width / 2);
        send('touchstart', start, [start]);
        const moved = at(rect.left + rect.width / 2 + 40);
        send('touchmove', moved, [moved]);
        send('touchend', moved, []);
      });
      await expect(range).toBeVisible();
      await expect(page.getByTestId('calc-hint-popover')).toBeVisible();

      // 対照: スライダーの外で同じだけ動かすとスクロールとみなして閉じる
      await page.evaluate(() => {
        const touch = (y: number) => new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
        window.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(300)] }));
        window.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(260)] }));
      });
      await expect(page.getByTestId('calc-hint-popover')).toHaveCount(0);
    });

    test('ヒントは指でスクロールし始めたら閉じ、テンキーで打っていた値は確定する', async ({ page }) => {
      const calc = new CalcPanelPage(page);
      await page.locator('#neo-calc').evaluate((panel) => {
        const spacer = document.createElement('div');
        spacer.style.height = '1400px';
        panel.appendChild(spacer);
      });
      const link = calc.getRowSleepTargetCurrentLink(calc.getRow(0));
      await link.click();
      await page.getByTestId('sleep-hint-hours-input').tap();
      for (const key of ['4', '5']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();

      // Playwright は指のスクロールを再現できないので、touchstart / touchmove を直接送る。
      // scroll を待たず、指が動いた時点で閉じる（テンキーと同じくらい早く消す）
      const drag = (dy: number) => page.evaluate((dy) => {
        const touch = (y: number) => new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
        window.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(300)] }));
        window.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(300 - dy)] }));
      }, dy);

      // タップの揺れ程度では閉じない
      await drag(5);
      await expect(page.getByTestId('sleep-hint-popover')).toBeVisible();

      await drag(15);
      await expect(page.getByTestId('sleep-hint-popover')).toHaveCount(0);
      await expect(page.getByTestId('numeric-keypad')).toHaveCount(0);
      await expect(link).toContainText('45');

      // 指を離したときの click は、受け口の消えた後ろへ届かない。
      // 次に指が触れたら解除し、次の操作のタップは捨てない
      const reached = await page.evaluate(() => {
        let count = 0;
        const button = document.querySelector<HTMLElement>('[data-testid="candyTargetHintBtn"]')!;
        const onClick = (ev: Event) => { count++; ev.stopPropagation(); };
        button.addEventListener('click', onClick);
        button.click();
        const afterDrag = count;
        const touch = new Touch({ identifier: 2, target: document.body, clientX: 10, clientY: 10 });
        document.dispatchEvent(new TouchEvent('touchstart', { touches: [touch] }));
        button.click();
        button.removeEventListener('click', onClick);
        return { afterDrag, nextTap: count - afterDrag };
      });
      expect(reached).toEqual({ afterDrag: 0, nextTap: 1 });
    });
  });

  test.describe('ボックスのテンキー', () => {
    test.beforeEach(async ({ page }) => {
      const box = new BoxPanelPage(page);
      await page.getByRole('tab', { name: 'ポケモンボックス' }).click();
      await box.openImportPanel();
      await box.fillImportText(testConfig.importData.singlePokemon);
      await box.clickImport();
      await box.selectBoxTile(0);
    });

    test('詳細の数値欄をテンキーで入力できる', async ({ page }) => {
      const keypad = page.getByTestId('numeric-keypad');
      const exp = page.getByTestId('box-detail-exp-remaining-input');
      await expect(exp).toHaveJSProperty('readOnly', true);
      await exp.tap();
      await expect(keypad).toContainText('あとEXP');
      for (const key of ['1', '2', '3']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(keypad).toHaveCount(0);
      await expect(exp).toHaveValue('123');

      const sleepHours = page.getByTestId('box-detail-sleep-hours-input');
      await sleepHours.tap();
      await expect(keypad).toContainText('累計睡眠時間');
      for (const key of ['3', '0', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(sleepHours).toHaveValue('300');

      // レベルピッカーもテンキー
      const level = page.getByTestId('box-detail-panel').getByTestId('level-picker-trigger');
      await level.tap();
      for (const key of ['4', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(level).toHaveValue('40');
    });

    test('1日の睡眠時間は小数点を打てる', async ({ page }) => {
      await page.getByTestId('box-detail-sleep-calc-toggle').click();
      const daily = page.getByTestId('box-sleep-daily-input');
      await daily.tap();
      const keypad = page.getByTestId('numeric-keypad');
      await expect(keypad).toContainText('1日の睡眠時間');
      // 小数の欄では C の位置が小数点になり、クリアは上部に移る
      await expect(page.getByTestId('numeric-keypad-decimal')).toBeVisible();
      await page.getByTestId('numeric-keypad-clear').tap();
      await page.getByTestId('numeric-keypad-key-7').tap();
      await page.getByTestId('numeric-keypad-decimal').tap();
      // 打ちかけの小数点はテンキーの表示だけに出す（type=number は「7.」を空欄として扱う）
      await expect(page.getByTestId('numeric-keypad-display')).toHaveText('7.');
      await expect(daily).toHaveValue('7');
      await page.getByTestId('numeric-keypad-decimal').tap(); // 2つ目は無視
      await page.getByTestId('numeric-keypad-key-5').tap();
      await expect(page.getByTestId('numeric-keypad-display')).toHaveText('7.5');
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(daily).toHaveValue('7.5');

      // 整数の欄には小数点キーを出さない
      await page.getByTestId('box-detail-exp-remaining-input').tap();
      await expect(page.getByTestId('numeric-keypad-decimal')).toHaveCount(0);
      await expect(page.getByTestId('numeric-keypad-clear')).toHaveText('C');
    });

    test('追加パネルの数値欄もテンキーで入力できる', async ({ page }) => {
      const box = new BoxPanelPage(page);
      await box.openAddNewPanel();
      const candy = page.getByTestId('box-add-species-candy');
      await expect(candy).toHaveJSProperty('readOnly', true);
      await candy.tap();
      for (const key of ['5', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(candy).toHaveValue('50');
    });
  });

  test.describe('モーダルのテンキー', () => {
    /** テンキーがモーダルより手前に出て、押せること */
    async function expectKeypadOnTop(page: import('@playwright/test').Page) {
      const pad = (await page.getByTestId('numeric-keypad').boundingBox())!;
      const onTop = await page.evaluate(
        ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.numKeypad')),
        [pad.x + pad.width / 2, pad.y + pad.height / 2],
      );
      expect(onTop).toBe(true);
    }

    test('設定のヒントも指でスクロールし始めたら閉じる（計算機と同じ）', async ({ page }) => {
      const settings = new SettingsModalPage(page);
      await settings.openSettingsFromMobile();
      await settings.growthIncenseNormalHintButton.tap();
      await expect(settings.hintPopover).toBeVisible();

      // Playwright は指のスクロールを再現できないので、touchstart / touchmove を直接送る
      const drag = (dy: number) => page.evaluate((dy) => {
        const touch = (y: number) => new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
        window.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(300)] }));
        window.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(300 - dy)] }));
      }, dy);

      // タップの揺れ程度では閉じない
      await drag(5);
      await expect(settings.hintPopover).toBeVisible();
      await drag(15);
      await expect(settings.hintPopover).toHaveCount(0);
      await expect(settings.modal).toBeVisible();

      // ホイールでも閉じる
      await settings.growthIncenseNormalHintButton.tap();
      await expect(settings.hintPopover).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 })));
      await expect(settings.hintPopover).toHaveCount(0);

      // 受け口の面で覆わない。指はモーダルの中身に触れるので、そのままスクロールできる
      await settings.growthIncenseNormalHintButton.tap();
      await expect(settings.hintPopover).toBeVisible();
      // チップもスクロールする中身の中に置く。外に置くと、iOS ではチップの上から指を動かしても
      // 中身がスクロールしない（Chromium は触れた瞬間に閉じたチップの下をスクロールするので、スワイプでは拾えない）
      const hb = (await settings.hintPopover.boundingBox())!;
      const onPopover = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return { popover: Boolean(el?.closest('[data-testid="settings-hint-popover"]')), inBody: Boolean(el?.closest('.modal__body')) };
      }, [hb.x + hb.width / 2, hb.y + hb.height / 2]);
      expect(onPopover).toEqual({ popover: true, inBody: true });
      const box = (await settings.universalCandySInput.boundingBox())!;
      const underFinger = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return { inModal: Boolean(el?.closest('.modal')), overlay: Boolean(el?.closest('.hintOverlay')) };
      }, [box.x + box.width / 2, box.y + box.height / 2]);
      expect(underFinger).toEqual({ inModal: true, overlay: false });

      // 外側のタップは閉じるだけ。後ろの欄（テンキー）も背景（設定を閉じる）も反応しない
      await settings.universalCandySInput.tap();
      await expect(settings.hintPopover).toHaveCount(0);
      await expect(page.getByTestId('numeric-keypad')).toHaveCount(0);
      await expect(settings.modal).toBeVisible();

      // ほかの「?」は1回で開く。開いている「?」をもう一度押すと閉じる。
      // 隣の「?」はチップに隠れることがあるので、離れた「?」へ移る
      await settings.growthIncenseNormalHintButton.tap();
      await expect(settings.hintPopover).toBeVisible();
      await settings.projectedEventsHintButton.tap();
      await expect(settings.hintPopover).toBeVisible();
      await expect(settings.projectedEventsHintButton).toHaveAttribute('aria-expanded', 'true');
      await settings.projectedEventsHintButton.tap();
      await expect(settings.hintPopover).toHaveCount(0);
    });

    test('設定のヒントを開いたまま指でスクロールすると、ヒントが閉じて設定がそのままスクロールする', async ({ page }) => {
      const settings = new SettingsModalPage(page);
      await settings.openSettingsFromMobile();
      const body = page.locator('.settings-overlay .modal__body').first();
      const scrollTop = () => body.evaluate((el) => el.scrollTop);
      const cdp = await page.context().newCDPSession(page);
      // 本物の指のスクロール（CDP のタッチ入力）。TouchEvent を JS で送ってもスクロールはしない。
      // 注意: この後の Playwright の tap は click にならないので、スワイプは各場面の最後に置く
      const swipe = async (x: number, startY: number) => {
        let y = startY;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let i = 0; i < 10; i++) {
          y -= 20;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };

      // 受け口の面があると、指はその面に触れて中身がスクロールしない（ヒントが消えるだけになる）
      await settings.growthIncenseNormalHintButton.tap();
      await expect(settings.hintPopover).toBeVisible();
      const b = (await body.boundingBox())!;
      await swipe(b.x + 40, b.y + b.height * 0.6);
      await expect(settings.hintPopover).toHaveCount(0);
      await expect.poll(scrollTop).toBeGreaterThan(100);
      await expect(settings.modal).toBeVisible();
    });

        test('設定の数値欄をテンキーで入力できる', async ({ page }) => {
      const settings = new SettingsModalPage(page);
      await settings.openSettingsFromMobile();

      // 空欄が規定値を表す欄は、規定値を「デフォルト」の札付きで薄く出す。リセットキーは付けない（C のまま）。
      // 消して確定すると規定値へ戻る
      const autoChip = page.getByTestId('numeric-keypad-auto-chip');
      const placeholder = page.getByTestId('numeric-keypad-placeholder');
      const remainingDefault = (await settings.boostCandyRemainingInput.getAttribute('placeholder'))!;
      await settings.boostCandyRemainingInput.tap();
      await expect(autoChip).toHaveText('デフォルト');
      await expect(placeholder).toHaveText(remainingDefault);
      await expect(page.getByTestId('numeric-keypad-reset')).toHaveCount(0);
      await expect(page.getByTestId('numeric-keypad-clear')).toHaveText('C');
      for (const key of ['7', '0', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await expect(autoChip).toHaveCount(0);
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(settings.boostCandyRemainingInput).toHaveValue('700');
      await settings.boostCandyRemainingInput.tap();
      await expect(autoChip).toHaveCount(0);
      await page.getByTestId('numeric-keypad-clear').tap();
      await expect(placeholder).toHaveText(remainingDefault);
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(settings.boostCandyRemainingInput).toHaveValue('');

      await settings.defaultBoostReachLevelInput.tap();
      await expect(autoChip).toHaveText('デフォルト');
      await expect(placeholder).toHaveText('目標Lvと同じ');
      await page.getByTestId('numeric-keypad-close').tap();

      await expect(settings.universalCandySInput).toHaveJSProperty('readOnly', true);
      await settings.universalCandySInput.tap();
      await expectKeypadOnTop(page);
      // 規定値の無い欄には札を出さない
      await expect(autoChip).toHaveCount(0);
      for (const key of ['1', '2']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(settings.universalCandySInput).toHaveValue('12');

      // かけら在庫は桁区切りで表示する（テンキーの表示欄も入力欄も）
      await settings.totalShardsInput.tap();
      for (const key of '12345678') await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await expect(page.getByTestId('numeric-keypad-display')).toHaveText('12,345,678');
      await expect(settings.totalShardsInput).toHaveValue('12,345,678');
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(settings.totalShardsInput).toHaveValue('12,345,678');

      // 1日の睡眠時間は 0.5 刻みなので小数点を出す
      await settings.dailySleepHoursInput.tap();
      await page.getByTestId('numeric-keypad-clear').tap();
      for (const key of ['8', 'decimal', '5']) {
        await page.getByTestId(key === 'decimal' ? 'numeric-keypad-decimal' : `numeric-keypad-key-${key}`).tap();
      }
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(settings.dailySleepHoursInput).toHaveValue('8.5');

      // 手入力イベントの開始日は YYYYMMDD の 8 桁（テンキー既定の 7 桁ではなく maxlength に従う）
      await page.getByTestId('settings-manual-event-add').click();
      const from = page.getByTestId('settings-manual-event-from').last();
      await from.tap();
      // 入力欄の maxlength は区切り付きの貼り付け用に 10。テンキーは数字だけなので 8 桁で止める
      for (const key of '202610011') await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await expect(page.getByTestId('numeric-keypad-display')).toHaveText('20261001');
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(page.getByTestId('numeric-keypad')).toHaveCount(0);
      await expect(settings.modal).toBeVisible();
    });

    test('ポケモン追加の数値欄をテンキーで入力できる', async ({ page }) => {
      const addModal = new AddPokemonModalPage(page);
      await addModal.open();

      await addModal.speciesCandyInput.tap();
      await expectKeypadOnTop(page);
      for (const key of ['3', '0']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(addModal.speciesCandyInput).toHaveValue('30');

      const src = addModal.modal.getByTestId('level-picker-trigger').first();
      await src.tap();
      for (const key of ['2', '5']) await page.getByTestId(`numeric-keypad-key-${key}`).tap();
      await page.getByTestId('numeric-keypad-confirm').tap();
      await expect(src).toHaveValue('25');
      await expect(addModal.modal).toBeVisible();
    });
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
