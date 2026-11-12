/**
 * シンプルの下書き。
 * 下書きは行一覧そのもの。各 op は今の下書きの行に計算機と同じ関数を当てて、その行だけを差し替える。
 * 動かせるのは目標Lv・アメブ（アメブ目標Lv・最小限のアメブ・再割当を含む）・アメの数・睡眠目標・順番と、
 * 行の詳細で現在Lv・あとEXP・ニックネーム（行の個体。ニックネームは `nicknames` に持ち、行の表示名も変える）・
 * 種族アメの在庫（進化系ごと。下書きの間は `speciesCandy` に持ち、評価のときだけ使う）と、計算機からの削除。
 * 「全体のLvを伸ばす」は、まとめて求めた行一覧を1つの op で入れる。
 * 何も選んでいないときの設定欄で、全体の設定（最小限のアメブ・既定のアメブ目標Lv）とかけら・万能アメの在庫も動かせる
 * （下書きの間は `settings` に持ち、評価のときだけ使う。既定のアメブ目標Lvは、自動の行をすぐ新しい既定で配り直す）。
 * アメの数を変えた行は個数指定の行になる（元の数に戻すと元の行に戻る）。個数指定の行も、計算機と同じくアメブを別に動かせる
 * （アメブはアメの数の内訳。アメブを動かすとアメの数の記録は外れ、元の数に戻しても元の行には戻らない）。
 * 目標Lvは計算機と同じく個数指定を上書きする（選ぶと個数指定とアメの数の記録が外れる）。
 * 行の詳細で、「全体のLvを伸ばす」にアメブを動かさせない行（固定、`boostLocks`）を選べる。固定はシンプルを開いている間だけで、
 * 計算機へは書かない（適用するものが無いので、固定だけを変えた下書きは空のまま）。手ではこれまでどおり動かせる。
 * ストア・Vue を import しない。ストアの関数は `FineTuneDeps` で受け取る。
 */
import type {
  CalcRow,
  CalcSettingsOverride,
  CalcSettingsSnapshot,
  EvaluatedRows,
  RowIndividualPatch,
  SpeciesCandyOverride,
} from "../../composables/useCalcStore";
import { normalizeDefaultBoostReachLevel } from "../pokesleep/boost-config";
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
  /** 開いた時点の設定（設定欄で動かすもの: 最小限のアメブ・既定のアメブ目標Lv・かけら在庫・万能アメ在庫） */
  settings: CalcSettingsSnapshot;
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
  /** 変えた設定（開いた時点と違うものだけ）。開いた時点と同じ値にすると消える。 */
  settings: CalcSettingsOverride;
  /**
   * 変えたニックネーム（行の ID → ボックスの個体の生の名前。空なら種族名の表示）。開いた時点の名前と同じにすると消える。
   * 行の title（表示名）は op のときに下書きの行へ入れ、適用でこの名前を個体へ書く
   */
  nicknames: Readonly<Record<string, string>>;
  /** 「全体のLvを伸ばす」にアメブを動かさせない行（行の ID）。シンプルを開いている間だけで、適用しない */
  boostLocks: BoostLocks;
}

/** アメブを固定した行（行の ID → true） */
export type BoostLocks = Readonly<Record<string, true>>;

/** 種族アメの在庫の上限（テンキーで打てる7桁） */
export const SPECIES_CANDY_MAX = 9_999_999;
/** 万能アメの在庫の上限（種族アメと同じ7桁） */
export const UNIVERSAL_CANDY_MAX = 9_999_999;
/** かけら在庫の上限（計算機の設定と同じ9桁） */
export const SHARDS_MAX = 999_999_999;

export type UniversalCandySize = "s" | "m" | "l";

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
  /** 行単位の最小限のアメブ（手持ちのアメから最小限のアメブを自動で決める） */
  | { kind: "boostMinimize"; rowId: string; on: boolean }
  /** アメブの再割当（手で入れた個数を自動の値へ戻し、残枠から配り直す。計算機の行の ↺ と同じ） */
  | { kind: "boostReset"; rowId: string }
  /** 行の詳細: 現在Lv（あとEXPは「次Lvまで全部」へ戻る）・あとEXP（行の個体） */
  | { kind: "srcLevelSet"; rowId: string; level: number }
  | { kind: "expRemainingSet"; rowId: string; exp: number }
  /** 行の詳細: その行の進化系の種族アメの在庫 */
  | { kind: "stockSet"; rowId: string; count: number }
  /** 行の詳細: ニックネーム（ボックスの個体の名前。空にすると種族名の表示に戻る） */
  | { kind: "nicknameSet"; rowId: string; nickname: string }
  /** 行の詳細: 計算機から削除（適用で計算機の行から外す。ボックスの個体は消さない） */
  | { kind: "removeRow"; rowId: string }
  /** 行の詳細: 「全体のLvを伸ばす」にアメブを動かさせない（固定）。開いている間だけ */
  | { kind: "boostLockSet"; rowId: string; on: boolean }
  /**
   * 調整バーのリセット。その行（とアメの数の記録・その行の進化系の在庫）を、調整バーで編集を始める前の値へ戻す。
   * ほかの行・順番は戻さない。`stock` はその行の進化系の在庫の、編集を始める前の下書きの値（変えていなければ undefined）。
   */
  | { kind: "revertRow"; rowId: string; row: CalcRow; candyRecord: CandyRecord | undefined; stock?: { familyKey: string; count: number | undefined } }
  /**
   * 「全体のLvを伸ばす」で求めた行一覧を入れる。`fromVersion` の下書きから求めたもので、
   * その後に下書きが変わっていれば入れない。行の顔ぶれと順番は変えられない（アメブだけを変えた行一覧）。
   */
  | { kind: "raise"; rows: readonly CalcRow[]; fromVersion: number }
  | FineTuneSettingsOp;

/** 設定欄の op（行に結びつかない） */
export type FineTuneSettingsOp =
  /** 全体の最小限のアメブ（計算機の設定「目標Lvに届く最小限のアメブ個数にする」） */
  | { kind: "minimizeBoostSet"; on: boolean }
  /** 既定のアメブ目標Lv（null は目標Lvと同じ）。自動の行は、すぐ新しい既定で配り直す */
  | { kind: "defaultBoostLevelSet"; level: number | null }
  /** かけら在庫 */
  | { kind: "shardsSet"; count: number }
  /** 万能アメの在庫 */
  | { kind: "universalCandySet"; size: UniversalCandySize; count: number }
  /** 設定を開いた時点へ戻す（既定のアメブ目標Lvで配り直した自動の行も、開いた時点の既定で配り直す） */
  | { kind: "settingsReset" };

const SETTINGS_OP_KINDS: ReadonlySet<FineTuneOp["kind"]> = new Set([
  "minimizeBoostSet",
  "defaultBoostLevelSet",
  "shardsSet",
  "universalCandySet",
  "settingsReset",
]);

function isSettingsOp(op: FineTuneOp): op is FineTuneSettingsOp {
  return SETTINGS_OP_KINDS.has(op.kind);
}

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
  /** 行の個体のニックネーム（ストアの生の名前。空なら種族名の表示）。リンク切れの行は undefined */
  nicknameOf(row: CalcRow): string | undefined;
  /** ニックネームを nickname にしたときの行の表示名（計算機の行の title と同じ作り方。空なら種族名） */
  titleForNickname(row: CalcRow, nickname: string): string;
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
  /**
   * 既定のアメブ目標Lvを `level` にしたとき、自動の行（アメブ個数も目標Lvも選んでいない行）を上から「再割当」と同じ手順で
   * 配り直した行一覧（変わらない行は同じ参照）。`settings` はその間に使うほかの設定（省略時は今の下書きの設定）。
   */
  withDefaultBoostReachLevelRows(rowList: readonly CalcRow[], level: number | null, settings?: CalcSettingsOverride): readonly CalcRow[];
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
  /** 対象外の行にアメブの操作、LvMax の行に目標Lvの操作（目標Lvは `canAdjustTarget`） */
  | "excluded"
  /** 睡眠EXPだけで目標に届き、アメブを使えない行のアメブ目標Lv（計算機でもピッカーを無効にしている） */
  | "boostLevelLocked"
  /** アメの数を変えられない行（睡眠目標モード・Lv上限・ポケモンが不明・アメを使わない行） */
  | "candyLocked"
  /**
   * 最小限のアメブにできない行（全体の設定で最小化している・個数指定・睡眠目標モード・在庫の種族が無い。計算機の `canMinimizeBoostFor`）。
   * アメが足りなくても入れられる（計算機と同じ。届かない行は既定のアメブ目標Lvを使い、画面で知らせる）
   */
  | "minimizeUnavailable"
  /** 個体を変えられない行（リンク切れ）の現在Lv・あとEXP、種族不明の行の在庫 */
  | "individualLocked"
  /** 「全体のLvを伸ばす」を求めている間に下書きが変わった */
  | "stale"
  /** 最後の1匹の計算機からの削除（行が無いとプレビューを計算できない） */
  | "lastRow";

export type FineTuneReduceResult = { state: FineTuneState } | { rejected: RejectReason };

/**
 * アメブを動かせない行の理由。上から順に判定する（目標Lvは LvMax のほか動かせる。`canAdjustTarget`）。
 * 個数指定の行は対象外にしない（計算機と同じく、アメの数とアメブを別々に決められる）
 */
export type RowExclusion = "noCandy" | "sleepOnly" | "maxLevel" | "unknownPokemon";

/** 数値の op が動ける範囲（`boostRange` / `boostLevelRange` / `targetRange` / `candyRange`） */
export interface OpRange {
  min: number;
  max: number;
}

/** 空の下書き。版は呼び出し側が決める。 */
export function initialFineTuneState(base: FineTuneBase, version = 0): FineTuneState {
  return { version, rows: base.rows, candyRecords: {}, speciesCandy: {}, settings: {}, nicknames: {}, boostLocks: {} };
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

/** キーを外した記録（キーが無ければ同じものを返す。下書きの記録はどれも「無ければ同じ参照」で変わっていないことを表す） */
function omitKey<V>(record: Readonly<Record<string, V>>, key: string): Readonly<Record<string, V>> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/** キーの値を変えた記録。undefined はキーを外す */
function withKey<V>(record: Readonly<Record<string, V>>, key: string, value: V | undefined): Readonly<Record<string, V>> {
  return value === undefined ? omitKey(record, key) : { ...record, [key]: value };
}

/** 2つの記録が同じキーと値を持つか（値は `eq` で比べる） */
function isSameRecord<V>(
  a: Readonly<Record<string, V>>,
  b: Readonly<Record<string, V>>,
  eq: (x: V, y: V) => boolean = (x, y) => x === y,
): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && eq(a[key]!, b[key]!));
}

/**
 * 行を変えたあとのアメの数の記録。変えた行が個数指定でなくなったら（目標Lv・睡眠目標・現在Lvで外れる）、記録も外す
 * （元の数へ戻す先が無くなる）
 */
function candyRecordsAfter(records: FineTuneState["candyRecords"], next: CalcRow): FineTuneState["candyRecords"] {
  return next.candyTarget === undefined ? omitKey(records, next.id) : records;
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

/** アメブを動かせない理由（目標Lvは `canAdjustTarget`）。動かせる行は null。 */
export function rowExclusion(row: CalcRow, evaluated: EvaluatedRows): RowExclusion | null {
  if (sleepTargetTraits(row).candy === "none") return "noCandy";
  if (row.sleepTargetHours !== undefined && candyUnitsOf(row, evaluated) === 0) return "sleepOnly";
  if (row.srcLevel >= MAX_LEVEL) return "maxLevel";
  if (row.pokedexId === undefined || !isValidPokedexId(row.pokedexId)) return "unknownPokemon";
  return null;
}

/**
 * 目標Lvを動かせる行。計算機の目標Lvピッカーと同じく、LvMax（現在Lv70。目標Lvは70から動かない）のほかは動かせる。
 * 睡眠だけで届く行・アメを使わない睡眠目標の行も動かせ、個数指定の行（アメの数を変えた行を含む）は目標Lvが個数指定を上書きする。
 * 評価に頼らない。
 */
export function canAdjustTarget(row: CalcRow): boolean {
  return row.srcLevel < MAX_LEVEL;
}

/**
 * 機械（全体のLvを伸ばす）がアメブを動かしてよい行。
 * 個数指定の行は外す。アメの数をユーザーが決めた行で、アメブを動かすとその行の到達Lv（個数から決まる目標Lv）が変わるため。
 * アメ在庫の睡眠目標の行（`stockOnly`）は、在庫が足りて睡眠前のアメ担当分（T'）に届いている行だけ（`stockReachesTarget`、S75）。
 * この行の到達は T' のまま動かさず、アメブを変えると使うアメの数が変わる（増やせば余った在庫が下の同じ進化系の行へ回る）。
 * 在庫が足りない行は、在庫の取り分を全部使うので、アメブを変えると到達Lvが上下する。そのため動かさない（固定のスイッチも出さない）。
 * `boostLocks` を渡すと、固定した行も外す（固定できる行かを見るときは渡さない）
 */
export function canAutoAdjustBoost(evaluated: EvaluatedRows, row: CalcRow, boostLocks?: BoostLocks): boolean {
  return boostLocks?.[row.id] !== true
    && row.candyTarget === undefined
    && (sleepTargetTraits(row).candy !== "stockOnly" || stockReachesTarget(evaluated, row.id))
    && rowExclusion(row, evaluated) === null;
}

/**
 * アメ在庫の睡眠目標の行が、この行に回る種族アメ在庫（上の行の取り分を除いた数）で、睡眠前のアメ担当分（T'）に届くか。
 * T' までに要るアメの数（`candyNeed`）が在庫の取り分以下なら届く。種族を解決できない行・評価に無い行は false
 */
export function stockReachesTarget(evaluated: EvaluatedRows, rowId: string): boolean {
  const item = evaluated.byId.get(rowId);
  return item !== undefined && item.stockCandyAvailable !== undefined && item.candyNeed <= item.stockCandyAvailable;
}

/**
 * アメの数を変えられる行。対象外でない行と、個数指定の行（アメの数を変えた行を含む）。
 * 睡眠目標モードの行は計算機でも個数指定にできないので不可。
 */
export function canAdjustCandy(evaluated: EvaluatedRows, row: CalcRow): boolean {
  if (row.sleepTargetMode !== undefined) return false;
  return row.candyTarget !== undefined || rowExclusion(row, evaluated) === null;
}

/** 最新の結果でその行が使えたアメの数。結果が無い・行が無ければ null。 */
function candyUsedOf(latest: FineTuneLatest | null, rowId: string): number | null {
  const planned = latest?.result.pokemonResults.find((p) => p.pokemonId === rowId);
  return planned === undefined ? null : planned.reachableLine.totalCandyUnitsUsed;
}

/**
 * アメの数の今の値。記録のある行は記録の値、ほかは `candyValueBeforeEdit`。
 * `used` は結果でその行が使えたアメの数（結果が無ければ null）
 */
export function candyValueOf(
  state: Pick<FineTuneState, "candyRecords">,
  evaluated: EvaluatedRows,
  used: number | null,
  row: CalcRow,
): number {
  return state.candyRecords[row.id]?.candy ?? candyValueBeforeEdit(evaluated, used, row);
}

/**
 * アメの数を変えていない行の値。もとから個数指定の行はその数（プランナーへ渡す数）、ほかは結果で使えた数（目標までに要る数を
 * 超えない）。足りずに要る数まで使えていない行でも、表に出ている数から動かし始める
 */
export function candyValueBeforeEdit(evaluated: EvaluatedRows, used: number | null, row: CalcRow): number {
  const m0 = candyUnitsOf(row, evaluated);
  if (row.candyTarget !== undefined) return m0;
  return used === null ? m0 : Math.min(m0, used);
}

// ===== 数値の op が動ける範囲。評価は渡された `evaluated`（今の下書きを評価した値）の1回だけで、ほかの行は見ない =====

/**
 * アメブの範囲。0 〜（全アメブ点。個数指定の行はアメの数）と（今の値 + 残り枠）の小さい方。
 * 個数指定の行の全アメブ点は「今の個数とアメブで決まる目標Lv」までの数なので、アメブを増やすたびに動いてしまう。
 * そのため全部をアメブにするまで（アメブはアメの数の内訳）を上限にする。
 * 今の値がそれより大きいときは、今の値までを範囲に入れる（はじめから超えている値を範囲の外にしない）。
 * `slotRemaining` は残り枠（`boostSlotRemaining`。全行の合計なので、行ごとに数え直さないよう呼び出し側で1回求める）
 */
export function boostRange(evaluated: EvaluatedRows, row: CalcRow, slotRemaining: number): OpRange {
  const item = evaluated.byId.get(row.id);
  if (item === undefined) return { min: 0, max: 0 };
  const full = row.candyTarget !== undefined ? candyUnitsOf(row, evaluated) : item.fullBoost;
  const cap = Math.min(full, item.effectiveBoost + Math.max(0, slotRemaining));
  return { min: 0, max: Math.max(item.effectiveBoost, cap) };
}

/** アメブ目標Lvの範囲。現在Lv〜上限（計算機のピッカーと同じ `boostReachLevelMax`）。行の実効アメブと同じく、残り枠では抑えない */
export function boostLevelRange(evaluated: EvaluatedRows, row: CalcRow): OpRange {
  const item = evaluated.byId.get(row.id);
  if (item === undefined) return { min: 0, max: 0 };
  return { min: row.srcLevel, max: Math.max(row.srcLevel, item.boostReachLevelMax) };
}

/** 目標Lvの範囲。現在Lv〜MAX_LEVEL */
export function targetRange(row: CalcRow): OpRange {
  return { min: row.srcLevel, max: MAX_LEVEL };
}

/** アメの数の範囲。0〜個数指定の上限（計算機と同じ。Lv70 に届く数）。記録のある行は、変える前の行（アメブを固定した行）で求める */
export function candyRange(
  state: Pick<FineTuneState, "candyRecords">,
  evaluated: EvaluatedRows,
  row: CalcRow,
  deps: Pick<FineTuneDeps, "maxCandyTargetFor" | "withExplicitBoost">,
): OpRange {
  return candyRangeFrom(candyBase(state, evaluated, row, deps).row, deps);
}

/** アメの数を入れる元の行（`candyBase` の `row`）での、アメの数の範囲 */
function candyRangeFrom(baseRow: CalcRow, deps: Pick<FineTuneDeps, "maxCandyTargetFor">): OpRange {
  return { min: 0, max: Math.max(0, deps.maxCandyTargetFor(baseRow)) };
}

/**
 * アメの数を入れる元。もとから個数指定の行（記録が無い）はその行のまま（`before` はその行、`boost` は使わない）。
 * ほかは、変える前の行（`before`）の実効アメブ（`boost`）を明示アメブで固定した行（`row`）
 * （アメブを固定しないと、個数を変えるたびにアメブの読み方が変わる）。
 */
function candyBase(
  state: Pick<FineTuneState, "candyRecords">,
  evaluated: EvaluatedRows,
  row: CalcRow,
  deps: Pick<FineTuneDeps, "withExplicitBoost">,
): { before: CalcRow; boost: number; row: CalcRow } {
  const record = state.candyRecords[row.id];
  const before = record?.before ?? row;
  const boost = record?.boost ?? evaluated.byId.get(row.id)?.effectiveBoost ?? 0;
  if (record === undefined && row.candyTarget !== undefined) return { before, boost, row };
  return { before, boost, row: deps.withExplicitBoost(before, boost, { preserveTargetForExplicitBoost: true }) };
}

/**
 * 下書きが基準と同じか（同じ順番で各行が同じ参照で、在庫・設定・ニックネームを変えていない）。
 * 固定（`boostLocks`）は計算機へ書かないので見ない（固定だけなら適用するものが無く、閉じても確かめない）
 */
export function isDraftEmpty(
  base: Pick<FineTuneBase, "rows">,
  state: Pick<FineTuneState, "rows" | "speciesCandy" | "settings" | "nicknames">,
): boolean {
  return isSameRows(base.rows, state.rows)
    && Object.keys(state.speciesCandy).length === 0
    && Object.keys(state.settings).length === 0
    && Object.keys(state.nicknames).length === 0;
}

/** 下書きで効いている設定（開いた時点の設定に、変えた設定を重ねたもの） */
export function settingsValueOf(
  base: Pick<FineTuneBase, "settings">,
  state: Pick<FineTuneState, "settings">,
): CalcSettingsSnapshot {
  return { ...base.settings, ...state.settings };
}

/** 設定を1つ変えた下書きの設定。開いた時点と同じ値なら、変えていない扱いに戻す */
function withSetting<K extends keyof CalcSettingsSnapshot>(
  base: Pick<FineTuneBase, "settings">,
  current: CalcSettingsOverride,
  key: K,
  value: CalcSettingsSnapshot[K],
): CalcSettingsOverride {
  const { [key]: _removed, ...rest } = current;
  return sameSettingValue(base.settings[key], value) ? rest : { ...rest, [key]: value };
}

function sameSettingValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 開いた時点の行と中身が同じ行は、開いた時点の行（同じ参照）にする。既定のアメブ目標Lvを変えて戻したとき、
 * 配り直した行が開いた時点と同じなら、下書きを変えていない扱いに戻すため。どれも同じなら同じ配列を返す
 */
function preferBaseRows(baseRows: readonly CalcRow[], rows: readonly CalcRow[]): readonly CalcRow[] {
  const baseById = new Map(baseRows.map((row) => [row.id, row]));
  let changed = false;
  const next = rows.map((row) => {
    const preferred = preferBase(baseById.get(row.id), row);
    if (preferred !== row) changed = true;
    return preferred;
  });
  return changed ? next : rows;
}

/** 1行だけの `preferBaseRows` */
function preferBaseRow(baseRows: readonly CalcRow[], row: CalcRow): CalcRow {
  return preferBase(baseRows.find((r) => r.id === row.id), row);
}

function preferBase(baseRow: CalcRow | undefined, row: CalcRow): CalcRow {
  return baseRow === undefined || baseRow === row || JSON.stringify(baseRow) !== JSON.stringify(row) ? row : baseRow;
}

/** 下書きでのその進化系の種族アメの在庫（変えていなければストアの値） */
export function speciesCandyValueOf(
  state: Pick<FineTuneState, "speciesCandy">,
  familyKey: string,
  deps: Pick<FineTuneDeps, "speciesCandyStockOf">,
): number {
  return state.speciesCandy[familyKey] ?? deps.speciesCandyStockOf(familyKey);
}

function isSameRows(a: readonly CalcRow[], b: readonly CalcRow[]): boolean {
  return a.length === b.length && a.every((row, i) => row === b[i]);
}

/** 下書きの中身（rows・candyRecords・speciesCandy・settings・nicknames・boostLocks）が同じか。version は見ない。履歴に記録するかの判定に使う。 */
export function isSameDraftContent(a: FineTuneState, b: FineTuneState): boolean {
  return isSameRows(a.rows, b.rows)
    && isSameRecord<unknown>(a.settings, b.settings, sameSettingValue)
    && isSameRecord(a.boostLocks, b.boostLocks)
    && isSameRecord(a.speciesCandy, b.speciesCandy)
    && isSameRecord(a.nicknames, b.nicknames)
    && isSameRecord(a.candyRecords, b.candyRecords);
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
    case "defaultBoostLevelSet":
      return "settings:defaultBoostLevel";
    case "shardsSet":
      return "settings:shards";
    case "universalCandySet":
      return `settings:universal:${op.size}`;
    default:
      return undefined;
  }
}

/** 値を範囲（`boostRange` など）に収める（整数に切り捨てる）。 */
function clampToRange(value: number, range: OpRange): number {
  return Math.min(range.max, Math.max(range.min, Math.floor(value)));
}

function advanced(state: FineTuneState, patch: Partial<Omit<FineTuneState, "version">>): { state: FineTuneState } {
  return { state: { ...state, ...patch, version: state.version + 1 } };
}

/**
 * 下書きを変える唯一の入口。ほかの行の都合で拒否しない。数値の op は範囲（`boostRange` など）に収め、
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
  if (isSettingsOp(op)) return reduceSettings(base, state, op, deps);

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
      const next = clampToRange(requested, boostRange(evaluated, row, boostSlotRemaining(base, evaluated)));
      if (next === current) return { state };
      // アメブを動かした行はアメの数の記録を外す（以後はもとから個数指定の行と同じに扱う）。記録の「変える前の行」は
      // アメブを変える前の行なので、元の数に戻したときにそこへ戻すと、動かしたアメブが消えてしまう。アメブ目標Lv・再割当も同じ
      return advanced(state, {
        rows: replaceRowAt(state.rows, index, deps.withExplicitBoost(row, next, { preserveTargetForExplicitBoost: true })),
        candyRecords: omitKey(state.candyRecords, row.id),
      });
    }
    case "boostLevelSet": {
      if (rowExclusion(row, evaluated) !== null) return { rejected: "excluded" };
      const item = evaluated.byId.get(row.id);
      if (item === undefined || item.boostInputDisabled) return { rejected: "boostLevelLocked" };
      if (!Number.isFinite(op.level)) return { rejected: "invalidValue" };
      const lv = clampToRange(op.level, boostLevelRange(evaluated, row));
      // 今のアメブ目標Lvと同じなら変えない（個数を手で入れた行も、そのLvを選び直しただけでは自動に戻さない）
      if (lv === item.boostReachLevel) return { state };
      const next = deps.withBoostReachLevel(row, lv);
      if (next === row) return { state };
      return advanced(state, {
        rows: replaceRowAt(state.rows, index, next),
        candyRecords: omitKey(state.candyRecords, row.id),
      });
    }
    case "targetStep":
    case "targetSet": {
      if (!canAdjustTarget(row)) return { rejected: "excluded" };
      const requested = op.kind === "targetStep" ? row.dstLevel + op.by : op.level;
      if (!Number.isFinite(requested)) return { rejected: "invalidValue" };
      const lv = clampToRange(requested, targetRange(row));
      if (lv === row.dstLevel) return { state };
      // 目標Lvは個数指定を上書きする（計算機と同じ）
      const next = deps.withTargetLevel(row, lv, state.rows);
      return advanced(state, { rows: replaceRowAt(state.rows, index, next), candyRecords: candyRecordsAfter(state.candyRecords, next) });
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
      const current = candyValueOf(state, evaluated, candyUsedOf(latest, row.id), row);
      const requested = op.kind === "candyStep" ? current + op.by : op.candy;
      if (!Number.isFinite(requested)) return { rejected: "invalidValue" };
      const candy = candyBase(state, evaluated, row, deps);
      const next = clampToRange(requested, candyRangeFrom(candy.row, deps));
      if (next === current) return { state };
      // もとから個数指定の行は、その行の数を変えるだけ（記録は持たない）
      if (record === undefined && row.candyTarget !== undefined) {
        return advanced(state, { rows: replaceRowAt(state.rows, index, deps.withCandyTarget(row, next)) });
      }
      const m0 = record?.m0 ?? candyUnitsOf(row, evaluated);
      if (next === m0) {
        // 変える前の数に戻したら、変える前の行へ戻す。記録が無い（使えた数が要る数より少ない行で、要る数まで増やした）なら変えない
        if (record === undefined) return { state };
        return advanced(state, { rows: replaceRowAt(state.rows, index, record.before), candyRecords: omitKey(state.candyRecords, row.id) });
      }
      return advanced(state, {
        rows: replaceRowAt(state.rows, index, deps.withCandyTarget(candy.row, next)),
        candyRecords: { ...state.candyRecords, [row.id]: { before: candy.before, m0, boost: candy.boost, candy: next } },
      });
    }
    case "sleepSet": {
      if (row.sleepTargetMode === (typeof op.target === "string" ? op.target : undefined)
        && row.sleepTargetHours === (typeof op.target === "number" ? op.target : undefined)) return { state };
      // 睡眠目標を入れると個数指定は外れる（計算機と同じ）
      const next = deps.withSleepTarget(row, op.target);
      return advanced(state, { rows: replaceRowAt(state.rows, index, next), candyRecords: candyRecordsAfter(state.candyRecords, next) });
    }
    case "boostMinimize": {
      if (rowExclusion(row, evaluated) !== null) return { rejected: "excluded" };
      // アメが足りず最小限のアメブにしても届かない行も入れられる（計算機と同じ。その行は元のアメブ個数・アメブ目標Lvを使い、画面で知らせる）
      if (op.on && !deps.canMinimizeBoostFor(row)) return { rejected: "minimizeUnavailable" };
      // スイッチが入っていれば、入れても変わらない（入れても元の設定は消さない）
      if (op.on && row.boostMinimizeRow === true) return { state };
      const next = deps.withMinimizeBoost(row, op.on);
      if (next === row) return { state };
      return advanced(state, { rows: replaceRowAt(state.rows, index, next) });
    }
    case "revertRow": {
      if (op.row.id !== row.id) return { rejected: "invalidValue" };
      const sameRecord = state.candyRecords[row.id] === op.candyRecord;
      const sameStock = op.stock === undefined || state.speciesCandy[op.stock.familyKey] === op.stock.count;
      // 戻す先は開いた時点の行なので、ニックネームも開いた時点へ戻す
      const sameNickname = state.nicknames[row.id] === undefined;
      if (row === op.row && sameRecord && sameStock && sameNickname) return { state };
      return advanced(state, {
        rows: replaceRowAt(state.rows, index, op.row),
        candyRecords: withKey(state.candyRecords, row.id, op.candyRecord),
        speciesCandy: op.stock === undefined ? state.speciesCandy : withKey(state.speciesCandy, op.stock.familyKey, op.stock.count),
        nicknames: omitKey(state.nicknames, row.id),
      });
    }
    case "nicknameSet": {
      const original = deps.nicknameOf(row);
      if (original === undefined) return { rejected: "individualLocked" };
      if (typeof op.nickname !== "string") return { rejected: "invalidValue" };
      // ボックスのニックネーム欄と同じく、打った名前をそのまま持つ（表示名は前後の空白を除き、空なら種族名）
      const nickname = op.nickname;
      if (nickname === (state.nicknames[row.id] ?? original)) return { state };
      const nicknames = withKey(state.nicknames, row.id, nickname === original ? undefined : nickname);
      const title = deps.titleForNickname(row, nickname);
      // 開いた時点の行と中身が同じに戻ったら、開いた時点の行（同じ参照）にする（ほかに何も変えていなければ下書きが空に戻る）
      const retitle = (r: CalcRow): CalcRow => (r.title === title ? r : preferBaseRow(base.rows, { ...r, title }));
      const next = retitle(row);
      // アメの数の記録の「変える前の行」も同じ名前にする（元の数へ戻したとき、名前が戻らないように。
      // 名前を開いた時点へ戻したら開いた時点の行に戻し、元の数へ戻したときに下書きが空に戻るように）
      const record = state.candyRecords[row.id];
      const candyRecords = record === undefined || record.before.title === title
        ? state.candyRecords
        : { ...state.candyRecords, [row.id]: { ...record, before: retitle(record.before) } };
      return advanced(state, {
        rows: next === row ? state.rows : replaceRowAt(state.rows, index, next),
        candyRecords,
        nicknames,
      });
    }
    case "removeRow": {
      // 最後の1匹は外せない。行が無いとプランナーの入力が作れず（計算機も計算しない）、プレビューが届かないため
      if (state.rows.length <= 1) return { rejected: "lastRow" };
      // 行の顔ぶれが変わるので、ほかの行のアメブ（自動の配分）・使うアメも評価し直しで変わる（計算機で削除したときと同じ）
      return advanced(state, {
        rows: state.rows.filter((_, i) => i !== index),
        candyRecords: omitKey(state.candyRecords, row.id),
        nicknames: omitKey(state.nicknames, row.id),
        boostLocks: omitKey(state.boostLocks, row.id),
      });
    }
    case "boostLockSet": {
      if (typeof op.on !== "boolean") return { rejected: "invalidValue" };
      if (op.on === (state.boostLocks[row.id] === true)) return { state };
      // 固定できるのは、機械がアメブを動かす行だけ（アメブのあるスロットで、個数指定でなく、対象外でない）。外すのはいつでもできる
      if (op.on && (evaluated.plannerInput?.boost.kind ?? "none") === "none") return { rejected: "excluded" };
      if (op.on && !canAutoAdjustBoost(evaluated, row)) return { rejected: "excluded" };
      return advanced(state, { boostLocks: withKey(state.boostLocks, row.id, op.on ? true : undefined) });
    }
    case "srcLevelSet":
    case "expRemainingSet": {
      if (!deps.canEditIndividual(row)) return { rejected: "individualLocked" };
      const requested = op.kind === "srcLevelSet" ? op.level : op.exp;
      if (!Number.isFinite(requested)) return { rejected: "invalidValue" };
      const patch = op.kind === "srcLevelSet" ? { level: requested } : { expRemaining: requested };
      const rows = deps.withRowIndividual(state.rows, row.id, patch);
      if (rows === state.rows) return { state };
      const record = state.candyRecords[row.id];
      if (record === undefined) return advanced(state, { rows });
      // 現在Lvを変えると個数指定が外れる（計算機と同じ）。アメの数の記録も外す
      if (op.kind === "srcLevelSet" || rows[index]!.candyTarget === undefined) {
        return advanced(state, { rows, candyRecords: omitKey(state.candyRecords, row.id) });
      }
      // あとEXPだけなら個数指定は残るので、記録の「変える前の行」にも同じ変更を当てる（元の数に戻したとき、変えたあとEXPのまま戻る）
      const before = deps.withRowIndividual(replaceRowAt(state.rows, index, record.before), row.id, patch)[index]!;
      return advanced(state, { rows, candyRecords: { ...state.candyRecords, [row.id]: { ...record, before } } });
    }
    case "stockSet": {
      const familyKey = deps.speciesCandyFamilyOf(row);
      if (familyKey === undefined) return { rejected: "individualLocked" };
      if (!Number.isFinite(op.count)) return { rejected: "invalidValue" };
      const count = clampToRange(op.count, { min: 0, max: SPECIES_CANDY_MAX });
      if (count === speciesCandyValueOf(state, familyKey, deps)) return { state };
      // 開いた時点の在庫と同じ数にしたら、変えていない扱いに戻す
      const next = count === deps.speciesCandyStockOf(familyKey) ? undefined : count;
      return advanced(state, { speciesCandy: withKey(state.speciesCandy, familyKey, next) });
    }
    case "boostReset": {
      if (rowExclusion(row, evaluated) !== null) return { rejected: "excluded" };
      // 個数を手で入れていない（自動の値）なら、戻すものが無い
      if (row.boostOrExpAdjustment === undefined) return { state };
      return advanced(state, {
        rows: replaceRowAt(state.rows, index, deps.withBoostCandyReset(row, state.rows)),
        candyRecords: omitKey(state.candyRecords, row.id),
      });
    }
  }
}

/** 設定欄の op。行を変えるのは既定のアメブ目標Lv（自動の行を配り直す）と、それを戻す設定のリセットだけ */
function reduceSettings(
  base: FineTuneBase,
  state: FineTuneState,
  op: FineTuneSettingsOp,
  deps: Pick<FineTuneDeps, "withDefaultBoostReachLevelRows">,
): FineTuneReduceResult {
  const current = settingsValueOf(base, state);
  switch (op.kind) {
    case "minimizeBoostSet": {
      if (op.on === current.minimizeBoost) return { state };
      return advanced(state, { settings: withSetting(base, state.settings, "minimizeBoost", op.on) });
    }
    case "defaultBoostLevelSet": {
      if (op.level !== null && !Number.isFinite(op.level)) return { rejected: "invalidValue" };
      // 計算機の設定と同じく、1 未満は「目標Lvと同じ」、70 より上は 70
      const level = normalizeDefaultBoostReachLevel(op.level);
      if (level === current.defaultBoostReachLevel) return { state };
      const rows = preferBaseRows(base.rows, deps.withDefaultBoostReachLevelRows(state.rows, level));
      return advanced(state, { rows, settings: withSetting(base, state.settings, "defaultBoostReachLevel", level) });
    }
    case "shardsSet": {
      if (!Number.isFinite(op.count)) return { rejected: "invalidValue" };
      const count = clampToRange(op.count, { min: 0, max: SHARDS_MAX });
      if (count === current.totalShards) return { state };
      return advanced(state, { settings: withSetting(base, state.settings, "totalShards", count) });
    }
    case "universalCandySet": {
      if (!Number.isFinite(op.count)) return { rejected: "invalidValue" };
      const count = clampToRange(op.count, { min: 0, max: UNIVERSAL_CANDY_MAX });
      if (count === current.universalCandy[op.size]) return { state };
      const next = { ...current.universalCandy, [op.size]: count };
      return advanced(state, { settings: withSetting(base, state.settings, "universalCandy", next) });
    }
    case "settingsReset": {
      if (Object.keys(state.settings).length === 0) return { state };
      // 既定のアメブ目標Lvを変えていたら、自動の行を開いた時点の設定で配り直す
      const rows = state.settings.defaultBoostReachLevel === undefined
        ? state.rows
        : preferBaseRows(base.rows, deps.withDefaultBoostReachLevelRows(state.rows, base.settings.defaultBoostReachLevel, base.settings));
      return advanced(state, { rows, settings: {} });
    }
  }
}
