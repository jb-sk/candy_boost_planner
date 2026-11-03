import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import type { CalcRow, CalcStore } from "./useCalcStore";
import { useCandyStore } from "./useCandyStore";
import { calcExpAndCandy } from "../domain/pokesleep/exp";
import { buildPlannerInputSignature } from "../domain/level-planner/signature";
import type { LevelPlannerInput } from "../domain/level-planner/types";
import { cancelPersist } from "../persistence/deferredPersist";
import { addBoxRow, createCalcStore, fakeIndividualsOf } from "../../tests/helpers/fakeIndividuals";

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

describe("useCalcStore: evaluateRows / with*（設計書 §8.2）", () => {
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

  /**
   * 目標Lvピッカーで目標を下げた明示アメブの行（A）、時間の睡眠目標の行（D）、在庫のみの行（B）、
   * アメブ最小化の行（C）、睡眠目標なしの行（E）。A・D・B・C は同じ進化系で種族アメを取り合う。
   */
  function makeScenario() {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("5000");
    store.updateSpeciesCandy(25, 400);
    const add = (boxId: string, pokedexId: number, dstLevelDefault: number) => {
      addBoxRow(store, { boxId, pokedexId, srcLevel: 10, dstLevelDefault, expType: 600, nature: "normal" });
      return store.rows.value[store.rows.value.length - 1]!.id;
    };
    const a = add("a", 25, 60);
    store.onRowBoostCandy(a, "150");
    store.setDstLevel(a, 30);
    const d = add("d", 25, 50);
    store.setRowSleepTarget(d, 200);
    const b = add("b", 26, 50);
    store.setRowSleepTarget(b, "stock");
    const c = add("c", 25, 40);
    store.setRowMinimizeBoost(c, true);
    const e = add("e", 133, 40);
    return { store, a, b, c, d, e };
  }

  const rowOf = (store: CalcStore, id: string) => store.rows.value.find((r) => r.id === id)!;

  it("evaluateRows(rows.value).plannerInput の署名が、ストアが計画に渡す入力の署名と一致し、行は書き換わらない", async () => {
    const previousWorker = globalThis.Worker;
    const requests: Array<{ input: LevelPlannerInput }> = [];
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage(message: { input: LevelPlannerInput }) {
        requests.push(message);
      }
      terminate() {}
    }
    Object.defineProperty(globalThis, "Worker", { value: FakeWorker, configurable: true, writable: true });
    try {
      const { store, a } = makeScenario();
      // A は目標を下げたあとも明示アメブが残る（目標Lvピッカーが目標を保って保存した行）
      expect(rowOf(store, a).boostOrExpAdjustment).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const ids = new Set(store.rows.value.map((r) => r.id));
      const own = requests.filter((r) => r.input.pokemonList.every((p) => ids.has(p.pokemonId))
        && r.input.pokemonList.length === ids.size);
      expect(own.length).toBeGreaterThan(0);
      const sent = own[own.length - 1]!;

      const before = snapshot(store.rows.value);
      const evaluated = store.evaluateRows(store.rows.value);
      expect(snapshot(store.rows.value)).toBe(before);
      expect(evaluated.plannerInput).not.toBeNull();
      expect(buildPlannerInputSignature(evaluated.plannerInput!)).toBe(buildPlannerInputSignature(sent.input));
    } finally {
      Object.defineProperty(globalThis, "Worker", { value: previousWorker, configurable: true, writable: true });
    }
  });

  it("byId の effectiveBoost・candyNeed・stockCandyAvailable が rowsView・取り分と一致する", () => {
    const { store, b } = makeScenario();
    const { byId } = store.evaluateRows(store.rows.value);
    for (const view of store.rowsView.value) {
      const item = byId.get(view.id)!;
      expect(item.effectiveBoost).toBe(view.ui.boostCandyInput);
      expect(item.stockCandyAvailable).toBe(store.rowStockCandyAvailableFor(view.id));
    }
    expect(byId.get(b)!.stockCandyAvailable).toBeDefined();
  });

  it("fullBoost: 睡眠目標なし・在庫のみは独立に求めた全アメブ点と一致し、時間の睡眠目標は全アメブ点で目標を動かさない", () => {
    const { store, b, d, e } = makeScenario();
    // 先頭の行が在庫を取り切らないようにして、在庫のみの行にも全アメブ点が出るようにする
    store.updateSpeciesCandy(25, 100_000);
    const { byId } = store.evaluateRows(store.rows.value);

    const eRow = rowOf(store, e);
    expect(byId.get(e)!.fullBoost).toBe(calcExpAndCandy({
      srcLevel: eRow.srcLevel, dstLevel: eRow.dstLevel, dstExpInLevel: 0,
      expType: eRow.expType, nature: eRow.nature, boost: "full",
    }).candy);

    const bRow = rowOf(store, b);
    const bBase = calcExpAndCandy({
      srcLevel: bRow.srcLevel, dstLevel: bRow.dstLevel, dstExpInLevel: 0,
      expType: bRow.expType, nature: bRow.nature, boost: "full",
    }).candy;
    expect(byId.get(b)!.fullBoost).toBe(Math.min(bBase, byId.get(b)!.stockCandyAvailable!));

    // 全アメブ点の個数を、目標を押し上げずに確定すると、実効アメブがその個数になり、目標は変わらない
    for (const id of [e, d, b]) {
      const row = rowOf(store, id);
      const full = byId.get(id)!.fullBoost;
      expect(full).toBeGreaterThan(0);
      const next = store.withExplicitBoost(row, full, { preserveTargetForExplicitBoost: true });
      expect(next.dstLevel).toBe(row.dstLevel);
      expect(next.dstExpInLevel).toBe(row.dstExpInLevel);
      const list = store.rows.value.map((r) => (r.id === id ? next : r));
      expect(store.evaluateRows(list).byId.get(id)!.effectiveBoost).toBe(full);
    }
  });

  it("順番を変えた行一覧で、取り分・最小化の実効アメブ・在庫のみの全アメブ点が計算機の値と一致する（rows.value を読まない）", () => {
    const { store, a, b, c, d, e } = makeScenario();
    const original = store.evaluateRows(store.rows.value).byId;
    const reordered = [e, c, b, d, a].map((id) => rowOf(store, id));

    const before = snapshot(store.rows.value);
    const evaluated = store.evaluateRows(reordered).byId;
    expect(snapshot(store.rows.value)).toBe(before);

    // 順番で値が変わる行がある
    expect(
      [b, c, d].some((id) => {
        const x = evaluated.get(id)!;
        const y = original.get(id)!;
        return x.stockCandyAvailable !== y.stockCandyAvailable || x.effectiveBoost !== y.effectiveBoost
          || x.fullBoost !== y.fullBoost;
      }),
    ).toBe(true);

    // 同じ順番に並べた計算機が出す値と一致する
    store.rows.value = reordered;
    const reorderedBase = store.evaluateRows(store.rows.value).byId;
    for (const view of store.rowsView.value) {
      const item = evaluated.get(view.id)!;
      expect(item.effectiveBoost).toBe(view.ui.boostCandyInput);
      expect(item.stockCandyAvailable).toBe(store.rowStockCandyAvailableFor(view.id));
      expect(reorderedBase.get(view.id)).toEqual(item);
    }
    expect(evaluated.get(b)!.fullBoost).toBe(
      Math.min(
        calcExpAndCandy({
          srcLevel: rowOf(store, b).srcLevel, dstLevel: rowOf(store, b).dstLevel, dstExpInLevel: 0,
          expType: 600, nature: "normal", boost: "full",
        }).candy,
        store.rowStockCandyAvailableFor(b)!,
      ),
    );
  });

  it("withExplicitBoost: 計算機の個数欄で確定した行と一致し、preserve で目標が変わらない", () => {
    const { store, a, c, e } = makeScenario();
    for (const [id, n] of [[a, 100], [c, 40], [e, 55]] as const) {
      const expected = store.withExplicitBoost(rowOf(store, id), n);
      store.onRowBoostCandy(id, String(n));
      expect(rowOf(store, id)).toEqual(expected);
    }
    const low = rowOf(store, a);
    const kept = store.withExplicitBoost(low, 1, { preserveTargetForExplicitBoost: true });
    expect(kept.dstLevel).toBe(low.dstLevel);
    expect(kept.dstExpInLevel).toBe(low.dstExpInLevel);
  });

  it("withTargetLevel: 計算機の目標Lvピッカーで確定した行と一致する", () => {
    const { store, a, b, c, d, e } = makeScenario();
    store.onRowBoostCandy(b, "30");
    store.onRowBoostCandy(e, "80");
    for (const [id, lv] of [[a, 20], [b, 35], [c, 30], [d, 45], [e, 25]] as const) {
      const expected = store.withTargetLevel(rowOf(store, id), lv, store.rows.value);
      store.setDstLevel(id, lv);
      expect(rowOf(store, id)).toEqual(expected);
    }
  });

  it("withTargetLevel: 在庫のみの行の明示アメブの切り詰めは、渡した行一覧の順番で決まる", () => {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("5000");
    store.updateSpeciesCandy(25, 100);
    addBoxRow(store, { boxId: "stock", pokedexId: 26, srcLevel: 10, dstLevelDefault: 60, expType: 600, nature: "normal" });
    addBoxRow(store, { boxId: "upper", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    const [stockId, upperId] = store.rows.value.map((r) => r.id) as [string, string];
    store.setRowSleepTarget(stockId, "stock");
    store.onRowBoostCandy(stockId, "80");
    expect(rowOf(store, stockId).boostOrExpAdjustment).toBe(80);

    const stockFirst = store.rows.value.slice();
    const upperFirst = [rowOf(store, upperId), rowOf(store, stockId)];
    const fromUpperFirst = store.withTargetLevel(rowOf(store, stockId), 50, upperFirst);
    const fromStockFirst = store.withTargetLevel(rowOf(store, stockId), 50, stockFirst);
    expect(fromStockFirst.boostOrExpAdjustment).toBeGreaterThan(fromUpperFirst.boostOrExpAdjustment ?? 0);

    // 並べ替えた計算機が出す行と一致する
    store.rows.value = upperFirst;
    store.setDstLevel(stockId, 50);
    expect(rowOf(store, stockId)).toEqual(fromUpperFirst);
  });

  it("minimizeShortCandy: 最小アメブにしても在庫で届かない行だけ true。最小アメブで届かず戻った行も true、在庫が足りれば false", () => {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("5000");
    // ピカチュウの進化系の在庫は 100 個。上の行（Lv10→30）は足り、下の行（Lv10→60）は残りでは届かない
    store.updateSpeciesCandy(25, 100);
    const add = (boxId: string, dstLevelDefault: number) => {
      addBoxRow(store, { boxId, pokedexId: 25, srcLevel: 10, dstLevelDefault, expType: 600, nature: "normal" });
      return store.rows.value[store.rows.value.length - 1]!.id;
    };
    const enough = add("enough", 20);
    const short = add("short", 60);

    const evaluated = store.evaluateRows(store.rows.value);
    expect(evaluated.byId.get(enough)!.minimizeShortCandy).toBe(false);
    expect(evaluated.byId.get(short)!.minimizeShortCandy).toBe(true);

    // 最小アメブを入れた行も、届かずに既定のアメブへ戻るので true のまま
    const minimized = store.rows.value.map((r) => (r.id === short ? store.withMinimizeBoost(r, true) : r));
    expect(minimized.find((r) => r.id === short)!.boostMinimizeRow).toBe(true);
    expect(store.evaluateRows(minimized).byId.get(short)!.minimizeShortCandy).toBe(true);

    // 在庫が足りれば false
    store.updateSpeciesCandy(25, 99999);
    expect(store.evaluateRows(store.rows.value).byId.get(short)!.minimizeShortCandy).toBe(false);
  });

  it("evaluateRows の speciesCandy: その進化系の在庫をその数として評価し、ストアの在庫は変えない", () => {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onBoostCandyRemainingInput("5000");
    store.updateSpeciesCandy(25, 100);
    addBoxRow(store, { boxId: "p", pokedexId: 25, srcLevel: 10, dstLevelDefault: 60, expType: 600, nature: "normal" });
    const id = store.rows.value[0]!.id;
    const family = store.speciesCandyFamilyOf(store.rows.value[0]!)!;
    expect(store.speciesCandyStockOf(family)).toBe(100);
    const plain = store.evaluateRows(store.rows.value);
    const more = store.evaluateRows(store.rows.value, { speciesCandy: { [family]: 5000 } });
    expect(plain.byId.get(id)!.stockCandyAvailable).toBe(100);
    expect(more.byId.get(id)!.stockCandyAvailable).toBe(5000);
    expect(more.plannerInput!.candyInventory.species[family]).toBe(5000);
    expect(store.speciesCandyStockOf(family)).toBe(100);
  });

  it("withRowIndividual: 計算機の現在Lv・あとEXPの欄で入れたときの行と一致し、ストアの行は変えない", () => {
    const { store, a, e } = makeScenario();
    const before = snapshot(store.rows.value);
    const leveled = store.withRowIndividual(store.rows.value, e, { level: 20 });
    const expd = store.withRowIndividual(store.rows.value, a, { expRemaining: 50 });
    expect(snapshot(store.rows.value)).toBe(before);
    // 同じ値なら同じ配列
    expect(store.withRowIndividual(store.rows.value, e, { level: rowOf(store, e).srcLevel })).toBe(store.rows.value);

    store.setSrcLevel(e, 20);
    expect(snapshot(leveled)).toBe(snapshot(store.rows.value));
    store.undo();
    store.onRowExpRemaining(a, "50");
    expect(snapshot(expd)).toBe(snapshot(store.rows.value));
  });

  it("applyFineTuneDraft: 行一覧・個体（現在Lv・あとEXP）・在庫を書き、元に戻す1回で全部戻る。基準が別物なら書かない", () => {
    const { store, e } = makeScenario();
    store.updateSpeciesCandy(133, 40);
    const base = store.rows.value;
    const srcBefore = rowOf(store, e).srcLevel;
    const family = store.speciesCandyFamilyOf(rowOf(store, e))!;
    const draft = store.withRowIndividual(store.withRowIndividual(base, e, { level: 15 }), e, { expRemaining: 30 });
    expect(store.applyFineTuneDraft({ rows: draft, speciesCandy: { [family]: 900 }, label: "かんたん", expectedBase: [...base] })).toBe(false);
    expect(store.applyFineTuneDraft({ rows: draft, speciesCandy: { [family]: 900 }, label: "かんたん", expectedBase: base })).toBe(true);
    expect(rowOf(store, e)).toMatchObject({ srcLevel: 15, expRemaining: 30 });
    expect(fakeIndividualsOf(store).individualById.value.get("e")).toMatchObject({ level: 15, expRemaining: 30 });
    expect(store.speciesCandyStockOf(family)).toBe(900);
    expect(snapshot(store.rows.value)).toBe(snapshot(draft));

    store.undo();
    expect(rowOf(store, e).srcLevel).toBe(srcBefore);
    expect(fakeIndividualsOf(store).individualById.value.get("e")!.level).toBe(srcBefore);
    expect(store.speciesCandyStockOf(family)).toBe(40);
    expect(snapshot(store.rows.value)).toBe(snapshot(base));
  });

  it("withCandyTarget: 計算機の個数指定の欄で確定した行と一致する。睡眠目標モードの行は変えない", () => {
    const { store, a, b, c, e } = makeScenario();
    for (const [id, m] of [[e, 300], [c, 250], [a, 120], [e, 1_000_000]] as const) {
      const expected = store.withCandyTarget(rowOf(store, id), m);
      store.onRowCandyTarget(id, String(m));
      expect(rowOf(store, id)).toEqual(expected);
    }
    const stockRow = rowOf(store, b);
    expect(store.withCandyTarget(stockRow, 100)).toBe(stockRow);
  });
});
