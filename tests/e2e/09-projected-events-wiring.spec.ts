import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BoxPanelPage } from './pages/BoxPanelPage';
import { CalcPanelPage } from './pages/CalcPanelPage';
import { SettingsModalPage } from './pages/SettingsModalPage';
import { installProjectedEventsFixture } from './fixtures/projected-events-fixture';

const testConfig = JSON.parse(
  readFileSync(new URL('../fixtures/test-config.json', import.meta.url), 'utf8'),
);

async function openSettings(page: Page): Promise<SettingsModalPage> {
  const settings = new SettingsModalPage(page);
  if (await page.evaluate(() => window.innerWidth < 680)) {
    await settings.openSettingsFromMobile();
  } else {
    await settings.openSettingsFromDesktop();
  }
  return settings;
}

async function prepareProjectedRow(page: Page): Promise<{ calc: CalcPanelPage; row: Locator }> {
  await installProjectedEventsFixture(page);
  await page.goto('/?gameDate=2027-07-12');

  const box = new BoxPanelPage(page);
  await box.openImportPanel();
  await box.fillImportText(testConfig.importData.singlePokemon);
  await box.clickImport();
  await box.selectBoxTile(0);
  await box.clickApplyToCalc();

  const calc = new CalcPanelPage(page);
  const row = calc.getRow(0);
  await calc.getRowSleepTargetSelect(row).selectOption('all');
  await expect(calc.getRowUsedRow(row)).toBeVisible({ timeout: 10_000 });
  return { calc, row };
}

test.describe('生成物スタブ済み 睡眠EXP仮イベント配線', () => {
  test('英語ではイベント一覧チップのイベント名がローカライズされる', async ({ page }) => {
    const { calc, row } = await prepareProjectedRow(page);
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('main.shell')).toHaveAttribute('data-locale', 'en');

    const reachable = calc.getRowUsedRow(row);
    await reachable.getByTestId('result-bonus-toggle').click();
    await expect(reachable.getByTestId('real-chip')).toContainText('Fixture Event');
  });

  test('英語ではイベント履歴の名前がローカライズされる', async ({ page }) => {
    await installProjectedEventsFixture(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('main.shell')).toHaveAttribute('data-locale', 'en');

    await page.getByTestId('open-event-history').click();
    const fixtureEvent = page.getByTestId('event-history-row').filter({ hasText: 'Fixture Event' });
    await expect(fixtureEvent).toHaveCount(1);
  });

  test('実生成物のすくすくウィーク5開催回はそれぞれの英語名で表示される', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await expect(page.locator('main.shell')).toHaveAttribute('data-locale', 'en');

    await page.getByTestId('open-event-history').click();

    // 表は年見出しで区切られており、その年と同じ年は行の日付から省かれる（開始日は月日だけになる）
    const expected = [
      ['05/19', 'Pokémon Growth Week Vol. 5'],
      ['02/24', 'Pokémon Growth Week Vol. 4'],
      ['12/09', 'Pokémon Growth Week Vol. 3'],
      ['08/05', 'Pokémon Growth Week Vol. 2'],
      ['07/01', 'Pokémon Growth Week'],
    ] as const;
    const displayedNames: string[] = [];
    for (const [start, englishName] of expected) {
      const row = page.getByTestId('event-history-row')
        .filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${start}–`) }) });
      await expect(row).toHaveCount(1);
      await expect(row.locator('td').nth(1)).toHaveText(englishName);
      displayedNames.push((await row.locator('td').nth(1).textContent()) ?? '');
    }
    expect(new Set(displayedNames).size).toBe(5);
  });

  test('仮イベントオフでも実イベント由来の満月シフト通知が到達可能行の明細内に出る', async ({ page }) => {
    const { calc, row } = await prepareProjectedRow(page);
    const settings = await openSettings(page);
    await settings.projectedEventsCheckbox.uncheck();
    await expect(settings.projectedEventsCheckbox).not.toBeChecked();
    await settings.closeByButton();

    const reachable = calc.getRowUsedRow(row);
    await reachable.getByTestId('result-bonus-toggle').click();
    await expect(reachable.getByTestId('result-bonus-details')).toBeVisible();
    const blueSeedShiftedNote = reachable.getByTestId('blue-seed-shift-note');
    await expect(blueSeedShiftedNote).toContainText('火曜');
  });

  // 仮イベント一覧は「内訳」明細の一部。専用の開閉は持たず、画面幅によらず一緒に出す。
  for (const [name, width] of [['680px以上', 680], ['680px未満', 679]] as const) {
    test.describe(name, () => {
      test.use({ viewport: { width, height: 900 } });

      test('到達可能行の明細内にイベントの見出しと実・仮のチップが出る', async ({ page }) => {
        const { calc, row } = await prepareProjectedRow(page);
        const settings = await openSettings(page);
        await settings.projectedEventsCheckbox.check();
        await settings.closeByButton();

        const reachable = calc.getRowUsedRow(row);
        await reachable.getByTestId('result-bonus-toggle').click();
        const chips = reachable.getByTestId('event-chips');
        await expect(chips).toBeVisible();
        await expect(chips.getByText('イベント', { exact: true })).toBeVisible();
        await expect(reachable.getByTestId('real-chip')).toHaveCount(1);
        await expect(reachable.getByTestId('projected-chip')).toHaveCount(1);
        // 既定オンの説明責任を担う断り書きは、幅にかかわらず一覧と一緒に表示する。
        await expect(chips).toContainText('実際の予定ではありません');
        // 実イベントが先、仮イベントが後。
        const kinds = await chips.locator('[data-testid$="-chip"]').evaluateAll(
          nodes => nodes.map(node => node.getAttribute('data-testid')),
        );
        expect(kinds).toEqual(['real-chip', 'projected-chip']);
      });

      test('仮イベントがオフでも実イベントだけの一覧が出る', async ({ page }) => {
        const { calc, row } = await prepareProjectedRow(page);
        const settings = await openSettings(page);
        await settings.projectedEventsCheckbox.uncheck();
        await settings.closeByButton();

        const reachable = calc.getRowUsedRow(row);
        await reachable.getByTestId('result-bonus-toggle').click();
        const chips = reachable.getByTestId('event-chips');
        await expect(chips).toBeVisible();
        await expect(reachable.getByTestId('real-chip')).toHaveCount(1);
        await expect(reachable.getByTestId('projected-chip')).toHaveCount(0);
        // 仮イベントが1件も無い一覧では断り書きを出さない。
        await expect(chips).not.toContainText('実際の予定ではありません');
      });
    });
  }

  /*
   * 明細の1列 / 2列。**閾値も画面幅も持たず「置き場所に収まるか」だけで決まる。**
   *
   * ここは実装を見ない。`data-columns` もクラス名も、CSS か JS かも見ず、
   * **座標だけ**で「一覧が表の右に並んだ / 下へ落ちた」を判定する。
   * 切り替えの仕組みを差し替えても、見え方が変わらなければ通り続ける。
   *
   * 逆に、切り替わる幅そのものは中身（言語・桁数・イベント件数）で動くので固定できない。
   * 代わりに**どの幅でも成り立つ不変条件**を押さえる。
   */
  test.describe('ボーナス明細の1列/2列', () => {
    type Placement = {
      /** 一覧が表の右（2列） */
      right: boolean;
      /** 一覧が表の下（1列） */
      below: boolean;
      /** 明細の箱の横スクロール量 */
      scrollOverflow: number;
      /** 箱の右端と、中身のいちばん右の端との差。大きいと右に使われない余白がある */
      deadSpace: number;
    };

    async function readPlacement(page: Page): Promise<Placement | null> {
      return page.evaluate(() => {
        const details = document.querySelector('[data-testid="result-bonus-details"]');
        const breakdown = document.querySelector('[data-testid="bonus-breakdown"]');
        const chips = document.querySelector('[data-testid="event-chips"]');
        if (!details || !breakdown || !chips) return null;
        const box = details.getBoundingClientRect();
        const table = breakdown.getBoundingClientRect();
        const list = chips.getBoundingClientRect();
        const dx = list.left - table.left;
        const dy = list.top - table.top;
        return {
          // 2列なら一覧は表のぶんだけ右へ寄り、上端は表と揃う。1列ならその逆。
          right: dx > 100 && dy < 32,
          below: dx < 32 && dy > 32,
          scrollOverflow: details.scrollWidth - details.clientWidth,
          deadSpace: box.right - Math.max(table.right, list.right),
        };
      });
    }

    /**
     * どの幅でも成り立つこと。
     *
     * - **並びがどちらかに確定している。** 「右でも下でもない」は、折り返しただけで
     *   箱が広がった状態（設計書§6.2 で踏んだ穴）
     * - **箱の右に使われない余白が無い。** 箱は常に中身ぶんの幅で、引き延ばさない
     * - **2列にしたせいではみ出していない。** 1列でも入りきらない内容（英語の狭い幅など）は
     *   横スクロールになるのが仕様なので、1列のときは溢れを許す
     */
    function expectSettled(placement: Placement | null, width: number): asserts placement is Placement {
      expect(placement, `幅 ${width}px で明細が見つからない`).not.toBeNull();
      expect(placement!.right !== placement!.below, `幅 ${width}px で並びが確定していない`).toBe(true);
      // 内側余白＋枠線ぶん（8〜12px + 1px）だけは中身の右に残る。
      expect(placement!.deadSpace, `幅 ${width}px で箱の右に余白が残った`).toBeLessThanOrEqual(16);
      if (placement!.right) {
        expect(placement!.scrollOverflow, `幅 ${width}px で2列にしたのにはみ出した`).toBe(0);
      }
    }

    /** 判定は次のフレームまで遅れる。不変条件が満たされるまで待つ。 */
    async function waitSettled(page: Page, width: number): Promise<void> {
      await expect
        .poll(async () => {
          const p = await readPlacement(page);
          return p !== null
            && p.right !== p.below
            && p.deadSpace <= 16
            && (!p.right || p.scrollOverflow === 0);
        }, { message: `幅 ${width}px で並びが落ち着かない` })
        .toBe(true);
    }

    async function openDetails(page: Page): Promise<void> {
      const { calc, row } = await prepareProjectedRow(page);
      const reachable = calc.getRowUsedRow(row);
      await reachable.getByTestId('result-bonus-toggle').click();
      await expect(reachable.getByTestId('result-bonus-details')).toBeVisible();
    }

    async function setLocale(page: Page, locale: 'ja' | 'en'): Promise<void> {
      await page.getByRole('button', { name: locale === 'ja' ? 'JP' : 'EN', exact: true }).click();
      await expect(page.locator('main.shell')).toHaveAttribute('data-locale', locale);
    }

    /*
     * 幅を変えても常に成り立つこと。
     * - 狭ければ縦積み、広ければ横並び（境目の位置は問わない）
     * - **どの幅でもはみ出さない**
     *
     * 幅ごとの決め打ちを持たないので、切り替わる位置が中身で動いても落ちない。
     * 逆に、幅が変わったときに測り直さない実装（初回しか判定しない等）は必ず落ちる。
     */
    for (const locale of ['ja', 'en'] as const) {
      test(`幅を変えても並びが破綻しない（${locale}）`, async ({ page }) => {
        await page.setViewportSize({ width: 1200, height: 900 });
        await openDetails(page);
        if (locale === 'en') await setLocale(page, 'en');

        for (const width of [320, 360, 420, 480, 520, 560, 600, 640, 679, 680, 760, 900, 1200]) {
          await page.setViewportSize({ width, height: 900 });
          await waitSettled(page, width);
          const placement = await readPlacement(page);
          expectSettled(placement, width);
          if (width <= 360) expect(placement.below, `幅 ${width}px は縦積みのはず`).toBe(true);
          if (width >= 900) expect(placement.right, `幅 ${width}px は横並びのはず`).toBe(true);
        }
      });
    }

    /*
     * 明細を開いたまま幅を変えたときに**追随する**こと。
     * 開いた時点でしか測らない実装（リサイズの購読漏れ）はここで落ちる。
     */
    test('明細を開いたまま幅を変えると並びが追随する', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 900 });
      await openDetails(page);
      await expect.poll(async () => (await readPlacement(page))?.below).toBe(true);

      await page.setViewportSize({ width: 1200, height: 900 });
      await expect.poll(async () => (await readPlacement(page))?.right).toBe(true);
      expectSettled(await readPlacement(page), 1200);

      await page.setViewportSize({ width: 360, height: 900 });
      await expect.poll(async () => (await readPlacement(page))?.below).toBe(true);
      expectSettled(await readPlacement(page), 360);
    });

    /**
     * 日本語でちょうど2列になる最小幅。**値は固定しない**（中身で動くため）。
     *
     * 二分探索は使えない。680px で明細の字下げと内側余白が変わり、**使える幅は
     * ビューポート幅に対して単調ではない**（679px より 680px の方が狭い）ため、
     * 探索のたびに違う答えが出る（実際に踏んだ）。1つの体裁に収まる範囲を刻んで走査する。
     */
    async function findSideBySideWidth(page: Page): Promise<number> {
      for (let width = 480; width < 680; width += 4) {
        await page.setViewportSize({ width, height: 900 });
        await waitSettled(page, width);
        if ((await readPlacement(page))?.right) return width;
      }
      throw new Error('日本語で2列になる幅が 480〜679px に見つからない');
    }

    /*
     * 幅が変わらなくても、**中身が変われば測り直す**こと。
     *
     * ちょうど2列になる幅で言語を切り替えると、必要な幅だけが変わる。
     * 内容の変化を購読していない実装は2列のままはみ出す。
     * （英語の方が短くなった場合はどちらでも収まるので、この検査は素通りする）
     */
    test('明細を開いたまま言語を切り替えても並びが破綻しない', async ({ page }) => {
      await page.setViewportSize({ width: 1200, height: 900 });
      await openDetails(page);

      const width = await findSideBySideWidth(page);
      await expect.poll(async () => (await readPlacement(page))?.right).toBe(true);

      await setLocale(page, 'en');
      await waitSettled(page, width);
      expectSettled(await readPlacement(page), width);

      await setLocale(page, 'ja');
      await expect.poll(async () => (await readPlacement(page))?.right).toBe(true);
      expectSettled(await readPlacement(page), width);
    });
  });
});
