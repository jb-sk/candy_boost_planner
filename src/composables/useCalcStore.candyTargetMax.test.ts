import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import type { CalcRow, CalcStore } from "./useCalcStore";
import { useCandyStore } from "./useCandyStore";
import { calcExp } from "../domain/pokesleep/exp";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { cancelPersist } from "../persistence/deferredPersist";
import { addBoxRow, createCalcStore, type BoxRowInput } from "../../tests/helpers/fakeIndividuals";

const t = ((key: string) => key) as unknown as Composer["t"];

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
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
    },
    configurable: true,
    writable: true,
  });
}

/**
 * 個数指定の上限（`maxCandyTargetFor`）は、その行で入れて意味のある最大の個数
 * ＝ MAX_LEVEL に届く最小の個数（calc-row-input-spec §4.6「MAX_LEVEL 到達に必要なアメ数から、睡眠EXPで賄える分を引いた値」）。
 * 上限ちょうどを保存した行は Lv70 に届き、上限−1 では届かないことを、アメブの種類・行の状態ごとに検査する。
 */
describe("useCalcStore: 個数指定の上限は MAX_LEVEL に届く最小の個数", () => {
  const candyStore = useCandyStore();
  let originalInventory: ReturnType<typeof candyStore.getInventory>;

  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
    originalInventory = candyStore.getInventory();
    candyStore.resetInventory();
  });

  afterEach(() => {
    candyStore.restoreInventory(originalInventory);
    cancelPersist();
  });

  const rowOf = (store: CalcStore, id: string) => store.rows.value.find((r) => r.id === id)!;
  const reachesMax = (row: CalcRow) => row.dstLevel === MAX_LEVEL;

  function storeWith(kind: "full" | "mini" | "none", individual: Partial<BoxRowInput> = {}) {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind(kind);
    store.onBoostCandyRemainingInput("100000");
    store.updateSpeciesCandy(25, 100_000);
    addBoxRow(store, { boxId: "x", pokedexId: 25, srcLevel: 10, dstLevelDefault: 60, expType: 600, nature: "normal", ...individual });
    return { store, id: store.rows.value[0]!.id };
  }

  /** 上限ちょうどで Lv70 に届き、上限−1 では届かない（withCandyTarget と計算機の個数欄の両方）。 */
  function expectMaxIsMinimalToReach(store: CalcStore, id: string) {
    const row = rowOf(store, id);
    const atHuge = store.withCandyTarget(row, 1_000_000);
    const max = atHuge.candyTarget!;
    expect(max).toBeGreaterThan(0);
    // 上限を入れた行は Lv70 に届き、実際に要る最小の個数になっている
    expect(reachesMax(atHuge)).toBe(true);
    const below = store.withCandyTarget(row, max - 1);
    expect(below.candyTarget).toBe(max - 1);
    expect(reachesMax(below)).toBe(false);

    // 計算機の個数欄で入れて保存した行でも同じ
    store.onRowCandyTarget(id, String(max));
    expect(reachesMax(rowOf(store, id))).toBe(true);
    store.onRowCandyTarget(id, String(max - 1));
    expect(reachesMax(rowOf(store, id))).toBe(false);
  }

  type Setup = (store: CalcStore, id: string) => void;
  const setups: Array<[string, Setup]> = [
    ["睡眠目標なし・アメブ目標Lv既定", () => {}],
    ["睡眠目標なし・目標Lvを下げて保存", (s, id) => s.setDstLevel(id, 30)],
    ["時間の睡眠目標", (s, id) => s.setRowSleepTargetHours(id, 200)],
    ["時間の睡眠目標・目標Lvを下げて保存", (s, id) => {
      s.setRowSleepTargetHours(id, 200);
      s.setDstLevel(id, 40);
    }],
    ["アメブ最小化の行", (s, id) => s.setRowMinimizeBoost(id, true)],
    ["アメブ最小化の行・時間の睡眠目標", (s, id) => {
      s.setRowMinimizeBoost(id, true);
      s.setRowSleepTargetHours(id, 200);
    }],
    ["明示アメブの行", (s, id) => s.onRowBoostCandy(id, "30")],
    // 個数欄はアメブ欄の上限で抑えるので、要る数より多い値は前の版で保存した行・取り込んだ行として直接入れる
    ["明示アメブが Lv70 までに要る数より多い行", (s, id) => {
      const rows = s.rows.value;
      s.applyFineTuneDraft({ rows: rows.map((r) => (r.id === id ? { ...r, boostOrExpAdjustment: 100_000 } : r)), speciesCandy: {}, label: "test", expectedBase: rows });
      expect(rowOf(s, id).boostOrExpAdjustment).toBe(100_000);
    }],
    ["アメブ目標Lvを下げた行", (s, id) => {
      s.setBoostLevel(id, 40);
      expect(rowOf(s, id).boostReachLevel).toBe(40);
    }],
    ["アメブ目標Lvを下げた行・時間の睡眠目標", (s, id) => {
      s.setRowSleepTargetHours(id, 200);
      s.setBoostLevel(id, 30);
      expect(rowOf(s, id).boostReachLevel).toBe(30);
    }],
    ["性格 EXP↑", (s, id) => s.setNature(id, "up")],
    ["性格 EXP↓・時間の睡眠目標", (s, id) => {
      s.setNature(id, "down");
      s.setRowSleepTargetHours(id, 200);
    }],
  ];

  for (const kind of ["full", "mini", "none"] as const) {
    for (const [label, setup] of setups) {
      it(`${kind} / ${label}: 上限ちょうどで Lv${MAX_LEVEL} に届き、上限−1 では届かない`, () => {
        const { store, id } = storeWith(kind);
        setup(store, id);
        expectMaxIsMinimalToReach(store, id);
      });
    }
  }

  // EXP の繰り越しと丸めの境界。上の表は Lv10・expType 600 だけなので、EXPタイプ・開始Lv・Lv内EXP を振る
  const individuals: Array<[string, Partial<BoxRowInput>]> = [
    ["expType 1320", { expType: 1320 }],
    ["Lv24・expType 1080", { srcLevel: 24, expType: 1080 }],
    ["Lv25・expType 900", { srcLevel: 25, expType: 900 }],
    ["Lv29", { srcLevel: 29 }],
    ["Lv30・expType 1320", { srcLevel: 30, expType: 1320 }],
    ["Lv69", { srcLevel: 69, dstLevelDefault: 70 }],
    ["次のLvまで残り1（expType 1320）", { srcLevel: 12, expType: 1320, expRemaining: 1 }],
    ["Lv内EXPが途中（expType 900）", { srcLevel: 40, expType: 900, expRemaining: 37 }],
  ];
  const sleepHoursFor = (individual: Partial<BoxRowInput>) => ((individual.srcLevel ?? 10) >= 60 ? 1 : 30);
  for (const kind of ["full", "mini", "none"] as const) {
    for (const [label, individual] of individuals) {
      it(`${kind} / ${label}: 上限ちょうどで Lv${MAX_LEVEL} に届き、上限−1 では届かない`, () => {
        const { store, id } = storeWith(kind, individual);
        expectMaxIsMinimalToReach(store, id);
      });
      it(`${kind} / ${label}・時間の睡眠目標（T'max が Lv の途中）: 上限ちょうどで Lv${MAX_LEVEL} に届き、上限−1 では届かない`, () => {
        const { store, id } = storeWith(kind, individual);
        store.setRowSleepTargetHours(id, sleepHoursFor(individual));
        expect(store.rowSleepExpFor(id)).toBeGreaterThan(0);
        expectMaxIsMinimalToReach(store, id);
      });
    }
  }

  describe("上限が0の行", () => {
    it("睡眠EXPだけで Lv70 に届く行は、上限が0で、どれだけ入れても0個のまま Lv70 に届く", () => {
      const { store, id } = storeWith("full", { srcLevel: 68 });
      store.setRowSleepTargetHours(id, 1000);
      const row = rowOf(store, id);
      expect(store.rowSleepExpFor(id)).toBeGreaterThanOrEqual(calcExp(68, MAX_LEVEL, 600));
      const atHuge = store.withCandyTarget(row, 1_000_000);
      expect(atHuge.candyTarget).toBe(0);
      expect(reachesMax(atHuge)).toBe(true);
    });

    it(`現在Lv${MAX_LEVEL} の行は、上限が0`, () => {
      const { store, id } = storeWith("full", { srcLevel: MAX_LEVEL, dstLevelDefault: MAX_LEVEL });
      const atHuge = store.withCandyTarget(rowOf(store, id), 1_000_000);
      expect(atHuge.candyTarget).toBe(0);
      expect(reachesMax(atHuge)).toBe(true);
    });
  });
});
