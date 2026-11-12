import { computed, onScopeDispose, ref, shallowRef, toRaw, watch } from "vue";
import type { Composer } from "vue-i18n";
import {
  coalesceKeyOf,
  initialFineTuneState,
  isDraftEmpty,
  isSameDraftContent,
  reduceFineTune,
  settingsValueOf,
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
  RAISE_SAVINGS,
  checkRaise,
  createRaiseCache,
  mergeRaiseOptions,
  raiseLevels,
  type RaiseCheck,
  type RaiseInput,
  type RaiseOption,
  type RaiseOutcome,
  type RaiseSaving,
  type SolvePlan,
} from "../domain/fine-tune/raise";
import {
  buildRowViews,
  buildSummary,
  type FineTuneRowView,
  type FineTuneSummary,
} from "../domain/fine-tune/rowView";
import { createPlannerRunner, type PlannerRunner } from "../workers/plannerRunner";
import type { CalcRow, CalcSettingsSnapshot, CalcStore } from "./useCalcStore";
import type { HistoryControls, HistoryRecordOptions } from "./useHistory";

/** プレビューを間引く待ち時間（通常の計算は 150ms） */
export const FINE_TUNE_PREVIEW_DELAY_MS = 300;

export interface UseFineTuneOptions {
  t: Composer["t"];
  /** テストで差し替える。既定は `createPlannerRunner`（通常の計算とは別の実行役）。 */
  createRunner?: () => PlannerRunner;
  now?: () => number;
  previewDelayMs?: number;
  /** 「全体のLvを伸ばす」で配り方を確かめるために解く。テストで差し替える。既定は専用の実行役（ワーカー） */
  solvePlan?: SolvePlan;
}

export type FineTuneApplyResult = "applied" | "empty" | "stale" | "notReady";

/**
 * 「全体のLvを伸ばす」の結果。"failed" は計算に失敗した、"busy" は求めている途中。
 * 伸びたときの `version` は、先頭の通りを入れた下書きの版（別の通りに替えるときに渡す。`selectRaiseOption`）
 */
export type FineTuneRaiseResult =
  | Exclude<RaiseOutcome, { kind: "raised" }>
  | {
    kind: "raised";
    /**
     * はじめに求めた通り（ふつうはアメ節約。アメ節約で伸びなかったときはかけら節約）。残りの節約するものは裏で求める（`more`）
     */
    options: readonly RaiseOption[];
    version: number;
    /**
     * 残りの節約するもの（かけら節約）を求め終えたときの通りの並び（`options` の後ろへ足し、同じ結果はまとめたもの）。
     * 止めた（`stopRaiseMore`・閉じた・下書きが変わった）・失敗した・伸びなかったときは null。reject しない。
     * 残りが無い（はじめに両方とも求めた）ときは Promise ではなく null
     */
    more: Promise<readonly RaiseOption[] | null> | null;
  }
  | { kind: "notReady" | "busy" | "failed" };

/**
 * シンプルの組み立て。基準の固定、下書き、op を reducer に通すこと、下書きの履歴、
 * プレビュー（間引きと実行役）、最新の結果、「全体のLvを伸ばす」、適用、ゲーム内の日付の停止と再開を持つ。
 * 上限・候補の計算は持たず、ドメイン（draft / raise / rowView）を呼ぶだけ。
 *
 * 日付の停止と実行役の破棄は、呼び出したコンポーネントの寿命（スコープ）に結びつける。
 * 適用・×・Escape・背景のタップのどれで閉じても unmount でスコープが止まり、必ず再開・破棄される。
 */
export function useFineTune(calc: CalcStore, options: UseFineTuneOptions) {
  const now = options.now ?? (() => Date.now());
  const previewDelayMs = options.previewDelayMs ?? FINE_TUNE_PREVIEW_DELAY_MS;
  const runner = (options.createRunner ?? createPlannerRunner)();
  const resumeGameDate = calc.holdGameDate();

  /**
   * 計算機の関数は、今の下書きの設定（設定欄で変えた最小限のアメブ・既定のアメブ目標Lv・かけら・万能アメ）と
   * 下書きの在庫（行の詳細で変えた種族アメの在庫）で呼ぶ。アメブの配り直し（再割当・既定のアメブ目標Lv・現在Lv）も
   * 下書きの在庫で歩く。どちらも変えていなければそのまま呼ぶ
   */
  function inDraft<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args) => calc.withDraftOverride({ settings: state.value?.settings, speciesCandy: state.value?.speciesCandy }, () => fn(...args));
  }
  const deps: FineTuneDeps = {
    evaluateRows: (rowList, speciesCandy) => calc.evaluateRows(rowList, { speciesCandy, settings: state.value?.settings }),
    withRowIndividual: inDraft(calc.withRowIndividual),
    canEditIndividual: calc.canEditIndividual,
    speciesCandyFamilyOf: calc.speciesCandyFamilyOf,
    speciesCandyStockOf: calc.speciesCandyStockOf,
    nicknameOf: calc.nicknameOfRow,
    titleForNickname: calc.titleForNickname,
    withExplicitBoost: inDraft(calc.withExplicitBoost),
    withBoostReachLevel: inDraft(calc.withBoostReachLevel),
    withTargetLevel: inDraft(calc.withTargetLevel),
    withCandyTarget: inDraft(calc.withCandyTarget),
    maxCandyTargetFor: inDraft(calc.maxCandyTargetFor),
    withSleepTarget: inDraft(calc.withSleepTarget),
    withMinimizeBoost: inDraft(calc.withMinimizeBoost),
    canMinimizeBoostFor: inDraft(calc.canMinimizeBoostFor),
    withBoostCandyReset: inDraft(calc.withBoostCandyReset),
    withDefaultBoostReachLevelRows: inDraft(calc.withDefaultBoostReachLevelRows),
  };

  // 状態は shallowRef で持つ。行の参照を比べて変更を見分けるので、リアクティブな包みを被せない
  const base = shallowRef<FineTuneBase | null>(null);
  const state = shallowRef<FineTuneState | null>(null);
  const history = shallowRef<FineTuneHistory>(EMPTY_FINE_TUNE_HISTORY);
  const latest = shallowRef<FineTuneLatest | null>(null);
  /**
   * 最新の結果を作った下書き（計算が終わったもの）。固定だけを変えた下書き（行・在庫・設定が同じ）は、計算し直さずに
   * この結果を使う（固定はプランナーへ渡す入力を変えない）
   */
  let latestSource: Pick<FineTuneState, "rows" | "speciesCandy" | "settings"> | null = null;
  /** 最新の結果と、それを作った下書きを一緒に変える（片方だけ変えると、固定だけを変えた下書きで古い結果を使い回してしまう） */
  function setLatest(s: FineTuneState, result: FineTuneLatest["result"]): void {
    latest.value = { version: s.version, result };
    latestSource = s;
  }
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
      settings: calc.settingsSnapshot(),
    };
    base.value = captured;
    const initial = initialFineTuneState(captured, 0);
    state.value = initial;
    setLatest(initial, captured.result);
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
  /** 設定欄の値（下書きで効いている値と、開いた時点の値） */
  const settings = computed<{ value: CalcSettingsSnapshot; base: CalcSettingsSnapshot } | null>(() => {
    const b = base.value;
    const s = state.value;
    return b === null || s === null ? null : { value: settingsValueOf(b, s), base: b.settings };
  });

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
      setLatest(s, b.result);
      return;
    }
    // 固定だけを変えた（行・在庫・設定が最新の結果を作った下書きと同じ）なら、計算し直さずにその結果を使う
    const l = latest.value;
    const src = latestSource;
    if (l !== null && src !== null && src.rows === s.rows && src.speciesCandy === s.speciesCandy && src.settings === s.settings) {
      setLatest(s, l.result);
      return;
    }
    const input = ev.plannerInput;
    if (input === null) return;
    previewTimer = setTimeout(() => {
      previewTimer = null;
      runner.run(
        input,
        (output) => setLatest(s, output.result),
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
  /** 履歴を1つ動かす。動かせたら true */
  function stepHistory(step: typeof undoDraft): boolean {
    const s = state.value;
    if (s === null || raising.value) return false;
    const stepped = step(history.value, s, now());
    if (stepped === null) return false;
    history.value = stepped.history;
    state.value = stepped.state;
    return true;
  }
  // `HistoryControls` の口は操作名（ここでは出さないので null）を返す
  function undo(): null {
    stepHistory(undoDraft);
    return null;
  }
  function redo(): null {
    stepHistory(redoDraft);
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

  // ===== 表示 =====
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

  // ===== 全体のLvを伸ばす =====
  /** 押して解いたが伸びなかった版と、その結果。同じ版のあいだは、押しても同じ結果になる */
  const raiseSettled = shallowRef<{ version: number; outcome: RaiseCheck } | null>(null);
  const RAISE_POSSIBLE: RaiseCheck = { kind: "possible" };
  let settledRaiseCheck: RaiseCheck = RAISE_POSSIBLE;
  /**
   * 押して伸びるかの見込み。伸びないと確かに分かっている（全員届いた・動かす行が無い・この版で押して伸びなかった）なら
   * その理由、分からなければ possible。モデルでの判断は使わない（外れることがあるため。押せばモデルで伸びないときは
   * 解かずにすぐ分かり、この版のあいだは押せない見た目になる）。プレビュー計算中は直前の見込みを使い回す（結果が届くまで行き来させない）。
   */
  const raiseCheck = computed<RaiseCheck>(() => {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    const l = latest.value;
    if (b === null || s === null || ev === null || l === null) return RAISE_POSSIBLE;
    const settled = raiseSettled.value;
    // 押して伸びなかった版の見込みも「直前の見込み」として覚える（下書きを変えてプレビューを待つ間、押せる見た目へ戻さない）
    if (settled !== null && settled.version === s.version) return (settledRaiseCheck = settled.outcome);
    if (l.version !== s.version) return settledRaiseCheck;
    settledRaiseCheck = checkRaise({ rows: s.rows, boostLocks: s.boostLocks, evaluated: ev, result: l.result });
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

  /** 裏で求めている残りの節約するもの（`raiseMore`）。止めるときに `stopped` を立てる */
  let raiseMoreRun: { stopped: boolean } | null = null;
  /** 押して求めている途中の「全体のLvを伸ばす」（`raiseAll`）。取り消すときに `stopped` を立てる */
  let raiseRun: { stopped: boolean } | null = null;

  /**
   * 押して求めている途中の「全体のLvを伸ばす」を取り消す（「LvUp中止」）。解いている途中の依頼も捨て、下書きは押す前のまま。
   * `raiseAll` は cancelled を返す。求めていなければ何もしない
   */
  function cancelRaise(): void {
    if (raiseRun === null) return;
    abortRaiseRun(raiseRun, "cancelled");
    raiseRun = null;
  }

  /** 裏で求めている残りの節約するものを止める（小窓を閉じた・もう一度押した）。解いている途中の依頼も捨てる */
  function stopRaiseMore(): void {
    if (raiseMoreRun === null) return;
    abortRaiseRun(raiseMoreRun, "stopped");
    raiseMoreRun = null;
  }

  /** 求めている途中の1回を止め、解いている途中の依頼を捨てる（待っている Promise は `reason` で reject する） */
  function abortRaiseRun(run: { stopped: boolean }, reason: string): void {
    run.stopped = true;
    raiseRunner?.cancel();
    rejectPendingSolve?.(new Error(reason));
    rejectPendingSolve = null;
  }

  /**
   * 残りの節約するもの（`rest`。はじめに求めていないもの）を、はじめと同じ入力・同じ置き場（解いた結果・モデル）で求める
   * （選び方が分かれるまでは解き直さない）。下書き・解いた結果は変えず、通りの並びを返すだけ。替えるのは `selectRaiseOption`
   */
  async function raiseMore(
    input: Omit<RaiseInput, "savings" | "isCancelled">,
    first: readonly RaiseOption[],
    rest: readonly RaiseSaving[],
    version: number,
  ): Promise<readonly RaiseOption[] | null> {
    const run = { stopped: false };
    raiseMoreRun = run;
    try {
      const out = await raiseLevels({ ...input, savings: rest, isCancelled: () => disposed || run.stopped || state.value?.version !== version });
      return out.kind === "raised" ? mergeRaiseOptions(first, out.options) : null;
    } catch (error) {
      if (!disposed && !run.stopped) console.error("[fine-tune] raise failed:", error);
      return null;
    } finally {
      if (raiseMoreRun === run) raiseMoreRun = null;
    }
  }

  /** 解いた結果を今の版の結果にする（プレビューを待たない） */
  function adoptResult(s: FineTuneState, result: FineTuneLatest["result"]): void {
    clearPreviewTimer();
    runner.cancel();
    previewFailed.value = false;
    setLatest(s, result);
  }

  /**
   * 全員のアメブ（とそれで決まる使うアメ）をまとめて動かし、届かない行を上から伸ばす（`raiseLevels`）。固定した行は動かさない。
   * はじめはアメ節約だけを求め、伸びたらその通りを下書きへ1つの op で入れ（元に戻す1回で戻る）、解いた結果をそのまま
   * 最新の結果にする。かけら節約はその後に裏で求める（`more`。待ち時間を半分にする）。
   * アメ節約で伸びなければ（粒度・余りゲートで採れなかったなど）、同じ呼び出しで続けてかけら節約を求め、伸びればそれを
   * 入れる（`untilRaised`。両方とも伸びなければ伸びない。設計書 §5.5）。このとき後から求めるものは無い（`more` は null）。
   * 求めている間に下書きが変わったら入れない。
   */
  async function raiseAll(): Promise<FineTuneRaiseResult> {
    const b = base.value;
    const s = state.value;
    if (b === null || s === null) return { kind: "notReady" };
    if (raising.value) return { kind: "busy" };
    stopRaiseMore();
    raising.value = true;
    const run = { stopped: false };
    raiseRun = run;
    const fromVersion = s.version;
    const l = latest.value;
    try {
      const input = {
        deps,
        base: b,
        rows: s.rows,
        speciesCandy: s.speciesCandy,
        boostLocks: s.boostLocks,
        // 今の版の結果があれば解き直さない（ソルバーは1回 1秒近くかかることがある）
        initialResult: l !== null && l.version === fromVersion ? l.result : undefined,
        solve: options.solvePlan ?? runnerSolve,
        cache: createRaiseCache(),
      };
      const out = await raiseLevels({ ...input, untilRaised: true, isCancelled: () => disposed || run.stopped || state.value?.version !== fromVersion });
      if (run.stopped) return { kind: "cancelled" };
      if (out.kind === "allReached" || out.kind === "unchanged" || out.kind === "unavailable") {
        // この版のあいだは押しても伸びない。ボタンを押せない見た目にする
        if (state.value?.version === fromVersion) raiseSettled.value = { version: fromVersion, outcome: out };
        return out;
      }
      if (out.kind !== "raised") return out;
      const first = out.options[0];
      if (first === undefined) return { kind: "cancelled" };
      const reduced = dispatch({ kind: "raise", rows: first.rows, fromVersion });
      if (!("state" in reduced)) return { kind: "cancelled" };
      adoptResult(reduced.state, first.result);
      const version = reduced.state.version;
      // 伸びた節約するものまでは求めた（`untilRaised`）。残りは後から求める
      const rest = RAISE_SAVINGS.slice(RAISE_SAVINGS.indexOf(first.savings[0]!) + 1);
      return { kind: "raised", options: out.options, version, more: rest.length > 0 ? raiseMore(input, out.options, rest, version) : null };
    } catch (error) {
      if (disposed || run.stopped) return { kind: "cancelled" };
      console.error("[fine-tune] raise failed:", error);
      return { kind: "failed" };
    } finally {
      if (raiseRun === run) raiseRun = null;
      raising.value = false;
    }
  }

  /**
   * 伸ばした結果の別の通り（アメ節約・かけら節約）に替える。伸ばした通りを入れた直後の下書き（`version`）のままのときだけ。
   * 元に戻すは1件のまま（伸ばす前へ戻る）。解いた結果をそのまま最新の結果にする。替えた後の版を返し、替えられなければ null
   */
  function selectRaiseOption(option: RaiseOption, version: number): number | null {
    const b = base.value;
    const s = state.value;
    const ev = evaluated.value;
    if (b === null || s === null || ev === null || raising.value || s.version !== version) return null;
    // 伸ばす前の下書き（履歴の一番上）へ戻してから、選んだ通りを入れ直す
    const stepped = undoDraft(history.value, s, now());
    if (stepped === null) return null;
    const before = stepped.state;
    const out = reduceFineTune(b, before, { kind: "raise", rows: option.rows, fromVersion: before.version }, deps, ev, latest.value);
    if ("rejected" in out || isSameDraftContent(before, out.state)) return null;
    history.value = recordDraft(stepped.history, before, undefined, now());
    state.value = out.state;
    adoptResult(out.state, option.result);
    return out.state.version;
  }

  /**
   * 伸ばした結果を取りやめて、押す前の下書きへ戻す（小窓のキャンセル）。伸ばした通りを入れた直後の下書き（`version`。
   * 別の通りに替えたら替えた後の版）のままのときだけ。伸ばした結果は履歴の1件なので、元に戻す1回と同じ（やり直すで戻せる）。
   * 戻せたら true
   */
  function revertRaise(version: number): boolean {
    const s = state.value;
    if (s === null || raising.value || s.version !== version) return false;
    stopRaiseMore();
    return stepHistory(undoDraft);
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
    // 現在Lv・あとEXP・ニックネーム・在庫・設定を変えていれば、個体・在庫・設定へも書く（元に戻す1回で全部戻る）
    const ok = calc.applyFineTuneDraft({
      rows: s.rows,
      speciesCandy: s.speciesCandy,
      settings: s.settings,
      nicknames: s.nicknames,
      label: options.t("calc.undoLabel.fineTune"),
      expectedBase: b.rows,
    });
    if (!ok) {
      if (import.meta.env.DEV) console.error("[fine-tune] 計算機の内容が開いた時点から変わっているため、適用しませんでした");
      return "stale";
    }
    return "applied";
  }

  function dispose(): void {
    disposed = true;
    stopRaiseMore();
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
    settings,
    hasBoost,
    history: historyControls,
    rowViews,
    summary,
    raising,
    raiseCheck,
    raiseAll,
    selectRaiseOption,
    stopRaiseMore,
    cancelRaise,
    revertRaise,
    dispatch,
    undo,
    redo,
    apply,
    dispose,
  };
}

export type FineTune = ReturnType<typeof useFineTune>;
