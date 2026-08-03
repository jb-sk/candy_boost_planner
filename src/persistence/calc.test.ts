import { beforeEach, describe, expect, it } from "vitest";
import { loadCalcSlots, loadDefaultBoostReachLevel, loadSleepSettings, loadTotalShards, saveDefaultBoostReachLevel, saveSleepSettings, saveTotalShards, serializeCalcSlots, DEFAULT_BOOST_REACH_LEVEL_KEY, DEFAULT_SLEEP_SETTINGS } from "./calc";
import { calcExp } from "../domain/pokesleep/exp";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";

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
              { ...row, id: "row-valid", candyTarget: 40, sleepTargetHours: 1000 },
              { ...row, id: "row-invalid", candyTarget: 40, sleepTargetHours: 999 },
              { ...row, id: "row-unset" },
              // 個数指定なしでも睡眠目標は独立して保持する
              { ...row, id: "row-no-candy-target", sleepTargetHours: 1000 },
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
    expect(slots[0]?.rows.find((r) => r.id === "row-no-candy-target")?.sleepTargetHours).toBe(1000);
  });

  it("§13-3: localStorage は有効な all だけを読み、数値・個数指定との同居はモード優先で正規化する", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({
        schemaVersion: 2,
        slots: [{
          savedAt: "2026-07-30T00:00:00.000Z",
          rows: [
            { ...row, id: "all", sleepTargetMode: "all", sleepTargetHours: 1000, candyTarget: 40, dstExpInLevel: 10 },
            { ...row, id: "invalid", sleepTargetMode: "everything", sleepTargetHours: 1000 },
          ],
          activeRowId: "all",
          boostKind: "full",
        }, null, null],
      }),
    );

    const rows = loadCalcSlots()[0]!.rows;
    expect(rows[0]).toMatchObject({
      sleepTargetMode: "all",
      sleepTargetHours: undefined,
      candyTarget: undefined,
      dstExpInLevel: undefined,
    });
    expect(rows[1]!.sleepTargetMode).toBeUndefined();
    expect(rows[1]!.sleepTargetHours).toBe(1000);
  });

  it("normalizes dstExpInLevel: drops it without candyTarget and clamps it below the next level requirement", () => {
    const toNext = calcExp(20, 21, 600);
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({
        schemaVersion: 1,
        slots: [
          {
            savedAt: "2026-07-25T00:00:00.000Z",
            rows: [
              { ...row, id: "no-target", dstExpInLevel: 300 },
              { ...row, id: "kept", candyTarget: 40, dstExpInLevel: 300 },
              { ...row, id: "overflow", candyTarget: 40, dstExpInLevel: toNext + 999 },
            ],
            activeRowId: null,
            boostKind: "mini",
          },
        ],
      }),
    );

    const loaded = loadCalcSlots()[0]?.rows ?? [];
    const byId = (id: string) => loaded.find((r) => r.id === id);

    // 個数指定なしの目標は常に Lv ちょうど
    expect(byId("no-target")?.dstExpInLevel).toBeUndefined();
    expect(byId("kept")?.dstExpInLevel).toBe(300);
    expect(byId("overflow")?.dstExpInLevel).toBe(toNext - 1);
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

  it("writes schemaVersion 2, drops indistinguishable V1 boost values, and preserves explicit V2 values", () => {
    const slot = {
      slotId: "slot-schema",
      savedAt: "2026-07-28T00:00:00.000Z",
      rows: [{ ...row, boostReachLevel: 25, boostOrExpAdjustment: 50 }],
      activeRowId: "row-1",
      boostKind: "mini" as const,
    };
    expect(JSON.parse(serializeCalcSlots([slot, null, null])).schemaVersion).toBe(2);

    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({ schemaVersion: 1, slots: [slot, null, null] }),
    );
    expect(loadCalcSlots()[0]?.rows[0]?.boostOrExpAdjustment).toBeUndefined();

    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({ schemaVersion: 2, slots: [slot, null, null] }),
    );
    expect(loadCalcSlots()[0]?.rows[0]?.boostOrExpAdjustment).toBe(50);
  });

  it("recovers effectiveN ≤ m without cutting saved boostReachLevel down to dstLevel", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({
        schemaVersion: 2,
        slots: [{
          savedAt: "2026-07-28T00:00:00.000Z",
          rows: [{
            ...row,
            dstLevel: 20,
            boostReachLevel: 40,
            boostOrExpAdjustment: 500,
            candyTarget: 10,
            dstExpInLevel: 12,
          }],
          activeRowId: "row-1",
          boostKind: "full",
        }, null, null],
      }),
    );

    const loaded = loadCalcSlots()[0]!.rows[0]!;
    expect(loaded.boostOrExpAdjustment).toBe(10);
    expect(loaded.boostReachLevel).toBe(40);
    expect(loaded.dstExpInLevel).toBe(12);
  });

});

describe("persistence/calc slotId", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("旧データの ID 無しスロットにも読み込み時に採番する", () => {
    // ID が無いままだと、一度も開いていないスロットが ID 無しでエクスポートされ、
    // バックアップ検証（slotId 必須）が自分の書き出しを弾く
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({ schemaVersion: 2, slots: [null, { savedAt: "2026-07-22T07:30:00.000Z", rows: [], activeRowId: null, boostKind: "full" }, null] }),
    );

    const slots = loadCalcSlots();

    expect(slots[1]).not.toBeNull();
    expect(typeof slots[1]!.slotId).toBe("string");
    expect(slots[1]!.slotId).not.toBe("");
  });

  it("空スロットは採番せず null のまま（採番が空判定を壊さない）", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:slots:v1",
      JSON.stringify({ schemaVersion: 2, slots: [null, { savedAt: "2026-07-22T07:30:00.000Z", rows: [], activeRowId: null }, null] }),
    );

    expect(loadCalcSlots()[1]).toBeNull();
  });
});

describe("persistence/calc defaultBoostReachLevel", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("returns null when nothing is stored (＝目標Lvと同じ)", () => {
    expect(loadDefaultBoostReachLevel()).toBeNull();
  });

  it("round-trips a level", () => {
    saveDefaultBoostReachLevel(35);
    expect(loadDefaultBoostReachLevel()).toBe(35);
  });

  it("removes the key for null so that 未設定 stays distinguishable from 0", () => {
    saveDefaultBoostReachLevel(35);
    saveDefaultBoostReachLevel(null);
    expect(localStorage.getItem(DEFAULT_BOOST_REACH_LEVEL_KEY)).toBeNull();
    expect(loadDefaultBoostReachLevel()).toBeNull();
  });

  it("floors fractional input and treats 0 as 未設定", () => {
    saveDefaultBoostReachLevel(35.9);
    expect(loadDefaultBoostReachLevel()).toBe(35);
    // Lv0 は Lv として意味を持たない。黙って Lv1（＝アメブほぼ無し）にせず未設定へ倒す
    saveDefaultBoostReachLevel(0);
    expect(loadDefaultBoostReachLevel()).toBeNull();
  });

  it("caps at MAX_LEVEL so that a stored value never fails our own backup validator", () => {
    saveDefaultBoostReachLevel(999);
    expect(loadDefaultBoostReachLevel()).toBe(MAX_LEVEL);

    // 手で書き換えられた値も読み出しで収める
    localStorage.setItem(DEFAULT_BOOST_REACH_LEVEL_KEY, "999");
    expect(loadDefaultBoostReachLevel()).toBe(MAX_LEVEL);
  });

  it("falls back to null for values that are not usable levels", () => {
    for (const raw of ["", "abc", "0", "-3", "NaN"]) {
      localStorage.setItem(DEFAULT_BOOST_REACH_LEVEL_KEY, raw);
      expect(loadDefaultBoostReachLevel()).toBeNull();
    }
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
