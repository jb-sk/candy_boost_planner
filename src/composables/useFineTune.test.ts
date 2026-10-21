import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, toRaw } from "vue";
import type { Composer } from "vue-i18n";
import { addBoxRow, createCalcStore } from "../../tests/helpers/fakeIndividuals";
import { cancelPersist } from "../persistence/deferredPersist";
import { hasFineTuneTarget } from "../domain/fine-tune/draft";
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
  const runs: Array<{ input: LevelPlannerInput; onResult: (output: { result: LevelPlannerResult; durationMs: number }) => void }> = [];
  const runnerCounts = { cancel: 0, dispose: 0 };
  const runner: PlannerRunner = {
    run: (input, onResult) => {
      runs.push({ input, onResult });
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
      replaceRows: (...args: Parameters<CalcStore["replaceRows"]>) => {
        counts.replaced += 1;
        return store.replaceRows(...args);
      },
    } as CalcStore;
    return { calc, counts };
  }

  function open(store: CalcStore, runnerKit = fakeRunner()) {
    const { calc, counts } = spied(store);
    const scope = effectScope();
    const fineTune = scope.run(() => useFineTune(calc, { t, createRunner: () => runnerKit.runner, previewDelayMs: 1 }))!;
    return { fineTune, scope, counts, ...runnerKit };
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

  it("op → プレビュー → 適用で replaceRows が1回だけ呼ばれ、計算機の元に戻す1回で戻る", async () => {
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
    fineTune.dispatch({ kind: "resetAll" });
    expect(fineTune.state.value!.version).toBe(version);
    expect(fineTune.history.canUndo.value).toBe(false);
  });

  it("一覧の表示データは、順番の変化とアメブの基準 → 変更後、サマリーの残り枠を出す", async () => {
    const { store, a, b } = await makeStore();
    const { fineTune } = open(store);
    const first = fineTune.rowViews.value[0]!;
    expect(first).toMatchObject({ id: a, index: 0, baseIndex: 0, mode1: true, giverLocked: false, exclusion: null });
    expect(first.boost).not.toBeNull();
    const baseBoost = first.boost!.base;
    const baseRemaining = fineTune.summary.value!.boostRemaining!.base;

    fineTune.dispatch({ kind: "move", rowId: b, toIndex: 0 });
    const moved = fineTune.rowViews.value.find((r) => r.id === b)!;
    expect(moved).toMatchObject({ index: 0, baseIndex: 1 });

    fineTune.dispatch({ kind: "set", rowId: a, boost: 10 });
    const edited = fineTune.rowViews.value.find((r) => r.id === a)!;
    expect(edited.boost).toMatchObject({ base: baseBoost, value: 10 });
    // 残り枠は評価した行の実効アメブから出す。減らした分だけ増える
    expect(fineTune.summary.value!.boostRemaining!.value).toBe(baseRemaining + baseBoost - 10);
  });

  it("入口のボタンは、対象にできる行が1行以上あるときだけ出す", async () => {
    const empty = createCalcStore({ locale: ref("ja"), t });
    expect(hasFineTuneTarget(empty.rows.value, empty.evaluateRows)).toBe(false);
    const { store } = await makeStore();
    expect(hasFineTuneTarget(store.rows.value, store.evaluateRows)).toBe(true);
  });

  it("ゆずる側のスライダーを動かしている間は、ソルバーを呼ばずに A の棒の塗りと目標の印を出し、離したあとの印と一致する", async () => {
    const { store } = await makeStore("1000000");
    // 上の行 b がゆずる側、下の行 a が受け取る側
    const [b, a] = store.rows.value.map((r) => r.id) as [string, string];
    const { fineTune, runs } = open(store);
    expect(fineTune.dispatch({ kind: "receiverSelect", rowId: a })).toHaveProperty("state");
    expect(fineTune.state.value!.rows.map((r) => r.id)).toEqual([b, a]);
    const view = () => fineTune.rowViews.value.find((r) => r.id === b)!;
    const m0 = view().giver!.m0;
    const fill0 = view().bars.yield.value!;
    expect(view().giver!.usable).not.toBeNull();
    const m = Math.floor(m0 / 2);
    expect(m).toBeLessThan(view().giver!.usable!);

    fineTune.setGivePreview(b, m);
    expect(fineTune.giveDragging.value).toBe(true);
    const live = fineTune.givePreview.value!;
    expect(live.rowId).toBe(b);
    // 塗りは m 個ぶんに縮み、目標の印は塗りより先（目標は m 個 + アメブ分の到達点）にある
    expect(live.fill!).toBeLessThan(fill0);
    expect(live.fill!).toBeGreaterThan(0);
    expect(live.target).not.toBeNull();
    // 動かしている間は op も実行役も動かない
    expect(fineTune.state.value!.givers[b]).toBeUndefined();
    expect(runs).toHaveLength(0);

    // 離すと同じ値の op が通り、印は reducer が作った行から出した値と一致する
    fineTune.dispatch({ kind: "giverSet", rowId: b, candy: m });
    expect(view().bars.yieldTarget).toBe(live.target);
    fineTune.releaseGivePreview();
    // 結果が届くまで動かしている間の棒を保ち、届いたら止める
    expect(fineTune.givePreview.value).not.toBeNull();
    expect(fineTune.giveDragging.value).toBe(false);
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    runs[0]!.onResult({ result: store.planResult.value!, durationMs: 1 });
    await nextTick();
    expect(fineTune.givePreview.value).toBeNull();
  });

  it("入口のボタン: 実ストアでも、個数指定の行はゆずる側になれるときだけ数える", () => {
    const store = createCalcStore({ locale: ref("ja"), t });
    store.setSlotBoostKind("full");
    store.updateSpeciesCandy(133, 100_000);
    // Lv上限の行は、個数指定を入れても使うアメが 0 個
    addBoxRow(store, { boxId: "m", pokedexId: 133, srcLevel: 70, dstLevelDefault: 70, expType: 600, nature: "normal" });
    const maxRowId = store.rows.value[0]!.id;
    store.onRowCandyTarget(maxRowId, "5");
    expect(hasFineTuneTarget(store.rows.value, store.evaluateRows)).toBe(false);
    // 普通の個数指定の行があれば true
    addBoxRow(store, { boxId: "n", pokedexId: 133, srcLevel: 10, dstLevelDefault: 50, expType: 600, nature: "normal" });
    const normalRowId = store.rows.value[1]!.id;
    store.onRowCandyTarget(normalRowId, "20");
    expect(store.rows.value[1]!.candyTarget).toBe(20);
    expect(hasFineTuneTarget(store.rows.value, store.evaluateRows)).toBe(true);
    // 睡眠目標モードにすると個数指定は外れ、対象外
    store.setRowSleepTarget(normalRowId, "all");
    expect(hasFineTuneTarget(store.rows.value, store.evaluateRows)).toBe(false);
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
