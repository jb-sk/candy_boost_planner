import { computed, onScopeDispose, ref, shallowRef, toRaw, watch } from "vue";
import type { Composer } from "vue-i18n";
import {
  adviseRows,
  createAdviceContext,
  DIAGNOSIS_DIRECTION,
  diagnose,
  type RowAdviceEntry,
} from "../domain/fine-tune/advice";
import {
  boostSlotRemaining,
  coalesceKeyOf,
  initialFineTuneState,
  isDraftEmpty,
  isSameDraftContent,
  reduceFineTune,
  type FineTuneBase,
  type FineTuneDeps,
  type FineTuneLatest,
  type FineTuneOp,
  type FineTuneReduceResult,
  type FineTuneState,
} from "../domain/fine-tune/draft";
import {
  EMPTY_FINE_TUNE_HISTORY,
  recordDraft,
  redoDraft,
  undoDraft,
  type FineTuneHistory,
} from "../domain/fine-tune/history";
import { checkRaise, raiseLevels, type RaiseCheck, type RaiseOutcome, type SolvePlan } from "../domain/fine-tune/raise";
import {
  buildRowViews,
  buildSummary,
  type FineTuneRowView,
  type FineTuneSummary,
} from "../domain/fine-tune/rowView";
import { createPlannerRunner, type PlannerRunner } from "../workers/plannerRunner";
import type { CalcRow, CalcStore } from "./useCalcStore";
import type { HistoryControls, HistoryRecordOptions } from "./useHistory";

/** プレビューを間引く待ち時間（通常の計算は 150ms） */
export const FINE_TUNE_PREVIEW_DELAY_MS = 300;

export interface UseFineTuneOptions {
  t: Composer["t"];
  /** テストで差し替える。既定は `createPlannerRunner`（通常の計算とは別の実行役）。 */
  createRunner?: () => PlannerRunner;
  now?: () => number;
  previewDelayMs?: number;
  /** 「全体のLvを伸ばす」で候補を解く。テストで差し替える。既定は専用の実行役（ワーカー） */
  solvePlan?: SolvePlan;
}

export type FineTuneApplyResult = "applied" | "empty" | "stale" | "notReady";

/** 「全体のLvを伸ばす」の結果。"failed" は計算に失敗した、"busy" は求めている途中 */
export type FineTuneRaiseResult = RaiseOutcome | { kind: "notReady" | "busy" | "failed" };

/**
 * シンプルの組み立て。基準の固定、下書き、op を reducer に通すこと、下書きの履歴、
 * プレビュー（間引きと実行役）、最新の結果、「全体のLvを伸ばす」、適用、ゲーム内の日付の停止と再開を持つ。
 * 上限・おすすめ量の計算は持たず、ドメイン（draft / advice / rowView）を呼ぶだけ。
 *
 * 日付の停止と実行役の破棄は、呼び出したコンポーネントの寿命（スコープ）に結びつける。
 * 適用・×・Escape・背景のタップのどれで閉じても unmount でスコープが止まり、必ず再開・破棄される。
 */
export function useFineTune(calc: CalcStore, options: UseFineTuneOptions) {
  const now = options.now ?? (() => Date.now());
  const previewDelayMs = options.previewDelayMs ?? FINE_TUNE_PREVIEW_DELAY_MS;
  const runner = (options.createRunner ?? createPlannerRunner)();
  const resumeGameDate = calc.holdGameDate();

  const deps: FineTuneDeps = {
    evaluateRows: (rowList, speciesCandy) => calc.evaluateRows(rowList, { speciesCandy }),
    withRowIndividual: calc.withRowIndividual,
    canEditIndividual: calc.canEditIndividual,
    speciesCandyFamilyOf: calc.speciesCandyFamilyOf,
    speciesCandyStockOf: calc.speciesCandyStockOf,
    withExplicitBoost: calc.withExplicitBoost,
    withBoostReachLevel: calc.withBoostReachLevel,
    withTargetLevel: calc.withTargetLevel,
    withCandyTarget: calc.withCandyTarget,
    maxCandyTargetFor: calc.maxCandyTargetFor,
    withSleepTarget: calc.withSleepTarget,
    withMinimizeBoost: calc.withMinimizeBoost,
    canMinimizeBoostFor: calc.canMinimizeBoostFor,
    withBoostCandyReset: calc.withBoostCandyReset,
  };

  // 状態は shallowRef で持つ。行の参照を比べて変更を見分けるので、リアクティブな包みを被せない
  const base = shallowRef<FineTuneBase | null>(null);
  const state = shallowRef<FineTuneState | null>(null);
  const history = shallowRef<FineTuneHistory>(EMPTY_FINE_TUNE_HISTORY);
  const latest = shallowRef<FineTuneLatest | null>(null);
  const previewFailed = ref(false);
  /** 「全体のLvを伸ばす」を求めている間 true。下書きを変える操作を受け付けない */
  const raising = ref(false);

  // ===== 基準 =====
  // 開いたときに計算機が計算中なら、終わるまで基準を作らない（一覧を出さない）。
  function captureBase(): void {
    if (base.value !== null) return;
    const result = calc.planResult.value;
    if (calc.planResultPending.value || result === null) return;
    // 写しを取らない。差し替えの検出に参照の同一性を使う
    const rows: readonly CalcRow[] = toRaw(calc.rows.value);
    const captured: FineTuneBase = {
      rows,
      evaluated: calc.evaluateRows(rows),
      result: toRaw(result),
      boostLimit: calc.boostCandyCap.value,
    };
    base.value = captured;
    const initial = initialFineTuneState(captured, 0);
    state.value = initial;
    latest.value = { version: initial.version, result: captured.result };
  }
  watch([calc.planResult, calc.planResultPending], captureBase, { immediate: true });

  const ready = computed(() => base.value !== null && state.value !== null);
  const hasBoost = computed(() => (base.value?.evaluated.plannerInput?.boost.kind ?? "none") !== "none");

  // ===== 下書きの評価（版ごとに1回） =====
  const evaluated = computed(() => {
    const b = base.value;
    const s = state.value;
    if (b === null || s === null) return null;
    return isDraftEmpty(b, s) ? b.evaluated : deps.evaluateRows(s.rows, s.speciesCandy);
  });
  const isEmpty = computed(() => (base.value !== null && state.value !== null ? isDraftEmpty(base.value, state.value) : true));

  // ===== プレビュー =====
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPreviewTimer(): void {
    if (previewTimer === null) return;
    clearTimeout(previewTimer);
    previewTimer = null;
  }

  function schedulePreview(): void {
    clearPreviewTimer();
    runner.cancel();
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    if (b === null || s === null || ev === null) return;
    previewFailed.value = false;
    // 下書きが空なら実行役を呼ばず、基準の結果を使う
    if (isDraftEmpty(b, s)) {
      latest.value = { version: s.version, result: b.result };
      return;
    }
    const input = ev.plannerInput;
    if (input === null) return;
    const version = s.version;
    previewTimer = setTimeout(() => {
      previewTimer = null;
      runner.run(
        input,
        (output) => {
          latest.value = { version, result: output.result };
        },
        (error) => {
          console.error("[fine-tune] preview failed:", error);
          previewFailed.value = true;
        },
      );
    }, previewDelayMs);
  }
  // 版が進むたびに同期で予約し直す（古い依頼を捨てるのを遅らせない）
  watch(state, schedulePreview, { flush: "sync" });

  /**
   * 最新の結果が今の下書きの版と違う。結果から出す値を薄くし、結果に頼る操作を押せなくする。
   * 計算に失敗しても、次の op で計算し直すまで古いまま。
   */
  const stale = computed(() => (
    state.value !== null && latest.value !== null && latest.value.version !== state.value.version
  ));
  /** 今の版を計算中。失敗したら止める（失敗の案内を出し、「計算中」は出さない）。 */
  const previewing = computed(() => stale.value && !previewFailed.value);

  // ===== op =====
  /**
   * `coalesce` は Lvピッカーのスライダーの1回のドラッグの目印。添えると、そのドラッグの op を元に戻すの1件にまとめる
   * （欄ごとの目印 `coalesceKeyOf` に足し、間隔は `coalesceWindowMs`）。
   */
  function dispatch(op: FineTuneOp, coalesce?: HistoryRecordOptions): FineTuneReduceResult | { rejected: "notReady" | "busy" } {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    if (b === null || s === null || ev === null) return { rejected: "notReady" };
    if (raising.value && op.kind !== "raise") return { rejected: "busy" };
    const out = reduceFineTune(b, s, op, deps, ev, latest.value);
    if ("rejected" in out) return out;
    // 中身が変わらない op は、状態も履歴も動かさない（版も進めない）
    if (isSameDraftContent(s, out.state)) return { state: s };
    const key = coalesceKeyOf(op);
    history.value = coalesce?.coalesceKey === undefined
      ? recordDraft(history.value, s, key, now())
      : recordDraft(history.value, s, `${key ?? op.kind}:${coalesce.coalesceKey}`, now(), coalesce.coalesceWindowMs);
    state.value = out.state;
    return out;
  }

  // ===== 下書きの元に戻す・やり直す（操作名もトーストも出さない） =====
  function undo(): null {
    const s = state.value;
    if (s === null || raising.value) return null;
    const stepped = undoDraft(history.value, s, now());
    if (stepped === null) return null;
    history.value = stepped.history;
    state.value = stepped.state;
    return null;
  }
  function redo(): null {
    const s = state.value;
    if (s === null || raising.value) return null;
    const stepped = redoDraft(history.value, s, now());
    if (stepped === null) return null;
    history.value = stepped.history;
    state.value = stepped.state;
    return null;
  }
  const historyControls: HistoryControls = {
    canUndo: computed(() => !raising.value && history.value.undo.length > 0),
    canRedo: computed(() => !raising.value && history.value.redo.length > 0),
    undoLabel: computed(() => null),
    redoLabel: computed(() => null),
    undo,
    redo,
  };

  // ===== おすすめ量・表示 =====
  const adviceContext = computed(() => {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    const l = latest.value;
    if (b === null || s === null || ev === null || l === null) return null;
    return createAdviceContext({ deps, base: b, state: s, evaluated: ev, result: l.result });
  });

  /** 最新の結果から出した診断。おすすめ量を出す向き（`DIAGNOSIS_DIRECTION`）をこれで決める。画面には出さない。 */
  const diagnosis = computed(() => {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    const l = latest.value;
    if (b === null || s === null || ev === null || l === null) return null;
    return diagnose(l.result, s.rows, ev.plannerInput?.boost.kind ?? "none", boostSlotRemaining(b, ev));
  });

  /**
   * 効果・おすすめ量は行ごとに需要の評価を何度も走らせる（`boostMarginal`）。
   * プレビュー計算中は直前の値を使い回す（結果が届くまで古い結果で2度求めない。おすすめは押せなくなっている）。
   */
  const NO_ADVICE: ReadonlyMap<string, RowAdviceEntry> = new Map();
  let settledAdvice: ReadonlyMap<string, RowAdviceEntry> = NO_ADVICE;
  const advice = computed<ReadonlyMap<string, RowAdviceEntry>>(() => {
    if (stale.value) return settledAdvice;
    const ctx = adviceContext.value;
    const d = diagnosis.value;
    if (ctx === null || d === null) return NO_ADVICE;
    const direction = DIAGNOSIS_DIRECTION[d.kind];
    settledAdvice = direction === null ? NO_ADVICE : adviseRows(ctx, direction);
    return settledAdvice;
  });

  const rowViews = computed<FineTuneRowView[]>(() => {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    if (b === null || s === null || ev === null) return [];
    return buildRowViews({
      base: b,
      state: s,
      evaluated: ev,
      latest: latest.value,
      advice: advice.value,
      hasBoost: hasBoost.value,
      reachAfterRemaining: (row, expToTarget) => calc.reachAfterRemainingForRow(row, expToTarget),
      deps,
    });
  });

  const summary = computed<FineTuneSummary | null>(() => {
    const b = base.value;
    const ev = evaluated.value;
    if (b === null || ev === null) return null;
    return buildSummary({ base: b, evaluated: ev, latest: latest.value, hasBoost: hasBoost.value });
  });

  /** 行名を引く（おすすめの文言に差し込む）。下書きの行一覧から引く。 */
  function titleOf(rowId: string): string {
    return state.value?.rows.find((r) => r.id === rowId)?.title ?? "";
  }

  // ===== 全体のLvを伸ばす =====
  /** 押して解いたが伸びなかった版と、その結果。同じ版のあいだは、押しても同じ結果になる */
  const raiseSettled = shallowRef<{ version: number; outcome: RaiseCheck } | null>(null);
  const RAISE_POSSIBLE: RaiseCheck = { kind: "possible" };
  let settledRaiseCheck: RaiseCheck = RAISE_POSSIBLE;
  /**
   * 押して伸びるかの見込み。伸びないと分かっている（全員届いた・試す候補が無い・この版で押して伸びなかった）なら
   * その理由、分からなければ possible。プレビュー計算中は直前の見込みを使い回す（結果が届くまで行き来させない）。
   */
  const raiseCheck = computed<RaiseCheck>(() => {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    const l = latest.value;
    if (b === null || s === null || ev === null || l === null) return RAISE_POSSIBLE;
    const settled = raiseSettled.value;
    if (settled !== null && settled.version === s.version) return settled.outcome;
    if (l.version !== s.version) return settledRaiseCheck;
    settledRaiseCheck = checkRaise({ deps, base: b, rows: s.rows, speciesCandy: s.speciesCandy, evaluated: ev, result: l.result });
    return settledRaiseCheck;
  });

  let disposed = false;
  let raiseRunner: PlannerRunner | null = null;
  let rejectPendingSolve: ((reason: unknown) => void) | null = null;

  /** プレビューとは別の実行役で1つずつ解く。閉じたら待っている依頼を止める */
  function runnerSolve(input: Parameters<SolvePlan>[0]): ReturnType<SolvePlan> {
    raiseRunner ??= (options.createRunner ?? createPlannerRunner)();
    const solver = raiseRunner;
    return new Promise((resolve, reject) => {
      rejectPendingSolve = reject;
      solver.run(
        input,
        (output) => {
          rejectPendingSolve = null;
          resolve(output.result);
        },
        (error) => {
          rejectPendingSolve = null;
          reject(error);
        },
      );
    });
  }

  /**
   * 全員のアメブ（とそれで決まる使うアメ）をまとめて動かし、届かない行を上から伸ばす（`raiseLevels`）。
   * 伸びたら下書きへ1つの op で入れ（元に戻す1回で戻る）、解いた結果をそのまま最新の結果にする。
   * 求めている間に下書きが変わったら入れない。
   */
  async function raiseAll(): Promise<FineTuneRaiseResult> {
    const b = base.value;
    const s = state.value;
    if (b === null || s === null) return { kind: "notReady" };
    if (raising.value) return { kind: "busy" };
    raising.value = true;
    const fromVersion = s.version;
    const l = latest.value;
    try {
      const out = await raiseLevels({
        deps,
        base: b,
        rows: s.rows,
        speciesCandy: s.speciesCandy,
        // 今の版の結果があれば解き直さない（ソルバーは1回 1秒近くかかることがある）
        initialResult: l !== null && l.version === fromVersion ? l.result : undefined,
        solve: options.solvePlan ?? runnerSolve,
        isCancelled: () => disposed || state.value?.version !== fromVersion,
      });
      if (out.kind === "allReached" || out.kind === "unchanged" || out.kind === "unavailable") {
        // この版のあいだは押しても伸びない。ボタンを押せない見た目にする
        if (state.value?.version === fromVersion) raiseSettled.value = { version: fromVersion, outcome: out };
        return out;
      }
      if (out.kind !== "raised") return out;
      const reduced = dispatch({ kind: "raise", rows: out.rows, fromVersion });
      if (!("state" in reduced)) return { kind: "cancelled" };
      // プレビューを待たず、解いた結果を今の版の結果にする
      clearPreviewTimer();
      runner.cancel();
      previewFailed.value = false;
      latest.value = { version: reduced.state.version, result: out.result };
      return out;
    } catch (error) {
      if (disposed) return { kind: "cancelled" };
      console.error("[fine-tune] raise failed:", error);
      return { kind: "failed" };
    } finally {
      raising.value = false;
    }
  }

  // ===== 適用 =====
  /**
   * 下書きを計算機へ書き込む（行一覧と、変えた現在Lv・あとEXP・在庫）。計算機の履歴は `applyFineTuneDraft` の1件だけ。
   * 基準が今の計算機と別物なら何も書かず "stale" を返す（黙って当て直さない）。
   */
  function apply(): FineTuneApplyResult {
    const b = base.value;
    const s = state.value;
    if (b === null || s === null) return "notReady";
    if (isDraftEmpty(b, s)) return "empty";
    // 現在Lv・あとEXP・在庫を変えていれば、個体・在庫へも書く（元に戻す1回で全部戻る）
    const ok = calc.applyFineTuneDraft({ rows: s.rows, speciesCandy: s.speciesCandy, label: options.t("calc.undoLabel.fineTune"), expectedBase: b.rows });
    if (!ok) {
      if (import.meta.env.DEV) console.error("[fine-tune] 計算機の内容が開いた時点から変わっているため、適用しませんでした");
      return "stale";
    }
    return "applied";
  }

  function dispose(): void {
    disposed = true;
    clearPreviewTimer();
    runner.dispose();
    raiseRunner?.dispose();
    rejectPendingSolve?.(new Error("disposed"));
    rejectPendingSolve = null;
    resumeGameDate();
  }
  onScopeDispose(dispose);

  return {
    ready,
    base,
    state,
    evaluated,
    latest,
    stale,
    previewing,
    previewFailed,
    isEmpty,
    hasBoost,
    history: historyControls,
    rowViews,
    summary,
    raising,
    raiseCheck,
    raiseAll,
    titleOf,
    dispatch,
    undo,
    redo,
    apply,
    dispose,
  };
}

export type FineTune = ReturnType<typeof useFineTune>;
