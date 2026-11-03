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

type RowInfo = { full: number; need: number; /** 個数指定の上限（既定 500） */ max?: number };

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
    withCandyTarget(row, m) {
      return { ...row, candyTarget: Math.min(m, info[row.id]!.max ?? 500) };
    },
    maxCandyTargetFor(row) {
      return info[row.id]!.max ?? 500;
    },
    withSleepTarget(row, target) {
      return {
        ...row,
        sleepTargetMode: typeof target === "string" ? target : undefined,
        sleepTargetHours: typeof target === "number" ? target : undefined,
        candyTarget: target === undefined ? row.candyTarget : undefined,
      };
    },
    withMinimizeBoost(row, on) {
      return on ? { ...row, boostOrExpAdjustment: undefined, boostMinimizeRow: true } : { ...row, boostMinimizeRow: undefined };
    },
    canMinimizeBoostFor(row) {
      return row.pokedexId !== 0;
    },
    withBoostCandyReset(row) {
      return { ...row, boostOrExpAdjustment: undefined };
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
    opRange(base, state, deps.evaluateRows(state.rows), target, deps);
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

describe("reduceFineTune: アメの数（candyStep / candySet）", () => {
  const info = {
    A: { full: 10, need: 100, max: 300 },
    C: { full: 10, need: 40, max: 200 },
    S: { full: 10, need: 100 },
    M: { full: 0, need: 0 },
  };
  const rows = () => [
    makeRow("A", { boostOrExpAdjustment: 7 }),
    makeRow("C", { candyTarget: 40 }),
    makeRow("S", { sleepTargetMode: "stock" }),
    makeRow("M", { srcLevel: MAX_LEVEL, dstLevel: MAX_LEVEL }),
  ];
  const latestOf = (state: FineTuneState, used: Record<string, number>) => ({
    version: state.version,
    result: {
      pokemonResults: Object.entries(used).map(([pokemonId, n]) => ({ pokemonId, reachableLine: { totalCandyUnitsUsed: n } })),
    } as unknown as LevelPlannerResult,
  });

  it("個数指定でない行は、アメブを今の実効値で固定してから個数指定にし、変える前の行・要る数・アメブを記録する", () => {
    const t = setup(rows(), info);
    const out = t.ok(t.initial, { kind: "candyStep", rowId: "A", by: -10 });
    expect(out.rows[0]).toMatchObject({ candyTarget: 90, boostOrExpAdjustment: 7 });
    expect(out.candyRecords.A).toEqual({ before: t.initial.rows[0], m0: 100, boost: 7, candy: 90 });
    // 個数指定の行になったので、目標Lv・アメブは動かせない
    expect(t.run(out, { kind: "step", rowId: "A", by: 1 })).toEqual({ rejected: "excluded" });
    expect(t.run(out, { kind: "targetStep", rowId: "A", by: 1 })).toEqual({ rejected: "excluded" });
  });

  it("要る数より多くもでき、上限（Lv70 に届く数）で止まる。要る数に戻すと変える前の行（同じ参照）に戻り、記録が消える", () => {
    const t = setup(rows(), info);
    const up = t.ok(t.initial, { kind: "candySet", rowId: "A", candy: 9999 });
    expect(up.candyRecords.A!.candy).toBe(300);
    expect(t.range(up, { kind: "candy", rowId: "A" })).toEqual({ min: 0, max: 300 });
    const back = t.ok(up, { kind: "candySet", rowId: "A", candy: 100 });
    expect(back.rows[0]).toBe(t.initial.rows[0]);
    expect(back.candyRecords).toEqual({});
    expect(isDraftEmpty(t.base, back)).toBe(true);
  });

  it("記録の無い行は、最新の結果で使えた数（要る数を超えない）から動かす。要る数まで増やしても記録は作らない", () => {
    const t = setup(rows(), info);
    const latest = latestOf(t.initial, { A: 70 });
    const run = (op: FineTuneOp) => reduceFineTune(t.base, t.initial, op, t.deps, t.deps.evaluateRows(t.initial.rows), latest);
    const down = run({ kind: "candyStep", rowId: "A", by: -10 });
    expect("state" in down && down.state.candyRecords.A).toMatchObject({ m0: 100, candy: 60 });
    expect(run({ kind: "candySet", rowId: "A", candy: 100 })).toEqual({ state: t.initial });
  });

  it("もとから個数指定の行は、その数を変えるだけで記録は持たない。睡眠目標モードの行・Lv上限の行は変えられない", () => {
    const t = setup(rows(), info);
    const out = t.ok(t.initial, { kind: "candyStep", rowId: "C", by: 10 });
    expect(out.rows[1]!.candyTarget).toBe(50);
    expect(out.candyRecords).toEqual({});
    expect(t.run(t.initial, { kind: "candyStep", rowId: "S", by: -1 })).toEqual({ rejected: "candyLocked" });
    expect(t.run(t.initial, { kind: "candyStep", rowId: "M", by: 1 })).toEqual({ rejected: "candyLocked" });
    expect(t.run(t.initial, { kind: "candySet", rowId: "A", candy: Number.NaN })).toEqual({ rejected: "invalidValue" });
  });

  it("数を変えた行は、続けて動かしても記録した要る数・アメブのまま", () => {
    const t = setup(rows(), info);
    let s = t.ok(t.initial, { kind: "candySet", rowId: "A", candy: 50 });
    s = t.ok(s, { kind: "candyStep", rowId: "A", by: -5 });
    expect(s.candyRecords.A).toMatchObject({ m0: 100, boost: 7, candy: 45 });
    expect(s.candyRecords.A!.before).toBe(t.initial.rows[0]);
  });
});

describe("reduceFineTune: 睡眠目標・最小アメブ・アメブのリセット", () => {
  it("睡眠目標を計算機と同じ関数で入れる。同じ目標なら変えない。個数指定が外れたらアメの数の記録も外す", () => {
    const t = setup([makeRow("a", { boostOrExpAdjustment: 7 }), makeRow("b")], { a: { full: 10, need: 100 }, b: { full: 10, need: 100 } });
    const hours = t.ok(t.initial, { kind: "sleepSet", rowId: "b", target: 1000 });
    expect(hours.rows[1]).toMatchObject({ sleepTargetHours: 1000, sleepTargetMode: undefined });
    expect(t.run(hours, { kind: "sleepSet", rowId: "b", target: 1000 })).toEqual({ state: hours });
    const nap = t.ok(hours, { kind: "sleepSet", rowId: "b", target: "napStockTicket" });
    expect(nap.rows[1]).toMatchObject({ sleepTargetMode: "napStockTicket", sleepTargetHours: undefined });
    expect(t.ok(nap, { kind: "sleepSet", rowId: "b", target: undefined }).rows[1]).toMatchObject({ sleepTargetMode: undefined, sleepTargetHours: undefined });
    // アメの数を変えた行に睡眠目標を入れると、個数指定と記録が外れる
    const candy = t.ok(t.initial, { kind: "candyStep", rowId: "a", by: -10 });
    expect(candy.candyRecords.a).toBeDefined();
    const slept = t.ok(candy, { kind: "sleepSet", rowId: "a", target: 500 });
    expect(slept.rows[0]!.candyTarget).toBeUndefined();
    expect(slept.candyRecords).toEqual({});
  });

  it("最小アメブ: 入れると個数を自動にしてスイッチを入れ、効いているときに入れても変えない。外すとスイッチだけ外す。できない行は拒否", () => {
    const t = setup([makeRow("a", { boostOrExpAdjustment: 7 }), makeRow("u", { pokedexId: 0 })], { a: { full: 10, need: 100 }, u: { full: 10, need: 100 } });
    const on = t.ok(t.initial, { kind: "boostMinimize", rowId: "a", on: true });
    expect(on.rows[0]).toMatchObject({ boostOrExpAdjustment: undefined, boostMinimizeRow: true });
    expect(t.run(on, { kind: "boostMinimize", rowId: "a", on: true })).toEqual({ state: on });
    expect(t.ok(on, { kind: "boostMinimize", rowId: "a", on: false }).rows[0]!.boostMinimizeRow).toBeUndefined();
    // 対象外の行（ポケモンが不明）は拒否
    expect(t.run(t.initial, { kind: "boostMinimize", rowId: "u", on: true })).toEqual({ rejected: "excluded" });
  });

  it("アメブのリセット: 手で入れた個数を自動へ戻す。自動の行・対象外の行は変えない", () => {
    const t = setup([makeRow("a", { boostOrExpAdjustment: 7 }), makeRow("b"), makeRow("c", { candyTarget: 40 })], {
      a: { full: 10, need: 100 }, b: { full: 10, need: 100 }, c: { full: 10, need: 40 },
    });
    expect(t.ok(t.initial, { kind: "boostReset", rowId: "a" }).rows[0]!.boostOrExpAdjustment).toBeUndefined();
    expect(t.run(t.initial, { kind: "boostReset", rowId: "b" })).toEqual({ state: t.initial });
    expect(t.run(t.initial, { kind: "boostReset", rowId: "c" })).toEqual({ rejected: "excluded" });
  });
});

describe("reduceFineTune: 調整バーのキャンセル（revertRow）", () => {
  it("その行とアメの数の記録だけを、編集を始める前へ戻す。ほかの行・順番は戻さない", () => {
    const t = setup([makeRow("a", { boostOrExpAdjustment: 7 }), makeRow("b")], { a: { full: 10, need: 100 }, b: { full: 10, need: 100 } });
    const moved = t.ok(t.initial, { kind: "move", rowId: "b", toIndex: 0 });
    // a の編集を始めた時点
    const start = { row: moved.rows[1]!, record: moved.candyRecords.a };
    let s = t.ok(moved, { kind: "candyStep", rowId: "a", by: -10 });
    s = t.ok(s, { kind: "candyStep", rowId: "a", by: -10 });
    s = t.ok(s, { kind: "step", rowId: "b", by: 3 });
    const reverted = t.ok(s, { kind: "revertRow", rowId: "a", row: start.row, candyRecord: start.record });
    expect(reverted.rows[1]).toBe(start.row);
    expect(reverted.candyRecords).toEqual({});
    // ほかの行の変更と順番は残る
    expect(ids(reverted)).toEqual(["b", "a"]);
    expect(reverted.rows[0]!.boostOrExpAdjustment).toBe(3);
  });

  it("編集を始める前と同じなら変えない。違う行の値は受け付けない", () => {
    const t = setup([makeRow("a"), makeRow("b")], { a: { full: 10, need: 100 }, b: { full: 10, need: 100 } });
    expect(t.run(t.initial, { kind: "revertRow", rowId: "a", row: t.initial.rows[0]!, candyRecord: undefined })).toEqual({ state: t.initial });
    expect(t.run(t.initial, { kind: "revertRow", rowId: "a", row: t.initial.rows[1]!, candyRecord: undefined })).toEqual({ rejected: "invalidValue" });
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
    expect(coalesceKeyOf({ kind: "candyStep", rowId: "a", by: 1 })).toBe("candy:a");
    expect(coalesceKeyOf({ kind: "candySet", rowId: "a", candy: 1 })).toBe("candy:a");
    expect(coalesceKeyOf({ kind: "raise", rows: [], fromVersion: 0 })).toBeUndefined();
  });

  it("isSameDraftContent は version を見ず、rows・candyRecords を比べる", () => {
    const t = setup([makeRow("a")], { a: { full: 1, need: 1 } });
    expect(isSameDraftContent(t.initial, { ...t.initial, version: 9 })).toBe(true);
    const record = { before: t.initial.rows[0]!, m0: 1, boost: 0, candy: 0 };
    expect(isSameDraftContent(t.initial, { ...t.initial, candyRecords: { a: record } })).toBe(false);
    expect(isSameDraftContent(t.initial, { ...t.initial, rows: [...t.initial.rows] })).toBe(true);
    expect(isSameDraftContent(t.initial, { ...t.initial, rows: [makeRow("a")] })).toBe(false);
  });
});
