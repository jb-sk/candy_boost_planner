/**
 * やりくりモーダルの下書き（設計書 §10.1）。
 * 下書きは行一覧そのもの（D40）。各 op は今の下書きの行に計算機と同じ関数を当てて、その行だけを差し替える。
 * ストア・Vue を import しない（§10.4）。ストアの関数は `FineTuneDeps` で受け取る。
 */
import type { CalcRow, EvaluatedRows } from "../../composables/useCalcStore";
import { isValidPokedexId } from "../pokesleep/candy-family";
import { maxLevel as MAX_LEVEL } from "../pokesleep/tables";
import { sleepTargetTraits } from "../sleep-target";
import type { LevelPlannerResult, PokemonPlanResult } from "../level-planner/types";

/** 開いた時点の計算機。モーダルの間は変わらない。 */
export interface FineTuneBase {
  /**
   * ストアの rows.value そのもの（差し替えの検出に参照の同一性を使う、§10.3）。
   * 写しを取らない。書き換えないことは型（readonly）で守る。
   */
  rows: readonly CalcRow[];
  evaluated: EvaluatedRows;
  result: LevelPlannerResult;
  /** スロットのアメブ上限（`boostCandyRemaining`）。残り枠は評価した行から出す（D26）。 */
  boostLimit: number;
}

/** ゆずる前の行と範囲（§6.2、D42）。 */
export interface GiverRecord {
  /** ゆずる前の行。m を変えるたびにここから作り直す。 */
  before: CalcRow;
  /** ゆずる前の使うアメの数（プランナーへ渡す総アメ数と同じもの）。 */
  m0: number;
  /** ゆずる前の実効アメブ。個数指定にする前に明示アメブで固定する。 */
  boost: number;
  /** 今の使うアメの数。常に m0 より小さい。 */
  candy: number;
}

export interface FineTuneState {
  /** 状態が変わるたびに1つ進む。最新の結果がどの下書きのものかを見分ける（§8.4）。 */
  version: number;
  /** 下書きの行一覧（順番を含む、D40）。開いた直後は base.rows。 */
  rows: readonly CalcRow[];
  /** ゆずる側ごとの記録。入っているのは candy < m0 の行だけ（D42）。選択を外しても残る。 */
  givers: Readonly<Record<string, GiverRecord>>;
  /** モード2の受け取る側（D38）。選んでいなければ null。 */
  receiverId: string | null;
}

export type FineTuneOp =
  | { kind: "step"; rowId: string; by: number }
  | { kind: "set"; rowId: string; boost: number }
  | { kind: "targetStep"; rowId: string; by: 1 | -1 }
  | { kind: "move"; rowId: string; toIndex: number }
  | { kind: "receiverSelect"; rowId: string }
  | { kind: "receiverClear" }
  | { kind: "giverStep"; rowId: string; by: number }
  | { kind: "giverSet"; rowId: string; candy: number }
  | { kind: "resetAll" };

/** ストアの関数。ドメインはストアを import しないので引数で受け取る（§10.1）。 */
export interface FineTuneDeps {
  evaluateRows(rowList: readonly CalcRow[]): EvaluatedRows;
  withExplicitBoost(row: CalcRow, n: number, options?: { preserveTargetForExplicitBoost?: boolean }): CalcRow;
  withTargetLevel(row: CalcRow, lv: number, rowList: readonly CalcRow[]): CalcRow;
  withCandyTarget(row: CalcRow, m: number): CalcRow;
}

/**
 * 最新の結果 = 最後に計算が終わった結果と、それを作った下書きの版の組（§8.4）。
 * `version` が今の版と同じなら確定、違えば計算中。
 */
export interface FineTuneLatest {
  version: number;
  result: LevelPlannerResult;
}

/** op を受け付けない理由。op 自身の範囲の外だけ（D37）。 */
export type RejectReason =
  | "unknownRow"
  | "invalidValue"
  /** 目標Lvが現在Lv〜MAX_LEVELの外 */
  | "outOfRange"
  /** 対象外の行（§7）にモード1の操作 */
  | "excluded"
  /** ゆずる側の行（記録のある行）にモード1の操作（D23） */
  | "giverLocked"
  /** 受け取る側がいるのに receiverSelect */
  | "receiverExists"
  /** 受け取る側になれない行 */
  | "notReceivable"
  /** 最新の結果が今の版でない（プレビュー計算中） */
  | "previewPending"
  /** 記録が無く、ゆずる側にもなれない行 */
  | "notGiver";

export type FineTuneReduceResult = { state: FineTuneState } | { rejected: RejectReason };

/** 対象外の行の理由（§7）。表の上から順に判定する。 */
export type RowExclusion = "candyTarget" | "noCandy" | "sleepOnly" | "maxLevel" | "unknownPokemon";

export type OpRangeTarget =
  | { kind: "boost"; rowId: string }
  | { kind: "giver"; rowId: string };

export interface OpRange {
  min: number;
  max: number;
}

/** 空の下書き。版は呼び出し側が決める。 */
export function initialFineTuneState(base: FineTuneBase, version = 0): FineTuneState {
  return { version, rows: base.rows, givers: {}, receiverId: null };
}

function rowIndexOf(rows: readonly CalcRow[], rowId: string): number {
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i]!.id === rowId) return i;
  }
  return -1;
}

function replaceRowAt(rows: readonly CalcRow[], index: number, next: CalcRow): CalcRow[] {
  const copy = rows.slice();
  copy[index] = next;
  return copy;
}

/** 残り枠 = アメブ上限 − 評価した全行の実効アメブの合計（D26）。負になりうる（D37）。 */
export function boostSlotRemaining(base: Pick<FineTuneBase, "boostLimit">, evaluated: EvaluatedRows): number {
  let used = 0;
  for (const item of evaluated.byId.values()) used += item.effectiveBoost;
  return base.boostLimit - used;
}

/**
 * 使うアメの数 m0。プランナーへ渡す総アメ数と同じもの（§6.2）。
 * プランナー入力の行に個数があればそれ、無ければ目標までに要る数。
 */
export function candyUnitsOf(row: CalcRow, evaluated: EvaluatedRows): number {
  const planned = evaluated.plannerInput?.pokemonList.find((p) => p.pokemonId === row.id);
  if (planned?.candyTarget !== undefined) return planned.candyTarget.totalCandyUnits;
  return evaluated.byId.get(row.id)?.candyNeed ?? 0;
}

/**
 * 対象外の行の理由（§7）。操作できる行は null。
 * 評価が要るのは時間の睡眠目標の行（総アメ数が 0 か）だけなので、`evaluated` は関数でも渡せる（入口のボタンの判定で遅らせる）。
 */
export function rowExclusion(row: CalcRow, evaluated: EvaluatedRows | (() => EvaluatedRows)): RowExclusion | null {
  if (row.candyTarget !== undefined) return "candyTarget";
  if (sleepTargetTraits(row).candy === "none") return "noCandy";
  if (row.sleepTargetHours !== undefined && candyUnitsOf(row, typeof evaluated === "function" ? evaluated() : evaluated) === 0) {
    return "sleepOnly";
  }
  if (row.srcLevel >= MAX_LEVEL) return "maxLevel";
  if (row.pokedexId === undefined || !isValidPokedexId(row.pokedexId)) return "unknownPokemon";
  return null;
}

/**
 * 入口のボタンを出すか（§4.1）。操作の対象にできる行（ゆずる側にだけなれる個数指定の行を含む）が1行以上ある。
 * 行一覧の評価は、時間の睡眠目標の行があって初めて必要になるときだけ、1回行う。
 */
export function hasFineTuneTarget(
  rows: readonly CalcRow[],
  evaluate: (rows: readonly CalcRow[]) => EvaluatedRows,
): boolean {
  let evaluated: EvaluatedRows | null = null;
  const lazy = (): EvaluatedRows => (evaluated ??= evaluate(rows));
  return rows.some((row) => {
    const exclusion = rowExclusion(row, lazy);
    return exclusion === null || exclusion === "candyTarget";
  });
}

/** モード1（アメブ・目標Lv）の操作ができる行。対象外の行とゆずる側の行は不可（§7、D23）。 */
export function canAdjustInMode1(state: FineTuneState, evaluated: EvaluatedRows, row: CalcRow): boolean {
  return state.givers[row.id] === undefined && rowExclusion(row, evaluated) === null;
}

/** 受け取る側になれる行（§6.1）。対象外でない行。受け取る側が決まっていないときだけ選べる。 */
export function canReceive(state: FineTuneState, evaluated: EvaluatedRows, row: CalcRow): boolean {
  return state.receiverId === null && state.givers[row.id] === undefined && rowExclusion(row, evaluated) === null;
}

/**
 * ゆずる側として使うアメを初めて減らせる行（§6.1）。受け取る側がいて、下書きの順番で受け取る側より上にあり、
 * 使うアメが1個以上で、睡眠目標モードでない行（個数指定の行はなれる）。記録のある行は含めない。
 */
export function canStartGiving(state: FineTuneState, evaluated: EvaluatedRows, row: CalcRow): boolean {
  if (state.receiverId === null || state.givers[row.id] !== undefined) return false;
  const receiverIndex = rowIndexOf(state.rows, state.receiverId);
  const index = rowIndexOf(state.rows, row.id);
  if (receiverIndex < 0 || index < 0 || index >= receiverIndex) return false;
  if (row.sleepTargetMode !== undefined) return false;
  const exclusion = rowExclusion(row, evaluated);
  if (exclusion !== null && exclusion !== "candyTarget") return false;
  return candyUnitsOf(row, evaluated) >= 1;
}

/** モード2でスライダーと ▲▼ を出す行 = 記録のある行 + 初めて減らせる行（D42）。 */
export function isGiverControlShown(state: FineTuneState, evaluated: EvaluatedRows, row: CalcRow): boolean {
  return state.givers[row.id] !== undefined || canStartGiving(state, evaluated, row);
}

/**
 * 数値の op が動ける範囲（§10.1）。評価は渡された `evaluated`（今の下書きを評価した値）の1回だけで、ほかの行は見ない（D37）。
 * - boost: 0〜min(全アメブ点, 今の値 + max(0, 残り枠))。今の値が全アメブ点を超えているときは増やせない（max = 今の値）。
 * - giver: 0〜m0。記録が無い行は今の評価から出す m0（今の値も m0）。
 * 行が見つからないときは { min: 0, max: 0 }。
 */
export function opRange(
  base: Pick<FineTuneBase, "boostLimit">,
  state: FineTuneState,
  evaluated: EvaluatedRows,
  target: OpRangeTarget,
): OpRange {
  if (target.kind === "giver") {
    const record = state.givers[target.rowId];
    if (record !== undefined) return { min: 0, max: record.m0 };
    const row = state.rows.find((r) => r.id === target.rowId);
    return { min: 0, max: row === undefined ? 0 : candyUnitsOf(row, evaluated) };
  }
  const item = evaluated.byId.get(target.rowId);
  if (item === undefined) return { min: 0, max: 0 };
  const cap = Math.min(item.fullBoost, item.effectiveBoost + Math.max(0, boostSlotRemaining(base, evaluated)));
  return { min: 0, max: Math.max(item.effectiveBoost, cap) };
}

/** 下書きの行が基準と同じか（同じ順番で各行が同じ参照）。受け取る側の選択・ゆずる側の記録は見ない（§10.1）。 */
export function isDraftEmpty(base: Pick<FineTuneBase, "rows">, state: Pick<FineTuneState, "rows">): boolean {
  if (state.rows.length !== base.rows.length) return false;
  return state.rows.every((row, i) => row === base.rows[i]);
}

/** 下書きの中身（rows・givers・receiverId）が同じか。version は見ない。履歴に記録するかの判定に使う（§10.1）。 */
export function isSameDraftContent(a: FineTuneState, b: FineTuneState): boolean {
  if (a.receiverId !== b.receiverId) return false;
  if (a.rows.length !== b.rows.length || !a.rows.every((row, i) => row === b.rows[i])) return false;
  const aKeys = Object.keys(a.givers);
  if (aKeys.length !== Object.keys(b.givers).length) return false;
  return aKeys.every((id) => a.givers[id] === b.givers[id]);
}

/** 数値の op だけに付く、履歴でまとめる相手の目印（§10.1）。 */
export function coalesceKeyOf(op: FineTuneOp): string | undefined {
  switch (op.kind) {
    case "step":
    case "set":
      return `boost:${op.rowId}`;
    case "targetStep":
      return `target:${op.rowId}`;
    case "giverStep":
    case "giverSet":
      return `giver:${op.rowId}`;
    default:
      return undefined;
  }
}

/** 値を `opRange` の範囲に収める（整数に切り捨てる）。reducer と、順位・おすすめ量の n' が同じ止め方をするための口。 */
export function clampToRange(value: number, range: OpRange): number {
  return Math.min(range.max, Math.max(range.min, Math.floor(value)));
}

function advanced(state: FineTuneState, patch: Partial<Omit<FineTuneState, "version">>): { state: FineTuneState } {
  return { state: { ...state, ...patch, version: state.version + 1 } };
}

function planResultOf(result: LevelPlannerResult, rowId: string): PokemonPlanResult | undefined {
  return result.pokemonResults.find((p) => p.pokemonId === rowId);
}

/** 受け取る側 B より上の届かない行を、順番を保ったまま B のすぐ下へ動かした行一覧（D39）。動かさないときは同じ配列。 */
function rowsAfterReceiverSelect(
  rows: readonly CalcRow[],
  receiverIndex: number,
  result: LevelPlannerResult,
): readonly CalcRow[] {
  const receiver = rows[receiverIndex]!;
  const receiverResult = planResultOf(result, receiver.id);
  if (receiverResult === undefined || receiverResult.reachableLine.effectiveTargetReached) return rows;
  const reachedAbove: CalcRow[] = [];
  const unreachedAbove: CalcRow[] = [];
  for (const row of rows.slice(0, receiverIndex)) {
    const planned = planResultOf(result, row.id);
    // 結果に無い行（プランナーに渡らない行）は動かさない
    if (planned !== undefined && !planned.reachableLine.effectiveTargetReached) unreachedAbove.push(row);
    else reachedAbove.push(row);
  }
  if (unreachedAbove.length === 0) return rows;
  return [...reachedAbove, receiver, ...unreachedAbove, ...rows.slice(receiverIndex + 1)];
}

/**
 * 下書きを変える唯一の入口（D21、D37）。ほかの行の都合で拒否しない。数値の op は `opRange` に収め、
 * 値が変わらなければ状態を変えない（同じ state を返す）。通った op は version を1つ進める。
 * `evaluated` は `deps.evaluateRows(state.rows)`、`latest` は最新の結果（§8.4）。
 */
export function reduceFineTune(
  base: FineTuneBase,
  state: FineTuneState,
  op: FineTuneOp,
  deps: FineTuneDeps,
  evaluated: EvaluatedRows,
  latest: FineTuneLatest | null,
): FineTuneReduceResult {
  if (op.kind === "resetAll") {
    return advanced(state, { rows: base.rows, givers: {}, receiverId: null });
  }
  if (op.kind === "receiverClear") {
    if (state.receiverId === null) return { state };
    return advanced(state, { receiverId: null });
  }

  const index = rowIndexOf(state.rows, op.rowId);
  if (index < 0) return { rejected: "unknownRow" };
  const row = state.rows[index]!;

  switch (op.kind) {
    case "step":
    case "set": {
      if (state.givers[row.id] !== undefined) return { rejected: "giverLocked" };
      if (rowExclusion(row, evaluated) !== null) return { rejected: "excluded" };
      const current = evaluated.byId.get(row.id)?.effectiveBoost ?? 0;
      const requested = op.kind === "step" ? current + op.by : op.boost;
      if (!Number.isFinite(requested)) return { rejected: "invalidValue" };
      const next = clampToRange(requested, opRange(base, state, evaluated, { kind: "boost", rowId: row.id }));
      if (next === current) return { state };
      return advanced(state, {
        rows: replaceRowAt(state.rows, index, deps.withExplicitBoost(row, next, { preserveTargetForExplicitBoost: true })),
      });
    }
    case "targetStep": {
      if (state.givers[row.id] !== undefined) return { rejected: "giverLocked" };
      if (rowExclusion(row, evaluated) !== null) return { rejected: "excluded" };
      const lv = row.dstLevel + op.by;
      if (lv < row.srcLevel || lv > MAX_LEVEL) return { rejected: "outOfRange" };
      return advanced(state, { rows: replaceRowAt(state.rows, index, deps.withTargetLevel(row, lv, state.rows)) });
    }
    case "move": {
      if (!Number.isFinite(op.toIndex)) return { rejected: "invalidValue" };
      const toIndex = Math.min(state.rows.length - 1, Math.max(0, Math.floor(op.toIndex)));
      if (toIndex === index) return { state };
      const moved = state.rows.slice();
      moved.splice(index, 1);
      moved.splice(toIndex, 0, row);
      return advanced(state, { rows: moved });
    }
    case "receiverSelect": {
      if (state.receiverId !== null) return { rejected: "receiverExists" };
      if (!canReceive(state, evaluated, row)) return { rejected: "notReceivable" };
      if (latest === null || latest.version !== state.version) return { rejected: "previewPending" };
      return advanced(state, {
        rows: rowsAfterReceiverSelect(state.rows, index, latest.result),
        receiverId: row.id,
      });
    }
    case "giverStep":
    case "giverSet": {
      const record = state.givers[row.id];
      if (record === undefined && !canStartGiving(state, evaluated, row)) return { rejected: "notGiver" };
      const m0 = record?.m0 ?? candyUnitsOf(row, evaluated);
      const current = record?.candy ?? m0;
      const requested = op.kind === "giverStep" ? current + op.by : op.candy;
      if (!Number.isFinite(requested)) return { rejected: "invalidValue" };
      const next = clampToRange(requested, { min: 0, max: m0 });
      if (next === current) return { state };
      if (next === m0) {
        // record があるのは current < m0 のときだけ（next === current で戻っている）
        const { [row.id]: _removed, ...rest } = state.givers;
        return advanced(state, { rows: replaceRowAt(state.rows, index, record!.before), givers: rest });
      }
      const before = record?.before ?? row;
      const boost = record?.boost ?? evaluated.byId.get(row.id)?.effectiveBoost ?? 0;
      const fixed = deps.withExplicitBoost(before, boost, { preserveTargetForExplicitBoost: true });
      return advanced(state, {
        rows: replaceRowAt(state.rows, index, deps.withCandyTarget(fixed, next)),
        givers: { ...state.givers, [row.id]: { before, m0, boost, candy: next } },
      });
    }
  }
}
