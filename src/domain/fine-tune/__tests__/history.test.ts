import { describe, expect, it } from "vitest";
import type { CalcRow, EvaluatedRows } from "../../../composables/useCalcStore";
import type { LevelPlannerResult } from "../../level-planner/types";
import {
  coalesceKeyOf,
  initialFineTuneState,
  isDraftEmpty,
  isSameDraftContent,
  reduceFineTune,
  type FineTuneBase,
  type FineTuneDeps,
  type FineTuneOp,
  type FineTuneState,
} from "../draft";
import {
  EMPTY_FINE_TUNE_HISTORY,
  redoDraft,
  recordDraft,
  undoDraft,
  type FineTuneHistory,
} from "../history";

function makeRow(id: string): CalcRow {
  return { id, title: id, pokedexId: 25, srcLevel: 10, dstLevel: 50, expRemaining: 0, expType: 600, nature: "normal", boostReachLevel: 50 };
}

const deps: FineTuneDeps = {
  evaluateRows(rowList): EvaluatedRows {
    const byId = new Map<string, { effectiveBoost: number; fullBoost: number; candyNeed: number; stockCandyAvailable: number | undefined }>();
    for (const r of rowList) {
      byId.set(r.id, { effectiveBoost: r.boostOrExpAdjustment ?? 0, fullBoost: 100, candyNeed: r.candyTarget ?? 80, stockCandyAvailable: undefined });
    }
    return { byId, plannerInput: null };
  },
  withExplicitBoost: (row, n) => ({ ...row, boostOrExpAdjustment: n }),
  withTargetLevel: (row, lv) => ({ ...row, dstLevel: lv }),
  withCandyTarget: (row, m) => ({ ...row, candyTarget: m }),
  maxCandyTargetFor: () => 500,
};

const emptyResult = { pokemonResults: [] } as unknown as LevelPlannerResult;
const base: FineTuneBase = {
  rows: [makeRow("a"), makeRow("b"), makeRow("c")],
  evaluated: deps.evaluateRows([makeRow("a"), makeRow("b"), makeRow("c")]),
  result: emptyResult,
  boostLimit: 1000,
};

/** 下書きと履歴を持つ小さな実行役（`useFineTune` が行う手順と同じ: 通って中身が変わった op だけ記録する） */
function session() {
  let state: FineTuneState = initialFineTuneState(base);
  let history: FineTuneHistory = EMPTY_FINE_TUNE_HISTORY;
  const api = {
    get state() { return state; },
    get history() { return history; },
    op(op: FineTuneOp, now: number) {
      const out = reduceFineTune(base, state, op, deps, deps.evaluateRows(state.rows));
      if ("rejected" in out) return false;
      if (isSameDraftContent(state, out.state)) return true;
      history = recordDraft(history, state, coalesceKeyOf(op), now);
      state = out.state;
      return true;
    },
    undo(now: number) {
      const step = undoDraft(history, state, now);
      if (step === null) return false;
      history = step.history;
      state = step.state;
      return true;
    },
    redo(now: number) {
      const step = redoDraft(history, state, now);
      if (step === null) return false;
      history = step.history;
      state = step.state;
      return true;
    },
  };
  return api;
}

const boostOf = (s: ReturnType<typeof session>, id: string) => s.state.rows.find((r) => r.id === id)!.boostOrExpAdjustment;

describe("下書きの履歴（§9.1、§10.1）", () => {
  it("通った op ごとに1件増え、元に戻すで1つ前の状態に、やり直すで戻す前の状態に戻る", () => {
    const s = session();
    s.op({ kind: "move", rowId: "c", toIndex: 0 }, 0);
    s.op({ kind: "step", rowId: "x", by: 1 }, 10); // rejected
    s.op({ kind: "move", rowId: "c", toIndex: 2 }, 20); // 元の並びへ
    expect(s.history.undo).toHaveLength(2);

    const afterMove = s.history.undo[1]!.state;
    expect(s.undo(30)).toBe(true);
    expect(s.state.rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(isSameDraftContent(s.state, afterMove)).toBe(true);
    expect(s.undo(40)).toBe(true);
    expect(s.state.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(isDraftEmpty(base, s.state)).toBe(true);
    expect(s.undo(50)).toBe(false);

    expect(s.redo(60)).toBe(true);
    expect(s.state.rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(s.redo(70)).toBe(true);
    expect(isDraftEmpty(base, s.state)).toBe(true);
    expect(s.redo(80)).toBe(false);
  });

  it("全体のLvを伸ばす（raise）は、何行を変えても1件で戻る", () => {
    const s = session();
    s.op({ kind: "move", rowId: "c", toIndex: 0 }, 0);
    const raised = s.state.rows.map((row) => ({ ...row, boostOrExpAdjustment: 7 }));
    s.op({ kind: "raise", rows: raised, fromVersion: s.state.version }, 10);
    expect(s.history.undo).toHaveLength(2);
    expect(s.state.rows.map((r) => r.boostOrExpAdjustment)).toEqual([7, 7, 7]);
    s.undo(20);
    expect(s.state.rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(s.state.rows.map((r) => r.boostOrExpAdjustment)).toEqual([undefined, undefined, undefined]);
    s.redo(30);
    expect(s.state.rows.map((r) => r.boostOrExpAdjustment)).toEqual([7, 7, 7]);
  });

  it("rejected の op と、中身が変わらない op（範囲の端で止まった）は記録しない", () => {
    const s = session();
    expect(s.op({ kind: "raise", rows: s.state.rows, fromVersion: s.state.version + 1 }, 0)).toBe(false);
    s.op({ kind: "step", rowId: "a", by: -1 }, 10); // 0 のまま
    s.op({ kind: "move", rowId: "a", toIndex: 0 }, 20); // 同じ位置
    s.op({ kind: "raise", rows: s.state.rows, fromVersion: s.state.version }, 30); // 同じ行一覧: 中身が変わらない
    expect(s.history.undo).toHaveLength(0);
  });

  it("同じ行のアメブの step を1秒以内に続けると1件になり、1秒を超える・別の行・別の種類では別の件になる", () => {
    const s = session();
    s.op({ kind: "step", rowId: "a", by: 5 }, 0);
    s.op({ kind: "step", rowId: "a", by: 5 }, 500);
    s.op({ kind: "set", rowId: "a", boost: 30 }, 1400);
    expect(s.history.undo).toHaveLength(1);
    s.op({ kind: "step", rowId: "a", by: 5 }, 2500);
    expect(s.history.undo).toHaveLength(2);
    s.op({ kind: "step", rowId: "b", by: 5 }, 2600);
    expect(s.history.undo).toHaveLength(3);
    s.op({ kind: "targetStep", rowId: "b", by: -1 }, 2700);
    expect(s.history.undo).toHaveLength(4);

    // まとめた1件の元に戻す1回で、まとめた分が全部戻る
    s.undo(2800);
    s.undo(2900);
    s.undo(3000);
    expect(boostOf(s, "a")).toBe(30);
    s.undo(3100);
    expect(boostOf(s, "a")).toBeUndefined();
  });

  it("元に戻す・やり直すの直後の op は、前の件にまとめられない", () => {
    const s = session();
    s.op({ kind: "step", rowId: "a", by: 5 }, 0);
    s.op({ kind: "step", rowId: "a", by: 5 }, 2000);
    s.undo(2100);
    expect(boostOf(s, "a")).toBe(5);
    s.op({ kind: "step", rowId: "a", by: 7 }, 2200);
    expect(s.history.undo).toHaveLength(2);
    s.undo(2300);
    expect(boostOf(s, "a")).toBe(5);

    // やり直すの直後も同じ
    s.redo(2400);
    expect(boostOf(s, "a")).toBe(12);
    s.op({ kind: "step", rowId: "a", by: 1 }, 2500);
    s.undo(2600);
    expect(boostOf(s, "a")).toBe(12);
  });

  it("元に戻したあとに新しい op を通すと、やり直すが空になる", () => {
    const s = session();
    s.op({ kind: "move", rowId: "c", toIndex: 0 }, 0);
    s.undo(10);
    expect(s.history.redo).toHaveLength(1);
    s.op({ kind: "move", rowId: "b", toIndex: 0 }, 20);
    expect(s.history.redo).toHaveLength(0);
    expect(s.redo(30)).toBe(false);
  });

  it("戻した状態の version は、記録した値でなく今の値 + 1", () => {
    const s = session();
    s.op({ kind: "move", rowId: "c", toIndex: 0 }, 0);
    s.op({ kind: "move", rowId: "b", toIndex: 0 }, 10);
    const versionBefore = s.state.version;
    s.undo(20);
    expect(s.state.version).toBe(versionBefore + 1);
    s.redo(30);
    expect(s.state.version).toBe(versionBefore + 2);
    s.undo(40);
    s.undo(50);
    expect(s.state.version).toBe(versionBefore + 4);
  });

  it("元の並びに戻したあと、と元に戻すで最初の状態まで戻ったあとが空になる", () => {
    const s = session();
    s.op({ kind: "move", rowId: "c", toIndex: 0 }, 0);
    expect(isDraftEmpty(base, s.state)).toBe(false);
    s.op({ kind: "move", rowId: "c", toIndex: 2 }, 10);
    expect(isDraftEmpty(base, s.state)).toBe(true);
    s.undo(20);
    expect(isDraftEmpty(base, s.state)).toBe(false);
    s.undo(30);
    expect(isDraftEmpty(base, s.state)).toBe(true);
  });

  it("入力の履歴・状態を書き換えない", () => {
    const history = recordDraft(EMPTY_FINE_TUNE_HISTORY, initialFineTuneState(base), "boost:a", 0);
    const snapshot = JSON.stringify(history);
    const current = { ...initialFineTuneState(base), version: 3 };
    undoDraft(history, current, 5);
    redoDraft(history, current, 5);
    expect(JSON.stringify(history)).toBe(snapshot);
    expect(history.undo[0]!.coalesceKey).toBe("boost:a");
  });
});
