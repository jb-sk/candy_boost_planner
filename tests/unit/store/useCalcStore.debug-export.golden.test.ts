import { fileURLToPath } from "node:url";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deterministicIds = vi.hoisted(() => ({ next: 1 }));

vi.mock("../../../src/persistence/box", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/persistence/box")>();
  return {
    ...actual,
    cryptoRandomId: () => `golden-id-${deterministicIds.next++}`,
  };
});

// Generated events change every day. This independent, fixed module fixture keeps the
// store wiring under test without coupling the goldens to auto-update-events.yml.
vi.mock("../../../src/domain/pokesleep/_generated/sleep-exp-events", () => ({
  sleepExpEventSegments: [
    { name: "Golden real event", from: "2026-08-24", to: "2026-08-30", multiplier: 1.5, source: "wiki" },
  ],
  sleepExpEventAnchors: [
    { match: "Golden real event", month: 8, day: 27 },
  ],
  sleepExpEventFlowers: [
    { match: "Golden real event", days: 7 },
  ],
  eventHistory: [],
  wikiKnownThrough: "2026-08-30",
}));

import { useCalcStore } from "../../../src/composables/useCalcStore";
import { useCandyStore } from "../../../src/composables/useCandyStore";
import { cancelPersist } from "../../../src/persistence/deferredPersist";

const GOLDEN_DIR = fileURLToPath(new URL("../goldens/debug-export", import.meta.url));
const t = ((key: string) => key) as unknown as Composer["t"];

// TSV の row 行は実運用フォーマットをそのまま守るため長い。失敗時は、日付単位で読める
// sleep-schedule ゴールデンの差分を先に確認してから、この配線全体の差分を追うこと。

function installLocalStorageMock(): void {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
}

function normalizeRuntimeMeasurements(tsv: string): string {
  const lines = tsv.replaceAll("\r\n", "\n").split("\n");
  for (let lineIndex = 0; lineIndex < lines.length - 1; lineIndex++) {
    const headers = lines[lineIndex]!.split("\t");
    const timingColumns = headers
      .map((header, index) => /^(?:actualDuration|feasibility|refine|duration|witnessRestore)Ms$/.test(header) ? index : -1)
      .filter(index => index >= 0);
    if (timingColumns.length === 0) continue;
    // 同じ表のデータ行が将来複数になっても、空行または次の異なる表まで全行を正規化する。
    for (let dataIndex = lineIndex + 1; dataIndex < lines.length; dataIndex++) {
      const values = lines[dataIndex]!.split("\t");
      if (values.length !== headers.length) break;
      for (const index of timingColumns) {
        if (values[index] !== undefined && values[index] !== "") values[index] = "<timing>";
      }
      lines[dataIndex] = values.join("\t");
    }
  }
  return lines.join("\n");
}

function addStandardRow(store: ReturnType<typeof useCalcStore>, suffix: string): string {
  store.upsertFromBox({
    boxId: `golden-${suffix}`,
    title: `Golden ${suffix}`,
    pokedexId: 25,
    pokemonType: "Electric",
    srcLevel: 10,
    dstLevelDefault: 40,
    expRemaining: 120,
    expType: 600,
    nature: "normal",
  });
  return store.rows.value.at(-1)!.id;
}

function createGoldenStore(
  options: Parameters<typeof useCalcStore>[0],
): ReturnType<typeof useCalcStore> {
  const store = useCalcStore(options);
  // ゴールデンは日本時間を前提にしているため、実行ホストのタイムゾーンを継承しない。
  store.updateSleepSettings({ timeZone: "Asia/Tokyo" });
  return store;
}

async function goldenTsv(store: ReturnType<typeof useCalcStore>): Promise<string> {
  await vi.waitFor(() => {
    expect(store.planResultPending.value).toBe(false);
    expect(store.planResult.value?.pokemonResults).toHaveLength(store.rows.value.length);
  }, { timeout: 10_000 });
  return normalizeRuntimeMeasurements(await store.buildDebugExportTsv());
}

describe("useCalcStore debug-export golden contract", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
    deterministicIds.next = 1;
    useCandyStore().resetInventory();
  });

  afterEach(() => cancelPersist());

  it("keeps the candy-only planner isolated from all sleep inputs", async () => {
    const store = createGoldenStore({ locale: ref("ja"), t, currentGameDate: "2026-08-24" });
    addStandardRow(store, "candy-only");
    store.onTotalShardsInput("500000");

    await expect(await goldenTsv(store)).toMatchFileSnapshot(`${GOLDEN_DIR}/candy-only.tsv`);
  });

  it("keeps long sleep planning, repeated GSD periods, and incense placement wired together", async () => {
    const store = createGoldenStore({ locale: ref("ja"), t, currentGameDate: "2026-07-20" });
    const id = addStandardRow(store, "long-gsd");
    store.setRowSleepTargetHours(id, 2000);
    store.updateSleepSettings({
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 2,
      growthIncenseStock: null,
      useProjectedEvents: false,
      blueSeedPlantWeekday: null,
    });

    await expect(await goldenTsv(store)).toMatchFileSnapshot(`${GOLDEN_DIR}/long-gsd-incense.tsv`);
  });

  it("keeps all-sleep mode free of candy allocation while preserving its sleep breakdown", async () => {
    const store = createGoldenStore({ locale: ref("ja"), t, currentGameDate: "2026-08-24" });
    const id = addStandardRow(store, "all-sleep");
    store.setRowSleepTarget(id, "all");
    store.updateSleepSettings({
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 1,
      growthIncenseStock: null,
    });

    await expect(await goldenTsv(store)).toMatchFileSnapshot(`${GOLDEN_DIR}/all-sleep.tsv`);
  });

  it("keeps weekly-only incense on high-multiplier days while all GSD incense flags stay off", async () => {
    const store = createGoldenStore({ locale: ref("ja"), t, currentGameDate: "2026-08-24" });
    const id = addStandardRow(store, "gsd-off-weekly-only");
    store.setRowSleepTarget(id, "all");
    store.updateSleepSettings({
      includeGSD: true,
      growthIncenseNormalPerWeek: 2,
      growthIncenseStock: null,
    });

    await expect(await goldenTsv(store)).toMatchFileSnapshot(`${GOLDEN_DIR}/gsd-off-weekly-only.tsv`);
  });

  it("keeps stock-plus-sleep candy allocation and its boost-candy half-lock", async () => {
    const store = createGoldenStore({ locale: ref("ja"), t, currentGameDate: "2026-08-24" });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("50");
    const id = addStandardRow(store, "stock-sleep");
    store.setDstLevel(id, 55);
    store.updateSpeciesCandy(25, 80);
    store.setRowSleepTarget(id, "stock");
    store.onRowBoostCandy(id, "50");
    store.updateSleepSettings({
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: true, afterFullMoon: true },
    });

    await expect(await goldenTsv(store)).toMatchFileSnapshot(`${GOLDEN_DIR}/stock-plus-sleep.tsv`);
  });

  it("keeps incenseOutOfStock visible after finite stock is exhausted", async () => {
    const store = createGoldenStore({ locale: ref("ja"), t, currentGameDate: "2026-08-24" });
    const id = addStandardRow(store, "incense-stock");
    store.setRowSleepTargetHours(id, 1000);
    store.updateSleepSettings({
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: true, afterFullMoon: true },
      growthIncenseNormalPerWeek: 7,
      growthIncenseStock: 3,
    });

    await expect(await goldenTsv(store)).toMatchFileSnapshot(`${GOLDEN_DIR}/incense-out-of-stock.tsv`);
  });

  it("keeps real, projected, and flower overlaps on the outer max multiplier", async () => {
    const store = createGoldenStore({
      locale: ref("ja"),
      t,
      currentGameDate: "2026-08-24",
      sleepEventFixture: {
        projectedOccurrences: [{
          name: "Golden projected event",
          sourceFrom: "2025-08-27",
          from: "2026-08-27",
          to: "2026-08-30",
          multiplier: 2.25,
          month: 8,
          weekOfMonth: 4,
        }],
        blueSeedSegments: [
          { from: "2026-08-28", to: "2026-08-31", multiplier: 2.5, source: "flower" },
          { from: "2026-08-29", to: "2026-08-29", multiplier: 3, source: "projectedFlower" },
        ],
        blueSeedShifts: [{ year: 2026, from: "2026-08-28", to: "2026-08-31" }],
      },
    });
    const id = addStandardRow(store, "overlapping-events");
    // 44h = five complete nights + a partial sixth night. The sixth night is the
    // projected-flower maximum and has planned incense, so TSV must report `skipped`.
    store.setRowSleepTargetHours(id, 44);
    store.updateSleepSettings({
      includeGSD: true,
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: true, afterFullMoon: true },
      useProjectedEvents: true,
      blueSeedPlantWeekday: 1,
      growthIncenseNormalPerWeek: 2,
    });

    await expect(await goldenTsv(store)).toMatchFileSnapshot(`${GOLDEN_DIR}/overlapping-events.tsv`);
  });
});
