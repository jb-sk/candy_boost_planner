/**
 * 「全体のLvを伸ばす」。全員のアメブ（とそれで決まる使うアメの数）をまとめて動かし、届かない行を上から順に伸ばす。
 *
 * 1歩ごとに、変えた行一覧の候補をいくつか作り、本物のソルバーで解いて、良くなったものの中で一番良いものを入れる。
 * 良くなったか（`compareResults`）は計算機の優先順位と同じく上の行から比べる。上の行の到達点を下げる候補は採らない。
 * 候補は次の順に作る。
 * 1. 先頭の届かない行への「〇〇のLvを上げる」（`adviseRows` のおすすめ量。アメが足りない・かけらが足りない）
 * 2. 届かない行（上から順）へのアメブの付け替え:
 *    - アメで止まっている行: 上の行のアメブを減らし、その分をその行へ回す。上の行は減らした分だけアメが要るので、
 *      その行の種族アメが余っているときだけ試す（余りが無いと共有のアメを取り合うだけで、合計は変わらない）
 *    - アメブ枠で止まっている行: 上の行のアメブを減らして枠を空ける
 *    - かけらで止まっている行: その行と上の行のアメブを減らす（浮いたかけらが回る）
 * ソルバーは1回 20ms〜1秒ほどかかるので、1歩で試す候補の数と、全体の歩数・時間に上限を置く。
 * ストア・Vue を値で import しない。ストアの関数は `AdviceDeps` で受け取る。
 */
import type { CalcRow, EvaluatedRows, SpeciesCandyOverride } from "../../composables/useCalcStore";
import type { LevelPlannerInput, LevelPlannerResult, PokemonPlanResult, ShortageType } from "../level-planner/types";
import { adviseRows, createAdviceContext, DIAGNOSIS_DIRECTION, diagnose, type AdviceDeps } from "./advice";
import { boostSlotRemaining, canAdjustLevel, type FineTuneBase } from "./draft";

export type SolvePlan = (input: LevelPlannerInput) => Promise<LevelPlannerResult>;

export interface RaiseInput {
  deps: AdviceDeps;
  base: Pick<FineTuneBase, "boostLimit">;
  /** 今の下書きの行一覧 */
  rows: readonly CalcRow[];
  /** 下書きで変えた種族アメの在庫（評価のときに在庫の代わりに使う） */
  speciesCandy?: SpeciesCandyOverride;
  /** `rows` を解いた結果がもうあれば渡す（はじめに解き直さない） */
  initialResult?: LevelPlannerResult;
  solve: SolvePlan;
  /** true を返すと途中で止める（閉じた・下書きが変わった） */
  isCancelled?: () => boolean;
  /** 歩数の上限 */
  maxSteps?: number;
  /** 時間の上限（ms）。超えたら、それまでに見つけた一番良い行一覧を返す */
  timeBudgetMs?: number;
  now?: () => number;
}

export type RaiseOutcome =
  /** 伸びた。`rows` は入れる行一覧、`result` はそれを解いた結果 */
  | { kind: "raised"; rows: readonly CalcRow[]; result: LevelPlannerResult; steps: number }
  /** はじめから全員が目標Lvに届いている */
  | { kind: "allReached" }
  /** 試したどの候補でも伸びなかった。`limitingFactor` は先頭の届かない行を止めているもの */
  | { kind: "unchanged"; limitingFactor: ShortageType | null }
  /** アメブなしのスロット・計算できる行が無い */
  | { kind: "unavailable" }
  | { kind: "cancelled" };

/**
 * 解かずに分かる「全体のLvを伸ばす」の見込み（`checkRaise`）。`possible` は試す候補があり、解くまで分からない。
 * ほかは押しても `raiseLevels` が同じ結果を返す（候補が1つも無ければ解く前に `unchanged` と分かる）。
 */
export type RaiseCheck =
  | { kind: "possible" }
  | Extract<RaiseOutcome, { kind: "allReached" | "unchanged" | "unavailable" }>;

export const RAISE_MAX_STEPS = 12;
export const RAISE_TIME_BUDGET_MS = 8000;
/** 1つの届かない行に対して試す、付け替えの相手の数（アメブの多い順） */
const TRANSFER_PARTNERS = 4;
/** 付け替えを試す届かない行の数（上から） */
const TRANSFER_TARGETS = 3;

interface Point {
  rows: readonly CalcRow[];
  evaluated: EvaluatedRows;
  result: LevelPlannerResult;
  speciesCandy: SpeciesCandyOverride;
}

function resultById(result: LevelPlannerResult): Map<string, PokemonPlanResult> {
  const map = new Map<string, PokemonPlanResult>();
  for (const p of result.pokemonResults) map.set(p.pokemonId, p);
  return map;
}

/**
 * 上の行から到達点（Lv、Lv内のEXP）を比べ、最初に違う行で決める。a が良ければ正、悪ければ負、同じなら 0。
 * 届いた行は目標で止まるので、届いた行どうしは同じになる。どちらかの結果に無い行は飛ばす。
 */
export function compareResults(a: LevelPlannerResult, b: LevelPlannerResult, rows: readonly CalcRow[]): number {
  const am = resultById(a);
  const bm = resultById(b);
  for (const row of rows) {
    const pa = am.get(row.id)?.reachableLine;
    const pb = bm.get(row.id)?.reachableLine;
    if (pa === undefined || pb === undefined) continue;
    if (pa.level !== pb.level) return pa.level - pb.level;
    if (pa.expInLevel !== pb.expInLevel) return pa.expInLevel - pb.expInLevel;
  }
  return 0;
}

function withBoosts(deps: AdviceDeps, rows: readonly CalcRow[], changes: ReadonlyMap<string, number>): CalcRow[] {
  return rows.map((row) => {
    const boost = changes.get(row.id);
    return boost === undefined ? row : deps.withExplicitBoost(row, boost, { preserveTargetForExplicitBoost: true });
  });
}

/** 1の候補: 先頭の届かない行への「〇〇のLvを上げる」 */
function recommendationCandidates(deps: AdviceDeps, base: RaiseInput["base"], point: Point): Map<string, number>[] {
  const kind = point.evaluated.plannerInput?.boost.kind ?? "none";
  const diagnosis = diagnose(point.result, point.rows, kind, boostSlotRemaining(base, point.evaluated));
  const direction = DIAGNOSIS_DIRECTION[diagnosis.kind];
  if (direction === null) return [];
  const ctx = createAdviceContext({
    deps,
    base,
    // 設定（設定欄で変えたもの）は deps が今の下書きの設定で読むので、ここでは持たない
    state: { version: 0, rows: point.rows, candyRecords: {}, speciesCandy: point.speciesCandy, settings: {} },
    evaluated: point.evaluated,
    result: point.result,
  });
  const candidates: Map<string, number>[] = [];
  for (const entry of adviseRows(ctx, direction).values()) {
    const rec = entry.recommendation;
    if (rec === null || rec.boost === point.evaluated.byId.get(entry.rowId)?.effectiveBoost) continue;
    candidates.push(new Map([[entry.rowId, rec.boost]]));
  }
  return candidates;
}

/** 2の候補: 届かない行 `targetId` へのアメブの付け替え */
function transferCandidates(point: Point, targetId: string): Map<string, number>[] {
  const res = resultById(point.result).get(targetId);
  const index = point.rows.findIndex((row) => row.id === targetId);
  const target = point.rows[index];
  const item = point.evaluated.byId.get(targetId);
  if (res === undefined || target === undefined || item === undefined) return [];
  const factor = res.constraintDiagnosis.limitingFactor;
  const boostOf = (row: CalcRow) => point.evaluated.byId.get(row.id)?.effectiveBoost ?? 0;
  const familyOf = (row: CalcRow) => point.evaluated.plannerInput?.pokemonList.find((p) => p.pokemonId === row.id)?.candyFamilyKey;
  /** その行の進化系の種族アメの余り（ほかの行は使えない） */
  const speciesLeftOf = (row: CalcRow) => {
    const family = familyOf(row);
    return family === undefined ? 0 : Math.max(0, point.result.summary.speciesCandyRemaining[family] ?? 0);
  };
  // 上の行のうち、アメブを減らせる行（アメブの多い順）。アメで止まっている行へ回すときは、種族アメの余る行だけ
  const partners = point.rows.slice(0, index)
    .filter((row) => canAdjustLevel(point.evaluated, row) && boostOf(row) > 0)
    .filter((row) => factor !== "candy" || speciesLeftOf(row) > 0)
    .sort((a, b) => boostOf(b) - boostOf(a))
    .slice(0, TRANSFER_PARTNERS);
  const candidates: Map<string, number>[] = [];
  const halves = (n: number) => [...new Set([n, Math.ceil(n / 2)])].filter((k) => k > 0);

  if (factor === "shards") {
    // 減らした分のかけらが届かない行へ回る。届かない行自身も減らせば、同じかけらでアメを多く使える
    const own = canAdjustLevel(point.evaluated, target) ? [target] : [];
    for (const row of [...own, ...partners]) {
      for (const k of halves(boostOf(row))) candidates.push(new Map([[row.id, boostOf(row) - k]]));
    }
    return candidates;
  }
  if (!canAdjustLevel(point.evaluated, target)) return [];
  // アメブ枠で止まっている行は、要るアメブ（実効アメブ）に枠が回っていない分。アメで止まっている行は全アメブ点までの分
  const granted = res.reachableLine.boostedCandyUnits;
  const want = factor === "boost"
    ? Math.max(0, item.effectiveBoost - granted)
    : Math.max(0, item.fullBoost - item.effectiveBoost);
  if (want <= 0) return [];
  for (const partner of partners) {
    // アメで止まっている行へは、上の行が余りの種族アメで賄える分まで
    const limit = factor === "candy" ? Math.min(want, boostOf(partner), speciesLeftOf(partner)) : Math.min(want, boostOf(partner));
    for (const k of halves(limit)) {
      const changes = new Map([[partner.id, boostOf(partner) - k]]);
      // 枠で止まっている行は、空いた枠をソルバーがそのまま回す。アメで止まっている行は、その分アメブを増やす
      if (factor !== "boost") changes.set(targetId, item.effectiveBoost + k);
      candidates.push(changes);
    }
  }
  return candidates;
}

/** 先頭の届かない行を止めているもの */
function limitingFactorOf(point: Point): ShortageType | null {
  const firstShort = unreachedIds(point)[0];
  return firstShort === undefined
    ? null
    : resultById(point.result).get(firstShort)?.constraintDiagnosis.limitingFactor ?? null;
}

function unreachedIds(point: Point): string[] {
  const byId = resultById(point.result);
  return point.rows
    .filter((row) => {
      const res = byId.get(row.id);
      return res !== undefined && !res.reachableLine.effectiveTargetReached;
    })
    .map((row) => row.id);
}

/**
 * 今の行一覧とその結果から、ソルバーを使わずに「全体のLvを伸ばす」の見込みを出す。
 * `raiseLevels` の最初の1歩と同じ候補を作り、1つも無ければ `unchanged`（押しても伸びない）。
 */
export function checkRaise(input: {
  deps: AdviceDeps;
  base: RaiseInput["base"];
  rows: readonly CalcRow[];
  speciesCandy?: SpeciesCandyOverride;
  evaluated: EvaluatedRows;
  result: LevelPlannerResult;
}): RaiseCheck {
  const { deps, base, rows, evaluated, result } = input;
  if (evaluated.plannerInput === null || evaluated.plannerInput.boost.kind === "none") return { kind: "unavailable" };
  const point: Point = { rows, evaluated, result, speciesCandy: input.speciesCandy ?? {} };
  const unreached = unreachedIds(point);
  if (unreached.length === 0) return { kind: "allReached" };
  if (recommendationCandidates(deps, base, point).length > 0) return { kind: "possible" };
  if (unreached.slice(0, TRANSFER_TARGETS).some((id) => transferCandidates(point, id).length > 0)) return { kind: "possible" };
  return { kind: "unchanged", limitingFactor: limitingFactorOf(point) };
}

export async function raiseLevels(input: RaiseInput): Promise<RaiseOutcome> {
  const { deps, base, solve } = input;
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const budget = input.timeBudgetMs ?? RAISE_TIME_BUDGET_MS;
  const maxSteps = input.maxSteps ?? RAISE_MAX_STEPS;
  const cancelled = () => input.isCancelled?.() === true;
  const outOfTime = () => now() - startedAt > budget;

  const speciesCandy = input.speciesCandy ?? {};
  const evaluated = deps.evaluateRows(input.rows, speciesCandy);
  const plannerInput = evaluated.plannerInput;
  if (plannerInput === null || plannerInput.boost.kind === "none") return { kind: "unavailable" };
  const initial: Point = { rows: input.rows, evaluated, result: input.initialResult ?? await solve(plannerInput), speciesCandy };
  if (cancelled()) return { kind: "cancelled" };
  if (unreachedIds(initial).length === 0) return { kind: "allReached" };

  /** 候補を解き、今より良くなったものの中で一番良いものを返す。無ければ null */
  async function bestOf(current: Point, candidates: Map<string, number>[]): Promise<Point | null | "cancelled"> {
    let best: Point | null = null;
    for (const changes of candidates) {
      if (cancelled()) return "cancelled";
      if (outOfTime()) break;
      const rows = withBoosts(deps, current.rows, changes);
      const next = deps.evaluateRows(rows, speciesCandy);
      if (next.plannerInput === null) continue;
      const result = await solve(next.plannerInput);
      if (compareResults(result, (best ?? current).result, current.rows) > 0) best = { rows, evaluated: next, result, speciesCandy };
    }
    return best;
  }

  let point = initial;
  let steps = 0;
  while (steps < maxSteps && !outOfTime()) {
    let next = await bestOf(point, recommendationCandidates(deps, base, point));
    if (next === "cancelled") return { kind: "cancelled" };
    if (next === null) {
      for (const targetId of unreachedIds(point).slice(0, TRANSFER_TARGETS)) {
        const found = await bestOf(point, transferCandidates(point, targetId));
        if (found === "cancelled") return { kind: "cancelled" };
        if (found !== null) {
          next = found;
          break;
        }
      }
    }
    if (next === null) break;
    point = next;
    steps += 1;
  }
  if (cancelled()) return { kind: "cancelled" };
  if (steps > 0) return { kind: "raised", rows: point.rows, result: point.result, steps };
  return { kind: "unchanged", limitingFactor: limitingFactorOf(point) };
}
