import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import type { CalcRow, CalcStore } from "../../../composables/useCalcStore";
import { useCandyStore } from "../../../composables/useCandyStore";
import { cancelPersist } from "../../../persistence/deferredPersist";
import { addBoxRow, createCalcStore } from "../../../../tests/helpers/fakeIndividuals";
import type { LevelPlannerResult } from "../../level-planner/types";
import {
  candyUnitsOf,
  initialFineTuneState,
  opRange,
  reduceFineTune,
  type FineTuneBase,
  type FineTuneDeps,
  type FineTuneOp,
  type FineTuneState,
} from "../draft";

/** 設計書 §12.1: 本物のストアを deps に渡して確かめる分（時間の睡眠目標の m0、アメブ最小化の行の固定など）。 */

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

function depsOf(store: CalcStore): FineTuneDeps {
  return {
    evaluateRows: store.evaluateRows,
    withExplicitBoost: store.withExplicitBoost,
    withTargetLevel: store.withTargetLevel,
  };
}

function session(store: CalcStore, boostLimit = 5000) {
  const deps = depsOf(store);
  const rows = store.rows.value;
  const base: FineTuneBase = {
    rows,
    evaluated: deps.evaluateRows(rows),
    result: { pokemonResults: [] } as unknown as LevelPlannerResult,
    boostLimit,
  };
  const ok = (state: FineTuneState, op: FineTuneOp): FineTuneState => {
    const out = reduceFineTune(base, state, op, deps, deps.evaluateRows(state.rows));
    if ("rejected" in out) throw new Error(`rejected: ${out.rejected}`);
    return out.state;
  };
  return { deps, base, ok, initial: initialFineTuneState(base) };
}

const rowOf = (rows: readonly CalcRow[], id: string) => rows.find((r) => r.id === id)!;

describe("reduceFineTune: 本物のストアを deps に渡す", () => {
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

  function newStore(speciesCandy: number) {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("5000");
    store.updateSpeciesCandy(25, speciesCandy);
    return store;
  }
  const add = (store: CalcStore, boxId: string, pokedexId: number, srcLevel: number, dst: number, extra: { expRemaining?: number } = {}) => {
    addBoxRow(store, { boxId, pokedexId, srcLevel, dstLevelDefault: dst, expType: 600, nature: "normal", ...extra });
    return store.rows.value[store.rows.value.length - 1]!.id;
  };

  it("アメブを動かしても目標Lvが変わらない（繰り越しで届く点が目標を超える入力でも）", () => {
    const store = newStore(0);
    // EXPタイプ600・現在Lv1で次まで1EXP・目標Lv2・full で全アメブ点は1個
    const a = add(store, "a", 133, 1, 2, { expRemaining: 1 });
    const s = session(store);
    expect(s.base.evaluated.byId.get(a)!.fullBoost).toBe(1);
    const next = s.ok(s.initial, { kind: "set", rowId: a, boost: 1 });
    expect(next.rows[0]!.boostOrExpAdjustment).toBe(1);
    expect(next.rows[0]!.dstLevel).toBe(2);
    expect(next.rows[0]!.dstExpInLevel ?? 0).toBe(0);
    // 全アメブ点を超える入力は全アメブ点で止まる
    expect(s.ok(s.initial, { kind: "set", rowId: a, boost: 50 }).rows[0]!.boostOrExpAdjustment).toBe(1);
  });

  it("目標Lvの ▼ は計算機の setDstLevel と同じ値に切り詰められ、▲ で戻しても切り詰めたアメブは戻らない", () => {
    const store = newStore(100_000);
    const a = add(store, "a", 133, 10, 60);
    store.onRowBoostCandy(a, "150");
    const s = session(store);
    const down = s.ok(s.initial, { kind: "targetStep", rowId: a, by: -1 });
    store.setDstLevel(a, 59);
    expect(down.rows[0]).toEqual(rowOf(store.rows.value, a));

    const low = s.ok(s.initial, { kind: "set", rowId: a, boost: 150 });
    let lowered = low;
    for (let i = 0; i < 48; i += 1) lowered = s.ok(lowered, { kind: "targetStep", rowId: a, by: -1 });
    const keptBoost = lowered.rows[0]!.boostOrExpAdjustment!;
    expect(keptBoost).toBeLessThan(150);
    const raised = s.ok(lowered, { kind: "targetStep", rowId: a, by: 1 });
    expect(raised.rows[0]!.boostOrExpAdjustment).toBe(keptBoost);
    // アメブを先に触っていてもいなくても、同じ目標なら同じ結果
    let plain = s.initial;
    for (let i = 0; i < 48; i += 1) plain = s.ok(plain, { kind: "targetStep", rowId: a, by: -1 });
    expect(plain.rows[0]!.dstLevel).toBe(lowered.rows[0]!.dstLevel);
  });

  it("時間の睡眠目標の行の使うアメの数は、プランナーへ渡す総アメ数（睡眠EXPを引いた数）と同じ", () => {
    const store = newStore(100_000);
    const d = add(store, "d", 25, 10, 50);
    store.setRowSleepTarget(d, 1000);
    add(store, "b", 133, 10, 50);
    const s = session(store);
    const row = rowOf(s.base.rows, d);
    const planned = s.base.evaluated.plannerInput!.pokemonList.find((p) => p.pokemonId === d)!;
    const m0 = candyUnitsOf(row, s.base.evaluated);
    expect(m0).toBe(planned.candyTarget!.totalCandyUnits);
    // 睡眠EXPを引いた数なので、睡眠目標を外した同じ行の総アメ数より小さい
    const noSleep = s.base.rows.map((r) => (r.id === d ? { ...r, sleepTargetHours: undefined } : r));
    expect(m0).toBeGreaterThan(0);
    expect(m0).toBeLessThan(s.deps.evaluateRows(noSleep).byId.get(d)!.candyNeed);
  });

  it("move は在庫のみの行の保存値が上限を超えても拒否されず、実効アメブが在庫で抑えられる。上の行が在庫を先に取ると全アメブ点が下がる", () => {
    const store = newStore(100);
    const stock = add(store, "stock", 26, 10, 60);
    const upper = add(store, "upper", 25, 10, 40);
    store.setRowSleepTarget(stock, "stock");
    store.onRowBoostCandy(stock, "80");
    const s = session(store);
    expect(s.base.evaluated.byId.get(stock)!.effectiveBoost).toBe(80);
    const before = s.base.evaluated.byId.get(stock)!;

    const moved = s.ok(s.initial, { kind: "move", rowId: upper, toIndex: 0 });
    const after = s.deps.evaluateRows(moved.rows).byId.get(stock)!;
    expect(after.fullBoost).toBeLessThan(before.fullBoost);
    expect(after.effectiveBoost).toBeLessThan(80);
    expect(rowOf(moved.rows, stock).boostOrExpAdjustment).toBe(80);
    // 増やせず、0 まで減らせる
    expect(opRange(s.base, moved, s.deps.evaluateRows(moved.rows), { kind: "boost", rowId: stock }).max).toBe(after.effectiveBoost);
  });
});
