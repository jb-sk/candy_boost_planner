/**
 * 「全体のLvを伸ばす」。全員のアメブ（とそれで決まる使うアメの数）をまとめて動かし、届かない行を上から順に伸ばす。
 *
 * 1歩ごとに、変えた行一覧の候補をいくつか作り、本物のソルバーで解いて、良くなったものの中で一番良いものを入れる。
 * 良くなったか（`compareResults`）は計算機の優先順位と同じく上の行から比べる。上の行の到達点を下げる候補は採らない。
 * 候補は次の順に作る。
 * 1. 先頭の届かない行への「〇〇のLvを上げる」（`adviseRows` のおすすめ量。アメが足りない・かけらが足りない）
 * 2. 届かない行（上から順）へのアメブの付け替え:
 *    - アメ・アメブ枠で止まっている行: 上の行のアメブを減らし、その分をその行へ回す（枠が足りないとき）
 *    - かけらで止まっている行: その行と上の行のアメブを減らす（浮いたかけらが回る）
 * ソルバーは1回 20ms ほどかかるので、1歩で試す候補の数と、全体の歩数・時間に上限を置く。
 * ストア・Vue を値で import しない。ストアの関数は `AdviceDeps` で受け取る。
 */
import type { CalcRow, EvaluatedRows } from "../../composables/useCalcStore";
import type { LevelPlannerInput, LevelPlannerResult, PokemonPlanResult } from "../level-planner/types";
import { adviseRows, createAdviceContext, DIAGNOSIS_DIRECTION, diagnose, type AdviceDeps } from "./advice";
import { boostSlotRemaining, canAdjustLevel, type FineTuneBase } from "./draft";

export type SolvePlan = (input: LevelPlannerInput) => Promise<LevelPlannerResult>;

export interface RaiseInput {
  deps: AdviceDeps;
  base: Pick<FineTuneBase, "boostLimit">;
  /** 今の下書きの行一覧 */
  rows: readonly CalcRow[];
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
  /** 試したどの候補でも伸びなかった */
  | { kind: "unchanged" }
  /** アメブなしのスロット・計算できる行が無い */
  | { kind: "unavailable" }
  | { kind: "cancelled" };

export const RAISE_MAX_STEPS = 12;
export const RAISE_TIME_BUDGET_MS = 6000;
/** 1つの届かない行に対して試す、付け替えの相手の数（アメブの多い順） */
const TRANSFER_PARTNERS = 4;
/** 付け替えを試す届かない行の数（上から） */
const TRANSFER_TARGETS = 3;

interface Point {
  rows: readonly CalcRow[];
  evaluated: EvaluatedRows;
  result: LevelPlannerResult;
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
    state: { version: 0, rows: point.rows },
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
  // 上の行のうち、アメブを減らせる行（アメブの多い順）
  const partners = point.rows.slice(0, index)
    .filter((row) => canAdjustLevel(point.evaluated, row) && boostOf(row) > 0)
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
    for (const k of halves(Math.min(want, boostOf(partner)))) {
      const changes = new Map([[partner.id, boostOf(partner) - k]]);
      // 枠で止まっている行は、空いた枠をソルバーがそのまま回す。アメで止まっている行は、その分アメブを増やす
      if (factor !== "boost") changes.set(targetId, item.effectiveBoost + k);
      candidates.push(changes);
    }
  }
  return candidates;
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

export async function raiseLevels(input: RaiseInput): Promise<RaiseOutcome> {
  const { deps, base, solve } = input;
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const budget = input.timeBudgetMs ?? RAISE_TIME_BUDGET_MS;
  const maxSteps = input.maxSteps ?? RAISE_MAX_STEPS;
  const cancelled = () => input.isCancelled?.() === true;
  const outOfTime = () => now() - startedAt > budget;

  const evaluated = deps.evaluateRows(input.rows);
  const plannerInput = evaluated.plannerInput;
  if (plannerInput === null || plannerInput.boost.kind === "none") return { kind: "unavailable" };
  const initial: Point = { rows: input.rows, evaluated, result: await solve(plannerInput) };
  if (cancelled()) return { kind: "cancelled" };
  if (unreachedIds(initial).length === 0) return { kind: "allReached" };

  /** 候補を解き、今より良くなったものの中で一番良いものを返す。無ければ null */
  async function bestOf(current: Point, candidates: Map<string, number>[]): Promise<Point | null | "cancelled"> {
    let best: Point | null = null;
    for (const changes of candidates) {
      if (cancelled()) return "cancelled";
      if (outOfTime()) break;
      const rows = withBoosts(deps, current.rows, changes);
      const next = deps.evaluateRows(rows);
      if (next.plannerInput === null) continue;
      const result = await solve(next.plannerInput);
      if (compareResults(result, (best ?? current).result, current.rows) > 0) best = { rows, evaluated: next, result };
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
  return steps === 0 ? { kind: "unchanged" } : { kind: "raised", rows: point.rows, result: point.result, steps };
}
