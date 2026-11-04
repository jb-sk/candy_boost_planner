import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref, toRaw } from "vue";
import type { Composer } from "vue-i18n";
import { addBoxRow, createCalcStore } from "../../tests/helpers/fakeIndividuals";
import { cancelPersist } from "../persistence/deferredPersist";
import { calcSleepLandingLevel } from "../domain/level-planner/sleepReachLevel";
import { solveLevelPlan } from "../domain/level-planner/core/solveLevelPlan";
import { dreamShardsPerCandy } from "../domain/pokesleep/tables";
import type { LevelPlannerInput, LevelPlannerResult } from "../domain/level-planner/types";
import type { PlannerRunner } from "../workers/plannerRunner";
import type { CalcStore } from "./useCalcStore";
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

  function open(store: CalcStore, runnerKit = fakeRunner()) {
    const { calc, counts } = spied(store);
    const scope = effectScope();
    let solves = 0;
    // 「全体のLvを伸ばす」はプレビューの実行役を使わず、その場で本物のソルバーで解く
    const solvePlan = async (input: LevelPlannerInput) => {
      solves += 1;
      return solveLevelPlan(input);
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

  it("どの行のアメブを動かしても先頭の未達行が伸びなければ、どの行にもおすすめ量が出ない", async () => {
    // b（ピカチュウ）はアメが1個も無く、a（イーブイ）の種族アメは使えない
    const { store, b } = await makeStore("100000000");
    const { fineTune } = open(store);
    expect(fineTune.rowViews.value.find((row) => row.id === b)!).toMatchObject({ reached: { value: false }, limitingFactor: "candy" });
    expect(fineTune.rowViews.value.every((row) => row.advice?.recommendation == null)).toBe(true);
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
    expect(first).toMatchObject({ id: a, index: 0, levelAdjustable: true, exclusion: null });
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

  it("アメの数: 減らした行は表に下書きの値を出し、アメブを動かせない（目標Lvは動かせる）。元の数に戻すと動かせる", async () => {
    const { store, a } = await makeStore("100000000");
    const { fineTune } = open(store);
    const view = () => fineTune.rowViews.value.find((r) => r.id === a)!;
    const edit = view().candyEdit!;
    expect(edit).toMatchObject({ min: 0, changed: false });
    expect(edit.max).toBeGreaterThan(edit.value);
    expect(fineTune.dispatch({ kind: "candyStep", rowId: a, by: -10 })).toHaveProperty("state");
    expect(view()).toMatchObject({ candyEdited: true, levelAdjustable: false, targetAdjustable: true, candyEdit: { value: edit.value - 10, base: edit.value, changed: true } });
    expect(fineTune.dispatch({ kind: "step", rowId: a, by: 1 })).toEqual({ rejected: "excluded" });
    expect(fineTune.dispatch({ kind: "candySet", rowId: a, candy: edit.value })).toHaveProperty("state");
    expect(view()).toMatchObject({ candyEdited: false, levelAdjustable: true });
    expect(fineTune.isEmpty.value).toBe(true);
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
    expect(view()).toMatchObject({ candyEdited: false, levelAdjustable: true, targetAdjustable: true });
    // 元に戻す1回で、アメの数を変えた状態（個数指定）へ戻る
    fineTune.undo();
    expect(view()).toMatchObject({ candyEdited: true, levelAdjustable: false });
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

  it("すべて睡眠（アメを使わない睡眠目標）の行も、目標Lvを動かせる（アメブは動かせない。計算機と同じ）", async () => {
    const { store, a } = await makeStore();
    store.setRowSleepTarget(a, "all");
    await vi.waitFor(() => expect(store.planResultPending.value).toBe(false));
    const { fineTune } = open(store);
    await vi.waitFor(() => expect(fineTune.ready.value).toBe(true));
    const view = () => fineTune.rowViews.value.find((r) => r.id === a)!;
    expect(view()).toMatchObject({ exclusion: "noCandy", levelAdjustable: false, targetAdjustable: true });
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
