import { computed, onScopeDispose, ref, shallowRef, toRaw, watch } from "vue";
import type { Composer } from "vue-i18n";
import {
  adviseRows,
  createAdviceContext,
  DIAGNOSIS_DIRECTION,
  diagnose,
  receiverNotices,
  type Diagnosis,
  type ReceiverNotice,
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
import {
  buildRowViews,
  buildSummary,
  previewGiver,
  type FineTuneRowView,
  type FineTuneSummary,
  type GiverPreview,
} from "../domain/fine-tune/rowView";
import { createPlannerRunner, type PlannerRunner } from "../workers/plannerRunner";
import type { CalcRow, CalcStore } from "./useCalcStore";
import type { HistoryControls } from "./useHistory";

/** 1回に動かす量の選択肢（§4.3）。 */
export const FINE_TUNE_STEP_OPTIONS = [1, 10, 100] as const;
export const FINE_TUNE_DEFAULT_STEP = 10;
/** プレビューを間引く待ち時間（§8.3。通常の計算は 150ms） */
export const FINE_TUNE_PREVIEW_DELAY_MS = 300;

export interface UseFineTuneOptions {
  t: Composer["t"];
  /** テストで差し替える。既定は `createPlannerRunner`（通常の計算とは別の実行役、§8.3）。 */
  createRunner?: () => PlannerRunner;
  now?: () => number;
  previewDelayMs?: number;
}

export type FineTuneApplyResult = "applied" | "empty" | "stale" | "notReady";

/**
 * やりくりモーダルの組み立て（設計書 §10.4）。基準の固定、下書き、op を reducer に通すこと、下書きの履歴、
 * プレビュー（間引きと実行役）、最新の結果、適用、ゲーム内の日付の停止と再開を持つ。
 * 上限・順位・診断の計算は持たず、ドメイン（draft / advice / rowView）を呼ぶだけ。
 *
 * 日付の停止と実行役の破棄は、呼び出したコンポーネントの寿命（スコープ）に結びつける。
 * 適用・キャンセル・×・Escape・背景のタップのどれで閉じても unmount でスコープが止まり、必ず再開・破棄される（§10.3）。
 */
export function useFineTune(calc: CalcStore, options: UseFineTuneOptions) {
  const now = options.now ?? (() => Date.now());
  const previewDelayMs = options.previewDelayMs ?? FINE_TUNE_PREVIEW_DELAY_MS;
  const runner = (options.createRunner ?? createPlannerRunner)();
  const resumeGameDate = calc.holdGameDate();

  const deps: FineTuneDeps = {
    evaluateRows: calc.evaluateRows,
    withExplicitBoost: calc.withExplicitBoost,
    withTargetLevel: calc.withTargetLevel,
    withCandyTarget: calc.withCandyTarget,
  };

  // 状態は shallowRef で持つ。行の参照を比べて変更を見分けるので、リアクティブな包みを被せない
  const base = shallowRef<FineTuneBase | null>(null);
  const state = shallowRef<FineTuneState | null>(null);
  const history = shallowRef<FineTuneHistory>(EMPTY_FINE_TUNE_HISTORY);
  const latest = shallowRef<FineTuneLatest | null>(null);
  const previewFailed = ref(false);
  const step = ref<number>(FINE_TUNE_DEFAULT_STEP);

  // ===== 基準 =====
  // 開いたときに計算機が計算中なら、終わるまで基準を作らない（一覧を出さない、§4.1）。
  function captureBase(): void {
    if (base.value !== null) return;
    const result = calc.planResult.value;
    if (calc.planResultPending.value || result === null) return;
    // 写しを取らない。差し替えの検出に参照の同一性を使う（§10.3）
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
    return isDraftEmpty(b, s) ? b.evaluated : calc.evaluateRows(s.rows);
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
    // 下書きが空なら実行役を呼ばず、基準の結果を使う（§8.3）
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

  /** 最新の結果が今の下書きの版と同じなら確定、違えば計算中（§8.4）。 */
  const previewing = computed(() => (
    state.value !== null && latest.value !== null && latest.value.version !== state.value.version
  ));

  // ===== op =====
  function dispatch(op: FineTuneOp): FineTuneReduceResult | { rejected: "notReady" } {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    if (b === null || s === null || ev === null) return { rejected: "notReady" };
    const out = reduceFineTune(b, s, op, deps, ev, latest.value);
    if ("rejected" in out) return out;
    // 中身が変わらない op は、状態も履歴も動かさない（版も進めない、§9.1）
    if (isSameDraftContent(s, out.state)) return { state: s };
    history.value = recordDraft(history.value, s, coalesceKeyOf(op), now());
    state.value = out.state;
    return out;
  }

  // ===== 下書きの元に戻す・やり直す（D34、D41。操作名もトーストも出さない） =====
  function undo(): null {
    const s = state.value;
    if (s === null) return null;
    const stepped = undoDraft(history.value, s, now());
    if (stepped === null) return null;
    history.value = stepped.history;
    state.value = stepped.state;
    return null;
  }
  function redo(): null {
    const s = state.value;
    if (s === null) return null;
    const stepped = redoDraft(history.value, s, now());
    if (stepped === null) return null;
    history.value = stepped.history;
    state.value = stepped.state;
    return null;
  }
  const historyControls: HistoryControls = {
    canUndo: computed(() => history.value.undo.length > 0),
    canRedo: computed(() => history.value.redo.length > 0),
    undoLabel: computed(() => null),
    redoLabel: computed(() => null),
    undo,
    redo,
  };

  // ===== 診断・順位・表示 =====
  const adviceContext = computed(() => {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    const l = latest.value;
    if (b === null || s === null || ev === null || l === null) return null;
    return createAdviceContext({ deps, base: b, state: s, evaluated: ev, result: l.result });
  });

  const diagnosis = computed<Diagnosis | null>(() => {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    const l = latest.value;
    if (b === null || s === null || ev === null || l === null) return null;
    return diagnose(l.result, s.rows, ev.plannerInput?.boost.kind ?? "none", boostSlotRemaining(b, ev));
  });

  /**
   * 順位・効果・おすすめ量は行ごとに需要の評価を何度も走らせる（`boostMarginal`）ので、モード1の間だけ求める。
   * プレビュー計算中は直前の値を使い回す（結果が届くまで古い結果で2度求めない。表示は薄くなっている、§8.4）。
   */
  const adviceActive = ref(true);
  const NO_ADVICE: ReadonlyMap<string, RowAdviceEntry> = new Map();
  let settledAdvice: ReadonlyMap<string, RowAdviceEntry> = NO_ADVICE;
  const advice = computed<ReadonlyMap<string, RowAdviceEntry>>(() => {
    if (!adviceActive.value) return NO_ADVICE;
    if (previewing.value) return settledAdvice;
    const ctx = adviceContext.value;
    const d = diagnosis.value;
    if (ctx === null || d === null) return NO_ADVICE;
    const direction = DIAGNOSIS_DIRECTION[d.kind];
    settledAdvice = direction === null ? NO_ADVICE : adviseRows(ctx, direction, step.value);
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
      diagnosis: diagnosis.value,
      hasBoost: hasBoost.value,
      hasSleepExp: (rowId) => calc.rowSleepExpFor(rowId) > 0,
    });
  });

  // ===== ゆずる側のスライダーを動かしている間の棒（§6.2、§13 Q12。ソルバーは呼ばない） =====
  const givePreviewRequest = shallowRef<{ rowId: string; m: number } | null>(null);
  /** 離したあと、その op の結果が届くまで動かしている間の棒を保つ（古い結果へ一度戻ってから動くのを避ける） */
  const givePreviewReleased = ref(false);
  /** スライダーを動かしている間 true（離すと計算する、の案内に使う） */
  const giveDragging = computed(() => givePreviewRequest.value !== null && !givePreviewReleased.value);

  function setGivePreview(rowId: string, m: number): void {
    givePreviewRequest.value = { rowId, m };
    givePreviewReleased.value = false;
  }
  /** 離した。op を投げたあとに呼ぶ。結果が今の版なら今すぐ、計算中なら届いたときに止める。 */
  function releaseGivePreview(): void {
    if (givePreviewRequest.value === null) return;
    if (previewing.value) givePreviewReleased.value = true;
    else givePreviewRequest.value = null;
  }
  watch(previewing, (value) => {
    if (!value && givePreviewReleased.value) {
      givePreviewRequest.value = null;
      givePreviewReleased.value = false;
    }
  });

  const givePreview = computed<GiverPreview | null>(() => {
    const request = givePreviewRequest.value;
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    if (request === null || b === null || s === null || ev === null) return null;
    const view = rowViews.value.find((r) => r.id === request.rowId);
    if (view === undefined) return null;
    return previewGiver({ base: b, state: s, evaluated: ev, deps, view, m: request.m });
  });

  const summary = computed<FineTuneSummary | null>(() => {
    const b = base.value;
    const ev = evaluated.value;
    if (b === null || ev === null) return null;
    return buildSummary({ base: b, evaluated: ev, latest: latest.value, hasBoost: hasBoost.value });
  });

  const notices = computed<ReceiverNotice[]>(() => {
    const s = state.value;
    const ev = evaluated.value;
    if (s === null || ev === null) return [];
    // 最新の結果が今の版でない間は、結果に頼る注意を出さない（古い結果で「先に取られる」と誤って出さない）
    const l = latest.value;
    return receiverNotices(s, ev, l !== null && l.version === s.version ? l : null);
  });

  const receiver = computed(() => {
    const s = state.value;
    if (s === null || s.receiverId === null) return null;
    const row = s.rows.find((r) => r.id === s.receiverId);
    return row === undefined ? null : { id: row.id, title: row.title };
  });

  /** 行名を引く（診断・注意の文言に差し込む）。下書きの行一覧から引く。 */
  function titleOf(rowId: string): string {
    return state.value?.rows.find((r) => r.id === rowId)?.title ?? "";
  }

  // ===== 適用（§10.2） =====
  /**
   * 下書きを計算機へ書き込む。履歴は `replaceRows` の1件だけ（D11）。
   * 基準が今の計算機と別物なら何も書かず "stale" を返す（黙って当て直さない、§10.3）。
   */
  function apply(): FineTuneApplyResult {
    const b = base.value;
    const s = state.value;
    if (b === null || s === null) return "notReady";
    if (isDraftEmpty(b, s)) return "empty";
    const ok = calc.replaceRows(s.rows, options.t("calc.undoLabel.fineTune"), b.rows);
    if (!ok) {
      if (import.meta.env.DEV) console.error("[fine-tune] 計算機の内容が開いた時点から変わっているため、適用しませんでした");
      return "stale";
    }
    return "applied";
  }

  function dispose(): void {
    clearPreviewTimer();
    runner.dispose();
    resumeGameDate();
  }
  onScopeDispose(dispose);

  return {
    ready,
    base,
    state,
    evaluated,
    latest,
    previewing,
    previewFailed,
    isEmpty,
    hasBoost,
    step,
    adviceActive,
    history: historyControls,
    diagnosis,
    rowViews,
    giveDragging,
    givePreview,
    setGivePreview,
    releaseGivePreview,
    summary,
    notices,
    receiver,
    titleOf,
    dispatch,
    undo,
    redo,
    apply,
    dispose,
  };
}

export type FineTune = ReturnType<typeof useFineTune>;
