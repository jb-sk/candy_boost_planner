import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calcExp } from '../../src/domain/pokesleep/exp';
import type { ExpGainNature, ExpType } from '../../src/domain/types';
import type { CalcRowV1, CalcSaveSlotV1 } from '../../src/persistence/calc';

const TEST_STORAGE_KEYS = [
  'candy-boost-planner:calc:slots:v1',
  'candy-boost-planner:calc:activeSlot',
  'candy-boost-planner:calc:totalShards',
  'candy-boost-planner:candy-inventory:v1',
] as const;
const requestedViewportWidth = Number(process.env.FBL04_CLS_WIDTH ?? '360');
const VIEWPORT_WIDTH = Number.isSafeInteger(requestedViewportWidth) && requestedViewportWidth >= 280
  ? requestedViewportWidth
  : 360;

type RectSnapshot = { x: number; y: number; width: number; height: number };
type LayoutShiftSample = {
  startTimeMs: number;
  value: number;
  hadRecentInput: boolean;
  sources: Array<{ target: string; previousRect: RectSnapshot; currentRect: RectSnapshot }>;
};
type ContainerFrame = {
  timeMs: number;
  summaryHeight: number;
  followingTop: number;
  followingTransform: string;
  followingInlineTransform: string;
  followingInlineTransition: string;
  actionsTop: number;
  slotsTop: number;
  firstRowTop: number | null;
  boxTop: number | null;
  /** 「ポケモンを追加」の下端から計算機パネルの下端までの見た目の余白。 */
  addButtonGap: number | null;
  containerTop: number;
  height: number;
  bottom: number;
  rowCount: number;
  exportDisabled: boolean | null;
  noStockWarning: boolean;
  summaryItems: Array<{ text: string; x: number; y: number; width: number; height: number }>;
};
type PerfLog = { timeMs: number; name: string; detail: Record<string, unknown> };
type BrowserClsState = { shifts: LayoutShiftSample[]; frames: ContainerFrame[]; logs: PerfLog[] };
type FixtureRow = {
  id: string;
  pokedexId: number;
  type: string;
  currentLevel: number;
  currentExpInLevel: number;
  targetLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
  requestedBoostCandy: number;
};

const fixtureRows: FixtureRow[] = [
  { id: 'dedenne-lower', pokedexId: 702, type: 'Electric', currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'normal', requestedBoostCandy: 0 },
  { id: 'latias', pokedexId: 380, type: 'Dragon', currentLevel: 55, currentExpInLevel: 0, targetLevel: 65, expType: 1080, nature: 'normal', requestedBoostCandy: 992 },
  { id: 'drampa', pokedexId: 780, type: 'Dragon', currentLevel: 25, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'down', requestedBoostCandy: 696 },
  { id: 'suicune', pokedexId: 245, type: 'Water', currentLevel: 61, currentExpInLevel: 0, targetLevel: 65, expType: 1080, nature: 'down', requestedBoostCandy: 514 },
  { id: 'dedenne-boundary', pokedexId: 702, type: 'Electric', currentLevel: 63, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'down', requestedBoostCandy: 0 },
  { id: 'spiritomb', pokedexId: 442, type: 'Dark', currentLevel: 63, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'normal', requestedBoostCandy: 158 },
  { id: 'cresselia', pokedexId: 488, type: 'Psychic', currentLevel: 25, currentExpInLevel: 0, targetLevel: 70, expType: 1080, nature: 'normal', requestedBoostCandy: 0 },
  { id: 'heracross', pokedexId: 214, type: 'Bug', currentLevel: 25, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'normal', requestedBoostCandy: 0 },
  { id: 'vikavolt', pokedexId: 738, type: 'Bug', currentLevel: 25, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'down', requestedBoostCandy: 0 },
  { id: 'swalot', pokedexId: 317, type: 'Poison', currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, expType: 600, nature: 'down', requestedBoostCandy: 0 },
];

function buildStoredRow(row: FixtureRow): CalcRowV1 {
  return {
    id: row.id,
    pokedexId: row.pokedexId,
    pokemonType: row.type,
    title: row.id,
    srcLevel: row.currentLevel,
    dstLevel: row.targetLevel,
    expRemaining: Math.max(0, calcExp(row.currentLevel, row.currentLevel + 1, row.expType) - row.currentExpInLevel),
    expType: row.expType,
    nature: row.nature,
    boostReachLevel: row.targetLevel,
    boostOrExpAdjustment: row.requestedBoostCandy,
  };
}

function buildFixture(emptyInventory: boolean, boostKind: 'full' | 'mini' | 'none', boostCap?: number): { slot: CalcSaveSlotV1; inventory: Record<string, unknown> } {
  return {
    slot: {
      slotId: 'fbl04-cls-fixture',
      savedAt: new Date(0).toISOString(),
      rows: fixtureRows.map(buildStoredRow),
      activeRowId: null,
      boostKind,
      boostCandyRemaining: boostKind === 'none' ? null : boostCap ?? (boostKind === 'mini' ? 350 : 3_500),
      itemCompareMode: 'surplusFirst',
    },
    inventory: emptyInventory ? {
      schemaVersion: 1,
      species: {},
      typeCandy: {},
      universal: { s: 0, m: 0, l: 0 },
    } : {
      schemaVersion: 1,
      species: { '380': 320, '780': 656, '245': 478, '442': 0, '702': 100, '738': 0, '317': 272, '214': 0, '488': 500 },
      typeCandy: {
        Dragon: { s: 13, m: 0 }, Water: { s: 0, m: 0 }, Dark: { s: 0, m: 3 },
        Electric: { s: 0, m: 0 }, Bug: { s: 0, m: 0 }, Poison: { s: 0, m: 0 },
        Psychic: { s: 18, m: 10 },
      },
      universal: { s: 432, m: 102, l: 9 },
    },
  };
}

function calculateCls(shifts: LayoutShiftSample[]): number {
  const eligible = shifts.filter(shift => !shift.hadRecentInput).sort((a, b) => a.startTimeMs - b.startTimeMs);
  let largestWindow = 0;
  let currentWindow = 0;
  let windowStartedAt = Number.NEGATIVE_INFINITY;
  let previousAt = Number.NEGATIVE_INFINITY;
  for (const shift of eligible) {
    if (shift.startTimeMs - previousAt > 1_000 || shift.startTimeMs - windowStartedAt > 5_000) {
      currentWindow = 0;
      windowStartedAt = shift.startTimeMs;
    }
    currentWindow += shift.value;
    largestWindow = Math.max(largestWindow, currentWindow);
    previousAt = shift.startTimeMs;
  }
  return Math.round(largestWindow * 1_000_000) / 1_000_000;
}

async function installFixture(page: Page, emptyInventory: boolean, boostKind: 'full' | 'mini' | 'none', boostCap?: number): Promise<void> {
  const fixture = buildFixture(emptyInventory, boostKind, boostCap);
  await page.evaluate(({ slot, inventory }) => {
    localStorage.setItem('candy-boost-planner:calc:slots:v1', JSON.stringify({ schemaVersion: 1, slots: [slot, null, null] }));
    localStorage.setItem('candy-boost-planner:calc:activeSlot', '0');
    localStorage.setItem('candy-boost-planner:calc:totalShards', '10000000');
    localStorage.setItem('candy-boost-planner:candy-inventory:v1', JSON.stringify(inventory));
  }, fixture);
}

test.use({ viewport: { width: VIEWPORT_WIDTH, height: 780 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type Attribution = { node?: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly };
    type LayoutShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: Attribution[] };
    const state: BrowserClsState = { shifts: [], frames: [], logs: [] };
    (window as unknown as { __fbl04Cls: BrowserClsState }).__fbl04Cls = state;
    const round = (value: number) => Math.round(value * 100) / 100;
    const rect = (value: DOMRectReadOnly): RectSnapshot => ({ x: round(value.x), y: round(value.y), width: round(value.width), height: round(value.height) });
    const selector = (node: Node | null | undefined): string => {
      // 文字だけが動いたときはテキストノードが来るので、親要素で場所を示す。
      if (node instanceof Text) return `${selector(node.parentElement)} > #text "${(node.textContent ?? '').trim().slice(0, 20)}"`;
      if (!(node instanceof Element)) return '(unknown)';
      const testId = node.getAttribute('data-testid');
      if (testId) return `[data-testid="${testId}"]`;
      if (node.id) return `#${node.id}`;
      return `${node.tagName.toLowerCase()}${[...node.classList].map(value => `.${value}`).join('')}`;
    };

    const originalInfo = console.info.bind(console);
    console.info = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[perf] ')) {
        const detail = args[1] && typeof args[1] === 'object'
          ? JSON.parse(JSON.stringify(args[1])) as Record<string, unknown>
          : {};
        state.logs.push({ timeMs: round(performance.now()), name: args[0].slice('[perf] '.length), detail });
      }
      originalInfo(...args);
    };

    if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
      const observer = new PerformanceObserver((list) => {
        for (const rawEntry of list.getEntries()) {
          const entry = rawEntry as LayoutShiftEntry;
          state.shifts.push({
            startTimeMs: round(entry.startTime),
            value: Math.round(entry.value * 1_000_000) / 1_000_000,
            hadRecentInput: entry.hadRecentInput,
            sources: (entry.sources ?? []).map(source => ({
              target: selector(source.node),
              previousRect: rect(source.previousRect),
              currentRect: rect(source.currentRect),
            })),
          });
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    }

    addEventListener('DOMContentLoaded', () => {
      let previous = '';
      // FLIP は 200ms ほどで終わるので、間引かずに毎フレーム記録する。
      const sample = (): void => {
        if (performance.now() <= 15_000) requestAnimationFrame(sample);
        const container = document.querySelector('.calcSlotContainer');
        if (!(container instanceof HTMLElement)) return;
        const bounds = container.getBoundingClientRect();
        const summary = document.querySelector('[data-testid="calc-sticky-summary"]');
        const following = document.querySelector('[data-testid="calc-following"]');
        const actions = document.querySelector('[data-testid="calc-actions"]');
        const slots = document.querySelector('.calcSlots');
        const firstRow = document.querySelector('[data-testid="calc-row"]');
        const box = document.querySelector('#neo-box');
        const calcPanel = document.querySelector('#neo-calc');
        const addButton = document.querySelector('[data-testid="calc-add-pokemon-btn"]');
        const exportButton = document.querySelector('[data-testid="calc-export-button"]');
        const frame: ContainerFrame = {
          timeMs: round(performance.now()),
          summaryHeight: summary instanceof HTMLElement ? round(summary.getBoundingClientRect().height) : 0,
          followingTop: following instanceof HTMLElement ? round(following.getBoundingClientRect().top) : 0,
          followingTransform: following instanceof HTMLElement ? getComputedStyle(following).transform : '',
          followingInlineTransform: following instanceof HTMLElement ? following.style.transform : '',
          followingInlineTransition: following instanceof HTMLElement ? following.style.transition : '',
          actionsTop: actions instanceof HTMLElement ? round(actions.getBoundingClientRect().top) : 0,
          slotsTop: slots instanceof HTMLElement ? round(slots.getBoundingClientRect().top) : 0,
          firstRowTop: firstRow instanceof HTMLElement ? round(firstRow.getBoundingClientRect().top) : null,
          boxTop: box instanceof HTMLElement && box.getClientRects().length > 0 ? round(box.getBoundingClientRect().top) : null,
          addButtonGap: calcPanel instanceof HTMLElement && addButton instanceof HTMLElement
            ? round(calcPanel.getBoundingClientRect().bottom - addButton.getBoundingClientRect().bottom)
            : null,
          containerTop: round(bounds.top),
          height: round(bounds.height),
          bottom: round(bounds.bottom),
          rowCount: document.querySelectorAll('[data-testid="calc-row"]').length,
          exportDisabled: exportButton instanceof HTMLButtonElement ? exportButton.disabled : null,
          noStockWarning: document.querySelector('.calcSticky__noStock') !== null,
          summaryItems: [...document.querySelectorAll('.calcSticky__summaryBody > *')].map((item) => {
            const itemBounds = item.getBoundingClientRect();
            return {
              text: item.textContent?.trim() ?? '',
              x: round(itemBounds.x),
              y: round(itemBounds.y),
              width: round(itemBounds.width),
              height: round(itemBounds.height),
            };
          }),
        };
        const signature = JSON.stringify({ ...frame, timeMs: 0 });
        if (signature !== previous) {
          state.frames.push(frame);
          previous = signature;
        }
      };
      requestAnimationFrame(sample);
    }, { once: true });
  });
});

for (const scenario of [
  { name: 'stocked-full', emptyInventory: false, boostKind: 'full' },
  { name: 'stocked-full-zero-cap', emptyInventory: false, boostKind: 'full', boostCap: 0 },
  { name: 'stocked-mini', emptyInventory: false, boostKind: 'mini' },
  { name: 'empty-stock-full', emptyInventory: true, boostKind: 'full' },
  { name: 'stocked-normal', emptyInventory: false, boostKind: 'none' },
  { name: 'empty-stock-normal', emptyInventory: true, boostKind: 'none' },
  { name: 'stocked-full-reduced-motion', emptyInventory: false, boostKind: 'full', reducedMotion: true },
  // 340px ではサマリーが結果確定で折り返し、sticky 前でも下の領域を FLIP で動かす。
  { name: 'stocked-full-narrow', emptyInventory: false, boostKind: 'full', viewportWidth: 340, expectFlip: true },
  { name: 'stocked-full-sticky', emptyInventory: false, boostKind: 'full', sticky: true, viewportWidth: 340 },
  // PC 2列では隣にボックスが並ぶので、sticky 中もページをスクロールさせず計算機の中だけを動かす。
  // PC のサマリーは項目名が数字の上にあって細く、この幅では結果が出ても折り返さない。
  // 高さが変わる場面を作るため、サマリーの幅だけを狭めて結果で2行に折り返させる（計算前の「-」なら1行に収まる幅）。
  { name: 'stocked-full-side-by-side-sticky', emptyInventory: false, boostKind: 'full', sideBySideSticky: true, viewportWidth: 1440, summaryMaxWidth: 460 },
] as const) {
  test(`reproduces saved 10-row mobile layout shifts: ${scenario.name}`, async ({ page }, testInfo) => {
    if ('viewportWidth' in scenario && scenario.viewportWidth !== undefined) {
      await page.setViewportSize({ width: scenario.viewportWidth, height: 780 });
    }
    if ('reducedMotion' in scenario && scenario.reducedMotion) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
    }
    await page.goto('/?perf=1');
    await installFixture(page, scenario.emptyInventory, scenario.boostKind, 'boostCap' in scenario ? scenario.boostCap : undefined);
    try {
      await page.reload();
      if ('summaryMaxWidth' in scenario) {
        await page.addStyleTag({ content: `.calcSticky__summaryBody { max-width: ${scenario.summaryMaxWidth}px; }` });
      }
      expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('layout-shift'))).toBe(true);
      await expect(page.getByTestId('calc-row')).toHaveCount(10);
      let stickyBaseline: { actionsTop: number; scrollY: number; scrolledAtMs: number } | null = null;
      const sideBySideSticky = 'sideBySideSticky' in scenario && scenario.sideBySideSticky;
      if (('sticky' in scenario && scenario.sticky) || sideBySideSticky) {
        stickyBaseline = await page.evaluate(() => {
          const sticky = document.querySelector<HTMLElement>('.calcSticky');
          const actions = document.querySelector<HTMLElement>('[data-testid="calc-actions"]');
          if (!sticky || !actions) throw new Error('sticky probe elements are missing');
          const stickyOffset = Number.parseFloat(getComputedStyle(sticky).top) || 0;
          window.scrollTo(0, window.scrollY + sticky.getBoundingClientRect().top - stickyOffset + 1);
          return { actionsTop: actions.getBoundingClientRect().top, scrollY: window.scrollY, scrolledAtMs: performance.now() };
        });
        expect(await page.getByTestId('calc-export-button').isDisabled(), 'sticky probe must scroll before Worker result').toBe(true);
      }
      await expect(page.getByTestId('calc-export-button')).toBeEnabled({ timeout: 60_000 });
      await page.waitForTimeout(1_100);
      const state = await page.evaluate(() => (window as unknown as { __fbl04Cls: BrowserClsState }).__fbl04Cls);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputDirectory = resolve('_local', 'fbl04-cls-perf', `${timestamp}-${scenario.name}`);
      const measuredViewport = page.viewportSize() ?? { width: VIEWPORT_WIDTH, height: 780 };
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(resolve(outputDirectory, 'detail.json'), `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        browser: 'chromium / mobile viewport',
        viewport: measuredViewport,
        fixture: `reportedFullPostSwitchFixture / surplusFirst / 10 rows / ${scenario.name}`,
        cls: calculateCls(state.shifts),
        ...state,
      }, null, 2)}\n`, 'utf8');
      testInfo.annotations.push({ type: 'performance-report', description: outputDirectory });
      console.info(`fbl04 CLS report: ${outputDirectory}`);
      const cls = calculateCls(state.shifts);
      console.info(`fbl04 reproduced CLS (${scenario.name}): ${cls}`);

      const initialFrame = state.frames[0];
      const finalFrame = state.frames.at(-1);
      expect(initialFrame, 'initial layout frame must be captured').toBeDefined();
      expect(finalFrame, 'final layout frame must be captured').toBeDefined();
      expect(cls, 'saved-plan initial render CLS must stay below 0.02').toBeLessThan(0.02);
      expect(finalFrame?.followingTransform, 'FLIP transform must be cleaned up').toBe('none');
      expect(finalFrame?.followingInlineTransform, 'inline FLIP transform must not remain').toBe('');
      expect(finalFrame?.followingInlineTransition, 'inline FLIP transition must not remain').toBe('');
      const styleResidue = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.calcFollowing, [data-testid="calc-row"], [data-testid="resultRowReachable"], .calcSticky__summaryBody > *')]
          .filter(element => element.style.transform || element.style.transition || element.style.transformOrigin || element.style.opacity || (element.matches('.calcFollowing') && element.style.marginBottom))
          .map(element => element.getAttribute('data-testid') ?? element.className),
      );
      expect(styleResidue, 'FLIP styles must be removed from every animated element').toEqual([]);
      // CLS は transform による移動を数えないため、行だけが先に飛ぶ不具合は CLS に出ない。
      // FLIP 中も行がタブと一緒に動いている（見た目の間隔が変わらない）ことを直接確かめる。
      const rowGaps = state.frames
        .filter(frame => frame.rowCount === 10 && frame.firstRowTop !== null)
        .map(frame => (frame.firstRowTop ?? 0) - frame.slotsTop);
      expect(rowGaps.length, 'row position frames must be captured').toBeGreaterThan(0);
      expect(Math.max(...rowGaps) - Math.min(...rowGaps), 'rows must move together with the slot tabs during FLIP').toBeLessThan(0.75);
      // パネルの下端も中身と一緒に動く（一番下の「ポケモンを追加」の下の余白が伸び縮みしない）。
      const addButtonGaps = state.frames
        .filter(frame => frame.rowCount === 10 && frame.addButtonGap !== null)
        .map(frame => frame.addButtonGap ?? 0);
      expect(addButtonGaps.length, 'add-button frames must be captured').toBeGreaterThan(0);
      expect(Math.max(...addButtonGaps) - Math.min(...addButtonGaps), 'the panel bottom must move together with the add button during FLIP').toBeLessThan(0.75);
      if ('expectFlip' in scenario && scenario.expectFlip) {
        // 折り返しが変わらなかったり FLIP の途中を取り逃したりすると、上の検査は何も見ずに通ってしまう。
        expect(
          Math.abs((finalFrame?.summaryHeight ?? 0) - (initialFrame?.summaryHeight ?? 0)),
          'narrow probe must change the summary height',
        ).toBeGreaterThan(0.5);
        expect(
          state.frames.some(frame => frame.followingTransform !== 'none' && frame.followingTransform !== ''),
          'narrow probe must capture a frame in the middle of the FLIP',
        ).toBe(true);
      }
      if (sideBySideSticky && stickyBaseline) {
        const scrollY = await page.evaluate(() => window.scrollY);
        const boxTops = state.frames
          .filter(frame => frame.timeMs > (stickyBaseline?.scrolledAtMs ?? 0))
          .map(frame => frame.boxTop).filter((top): top is number => top !== null);
        expect(boxTops.length, 'side-by-side probe must see the Box panel').toBeGreaterThan(0);
        expect(
          Math.abs((finalFrame?.summaryHeight ?? 0) - (initialFrame?.summaryHeight ?? 0)),
          'side-by-side probe must change the summary height',
        ).toBeGreaterThan(0.5);
        expect(scrollY, 'side-by-side compensation must not scroll the page').toBe(stickyBaseline.scrollY);
        expect(Math.max(...boxTops) - Math.min(...boxTops), 'the Box panel beside the calculator must not move').toBeLessThan(0.75);
      } else if (stickyBaseline) {
        const stickyFinal = await page.evaluate(() => ({
          actionsTop: document.querySelector<HTMLElement>('[data-testid="calc-actions"]')?.getBoundingClientRect().top ?? 0,
          scrollY: window.scrollY,
        }));
        expect(Math.abs(stickyFinal.actionsTop - stickyBaseline.actionsTop), 'sticky compensation must preserve following content position').toBeLessThan(0.75);
        expect(stickyFinal.scrollY - stickyBaseline.scrollY, 'sticky compensation must follow natural summary growth').toBeGreaterThan(5);
        expect(
          Math.abs((finalFrame?.summaryHeight ?? 0) - (initialFrame?.summaryHeight ?? 0)),
          'sticky probe must keep its natural summary-height change',
        ).toBeGreaterThan(0.5);
      }
    } finally {
      await page.evaluate(keys => keys.forEach(key => localStorage.removeItem(key)), TEST_STORAGE_KEYS);
    }
  });
}

// ===== スロット切り替え（計算済みの結果がクリックの直後に非同期で届く） =====

/**
 * 10行・1行・別の1行の3スロット。アメブ種別が同じなので、クリックの時点ではサマリーが変わらず、結果が届いてから変わる。
 * 340px では10行のサマリーは2行、1行のスロットはどちらも1行になる。
 */
async function installSlotFixture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 340, height: 780 });
  await page.goto('/?perf=1');
  const { slot, inventory } = buildFixture(false, 'full');
  const smallSlot: CalcSaveSlotV1 = { ...slot, slotId: 'fbl04-cls-small', rows: slot.rows.slice(1, 2) };
  const otherSmallSlot: CalcSaveSlotV1 = { ...slot, slotId: 'fbl04-cls-other-small', rows: slot.rows.slice(2, 3) };
  await page.evaluate(({ slots, inventory }) => {
    localStorage.setItem('candy-boost-planner:calc:slots:v1', JSON.stringify({ schemaVersion: 1, slots }));
    localStorage.setItem('candy-boost-planner:calc:activeSlot', '0');
    localStorage.setItem('candy-boost-planner:calc:totalShards', '10000000');
    localStorage.setItem('candy-boost-planner:candy-inventory:v1', JSON.stringify(inventory));
  }, { slots: [slot, smallSlot, otherSmallSlot], inventory });
  await page.reload();
  await expect(page.getByTestId('calc-export-button')).toBeEnabled({ timeout: 60_000 });
  await page.waitForTimeout(600);
}

/** スロットのタブを座標でクリックする（Playwright の click はタブを画面内へスクロールしてしまう）。 */
async function clickSlot(page: Page, index: number): Promise<void> {
  const tab = await page.getByTestId('calc-slot-tabs').locator(':scope > *').nth(index).boundingBox();
  if (!tab) throw new Error('slot tab is missing');
  await page.mouse.click(tab.x + tab.width / 2, tab.y + tab.height / 2);
}

async function switchSlotAndSettle(page: Page, index: number): Promise<void> {
  await clickSlot(page, index);
  await expect(page.getByTestId('calc-export-button')).toBeEnabled({ timeout: 60_000 });
  await page.waitForTimeout(500);
}

async function recordedFrames(page: Page): Promise<ContainerFrame[]> {
  return page.evaluate(() => (window as unknown as { __fbl04Cls: BrowserClsState }).__fbl04Cls.frames);
}

// 結果が届く速さで「滑らかに動く／瞬間移動する」が入れ替わらないよう、届いた結果は毎回 FLIP する。
test('animates slot-switch results even when they arrive right after the click', async ({ page }) => {
  await installSlotFixture(page);
  try {
    const switches: Array<{ heightChanged: boolean; animated: boolean }> = [];
    for (let index = 0; index < 4; index++) {
      const startedAt = await page.evaluate(() => performance.now());
      // 10行 ⇔ 1行を往復する。2往復目は両方とも計算済みの結果がクリックの直後に届く
      await switchSlotAndSettle(page, index % 2 === 0 ? 1 : 0);
      const all = await recordedFrames(page);
      const before = all.filter(frame => frame.timeMs < startedAt).at(-1);
      const frames = all.filter(frame => frame.timeMs >= startedAt);
      switches.push({
        heightChanged: frames.some(frame => Math.abs(frame.summaryHeight - (before?.summaryHeight ?? frame.summaryHeight)) > 0.5),
        animated: frames.some(frame => frame.followingTransform !== 'none' && frame.followingTransform !== ''),
      });
    }
    const switchesWithHeightChange = switches.filter(entry => entry.heightChanged);
    expect(switchesWithHeightChange.length, 'the probe slots must change the summary height').toBeGreaterThan(1);
    expect(switchesWithHeightChange.every(entry => entry.animated), 'every slot switch with a summary change must animate').toBe(true);
  } finally {
    await page.evaluate(keys => keys.forEach(key => localStorage.removeItem(key)), TEST_STORAGE_KEYS);
  }
});

type SummaryMotionFrame = { timeMs: number; items: Array<{ id: number; text: string; lineTop: number; opacity: number }> };

// 計算結果は段階的に届くこともあり、FLIP の途中で次の結果が来ることがある。
// 10行 → 1行の FLIP で別の行から現れかけている項目がある間に、別の1行のスロットへ切り替えて結果を重ねる。
// 2回目では行が変わらないので、現れかけた項目はその透明度から続かなければならない。
test('continues from what is on screen when a result arrives during a running FLIP', async ({ page }) => {
  await installSlotFixture(page);
  try {
    // 3つのスロットを計算済みにして、10行のスロットへ戻る
    for (const index of [1, 2, 0]) await switchSlotAndSettle(page, index);
    const startedAt = await page.evaluate(() => {
      const frames: SummaryMotionFrame[] = [];
      (window as unknown as { __summaryMotion: SummaryMotionFrame[] }).__summaryMotion = frames;
      const ids = new WeakMap<Element, number>();
      let nextId = 0;
      const startedAt = performance.now();
      const sample = (): void => {
        const body = document.querySelector('.calcSticky__summaryBody');
        if (body) {
          const bodyTop = body.getBoundingClientRect().top;
          frames.push({
            timeMs: performance.now(),
            items: [...body.children].map((item) => {
              if (!ids.has(item)) ids.set(item, nextId++);
              const style = getComputedStyle(item);
              const matrix = /^matrix\(([^)]+)\)$/.exec(style.transform);
              const translateY = matrix ? Number.parseFloat(matrix[1].split(',')[5] ?? '0') || 0 : 0;
              return {
                id: ids.get(item) ?? -1,
                text: item.textContent?.trim() ?? '',
                lineTop: Math.round(item.getBoundingClientRect().top - translateY - bodyTop),
                opacity: Number.parseFloat(style.opacity),
              };
            }),
          });
        }
        if (performance.now() - startedAt < 2_000) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      return startedAt;
    });
    await clickSlot(page, 1);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="calc-following"]')!).transform !== 'none');
    await clickSlot(page, 2);
    await expect(page.getByTestId('calc-export-button')).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(800);

    const frames = (await recordedFrames(page)).filter(frame => frame.timeMs >= startedAt);

    // 行・タブ・「ポケモンを追加」・パネルの下端は、重なっても一緒に動く
    const rowGaps = frames.filter(frame => frame.firstRowTop !== null).map(frame => (frame.firstRowTop ?? 0) - frame.slotsTop);
    expect(Math.max(...rowGaps) - Math.min(...rowGaps), 'rows must move together with the slot tabs').toBeLessThan(0.75);
    const addButtonGaps = frames.filter(frame => frame.addButtonGap !== null).map(frame => frame.addButtonGap ?? 0);
    expect(Math.max(...addButtonGaps) - Math.min(...addButtonGaps), 'the panel bottom must move together with the add button').toBeLessThan(0.75);

    // 前提: 2回目の結果（サマリーの文字が変わる）が届いた時点で、同じ行で現れかけている項目がある
    const motion = await page.evaluate(() => (window as unknown as { __summaryMotion: SummaryMotionFrame[] }).__summaryMotion);
    const texts = (frame: SummaryMotionFrame) => frame.items.map(item => item.text).join('|');
    const firstFadeIndex = motion.findIndex(frame => frame.items.some(item => item.opacity < 0.99));
    const secondIndex = motion.findIndex((frame, index) => index > firstFadeIndex && firstFadeIndex >= 0 && texts(frame) !== texts(motion[index - 1]));
    expect(secondIndex, 'the second result must arrive after the first FLIP starts').toBeGreaterThan(0);
    const beforeSecond = motion[secondIndex - 1];
    const afterSecond = motion[secondIndex];
    const continuing = (beforeSecond?.items ?? []).filter(item =>
      item.opacity > 0.01 && item.opacity < 0.99
      && (afterSecond?.items ?? []).some(next => next.id === item.id && next.lineTop === item.lineTop));
    expect(continuing.length, 'an item must be fading in on the same line when the second FLIP starts').toBeGreaterThan(0);

    // 現れかけた項目は、行が変わらない限り再び消えない
    const reversals: string[] = [];
    for (let index = 1; index < motion.length; index++) {
      const previous = new Map(motion[index - 1].items.map(item => [item.id, item]));
      for (const item of motion[index].items) {
        const before = previous.get(item.id);
        if (!before || before.lineTop !== item.lineTop) continue;
        if (before.opacity > 0.01 && before.opacity < 0.99 && item.opacity < before.opacity - 0.01) {
          reversals.push(`${item.text}: ${before.opacity} -> ${item.opacity}`);
        }
      }
    }
    expect(reversals, 'a fading summary item must not disappear again on the same line').toEqual([]);

    const residue = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.calcFollowing, [data-testid="calc-row"], [data-testid="resultRowReachable"], .calcSticky__summaryBody > *')]
        .filter(element => element.style.transform || element.style.transition || element.style.opacity || (element.matches('.calcFollowing') && element.style.marginBottom))
        .map(element => element.getAttribute('data-testid') ?? element.className),
    );
    expect(residue, 'FLIP styles must be removed after overlapping results').toEqual([]);
  } finally {
    await page.evaluate(keys => keys.forEach(key => localStorage.removeItem(key)), TEST_STORAGE_KEYS);
  }
});
