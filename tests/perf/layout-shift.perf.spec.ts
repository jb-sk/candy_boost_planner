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
  actionsTop: number;
  slotsTop: number;
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
    boostRatioPct: 100,
    boostOrExpAdjustment: row.requestedBoostCandy,
    mode: 'targetLevel',
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
      const timer = setInterval(() => {
        const container = document.querySelector('.calcSlotContainer');
        if (!(container instanceof HTMLElement)) return;
        const bounds = container.getBoundingClientRect();
        const summary = document.querySelector('[data-testid="calc-sticky-summary"]');
        const actions = document.querySelector('[data-testid="calc-actions"]');
        const slots = document.querySelector('.calcSlots');
        const exportButton = document.querySelector('[data-testid="calc-export-button"]');
        const frame: ContainerFrame = {
          timeMs: round(performance.now()),
          summaryHeight: summary instanceof HTMLElement ? round(summary.getBoundingClientRect().height) : 0,
          actionsTop: actions instanceof HTMLElement ? round(actions.getBoundingClientRect().top) : 0,
          slotsTop: slots instanceof HTMLElement ? round(slots.getBoundingClientRect().top) : 0,
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
        if (performance.now() > 15_000) clearInterval(timer);
      }, 50);
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
] as const) {
  test(`reproduces saved 10-row mobile layout shifts: ${scenario.name}`, async ({ page }, testInfo) => {
    await page.goto('/?perf=1');
    await installFixture(page, scenario.emptyInventory, scenario.boostKind, 'boostCap' in scenario ? scenario.boostCap : undefined);
    try {
      await page.reload();
      expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('layout-shift'))).toBe(true);
      await expect(page.getByTestId('calc-row')).toHaveCount(10);
      await expect(page.getByTestId('calc-export-button')).toBeEnabled({ timeout: 60_000 });
      await page.waitForTimeout(1_100);
      const state = await page.evaluate(() => (window as unknown as { __fbl04Cls: BrowserClsState }).__fbl04Cls);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputDirectory = resolve('_local', 'fbl04-cls-perf', `${timestamp}-${scenario.name}`);
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(resolve(outputDirectory, 'detail.json'), `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        browser: 'chromium / mobile viewport',
        viewport: { width: VIEWPORT_WIDTH, height: 780 },
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
      for (const key of ['summaryHeight', 'actionsTop', 'slotsTop', 'containerTop'] as const) {
        expect(Math.abs((finalFrame?.[key] ?? 0) - (initialFrame?.[key] ?? 0)), `${key} must remain stable`).toBeLessThan(0.5);
      }
    } finally {
      await page.evaluate(keys => keys.forEach(key => localStorage.removeItem(key)), TEST_STORAGE_KEYS);
    }
  });
}
