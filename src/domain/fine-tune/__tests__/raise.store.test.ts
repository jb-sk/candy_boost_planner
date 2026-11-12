import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import type { CalcRow, CalcStore } from "../../../composables/useCalcStore";
import { useCandyStore } from "../../../composables/useCandyStore";
import { cancelPersist } from "../../../persistence/deferredPersist";
import { addBoxRow, createCalcStore } from "../../../../tests/helpers/fakeIndividuals";
import { solveLevelPlan } from "../../level-planner/core/solveLevelPlan";
import type { ItemCompareMode, LevelPlannerInput, LevelPlannerResult } from "../../level-planner/types";
import { canAutoAdjustBoost, stockReachesTarget, type BoostLocks } from "../draft";
import { __boostPlanTestHooks, planBoosts } from "../boostPlan";
import { PLANNER_DEADLINE_MS } from "../../level-planner/constants";
import { getPokemonExpType } from "../../pokesleep/pokemon-names";
import {
  RAISE_MAX_REPAIRS,
  RAISE_TIME_BUDGET_MS,
  checkRaise,
  compareResults,
  createRaiseCache,
  mergeRaiseOptions,
  raiseHeadline,
  raiseLevels,
  type RaiseInput,
  type RaiseOption,
  type RaiseOutcome,
  type RaiseReport,
  type RaiseRowChange,
} from "../raise";

/**
 * 本物のストアとソルバーで「全体のLvを伸ばす」を確かめる。
 * テストデータは実在のポケモン。`build` はEXPタイプ 600・性格 normal で行を作るので、EXPタイプが 600 のポケモン
 * （pokemon-master の expType。フシギダネ 1・ヒトカゲ 4・ゼニガメ 7・ピカチュウ 25・イーブイ 133）だけを使う
 */

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
  /** 現在Lv。省略は 10 */
  src?: number;
  dst: number;
  /** 明示アメブ。省略は導出 */
  boost?: number;
}

interface World {
  boostKind?: "full" | "mini" | "none";
  boostLimit: number;
  shards: number;
  species: Array<[number, number]>;
  universal?: { s: number; m: number; l: number };
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
    store.updateUniversalCandy(world.universal ?? { s: 0, m: 0, l: 0 });
    for (const spec of world.rows) {
      addBoxRow(store, { boxId: spec.boxId, pokedexId: spec.pokedexId, srcLevel: spec.src ?? 10, dstLevelDefault: spec.dst, expType: getPokemonExpType(spec.pokedexId), nature: "normal" });
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

  /** 解かずに見込みを出す（今の行一覧とその結果から） */
  function check(store: CalcStore, boostLocks?: BoostLocks, result: LevelPlannerResult = solveOf(store, store.rows.value)) {
    return checkRaise({ rows: store.rows.value, boostLocks, evaluated: store.evaluateRows(store.rows.value), result });
  }

  const reachedIds = (result: LevelPlannerResult) =>
    result.pokemonResults.filter((p) => p.reachableLine.effectiveTargetReached).map((p) => p.pokemonId);
  const lineOf = (result: LevelPlannerResult, id: string) => result.pokemonResults.find((r) => r.pokemonId === id)!.reachableLine;

  /** 伸びた結果の先頭の通り（アメ節約。はじめに下書きへ入れる通り） */
  function firstOf(out: RaiseOutcome): RaiseOption {
    expect(out.kind).toBe("raised");
    if (out.kind !== "raised") throw new Error(`raised ではない: ${out.kind}`);
    return out.options[0]!;
  }

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

  /** ピカチュウ（アメブ 100）が万能アメ L を使い、ヒトカゲ（別の種族・別のタイプ）が届かない場面。ピカチュウのアメブを増やすと万能アメが浮く */
  const SHARED_UNIVERSAL: World = {
    boostLimit: 3000,
    shards: 100_000_000,
    species: [[25, 50], [4, 30]],
    universal: { s: 0, m: 0, l: 7 },
    rows: [
      { boxId: "p", pokedexId: 25, dst: 40, boost: 100 },
      { boxId: "h", pokedexId: 4, dst: 40 },
    ],
  };

  /** ピカチュウ（届いている）とヒトカゲ（種族アメが 600 個で、アメブ枠を分け合うと全アメブ点に届かない）。ピカチュウのアメブを減らして枠を空ける */
  const SLOT_SHARED: World = {
    boostLimit: 450,
    shards: 12_000_000,
    species: [[25, 99_999], [4, 600]],
    rows: [
      { boxId: "p", pokedexId: 25, dst: 40 },
      { boxId: "h", pokedexId: 4, dst: 60 },
    ],
  };

  /**
   * 2行を同時に動かさないと伸びない場面。ピカチュウ・イーブイ（どちらも Lv10→40・種族アメは全アメブ点の要る数 +3 個だけ）が
   * かけらの大半を使い、ヒトカゲ（固定して使う）が次のアメブ1個ぶんのかけらに届かずに止まっている
   */
  const SIMULTANEOUS: World = {
    boostLimit: 3000,
    shards: 1_259_000,
    species: [[25, 302], [133, 302], [4, 99_999]],
    rows: [
      { boxId: "p", pokedexId: 25, dst: 40 },
      { boxId: "e", pokedexId: 133, dst: 40 },
      { boxId: "h", pokedexId: 4, dst: 60 },
    ],
  };

  it("上の行のアメブを増やして万能アメを浮かせ、届かない行が届く（配り方をモデルで求め、本物のソルバーで確かめて入れる）", async () => {
    const store = build({
      boostLimit: 3000,
      shards: 100_000_000,
      species: [[25, 100]],
      universal: { s: 25, m: 0, l: 0 },
      rows: [
        { boxId: "a", pokedexId: 25, dst: 30, boost: 0 },
        { boxId: "b", pokedexId: 133, dst: 40 },
      ],
    });
    const before = solveOf(store, store.rows.value);
    expect(reachedIds(before)).not.toContain(store.rows.value[0]!.id);
    const out = firstOf(await raiseLevels(input(store, 3000)));
    expectRaised(store, 3000, before, out.rows, out.result);
    expect(reachedIds(out.result)).toContain(store.rows.value[0]!.id);
    // 小窓の万能アメ残りは、前後の結果の集計そのもの（全員で分け合う在庫なので、行ごとには出さない）
    expect(out.report.universalRemaining).toEqual({ before: before.summary.universalCandyRemaining, after: out.result.summary.universalCandyRemaining });
  });

  it("アメブ枠が足りないとき、届いている上の行のアメブを減らし、その分を届かない行へ回す", async () => {
    const store = build(SLOT_SHARED);
    const [p, h] = store.rows.value.map((r) => r.id) as [string, string];
    const before = solveOf(store, store.rows.value);
    expect(reachedIds(before)).toEqual([p]);
    const out = firstOf(await raiseLevels(input(store, 450)));
    expectRaised(store, 450, before, out.rows, out.result);
    const evaluated = store.evaluateRows(out.rows);
    expect(evaluated.byId.get(p)!.effectiveBoost).toBeLessThan(store.evaluateRows(store.rows.value).byId.get(p)!.effectiveBoost);
    expect(evaluated.byId.get(h)!.effectiveBoost).toBeGreaterThan(store.evaluateRows(store.rows.value).byId.get(h)!.effectiveBoost);
  });

  it("固定した行のアメブは、どの通りでも動かさない。固定していない行は動いて伸びる", async () => {
    // ピカチュウを固定すると、枠 450 のうちピカチュウが使う分は動かず、ヒトカゲには全アメブ点まで回らない。
    // ヒトカゲを動かすのではなく、ピカチュウの代わりにヒトカゲを固定すると、ピカチュウが枠を空けられる
    const store = build(SLOT_SHARED);
    const [p, h] = store.rows.value.map((r) => r.id) as [string, string];
    const boostOf = (rows: readonly CalcRow[], id: string) => store.evaluateRows(rows).byId.get(id)!.effectiveBoost;
    const lockedP = await raiseLevels(input(store, 450, { boostLocks: { [p]: true } }));
    if (lockedP.kind === "raised") {
      for (const option of lockedP.options) expect(boostOf(option.rows, p)).toBe(boostOf(store.rows.value, p));
    } else {
      expect(lockedP.kind).toBe("unchanged");
    }
    const lockedH = await raiseLevels(input(store, 450, { boostLocks: { [h]: true } }));
    if (lockedH.kind === "raised") {
      for (const option of lockedH.options) expect(boostOf(option.rows, h)).toBe(boostOf(store.rows.value, h));
    } else {
      expect(lockedH.kind).toBe("unchanged");
    }
    // 両方固定すれば動かす行が無い。解かずに伸ばせないと分かる
    const both = input(store, 450, { boostLocks: { [p]: true, [h]: true }, initialResult: solveOf(store, store.rows.value) });
    expect((await raiseLevels(both)).kind).toBe("unchanged");
    expect(both.solves()).toBe(0);
    expect(check(store, { [p]: true, [h]: true }).kind).toBe("unchanged");
  });

  it("アメ節約とかけら節約で配り方が分かれると2通りを返し、同じ入力は解き直さない。分けて呼んでも同じ通りになる（S67）", async () => {
    // ピカチュウは全アメブ点まで入れても種族アメが足りず、イーブイはアメブ 0 で種族アメが足りない。
    // イーブイが自分のアメブを増やすと届く。増やす量が多いほどアメが少なくかけらが多い
    const store = build({
      boostLimit: 3000,
      shards: 100_000_000,
      species: [[25, 20], [133, 100]],
      rows: [
        { boxId: "p", pokedexId: 25, dst: 25 },
        { boxId: "e", pokedexId: 133, dst: 20, boost: 0 },
      ],
    });
    const [, e] = store.rows.value.map((r) => r.id) as [string, string];
    const keys: string[] = [];
    const run = input(store, 3000, {
      solve: async (planner: LevelPlannerInput) => {
        keys.push(JSON.stringify(planner));
        return solveLevelPlan(planner);
      },
    });
    const out = await raiseLevels(run);
    expect(out.kind).toBe("raised");
    if (out.kind !== "raised") return;
    // 解いた入力はどれも違う（アメ節約で解いたものは、かけら節約で解き直さない）
    expect(new Set(keys).size).toBe(keys.length);
    expect(out.options.map((o) => o.savings)).toEqual([["candy"], ["shards"]]);
    const [candy, shards] = out.options as [RaiseOption, RaiseOption];
    const before = solveOf(store, store.rows.value);
    expectRaised(store, 3000, before, candy.rows, candy.result);
    expectRaised(store, 3000, before, shards.rows, shards.result);
    const shardsOf = (o: RaiseOption) => o.result.pokemonResults.reduce((sum, r) => sum + r.reachableLine.dreamShardsUsed, 0);
    expect(candy.report.candyUsed.after).toBeLessThan(shards.report.candyUsed.after);
    expect(shardsOf(shards)).toBeLessThan(shardsOf(candy));
    const eBoost = (o: RaiseOption) => store.evaluateRows(o.rows).byId.get(e)!.effectiveBoost;
    expect(eBoost(candy)).toBeGreaterThan(eBoost(shards));

    // 節約するものを分けて呼んでも（アメ節約を先に出し、かけら節約を後から求める）、解いた結果の置き場を渡せば
    // 解き直さず、まとめて求めたのと同じ通りになる。モデルの置き場を渡せば、後から求めるかけら節約は
    // 到達の決め方を求め直さない（配り方を求める satisfy 1回だけ）
    keys.length = 0;
    const cache = createRaiseCache();
    const first = await raiseLevels({ ...run, savings: ["candy"], cache });
    __boostPlanTestHooks.resetStats();
    const rest = await raiseLevels({ ...run, savings: ["shards"], cache });
    expect(__boostPlanTestHooks.stats.satisfyCalls).toBe(1);
    expect(cache.planners.size).toBe(1);
    expect(new Set(keys).size).toBe(keys.length);
    if (first.kind !== "raised" || rest.kind !== "raised") throw new Error("伸びていない");
    expect(first.options.map((o) => o.savings)).toEqual([["candy"]]);
    const merged = mergeRaiseOptions(first.options, rest.options);
    expect(merged.map((o) => o.savings)).toEqual([["candy"], ["shards"]]);
    expect(merged.map((o) => o.rows)).toEqual(out.options.map((o) => o.rows));
    // 同じ行一覧の通りは、前の通りへ節約するものを足して1つにまとめる（もとの並びは変えない）
    const same = mergeRaiseOptions(first.options, [{ ...first.options[0]!, savings: ["shards"] }]);
    expect(same.map((o) => o.savings)).toEqual([["candy", "shards"]]);
    expect(first.options[0]!.savings).toEqual(["candy"]);
  });

  it("配り方が同じになる節約するものは、同じ入力を解き直さず、1つの通りにまとめる", async () => {
    const store = build(SLOT_SHARED);
    const keys: string[] = [];
    const run = input(store, 450, {
      initialResult: solveOf(store, store.rows.value),
      solve: async (planner: LevelPlannerInput) => {
        keys.push(JSON.stringify(planner));
        return solveLevelPlan(planner);
      },
    });
    const out = await raiseLevels(run);
    expect(out.kind).toBe("raised");
    if (out.kind !== "raised") return;
    expect(new Set(keys).size).toBe(keys.length);
    // 通りの数だけ（多くて2つ）解く
    expect(keys.length).toBeLessThanOrEqual(2);
    expect(out.options.length).toBe(keys.length);
    expect(out.options.flatMap((o) => o.savings)).toEqual(["candy", "shards"]);
  });

  /**
   * 2行を同時に動かさないと伸びない場面。ピカチュウ・イーブイ（どちらも Lv10→40・種族アメは全アメブ点の要る数 +3 個だけ）が
   * かけらの大半を使い、ヒトカゲ（固定）が次のアメブ1個ぶんのかけらに届かずに止まっている。
   * 1行が減らせるアメブは3個ぶん（アメが3個増えるところまで）で、浮くかけらでは次の1個に足りない。2行とも減らすと届く。
   * 1歩ずつ1行だけを動かす探し方では伸ばせない（S71）
   */
  describe("2行を同時に動かさないと伸びない場面", () => {
    it("ピカチュウ・イーブイを同時に動かせば、ヒトカゲが伸びる。1行だけでは解かずに伸びないと分かる", async () => {
      const store = build(SIMULTANEOUS);
      const [p, e, h] = store.rows.value.map((r) => r.id) as [string, string, string];
      const before = solveOf(store, store.rows.value);
      expect(lineOf(before, h).candyDemandMet).toBe(false);
      // 1行だけ動かせるとき（もう1行とヒトカゲを固定）は伸びない。動かす行があるので見込みは possible（モデルで判断しない）、
      // 押すとモデルで伸びないと分かり、解かずに unchanged
      for (const fixed of [p, e]) {
        const locks = { [fixed]: true, [h]: true } as const;
        expect(check(store, locks, before)).toEqual({ kind: "possible" });
        const only = input(store, 3000, { boostLocks: locks, initialResult: before });
        expect((await raiseLevels(only)).kind).toBe("unchanged");
        expect(only.solves()).toBe(0);
      }
      // 2行なら押すと伸びる
      const locks = { [h]: true } as const;
      expect(check(store, locks, before)).toEqual({ kind: "possible" });
      const out = firstOf(await raiseLevels(input(store, 3000, { boostLocks: locks, initialResult: before })));
      expectRaised(store, 3000, before, out.rows, out.result);
      expect(lineOf(out.result, h).expInLevel).toBeGreaterThan(lineOf(before, h).expInLevel);
      const evaluated = store.evaluateRows(out.rows);
      const boostBefore = store.evaluateRows(store.rows.value);
      expect(evaluated.byId.get(p)!.effectiveBoost).toBeLessThan(boostBefore.byId.get(p)!.effectiveBoost);
      expect(evaluated.byId.get(e)!.effectiveBoost).toBeLessThan(boostBefore.byId.get(e)!.effectiveBoost);
      expect(evaluated.byId.get(h)!.effectiveBoost).toBe(boostBefore.byId.get(h)!.effectiveBoost);
    });
  });

  /**
   * 直し（設計書 §5.5）。作り物のソルバーで、はじめと違う入力を解くたびに、最初の `times` 回だけ `shape` で結果を作り物にし、
   * それ以降は本物の結果を返す。`keys` は解いた入力（同じ入力は解き直さないので、直しで配り方が変わると増える）。
   * 場面は「2行を同時に動かさないと伸びない場面」（`SIMULTANEOUS`。ヒトカゲを固定）。上の行（ピカチュウ）の要るアメに足すと、
   * ピカチュウが減らせるアメブが減るので、配り方が変わる
   */
  interface FakeContext {
    /** 行ID（上から） */
    ids: string[];
    before: LevelPlannerResult;
  }
  function repairWorld(fake: { times: number; shape: (result: LevelPlannerResult, ctx: FakeContext) => LevelPlannerResult }, mode?: ItemCompareMode) {
    const store = build(SIMULTANEOUS);
    if (mode !== undefined) store.setItemCompareMode(mode);
    const ids = store.rows.value.map((r) => r.id);
    const before = solveOf(store, store.rows.value);
    const initialKey = JSON.stringify(store.evaluateRows(store.rows.value).plannerInput);
    const keys: string[] = [];
    const run = input(store, SIMULTANEOUS.boostLimit, {
      initialResult: before,
      boostLocks: { [ids[2]!]: true },
      solve: async (planner: LevelPlannerInput) => {
        const key = JSON.stringify(planner);
        if (key === initialKey) return before;
        keys.push(key);
        const result = solveLevelPlan(planner);
        return keys.length <= fake.times ? fake.shape(result, { ids, before }) : result;
      },
    });
    return { store, ids, before, run: { ...run, savings: ["candy"] as const }, keys };
  }

  /** ピカチュウがモデルでは届くのに、ソルバーでは届かなかった（足りないアメ 1 個）形 */
  const shortOfCandy = (result: LevelPlannerResult, { ids }: FakeContext): LevelPlannerResult => ({
    ...result,
    pokemonResults: result.pokemonResults.map((r) => (r.pokemonId === ids[0]
      ? { ...r, shortage: { ...r.shortage, candyToTarget: 1 }, reachableLine: { ...r.reachableLine, candyDemandMet: false, effectiveTargetReached: false } }
      : r)),
  });

  it("直し: モデルで届くとした行がソルバーで届かなければ、足りなかったアメを要るアメに足して求め直し、2回目で採れる", async () => {
    // 直さなくても伸びる場面（作り物にしなければ1回で採れる）
    const probe = repairWorld({ times: 0, shape: (r) => r });
    const out0 = firstOf(await raiseLevels(probe.run));
    expect(probe.keys).toHaveLength(1);

    const w = repairWorld({ times: 1, shape: shortOfCandy });
    const out = firstOf(await raiseLevels(w.run));
    // 2回解いた（1回目は作り物で採れず、直して求め直した2回目で採れた）。入力が違う = margins がアメブの配り方を変えた
    expect(w.keys).toHaveLength(2);
    expect(w.keys[0]).not.toBe(w.keys[1]);
    expectRaised(w.store, 3000, w.before, out.rows, out.result);
    const [p, , h] = w.ids as [string, string, string];
    expect(lineOf(out.result, h).expInLevel).toBeGreaterThan(lineOf(w.before, h).expInLevel);
    // ピカチュウが減らすアメブは、足したアメの分だけ少ない
    const boostOf = (store: CalcStore, rows: readonly CalcRow[], id: string) => store.evaluateRows(rows).byId.get(id)!.effectiveBoost;
    expect(boostOf(w.store, out.rows, p)).toBeGreaterThan(boostOf(probe.store, out0.rows, probe.ids[0]!));
  });

  it(`直しは ${RAISE_MAX_REPAIRS} 回まで。直しても採れなければ、その節約するものは伸びなかったとする（unchanged）`, async () => {
    const w = repairWorld({ times: 99, shape: shortOfCandy });
    expect((await raiseLevels(w.run)).kind).toBe("unchanged");
    // はじめの1回と、直しの回数（同じ入力は解き直さないので、これ以下）
    expect(w.keys.length).toBeGreaterThanOrEqual(2);
    expect(w.keys.length).toBeLessThanOrEqual(RAISE_MAX_REPAIRS + 1);
  });

  it(`時間の上限は計算機と同じ（ソルバー1回の締切 ${PLANNER_DEADLINE_MS}ms）で、節約するものをまたいで1回の呼び出しで数える`, async () => {
    expect(RAISE_TIME_BUDGET_MS).toBe(PLANNER_DEADLINE_MS);
    // アメ節約で解いている間に上限を超え、採れなかった: かけら節約も解かない
    let clock = 0;
    const w = repairWorld({ times: 99, shape: (r, ctx) => { clock = 9000; return shortOfCandy(r, ctx); } });
    expect((await raiseLevels({ ...w.run, savings: ["candy", "shards"], now: () => clock, timeBudgetMs: 8000 })).kind).toBe("unchanged");
    expect(w.keys).toHaveLength(1);
  });

  it("時間の上限は解き始める前に見る。解いている間に超えても採れる結果は採り、採れなければ直しを始めない", async () => {
    // 解いている間に上限を超えた（解き終えた結果は採る条件を満たす）: 採る
    let clockOk = 0;
    const ok = repairWorld({ times: 1, shape: (r) => { clockOk = 9000; return r; } });
    expect((await raiseLevels({ ...ok.run, now: () => clockOk, timeBudgetMs: 8000 })).kind).toBe("raised");
    expect(ok.keys).toHaveLength(1);
    // 解いている間に上限を超え、採れなかった: 直して解き直さない
    let clockNg = 0;
    const ng = repairWorld({ times: 99, shape: (r, ctx) => { clockNg = 9000; return shortOfCandy(r, ctx); } });
    expect((await raiseLevels({ ...ng.run, now: () => clockNg, timeBudgetMs: 8000 })).kind).toBe("unchanged");
    expect(ng.keys).toHaveLength(1);
  });

  describe("余り最小のゲート（S69）", () => {
    /** ピカチュウの余りを 3 にして、各行余り0〜2を破らせる */
    const breakGate = (result: LevelPlannerResult, { ids }: FakeContext): LevelPlannerResult => ({
      ...result,
      pokemonResults: result.pokemonResults.map((r) => (r.pokemonId === ids[0]
        ? { ...r, reachableLine: { ...r.reachableLine, surplusCandyValue: 3 } }
        : r)),
    });

    it("今が各行余り0〜2を満たしていれば、到達が伸びても余り3以上の行が出る結果は採らず、直しても採れなければ unchanged。EXP最大は採る", async () => {
      const surplusFirst = repairWorld({ times: 99, shape: breakGate }, "surplusFirst");
      for (const id of surplusFirst.ids) expect(lineOf(surplusFirst.before, id).surplusCandyValue).toBeLessThanOrEqual(2);
      expect((await raiseLevels(surplusFirst.run)).kind).toBe("unchanged");
      const legacy = repairWorld({ times: 99, shape: breakGate }, "legacyImproved");
      const out = firstOf(await raiseLevels(legacy.run));
      expect(compareResults(out.result, legacy.before, legacy.store.rows.value)).toBeGreaterThan(0);
      expect(legacy.keys).toHaveLength(1);
    });

    it("ゲートを破ったときは、破ったいちばん上の行に1を足して求め直し、破らない結果が出れば採る", async () => {
      const w = repairWorld({ times: 1, shape: breakGate }, "surplusFirst");
      const out = firstOf(await raiseLevels(w.run));
      // 1回目は余りで採れず、直して2回目で採れた（入力が違う = 足した1がアメブの配り方を変えた）
      expect(w.keys).toHaveLength(2);
      expect(w.keys[0]).not.toBe(w.keys[1]);
      expect(compareResults(out.result, w.before, w.store.rows.value)).toBeGreaterThan(0);
      expect(lineOf(out.result, w.ids[0]!).surplusCandyValue).toBeLessThanOrEqual(2);
    });

    it("今が各行余り0〜2を満たしていなければ、余りの大きい結果も採る（ソルバーがバランスへ切り替えた結果など）", async () => {
      const store = build(SHARED_UNIVERSAL);
      store.setItemCompareMode("surplusFirst");
      const [p, h] = store.rows.value.map((r) => r.id) as [string, string];
      const before = solveOf(store, store.rows.value);
      expect(lineOf(before, p).surplusCandyValue).toBeGreaterThan(2);
      const out = firstOf(await raiseLevels(input(store, 3000, { initialResult: before, savings: ["candy"] })));
      expect(lineOf(out.result, h).candyDemandMet).toBe(true);
    });

    /**
     * フシギダネ（Lv11→16）とミニリュウ（EXPタイプ900、Lv16→19）。余り最小で、押す前はフシギダネだけ届き、各行余り0〜2。
     * アメブを両方0にすると、ソルバーは余り0〜2では誰も届かないのでバランスへ切り替え、2匹とも届くが余りが3以上になる。
     * その結果は余りゲートで捨てる（S69）。バランスでは押す前から2匹とも届いている
     */
    it("到達が伸びる結果を余りゲートで捨てて伸びなければ、unchanged に surplusGated を付ける（配分方針を変えると伸ばせることがある）", async () => {
      const store = build({
        boostLimit: 11,
        shards: 17705,
        species: [[1, 36], [147, 21]],
        universal: { s: 2, m: 1, l: 1 },
        rows: [{ boxId: "b", pokedexId: 1, src: 11, dst: 16, boost: 26 }, { boxId: "d", pokedexId: 147, src: 16, dst: 19, boost: 27 }],
      });
      store.setItemCompareMode("surplusFirst");
      const [b, d] = store.rows.value.map((r) => r.id) as [string, string];
      const before = solveOf(store, store.rows.value);
      expect(lineOf(before, b).candyDemandMet).toBe(true);
      expect(lineOf(before, d).candyDemandMet).toBe(false);
      expect(lineOf(before, b).surplusCandyValue).toBeLessThanOrEqual(2);
      const out = await raiseLevels(input(store, 11, { initialResult: before }));
      expect(out).toMatchObject({ kind: "unchanged", surplusGated: true });
      // バランスでは押す前から2匹とも届いている
      store.setItemCompareMode("surplusGateFirst");
      expect(await raiseLevels(input(store, 11))).toEqual({ kind: "allReached" });
    });
  });

  it("伸ばしたときの増減（report）は、伸ばす前と後の評価・結果そのもので、変わった行だけを行の順に並べる", async () => {
    const store = build(SLOT_SHARED);
    const [p, h] = store.rows.value.map((r) => r.id) as [string, string];
    const beforeRows = store.rows.value;
    const beforeResult = solveOf(store, beforeRows);
    const out = firstOf(await raiseLevels(input(store, 450)));
    const { report } = out;
    // ピカチュウがアメブを出し、ヒトカゲが受け取って届くLvが上がる
    expect(report.rows.map((r) => r.rowId)).toEqual([p, h]);
    const beforeEval = store.evaluateRows(beforeRows);
    const afterEval = store.evaluateRows(out.rows);
    const rowLine = (result: LevelPlannerResult, id: string) => lineOf(result, id);
    for (const change of report.rows) {
      const id = change.rowId;
      expect(change.boost).toEqual({ before: beforeEval.byId.get(id)!.effectiveBoost, after: afterEval.byId.get(id)!.effectiveBoost });
      expect(change.candy).toEqual({ before: rowLine(beforeResult, id).totalCandyUnitsUsed, after: rowLine(out.result, id).totalCandyUnitsUsed });
      expect(change.shards).toEqual({ before: rowLine(beforeResult, id).dreamShardsUsed, after: rowLine(out.result, id).dreamShardsUsed });
      expect(change.level).toEqual({ before: rowLine(beforeResult, id).level, after: rowLine(out.result, id).level });
      // あとEXP は到達点の次のLvまでの EXP（Lv70・0 は null）
      const expLeft = (line: ReturnType<typeof rowLine>) => (line.level < 70 && line.expToNextLevel > 0 ? line.expToNextLevel : null);
      expect(change.expLeft).toEqual({ before: expLeft(rowLine(beforeResult, id)), after: expLeft(rowLine(out.result, id)) });
    }
    const [pc, hc] = report.rows as [(typeof report.rows)[number], (typeof report.rows)[number]];
    expect(pc.boost.after).toBeLessThan(pc.boost.before);
    expect(hc.boost.after).toBeGreaterThan(hc.boost.before);
    expect(hc.level.after).toBeGreaterThan(hc.level.before);
    expect(hc.expLeft.after).not.toBeNull();
    // ピカチュウは前後とも届いているので同じ、ヒトカゲは良くなった
    expect(pc.reach).toBe("same");
    expect(hc.reach).toBe("better");
    // 到達点が良くなったいちばん上の行はヒトカゲ（ピカチュウは前後とも届いているので比べない）。見出しはヒトカゲのレベルアップ
    expect(report.lead).toEqual({ rowId: h, title: hc.title });
    expect(raiseHeadline(report)).toEqual({ kind: "levelUp", title: hc.title, others: false });
    const used = (list: readonly CalcRow[]) => [...store.evaluateRows(list).byId.values()].reduce((sum, item) => sum + item.effectiveBoost, 0);
    expect(report.boostRemaining).toEqual({ before: 450 - used(beforeRows), after: 450 - used(out.rows) });
    expect(report.shardsRemaining).toEqual({
      before: beforeResult.summary.dreamShardsRemaining,
      after: out.result.summary.dreamShardsRemaining,
    });
    // 全員のアメ合計（アメ節約・かけら節約を見比べる）
    const candyOf = (result: LevelPlannerResult) => result.pokemonResults.reduce((sum, r) => sum + r.reachableLine.totalCandyUnitsUsed, 0);
    expect(report.candyUsed).toEqual({ before: candyOf(beforeResult), after: candyOf(out.result) });
  });

  it("伸ばしたときの増減（report）に、何も変わらなかった行は入らない", async () => {
    // イーブイは上でアメが潤沢に届いており、アメブ枠を分け合わない（下の2匹のやりとりで変わらない）
    const store = build({
      boostLimit: 450,
      shards: 12_000_000,
      species: [[133, 99_999], [25, 99_999], [4, 600]],
      rows: [
        { boxId: "e", pokedexId: 133, dst: 20, boost: 0 },
        { boxId: "p", pokedexId: 25, dst: 40 },
        { boxId: "h", pokedexId: 4, dst: 60 },
      ],
    });
    const [e] = store.rows.value.map((r) => r.id) as [string];
    const out = firstOf(await raiseLevels(input(store, 450)));
    const before = lineOf(solveOf(store, store.rows.value), e);
    const after = lineOf(out.result, e);
    expect(after.totalCandyUnitsUsed).toBe(before.totalCandyUnitsUsed);
    expect(after.dreamShardsUsed).toBe(before.dreamShardsUsed);
    expect(out.report.rows.map((r) => r.rowId)).not.toContain(e);
    expect(out.report.rows.length).toBeGreaterThan(0);
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
    const out = firstOf(await raiseLevels(input(store, 3000)));
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

  it("モデルでも伸びなければ unchanged（アメもかけらも無い）。解いたのは今の結果だけ", async () => {
    const store = build({ boostLimit: 3000, shards: 0, species: [], rows: [{ boxId: "a", pokedexId: 25, dst: 30 }, { boxId: "b", pokedexId: 133, dst: 30 }] });
    const run = input(store, 3000);
    expect((await raiseLevels(run)).kind).toBe("unchanged");
    expect(run.solves()).toBe(1);
  });

  it("アメが足りず、上の行に種族アメの余りが無いときは、アメブを付け替えても合計が変わらないので、モデルで伸びないと分かり、解かずに unchanged（candy）を返す", async () => {
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
    // 見込みはモデルで判断しないので possible（押せる見た目）。押せば上のとおり解かずに unchanged と分かる
    expect(check(store, undefined, before)).toEqual({ kind: "possible" });
  });

  it("アメの個数を指定した行がアメブ枠で削られて到達点に届かなくても、アメを配り終えていれば届いた行とみなす（配分方針 §6.5）。その行の到達Lvだけが上がる配り方は採らない", async () => {
    // ピカチュウがアメブ枠 300 を全部使い、イーブイ（アメ 200 個・アメブ 200 を指定）には枠が回らない。
    // ヒトカゲは種族アメが無く（万能アメも無い）、アメを1つも使えないので、アメブを増やしても伸びない
    const store = build({
      boostLimit: 300,
      shards: 100_000_000,
      species: [[25, 5000], [133, 5000], [4, 0]],
      rows: [
        { boxId: "p", pokedexId: 25, dst: 50, boost: 300 },
        { boxId: "e", pokedexId: 133, dst: 50, boost: 200 },
        { boxId: "h", pokedexId: 4, dst: 50, boost: 0 },
      ],
    });
    const [, e, h] = store.rows.value.map((r) => r.id) as [string, string, string];
    store.onRowCandyTarget(e, "200");
    const rows = store.rows.value;
    expect(rows[1]!.candyTarget).toBe(200);
    const result = solveOf(store, rows);
    expect(lineOf(result, e)).toMatchObject({ candyDemandMet: true, effectiveTargetReached: false });
    expect(result.pokemonResults.find((r) => r.pokemonId === e)!.constraintDiagnosis.limitingFactor).toBe("boost");
    expect(lineOf(result, h).candyDemandMet).toBe(false);
    expect(result.pokemonResults.find((r) => r.pokemonId === h)!.constraintDiagnosis.limitingFactor).toBe("candy");
    // ヒトカゲのためにピカチュウのアメブを減らすと、空いた枠でイーブイの到達Lvだけが上がる（ヒトカゲは伸びない）。
    // イーブイは前後とも届いた行なので同じとみなし、伸びたことにしない。止めているのはヒトカゲのアメ
    const run = input(store, 300, { initialResult: result });
    expect(await raiseLevels(run)).toEqual({ kind: "unchanged", limitingFactor: "candy" });
  });

  it("届かない行が無く、アメブ枠で削られた個数指定の行だけが表で届いていないときは、全員届いたではなく止めているもの（アメブ枠）を添えて伸ばせないとする", async () => {
    const store = build({
      boostLimit: 300,
      shards: 100_000_000,
      species: [[25, 5000], [133, 5000]],
      rows: [
        { boxId: "p", pokedexId: 25, dst: 50, boost: 300 },
        { boxId: "e", pokedexId: 133, dst: 50, boost: 200 },
      ],
    });
    const [, e] = store.rows.value.map((r) => r.id) as [string, string];
    store.onRowCandyTarget(e, "200");
    const rows = store.rows.value;
    const result = solveOf(store, rows);
    expect(lineOf(result, e)).toMatchObject({ candyDemandMet: true, effectiveTargetReached: false });
    expect(check(store, undefined, result)).toEqual({ kind: "unchanged", limitingFactor: "boost" });
    const run = input(store, 300, { initialResult: result });
    expect(await raiseLevels(run)).toEqual({ kind: "unchanged", limitingFactor: "boost" });
    expect(run.solves()).toBe(0);
  });

  it("上にアメが足りず動かせない届かない行があっても、アメで止まっている下の行は自分のアメブを増やして伸びる", async () => {
    // p（ピカチュウ）は全アメブ点まで入れてもアメが足りない。e（イーブイ）はアメブを 0 にしてあり、アメが足りない。
    // 残り枠とかけらは余っているので、e が自分のアメブを増やせば、同じアメで先へ進む
    const store = build({
      boostLimit: 3000,
      shards: 100_000_000,
      species: [[25, 20], [133, 150]],
      rows: [
        { boxId: "p", pokedexId: 25, dst: 30 },
        { boxId: "e", pokedexId: 133, dst: 40, boost: 0 },
      ],
    });
    const [p, e] = store.rows.value.map((r) => r.id) as [string, string];
    store.onRowBoostCandy(p, String(store.evaluateRows(store.rows.value).byId.get(p)!.fullBoost));
    const evaluated = store.evaluateRows(store.rows.value);
    expect(evaluated.byId.get(p)!.effectiveBoost).toBe(evaluated.byId.get(p)!.fullBoost);
    const before = solveOf(store, store.rows.value);
    const byId = new Map(before.pokemonResults.map((r) => [r.pokemonId, r]));
    expect(byId.get(p)!.constraintDiagnosis.limitingFactor).toBe("candy");
    expect(byId.get(e)!.constraintDiagnosis.limitingFactor).toBe("candy");
    const run = input(store, 3000, { initialResult: before });
    expect(check(store, undefined, before)).toEqual({ kind: "possible" });
    const out = firstOf(await raiseLevels(run));
    expectRaised(store, 3000, before, out.rows, out.result);
    expect(store.evaluateRows(out.rows).byId.get(e)!.effectiveBoost).toBeGreaterThan(0);
    // e を固定すると、動かせるのは全アメブ点の p だけ（減らすとアメが増えて足りない）で、伸びない（押すと解かずに分かる。
    // 見込みはモデルで判断しないので possible）
    const locked = input(store, 3000, { initialResult: before, boostLocks: { [e]: true } });
    expect(check(store, { [e]: true }, before)).toEqual({ kind: "possible" });
    expect(await raiseLevels(locked)).toEqual({ kind: "unchanged", limitingFactor: "candy" });
    expect(locked.solves()).toBe(0);
  });

  describe("アメ在庫の睡眠目標の行（S75）", () => {
    /** 行一覧を評価した、その行の実効アメブ・T' までに要る数・プランナーへ渡す使うアメの数 */
    const stockRowOf = (store: CalcStore, rows: readonly CalcRow[], id: string) => {
      const evaluated = store.evaluateRows(rows);
      return {
        boost: evaluated.byId.get(id)!.effectiveBoost,
        reaches: stockReachesTarget(evaluated, id),
        candy: evaluated.plannerInput!.pokemonList.find((p) => p.pokemonId === id)!.candyTarget!.totalCandyUnits,
      };
    };

    it("在庫が足りて T' に届く行は動く。到達は T' のまま、アメブを増やして浮いた在庫を下の同じ進化系の行へ回す", async () => {
      // ピカチュウ2匹（同じ進化系）。上はアメ在庫の睡眠目標でアメブ 0（T' までに 273 個、在庫 373 個で届く）。
      // 下はふつうの行で、残りの在庫 100 個では 137 個に足りない。上がアメブを増やすと要る数が減り、下が届く
      const store = build({
        boostLimit: 3000,
        shards: 100_000_000,
        species: [[25, 373]],
        rows: [{ boxId: "s", pokedexId: 25, dst: 30, boost: 0 }, { boxId: "b", pokedexId: 25, dst: 30 }],
      });
      const [s, b] = store.rows.value.map((r) => r.id) as [string, string];
      store.setRowSleepTarget(s, "stock");
      store.onRowBoostCandy(s, "0");
      const rows = store.rows.value;
      const before = solveOf(store, rows);
      const was = stockRowOf(store, rows, s);
      expect(was).toMatchObject({ boost: 0, reaches: true });
      expect(lineOf(before, b).candyDemandMet).toBe(false);
      expect(check(store, undefined, before)).toEqual({ kind: "possible" });

      const out = firstOf(await raiseLevels(input(store, 3000, { initialResult: before, savings: ["candy"] })));
      expectRaised(store, 3000, before, out.rows, out.result);
      expect(lineOf(out.result, b).candyDemandMet).toBe(true);
      const now = stockRowOf(store, out.rows, s);
      expect(now.boost).toBeGreaterThan(was.boost);
      expect(now.reaches).toBe(true);
      expect(now.candy).toBeLessThan(was.candy);
      // 到達は T' のまま
      expect({ level: lineOf(out.result, s).level, exp: lineOf(out.result, s).expInLevel })
        .toEqual({ level: lineOf(before, s).level, exp: lineOf(before, s).expInLevel });
    });

    it("在庫が足りず T' に届かない行は動かさない（在庫の取り分を全部使うので、アメブを変えると到達Lvが上下する）", async () => {
      // SLOT_SHARED のピカチュウをアメ在庫の睡眠目標にし、在庫を 200 個にする（Lv40 の T' には足りない）
      const store = build({ ...SLOT_SHARED, species: [[25, 200], [4, 600]] });
      const [p] = store.rows.value.map((r) => r.id) as [string, string];
      store.setRowSleepTarget(p, "stock");
      const rows = store.rows.value;
      expect(stockRowOf(store, rows, p).reaches).toBe(false);
      expect(canAutoAdjustBoost(store.evaluateRows(rows), rows[0]!)).toBe(false);
      const before = solveOf(store, rows);
      const out = await raiseLevels(input(store, 450, { initialResult: before }));
      if (out.kind === "raised") {
        for (const option of out.options) expect(stockRowOf(store, option.rows, p).boost).toBe(stockRowOf(store, rows, p).boost);
      } else {
        expect(out.kind).toBe("unchanged");
      }
    });

    it("上の行のアメブを動かすと下のアメ在庫の行の取り分が減って到達が下がるなら、解かずに上の行を動かさないことにする", async () => {
      // ピカチュウ（ふつう、Lv30）・ピカチュウ（アメ在庫の睡眠目標、Lv40。在庫の残り 263 個では T' に足りない）・
      // ヒトカゲ（アメブ 0。かけらが足りない）。上のピカチュウがアメブを減らせばかけらが浮くが、要る種族アメが増え、計算機は在庫を
      // 上の行から取り分けるので、下のピカチュウの取り分が減る（モデルは上のピカチュウが万能アメを使えるとみなす）
      const store = build({
        boostLimit: 3000,
        shards: 200_000,
        species: [[25, 400], [4, 9999]],
        universal: { s: 0, m: 0, l: 50 },
        rows: [{ boxId: "u", pokedexId: 25, dst: 30 }, { boxId: "c", pokedexId: 25, dst: 40 }, { boxId: "d", pokedexId: 4, dst: 30, boost: 0 }],
      });
      const [u, c, d] = store.rows.value.map((r) => r.id) as [string, string, string];
      store.setRowSleepTarget(c, "stock");
      const rows = store.rows.value;
      const evaluated = store.evaluateRows(rows);
      const before = solveOf(store, rows);
      expect(stockRowOf(store, rows, c).reaches).toBe(false);
      expect(lineOf(before, d).candyDemandMet).toBe(false);
      // モデルだけで決めると、下のピカチュウの使うアメの数が減る（そのまま解くと、届いていなかった行が少ない数で「届いた」になり、
      // 比べ方では良くなったと見える）
      const plan = planBoosts({ plannerInput: evaluated.plannerInput!, current: before, variableIds: new Set([u, d]) }, "candy");
      if (plan.kind !== "plan") throw new Error("モデルで伸びない");
      const planned = rows.map((row) => {
        const boost = plan.boosts.get(row.id);
        return boost === undefined || boost === evaluated.byId.get(row.id)!.effectiveBoost ? row : store.withExplicitBoost(row, boost, { preserveTargetForExplicitBoost: true });
      });
      expect(stockRowOf(store, planned, c).candy).toBeLessThan(stockRowOf(store, rows, c).candy);
      // 全体のLvを伸ばすは、上のピカチュウを動かさないことにして求め直し、ほかに伸ばせないので解かずに終える
      const run = input(store, 3000, { initialResult: before });
      expect((await raiseLevels(run)).kind).toBe("unchanged");
      expect(run.solves()).toBe(0);
    });
  });

  it("checkRaise: 解かず・モデルも使わずに、全員届いていれば allReached、アメブなしは unavailable、動かす行が無ければ unchanged、あれば possible", () => {
    const all = build({ boostLimit: 3000, shards: 100_000_000, species: [[25, 99_999]], rows: [{ boxId: "a", pokedexId: 25, dst: 30 }] });
    expect(check(all)).toEqual({ kind: "allReached" });
    const none = build({ boostKind: "none", boostLimit: 0, shards: 100, species: [], rows: [{ boxId: "a", pokedexId: 25, dst: 30 }] });
    expect(check(none, undefined, { pokemonResults: [] } as unknown as LevelPlannerResult)).toEqual({ kind: "unavailable" });
    // アメブ枠が足りず、届いている上の行から枠を空けられる
    candyStore.resetInventory();
    expect(check(build(SLOT_SHARED))).toEqual({ kind: "possible" });
    // アメもかけらも無い: モデルでは伸びないが、見込みはモデルで判断しないので possible。全員固定すると動かす行が無く
    // unchanged（先頭の届かない行の律速を添える）
    candyStore.resetInventory();
    const nothing = build({ boostLimit: 3000, shards: 0, species: [], rows: [{ boxId: "a", pokedexId: 25, dst: 30 }, { boxId: "b", pokedexId: 133, dst: 30 }] });
    expect(check(nothing)).toEqual({ kind: "possible" });
    const allLocked: BoostLocks = Object.fromEntries(nothing.rows.value.map((r) => [r.id, true] as const));
    expect(check(nothing, allLocked)).toEqual({ kind: "unchanged", limitingFactor: "candy" });
  });

  it("途中で止めると cancelled。時間の上限を超えたら、その節約するものは伸びなかったとして unchanged", async () => {
    const store = build(SLOT_SHARED);
    expect(await raiseLevels(input(store, 450, { isCancelled: () => false, savings: ["candy"] }))).toMatchObject({ kind: "raised" });
    // 最初に解いた直後は止めない。その次（描画へ譲ったあと・モデルを求めたあと・解いたあと）で止める
    for (const stopAt of [2, 3, 4]) {
      let calls = 0;
      const out = await raiseLevels(input(store, 450, { isCancelled: () => (calls += 1) >= stopAt }));
      expect(out).toEqual({ kind: "cancelled" });
    }
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

  it("両方で届いた行は、目標を越えた端数が違っても同じとみなす（下の行が下がる候補を採らない）", () => {
    const reached = (level: number, expInLevel: number) => ({ reachableLine: { level, expInLevel, effectiveTargetReached: true, candyDemandMet: true } });
    const base = result({ a: reached(45, 6), b: line(51, 158), c: line(10, 0) });
    // a の端数が増えても、b が下がれば悪い
    expect(compareResults(result({ a: reached(45, 21), b: line(50, 0), c: line(10, 0) }), base, rows)).toBeLessThan(0);
    expect(compareResults(result({ a: reached(45, 21), b: line(51, 158), c: line(10, 0) }), base, rows)).toBe(0);
    // 届いていた行が届かなくなれば、到達点で比べる
    expect(compareResults(result({ a: line(44, 900), b: line(55, 0), c: line(10, 0) }), base, rows)).toBeLessThan(0);
  });

  it("届いたかは配分器と同じく、要求したアメを配り終えたか（candyDemandMet）で見る。アメブ枠で削られて到達点に届かない行も、両方で配り終えていれば同じ", () => {
    // アメの個数を指定した行がアメブ枠で削られた形: アメは配り終えたが、到達点（effectiveTargetReached）には届かない
    const truncated = (level: number, expInLevel: number) => ({ reachableLine: { level, expInLevel, effectiveTargetReached: false, candyDemandMet: true } });
    const base = result({ a: truncated(40, 0), b: line(20, 0), c: line(10, 0) });
    // a の到達点が上がっても下がっても、b で決まる
    expect(compareResults(result({ a: truncated(38, 0), b: line(21, 0), c: line(10, 0) }), base, rows)).toBeGreaterThan(0);
    expect(compareResults(result({ a: truncated(42, 0), b: line(19, 0), c: line(10, 0) }), base, rows)).toBeLessThan(0);
    // 配り終えていない行は、到達点で比べる
    expect(compareResults(result({ a: line(39, 0), b: line(30, 0), c: line(10, 0) }), base, rows)).toBeLessThan(0);
    // 片方だけ配り終えた行は、到達Lvが低くても配り終えた方が良い（到達 prefix を先に比べる）
    expect(compareResults(result({ a: line(45, 0), b: line(30, 0), c: line(10, 0) }), base, rows)).toBeLessThan(0);
  });

  it("どちらかの結果に無い行は飛ばす", () => {
    const a = result({ a: line(30, 0), c: line(12, 0) });
    const b = result({ a: line(30, 0), b: line(99, 0), c: line(11, 0) });
    expect(compareResults(a, b, rows)).toBeGreaterThan(0);
  });
});

describe("raiseHeadline: 小窓の見出し", () => {
  const change = (title: string, level: [number, number]): RaiseRowChange => ({
    rowId: title,
    title,
    boost: { before: 0, after: 0 },
    candy: { before: 0, after: 0 },
    shards: { before: 0, after: 0 },
    level: { before: level[0], after: level[1] },
    expLeft: { before: 100, after: 100 },
    reach: level[1] > level[0] ? "better" : level[1] < level[0] ? "worse" : "same",
  });
  const report = (rows: RaiseRowChange[], lead: RaiseReport["lead"]): RaiseReport => ({
    rows,
    lead,
    boostRemaining: { before: 0, after: 0 },
    shardsRemaining: { before: 0, after: 0 },
    universalRemaining: { before: { s: 0, m: 0, l: 0 }, after: { s: 0, m: 0, l: 0 } },
    candyUsed: { before: 0, after: 0 },
  });

  it("届くLvが上がった行があれば、いちばん上の行。ほかにも上がった行があれば others", () => {
    // ピカチュウはアメブを出しただけ（Lvはそのまま）。ヒトカゲだけが上がる
    expect(raiseHeadline(report([change("ピカチュウ", [40, 40]), change("ヒトカゲ", [44, 51])], { rowId: "ヒトカゲ", title: "ヒトカゲ" })))
      .toEqual({ kind: "levelUp", title: "ヒトカゲ", others: false });
    expect(raiseHeadline(report([change("フシギダネ", [30, 31]), change("ヒトカゲ", [44, 51])], { rowId: "フシギダネ", title: "フシギダネ" })))
      .toEqual({ kind: "levelUp", title: "フシギダネ", others: true });
  });

  it("下がった行は数えない。上がった行が無ければ、到達点が良くなったいちばん上の行（経験値が増えた）", () => {
    expect(raiseHeadline(report([change("ピカチュウ", [40, 40]), change("ヒトカゲ", [51, 50])], { rowId: "ピカチュウ", title: "ピカチュウ" })))
      .toEqual({ kind: "expGained", title: "ピカチュウ" });
    expect(raiseHeadline(report([change("ピカチュウ", [40, 40])], null))).toEqual({ kind: "none" });
  });
});
