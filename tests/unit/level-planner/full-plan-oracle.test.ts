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

function speciesKey(pokemon: Pick<PokemonPlanInput, 'pokedexId'>): string {
  return String(pokemon.pokedexId);
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
    reachedSurplus: metrics.reachedSurplus + (candidate.line.targetReached ? candidate.line.surplusCandyValue : 0),
    normalizedSurplus: metrics.normalizedSurplus + (candidate.line.surplusCandyValue <= MAX_ACCEPTABLE_SURPLUS ? 0 : candidate.line.surplusCandyValue),
    surplusExp: metrics.surplusExp + candidate.line.surplusExp,
    speciesLex: metrics.speciesLex - candidate.line.candySupply.species * candidate.pokemon.priorityIndex,
    itemPriority: metrics.itemPriority.map((value, index) => value + priority[index]),
    legacyItemPriority: metrics.legacyItemPriority.map((value, index) => value + legacyPriority[index]),
  };
}

function buildPlan(choices: OracleCandidate[], mode: SolverItemCompareMode): OraclePlan {
  let usage = emptyUsage();
  let metrics = emptyMetrics();
  let reachedPrefixCount = 0;
  let boundary: OracleCandidate | undefined;
  for (const [index, candidate] of choices.entries()) {
    usage = mergeUsage(usage, usageFrom(candidate.pokemon, candidate.line));
    metrics = appendMetrics(metrics, candidate, mode);
    if (!boundary && candidate.line.targetReached) reachedPrefixCount = index + 1;
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
    if (a.usage.shards !== b.usage.shards) return a.usage.shards < b.usage.shards ? 1 : -1;
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
  if (a.usage.shards !== b.usage.shards) return a.usage.shards < b.usage.shards ? 1 : -1;
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
    if (!useCandy(boost > 0) && !useCandy(false)) break;
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
  fixedBoost = false,
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
  while (remaining > 0 && level < maxLevel) {
    if (boost > 0) {
      if (useCandy(true)) continue;
      if (fixedBoost) break;
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

function hasFixedCandyTargetBoost(pokemon: Pick<PokemonPlanInput, 'candyTarget'>): boolean {
  return pokemon.candyTarget?.boostedCandyUnits !== undefined;
}

function candyTargetBoostCap(pokemon: Pick<OracleCandidate['pokemon'], 'candyTarget' | 'requestedBoostCandy'>, requestedBoostCandy: number, kind: BoostKind): number {
  if (kind === 'none' || !pokemon.candyTarget) return 0;
  return Math.min(Math.max(0, requestedBoostCandy), pokemon.candyTarget.boostedCandyUnits ?? pokemon.candyTarget.totalCandyUnits);
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
      const reached = simulateCandyBudget(pokemon, boosted, pokemon.candyTarget.totalCandyUnits, Infinity, kind, hasFixedCandyTargetBoost(pokemon));
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

function maxBoostFor(pokemon: OracleCandidate['pokemon'], input: LevelPlannerInput, remainingBoost: number): number {
  if (pokemon.candyTarget) return Math.min(candyTargetBoostCap(pokemon, pokemon.requestedBoostCandy, input.boost.kind), Math.max(0, remainingBoost));
  const full = targetMixed(pokemon, input.boost.kind, Number.MAX_SAFE_INTEGER).boostCandy;
  return Math.min(pokemon.requestedBoostCandy, full, Math.max(0, remainingBoost));
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
    targetReached: compareLevel(reached, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) >= 0,
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
  const fixedBoost = hasFixedCandyTargetBoost(pokemon);
  const reached = simulateCandyBudget(pokemon, boostBudget, totalBudget, shardLimit, input.boost.kind, fixedBoost);
  const totalCandyUnitsUsed = reached.boostUsed + reached.normalUsed;
  const targetTotal = pokemon.candyTarget?.totalCandyUnits ?? totalBudget;
  const targetBoost = Math.min(candyTargetBoostCap(pokemon, pokemon.requestedBoostCandy, input.boost.kind), targetTotal);
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
    targetReached: totalCandyUnitsUsed >= targetTotal && (!fixedBoost || reached.boostUsed >= targetBoost),
  };
}

function enumerateSupplies(total: number, pokemon: PokemonPlanInput, inventory: CandyInventory): CandySupplyBreakdown[] {
  if (total === 0) return [emptySupply()];
  const type = inventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const universal = inventory.universal;
  const result: CandySupplyBreakdown[] = [];
  const speciesMax = Math.min(inventory.species[speciesKey(pokemon)] ?? 0, total);
  for (const species of [speciesMax]) {
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

function enumerateCandidates(pokemon: OracleCandidate['pokemon'], input: LevelPlannerInput, usage: OracleUsage): OracleCandidate[] {
  const inventory = remainingInventory(input, usage);
  const remainingBoost = Math.max(0, input.boost.limit - usage.boost);
  const remainingShards = Math.max(0, input.dreamShards - usage.shards);
  const boostBudget = maxBoostFor(pokemon, input, remainingBoost);
  if (pokemon.candyTarget) {
    const maxTotalBudget = Math.min(pokemon.candyTarget.totalCandyUnits, Math.max(0, inventoryValueFor(pokemon, inventory)));
    const candidates: OracleCandidate[] = [];
    for (let totalBudget = 0; totalBudget <= maxTotalBudget; totalBudget++) {
      const requestedBoost = Math.min(boostBudget, totalBudget);
      const reached = simulateCandyBudget(pokemon, requestedBoost, totalBudget, remainingShards, input.boost.kind, hasFixedCandyTargetBoost(pokemon));
      const total = reached.boostUsed + reached.normalUsed;
      for (const supply of enumerateSupplies(total, pokemon, inventory)) {
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
    pokemon.candyTarget?.totalCandyUnits ?? targetTotal,
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
    if (pokemon.candyTarget && option.total > pokemon.candyTarget.totalCandyUnits) continue;
    for (const supply of enumerateSupplies(option.total, pokemon, inventory)) {
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
      const reached = simulateCandyBudget(pokemon, Math.min(boostBudget, totalBudget), totalBudget, remainingShards, input.boost.kind, hasFixedCandyTargetBoost(pokemon));
      const total = reached.boostUsed + reached.normalUsed;
      for (const supply of enumerateSupplies(total, pokemon, inventory)) {
        candidates.push({ pokemon, line: makeCandyTargetLine(pokemon, input, Math.min(boostBudget, totalBudget), totalBudget, remainingShards, supply) });
      }
      continue;
    }
    const targetTotal = target.boostCandy + target.normalCandy;
    const maxCandyBudget = Math.min(
      pokemon.candyTarget?.totalCandyUnits ?? targetTotal,
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
      if (pokemon.candyTarget && option.total > pokemon.candyTarget.totalCandyUnits) continue;
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
        && candidate.line.targetReached === other.line.targetReached
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
    const candidates = enumerateCandidates(pokemonList[index], input, usage);
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
    targetReached: candidate.line.targetReached,
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
  return {
    pokemonId: `oracle-${index}`,
    pokedexId: 9000 + index,
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

function smallRandomCase(seed: number): LevelPlannerInput {
  const rng = createRng(seed);
  const forcedCount = envInt('LEVEL_PLANNER_ORACLE_RANDOM_COUNT', 0);
  const count = forcedCount > 0 ? forcedCount : seed % 2 === 0 ? 2 : 1;
  const forcedBoostKind = process.env.LEVEL_PLANNER_ORACLE_RANDOM_BOOST_KIND as BoostKind | undefined;
  const boostKind = forcedBoostKind && boostKinds.includes(forcedBoostKind) ? forcedBoostKind : pick(rng, boostKinds);
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
    const row = pokemon(index, {
      pokedexId: sharedSpecies && index > 0 ? 10_100 + seed : 10_100 + seed * 10 + index,
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
    const row = pokemon(index, {
      pokedexId: sharedSpecies && index > 0 ? 20_000 + seed : 20_000 + seed * 10 + index,
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

describe('level planner full-plan oracle', () => {
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
          pokemon(1, { pokedexId: 4, type: 'fire', candyTarget: { totalCandyUnits: 2, boostedCandyUnits: 0 } }),
        ],
        candyInventory: { species: { '4': 3 }, typeCandy: { grass: { s: 1, m: 0 }, fire: { s: 1, m: 0 } }, universal: { s: 2, m: 0, l: 0 } },
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
      targetReached: true,
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

  it('ランダム入力を全プランoracleと照合して計算機のバグを検出する', { timeout: 60_000 }, () => {
    const seeds = randomDetectionSeeds();
    const selectedModes = randomDetectionModes();
    let checkedFeasibility = 0;
    let checkedRefined = 0;
    let skipped = 0;
    expect(seeds.length, 'LEVEL_PLANNER_ORACLE_RANDOM_RUNS must be greater than 0').toBeGreaterThan(0);
    for (const seed of seeds) {
      const input = smallRandomCase(seed);
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
