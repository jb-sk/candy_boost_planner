/**
 * 「全体のLvを伸ばす」。全員のアメブ（とそれで決まる使うアメの数）をまとめて動かし、届かない行を上から順に伸ばす。
 * 設計書 §5（S71・S72）。
 *
 * 1歩ずつ候補を試すのではなく、動かす行（`canAutoAdjustBoost` で機械が動かしてよい行）のアメブをすべて変数にして、
 * モデル（`boostPlan.ts` の `createBoostPlanner`）で一度に求める。
 * 1. 節約するもの（`RAISE_SAVINGS`。アメ節約 → かけら節約）ごとに、アメブの配り方を求める。モデルでも今より到達が
 *    伸びなければ、解かずにその節約するものは伸びないとする
 * 2. 決めたアメブが今と違う行だけ入れ、計算機と同じ評価でプランナー入力を作り、本物のソルバーで1回解いて確かめる
 *    （モデルの予想ではなく、この結果を入れる）。解く前に、アメ在庫の睡眠目標の行の到達が下がらないかを評価で確かめ、
 *    下がるならその原因の行を動かさないことにして求め直す（`loweredStockPins`、S75）
 * 3. 採るのは、到達が良くなった（`compareResults`。上の行から比べるので、上の行の到達点を下げる結果は採らない。
 *    押して Lv が下がることは無い）結果。余り最小は、今が各行余り0〜2（配分方針 §6 のハード制約）を満たしていれば、
 *    結果も満たすこと（`keepsSurplusGate`）
 * 4. 採れなければ直す。モデルは粒度（アイテムの余り）を見ないので、届くとした行がソルバーで数個足りないことがある。
 *    その行の要るアメに足りなかった分を足して（`margins`）求め直す。余りゲートを破ったときは、破ったいちばん上の行に1を
 *    足す。直しは節約するものごとに `RAISE_MAX_REPAIRS` 回まで。直しても採れなければ、その節約するものは伸びない
 * 「届いた」は配分器と同じく、要求したアメを配り終えたか（`candyDemandMet`、配分方針 §6.5）で見る（`isDemandMet`）。
 * 固定した行（`boostLocks`。シンプルを開いている間だけ）のアメブは動かさない。
 * 節約するものはアメ節約・かけら節約の2通りを求め、結果が違えば両方を返す。呼び出し側は、求める節約するもの
 * （`savings`）を分けて呼べる（アメ節約を先に出し、かけら節約は後から求める。同じ `cache` を渡すと、解いた結果とモデルを
 * 使い回す）。`untilRaised` なら、最初に伸びた節約するもので止める（アメ節約で伸びなければかけら節約を求める）。
 * ソルバーを解くのは節約するものごとに1回（直しがあれば最大 `RAISE_MAX_REPAIRS + 1` 回）。時間は1回の呼び出しで
 * `RAISE_TIME_BUDGET_MS`（計算機と同じ30秒）まで（解き始める前に見る。解き終えた結果は採る条件で見る）。
 * 押したときに「LvUp中止」を先に描けるよう、各節約するものの最初に1回、描画へ処理を譲る。
 * ストア・Vue を値で import しない。ストアの関数は `RaiseDeps` で受け取る。
 */
import type { CalcRow, EvaluatedRows, SpeciesCandyOverride } from "../../composables/useCalcStore";
import type { ItemCompareMode, LevelPlannerInput, LevelPlannerResult, PokemonPlanResult, ShortageType, UniversalCandyStock } from "../level-planner/types";
import { MAX_ACCEPTABLE_SURPLUS, PLANNER_DEADLINE_MS } from "../level-planner/constants";
import { pokemonResultsById } from "../level-planner/resultIndex";
import { maxLevel as MAX_LEVEL } from "../pokesleep/tables";
import { perfInfo } from "../../utils/perf";
import { boostSlotRemaining, canAutoAdjustBoost, stockReachesTarget, type BoostLocks, type FineTuneBase, type FineTuneDeps } from "./draft";
import { createBoostPlanner, type BoostPlanner, type RaiseSaving } from "./boostPlan";

export type { RaiseSaving };

export type SolvePlan = (input: LevelPlannerInput) => Promise<LevelPlannerResult>;

/** 行を入れ直すためにストアから受け取る関数 */
export type RaiseDeps = Pick<FineTuneDeps, "evaluateRows" | "withExplicitBoost">;

/** 求める順（はじめに選ばれているのはアメ節約。配分方針 §1: アメはかけらより貴重） */
export const RAISE_SAVINGS: readonly RaiseSaving[] = ["candy", "shards"];

/** 届いた行か。配分器（ソルバーの到達 prefix・境界）と同じく、要求したアメを配り終えたか（`candyDemandMet`）で見る（配分方針 §6.5） */
export const isDemandMet = (p: PokemonPlanResult): boolean => p.reachableLine.candyDemandMet;

export interface RaiseInput {
  deps: RaiseDeps;
  base: Pick<FineTuneBase, "boostLimit">;
  /** 今の下書きの行一覧 */
  rows: readonly CalcRow[];
  /** 下書きで変えた種族アメの在庫（評価のときに在庫の代わりに使う） */
  speciesCandy?: SpeciesCandyOverride;
  /** アメブを固定した行（動かさない） */
  boostLocks?: BoostLocks;
  /** `rows` を解いた結果がもうあれば渡す（はじめに解き直さない） */
  initialResult?: LevelPlannerResult;
  solve: SolvePlan;
  /** 求める節約するもの（`RAISE_SAVINGS` の順に並べる）。省くと全部 */
  savings?: readonly RaiseSaving[];
  /**
   * true なら、`savings` を順に求めて最初に伸びたところで止める（残りは後から求める）。伸びた通りは1つで、
   * それより前の節約するものは伸びなかった
   */
  untilRaised?: boolean;
  /**
   * 解いた結果とモデルの置き場（`createRaiseCache`）。同じ `rows` を節約するものを分けて呼ぶときに同じものを渡すと、
   * 前の呼び出しで解いた入力を解き直さず、到達の決め方・要るアメの表も求め直さない。省くと呼び出しの中だけで使い回す
   */
  cache?: RaiseCache;
  /** true を返すと途中で止める（閉じた・下書きが変わった） */
  isCancelled?: () => boolean;
  /**
   * 時間の上限（ms、この呼び出しの始めから。節約するものをまたぐ）。ソルバーを解き始める前に見て、超えていれば解かずに、
   * その節約するもの（と残り）は伸びなかったとする。解いている間に超えた結果は、採る条件を満たせば採る
   */
  timeBudgetMs?: number;
  now?: () => number;
}

/** 解いた結果とモデルの置き場（`RaiseInput.cache`） */
export interface RaiseCache {
  /** プランナーへの入力の `JSON.stringify` → 解いた結果 */
  readonly solved: Map<string, Promise<LevelPlannerResult>>;
  /** 動かす行とプランナーへの入力 → モデル */
  readonly planners: Map<string, BoostPlanner>;
}

export const createRaiseCache = (): RaiseCache => ({ solved: new Map(), planners: new Map() });

/** 伸ばした結果の1通り。`savings` はこの結果になった節約するもの（両方で同じ結果なら2つ） */
export interface RaiseOption {
  savings: readonly RaiseSaving[];
  /** 入れる行一覧 */
  rows: readonly CalcRow[];
  /** `rows` を解いた結果 */
  result: LevelPlannerResult;
  /** 伸ばす前からの増減 */
  report: RaiseReport;
}

export type RaiseOutcome =
  /** 伸びた。`options` は結果の違う通りごと（`RAISE_SAVINGS` の順。はじめは先頭を入れる） */
  | { kind: "raised"; options: readonly RaiseOption[] }
  /** はじめから全員が目標Lvに届いている */
  | { kind: "allReached" }
  /**
   * どの節約するもので求めても伸びなかった。`limitingFactor` は先頭の届かない行を止めているもの。
   * `surplusGated` は、到達が伸びる結果があったのに余り最小の余りゲート（各行余り0〜2、S69）で捨てたとき
   * （配分方針をバランス・EXP最大にすると伸ばせることがある）
   */
  | { kind: "unchanged"; limitingFactor: ShortageType | null; surplusGated?: true }
  /** アメブなしのスロット・計算できる行が無い */
  | { kind: "unavailable" }
  | { kind: "cancelled" };

/**
 * 解かずに確かに分かる「全体のLvを伸ばす」の見込み（`checkRaise`）。`possible` は、押してみないと分からない
 * （モデルでの判断は見込みに使わない。設計書 §5.2）。ほかは押しても `raiseLevels` が同じ結果を返す。
 */
export type RaiseCheck =
  | { kind: "possible" }
  | Extract<RaiseOutcome, { kind: "allReached" | "unchanged" | "unavailable" }>;

/** 伸ばす前 → 後 */
export interface BeforeAfter<T> {
  before: T;
  after: T;
}

/**
 * 「全体のLvを伸ばす」で変わった1行。値はどれも結果・評価そのもの（誰の分が誰へ回ったかは、ソルバーが上から順に
 * 配るので決まらない。減った行が出した側、増えた行が受け取った側）。
 */
export interface RaiseRowChange {
  rowId: string;
  /** 行の表示名（下書きの行の名前） */
  title: string;
  /** 実効アメブ（表のアメブの欄と同じ） */
  boost: BeforeAfter<number>;
  /** 使ったアメ（アメブを含む合計。表のアメの欄と同じ） */
  candy: BeforeAfter<number>;
  /** 使ったかけら */
  shards: BeforeAfter<number>;
  /** アメで届くLv */
  level: BeforeAfter<number>;
  /** 到達点から次のLvまでの EXP（あとEXP。操作パネルの「到達Lv 63（あとEXP 358）」と同じ）。Lv70・0 のときは null */
  expLeft: BeforeAfter<number | null>;
  /**
   * 到達点が良くなったか（`compareResults` の1行分 `compareLines`。両方で届いた行は same）。Lvが同じで経験値だけ増えた行も better
   */
  reach: "better" | "worse" | "same";
}

export interface RaiseReport {
  /** アメブ・使ったアメ・かけら・届くLv・あとEXPのどれかが変わった行（行の順） */
  rows: RaiseRowChange[];
  /**
   * 伸ばす前より到達点が良くなった（`reach` が better の）、いちばん上の行。Lvの上がった行が無く、Lv 内の EXP だけが
   * 増えたときの見出しに使う
   */
  lead: { rowId: string; title: string } | null;
  boostRemaining: BeforeAfter<number>;
  shardsRemaining: BeforeAfter<number>;
  /**
   * 万能アメの残り（S・M・L の個数）。万能アメは全員で分け合う在庫なので、行ごとの配り先ではなく残りの合計で見る
   * （配り先はソルバーが決め、誰から誰へ回ったかは決まらない。行ごとに使ったアメは `rows` の `candy`）
   */
  universalRemaining: BeforeAfter<UniversalCandyStock>;
  /** 全員の使ったアメ（アメ合計の和）。アメ節約・かけら節約を見比べるのに使う */
  candyUsed: BeforeAfter<number>;
}

/**
 * 小窓の見出しに出すこと。
 * - `levelUp`: 届くLvが上がった行のうち、いちばん上の行（`others` はほかにも上がった行がある）
 * - `expGained`: Lvの上がった行が無いとき、到達点が良くなった（Lv 内の EXP が増えた）いちばん上の行
 * - `none`: どちらも無い（伸びたときには起きない。念のため）
 */
export type RaiseHeadline =
  | { kind: "levelUp"; title: string; others: boolean }
  | { kind: "expGained"; title: string }
  | { kind: "none" };

export function raiseHeadline(report: RaiseReport): RaiseHeadline {
  const ups = report.rows.filter((r) => r.level.after > r.level.before);
  const first = ups[0];
  if (first !== undefined) return { kind: "levelUp", title: first.title, others: ups.length > 1 };
  if (report.lead !== null) return { kind: "expGained", title: report.lead.title };
  return { kind: "none" };
}

/** 伸ばす前と後の点（行一覧・評価・結果）から、変わった行と残りの増減を出す */
function raiseReport(base: Pick<FineTuneBase, "boostLimit">, before: Point, after: Point): RaiseReport {
  const rows: RaiseRowChange[] = [];
  let lead: RaiseReport["lead"] = null;
  for (const row of after.rows) {
    const b = before.resultById.get(row.id)?.reachableLine;
    const a = after.resultById.get(row.id)?.reachableLine;
    if (b === undefined || a === undefined) continue;
    const diff = compareLines(a, b);
    if (lead === null && diff > 0) lead = { rowId: row.id, title: row.title };
    const change: RaiseRowChange = {
      rowId: row.id,
      title: row.title,
      boost: { before: before.evaluated.byId.get(row.id)?.effectiveBoost ?? 0, after: after.evaluated.byId.get(row.id)?.effectiveBoost ?? 0 },
      candy: { before: b.totalCandyUnitsUsed, after: a.totalCandyUnitsUsed },
      shards: { before: b.dreamShardsUsed, after: a.dreamShardsUsed },
      level: { before: b.level, after: a.level },
      expLeft: { before: expLeftOf(b), after: expLeftOf(a) },
      reach: diff > 0 ? "better" : diff < 0 ? "worse" : "same",
    };
    const changed = [change.boost, change.candy, change.shards, change.level, change.expLeft].some((v) => v.before !== v.after);
    if (changed) rows.push(change);
  }
  return {
    rows,
    lead,
    boostRemaining: { before: boostSlotRemaining(base, before.evaluated), after: boostSlotRemaining(base, after.evaluated) },
    shardsRemaining: { before: before.result.summary.dreamShardsRemaining, after: after.result.summary.dreamShardsRemaining },
    universalRemaining: { before: before.result.summary.universalCandyRemaining, after: after.result.summary.universalCandyRemaining },
    candyUsed: { before: candyUsedOf(before), after: candyUsedOf(after) },
  };
}

/**
 * 時間の上限（1回の呼び出しで、節約するものをまたいで）。計算機の待ち時間の上限（ソルバー1回の締切 `PLANNER_DEADLINE_MS`）に
 * 合わせる。上限は解き始める前に見るので、解いている途中の1回はソルバーの締切まで続くことがある（止めたいときは取り消す）
 */
export const RAISE_TIME_BUDGET_MS = PLANNER_DEADLINE_MS;
/** 直しの上限（節約するものごと）。ソルバーを解くのは最大 `RAISE_MAX_REPAIRS + 1` 回 */
export const RAISE_MAX_REPAIRS = 2;

interface Point {
  rows: readonly CalcRow[];
  evaluated: EvaluatedRows;
  result: LevelPlannerResult;
  /** `result` の行（行ID → 結果）。点ごとに1回だけ作る */
  resultById: ReadonlyMap<string, PokemonPlanResult>;
}

function pointOf(rows: readonly CalcRow[], evaluated: EvaluatedRows, result: LevelPlannerResult): Point {
  return { rows, evaluated, result, resultById: pokemonResultsById(result) };
}

/** 全員の使ったアメ（アメ合計の和） */
function candyUsedOf(point: Point): number {
  let sum = 0;
  for (const row of point.rows) sum += point.resultById.get(row.id)?.reachableLine.totalCandyUnitsUsed ?? 0;
  return sum;
}

/**
 * 各行余り0〜2（配分方針 §6 のハード制約）を破った行（行の順）。見るのは到達 prefix（上から続けて届いた行）と
 * 境界（その次の行）で、余り（`surplusCandyValue`）が `MAX_ACCEPTABLE_SURPLUS` を超えた行。結果に無い行は飛ばす
 */
function surplusGateBreakers(point: Point): string[] {
  const breakers: string[] = [];
  for (const row of point.rows) {
    const res = point.resultById.get(row.id);
    if (res === undefined) continue;
    if (res.reachableLine.surplusCandyValue > MAX_ACCEPTABLE_SURPLUS) breakers.push(row.id);
    if (!isDemandMet(res)) break;
  }
  return breakers;
}

/**
 * 余り最小で、候補が各行余り0〜2（配分方針 §6 のハード制約）を保つか。今が満たしていれば候補も満たすこと、
 * 今が満たしていなければ問わない（ソルバーがバランスへ切り替えた結果など。満たさないことを理由に伸ばすのを止めない）
 */
function keepsSurplusGate(candidate: Point, current: Point): boolean {
  return surplusGateBreakers(current).length > 0 || surplusGateBreakers(candidate).length === 0;
}

/**
 * 上の行から到達点を比べ（`compareLines`）、最初に違う行で決める。a が良ければ正、悪ければ負、同じなら 0。
 * 到達 prefix の数 → 境界の Lv+EXP → 境界より下の行、の順に比べるのと同じ。どちらかの結果に無い行は飛ばす。
 */
export function compareResults(a: LevelPlannerResult, b: LevelPlannerResult, rows: readonly CalcRow[]): number {
  return compareReach(pokemonResultsById(a), pokemonResultsById(b), rows);
}

/** `compareResults` を、点ごとに作ってある行ID → 結果の表で比べる */
function compareReach(am: ReadonlyMap<string, PokemonPlanResult>, bm: ReadonlyMap<string, PokemonPlanResult>, rows: readonly CalcRow[]): number {
  for (const row of rows) {
    const pa = am.get(row.id)?.reachableLine;
    const pb = bm.get(row.id)?.reachableLine;
    if (pa === undefined || pb === undefined) continue;
    const diff = compareLines(pa, pb);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 到達点のあとEXP（操作パネルと同じく、Lv70・0 のときは出さない） */
function expLeftOf(line: PokemonPlanResult["reachableLine"]): number | null {
  return line.level < MAX_LEVEL && line.expToNextLevel > 0 ? line.expToNextLevel : null;
}

/**
 * 1行の到達点を比べる（`compareResults` の1行分）。a が良ければ正、悪ければ負、同じなら 0。
 * - 両方で届いた行（`isDemandMet`）は同じ。届いた点は、アメの刻みで目標を少し越えた分だけ違うことがあり、越えた分を良しと
 *   すると、上の届いた行の端数のために下の行の到達点を下げる配り方を採ってしまう。アメの個数を指定した行がアメブ枠で削られて
 *   到達点が違うときも、配分器と同じく同じとみなす
 * - 片方だけ届いた行は、届いた方が良い（枠で削られた個数指定の行は、届いていても到達Lvが低いことがある）
 * - どちらも届かない行は Lv、同じなら Lv 内の EXP
 */
function compareLines(a: PokemonPlanResult["reachableLine"], b: PokemonPlanResult["reachableLine"]): number {
  if (a.candyDemandMet && b.candyDemandMet) return 0;
  if (a.candyDemandMet !== b.candyDemandMet) return a.candyDemandMet ? 1 : -1;
  if (a.level !== b.level) return a.level - b.level;
  return a.expInLevel - b.expInLevel;
}

/**
 * モデルで動かす行の pokemonId。プランナー入力にある行のうち、機械がアメブを動かしてよい（`canAutoAdjustBoost`。固定・個数指定・
 * 対象外・在庫が足りないアメ在庫の睡眠目標の行は外す）行
 */
function variableIdsOf(rows: readonly CalcRow[], evaluated: EvaluatedRows, boostLocks: BoostLocks): Set<string> {
  const inInput = new Set((evaluated.plannerInput?.pokemonList ?? []).map((p) => p.pokemonId));
  const ids = new Set<string>();
  for (const row of rows) {
    if (inInput.has(row.id) && canAutoAdjustBoost(evaluated, row, boostLocks)) ids.add(row.id);
  }
  return ids;
}

/**
 * アメ在庫の睡眠目標の行（プランナー入力で `itemsAllowed` が false）の到達が、決めたアメブで下がるかを、解く前に評価で確かめる（S75）。
 * - 動かす行: 在庫の取り分で、睡眠前のアメ担当分（T'）に届いたまま（`stockReachesTarget`）
 * - 動かさない行: 使うアメの数（`candyTarget.totalCandyUnits`）が減らない（アメブは同じなので、数が減ると到達が下がる）
 * 計算機は種族アメ在庫を上の行から取り分け（上の行がアイテムで賄う分も取り分に数える）、モデルはアイテムで賄える分を差し引くので、
 * モデルで届く行の取り分が計算機では足りないことがある。この行は在庫を配り終えれば届いた行（`candyDemandMet`）なので、
 * ソルバーの結果を比べても気づけない。
 * 下がった行があれば、いちばん上の下がった行について固定する行を返す（動かす行ならその行、動かさない行なら同じ進化系でそれより
 * 上の動かす行。無ければ空）。下がった行が無ければ null
 */
function loweredStockPins(before: EvaluatedRows, next: EvaluatedRows, variableIds: ReadonlySet<string>): string[] | null {
  const list = next.plannerInput?.pokemonList ?? [];
  const beforeTotal = new Map<string, number>();
  for (const p of before.plannerInput?.pokemonList ?? []) beforeTotal.set(p.pokemonId, p.candyTarget?.totalCandyUnits ?? 0);
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    if (p.itemsAllowed !== false) continue;
    if (variableIds.has(p.pokemonId)) {
      if (!stockReachesTarget(next, p.pokemonId)) return [p.pokemonId];
      continue;
    }
    const was = beforeTotal.get(p.pokemonId);
    if (was === undefined || (p.candyTarget?.totalCandyUnits ?? 0) >= was) continue;
    return list.slice(0, i).filter((u) => u.candyFamilyKey === p.candyFamilyKey && variableIds.has(u.pokemonId)).map((u) => u.pokemonId);
  }
  return null;
}

/** 先頭の届かない行を止めているもの */
function limitingFactorOf(point: Point): ShortageType | null {
  return firstOf(point, (res) => !isDemandMet(res))?.constraintDiagnosis.limitingFactor ?? null;
}

/** 行の順で、結果が `pred` を満たす最初の行の結果（結果に無い行は飛ばす） */
function firstOf(point: Point, pred: (res: PokemonPlanResult) => boolean): PokemonPlanResult | undefined {
  for (const row of point.rows) {
    const res = point.resultById.get(row.id);
    if (res !== undefined && pred(res)) return res;
  }
  return undefined;
}

/** 届かない行（`isDemandMet` でない行）が無いか */
const allDemandMet = (point: Point): boolean => firstOf(point, (res) => !isDemandMet(res)) === undefined;

/**
 * 届かない行が無いときの結果。全員が到達点にも届いていれば `allReached`。アメの個数を指定した行がアメブ枠で削られて
 * 到達点に届かない（`effectiveTargetReached` が false）ときは、表では届いていないので、その行を止めているもの
 * （アメブ枠）を添えて `unchanged` にする（届いた行へ枠は回さないので、押しても伸びない）
 */
function settledOutcome(point: Point): Extract<RaiseOutcome, { kind: "allReached" | "unchanged" }> {
  const short = firstOf(point, (res) => !res.reachableLine.effectiveTargetReached);
  return short === undefined ? { kind: "allReached" } : { kind: "unchanged", limitingFactor: short.constraintDiagnosis.limitingFactor };
}

/**
 * 今の行一覧とその結果から、ソルバーもモデルも使わずに「全体のLvを伸ばす」の見込みを出す（設計書 §5.2）。
 * 動かす行が無ければ `unchanged`（押しても伸びない）、あれば `possible`。モデルで伸びるかは見込みに使わない
 * （モデルはアイテムの粒度・動かさない行の予算の変化を見ないので、外れて「伸ばせるのに押せない見た目」になりうる。Q31）。
 * モデルで伸びないときは、押すと `raiseLevels` が解かずにすぐ `unchanged` を返す。
 */
export function checkRaise(input: {
  rows: readonly CalcRow[];
  boostLocks?: BoostLocks;
  evaluated: EvaluatedRows;
  result: LevelPlannerResult;
}): RaiseCheck {
  const { rows, evaluated, result } = input;
  const plannerInput = evaluated.plannerInput;
  if (plannerInput === null || plannerInput.boost.kind === "none") return { kind: "unavailable" };
  const point = pointOf(rows, evaluated, result);
  if (allDemandMet(point)) return settledOutcome(point);
  if (variableIdsOf(rows, evaluated, input.boostLocks ?? {}).size > 0) return { kind: "possible" };
  return { kind: "unchanged", limitingFactor: limitingFactorOf(point) };
}

/** 描画へ処理を譲る（「LvUp中止」を先に描くため） */
const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function raiseLevels(input: RaiseInput): Promise<RaiseOutcome> {
  const { deps, base } = input;
  const now = input.now ?? (() => Date.now());
  const budget = input.timeBudgetMs ?? RAISE_TIME_BUDGET_MS;
  const startedAt = now();
  const cancelled = () => input.isCancelled?.() === true;

  const speciesCandy = input.speciesCandy ?? {};
  const boostLocks = input.boostLocks ?? {};
  const evaluated = deps.evaluateRows(input.rows, speciesCandy);
  const plannerInput = evaluated.plannerInput;
  if (plannerInput === null || plannerInput.boost.kind === "none") return { kind: "unavailable" };
  const mode: ItemCompareMode = plannerInput.options?.itemCompareMode ?? "surplusFirst";

  // 同じ入力は解き直さない（アメ節約とかけら節約は、決めたアメブが同じなら同じ入力を解く）
  const { solved, planners } = input.cache ?? createRaiseCache();
  const solve = (plan: LevelPlannerInput): Promise<LevelPlannerResult> => {
    const key = JSON.stringify(plan);
    let pending = solved.get(key);
    if (pending === undefined) {
      pending = input.solve(plan);
      solved.set(key, pending);
    }
    return pending;
  };

  const initialResult = input.initialResult ?? await solve(plannerInput);
  const initial = pointOf(input.rows, evaluated, initialResult);
  if (cancelled()) return { kind: "cancelled" };
  if (allDemandMet(initial)) return settledOutcome(initial);
  // モデルは節約するもの・直し・呼び出しをまたいで使い回す（到達の決め方は同じ直しの個数なら1回だけ求める）。
  // 今の結果は同じプランナーへの入力を解いたものなので、キーは動かす行と入力で足りる
  const allVariableIds = variableIdsOf(input.rows, evaluated, boostLocks);
  const plannerInputKey = JSON.stringify(plannerInput);
  /** 固定する行（`pinned`）を外した動かす行で、モデルを取り出す */
  const plannerFor = (pinned: ReadonlySet<string>): { planner: BoostPlanner; variableIds: ReadonlySet<string> } => {
    const variableIds = pinned.size === 0 ? allVariableIds : new Set([...allVariableIds].filter((id) => !pinned.has(id)));
    const key = `${[...variableIds].join("\n")}\n${plannerInputKey}`;
    let planner = planners.get(key);
    if (planner === undefined) {
      planner = createBoostPlanner({ plannerInput, current: initialResult, variableIds });
      planners.set(key, planner);
    }
    return { planner, variableIds };
  };

  /** 決めたアメブが今の実効アメブと違う行だけ、下書きの行へ入れる */
  function withPlannedBoosts(boosts: ReadonlyMap<string, number>): CalcRow[] {
    return input.rows.map((row) => {
      const boost = boosts.get(row.id);
      if (boost === undefined || boost === (evaluated.byId.get(row.id)?.effectiveBoost ?? 0)) return row;
      return deps.withExplicitBoost(row, boost, { preserveTargetForExplicitBoost: true });
    });
  }

  /**
   * アメ在庫の睡眠目標の行の到達を下げないために、動かさないことにした行（`loweredStockPins`）。原因は計算機の在庫の取り分けと
   * モデルのずれで、節約するものによらないので、節約するものをまたいで使う
   */
  const pinned = new Set<string>();
  /** 到達が伸びる結果を余りゲートで捨てたか（節約するものをまたいで見る。伸びなかったときの理由に使う） */
  let surplusGated = false;

  /** 節約するもの1つで、アメブを求めてソルバーで確かめる（直しは `RAISE_MAX_REPAIRS` 回まで）。伸びなければ null */
  const raiseWith = async (saving: RaiseSaving): Promise<Point | null | "cancelled"> => {
    await yieldToUi();
    const margins = new Map<string, number>();
    let modelMs = 0;
    let solves = 0;
    let repairs = 0;
    const finish = <T>(value: T, outcome: string): T => {
      perfInfo("raise", { saving, modelMs, solves, repairs, pinned: pinned.size, outcome });
      return value;
    };

    for (;;) {
      if (cancelled()) return "cancelled";

      const modelStart = now();
      const { planner, variableIds } = plannerFor(pinned);
      const plan = planner.plan(saving, margins);
      modelMs += now() - modelStart;
      if (plan.kind === "none") return finish(null, "none");

      const rows = withPlannedBoosts(plan.boosts);
      // どの行も今のアメブのまま（モデルの伸びが、今のアメブで出せる分だけ）なら、はじめと同じ入力なので解かない
      if (rows.every((row, i) => row === input.rows[i])) return finish(null, "unchanged");
      const next = deps.evaluateRows(rows, speciesCandy);
      if (next.plannerInput === null) return finish(null, "noInput");
      // アメ在庫の睡眠目標の行の到達が下がるなら、解かずに、その原因の行を動かさないことにして求め直す（固定する行が増えなければ打ち切る）
      const pins = loweredStockPins(evaluated, next, variableIds);
      if (pins !== null) {
        const added = pins.filter((id) => !pinned.has(id));
        if (added.length === 0) return finish(null, "stockLowered");
        for (const id of added) pinned.add(id);
        continue;
      }
      // 時間の上限は解き始める前に見る（モデルは軽いので、重いのはソルバーだけ）。解いている間に超えても、解き終えた結果は
      // 採る条件で見る（捨てても待ち時間は戻らない）。超えたあとは直しを始めない
      if (now() - startedAt > budget) return finish(null, "timeout");
      const result = await solve(next.plannerInput);
      solves += 1;
      if (cancelled()) return "cancelled";
      const candidate = pointOf(rows, next, result);

      const improved = compareReach(candidate.resultById, initial.resultById, initial.rows) > 0;
      const keepsGate = mode !== "surplusFirst" || keepsSurplusGate(candidate, initial);
      if (improved && keepsGate) return finish(candidate, "raised");
      if (improved) surplusGated = true;
      if (repairs >= RAISE_MAX_REPAIRS) return finish(null, "repairLimit");

      // 直し（設計書 §5.5）: モデルで届くとした行のうち、ソルバーで届かなかったいちばん上の行に、足りなかったアメを足す。
      // それが無く余りゲートを破ったときは、破ったいちばん上の行に1を足す。どちらも無ければ打ち切る
      let target: { id: string; add: number } | null = null;
      for (const row of input.rows) {
        if (!plan.predictedMet.has(row.id)) continue;
        const res = candidate.resultById.get(row.id);
        if (res !== undefined && !isDemandMet(res)) {
          target = { id: row.id, add: Math.max(1, Math.floor(res.shortage.candyToTarget) || 0) };
          break;
        }
      }
      if (target === null && !keepsGate) {
        const breaker = surplusGateBreakers(candidate)[0];
        if (breaker !== undefined) target = { id: breaker, add: 1 };
      }
      if (target === null) return finish(null, "noRepair");
      margins.set(target.id, (margins.get(target.id) ?? 0) + target.add);
      repairs += 1;
    }
  };

  let options: RaiseOption[] = [];
  for (const saving of input.savings ?? RAISE_SAVINGS) {
    const raised = await raiseWith(saving);
    if (raised === "cancelled" || cancelled()) return { kind: "cancelled" };
    if (raised === null) continue;
    options = mergeRaiseOptions(options, [
      { savings: [saving], rows: raised.rows, result: raised.result, report: raiseReport(base, initial, raised) },
    ]);
    if (input.untilRaised === true) break;
  }
  if (options.length > 0) return { kind: "raised", options };
  const limitingFactor = limitingFactorOf(initial);
  return surplusGated ? { kind: "unchanged", limitingFactor, surplusGated: true } : { kind: "unchanged", limitingFactor };
}

/**
 * 伸ばした結果の通りを1つの並びにまとめる（`RAISE_SAVINGS` の順に分けて求めた通りを、前の並びの後ろへ足す）。
 * 同じ行一覧になった通りは前の通りへ節約するものを足してまとめる（タブを出さない）。もとの並びは変えない
 */
export function mergeRaiseOptions(options: readonly RaiseOption[], added: readonly RaiseOption[]): RaiseOption[] {
  const merged = [...options];
  for (const option of added) {
    const index = merged.findIndex((o) => isSameBoosts(o.rows, option.rows));
    const same = merged[index];
    if (same === undefined) merged.push(option);
    else merged[index] = { ...same, savings: [...same.savings, ...option.savings] };
  }
  return merged;
}

/** 2つの行一覧が同じか（「全体のLvを伸ばす」はアメブだけを変えるので、行ごとの中身で比べる） */
function isSameBoosts(a: readonly CalcRow[], b: readonly CalcRow[]): boolean {
  return a.length === b.length && a.every((row, i) => row === b[i] || JSON.stringify(row) === JSON.stringify(b[i]));
}
