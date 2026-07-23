import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BoxPanelPage } from '../e2e/pages/BoxPanelPage';
import { CalcPanelPage } from '../e2e/pages/CalcPanelPage';
import { SettingsModalPage } from '../e2e/pages/SettingsModalPage';
import { AddPokemonModalPage } from '../e2e/pages/AddPokemonModalPage';

const requestedRepeatCount = Number(process.env.FBL04_PERF_REPEAT ?? '20');
const REPEAT_COUNT = Number.isSafeInteger(requestedRepeatCount) && requestedRepeatCount > 0
  ? requestedRepeatCount
  : 20;
const EVENT_TIMING_LOWER_BOUND_MS = 16;

type EventTimingSample = {
  name: string;
  durationMs: number;
  inputDelayMs: number;
  processingMs: number;
  presentationMs: number;
  interactionId: number;
  target: string;
};

type PerfLog = {
  name: string;
  detail: Record<string, unknown>;
};

type ActionSample = {
  scenario: string;
  action: string;
  iteration: number;
  automationWallMs: number;
  eventCount: number;
  eventDurationMs: number | null;
  eventDurationUpperBoundMs: number;
  inputDelayMs: number | null;
  processingMs: number | null;
  presentationMs: number | null;
  events: EventTimingSample[];
};

type BrowserPerfState = {
  events: EventTimingSample[];
  logs: PerfLog[];
};

type SummaryRow = {
  scenario: string;
  action: string;
  samples: number;
  observedEventSamples: number;
  eventDurationP75UpperBoundMs: number;
  eventDurationMaxUpperBoundMs: number;
  automationWallP75Ms: number;
  automationWallMaxMs: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function makeImportLines(count: number): string {
  const iv = '0RPAjRwdTEFu';
  return Array.from({ length: count }, (_, index) => `${iv}@perf-${String(index + 1).padStart(3, '0')}`).join('\n');
}

async function resetApplication(page: Page): Promise<void> {
  await page.goto('/?perf=1');
  await page.evaluate(() => {
    const onboarding = localStorage.getItem('candy-boost-planner:onboarding-done') ?? '1';
    const lang = localStorage.getItem('candy-boost-planner:lang') ?? 'ja';
    localStorage.clear();
    localStorage.setItem('candy-boost-planner:onboarding-done', onboarding);
    localStorage.setItem('candy-boost-planner:lang', lang);
  });
  await page.reload();
  await page.locator('#neo-calc').waitFor({ state: 'visible' });
  const supportsEventTiming = await page.evaluate(() => (
    typeof PerformanceObserver !== 'undefined'
    && PerformanceObserver.supportedEntryTypes.includes('event')
  ));
  expect(supportsEventTiming, 'Chromium must support Event Timing for this runner').toBe(true);
}

async function clearBrowserMetrics(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as unknown as { __fbl04Perf: BrowserPerfState }).__fbl04Perf;
    state.events.length = 0;
    state.logs.length = 0;
  });
}

async function settleInteraction(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
  }));
  await page.waitForTimeout(30);
}

async function measureAction(
  page: Page,
  samples: ActionSample[],
  scenario: string,
  actionName: string,
  iteration: number,
  action: () => Promise<void>,
  settled?: () => Promise<void>,
): Promise<void> {
  const start = await page.evaluate(() => {
    const state = (window as unknown as { __fbl04Perf: BrowserPerfState }).__fbl04Perf;
    return { now: performance.now(), eventCursor: state.events.length };
  });

  await action();
  if (settled) await settled();
  await settleInteraction(page);

  const captured = await page.evaluate(({ startedAt, eventCursor }) => {
    const state = (window as unknown as { __fbl04Perf: BrowserPerfState }).__fbl04Perf;
    return {
      wallMs: performance.now() - startedAt,
      events: state.events.slice(eventCursor),
    };
  }, { startedAt: start.now, eventCursor: start.eventCursor });

  const longest = captured.events.reduce<EventTimingSample | null>(
    (current, event) => current === null || event.durationMs > current.durationMs ? event : current,
    null,
  );
  samples.push({
    scenario,
    action: actionName,
    iteration,
    automationWallMs: round(captured.wallMs),
    eventCount: captured.events.length,
    eventDurationMs: longest?.durationMs ?? null,
    eventDurationUpperBoundMs: longest?.durationMs ?? EVENT_TIMING_LOWER_BOUND_MS,
    inputDelayMs: longest?.inputDelayMs ?? null,
    processingMs: longest?.processingMs ?? null,
    presentationMs: longest?.presentationMs ?? null,
    events: captured.events,
  });
  if (iteration === 1 || iteration === REPEAT_COUNT || iteration % 5 === 0) {
    console.info(`[perf-runner] ${scenario}/${actionName}: ${iteration}/${REPEAT_COUNT}`);
  }
}

async function replaceWithThreeDigits(input: Locator, value: number): Promise<void> {
  await input.click();
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await input.pressSequentially(String(value), { delay: 0 });
  await input.press('Tab');
}

async function collectPerfLogs(page: Page, target: PerfLog[]): Promise<void> {
  await page.waitForTimeout(650);
  const logs = await page.evaluate(() => {
    const state = (window as unknown as { __fbl04Perf: BrowserPerfState }).__fbl04Perf;
    return state.logs;
  });
  target.push(...logs);
}

function summarize(samples: ActionSample[]): SummaryRow[] {
  const groups = new Map<string, ActionSample[]>();
  for (const sample of samples) {
    const key = `${sample.scenario}\u0000${sample.action}`;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    scenario: group[0]?.scenario ?? '',
    action: group[0]?.action ?? '',
    samples: group.length,
    observedEventSamples: group.filter((sample) => sample.eventDurationMs !== null).length,
    eventDurationP75UpperBoundMs: round(percentile(group.map((sample) => sample.eventDurationUpperBoundMs), 0.75)),
    eventDurationMaxUpperBoundMs: round(Math.max(...group.map((sample) => sample.eventDurationUpperBoundMs))),
    automationWallP75Ms: round(percentile(group.map((sample) => sample.automationWallMs), 0.75)),
    automationWallMaxMs: round(Math.max(...group.map((sample) => sample.automationWallMs))),
  }));
}

function writeReport(samples: ActionSample[], perfLogs: PerfLog[]): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDirectory = resolve('_local', 'fbl04-interaction-perf', timestamp);
  mkdirSync(outputDirectory, { recursive: true });
  const summary = summarize(samples);
  const report = {
    generatedAt: new Date().toISOString(),
    browser: 'chromium / Desktop Chrome',
    build: 'Vite development server',
    repeatCount: REPEAT_COUNT,
    eventTimingDurationThresholdMs: EVENT_TIMING_LOWER_BOUND_MS,
    note: 'Missing Event Timing entries are reported conservatively as <16ms and use 16ms for upper-bound percentiles. automationWallMs includes Playwright transport and is not INP.',
    summary,
    samples,
    perfLogs,
  };
  writeFileSync(resolve(outputDirectory, 'detail.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const header = Object.keys(summary[0] ?? {}) as Array<keyof SummaryRow>;
  const lines = [
    header.join('\t'),
    ...summary.map((row) => header.map((key) => String(row[key])).join('\t')),
  ];
  writeFileSync(resolve(outputDirectory, 'summary.tsv'), `${lines.join('\n')}\n`, 'utf8');
  return outputDirectory;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    type CapturedState = { events: EventTimingSample[]; logs: PerfLog[] };
    const state: CapturedState = { events: [], logs: [] };
    (window as unknown as { __fbl04Perf: CapturedState }).__fbl04Perf = state;

    const originalInfo = console.info.bind(console);
    console.info = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[perf] ')) {
        const detail = args[1] && typeof args[1] === 'object'
          ? JSON.parse(JSON.stringify(args[1])) as Record<string, unknown>
          : {};
        state.logs.push({ name: args[0].slice('[perf] '.length), detail });
      }
      originalInfo(...args);
    };

    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('event')) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const event = entry as PerformanceEventTiming;
          const inputDelay = event.processingStart - event.startTime;
          const processing = event.processingEnd - event.processingStart;
          const presentation = Math.max(0, event.duration - inputDelay - processing);
          const target = event.target instanceof Element
            ? event.target.getAttribute('data-testid') ?? event.target.tagName.toLowerCase()
            : '(unknown)';
          state.events.push({
            name: event.name,
            durationMs: Math.round(event.duration * 100) / 100,
            inputDelayMs: Math.round(inputDelay * 100) / 100,
            processingMs: Math.round(processing * 100) / 100,
            presentationMs: Math.round(presentation * 100) / 100,
            interactionId: event.interactionId,
            target,
          });
        }
      });
      observer.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit & { durationThreshold: number });
    }
  });
});

test('collects local fbl04 interaction timings', async ({ page }, testInfo) => {
  const samples: ActionSample[] = [];
  const perfLogs: PerfLog[] = [];

  await resetApplication(page);
  const addBox = new BoxPanelPage(page);
  const addCalc = new CalcPanelPage(page);
  const addModal = new AddPokemonModalPage(page);
  await addBox.openImportPanel();
  await addBox.fillImportText(makeImportLines(280));
  await addBox.clickImport();
  await expect(addBox.boxTiles).toHaveCount(280);
  await addCalc.setBoostKind('none');
  await addModal.open();
  await clearBrowserMetrics(page);
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    if (!(await addModal.modal.isVisible())) await addModal.open();
    // Consume the delayed blur scheduled by the previous suggestion click,
    // then establish the same focused state as a user starting a new entry.
    await addModal.nameInput.blur();
    await page.waitForTimeout(0);
    await addModal.nameInput.focus();
    await addModal.fillAndPickName('ピカ');
    await settleInteraction(page);
    await measureAction(
      page,
      samples,
      'box-near-300',
      'add-modal-submit-to-box-and-calc',
      iteration,
      () => addModal.submitButton.click(),
      async () => {
        await expect(addBox.boxTiles).toHaveCount(280 + iteration);
        await addCalc.expectRowCount(iteration);
      },
    );
  }
  await collectPerfLogs(page, perfLogs);

  await resetApplication(page);
  const box = new BoxPanelPage(page);
  await box.openImportPanel();
  await box.fillImportText(makeImportLines(300));
  await box.clickImport();
  await expect(box.boxTiles).toHaveCount(300);
  await box.selectBoxTile(0);
  await box.expectDetailPanelVisible();
  await clearBrowserMetrics(page);

  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    await measureAction(page, samples, 'box-300', 'favorite-toggle', iteration, () => box.toggleDetailFavorite());
  }
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    await measureAction(page, samples, 'box-300', 'three-digit-exp-input', iteration, () => replaceWithThreeDigits(box.detailExpRemainingInput, 100 + iteration));
  }
  await collectPerfLogs(page, perfLogs);

  // Isolate history operations from the 40 edit actions above. Otherwise the
  // bounded application undo history changes the fixture during later cycles.
  await resetApplication(page);
  await box.openImportPanel();
  await box.fillImportText(makeImportLines(300));
  await box.clickImport();
  await expect(box.boxTiles).toHaveCount(300);
  await box.selectBoxTile(0);
  await box.expectDetailPanelVisible();
  await clearBrowserMetrics(page);
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    if (iteration > 1 && (iteration - 1) % 5 === 0) {
      await collectPerfLogs(page, perfLogs);
      await resetApplication(page);
      await box.openImportPanel();
      await box.fillImportText(makeImportLines(300));
      await box.clickImport();
      await expect(box.boxTiles).toHaveCount(300);
      await box.selectBoxTile(0);
      await box.expectDetailPanelVisible();
      await clearBrowserMetrics(page);
    }
    await measureAction(page, samples, 'box-300', 'delete', iteration, () => box.clickDeleteFromBox(), () => expect(box.boxTiles).toHaveCount(299));
    await measureAction(page, samples, 'box-300', 'undo', iteration, () => box.clickUndo(), () => expect(box.boxTiles).toHaveCount(300));
    await measureAction(page, samples, 'box-300', 'redo', iteration, () => box.clickRedo(), () => expect(box.boxTiles).toHaveCount(299));
    await box.clickUndo();
    await expect(box.boxTiles).toHaveCount(300);
    await expect(box.detailPanel).toBeVisible();
  }
  await collectPerfLogs(page, perfLogs);

  await resetApplication(page);
  const calcBox = new BoxPanelPage(page);
  const calc = new CalcPanelPage(page);
  await calcBox.openImportPanel();
  await calcBox.fillImportText(makeImportLines(10));
  await calcBox.clickImport();
  await expect(calcBox.boxTiles).toHaveCount(10);
  for (let slot = 0; slot < 3; slot++) {
    await calc.clickSlotTab(slot);
    await calc.setBoostKind('none');
    for (let row = 0; row < 10; row++) {
      await calcBox.selectBoxTile(row);
      await calcBox.clickApplyToCalc();
    }
    await calc.expectRowCount(10);
  }
  await calc.clickSlotTab(0);
  await clearBrowserMetrics(page);

  const firstRow = calc.getRow(0);
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    await measureAction(page, samples, 'calc-10x3', 'three-digit-exp-input', iteration, () => replaceWithThreeDigits(calc.getRowExpRemainingInput(firstRow), 200 + iteration));
  }
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    await measureAction(page, samples, 'calc-10x3', 'three-digit-species-candy-input', iteration, () => replaceWithThreeDigits(calc.getRowSpeciesCandyInput(firstRow), 300 + iteration));
  }
  await collectPerfLogs(page, perfLogs);

  // Cloudflare Web Analyticsで遅延が観測された直接input要素。
  // 通常モードではなく実際のアメブ個数入力として測るため、計測外でミニブへ切り替える。
  await calc.setBoostKind('mini');
  await calc.waitForPlannerResult(60_000);
  await clearBrowserMetrics(page);
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    await measureAction(page, samples, 'calc-10x3-mini', 'three-digit-boost-candy-input', iteration, () => replaceWithThreeDigits(calc.getRowBoostCandyInput(firstRow), 100 + iteration));
  }
  await collectPerfLogs(page, perfLogs);
  await calc.setBoostKind('none');
  await calc.waitForPlannerResult(60_000);
  await clearBrowserMetrics(page);
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    const slot = iteration % 3;
    await measureAction(page, samples, 'calc-10x3', 'slot-switch', iteration, () => calc.clickSlotTab(slot));
  }
  await calc.clickSlotTab(0);
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    await measureAction(page, samples, 'calc-10x3', 'delete', iteration, () => calc.deleteRow(calc.getRow(0)), () => calc.expectRowCount(9));
    await measureAction(page, samples, 'calc-10x3', 'undo', iteration, () => calc.clickUndo(), () => calc.expectRowCount(10));
  }
  await collectPerfLogs(page, perfLogs);

  const settings = new SettingsModalPage(page);
  await settings.openSettingsFromDesktop();
  await clearBrowserMetrics(page);
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    await measureAction(page, samples, 'candy-inventory', 'universal-s-three-digit-input', iteration, () => replaceWithThreeDigits(settings.universalCandySInput, 400 + iteration));
  }
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration++) {
    const electricS = page.getByTestId('settings-type-candy-Electric-s-input');
    await measureAction(page, samples, 'candy-inventory', 'type-s-three-digit-input', iteration, () => replaceWithThreeDigits(electricS, 500 + iteration));
  }
  await collectPerfLogs(page, perfLogs);

  const outputDirectory = writeReport(samples, perfLogs);
  testInfo.annotations.push({ type: 'performance-report', description: outputDirectory });
  console.info(`fbl04 interaction performance report: ${outputDirectory}`);
});
