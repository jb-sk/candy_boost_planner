import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import type { CalcRow, CalcStore } from "../../../composables/useCalcStore";
import { useCandyStore } from "../../../composables/useCandyStore";
import { cancelPersist } from "../../../persistence/deferredPersist";
import { addBoxRow, createCalcStore } from "../../../../tests/helpers/fakeIndividuals";
import { solveLevelPlan } from "../../level-planner/core/solveLevelPlan";
import type { LevelPlannerInput, LevelPlannerResult } from "../../level-planner/types";
import { calcExp, calcExpAndCandyMixed } from "../../pokesleep/exp";
import { simulateCandyBudget } from "../../pokesleep/simulateCandyBudget";
import {
  adviseRow,
  adviseRows,
  boostMarginal,
  createAdviceContext,
  diagnose,
  recommendBoost,
  type AdviceContext,
} from "../advice";
import {
  boostSlotRemaining,
  initialFineTuneState,
  opRange,
  type FineTuneBase,
  type FineTuneState,
} from "../draft";

/** 本物のストアとソルバーで、boostMarginal・効果・おすすめ量・診断を独立に求めた値と突き合わせる。 */

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

/** 行ごとの設定。pokedexId は 25（ピカチュウ系）/ 133（イーブイ）/ 7（ゼニガメ）など。 */
interface RowSpec {
  boxId: string;
  pokedexId: number;
  src: number;
  dst: number;
  expRemaining?: number;
  /** 明示アメブ。省略は導出（全アメブ） */
  boost?: number;
}

interface World {
  boostKind?: "full" | "mini";
  boostLimit?: number;
  shards?: number;
  species?: Array<[number, number]>;
  universalL?: number;
  universalS?: number;
  rows: RowSpec[];
}

describe("advice: 本物のストアとソルバー", () => {
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
    const boostLimit = world.boostLimit ?? 3500;
    store.onBoostCandyRemainingInput(String(boostLimit));
    store.onTotalShardsInput(String(world.shards ?? 100_000_000));
    for (const [dex, count] of world.species ?? []) store.updateSpeciesCandy(dex, count);
    if (world.universalL !== undefined || world.universalS !== undefined) {
      store.updateUniversalCandy({ s: world.universalS ?? 0, m: 0, l: world.universalL ?? 0 });
    }
    const ids: string[] = [];
    for (const spec of world.rows) {
      addBoxRow(store, {
        boxId: spec.boxId, pokedexId: spec.pokedexId, srcLevel: spec.src, dstLevelDefault: spec.dst,
        expType: 600, nature: "normal", expRemaining: spec.expRemaining,
      });
      const id = store.rows.value[store.rows.value.length - 1]!.id;
      ids.push(id);
      if (spec.boost !== undefined) store.onRowBoostCandy(id, String(spec.boost));
    }
    return { store, ids, boostLimit };
  }

  /** 下書きの行一覧から、プランナーを実際に走らせた最新の結果とともに文脈を作る。 */
  function contextOf(store: CalcStore, boostLimit: number, state?: FineTuneState, result?: LevelPlannerResult) {
    const rows = state?.rows ?? store.rows.value;
    const evaluated = store.evaluateRows(rows);
    const solved = result ?? solveLevelPlan(evaluated.plannerInput!);
    const base: FineTuneBase = { rows: store.rows.value, evaluated: store.evaluateRows(store.rows.value), result: solved, boostLimit };
    const current = state ?? initialFineTuneState(base);
    const ctx = createAdviceContext({
      deps: { evaluateRows: store.evaluateRows, withExplicitBoost: store.withExplicitBoost },
      base,
      state: current,
      evaluated,
      result: solved,
    });
    return { ctx, base, state: current, evaluated, result: solved, rows };
  }

  /** boostMarginal だけを使う文脈。結果は使わないので、プランナーは走らせない。 */
  function marginalContext(store: CalcStore, boostLimit: number) {
    const stub = { pokemonResults: [], summary: {} } as unknown as LevelPlannerResult;
    return contextOf(store, boostLimit, undefined, stub);
  }

  const rowOf = (rows: readonly CalcRow[], id: string) => rows.find((r) => r.id === id)!;

  /** プランナーを通さず、行の需要を独立に求める（calcExpAndCandyMixed）。 */
  function direct(row: CalcRow, kind: "full" | "mini", n: number) {
    const toNext = calcExp(row.srcLevel, row.srcLevel + 1, row.expType);
    const expGot = row.expRemaining > 0 ? Math.max(0, toNext - row.expRemaining) : 0;
    const m = calcExpAndCandyMixed({
      srcLevel: row.srcLevel, dstLevel: row.dstLevel, dstExpInLevel: 0,
      expType: row.expType, nature: row.nature, boost: kind, boostCandy: n, expGot,
    });
    const total = m.boostCandy + m.normalCandy;
    const subject = { currentLevel: row.srcLevel, currentExpInLevel: expGot, expType: row.expType, nature: row.nature };
    const run = simulateCandyBudget(subject, n, total, Infinity, kind);
    return { total, shards: m.shards, runShards: run.shards, expGained: run.expGained };
  }

  describe("boostMarginal: simulateCandyBudget の n と n' の差", () => {
    it("設計書 §2.1 の例（EXPタイプ600・Lv24 で次まで14・目標26・full）: 0 → 1 個で総アメ -2・かけら +178", () => {
      const { store, ids, boostLimit } = build({ rows: [{ boxId: "a", pokedexId: 25, src: 24, dst: 26, expRemaining: 14, boost: 0 }] });
      const { ctx, rows } = marginalContext(store, boostLimit);
      const row = rowOf(rows, ids[0]!);
      expect(direct(row, "full", 0)).toMatchObject({ total: 19, shards: 1802 });
      expect(direct(row, "full", 1)).toMatchObject({ total: 17, shards: 1980 });
      const m = boostMarginal(ctx, ids[0]!, 1)!;
      expect(m).toMatchObject({ rowId: ids[0], from: 0, to: 1, deltaCandy: -2, deltaShards: 178, savedCandy: 2 });
    });

    it.each(["full", "mini"] as const)("%s: いくつもの (n, n') で、独立に求めた総アメ・かけら・EXPの差と一致する（先端が Lv をまたぐ範囲を含む）", (kind) => {
      const { store, ids, boostLimit } = build({ boostKind: kind, rows: [{ boxId: "a", pokedexId: 25, src: 10, dst: 60, boost: 40 }] });
      const { ctx, rows } = marginalContext(store, boostLimit);
      const id = ids[0]!;
      const row = rowOf(rows, id);
      const full = store.evaluateRows(rows).byId.get(id)!.fullBoost;
      expect(full).toBeGreaterThan(100);
      for (const to of [0, 1, 39, 41, 60, 100, 101, Math.floor(full / 2), full - 1, full]) {
        const a = direct(row, kind, 40);
        const b = direct(row, kind, to);
        const m = boostMarginal(ctx, id, to)!;
        expect(m.from).toBe(40);
        expect(m.to).toBe(to);
        expect(m.deltaCandy).toBe(b.total - a.total);
        expect(m.deltaShards).toBe(b.shards - a.shards);
        // simulateCandyBudget（ソルバーと同じ中核）のかけらとも一致する
        expect(b.runShards).toBe(b.shards);
        expect(m.deltaExp).toBe(b.expGained - a.expGained);
      }
    });

    it("+1 と -1 は非対称（先端の Lv で1個あたりのかけらが変わる）。どちらも独立に求めた値と一致する", () => {
      const { store, ids, boostLimit } = build({ rows: [{ boxId: "a", pokedexId: 25, src: 10, dst: 60, boost: 0 }] });
      const id = ids[0]!;
      const full = store.evaluateRows(store.rows.value).byId.get(id)!.fullBoost;
      let found = -1;
      for (let n = 1; n < full && found < 0; n += 1) {
        store.onRowBoostCandy(id, String(n));
        const { ctx, rows } = marginalContext(store, boostLimit);
        const row = rowOf(rows, id);
        const up = boostMarginal(ctx, id, n + 1)!;
        const down = boostMarginal(ctx, id, n - 1)!;
        expect(up.deltaShards).toBe(direct(row, "full", n + 1).shards - direct(row, "full", n).shards);
        expect(down.deltaShards).toBe(direct(row, "full", n - 1).shards - direct(row, "full", n).shards);
        if (up.deltaShards !== -down.deltaShards) found = n;
      }
      expect(found).toBeGreaterThan(0);
    });

    it("to が今の値のときは変化がすべて 0", () => {
      const { store, ids, boostLimit } = build({ rows: [{ boxId: "a", pokedexId: 25, src: 10, dst: 40, boost: 20 }] });
      const { ctx } = marginalContext(store, boostLimit);
      const m = boostMarginal(ctx, ids[0]!, 20)!;
      expect(m).toMatchObject({ deltaCandy: 0, deltaShards: 0, deltaExp: 0, savedCandy: 0 });
    });

    it("行が無ければ null。評価は同じ文脈で使い回す", () => {
      const { store, ids, boostLimit } = build({ rows: [{ boxId: "a", pokedexId: 25, src: 10, dst: 40, boost: 20 }] });
      let evaluations = 0;
      const { ctx } = marginalContext(store, boostLimit);
      const counting: AdviceContext = {
        ...ctx,
        demandCache: new Map(),
        deps: { ...ctx.deps, evaluateRows: (list) => { evaluations += 1; return ctx.deps.evaluateRows(list); } },
      };
      expect(boostMarginal(counting, "missing", 1)).toBeNull();
      boostMarginal(counting, ids[0]!, 30);
      boostMarginal(counting, ids[0]!, 30);
      boostMarginal(counting, ids[0]!, 31);
      expect(evaluations).toBe(2);
    });

    it("時間の睡眠目標の行: 総アメはプランナーへ渡す数（睡眠EXPを引いた数）の差、かけらは simulateCandyBudget の差", () => {
      const { store, ids, boostLimit } = build({ species: [[25, 100_000]], rows: [{ boxId: "a", pokedexId: 25, src: 10, dst: 50, boost: 0 }] });
      const id = ids[0]!;
      store.setRowSleepTarget(id, 1000);
      const { ctx, rows } = marginalContext(store, boostLimit);
      const totals = (n: number) => {
        const evaluated = store.evaluateRows(rows.map((r) => (r.id === id ? store.withExplicitBoost(r, n, { preserveTargetForExplicitBoost: true }) : r)));
        return evaluated.plannerInput!.pokemonList.find((p) => p.pokemonId === id)!.candyTarget!.totalCandyUnits;
      };
      const row = rowOf(rows, id);
      const m = boostMarginal(ctx, id, 30)!;
      expect(totals(0)).toBeLessThan(direct(row, "full", 0).total);
      expect(m.deltaCandy).toBe(totals(30) - totals(0));
      const subject = { currentLevel: row.srcLevel, currentExpInLevel: 0, expType: row.expType, nature: row.nature };
      expect(m.deltaShards).toBe(
        simulateCandyBudget(subject, 30, totals(30), Infinity, "full").shards - simulateCandyBudget(subject, 0, totals(0), Infinity, "full").shards,
      );
    });
  });

  describe("在庫で決まる行（在庫のみの睡眠目標）", () => {
    const STOCK = 200;
    function stockWorld() {
      const world = build({
        species: [[26, STOCK]],
        rows: [{ boxId: "z", pokedexId: 26, src: 10, dst: 30, boost: 0 }],
      });
      world.store.setRowSleepTarget(world.ids[0]!, "stock");
      return world;
    }

    it("総アメが変わらず到達EXPが増える。要る数が在庫以下になる境目をまたぐと総アメが減る", () => {
      const { store, ids, boostLimit } = stockWorld();
      const id = ids[0]!;
      const { ctx, rows, evaluated } = marginalContext(store, boostLimit);
      const row = rowOf(rows, id);
      const stock = evaluated.byId.get(id)!.stockCandyAvailable!;
      expect(stock).toBe(STOCK);
      const need = (n: number) => direct(row, "full", n).total;
      expect(need(0)).toBeGreaterThan(stock);
      // 要る数が在庫以下になる最小のアメブ（全アメブ点で在庫以下になる）
      const full = evaluated.byId.get(id)!.fullBoost;
      expect(need(full)).toBeLessThanOrEqual(stock);
      let crossing = 1;
      while (crossing < full && need(crossing) > stock) crossing += 1;
      expect(crossing).toBeGreaterThan(2);
      expect(crossing + 3).toBeLessThanOrEqual(full);

      const before = boostMarginal(ctx, id, crossing - 1)!;
      expect(before.deltaCandy).toBe(0);
      expect(before.deltaExp).toBeGreaterThan(0);
      expect(before.deltaShards).toBeGreaterThan(0);
      expect(before.savedCandy).toBe(0);

      const across = boostMarginal(ctx, id, crossing + 3)!;
      expect(across.deltaCandy).toBe(Math.min(stock, need(crossing + 3)) - stock);
      expect(across.deltaCandy).toBeLessThanOrEqual(0);
    });

    it("effect は sameStockMoreExp。おすすめ量は付かない", () => {
      const { store, ids, boostLimit } = stockWorld();
      const id = ids[0]!;
      const { ctx, result } = contextOf(store, boostLimit);
      // 在庫のみの行は届く行として扱われる（先頭の未達行にならない）
      expect(result.pokemonResults[0]!.reachableLine.effectiveTargetReached).toBe(true);
      expect(adviseRow(ctx, id, "increase")).toEqual({ kind: "sameStockMoreExp" });
      const entry = adviseRows(ctx, "increase").get(id)!;
      expect(entry.advice).toEqual({ kind: "sameStockMoreExp" });
      expect(entry.recommendation).toBeNull();
    });
  });

  /**
   * A（ピカチュウ系）は種族アメ200と万能アメS25個（75）で自分の分を取り、B・C は届かない（アメで止まる）。
   * 行のアメブは先端の Lv がそれぞれ違うように決めてある。
   */
  function candyShortWorld(extra: Partial<World> = {}) {
    return build({
      species: [[25, 200]],
      universalS: 25,
      rows: [
        { boxId: "a", pokedexId: 25, src: 10, dst: 30, boost: 0 },
        { boxId: "b", pokedexId: 133, src: 10, dst: 40, boost: 60 },
        { boxId: "c", pokedexId: 7, src: 10, dst: 36, boost: 120 },
      ],
      ...extra,
    });
  }

  /**
   * 3行ともアメは十分あり、かけらだけが足りない。a・b は届き、c はかけらで止まる。
   * 総かけらは「a・b の分 + c の分の cFraction 倍」にする（c の不足 = c の分の残り）。
   */
  function shardShortWorld(cFraction = 0.5) {
    const world = build({
      species: [[25, 100_000], [133, 100_000], [7, 100_000]],
      rows: [
        { boxId: "a", pokedexId: 25, src: 10, dst: 60, boost: 300 },
        { boxId: "b", pokedexId: 133, src: 10, dst: 60, boost: 250 },
        { boxId: "c", pokedexId: 7, src: 10, dst: 60 },
      ],
    });
    const evaluated = world.store.evaluateRows(world.store.rows.value);
    const cost = (index: number) => {
      const row = world.store.rows.value[index]!;
      return direct(row, "full", evaluated.byId.get(row.id)!.effectiveBoost).shards;
    };
    const total = cost(0) + cost(1) + Math.floor(cost(2) * cFraction);
    world.store.onTotalShardsInput(String(total));
    return world;
  }

  describe("adviseRows: 効果とおすすめ量（§5.2、§5.3）", () => {
    it("増やす: 効果の kind が下へ回る・自分の不足・自分の不足。おすすめ量は先頭の未達行を伸ばす行だけに付く", () => {
      const { store, ids, boostLimit } = candyShortWorld();
      const [a, b, c] = ids as [string, string, string];
      const { ctx, result } = contextOf(store, boostLimit);
      expect(result.pokemonResults.map((p) => p.reachableLine.effectiveTargetReached)).toEqual([true, false, false]);
      const entries = adviseRows(ctx, "increase");
      expect(entries.get(a)!.advice).toEqual({ kind: "feedsBelow", beneficiaryIds: [b, c] });
      expect(entries.get(b)!.advice).toEqual({ kind: "selfShort" });
      expect(entries.get(c)!.advice).toEqual({ kind: "selfShort" });
      // b は使えるアメが0（万能アメは上の a が取る）なので、自分のアメブを増やしても伸びない。
      // c は先頭の未達行 b より下なので、伸びる見積もりでも出さない（浮いた分は先に b が受け取る）
      expect(entries.get(a)!.recommendation).toMatchObject({ targetRowId: b });
      expect(entries.get(a)!.recommendation!.boost).toBeGreaterThan(0);
      expect(entries.get(b)!.recommendation).toBeNull();
      expect(entries.get(c)!.recommendation).toBeNull();
    });

    it("全アメブ点にいる行は atFullBoost でおすすめ量が付かない", () => {
      const { store, ids } = build({
        boostLimit: 20,
        species: [[25, 100]],
        universalL: 2,
        rows: [
          { boxId: "a", pokedexId: 25, src: 10, dst: 30, boost: 5 },
          { boxId: "c", pokedexId: 7, src: 10, dst: 12, boost: 0 },
        ],
      });
      const c = ids[1]!;
      store.onRowBoostCandy(c, String(store.evaluateRows(store.rows.value).byId.get(c)!.fullBoost));
      const { ctx } = contextOf(store, 20);
      const entry = adviseRows(ctx, "increase").get(c)!;
      expect(entry.advice).toEqual({ kind: "noEffect", reason: "atFullBoost" });
      expect(entry.recommendation).toBeNull();
    });

    it("目標Lv・アメブを動かせない行（個数指定）は入らない。アメブなしのスロットでは空", () => {
      const { store, ids, boostLimit } = candyShortWorld();
      store.onRowCandyTarget(ids[2]!, "50");
      const { ctx } = contextOf(store, boostLimit);
      expect([...adviseRows(ctx, "increase").keys()]).toEqual([ids[0], ids[1]]);

      const none = build({ rows: [{ boxId: "a", pokedexId: 25, src: 10, dst: 30 }] });
      none.store.setSlotBoostKind("none");
      expect(adviseRows(contextOf(none.store, 0).ctx, "increase").size).toBe(0);
    });

    it("全員届いているとき: saving で、おすすめ量は出ない", () => {
      const { store, ids, boostLimit } = build({
        species: [[25, 100_000], [133, 100_000]],
        rows: [
          { boxId: "a", pokedexId: 25, src: 10, dst: 30, boost: 0 },
          { boxId: "b", pokedexId: 133, src: 10, dst: 36, boost: 40 },
        ],
      });
      const { ctx, result } = contextOf(store, boostLimit);
      expect(result.pokemonResults.every((p) => p.reachableLine.effectiveTargetReached)).toBe(true);
      const entries = adviseRows(ctx, "increase");
      for (const id of ids) {
        expect(entries.get(id)!.advice).toEqual({ kind: "saving" });
        expect(entries.get(id)!.recommendation).toBeNull();
      }
    });

    it("減らす: かけらで止まる行が selfShort、上の行は feedsBelow で、どれも減らすおすすめ量が付く。アメブ0の行は noBoost", () => {
      const { store, ids, boostLimit } = shardShortWorld();
      const [a, b, c] = ids as [string, string, string];
      const { ctx, result, evaluated } = contextOf(store, boostLimit);
      expect(result.pokemonResults.map((p) => p.constraintDiagnosis.limitingFactor)).toEqual([null, null, "shards"]);
      const entries = adviseRows(ctx, "decrease");
      expect(entries.get(a)!.advice).toEqual({ kind: "feedsBelow", beneficiaryIds: [c] });
      expect(entries.get(b)!.advice).toEqual({ kind: "feedsBelow", beneficiaryIds: [c] });
      expect(entries.get(c)!.advice).toEqual({ kind: "selfShort" });
      for (const id of [a, b, c]) {
        const rec = entries.get(id)!.recommendation!;
        expect(rec.targetRowId).toBe(c);
        expect(rec.boost).toBeLessThan(evaluated.byId.get(id)!.effectiveBoost);
      }
      store.onRowBoostCandy(b, "0");
      const zero = contextOf(store, boostLimit);
      const zeroEntries = adviseRows(zero.ctx, "decrease");
      expect(zeroEntries.get(b)!.advice).toEqual({ kind: "noEffect", reason: "noBoost" });
      expect(zeroEntries.get(b)!.recommendation).toBeNull();
    });
  });

  describe("recommendBoost: 「〇〇のLvを上げる」の量と名前（§5.5、D29）", () => {
    it("上の行として下へ回す: 名前は beneficiaryIds の先頭1匹。かけらが十分なら、量は節約アメが s 以上になる最小の個数（絶対値）", () => {
      const { store, ids, boostLimit } = candyShortWorld();
      const [a, b] = ids as [string, string, string];
      const { ctx, result, rows } = contextOf(store, boostLimit);
      const advice = adviseRow(ctx, a, "increase")!;
      const rec = recommendBoost(ctx, a, "increase", advice)!;
      // a が浮かせる万能アメは b の不足より少ないので、b は届かず（これだけでは届きません）、下の c までは回らない（「など」にならない）
      expect(rec).toMatchObject({ rowId: a, targetRowId: b, andOthers: false, insufficient: true });

      // s = min(a が使っているアメのうち下の行が使えるもの, 下の届かない行の不足アメ合計)。a の使うアメは種族アメと万能アメだけ
      const supply = result.pokemonResults[0]!.reachableLine.candySupply;
      expect(supply.type).toEqual({ s: 0, m: 0 });
      const universalValue = supply.universal.s * 3 + supply.universal.m * 20 + supply.universal.l * 100;
      expect(universalValue).toBeGreaterThan(0);
      const shortage = result.pokemonResults[1]!.shortage.candyToTarget + result.pokemonResults[2]!.shortage.candyToTarget;
      const s = Math.min(universalValue, shortage);
      const row = rowOf(rows, a);
      const total0 = direct(row, "full", 0).total;
      // 最小性: rec.boost で節約アメが s 以上、1 個少ないと s 未満（絶対値で入る）
      expect(total0 - direct(row, "full", rec.boost).total).toBeGreaterThanOrEqual(s);
      expect(total0 - direct(row, "full", rec.boost - 1).total).toBeLessThan(s);
    });

    it("同じ文脈で何度求めても同じ。入れて再計算した後に求め直しても、今より減らす値にならない", () => {
      const { store, ids, boostLimit } = candyShortWorld();
      const a = ids[0]!;
      const first = contextOf(store, boostLimit);
      const advice = adviseRow(first.ctx, a, "increase")!;
      const rec1 = recommendBoost(first.ctx, a, "increase", advice)!;
      expect(recommendBoost(first.ctx, a, "increase", advice)).toEqual(rec1);
      store.onRowBoostCandy(a, String(rec1.boost));
      const second = contextOf(store, boostLimit);
      const advice2 = adviseRow(second.ctx, a, "increase")!;
      const rec2 = recommendBoost(second.ctx, a, "increase", advice2);
      if (rec2 !== null) expect(rec2.boost).toBeGreaterThan(rec1.boost);
    });

    it("自分の不足が減る行: 名前は自分。かけらが十分で、使えるアメを全部アメブにしても届かなければ、その数が入り「これだけでは届きません」", () => {
      // b は種族アメ100個。全部アメブにしても目標までのアメの半分ほどにしかならない
      const { store, ids, boostLimit } = build({
        species: [[133, 100]],
        rows: [{ boxId: "b", pokedexId: 133, src: 10, dst: 40, boost: 0 }],
      });
      const b = ids[0]!;
      const { ctx, evaluated } = contextOf(store, boostLimit);
      const advice = adviseRow(ctx, b, "increase")!;
      expect(advice).toEqual({ kind: "selfShort" });
      const rec = recommendBoost(ctx, b, "increase", advice)!;
      expect(rec).toMatchObject({ rowId: b, targetRowId: b, andOthers: false, insufficient: true });
      // 全アメブ点まで増やしても、使えるアメ100個より多くはアメブにならず伸びない。同じ伸びの最小の個数で止める
      expect(evaluated.byId.get(b)!.fullBoost).toBeGreaterThan(100);
      expect(rec.boost).toBe(100);
    });

    it("使えるアメが0の自分の不足は、自分のアメブを増やしても伸びないので出さない", () => {
      const { store, ids, boostLimit } = candyShortWorld();
      const b = ids[1]!;
      const { ctx, result } = contextOf(store, boostLimit);
      expect(result.pokemonResults[1]!.reachableLine.totalCandyUnitsUsed).toBe(0);
      expect(recommendBoost(ctx, b, "increase", adviseRow(ctx, b, "increase")!)).toBeNull();
    });

    it("範囲の中に解がある自分の不足: 不足アメ以上減る最小の個数", () => {
      // b は種族アメ350個で、不足アメは 598 - 350。全アメブにすれば足りる
      const { store, ids, boostLimit } = build({
        species: [[133, 350]],
        rows: [{ boxId: "b", pokedexId: 133, src: 10, dst: 40, boost: 0 }],
      });
      const b = ids[0]!;
      const { ctx, result, rows } = contextOf(store, boostLimit);
      const shortage = result.pokemonResults[0]!.shortage.candyToTarget;
      expect(shortage).toBeGreaterThan(0);
      const rec = recommendBoost(ctx, b, "increase", adviseRow(ctx, b, "increase")!)!;
      const row = rowOf(rows, b);
      expect(rec.insufficient).toBe(false);
      expect(direct(row, "full", 0).total - direct(row, "full", rec.boost).total).toBeGreaterThanOrEqual(shortage);
      expect(direct(row, "full", 0).total - direct(row, "full", rec.boost - 1).total).toBeLessThan(shortage);
    });

    it("上限: 残り枠で止まり、端を入れて「これだけでは届きません」になる", () => {
      const { store, ids } = build({
        boostLimit: 40,
        species: [[133, 350]],
        rows: [{ boxId: "b", pokedexId: 133, src: 10, dst: 40, boost: 0 }],
      });
      const b = ids[0]!;
      const { ctx, base, state, evaluated } = contextOf(store, 40);
      expect(opRange(base, state, evaluated, { kind: "boost", rowId: b }).max).toBe(40);
      const rec = recommendBoost(ctx, b, "increase", adviseRow(ctx, b, "increase")!)!;
      expect(rec).toMatchObject({ boost: 40, insufficient: true });
    });

    /**
     * つり合う点（§5.5）: かけらが足りないとき、不足アメが埋まる量まで増やすと、伸びた先頭の未達行がかけらで止まり、
     * 逆向き（減らす）のおすすめが出て往復した（ユーザー指摘、2026-10-22）。おすすめ量を入れてソルバーで計算し直しても、
     * 先頭の未達行は伸び、どの行にも逆向きのおすすめが出ない。
     */
    describe("つり合う点: おすすめ量を入れて計算し直しても往復しない", () => {
      /** 下書きの行に一度だけおすすめ量を入れ、ソルバーで計算し直した前後 */
      function pressOnce(store: CalcStore, boostLimit: number, rowId: string) {
        const before = contextOf(store, boostLimit);
        const direction = before.result.pokemonResults.some((p) => p.constraintDiagnosis.limitingFactor === "shards" && !p.reachableLine.effectiveTargetReached)
          ? "decrease" as const
          : "increase" as const;
        const rec = adviseRows(before.ctx, direction).get(rowId)!.recommendation!;
        expect(rec).not.toBeNull();
        const from = before.evaluated.byId.get(rowId)!.effectiveBoost;
        store.onRowBoostCandy(rowId, String(rec.boost));
        const after = contextOf(store, boostLimit);
        const reach = (r: LevelPlannerResult) => r.pokemonResults.find((p) => p.pokemonId === rec.targetRowId)!.reachableLine;
        const d = diagnose(after.result, after.rows, "full", boostSlotRemaining(after.base, after.evaluated));
        const nextDirection = d.kind === "shardsShort" ? "decrease" : d.kind === "candyShortRoom" ? "increase" : null;
        const next = nextDirection === null ? new Map() : adviseRows(after.ctx, nextDirection);
        return { rec, from, before: reach(before.result), after: reach(after.result), next, nextDirection, direction };
      }
      const progressed = (a: { level: number; expInLevel: number }, b: { level: number; expInLevel: number }) =>
        b.level > a.level || (b.level === a.level && b.expInLevel > a.expInLevel);

      it.each([60_000, 100_000, 150_000])("自分の不足を増やす（総かけら %i）: 届かない量でも先頭の未達行が伸び、減らすおすすめが出ない", (shards) => {
        const { store, ids, boostLimit } = build({ shards, species: [[133, 350]], rows: [{ boxId: "b", pokedexId: 133, src: 10, dst: 40, boost: 0 }] });
        const out = pressOnce(store, boostLimit, ids[0]!);
        expect(out.rec.boost).toBeGreaterThan(out.from);
        expect(progressed(out.before, out.after)).toBe(true);
        if (out.nextDirection === "decrease") {
          for (const entry of out.next.values()) expect(entry.recommendation).toBeNull();
        }
        const again = out.next.get(ids[0]!)?.recommendation ?? null;
        if (again !== null) expect(again.boost).toBeGreaterThan(out.rec.boost);
      });

      it("上の行から下へ回す（かけらが足りない）: 先頭の未達行が伸び、減らすおすすめが出ない", () => {
        const { store, ids, boostLimit } = build({
          shards: 40_000,
          species: [[25, 200]],
          universalS: 25,
          rows: [
            { boxId: "a", pokedexId: 25, src: 10, dst: 30, boost: 0 },
            { boxId: "b", pokedexId: 133, src: 10, dst: 40, boost: 60 },
          ],
        });
        const out = pressOnce(store, boostLimit, ids[0]!);
        expect(out.rec).toMatchObject({ rowId: ids[0], targetRowId: ids[1] });
        expect(progressed(out.before, out.after)).toBe(true);
        for (const entry of out.next.values()) {
          const rec = entry.recommendation;
          if (rec === null || out.nextDirection === null) continue;
          expect(out.nextDirection).toBe("increase");
        }
      });

      it("減らす（上の行のかけらを浮かせる）: 先頭の未達行が伸び、増やすおすすめが出ない", () => {
        const { store, ids, boostLimit } = build({
          shards: 700_000,
          species: [[25, 100_000], [133, 100_000], [7, 2_000]],
          rows: [
            { boxId: "a", pokedexId: 25, src: 10, dst: 60, boost: 300 },
            { boxId: "b", pokedexId: 133, src: 10, dst: 60, boost: 250 },
            { boxId: "c", pokedexId: 7, src: 10, dst: 60 },
          ],
        });
        const [a, b] = ids as [string, string, string];
        const out = pressOnce(store, boostLimit, a);
        expect(out.direction).toBe("decrease");
        expect(out.rec).toMatchObject({ rowId: a, targetRowId: b });
        expect(progressed(out.before, out.after)).toBe(true);
        expect(out.nextDirection).toBe("decrease");
      });
    });

    it("減らす: 浮くかけらが不足かけら以上になる最小の個数（名前は下の届かない行の先頭）", () => {
      // c の不足かけらを a が減らして賄える程度にする（c の分の 97%）
      const { store, ids, boostLimit } = shardShortWorld(0.97);
      const [a, , c] = ids as [string, string, string];
      const { ctx, result, rows } = contextOf(store, boostLimit);
      const shardShortage = result.pokemonResults[2]!.shortage.dreamShardShortage;
      expect(shardShortage).toBeGreaterThan(0);
      const advice = adviseRow(ctx, a, "decrease")!;
      expect(advice).toEqual({ kind: "feedsBelow", beneficiaryIds: [c] });
      const rec = recommendBoost(ctx, a, "decrease", advice)!;
      const row = rowOf(rows, a);
      const freed = (n: number) => direct(row, "full", 300).shards - direct(row, "full", n).shards;
      expect(freed(0)).toBeGreaterThan(shardShortage);
      expect(rec).toMatchObject({ rowId: a, targetRowId: c, andOthers: false, insufficient: false });
      expect(freed(rec.boost)).toBeGreaterThanOrEqual(shardShortage);
      expect(freed(rec.boost + 1)).toBeLessThan(shardShortage);
    });

    it("減らす: アメブを全部外してもかけらが足りないとき 0 を入れ、これだけでは届かない", () => {
      const { store, ids, boostLimit } = shardShortWorld(0.05);
      const [a, , c] = ids as [string, string, string];
      const { ctx, result, rows } = contextOf(store, boostLimit);
      const shardShortage = result.pokemonResults[2]!.shortage.dreamShardShortage;
      const row = rowOf(rows, a);
      expect(shardShortage).toBeGreaterThan(direct(row, "full", 300).shards - direct(row, "full", 0).shards);
      const advice = adviseRow(ctx, a, "decrease")!;
      expect(recommendBoost(ctx, a, "decrease", advice)).toMatchObject({ rowId: a, targetRowId: c, boost: 0, insufficient: true });
    });

    it("自分がかけらで止まる行は名前が自分", () => {
      const { store, ids, boostLimit } = build({
        shards: 3_000,
        species: [[25, 100_000]],
        rows: [{ boxId: "a", pokedexId: 25, src: 10, dst: 60, boost: 20 }],
      });
      const a = ids[0]!;
      const { ctx, result } = contextOf(store, boostLimit);
      expect(result.pokemonResults[0]!.constraintDiagnosis.limitingFactor).toBe("shards");
      const advice = adviseRow(ctx, a, "decrease")!;
      expect(advice).toEqual({ kind: "selfShort" });
      expect(recommendBoost(ctx, a, "decrease", advice)).toMatchObject({ rowId: a, targetRowId: a, boost: 0, insufficient: true });
    });

    it("出さないとき: saving / noEffect / sameStockMoreExp、全アメブ点にいる行", () => {
      const { store, ids, boostLimit } = candyShortWorld();
      const { ctx } = contextOf(store, boostLimit);
      for (const advice of [
        { kind: "saving" },
        { kind: "noEffect", reason: "speciesOnly" },
        { kind: "sameStockMoreExp" },
      ] as const) {
        expect(recommendBoost(ctx, ids[0]!, "increase", advice)).toBeNull();
      }
      store.onRowBoostCandy(ids[1]!, "9999");
      const full = contextOf(store, boostLimit);
      expect(recommendBoost(full.ctx, ids[1]!, "increase", { kind: "selfShort" })).toBeNull();
    });

    it("adviseRows の recommendation: 先頭の未達行を伸ばす selfShort / feedsBelow の行だけに付く", () => {
      const { store, ids, boostLimit } = candyShortWorld();
      const [a, b, c] = ids as [string, string, string];
      const { ctx } = contextOf(store, boostLimit);
      const entries = adviseRows(ctx, "increase");
      expect(entries.get(a)!.recommendation).toMatchObject({ targetRowId: b });
      expect(entries.get(b)!.recommendation).toBeNull();
      expect(entries.get(c)!.recommendation).toBeNull();
      const stock = build({ species: [[26, 200]], rows: [{ boxId: "z", pokedexId: 26, src: 10, dst: 30, boost: 0 }] });
      stock.store.setRowSleepTarget(stock.ids[0]!, "stock");
      const stockCtx = contextOf(stock.store, stock.boostLimit);
      expect(adviseRows(stockCtx.ctx, "increase").get(stock.ids[0]!)!.recommendation).toBeNull();
    });
  });

  describe("診断（§12.1）", () => {
    it("残り枠は summary.boost.boostRemaining でなく、評価した行の実効アメブから出る。かけらで使えなかった要求がある入力で食い違う", () => {
      // 700 の枠を、下の行 c の要求 700 が占める。c はかけら不足で 470 しか使えない（230 は使えなかった要求）
      const { store, ids } = build({
        boostLimit: 700,
        shards: 400_000,
        species: [[25, 100], [7, 2000]],
        universalL: 2,
        rows: [
          { boxId: "a", pokedexId: 25, src: 10, dst: 30, boost: 0 },
          { boxId: "b", pokedexId: 133, src: 10, dst: 40, boost: 0 },
          { boxId: "c", pokedexId: 7, src: 10, dst: 40, boost: 700 },
        ],
      });
      const [, b, c] = ids as [string, string, string];
      const { base, evaluated, result, rows } = contextOf(store, 700);
      const cResult = result.pokemonResults[2]!;
      expect(cResult.constraintDiagnosis.limitingFactor).toBe("shards");
      expect(cResult.reachableLine.boostedCandyUnits).toBeLessThan(700);

      const slot = boostSlotRemaining(base, evaluated);
      expect(slot).toBe(0);
      expect(result.summary.boost.boostRemaining).toBeGreaterThan(0);
      expect(result.summary.dreamShardsRemaining).toBeGreaterThan(0);

      // 先頭の未達行は b（アメ）。評価した行の残り枠 0 で判定すると「枠が残っていない」
      const diagnosis = diagnose(result, rows, "full", slot);
      expect(diagnosis).toMatchObject({ kind: "candyShortNoSlot", firstShortId: b });
      expect(diagnosis).toMatchObject({ alsoShort: [{ rowId: c, factor: "shards" }] });
      // 結果の boostRemaining で判定すると「余っている」と誤る
      expect(diagnose(result, rows, "full", result.summary.boost.boostRemaining).kind).toBe("candyShortRoom");
    });

    it("アメブ枠が足りず通常アメへ置き換えられて、需要は配り切ったが届かない行（role が境界にならない）が先頭の未達行になる", () => {
      // single-pipeline.test.ts の形: 上位が枠300を使い、下位には100しか残らない
      const buildRow = (id: string, dex: number, idx: number) => ({
        pokemonId: id, pokedexId: dex, name: id, type: "electric",
        currentLevel: 10, currentExpInLevel: 0, targetLevel: 40, targetExpInLevel: 0,
        expType: 600, nature: "normal", requestedBoostCandy: 300, boostAllowed: true,
        candyTarget: { totalCandyUnits: 300, boostedCandyUnits: 300 },
        priorityIndex: idx,
      });
      const result = solveLevelPlan({
        pokemonList: [buildRow("row0", 25, 0), buildRow("row1", 133, 1)],
        dreamShards: 10_000_000,
        boost: { kind: "full", limit: 400 },
        candyInventory: { species: {}, typeCandy: {}, universal: { s: 1000, m: 100, l: 10 } },
      } as unknown as LevelPlannerInput);
      const lower = result.pokemonResults[1]!;
      expect(lower.reachableLine.candyDemandMet).toBe(true);
      expect(lower.reachableLine.effectiveTargetReached).toBe(false);
      expect(lower.role).not.toBe("boundary");
      const rows: CalcRow[] = ["row0", "row1"].map((id) => ({
        id, title: id, pokedexId: 25, srcLevel: 10, dstLevel: 40, expRemaining: 0, expType: 600, nature: "normal", boostReachLevel: 40,
      }));
      expect(diagnose(result, rows, "full", 100)).toEqual({ kind: "boostCapShort", firstShortId: "row1", moreShort: false, alsoShort: [] });
    });

    it("在庫のみの行で使える在庫が要る数より少ない行は、届く行として扱われ、先頭の未達行にならない", () => {
      const { store, ids, boostLimit } = build({
        species: [[26, 60]],
        rows: [{ boxId: "z", pokedexId: 26, src: 10, dst: 50, boost: 0 }],
      });
      store.setRowSleepTarget(ids[0]!, "stock");
      const { result, rows, base, evaluated } = contextOf(store, boostLimit);
      expect(result.pokemonResults[0]!.reachableLine.effectiveTargetReached).toBe(true);
      expect(diagnose(result, rows, "full", boostSlotRemaining(base, evaluated)).kind).toBe("allReachedRoom");
    });

    it("先頭の未達行の律速で kind が決まり、結果の律速と一致する（実際のソルバーの結果）", () => {
      const { store, ids, boostLimit } = candyShortWorld();
      const { result, rows, base, evaluated } = contextOf(store, boostLimit);
      const d = diagnose(result, rows, "full", boostSlotRemaining(base, evaluated));
      // b の下の c もアメで止まっているので「〇〇以下は」
      expect(d).toEqual({ kind: "candyShortRoom", firstShortId: ids[1], moreShort: true, alsoShort: [] });
      // かけらで止まる行が先頭、アメで止まる行が下にある
      const shards = shardShortWorld(0.5);
      const mixed = contextOf(shards.store, shards.boostLimit);
      expect(mixed.result.pokemonResults[2]!.constraintDiagnosis.limitingFactor).toBe("shards");
      expect(diagnose(mixed.result, mixed.rows, "full", boostSlotRemaining(mixed.base, mixed.evaluated))).toMatchObject({
        kind: "shardsShort",
        firstShortId: shards.ids[2],
      });
    });
  });
});
