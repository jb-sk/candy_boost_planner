import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick, ref, watch } from "vue";
import type { Composer } from "vue-i18n";
import type { CalcRow, CalcStore } from "./useCalcStore";
import { useCandyStore } from "./useCandyStore";
import { buildPlannerInputSignature } from "../domain/level-planner/signature";
import { cancelPersist } from "../persistence/deferredPersist";
import { addBoxRow, createCalcStore } from "../../tests/helpers/fakeIndividuals";

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

const snapshot = (rows: readonly CalcRow[]) => JSON.stringify(rows);

describe("useCalcStore: replaceRows（設計書 §10.2）", () => {
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

  /** 同じ進化系の4匹。a は受け取る側、b・c はゆずる側、d は触らない行。 */
  function makeScenario() {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("5000");
    store.updateSpeciesCandy(25, 400);
    const add = (boxId: string, dstLevelDefault: number) => {
      addBoxRow(store, { boxId, pokedexId: 25, srcLevel: 10, dstLevelDefault, expType: 600, nature: "normal" });
      return store.rows.value[store.rows.value.length - 1]!.id;
    };
    const a = add("a", 50);
    const b = add("b", 50);
    const c = add("c", 50);
    const d = add("d", 40);
    return { store, a, b, c, d };
  }

  const rowOf = (store: CalcStore, id: string) => store.rows.value.find((r) => r.id === id)!;

  /** 下書き相当の行一覧: a のアメブを動かし、b・c をゆずる側（個数指定）にして、d を先頭へ並べ替える。 */
  function makeDraft(store: CalcStore, ids: { a: string; b: string; c: string; d: string }): CalcRow[] {
    const base = store.rows.value;
    const pick = (id: string) => base.find((r) => r.id === id)!;
    return [
      pick(ids.d),
      store.withExplicitBoost(pick(ids.a), 120, { preserveTargetForExplicitBoost: true }),
      store.withCandyTarget(pick(ids.b), 20),
      store.withCandyTarget(pick(ids.c), 25),
    ];
  }

  it("履歴が1件増え、1回の元に戻すで行（アメブ・個数指定・目標Lv・順番）が全部戻る", () => {
    const { store, ...ids } = makeScenario();
    const base = store.rows.value;
    const before = snapshot(base);
    const draft = makeDraft(store, ids);
    expect(snapshot(draft)).not.toBe(before);

    expect(store.replaceRows(draft, "やりくり", base)).toBe(true);
    expect(store.rows.value.map((r) => r.id)).toEqual([ids.d, ids.a, ids.b, ids.c]);
    expect(rowOf(store, ids.b).candyTarget).toBe(20);
    expect(rowOf(store, ids.c).candyTarget).toBe(25);

    store.undo();
    expect(snapshot(store.rows.value)).toBe(before);
    // 履歴は1件だけ（もう1回戻すと、適用の前の操作が戻る）
    store.undo();
    expect(snapshot(store.rows.value)).not.toBe(before);
  });

  it("アメブを動かした行は目標Lvが変わらず、基準と同じ数に戻した行も明示アメブとして保存される", () => {
    const { store, ...ids } = makeScenario();
    const base = store.rows.value;
    const baseA = rowOf(store, ids.a);
    const moved = store.withExplicitBoost(baseA, 120, { preserveTargetForExplicitBoost: true });
    const sameCount = store.withExplicitBoost(rowOf(store, ids.d), store.evaluateRows(base).byId.get(ids.d)!.effectiveBoost, { preserveTargetForExplicitBoost: true });
    const next = base.map((r) => (r.id === ids.a ? moved : r.id === ids.d ? sameCount : r));

    expect(store.replaceRows(next, "やりくり", base)).toBe(true);
    expect(rowOf(store, ids.a).dstLevel).toBe(baseA.dstLevel);
    expect(rowOf(store, ids.a).boostOrExpAdjustment).toBe(120);
    expect(rowOf(store, ids.d).boostOrExpAdjustment).toBeDefined();
  });

  it("ゆずる側が個数指定の行として保存され、計算機で同じ個数を入れたときと同じ行になる", () => {
    const { store, ...ids } = makeScenario();
    const base = store.rows.value;
    const draft = makeDraft(store, ids);
    expect(store.replaceRows(draft, "やりくり", base)).toBe(true);

    const viaCalc = createCalcStore({ locale: ref("ja"), t });
    viaCalc.setSlotBoostKind("full");
    viaCalc.onBoostCandyRemainingInput("5000");
    viaCalc.updateSpeciesCandy(25, 400);
    for (const [boxId, dst] of [["a", 50], ["b", 50], ["c", 50], ["d", 40]] as const) {
      addBoxRow(viaCalc, { boxId, pokedexId: 25, srcLevel: 10, dstLevelDefault: dst, expType: 600, nature: "normal" });
    }
    const idsOf = viaCalc.rows.value.map((r) => r.id);
    viaCalc.onRowCandyTarget(idsOf[1]!, "20");
    viaCalc.onRowCandyTarget(idsOf[2]!, "25");
    for (const [stored, idx] of [[ids.b, 1], [ids.c, 2]] as const) {
      const got = rowOf(store, stored);
      const expected = viaCalc.rows.value[idx]!;
      expect({ candyTarget: got.candyTarget, dstLevel: got.dstLevel, dstExpInLevel: got.dstExpInLevel })
        .toEqual({ candyTarget: expected.candyTarget, dstLevel: expected.dstLevel, dstExpInLevel: expected.dstExpInLevel });
    }
  });

  it("expectedBase が今の rows.value と別物なら何もせず false を返す", () => {
    const { store, ...ids } = makeScenario();
    const staleBase = store.rows.value;
    store.updateSpeciesCandy(25, 10);
    store.setRowMinimizeBoost(ids.a, true);
    expect(store.rows.value).not.toBe(staleBase);
    const before = snapshot(store.rows.value);

    expect(store.replaceRows(makeDraft(store, ids), "やりくり", staleBase)).toBe(false);
    expect(snapshot(store.rows.value)).toBe(before);
  });

  it("evaluateRows で評価した行と、replaceRows で保存された行が一致する（行を書き換えない）", () => {
    const { store, ...ids } = makeScenario();
    const base = store.rows.value;
    const draft = makeDraft(store, ids);
    const draftSnapshot = snapshot(draft);
    const previewInput = store.evaluateRows(draft).plannerInput;

    expect(store.replaceRows(draft, "やりくり", base)).toBe(true);
    expect(snapshot(store.rows.value)).toBe(draftSnapshot);
    expect(snapshot(draft)).toBe(draftSnapshot);
    const appliedInput = store.evaluateRows(store.rows.value).plannerInput;
    expect(previewInput).not.toBeNull();
    expect(buildPlannerInputSignature(appliedInput!)).toBe(buildPlannerInputSignature(previewInput!));
  });
});

describe("useCalcStore: holdGameDate（設計書 §10.3）", () => {
  beforeEach(() => {
    cancelPersist();
    installLocalStorageMock();
  });
  afterEach(() => {
    cancelPersist();
  });

  function makeStore() {
    const store = createCalcStore({ locale: ref("ja"), t, currentGameDate: "2026-07-13" });
    let changes = 0;
    watch(store.currentGameDate, () => { changes++; }, { flush: "sync" });
    const advance = async (text: string) => {
      store.debugNowText.value = text;
      await nextTick();
    };
    return { store, advance, changes: () => changes };
  }

  it("止めていないときは今までどおり更新される", async () => {
    const { store, advance } = makeStore();
    await advance("2026-07-20T12:00");
    expect(store.currentGameDate.value).toBe("2026-07-20");
  });

  it("止めている間に日付が変わっても変わらず、再開で1回だけ更新される", async () => {
    const { store, advance, changes } = makeStore();
    const release = store.holdGameDate();
    await advance("2026-07-20T12:00");
    await advance("2026-07-21T12:00");
    expect(store.currentGameDate.value).toBe("2026-07-13");
    expect(changes()).toBe(0);

    release();
    expect(store.currentGameDate.value).toBe("2026-07-21");
    expect(changes()).toBe(1);
  });

  it("2つ止めて1つ再開しても再開しない", async () => {
    const { store, advance } = makeStore();
    const first = store.holdGameDate();
    const second = store.holdGameDate();
    await advance("2026-07-20T12:00");

    first();
    expect(store.currentGameDate.value).toBe("2026-07-13");
    second();
    expect(store.currentGameDate.value).toBe("2026-07-20");
  });

  it("戻り値を2回呼んでも1回分であり、止めている間に更新が無ければ再開しても何も起きない", async () => {
    const { store, advance, changes } = makeStore();
    const first = store.holdGameDate();
    const second = store.holdGameDate();
    await advance("2026-07-20T12:00");

    first();
    first();
    expect(store.currentGameDate.value).toBe("2026-07-13");
    second();
    expect(store.currentGameDate.value).toBe("2026-07-20");
    expect(changes()).toBe(1);

    const idle = store.holdGameDate();
    idle();
    expect(changes()).toBe(1);
  });
});
