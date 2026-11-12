/**
 * 「全体のLvを伸ばす」のアメブの配り方（`createBoostPlanner` / `planBoosts`）。設計書 §5.4（S72）。
 *
 * ソルバーを呼ばずに、全員のアメブ（各行のブーストに使うアメの数）を1度に決める。アイテムを価値で連続化した資源の
 * モデル（種族アメ・タイプアメ・万能アメ → 行の流れと、かけら・アメブ枠の合計）で、上の行から到達を一番伸ばし、
 * そのうえで節約するもの（アメ節約・かけら節約）の方へ寄せる。
 * ストア・Vue・`solveLevelPlan` は import しない（プランナー入力・今の結果・動かす行を受け取るだけの純粋モジュール）。
 *
 * モデルの規則はソルバー（`solveLevelPlan.ts` の `normalizeInput` / `targetMixed` / `maxBoostFor`）と同じ。
 * - 行の分類
 *   - `target`: 到達点（Lv+EXP）で表す行。個数の無い行と、動かす行のうち個数の行（時間の睡眠目標）。後者の到達点は
 *     `normalizeInput` と同じく、今のアメの数とアメブで届く点（アメが担当する到達点）
 *   - `count`: 配るアメの数で表す行（個数の行で動かさないもの）。届く = 個数を配り終える（`candyDemandMet` と同じ）
 * - 要求は行ごとに1つの「進み」: target 行は到達点までの累積 EXP、count 行はアメの数。進みが最大なら「届く」。
 * - target 行の要るアメ・かけらは `calcExpAndCandyMixed`（アメブを低Lv側から先に使う）。ソルバーの `simulateCandyRun`
 *   （アメブ予算 b・通常アメ無制限で到達点に止まる）と一致する。ただし `calcExpAndCandyMixed` は余ったアメブを
 *   最後に足し込むので、b は全部アメブで上げるときの個数でそろえて渡す。
 * - 動かす行のアメブ b は 0〜B(P)（`boostCeiling`。ソルバーの `maxBoostFor` と同じ上限）。動かさない行は今ソルバーが
 *   配る予算のまま（`fixedBoost`）。
 * - 資源は最大流（資源 ↔ 行の二部グラフ。付け替えも見る増加路）で配れるかを確かめる。かけら・アメブ枠は全員の合計。
 *
 * モデルがアイテムの粒度（余り）を見ないことによるずれは、呼び出し側がソルバーで確かめ、`margins` で直す（§5.5）。
 */
import type { BoostKind, LevelPlannerInput, LevelPlannerResult, PokemonPlanInput } from "../level-planner/types";
import { CANDY_VALUES } from "../level-planner/constants";
import { pokemonResultsById } from "../level-planner/resultIndex";
import { addExpToLevel, calcExp, calcExpAndCandyMixed, calcExpPerCandy, isTargetReached } from "../pokesleep/exp";
import { minBoostForTarget } from "../pokesleep/minBoostForTarget";
import { simulateCandyBudget } from "../pokesleep/simulateCandyBudget";
import { maxLevel } from "../pokesleep/tables";
import type { ExpGainNature, ExpType } from "../types";

/** 節約するもの。アメ節約は使うアメが最少、かけら節約は使うかけらが最少になる寄せ方（S73） */
export type RaiseSaving = "candy" | "shards";

export interface BoostPlanInput {
  /** 今の下書きのプランナー入力 */
  plannerInput: LevelPlannerInput;
  /** `plannerInput` を解いた今の結果 */
  current: LevelPlannerResult;
  /** アメブを動かしてよい行の pokemonId（呼び出し側が決める） */
  variableIds: ReadonlySet<string>;
  /** 直し（§5.5）で、行の要るアメに足す個数（行の pokemonId → 個数） */
  margins?: ReadonlyMap<string, number>;
}

export type BoostPlan =
  /** モデルでも今より到達が伸びない */
  | { kind: "none" }
  | {
    kind: "plan";
    /** 動かす行すべての新しいアメブ（= 新しい requestedBoostCandy。今のアメブを残す規則を当てた後の値） */
    boosts: ReadonlyMap<string, number>;
    /** 最終の要求が「届く」の行（動かす行・動かさない行とも）。直し（§5.5）で使う */
    predictedMet: ReadonlySet<string>;
  };

// ---------------------------------------------------------------------------
// モデル
// ---------------------------------------------------------------------------

type PositiveBoostKind = Exclude<BoostKind, "none">;
interface Point { level: number; exp: number }
/** 要るアメ（アメブを含む）・かけら・使うアメブ */
interface Need { n: number; h: number; boost: number }
const ZERO_NEED: Need = { n: 0, h: 0, boost: 0 };

interface RowModel {
  index: number;
  id: string;
  kind: "target" | "count";
  /** アメブを動かしてよい行 */
  movable: boolean;
  p: PokemonPlanInput;
  src: number;
  expGot: number;
  expType: ExpType;
  nature: ExpGainNature;
  /** 今の requestedBoostCandy（プランナー入力の値） */
  requested: number;
  /** target 行: 到達点 P */
  goal: Point;
  /** 「届く」ときの進み（target 行は P までの累積 EXP、count 行は個数） */
  total: number;
  /**
   * 動かさない行のアメブ g。ソルバーがその行へ配るアメブの予算（要求・全アメブ点（count 行は個数のアメブ）・残り枠の最小）。
   * 設計書 §5.4 は「今の結果の `reachableLine.boostedCandyUnits`」とするが、かけらで止まった行は使ったアメブが予算より
   * 少なく（ソルバーは次のアメブがかけらに入らないと打ち切る）、それを g にすると、止まった先を通常アメで続けられると
   * 数えてしまう。枠で削られた行は、残り枠が小さくなるのでこの式でも削られた数になる。
   */
  fixedBoost: number;
  /** 今の進み（届いていれば total） */
  cur: number;
  curMet: boolean;
  /** 直し（§5.5）で要るアメに足す個数。`plan` ごとに入れ直す（要るアメ・かけらの表は margin によらないので使い回す） */
  margin: number;
  /** target 行: 要求の進み → 点・全アメブ点・要るアメの表（行ごとに使い回す。margin によらない） */
  qCache: Map<number, QInfo>;
  /** count 行: 配る個数 → 要るアメ・かけら（行ごとに使い回す） */
  countNeeds: Map<number, Need>;
}

/** 要求点 Q ごとの値 */
interface QInfo {
  point: Point;
  /** 全部アメブで Q まで上げるとき、Lv ごとに使うアメブの個数の累計（個数が0の Lv は含めない）。段の下端を出すのに使う */
  cum: number[];
  /** 全部アメブで上げるときのアメブの総数 */
  all: number;
  /** 動かす行のアメブの上限 B(Q)（`boostCeiling`）。要るときに1回だけ求める */
  bMax: number | null;
  /** アメブ（`all` で抑えた数）→ Q まで届くのに要るアメ・かけら */
  needs: Map<number, Need>;
}

interface Model {
  kind: PositiveBoostKind;
  rows: RowModel[];
  dreamShards: number;
  boostLimit: number;
  /** 資源の容量（価値） */
  caps: number[];
  /** 行ごとに受け取れる資源の添字 */
  allowed: number[][];
}

/** テスト用の計数（速さを実時間でなく決定的な指標で見る） */
const stats = { satisfyCalls: 0, evalCalls: 0, augments: 0 };

/** 全部アメブで Q まで上げるときの、Lv ごとのアメブの個数の累計。`calcExpAndCandyMixed` の繰り上げ規則と同じ */
function boostSegments(subject: Subject, kind: PositiveBoostKind, q: Point): number[] {
  const cum: number[] = [];
  const dstExp = q.level >= maxLevel ? 0 : q.exp;
  if (isTargetReached(subject.src, q.level, subject.expGot, dstExp)) return cum;
  let total = 0;
  let carry = subject.expGot;
  for (let level = subject.src; level < q.level; level++) {
    const required = calcExp(level, level + 1, subject.expType) - carry;
    if (required <= 0) {
      carry = -required;
      continue;
    }
    const per = calcExpPerCandy(level, subject.nature, kind);
    const count = Math.ceil(required / per);
    total += count;
    cum.push(total);
    carry = per * count - required;
  }
  if (dstExp > 0 && carry < dstExp) {
    const per = calcExpPerCandy(q.level, subject.nature, kind);
    total += Math.ceil((dstExp - carry) / per);
    cum.push(total);
  }
  return cum;
}

interface Subject {
  src: number;
  expGot: number;
  expType: ExpType;
  nature: ExpGainNature;
}

/**
 * target 行が点 q まで届くのに要るアメ（アメブを含む）・かけら。アメブ b 個を低Lv側から先に使い、残りは通常アメ。
 * b は全部アメブで上げる個数でそろえる（`calcExpAndCandyMixed` は余ったアメブを最後に足し込むが、ソルバーは到達点で止まる）。
 */
function targetNeed(subject: Subject, kind: PositiveBoostKind, q: Pick<QInfo, "point" | "all">, b: number): Need {
  if (q.all === 0) return ZERO_NEED;
  stats.evalCalls += 1;
  const m = calcExpAndCandyMixed({
    srcLevel: subject.src,
    dstLevel: q.point.level,
    dstExpInLevel: q.point.exp,
    expType: subject.expType,
    nature: subject.nature,
    boost: kind,
    boostCandy: Math.min(Math.max(0, b), q.all),
    expGot: subject.expGot,
  });
  return { n: m.normalCandy + m.boostCandy, h: m.shards, boost: m.boostCandy };
}

function buildModel(input: Omit<BoostPlanInput, "margins">): Model | null {
  const { plannerInput, current, variableIds } = input;
  const kind = plannerInput.boost.kind;
  if (kind === "none" || variableIds.size === 0) return null;
  const results = pokemonResultsById(current);
  const rows: RowModel[] = [];
  const resourceIndex = new Map<string, number>();
  const caps: number[] = [];
  const allowed: number[][] = [];
  const inventory = plannerInput.candyInventory;
  const resource = (key: string, cap: () => number): number => {
    let index = resourceIndex.get(key);
    if (index === undefined) {
      index = caps.length;
      resourceIndex.set(key, index);
      caps.push(Math.max(0, cap()));
    }
    return index;
  };

  /** ソルバーは枠を上の行から配る。その行に回る残り枠（今の結果で上の行が使ったアメブを引いた数） */
  let quotaLeft = Math.max(0, Math.floor(plannerInput.boost.limit));
  for (const p of plannerInput.pokemonList) {
    const res = results.get(p.pokemonId);
    if (res === undefined) continue; // プランナー入力に無い行は見ない
    const line = res.reachableLine;
    const movable = variableIds.has(p.pokemonId) && p.boostAllowed;
    const requested = p.boostAllowed ? Math.max(0, Math.floor(p.requestedBoostCandy)) : 0;
    const src = p.currentLevel;
    const expGot = p.currentExpInLevel;
    const isTarget = p.candyTarget === undefined || movable;

    let goal: Point = { level: 0, exp: 0 };
    let total: number;
    let cur: number;
    let fixedBoost = 0;
    if (isTarget) {
      if (p.candyTarget === undefined) {
        const level = Math.min(maxLevel, p.targetLevel);
        goal = { level, exp: level >= maxLevel ? 0 : (p.targetExpInLevel ?? 0) };
      } else {
        // 時間の睡眠目標の行: `normalizeInput` と同じく、今のアメの数とアメブで届く点（アメが担当する到達点）
        const count = Math.max(0, Math.floor(p.candyTarget.totalCandyUnits) || 0);
        const boosted = Math.max(0, Math.floor(p.candyTarget.boostedCandyUnits) || 0);
        const reached = simulateCandyBudget(p, Math.min(requested, boosted), count, Infinity, kind);
        goal = { level: reached.level, exp: reached.expInLevel };
      }
      total = isTargetReached(src, goal.level, expGot, goal.exp)
        ? 0
        : calcExp(src, goal.level, p.expType) + goal.exp - expGot;
      const progress = Math.max(0, calcExp(src, line.level, p.expType) + line.expInLevel - expGot);
      cur = line.candyDemandMet ? total : Math.min(total, progress);
      if (!movable) {
        const full = minBoostForTarget({
          srcLevel: src, targetLevel: goal.level, targetExpInLevel: goal.exp, expType: p.expType, nature: p.nature,
          boostKind: kind, maxBoost: Number.MAX_SAFE_INTEGER, expGot,
        });
        fixedBoost = Math.min(requested, full, quotaLeft);
      }
    } else {
      total = Math.max(0, Math.floor(p.candyTarget?.totalCandyUnits ?? 0) || 0);
      cur = line.candyDemandMet ? total : Math.min(total, Math.max(0, line.totalCandyUnitsUsed));
      const boosted = Math.max(0, Math.floor(p.candyTarget?.boostedCandyUnits ?? 0) || 0);
      fixedBoost = Math.min(requested, boosted, total, quotaLeft);
    }
    quotaLeft = Math.max(0, quotaLeft - Math.max(0, line.boostedCandyUnits));

    const speciesIdx = resource(`s:${p.candyFamilyKey}`, () => Math.floor(inventory.species[p.candyFamilyKey] ?? 0));
    const rowAllowed = [speciesIdx];
    if (p.itemsAllowed !== false) {
      rowAllowed.push(resource(`t:${p.type}`, () => {
        const stock = inventory.typeCandy[p.type];
        return stock === undefined ? 0 : stock.s * CANDY_VALUES.type.s + stock.m * CANDY_VALUES.type.m;
      }));
      rowAllowed.push(resource("u", () => {
        const u = inventory.universal;
        return u.s * CANDY_VALUES.universal.s + u.m * CANDY_VALUES.universal.m + u.l * CANDY_VALUES.universal.l;
      }));
    }
    allowed.push(rowAllowed);
    rows.push({
      index: rows.length, id: p.pokemonId, kind: isTarget ? "target" : "count", movable, p,
      src, expGot, expType: p.expType, nature: p.nature, requested, goal, total, fixedBoost, cur, curMet: line.candyDemandMet,
      margin: 0, qCache: new Map(), countNeeds: new Map(),
    });
  }
  if (!rows.some((r) => r.movable)) return null;
  return {
    kind,
    rows,
    dreamShards: plannerInput.dreamShards,
    boostLimit: Math.max(0, Math.floor(plannerInput.boost.limit)),
    caps,
    allowed,
  };
}

/** 進み e の要求点・全アメブ点の表（`total` 以上は目標点 P） */
function qInfoOf(model: Model, row: RowModel, e: number): QInfo {
  const key = Math.min(e, row.total);
  let q = row.qCache.get(key);
  if (q === undefined) {
    let point: Point;
    if (key >= row.total) point = row.goal;
    else {
      const reached = addExpToLevel(row.src, row.expGot, key, row.expType);
      point = { level: reached.level, exp: reached.expInLevel };
    }
    q = qInfoAt(row, model.kind, point);
    row.qCache.set(key, q);
  }
  return q;
}

function qInfoAt(subject: Subject, kind: PositiveBoostKind, point: Point): QInfo {
  const cum = boostSegments(subject, kind, point);
  return { point, cum, all: cum.length > 0 ? cum[cum.length - 1]! : 0, bMax: null, needs: new Map() };
}

/**
 * 動かす行のアメブの上限 B(Q)。ソルバーの `maxBoostFor`（`minBoostForTarget`）と同じ値:
 * 全部アメブで上げる個数（`q.all`）から1個減らしても通常アメが1個以内で済むなら、1個減らした数。
 * `minBoostForTarget` は全アメブの個数を Lv ループで数え直すので、`q.all` と要るアメの表（`needOfTarget`）で出す。
 */
function boostCeiling(kind: PositiveBoostKind, subject: Subject, q: QInfo): number {
  if (q.bMax === null) {
    if (q.all === 0) q.bMax = 0;
    else {
      const less = needOfTarget(kind, subject, q, q.all - 1);
      q.bMax = less.n - less.boost <= 1 ? q.all - 1 : q.all;
    }
  }
  return q.bMax;
}

/** 要求点 q まで、アメブ b で届くのに要るアメ・かけら（q ごとに使い回す） */
function needOfTarget(kind: PositiveBoostKind, subject: Subject, q: QInfo, b: number): Need {
  const key = Math.min(Math.max(0, b), q.all);
  let need = q.needs.get(key);
  if (need === undefined) {
    need = targetNeed(subject, kind, q, key);
    q.needs.set(key, need);
  }
  return need;
}

/** count 行に x 個配ったときの要るアメ・かけら（`simulateCandyBudget` と同じ規則。動かさないので g は固定） */
function needOfCount(model: Model, row: RowModel, x: number): Need {
  if (x <= 0) return ZERO_NEED;
  let need = row.countNeeds.get(x);
  if (need === undefined) {
    stats.evalCalls += 1;
    const run = simulateCandyBudget(row.p, Math.min(row.fixedBoost, x), x, Infinity, model.kind);
    need = { n: run.boostUsed + run.normalUsed, h: run.shards, boost: run.boostUsed };
    row.countNeeds.set(x, need);
  }
  return need;
}

// ---------------------------------------------------------------------------
// 最大流（資源 ↔ 行）
// ---------------------------------------------------------------------------

/**
 * 資源（容量つき）から行へ要る量を配れるかを、増加路で確かめる。行は自分の `allowed` の資源だけから受け取れる。
 * 増加路は、ほかの行が別の資源へ移る付け替えも通る（どの時点でも有効な流れを持つので、`remove` で戻せる）。
 */
class Flow {
  private readonly f: number[][];
  private readonly used: number[];
  readonly placed: number[];
  // 増加路の探索の作業場所（`augment` は何千回も呼ばれるので、毎回作らずに使い回す）
  private readonly seenRow: boolean[];
  private readonly seenRes: boolean[];
  /** 資源を見つけた行（その行がその資源から受け取る） */
  private readonly finder: number[];
  /** 行に来るために通った資源（その行がその資源の分を手放す） */
  private readonly via: number[];
  /** 探す行の待ち行列（行は1回しか入らないので行の数で足りる） */
  private readonly queue: number[];

  constructor(private readonly caps: readonly number[], private readonly allowed: readonly (readonly number[])[]) {
    this.f = allowed.map(() => new Array<number>(caps.length).fill(0));
    this.used = new Array<number>(caps.length).fill(0);
    this.placed = new Array<number>(allowed.length).fill(0);
    this.seenRow = new Array<boolean>(allowed.length).fill(false);
    this.seenRes = new Array<boolean>(caps.length).fill(false);
    this.finder = new Array<number>(caps.length).fill(-1);
    this.via = new Array<number>(allowed.length).fill(-1);
    this.queue = new Array<number>(allowed.length).fill(0);
  }

  /** 行 `start` へ最大 `want` を1本の増加路で足す。足せた量 */
  private augment(start: number, want: number): number {
    stats.augments += 1;
    const rowCount = this.allowed.length;
    const { seenRow, seenRes, finder, via, queue } = this;
    seenRow.fill(false);
    seenRes.fill(false);
    queue[0] = start;
    let tail = 1;
    seenRow[start] = true;
    let end = -1;
    for (let qi = 0; qi < tail && end < 0; qi++) {
      const u = queue[qi]!;
      for (const r of this.allowed[u]!) {
        if (seenRes[r]) continue;
        seenRes[r] = true;
        finder[r] = u;
        if (this.used[r]! < this.caps[r]!) {
          end = r;
          break;
        }
        for (let j = 0; j < rowCount; j++) {
          if (!seenRow[j] && this.f[j]![r]! > 0) {
            seenRow[j] = true;
            via[j] = r;
            queue[tail++] = j;
          }
        }
      }
    }
    if (end < 0) return 0;
    let delta = Math.min(want, this.caps[end]! - this.used[end]!);
    for (let g = end; ;) {
      const u = finder[g]!;
      if (u === start) break;
      const lose = via[u]!;
      delta = Math.min(delta, this.f[u]![lose]!);
      g = lose;
    }
    for (let g = end; ;) {
      const u = finder[g]!;
      this.f[u]![g]! += delta;
      if (u === start) break;
      const lose = via[u]!;
      this.f[u]![lose]! -= delta;
      g = lose;
    }
    this.used[end]! += delta;
    this.placed[start]! += delta;
    return delta;
  }

  /** 行へ `amount` を足す。足せた量（足りなければ配れる分まで） */
  add(row: number, amount: number): number {
    let left = amount;
    while (left > 0) {
      const delta = this.augment(row, left);
      if (delta <= 0) break;
      left -= delta;
    }
    return amount - left;
  }

  remove(row: number, amount: number): void {
    let left = amount;
    for (const r of this.allowed[row]!) {
      if (left <= 0) break;
      const take = Math.min(left, this.f[row]![r]!);
      if (take <= 0) continue;
      this.f[row]![r]! -= take;
      this.used[r]! -= take;
      left -= take;
    }
    this.placed[row]! -= amount - left;
  }

  /** 行の量を `demand` にする。配れなければ何も変えず false */
  set(row: number, demand: number): boolean {
    const have = this.placed[row]!;
    if (demand <= have) {
      this.remove(row, have - demand);
      return true;
    }
    const delta = demand - have;
    const got = this.add(row, delta);
    if (got === delta) return true;
    this.remove(row, got);
    return false;
  }
}

// ---------------------------------------------------------------------------
// satisfy
// ---------------------------------------------------------------------------

type SatisfyMode = "fit" | "all";

interface RowState {
  q: QInfo | null;
  /** 動かす行の今のアメブ（動かさない行は固定の値） */
  b: number;
  need: Need;
  /** 流れに置いている量（要るアメ + 直しの個数） */
  demand: number;
  /** これ以上減らせない */
  sat: boolean;
  step: Step | null | undefined;
}

/** アメブを段の下端まで減らす1手 */
interface Step {
  low: number;
  need: Need;
  /** 増えるアメ */
  dN: number;
  /** 浮くかけら */
  dH: number;
}

interface Solution {
  /** 行ごとのアメブ（動かす行は決めた値、動かさない行は固定の値） */
  boosts: number[];
  /** 行ごとの要求の点（要求が始めの点の行は null） */
  qs: (QInfo | null)[];
}

/**
 * 要求（行ごとの進み。上の行から決めたもの。決めていない行は 0＝始めの点）を満たすアメブの配り方を求める。
 * 1. 動かす行のアメブを B(Q)（要るアメが最少）にし、全員の要るアメを流れで配る。配れなければ null。
 * 2. かけら合計・アメブ合計に収まるまで、動かす行のアメブを段（アメブを使い終える Lv）ごとに減らす。増えるアメ1個あたりの
 *    かけらが一番浮く段から。ΔN ≤ 0 は先に。同じなら今の requestedBoostCandy より多い行、次に上の行を先。
 *    段を丸ごと流せないときは、配れる範囲で一番小さいアメブを二分探索して止め、その行は飽和とする。
 *    - `fit`: 収まった時点で止める（段の途中で収まるなら必要な分だけ減らす）
 *    - `all`: かけらが浮く限り最後まで減らす（かけら最少）
 */
function satisfy(model: Model, reqs: readonly number[], mode: SatisfyMode): Solution | null {
  stats.satisfyCalls += 1;
  const rows = model.rows;
  const flow = new Flow(model.caps, model.allowed);
  const st: RowState[] = [];
  let shardsTotal = 0;
  let boostTotal = 0;
  const demandOf = (row: RowModel, need: Need): number => (need.n > 0 ? need.n + row.margin : 0);

  for (const row of rows) {
    const req = reqs[row.index] ?? 0;
    const s: RowState = { q: null, b: 0, need: ZERO_NEED, demand: 0, sat: false, step: undefined };
    if (req > 0) {
      if (row.kind === "count") {
        s.need = needOfCount(model, row, req);
        s.b = Math.min(row.fixedBoost, req);
      } else {
        const q = qInfoOf(model, row, req);
        s.q = q;
        s.b = row.movable ? boostCeiling(model.kind, row, q) : Math.min(row.fixedBoost, q.all);
        s.need = needOfTarget(model.kind, row, q, s.b);
      }
      s.demand = demandOf(row, s.need);
      if (s.demand > 0 && flow.add(row.index, s.demand) < s.demand) return null;
    }
    st.push(s);
    shardsTotal += s.need.h;
    boostTotal += s.need.boost;
  }

  const shardsViolated = () => shardsTotal > model.dreamShards;
  const boostViolated = () => boostTotal > model.boostLimit;
  const isFit = () => !shardsViolated() && !boostViolated();

  const stepOf = (i: number): Step | null => {
    const s = st[i]!;
    const row = rows[i]!;
    if (!row.movable || s.q === null || s.b <= 0 || s.sat) return null;
    if (s.step !== undefined) return s.step;
    const cum = s.q.cum;
    let k = 0;
    while (k < cum.length - 1 && cum[k]! < s.b) k++;
    const low = k > 0 ? cum[k - 1]! : 0;
    const need = needOfTarget(model.kind, row, s.q, low);
    s.step = { low, need, dN: need.n - s.need.n, dH: s.need.h - need.h };
    return s.step;
  };

  /** 今の状態から見て、この1手がしたいことか（収まっていないものを直す、または かけら最少へ寄せる） */
  const wants = (i: number, step: Step): boolean => {
    const dBoost = st[i]!.need.boost - step.need.boost;
    return (step.dH > 0 && (mode === "all" || shardsViolated())) || (boostViolated() && dBoost > 0);
  };

  /** a の方が先に減らすべきなら true */
  const earlier = (ai: number, a: Step, bi: number, b: Step): boolean => {
    const aFree = a.dN <= 0;
    const bFree = b.dN <= 0;
    if (aFree !== bFree) return aFree;
    if (aFree) {
      if (a.dH !== b.dH) return a.dH > b.dH;
    } else {
      const left = a.dH * b.dN;
      const right = b.dH * a.dN;
      if (left !== right) return left > right;
    }
    const aOver = st[ai]!.b > rows[ai]!.requested;
    const bOver = st[bi]!.b > rows[bi]!.requested;
    if (aOver !== bOver) return aOver;
    return ai < bi;
  };

  const reduce = (i: number, step: Step): void => {
    const s = st[i]!;
    const row = rows[i]!;
    const q = s.q!;
    const bCur = s.b;
    const fitWith = (need: Need) => shardsTotal - s.need.h + need.h <= model.dreamShards && boostTotal - s.need.boost + need.boost <= model.boostLimit;
    let bT = step.low;
    let needT = step.need;
    // この行に流せる量の上限（ほかの行の量は変えず、付け替えは許す）。増加路が尽きるまで足せば上限になるので、1回だけ求める
    const stepDemand = demandOf(row, step.need);
    const room = stepDemand > s.demand ? s.demand + flow.add(i, stepDemand - s.demand) : stepDemand;
    const limited = room < stepDemand;
    if (limited) {
      // 段を丸ごとは流せない。流せる範囲で一番小さいアメブを探す（lo: 流せない、hi: 流せる）
      let lo = step.low;
      let hi = bCur;
      let needHi = s.need;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const need = needOfTarget(model.kind, row, q, mid);
        if (demandOf(row, need) <= room) {
          hi = mid;
          needHi = need;
        } else {
          lo = mid;
        }
      }
      bT = hi;
      needT = needHi;
    }
    if (bT < bCur && mode === "fit" && fitWith(needT)) {
      // 段の途中で収まる。必要な分だけ減らす（lo: 収まる、hi: 収まらない）
      let lo = bT;
      let needLo = needT;
      let hi = bCur;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const need = needOfTarget(model.kind, row, q, mid);
        if (fitWith(need)) {
          lo = mid;
          needLo = need;
        } else {
          hi = mid;
        }
      }
      bT = lo;
      needT = needLo;
    }
    // アメブを減らすと要るアメは増えるだけなので、上限の内側の量は流せる。減らせない・流せないときは今の量へ戻して飽和にする
    if (bT === bCur || !flow.set(i, demandOf(row, needT))) {
      flow.set(i, s.demand);
      s.sat = true;
      return;
    }
    shardsTotal += needT.h - s.need.h;
    boostTotal += needT.boost - s.need.boost;
    s.b = bT;
    s.need = needT;
    s.demand = demandOf(row, needT);
    s.step = undefined;
    if (limited) s.sat = true;
  };

  for (;;) {
    if (mode === "fit" && isFit()) break;
    let best = -1;
    let bestStep: Step | null = null;
    for (let i = 0; i < rows.length; i++) {
      const step = stepOf(i);
      if (step === null || !wants(i, step)) continue;
      if (bestStep === null || earlier(i, step, best, bestStep)) {
        best = i;
        bestStep = step;
      }
    }
    if (bestStep === null) break;
    reduce(best, bestStep);
  }
  if (!isFit()) return null;
  return { boosts: st.map((s) => s.b), qs: st.map((s) => s.q) };
}

// ---------------------------------------------------------------------------
// 到達の決め方
// ---------------------------------------------------------------------------

/** 今の結果と比べた1行分（`compareResults` の `compareLines` と同じ。両方で届いた行は同じ）。a（新）が良ければ正 */
function compareProgress(row: RowModel, next: number): number {
  if (row.total === 0) return 0;
  const nextMet = next >= row.total;
  if (nextMet && row.curMet) return 0;
  if (nextMet !== row.curMet) return nextMet ? 1 : -1;
  return next - row.cur;
}

interface Requests {
  reqs: number[];
  improved: boolean;
}

/**
 * 上の行から1行ずつ、一番先まで届く要求を決める。その行を「届く」にして、上の行の要求と一緒に満たせれば届く。
 * 満たせなければ、満たせる一番先の進みを二分探索する。下限は今の進み（それも満たせなければ始めの点で、上限を今の進みにする）。
 * 今の進みから1つ先も満たせなければ探さない（満たせるかは進みについて単調なので、二分探索の答えと同じ）。
 * 今より伸びていなければ（上の行から比べて、最初に違う行が悪い・全部同じ）improved は false。
 * 伸びないと決まった時点で残りを求めずに終える（そのときの reqs は使わない）:
 * 上の行がどれも今と同じで、この行が今の進みを満たせない（今より悪い）、またはこの行が要求のある最後の行で
 * 今の進みより先を満たせない（全部同じ）とき。
 */
function decideRequests(model: Model): Requests {
  const rows = model.rows;
  const reqs = rows.map(() => 0);
  const notImproved = (): Requests => ({ reqs, improved: false });
  let lastIndex = -1;
  for (const row of rows) if (row.total > 0) lastIndex = row.index;
  /** 上の行から比べて最初に違う行の差（まだ全部同じなら 0） */
  let lead = 0;
  for (const row of rows) {
    if (row.total === 0) continue;
    reqs[row.index] = row.total;
    if (satisfy(model, reqs, "fit") === null) {
      // 届かない。上の行が今と同じなら、今届いている行は悪くなる・今の進みより先を満たせなければ伸びない
      if (lead === 0 && row.curMet) return notImproved();
      let lo = 0;
      let hi = row.total; // lo: 満たせる、hi: 満たせない
      if (!row.curMet && row.cur > 0) {
        reqs[row.index] = row.cur;
        if (satisfy(model, reqs, "fit") !== null) lo = row.cur;
        else if (lead === 0) return notImproved();
        else hi = row.cur;
      }
      // 今の進みから1つ先も満たせなければ、探さずに今の進みに決める（伸びない行で二分探索を空回りさせない）
      if (lo === row.cur && lo + 1 < hi) {
        reqs[row.index] = lo + 1;
        if (satisfy(model, reqs, "fit") !== null) lo += 1;
        else if (lead === 0 && row.index === lastIndex) return notImproved();
        else hi = lo + 1;
      }
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        reqs[row.index] = mid;
        if (satisfy(model, reqs, "fit") !== null) lo = mid;
        else hi = mid;
      }
      reqs[row.index] = lo;
    }
    if (lead === 0) {
      lead = compareProgress(row, reqs[row.index]!);
      if (lead < 0) return notImproved();
    }
  }
  return { reqs, improved: lead > 0 };
}

/**
 * 今のアメブを残す規則（§5.4）。動かす行で、決めたアメブでも今のアメブでも、その行の要るアメ・かけら（と使うアメブ）が同じに
 * なるときは今のアメブのまま入れる（動かしたアメブを少なくするため。ソルバーは届かない行のアメブを配れたアメの数で
 * 抑えるので、同じ結果になる）。何も受け取らない行（要求が始めの点）も今のまま。
 */
function keepCurrentBoost(kind: PositiveBoostKind, row: RowModel, q: QInfo | null, decided: number): number {
  if (q === null) return row.requested;
  const a = needOfTarget(kind, row, q, decided);
  const c = needOfTarget(kind, row, q, row.requested);
  return a.n === c.n && a.h === c.h && a.boost === c.boost ? row.requested : decided;
}

/** 同じ入力（プランナー入力・今の結果・動かす行）で、節約するもの・直しの個数を変えて何度も求める */
export interface BoostPlanner {
  plan(saving: RaiseSaving, margins?: ReadonlyMap<string, number>): BoostPlan;
}

/**
 * モデル（行の分類・資源・要るアメ・かけらの表）を1回だけ作り、`plan` で使い回す。到達の決め方（`decideRequests`）は
 * 節約するものによらないので、同じ直しの個数なら1回だけ求める（アメ節約 → かけら節約、直しで求め直すときに速い）。
 */
export function createBoostPlanner(input: Omit<BoostPlanInput, "margins">): BoostPlanner {
  const model = buildModel(input);
  const decided = new Map<string, Requests>();
  return {
    plan(saving, margins) {
      if (model === null) return { kind: "none" };
      for (const row of model.rows) row.margin = Math.max(0, Math.floor(margins?.get(row.id) ?? 0));
      const key = model.rows.map((row) => row.margin).join(",");
      let requests = decided.get(key);
      if (requests === undefined) {
        requests = decideRequests(model);
        decided.set(key, requests);
      }
      const { reqs, improved } = requests;
      if (!improved) return { kind: "none" };
      const solution = satisfy(model, reqs, saving === "candy" ? "fit" : "all");
      if (solution === null) return { kind: "none" };
      const boosts = new Map<string, number>();
      const predictedMet = new Set<string>();
      for (const row of model.rows) {
        if (reqs[row.index]! >= row.total) predictedMet.add(row.id);
        if (!row.movable) continue;
        boosts.set(row.id, keepCurrentBoost(model.kind, row, solution.qs[row.index]!, solution.boosts[row.index]!));
      }
      return { kind: "plan", boosts, predictedMet };
    },
  };
}

/** 1回だけ求める（`createBoostPlanner(input).plan(saving, input.margins)`） */
export function planBoosts(input: BoostPlanInput, saving: RaiseSaving): BoostPlan {
  return createBoostPlanner(input).plan(saving, input.margins);
}

/** テスト用。モデルの内部を直接確かめる */
export const __boostPlanTestHooks = {
  stats,
  resetStats(): void {
    stats.satisfyCalls = 0;
    stats.evalCalls = 0;
    stats.augments = 0;
  },
  /** target 行が点 q まで届くのに要るアメ・かけら（ソルバーの経路との一致を確かめる） */
  targetNeed(subject: Subject, kind: PositiveBoostKind, point: Point, b: number): Need {
    return targetNeed(subject, kind, qInfoAt(subject, kind, point), b);
  },
  boostSegments,
  /** 動かす行のアメブの上限 B(q)（`minBoostForTarget` との一致を確かめる） */
  boostCeiling(subject: Subject, kind: PositiveBoostKind, point: Point): number {
    return boostCeiling(kind, subject, qInfoAt(subject, kind, point));
  },
  Flow,
};
