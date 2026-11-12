import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref, toRaw } from "vue";
import type { Composer } from "vue-i18n";
import { addBoxRow, createCalcStore, fakeIndividualsOf } from "../../tests/helpers/fakeIndividuals";
import { cancelPersist } from "../persistence/deferredPersist";
import { calcSleepLandingLevel } from "../domain/level-planner/sleepReachLevel";
import { solveLevelPlan } from "../domain/level-planner/core/solveLevelPlan";
import { dreamShardsPerCandy } from "../domain/pokesleep/tables";
import type { LevelPlannerInput, LevelPlannerResult } from "../domain/level-planner/types";
import { raiseLevels, type RaiseOption } from "../domain/fine-tune/raise";
import type { PlannerRunner } from "../workers/plannerRunner";
import type { CalcRow, CalcStore } from "./useCalcStore";
import { useCandyStore } from "./useCandyStore";
import { useFineTune } from "./useFineTune";

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

/** プレビューの実行役の代わり。頼まれた入力を溜め、結果は測定側が好きなときに返す。 */
function fakeRunner() {
  const runs: Array<{
    input: LevelPlannerInput;
    onResult: (output: { result: LevelPlannerResult; durationMs: number }) => void;
    onError: (error: unknown) => void;
  }> = [];
  const runnerCounts = { cancel: 0, dispose: 0 };
  const runner: PlannerRunner = {
    run: (input, onResult, onError) => {
      runs.push({ input, onResult, onError });
    },
    cancel: () => {
      runnerCounts.cancel += 1;
    },
    dispose: () => {
      runnerCounts.dispose += 1;
    },
  };
  return { runner, runs, runnerCounts };
}

describe("useFineTune（設計書 §10.4）", () => {
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

  /** 2匹。計算機の計算が終わるまで待つ。 */
  async function makeStore(totalShards?: string) {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    if (totalShards !== undefined) store.onTotalShardsInput(totalShards);
    store.onBoostCandyRemainingInput("5000");
    store.updateSpeciesCandy(133, 100_000);
    const add = (boxId: string, pokedexId: number) => {
      addBoxRow(store, { boxId, pokedexId, srcLevel: 10, dstLevelDefault: 50, expType: 600, nature: "normal" });
      return store.rows.value[store.rows.value.length - 1]!.id;
    };
    const a = add("a", 133);
    const b = add("b", 25);
    await vi.waitFor(() => {
      expect(store.planResultPending.value).toBe(false);
      expect(store.planResult.value).not.toBeNull();
    });
    return { store, a, b };
  }

  /** 日付の停止・再開と、ストアの適用の呼び出しを数える。 */
  function spied(store: CalcStore) {
    const counts = { held: 0, released: 0, replaced: 0 };
    const calc = {
      ...store,
      holdGameDate: () => {
        counts.held += 1;
        const release = store.holdGameDate();
        return () => {
          counts.released += 1;
          release();
        };
      },
      applyFineTuneDraft: (...args: Parameters<CalcStore["applyFineTuneDraft"]>) => {
        counts.replaced += 1;
        return store.applyFineTuneDraft(...args);
      },
    } as CalcStore;
    return { calc, counts };
  }

  function open(store: CalcStore, runnerKit = fakeRunner(), solve: (input: LevelPlannerInput) => LevelPlannerResult = solveLevelPlan) {
    const { calc, counts } = spied(store);
    const scope = effectScope();
    let solves = 0;
    // 「全体のLvを伸ばす」はプレビューの実行役を使わず、その場で本物のソルバーで解く
    const solvePlan = async (input: LevelPlannerInput) => {
      solves += 1;
      return solve(input);
    };
    const fineTune = scope.run(() => useFineTune(calc, { t, createRunner: () => runnerKit.runner, previewDelayMs: 1, solvePlan }))!;
    return { fineTune, scope, counts, solves: () => solves, ...runnerKit };
  }

  it("開いたとき日付の更新を止め、基準を固定して、下書きは空から始まる", async () => {
    const { store, a } = await makeStore();
    const { fineTune, counts, runs } = open(store);
    expect(counts.held).toBe(1);
    expect(fineTune.ready.value).toBe(true);
    expect(fineTune.isEmpty.value).toBe(true);
    // 基準の行は計算機の rows.value そのもの（写しを取らない。差し替えの検出に参照を使う）
    expect(fineTune.base.value!.rows).toBe(toRaw(store.rows.value));
    expect(fineTune.rowViews.value.map((r) => r.id)).toContain(a);
    // 下書きが空のうちは実行役を呼ばず、基準の結果を使う
    expect(runs).toHaveLength(0);
    expect(fineTune.previewing.value).toBe(false);
    expect(fineTune.apply()).toBe("empty");
    expect(counts.replaced).toBe(0);
  });

  it("計算機の計算が終わっていなければ、終わるまで基準を作らない", async () => {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    addBoxRow(store, { boxId: "a", pokedexId: 133, srcLevel: 10, dstLevelDefault: 50, expType: 600, nature: "normal" });
    const { fineTune } = open(store);
    expect(fineTune.ready.value).toBe(false);
    expect(fineTune.rowViews.value).toEqual([]);
    await vi.waitFor(() => expect(fineTune.ready.value).toBe(true));
  });

  it("op → プレビュー → 適用で applyFineTuneDraft が1回だけ呼ばれ、計算機の元に戻す1回で戻る", async () => {
    const { store, a } = await makeStore();
    const baseRows = store.rows.value;
    const { fineTune, counts, runs, scope } = open(store);

    const out = fineTune.dispatch({ kind: "set", rowId: a, boost: 40 });
    expect("state" in out).toBe(true);
    expect(fineTune.isEmpty.value).toBe(false);
    // 最新の結果がまだ今の版でない間は計算中
    expect(fineTune.previewing.value).toBe(true);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]!.input).toBe(fineTune.evaluated.value!.plannerInput);
    runs[0]!.onResult({ result: store.planResult.value!, durationMs: 1 });
    expect(fineTune.previewing.value).toBe(false);

    // 適用は下書きの行一覧をそのまま1回で書き込む
    expect(fineTune.apply()).toBe("applied");
    expect(counts.replaced).toBe(1);
    expect(store.rows.value.find((r) => r.id === a)!.boostOrExpAdjustment).toBe(40);
    // 閉じる（unmount）と日付の更新が再開する
    scope.stop();
    expect(counts.released).toBe(1);

    store.undo();
    expect(JSON.stringify(store.rows.value)).toBe(JSON.stringify(baseRows));
  });

  it("連続した op はプレビューを間引き、古い依頼を捨てて最後の版だけ計算する", async () => {
    const { store, a } = await makeStore();
    const { fineTune, runs, runnerCounts } = open(store);
    const cancelsBefore = runnerCounts.cancel;
    fineTune.dispatch({ kind: "set", rowId: a, boost: 10 });
    fineTune.dispatch({ kind: "set", rowId: a, boost: 20 });
    expect(runnerCounts.cancel).toBeGreaterThan(cancelsBefore);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(fineTune.evaluated.value!.byId.get(a)!.effectiveBoost).toBe(20);
    // 古い版の結果が届いても、今の版の結果にはならない
    const version = fineTune.state.value!.version;
    runs[0]!.onResult({ result: store.planResult.value!, durationMs: 1 });
    expect(fineTune.latest.value!.version).toBe(version);
  });

  it("プレビューが失敗すると計算中をやめ、結果は古いままにして、次の op で計算し直す", async () => {
    const { store, a } = await makeStore();
    const { fineTune, runs } = open(store);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fineTune.dispatch({ kind: "set", rowId: a, boost: 40 });
      await vi.waitFor(() => expect(runs).toHaveLength(1));
      runs[0]!.onError("boom");
      expect(fineTune.previewFailed.value).toBe(true);
      expect(fineTune.previewing.value).toBe(false);
      // 結果は今の版のものではないので、結果に頼る表示・操作は古いまま
      expect(fineTune.stale.value).toBe(true);

      fineTune.dispatch({ kind: "set", rowId: a, boost: 41 });
      expect(fineTune.previewFailed.value).toBe(false);
      expect(fineTune.previewing.value).toBe(true);
      await vi.waitFor(() => expect(runs).toHaveLength(2));
      runs[1]!.onResult({ result: store.planResult.value!, durationMs: 1 });
      expect(fineTune.stale.value).toBe(false);
      expect(fineTune.previewing.value).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("Lvピッカーのスライダーの1回のドラッグ（coalesce を添えた op）は、元に戻す1回で戻る", async () => {
    const { store, a } = await makeStore();
    const { fineTune } = open(store);
    const dstOf = () => fineTune.state.value!.rows.find((r) => r.id === a)!.dstLevel;
    const before = dstOf();
    const drag = { coalesceKey: "levelPicker:slider:1", coalesceWindowMs: Number.POSITIVE_INFINITY };
    for (const level of [before - 1, before - 2, before - 3]) fineTune.dispatch({ kind: "targetSet", rowId: a, level }, drag);
    expect(dstOf()).toBe(before - 3);
    fineTune.history.undo();
    expect(dstOf()).toBe(before);
    expect(fineTune.history.canUndo.value).toBe(false);
  });

  it("設定欄: 設定を変えると下書きが空でなくなり、プレビューの入力に入る。設定のリセットで戻り、適用で計算機の設定へ移る", async () => {
    const { store } = await makeStore();
    const { fineTune } = open(store);
    expect(fineTune.settings.value!.base).toEqual(store.settingsSnapshot());
    fineTune.dispatch({ kind: "shardsSet", count: 4321 });
    expect(fineTune.isEmpty.value).toBe(false);
    expect(fineTune.settings.value!.value.totalShards).toBe(4321);
    expect(fineTune.evaluated.value!.plannerInput!.dreamShards).toBe(4321);
    // 元に戻す1回で戻る
    fineTune.undo();
    expect(fineTune.isEmpty.value).toBe(true);
    fineTune.dispatch({ kind: "universalCandySet", size: "l", count: 7 });
    fineTune.dispatch({ kind: "settingsReset" });
    expect(fineTune.isEmpty.value).toBe(true);

    fineTune.dispatch({ kind: "minimizeBoostSet", on: true });
    fineTune.dispatch({ kind: "shardsSet", count: 4321 });
    expect(fineTune.apply()).toBe("applied");
    expect(store.minimizeBoost.value).toBe(true);
    expect(store.totalShards.value).toBe(4321);
  });

  it("元に戻す・やり直すは1件ずつで、ラベルは常に null、undo() は null を返す（D41）", async () => {
    const { store, a, b } = await makeStore();
    const { fineTune } = open(store);
    expect(fineTune.history.canUndo.value).toBe(false);
    expect(fineTune.history.undoLabel.value).toBeNull();

    fineTune.dispatch({ kind: "move", rowId: b, toIndex: 0 });
    fineTune.dispatch({ kind: "targetStep", rowId: a, by: -1 });
    expect(fineTune.history.canUndo.value).toBe(true);
    expect(fineTune.state.value!.rows.map((r) => r.id)).toEqual([b, a]);

    expect(fineTune.history.undo()).toBeNull();
    expect(fineTune.state.value!.rows.find((r) => r.id === a)!.dstLevel).toBe(50);
    expect(fineTune.state.value!.rows.map((r) => r.id)).toEqual([b, a]);
    expect(fineTune.history.canRedo.value).toBe(true);

    fineTune.history.undo();
    expect(fineTune.isEmpty.value).toBe(true);
    expect(fineTune.history.canUndo.value).toBe(false);

    expect(fineTune.history.redo()).toBeNull();
    expect(fineTune.state.value!.rows.map((r) => r.id)).toEqual([b, a]);
    // 版は戻さず、今の値から進む
    expect(fineTune.state.value!.version).toBeGreaterThan(3);
  });

  it("中身が変わらない op と拒否された op は、版も履歴も動かさない", async () => {
    const { store, a } = await makeStore();
    const { fineTune } = open(store);
    const version = fineTune.state.value!.version;
    fineTune.dispatch({ kind: "step", rowId: a, by: 0 });
    expect("rejected" in fineTune.dispatch({ kind: "move", rowId: "no-such-row", toIndex: 0 })).toBe(true);
    // 同じ行一覧の raise と、古い版から求めた raise
    fineTune.dispatch({ kind: "raise", rows: fineTune.state.value!.rows, fromVersion: version });
    expect(fineTune.dispatch({ kind: "raise", rows: fineTune.state.value!.rows, fromVersion: version - 1 })).toEqual({ rejected: "stale" });
    expect(fineTune.state.value!.version).toBe(version);
    expect(fineTune.history.canUndo.value).toBe(false);
  });

  it("一覧の表示データは、順番の変化とアメブの基準 → 変更後、サマリーの残り枠を出す", async () => {
    const { store, a, b } = await makeStore();
    const { fineTune } = open(store);
    const first = fineTune.rowViews.value[0]!;
    expect(first).toMatchObject({ id: a, index: 0, exclusion: null });
    expect(first.boost).not.toBeNull();
    const baseBoost = first.boost!.base;
    const baseRemaining = fineTune.summary.value!.boostRemaining!.base;

    fineTune.dispatch({ kind: "move", rowId: b, toIndex: 0 });
    const moved = fineTune.rowViews.value.find((r) => r.id === b)!;
    expect(moved).toMatchObject({ index: 0 });

    fineTune.dispatch({ kind: "set", rowId: a, boost: 10 });
    const edited = fineTune.rowViews.value.find((r) => r.id === a)!;
    expect(edited.boost).toMatchObject({ base: baseBoost, value: 10 });
    // 残り枠は評価した行の実効アメブから出す。減らした分だけ増える
    expect(fineTune.summary.value!.boostRemaining!.value).toBe(baseRemaining + baseBoost - 10);
  });

  it("睡眠到達Lv: 睡眠の行だけに出し、計算機と同じ着地点。睡眠のあとも目標に届かない行は届かない行（D46、D47）", async () => {
    for (const [shards, short] of [["100000000", false], ["1", true]] as const) {
      const { store, a, b } = await makeStore(shards);
      // a（イーブイ）は種族アメが十分。b（ピカチュウ）は睡眠目標なし
      store.setRowSleepTargetHours(a, 200);
      await vi.waitFor(() => {
        expect(store.planResultPending.value).toBe(false);
        expect(store.rowSleepExpFor(a)).toBeGreaterThan(0);
      });
      const { fineTune } = open(store);
      const view = (id: string) => fineTune.rowViews.value.find((r) => r.id === id)!;
      // 睡眠目標を入れた直後の計算機の計算が終わり、基準ができるまで待つ
      await vi.waitFor(() => {
        expect(fineTune.ready.value).toBe(true);
        expect(view(a).sleepReach).not.toBeNull();
      });
      expect(view(b).sleepReach).toBeNull();
      const reach = view(a).sleepReach!;
      expect(reach.kind).toBe("sleep");
      expect(view(a).reached.value).toBe(!short);
      // 届く行は睡眠のあと最終目標以上、届かない行は下
      const target = view(a).targetLevel.value;
      if (short) expect(reach.level).toBeLessThanOrEqual(target);
      else expect(reach.level).toBeGreaterThanOrEqual(target);
      const plan = store.getPokemonResult(a)!;
      const landing = calcSleepLandingLevel({
        reachedLevel: plan.reachableLine.level,
        reachedExpInLevel: plan.reachableLine.expInLevel,
        sleepExp: store.rowSleepExpFor(a),
        expType: store.rows.value.find((r) => r.id === a)!.expType,
      });
      expect(landing.shown && { level: landing.level, tenths: landing.tenths }).toEqual({ level: reach.level, tenths: reach.tenths });
    }
  });

  it("全体のLvを伸ばす: 上の行のアメブを動かして届かない行が届き、1件の履歴で入り、解いた結果がそのまま最新の結果になる", async () => {
    // a（ピカチュウ）は種族アメが足りず万能アメで届く。アメブ 0 だと万能アメを使い切り、b（イーブイ）が届かない
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onTotalShardsInput("100000000");
    store.onBoostCandyRemainingInput("3000");
    store.updateSpeciesCandy(25, 100);
    store.updateUniversalCandy({ s: 25, m: 0, l: 0 });
    addBoxRow(store, { boxId: "a", pokedexId: 25, srcLevel: 10, dstLevelDefault: 30, expType: 600, nature: "normal" });
    addBoxRow(store, { boxId: "b", pokedexId: 133, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
    const [a] = store.rows.value.map((r) => r.id) as [string, string];
    store.onRowBoostCandy(a, "0");
    await vi.waitFor(() => {
      expect(store.planResultPending.value).toBe(false);
      expect(store.planResult.value).not.toBeNull();
    });
    const { fineTune, runs, solves } = open(store);
    const reachedCount = () => fineTune.rowViews.value.filter((row) => row.reached.value === true).length;
    const before = reachedCount();
    const pending = fineTune.raiseAll();
    // 求めている間は下書きを変えられない
    expect(fineTune.raising.value).toBe(true);
    expect(fineTune.dispatch({ kind: "step", rowId: a, by: 1 })).toEqual({ rejected: "busy" });
    expect(fineTune.history.canUndo.value).toBe(false);
    expect((await pending).kind).toBe("raised");
    expect(fineTune.raising.value).toBe(false);
    // 開いた時点の結果（今の版）を使うので、解くのは候補の分だけ
    expect(solves()).toBeGreaterThanOrEqual(1);
    expect(reachedCount()).toBeGreaterThan(before);
    expect(fineTune.rowViews.value.find((row) => row.id === a)!.boost!.value).toBeGreaterThan(0);
    // プレビューの実行役は呼ばず、計算中にならない
    expect(fineTune.stale.value).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runs).toHaveLength(0);
    // 元に戻す1回で、押す前へ戻る
    expect(fineTune.history.canUndo.value).toBe(true);
    fineTune.undo();
    expect(fineTune.isEmpty.value).toBe(true);
  });

  /**
   * アメ節約とかけら節約で配り方が分かれる場面（本物のソルバー）。ピカチュウは全アメブ点まで入れても種族アメが足りず、
   * イーブイ（アメブ 0）は種族アメが足りない。イーブイが自分のアメブを増やすと届き、増やす量が多いほどアメが少なく
   * かけらが多い（アメ節約はアメブを多く、かけら節約は少なく入れる）
   */
  async function makeSavingSplitStore() {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.onTotalShardsInput("100000000");
    store.onBoostCandyRemainingInput("3000");
    store.updateSpeciesCandy(25, 20);
    store.updateSpeciesCandy(133, 100);
    addBoxRow(store, { boxId: "p", pokedexId: 25, srcLevel: 10, dstLevelDefault: 25, expType: 600, nature: "normal" });
    addBoxRow(store, { boxId: "e", pokedexId: 133, srcLevel: 10, dstLevelDefault: 20, expType: 600, nature: "normal" });
    const [p, e] = store.rows.value.map((r) => r.id) as [string, string];
    store.onRowBoostCandy(e, "0");
    await vi.waitFor(() => {
      expect(store.planResultPending.value).toBe(false);
      expect(store.planResult.value).not.toBeNull();
    });
    return { store, p, e };
  }

  it("全体のLvを伸ばす: はじめはアメ節約だけを求めて入れ、かけら節約は後から求める。結果が違えば両方になり、別の通りに替えても元に戻すは1件のまま", async () => {
    const { store } = await makeSavingSplitStore();
    const { fineTune, runs } = open(store);
    const out = await fineTune.raiseAll();
    expect(out.kind).toBe("raised");
    if (out.kind !== "raised") return;
    expect(out.options.map((o) => o.savings)).toEqual([["candy"]]);
    expect(fineTune.raising.value).toBe(false);
    // かけら節約を求めても、下書き・最新の結果は変えない
    const options = await out.more;
    expect(options?.map((o) => o.savings)).toEqual([["candy"], ["shards"]]);
    expect(options![0]).toBe(out.options[0]);
    expect(fineTune.state.value!.version).toBe(out.version);
    const [candy, shards] = options as [RaiseOption, RaiseOption];
    expect(fineTune.state.value!.rows).toBe(candy.rows);
    expect(fineTune.state.value!.version).toBe(out.version);
    expect(fineTune.latest.value!.result).toBe(candy.result);
    // かけら節約に替える。解いた結果をそのまま最新の結果にする（プレビューを待たない）
    const switched = fineTune.selectRaiseOption(shards, out.version);
    expect(switched).not.toBeNull();
    expect(fineTune.state.value!.rows).toBe(shards.rows);
    expect(fineTune.latest.value).toEqual({ version: switched, result: shards.result });
    expect(fineTune.stale.value).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runs).toHaveLength(0);
    // 替えた前の版を渡しても替えない（下書きが変わっている）
    expect(fineTune.selectRaiseOption(candy, out.version)).toBeNull();
    // 元に戻す1回で、押す前へ戻る
    fineTune.undo();
    expect(fineTune.isEmpty.value).toBe(true);
    expect(fineTune.history.canUndo.value).toBe(false);
  });

  it("全体のLvを伸ばす: アメ節約で伸びなければ続けてかけら節約を求め、伸びればそれを入れる（後から求めるものは無い）", async () => {
    const { store } = await makeSavingSplitStore();
    // かけら節約で解く入力（本物のソルバーで確かめる）を先に集める
    const initialKey = JSON.stringify(store.evaluateRows(store.rows.value).plannerInput);
    const shardsKeys = new Set<string>();
    const direct = await raiseLevels({
      deps: { evaluateRows: store.evaluateRows, withExplicitBoost: store.withExplicitBoost },
      base: { boostLimit: 3000 },
      rows: store.rows.value,
      savings: ["shards"],
      solve: async (input) => {
        shardsKeys.add(JSON.stringify(input));
        return solveLevelPlan(input);
      },
    });
    expect(direct.kind).toBe("raised");
    // アメ節約で解く入力は、伸びなかった結果（はじめの結果）を返す
    const initial = solveLevelPlan(JSON.parse(initialKey) as LevelPlannerInput);
    const { fineTune } = open(store, undefined, (input) => {
      const key = JSON.stringify(input);
      return key === initialKey || shardsKeys.has(key) ? solveLevelPlan(input) : initial;
    });
    const out = await fineTune.raiseAll();
    if (out.kind !== "raised") throw new Error(`伸びていない: ${out.kind}`);
    expect(out.options.map((o) => o.savings)).toEqual([["shards"]]);
    expect(out.more).toBeNull();
    expect(fineTune.state.value!.rows).toBe(out.options[0]!.rows);
  });

  it("全体のLvを伸ばす: 小窓のキャンセル（revertRaise）は、伸ばした直後の版のときだけ押す前の下書きへ戻す。やり直すで戻せる", async () => {
    const { store } = await makeSavingSplitStore();
    const { fineTune } = open(store);
    const out = await fineTune.raiseAll();
    if (out.kind !== "raised") throw new Error("伸びていない");
    const raisedRows = fineTune.state.value!.rows;
    // 違う版では戻さない
    expect(fineTune.revertRaise(out.version + 1)).toBe(false);
    expect(fineTune.state.value!.rows).toBe(raisedRows);
    expect(fineTune.revertRaise(out.version)).toBe(true);
    expect(fineTune.isEmpty.value).toBe(true);
    expect(fineTune.history.canUndo.value).toBe(false);
    // 裏で求めていたかけら節約も止める
    expect(await out.more).toBeNull();
    fineTune.redo();
    expect(fineTune.state.value!.rows).toEqual(raisedRows);
  });

  it("全体のLvを伸ばす: 求めている途中で取り消す（LvUp中止）と cancelled で、下書きは押す前のまま。また押せば伸びる", async () => {
    const { store } = await makeSavingSplitStore();
    const { fineTune } = open(store);
    // 求めていないときは何もしない
    fineTune.cancelRaise();
    const pending = fineTune.raiseAll();
    expect(fineTune.raising.value).toBe(true);
    fineTune.cancelRaise();
    expect(await pending).toEqual({ kind: "cancelled" });
    expect(fineTune.raising.value).toBe(false);
    expect(fineTune.isEmpty.value).toBe(true);
    expect(fineTune.history.canUndo.value).toBe(false);
    // 取り消しは「伸びない」と覚えない（押せない見た目にしない）
    expect(fineTune.raiseCheck.value.kind).toBe("possible");
    expect((await fineTune.raiseAll()).kind).toBe("raised");
  });

  it("全体のLvを伸ばす: 実行役で解いている途中で取り消すと、解いている依頼を捨てて cancelled", async () => {
    const { store } = await makeSavingSplitStore();
    // 押した版の結果が無い（はじめに解く）ようにして、実行役（作り物）へ依頼させ、返さないまま取り消す
    // 実行役はプレビュー用（はじめに作る）と全体のLvを伸ばす用（押したときに作る）を分ける
    const scope = effectScope();
    const preview = fakeRunner();
    const raise = fakeRunner();
    let created = 0;
    const createRunner = () => (created++ === 0 ? preview.runner : raise.runner);
    const fineTune = scope.run(() => useFineTune(spied(store).calc, { t, createRunner, previewDelayMs: 1 }))!;
    fineTune.dispatch({ kind: "step", rowId: store.rows.value[0]!.id, by: -1 });
    const pending = fineTune.raiseAll();
    await vi.waitFor(() => expect(raise.runs).toHaveLength(1));
    fineTune.cancelRaise();
    expect(await pending).toEqual({ kind: "cancelled" });
    expect(raise.runnerCounts.cancel).toBeGreaterThanOrEqual(1);
    expect(fineTune.raising.value).toBe(false);
    scope.stop();
  });

  it("全体のLvを伸ばす: 後から求めるかけら節約は、止める（小窓を閉じた）か下書きが変わると何も返さない", async () => {
    const { store } = await makeSavingSplitStore();
    const { fineTune } = open(store);
    const out = await fineTune.raiseAll();
    if (out.kind !== "raised") throw new Error("伸びていない");
    fineTune.stopRaiseMore();
    expect(await out.more).toBeNull();
    // 押す前へ戻す（下書きが変わる）と、求めかけのかけら節約は止まる。押し直せば、止めずに求め終える
    fineTune.undo();
    const again = await fineTune.raiseAll();
    if (again.kind !== "raised") throw new Error("伸びていない");
    fineTune.undo();
    expect(await again.more).toBeNull();
    const third = await fineTune.raiseAll();
    if (third.kind !== "raised") throw new Error("伸びていない");
    expect((await third.more)?.length).toBe(2);
  });

  it("アメブ固定: 開いている間だけの印で、適用するものは無く（下書きは空のまま）、計算し直さない。元に戻せる。固定した行は全体のLvを伸ばすで動かない", async () => {
    const { store, p } = await makeSavingSplitStore();
    const { fineTune, runs } = open(store);
    const view = () => fineTune.rowViews.value.find((r) => r.id === p)!;
    expect(view().boost).toMatchObject({ locked: false, lockable: true });
    expect(fineTune.dispatch({ kind: "boostLockSet", rowId: p, on: true })).toHaveProperty("state");
    expect(view().boost!.locked).toBe(true);
    expect(fineTune.isEmpty.value).toBe(true);
    expect(fineTune.history.canUndo.value).toBe(true);
    expect(fineTune.stale.value).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runs).toHaveLength(0);
    // ピカチュウを固定しても、イーブイが自分のアメブを増やして伸びる（固定したピカチュウのアメブは動かない）
    const out = await fineTune.raiseAll();
    if (out.kind === "raised") {
      const boostOf = (rows: readonly CalcRow[]) => store.evaluateRows(rows).byId.get(p)!.effectiveBoost;
      for (const option of out.options) expect(boostOf(option.rows)).toBe(boostOf(store.rows.value));
    }
    // 下書きを変えたあとでも、固定だけを変えたら計算し直さない
    fineTune.undo();
    fineTune.undo();
    expect(fineTune.state.value!.boostLocks).toEqual({});
    expect(fineTune.dispatch({ kind: "step", rowId: p, by: -1 })).toHaveProperty("state");
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    runs[0]!.onResult({ result: solveLevelPlan(fineTune.evaluated.value!.plannerInput!), durationMs: 1 });
    await vi.waitFor(() => expect(fineTune.stale.value).toBe(false));
    fineTune.dispatch({ kind: "boostLockSet", rowId: p, on: true });
    expect(fineTune.stale.value).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(runs).toHaveLength(1);
  });

  it("アメの数: 減らした行は表に下書きの値を出し、個数指定の行になる。計算機と同じくアメブも目標Lvも動かせる。元の数に戻すと元の行に戻る", async () => {
    const { store, a } = await makeStore("100000000");
    const { fineTune } = open(store);
    const view = () => fineTune.rowViews.value.find((r) => r.id === a)!;
    const edit = view().candyEdit!;
    expect(edit).toMatchObject({ min: 0, changed: false });
    expect(edit.max).toBeGreaterThan(edit.value);
    expect(fineTune.dispatch({ kind: "candyStep", rowId: a, by: -10 })).toHaveProperty("state");
    expect(view()).toMatchObject({ candyTargeted: true, exclusion: null, targetAdjustable: true, candyEdit: { value: edit.value - 10, base: edit.value, changed: true } });
    expect(fineTune.dispatch({ kind: "candySet", rowId: a, candy: edit.value })).toHaveProperty("state");
    expect(view()).toMatchObject({ candyTargeted: false, exclusion: null });
    expect(fineTune.isEmpty.value).toBe(true);
  });

  it("アメ在庫の睡眠目標の行: 保存したアメブ個数が在庫の残りより多いときだけ、在庫の分だけ使うと知らせる（目標までに要る数で抑えたときは出さない）", async () => {
    const { store, a, b } = await makeStore();
    // 入れるときは在庫までに抑えられるので、b（ピカチュウ）は在庫 1000 個で 150 個入れてから在庫を 40 個に減らす
    // （目標までに 40 個より多く要る）。a（イーブイ）は在庫が十分にあり、目標までに要る数で抑えられる
    store.updateSpeciesCandy(25, 1000);
    store.setRowSleepTarget(a, "stock");
    store.setRowSleepTarget(b, "stock");
    store.onRowBoostCandy(a, "99999");
    store.onRowBoostCandy(b, "150");
    store.updateSpeciesCandy(25, 40);
    await vi.waitFor(() => {
      expect(store.planResultPending.value).toBe(false);
    });
    const { fineTune } = open(store);
    await vi.waitFor(() => {
      expect(fineTune.ready.value).toBe(true);
    });
    const view = (id: string) => fineTune.rowViews.value.find((r) => r.id === id)!;
    expect(store.rows.value.find((r) => r.id === b)!.boostOrExpAdjustment).toBe(150);
    expect(view(b).boost).toMatchObject({ value: 40, capped: { saved: 150, used: 40 } });
    expect(view(a).boost!.capped).toBeNull();
  });

  it("アメの数を変えた行は、目標Lvを選ぶと計算機と同じく個数指定が外れ、アメブも動かせる", async () => {
    const { store, a } = await makeStore("100000000");
    const { fineTune } = open(store);
    const view = () => fineTune.rowViews.value.find((r) => r.id === a)!;
    const rowOf = () => fineTune.state.value!.rows.find((r) => r.id === a)!;
    fineTune.dispatch({ kind: "candyStep", rowId: a, by: -10 });
    expect(rowOf().candyTarget).toBeDefined();
    const level = rowOf().dstLevel - 3;
    expect(fineTune.dispatch({ kind: "targetSet", rowId: a, level })).toHaveProperty("state");
    expect(rowOf()).toMatchObject({ dstLevel: level, candyTarget: undefined });
    expect(view()).toMatchObject({ candyTargeted: false, exclusion: null, targetAdjustable: true });
    // 元に戻す1回で、アメの数を変えた状態（個数指定）へ戻る
    fineTune.undo();
    expect(view()).toMatchObject({ candyTargeted: true, exclusion: null });
  });

  it("アメ1個あたりのかけらは到達Lvの値段（ゲームの表）。アメを減らして到達Lvが下がると、値段も下がる", async () => {
    const { store, a } = await makeStore("100000000");
    const { fineTune, runs } = open(store);
    const view = () => fineTune.rowViews.value.find((r) => r.id === a)!;
    const plan = store.getPokemonResult(a)!.reachableLine;
    // Lv ちょうどで止まった行はそのLvへ上がるアメ、Lv の途中で止まった行は次のLvへ向かうアメの値段
    const priceAt = (line: { level: number; expInLevel: number }) => dreamShardsPerCandy[line.expInLevel === 0 ? line.level : line.level + 1]!;
    const before = priceAt(plan);
    expect(view().shardsPerCandy).toEqual({ base: before, value: before });
    fineTune.dispatch({ kind: "candyStep", rowId: a, by: -200 });
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    const result = solveLevelPlan(fineTune.evaluated.value!.plannerInput!);
    runs[0]!.onResult({ result, durationMs: 1 });
    await vi.waitFor(() => expect(fineTune.stale.value).toBe(false));
    const line = result.pokemonResults.find((p) => p.pokemonId === a)!.reachableLine;
    expect(line.level).toBeLessThan(plan.level);
    expect(view().shardsPerCandy).toEqual({ base: before, value: priceAt(line) });
    expect(priceAt(line)).toBeLessThan(before);
  });

  it("全体のLvを伸ばす: 全員届いていれば allReached で、下書きを変えない", async () => {
    const { store } = await makeStore("100000000");
    store.updateSpeciesCandy(25, 100_000);
    await vi.waitFor(() => {
      expect(store.planResultPending.value).toBe(false);
      expect(store.planResult.value!.pokemonResults.every((p) => p.reachableLine.effectiveTargetReached)).toBe(true);
    });
    const { fineTune } = open(store);
    expect((await fineTune.raiseAll()).kind).toBe("allReached");
    expect(fineTune.isEmpty.value).toBe(true);
    expect(fineTune.history.canUndo.value).toBe(false);
  });

  it("全体のLvを伸ばす: 見込みはモデルで判断しない。モデルで伸びない入力でも押せる見た目で、押すと解かずに unchanged になり、その版のあいだは押せない見た目", async () => {
    // かけらが無く、イーブイはアメがあってもかけらで止まり、ピカチュウはアメが無い。どう配っても伸びない
    const { store, a } = await makeStore("0");
    const { fineTune, solves, runs } = open(store);
    expect(fineTune.raiseCheck.value).toEqual({ kind: "possible" });
    const out = await fineTune.raiseAll();
    expect(out.kind).toBe("unchanged");
    expect(solves()).toBe(0);
    expect(fineTune.raiseCheck.value).toEqual(out);
    expect(fineTune.isEmpty.value).toBe(true);
    // 下書きを変えると、プレビューを待つ間は直前の見込み（押して伸びなかった）のまま。結果が届くと見込みに戻る（動かす行があるので possible）
    expect(fineTune.dispatch({ kind: "step", rowId: a, by: 1 })).toHaveProperty("state");
    expect(fineTune.raiseCheck.value).toEqual(out);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(fineTune.raiseCheck.value).toEqual(out);
    runs[0]!.onResult({ result: solveLevelPlan(fineTune.evaluated.value!.plannerInput!), durationMs: 1 });
    expect(fineTune.raiseCheck.value).toEqual({ kind: "possible" });
  });

  it("すべて睡眠（アメを使わない睡眠目標）の行も、目標Lvを動かせる（アメブは動かせない。計算機と同じ）", async () => {
    const { store, a } = await makeStore();
    store.setRowSleepTarget(a, "all");
    await vi.waitFor(() => expect(store.planResultPending.value).toBe(false));
    const { fineTune } = open(store);
    await vi.waitFor(() => expect(fineTune.ready.value).toBe(true));
    const view = () => fineTune.rowViews.value.find((r) => r.id === a)!;
    expect(view()).toMatchObject({ exclusion: "noCandy", targetAdjustable: true });
    const level = view().targetLevel.value - 5;
    expect(fineTune.dispatch({ kind: "targetSet", rowId: a, level })).toHaveProperty("state");
    expect(view().targetLevel.value).toBe(level);
    expect(fineTune.dispatch({ kind: "step", rowId: a, by: 1 })).toEqual({ rejected: "excluded" });
  });

  it("基準が今の計算機と別物なら、適用せず stale を返す（黙って当て直さない）", async () => {
    const { store, a } = await makeStore();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { fineTune, counts } = open(store);
    fineTune.dispatch({ kind: "set", rowId: a, boost: 30 });
    store.setDstLevel(a, 40);
    expect(fineTune.apply()).toBe("stale");
    expect(counts.replaced).toBe(1);
    expect(store.rows.value.find((r) => r.id === a)!.boostOrExpAdjustment).not.toBe(30);
    errorSpy.mockRestore();
  });

  it("計算機から削除: 下書きから外れ、元に戻すで戻る。適用で計算機の行から外れ（ボックスの個体は残る）、計算機の元に戻す1回で戻る", async () => {
    const { store, a, b } = await makeStore();
    const baseRows = store.rows.value;
    store.activeRowId.value = b;
    const { fineTune, runs } = open(store);

    expect("state" in fineTune.dispatch({ kind: "removeRow", rowId: b })).toBe(true);
    expect(fineTune.rowViews.value.map((r) => r.id)).toEqual([a]);
    expect(fineTune.isEmpty.value).toBe(false);
    // 行の顔ぶれが変わるので、残った行だけでプレビューを計算する
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0]!.input.pokemonList.map((p) => p.pokemonId)).toEqual([a]);
    // 下書きの元に戻すで戻る
    fineTune.undo();
    expect(fineTune.rowViews.value.map((r) => r.id)).toEqual([a, b]);
    expect(fineTune.isEmpty.value).toBe(true);
    fineTune.redo();

    expect(fineTune.apply()).toBe("applied");
    expect(store.rows.value.map((r) => r.id)).toEqual([a]);
    // 選んでいた行を外したので、計算機で削除したときと同じく先頭の行を選ぶ
    expect(store.activeRowId.value).toBe(a);
    expect(fakeIndividualsOf(store).individualById.value.has("b")).toBe(true);
    store.undo();
    expect(JSON.stringify(store.rows.value)).toBe(JSON.stringify(baseRows));
  });

  it("計算機から削除: 最後の1匹は外せない（行が無いとプランナーの入力が作れず、プレビューが届かない）", async () => {
    const { store, a, b } = await makeStore();
    const { fineTune } = open(store);
    fineTune.dispatch({ kind: "removeRow", rowId: a });
    expect(fineTune.dispatch({ kind: "removeRow", rowId: b })).toEqual({ rejected: "lastRow" });
    expect(fineTune.rowViews.value.map((r) => r.id)).toEqual([b]);
  });

  it("ニックネーム: 変えると表の名前が変わり、適用でボックスの個体へ書く。開いた時点の名前に戻すと下書きが空に戻る。計算機の元に戻す1回で戻る", async () => {
    const { store, a } = await makeStore();
    fakeIndividualsOf(store).set("a", { label: "イーブイ" });
    const baseRows = store.rows.value;
    const { fineTune } = open(store);
    const view = () => fineTune.rowViews.value.find((row) => row.id === a)!;
    expect(view().nickname).toEqual({ base: "イーブイ", value: "イーブイ", placeholder: "(no name)" });

    fineTune.dispatch({ kind: "nicknameSet", rowId: a, nickname: "ブイ" });
    expect(view().title).toBe("ブイ");
    expect(view().nickname!.value).toBe("ブイ");
    expect(fineTune.isEmpty.value).toBe(false);
    // 開いた時点の名前に戻すと、行も開いた時点の行（同じ参照）に戻る
    fineTune.dispatch({ kind: "nicknameSet", rowId: a, nickname: "イーブイ" });
    expect(fineTune.isEmpty.value).toBe(true);
    expect(fineTune.state.value!.rows.every((row, i) => row === fineTune.base.value!.rows[i])).toBe(true);

    fineTune.dispatch({ kind: "nicknameSet", rowId: a, nickname: "ブイ" });
    expect(fineTune.apply()).toBe("applied");
    expect(fakeIndividualsOf(store).individualById.value.get("a")!.label).toBe("ブイ");
    expect(store.rows.value.find((r) => r.id === a)!.title).toBe("ブイ");
    store.undo();
    expect(fakeIndividualsOf(store).individualById.value.get("a")!.label).toBe("イーブイ");
    expect(JSON.stringify(store.rows.value)).toBe(JSON.stringify(baseRows));
  });

  it("ニックネーム: リセットで開いた時点の名前に戻る。アメの数を元に戻しても変えた名前のまま。リンク切れの行は変えられない", async () => {
    const { store, a, b } = await makeStore("100000000");
    const { fineTune } = open(store);
    const view = () => fineTune.rowViews.value.find((row) => row.id === a)!;
    const baseRow = fineTune.base.value!.rows.find((r) => r.id === a)!;

    // アメの数を変えてから名前を変え、アメの数を元へ戻す（記録の「変える前の行」へ戻る）
    const candy = view().candyEdit!.value;
    expect(candy).toBeGreaterThan(10);
    fineTune.dispatch({ kind: "candySet", rowId: a, candy: candy - 10 });
    expect(fineTune.state.value!.candyRecords[a]).toBeDefined();
    fineTune.dispatch({ kind: "nicknameSet", rowId: a, nickname: "ブイ" });
    fineTune.dispatch({ kind: "candySet", rowId: a, candy });
    expect(view().title).toBe("ブイ");

    fineTune.dispatch({ kind: "revertRow", rowId: a, row: baseRow, candyRecord: undefined });
    expect(view().title).toBe(baseRow.title);
    expect(view().nickname!.value).toBe("");
    expect(fineTune.state.value!.nicknames).toEqual({});

    fakeIndividualsOf(store).remove("b");
    const opened = open(store);
    expect(opened.fineTune.rowViews.value.find((row) => row.id === b)!.nickname).toBeNull();
    expect(opened.fineTune.dispatch({ kind: "nicknameSet", rowId: b, nickname: "x" })).toEqual({ rejected: "individualLocked" });
  });

  it("ニックネーム: アメの数を変えてから名前を変えて戻し、アメの数も元へ戻すと、下書きが空に戻る", async () => {
    const { store, a } = await makeStore("100000000");
    fakeIndividualsOf(store).set("a", { label: "イーブイ" });
    const { fineTune } = open(store);
    const candy = fineTune.rowViews.value.find((row) => row.id === a)!.candyEdit!.value;
    expect(candy).toBeGreaterThan(10);
    fineTune.dispatch({ kind: "candySet", rowId: a, candy: candy - 10 });
    fineTune.dispatch({ kind: "nicknameSet", rowId: a, nickname: "ブイ" });
    fineTune.dispatch({ kind: "nicknameSet", rowId: a, nickname: "イーブイ" });
    expect(fineTune.isEmpty.value).toBe(false);
    fineTune.dispatch({ kind: "candySet", rowId: a, candy });
    expect(fineTune.isEmpty.value).toBe(true);
    expect(fineTune.state.value!.rows.every((row, i) => row === fineTune.base.value!.rows[i])).toBe(true);
  });

  it("下書きで在庫を変えてからアメブを配り直すと、計算機の在庫を変えてから配り直したのと同じ行になる（計算機の在庫で配り直さない）", async () => {
    /** イーブイ1匹。行ごとの最小限のアメブを入れ、アメブ枠は 100 */
    async function storeWith(eeveeStock: number) {
      const store = createCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("full");
      store.onBoostCandyRemainingInput("100");
      store.updateSpeciesCandy(133, eeveeStock);
      addBoxRow(store, { boxId: "e", pokedexId: 133, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
      const id = store.rows.value[0]!.id;
      expect(store.setRowMinimizeBoost(id, true)).toBe("applied");
      await vi.waitFor(() => {
        expect(store.planResultPending.value).toBe(false);
        expect(store.planResult.value).not.toBeNull();
      });
      return { store, id };
    }
    const pick = (row: { boostOrExpAdjustment?: number; boostReachLevel?: number; boostMinimizeRow?: boolean }) =>
      ({ boost: row.boostOrExpAdjustment, level: row.boostReachLevel, minimize: row.boostMinimizeRow });

    // 足した時点で枠 100 の個数が入っている（手で入れた個数）ので、再割当で配り直す
    const resetOf = (store: CalcStore) => pick(store.withBoostCandyReset(store.rows.value[0]!, store.rows.value));
    // 計算機の在庫を 3000 にしてから再割当した行
    const real = await storeWith(3000);
    expect(real.store.rows.value[0]!.boostOrExpAdjustment).toBe(100);
    const expected = resetOf(real.store);
    // 在庫 100 のままだと最小限のアメブに届かず、枠 100 で個数が決まって印が外れる（食い違いが見える条件になっている）
    const low = await storeWith(100);
    expect(resetOf(low.store)).not.toEqual(expected);

    // 在庫 100 の計算機でシンプルを開き、下書きで在庫を 3000 にしてから再割当する
    const { fineTune } = open(low.store);
    expect("state" in fineTune.dispatch({ kind: "stockSet", rowId: low.id, count: 3000 })).toBe(true);
    expect("state" in fineTune.dispatch({ kind: "boostReset", rowId: low.id })).toBe(true);
    expect(pick(fineTune.state.value!.rows[0]!)).toEqual(expected);
  });

  it("再割当は、配り直さない上の行の使用量も下書き（下書きの在庫）で数える（計算機の行と在庫で数えない）", async () => {
    /** 上: イーブイ（行ごとの最小限のアメブ）、下: ピカチュウ（アメは十分）。アメブ枠は 100 で、足した時点で上の行が使い切る */
    async function storeWith(eeveeStock: number) {
      const store = createCalcStore({ locale: ref("ja"), t });
      store.setSlotBoostKind("full");
      store.onBoostCandyRemainingInput("100");
      store.updateSpeciesCandy(133, eeveeStock);
      store.updateSpeciesCandy(25, 99_999);
      addBoxRow(store, { boxId: "e", pokedexId: 133, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
      addBoxRow(store, { boxId: "p", pokedexId: 25, srcLevel: 10, dstLevelDefault: 40, expType: 600, nature: "normal" });
      const [upper, lower] = store.rows.value.map((r) => r.id) as [string, string];
      expect(store.setRowMinimizeBoost(upper, true)).toBe("applied");
      store.onRowBoostCandy(lower, "0");
      await vi.waitFor(() => {
        expect(store.planResultPending.value).toBe(false);
        expect(store.planResult.value).not.toBeNull();
      });
      return { store, lower };
    }
    const resetLower = (store: CalcStore) => store.withBoostCandyReset(store.rows.value[1]!, store.rows.value).boostOrExpAdjustment;
    // 計算機の在庫で上の行が最小限のアメブに届けば、上の行は枠を使わず、下の行に枠が回る
    const real = await storeWith(3000);
    const expected = resetLower(real.store);
    const low = await storeWith(100);
    expect(resetLower(low.store)).not.toEqual(expected);

    const { fineTune } = open(low.store);
    fineTune.dispatch({ kind: "stockSet", rowId: low.store.rows.value[0]!.id, count: 3000 });
    expect("state" in fineTune.dispatch({ kind: "boostReset", rowId: low.lower })).toBe(true);
    expect(fineTune.state.value!.rows[1]!.boostOrExpAdjustment).toEqual(expected);
  });

  it("どの閉じ方でも、コンポーネントの寿命（スコープ）が終わると日付の更新が再開し、実行役が破棄される", async () => {
    const { store, a } = await makeStore();
    // キャンセル・×・Escape・背景のタップ: 何も適用せずに外れる
    const closed = open(store);
    closed.fineTune.dispatch({ kind: "set", rowId: a, boost: 30 });
    closed.scope.stop();
    expect(closed.counts.released).toBe(1);
    expect(closed.runnerCounts.dispose).toBe(1);

    // 適用して外れる
    const applied = open(store);
    applied.fineTune.dispatch({ kind: "set", rowId: a, boost: 30 });
    expect(applied.fineTune.apply()).toBe("applied");
    applied.scope.stop();
    expect(applied.counts.released).toBe(1);
    expect(applied.runnerCounts.dispose).toBe(1);
  });
});
