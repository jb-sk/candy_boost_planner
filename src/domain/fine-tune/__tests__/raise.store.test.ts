import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import type { CalcRow, CalcStore } from "../../../composables/useCalcStore";
import { useCandyStore } from "../../../composables/useCandyStore";
import { cancelPersist } from "../../../persistence/deferredPersist";
import { addBoxRow, createCalcStore } from "../../../../tests/helpers/fakeIndividuals";
import { solveLevelPlan } from "../../level-planner/core/solveLevelPlan";
import type { LevelPlannerInput, LevelPlannerResult } from "../../level-planner/types";
import { compareResults, raiseLevels, type RaiseInput } from "../raise";

/** 本物のストアとソルバーで「全体のLvを伸ばす」を確かめる。 */

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

interface RowSpec {
  boxId: string;
  pokedexId: number;
  dst: number;
  /** 明示アメブ。省略は導出 */
  boost?: number;
}

interface World {
  boostKind?: "full" | "mini" | "none";
  boostLimit: number;
  shards: number;
  species: Array<[number, number]>;
  universalS?: number;
  rows: RowSpec[];
}

describe("raiseLevels: 本物のストアとソルバー", () => {
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

  function build(world: World) {
    const store: CalcStore = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind(world.boostKind ?? "full");
    store.onBoostCandyRemainingInput(String(world.boostLimit));
    store.onTotalShardsInput(String(world.shards));
    for (const [dex, count] of world.species) store.updateSpeciesCandy(dex, count);
    store.updateUniversalCandy({ s: world.universalS ?? 0, m: 0, l: 0 });
    for (const spec of world.rows) {
      addBoxRow(store, { boxId: spec.boxId, pokedexId: spec.pokedexId, srcLevel: 10, dstLevelDefault: spec.dst, expType: 600, nature: "normal" });
      const id = store.rows.value[store.rows.value.length - 1]!.id;
      if (spec.boost !== undefined) store.onRowBoostCandy(id, String(spec.boost));
    }
    return store;
  }

  function solveOf(store: CalcStore, rows: readonly CalcRow[]): LevelPlannerResult {
    return solveLevelPlan(store.evaluateRows(rows).plannerInput!);
  }

  function input(store: CalcStore, boostLimit: number, extra: Partial<RaiseInput> = {}): RaiseInput & { solves: () => number } {
    let solves = 0;
    return {
      deps: { evaluateRows: store.evaluateRows, withExplicitBoost: store.withExplicitBoost },
      base: { boostLimit },
      rows: store.rows.value,
      solve: async (planner: LevelPlannerInput) => {
        solves += 1;
        return solveLevelPlan(planner);
      },
      solves: () => solves,
      ...extra,
    };
  }

  const reachedIds = (result: LevelPlannerResult) =>
    result.pokemonResults.filter((p) => p.reachableLine.effectiveTargetReached).map((p) => p.pokemonId);

  /** 伸ばしたあとの結果は前より良く、前に届いていた行は届いたまま。アメブは全アメブ点と枠を超えない */
  function expectRaised(store: CalcStore, boostLimit: number, before: LevelPlannerResult, rows: readonly CalcRow[], result: LevelPlannerResult) {
    expect(compareResults(result, before, store.rows.value)).toBeGreaterThan(0);
    for (const id of reachedIds(before)) expect(reachedIds(result)).toContain(id);
    // 入れる行一覧をもう一度解いても同じ結果
    expect(compareResults(solveOf(store, rows), result, rows)).toBe(0);
    const usedOf = (list: readonly CalcRow[]) => {
      let used = 0;
      for (const item of store.evaluateRows(list).byId.values()) {
        expect(item.effectiveBoost).toBeLessThanOrEqual(item.fullBoost);
        used += item.effectiveBoost;
      }
      return used;
    };
    // 枠を超えない（はじめから超えていた分は増やさない）
    expect(usedOf(rows)).toBeLessThanOrEqual(Math.max(boostLimit, usedOf(store.rows.value)));
    // 顔ぶれと順番は変えない
    expect(rows.map((r) => r.id)).toEqual(store.rows.value.map((r) => r.id));
  }

  it("上の行のアメブを増やして万能アメを浮かせ、届かない行が届く（「〇〇のLvを上げる」を本物のソルバーで確かめて入れる）", async () => {
    const store = build({
      boostLimit: 3000,
      shards: 100_000_000,
      species: [[25, 100]],
      universalS: 25,
      rows: [
        { boxId: "a", pokedexId: 25, dst: 30, boost: 0 },
        { boxId: "b", pokedexId: 133, dst: 40 },
      ],
    });
    const before = solveOf(store, store.rows.value);
    expect(reachedIds(before)).not.toContain(store.rows.value[0]!.id);
    const out = await raiseLevels(input(store, 3000));
    expect(out.kind).toBe("raised");
    if (out.kind !== "raised") return;
    expectRaised(store, 3000, before, out.rows, out.result);
    expect(reachedIds(out.result)).toContain(store.rows.value[0]!.id);
  });

  it("アメブ枠が足りないとき、届いている上の行のアメブを減らし、その分を届かない行へ回す", async () => {
    const store = build({
      boostLimit: 450,
      shards: 12_000_000,
      species: [[25, 99_999], [4, 600]],
      rows: [
        { boxId: "p", pokedexId: 25, dst: 40 },
        { boxId: "h", pokedexId: 4, dst: 60 },
      ],
    });
    const [p, h] = store.rows.value.map((r) => r.id) as [string, string];
    const before = solveOf(store, store.rows.value);
    expect(reachedIds(before)).toEqual([p]);
    const out = await raiseLevels(input(store, 450));
    expect(out.kind).toBe("raised");
    if (out.kind !== "raised") return;
    expectRaised(store, 450, before, out.rows, out.result);
    const evaluated = store.evaluateRows(out.rows);
    expect(evaluated.byId.get(p)!.effectiveBoost).toBeLessThan(store.evaluateRows(store.rows.value).byId.get(p)!.effectiveBoost);
    expect(evaluated.byId.get(h)!.effectiveBoost).toBeGreaterThan(store.evaluateRows(store.rows.value).byId.get(h)!.effectiveBoost);
  });

  it("かけらが足りないとき、アメの余っている上の行のアメブを減らしてかけらを浮かせ、下の行が伸びる", async () => {
    const store = build({
      boostLimit: 3000,
      shards: 1_450_000,
      species: [[25, 99_999], [133, 99_999], [4, 99_999], [7, 99_999]],
      rows: [
        { boxId: "p", pokedexId: 25, dst: 40 },
        { boxId: "e", pokedexId: 133, dst: 40 },
        { boxId: "h", pokedexId: 4, dst: 60 },
        { boxId: "z", pokedexId: 7, dst: 45 },
      ],
    });
    const before = solveOf(store, store.rows.value);
    const out = await raiseLevels(input(store, 3000));
    expect(out.kind).toBe("raised");
    if (out.kind !== "raised") return;
    expectRaised(store, 3000, before, out.rows, out.result);
    expect(reachedIds(out.result).length).toBeGreaterThan(reachedIds(before).length);
  });

  it("全員が届いていれば allReached、アメブなしのスロットは unavailable。どちらも1回しか解かない", async () => {
    const all = build({ boostLimit: 3000, shards: 100_000_000, species: [[25, 99_999]], rows: [{ boxId: "a", pokedexId: 25, dst: 30 }] });
    const allInput = input(all, 3000);
    expect(await raiseLevels(allInput)).toEqual({ kind: "allReached" });
    expect(allInput.solves()).toBe(1);
    const none = build({ boostKind: "none", boostLimit: 0, shards: 100, species: [], rows: [{ boxId: "a", pokedexId: 25, dst: 30 }] });
    const noneInput = input(none, 0);
    expect(await raiseLevels(noneInput)).toEqual({ kind: "unavailable" });
    expect(noneInput.solves()).toBe(0);
  });

  it("どの候補でも伸びなければ unchanged（アメもかけらも無い）", async () => {
    const store = build({ boostLimit: 3000, shards: 0, species: [], rows: [{ boxId: "a", pokedexId: 25, dst: 30 }, { boxId: "b", pokedexId: 133, dst: 30 }] });
    expect((await raiseLevels(input(store, 3000))).kind).toBe("unchanged");
  });

  it("アメが足りず、上の行に種族アメの余りが無いときは、アメブを付け替えても合計が変わらないので試さず、unchanged（candy）を返す", async () => {
    // p は種族アメをちょうど使い切って届き、アメブ枠も p が使い切る。e はアメ（種族アメ・万能アメ）が足りない
    const store = build({ boostLimit: 3000, shards: 100_000_000, species: [[25, 99_999], [133, 50]], rows: [{ boxId: "p", pokedexId: 25, dst: 30 }, { boxId: "e", pokedexId: 133, dst: 40 }] });
    const [p, e] = store.rows.value.map((r) => r.id) as [string, string];
    const first = store.evaluateRows(store.rows.value).byId.get(p)!;
    store.updateSpeciesCandy(25, first.candyNeed);
    store.onBoostCandyRemainingInput(String(first.effectiveBoost));
    const before = solveOf(store, store.rows.value);
    const byId = new Map(before.pokemonResults.map((r) => [r.pokemonId, r]));
    expect(byId.get(p)!.reachableLine.effectiveTargetReached).toBe(true);
    expect(byId.get(e)!.constraintDiagnosis.limitingFactor).toBe("candy");
    const run = input(store, first.effectiveBoost, { initialResult: before });
    expect(await raiseLevels(run)).toEqual({ kind: "unchanged", limitingFactor: "candy" });
    // 今の結果を渡したので、1回も解かない
    expect(run.solves()).toBe(0);
  });

  it("途中で止めると cancelled。時間の上限を超えたら、それまでに見つけた一番良い行一覧を返す", async () => {
    const world: World = {
      boostLimit: 450,
      shards: 12_000_000,
      species: [[25, 99_999], [4, 600]],
      rows: [
        { boxId: "p", pokedexId: 25, dst: 40 },
        { boxId: "h", pokedexId: 4, dst: 60 },
      ],
    };
    const store = build(world);
    let calls = 0;
    expect(await raiseLevels(input(store, 450, { isCancelled: () => (calls += 1) > 1 }))).toEqual({ kind: "cancelled" });
    // 最初に解いた直後から時間切れ: 候補を解かずに終わる
    let clock = 0;
    const timed = input(store, 450, { now: () => (clock += 10_000), timeBudgetMs: 1 });
    expect((await raiseLevels(timed)).kind).toBe("unchanged");
    expect(timed.solves()).toBe(1);
  });
});

describe("compareResults: 上の行から到達点を比べる", () => {
  const line = (level: number, expInLevel: number) => ({ reachableLine: { level, expInLevel } });
  const result = (lines: Record<string, ReturnType<typeof line>>) => ({
    pokemonResults: Object.entries(lines).map(([pokemonId, l]) => ({ pokemonId, ...l })),
  }) as unknown as LevelPlannerResult;
  const rows = ["a", "b", "c"].map((id) => ({ id }) as CalcRow);

  it("最初に違う行で決まり、下の行の差は上の行の差に勝たない", () => {
    const base = result({ a: line(30, 0), b: line(20, 100), c: line(10, 0) });
    expect(compareResults(base, base, rows)).toBe(0);
    expect(compareResults(result({ a: line(30, 0), b: line(20, 101), c: line(10, 0) }), base, rows)).toBeGreaterThan(0);
    expect(compareResults(result({ a: line(30, 0), b: line(20, 99), c: line(50, 0) }), base, rows)).toBeLessThan(0);
    expect(compareResults(result({ a: line(30, 0), b: line(21, 0), c: line(10, 0) }), base, rows)).toBeGreaterThan(0);
  });

  it("どちらかの結果に無い行は飛ばす", () => {
    const a = result({ a: line(30, 0), c: line(12, 0) });
    const b = result({ a: line(30, 0), b: line(99, 0), c: line(11, 0) });
    expect(compareResults(a, b, rows)).toBeGreaterThan(0);
  });
});
