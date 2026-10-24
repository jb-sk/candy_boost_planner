import { computed, ref, type Ref } from "vue";
import type { Composer } from "vue-i18n";
import { lastOf } from "../utils/lastOf";
import { showToast } from "./useToast";

/**
 * 個体属性の編集・再リンク・個体の削除・全消去が記録する範囲。
 * 正本（ボックス）の値が変わると計算機の計画（行・スロット）も変わるので、組で記録しないと計画が戻らない。
 */
export const INDIVIDUAL_EDIT_SCOPES: readonly HistoryScope[] = ["box", "rows", "slots"];

/**
 * ポケモンの追加（追加フォーム・追加モーダル）が変えうる範囲。ボックスへ追加し、
 * 種族アメの在庫を書き、表示中スロットの計算機へも追加するのを `recordAsOne` で1件にする。
 */
export const INDIVIDUAL_ADD_SCOPES: readonly HistoryScope[] = ["box", "rows", "candyInventory"];

/** 計算機ストアが扱う scope。 */
export type CalcHistoryScope =
  | "rows"
  | "slots"
  | "activeSlotTab"
  | "totalShards"
  | "boostCandyRemaining"
  | "itemCompareMode"
  | "sleepSettings"
  | "defaultBoostReachLevel"
  | "minimizeBoost"
  | "candyInventory";

/** ボックスストアが扱う scope（`entries`・タグ・`selectedBoxId` への参照）。 */
export type BoxHistoryScope = "box";

export type HistoryScope = CalcHistoryScope | BoxHistoryScope;

/** scope を持つストア（提供者）の識別子。 */
export type HistoryProviderKey = "calc" | "box";

/**
 * 提供者を復元する順番。正本（ボックス）を最後に戻す。
 * 同期の watch が走る時点で、計算機の行はすでに同じ時点の値に戻っている。
 */
export const RESTORE_ORDER: readonly HistoryProviderKey[] = ["calc", "box"];

function providerOf(scope: HistoryScope): HistoryProviderKey {
  return scope === "box" ? "box" : "calc";
}

/**
 * ストアごとの提供者。履歴は scope の中身を知らず、3つの手順を順に呼ぶだけ。
 * - `prepare`: 復元の前に、何が戻るかが画面で見えるよう表示を整える（記録しない）
 * - `capture`: 自分の scope の今の状態を取る
 * - `restore`: 取っておいた状態へ戻す
 */
export type HistoryProvider<S> = {
  prepare: (snapshot: S) => void;
  capture: (scopes: readonly HistoryScope[]) => S;
  restore: (snapshot: S) => void;
};

export type HistoryRecordOptions = { coalesceKey?: string; coalesceWindowMs?: number };

type HistoryEntry = {
  scopes: readonly HistoryScope[];
  snapshots: Partial<Record<HistoryProviderKey, unknown>>;
  label: string;
  coalesceKey?: string;
  recordedAt: number;
  coalesceRevision: number;
};

export const HISTORY_LIMIT = 30;
const COALESCE_MS = 1000;

/**
 * アプリ全体で1本の Undo / Redo 履歴（上限30件）。計算機とボックスの両ストアへ注入する。
 * 履歴は一直線（LIFO）なので、スナップショットで戻しても後から行った別の編集は巻き戻らない。
 */
export function useHistory() {
  const providers = new Map<HistoryProviderKey, HistoryProvider<unknown>>();
  const undoStack = ref<HistoryEntry[]>([]);
  const redoStack = ref<HistoryEntry[]>([]);
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);
  /** 次の Undo / Redo で戻る操作のラベル（ボタンの説明に出す）。無ければ null。 */
  const undoLabel = computed(() => lastOf(undoStack.value)?.label ?? null);
  const redoLabel = computed(() => lastOf(redoStack.value)?.label ?? null);
  let coalesceRevision = 0;
  /** `recordAsOne` でまとめている最中の範囲と、最初の記録を済ませたか */
  let group: { scopes: readonly HistoryScope[]; recorded: boolean } | null = null;

  function registerProvider<S>(key: HistoryProviderKey, provider: HistoryProvider<S>) {
    providers.set(key, provider as HistoryProvider<unknown>);
  }

  function providerFor(key: HistoryProviderKey): HistoryProvider<unknown> {
    const provider = providers.get(key);
    if (!provider) throw new Error(`history provider not registered: ${key}`);
    return provider;
  }

  function captureAll(scopes: readonly HistoryScope[]): HistoryEntry["snapshots"] {
    const snapshots: HistoryEntry["snapshots"] = {};
    for (const key of RESTORE_ORDER) {
      const own = scopes.filter((scope) => providerOf(scope) === key);
      if (own.length) snapshots[key] = providerFor(key).capture(own);
    }
    return snapshots;
  }

  /**
   * 変更の直前に呼んで、戻す範囲を記録する。**その操作が実際に変えたものだけを scope に渡す。**
   * 全部を戻すと、記録した後にユーザーが変えた別の値まで一緒に戻ってしまう。
   *
   * @param options.coalesceKey 同じキーの連続更新を1本の履歴へまとめる。
   * @param options.coalesceWindowMs まとめてよい間隔の上限。**キー自体が1回の操作を表すとき**
   *   （並べ替えドラッグのセッションIDなど）は `Infinity` を渡す。時間で切ると、ゆっくりした
   *   ドラッグが途中で別の履歴へ割れる
   */
  function record(label: string, scopes: readonly HistoryScope[], options: HistoryRecordOptions = {}) {
    if (group) {
      // まとめている間は最初の記録だけを、まとめる範囲ごと残す（まとめた1件は後の記録とも合体させない）
      if (group.recorded) return;
      group.recorded = true;
      scopes = [...new Set([...group.scopes, ...scopes])];
      options = {};
    }
    const now = Date.now();
    const last = lastOf(undoStack.value);
    if (
      options.coalesceKey !== undefined
      && last?.coalesceKey === options.coalesceKey
      && last.coalesceRevision === coalesceRevision
      && now - last.recordedAt <= (options.coalesceWindowMs ?? COALESCE_MS)
      && last.scopes.join("\u0000") === scopes.join("\u0000")
    ) {
      last.recordedAt = now;
      redoStack.value = [];
      return;
    }
    undoStack.value = [...undoStack.value, {
      scopes,
      snapshots: captureAll(scopes),
      label,
      coalesceKey: options.coalesceKey,
      recordedAt: now,
      coalesceRevision,
    }].slice(-HISTORY_LIMIT);
    redoStack.value = [];
  }

  /**
   * `fn` の中の記録を1件にまとめる（ボックスへの追加と計算機への追加など、ストアをまたぐ1回の操作）。
   * ラベルは最初の記録のもの。**`scopes` には `fn` が変えうる範囲をすべて渡す**
   * （2件目以降の記録は捨てるので、そこで変わる範囲は最初の記録の時点で取っておく必要がある）。
   */
  function recordAsOne<T>(scopes: readonly HistoryScope[], fn: () => T): T {
    if (group) return fn();
    group = { scopes, recorded: false };
    try {
      return fn();
    } finally {
      group = null;
    }
  }

  /** これ以降の記録を、直前までの記録へまとめない（スロットの切り替えなど）。 */
  function breakCoalesce() {
    coalesceRevision += 1;
  }

  /**
   * undo / redo で反対側のスタックへ積み直すエントリ。**呼び出し前に
   * `coalesceRevision` を進めておくこと**（現在値をそのまま刻む）。
   *
   * `coalesceKey` を捨てるのがここの肝。残すと、undo/redo の直後に同じ欄を触った編集が
   * このエントリへ吸われ、**新しいスナップショットが積まれないまま undo 1回で
   * その操作まで巻き戻る**（記録していない編集を黙って戻す型）。
   */
  function reEntry(e: HistoryEntry): HistoryEntry {
    return {
      ...e,
      coalesceKey: undefined,
      snapshots: captureAll(e.scopes),
      recordedAt: Date.now(),
      coalesceRevision,
    };
  }

  /** 準備 → 反対側の記録 → 復元 の順に呼ぶ。反対側の記録は準備の後なので、戻す対象と同じ状態を記録する。 */
  function step(from: typeof undoStack, to: typeof redoStack): string | null {
    const e = from.value.pop();
    if (!e) return null;
    coalesceRevision += 1;
    const keys = RESTORE_ORDER.filter((key) => e.snapshots[key] !== undefined);
    for (const key of keys) providerFor(key).prepare(e.snapshots[key]);
    to.value = [...to.value, reEntry(e)].slice(-HISTORY_LIMIT);
    for (const key of keys) providerFor(key).restore(e.snapshots[key]);
    return e.label;
  }

  /** 戻した操作のラベル。戻すものが無ければ null。 */
  function undo(): string | null {
    return step(undoStack, redoStack);
  }

  /** やり直した操作のラベル。やり直すものが無ければ null。 */
  function redo(): string | null {
    return step(redoStack, undoStack);
  }

  return { canUndo, canRedo, undoLabel, redoLabel, registerProvider, record, recordAsOne, breakCoalesce, undo, redo };
}

export type History = ReturnType<typeof useHistory>;

/**
 * 元に戻す・やり直すのボタン（HistoryButtons.vue）が使う分だけの型。
 * 計算機の `useHistory()` の戻り値はそのまま渡せる。やりくりモーダルは自前の履歴をこの形で渡す
 * （操作名は出さないので、ラベルは常に null、`undo()` / `redo()` も null を返す）。
 */
export type HistoryControls = {
  canUndo: Readonly<Ref<boolean>>;
  canRedo: Readonly<Ref<boolean>>;
  undoLabel: Readonly<Ref<string | null>>;
  redoLabel: Readonly<Ref<string | null>>;
  undo: () => string | null;
  redo: () => string | null;
};

/** 計算機・ボックスどちらの Undo / Redo ボタンからでも、同じ「○○を元に戻しました」トーストを出す。ラベルが null なら出さない。 */
export function stepHistoryWithToast(history: Pick<HistoryControls, "undo" | "redo">, direction: "undo" | "redo", t: Composer["t"]) {
  const label = history[direction]();
  if (label === null) return;
  showToast(t(direction === "undo" ? "status.undoWithLabel" : "status.redoWithLabel", { label }));
}
