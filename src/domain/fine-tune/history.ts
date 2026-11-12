/**
 * シンプルモードの下書きの元に戻す・やり直す。
 * 計算機の履歴（`useHistory`）とは別の、モーダルの中だけの履歴。reducer の外の純粋関数で持つ。
 */
import type { FineTuneState } from "./draft";

/** 同じ目印の数値の op をまとめる間隔。計算機のアメブ欄と同じ（`useHistory` の `COALESCE_MS`）。 */
export const FINE_TUNE_COALESCE_MS = 1000;

export interface FineTuneHistoryEntry {
  /** この件を記録する直前の下書き（version は使わない、§9.1）。 */
  state: FineTuneState;
  /** まとめる相手の目印（同じ行のアメブなど）。元に戻す・やり直すで積み直した件は持たない。 */
  coalesceKey?: string;
  recordedAt: number;
}

export interface FineTuneHistory {
  undo: readonly FineTuneHistoryEntry[];
  redo: readonly FineTuneHistoryEntry[];
}

export const EMPTY_FINE_TUNE_HISTORY: FineTuneHistory = { undo: [], redo: [] };

export interface FineTuneHistoryStep {
  history: FineTuneHistory;
  state: FineTuneState;
}

/**
 * op が通って中身が変わったときに呼ぶ。1秒以内（`windowMs`）の同じ coalesceKey は前の件にまとめる。redo を空にする。
 * `before` は op を通す直前の下書き。目印そのものが1回の操作を表すとき（Lvピッカーのスライダーの1回のドラッグ）は
 * `windowMs` に Infinity を渡す（ゆっくりしたドラッグを途中で割らない）。
 */
export function recordDraft(
  history: FineTuneHistory,
  before: FineTuneState,
  coalesceKey: string | undefined,
  now: number,
  windowMs = FINE_TUNE_COALESCE_MS,
): FineTuneHistory {
  const last = history.undo[history.undo.length - 1];
  if (
    coalesceKey !== undefined
    && last?.coalesceKey === coalesceKey
    && now - last.recordedAt <= windowMs
  ) {
    return { undo: [...history.undo.slice(0, -1), { ...last, recordedAt: now }], redo: [] };
  }
  return { undo: [...history.undo, { state: before, coalesceKey, recordedAt: now }], redo: [] };
}

/** 残った件の一番上から coalesceKey を外す。戻した直後の op を前の件にまとめない（§9.1）。 */
function withoutTopKey(entries: readonly FineTuneHistoryEntry[]): FineTuneHistoryEntry[] {
  const top = entries[entries.length - 1];
  if (top === undefined || top.coalesceKey === undefined) return entries.slice();
  return [...entries.slice(0, -1), { ...top, coalesceKey: undefined }];
}

/**
 * 戻す先の状態と、新しい履歴を返す。戻す先の version は current.version + 1（§9.1）。戻すものが無ければ null。
 * reducer を通さず、記録した状態へそのまま戻す（D34）。
 */
export function undoDraft(history: FineTuneHistory, current: FineTuneState, now: number): FineTuneHistoryStep | null {
  const entry = history.undo[history.undo.length - 1];
  if (entry === undefined) return null;
  return {
    history: {
      undo: withoutTopKey(history.undo.slice(0, -1)),
      redo: [...history.redo, { state: current, recordedAt: now }],
    },
    state: { ...entry.state, version: current.version + 1 },
  };
}

/** `undoDraft` の逆。戻す先の version は current.version + 1。やり直すものが無ければ null。 */
export function redoDraft(history: FineTuneHistory, current: FineTuneState, now: number): FineTuneHistoryStep | null {
  const entry = history.redo[history.redo.length - 1];
  if (entry === undefined) return null;
  return {
    history: {
      undo: [...history.undo, { state: current, recordedAt: now }],
      redo: history.redo.slice(0, -1),
    },
    state: { ...entry.state, version: current.version + 1 },
  };
}
