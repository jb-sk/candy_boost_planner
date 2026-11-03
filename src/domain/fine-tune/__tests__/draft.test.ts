import { describe, expect, it } from "vitest";
import type { CalcRow, EvaluatedRows } from "../../../composables/useCalcStore";
import type { LevelPlannerResult } from "../../level-planner/types";
import { maxLevel as MAX_LEVEL } from "../../pokesleep/tables";
import {
  boostSlotRemaining,
  coalesceKeyOf,
  hasFineTuneTarget,
  initialFineTuneState,
  isDraftEmpty,
  isSameDraftContent,
  opRange,
  reduceFineTune,
  rowExclusion,
  type FineTuneBase,
  type FineTuneDeps,
  type FineTuneOp,
  type FineTuneState,
} from "../draft";

type RowInfo = { full: number; need: number };

function makeRow(id: string, extra: Partial<CalcRow> = {}): CalcRow {
  return {
    id,
    title: id,
    pokedexId: 25,
    srcLevel: 10,
    dstLevel: 50,
    expRemaining: 0,
    expType: 600,
    nature: "normal",
    boostReachLevel: 50,
    ...extra,
  };
}

/** 差し替えた deps。実効アメブは明示アメブ、個数は個数指定（無ければ info の need）をそのまま返す。 */
function makeDeps(info: Record<string, RowInfo>) {
  const calls = { explicit: 0, target: 0 };
  const deps: FineTuneDeps = {
    evaluateRows(rowList): EvaluatedRows {
      const byId = new Map<string, { effectiveBoost: number; fullBoost: number; candyNeed: number; stockCandyAvailable: number | undefined }>();
      for (const r of rowList) {
        const row = info[r.id]!;
        byId.set(r.id, {
          effectiveBoost: r.boostOrExpAdjustment ?? 0,
          fullBoost: row.full,
          candyNeed: r.candyTarget ?? row.need,
          stockCandyAvailable: undefined,
        });
      }
      return { byId, plannerInput: null };
    },
    withExplicitBoost(row, n) {
      calls.explicit += 1;
      return { ...row, boostOrExpAdjustment: n };
    },
    withTargetLevel(row, lv) {
      calls.target += 1;
      return { ...row, dstLevel: lv, candyTarget: undefined };
    },
  };
  return { deps, calls };
}

function resultOf(): LevelPlannerResult {
  return { pokemonResults: [] } as unknown as LevelPlannerResult;
}

function setup(rows: CalcRow[], info: Record<string, RowInfo>, boostLimit = 1000) {
  const { deps, calls } = makeDeps(info);
  const base: FineTuneBase = {
    rows,
    evaluated: deps.evaluateRows(rows),
    result: resultOf(),
    boostLimit,
  };
  const run = (state: FineTuneState, op: FineTuneOp) =>
    reduceFineTune(base, state, op, deps, deps.evaluateRows(state.rows));
  const ok = (state: FineTuneState, op: FineTuneOp): FineTuneState => {
    const out = run(state, op);
    if ("rejected" in out) throw new Error(`rejected: ${out.rejected}`);
    return out.state;
  };
  const range = (state: FineTuneState, target: Parameters<typeof opRange>[3]) =>
    opRange(base, state, deps.evaluateRows(state.rows), target);
  return { deps, calls, base, run, ok, range, initial: initialFineTuneState(base) };
}

const ids = (state: FineTuneState) => state.rows.map((r) => r.id);

describe("opRange / reduceFineTune: アメブ（D36、D37）", () => {
  it("set と step が、全アメブ点と「今の値 + 残り枠」の小さい方で同じ値に止まる", () => {
    // 残り枠 = 100 - 30 = 70。今の値 30 + 70 = 100 が全アメブ点 90 より大きいので 90 で止まる
    const t = setup([makeRow("a", { boostOrExpAdjustment: 30 })], { a: { full: 90, need: 200 } }, 100);
    expect(t.range(t.initial, { kind: "boost", rowId: "a" })).toEqual({ min: 0, max: 90 });
    const bySet = t.ok(t.initial, { kind: "set", rowId: "a", boost: 500 });
    const byStep = t.ok(t.initial, { kind: "step", rowId: "a", by: 500 });
    expect(bySet.rows[0]!.boostOrExpAdjustment).toBe(90);
    expect(byStep.rows[0]!.boostOrExpAdjustment).toBe(90);
  });

  it("残り枠が全アメブ点より小さいときは今の値 + 残り枠で止まる", () => {
    const t = setup([makeRow("a", { boostOrExpAdjustment: 30 })], { a: { full: 500, need: 600 } }, 100);
    expect(t.range(t.initial, { kind: "boost", rowId: "a" }).max).toBe(100);
    expect(t.ok(t.initial, { kind: "step", rowId: "a", by: 1000 }).rows[0]!.boostOrExpAdjustment).toBe(100);
    expect(t.ok(t.initial, { kind: "set", rowId: "a", boost: 1000 }).rows[0]!.boostOrExpAdjustment).toBe(100);
  });

  it("step の負の向きは 0 で止まる", () => {
    const t = setup([makeRow("a", { boostOrExpAdjustment: 30 })], { a: { full: 90, need: 200 } });
    expect(t.ok(t.initial, { kind: "step", rowId: "a", by: -1000 }).rows[0]!.boostOrExpAdjustment).toBe(0);
  });

  it("値が変わらない op は状態を変えない（同じ state、version も進まない）", () => {
    const t = setup([makeRow("a", { boostOrExpAdjustment: 90 }), makeRow("z")], { a: { full: 90, need: 200 }, z: { full: 5, need: 5 } });
    expect(t.run(t.initial, { kind: "step", rowId: "a", by: 1 })).toEqual({ state: t.initial });
    expect(t.run(t.initial, { kind: "set", rowId: "a", boost: 90 })).toEqual({ state: t.initial });
    const zero = setup([makeRow("a")], { a: { full: 90, need: 200 } });
    const out = zero.run(zero.initial, { kind: "step", rowId: "a", by: -1 });
    expect("state" in out && out.state === zero.initial).toBe(true);
  });

  it("通った op は version を1つ進め、書き換えた行以外は参照のまま残る", () => {
    const t = setup([makeRow("a"), makeRow("b")], { a: { full: 90, need: 200 }, b: { full: 90, need: 200 } });
    const next = t.ok(t.initial, { kind: "step", rowId: "a", by: 10 });
    expect(next.version).toBe(t.initial.version + 1);
    expect(next.rows[0]).not.toBe(t.initial.rows[0]);
    expect(next.rows[1]).toBe(t.initial.rows[1]);
  });

  it("アメブの書き換えは preserveTargetForExplicitBoost: true で行う", () => {
    const seen: unknown[] = [];
    const t = setup([makeRow("a")], { a: { full: 90, need: 200 } });
    const deps: FineTuneDeps = {
      ...t.deps,
      withExplicitBoost(row, n, options) {
        seen.push(options);
        return t.deps.withExplicitBoost(row, n, options);
      },
    };
    reduceFineTune(t.base, t.initial, { kind: "step", rowId: "a", by: 5 }, deps, t.deps.evaluateRows(t.initial.rows));
    expect(seen).toEqual([{ preserveTargetForExplicitBoost: true }]);
  });

  it("残り枠は評価した行の実効アメブの合計から出る（負にもなる）", () => {
    const rows = [makeRow("a", { boostOrExpAdjustment: 80 }), makeRow("b", { boostOrExpAdjustment: 50 })];
    const t = setup(rows, { a: { full: 200, need: 300 }, b: { full: 200, need: 300 } }, 100);
    expect(boostSlotRemaining(t.base, t.deps.evaluateRows(rows))).toBe(-30);
    // 増やす op は止まり、減らす op は通る
    expect(t.range(t.initial, { kind: "boost", rowId: "a" }).max).toBe(80);
    expect(t.run(t.initial, { kind: "step", rowId: "a", by: 10 })).toEqual({ state: t.initial });
    expect(t.ok(t.initial, { kind: "step", rowId: "a", by: -10 }).rows[0]!.boostOrExpAdjustment).toBe(70);
  });

  it("保存値が全アメブ点を超えている行は、増やせず、0 まで減らせる", () => {
    const t = setup([makeRow("a", { boostOrExpAdjustment: 80 })], { a: { full: 50, need: 300 } });
    expect(t.range(t.initial, { kind: "boost", rowId: "a" })).toEqual({ min: 0, max: 80 });
    expect(t.run(t.initial, { kind: "step", rowId: "a", by: 1 })).toEqual({ state: t.initial });
    expect(t.ok(t.initial, { kind: "set", rowId: "a", boost: 0 }).rows[0]!.boostOrExpAdjustment).toBe(0);
  });

  it("対象外の行（§7）には、目標Lv・アメブの op を拒否する", () => {
    const rows = [makeRow("c", { candyTarget: 100 }), makeRow("n", { sleepTargetMode: "all" }), makeRow("s", { sleepTargetHours: 1000 }), makeRow("m", { srcLevel: MAX_LEVEL, dstLevel: MAX_LEVEL })];
    const t = setup(rows, {
      c: { full: 10, need: 10 }, n: { full: 0, need: 0 }, s: { full: 0, need: 0 }, m: { full: 0, need: 0 }, u: { full: 0, need: 1 },
    });
    for (const rowId of ["c", "n", "s", "m"]) {
      expect(t.run(t.initial, { kind: "step", rowId, by: 1 })).toEqual({ rejected: "excluded" });
      expect(t.run(t.initial, { kind: "set", rowId, boost: 1 })).toEqual({ rejected: "excluded" });
      expect(t.run(t.initial, { kind: "targetStep", rowId, by: 1 })).toEqual({ rejected: "excluded" });
      expect(t.run(t.initial, { kind: "targetSet", rowId, level: 40 })).toEqual({ rejected: "excluded" });
    }
    expect(rows.map((r) => rowExclusion(r, t.deps.evaluateRows(rows)))).toEqual(["candyTarget", "noCandy", "sleepOnly", "maxLevel"]);
    expect(rowExclusion(makeRow("u", { pokedexId: 0 }), t.deps.evaluateRows([makeRow("u")]))).toBe("unknownPokemon");
    expect(t.run(t.initial, { kind: "step", rowId: "nope", by: 1 })).toEqual({ rejected: "unknownRow" });
  });
});

describe("hasFineTuneTarget: 入口のボタン（§4.1）", () => {
  const info = { c: { full: 10, need: 10 }, n: { full: 0, need: 0 }, m: { full: 0, need: 0 }, ok: { full: 10, need: 10 } };
  const has = (rows: CalcRow[]) => hasFineTuneTarget(rows, makeDeps(info).deps.evaluateRows);

  it("個数指定の行だけでは false（目標Lv・アメブを動かせない）", () => {
    expect(has([makeRow("n", { candyTarget: 5, sleepTargetMode: "all" })])).toBe(false);
    expect(has([makeRow("m", { candyTarget: 0, srcLevel: MAX_LEVEL, dstLevel: MAX_LEVEL })])).toBe(false);
    expect(has([makeRow("c", { candyTarget: 5 })])).toBe(false);
    expect(has([makeRow("c", { candyTarget: 5 }), makeRow("ok")])).toBe(true);
  });

  it("個数指定でない行は対象外でなければ true", () => {
    expect(has([makeRow("ok")])).toBe(true);
    expect(has([makeRow("m", { srcLevel: MAX_LEVEL, dstLevel: MAX_LEVEL })])).toBe(false);
  });

  it("評価は必要なときだけ、1回に限る", () => {
    const { deps } = makeDeps(info);
    let evaluations = 0;
    const evaluate = (rows: readonly CalcRow[]) => {
      evaluations += 1;
      return deps.evaluateRows(rows);
    };
    hasFineTuneTarget([makeRow("ok")], evaluate);
    expect(evaluations).toBe(0);
    // 評価が要るのは時間の睡眠目標の行（睡眠だけで届くか）だけ
    hasFineTuneTarget([makeRow("c", { sleepTargetHours: 100 }), makeRow("m", { sleepTargetHours: 100 })], evaluate);
    expect(evaluations).toBe(1);
  });
});

describe("reduceFineTune: 目標Lv（D28）", () => {
  it("現在Lv〜MAX_LEVEL に収める。端から外へ動かしても状態は変わらない", () => {
    const rows = [makeRow("lo", { srcLevel: 10, dstLevel: 10 }), makeRow("hi", { dstLevel: MAX_LEVEL }), makeRow("mid", { srcLevel: 10, dstLevel: 12 })];
    const t = setup(rows, { lo: { full: 1, need: 1 }, hi: { full: 1, need: 1 }, mid: { full: 1, need: 1 } });
    expect(t.run(t.initial, { kind: "targetStep", rowId: "lo", by: -1 })).toEqual({ state: t.initial });
    expect(t.run(t.initial, { kind: "targetStep", rowId: "hi", by: 5 })).toEqual({ state: t.initial });
    expect(t.ok(t.initial, { kind: "targetStep", rowId: "mid", by: -5 }).rows[2]!.dstLevel).toBe(10);
    expect(t.ok(t.initial, { kind: "targetSet", rowId: "mid", level: 999 }).rows[2]!.dstLevel).toBe(MAX_LEVEL);
    expect(t.ok(t.initial, { kind: "targetSet", rowId: "mid", level: 33.7 }).rows[2]!.dstLevel).toBe(33);
    expect(t.run(t.initial, { kind: "targetSet", rowId: "mid", level: Number.NaN })).toEqual({ rejected: "invalidValue" });
    expect(t.range(t.initial, { kind: "target", rowId: "mid" })).toEqual({ min: 10, max: MAX_LEVEL });
  });

  it("今の下書きの行の目標 ±1 を、今の行一覧とともに withTargetLevel へ渡す", () => {
    const seen: Array<{ lv: number; list: readonly CalcRow[] }> = [];
    const t = setup([makeRow("a", { dstLevel: 30 })], { a: { full: 1, need: 1 } });
    const deps: FineTuneDeps = {
      ...t.deps,
      withTargetLevel(row, lv, list) {
        seen.push({ lv, list });
        return t.deps.withTargetLevel(row, lv, list);
      },
    };
    const out = reduceFineTune(t.base, t.initial, { kind: "targetStep", rowId: "a", by: -1 }, deps, t.deps.evaluateRows(t.initial.rows));
    expect("state" in out && out.state.rows[0]!.dstLevel).toBe(29);
    expect(seen).toEqual([{ lv: 29, list: t.initial.rows }]);
  });
});

describe("reduceFineTune: 並べ替え（move）と isDraftEmpty", () => {
  it("行を動かし、元の並びに戻すと isDraftEmpty が true になる。行は参照のまま", () => {
    const t = setup([makeRow("a"), makeRow("b"), makeRow("c")], { a: { full: 1, need: 1 }, b: { full: 1, need: 1 }, c: { full: 1, need: 1 } });
    expect(isDraftEmpty(t.base, t.initial)).toBe(true);
    const moved = t.ok(t.initial, { kind: "move", rowId: "c", toIndex: 0 });
    expect(ids(moved)).toEqual(["c", "a", "b"]);
    expect(moved.rows[1]).toBe(t.initial.rows[0]);
    expect(isDraftEmpty(t.base, moved)).toBe(false);
    const back = t.ok(moved, { kind: "move", rowId: "c", toIndex: 2 });
    expect(ids(back)).toEqual(["a", "b", "c"]);
    expect(isDraftEmpty(t.base, back)).toBe(true);
  });

  it("同じ位置への move は状態を変えず、範囲外の位置は端に収める", () => {
    const t = setup([makeRow("a"), makeRow("b")], { a: { full: 1, need: 1 }, b: { full: 1, need: 1 } });
    expect(t.run(t.initial, { kind: "move", rowId: "a", toIndex: 0 })).toEqual({ state: t.initial });
    expect(ids(t.ok(t.initial, { kind: "move", rowId: "a", toIndex: 99 }))).toEqual(["b", "a"]);
  });

  it("基準と同じ値に戻した行は、新しい行なので空にならない（D35）", () => {
    const t = setup([makeRow("a")], { a: { full: 90, need: 200 } });
    const up = t.ok(t.initial, { kind: "step", rowId: "a", by: 5 });
    const down = t.ok(up, { kind: "step", rowId: "a", by: -5 });
    expect(down.rows[0]!.boostOrExpAdjustment).toBe(0);
    expect(isDraftEmpty(t.base, down)).toBe(false);
  });
});

describe("reduceFineTune: 全体のLvを伸ばす（raise）", () => {
  it("同じ顔ぶれ・順番の行一覧を1つの op で入れ、版を1つ進める。同じ行一覧なら変えない", () => {
    const t = setup([makeRow("a"), makeRow("b")], { a: { full: 50, need: 100 }, b: { full: 50, need: 100 } });
    const rows = [{ ...t.initial.rows[0]!, boostOrExpAdjustment: 10 }, t.initial.rows[1]!];
    const out = t.ok(t.initial, { kind: "raise", rows, fromVersion: t.initial.version });
    expect(out.rows).toBe(rows);
    expect(out.version).toBe(t.initial.version + 1);
    expect(t.run(t.initial, { kind: "raise", rows: t.initial.rows, fromVersion: t.initial.version })).toEqual({ state: t.initial });
  });

  it("求めた後に下書きが変わっていたら stale、顔ぶれか順番が違えば invalidValue", () => {
    const t = setup([makeRow("a"), makeRow("b")], { a: { full: 50, need: 100 }, b: { full: 50, need: 100 } });
    const moved = t.ok(t.initial, { kind: "move", rowId: "b", toIndex: 0 });
    expect(t.run(moved, { kind: "raise", rows: t.initial.rows, fromVersion: t.initial.version })).toEqual({ rejected: "stale" });
    expect(t.run(moved, { kind: "raise", rows: t.initial.rows, fromVersion: moved.version })).toEqual({ rejected: "invalidValue" });
    expect(t.run(t.initial, { kind: "raise", rows: [t.initial.rows[0]!], fromVersion: t.initial.version })).toEqual({ rejected: "invalidValue" });
  });
});

describe("reduceFineTune: その他", () => {
  it("rejected の op では version が進まない", () => {
    const t = setup([makeRow("a", { candyTarget: 5 })], { a: { full: 1, need: 5 } });
    expect(t.run(t.initial, { kind: "step", rowId: "a", by: 1 })).toEqual({ rejected: "excluded" });
  });

  it("coalesceKeyOf は数値の op だけに目印を付ける", () => {
    expect(coalesceKeyOf({ kind: "step", rowId: "a", by: 1 })).toBe("boost:a");
    expect(coalesceKeyOf({ kind: "set", rowId: "a", boost: 1 })).toBe("boost:a");
    expect(coalesceKeyOf({ kind: "targetStep", rowId: "a", by: 1 })).toBe("target:a");
    expect(coalesceKeyOf({ kind: "targetSet", rowId: "a", level: 30 })).toBe("target:a");
    expect(coalesceKeyOf({ kind: "move", rowId: "a", toIndex: 0 })).toBeUndefined();
    expect(coalesceKeyOf({ kind: "raise", rows: [], fromVersion: 0 })).toBeUndefined();
  });

  it("isSameDraftContent は version を見ず、rows を比べる", () => {
    const t = setup([makeRow("a")], { a: { full: 1, need: 1 } });
    expect(isSameDraftContent(t.initial, { ...t.initial, version: 9 })).toBe(true);
    expect(isSameDraftContent(t.initial, { ...t.initial, rows: [...t.initial.rows] })).toBe(true);
    expect(isSameDraftContent(t.initial, { ...t.initial, rows: [makeRow("a")] })).toBe(false);
  });
});
