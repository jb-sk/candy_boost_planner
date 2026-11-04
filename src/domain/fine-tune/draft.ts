/**
 * シンプルの下書き。
 * 下書きは行一覧そのもの。各 op は今の下書きの行に計算機と同じ関数を当てて、その行だけを差し替える。
 * 動かせるのは目標Lv・アメブ（アメブ目標Lv・最小アメブ・リセットを含む）・アメの数・睡眠目標・順番と、
 * 行の詳細で現在Lv・あとEXP（行の個体）・種族アメの在庫（進化系ごと。下書きの間は `speciesCandy` に持ち、評価のときだけ使う）。
 * 「全体のLvを伸ばす」は、まとめて求めた行一覧を1つの op で入れる。
 * アメの数を変えた行は個数指定の行になるので、目標Lv・アメブは動かせない（元の数に戻すと元の行に戻り、動かせる）。
 * ストア・Vue を import しない。ストアの関数は `FineTuneDeps` で受け取る。
 */
import type { CalcRow, EvaluatedRows, RowIndividualPatch, SpeciesCandyOverride } from "../../composables/useCalcStore";
import { isValidPokedexId } from "../pokesleep/candy-family";
import { maxLevel as MAX_LEVEL } from "../pokesleep/tables";
import { sleepTargetTraits, type SleepTargetMode } from "../sleep-target";
import type { LevelPlannerResult } from "../level-planner/types";

/** 開いた時点の計算機。モーダルの間は変わらない。 */
export interface FineTuneBase {
  /**
   * ストアの rows.value そのもの（差し替えの検出に参照の同一性を使う）。
   * 写しを取らない。書き換えないことは型（readonly）で守る。
   */
  rows: readonly CalcRow[];
  evaluated: EvaluatedRows;
  result: LevelPlannerResult;
  /** スロットのアメブ上限（`boostCandyRemaining`）。残り枠は評価した行から出す。 */
  boostLimit: number;
}

/** アメの数を変える前の行（個数指定でなかった行だけ）。元の数に戻したとき、この行へ戻す。 */
export interface CandyRecord {
  /** 変える前の行。数を変えるたびにここから作り直す。 */
  before: CalcRow;
  /** 変える前の使うアメの数（プランナーへ渡す総アメ数と同じもの）。この数にすると記録が消える。 */
  m0: number;
  /** 変える前の実効アメブ。個数指定にする前に明示アメブで固定する。 */
  boost: number;
  /** 今のアメの数。m0 と違う。 */
  candy: number;
}

export interface FineTuneState {
  /** 状態が変わるたびに1つ進む。最新の結果がどの下書きのものかを見分ける。 */
  version: number;
  /** 下書きの行一覧（順番を含む）。開いた直後は base.rows。 */
  rows: readonly CalcRow[];
  /** アメの数を変えた行の記録（個数指定でなかった行だけ）。 */
  candyRecords: Readonly<Record<string, CandyRecord>>;
  /** 変えた種族アメの在庫（進化系のキー → 個数）。開いた時点の在庫と同じ数にすると消える。 */
  speciesCandy: SpeciesCandyOverride;
}

/** 種族アメの在庫の上限（テンキーで打てる7桁） */
export const SPECIES_CANDY_MAX = 9_999_999;

export type FineTuneOp =
  | { kind: "step"; rowId: string; by: number }
  | { kind: "set"; rowId: string; boost: number }
  /** アメブ目標Lv（計算機のアメブ目標Lvピッカーと同じ。個数は自動へ戻し、そのLvまでをアメブで賄う） */
  | { kind: "boostLevelSet"; rowId: string; level: number }
  | { kind: "targetStep"; rowId: string; by: number }
  | { kind: "targetSet"; rowId: string; level: number }
  | { kind: "move"; rowId: string; toIndex: number }
  | { kind: "candyStep"; rowId: string; by: number }
  | { kind: "candySet"; rowId: string; candy: number }
  /** 睡眠目標（計算機と同じ値: 時間・モード・未設定は undefined） */
  | { kind: "sleepSet"; rowId: string; target: number | SleepTargetMode | undefined }
  /** 行単位の最小アメブ（手持ちのアメから最小限のアメブを自動で決める） */
  | { kind: "boostMinimize"; rowId: string; on: boolean }
  /** アメブ個数をリセット（自動の値へ戻し、残枠から配り直す） */
  | { kind: "boostReset"; rowId: string }
  /** 行の詳細: 現在Lv（あとEXPは「次Lvまで全部」へ戻る）・あとEXP（行の個体） */
  | { kind: "srcLevelSet"; rowId: string; level: number }
  | { kind: "expRemainingSet"; rowId: string; exp: number }
  /** 行の詳細: その行の進化系の種族アメの在庫 */
  | { kind: "stockSet"; rowId: string; count: number }
  /**
   * 調整バーのリセット。その行（とアメの数の記録・その行の進化系の在庫）を、調整バーで編集を始める前の値へ戻す。
   * ほかの行・順番は戻さない。`stock` はその行の進化系の在庫の、編集を始める前の下書きの値（変えていなければ undefined）。
   */
  | { kind: "revertRow"; rowId: string; row: CalcRow; candyRecord: CandyRecord | undefined; stock?: { familyKey: string; count: number | undefined } }
  /**
   * 「全体のLvを伸ばす」で求めた行一覧を入れる。`fromVersion` の下書きから求めたもので、
   * その後に下書きが変わっていれば入れない。行の顔ぶれと順番は変えられない（アメブだけを変えた行一覧）。
   */
  | { kind: "raise"; rows: readonly CalcRow[]; fromVersion: number };

/** ストアの関数。ドメインはストアを import しないので引数で受け取る。 */
export interface FineTuneDeps {
  /** `speciesCandy` は下書きで変えた種族アメの在庫（`FineTuneState.speciesCandy`） */
  evaluateRows(rowList: readonly CalcRow[], speciesCandy?: SpeciesCandyOverride): EvaluatedRows;
  /** 計算機の現在Lv・あとEXPの欄で入れたときと同じ行一覧（変わらなければ同じ配列） */
  withRowIndividual(rowList: readonly CalcRow[], rowId: string, patch: RowIndividualPatch): readonly CalcRow[];
  /** 行の個体（現在Lv・あとEXP）を変えられるか（リンク切れの行は不可） */
  canEditIndividual(row: CalcRow): boolean;
  /** 行の種族アメの進化系のキー（種族不明の行は undefined） */
  speciesCandyFamilyOf(row: CalcRow): string | undefined;
  /** 進化系の種族アメの在庫（開いた時点の、ストアの値） */
  speciesCandyStockOf(familyKey: string): number;
  withExplicitBoost(row: CalcRow, n: number, options?: { preserveTargetForExplicitBoost?: boolean }): CalcRow;
  /** アメブ目標Lvピッカーで lv を選んだときと同じ行（上限・睡眠での無効化は reducer が `evaluateRows` の値で見る） */
  withBoostReachLevel(row: CalcRow, lv: number): CalcRow;
  withTargetLevel(row: CalcRow, lv: number, rowList: readonly CalcRow[]): CalcRow;
  withCandyTarget(row: CalcRow, m: number): CalcRow;
  /** 個数指定の上限（計算機と同じ。`withCandyTarget` もこの数で抑える） */
  maxCandyTargetFor(row: CalcRow): number;
  withSleepTarget(row: CalcRow, target: number | SleepTargetMode | undefined): CalcRow;
  withMinimizeBoost(row: CalcRow, on: boolean): CalcRow;
  canMinimizeBoostFor(row: CalcRow): boolean;
  withBoostCandyReset(row: CalcRow, rowList: readonly CalcRow[]): CalcRow;
}

/**
 * 最新の結果 = 最後に計算が終わった結果と、それを作った下書きの版の組。
 * `version` が今の版と同じなら確定、違えば計算中。
 */
export interface FineTuneLatest {
  version: number;
  result: LevelPlannerResult;
}

/** op を受け付けない理由。数値は範囲に収めるので、範囲の外は理由にならない。 */
export type RejectReason =
  | "unknownRow"
  | "invalidValue"
  /** 対象外の行に目標Lv・アメブの操作（睡眠だけで届く行は目標Lvを動かせる。`canAdjustTarget`） */
  | "excluded"
  /** 睡眠EXPだけで目標に届き、アメブを使えない行のアメブ目標Lv（計算機でもピッカーを無効にしている） */
  | "boostLevelLocked"
  /** アメの数を変えられない行（睡眠目標モード・Lv上限・ポケモンが不明・アメを使わない行） */
  | "candyLocked"
  /** 最小アメブにできない行（全体の設定で最小化している・在庫の種族が無い・アメが足りず届かない） */
  | "minimizeUnavailable"
  /** 個体を変えられない行（リンク切れ）の現在Lv・あとEXP、種族不明の行の在庫 */
  | "individualLocked"
  /** 「全体のLvを伸ばす」を求めている間に下書きが変わった */
  | "stale";

export type FineTuneReduceResult = { state: FineTuneState } | { rejected: RejectReason };

/** 目標Lv・アメブを動かせない行の理由。上から順に判定する。 */
export type RowExclusion = "candyTarget" | "noCandy" | "sleepOnly" | "maxLevel" | "unknownPokemon";

export type OpRangeTarget =
  | { kind: "boost"; rowId: string }
  | { kind: "boostLevel"; rowId: string }
  | { kind: "target"; rowId: string }
  | { kind: "candy"; rowId: string };

export interface OpRange {
  min: number;
  max: number;
}

/** 空の下書き。版は呼び出し側が決める。 */
export function initialFineTuneState(base: FineTuneBase, version = 0): FineTuneState {
  return { version, rows: base.rows, candyRecords: {}, speciesCandy: {} };
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

/** 残り枠 = アメブ上限 − 評価した全行の実効アメブの合計。負になりうる（ほかの行の都合で op を拒否しない）。 */
export function boostSlotRemaining(base: Pick<FineTuneBase, "boostLimit">, evaluated: EvaluatedRows): number {
  let used = 0;
  for (const item of evaluated.byId.values()) used += item.effectiveBoost;
  return base.boostLimit - used;
}

/**
 * 使うアメの数。プランナーへ渡す総アメ数と同じもの。
 * プランナー入力の行に個数があればそれ、無ければ目標までに要る数。
 */
export function candyUnitsOf(row: CalcRow, evaluated: EvaluatedRows): number {
  const planned = evaluated.plannerInput?.pokemonList.find((p) => p.pokemonId === row.id);
  if (planned?.candyTarget !== undefined) return planned.candyTarget.totalCandyUnits;
  return evaluated.byId.get(row.id)?.candyNeed ?? 0;
}

/** 目標Lv・アメブを動かせない理由。動かせる行は null。 */
export function rowExclusion(row: CalcRow, evaluated: EvaluatedRows): RowExclusion | null {
  if (row.candyTarget !== undefined) return "candyTarget";
  if (sleepTargetTraits(row).candy === "none") return "noCandy";
  if (row.sleepTargetHours !== undefined && candyUnitsOf(row, evaluated) === 0) return "sleepOnly";
  return levelExclusion(row);
}

/** Lv上限・ポケモンが不明（目標Lvも動かせない理由のうち、評価に頼らないもの） */
function levelExclusion(row: CalcRow): "maxLevel" | "unknownPokemon" | null {
  if (row.srcLevel >= MAX_LEVEL) return "maxLevel";
  if (row.pokedexId === undefined || !isValidPokedexId(row.pokedexId)) return "unknownPokemon";
  return null;
}

/**
 * 目標Lvを動かせる行。アメブを動かせる行（`canAdjustLevel`）と、睡眠だけで届く行（`sleepOnly`）。
 * 睡眠だけで届くかは目標Lvで決まるので、そこで目標Lvを止めない（計算機と同じく、睡眠で届くLvより下げても、上げ直してもよい。
 * 上げてアメが要るようになれば、アメブも動かせる）。評価に頼らない。
 */
export function canAdjustTarget(row: CalcRow): boolean {
  return row.candyTarget === undefined && sleepTargetTraits(row).candy !== "none" && levelExclusion(row) === null;
}

/**
 * 入口のボタンを出すか。目標Lvを動かせる行が1行以上ある（アメブを動かせる行は目標Lvも動かせる）。評価しない。
 */
export function hasFineTuneTarget(rows: readonly CalcRow[]): boolean {
  return rows.some((row) => canAdjustTarget(row));
}

/** 目標Lv・アメブを動かせる行。対象外の行（アメの数を変えた行は個数指定の行）は不可。 */
export function canAdjustLevel(evaluated: EvaluatedRows, row: CalcRow): boolean {
  return rowExclusion(row, evaluated) === null;
}

/**
 * アメの数を変えられる行。対象外でない行と、個数指定の行（アメの数を変えた行を含む）。
 * 睡眠目標モードの行は計算機でも個数指定にできないので不可。
 */
export function canAdjustCandy(evaluated: EvaluatedRows, row: CalcRow): boolean {
  if (row.sleepTargetMode !== undefined) return false;
  const exclusion = rowExclusion(row, evaluated);
  return exclusion === null || exclusion === "candyTarget";
}

/** 最新の結果でその行が使えたアメの数。結果が無い・行が無ければ null。 */
function candyUsedOf(latest: FineTuneLatest | null, rowId: string): number | null {
  const planned = latest?.result.pokemonResults.find((p) => p.pokemonId === rowId);
  return planned === undefined ? null : planned.reachableLine.totalCandyUnitsUsed;
}

/**
 * アメの数の今の値。記録のある行は記録の値、もとから個数指定の行はその数（プランナーへ渡す数）、
 * ほかは最新の結果で使えた数（目標までに要る数を超えない）。足りずに要る数まで使えていない行でも、表に出ている数から動かし始める。
 */
export function candyValueOf(
  state: FineTuneState,
  evaluated: EvaluatedRows,
  latest: FineTuneLatest | null,
  row: CalcRow,
): number {
  const record = state.candyRecords[row.id];
  if (record !== undefined) return record.candy;
  const m0 = candyUnitsOf(row, evaluated);
  if (row.candyTarget !== undefined) return m0;
  const used = candyUsedOf(latest, row.id);
  return used === null ? m0 : Math.min(m0, used);
}

/**
 * 数値の op が動ける範囲。評価は渡された `evaluated`（今の下書きを評価した値）の1回だけで、ほかの行は見ない。
 * - boost: 0〜min(全アメブ点, 今の値 + max(0, 残り枠))。今の値が全アメブ点を超えているときは増やせない（max = 今の値）。
 * - boostLevel: 現在Lv〜アメブ目標Lvの上限（計算機のピッカーと同じ `boostReachLevelMax`）。行の実効アメブと同じく、残り枠では抑えない。
 * - target: 現在Lv〜MAX_LEVEL。
 * - candy: 0〜個数指定の上限（計算機と同じ。Lv70 に届く数）。記録のある行は、変える前の行（アメブを固定した行）で求める。
 * 行が見つからないときは { min: 0, max: 0 }。
 */
export function opRange(
  base: Pick<FineTuneBase, "boostLimit">,
  state: FineTuneState,
  evaluated: EvaluatedRows,
  target: OpRangeTarget,
  deps?: Pick<FineTuneDeps, "maxCandyTargetFor" | "withExplicitBoost">,
): OpRange {
  if (target.kind === "candy") {
    const row = state.rows.find((r) => r.id === target.rowId);
    if (row === undefined || deps === undefined) return { min: 0, max: 0 };
    return { min: 0, max: Math.max(0, deps.maxCandyTargetFor(candyBaseRow(state, evaluated, row, deps))) };
  }
  if (target.kind === "target") {
    const row = state.rows.find((r) => r.id === target.rowId);
    return row === undefined ? { min: 0, max: 0 } : { min: row.srcLevel, max: MAX_LEVEL };
  }
  if (target.kind === "boostLevel") {
    const row = state.rows.find((r) => r.id === target.rowId);
    const item = evaluated.byId.get(target.rowId);
    if (row === undefined || item === undefined) return { min: 0, max: 0 };
    return { min: row.srcLevel, max: Math.max(row.srcLevel, item.boostReachLevelMax) };
  }
  const item = evaluated.byId.get(target.rowId);
  if (item === undefined) return { min: 0, max: 0 };
  const cap = Math.min(item.fullBoost, item.effectiveBoost + Math.max(0, boostSlotRemaining(base, evaluated)));
  return { min: 0, max: Math.max(item.effectiveBoost, cap) };
}

/**
 * アメの数を入れる元の行。もとから個数指定の行はその行、ほかは変える前の行の実効アメブを明示アメブで固定した行
 * （アメブを固定しないと、個数を変えるたびにアメブの読み方が変わる）。
 */
function candyBaseRow(
  state: FineTuneState,
  evaluated: EvaluatedRows,
  row: CalcRow,
  deps: Pick<FineTuneDeps, "withExplicitBoost">,
): CalcRow {
  const record = state.candyRecords[row.id];
  if (record === undefined && row.candyTarget !== undefined) return row;
  const before = record?.before ?? row;
  const boost = record?.boost ?? evaluated.byId.get(row.id)?.effectiveBoost ?? 0;
  return deps.withExplicitBoost(before, boost, { preserveTargetForExplicitBoost: true });
}

/** 下書きが基準と同じか（同じ順番で各行が同じ参照で、在庫を変えていない）。 */
export function isDraftEmpty(base: Pick<FineTuneBase, "rows">, state: Pick<FineTuneState, "rows" | "speciesCandy">): boolean {
  return isSameRows(base.rows, state.rows) && Object.keys(state.speciesCandy).length === 0;
}

/** 下書きでのその進化系の種族アメの在庫（変えていなければストアの値） */
export function speciesCandyValueOf(
  state: Pick<FineTuneState, "speciesCandy">,
  familyKey: string,
  deps: Pick<FineTuneDeps, "speciesCandyStockOf">,
): number {
  return state.speciesCandy[familyKey] ?? deps.speciesCandyStockOf(familyKey);
}

function withSpeciesCandy(
  current: SpeciesCandyOverride,
  familyKey: string,
  count: number | undefined,
): SpeciesCandyOverride {
  const { [familyKey]: _removed, ...rest } = current;
  return count === undefined ? rest : { ...rest, [familyKey]: count };
}

function isSameRows(a: readonly CalcRow[], b: readonly CalcRow[]): boolean {
  return a.length === b.length && a.every((row, i) => row === b[i]);
}

/** 下書きの中身（rows・candyRecords・speciesCandy）が同じか。version は見ない。履歴に記録するかの判定に使う。 */
export function isSameDraftContent(a: FineTuneState, b: FineTuneState): boolean {
  if (!isSameRows(a.rows, b.rows)) return false;
  const aStock = Object.keys(a.speciesCandy);
  if (aStock.length !== Object.keys(b.speciesCandy).length || aStock.some((k) => a.speciesCandy[k] !== b.speciesCandy[k])) return false;
  const aKeys = Object.keys(a.candyRecords);
  if (aKeys.length !== Object.keys(b.candyRecords).length) return false;
  return aKeys.every((id) => a.candyRecords[id] === b.candyRecords[id]);
}

/** 数値の op だけに付く、履歴でまとめる相手の目印。 */
export function coalesceKeyOf(op: FineTuneOp): string | undefined {
  switch (op.kind) {
    case "step":
    case "set":
      return `boost:${op.rowId}`;
    case "boostLevelSet":
      return `boostLevel:${op.rowId}`;
    case "targetStep":
    case "targetSet":
      return `target:${op.rowId}`;
    case "candyStep":
    case "candySet":
      return `candy:${op.rowId}`;
    case "srcLevelSet":
      return `srcLevel:${op.rowId}`;
    case "expRemainingSet":
      return `exp:${op.rowId}`;
    case "stockSet":
      return `stock:${op.rowId}`;
    default:
      return undefined;
  }
}

/** 値を `opRange` の範囲に収める（整数に切り捨てる）。reducer と、おすすめ量が同じ止め方をするための口。 */
export function clampToRange(value: number, range: OpRange): number {
  return Math.min(range.max, Math.max(range.min, Math.floor(value)));
}

function advanced(state: FineTuneState, patch: Partial<Omit<FineTuneState, "version">>): { state: FineTuneState } {
  return { state: { ...state, ...patch, version: state.version + 1 } };
}

/**
 * 下書きを変える唯一の入口。ほかの行の都合で拒否しない。数値の op は `opRange` に収め、
 * 値が変わらなければ状態を変えない（同じ state を返す）。通った op は version を1つ進める。
 * `evaluated` は `deps.evaluateRows(state.rows)`、`latest` は最新の結果（アメの数の今の値に使う。計算中なら古い版のもの）。
 */
export function reduceFineTune(
  base: FineTuneBase,
  state: FineTuneState,
  op: FineTuneOp,
  deps: FineTuneDeps,
  evaluated: EvaluatedRows,
  latest: FineTuneLatest | null = null,
): FineTuneReduceResult {
  if (op.kind === "raise") {
    if (op.fromVersion !== state.version) return { rejected: "stale" };
    if (op.rows.length !== state.rows.length || op.rows.some((row, i) => row.id !== state.rows[i]!.id)) {
      return { rejected: "invalidValue" };
    }
    if (isSameRows(op.rows, state.rows)) return { state };
    return advanced(state, { rows: op.rows });
  }

  const index = rowIndexOf(state.rows, op.rowId);
  if (index < 0) return { rejected: "unknownRow" };
  const row = state.rows[index]!;

  switch (op.kind) {
    case "step":
    case "set": {
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
    case "boostLevelSet": {
      if (rowExclusion(row, evaluated) !== null) return { rejected: "excluded" };
      const item = evaluated.byId.get(row.id);
      if (item === undefined || item.boostInputDisabled) return { rejected: "boostLevelLocked" };
      if (!Number.isFinite(op.level)) return { rejected: "invalidValue" };
      const lv = clampToRange(op.level, opRange(base, state, evaluated, { kind: "boostLevel", rowId: row.id }));
      // 今のアメブ目標Lvと同じなら変えない（個数を手で入れた行も、そのLvを選び直しただけでは自動に戻さない）
      if (lv === item.boostReachLevel) return { state };
      const next = deps.withBoostReachLevel(row, lv);
      if (next === row) return { state };
      return advanced(state, { rows: replaceRowAt(state.rows, index, next) });
    }
    case "targetStep":
    case "targetSet": {
      if (!canAdjustTarget(row)) return { rejected: "excluded" };
      const requested = op.kind === "targetStep" ? row.dstLevel + op.by : op.level;
      if (!Number.isFinite(requested)) return { rejected: "invalidValue" };
      const lv = clampToRange(requested, opRange(base, state, evaluated, { kind: "target", rowId: row.id }));
      if (lv === row.dstLevel) return { state };
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
    case "candyStep":
    case "candySet": {
      if (!canAdjustCandy(evaluated, row)) return { rejected: "candyLocked" };
      const record = state.candyRecords[row.id];
      const current = candyValueOf(state, evaluated, latest, row);
      const requested = op.kind === "candyStep" ? current + op.by : op.candy;
      if (!Number.isFinite(requested)) return { rejected: "invalidValue" };
      const next = clampToRange(requested, opRange(base, state, evaluated, { kind: "candy", rowId: row.id }, deps));
      if (next === current) return { state };
      // もとから個数指定の行は、その行の数を変えるだけ（記録は持たない）
      if (record === undefined && row.candyTarget !== undefined) {
        return advanced(state, { rows: replaceRowAt(state.rows, index, deps.withCandyTarget(row, next)) });
      }
      const m0 = record?.m0 ?? candyUnitsOf(row, evaluated);
      if (next === m0) {
        // 変える前の数に戻したら、変える前の行へ戻す。記録が無い（使えた数が要る数より少ない行で、要る数まで増やした）なら変えない
        if (record === undefined) return { state };
        const { [row.id]: _removed, ...rest } = state.candyRecords;
        return advanced(state, { rows: replaceRowAt(state.rows, index, record.before), candyRecords: rest });
      }
      const before = record?.before ?? row;
      const boost = record?.boost ?? evaluated.byId.get(row.id)?.effectiveBoost ?? 0;
      const fixed = deps.withExplicitBoost(before, boost, { preserveTargetForExplicitBoost: true });
      return advanced(state, {
        rows: replaceRowAt(state.rows, index, deps.withCandyTarget(fixed, next)),
        candyRecords: { ...state.candyRecords, [row.id]: { before, m0, boost, candy: next } },
      });
    }
    case "sleepSet": {
      if (row.sleepTargetMode === (typeof op.target === "string" ? op.target : undefined)
        && row.sleepTargetHours === (typeof op.target === "number" ? op.target : undefined)) return { state };
      const next = deps.withSleepTarget(row, op.target);
      // 睡眠目標を入れると個数指定は外れる（計算機と同じ）。アメの数の記録も外す（元の数へ戻す先が無くなる）
      const { [row.id]: dropped, ...rest } = state.candyRecords;
      const candyRecords = dropped !== undefined && next.candyTarget === undefined ? rest : state.candyRecords;
      return advanced(state, { rows: replaceRowAt(state.rows, index, next), candyRecords });
    }
    case "boostMinimize": {
      if (rowExclusion(row, evaluated) !== null) return { rejected: "excluded" };
      if (op.on && !deps.canMinimizeBoostFor(row)) return { rejected: "minimizeUnavailable" };
      // アメが足りず、最小アメブにしても目標に届かない行は入れられない（入れても既定のアメブへ戻るだけ）
      if (op.on && row.boostMinimizeRow !== true && evaluated.byId.get(row.id)?.minimizeShortCandy === true) {
        return { rejected: "minimizeUnavailable" };
      }
      // 最小化が効いている（スイッチが入っていて、個数を手で入れていない）なら、入れても変わらない
      if (op.on && row.boostMinimizeRow === true && row.boostOrExpAdjustment === undefined) return { state };
      const next = deps.withMinimizeBoost(row, op.on);
      if (next === row) return { state };
      return advanced(state, { rows: replaceRowAt(state.rows, index, next) });
    }
    case "revertRow": {
      if (op.row.id !== row.id) return { rejected: "invalidValue" };
      const sameRecord = state.candyRecords[row.id] === op.candyRecord;
      const sameStock = op.stock === undefined || state.speciesCandy[op.stock.familyKey] === op.stock.count;
      if (row === op.row && sameRecord && sameStock) return { state };
      const { [row.id]: _current, ...rest } = state.candyRecords;
      return advanced(state, {
        rows: replaceRowAt(state.rows, index, op.row),
        candyRecords: op.candyRecord === undefined ? rest : { ...rest, [row.id]: op.candyRecord },
        speciesCandy: op.stock === undefined ? state.speciesCandy : withSpeciesCandy(state.speciesCandy, op.stock.familyKey, op.stock.count),
      });
    }
    case "srcLevelSet":
    case "expRemainingSet": {
      if (!deps.canEditIndividual(row)) return { rejected: "individualLocked" };
      const requested = op.kind === "srcLevelSet" ? op.level : op.exp;
      if (!Number.isFinite(requested)) return { rejected: "invalidValue" };
      const patch = op.kind === "srcLevelSet" ? { level: requested } : { expRemaining: requested };
      const rows = deps.withRowIndividual(state.rows, row.id, patch);
      if (rows === state.rows) return { state };
      // 現在Lvを変えると個数指定が外れる（計算機と同じ）。アメの数の記録も外す。
      // あとEXPだけなら個数指定は残るので、記録の「変える前の行」にも同じ変更を当てる（元の数に戻したとき、変えたあとEXPのまま戻る）
      const record = state.candyRecords[row.id];
      const { [row.id]: _dropped, ...rest } = state.candyRecords;
      let candyRecords = state.candyRecords;
      if (record !== undefined) {
        const updated = rows[index]!;
        if (op.kind === "srcLevelSet" || updated.candyTarget === undefined) {
          candyRecords = rest;
        } else {
          const before = deps.withRowIndividual(replaceRowAt(state.rows, index, record.before), row.id, patch)[index]!;
          candyRecords = { ...rest, [row.id]: { ...record, before } };
        }
      }
      return advanced(state, { rows, candyRecords });
    }
    case "stockSet": {
      const familyKey = deps.speciesCandyFamilyOf(row);
      if (familyKey === undefined) return { rejected: "individualLocked" };
      if (!Number.isFinite(op.count)) return { rejected: "invalidValue" };
      const count = clampToRange(op.count, { min: 0, max: SPECIES_CANDY_MAX });
      if (count === speciesCandyValueOf(state, familyKey, deps)) return { state };
      // 開いた時点の在庫と同じ数にしたら、変えていない扱いに戻す
      const next = count === deps.speciesCandyStockOf(familyKey) ? undefined : count;
      return advanced(state, { speciesCandy: withSpeciesCandy(state.speciesCandy, familyKey, next) });
    }
    case "boostReset": {
      if (rowExclusion(row, evaluated) !== null) return { rejected: "excluded" };
      // 個数を手で入れていない（自動の値）なら、戻すものが無い
      if (row.boostOrExpAdjustment === undefined) return { state };
      return advanced(state, { rows: replaceRowAt(state.rows, index, deps.withBoostCandyReset(row, state.rows)) });
    }
  }
}
