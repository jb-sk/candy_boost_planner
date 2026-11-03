import { describe, expect, it } from "vitest";
import type { CalcRow, EvaluatedRows } from "../../../composables/useCalcStore";
import type { LevelPlannerResult } from "../../level-planner/types";
import { maxLevel as MAX_LEVEL } from "../../pokesleep/tables";
import {
  boostSlotRemaining,
  canReceive,
  canStartGiving,
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
  type FineTuneLatest,
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
  const calls = { explicit: 0, target: 0, candy: 0 };
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
    withCandyTarget(row, m) {
      calls.candy += 1;
      return { ...row, candyTarget: m };
    },
  };
  return { deps, calls };
}

function resultOf(reached: Record<string, boolean>, used: Record<string, number> = {}): LevelPlannerResult {
  return {
    pokemonResults: Object.entries(reached).map(([pokemonId, ok]) => ({
      pokemonId,
      reachableLine: { effectiveTargetReached: ok, totalCandyUnitsUsed: used[pokemonId] ?? 0 },
    })),
  } as unknown as LevelPlannerResult;
}

function setup(rows: CalcRow[], info: Record<string, RowInfo>, boostLimit = 1000) {
  const { deps, calls } = makeDeps(info);
  const base: FineTuneBase = {
    rows,
    evaluated: deps.evaluateRows(rows),
    result: resultOf({}),
    boostLimit,
  };
  const run = (state: FineTuneState, op: FineTuneOp, latest: FineTuneLatest | null = null) =>
    reduceFineTune(base, state, op, deps, deps.evaluateRows(state.rows), latest);
  const ok = (state: FineTuneState, op: FineTuneOp, latest: FineTuneLatest | null = null): FineTuneState => {
    const out = run(state, op, latest);
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
    reduceFineTune(t.base, t.initial, { kind: "step", rowId: "a", by: 5 }, deps, t.deps.evaluateRows(t.initial.rows), null);
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

  it("睡眠目標モードの個数指定の行だけ・Lv上限の個数指定の行だけでは false", () => {
    expect(has([makeRow("n", { candyTarget: 5, sleepTargetMode: "all" })])).toBe(false);
    expect(has([makeRow("m", { candyTarget: 0, srcLevel: MAX_LEVEL, dstLevel: MAX_LEVEL })])).toBe(false);
  });

  it("普通の個数指定の行があれば true、個数指定の行だけでも true", () => {
    expect(has([makeRow("c", { candyTarget: 5 })])).toBe(true);
    expect(has([makeRow("n", { candyTarget: 5, sleepTargetMode: "all" }), makeRow("c", { candyTarget: 5 })])).toBe(true);
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
    hasFineTuneTarget([makeRow("c", { candyTarget: 0 }), makeRow("m", { candyTarget: 0 })], evaluate);
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
    const out = reduceFineTune(t.base, t.initial, { kind: "targetStep", rowId: "a", by: -1 }, deps, t.deps.evaluateRows(t.initial.rows), null);
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

describe("reduceFineTune: 受け取る側（receiverSelect、D39）", () => {
  const info = Object.fromEntries(["U0", "R1", "U2", "R3", "B", "C"].map((id) => [id, { full: 10, need: 100 }]));
  const rows = () => ["U0", "R1", "U2", "R3", "B", "C"].map((id) => makeRow(id));
  const latestOf = (state: FineTuneState, reached: Record<string, boolean>): FineTuneLatest => ({ version: state.version, result: resultOf(reached) });
  const reached = { U0: false, R1: true, U2: false, R3: true, B: false, C: false };

  it("受け取る側より上の届かない行が、順番を保ったまま受け取る側のすぐ下へ動く。下の行は動かない", () => {
    const t = setup(rows(), info);
    const next = t.ok(t.initial, { kind: "receiverSelect", rowId: "B" }, latestOf(t.initial, reached));
    expect(ids(next)).toEqual(["R1", "R3", "B", "U0", "U2", "C"]);
    expect(next.receiverId).toBe("B");
    expect(next.version).toBe(t.initial.version + 1);
  });

  it("1行目が届かない行でも、届く行が受け取る側より上に残る", () => {
    const t = setup(rows(), info);
    const next = t.ok(t.initial, { kind: "receiverSelect", rowId: "R3" }, latestOf(t.initial, { ...reached, R3: false }));
    expect(ids(next)).toEqual(["R1", "R3", "U0", "U2", "B", "C"]);
  });

  it("受け取る側自身が届いている、または上に届かない行が無いときは動かさない（選択だけ入る）", () => {
    const t = setup(rows(), info);
    const reachedSelf = t.ok(t.initial, { kind: "receiverSelect", rowId: "B" }, latestOf(t.initial, { ...reached, B: true }));
    expect(reachedSelf.rows).toBe(t.initial.rows);
    expect(reachedSelf.receiverId).toBe("B");
    const none = t.ok(t.initial, { kind: "receiverSelect", rowId: "R1" }, latestOf(t.initial, { ...reached, U0: true, R1: false }));
    expect(none.rows).toBe(t.initial.rows);
    expect(isDraftEmpty(t.base, none)).toBe(true);
  });

  it("最新の結果が今の版でない・結果が無いときは rejected", () => {
    const t = setup(rows(), info);
    expect(t.run(t.initial, { kind: "receiverSelect", rowId: "B" }, { version: t.initial.version - 1, result: resultOf(reached) })).toEqual({ rejected: "previewPending" });
    expect(t.run(t.initial, { kind: "receiverSelect", rowId: "B" }, null)).toEqual({ rejected: "previewPending" });
  });

  it("個数指定の行は選べず、受け取る側がいるときは rejected。receiverClear は選択だけを外す", () => {
    const withCandy = [makeRow("A", { candyTarget: 50 }), makeRow("B")];
    const t = setup(withCandy, { A: { full: 1, need: 50 }, B: { full: 1, need: 1 } });
    expect(t.run(t.initial, { kind: "receiverSelect", rowId: "A" }, latestOf(t.initial, { A: false, B: false }))).toEqual({ rejected: "notReceivable" });

    const t2 = setup(rows(), info);
    const selected = t2.ok(t2.initial, { kind: "receiverSelect", rowId: "B" }, latestOf(t2.initial, reached));
    expect(t2.run(selected, { kind: "receiverSelect", rowId: "C" }, latestOf(selected, reached))).toEqual({ rejected: "receiverExists" });
    const cleared = t2.ok(selected, { kind: "receiverClear" });
    expect(cleared.receiverId).toBeNull();
    expect(cleared.rows).toBe(selected.rows);
    expect(cleared.givers).toBe(selected.givers);
    // 選んでいないときの receiverClear は変えない
    expect(t2.run(cleared, { kind: "receiverClear" })).toEqual({ state: cleared });
    expect(canReceive(cleared, t2.deps.evaluateRows(cleared.rows), cleared.rows[0]!)).toBe(true);
    expect(canReceive(selected, t2.deps.evaluateRows(selected.rows), selected.rows[0]!)).toBe(false);
  });
});

describe("reduceFineTune: ゆずる側（giverStep / giverSet、D31、D38、D42）", () => {
  const info = {
    G1: { full: 10, need: 100 },
    G2: { full: 10, need: 60 },
    B: { full: 10, need: 100 },
    L: { full: 10, need: 100 },
    Z: { full: 10, need: 0 },
    S: { full: 10, need: 100 },
  };
  const rows = () => [makeRow("G1", { boostOrExpAdjustment: 7 }), makeRow("G2"), makeRow("Z"), makeRow("S", { sleepTargetMode: "stock" }), makeRow("B"), makeRow("L")];
  const withReceiver = (t: ReturnType<typeof setup>): FineTuneState => ({ ...t.initial, receiverId: "B" });

  it("記録の無い行で受け付けるのは、使うアメが1個以上で、睡眠目標モードでない、受け取る側でない行。受け取る側の有無と位置は問わない", () => {
    const t = setup(rows(), info);
    expect("state" in t.run(t.initial, { kind: "giverSet", rowId: "G1", candy: 10 })).toBe(true);
    const s = withReceiver(t);
    // 受け取る側より下の行も減らせる（注意 belowReceiver が出る）
    expect("state" in t.run(s, { kind: "giverSet", rowId: "L", candy: 10 })).toBe(true);
    expect(t.run(s, { kind: "giverSet", rowId: "B", candy: 10 })).toEqual({ rejected: "notGiver" });
    expect(t.run(s, { kind: "giverSet", rowId: "Z", candy: 0 })).toEqual({ rejected: "notGiver" });
    expect(t.run(s, { kind: "giverStep", rowId: "S", by: -1 })).toEqual({ rejected: "notGiver" });
    expect("state" in t.run(s, { kind: "giverStep", rowId: "G2", by: -1 })).toBe(true);
  });

  it("記録の無い行は、最新の結果で使えた数（m0 を超えない）から動かす。m0 まで増やしても記録は作らない", () => {
    const t = setup(rows(), info);
    const latest = { version: t.initial.version, result: resultOf({ G1: false, G2: true }, { G1: 70, G2: 999 }) };
    const down = t.ok(t.initial, { kind: "giverStep", rowId: "G1", by: -10 }, latest);
    expect(down.givers.G1).toMatchObject({ m0: 100, candy: 60 });
    // 使えた数が m0 を超えていても m0 から
    expect(t.ok(t.initial, { kind: "giverStep", rowId: "G2", by: -10 }, latest).givers.G2).toMatchObject({ m0: 60, candy: 50 });
    // 使えた数より多く m0 より少ない数は記録する。m0 は記録しない
    expect(t.ok(t.initial, { kind: "giverStep", rowId: "G1", by: 5 }, latest).givers.G1).toMatchObject({ candy: 75 });
    expect(t.run(t.initial, { kind: "giverSet", rowId: "G1", candy: 100 }, latest)).toEqual({ state: t.initial });
  });

  it("個数指定の行・目標Lvやアメブを変えた行もゆずる側になれる", () => {
    const t = setup([makeRow("P", { candyTarget: 40 }), makeRow("B")], { P: { full: 1, need: 40 }, B: { full: 1, need: 1 } });
    const s = { ...t.initial, receiverId: "B" };
    expect(canStartGiving(s, t.deps.evaluateRows(s.rows), s.rows[0]!)).toBe(true);
    const out = t.ok(s, { kind: "giverSet", rowId: "P", candy: 10 });
    expect(out.rows[0]!.candyTarget).toBe(10);
    expect(out.givers.P!.m0).toBe(40);
  });

  it("m0 以上を求めても記録ができず状態が変わらない。m0 より下げたときに、その時点の行・m0・実効アメブが記録される", () => {
    const t = setup(rows(), info);
    const s = withReceiver(t);
    expect(t.run(s, { kind: "giverSet", rowId: "G1", candy: 100 })).toEqual({ state: s });
    expect(t.run(s, { kind: "giverSet", rowId: "G1", candy: 500 })).toEqual({ state: s });
    expect(t.run(s, { kind: "giverStep", rowId: "G1", by: 3 })).toEqual({ state: s });

    const out = t.ok(s, { kind: "giverSet", rowId: "G1", candy: 60 });
    expect(out.givers.G1).toEqual({ before: s.rows[0], m0: 100, boost: 7, candy: 60 });
    expect(out.givers.G1!.before).toBe(s.rows[0]);
    expect(out.rows[0]!.candyTarget).toBe(60);
    expect(out.rows[0]!.boostOrExpAdjustment).toBe(7);
    expect(out.version).toBe(s.version + 1);
    expect(isDraftEmpty(t.base, out)).toBe(false);
  });

  it("実効アメブで固定してから個数指定にする（withExplicitBoost の後に withCandyTarget）", () => {
    const order: string[] = [];
    const t = setup(rows(), info);
    const deps: FineTuneDeps = {
      ...t.deps,
      withExplicitBoost(row, n, options) {
        order.push(`boost:${n}:${options?.preserveTargetForExplicitBoost}`);
        return t.deps.withExplicitBoost(row, n, options);
      },
      withCandyTarget(row, m) {
        order.push(`candy:${m}`);
        return t.deps.withCandyTarget(row, m);
      },
    };
    const s = withReceiver(t);
    reduceFineTune(t.base, s, { kind: "giverSet", rowId: "G1", candy: 60 }, deps, t.deps.evaluateRows(s.rows), null);
    expect(order).toEqual(["boost:7:true", "candy:60"]);
  });

  it("0〜m0 に収まり、2匹以上をそれぞれ別に減らせる。記録した m0・アメブは続けて動かしても変わらない", () => {
    const t = setup(rows(), info);
    let s = withReceiver(t);
    s = t.ok(s, { kind: "giverSet", rowId: "G1", candy: 60 });
    s = t.ok(s, { kind: "giverStep", rowId: "G2", by: -1000 });
    expect(s.givers.G2!.candy).toBe(0);
    expect(s.rows[1]!.candyTarget).toBe(0);
    s = t.ok(s, { kind: "giverStep", rowId: "G1", by: -5 });
    expect(s.givers.G1).toMatchObject({ m0: 100, boost: 7, candy: 55 });
    expect(Object.keys(s.givers).sort()).toEqual(["G1", "G2"]);
  });

  it("m を m0 に戻すと、行がゆずる前の行（同じ参照）に戻り、記録が消える。次に下げるときは記録し直す", () => {
    const t = setup(rows(), info);
    const s = withReceiver(t);
    const down = t.ok(s, { kind: "giverSet", rowId: "G1", candy: 60 });
    const up = t.ok(down, { kind: "giverSet", rowId: "G1", candy: 100 });
    expect(up.rows[0]).toBe(s.rows[0]);
    expect(up.givers).toEqual({});
    expect(isDraftEmpty(t.base, up)).toBe(true);
    const again = t.ok(up, { kind: "giverStep", rowId: "G1", by: -1 });
    expect(again.givers.G1!.candy).toBe(99);
  });

  it("記録のある行は、受け取る側がいなくても、受け取る側より下にあっても通る。選択を外しても m は戻らない", () => {
    const t = setup(rows(), info);
    let s = withReceiver(t);
    s = t.ok(s, { kind: "giverSet", rowId: "G1", candy: 60 });
    // 受け取る側を G1 より上へ動かす
    const moved = t.ok(s, { kind: "move", rowId: "B", toIndex: 0 });
    expect(ids(moved)[0]).toBe("B");
    expect(t.ok(moved, { kind: "giverStep", rowId: "G1", by: 1 }).givers.G1!.candy).toBe(61);
    const cleared = t.ok(s, { kind: "receiverClear" });
    expect(cleared.givers).toBe(s.givers);
    expect(cleared.rows[0]!.candyTarget).toBe(60);
    expect(t.ok(cleared, { kind: "giverStep", rowId: "G1", by: 10 }).givers.G1!.candy).toBe(70);
    // 選び直しても記録した m0 と m のまま調整を続けられる
    const reselected = t.ok(cleared, { kind: "receiverSelect", rowId: "L" }, { version: cleared.version, result: resultOf({}) });
    expect(reselected.givers.G1).toBe(cleared.givers.G1);
  });

  it("ゆずる側の行に step / set / targetStep / targetSet が来たら rejected。m0 に戻したあとは通る（D23）", () => {
    const t = setup(rows(), info);
    const s = t.ok(withReceiver(t), { kind: "giverSet", rowId: "G1", candy: 60 });
    expect(t.run(s, { kind: "step", rowId: "G1", by: 1 })).toEqual({ rejected: "giverLocked" });
    expect(t.run(s, { kind: "set", rowId: "G1", boost: 1 })).toEqual({ rejected: "giverLocked" });
    expect(t.run(s, { kind: "targetStep", rowId: "G1", by: -1 })).toEqual({ rejected: "giverLocked" });
    expect(t.run(s, { kind: "targetSet", rowId: "G1", level: 20 })).toEqual({ rejected: "giverLocked" });
    const back = t.ok(s, { kind: "giverSet", rowId: "G1", candy: 100 });
    expect("state" in t.run(back, { kind: "step", rowId: "G1", by: 1 })).toBe(true);
  });

  it("受け取る側をゆずる側より上へ move しても拒否されない（D37）。ゆずる側の使うアメを戻して枠を超えても通り、残り枠が負になる", () => {
    const t = setup(rows(), info, 10);
    let s = withReceiver(t);
    s = t.ok(s, { kind: "giverSet", rowId: "G1", candy: 60 });
    expect("state" in t.run(s, { kind: "move", rowId: "B", toIndex: 0 })).toBe(true);
    // 枠(10)に対して G1 のアメブ 7 + G2 のアメブ 9 = 16 > 10
    s = t.ok(s, { kind: "move", rowId: "G2", toIndex: 1 });
    const g2 = t.ok({ ...s, rows: s.rows.map((r) => (r.id === "G2" ? { ...r, boostOrExpAdjustment: 9 } : r)) }, { kind: "giverSet", rowId: "G1", candy: 100 });
    expect(boostSlotRemaining(t.base, t.deps.evaluateRows(g2.rows))).toBe(-6);
  });

  it("opRange の giver: 記録が無い行は 0〜今の評価の m0、記録のある行は 0〜記録の m0", () => {
    const t = setup(rows(), info);
    const s = withReceiver(t);
    expect(t.range(s, { kind: "giver", rowId: "G2" })).toEqual({ min: 0, max: 60 });
    const down = t.ok(s, { kind: "giverSet", rowId: "G2", candy: 10 });
    // 個数指定になっても、記録の m0 のまま
    expect(t.range(down, { kind: "giver", rowId: "G2" })).toEqual({ min: 0, max: 60 });
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
    expect(coalesceKeyOf({ kind: "giverStep", rowId: "a", by: 1 })).toBe("giver:a");
    expect(coalesceKeyOf({ kind: "giverSet", rowId: "a", candy: 1 })).toBe("giver:a");
    expect(coalesceKeyOf({ kind: "move", rowId: "a", toIndex: 0 })).toBeUndefined();
    expect(coalesceKeyOf({ kind: "receiverClear" })).toBeUndefined();
  });

  it("isSameDraftContent は version を見ず、rows・givers・receiverId を比べる", () => {
    const t = setup([makeRow("a")], { a: { full: 1, need: 1 } });
    expect(isSameDraftContent(t.initial, { ...t.initial, version: 9 })).toBe(true);
    expect(isSameDraftContent(t.initial, { ...t.initial, receiverId: "a" })).toBe(false);
    expect(isSameDraftContent(t.initial, { ...t.initial, rows: [...t.initial.rows] })).toBe(true);
    expect(isSameDraftContent(t.initial, { ...t.initial, rows: [makeRow("a")] })).toBe(false);
  });
});
