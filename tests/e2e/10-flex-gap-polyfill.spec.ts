/**
 * flex の gap が効かない古い端末（iOS 14.4 以前など）向けの補正（src/utils/flexGapPolyfill.ts）。
 *
 * `?flexGapPolyfill=1` で補正を強制すると、元の gap を 0 にして margin だけで並べるので、古い端末の見た目を再現できる。
 * 通常の表示と比べて、目に見える中身（子を持たない要素）の位置が変わらないことを確かめる。
 * 子を持つ要素（並びを包む箱など）は比べない。目に見えるのは中身なので、中身が一致すれば足りる。
 */
import { test, expect, type Page } from '@playwright/test';
import { AddPokemonModalPage } from './pages/AddPokemonModalPage';
import { CalcPanelPage } from './pages/CalcPanelPage';

type Box = { key: string; x: number; y: number; w: number; h: number };

async function visibleLeafBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: { key: string; x: number; y: number; w: number; h: number }[] = [];
    const all = document.body.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const element = all[i];
      if (element.children.length > 0) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const className = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      out.push({
        key: `${i}:${element.tagName.toLowerCase()}${className ? `.${className}` : ''}`,
        x: rect.left,
        y: rect.top + window.scrollY,
        w: rect.width,
        h: rect.height,
      });
    }
    return out;
  });
}

async function resetAppStorage(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    const keep = ['candy-boost-planner:onboarding-done', 'candy-boost-planner:lang'];
    Object.keys(localStorage).forEach((key) => { if (keep.indexOf(key) < 0) localStorage.removeItem(key); });
    sessionStorage.clear();
  });
}

type Scenario = (page: Page, mobile: boolean) => Promise<void>;

async function addOnePokemon(page: Page): Promise<void> {
  const modal = new AddPokemonModalPage(page);
  await modal.open();
  await modal.fillAndPickName('ピカ');
  await modal.submitButton.click();
  await modal.close();
  await expect(page.locator('.calcRow')).toHaveCount(1);
}

const scenarios: Record<string, Scenario> = {
  計算機: addOnePokemon,
  // 合計カードは幅 calc(50% - 5px) の折り返す並び。親を広げる補正だと % が広がって1列になった。
  育成プラン: async (page) => {
    await addOnePokemon(page);
    const calc = new CalcPanelPage(page);
    await calc.clickExport();
    await expect(calc.exportModal).toBeVisible();
    await expect(page.getByTestId('statCard').first()).toBeVisible();
  },
  ポケモン追加: async (page) => {
    const modal = new AddPokemonModalPage(page);
    await modal.open();
    await modal.fillAndPickName('ピカ');
  },
  設定: async (page, mobile) => {
    await page.getByTestId(mobile ? 'calc-empty-settings-link' : 'settings-open-button-desktop').click();
    await expect(page.locator('.modal')).toBeVisible();
  },
  ポケモンボックス: async (page, mobile) => {
    if (mobile) await page.locator('.mobileNav__panelTabs button').filter({ hasText: 'ポケモンボックス' }).click();
  },
};

async function capture(page: Page, scenario: Scenario, mobile: boolean, theme: string, polyfill: boolean): Promise<Box[]> {
  await resetAppStorage(page);
  await page.evaluate((id) => localStorage.setItem('candy-boost-planner:design', id), theme);
  await page.goto(polyfill ? '/?flexGapPolyfill=1' : '/');
  await expect(page.locator('#app > *').first()).toBeVisible();
  await expect(page.locator('html')).toHaveClass(polyfill ? /no-flexgap/ : /^(?!.*no-flexgap).*$/);
  await scenario(page, mobile);
  // 補正は requestAnimationFrame で付くので、描画が落ち着くのを待つ（テーマの transition も含む）。
  await page.waitForTimeout(400);
  return visibleLeafBoxes(page);
}

const variants = [
  { name: 'スマホ幅・blue', mobile: true, theme: 'blue' },
  // margin も transition で動くテーマ。付け直しのたびに間隔が膨らまないこと。
  { name: 'スマホ幅・cyberpunk', mobile: true, theme: 'cyberpunk' },
  { name: 'PC 幅・blue', mobile: false, theme: 'blue' },
];

for (const variant of variants) {
  test.describe(`flex の gap の補正（${variant.name}）`, () => {
    test.use(variant.mobile
      ? { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1440, height: 900 } });

    for (const [name, scenario] of Object.entries(scenarios)) {
      test(`${name}: 補正で並べても中身の位置が変わらない`, async ({ page }) => {
        const native = await capture(page, scenario, variant.mobile, variant.theme, false);
        const polyfilled = await capture(page, scenario, variant.mobile, variant.theme, true);
        expect(polyfilled.map((box) => box.key)).toEqual(native.map((box) => box.key));
        const round = (value: number) => Math.round(value * 10) / 10;
        const moved = native
          .map((box, index) => {
            const other = polyfilled[index];
            return {
              key: box.key,
              moved: round(Math.max(Math.abs(box.x - other.x), Math.abs(box.y - other.y))),
              resized: round(Math.max(Math.abs(box.w - other.w), Math.abs(box.h - other.h))),
            };
          })
          // 位置は一致させる。大きさは、gap で折り返す並びを落とすために前の行を埋めると伸びる子がその分細くなるので、少し許す。
          .filter((entry) => entry.moved > 1.5 || entry.resized > 5);
        expect(moved).toEqual([]);
      });
    }
  });
}

test.describe('flex の gap の補正（書き換えへの追従）', () => {
  // 件数の更新や言語の切り替えは、要素を足さず文字だけを書き換える。子の中の文字が延びて折り返しが変わったら付け直す。
  test('子孫の文字だけが変わって折り返しが変わっても、通常の表示と同じ位置に並ぶ', async ({ page }) => {
    const layout = async (polyfill: boolean) => {
      await page.goto(polyfill ? '/?flexGapPolyfill=1' : '/');
      await expect(page.locator('#app > *').first()).toBeVisible();
      return page.evaluate(async () => {
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px 20px;width:110px;position:absolute;left:0;top:0';
        const labels: HTMLElement[] = [];
        for (let i = 0; i < 3; i++) {
          const item = document.createElement('div');
          const label = document.createElement('span');
          label.style.cssText = 'display:inline-block;font:16px monospace';
          label.textContent = 'x';
          item.appendChild(label);
          box.appendChild(item);
          labels.push(label);
        }
        document.body.appendChild(box);
        await frame();
        // 文字の節点だけを書き換える（要素の増減・class の変化は起こさない）。1つ目が延びて2つ目が次の行へ落ちる
        labels[0].firstChild!.nodeValue = 'x'.repeat(12);
        await frame();
        return Array.from(box.children).map((child) => {
          const rect = child.getBoundingClientRect();
          return [Math.round(rect.left * 10) / 10, Math.round(rect.top * 10) / 10];
        });
      });
    };
    const native = await layout(false);
    // 前提: 書き換えで折り返している（2つ目が1つ目より下）
    expect(native[1][1]).toBeGreaterThan(native[0][1]);
    expect(await layout(true)).toEqual(native);
  });
});
