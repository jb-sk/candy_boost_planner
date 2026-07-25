import { beforeEach, describe, expect, it } from "vitest";
import { loadCalcSlots, loadSleepSettings, loadTotalShards, saveSleepSettings, saveTotalShards, DEFAULT_SLEEP_SETTINGS } from "./calc";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
}

describe("persistence/calc sleepSettings", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("returns defaults when nothing is stored", () => {
    const settings = loadSleepSettings();
    expect(settings).toEqual(DEFAULT_SLEEP_SETTINGS);
  });

  it("round-trips saved settings", () => {
    const custom = { dailySleepHours: 7, sleepExpBonusCount: 3, includeGSD: false };
    saveSleepSettings(custom);
    const loaded = loadSleepSettings();
    expect(loaded).toEqual(custom);
  });

  it("returns defaults after removing settings", () => {
    saveSleepSettings({ dailySleepHours: 6, sleepExpBonusCount: 2, includeGSD: true });
    saveSleepSettings(undefined);
    expect(loadSleepSettings()).toEqual(DEFAULT_SLEEP_SETTINGS);
  });

  it("falls back to defaults for invalid stored JSON", () => {
    localStorage.setItem("candy-boost-planner:calc:sleepSettings", "not-json");
    expect(loadSleepSettings()).toEqual(DEFAULT_SLEEP_SETTINGS);
  });

  it("falls back to defaults for out-of-range values", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:sleepSettings",
      JSON.stringify({ dailySleepHours: 20, sleepExpBonusCount: -1, includeGSD: "yes" }),
    );
    expect(loadSleepSettings()).toEqual(DEFAULT_SLEEP_SETTINGS);
  });

  it("fills missing fields with defaults when partial data is stored", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:sleepSettings",
      JSON.stringify({ dailySleepHours: 10 }),
    );
    const loaded = loadSleepSettings();
    expect(loaded.dailySleepHours).toBe(10);
    expect(loaded.sleepExpBonusCount).toBe(DEFAULT_SLEEP_SETTINGS.sleepExpBonusCount);
    expect(loaded.includeGSD).toBe(DEFAULT_SLEEP_SETTINGS.includeGSD);
  });
});

describe("persistence/calc slots", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  const row = {
    id: "row-1",
    title: "テスト",
    srcLevel: 10,
    dstLevel: 20,
    expRemaining: 100,
    expType: 600 as const,
    nature: "normal" as const,
    boostReachLevel: 10,
    boostRatioPct: 0,
    mode: "targetLevel" as const,
  };

  it("fills missing itemCompareMode with the current default", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({
        schemaVersion: 1,
        slots: [
          {
            savedAt: "2026-07-13T00:00:00.000Z",
            rows: [row],
            activeRowId: "row-1",
            boostKind: "mini",
          },
        ],
      }),
    );

    const slots = loadCalcSlots();

    expect(slots[0]?.itemCompareMode).toBe("surplusFirst");
  });

  it("keeps reading raw slot arrays, removed row modes, and slots without boostKind", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify([{
        savedAt: "2025-01-01T00:00:00.000Z",
        rows: [{ ...row, mode: "legacyMode" }],
        activeRowId: "row-1",
      }]),
    );

    const slots = loadCalcSlots();

    expect(slots[0]?.boostKind).toBe("mini");
    expect(slots[0]?.itemCompareMode).toBe("surplusFirst");
    // mode は廃止フィールド。読み捨てられ、保存形式にも現れない（設計書§6.1）
    expect(slots[0]?.rows[0]).not.toHaveProperty("mode");
    expect(slots.slice(1)).toEqual([null, null]);
  });

  it("falls back to the current default for unknown itemCompareMode values", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({
        schemaVersion: 1,
        slots: [
          {
            savedAt: "2026-07-13T00:00:00.000Z",
            rows: [row],
            activeRowId: "row-1",
            boostKind: "mini",
            itemCompareMode: "unknown",
          },
        ],
      }),
    );

    const slots = loadCalcSlots();

    expect(slots[0]?.itemCompareMode).toBe("surplusFirst");
  });

  it("preserves the surplus 0-2 priority itemCompareMode", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({
        schemaVersion: 1,
        slots: [
          {
            savedAt: "2026-07-13T00:00:00.000Z",
            rows: [row],
            activeRowId: "row-1",
            boostKind: "mini",
            itemCompareMode: "surplusGateFirst",
          },
        ],
      }),
    );

    const slots = loadCalcSlots();

    expect(slots[0]?.itemCompareMode).toBe("surplusGateFirst");
  });

  it("migrates legacy mode:'peak' rows to candyTarget without losing the entered candy count", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({
        schemaVersion: 1,
        slots: [
          {
            savedAt: "2026-07-25T00:00:00.000Z",
            rows: [
              // peak: boostOrExpAdjustment（入力された総アメ数）を引き継ぐ
              { ...row, id: "peak-adj", mode: "peak", boostOrExpAdjustment: 608, candyPeak: 100 },
              // peak かつ boostOrExpAdjustment なし: candyPeak へフォールバック
              { ...row, id: "peak-fallback", mode: "peak", candyPeak: 77 },
              // targetLevel: 既存 candyTarget を維持
              { ...row, id: "target-with", mode: "targetLevel", candyTarget: 42, boostOrExpAdjustment: 5 },
              // targetLevel かつ candyTarget なし: undefined のまま（個数指定なし）
              { ...row, id: "target-without", mode: "targetLevel", boostOrExpAdjustment: 5 },
              // 明示的な candyTarget は peak でも優先される
              { ...row, id: "peak-with-target", mode: "peak", candyTarget: 11, boostOrExpAdjustment: 608 },
            ],
            activeRowId: "peak-adj",
            boostKind: "mini",
          },
        ],
      }),
    );

    const loaded = loadCalcSlots()[0]?.rows ?? [];
    const byId = (id: string) => loaded.find((r) => r.id === id);

    expect(byId("peak-adj")?.candyTarget).toBe(608);
    expect(byId("peak-fallback")?.candyTarget).toBe(77);
    expect(byId("target-with")?.candyTarget).toBe(42);
    expect(byId("target-without")?.candyTarget).toBeUndefined();
    expect(byId("peak-with-target")?.candyTarget).toBe(11);
  });

  it("reads sleepTargetHours only when it is one of the dropdown options", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({
        schemaVersion: 1,
        slots: [
          {
            savedAt: "2026-07-25T00:00:00.000Z",
            rows: [
              { ...row, id: "row-valid", sleepTargetHours: 1000 },
              { ...row, id: "row-invalid", sleepTargetHours: 999 },
              { ...row, id: "row-unset" },
            ],
            activeRowId: "row-valid",
            boostKind: "mini",
          },
        ],
      }),
    );

    const slots = loadCalcSlots();

    expect(slots[0]?.rows.find((r) => r.id === "row-valid")?.sleepTargetHours).toBe(1000);
    expect(slots[0]?.rows.find((r) => r.id === "row-invalid")?.sleepTargetHours).toBeUndefined();
    expect(slots[0]?.rows.find((r) => r.id === "row-unset")?.sleepTargetHours).toBeUndefined();
  });

  it("preserves itemCompareMode for an empty configured slot", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({
        schemaVersion: 1,
        slots: [
          {
            slotId: "slot-empty",
            savedAt: "2026-07-13T00:00:00.000Z",
            rows: [],
            activeRowId: null,
            boostKind: "mini",
            itemCompareMode: "surplusGateFirst",
          },
        ],
      }),
    );

    const slots = loadCalcSlots();

    expect(slots[0]?.rows).toEqual([]);
    expect(slots[0]?.itemCompareMode).toBe("surplusGateFirst");
  });

});

describe("persistence/calc totalShards", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("keeps the existing storage key while using the current API name", () => {
    saveTotalShards(1234.9);

    expect(localStorage.getItem("candy-boost-planner:calc:totalShards")).toBe("1234");
    expect(loadTotalShards()).toBe(1234);
  });
});
