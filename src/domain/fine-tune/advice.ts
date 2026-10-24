/**
 * やりくりモーダルの診断・順位・おすすめ量・モード2の注意（設計書 §5、§6、§10.4）。
 * 機械はポケモンを選ばない。順位・効果・おすすめ量を出すだけ（D4）。
 * ストア・Vue を値で import しない。ストアの関数は `AdviceDeps` で受け取る。
 * 文言は画面側（i18n）で引く。ここは `kind` と行IDなどのデータだけを返す。
 * 診断・効果・おすすめ量は最新の結果から出す。基準の結果は使わない（§8.4）。
 */
import type { CalcRow, EvaluatedRows } from "../../composables/useCalcStore";
import { CANDY_VALUES } from "../level-planner/constants";
import type {
  BoostKind,
  CandySupplyBreakdown,
  LevelPlannerResult,
  PokemonPlanInput,
  PokemonPlanResult,
  ShortageType,
} from "../level-planner/types";
import { calcExp } from "../pokesleep/exp";
import { simulateCandyBudget, simulateCandyRun } from "../pokesleep/simulateCandyBudget";
import { maxLevel } from "../pokesleep/tables";
import { sleepTargetTraits } from "../sleep-target";
import {
  canAdjustInMode1,
  candyUnitsOf,
  clampToRange,
  isGiverControlShown,
  opRange,
  type FineTuneBase,
  type FineTuneDeps,
  type FineTuneLatest,
  type FineTuneState,
} from "./draft";

/** 増やす向きか減らす向きか。診断から毎回決める（D19）。 */
export type RankDirection = "increase" | "decrease";

// ============================================================
// 診断（§5.1）
// ============================================================

/** 先頭の未達行より下で、違うもので止まっている行（添え書き）。 */
export interface AlsoShort {
  rowId: string;
  factor: ShortageType;
}

/**
 * 表の9行に対応する判別共用体（§5.1）。向き・文言・案内は `kind` から引く（`DIAGNOSIS_DIRECTION` など）。
 * 1 `allReachedRoom` / 2 `allReachedNoRoom` / 3 `candyShortRoom` / 4 `candyShortNoSlot` / 5 `candyShortNoShards` /
 * 6 `shardsShort` / 7 `boostCapShort` / 8 `noBoostAllReached` / 9 `noBoostShort`。
 * `boostCannotHelp` は `diagnose` が返さない。3・6 でどの行にもおすすめ量が無いとき `settleDiagnosis` が置き換える。
 */
export type Diagnosis =
  | { kind: "allReachedRoom" }
  | { kind: "allReachedNoRoom" }
  | { kind: "noBoostAllReached" }
  | {
      kind:
        | "candyShortRoom"
        | "candyShortNoSlot"
        | "candyShortNoShards"
        | "shardsShort"
        | "boostCapShort"
        | "noBoostShort"
        | "boostCannotHelp";
      /** 先頭の未達行 */
      firstShortId: string;
      /** 先頭の未達行より下に、同じもので止まっている届かない行がある（「〇〇以下は」） */
      moreShort: boolean;
      /** 添え書きの行（先頭の未達行より下で、違うもので止まっている行。向きは変えない） */
      alsoShort: AlsoShort[];
    };

/**
 * 診断の kind から向きを引く表。null は順位・効果・おすすめ量を出さない（案内のみ・増やせない）。
 * 画面に向きの if を書かず、この表を引く（§10.4）。
 */
export const DIAGNOSIS_DIRECTION: Readonly<Record<Diagnosis["kind"], RankDirection | null>> = {
  allReachedRoom: "increase",
  allReachedNoRoom: null,
  candyShortRoom: "increase",
  candyShortNoSlot: null,
  candyShortNoShards: null,
  shardsShort: "decrease",
  boostCapShort: null,
  noBoostAllReached: null,
  noBoostShort: null,
  boostCannotHelp: null,
};

const isReached = (p: PokemonPlanResult): boolean => p.reachableLine.effectiveTargetReached;

/** 下書きの行の順に並べた結果。結果に無い行（プランナーに渡らない行）は飛ばす。 */
function resultsInRowOrder(result: LevelPlannerResult, rows: readonly CalcRow[]): PokemonPlanResult[] {
  const byId = new Map<string, PokemonPlanResult>();
  for (const p of result.pokemonResults) byId.set(p.pokemonId, p);
  const ordered: PokemonPlanResult[] = [];
  for (const row of rows) {
    const p = byId.get(row.id);
    if (p !== undefined) ordered.push(p);
  }
  return ordered;
}

/**
 * 診断（§5.1）。先頭の未達行（`!reachableLine.effectiveTargetReached` の最初の行）で決める（D18）。
 * `role` と `summary.fullyReachedCount` と `summary.boost.boostRemaining` は使わない（D26）。
 * `remainingBoost` は残り枠（D26。`boostSlotRemaining`）。呼び出し側が今の下書きの評価から出して渡す。
 */
export function diagnose(
  result: LevelPlannerResult,
  rows: readonly CalcRow[],
  boostKind: BoostKind,
  remainingBoost: number,
): Diagnosis {
  const ordered = resultsInRowOrder(result, rows);
  const firstIndex = ordered.findIndex((p) => !isReached(p));
  if (firstIndex < 0) {
    if (boostKind === "none") return { kind: "noBoostAllReached" };
    return remainingBoost > 0 && result.summary.dreamShardsRemaining > 0
      ? { kind: "allReachedRoom" }
      : { kind: "allReachedNoRoom" };
  }
  const first = ordered[firstIndex]!;
  // 律速が null なのは届いている行だけ（`calcDiagnosis`）。届かない行には必ず付く
  const factor = first.constraintDiagnosis.limitingFactor!;
  const alsoShort: AlsoShort[] = [];
  let moreShort = false;
  for (const p of ordered.slice(firstIndex + 1)) {
    if (isReached(p)) continue;
    const f = p.constraintDiagnosis.limitingFactor;
    if (f === factor) moreShort = true;
    else if (f !== null) alsoShort.push({ rowId: p.pokemonId, factor: f });
  }
  const head = { firstShortId: first.pokemonId, moreShort, alsoShort };
  if (boostKind === "none") return { kind: "noBoostShort", ...head };
  switch (factor) {
    case "candy":
      if (remainingBoost <= 0) return { kind: "candyShortNoSlot", ...head };
      if (result.summary.dreamShardsRemaining <= 0) return { kind: "candyShortNoShards", ...head };
      return { kind: "candyShortRoom", ...head };
    case "shards":
      return { kind: "shardsShort", ...head };
    case "boost":
      return { kind: "boostCapShort", ...head };
  }
}

// ============================================================
// 文脈
// ============================================================

/** advice が呼ぶストアの関数。`FineTuneDeps` の一部。 */
export type AdviceDeps = Pick<FineTuneDeps, "evaluateRows" | "withExplicitBoost">;

export interface AdviceInput {
  deps: AdviceDeps;
  base: Pick<FineTuneBase, "boostLimit">;
  state: FineTuneState;
  /** `deps.evaluateRows(state.rows)`（版ごとに1回） */
  evaluated: EvaluatedRows;
  /** 最新の結果（§8.4）。基準の結果ではない。 */
  result: LevelPlannerResult;
}

/** アメブを n にしたときの、プランナーへ渡る需要とそのシミュレーション。 */
interface DemandPoint {
  boost: number;
  totalCandy: number;
  shards: number;
  expGained: number;
}

export interface AdviceContext extends AdviceInput {
  /** 結果にある行のID（下書きの順） */
  readonly order: readonly string[];
  readonly rowById: ReadonlyMap<string, CalcRow>;
  readonly planById: ReadonlyMap<string, PokemonPlanInput>;
  readonly resultById: ReadonlyMap<string, PokemonPlanResult>;
  /** アメブなしのスロットは null ではなく "none"。プランナー入力が無いときは null */
  readonly boostKind: BoostKind | null;
  /** (行ID, アメブ個数) → 需要の点。同じ文脈の中で評価を使い回す。 */
  readonly demandCache: Map<string, DemandPoint | null>;
}

/** 順位・効果・おすすめ量の入力をまとめる。同じ版の間は使い回してよい。 */
export function createAdviceContext(input: AdviceInput): AdviceContext {
  const rowById = new Map<string, CalcRow>();
  for (const row of input.state.rows) rowById.set(row.id, row);
  const planById = new Map<string, PokemonPlanInput>();
  for (const p of input.evaluated.plannerInput?.pokemonList ?? []) planById.set(p.pokemonId, p);
  const resultById = new Map<string, PokemonPlanResult>();
  for (const p of input.result.pokemonResults) resultById.set(p.pokemonId, p);
  const order = input.state.rows.map((r) => r.id).filter((id) => resultById.has(id));
  return {
    ...input,
    order,
    rowById,
    planById,
    resultById,
    boostKind: input.evaluated.plannerInput?.boost.kind ?? null,
    demandCache: new Map(),
  };
}

// ============================================================
// 1個あたりの変化 boostMarginal（§5.2）
// ============================================================

/**
 * アメブを from から to へ動かしたときの変化。n と n' を `simulateCandyBudget` で計算した差（表の式は目安）。
 * 総アメ数 Δ は、プランナーへ渡る需要（個数指定の行はその個数、無い行は目標までに要る数。`candyUnitsOf`）の差。
 * 在庫で決まる行（在庫のみの睡眠目標で要る数 > 使える在庫）は総アメが変わらず `deltaExp` が増える。
 * 要る数が在庫以下になる境目をまたぐ to も、to の行を評価し直すので正しく出る。
 */
export interface BoostMarginal {
  rowId: string;
  from: number;
  to: number;
  /** 総アメ数の変化（to − from）。節約すると負 */
  deltaCandy: number;
  /** かけらの変化（to − from） */
  deltaShards: number;
  /** アメが担当するEXPの変化（to − from） */
  deltaExp: number;
  /** 節約アメ = −deltaCandy */
  savedCandy: number;
  /** 増やす向きの c_i = deltaShards ÷ 節約アメ。節約アメが 0 以下のとき null（順位を付けない） */
  shardsPerSavedCandy: number | null;
  /** 画面の「1個あたり」= deltaShards ÷ (to − from)。to = from のとき null。減らす向きの r_i は −これ */
  shardsPerBoost: number | null;
}

function pointFrom(evaluated: EvaluatedRows, row: CalcRow): DemandPoint | null {
  const input = evaluated.plannerInput;
  const plan = input?.pokemonList.find((p) => p.pokemonId === row.id);
  if (input === null || input === undefined || plan === undefined) return null;
  const totalCandy = candyUnitsOf(row, evaluated);
  const reached = simulateCandyBudget(
    {
      currentLevel: plan.currentLevel,
      currentExpInLevel: plan.currentExpInLevel,
      expType: plan.expType,
      nature: plan.nature,
    },
    plan.requestedBoostCandy,
    totalCandy,
    Infinity,
    input.boost.kind,
  );
  return { boost: plan.requestedBoostCandy, totalCandy, shards: reached.shards, expGained: reached.expGained };
}

/** その行のアメブを n にした下書き（▲▼ で入る行と同じ）を評価した需要の点。 */
function demandAt(ctx: AdviceContext, rowId: string, n: number): DemandPoint | null {
  const key = `${rowId}:${n}`;
  const cached = ctx.demandCache.get(key);
  if (cached !== undefined) return cached;
  const row = ctx.rowById.get(rowId);
  let point: DemandPoint | null = null;
  if (row !== undefined) {
    if (ctx.evaluated.byId.get(rowId)?.effectiveBoost === n) {
      point = pointFrom(ctx.evaluated, row);
    } else {
      const next = ctx.deps.withExplicitBoost(row, n, { preserveTargetForExplicitBoost: true });
      const rows = ctx.state.rows.map((r) => (r.id === rowId ? next : r));
      point = pointFrom(ctx.deps.evaluateRows(rows), next);
    }
  }
  ctx.demandCache.set(key, point);
  return point;
}

/** 行のアメブを今の値から `to` へ動かしたときの変化。行・プランナー入力が無いときは null。 */
export function boostMarginal(ctx: AdviceContext, rowId: string, to: number): BoostMarginal | null {
  const from = ctx.evaluated.byId.get(rowId)?.effectiveBoost;
  if (from === undefined) return null;
  const a = demandAt(ctx, rowId, from);
  const b = to === from ? a : demandAt(ctx, rowId, to);
  if (a === null || b === null) return null;
  const deltaCandy = b.totalCandy - a.totalCandy;
  const deltaShards = b.shards - a.shards;
  const savedCandy = a.totalCandy - b.totalCandy;
  return {
    rowId,
    from,
    to,
    deltaCandy,
    deltaShards,
    deltaExp: b.expGained - a.expGained,
    savedCandy,
    shardsPerSavedCandy: savedCandy > 0 ? deltaShards / savedCandy : null,
    shardsPerBoost: to === from ? null : deltaShards / (to - from),
  };
}

/** その行の ▲▼ を `by` ぶん押したときに実際に入るアメブ（`opRange` に収めた n'、D36・D37）。行が無ければ null。 */
export function boostAfterStep(ctx: AdviceContext, rowId: string, by: number): number | null {
  const item = ctx.evaluated.byId.get(rowId);
  if (item === undefined) return null;
  const range = opRange(ctx.base, ctx.state, ctx.evaluated, { kind: "boost", rowId });
  return clampToRange(item.effectiveBoost + by, range);
}

// ============================================================
// 効果 adviseRow（§5.2、§5.3、§2.5）
// ============================================================

export type NoEffectReason =
  | "speciesOnly"
  | "belowShortRows"
  | "noBoost"
  | "shardsLimited"
  | "boostCapLimited"
  | "atFullBoost";

/** 行の効果（§5.2）。札の文言・順位の対象か・おすすめ量の出し方は `kind` から引く。 */
export type RowAdvice =
  /** 自分の不足が減る（増やす: アメ不足、減らす: かけら不足） */
  | { kind: "selfShort" }
  /** 上の行として、下の届かない行に回る。`beneficiaryIds` は上から順 */
  | { kind: "feedsBelow"; beneficiaryIds: string[] }
  /** 在庫で決まる行。同じ在庫で Lv が上がる */
  | { kind: "sameStockMoreExp" }
  /** 全員届いていて、アメの節約 */
  | { kind: "saving" }
  | { kind: "noEffect"; reason: NoEffectReason };

/** 順位を付ける効果の kind（向きごと、§5.2、§5.3）。 */
export const RANKED_ADVICE_KINDS: Readonly<Record<RankDirection, readonly RowAdvice["kind"][]>> = {
  increase: ["selfShort", "feedsBelow", "saving"],
  decrease: ["selfShort", "feedsBelow"],
};

/** 供給（アメの使い方）のうち、taker が使える種類（§2.5）。 */
interface UsableKinds {
  species: boolean;
  type: boolean;
  universal: boolean;
}

function usableKinds(supply: CandySupplyBreakdown, giver: PokemonPlanInput, taker: PokemonPlanInput): UsableKinds {
  // 在庫のみの睡眠目標の行（itemsAllowed === false）が使えるのは自分の進化系の種族アメだけ
  const items = taker.itemsAllowed !== false;
  return {
    species: supply.species > 0 && giver.candyFamilyKey === taker.candyFamilyKey,
    type: items && supply.type.s + supply.type.m > 0 && giver.type === taker.type,
    universal: items && supply.universal.s + supply.universal.m + supply.universal.l > 0,
  };
}

const anyUsable = (u: UsableKinds): boolean => u.species || u.type || u.universal;

/** 下の届かない行のうち、律速が factor の行（上から順）。 */
function unreachedBelow(ctx: AdviceContext, rowId: string, factor: ShortageType): string[] {
  const index = ctx.order.indexOf(rowId);
  const ids: string[] = [];
  for (const id of ctx.order.slice(index + 1)) {
    const p = ctx.resultById.get(id)!;
    if (!isReached(p) && p.constraintDiagnosis.limitingFactor === factor) ids.push(id);
  }
  return ids;
}

function allReached(ctx: AdviceContext): boolean {
  return ctx.order.every((id) => isReached(ctx.resultById.get(id)!));
}

/** 在庫で決まる行（在庫のみの睡眠目標で、目標までに要る数 > 使える在庫、§5.2）。 */
function isStockBound(ctx: AdviceContext, row: CalcRow): boolean {
  if (sleepTargetTraits(row).candy !== "stockOnly") return false;
  const item = ctx.evaluated.byId.get(row.id);
  return item !== undefined && item.stockCandyAvailable !== undefined && item.candyNeed > item.stockCandyAvailable;
}

/**
 * 行の効果（§5.2、§5.3）。最新の結果から判定する。行かプランナー入力が無ければ null。
 * 増やす向き: 全アメブ点 → 自分の律速 → 在庫で決まる行 → 下の行へ回る → 節約 → 効果なし の順に当てはまったものを使う。
 * 減らす向き: アメブ0 → 自分のかけら不足 → 下の行へ回る → 効果なし。
 */
export function adviseRow(ctx: AdviceContext, rowId: string, direction: RankDirection): RowAdvice | null {
  const row = ctx.rowById.get(rowId);
  const item = ctx.evaluated.byId.get(rowId);
  const plan = ctx.planById.get(rowId);
  const res = ctx.resultById.get(rowId);
  if (row === undefined || item === undefined || plan === undefined || res === undefined) return null;

  const factor = isReached(res) ? null : res.constraintDiagnosis.limitingFactor;

  if (direction === "decrease") {
    if (item.effectiveBoost <= 0) return { kind: "noEffect", reason: "noBoost" };
    if (factor === "shards") return { kind: "selfShort" };
    const beneficiaryIds = unreachedBelow(ctx, rowId, "shards");
    return beneficiaryIds.length > 0
      ? { kind: "feedsBelow", beneficiaryIds }
      : { kind: "noEffect", reason: "belowShortRows" };
  }

  if (item.effectiveBoost >= item.fullBoost) return { kind: "noEffect", reason: "atFullBoost" };
  if (factor === "candy") return { kind: "selfShort" };
  if (factor === "shards") return { kind: "noEffect", reason: "shardsLimited" };
  if (factor === "boost") return { kind: "noEffect", reason: "boostCapLimited" };
  // 在庫で決まる行は総アメ数が在庫で固定され、アメブは到達EXPを増やすだけ。下の行へは回らない
  if (isStockBound(ctx, row)) return { kind: "sameStockMoreExp" };
  const beneficiaryIds = beneficiariesOfItems(ctx, rowId);
  if (beneficiaryIds.length > 0) return { kind: "feedsBelow", beneficiaryIds };
  if (allReached(ctx)) return { kind: "saving" };
  // 届かない行がアメで止まっていても、この行より下に無い、またはこの行のアメを使えない
  return unreachedBelow(ctx, rowId, "candy").length === 0
    ? { kind: "noEffect", reason: "belowShortRows" }
    : { kind: "noEffect", reason: "speciesOnly" };
}

/** この行が使っているアメを使える、下の「アメで止まっている届かない行」（上から順）。 */
function beneficiariesOfItems(ctx: AdviceContext, rowId: string): string[] {
  const giver = ctx.planById.get(rowId);
  const supply = ctx.resultById.get(rowId)?.reachableLine.candySupply;
  if (giver === undefined || supply === undefined) return [];
  return unreachedBelow(ctx, rowId, "candy").filter((id) => {
    const taker = ctx.planById.get(id);
    return taker !== undefined && anyUsable(usableKinds(supply, giver, taker));
  });
}

// ============================================================
// 「〇〇のLvを上げる」の量と名前（§5.5、D29）
// ============================================================

/**
 * 押すと入れる値（変更後のアメブ個数、絶対値）と、ボタンの名前に出す行。
 * 概算なので、正しい結果はプレビューで見る。
 */
export interface BoostRecommendation {
  rowId: string;
  /** 〇〇に当たる行: `selfShort` は自分、`feedsBelow` は beneficiaryIds の先頭1匹 */
  targetRowId: string;
  /** 2匹以上のとき true（「〇〇など」） */
  andOthers: boolean;
  /** 入れるアメブ個数（絶対値） */
  boost: number;
  /** 範囲に解が無く、端を入れた（「これだけでは届きません」） */
  insufficient: boolean;
}

/** 範囲 [lo, hi] で pred が false…true と単調なとき、最初に true になる値。無ければ null。 */
function firstTrue(lo: number, hi: number, pred: (k: number) => boolean): number | null {
  if (lo > hi || !pred(hi)) return null;
  let low = lo;
  let high = hi;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (pred(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** 範囲 [lo, hi] で pred が true…false と単調なとき、最後に true になる値。lo も false なら lo - 1。 */
function lastTrue(lo: number, hi: number, pred: (k: number) => boolean): number {
  let low = lo - 1;
  let high = hi;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (pred(mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** 行が使っているアメのうち、受け取り手が使えるもの（通常アメ換算、§5.5）。 */
function usableCandyValue(ctx: AdviceContext, rowId: string, takerIds: readonly string[]): number {
  const giver = ctx.planById.get(rowId);
  const supply = ctx.resultById.get(rowId)?.reachableLine.candySupply;
  if (giver === undefined || supply === undefined) return 0;
  let species = false;
  let type = false;
  let universal = false;
  for (const id of takerIds) {
    const taker = ctx.planById.get(id);
    if (taker === undefined) continue;
    const u = usableKinds(supply, giver, taker);
    species = species || u.species;
    type = type || u.type;
    universal = universal || u.universal;
  }
  return (species ? supply.species * CANDY_VALUES.species : 0)
    + (type ? supply.type.s * CANDY_VALUES.type.s + supply.type.m * CANDY_VALUES.type.m : 0)
    + (universal
      ? supply.universal.s * CANDY_VALUES.universal.s
        + supply.universal.m * CANDY_VALUES.universal.m
        + supply.universal.l * CANDY_VALUES.universal.l
      : 0);
}

/** 最新の結果で誰も使っていない在庫のうち、その行が使えるもの（通常アメ換算）。 */
function leftoverCandyValue(ctx: AdviceContext, rowId: string): number {
  const plan = ctx.planById.get(rowId);
  if (plan === undefined) return 0;
  const summary = ctx.result.summary;
  const species = summary.speciesCandyRemaining[plan.candyFamilyKey] ?? 0;
  // 在庫のみの睡眠目標の行（itemsAllowed === false）が使えるのは自分の進化系の種族アメだけ
  if (plan.itemsAllowed === false) return species;
  const type = summary.typeCandyRemaining[plan.type] ?? { s: 0, m: 0 };
  const universal = summary.universalCandyRemaining;
  return species
    + type.s * CANDY_VALUES.type.s + type.m * CANDY_VALUES.type.m
    + universal.s * CANDY_VALUES.universal.s + universal.m * CANDY_VALUES.universal.m + universal.l * CANDY_VALUES.universal.l;
}

/** 受け取る側1匹の、渡したアメ・かけらでの進み（§5.5 の見積もり）。 */
interface TakerRun {
  /** 進んだEXP（目標までで頭打ち） */
  gained: number;
  candy: number;
  shards: number;
  /** 目標に届いた／アメが尽きた／かけらが尽きた */
  stop: "reached" | "candy" | "shards";
}

/**
 * 受け取る側1匹を `simulateCandyRun`（ソルバーと同じ中核）で進める。目標（アメが担当する到達点）で止める。
 * `fromStart` は現在Lvから（動かす行自身、または先頭の受け取る側）、そうでなければ最新の結果の到達点から。
 */
function runTaker(
  ctx: AdviceContext,
  rowId: string,
  fromStart: boolean,
  boost: number,
  candyCap: number,
  shardCap: number,
): TakerRun | null {
  const plan = ctx.planById.get(rowId);
  const line = ctx.resultById.get(rowId)?.reachableLine;
  if (plan === undefined || line === undefined || ctx.boostKind === null) return null;
  const subject = fromStart
    ? { currentLevel: plan.currentLevel, currentExpInLevel: plan.currentExpInLevel, expType: plan.expType, nature: plan.nature }
    : { currentLevel: line.level, currentExpInLevel: line.expInLevel, expType: plan.expType, nature: plan.nature };
  const need = fromStart ? line.expGained + line.expToTarget : line.expToTarget;
  // 開始Lvから各Lvの頭までのEXP（アメ1個ごとに calcExp を足し直さない）
  const toLevel: number[] = [];
  toLevel[subject.currentLevel] = 0;
  for (let lv = subject.currentLevel; lv < maxLevel; lv += 1) {
    toLevel[lv + 1] = toLevel[lv]! + calcExp(lv, lv + 1, subject.expType);
  }
  const gainedAt = (level: number, expInLevel: number): number =>
    toLevel[level]! + expInLevel - subject.currentExpInLevel;
  const cap = Math.max(0, Math.floor(candyCap));
  const run = simulateCandyRun(subject, {
    boostBudget: boost,
    normalBudget: Infinity,
    totalCap: cap,
    shardLimit: Math.max(0, shardCap),
    kind: ctx.boostKind,
    shouldContinue: (level, expInLevel) => gainedAt(level, expInLevel) < need,
  });
  const candy = run.boostUsed + run.normalUsed;
  const reached = run.expGained >= need || run.level >= maxLevel;
  return {
    gained: Math.min(run.expGained, need),
    candy,
    shards: run.shards,
    stop: reached ? "reached" : candy >= cap ? "candy" : "shards",
  };
}

/** 動かす行のアメブを n にしたときの、受け取る側の進み（上から順）。 */
interface GroupOutcome {
  runs: TakerRun[];
}

/**
 * 動かす行 `rowId` のアメブを n にしたときの、受け取る側 `takerIds`（上から順）の進みの見積もり（§5.5）。
 * ソルバーは呼ばない。先頭の受け取る側は現在Lvから、使えるアメ（今使っている数 + 誰も使っていない在庫）と
 * かけら（今使っている数 + 残り）で進め、残りを下の受け取る側へ上から順に渡す。
 * 動かす行が先頭の受け取る側でなければ、その行が浮かせたアメ（受け取る側が使える種類まで）とかけらを足す。
 * 増えたアメは、その行の種族アメの余りで賄えなかった分だけ受け取る側から引く。
 */
function outcomeAt(ctx: AdviceContext, rowId: string, takerIds: readonly string[], n: number): GroupOutcome | null {
  const firstId = takerIds[0];
  const firstPlan = firstId === undefined ? undefined : ctx.planById.get(firstId);
  const firstLine = firstId === undefined ? undefined : ctx.resultById.get(firstId)?.reachableLine;
  if (firstId === undefined || firstPlan === undefined || firstLine === undefined) return null;
  let candy = firstLine.totalCandyUnitsUsed + leftoverCandyValue(ctx, firstId);
  let shards = firstLine.dreamShardsUsed + ctx.result.summary.dreamShardsRemaining;
  const self = firstId === rowId;
  if (!self) {
    const m = boostMarginal(ctx, rowId, n);
    if (m === null) return null;
    const speciesLeft = ctx.result.summary.speciesCandyRemaining[ctx.planById.get(rowId)?.candyFamilyKey ?? ""] ?? 0;
    candy += m.savedCandy >= 0
      ? Math.min(m.savedCandy, usableCandyValue(ctx, rowId, takerIds))
      : -Math.max(0, -m.savedCandy - speciesLeft);
    shards -= m.deltaShards;
  }
  const runs: TakerRun[] = [];
  for (const [i, id] of takerIds.entries()) {
    const plan = ctx.planById.get(id);
    const line = ctx.resultById.get(id)?.reachableLine;
    if (plan === undefined || line === undefined) return null;
    const boost = i === 0
      ? (self ? n : plan.requestedBoostCandy)
      : Math.max(0, plan.requestedBoostCandy - line.boostedCandyUnits);
    const run = runTaker(ctx, id, i === 0, boost, candy, shards);
    if (run === null) return null;
    runs.push(run);
    candy -= run.candy;
    shards -= run.shards;
  }
  return { runs };
}

/** 上から順に進みを比べる（上の受け取る側を優先する。ソルバーが上から続けて届く数を優先するのと同じ）。 */
function compareOutcome(a: GroupOutcome, b: GroupOutcome): number {
  for (let i = 0; i < a.runs.length; i += 1) {
    const diff = a.runs[i]!.gained - b.runs[i]!.gained;
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 受け取る側（上から順）。自分の不足なら自分が先頭で、その下の同じもので止まっている行が続く（§5.5、下の分まで足す）。 */
function takersOf(ctx: AdviceContext, rowId: string, direction: RankDirection, advice: RowAdvice): string[] {
  if (advice.kind === "feedsBelow") return advice.beneficiaryIds;
  const below = direction === "increase" ? beneficiariesOfItems(ctx, rowId) : unreachedBelow(ctx, rowId, "shards");
  return [rowId, ...below];
}

/**
 * 「〇〇のLvを上げる」（§5.5）。`selfShort` / `feedsBelow` の行だけ。それ以外と、受け取る側が伸びないとき null。
 * 受け取る側（`takersOf`）の進みが最も大きくなる個数（つり合う点）を入れる。増やすとアメは浮くがかけらが減り、
 * 減らすとかけらは浮くがアメが要るので、進みは山の形になる。山の頂上を越えると、受け取る側が
 * もう一方で止まり、逆向きのおすすめが出る（増やす → 減らす の往復）ので越えない。
 * - 動かす向きが使うもの（増やす: かけら、減らす: アメ）で受け取る側が止まらない最大の個数 kb を二分探索し、
 *   kb と kb+1 のうち進みが大きい方（同じなら少ない方）を、同じ進みになる最小の個数まで戻して入れる。
 * - 範囲は `opRange`（全アメブ点と残り枠）。進みが今より大きくならなければ null（頂上にいる）。
 * 見積もりは行ごとの計算で、ソルバーの配り方とは一致しない。正しい結果はプレビューで見る。
 */
export function recommendBoost(
  ctx: AdviceContext,
  rowId: string,
  direction: RankDirection,
  advice: RowAdvice,
): BoostRecommendation | null {
  if (advice.kind !== "selfShort" && advice.kind !== "feedsBelow") return null;
  const current = ctx.evaluated.byId.get(rowId)?.effectiveBoost;
  if (current === undefined) return null;
  const takerIds = takersOf(ctx, rowId, direction, advice);
  // 浮いた分は上から順に配られ、先頭の未達行が最初に受け取る（§5.6）。その下の行だけが伸びる見積もりは、
  // ソルバーが先頭の未達行を優先して下の行へ配らないため実現しない（実測: 押しても到達が変わらない）
  if (takerIds[0] !== ctx.order.find((id) => !isReached(ctx.resultById.get(id)!))) return null;
  const sign = direction === "increase" ? 1 : -1;
  const range = opRange(ctx.base, ctx.state, ctx.evaluated, { kind: "boost", rowId });
  const reach = direction === "increase" ? range.max - current : current - range.min;
  if (reach < 1) return null;

  const outcomes = new Map<number, GroupOutcome | null>();
  const at = (k: number): GroupOutcome | null => {
    if (!outcomes.has(k)) outcomes.set(k, outcomeAt(ctx, rowId, takerIds, current + sign * k));
    return outcomes.get(k)!;
  };
  const baseline = at(0);
  if (baseline === null) return null;
  const consumed = direction === "increase" ? "shards" : "candy";
  const fits = (k: number): boolean => at(k)?.runs.every((r) => r.stop !== consumed) ?? false;
  const kb = lastTrue(0, reach, fits);

  let bestK = 0;
  let best = baseline;
  for (const k of [kb, kb + 1]) {
    if (k < 1 || k > reach) continue;
    const outcome = at(k);
    if (outcome !== null && compareOutcome(outcome, best) > 0) {
      best = outcome;
      bestK = k;
    }
  }
  if (bestK === 0) return null;
  const k = firstTrue(1, bestK, (value) => {
    const outcome = at(value);
    return outcome !== null && compareOutcome(outcome, best) >= 0;
  }) ?? bestK;
  const chosen = at(k)!;
  return {
    rowId,
    targetRowId: takerIds[0]!,
    andOthers: chosen.runs.slice(1).some((run, i) => run.gained > baseline.runs[i + 1]!.gained),
    boost: current + sign * k,
    insufficient: chosen.runs[0]!.stop !== "reached",
  };
}

// ============================================================
// 一覧の順位・効果・おすすめ量
// ============================================================

export interface RowAdviceEntry {
  rowId: string;
  advice: RowAdvice;
  /**
   * 順位を付けた量での変化。おすすめ量がある行は今の値からおすすめ量へ、無い行は ▲▼ を1回押したときに入る値 n' へ。
   * n' = 今の値のときは変化が全て 0
   */
  marginal: BoostMarginal | null;
  /** 順位（1位から）。順位を付けない行は null */
  rank: number | null;
  /** 「〇〇のLvを上げる」。出さないとき null */
  recommendation: BoostRecommendation | null;
}

/**
 * モード1の全行の効果・順位・おすすめ量（§5.2、§5.3、§5.5）。操作できる行（`canAdjustInMode1`）だけが入る。
 * アメブなしのスロットでは空。`step` は「1回に動かす量」。順位は一覧を並べ替えず札で出す（D17）。
 * 順位は「〇〇のLvを上げる」で入る量での効率で付ける（押したときに入る量と、順位を付けた量を揃える）。
 * おすすめ量の無い `selfShort` / `feedsBelow` の行（頂上にいる行）には付けない。`saving`（全員届いている）は
 * おすすめ量が無いので「1回に動かす量」での効率で付ける。
 * - 増やす: 節約アメ1個あたりのかけら（c_i）の小さい順。節約アメが 0 以下の行は最後。
 * - 減らす: 1個あたり浮くかけら（r_i）の大きい順。
 * 同点は下書きの順。
 */
export function adviseRows(
  ctx: AdviceContext,
  direction: RankDirection,
  step: number,
): Map<string, RowAdviceEntry> {
  const entries = new Map<string, RowAdviceEntry>();
  if (ctx.boostKind === null || ctx.boostKind === "none") return entries;
  const sign = direction === "increase" ? 1 : -1;
  const ranked: Array<{ rowId: string; key: number; index: number }> = [];
  for (const row of ctx.state.rows) {
    if (!canAdjustInMode1(ctx.state, ctx.evaluated, row)) continue;
    const advice = adviseRow(ctx, row.id, direction);
    if (advice === null) continue;
    const recommendation = recommendBoost(ctx, row.id, direction, advice);
    const to = recommendation?.boost ?? boostAfterStep(ctx, row.id, sign * step);
    const marginal = to === null ? null : boostMarginal(ctx, row.id, to);
    entries.set(row.id, { rowId: row.id, advice, marginal, rank: null, recommendation });
    if (marginal === null || !RANKED_ADVICE_KINDS[direction].includes(advice.kind)) continue;
    if (advice.kind !== "saving" && recommendation === null) continue;
    if (direction === "increase") {
      if (marginal.to > marginal.from) {
        ranked.push({ rowId: row.id, key: marginal.shardsPerSavedCandy ?? Infinity, index: ranked.length });
      }
    } else if (marginal.to < marginal.from && marginal.shardsPerBoost !== null) {
      ranked.push({ rowId: row.id, key: -marginal.shardsPerBoost, index: ranked.length });
    }
  }
  // 小さい順（減らす向きは key が負なので、浮くかけらの大きい順）。同点は下書きの順（古い端末の sort は安定と限らない）
  ranked.sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? -1 : 1));
  ranked.forEach((item, i) => {
    entries.get(item.rowId)!.rank = i + 1;
  });
  return entries;
}

/**
 * 表示する診断。アメブで伸ばせるはずの診断（アメ不足で余りがある・かけら不足）なのに、どの行にも
 * 「〇〇のLvを上げる」が無い（どの行のアメブを動かしても先頭の未達行が伸びない＝頂上にいる）ときは、
 * 「アメブを動かしても伸びません」（`boostCannotHelp`）に置き換える。向きの判定（`DIAGNOSIS_DIRECTION`）には元の診断を使う。
 */
export function settleDiagnosis(diagnosis: Diagnosis, entries: ReadonlyMap<string, RowAdviceEntry>): Diagnosis {
  if (diagnosis.kind !== "candyShortRoom" && diagnosis.kind !== "shardsShort") return diagnosis;
  for (const entry of entries.values()) {
    if (entry.recommendation !== null) return diagnosis;
  }
  return { ...diagnosis, kind: "boostCannotHelp" };
}

// ============================================================
// モード2の上部の欄の注意（§6.1、§6.2、D43）
// ============================================================

/**
 * 上部の受け取る側の欄にまとめて出す注意。記録のある行（実際に減らした行）についてだけ出す（`noGivers` を除く）。
 * - noGivers: 受け取る側より上にゆずれるポケモンがいない
 * - belowReceiver: 記録のある行が受け取る側より下なので届かない（D7）
 * - takenFirst: 受け取る側が受け取れるものを、間の届かない行が先に受け取る。giverIds は対象の記録のある行
 */
export type ReceiverNotice =
  | { kind: "noGivers"; receiverId: string }
  | { kind: "belowReceiver"; giverId: string; receiverId: string }
  | { kind: "takenFirst"; takerId: string; giverIds: string[]; receiverId: string };

/** 受け取る側 B が giver の浮いたものから受け取れる種類（§6.2）。 */
interface ReceivableKinds extends UsableKinds {
  shards: boolean;
}

/**
 * モード2の注意。受け取る側がいなければ空。`latest` が null のときは結果に頼らない注意（noGivers、belowReceiver）だけ。
 * 受け取れるもの: giver が使っているアメのうち B が使えるもの（B が在庫のみの行なら giver と同じ進化系の種族アメだけ）。
 * B がかけらで止まっているなら、giver が使っているかけら。間の届かない行 X が先に取るのは、X が同じものを使える
 * （アメは X がアメで止まっている、かけらは X がかけらで止まっている）とき。
 */
export function receiverNotices(
  state: FineTuneState,
  evaluated: EvaluatedRows,
  latest: FineTuneLatest | null,
): ReceiverNotice[] {
  const receiverId = state.receiverId;
  if (receiverId === null) return [];
  const rows = state.rows;
  const receiverIndex = rows.findIndex((r) => r.id === receiverId);
  if (receiverIndex < 0) return [];
  const notices: ReceiverNotice[] = [];

  if (!rows.slice(0, receiverIndex).some((row) => isGiverControlShown(state, evaluated, row))) {
    notices.push({ kind: "noGivers", receiverId });
  }
  const giverRows = rows.filter((r) => state.givers[r.id] !== undefined);
  for (const giver of giverRows) {
    if (rows.indexOf(giver) > receiverIndex) notices.push({ kind: "belowReceiver", giverId: giver.id, receiverId });
  }
  if (latest === null) return notices;

  const resultById = new Map<string, PokemonPlanResult>();
  for (const p of latest.result.pokemonResults) resultById.set(p.pokemonId, p);
  const planById = new Map<string, PokemonPlanInput>();
  for (const p of evaluated.plannerInput?.pokemonList ?? []) planById.set(p.pokemonId, p);
  const receiverResult = resultById.get(receiverId);
  const receiverPlan = planById.get(receiverId);
  if (receiverResult === undefined || receiverPlan === undefined || isReached(receiverResult)) return notices;
  const receiverShortOfShards = receiverResult.constraintDiagnosis.limitingFactor === "shards";

  const takers = new Map<string, string[]>();
  for (const giver of giverRows) {
    const giverIndex = rows.indexOf(giver);
    if (giverIndex > receiverIndex) continue;
    const giverResult = resultById.get(giver.id);
    const giverPlan = planById.get(giver.id);
    if (giverResult === undefined || giverPlan === undefined) continue;
    const receivable: ReceivableKinds = {
      ...usableKinds(giverResult.reachableLine.candySupply, giverPlan, receiverPlan),
      shards: receiverShortOfShards && giverResult.reachableLine.dreamShardsUsed > 0,
    };
    if (!anyUsable(receivable) && !receivable.shards) continue;
    for (const between of rows.slice(giverIndex + 1, receiverIndex)) {
      const result = resultById.get(between.id);
      const plan = planById.get(between.id);
      if (result === undefined || plan === undefined || isReached(result)) continue;
      const factor = result.constraintDiagnosis.limitingFactor;
      const wanted = factor === "shards"
        ? receivable.shards
        : factor === "candy" && anyUsable(intersect(receivable, usableKinds(giverResult.reachableLine.candySupply, giverPlan, plan)));
      if (!wanted) continue;
      const list = takers.get(between.id) ?? [];
      list.push(giver.id);
      takers.set(between.id, list);
      break;
    }
  }
  for (const [takerId, giverIds] of takers) notices.push({ kind: "takenFirst", takerId, giverIds, receiverId });
  return notices;
}

function intersect(a: UsableKinds, b: UsableKinds): UsableKinds {
  return { species: a.species && b.species, type: a.type && b.type, universal: a.universal && b.universal };
}
