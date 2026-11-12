import { describe, expect, it } from "vitest";
import type { CalcRow, CalcSettingsOverride, CalcSettingsSnapshot, EvaluatedRows } from "../../../composables/useCalcStore";
import type { LevelPlannerResult } from "../../level-planner/types";
import { maxLevel as MAX_LEVEL } from "../../pokesleep/tables";
import {
  boostSlotRemaining,
  canAdjustTarget,
  canAutoAdjustBoost,
  stockReachesTarget,
  coalesceKeyOf,
  initialFineTuneState,
  isDraftEmpty,
  isSameDraftContent,
  boostLevelRange,
  boostRange,
  candyRange,
  targetRange,
  reduceFineTune,
  rowExclusion,
  settingsValueOf,
  SHARDS_MAX,
  UNIVERSAL_CANDY_MAX,
  type FineTuneBase,
  type FineTuneDeps,
  type FineTuneOp,
  type FineTuneState,
} from "../draft";

type RowInfo = {
  full: number;
  need: number;
  /** 個数指定の上限（既定 500） */ max?: number;
  /** 最小アメブにしても在庫で届かない（既定 false） */ minimizeShortCandy?: boolean;
  /** アメブ目標Lvの上限（既定 MAX_LEVEL） */ reachMax?: number;
  /** 睡眠EXPだけで届き、アメブを使えない（既定 false） */ boostDisabled?: boolean;
  /** この行に回る種族アメ在庫（アメ在庫の睡眠目標の行。既定 undefined） */ stock?: number;
};

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
  const calls = {
    explicit: 0,
    target: 0,
    boostLevel: 0,
    defaultLevel: [] as Array<{ level: number | null; settings: CalcSettingsOverride | undefined }>,
  };
  const deps: FineTuneDeps = {
    evaluateRows(rowList): EvaluatedRows {
      const byId: EvaluatedRows["byId"] = new Map();
      for (const r of rowList) {
        const row = info[r.id]!;
        byId.set(r.id, {
          effectiveBoost: r.boostOrExpAdjustment ?? 0,
          boostReachLevel: Math.min(r.boostReachLevel ?? r.dstLevel, r.dstLevel),
          boostReachLevelMax: row.reachMax ?? MAX_LEVEL,
          boostInputDisabled: row.boostDisabled ?? false,
          fullBoost: row.full,
          candyNeed: r.candyTarget ?? row.need,
          stockCandyAvailable: row.stock,
          minimizeShortCandy: row.minimizeShortCandy ?? false,
          minimizeNeededCandy: row.minimizeShortCandy === true ? 999 : undefined,
        });
      }
      return { byId, plannerInput: null };
    },
    withExplicitBoost(row, n) {
      calls.explicit += 1;
      return { ...row, boostOrExpAdjustment: n };
    },
    /** 個数を自動へ戻し、意図を保存する。目標Lvより上なら目標Lvも上げる（計算機と同じ） */
    withBoostReachLevel(row, lv) {
      calls.boostLevel += 1;
      return {
        ...row,
        boostReachLevel: lv,
        boostOrExpAdjustment: undefined,
        boostMinimizeRow: undefined,
        dstLevel: Math.max(row.dstLevel, lv),
      };
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
    /** 自動の行（個数もアメブ目標Lvも選んでいない・個数指定でない行）だけ、アメブ目標Lvを新しい既定（無ければ目標Lv）にする */
    withDefaultBoostReachLevelRows(rowList, level, settings) {
      calls.defaultLevel.push({ level, settings });
      return rowList.map((r) => (r.boostOrExpAdjustment === undefined && r.boostReachAuto !== false && r.candyTarget === undefined
        ? { ...r, boostReachLevel: Math.min(level ?? r.dstLevel, r.dstLevel) }
        : r));
    },
    /** 現在Lvは 1〜目標Lv、あとEXPは 1〜100（0 は 100）。Lv を変えると個数指定が外れ、あとEXPは 100 に戻る */
    withRowIndividual(rowList, rowId, patch) {
      const row = rowList.find((r) => r.id === rowId)!;
      const level = patch.level === undefined ? row.srcLevel : Math.max(1, Math.min(row.dstLevel, Math.floor(patch.level)));
      const exp = patch.expRemaining !== undefined
        ? (Math.min(100, Math.max(0, Math.floor(patch.expRemaining))) || 100)
        : level !== row.srcLevel ? 100 : row.expRemaining;
      if (level === row.srcLevel && exp === row.expRemaining) return rowList;
      return rowList.map((r) => (r.id === rowId
        ? { ...r, srcLevel: level, expRemaining: exp, candyTarget: level !== row.srcLevel ? undefined : r.candyTarget }
        : r));
    },
    canEditIndividual(row) {
      return row.boxId !== "broken";
    },
    speciesCandyFamilyOf(row) {
      return row.pokedexId === 0 ? undefined : String(row.pokedexId);
    },
    speciesCandyStockOf() {
      return 300;
    },
    /** 開いた時点のニックネームは空（表示名は種族名の代わりに行の ID）。リンク切れの行は変えられない */
    nicknameOf(row) {
      return row.boxId === "broken" ? undefined : "";
    },
    titleForNickname(row, nickname) {
      return nickname.trim() || row.id;
    },
  };
  return { deps, calls };
}

/** 開いた時点の設定（テスト用） */
const BASE_SETTINGS: CalcSettingsSnapshot = { minimizeBoost: false, defaultBoostReachLevel: null, totalShards: 1000, universalCandy: { s: 1, m: 2, l: 3 } };

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
    settings: BASE_SETTINGS,
  };
  const run = (state: FineTuneState, op: FineTuneOp) =>
    reduceFineTune(base, state, op, deps, deps.evaluateRows(state.rows));
  const ok = (state: FineTuneState, op: FineTuneOp): FineTuneState => {
    const out = run(state, op);
    if ("rejected" in out) throw new Error(`rejected: ${out.rejected}`);
    return out.state;
  };
  const range = (state: FineTuneState, target: { kind: "boost" | "boostLevel" | "target" | "candy"; rowId: string }) => {
    const evaluated = deps.evaluateRows(state.rows);
    const row = state.rows.find((r) => r.id === target.rowId)!;
    switch (target.kind) {
      case "boost": return boostRange(evaluated, row, boostSlotRemaining(base, evaluated));
      case "boostLevel": return boostLevelRange(evaluated, row);
      case "target": return targetRange(row);
      case "candy": return candyRange(state, evaluated, row, deps);
    }
  };
  return { deps, calls, base, run, ok, range, initial: initialFineTuneState(base) };
}

const ids = (state: FineTuneState) => state.rows.map((r) => r.id);

describe("reduceFineTune: アメブ固定（boostLockSet）", () => {
  /** アメブのあるスロット（差し替えた評価にプランナー入力のアメブだけを足す） */
  function withBoostSlot(t: ReturnType<typeof setup>, kind: "full" | "none" = "full") {
    const evaluateRows: FineTuneDeps["evaluateRows"] = (rowList) => ({
      ...t.deps.evaluateRows(rowList),
      plannerInput: { boost: { kind, limit: 1000 } } as EvaluatedRows["plannerInput"],
    });
    return (state: FineTuneState, op: FineTuneOp) => reduceFineTune(t.base, state, op, { ...t.deps, evaluateRows }, evaluateRows(state.rows));
  }

  it("機械がアメブを動かす行だけ固定でき、外すのはいつでもできる。固定は適用しないので、下書きは空のまま", () => {
    const t = setup([makeRow("a"), makeRow("c", { candyTarget: 100 })], { a: { full: 10, need: 10 }, c: { full: 10, need: 100 } });
    const run = withBoostSlot(t);
    const locked = run(t.initial, { kind: "boostLockSet", rowId: "a", on: true });
    if ("rejected" in locked) throw new Error(locked.rejected);
    expect(locked.state.boostLocks).toEqual({ a: true });
    expect(locked.state.version).toBe(t.initial.version + 1);
    expect(isDraftEmpty(t.base, locked.state)).toBe(true);
    // 履歴には記録する（中身が違う）
    expect(isSameDraftContent(t.initial, locked.state)).toBe(false);
    // 同じ値は変えない
    expect(run(locked.state, { kind: "boostLockSet", rowId: "a", on: true })).toEqual({ state: locked.state });
    // 固定した行は、機械が動かす行から外れる
    const evaluated = t.deps.evaluateRows(locked.state.rows);
    expect(canAutoAdjustBoost(evaluated, locked.state.rows[0]!, locked.state.boostLocks)).toBe(false);
    expect(canAutoAdjustBoost(evaluated, locked.state.rows[0]!)).toBe(true);
    // 個数指定の行は機械が元から動かさないので固定できない
    expect(run(t.initial, { kind: "boostLockSet", rowId: "c", on: true })).toEqual({ rejected: "excluded" });
    // アメ在庫の睡眠目標の行も、機械が元から動かさないので固定できない（S75）
    const withStock = setup([makeRow("a"), makeRow("k", { sleepTargetMode: "stock" })], { a: { full: 10, need: 10 }, k: { full: 10, need: 10 } });
    expect(withBoostSlot(withStock)(withStock.initial, { kind: "boostLockSet", rowId: "k", on: true })).toEqual({ rejected: "excluded" });
    const unlocked = run(locked.state, { kind: "boostLockSet", rowId: "a", on: false });
    if ("rejected" in unlocked) throw new Error(unlocked.rejected);
    expect(unlocked.state.boostLocks).toEqual({});
    // アメブなしのスロットでは固定できない（全体のLvを伸ばすが無い）
    expect(withBoostSlot(t, "none")(t.initial, { kind: "boostLockSet", rowId: "a", on: true })).toEqual({ rejected: "excluded" });
  });

  it("計算機から削除した行の固定は外す。リセット（revertRow）では外さない", () => {
    const t = setup([makeRow("a", { boostOrExpAdjustment: 3 }), makeRow("b")], { a: { full: 10, need: 10 }, b: { full: 10, need: 10 } });
    const run = withBoostSlot(t);
    const ok = (state: FineTuneState, op: FineTuneOp) => {
      const out = run(state, op);
      if ("rejected" in out) throw new Error(out.rejected);
      return out.state;
    };
    const locked = ok(t.initial, { kind: "boostLockSet", rowId: "a", on: true });
    const stepped = ok(locked, { kind: "step", rowId: "a", by: 1 });
    const reverted = ok(stepped, { kind: "revertRow", rowId: "a", row: t.base.rows[0]!, candyRecord: undefined });
    expect(reverted.boostLocks).toEqual({ a: true });
    expect(ok(locked, { kind: "removeRow", rowId: "a" }).boostLocks).toEqual({});
  });
});

describe("boostRange / reduceFineTune: アメブ（D36、D37）", () => {
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

  it("対象外の行（§7）には、アメブの op を拒否する。目標Lvの op は LvMax の行だけ拒否する（計算機と同じ）", () => {
    const rows = [makeRow("c", { candyTarget: 100 }), makeRow("n", { sleepTargetMode: "all" }), makeRow("s", { sleepTargetHours: 1000 }), makeRow("m", { srcLevel: MAX_LEVEL, dstLevel: MAX_LEVEL })];
    const t = setup(rows, {
      c: { full: 10, need: 10 }, n: { full: 0, need: 0 }, s: { full: 0, need: 0 }, m: { full: 0, need: 0 }, u: { full: 0, need: 1 },
    });
    for (const rowId of ["n", "s", "m"]) {
      expect(t.run(t.initial, { kind: "step", rowId, by: 1 })).toEqual({ rejected: "excluded" });
      expect(t.run(t.initial, { kind: "set", rowId, boost: 1 })).toEqual({ rejected: "excluded" });
    }
    // 個数指定の行は対象外にしない（計算機と同じく、アメの数とアメブを別々に決められる。上限はアメの数）
    expect(t.range(t.initial, { kind: "boost", rowId: "c" })).toEqual({ min: 0, max: 100 });
    expect(t.ok(t.initial, { kind: "set", rowId: "c", boost: 500 }).rows[0]).toMatchObject({ boostOrExpAdjustment: 100, candyTarget: 100 });
    expect(t.run(t.initial, { kind: "targetStep", rowId: "m", by: 1 })).toEqual({ rejected: "excluded" });
    expect(t.run(t.initial, { kind: "targetSet", rowId: "m", level: 40 })).toEqual({ rejected: "excluded" });
    // 個数指定・アメを使わない睡眠目標・睡眠だけで届く行も、目標Lvは動かせる。個数指定は目標Lvで外れる
    expect(t.ok(t.initial, { kind: "targetSet", rowId: "c", level: 40 }).rows[0]).toMatchObject({ dstLevel: 40, candyTarget: undefined });
    expect(t.ok(t.initial, { kind: "targetSet", rowId: "n", level: 40 }).rows[1]!.dstLevel).toBe(40);
    expect(t.ok(t.initial, { kind: "targetSet", rowId: "s", level: 40 }).rows[2]!.dstLevel).toBe(40);
    expect(rows.map((r) => rowExclusion(r, t.deps.evaluateRows(rows)))).toEqual([null, "noCandy", "sleepOnly", "maxLevel"]);
    expect(rows.map((r) => canAdjustTarget(r))).toEqual([true, true, true, false]);
    // 操作パネルでは個数指定の行のアメブも動かせるが、機械（全体のLvを伸ばす）は動かさない
    const evaluated = t.deps.evaluateRows(rows);
    expect(rows.map((r) => rowExclusion(r, evaluated) === null)).toEqual([true, false, false, false]);
    expect(rows.map((r) => canAutoAdjustBoost(evaluated, r))).toEqual([false, false, false, false]);
    const free = makeRow("f");
    expect(canAutoAdjustBoost(setup([free], { f: { full: 10, need: 10 } }).deps.evaluateRows([free]), free)).toBe(true);
    // アメ在庫の睡眠目標の行（`stockOnly`）は、操作パネルでは動かせる。機械は、この行に回る在庫で睡眠前のアメ担当分（T'）に
    // 届く行（要る数 ≤ 在庫の取り分）だけ動かす（S75）
    const stock = makeRow("k", { sleepTargetMode: "stock" });
    const stockEvaluated = (info: RowInfo) => setup([stock], { k: info }).deps.evaluateRows([stock]);
    expect(rowExclusion(stock, stockEvaluated({ full: 10, need: 10 }))).toBeNull();
    expect(canAutoAdjustBoost(stockEvaluated({ full: 10, need: 10, stock: 10 }), stock)).toBe(true);
    expect(stockReachesTarget(stockEvaluated({ full: 10, need: 10, stock: 10 }), "k")).toBe(true);
    expect(canAutoAdjustBoost(stockEvaluated({ full: 10, need: 10, stock: 9 }), stock)).toBe(false);
    // 種族を解決できない（在庫の取り分が無い）行も動かさない
    expect(canAutoAdjustBoost(stockEvaluated({ full: 10, need: 10 }), stock)).toBe(false);
    expect(rowExclusion(makeRow("u", { pokedexId: 0 }), t.deps.evaluateRows([makeRow("u")]))).toBe("unknownPokemon");
    expect(canAdjustTarget(makeRow("u", { pokedexId: 0 }))).toBe(true);
    expect(t.run(t.initial, { kind: "step", rowId: "nope", by: 1 })).toEqual({ rejected: "unknownRow" });
  });

  it("睡眠だけで届く行（sleepOnly）も目標Lvは動かせる（計算機と同じく下げても上げてもよい）", () => {
    const t = setup([makeRow("s", { sleepTargetHours: 2000, dstLevel: 48 })], { s: { full: 0, need: 0 } });
    expect(rowExclusion(t.initial.rows[0]!, t.deps.evaluateRows(t.initial.rows))).toBe("sleepOnly");
    expect(t.ok(t.initial, { kind: "targetStep", rowId: "s", by: -1 }).rows[0]!.dstLevel).toBe(47);
    expect(t.ok(t.initial, { kind: "targetSet", rowId: "s", level: 30 }).rows[0]!.dstLevel).toBe(30);
    expect(t.ok(t.initial, { kind: "targetSet", rowId: "s", level: 70 }).rows[0]!.dstLevel).toBe(70);
  });
});

describe("reduceFineTune: アメブ目標Lv（boostLevelSet）", () => {
  it("選んだLvを意図として保存し、手で入れた個数と最小アメブを外す（計算機のアメブ目標Lvピッカーと同じ deps を呼ぶ）", () => {
    const { ok, calls, initial } = setup([makeRow("a", { boostReachLevel: 50, boostOrExpAdjustment: 30, boostMinimizeRow: true })], { a: { full: 100, need: 80 } });
    const next = ok(initial, { kind: "boostLevelSet", rowId: "a", level: 40 });
    expect(next.rows[0]).toMatchObject({ boostReachLevel: 40, boostOrExpAdjustment: undefined, boostMinimizeRow: undefined, dstLevel: 50 });
    expect(next.version).toBe(initial.version + 1);
    expect(calls.boostLevel).toBe(1);
  });

  it("範囲は現在Lv〜アメブ目標Lvの上限で、外は端に収める。今と同じLvなら下書きを変えない", () => {
    const { ok, range, initial } = setup([makeRow("a", { srcLevel: 10, dstLevel: 50, boostReachLevel: 50 })], { a: { full: 100, need: 80, reachMax: 45 } });
    expect(range(initial, { kind: "boostLevel", rowId: "a" })).toEqual({ min: 10, max: 45 });
    expect(ok(initial, { kind: "boostLevelSet", rowId: "a", level: 60 }).rows[0]!.boostReachLevel).toBe(45);
    expect(ok(initial, { kind: "boostLevelSet", rowId: "a", level: 3 }).rows[0]!.boostReachLevel).toBe(10);
    const lowered = ok(initial, { kind: "boostLevelSet", rowId: "a", level: 30 });
    expect(ok(lowered, { kind: "boostLevelSet", rowId: "a", level: 30 })).toBe(lowered);
  });

  it("目標Lvより上を選ぶと目標Lvも上がる（計算機と同じ）", () => {
    const { ok, initial } = setup([makeRow("a", { dstLevel: 40, boostReachLevel: 40 })], { a: { full: 100, need: 80 } });
    expect(ok(initial, { kind: "boostLevelSet", rowId: "a", level: 55 }).rows[0]).toMatchObject({ dstLevel: 55, boostReachLevel: 55 });
  });

  it("対象外の行は excluded、睡眠EXPだけで届きアメブを使えない行は boostLevelLocked、数でない Lv は invalidValue で拒否する", () => {
    const { run, initial } = setup(
      [makeRow("a", { sleepTargetMode: "all" }), makeRow("b"), makeRow("c")],
      { a: { full: 0, need: 0 }, b: { full: 100, need: 80, boostDisabled: true }, c: { full: 100, need: 80 } },
    );
    expect(run(initial, { kind: "boostLevelSet", rowId: "a", level: 30 })).toEqual({ rejected: "excluded" });
    expect(run(initial, { kind: "boostLevelSet", rowId: "b", level: 30 })).toEqual({ rejected: "boostLevelLocked" });
    expect(run(initial, { kind: "boostLevelSet", rowId: "c", level: Number.NaN })).toEqual({ rejected: "invalidValue" });
  });

  it("履歴でまとめる相手は行ごとのアメブ目標Lv（アメブの個数とは別）", () => {
    expect(coalesceKeyOf({ kind: "boostLevelSet", rowId: "a", level: 30 })).toBe("boostLevel:a");
    expect(coalesceKeyOf({ kind: "set", rowId: "a", boost: 30 })).toBe("boost:a");
  });
});

describe("reduceFineTune: 設定欄（最小限のアメブ・既定のアメブ目標Lv・かけら・万能アメ）", () => {
  const rows = () => [
    makeRow("auto", { dstLevel: 60, boostReachLevel: 60 }),
    makeRow("manual", { dstLevel: 60, boostReachLevel: 60, boostOrExpAdjustment: 30 }),
    makeRow("picked", { dstLevel: 60, boostReachLevel: 45, boostReachAuto: false }),
  ];
  const info = { auto: { full: 100, need: 100 }, manual: { full: 100, need: 100 }, picked: { full: 100, need: 100 } };

  it("変えた設定だけを下書きに持ち、開いた時点と同じ値に戻すと消える（行は変えない）", () => {
    const t = setup(rows(), info);
    const shards = t.ok(t.initial, { kind: "shardsSet", count: 5000 });
    expect(shards.settings).toEqual({ totalShards: 5000 });
    expect(shards.rows).toBe(t.initial.rows);
    expect(isDraftEmpty(t.base, shards)).toBe(false);
    expect(settingsValueOf(t.base, shards)).toEqual({ ...BASE_SETTINGS, totalShards: 5000 });
    const back = t.ok(shards, { kind: "shardsSet", count: BASE_SETTINGS.totalShards });
    expect(back.settings).toEqual({});
    expect(isDraftEmpty(t.base, back)).toBe(true);

    const universal = t.ok(t.initial, { kind: "universalCandySet", size: "m", count: 20 });
    expect(universal.settings).toEqual({ universalCandy: { s: 1, m: 20, l: 3 } });
    expect(t.ok(universal, { kind: "universalCandySet", size: "m", count: 2 }).settings).toEqual({});

    const minimized = t.ok(t.initial, { kind: "minimizeBoostSet", on: true });
    expect(minimized.settings).toEqual({ minimizeBoost: true });
    expect(minimized.rows).toBe(t.initial.rows);
    // 同じ値は下書きを変えない
    expect(t.run(minimized, { kind: "minimizeBoostSet", on: true })).toEqual({ state: minimized });
  });

  it("かけら・万能アメは範囲に収める（0〜上限、整数）。数でない値は invalidValue", () => {
    const t = setup(rows(), info);
    expect(t.ok(t.initial, { kind: "shardsSet", count: -5 }).settings).toEqual({ totalShards: 0 });
    expect(t.ok(t.initial, { kind: "shardsSet", count: SHARDS_MAX + 10 }).settings).toEqual({ totalShards: SHARDS_MAX });
    expect(t.ok(t.initial, { kind: "universalCandySet", size: "s", count: 12.7 }).settings).toEqual({ universalCandy: { s: 12, m: 2, l: 3 } });
    expect(t.ok(t.initial, { kind: "universalCandySet", size: "l", count: UNIVERSAL_CANDY_MAX + 1 }).settings.universalCandy?.l).toBe(UNIVERSAL_CANDY_MAX);
    expect(t.run(t.initial, { kind: "shardsSet", count: Number.NaN })).toEqual({ rejected: "invalidValue" });
    expect(t.run(t.initial, { kind: "universalCandySet", size: "s", count: Number.NaN })).toEqual({ rejected: "invalidValue" });
  });

  it("既定のアメブ目標Lvは、自動の行だけをすぐ新しい既定で配り直す（手で入れた行・アメブ目標Lvを選んだ行はそのまま）", () => {
    const t = setup(rows(), info);
    const out = t.ok(t.initial, { kind: "defaultBoostLevelSet", level: 40 });
    expect(out.settings).toEqual({ defaultBoostReachLevel: 40 });
    expect(out.rows[0]).toMatchObject({ id: "auto", boostReachLevel: 40 });
    expect(out.rows[1]).toBe(t.initial.rows[1]);
    expect(out.rows[2]).toBe(t.initial.rows[2]);
    expect(t.calls.defaultLevel.at(-1)).toEqual({ level: 40, settings: undefined });
    // 計算機の設定と同じく、1 未満は「目標Lvと同じ」（null）、70 より上は 70
    expect(t.ok(t.initial, { kind: "defaultBoostLevelSet", level: 99 }).settings).toEqual({ defaultBoostReachLevel: MAX_LEVEL });
    expect(t.run(t.initial, { kind: "defaultBoostLevelSet", level: 0 })).toEqual({ state: t.initial });
    expect(t.run(t.initial, { kind: "defaultBoostLevelSet", level: Number.NaN })).toEqual({ rejected: "invalidValue" });
  });

  it("既定のアメブ目標Lvを開いた時点の値へ戻すと、配り直した行は開いた時点の行（同じ参照）に戻り、下書きは空になる", () => {
    const t = setup(rows(), info);
    const changed = t.ok(t.initial, { kind: "defaultBoostLevelSet", level: 40 });
    const back = t.ok(changed, { kind: "defaultBoostLevelSet", level: null });
    expect(back.rows[0]).toBe(t.initial.rows[0]);
    expect(back.settings).toEqual({});
    expect(isDraftEmpty(t.base, back)).toBe(true);
  });

  it("設定のリセットは、設定を開いた時点へ戻し、既定のアメブ目標Lvで配り直した行も開いた時点の設定で配り直す", () => {
    const t = setup(rows(), info);
    let s = t.ok(t.initial, { kind: "defaultBoostLevelSet", level: 40 });
    s = t.ok(s, { kind: "shardsSet", count: 9999 });
    s = t.ok(s, { kind: "minimizeBoostSet", on: true });
    const reset = t.ok(s, { kind: "settingsReset" });
    expect(reset.settings).toEqual({});
    expect(reset.rows[0]).toBe(t.initial.rows[0]);
    expect(isDraftEmpty(t.base, reset)).toBe(true);
    expect(t.calls.defaultLevel.at(-1)).toEqual({ level: null, settings: BASE_SETTINGS });
    // 変えていなければ何もしない
    expect(t.run(t.initial, { kind: "settingsReset" })).toEqual({ state: t.initial });
  });

  it("履歴でまとめる相手: かけら・万能アメ（大きさごと）・既定のアメブ目標Lv。最小限のアメブとリセットはまとめない", () => {
    expect(coalesceKeyOf({ kind: "shardsSet", count: 1 })).toBe("settings:shards");
    expect(coalesceKeyOf({ kind: "universalCandySet", size: "s", count: 1 })).toBe("settings:universal:s");
    expect(coalesceKeyOf({ kind: "defaultBoostLevelSet", level: 30 })).toBe("settings:defaultBoostLevel");
    expect(coalesceKeyOf({ kind: "minimizeBoostSet", on: true })).toBeUndefined();
    expect(coalesceKeyOf({ kind: "settingsReset" })).toBeUndefined();
  });

  it("設定だけ違う下書きは、中身が違う（履歴に記録する）", () => {
    const t = setup(rows(), info);
    const a = t.ok(t.initial, { kind: "universalCandySet", size: "s", count: 5 });
    expect(isSameDraftContent(a, t.initial)).toBe(false);
    expect(isSameDraftContent(a, { ...a, version: a.version + 1 })).toBe(true);
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
    // 個数指定の行になっても、計算機と同じくアメブは動かせる（上限はアメの数）。動かすとアメの数の記録は外れ、
    // 元の数に戻しても変える前の行（アメブを動かす前の行）には戻らない
    const stepped = t.ok(out, { kind: "step", rowId: "A", by: 1 });
    expect(stepped.rows[0]).toMatchObject({ candyTarget: 90, boostOrExpAdjustment: 8 });
    expect(stepped.candyRecords.A).toBeUndefined();
    expect(t.range(stepped, { kind: "boost", rowId: "A" }).max).toBe(90);
    expect(t.ok(stepped, { kind: "candySet", rowId: "A", candy: 100 }).rows[0]).toMatchObject({ candyTarget: 100, boostOrExpAdjustment: 8 });
  });

  it("アメの数を変えた行・もとから個数指定の行も、目標Lvを選ぶと個数指定が外れる（計算機と同じ）。アメの数の記録も外れる", () => {
    const t = setup(rows(), info);
    const edited = t.ok(t.initial, { kind: "candyStep", rowId: "A", by: -10 });
    const targeted = t.ok(edited, { kind: "targetSet", rowId: "A", level: 40 });
    expect(targeted.rows[0]).toMatchObject({ dstLevel: 40, candyTarget: undefined, boostOrExpAdjustment: 7 });
    expect(targeted.candyRecords.A).toBeUndefined();
    // 個数指定が外れたので、アメブも動かせる
    expect(t.ok(targeted, { kind: "step", rowId: "A", by: 1 }).rows[0]!.boostOrExpAdjustment).toBe(8);
    // もとから個数指定の行（記録は持たない）
    expect(t.ok(t.initial, { kind: "targetSet", rowId: "C", level: 40 }).rows[1]).toMatchObject({ dstLevel: 40, candyTarget: undefined });
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

  it("最小アメブ: アメが足りず最小アメブにしても届かない行も、計算機と同じく入れられる。入っている行は外せる", () => {
    const t = setup(
      [makeRow("s", { boostOrExpAdjustment: 7 }), makeRow("m", { boostMinimizeRow: true })],
      { s: { full: 10, need: 100, minimizeShortCandy: true }, m: { full: 10, need: 100, minimizeShortCandy: true } },
    );
    expect(t.ok(t.initial, { kind: "boostMinimize", rowId: "s", on: true }).rows[0]).toMatchObject({ boostOrExpAdjustment: undefined, boostMinimizeRow: true });
    expect(t.ok(t.initial, { kind: "boostMinimize", rowId: "m", on: false }).rows[1]!.boostMinimizeRow).toBeUndefined();
  });

  it("アメブの再割当: 手で入れた個数を自動へ戻す（個数指定の行も。アメの数の記録は外す）。自動の行は変えず、対象外の行は拒否する", () => {
    const t = setup(
      [makeRow("a", { boostOrExpAdjustment: 7 }), makeRow("b"), makeRow("c", { candyTarget: 40, boostOrExpAdjustment: 5 }), makeRow("n", { sleepTargetMode: "all", boostOrExpAdjustment: 3 })],
      { a: { full: 10, need: 100 }, b: { full: 10, need: 100 }, c: { full: 10, need: 40 }, n: { full: 0, need: 0 } },
    );
    expect(t.ok(t.initial, { kind: "boostReset", rowId: "a" }).rows[0]!.boostOrExpAdjustment).toBeUndefined();
    expect(t.run(t.initial, { kind: "boostReset", rowId: "b" })).toEqual({ state: t.initial });
    expect(t.ok(t.initial, { kind: "boostReset", rowId: "c" }).rows[2]).toMatchObject({ candyTarget: 40, boostOrExpAdjustment: undefined });
    expect(t.run(t.initial, { kind: "boostReset", rowId: "n" })).toEqual({ rejected: "excluded" });
    // アメの数を変えた行で再割当すると、記録が外れる
    const edited = t.ok(t.initial, { kind: "candyStep", rowId: "a", by: -10 });
    expect(edited.candyRecords.a).toBeDefined();
    expect(t.ok(edited, { kind: "boostReset", rowId: "a" }).candyRecords).toEqual({});
  });
});

describe("reduceFineTune: 調整バーのリセット（revertRow）", () => {
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
    const t = setup([makeRow("a", { sleepTargetMode: "all" })], { a: { full: 0, need: 0 } });
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

describe("reduceFineTune: 行の詳細（現在Lv・あとEXP・アメ在庫）", () => {
  it("現在Lv: 1〜目標Lvに収め、あとEXPは次Lvまで全部へ戻す。個数指定とアメの数の記録は外れる", () => {
    const t = setup([makeRow("a", { expRemaining: 40 })], { a: { full: 10, need: 100 } });
    const candied = t.ok(t.initial, { kind: "candySet", rowId: "a", candy: 50 });
    expect(candied.candyRecords.a).toBeDefined();
    const raised = t.ok(candied, { kind: "srcLevelSet", rowId: "a", level: 99 });
    expect(raised.rows[0]).toMatchObject({ srcLevel: 50, expRemaining: 100, candyTarget: undefined });
    expect(raised.candyRecords).toEqual({});
    // 同じ値なら変えない
    expect(t.run(raised, { kind: "srcLevelSet", rowId: "a", level: 50 })).toEqual({ state: raised });
  });

  it("あとEXP: 0 は次Lvまで全部。個数指定は残り、アメの数の記録の「変える前の行」にも同じあとEXPが入る", () => {
    const t = setup([makeRow("a")], { a: { full: 10, need: 100 } });
    const candied = t.ok(t.initial, { kind: "candySet", rowId: "a", candy: 50 });
    const exp = t.ok(candied, { kind: "expRemainingSet", rowId: "a", exp: 30 });
    expect(exp.rows[0]).toMatchObject({ expRemaining: 30, candyTarget: 50 });
    expect(exp.candyRecords.a!.before.expRemaining).toBe(30);
    expect(t.ok(exp, { kind: "expRemainingSet", rowId: "a", exp: 0 }).rows[0]!.expRemaining).toBe(100);
  });

  it("リンク切れの行の現在Lv・あとEXP、種族不明の行の在庫は individualLocked", () => {
    const t = setup([makeRow("b", { boxId: "broken" }), makeRow("u", { pokedexId: 0 })], {
      b: { full: 10, need: 100 }, u: { full: 10, need: 100 },
    });
    expect(t.run(t.initial, { kind: "srcLevelSet", rowId: "b", level: 20 })).toEqual({ rejected: "individualLocked" });
    expect(t.run(t.initial, { kind: "expRemainingSet", rowId: "b", exp: 20 })).toEqual({ rejected: "individualLocked" });
    expect(t.run(t.initial, { kind: "stockSet", rowId: "u", count: 20 })).toEqual({ rejected: "individualLocked" });
  });

  it("アメ在庫: 進化系ごとに下書きへ持ち、開いた時点の数に戻すと消える。在庫だけ変えても下書きは空でない", () => {
    const t = setup([makeRow("a"), makeRow("b")], { a: { full: 10, need: 100 }, b: { full: 10, need: 100 } });
    const stocked = t.ok(t.initial, { kind: "stockSet", rowId: "a", count: 500.7 });
    expect(stocked.speciesCandy).toEqual({ "25": 500 });
    expect(stocked.rows).toBe(t.initial.rows);
    expect(isDraftEmpty(t.base, stocked)).toBe(false);
    // 同じ進化系の行（b も 25）からも同じ在庫を動かす
    expect(t.run(stocked, { kind: "stockSet", rowId: "b", count: 500 })).toEqual({ state: stocked });
    const back = t.ok(stocked, { kind: "stockSet", rowId: "b", count: 300 });
    expect(back.speciesCandy).toEqual({});
    expect(isDraftEmpty(t.base, back)).toBe(true);
    expect(t.ok(t.initial, { kind: "stockSet", rowId: "a", count: -5 }).speciesCandy).toEqual({ "25": 0 });
  });

  it("リセット（revertRow）は、その行と一緒にその行の進化系の在庫も編集を始める前の値へ戻す", () => {
    const t = setup([makeRow("a")], { a: { full: 10, need: 100 } });
    const start = t.initial.rows[0]!;
    const edited = t.ok(t.ok(t.initial, { kind: "stockSet", rowId: "a", count: 900 }), { kind: "srcLevelSet", rowId: "a", level: 20 });
    const reverted = t.ok(edited, { kind: "revertRow", rowId: "a", row: start, candyRecord: undefined, stock: { familyKey: "25", count: undefined } });
    expect(reverted.rows[0]).toBe(start);
    expect(reverted.speciesCandy).toEqual({});
    expect(isSameDraftContent(reverted, t.initial)).toBe(true);
  });

  it("isSameDraftContent は在庫の違いも見る。coalesceKeyOf は欄ごとに目印を付ける", () => {
    const t = setup([makeRow("a")], { a: { full: 10, need: 100 } });
    expect(isSameDraftContent(t.initial, { ...t.initial, speciesCandy: { "25": 1 } })).toBe(false);
    expect(coalesceKeyOf({ kind: "srcLevelSet", rowId: "a", level: 1 })).toBe("srcLevel:a");
    expect(coalesceKeyOf({ kind: "expRemainingSet", rowId: "a", exp: 1 })).toBe("exp:a");
    expect(coalesceKeyOf({ kind: "stockSet", rowId: "a", count: 1 })).toBe("stock:a");
  });
});
