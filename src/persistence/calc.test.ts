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
    expect(slots[0]?.rows[0]?.mode).toBe("targetLevel");
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
