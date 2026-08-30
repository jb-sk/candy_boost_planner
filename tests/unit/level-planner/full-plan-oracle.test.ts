import { describe, expect, it } from 'vitest';
import { CANDY_VALUES, MAX_ACCEPTABLE_SURPLUS } from '../../../src/domain/level-planner/constants';
import { __levelPlannerTestHooks, solveLevelPlan } from '../../../src/domain/level-planner/core/solveLevelPlan';
import type {
  BoostKind,
  CandyInventory,
  CandySupplyBreakdown,
  LevelPlannerInput,
  LevelPlannerResult,
  PokemonPlanInput,
  PokemonPlanLine,
  SolverItemCompareMode,
  TypeCandyStock,
  UniversalCandyStock,
} from '../../../src/domain/level-planner/types';
import type { ExpGainNature, ExpType } from '../../../src/domain/types';
import { calcExp, calcExpAndCandyMixed, calcExpPerCandy } from '../../../src/domain/pokesleep/exp';
import { boostRules } from '../../../src/domain/pokesleep/boost-config';
import { minBoostForTarget } from '../../../src/domain/pokesleep/minBoostForTarget';
import { dreamShardsPerCandy, maxLevel } from '../../../src/domain/pokesleep/tables';

type OracleCandidate = {
  pokemon: PokemonPlanInput & { targetExpInLevel: number; requestedBoostCandy: number; effectiveLevel: number; effectiveExp: number };
  line: PokemonPlanLine;
};

type OracleUsage = {
  boost: number;
  shards: number;
  species: Record<string, number>;
  type: Record<string, TypeCandyStock>;
  universal: UniversalCandyStock;
};

type OracleMetrics = {
  zeroSurplusCount: number;
  speciesUsed: number;
  rawSurplus: number;
  reachedSurplus: number;
  normalizedSurplus: number;
  surplusExp: number;
  /**
   * 比較キーとしてのかけら消費。**`usage.shards`（全行）ではなくこちらを使う。**
   * `usage` は在庫超過の検査（`canConsume`）専用で、集計範囲が「全行」なので目的関数には使えない。
   */
  shards: number;
  speciesLex: number;
  itemPriority: number[];
  legacyItemPriority: number[];
};

type OraclePlan = {
  choices: OracleCandidate[];
  usage: OracleUsage;
  reachedPrefixCount: number;
  boundary?: OracleCandidate;
  metrics: OracleMetrics;
};

type OracleResult = {
  best: OraclePlan;
  planCount: number;
  candidateCounts: number[];
};

type OracleCheckResult = 'checked-feasibility' | 'checked-refined' | 'skipped-too-large';
type SolverPlan = {
  plan: OraclePlan;
  result: LevelPlannerResult;
};
type OptimizationOraclePolicy = {
  /** この集合に入った行だけ、将来のスライダーでアメブ・かけらを譲れる。 */
  donorPokemonIds: Set<string>;
};

const modes: SolverItemCompareMode[] = ['surplusFirst', 'legacyImproved', 'surplusGateFirst'];
const expTypes: ExpType[] = [600, 900];
const natures: ExpGainNature[] = ['down', 'normal', 'up'];
const boostKinds: BoostKind[] = ['none', 'mini', 'full'];
const MAX_ORACLE_PLANS = 250_000;
const DEFAULT_RANDOM_DETECTION_RUNS = 25;

const emptySupply = (): CandySupplyBreakdown => ({ species: 0, type: { s: 0, m: 0 }, universal: { s: 0, m: 0, l: 0 } });
const emptyUsage = (): OracleUsage => ({ boost: 0, shards: 0, species: {}, type: {}, universal: { s: 0, m: 0, l: 0 } });

function supplyValue(supply: CandySupplyBreakdown): number {
  return supply.species
    + supply.type.s * CANDY_VALUES.type.s
    + supply.type.m * CANDY_VALUES.type.m
    + supply.universal.s * CANDY_VALUES.universal.s
    + supply.universal.m * CANDY_VALUES.universal.m
    + supply.universal.l * CANDY_VALUES.universal.l;
}

function speciesKey(pokemon: Pick<PokemonPlanInput, 'candyFamilyKey'>): string {
  return pokemon.candyFamilyKey;
}

function compareNumbers(a: number[], b: number[]): number {
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function itemPriority(supply: CandySupplyBreakdown): number[] {
  return [supply.type.s, supply.type.m, supply.universal.s, supply.universal.m, supply.universal.l];
}

function legacyItemPriority(supply: CandySupplyBreakdown): number[] {
  return [-supply.universal.l, -supply.universal.m, supply.type.s, supply.type.m];
}

function isLegacyLikeMode(mode: SolverItemCompareMode): boolean {
  return mode === 'legacyImproved' || mode === 'surplusGateFirst';
}

function usesZeroSurplusPriority(mode: SolverItemCompareMode): boolean {
  return mode === 'surplusFirst' || mode === 'surplusGateFirst' || mode === 'legacyImproved';
}

function emptyMetrics(): OracleMetrics {
  return {
    zeroSurplusCount: 0,
    speciesUsed: 0,
    rawSurplus: 0,
    reachedSurplus: 0,
    normalizedSurplus: 0,
    surplusExp: 0,
    shards: 0,
    speciesLex: 0,
    itemPriority: [0, 0, 0, 0, 0],
    legacyItemPriority: [0, 0, 0, 0],
  };
}

function mergeUsage(a: OracleUsage, b: OracleUsage): OracleUsage {
  const usage: OracleUsage = {
    boost: a.boost + b.boost,
    shards: a.shards + b.shards,
    species: { ...a.species },
    type: Object.fromEntries(Object.entries(a.type).map(([key, value]) => [key, { ...value }])),
    universal: {
      s: a.universal.s + b.universal.s,
      m: a.universal.m + b.universal.m,
      l: a.universal.l + b.universal.l,
    },
  };
  for (const [key, value] of Object.entries(b.species)) usage.species[key] = (usage.species[key] ?? 0) + value;
  for (const [key, value] of Object.entries(b.type)) {
    usage.type[key] = {
      s: (usage.type[key]?.s ?? 0) + value.s,
      m: (usage.type[key]?.m ?? 0) + value.m,
    };
  }
  return usage;
}

function usageFrom(pokemon: PokemonPlanInput, line: PokemonPlanLine): OracleUsage {
  return {
    boost: line.boostedCandyUnits,
    shards: line.dreamShardsUsed,
    species: { [speciesKey(pokemon)]: line.candySupply.species },
    type: { [pokemon.type]: { ...line.candySupply.type } },
    universal: { ...line.candySupply.universal },
  };
}

function canConsume(usage: OracleUsage, input: LevelPlannerInput): boolean {
  if (usage.boost > input.boost.limit || usage.shards > input.dreamShards) return false;
  if (usage.universal.s > input.candyInventory.universal.s) return false;
  if (usage.universal.m > input.candyInventory.universal.m) return false;
  if (usage.universal.l > input.candyInventory.universal.l) return false;
  for (const [key, value] of Object.entries(usage.species)) {
    if (value > (input.candyInventory.species[key] ?? 0)) return false;
  }
  for (const [key, value] of Object.entries(usage.type)) {
    const stock = input.candyInventory.typeCandy[key] ?? { s: 0, m: 0 };
    if (value.s > stock.s || value.m > stock.m) return false;
  }
  return true;
}

function candidateUsesZeroSurplusPriority(candidate: OracleCandidate, mode: SolverItemCompareMode): boolean {
  return Boolean(candidate.pokemon.preferZeroSurplus)
    || (usesZeroSurplusPriority(mode) && candidate.line.level >= maxLevel && candidate.line.expInLevel === 0);
}
function candidateAchievedZeroSurplusPriority(candidate: OracleCandidate, mode: SolverItemCompareMode): boolean {
  return candidateUsesZeroSurplusPriority(candidate, mode) && candidate.line.surplusCandyValue === 0;
}

function appendMetrics(metrics: OracleMetrics, candidate: OracleCandidate, mode: SolverItemCompareMode): OracleMetrics {
  const priority = itemPriority(candidate.line.candySupply);
  const legacyPriority = legacyItemPriority(candidate.line.candySupply);
  return {
    zeroSurplusCount: metrics.zeroSurplusCount + (candidateAchievedZeroSurplusPriority(candidate, mode) ? 1 : 0),
    speciesUsed: metrics.speciesUsed + candidate.line.candySupply.species,
    rawSurplus: metrics.rawSurplus + candidate.line.surplusCandyValue,
    reachedSurplus: metrics.reachedSurplus + (candidate.line.candyDemandMet ? candidate.line.surplusCandyValue : 0),
    normalizedSurplus: metrics.normalizedSurplus + (candidate.line.surplusCandyValue <= MAX_ACCEPTABLE_SURPLUS ? 0 : candidate.line.surplusCandyValue),
    surplusExp: metrics.surplusExp + candidate.line.surplusExp,
    shards: metrics.shards + candidate.line.dreamShardsUsed,
    speciesLex: metrics.speciesLex - candidate.line.candySupply.species * candidate.pokemon.priorityIndex,
    itemPriority: metrics.itemPriority.map((value, index) => value + priority[index]),
    legacyItemPriority: metrics.legacyItemPriority.map((value, index) => value + legacyPriority[index]),
  };
}

/**
 * 候補列からプランを組む。
 *
 * **⚠ 比較キー（`metrics`）は到達prefix ＋ 境界の範囲だけで集計する。境界より下を混ぜない。**
 *
 * 仕様の優先順位は「**到達済み上位の**余り合計最小」（`level-planner-allocation-policy-spec.md` §258）で、
 * 境界より下は §14.4 で「到達数・境界EXPの保証対象外」かつ
 * 「残ったかけら・アメブ枠・アメ在庫で優先順位順に個別処理する」（同 §3-5、フェーズ3）と決まっている。
 * **下位へ配ること自体が仕様なので、下位の余りを比較キーに足すと「配らないほうが余りが小さい」となり、
 * 仕様どおり配る実装が負ける。** 実測（2026-07-31・seed=168）:
 *
 * ```text
 * 実装    : 下位行に 種族1 + 万能S1（total 2・余り2）を配る   ← フェーズ3 の仕様どおり
 * 旧oracle: 下位行に 0 個（余り0）で「勝ち」                   ← 下位の余りを全体に足していた
 * ```
 *
 * `usage`（資源の使用量）は在庫超過の検査に要るので**全行ぶん**を集計する。集計範囲が違うのは意図的。
 * 下位行の配分そのものは `lower-row-residual-allocation.test.ts`（フェーズ3の回帰）が受け持つ。
 *
 * > **⚠ `usage` を比較キーに使ってはいけない。`canConsume` 専用である。**
 * > 2026-07-31 に `metrics` の集計範囲だけを直したが、**かけらは `usage.shards` のまま比較に残っていた**
 * > （2026-08-01 に外部レビューで指摘され修正）。下位行を育てたプランは `metrics` が完全一致したあと
 * > `usage.shards` の比較で負けるので、**修正したはずの「配らないほうが勝つ」が、かけら軸だけ生き残っていた。**
 * > 比較キーに要る資源量は `metrics`（到達prefix＋境界）側へ足すこと。
 */
function buildPlan(choices: OracleCandidate[], mode: SolverItemCompareMode): OraclePlan {
  let usage = emptyUsage();
  let metrics = emptyMetrics();
  let reachedPrefixCount = 0;
  let boundary: OracleCandidate | undefined;
  for (const [index, candidate] of choices.entries()) {
    usage = mergeUsage(usage, usageFrom(candidate.pokemon, candidate.line));
    if (!boundary) metrics = appendMetrics(metrics, candidate, mode);
    if (!boundary && candidate.line.candyDemandMet) reachedPrefixCount = index + 1;
    else if (!boundary) boundary = candidate;
  }
  return { choices, usage, reachedPrefixCount, boundary, metrics };
}

function satisfiesSurplusFirstGate(plan: OraclePlan): boolean {
  return plan.choices
    .slice(0, Math.min(plan.choices.length, plan.reachedPrefixCount + (plan.boundary ? 1 : 0)))
    .every(choice => choice.line.surplusCandyValue <= MAX_ACCEPTABLE_SURPLUS);
}

function compareLevel(a: { level: number; expInLevel: number }, b: { level: number; expInLevel: number }): number {
  return a.level - b.level || a.expInLevel - b.expInLevel;
}

function compareCoreAllocationPlan(a: OraclePlan, b: OraclePlan, mode: SolverItemCompareMode): number {
  if (mode === 'surplusFirst') {
    if (a.reachedPrefixCount !== b.reachedPrefixCount) return a.reachedPrefixCount > b.reachedPrefixCount ? 1 : -1;
    if (a.metrics.reachedSurplus !== b.metrics.reachedSurplus) return a.metrics.reachedSurplus < b.metrics.reachedSurplus ? 1 : -1;
    if (a.boundary && b.boundary) {
      const boundary = compareLevel(a.boundary.line, b.boundary.line);
      if (boundary) return boundary > 0 ? 1 : -1;
    } else if (!a.boundary && b.boundary) return 1;
    else if (a.boundary && !b.boundary) return -1;
    if (a.metrics.zeroSurplusCount !== b.metrics.zeroSurplusCount) return a.metrics.zeroSurplusCount > b.metrics.zeroSurplusCount ? 1 : -1;
    if (a.metrics.rawSurplus !== b.metrics.rawSurplus) return a.metrics.rawSurplus < b.metrics.rawSurplus ? 1 : -1;
    const item = compareNumbers(a.metrics.itemPriority, b.metrics.itemPriority);
    if (item) return item;
    if (a.metrics.surplusExp !== b.metrics.surplusExp) return a.metrics.surplusExp < b.metrics.surplusExp ? 1 : -1;
    if (a.metrics.shards !== b.metrics.shards) return a.metrics.shards < b.metrics.shards ? 1 : -1;
    return 0;
  }
  if (a.reachedPrefixCount !== b.reachedPrefixCount) return a.reachedPrefixCount > b.reachedPrefixCount ? 1 : -1;
  if (a.metrics.speciesUsed !== b.metrics.speciesUsed) return a.metrics.speciesUsed > b.metrics.speciesUsed ? 1 : -1;
  if (usesZeroSurplusPriority(mode) && a.metrics.zeroSurplusCount !== b.metrics.zeroSurplusCount) {
    return a.metrics.zeroSurplusCount > b.metrics.zeroSurplusCount ? 1 : -1;
  }
  if (isLegacyLikeMode(mode)) {
    const acceptableA = a.metrics.normalizedSurplus === 0;
    const acceptableB = b.metrics.normalizedSurplus === 0;
    if (acceptableA !== acceptableB) return acceptableA ? 1 : -1;
    if (!acceptableA && a.metrics.normalizedSurplus !== b.metrics.normalizedSurplus) {
      return a.metrics.normalizedSurplus < b.metrics.normalizedSurplus ? 1 : -1;
    }
    const legacyItem = compareNumbers(a.metrics.legacyItemPriority, b.metrics.legacyItemPriority);
    if (legacyItem) return legacyItem;
    if (a.metrics.rawSurplus !== b.metrics.rawSurplus) return a.metrics.rawSurplus < b.metrics.rawSurplus ? 1 : -1;
  } else {
    if (a.metrics.rawSurplus !== b.metrics.rawSurplus) return a.metrics.rawSurplus < b.metrics.rawSurplus ? 1 : -1;
    const item = compareNumbers(a.metrics.itemPriority, b.metrics.itemPriority);
    if (item) return item;
  }
  if (a.metrics.surplusExp !== b.metrics.surplusExp) return a.metrics.surplusExp < b.metrics.surplusExp ? 1 : -1;
  if (a.metrics.shards !== b.metrics.shards) return a.metrics.shards < b.metrics.shards ? 1 : -1;
  return 0;
}

function compareFeasibilityPlan(a: OraclePlan, b: OraclePlan, mode: SolverItemCompareMode): number {
  if (mode === 'surplusFirst') {
    if (a.reachedPrefixCount !== b.reachedPrefixCount) return a.reachedPrefixCount > b.reachedPrefixCount ? 1 : -1;
    if (a.metrics.reachedSurplus !== b.metrics.reachedSurplus) return a.metrics.reachedSurplus < b.metrics.reachedSurplus ? 1 : -1;
    if (a.boundary && b.boundary) {
      const boundary = compareLevel(a.boundary.line, b.boundary.line);
      if (boundary) return boundary > 0 ? 1 : -1;
    } else if (!a.boundary && b.boundary) return 1;
    else if (a.boundary && !b.boundary) return -1;
    if (a.metrics.zeroSurplusCount !== b.metrics.zeroSurplusCount) return a.metrics.zeroSurplusCount > b.metrics.zeroSurplusCount ? 1 : -1;
    if (a.metrics.rawSurplus !== b.metrics.rawSurplus) return a.metrics.rawSurplus < b.metrics.rawSurplus ? 1 : -1;
    return 0;
  }
  if (a.reachedPrefixCount !== b.reachedPrefixCount) return a.reachedPrefixCount > b.reachedPrefixCount ? 1 : -1;
  if (!a.boundary && !b.boundary) return 0;
  if (!a.boundary) return -1;
  if (!b.boundary) return 1;
  return compareLevel(a.boundary.line, b.boundary.line);
}

function compareFixedDemandSupplyPlan(a: OraclePlan, b: OraclePlan, mode: SolverItemCompareMode): number {
  if (a.metrics.speciesUsed !== b.metrics.speciesUsed) return a.metrics.speciesUsed > b.metrics.speciesUsed ? 1 : -1;
  if (mode === 'surplusFirst') {
    if (a.metrics.reachedSurplus !== b.metrics.reachedSurplus) return a.metrics.reachedSurplus < b.metrics.reachedSurplus ? 1 : -1;
    if (a.metrics.zeroSurplusCount !== b.metrics.zeroSurplusCount) return a.metrics.zeroSurplusCount > b.metrics.zeroSurplusCount ? 1 : -1;
    if (a.metrics.rawSurplus !== b.metrics.rawSurplus) return a.metrics.rawSurplus < b.metrics.rawSurplus ? 1 : -1;
  }
  if (isLegacyLikeMode(mode)) {
    if (a.metrics.zeroSurplusCount !== b.metrics.zeroSurplusCount) return a.metrics.zeroSurplusCount > b.metrics.zeroSurplusCount ? 1 : -1;
    const acceptableA = a.metrics.normalizedSurplus === 0;
    const acceptableB = b.metrics.normalizedSurplus === 0;
    if (acceptableA !== acceptableB) return acceptableA ? 1 : -1;
    if (!acceptableA && a.metrics.normalizedSurplus !== b.metrics.normalizedSurplus) {
      return a.metrics.normalizedSurplus < b.metrics.normalizedSurplus ? 1 : -1;
    }
    const legacyItem = compareNumbers(a.metrics.legacyItemPriority, b.metrics.legacyItemPriority);
    if (legacyItem) return legacyItem;
    if (a.metrics.rawSurplus !== b.metrics.rawSurplus) return a.metrics.rawSurplus < b.metrics.rawSurplus ? 1 : -1;
  }
  const item = compareNumbers(a.metrics.itemPriority, b.metrics.itemPriority);
  if (item) return item;
  if (a.metrics.speciesLex !== b.metrics.speciesLex) return a.metrics.speciesLex > b.metrics.speciesLex ? 1 : -1;
  return 0;
}

function simulate(
  pokemon: Pick<PokemonPlanInput, 'currentLevel' | 'currentExpInLevel' | 'expType' | 'nature'>,
  boostBudget: number,
  normalBudget: number,
  shardLimit: number,
  targetLevel: number,
  targetExp: number,
  kind: BoostKind,
) {
  let level = pokemon.currentLevel;
  let expInLevel = pokemon.currentExpInLevel;
  let boost = Math.max(0, Math.floor(boostBudget));
  let normal = Math.max(0, Math.floor(normalBudget));
  let boostUsed = 0;
  let normalUsed = 0;
  let shards = 0;
  const useCandy = (isBoost: boolean): boolean => {
    const available = isBoost ? boost : normal;
    if (available <= 0) return false;
    const shard = (dreamShardsPerCandy[level + 1] ?? 0) * (isBoost ? boostRules[kind].shardMultiplier : 1);
    if (shards + shard > shardLimit) return false;
    if (isBoost) {
      boost--;
      boostUsed++;
    } else {
      normal--;
      normalUsed++;
    }
    expInLevel += calcExpPerCandy(level, pokemon.nature, isBoost ? kind : 'none');
    shards += shard;
    while (level < maxLevel) {
      const needed = calcExp(level, level + 1, pokemon.expType);
      if (expInLevel < needed) break;
      expInLevel -= needed;
      level++;
    }
    return true;
  };
  while (level < targetLevel || (level === targetLevel && expInLevel < targetExp)) {
    if (boost > 0) {
      if (!useCandy(true)) break;
      continue;
    }
    if (!useCandy(false)) break;
  }
  return {
    level,
    expInLevel: level >= maxLevel ? 0 : expInLevel,
    boostUsed,
    normalUsed,
    shards,
    expGained: calcExp(pokemon.currentLevel, level, pokemon.expType) + expInLevel - pokemon.currentExpInLevel,
  };
}

function simulateCandyBudget(
  pokemon: Pick<PokemonPlanInput, 'currentLevel' | 'currentExpInLevel' | 'expType' | 'nature'>,
  boostBudget: number,
  totalBudget: number,
  shardLimit: number,
  kind: BoostKind,
) {
  let level = pokemon.currentLevel;
  let expInLevel = pokemon.currentExpInLevel;
  let boost = Math.max(0, Math.floor(boostBudget));
  let remaining = Math.max(0, Math.floor(totalBudget));
  let boostUsed = 0;
  let normalUsed = 0;
  let shards = 0;
  const useCandy = (isBoost: boolean): boolean => {
    if (remaining <= 0 || level >= maxLevel) return false;
    if (isBoost && boost <= 0) return false;
    const shard = (dreamShardsPerCandy[level + 1] ?? 0) * (isBoost ? boostRules[kind].shardMultiplier : 1);
    if (shards + shard > shardLimit) return false;
    if (isBoost) {
      boost--;
      boostUsed++;
    } else normalUsed++;
    remaining--;
    expInLevel += calcExpPerCandy(level, pokemon.nature, isBoost ? kind : 'none');
    shards += shard;
    while (level < maxLevel) {
      const needed = calcExp(level, level + 1, pokemon.expType);
      if (expInLevel < needed) break;
      expInLevel -= needed;
      level++;
    }
    return true;
  };
  // アメブ予算が残っている間は、かけら不足を理由に通常アメへ振り替えない（実装と同じ規則）。
  while (remaining > 0 && level < maxLevel) {
    if (boost > 0) {
      if (!useCandy(true)) break;
      continue;
    }
    if (!useCandy(false)) break;
  }
  return {
    level,
    expInLevel: level >= maxLevel ? 0 : expInLevel,
    boostUsed,
    normalUsed,
    shards,
    expGained: calcExp(pokemon.currentLevel, level, pokemon.expType) + expInLevel - pokemon.currentExpInLevel,
  };
}

function candyTargetBoostCap(pokemon: Pick<OracleCandidate['pokemon'], 'candyTarget' | 'requestedBoostCandy'>, requestedBoostCandy: number, kind: BoostKind): number {
  if (kind === 'none' || !pokemon.candyTarget) return 0;
  return Math.min(Math.max(0, requestedBoostCandy), pokemon.candyTarget.boostedCandyUnits);
}

function normalizePokemon(input: LevelPlannerInput, _mode: SolverItemCompareMode): OracleCandidate['pokemon'][] {
  const kind = input.boost.kind;
  return input.pokemonList.map((pokemon, priorityIndex) => {
    const targetLevel = Math.min(maxLevel, pokemon.targetLevel);
    const targetExpInLevel = targetLevel >= maxLevel ? 0 : (pokemon.targetExpInLevel ?? 0);
    const requestedBoostCandy = kind === 'none' || !pokemon.boostAllowed ? 0 : Math.max(0, Math.floor(pokemon.requestedBoostCandy));
    let effectiveLevel = targetLevel;
    let effectiveExp = targetExpInLevel;
    if (pokemon.candyTarget) {
      const boosted = candyTargetBoostCap(pokemon as OracleCandidate['pokemon'], requestedBoostCandy, kind);
      const reached = simulateCandyBudget(pokemon, boosted, pokemon.candyTarget.totalCandyUnits, Infinity, kind);
      effectiveLevel = reached.level;
      effectiveExp = reached.expInLevel;
    }
    return { ...pokemon, priorityIndex, targetLevel, targetExpInLevel, requestedBoostCandy, effectiveLevel, effectiveExp, preferZeroSurplus: Boolean(pokemon.preferZeroSurplus) };
  });
}

function targetMixed(pokemon: OracleCandidate['pokemon'], kind: BoostKind, boost: number): { boostCandy: number; normalCandy: number; shards: number } {
  const reached = simulate(pokemon, boost, Number.MAX_SAFE_INTEGER, Infinity, pokemon.effectiveLevel, pokemon.effectiveExp, kind);
  return { boostCandy: reached.boostUsed, normalCandy: reached.normalUsed, shards: reached.shards };
}

/**
 * 仕様上のアメブ個数（canonical boost）を、実装のロジックを写さずに総当たりで決める。
 *
 * `level-planner-allocation-policy-spec.md` §4 は「余分なアメブ（到達に不要）はコアでも抑制する。
 * 目標到達時に『アメブ1個 → 通常アメ1個』へ置換しても到達できるなら、アメブを使わず通常アメを使う」
 * と定めている。これを宣言的に書くと **`(総アメ数, アメブ数)` の辞書順最小**になる。
 *
 * **⚠ 置換の成立条件（①目標到達 ②通常アメ1個以下 ③総数不変 ④置換後も到達）を写してはいけない。**
 * 写すと独立オラクルが実装と同じ判断を持ち、実装が間違っても両方が同じ間違いをして通る。
 * ここは条件を1つも持たず、`simulate`（アメを1個ずつ投入するシミュレーション）で全アメブ数を試し、
 * 目的関数だけで選ぶ。実装は閉形式（`calcExpAndCandy` の ceil ＋ `-1` の置換試行）なのでアルゴリズムが違う。
 *
 * 2026-08-01 の掃引（Lv1→70 / mini・full / 性格3種 / EXP型2種 / 端数あり、59,616件・置換発火29,838件）で
 * 実装の `minBoostForTarget` と不一致0だった。**ただしこれは範囲確認であって証明ではない**（§18.1）。
 */
function canonicalBoostFor(pokemon: OracleCandidate['pokemon'], kind: BoostKind): number {
  const upper = targetMixed(pokemon, kind, Number.MAX_SAFE_INTEGER).boostCandy;
  let bestBoost = upper;
  let bestTotal = Number.MAX_SAFE_INTEGER;
  for (let boost = 0; boost <= upper; boost++) {
    const used = targetMixed(pokemon, kind, boost);
    const total = used.boostCandy + used.normalCandy;
    if (total < bestTotal || (total === bestTotal && used.boostCandy < bestBoost)) {
      bestTotal = total;
      bestBoost = used.boostCandy;
    }
  }
  return bestBoost;
}

function maxBoostFor(pokemon: OracleCandidate['pokemon'], input: LevelPlannerInput, remainingBoost: number): number {
  if (pokemon.candyTarget) return Math.min(candyTargetBoostCap(pokemon, pokemon.requestedBoostCandy, input.boost.kind), Math.max(0, remainingBoost));
  // §4 の `min(requestedBoostCandy, 優先順位順に残った枠で賄える分)`。canonical は枠無制限で出してから切る。
  return Math.min(pokemon.requestedBoostCandy, canonicalBoostFor(pokemon, input.boost.kind), Math.max(0, remainingBoost));
}

function remainingInventory(input: LevelPlannerInput, usage: OracleUsage): CandyInventory {
  const species: Record<string, number> = {};
  for (const [key, amount] of Object.entries(input.candyInventory.species)) {
    species[key] = Math.max(0, amount - (usage.species[key] ?? 0));
  }
  const typeCandy: CandyInventory['typeCandy'] = {};
  for (const [key, amount] of Object.entries(input.candyInventory.typeCandy)) {
    const used = usage.type[key] ?? { s: 0, m: 0 };
    typeCandy[key] = { s: Math.max(0, amount.s - used.s), m: Math.max(0, amount.m - used.m) };
  }
  return {
    species,
    typeCandy,
    universal: {
      s: Math.max(0, input.candyInventory.universal.s - usage.universal.s),
      m: Math.max(0, input.candyInventory.universal.m - usage.universal.m),
      l: Math.max(0, input.candyInventory.universal.l - usage.universal.l),
    },
  };
}

function inventoryValueFor(pokemon: PokemonPlanInput, inventory: CandyInventory): number {
  const type = inventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  return (inventory.species[speciesKey(pokemon)] ?? 0)
    + type.s * CANDY_VALUES.type.s
    + type.m * CANDY_VALUES.type.m
    + inventory.universal.s * CANDY_VALUES.universal.s
    + inventory.universal.m * CANDY_VALUES.universal.m
    + inventory.universal.l * CANDY_VALUES.universal.l;
}

function makeLine(
  pokemon: OracleCandidate['pokemon'],
  input: LevelPlannerInput,
  boostBudget: number,
  normalBudget: number,
  shardLimit: number,
  supply: CandySupplyBreakdown,
): PokemonPlanLine {
  const reached = simulate(pokemon, boostBudget, normalBudget, shardLimit, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
  const totalCandyUnitsUsed = reached.boostUsed + reached.normalUsed;
  return {
    level: reached.level,
    expInLevel: reached.expInLevel,
    expToNextLevel: Math.max(0, calcExp(reached.level, reached.level + 1, pokemon.expType) - reached.expInLevel),
    expToTarget: Math.max(0, calcExp(reached.level, pokemon.effectiveLevel, pokemon.expType) + pokemon.effectiveExp - reached.expInLevel),
    totalCandyUnitsUsed,
    boostedCandyUnits: reached.boostUsed,
    nonBoostCandyUnits: reached.normalUsed,
    candySupply: supply,
    dreamShardsUsed: reached.shards,
    expGained: reached.expGained,
    surplusExp: Math.max(0, reached.expInLevel - pokemon.effectiveExp),
    surplusCandyValue: Math.max(0, supplyValue(supply) - totalCandyUnitsUsed),
    candyDemandMet: compareLevel(reached, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) >= 0,
    effectiveTargetReached: compareLevel(reached, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) >= 0
      || reached.level >= maxLevel,
  };
}

function makeCandyTargetLine(
  pokemon: OracleCandidate['pokemon'],
  input: LevelPlannerInput,
  boostBudget: number,
  totalBudget: number,
  shardLimit: number,
  supply: CandySupplyBreakdown,
): PokemonPlanLine {
  const reached = simulateCandyBudget(pokemon, boostBudget, totalBudget, shardLimit, input.boost.kind);
  const totalCandyUnitsUsed = reached.boostUsed + reached.normalUsed;
  const targetTotal = pokemon.candyTarget?.totalCandyUnits ?? totalBudget;
  return {
    level: reached.level,
    expInLevel: reached.expInLevel,
    expToNextLevel: Math.max(0, calcExp(reached.level, reached.level + 1, pokemon.expType) - reached.expInLevel),
    expToTarget: Math.max(0, calcExp(reached.level, pokemon.effectiveLevel, pokemon.expType) + pokemon.effectiveExp - reached.expInLevel),
    totalCandyUnitsUsed,
    boostedCandyUnits: reached.boostUsed,
    nonBoostCandyUnits: reached.normalUsed,
    candySupply: supply,
    dreamShardsUsed: reached.shards,
    expGained: reached.expGained,
    surplusExp: Math.max(0, reached.expInLevel - pokemon.effectiveExp),
    surplusCandyValue: Math.max(0, supplyValue(supply) - totalCandyUnitsUsed),
    candyDemandMet: totalCandyUnitsUsed >= targetTotal || reached.level >= maxLevel,
    effectiveTargetReached: compareLevel(reached, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) >= 0
      || reached.level >= maxLevel,
  };
}

function enumerateSupplies(
  total: number,
  pokemon: PokemonPlanInput,
  inventory: CandyInventory,
  fixedSpecies?: number,
): CandySupplyBreakdown[] {
  if (total === 0) return fixedSpecies === undefined || fixedSpecies === 0 ? [emptySupply()] : [];
  const type = inventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const universal = inventory.universal;
  const result: CandySupplyBreakdown[] = [];
  const speciesMax = Math.min(inventory.species[speciesKey(pokemon)] ?? 0, total);
  // 種族アメはfamily単位の残在庫を、優先順位順に各行で先に使い切る。
  const speciesValues = fixedSpecies === undefined ? [speciesMax] : [fixedSpecies];
  for (const species of speciesValues) {
    if (species < 0 || species > speciesMax) continue;
    for (let typeS = 0; typeS <= type.s; typeS++) {
      for (let typeM = 0; typeM <= type.m; typeM++) {
        for (let universalS = 0; universalS <= universal.s; universalS++) {
          for (let universalM = 0; universalM <= universal.m; universalM++) {
            for (let universalL = 0; universalL <= universal.l; universalL++) {
              const supply = { species, type: { s: typeS, m: typeM }, universal: { s: universalS, m: universalM, l: universalL } };
              if (supplyValue(supply) >= total) result.push(supply);
            }
          }
        }
      }
    }
  }
  return result;
}

/**
 * 行1つぶんの候補を総当たりで作る。
 *
 * **アメブ個数は `maxBoostFor` の1値だけを使う**（探索するのは通常アメと供給内訳）。
 * その1値は `canonicalBoostFor` が仕様の目的関数から独立に決める。
 *
 * > **⚠ アメブ個数を 0〜上限で振ってはいけない。**
 * > `level-planner-allocation-policy-spec.md` §4 は「アメブは優先順位順に確定し、最適化のために
 * > 再配分しない」と定めている。振ると仕様外の候補（境界行のアメブを削る／総アメ数を増やして
 * > アメブを削る）まで作られ、**仕様どおりに振る舞う実装がオラクルに負ける。**
 * > 2026-07-31 に一度その方向で試み、別の seed で落ち続けた（seed=300 → 84 → 11 → 168）。
 *
 * > **⚠ そこから「アメブ個数は全プランoracleの検証範囲外」と結論したのは誤りだった
 * > （2026-07-31 の判断。2026-08-01 に外部レビューの指摘を受けて撤回）。**
 * > 変異テストで実証済み: 置換を止める変異（到達に不要なアメブを1個余分に使う。**総アメ数は不変**）を
 * > 入れても、旧オラクルは 1000ラン × `mini` / `full` で1件も落ちなかった。
 * > その変異は 1000 seed 中 **131 seed でソルバー出力を実際に変えている**（seed=290: `boost=0/2 → 0/3`、
 * > 総アメ 3/3 のまま到達 `6+70 → 6+110`）。`compareFeasibilityPlan` は到達prefixと境界行の Lv+EXP しか
 * > 見ないため、到達済み行のアメブ差は同点になっていた。
 * >
 * > **「4条件を写すと独立性が消える」は正しいが、そこから「仕様をオラクルに持たせない」へ進んだのが誤り。**
 * > 独立性とは異なる仕様を持つことではなく、**同じ仕様を異なるアルゴリズムで判定すること**である。
 * > 宣言的な目的関数（`canonicalBoostFor`）なら、条件を1つも写さずに仕様を表せる。
 * > canonical 導入後は同じ変異が 572ms で落ちる（`phase=feasibility` の比較負け。
 * > 余分なアメブがかけらを食って到達数が落ちるため）。
 *
 * `solveByFixedDemandSupplyOracle` だけは `fixedBoost` でアメブ数を**実装の witness から固定して**受け取る
 * （`fixedSpecies` と同じ扱い）。refine の契約はアメブを動かさないので、そこでは探索軸ではないため。
 */
function enumerateCandidates(
  pokemon: OracleCandidate['pokemon'],
  input: LevelPlannerInput,
  usage: OracleUsage,
  fixedSpecies?: number,
  fixedBoost?: number,
): OracleCandidate[] {
  const inventory = remainingInventory(input, usage);
  const remainingBoost = Math.max(0, input.boost.limit - usage.boost);
  const remainingShards = Math.max(0, input.dreamShards - usage.shards);
  const boostBudget = fixedBoost ?? maxBoostFor(pokemon, input, remainingBoost);
  if (pokemon.candyTarget) {
    const maxTotalBudget = Math.min(pokemon.candyTarget.totalCandyUnits, Math.max(0, inventoryValueFor(pokemon, inventory)));
    const candidates: OracleCandidate[] = [];
    for (let totalBudget = 0; totalBudget <= maxTotalBudget; totalBudget++) {
      const requestedBoost = Math.min(boostBudget, totalBudget);
      const reached = simulateCandyBudget(pokemon, requestedBoost, totalBudget, remainingShards, input.boost.kind);
      const total = reached.boostUsed + reached.normalUsed;
      for (const supply of enumerateSupplies(total, pokemon, inventory, fixedSpecies)) {
        candidates.push({
          pokemon,
          line: makeCandyTargetLine(pokemon, input, requestedBoost, totalBudget, remainingShards, supply),
        });
      }
    }
    return candidates;
  }
  const target = targetMixed(pokemon, input.boost.kind, boostBudget);
  const targetTotal = target.boostCandy + target.normalCandy;
  const maxCandyBudget = Math.min(
    targetTotal,
    Math.max(0, inventoryValueFor(pokemon, inventory)),
  );
  const byUse = new Map<string, { boostBudget: number; normalBudget: number; total: number }>();
  for (let normalBudget = 0; normalBudget <= maxCandyBudget; normalBudget++) {
    const reached = simulate(pokemon, boostBudget, normalBudget, remainingShards, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
    const total = reached.boostUsed + reached.normalUsed;
    const key = `${reached.level}/${reached.expInLevel}/${reached.boostUsed}/${reached.normalUsed}/${reached.shards}`;
    if (!byUse.has(key)) byUse.set(key, { boostBudget, normalBudget, total });
  }
  const candidates: OracleCandidate[] = [];
  for (const option of byUse.values()) {
    for (const supply of enumerateSupplies(option.total, pokemon, inventory, fixedSpecies)) {
      candidates.push({ pokemon, line: makeLine(pokemon, input, option.boostBudget, option.normalBudget, remainingShards, supply) });
    }
  }
  return candidates;
}

function enumerateOptimizationPreviewCandidates(
  pokemon: OracleCandidate['pokemon'],
  input: LevelPlannerInput,
  usage: OracleUsage,
  policy: OptimizationOraclePolicy,
): OracleCandidate[] {
  const inventory = remainingInventory(input, usage);
  const remainingBoost = Math.max(0, input.boost.limit - usage.boost);
  const remainingShards = Math.max(0, input.dreamShards - usage.shards);
  const maxBoost = maxBoostFor(pokemon, input, remainingBoost);
  const boostValues = policy.donorPokemonIds.has(pokemon.pokemonId)
    ? Array.from({ length: maxBoost + 1 }, (_, value) => value)
    : [maxBoost];
  const candidates: OracleCandidate[] = [];
  for (const boostBudget of boostValues) {
    const target = targetMixed(pokemon, input.boost.kind, boostBudget);
    if (pokemon.candyTarget) {
      const totalBudget = Math.min(pokemon.candyTarget.totalCandyUnits, Math.max(0, inventoryValueFor(pokemon, inventory)));
      const reached = simulateCandyBudget(pokemon, Math.min(boostBudget, totalBudget), totalBudget, remainingShards, input.boost.kind);
      const total = reached.boostUsed + reached.normalUsed;
      for (const supply of enumerateSupplies(total, pokemon, inventory)) {
        candidates.push({ pokemon, line: makeCandyTargetLine(pokemon, input, Math.min(boostBudget, totalBudget), totalBudget, remainingShards, supply) });
      }
      continue;
    }
    const targetTotal = target.boostCandy + target.normalCandy;
    const maxCandyBudget = Math.min(
      targetTotal,
      Math.max(0, inventoryValueFor(pokemon, inventory)),
    );
    const byUse = new Map<string, { boostBudget: number; normalBudget: number; total: number }>();
    for (let normalBudget = 0; normalBudget <= maxCandyBudget; normalBudget++) {
      const reached = simulate(pokemon, boostBudget, normalBudget, remainingShards, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
      const total = reached.boostUsed + reached.normalUsed;
      const key = `${reached.level}/${reached.expInLevel}/${reached.boostUsed}/${reached.normalUsed}/${reached.shards}`;
      if (!byUse.has(key)) byUse.set(key, { boostBudget, normalBudget, total });
    }
    for (const option of byUse.values()) {
      for (const supply of enumerateSupplies(option.total, pokemon, inventory)) {
        candidates.push({ pokemon, line: makeLine(pokemon, input, option.boostBudget, option.normalBudget, remainingShards, supply) });
      }
    }
  }
  return candidates;
}

function compareOptimizationPreviewPlan(a: OraclePlan, b: OraclePlan, mode: SolverItemCompareMode): number {
  if (a.reachedPrefixCount !== b.reachedPrefixCount) return a.reachedPrefixCount > b.reachedPrefixCount ? 1 : -1;
  if (a.boundary && b.boundary) {
    const boundary = compareLevel(a.boundary.line, b.boundary.line);
    if (boundary) return boundary;
  }
  return compareCoreAllocationPlan(a, b, mode);
}

function solveByCoreAllocationOracle(rawInput: LevelPlannerInput, mode: SolverItemCompareMode, label = ''): OracleResult {
  const input = {
    ...rawInput,
    boost: { ...rawInput.boost, limit: rawInput.boost.kind === 'none' ? 0 : rawInput.boost.limit },
    options: { ...(rawInput.options ?? {}), itemCompareMode: mode },
  };
  const pokemonList = normalizePokemon(input, mode);
  const candidateCounts = Array.from({ length: pokemonList.length }, () => 0);
  let best: OraclePlan | undefined;
  let planCount = 0;
  const visit = (index: number, choices: OracleCandidate[], usage: OracleUsage): void => {
    if (index === pokemonList.length) {
      const plan = buildPlan(choices, mode);
      if (mode === 'surplusFirst' && !satisfiesSurplusFirstGate(plan)) return;
      planCount++;
      if (!best || compareCoreAllocationPlan(plan, best, mode) > 0) best = plan;
      return;
    }
    const candidates = enumerateCandidates(pokemonList[index], input, usage);
    candidateCounts[index] = Math.max(candidateCounts[index], candidates.length);
    for (const candidate of candidates) {
      const nextUsage = mergeUsage(usage, usageFrom(candidate.pokemon, candidate.line));
      if (!canConsume(nextUsage, input)) continue;
      if (planCount > MAX_ORACLE_PLANS) throw new Error(`full-plan oracle exploded: ${label}, ${planCount} plans, candidates=${candidateCounts.join(',')}`);
      visit(index + 1, [...choices, candidate], nextUsage);
    }
  };
  visit(0, [], emptyUsage());
  if (!best) throw new Error(`full-plan oracle found no feasible plan: candidates=${candidateCounts.join(',')}`);
  return { best, planCount, candidateCounts };
}

function solveByFeasibilityOracle(rawInput: LevelPlannerInput, mode: SolverItemCompareMode, label = ''): OracleResult {
  const input = {
    ...rawInput,
    boost: { ...rawInput.boost, limit: rawInput.boost.kind === 'none' ? 0 : rawInput.boost.limit },
    options: { ...(rawInput.options ?? {}), itemCompareMode: mode },
  };
  const pokemonList = normalizePokemon(input, mode);
  const candidateCounts = Array.from({ length: pokemonList.length }, () => 0);
  let best: OraclePlan | undefined;
  let planCount = 0;
  const visit = (index: number, choices: OracleCandidate[], usage: OracleUsage): void => {
    if (index === pokemonList.length) {
      const plan = buildPlan(choices, mode);
      if (mode === 'surplusFirst' && !satisfiesSurplusFirstGate(plan)) return;
      planCount++;
      if (!best || compareFeasibilityPlan(plan, best, mode) > 0) best = plan;
      return;
    }
    const candidates = enumerateCandidates(pokemonList[index], input, usage);
    candidateCounts[index] = Math.max(candidateCounts[index], candidates.length);
    for (const candidate of candidates) {
      const nextUsage = mergeUsage(usage, usageFrom(candidate.pokemon, candidate.line));
      if (!canConsume(nextUsage, input)) continue;
      if (planCount > MAX_ORACLE_PLANS) throw new Error(`full-plan oracle exploded: ${label}, ${planCount} plans, candidates=${candidateCounts.join(',')}`);
      visit(index + 1, [...choices, candidate], nextUsage);
    }
  };
  visit(0, [], emptyUsage());
  if (!best) throw new Error(`full-plan oracle found no feasible plan: candidates=${candidateCounts.join(',')}`);
  return { best, planCount, candidateCounts };
}

function sameFixedDemandShape(a: OraclePlan, b: OraclePlan): boolean {
  return a.choices.length === b.choices.length
    && a.choices.every((candidate, index) => {
      const other = b.choices[index];
      return candidate.line.level === other.line.level
        && candidate.line.expInLevel === other.line.expInLevel
        && candidate.line.candyDemandMet === other.line.candyDemandMet
        && candidate.line.totalCandyUnitsUsed === other.line.totalCandyUnitsUsed
        && candidate.line.boostedCandyUnits === other.line.boostedCandyUnits
        && candidate.line.nonBoostCandyUnits === other.line.nonBoostCandyUnits
        && candidate.line.dreamShardsUsed === other.line.dreamShardsUsed;
    });
}

function solveByFixedDemandSupplyOracle(rawInput: LevelPlannerInput, mode: SolverItemCompareMode, fixedDemand: OraclePlan, label = ''): OracleResult {
  const input = {
    ...rawInput,
    boost: { ...rawInput.boost, limit: rawInput.boost.kind === 'none' ? 0 : rawInput.boost.limit },
    options: { ...(rawInput.options ?? {}), itemCompareMode: mode },
  };
  const pokemonList = normalizePokemon(input, mode);
  const candidateCounts = Array.from({ length: pokemonList.length }, () => 0);
  let best: OraclePlan | undefined;
  let planCount = 0;
  const visit = (index: number, choices: OracleCandidate[], usage: OracleUsage): void => {
    if (index === pokemonList.length) {
      const plan = buildPlan(choices, mode);
      if (!sameFixedDemandShape(plan, fixedDemand)) return;
      if (mode === 'surplusFirst' && !satisfiesSurplusFirstGate(plan)) return;
      planCount++;
      if (!best || compareFixedDemandSupplyPlan(plan, best, mode) > 0) best = plan;
      return;
    }
    const candidates = enumerateCandidates(
      pokemonList[index],
      input,
      usage,
      fixedDemand.choices[index]?.line.candySupply.species,
      // アメブ個数は実装の witness から固定する（`enumerateCandidates` の docblock 参照）。
      // ここは「形を固定して供給内訳だけを検証する」オラクルなので、アメブは探索軸ではない。
      fixedDemand.choices[index]?.line.boostedCandyUnits,
    );
    candidateCounts[index] = Math.max(candidateCounts[index], candidates.length);
    for (const candidate of candidates) {
      const nextUsage = mergeUsage(usage, usageFrom(candidate.pokemon, candidate.line));
      if (!canConsume(nextUsage, input)) continue;
      if (planCount > MAX_ORACLE_PLANS) throw new Error(`fixed-demand oracle exploded: ${label}, ${planCount} plans, candidates=${candidateCounts.join(',')}`);
      visit(index + 1, [...choices, candidate], nextUsage);
    }
  };
  visit(0, [], emptyUsage());
  if (!best) throw new Error(`fixed-demand oracle found no feasible plan: candidates=${candidateCounts.join(',')}`);
  return { best, planCount, candidateCounts };
}

function solveByOptimizationPreviewOracle(
  rawInput: LevelPlannerInput,
  mode: SolverItemCompareMode,
  policy: OptimizationOraclePolicy,
  label = '',
): OracleResult {
  const input = {
    ...rawInput,
    boost: { ...rawInput.boost, limit: rawInput.boost.kind === 'none' ? 0 : rawInput.boost.limit },
    options: { ...(rawInput.options ?? {}), itemCompareMode: mode },
  };
  const pokemonList = normalizePokemon(input, mode);
  const candidateCounts = Array.from({ length: pokemonList.length }, () => 0);
  let best: OraclePlan | undefined;
  let planCount = 0;
  const visit = (index: number, choices: OracleCandidate[], usage: OracleUsage): void => {
    if (index === pokemonList.length) {
      const plan = buildPlan(choices, mode);
      planCount++;
      if (!best || compareOptimizationPreviewPlan(plan, best, mode) > 0) best = plan;
      return;
    }
    const candidates = enumerateOptimizationPreviewCandidates(pokemonList[index], input, usage, policy);
    candidateCounts[index] = Math.max(candidateCounts[index], candidates.length);
    for (const candidate of candidates) {
      const nextUsage = mergeUsage(usage, usageFrom(candidate.pokemon, candidate.line));
      if (!canConsume(nextUsage, input)) continue;
      if (planCount > MAX_ORACLE_PLANS) throw new Error(`optimization oracle exploded: ${label}, ${planCount} plans, candidates=${candidateCounts.join(',')}`);
      visit(index + 1, [...choices, candidate], nextUsage);
    }
  };
  visit(0, [], emptyUsage());
  if (!best) throw new Error(`optimization oracle found no feasible plan: candidates=${candidateCounts.join(',')}`);
  return { best, planCount, candidateCounts };
}

function planFromSolver(input: LevelPlannerInput, mode: SolverItemCompareMode): SolverPlan {
  const result = solveLevelPlan({ ...input, options: { ...(input.options ?? {}), itemCompareMode: mode } });
  const normalized = normalizePokemon(input, mode);
  const plan = buildPlan(result.pokemonResults.map((pokemonResult, index) => ({
    pokemon: normalized[index],
    line: pokemonResult.reachableLine,
  })), mode);
  return { plan, result };
}

function assertSolverMatchesOracle(input: LevelPlannerInput, mode: SolverItemCompareMode, label = ''): OracleCheckResult {
  const feasibilityOracle = solveByFeasibilityOracle(input, mode, label);
  const selected = planFromSolver(input, mode);
  const feasibilityComparison = compareFeasibilityPlan(selected.plan, feasibilityOracle.best, mode);
  expect(
    feasibilityComparison,
    [
      label ? `case=${label}` : '',
      `mode=${mode}`,
      `phase=feasibility`,
      `candidateCounts=${feasibilityOracle.candidateCounts.join(',')}`,
      `planCount=${feasibilityOracle.planCount}`,
      `input=${describeInput(input)}`,
      `selected=${describePlan(selected.plan)}`,
      `best=${describePlan(feasibilityOracle.best)}`,
    ].filter(Boolean).join('\n'),
  ).toBeGreaterThanOrEqual(0);

  if (selected.result.performance?.refineStatus !== 'ok' || selected.plan.reachedPrefixCount < selected.plan.choices.length) return 'checked-feasibility';

  const supplyOracle = solveByFixedDemandSupplyOracle(input, mode, selected.plan, label);
  const supplyComparison = compareFixedDemandSupplyPlan(selected.plan, supplyOracle.best, mode);
  expect(
    supplyComparison,
    [
      label ? `case=${label}` : '',
      `mode=${mode}`,
      `phase=refine`,
      `candidateCounts=${supplyOracle.candidateCounts.join(',')}`,
      `planCount=${supplyOracle.planCount}`,
      `input=${describeInput(input)}`,
      `selected=${describePlan(selected.plan)}`,
      `best=${describePlan(supplyOracle.best)}`,
    ].filter(Boolean).join('\n'),
  ).toBeGreaterThanOrEqual(0);
  return 'checked-refined';
}

function checkSolverMatchesOracle(input: LevelPlannerInput, mode: SolverItemCompareMode, label = ''): OracleCheckResult {
  try {
    return assertSolverMatchesOracle(input, mode, label);
  } catch (error) {
    if (error instanceof Error && error.message.includes('full-plan oracle exploded')) return 'skipped-too-large';
    if (error instanceof Error && error.message.includes('fixed-demand oracle exploded')) return 'skipped-too-large';
    throw error;
  }
}

function describeInput(input: LevelPlannerInput): string {
  return JSON.stringify({
    boost: input.boost,
    dreamShards: input.dreamShards,
    candyInventory: input.candyInventory,
    pokemonList: input.pokemonList.map(pokemon => ({
      pokedexId: pokemon.pokedexId,
      type: pokemon.type,
      currentLevel: pokemon.currentLevel,
      currentExpInLevel: pokemon.currentExpInLevel,
      targetLevel: pokemon.targetLevel,
      targetExpInLevel: pokemon.targetExpInLevel,
      candyTarget: pokemon.candyTarget,
      expType: pokemon.expType,
      nature: pokemon.nature,
      requestedBoostCandy: pokemon.requestedBoostCandy,
      boostAllowed: pokemon.boostAllowed,
    })),
  });
}

function describePlan(plan: OraclePlan): string {
  const rows = plan.choices.map(candidate => ({
    name: candidate.pokemon.name,
    level: candidate.line.level,
    candyDemandMet: candidate.line.candyDemandMet,
    total: candidate.line.totalCandyUnitsUsed,
    boost: candidate.line.boostedCandyUnits,
    species: candidate.line.candySupply.species,
    typeS: candidate.line.candySupply.type.s,
    typeM: candidate.line.candySupply.type.m,
    universalS: candidate.line.candySupply.universal.s,
    universalM: candidate.line.candySupply.universal.m,
    universalL: candidate.line.candySupply.universal.l,
    surplus: candidate.line.surplusCandyValue,
  }));
  return JSON.stringify({ metrics: plan.metrics, usage: plan.usage, rows });
}

function pokemon(index: number, overrides: Partial<PokemonPlanInput> = {}): PokemonPlanInput {
  const result: PokemonPlanInput = {
    pokemonId: `oracle-${index}`,
    pokedexId: 9000 + index,
    candyFamilyKey: String(9000 + index),
    name: `Oracle ${index}`,
    type: `oracle_type_${index}`,
    currentLevel: 2,
    currentExpInLevel: 0,
    targetLevel: 3,
    targetExpInLevel: 0,
    expType: 600,
    nature: 'normal',
    requestedBoostCandy: 0,
    boostAllowed: true,
    priorityIndex: index,
    ...overrides,
  };
  if (overrides.candyFamilyKey === undefined) result.candyFamilyKey = String(result.pokedexId);
  return result;
}

function caseInput(overrides: Partial<LevelPlannerInput> = {}): LevelPlannerInput {
  return {
    pokemonList: [pokemon(0)],
    dreamShards: 100_000,
    boost: { kind: 'none', limit: 0 },
    candyInventory: { species: {}, typeCandy: {}, universal: { s: 0, m: 0, l: 0 } },
    ...overrides,
  };
}

function createRng(seed: number): () => number {
  let state = (seed ^ 0x9e37_79b9) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function int(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[int(rng, 0, values.length - 1)];
}

/**
 * ラン数を増やす運用（§18.1）で種別・体数を強制するための上書き。
 *
 * **⚠ 環境変数をここで直接読んではいけない。** 読むとシード固定のケースまで入力が変わり、
 * `smallRandomCase(300)` の期待値を持つテストが `LEVEL_PLANNER_ORACLE_RANDOM_BOOST_KIND=mini` で落ちる
 * （2026-08-01 に実測。「種別を強制してラン数を増やす」という §18.1 の運用手順そのものが回せなくなっていた）。
 * env を読むのはランダム検出テスト1本だけで、そこから引数で渡す。
 */
type RandomCaseOverrides = { count?: number; boostKind?: BoostKind };

function smallRandomCase(seed: number, overrides: RandomCaseOverrides = {}): LevelPlannerInput {
  const rng = createRng(seed);
  const count = overrides.count && overrides.count > 0 ? overrides.count : seed % 2 === 0 ? 2 : 1;
  // 強制時は `pick` を呼ばないので以降の乱数列がずれる。種別を変える以上は入力全体が変わるのが前提。
  const boostKind = overrides.boostKind ?? pick(rng, boostKinds);
  const sharedSpecies = count > 1 && seed % 3 === 0;
  const sharedType = count > 1 && seed % 4 === 0;
  const pokemonList: PokemonPlanInput[] = [];
  const species: Record<string, number> = {};
  const typeCandy: CandyInventory['typeCandy'] = {};
  let estimatedNeed = 0;
  let requestedBoostTotal = 0;

  for (let index = 0; index < count; index++) {
    const currentLevel = int(rng, 2, 5);
    const expType = pick(rng, expTypes);
    const currentExpInLevel = int(rng, 0, Math.max(0, Math.floor(calcExp(currentLevel, currentLevel + 1, expType) * 0.4)));
    const targetLevel = currentLevel + 1;
    const targetExpInLevel = int(rng, 0, Math.floor(calcExp(targetLevel, targetLevel + 1, expType) * 0.25));
    const requestedBoostCandy = boostKind === 'none' ? 0 : int(rng, 0, 3);
    const pokedexId = 10_100 + seed * 10 + index;
    const row = pokemon(index, {
      pokedexId,
      candyFamilyKey: sharedSpecies ? String(10_100 + seed * 10) : String(pokedexId),
      type: sharedType && index > 0 ? `oracle_shared_type_${seed}` : `oracle_type_${seed}_${index}`,
      currentLevel,
      currentExpInLevel,
      targetLevel,
      targetExpInLevel,
      expType,
      nature: pick(rng, natures),
      requestedBoostCandy,
      boostAllowed: boostKind !== 'none',
      candyTarget: rng() < 0.3 ? { totalCandyUnits: int(rng, 1, 4), boostedCandyUnits: boostKind === 'none' ? 0 : int(rng, 0, requestedBoostCandy) } : undefined,
    });
    const target = row.candyTarget
      ? row.candyTarget.totalCandyUnits
      : calcExpAndCandyMixed({
          srcLevel: row.currentLevel,
          dstLevel: row.targetLevel,
          dstExpInLevel: row.targetExpInLevel,
          expType: row.expType,
          nature: row.nature,
          boost: boostKind,
          boostCandy: row.requestedBoostCandy,
          expGot: row.currentExpInLevel,
        }).normalCandy + Math.min(row.requestedBoostCandy, 3);
    estimatedNeed += Math.min(7, Math.max(1, target));
    requestedBoostTotal += row.candyTarget?.boostedCandyUnits ?? row.requestedBoostCandy;
    pokemonList.push(row);
  }

  for (const row of pokemonList) {
    const key = speciesKey(row);
    species[key] = (species[key] ?? 0) + int(rng, 0, 3);
    const type = typeCandy[row.type] ?? { s: 0, m: 0 };
    type.s += int(rng, 0, 2);
      type.m += seed % 6 === 0 ? 1 : 0;
    typeCandy[row.type] = type;
  }
  return {
    pokemonList,
    dreamShards: seed % 7 === 0 ? int(rng, 120, 500) : 100_000,
    boost: { kind: boostKind, limit: boostKind === 'none' ? 0 : Math.max(0, requestedBoostTotal + int(rng, 0, 2)) },
    candyInventory: {
      species,
      typeCandy,
      universal: {
        s: int(rng, Math.max(0, Math.min(estimatedNeed, 3)), Math.min(estimatedNeed + 2, 7)),
        m: seed % 5 === 0 ? 1 : 0,
        l: 0,
      },
    },
  };
}

function tinyThreePokemonCase(seed: number): LevelPlannerInput {
  const rng = createRng(seed);
  const boostKind: BoostKind = 'full';
  const sharedSpecies = seed % 2 === 0;
  const sharedType = seed % 3 !== 1;
  const pokemonList: PokemonPlanInput[] = [];
  const species: Record<string, number> = {};
  const typeCandy: CandyInventory['typeCandy'] = {};
  let totalTarget = 0;
  let requestedBoostTotal = 0;

  for (let index = 0; index < 3; index++) {
    const totalCandyUnits = int(rng, 1, 4);
    const requestedBoostCandy = int(rng, 0, 4);
    const boostedCandyUnits = int(rng, 0, Math.min(totalCandyUnits, requestedBoostCandy));
    const pokedexId = 20_000 + seed * 10 + index;
    const row = pokemon(index, {
      pokedexId,
      candyFamilyKey: sharedSpecies ? String(20_000 + seed * 10) : String(pokedexId),
      type: sharedType && index > 0 ? `oracle_three_shared_${seed}` : `oracle_three_${seed}_${index}`,
      currentLevel: 2 + (seed + index) % 2,
      currentExpInLevel: int(rng, 0, 10),
      targetLevel: 4 + (seed + index) % 2,
      targetExpInLevel: 0,
      expType: pick(rng, expTypes),
      nature: pick(rng, natures),
      requestedBoostCandy,
      boostAllowed: true,
      candyTarget: { totalCandyUnits, boostedCandyUnits },
    });
    pokemonList.push(row);
    totalTarget += totalCandyUnits;
    requestedBoostTotal += boostedCandyUnits;

    const key = speciesKey(row);
    species[key] = (species[key] ?? 0) + int(rng, 0, totalCandyUnits);
    const type = typeCandy[row.type] ?? { s: 0, m: 0 };
    type.s += int(rng, 0, 1);
    type.m += seed % 5 === 0 ? int(rng, 0, 1) : 0;
    typeCandy[row.type] = type;
  }

  const speciesValue = Object.values(species).reduce((sum, value) => sum + value, 0);
  const typeValue = Object.values(typeCandy).reduce((sum, value) => sum + value.s * CANDY_VALUES.type.s + value.m * CANDY_VALUES.type.m, 0);
  const residual = Math.max(0, totalTarget - speciesValue - typeValue);
  return {
    pokemonList,
    dreamShards: 100_000,
    boost: { kind: boostKind, limit: Math.max(0, requestedBoostTotal + int(rng, 0, 2)) },
    candyInventory: {
      species,
      typeCandy,
      universal: {
        s: int(rng, Math.max(0, Math.ceil(residual / CANDY_VALUES.universal.s)), Math.max(2, Math.ceil((residual + 4) / CANDY_VALUES.universal.s))),
        m: int(rng, 0, 1),
        l: 0,
      },
    },
  };
}

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function randomDetectionModes(): SolverItemCompareMode[] {
  const raw = process.env.LEVEL_PLANNER_ORACLE_RANDOM_MODES;
  if (!raw) return modes;
  const requested = raw.split(',').map(value => value.trim()).filter(Boolean);
  const selected = modes.filter(mode => requested.includes(mode));
  return selected.length ? selected : modes;
}

function randomDetectionSeeds(): number[] {
  const runs = Math.max(0, envInt('LEVEL_PLANNER_ORACLE_RANDOM_RUNS', DEFAULT_RANDOM_DETECTION_RUNS));
  const start = envInt('LEVEL_PLANNER_ORACLE_RANDOM_START', 1);
  return Array.from({ length: runs }, (_, index) => start + index);
}

/** env はここでだけ読む（`smallRandomCase` の docblock 参照）。 */
function envRandomCaseOverrides(): RandomCaseOverrides {
  const count = envInt('LEVEL_PLANNER_ORACLE_RANDOM_COUNT', 0);
  const boostKind = process.env.LEVEL_PLANNER_ORACLE_RANDOM_BOOST_KIND as BoostKind | undefined;
  return {
    count: count > 0 ? count : undefined,
    boostKind: boostKind && boostKinds.includes(boostKind) ? boostKind : undefined,
  };
}

/**
 * ラン数に比例させる。既定25ランは 60 秒で足りるが、§18.1 の 3,000 ラン運用は 60 秒では届かず、
 * **timeout 失敗を「オラクルがバグを検出した」と読み違える**（2026-08-01 に実測で1度踏んだ）。
 */
const RANDOM_DETECTION_TIMEOUT_MS = Math.max(60_000, randomDetectionSeeds().length * 60);

describe('level planner full-plan oracle', () => {
  /**
   * **このテストがオラクルの検出力の土台である。**
   *
   * `canonicalBoostFor`（宣言的な目的関数の総当たり）と実装の `minBoostForTarget`（閉形式＋置換試行）が
   * 一致することを決定的に確かめる。ランダム検出テストは既定25ランではアメブ差を拾えないので、
   * **アメブ決定の退行はここが受け止める。**
   *
   * `minBoostForTarget` を壊すとここが落ちる。落ちなくなったら、それは
   * 「オラクルが実装のロジックを写してしまった」サインなので `canonicalBoostFor` を疑うこと。
   */
  it('canonical boost がソルバーのアメブ決定と一致する', { timeout: 60_000 }, () => {
    const mismatches: string[] = [];
    let swapped = 0;
    for (const kind of ['mini', 'full'] as BoostKind[]) {
      for (const expType of expTypes) {
        for (const nature of natures) {
          for (let currentLevel = 1; currentLevel <= 61; currentLevel += 5) {
            for (const span of [1, 3, 9]) {
              const targetLevel = currentLevel + span;
              if (targetLevel > maxLevel) continue;
              // 高Lv × 長距離は必要アメが数百個になり、canonical の総当たりが O(n^2) で重い。
              // 置換の端数は距離ではなく Lv 帯ごとのEXP単価で決まるので、高Lvは短距離で代表させる。
              if (span > 3 && currentLevel > 31) continue;
              for (const currentExpInLevel of [0, 31]) {
                for (const targetExpInLevel of [0, 23]) {
                  // `normalizePokemon` を通す（Lv上限では目標Lv内EXPが0へ正規化される等、
                  // オラクル自身の前処理をここで再実装しないため）。
                  const candidate = normalizePokemon(caseInput({
                    pokemonList: [pokemon(0, {
                      currentLevel, currentExpInLevel, targetLevel, targetExpInLevel, expType, nature,
                      requestedBoostCandy: Number.MAX_SAFE_INTEGER,
                    })],
                    boost: { kind, limit: Number.MAX_SAFE_INTEGER },
                  }), 'surplusFirst')[0];
                  const oracleBoost = canonicalBoostFor(candidate, kind);
                  const solverBoost = minBoostForTarget({
                    srcLevel: currentLevel, targetLevel: candidate.effectiveLevel,
                    targetExpInLevel: candidate.effectiveExp, expType, nature,
                    boostKind: kind, maxBoost: Number.MAX_SAFE_INTEGER, expGot: currentExpInLevel,
                  });
                  if (oracleBoost < targetMixed(candidate, kind, Number.MAX_SAFE_INTEGER).boostCandy) swapped++;
                  if (oracleBoost !== solverBoost) {
                    mismatches.push(`${kind}/${expType}/${nature} src=${currentLevel}+${currentExpInLevel}`
                      + ` dst=${targetLevel}+${targetExpInLevel} oracle=${oracleBoost} solver=${solverBoost}`);
                  }
                }
              }
            }
          }
        }
      }
    }
    // 置換が一度も起きない範囲だと「一致した」に意味が無いので、発火していることを対照として確かめる。
    expect(swapped, 'canonical boost の置換が1件も発火していない（掃引範囲が狭すぎる）').toBeGreaterThan(100);
    expect(mismatches, mismatches.slice(0, 10).join('\n')).toEqual([]);
  });

  /**
   * §18.1 穴2 の「かけら軸だけ残っていた」ぶんの回帰。
   *
   * 境界より下へ残資源を配ったプラン（フェーズ3の仕様どおり）と、配らなかったプランを比べる。
   * `metrics` は到達prefix＋境界までしか集計しないので完全一致し、**比較は最後のかけらで決まる。**
   * ここで全行の `usage.shards` を見ると、配った側が「かけらを使った」だけで負ける。
   */
  it('比較キーは境界より下のかけらを見ない', () => {
    const input = caseInput({ pokemonList: [pokemon(0), pokemon(1)] });
    const rows = normalizePokemon(input, 'surplusFirst');
    const fakeLine = (overrides: Partial<PokemonPlanLine>): PokemonPlanLine => ({
      level: 2, expInLevel: 0, expToNextLevel: 100, expToTarget: 0,
      totalCandyUnitsUsed: 0, boostedCandyUnits: 0, nonBoostCandyUnits: 0,
      candySupply: emptySupply(), dreamShardsUsed: 0, expGained: 0,
      surplusExp: 0, surplusCandyValue: 0, candyDemandMet: false, effectiveTargetReached: false,
      ...overrides,
    });
    // 行0 = 境界（アメが無く未達）。両プランで同一。
    const boundary = { pokemon: rows[0], line: fakeLine({ dreamShardsUsed: 12 }) };
    // 行1 = 下位。残資源を受け取る側と、受け取らない側。
    const fed = buildPlan([boundary, {
      pokemon: rows[1],
      line: fakeLine({
        totalCandyUnitsUsed: 2, nonBoostCandyUnits: 2, dreamShardsUsed: 100,
        candySupply: { species: 2, type: { s: 0, m: 0 }, universal: { s: 0, m: 0, l: 0 } },
      }),
    }], 'surplusFirst');
    const starved = buildPlan([boundary, { pokemon: rows[1], line: fakeLine({}) }], 'surplusFirst');

    expect(fed.reachedPrefixCount).toBe(0);
    expect(starved.reachedPrefixCount).toBe(0);
    // 前提: 下位を育てた側は全行かけらが実際に多い（対照が成立していることを先に確かめる）。
    expect(fed.usage.shards).toBeGreaterThan(starved.usage.shards);
    for (const mode of modes) {
      expect(compareCoreAllocationPlan(fed, starved, mode), `mode=${mode}`).toBe(0);
      expect(compareOptimizationPreviewPlan(fed, starved, mode), `mode=${mode}`).toBe(0);
    }
  });

  it.each(modes)('小さい固定ケースで計算機の結果が全プランoracleと一致する: %s', mode => {
    const cases: LevelPlannerInput[] = [
      caseInput({
        pokemonList: [pokemon(0, { pokedexId: 1, type: 'electric' })],
        candyInventory: { species: { '1': 3 }, typeCandy: { electric: { s: 1, m: 0 } }, universal: { s: 3, m: 1, l: 0 } },
      }),
      caseInput({
        pokemonList: [
          pokemon(0, { pokedexId: 2, type: 'water', requestedBoostCandy: isLegacyLikeMode(mode) ? 0 : 2 }),
          pokemon(1, { pokedexId: 3, type: 'water' }),
        ],
        boost: { kind: isLegacyLikeMode(mode) ? 'none' : 'mini', limit: isLegacyLikeMode(mode) ? 0 : 2 },
        candyInventory: { species: { '2': 1, '3': 0 }, typeCandy: { water: { s: 2, m: 1 } }, universal: { s: 8, m: 1, l: 0 } },
      }),
      caseInput({
        pokemonList: [
          pokemon(0, { pokedexId: 4, type: 'grass', candyTarget: { totalCandyUnits: 2, boostedCandyUnits: 0 } }),
          pokemon(1, { pokedexId: 5, candyFamilyKey: '4', type: 'fire', candyTarget: { totalCandyUnits: 2, boostedCandyUnits: 0 } }),
        ],
        candyInventory: { species: { '4': 3 }, typeCandy: { grass: { s: 1, m: 0 }, fire: { s: 1, m: 0 } }, universal: { s: 2, m: 0, l: 0 } },
      }),
      caseInput({
        pokemonList: [
          pokemon(0, { pokedexId: 172, candyFamilyKey: '25', type: 'electric', candyTarget: { totalCandyUnits: 2, boostedCandyUnits: 0 } }),
          pokemon(1, { pokedexId: 25, candyFamilyKey: '25', type: 'electric', candyTarget: { totalCandyUnits: 2, boostedCandyUnits: 0 } }),
          pokemon(2, { pokedexId: 26, candyFamilyKey: '25', type: 'electric', candyTarget: { totalCandyUnits: 2, boostedCandyUnits: 0 } }),
        ],
        candyInventory: { species: { '25': 4 }, typeCandy: { electric: { s: 1, m: 0 } }, universal: { s: 1, m: 0, l: 0 } },
      }),
      caseInput({
        pokemonList: [
          pokemon(0, { pokedexId: 133, candyFamilyKey: '133', type: 'normal', candyTarget: { totalCandyUnits: 2, boostedCandyUnits: 0 } }),
          pokemon(1, { pokedexId: 134, candyFamilyKey: '133', type: 'water', candyTarget: { totalCandyUnits: 2, boostedCandyUnits: 0 } }),
          pokemon(2, { pokedexId: 135, candyFamilyKey: '133', type: 'electric', candyTarget: { totalCandyUnits: 2, boostedCandyUnits: 0 } }),
        ],
        candyInventory: {
          species: { '133': 3 },
          typeCandy: { normal: { s: 1, m: 0 }, water: { s: 1, m: 0 }, electric: { s: 1, m: 0 } },
          universal: { s: 2, m: 0, l: 0 },
        },
      }),
    ];

    for (const input of cases) assertSolverMatchesOracle(input, mode);
  });

  it.each(modes)('小さいランダムケースで計算機の退行を検出する: %s', mode => {
    for (const seed of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15]) {
      assertSolverMatchesOracle(smallRandomCase(seed), mode, `smoke seed=${seed}`);
    }
  });

  it('3体・フル・共有資源の小さいランダムケースで計算機の退行を検出する', { timeout: 60_000 }, () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40]) {
      const result = checkSolverMatchesOracle(tinyThreePokemonCase(seed), 'surplusFirst', `tiny three seed=${seed}`);
      if (result === 'checked-feasibility' || result === 'checked-refined') checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it('検出されたseed 300で余り1の万能S候補を落とさない', () => {
    const input = smallRandomCase(300);
    const targetRow = input.pokemonList[1];
    targetRow.candyFamilyKey = String(targetRow.pokedexId);
    input.candyInventory.species[targetRow.candyFamilyKey] = 0;
    const candidates = __levelPlannerTestHooks.supplyCandidatesForTest(
      { ...input, options: { itemCompareMode: 'surplusFirst' } },
      1,
      5,
    );
    expect(candidates).toContainEqual({
      species: 0,
      type: { s: 0, m: 0 },
      universal: { s: 2, m: 0, l: 0 },
    });
    const lineCandidates = __levelPlannerTestHooks.candidatesForTest({ ...input, options: { itemCompareMode: 'surplusFirst' } }, 1);
    expect(lineCandidates, JSON.stringify(lineCandidates)).toContainEqual(expect.objectContaining({
      candyDemandMet: true,
      totalCandyUnitsUsed: 5,
      boostedCandyUnits: 1,
      surplusCandyValue: 1,
      supply: {
        species: 0,
        type: { s: 0, m: 0 },
        universal: { s: 2, m: 0, l: 0 },
      },
    }));
    assertSolverMatchesOracle(input, 'surplusFirst', 'fixed random seed=300');
  });

  it('ランダム入力を全プランoracleと照合して計算機のバグを検出する', { timeout: RANDOM_DETECTION_TIMEOUT_MS }, () => {
    const seeds = randomDetectionSeeds();
    const selectedModes = randomDetectionModes();
    const overrides = envRandomCaseOverrides();
    let checkedFeasibility = 0;
    let checkedRefined = 0;
    let skipped = 0;
    expect(seeds.length, 'LEVEL_PLANNER_ORACLE_RANDOM_RUNS must be greater than 0').toBeGreaterThan(0);
    for (const seed of seeds) {
      const input = smallRandomCase(seed, overrides);
      for (const mode of selectedModes) {
        const result = checkSolverMatchesOracle(input, mode, `random seed=${seed}`);
        if (result === 'checked-refined') checkedRefined++;
        else if (result === 'checked-feasibility') checkedFeasibility++;
        else skipped++;
      }
    }
    const checked = checkedFeasibility + checkedRefined;
    expect(checked, `oracle random detection checked=${checked}, refined=${checkedRefined}, skippedTooLarge=${skipped}`).toBeGreaterThanOrEqual(seeds.length);
    expect(checkedRefined, `oracle random detection refined=${checkedRefined}, feasibilityOnly=${checkedFeasibility}, skippedTooLarge=${skipped}`).toBeGreaterThan(0);
  });
});

describe.skip('level planner optimization preview oracle', () => {
  it('譲る指定された上位だけをデブーストし、境界Lv+EXP最大化を検証する', () => {
    const input = caseInput({
      pokemonList: [
        pokemon(0, { pokemonId: 'donor', pokedexId: 30, type: 'grass', requestedBoostCandy: 2 }),
        pokemon(1, { pokemonId: 'locked', pokedexId: 31, type: 'water', requestedBoostCandy: 2 }),
        pokemon(2, { pokemonId: 'boundary', pokedexId: 32, type: 'electric', requestedBoostCandy: 2 }),
      ],
      boost: { kind: 'full', limit: 4 },
      candyInventory: {
        species: { '30': 4, '31': 4, '32': 4 },
        typeCandy: { grass: { s: 2, m: 0 }, water: { s: 2, m: 0 }, electric: { s: 2, m: 0 } },
        universal: { s: 8, m: 1, l: 0 },
      },
    });

    const core = solveByCoreAllocationOracle(input, 'surplusFirst', 'optimization baseline');
    const preview = solveByOptimizationPreviewOracle(
      input,
      'surplusFirst',
      { donorPokemonIds: new Set(['donor']) },
      'optimization donor-only',
    );

    expect(preview.best.choices[1].line.boostedCandyUnits).toBe(core.best.choices[1].line.boostedCandyUnits);
    expect(compareOptimizationPreviewPlan(preview.best, core.best, 'surplusFirst')).toBeGreaterThanOrEqual(0);
  });
});
