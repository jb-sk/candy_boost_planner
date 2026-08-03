/** fbl01d feasibility witness を本線とするレベルプランナー。 */
import type {
  CandyInventory, CandySupplyBreakdown, LevelPlannerInput, LevelPlannerResult,
  PokemonPlanInput, PokemonPlanLine, PokemonPlanResult, PokemonShortage,
  PokemonConstraintDiagnosis, PlannerLossLedger, PlannerOptions, TypeCandyStock, UniversalCandyStock,
  DeadlineExceededMeta, MixedCalculationMeta, PlannerSolveOptions, PlannerSolveOutcome, PlannerTuning,
  ItemCompareMode, ShortageType,
} from '../types';
import { isPerfEnabled } from '../../../utils/perf';
import { CANDY_VALUES, MAX_ACCEPTABLE_SURPLUS } from '../constants';
import { calcExp, calcExpAndCandyMixed } from '../../pokesleep/exp';
import { minBoostForTarget } from '../../pokesleep/minBoostForTarget';
import { simulateCandyBudget, simulateCandyRun } from '../../pokesleep/simulateCandyBudget';
import { maxLevel } from '../../pokesleep/tables';
import { findBestItemAllocation } from './itemAllocation';
import { addItemPriority, compareItemPriority, emptyItemPriority, itemPriorityOf } from './itemPriority';
import type { ItemPriorityTuple } from './itemPriority';
import { createIndependentBoundaryFeasibilitySession, createPrefixDecisionSession, fixedRowsFailFeasibilityRelaxation, hasSingleRowSupplyWithinSurplus, refineFeasibilityWitness, solveFeasibilityDecisionForFixedRows, solveFeasibilityForFixedRows } from './feasibilityWitness';
import { createPlannerLossLedger, toPublicPlannerLossLedger } from './lossLedger';
import type { InternalPlannerLossLedger } from './lossLedger';
import type { FeasibilityDemandRow, FeasibilityResult, FeasibilitySolverOptions, FeasibilityWitness } from '../types';

const DEFAULT_MAX_SUPPLY_CANDIDATES = Number.POSITIVE_INFINITY;
const DEFAULT_MAX_SHARED_SPECIES_SUPPLY_CANDIDATES = Number.POSITIVE_INFINITY;
const DEFAULT_MAX_STATES_PER_INDEX = Number.POSITIVE_INFINITY;
const DEFAULT_MAX_STATES_BEFORE_FINAL_INDEX = Number.POSITIVE_INFINITY;
const DEFAULT_MAX_EXPANSIONS = Number.POSITIVE_INFINITY;
const CANDIDATE_CACHE_LIMIT = 256;
const DEBUG_LEVEL_PLANNER = import.meta.env.DEV && import.meta.env.VITE_LEVEL_PLANNER_DEBUG === 'true';

const emptyFeasibilityStats = (): FeasibilityResult['stats'] => ({
  rowOptionCounts: [],
  rowFrontierCounts: [],
  typeBlockFrontierCounts: [],
  globalKeyCount: 0,
  transitions: 0,
  witnessRestoreMs: 0,
  durationMs: 0,
  elapsedMs: 0,
});

type NormalizedPokemon = PokemonPlanInput & {
  targetExpInLevel: number;
  requestedBoostCandy: number;
  effectiveLevel: number;
  effectiveExp: number;
};
type Usage = {
  boost: number; shards: number; species: Record<string, number>;
  type: Record<string, TypeCandyStock>; universal: UniversalCandyStock;
};
type Contention = {
  boost: boolean; shards: boolean; species: Record<string, boolean>;
  type: Record<string, TypeCandyStock>; universal: UniversalCandyStock;
};
type ContentionKeys = { species: string[]; typeS: string[]; typeM: string[] };
type NormalizedInput = Omit<LevelPlannerInput, 'pokemonList' | 'options'> & {
  pokemonList: NormalizedPokemon[]; options: PlannerOptions; contention: Contention;
  contentionKeys: ContentionKeys; speciesNeeds: Record<string, number>;
};
type Candidate = { p: NormalizedPokemon; line: PokemonPlanLine; usage: Usage; stableIndex: number };
type StateMetrics = { zeroSurplusCount: number; speciesUsed: number; rawSurplus: number; reachedSurplus: number; normalizedSurplus: number; surplusExp: number; itemPriority: ItemPriorityTuple };
type State = { choices: Candidate[]; usage: Usage; reachedPrefixCount: number; boundary?: Candidate; metrics: StateMetrics };
type SupplyOption = { supply: CandySupplyBreakdown; order: number };
type SupplyCandidateCacheEntry = { candidates: CandySupplyBreakdown[]; cut?: PlannerLossLedger['supplyCandidateCuts'][number] };
type MixedChoiceResult = { choices: Candidate[]; source: MixedCalculationMeta['source']; exactPrefixCount: number };
type BoundarySearchSummary = NonNullable<NonNullable<LevelPlannerResult['performance']>['boundarySearch']>;
type PrefixSearchSummary = NonNullable<NonNullable<LevelPlannerResult['performance']>['prefixSearch']>;
type CandyExpOptimizationResult = {
  solvedCandidates: number;
  supplyRejectedCandidates: number;
  supplyInconclusiveCandidates: number;
  feasibilityMs?: number;
  refineMs?: number;
  refineStatus?: string;
  refineReason?: string;
  boundarySearch?: BoundarySearchSummary;
  prefixSearch?: PrefixSearchSummary;
  prefixSearchAttempts?: PrefixSearchSummary[];
};
type InternalPlannerTuning = PlannerTuning & {
  // Probe-only: lets tuning tests inspect large frontiers before the full DP completes.
  stopAfterIndex: number;
  // Probe-only: adds per-candidate timing overhead, so it must stay opt-in.
  traceStepTimings: boolean;
  // Probe-only: emits progress while a single large DP step is still running.
  traceProgressEveryInputStates: number;
  // Probe-only: returns after a partial slice of a single large DP step.
  stopDuringIndex: number;
  stopAfterInputStates: number;
};

const candidateCache = new Map<string, Candidate[]>();
const supplyCandidateCache = new Map<string, SupplyCandidateCacheEntry>();
let activeLossLedger: InternalPlannerLossLedger | null = null;
let activeTuning: InternalPlannerTuning = {
  maxSupplyCandidates: DEFAULT_MAX_SUPPLY_CANDIDATES,
  maxSharedSpeciesSupplyCandidates: DEFAULT_MAX_SHARED_SPECIES_SUPPLY_CANDIDATES,
  maxStatesPerIndex: DEFAULT_MAX_STATES_PER_INDEX,
  maxStatesBeforeFinalIndex: DEFAULT_MAX_STATES_BEFORE_FINAL_INDEX,
  maxExpansions: DEFAULT_MAX_EXPANSIONS,
  stopAfterIndex: Number.POSITIVE_INFINITY,
  traceStepTimings: false,
  traceProgressEveryInputStates: Number.POSITIVE_INFINITY,
  stopDuringIndex: Number.POSITIVE_INFINITY,
  stopAfterInputStates: Number.POSITIVE_INFINITY,
};

type DeadlineContext = {
  startedAt: number;
  deadlineAt?: number;
  abortAfterExpansions?: number;
  checks: number;
  maxNextStates: number;
  maxOutputStates: number;
  reachedIndex: number;
  expansions: number;
  prefix: DeadlinePrefix;
};

type DeadlinePrefix = {
  state: State;
  completedPrefixCount: number;
};

class PlannerDeadlineExceeded extends Error {
  readonly prefix: DeadlinePrefix;
  readonly meta: DeadlineExceededMeta;

  constructor(meta: DeadlineExceededMeta, prefix: DeadlinePrefix) {
    super('level planner deadline exceeded');
    this.name = 'PlannerDeadlineExceeded';
    this.meta = meta;
    this.prefix = prefix;
  }
}

let activeDeadline: DeadlineContext | null = null;
const emptySupply = (): CandySupplyBreakdown => ({ species: 0, type: { s: 0, m: 0 }, universal: { s: 0, m: 0, l: 0 } });
const emptyUsage = (): Usage => ({ boost: 0, shards: 0, species: {}, type: {}, universal: { s: 0, m: 0, l: 0 } });
const emptyPlannerState = (): State => ({ choices: [], usage: emptyUsage(), reachedPrefixCount: 0, metrics: emptyStateMetrics() });

function deadlineCheckpoint(
  reachedIndex: number,
  expansions: number,
  prefixState: State,
  completedPrefixCount: number,
  force = false,
): void {
  const deadline = activeDeadline;
  if (!deadline) return;
  deadline.reachedIndex = reachedIndex;
  deadline.expansions = expansions;
  deadline.prefix = { state: prefixState, completedPrefixCount };
  deadline.checks++;
  deadline.maxNextStates = Math.max(deadline.maxNextStates, 0);
  const deterministicAbort = deadline.abortAfterExpansions !== undefined
    && expansions >= deadline.abortAfterExpansions;
  const shouldCheckClock = force || deterministicAbort || deadline.checks % 64 === 0;
  if (!shouldCheckClock) return;
  const now = performance.now();
  const timedOut = deadline.deadlineAt !== undefined && now >= deadline.deadlineAt;
  if (!deterministicAbort && !timedOut) return;
  throw new PlannerDeadlineExceeded(
    {
      deadlineExceeded: true,
      elapsedMs: Math.max(0, now - deadline.startedAt),
      reachedIndex,
      expansions,
      maxNextStates: deadline.maxNextStates,
      maxOutputStates: deadline.maxOutputStates,
      completedPrefixCount,
    },
    { state: prefixState, completedPrefixCount },
  );
}

function preparationCheckpoint(force = false): void {
  const deadline = activeDeadline;
  if (!deadline) return;
  deadlineCheckpoint(deadline.reachedIndex, deadline.expansions, deadline.prefix.state, deadline.prefix.completedPrefixCount, force);
}

function copyUsage(usage: Usage): Usage {
  const species: Record<string, number> = {};
  for (const [key, amount] of Object.entries(usage.species)) species[key] = amount;
  const type: Record<string, TypeCandyStock> = {};
  for (const [key, amount] of Object.entries(usage.type)) type[key] = { s: amount.s, m: amount.m };
  return {
    boost: usage.boost,
    shards: usage.shards,
    species,
    type,
    universal: { s: usage.universal.s, m: usage.universal.m, l: usage.universal.l },
  };
}
const speciesKey = (pokemon: Pick<PokemonPlanInput, 'candyFamilyKey'>) => pokemon.candyFamilyKey;
const supplyValue = (supply: CandySupplyBreakdown): number => supply.species
  + supply.type.s * CANDY_VALUES.type.s + supply.type.m * CANDY_VALUES.type.m
  + supply.universal.s * CANDY_VALUES.universal.s + supply.universal.m * CANDY_VALUES.universal.m + supply.universal.l * CANDY_VALUES.universal.l;
const cmpLevel = (a: { level: number; expInLevel: number }, b: { level: number; expInLevel: number }) => a.level - b.level || a.expInLevel - b.expInLevel;
const stableJson = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'number' && !Number.isFinite(item) ? String(item) : item);
const supplyBreakdownKey = (supply: CandySupplyBreakdown): string => `${supply.species}|${supply.type.s}|${supply.type.m}|${supply.universal.s}|${supply.universal.m}|${supply.universal.l}`;
const roundMs = (value: number): number => Math.round(value * 100) / 100;
const isLegacyLikeMode = (mode: PlannerOptions['itemCompareMode']): boolean => mode === 'legacyImproved' || mode === 'surplusGateFirst';
const usesZeroSurplusPriority = (mode: PlannerOptions['itemCompareMode']): boolean => mode === 'surplusFirst' || mode === 'surplusGateFirst' || mode === 'legacyImproved';

function recordSupplyCandidateCut(cacheKey: string, cut: PlannerLossLedger['supplyCandidateCuts'][number] | undefined): void {
  if (!activeLossLedger || !cut || activeLossLedger.seenSupplyCutKeys.has(cacheKey)) return;
  activeLossLedger.seenSupplyCutKeys.add(cacheKey);
  activeLossLedger.hasLoss = true;
  activeLossLedger.supplyCandidateCuts.push(cut);
}

function normalizeInput(raw: LevelPlannerInput): NormalizedInput {
  const kind = raw.boost.kind;
  const options = { itemCompareMode: raw.options?.itemCompareMode ?? 'surplusFirst' } as PlannerOptions;
  const pokemonList = raw.pokemonList.map((pokemon, priorityIndex) => {
    const targetLevel = Math.min(maxLevel, pokemon.targetLevel);
    const targetExpInLevel = targetLevel >= maxLevel ? 0 : (pokemon.targetExpInLevel ?? 0);
    const requestedBoostCandy = kind === 'none' || !pokemon.boostAllowed ? 0 : Math.max(0, Math.floor(pokemon.requestedBoostCandy));
    // `boostedCandyUnits` は型上必須だが、保存データの復元など型検査を通らない経路から
    // 欠けた値が来ると `Math.min(x, undefined)` が NaN になって静かに壊れる。ここで整える。
    const candyTarget = pokemon.candyTarget
      ? {
        totalCandyUnits: Math.max(0, Math.floor(pokemon.candyTarget.totalCandyUnits) || 0),
        boostedCandyUnits: Math.max(0, Math.floor(pokemon.candyTarget.boostedCandyUnits) || 0),
      }
      : undefined;
    let effectiveLevel = targetLevel;
    let effectiveExp = targetExpInLevel;
    if (candyTarget) {
      const boosted = candyTargetBoostCap({ candyTarget, requestedBoostCandy }, requestedBoostCandy, kind);
      const reached = simulateCandyBudget(pokemon, boosted, candyTarget.totalCandyUnits, Infinity, kind);
      effectiveLevel = reached.level;
      effectiveExp = reached.expInLevel;
    }
    return { ...pokemon, priorityIndex, targetLevel, targetExpInLevel, requestedBoostCandy, candyTarget, effectiveLevel, effectiveExp, preferZeroSurplus: Boolean(pokemon.preferZeroSurplus) };
  });
  const base = {
    ...raw,
    boost: { kind, limit: kind === 'none' ? 0 : Math.max(0, Math.floor(raw.boost.limit)) },
    dreamShards: Math.max(0, raw.dreamShards), pokemonList, options,
  };
  const speciesNeeds = calculateSpeciesNeeds(base);
  const contention = analyzeContention(base, speciesNeeds);
  const contentionKeys = buildContentionKeys(contention);
  return { ...base, contention, contentionKeys, speciesNeeds };
}

/** exp.ts と同じく、boost は低レベル側から優先して消費する。 */
function simulate(pokemon: Pick<NormalizedPokemon, 'currentLevel' | 'currentExpInLevel' | 'expType' | 'nature'>, boostBudget: number, normalBudget: number, shardLimit: number, targetLevel: number, targetExp: number, kind: LevelPlannerInput['boost']['kind']) {
  return simulateCandyRun(pokemon, {
    boostBudget,
    normalBudget,
    totalCap: Infinity,
    shardLimit,
    kind,
    shouldContinue: (level, expInLevel) => (
      level < targetLevel || (level === targetLevel && expInLevel < targetExp)
    ),
  });
}

function candyTargetBoostCap(pokemon: Pick<NormalizedPokemon, 'candyTarget' | 'requestedBoostCandy'>, requestedBoostCandy: number, kind: LevelPlannerInput['boost']['kind']): number {
  if (kind === 'none' || !pokemon.candyTarget) return 0;
  return Math.min(Math.max(0, requestedBoostCandy), pokemon.candyTarget.boostedCandyUnits);
}

/** 固定配分のアメブ予算を、行の総数とその時点のグローバル残枠に収める。 */
function fixedCandyTargetBoostBudget(
  pokemon: Pick<NormalizedPokemon, 'candyTarget' | 'requestedBoostCandy'>,
  kind: LevelPlannerInput['boost']['kind'],
  totalCandy: number,
  remainingBoost: number,
): number {
  return Math.min(
    candyTargetBoostCap(pokemon, pokemon.requestedBoostCandy, kind),
    Math.max(0, totalCandy),
    Math.max(0, remainingBoost),
  );
}

function targetMixed(pokemon: NormalizedPokemon, kind: LevelPlannerInput['boost']['kind'], boost: number) {
  const reached = simulate(pokemon, boost, Number.MAX_SAFE_INTEGER, Infinity, pokemon.effectiveLevel, pokemon.effectiveExp, kind);
  return { boostCandy: reached.boostUsed, normalCandy: reached.normalUsed, shards: reached.shards };
}
function plannedCandyUnits(pokemon: NormalizedPokemon, kind: LevelPlannerInput['boost']['kind']): number {
  if (pokemon.candyTarget) return pokemon.candyTarget.totalCandyUnits;
  const mixed = targetMixed(pokemon, kind, Math.min(pokemon.requestedBoostCandy, Number.MAX_SAFE_INTEGER));
  return mixed.boostCandy + mixed.normalCandy;
}
function calculateSpeciesNeeds(input: Pick<NormalizedInput, 'pokemonList' | 'boost'>): Record<string, number> {
  const needs: Record<string, number> = {};
  for (const pokemon of input.pokemonList) {
    needs[speciesKey(pokemon)] = (needs[speciesKey(pokemon)] ?? 0) + plannedCandyUnits(pokemon, input.boost.kind);
  }
  return needs;
}
function addType(record: Record<string, TypeCandyStock>, type: string, s: number, m: number): void {
  const current = record[type] ?? { s: 0, m: 0 };
  record[type] = { s: current.s + s, m: current.m + m };
}
function buildContentionKeys(contention: Contention): ContentionKeys {
  return {
    species: Object.entries(contention.species).filter(([, enabled]) => enabled).map(([key]) => key),
    typeS: Object.entries(contention.type).filter(([, enabled]) => Boolean(enabled.s)).map(([key]) => key),
    typeM: Object.entries(contention.type).filter(([, enabled]) => Boolean(enabled.m)).map(([key]) => key),
  };
}
/** 各候補が単独で取り得る上限を合計し、枯渇しない次元を探索から除外する。 */
function analyzeContention(input: Pick<NormalizedInput, 'pokemonList' | 'boost' | 'dreamShards' | 'candyInventory'>, _speciesNeeds: Record<string, number>): Contention {
  const upper = emptyUsage();
  for (const pokemon of input.pokemonList) {
    const mixed = targetMixed(pokemon, input.boost.kind, pokemon.requestedBoostCandy);
    const total = plannedCandyUnits(pokemon, input.boost.kind);
    upper.boost += pokemon.requestedBoostCandy;
    upper.shards += mixed.shards;
    const key = speciesKey(pokemon);
    upper.species[key] = (upper.species[key] ?? 0) + Math.min(input.candyInventory.species[key] ?? 0, total);
    const typeStock = input.candyInventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
    addType(upper.type, pokemon.type, Math.min(typeStock.s, Math.ceil(total / CANDY_VALUES.type.s)), Math.min(typeStock.m, Math.ceil(total / CANDY_VALUES.type.m)));
    upper.universal.s += Math.min(input.candyInventory.universal.s, Math.ceil(total / CANDY_VALUES.universal.s));
    upper.universal.m += Math.min(input.candyInventory.universal.m, Math.ceil(total / CANDY_VALUES.universal.m));
    upper.universal.l += Math.min(input.candyInventory.universal.l, Math.ceil(total / CANDY_VALUES.universal.l));
  }
  const species: Record<string, boolean> = {};
  for (const [key, amount] of Object.entries(upper.species)) species[key] = amount > (input.candyInventory.species[key] ?? 0);
  const type: Record<string, TypeCandyStock> = {};
  for (const [key, amount] of Object.entries(upper.type)) {
    const stock = input.candyInventory.typeCandy[key] ?? { s: 0, m: 0 };
    type[key] = { s: Number(amount.s > stock.s), m: Number(amount.m > stock.m) };
  }
  return {
    boost: upper.boost > input.boost.limit, shards: upper.shards > input.dreamShards, species, type,
    universal: {
      s: Number(upper.universal.s > input.candyInventory.universal.s),
      m: Number(upper.universal.m > input.candyInventory.universal.m),
      l: Number(upper.universal.l > input.candyInventory.universal.l),
    },
  };
}
function maxBoostFor(pokemon: NormalizedPokemon, kind: LevelPlannerInput['boost']['kind'], limit: number): number {
  if (pokemon.candyTarget) return Math.min(candyTargetBoostCap(pokemon, pokemon.requestedBoostCandy, kind), Math.max(0, limit));
  // 目標到達に不要な余分な1個のアメブを消費しない（仕様§4、設計書§3.8-e）。
  const full = minBoostForTarget({
    srcLevel: pokemon.currentLevel,
    targetLevel: pokemon.effectiveLevel,
    targetExpInLevel: pokemon.effectiveExp,
    expType: pokemon.expType,
    nature: pokemon.nature,
    boostKind: kind,
    maxBoost: Number.MAX_SAFE_INTEGER,
    expGot: pokemon.currentExpInLevel,
  });
  return Math.min(pokemon.requestedBoostCandy, full, Math.max(0, limit));
}

/** 3モード共通の使用優先度。重みと順序の根拠は `itemPriority.ts` を見ること。 */
function itemPriority(supply: CandySupplyBreakdown): ItemPriorityTuple {
  return itemPriorityOf({
    typeS: supply.type.s,
    typeM: supply.type.m,
    universalS: supply.universal.s,
    universalM: supply.universal.m,
    universalL: supply.universal.l,
  });
}
function emptyStateMetrics(): StateMetrics {
  return {
    zeroSurplusCount: 0,
    speciesUsed: 0,
    rawSurplus: 0,
    reachedSurplus: 0,
    normalizedSurplus: 0,
    surplusExp: 0,
    itemPriority: emptyItemPriority(),
  };
}
function candidateUsesZeroSurplusPriority(candidate: Candidate, mode: PlannerOptions['itemCompareMode']): boolean {
  return Boolean(candidate.p.preferZeroSurplus)
    || (usesZeroSurplusPriority(mode) && candidate.line.level >= maxLevel && candidate.line.expInLevel === 0);
}
function candidateAchievedZeroSurplusPriority(candidate: Candidate, mode: PlannerOptions['itemCompareMode']): boolean {
  return candidateUsesZeroSurplusPriority(candidate, mode) && candidate.line.surplusCandyValue === 0;
}
function appendStateMetrics(metrics: StateMetrics, candidate: Candidate, mode: PlannerOptions['itemCompareMode']): StateMetrics {
  const priority = itemPriority(candidate.line.candySupply);
  return {
    zeroSurplusCount: metrics.zeroSurplusCount + (candidateAchievedZeroSurplusPriority(candidate, mode) ? 1 : 0),
    speciesUsed: metrics.speciesUsed + candidate.line.candySupply.species,
    rawSurplus: metrics.rawSurplus + candidate.line.surplusCandyValue,
    reachedSurplus: metrics.reachedSurplus + (candidate.line.candyDemandMet ? candidate.line.surplusCandyValue : 0),
    normalizedSurplus: metrics.normalizedSurplus + (candidate.line.surplusCandyValue <= MAX_ACCEPTABLE_SURPLUS ? 0 : candidate.line.surplusCandyValue),
    surplusExp: metrics.surplusExp + candidate.line.surplusExp,
    itemPriority: addItemPriority(metrics.itemPriority, priority),
  };
}
function supplyCacheKey(total: number, pokemon: NormalizedPokemon, input: NormalizedInput): string {
  const species = speciesKey(pokemon);
  const typeStock = input.candyInventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const typeContention = input.contention.type[pokemon.type] ?? { s: false, m: false };
  const valueCap = total + CANDY_VALUES.universal.l;
  return stableJson({
    total,
    species,
    type: pokemon.type,
    preferZeroSurplus: Boolean(pokemon.preferZeroSurplus),
    inventory: {
      species: Math.min(input.candyInventory.species[species] ?? 0, total),
      type: {
        s: Math.min(typeStock.s, Math.ceil(valueCap / CANDY_VALUES.type.s)),
        m: Math.min(typeStock.m, Math.ceil(valueCap / CANDY_VALUES.type.m)),
      },
      universal: {
        s: Math.min(input.candyInventory.universal.s, valueCap),
        m: Math.min(input.candyInventory.universal.m, Math.ceil(valueCap / CANDY_VALUES.universal.m)),
        l: Math.min(input.candyInventory.universal.l, Math.ceil(valueCap / CANDY_VALUES.universal.l)),
      },
    },
    speciesNeed: input.speciesNeeds[species],
    tuning: {
      maxSupplyCandidates: activeTuning.maxSupplyCandidates,
      maxSharedSpeciesSupplyCandidates: activeTuning.maxSharedSpeciesSupplyCandidates,
    },
    contention: {
      species: Boolean(input.contention.species[species]),
      type: typeContention,
      universal: input.contention.universal,
    },
    itemCompareMode: input.options.itemCompareMode,
  });
}
function acceptableSurplusRank(surplus: number): number {
  return surplus >= 0 && surplus <= MAX_ACCEPTABLE_SURPLUS ? 1 : 0;
}
function hasOnlyAcceptableRowSurplus(metrics: Pick<StateMetrics, 'normalizedSurplus'>): boolean {
  return metrics.normalizedSurplus === 0;
}
function compareSupply(a: CandySupplyBreakdown, b: CandySupplyBreakdown, total: number, mode: PlannerOptions['itemCompareMode']): number {
  const surplusA = supplyValue(a) - total; const surplusB = supplyValue(b) - total;
  if (a.species !== b.species) return a.species > b.species ? 1 : -1;
  if (isLegacyLikeMode(mode)) {
    const acceptableA = acceptableSurplusRank(surplusA);
    const acceptableB = acceptableSurplusRank(surplusB);
    if (acceptableA !== acceptableB) return acceptableA > acceptableB ? 1 : -1;
    if (!acceptableA && surplusA !== surplusB) return surplusA < surplusB ? 1 : -1;
    const priority = compareItemPriority(itemPriority(a), itemPriority(b));
    if (priority) return priority;
    // 余り0〜2を同等扱いする分、スコアが同点でも供給価値は最大2ずれる。ここで明示的に詰める。
    if (surplusA !== surplusB) return surplusA < surplusB ? 1 : -1;
    return 0;
  }
  if (surplusA !== surplusB) return surplusA < surplusB ? 1 : -1;
  const priority = compareItemPriority(itemPriority(a), itemPriority(b));
  if (priority) return priority;
  return 0;
}
function supplyUsageAtMost(a: CandySupplyBreakdown, b: CandySupplyBreakdown, pokemon: NormalizedPokemon, input: NormalizedInput): boolean {
  const type = input.contention.type[pokemon.type] ?? { s: 0, m: 0 };
  return (!input.contention.species[speciesKey(pokemon)] || a.species <= b.species)
    && (!type.s || a.type.s <= b.type.s) && (!type.m || a.type.m <= b.type.m)
    && (!input.contention.universal.s || a.universal.s <= b.universal.s)
    && (!input.contention.universal.m || a.universal.m <= b.universal.m)
    && (!input.contention.universal.l || a.universal.l <= b.universal.l);
}
function supplyDominates(a: CandySupplyBreakdown, b: CandySupplyBreakdown, total: number, pokemon: NormalizedPokemon, input: NormalizedInput): boolean {
  return a.species >= b.species
    && supplyUsageAtMost(a, b, pokemon, input)
    && supplyValue(a) - total <= supplyValue(b) - total
    && compareItemPriority(itemPriority(a), itemPriority(b)) >= 0;
}
function compareSupplyRetention(a: SupplyOption, b: SupplyOption, total: number, mode: PlannerOptions['itemCompareMode']): number {
  const compare = compareSupply(a.supply, b.supply, total, mode);
  if (compare) return -compare;
  return a.order - b.order;
}
function supplyCandidateLimit(pokemon: NormalizedPokemon, input: NormalizedInput): number {
  return input.contention.species[speciesKey(pokemon)] ? activeTuning.maxSharedSpeciesSupplyCandidates : activeTuning.maxSupplyCandidates;
}
function hasUncappedSupplyCandidates(): boolean {
  return !Number.isFinite(activeTuning.maxSupplyCandidates) && !Number.isFinite(activeTuning.maxSharedSpeciesSupplyCandidates);
}
function trimSupplyOptions(options: SupplyOption[], total: number, pokemon: NormalizedPokemon, input: NormalizedInput): SupplyOption[] {
  const limit = supplyCandidateLimit(pokemon, input);
  if (!Number.isFinite(limit)) return [...options].sort((a, b) => compareSupplyRetention(a, b, total, input.options.itemCompareMode));
  const hasSharedSpecies = Boolean(input.contention.species[speciesKey(pokemon)]);
  const sorted = [...options].sort((a, b) => compareSupplyRetention(a, b, total, input.options.itemCompareMode));
  if (sorted.length <= limit && !hasSharedSpecies) return sorted;
  const kept: SupplyOption[] = [];
  const keptKeys = new Set<string>();
  const add = (option: SupplyOption | undefined) => {
    if (!option) return;
    const key = supplyBreakdownKey(option.supply);
    if (keptKeys.has(key)) return;
    keptKeys.add(key);
    kept.push(option);
  };
  const bestMin = (valueOf: (option: SupplyOption) => number) => {
    let best = sorted[0];
    let bestValue = best ? valueOf(best) : 0;
    for (let index = 1; index < sorted.length; index++) {
      const option = sorted[index];
      const value = valueOf(option);
      if (value < bestValue || (value === bestValue && compareSupplyRetention(option, best, total, input.options.itemCompareMode) < 0)) {
        best = option;
        bestValue = value;
      }
    }
    return best;
  };
  let bestItemPriority = sorted[0];
  for (let index = 1; index < sorted.length; index++) {
    const option = sorted[index];
    const priority = compareItemPriority(itemPriority(option.supply), itemPriority(bestItemPriority.supply));
    const surplusOption = supplyValue(option.supply) - total;
    const surplusBest = supplyValue(bestItemPriority.supply) - total;
    if (priority > 0
      || (priority === 0 && surplusOption < surplusBest)
      || (priority === 0 && surplusOption === surplusBest && compareSupplyRetention(option, bestItemPriority, total, input.options.itemCompareMode) < 0)) {
      bestItemPriority = option;
    }
  }
  add(bestItemPriority);
  if (hasSharedSpecies) {
    const bestBySpecies = new Map<number, SupplyOption>();
    for (const option of sorted) {
      if (!bestBySpecies.has(option.supply.species)) bestBySpecies.set(option.supply.species, option);
    }
    for (const option of bestBySpecies.values()) add(option);
  }
  const type = input.contention.type[pokemon.type] ?? { s: 0, m: 0 };
  if (input.contention.species[speciesKey(pokemon)]) add(bestMin(option => option.supply.species));
  if (type.s) add(bestMin(option => option.supply.type.s));
  if (type.m) add(bestMin(option => option.supply.type.m));
  if (type.s || type.m) add(bestMin(option => option.supply.type.s * CANDY_VALUES.type.s + option.supply.type.m * CANDY_VALUES.type.m));
  if (input.contention.universal.s) add(bestMin(option => option.supply.universal.s));
  if (input.contention.universal.m) add(bestMin(option => option.supply.universal.m));
  if (input.contention.universal.l) add(bestMin(option => option.supply.universal.l));
  if (input.contention.universal.s || input.contention.universal.m || input.contention.universal.l) {
    add(bestMin(option => option.supply.universal.s * CANDY_VALUES.universal.s + option.supply.universal.m * CANDY_VALUES.universal.m + option.supply.universal.l * CANDY_VALUES.universal.l));
  }
  for (const option of sorted) {
    add(option);
    if (kept.length >= limit) break;
  }
  return kept.sort((a, b) => compareSupplyRetention(a, b, total, input.options.itemCompareMode));
}
function pushSupplyCandidate(
  selected: SupplyOption[],
  seen: Set<string>,
  option: SupplyOption,
  total: number,
  pokemon: NormalizedPokemon,
  input: NormalizedInput,
  limit: number,
): boolean {
  const key = supplyBreakdownKey(option.supply);
  if (seen.has(key)) return false;
  seen.add(key);
  if (selected.some(current => supplyDominates(current.supply, option.supply, total, pokemon, input))) return false;
  for (let index = selected.length - 1; index >= 0; index--) {
    if (supplyDominates(option.supply, selected[index].supply, total, pokemon, input)) selected.splice(index, 1);
  }
  selected.push(option);
  return Number.isFinite(limit) && selected.length >= limit;
}
function visitSupplyOptionsAtSurplus(
  total: number,
  targetSurplus: number,
  speciesMax: number,
  pokemon: NormalizedPokemon,
  input: NormalizedInput,
  type: TypeCandyStock,
  universal: UniversalCandyStock,
  visit: (supply: CandySupplyBreakdown) => void,
): void {
  const target = total + targetSurplus;
  const maxUniversalL = Math.min(universal.l, Math.floor(target / CANDY_VALUES.universal.l));
  for (let universalL = 0; universalL <= maxUniversalL; universalL++) {
    preparationCheckpoint();
    const afterL = universalL * CANDY_VALUES.universal.l;
    const maxUniversalM = Math.min(universal.m, Math.floor((target - afterL) / CANDY_VALUES.universal.m));
    for (let universalM = 0; universalM <= maxUniversalM; universalM++) {
      const afterM = afterL + universalM * CANDY_VALUES.universal.m;
      const maxTypeM = Math.min(type.m, Math.floor((target - afterM) / CANDY_VALUES.type.m));
      for (let typeM = 0; typeM <= maxTypeM; typeM++) {
        preparationCheckpoint();
        const base = afterM + typeM * CANDY_VALUES.type.m;
        const residual = target - base - speciesMax;
        if (residual < 0) continue;
        const minTypeS = Math.max(0, Math.ceil((residual - universal.s * CANDY_VALUES.universal.s) / CANDY_VALUES.type.s));
        const maxTypeS = Math.min(type.s, Math.floor(residual / CANDY_VALUES.type.s));
        if (minTypeS > maxTypeS) continue;
        const residue = ((residual % CANDY_VALUES.universal.s) + CANDY_VALUES.universal.s) % CANDY_VALUES.universal.s;
        const firstTypeS = minTypeS + ((residue - minTypeS) % CANDY_VALUES.universal.s + CANDY_VALUES.universal.s) % CANDY_VALUES.universal.s;
        if (firstTypeS > maxTypeS) continue;
        for (let typeS = firstTypeS; typeS <= maxTypeS; typeS += CANDY_VALUES.universal.s) {
          preparationCheckpoint();
          const universalS = (residual - typeS * CANDY_VALUES.type.s) / CANDY_VALUES.universal.s;
          if (universalS < 0 || universalS > universal.s) continue;
          visit({
            species: speciesMax,
            type: { s: typeS, m: typeM },
            universal: { s: universalS, m: universalM, l: universalL },
          });
        }
      }
    }
  }
}
/** 候補列挙用。実在庫だけを使い、種族アメは原則使い切る。 */
function enumerateCandySupplyCandidates(total: number, pokemon: NormalizedPokemon, input: NormalizedInput): CandySupplyBreakdown[] {
  if (total === 0) return [emptySupply()];
  const key = supplyCacheKey(total, pokemon, input);
  const cached = supplyCandidateCache.get(key);
  if (cached) {
    recordSupplyCandidateCut(key, cached.cut);
    return cached.candidates;
  }
  const keySpecies = speciesKey(pokemon);
  const speciesStock = input.candyInventory.species[keySpecies] ?? 0;
  const speciesMax = Math.min(speciesStock, total);
  const hasSharedSpecies = Boolean(input.contention.species[keySpecies]);
  if (!hasSharedSpecies && speciesMax >= total) {
    const resolved = [{ ...emptySupply(), species: total }];
    supplyCandidateCache.set(key, { candidates: resolved });
    return resolved;
  }
  const type = input.candyInventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const universal = input.candyInventory.universal;
  const selected: SupplyOption[] = [];
  const seen = new Set<string>();
  let order = 0;
  const limit = supplyCandidateLimit(pokemon, input);
  let stoppedAtSurplus: number = CANDY_VALUES.universal.l;

  for (let targetSurplus = 0; targetSurplus <= CANDY_VALUES.universal.l; targetSurplus++) {
    visitSupplyOptionsAtSurplus(total, targetSurplus, speciesMax, pokemon, input, type, universal, supply => {
      pushSupplyCandidate(selected, seen, { supply, order: order++ }, total, pokemon, input, limit);
    });
    if (Number.isFinite(limit)) selected.splice(0, selected.length, ...trimSupplyOptions(selected, total, pokemon, input));
    if (Number.isFinite(limit) && selected.length >= limit
      && (!hasSharedSpecies || targetSurplus >= MAX_ACCEPTABLE_SURPLUS)
      && (!isLegacyLikeMode(input.options.itemCompareMode) || targetSurplus >= MAX_ACCEPTABLE_SURPLUS)) {
      stoppedAtSurplus = targetSurplus;
      break;
    }
  }
  const selectedBeforeFinalTrim = selected.length;
  const result = trimSupplyOptions(selected, total, pokemon, input).map(option => option.supply);
  const truncatedByLayer = stoppedAtSurplus < CANDY_VALUES.universal.l;
  const truncatedByFinalTrim = selectedBeforeFinalTrim > result.length;
  const cut: PlannerLossLedger['supplyCandidateCuts'][number] | undefined = truncatedByLayer || truncatedByFinalTrim ? {
    pokemonId: pokemon.pokemonId,
    name: pokemon.name,
    pokedexId: pokemon.pokedexId,
    totalCandyUnits: total,
    limit,
    kept: result.length,
    selectedBeforeTrim: selectedBeforeFinalTrim,
    stoppedAtSurplus,
    maxSurplus: CANDY_VALUES.universal.l,
    sharedSpecies: hasSharedSpecies,
    itemCompareMode: input.options.itemCompareMode,
  } : undefined;
  supplyCandidateCache.set(key, { candidates: result, cut });
  recordSupplyCandidateCut(key, cut);
  return result;
}
/** 配分方針「余り最小」では、表示用の理論配分でも余り最小を優先する。 */
function prefersMinSurplusDisplay(input: NormalizedInput): boolean {
  return input.options.itemCompareMode === 'surplusFirst';
}

/** 表示用。理論値行だけは不足分を万能Sで補填する。 */
function resolveDisplayCandySupply(total: number, pokemon: NormalizedPokemon, inventory: CandyInventory, allowUniversalSFill: boolean, preferMinSurplus: boolean): CandySupplyBreakdown {
  if (total === 0) return emptySupply();
  const type = inventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const species = Math.min(inventory.species[speciesKey(pokemon)] ?? 0, total);
  const remaining = total - species;
  const allocation = findBestItemAllocation(remaining, type, inventory.universal, preferMinSurplus);
  const missing = Math.max(0, remaining - allocation.supplied);
  return {
    species,
    type: { s: allocation.typeS, m: allocation.typeM },
    universal: {
      s: allocation.universalS + (allowUniversalSFill ? Math.ceil(missing / CANDY_VALUES.universal.s) : 0),
      m: allocation.universalM,
      l: allocation.universalL,
    },
  };
}

/**
 * 実配分を正本にし、理論値行では不足分を「在庫に残る種族アメ → 理論上の万能S」の順で補う。
 *
 * 種族アメは価値1で余りを生まないため、仕様どおり常に先に使い切る。
 * 実配分がかけら・アメブ律速で在庫の種族アメを使い切っていない場合、
 * 万能Sだけで補うと理論値行が「まだ持っている種族アメ」を無視した必要量になる。
 */
function addTheoreticalSupplyFill(supply: CandySupplyBreakdown, total: number, pokemon: NormalizedPokemon, inventory: CandyInventory): CandySupplyBreakdown {
  const shortfall = Math.max(0, total - supplyValue(supply));
  const speciesLeft = Math.max(0, (inventory.species[speciesKey(pokemon)] ?? 0) - supply.species);
  const speciesFill = Math.min(speciesLeft, shortfall);
  const missing = shortfall - speciesFill;
  return {
    species: supply.species + speciesFill,
    type: { ...supply.type },
    universal: { ...supply.universal, s: supply.universal.s + Math.ceil(missing / CANDY_VALUES.universal.s) },
  };
}

function usageFrom(pokemon: NormalizedPokemon, line: PokemonPlanLine): Usage {
  const supply = line.candySupply;
  return { boost: line.boostedCandyUnits, shards: line.dreamShardsUsed, species: { [speciesKey(pokemon)]: supply.species }, type: { [pokemon.type]: { ...supply.type } }, universal: { ...supply.universal } };
}
function mergeUsage(a: Usage, b: Usage): Usage {
  const result = copyUsage(a);
  result.boost += b.boost;
  result.shards += b.shards;
  for (const [key, amount] of Object.entries(b.species)) {
    result.species[key] = (result.species[key] ?? 0) + amount;
  }
  for (const [key, amount] of Object.entries(b.type)) {
    addType(result.type, key, amount.s, amount.m);
  }
  result.universal.s += b.universal.s;
  result.universal.m += b.universal.m;
  result.universal.l += b.universal.l;
  return result;
}
function remainingCandyValue(input: NormalizedInput, usage: Usage, pokemon: NormalizedPokemon): number {
  const species = Math.max(0, (input.candyInventory.species[speciesKey(pokemon)] ?? 0) - (usage.species[speciesKey(pokemon)] ?? 0));
  const type = input.candyInventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const usedType = usage.type[pokemon.type] ?? { s: 0, m: 0 };
  return species + Math.max(0, type.s - usedType.s) * CANDY_VALUES.type.s + Math.max(0, type.m - usedType.m) * CANDY_VALUES.type.m
    + Math.max(0, input.candyInventory.universal.s - usage.universal.s) * CANDY_VALUES.universal.s
    + Math.max(0, input.candyInventory.universal.m - usage.universal.m) * CANDY_VALUES.universal.m
    + Math.max(0, input.candyInventory.universal.l - usage.universal.l) * CANDY_VALUES.universal.l;
}
/**
 * アメが担当する到達点（`effectiveLevel + effectiveExp`）へ届いたか（§11.3）。
 *
 * `candyDemandMet`（＝予定アメを配れたか）とは別概念。個数指定があるときは、アメブ枠不足で
 * 通常アメへ置換されると**予定アメを配り切っても目標Lvへ届かない**（実測: 目標Lv40 に対し Lv34）。
 * 不足診断はこちらで門番しないと、律速表示が丸ごと消える。
 *
 * Lv70 は硬上限でそれ以上進めないため到達扱いにする（§10.16 修正4 と同じ理由）。
 */
function reachedEffectiveTarget(
  pokemon: Pick<NormalizedPokemon, 'effectiveLevel' | 'effectiveExp'>,
  reached: { level: number; expInLevel: number },
): boolean {
  return cmpLevel(reached, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) >= 0
    || reached.level >= maxLevel;
}
function makeLineFromReached(pokemon: NormalizedPokemon, reached: ReturnType<typeof simulate>, supply: CandySupplyBreakdown): PokemonPlanLine {
  const used = reached.boostUsed + reached.normalUsed;
  return {
    level: reached.level, expInLevel: reached.expInLevel,
    expToNextLevel: Math.max(0, calcExp(reached.level, reached.level + 1, pokemon.expType) - reached.expInLevel),
    expToTarget: Math.max(0, calcExp(reached.level, pokemon.effectiveLevel, pokemon.expType) + pokemon.effectiveExp - reached.expInLevel),
    totalCandyUnitsUsed: used, boostedCandyUnits: reached.boostUsed, nonBoostCandyUnits: reached.normalUsed,
    candySupply: supply, dreamShardsUsed: reached.shards, expGained: reached.expGained,
    surplusExp: Math.max(0, reached.expInLevel - pokemon.effectiveExp), surplusCandyValue: Math.max(0, supplyValue(supply) - used),
    candyDemandMet: cmpLevel(reached, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) >= 0,
    effectiveTargetReached: reachedEffectiveTarget(pokemon, reached),
  };
}
function makeCandyTargetLineFromReached(pokemon: NormalizedPokemon, reached: ReturnType<typeof simulateCandyBudget>, supply: CandySupplyBreakdown, totalBudget: number): PokemonPlanLine {
  const used = reached.boostUsed + reached.normalUsed;
  const targetTotal = pokemon.candyTarget?.totalCandyUnits ?? totalBudget;
  return {
    level: reached.level, expInLevel: reached.expInLevel,
    expToNextLevel: Math.max(0, calcExp(reached.level, reached.level + 1, pokemon.expType) - reached.expInLevel),
    expToTarget: Math.max(0, calcExp(reached.level, pokemon.effectiveLevel, pokemon.expType) + pokemon.effectiveExp - reached.expInLevel),
    totalCandyUnitsUsed: used, boostedCandyUnits: reached.boostUsed, nonBoostCandyUnits: reached.normalUsed,
    candySupply: supply, dreamShardsUsed: reached.shards, expGained: reached.expGained,
    surplusExp: Math.max(0, reached.expInLevel - pokemon.effectiveExp), surplusCandyValue: Math.max(0, supplyValue(supply) - used),
    candyDemandMet: used >= targetTotal || reached.level >= maxLevel,
    effectiveTargetReached: reachedEffectiveTarget(pokemon, reached),
  };
}
function staticBoostValues(pokemon: NormalizedPokemon, input: NormalizedInput): number[] {
  return [maxBoostFor(pokemon, input.boost.kind, input.boost.limit)];
}
function availableInventoryValue(input: NormalizedInput, pokemon: NormalizedPokemon): number {
  const type = input.candyInventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  return (input.candyInventory.species[speciesKey(pokemon)] ?? 0)
    + type.s * CANDY_VALUES.type.s + type.m * CANDY_VALUES.type.m
    + input.candyInventory.universal.s * CANDY_VALUES.universal.s
    + input.candyInventory.universal.m * CANDY_VALUES.universal.m
    + input.candyInventory.universal.l * CANDY_VALUES.universal.l;
}
function withStableIndexes(candidates: Candidate[]): Candidate[] {
  return [...candidates]
    .sort((a, b) => {
      if (a.line.candySupply.species !== b.line.candySupply.species) return b.line.candySupply.species - a.line.candySupply.species;
      const priority = compareItemPriority(itemPriority(a.line.candySupply), itemPriority(b.line.candySupply));
      if (priority) return -priority;
      return stableJson(a.line.candySupply).localeCompare(stableJson(b.line.candySupply));
    })
    .map((candidate, stableIndex) => ({ ...candidate, stableIndex }));
}
function uniqueBudgets(budgets: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>();
  const result: Array<[number, number]> = [];
  for (const budget of budgets) {
    const key = `${budget[0]}|${budget[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(budget);
  }
  return result;
}
function candidateForBoost(pokemon: NormalizedPokemon, input: NormalizedInput, boost: number, shardLimit = Infinity, onlyTarget = false, candyLimit = Infinity, inventory: CandyInventory = input.candyInventory): Candidate[] {
  const supplyInput = inventory === input.candyInventory ? input : { ...input, candyInventory: inventory };
  if (pokemon.candyTarget) {
    if (onlyTarget && candyLimit < pokemon.candyTarget.totalCandyUnits) return [];
    const totalBudget = Math.min(pokemon.candyTarget.totalCandyUnits, candyLimit);
    const boostBudget = Math.min(boost, totalBudget);
    const reached = simulateCandyBudget(pokemon, boostBudget, totalBudget, shardLimit, input.boost.kind);
    const used = reached.boostUsed + reached.normalUsed;
    return enumerateCandySupplyCandidates(used, pokemon, supplyInput).map((supply, stableIndex) => {
      const line = makeCandyTargetLineFromReached(pokemon, reached, supply, totalBudget);
      return { p: pokemon, line, usage: usageFrom(pokemon, line), stableIndex };
    });
  }
  const target = targetMixed(pokemon, input.boost.kind, boost);
  const budgets: Array<[number, number]> = [[target.boostCandy, target.normalCandy]];
  if (!onlyTarget) {
    // 在庫・遷移時の残価値でちょうど止まる未達候補。供給不足で候補が全滅しないようにする。
    const cappedTotal = Math.min(target.boostCandy + target.normalCandy, candyLimit);
    const cappedBoost = Math.min(target.boostCandy, cappedTotal);
    budgets.push([cappedBoost, Math.max(0, cappedTotal - cappedBoost)]);
  }
  const all: Candidate[] = [];
  let stableIndex = 0;
  for (const [boostBudget, normalBudget] of uniqueBudgets(budgets)) {
    const provisional = simulate(pokemon, boostBudget, normalBudget, shardLimit, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
    const used = provisional.boostUsed + provisional.normalUsed;
    for (const supply of enumerateCandySupplyCandidates(used, pokemon, supplyInput)) {
      all.push({ p: pokemon, line: makeLineFromReached(pokemon, provisional, supply), usage: emptyUsage(), stableIndex: stableIndex++ });
    }
  }
  return all.map(candidate => ({ ...candidate, usage: usageFrom(pokemon, candidate.line) }));
}
function resourceAtMost(a: Usage, b: Usage, contention?: Contention): boolean {
  if ((!contention || contention.boost) && a.boost > b.boost) return false;
  if ((!contention || contention.shards) && a.shards > b.shards) return false;
  const speciesKeys = new Set([...Object.keys(a.species), ...Object.keys(b.species)]);
  for (const key of speciesKeys) if ((!contention || contention.species[key]) && (a.species[key] ?? 0) > (b.species[key] ?? 0)) return false;
  const typeKeys = new Set([...Object.keys(a.type), ...Object.keys(b.type)]);
  for (const key of typeKeys) {
    const contended = contention?.type[key];
    const aa = a.type[key] ?? { s: 0, m: 0 };
    const bb = b.type[key] ?? { s: 0, m: 0 };
    if ((!contention || contended?.s) && aa.s > bb.s) return false;
    if ((!contention || contended?.m) && aa.m > bb.m) return false;
  }
  return (!contention || contention.universal.s ? a.universal.s <= b.universal.s : true)
    && (!contention || contention.universal.m ? a.universal.m <= b.universal.m : true)
    && (!contention || contention.universal.l ? a.universal.l <= b.universal.l : true);
}
function candidateDominates(a: Candidate, b: Candidate): boolean {
  return a.line.level === b.line.level && a.line.expInLevel === b.line.expInLevel && a.line.candyDemandMet === b.line.candyDemandMet
    && a.line.candySupply.species >= b.line.candySupply.species
    && resourceAtMost(a.usage, b.usage) && a.line.surplusExp <= b.line.surplusExp
    && a.line.surplusCandyValue <= b.line.surplusCandyValue
    && compareItemPriority(itemPriority(a.line.candySupply), itemPriority(b.line.candySupply)) >= 0;
}
function pruneExcessSurplusCandidates(candidates: Candidate[], input: NormalizedInput): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.line.level}/${candidate.line.expInLevel}/${candidate.line.candyDemandMet}/${candidate.line.boostedCandyUnits}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const result: Candidate[] = [];
  for (const group of groups.values()) {
    result.push(...group.filter(candidate => candidate.line.surplusCandyValue <= MAX_ACCEPTABLE_SURPLUS));
    const excess = group.filter(candidate => candidate.line.surplusCandyValue > MAX_ACCEPTABLE_SURPLUS);
    if (excess.length === 0) continue;
    const minSurplus = Math.min(...excess.map(candidate => candidate.line.surplusCandyValue));
    const bestMin = excess.filter(candidate => candidate.line.surplusCandyValue === minSurplus).sort((a, b) => -compareCandidate(a, b, input.options.itemCompareMode))[0];
    const boundaries = excess.filter(candidate => !excess.some(other =>
      other !== candidate
      && other.line.candySupply.species >= candidate.line.candySupply.species
      && other.line.surplusCandyValue <= candidate.line.surplusCandyValue
      && resourceAtMost(other.usage, candidate.usage)
      && compareItemPriority(itemPriority(other.line.candySupply), itemPriority(candidate.line.candySupply)) >= 0
    ));
    for (const candidate of [bestMin, ...boundaries]) {
      if (candidate && !result.includes(candidate)) result.push(candidate);
    }
  }
  return result;
}
function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  return [...new Map(candidates.map(candidate => [`${candidate.line.level}/${candidate.line.expInLevel}/${candidate.line.boostedCandyUnits}/${stableJson(candidate.line.candySupply)}`, candidate])).values()];
}
function pruneExactSafeCandidates(candidates: Candidate[], input: NormalizedInput): Candidate[] {
  const unique = dedupeCandidates(candidates);
  const frontier: Candidate[] = [];
  for (const candidate of unique.sort((a, b) => -compareCandidate(a, b, input.options.itemCompareMode))) {
    if (frontier.some(other => candidateDominates(other, candidate))) continue;
    for (let index = frontier.length - 1; index >= 0; index--) {
      if (candidateDominates(candidate, frontier[index])) frontier.splice(index, 1);
    }
    frontier.push(candidate);
  }
  const pruned = frontier;
  const allNonContended = !input.contention.boost && !input.contention.shards && !Object.values(input.contention.species).some(Boolean)
    && !Object.values(input.contention.type).some(value => Boolean(value.s || value.m)) && !Object.values(input.contention.universal).some(Boolean);
  if (!allNonContended) return withStableIndexes(pruned);
  const bestByReachedState = new Map<string, Candidate>();
  for (const candidate of pruned) {
    const key = `${candidate.line.level}/${candidate.line.expInLevel}/${candidate.line.candyDemandMet}`;
    const previous = bestByReachedState.get(key);
    if (!previous || compareCandidate(candidate, previous, input.options.itemCompareMode) > 0) bestByReachedState.set(key, candidate);
  }
  return withStableIndexes([...bestByReachedState.values()]);
}
function pruneCandidates(candidates: Candidate[], input: NormalizedInput): Candidate[] {
  return withStableIndexes(pruneExcessSurplusCandidates(pruneExactSafeCandidates(candidates, input), input));
}
function compareCandidate(a: Candidate, b: Candidate, mode: PlannerOptions['itemCompareMode']): number {
  const level = cmpLevel(a.line, b.line); if (level) return level;
  if (a.line.candySupply.species !== b.line.candySupply.species) return a.line.candySupply.species > b.line.candySupply.species ? 1 : -1;
  if (usesZeroSurplusPriority(mode) && (candidateUsesZeroSurplusPriority(a, mode) || candidateUsesZeroSurplusPriority(b, mode))) {
    const zeroA = candidateAchievedZeroSurplusPriority(a, mode) ? 1 : 0;
    const zeroB = candidateAchievedZeroSurplusPriority(b, mode) ? 1 : 0;
    if (zeroA !== zeroB) return zeroA > zeroB ? 1 : -1;
  }
  const supply = compareSupply(a.line.candySupply, b.line.candySupply, a.line.totalCandyUnitsUsed, mode); if (supply) return supply;
  if (a.line.surplusExp !== b.line.surplusExp) return a.line.surplusExp < b.line.surplusExp ? 1 : -1;
  if (a.line.dreamShardsUsed !== b.line.dreamShardsUsed) return a.line.dreamShardsUsed < b.line.dreamShardsUsed ? 1 : -1;
  return b.stableIndex - a.stableIndex;
}
function cacheKey(pokemon: NormalizedPokemon, input: NormalizedInput): string {
  const species = speciesKey(pokemon);
  const duplicateSpecies = input.pokemonList.filter(item => speciesKey(item) === species).length > 1;
  return stableJson({ pokemon, inventory: input.candyInventory, boost: input.boost, options: input.options, contention: input.contention, speciesNeed: duplicateSpecies ? input.speciesNeeds[species] : undefined, tuning: activeTuning });
}
function cacheCandidates(key: string, candidates: Candidate[]): Candidate[] {
  candidateCache.set(key, candidates);
  if (candidateCache.size > CANDIDATE_CACHE_LIMIT) candidateCache.delete(candidateCache.keys().next().value!);
  return candidates;
}
function generatePokemonCandidates(pokemon: NormalizedPokemon, input: NormalizedInput): Candidate[] {
  preparationCheckpoint();
  const key = cacheKey(pokemon, input); const cached = candidateCache.get(key);
  if (cached) return cached;
  // 0配分は非転落不変条件の前提でもあるため、資源が非競合でも必ず残す。
  const candidates = [
    { p: pokemon, line: zeroLine(pokemon), usage: emptyUsage(), stableIndex: -1 },
    ...staticBoostValues(pokemon, input).flatMap(boost => candidateForBoost(pokemon, input, boost, Infinity, false, availableInventoryValue(input, pokemon))),
  ];
  if (hasUncappedSupplyCandidates()) return cacheCandidates(key, pruneExactSafeCandidates(candidates, input));
  return cacheCandidates(key, pruneCandidates(candidates, input));
}
function stateForChoices(choices: Candidate[], mode: PlannerOptions['itemCompareMode']): State {
  let usage = emptyUsage(); let prefix = 0; let boundary: Candidate | undefined; let metrics = emptyStateMetrics();
  for (const candidate of choices) {
    usage = mergeUsage(usage, candidate.usage);
    metrics = appendStateMetrics(metrics, candidate, mode);
    if (!boundary && candidate.line.candyDemandMet) prefix++;
    else if (!boundary) boundary = candidate;
  }
  return { choices, usage, reachedPrefixCount: prefix, boundary, metrics };
}
function compareStableOrder(a: State, b: State): number {
  const length = Math.max(a.choices.length, b.choices.length);
  for (let index = 0; index < length; index++) {
    const aa = a.choices[index]?.stableIndex ?? Number.MAX_SAFE_INTEGER;
    const bb = b.choices[index]?.stableIndex ?? Number.MAX_SAFE_INTEGER;
    if (aa !== bb) return aa < bb ? 1 : -1;
  }
  return 0;
}
function compareBoundaryProgress(a: State, b: State): number {
  if (!a.boundary && !b.boundary) return 0;
  if (!a.boundary) return 1;
  if (!b.boundary) return -1;
  const level = cmpLevel(a.boundary.line, b.boundary.line);
  return level ? level > 0 ? 1 : -1 : 0;
}
function compareState(a: State, b: State, mode: PlannerOptions['itemCompareMode'], includeStableOrder = true): number {
  const surplusA = a.metrics.rawSurplus; const surplusB = b.metrics.rawSurplus;
  if (mode === 'surplusFirst') {
    if (a.reachedPrefixCount !== b.reachedPrefixCount) return a.reachedPrefixCount > b.reachedPrefixCount ? 1 : -1;
    if (a.metrics.reachedSurplus !== b.metrics.reachedSurplus) return a.metrics.reachedSurplus < b.metrics.reachedSurplus ? 1 : -1;
    const boundaryProgress = compareBoundaryProgress(a, b);
    if (boundaryProgress) return boundaryProgress;
    if (a.metrics.zeroSurplusCount !== b.metrics.zeroSurplusCount) return a.metrics.zeroSurplusCount > b.metrics.zeroSurplusCount ? 1 : -1;
    if (surplusA !== surplusB) return surplusA < surplusB ? 1 : -1;
    const item = compareItemPriority(a.metrics.itemPriority, b.metrics.itemPriority); if (item) return item;
    if (a.metrics.surplusExp !== b.metrics.surplusExp) return a.metrics.surplusExp < b.metrics.surplusExp ? 1 : -1;
    if (a.usage.shards !== b.usage.shards) return a.usage.shards < b.usage.shards ? 1 : -1;
    return includeStableOrder ? compareStableOrder(a, b) : 0;
  }
  if (a.reachedPrefixCount !== b.reachedPrefixCount) return a.reachedPrefixCount > b.reachedPrefixCount ? 1 : -1;
  // §15: fbl01d の speciesUsed は各系統で最大使用を不変条件にするため、比較軸にしない。
  const boundaryProgress = compareBoundaryProgress(a, b);
  if (boundaryProgress) return boundaryProgress;
  if (usesZeroSurplusPriority(mode) && a.metrics.zeroSurplusCount !== b.metrics.zeroSurplusCount) return a.metrics.zeroSurplusCount > b.metrics.zeroSurplusCount ? 1 : -1;
  const acceptableA = hasOnlyAcceptableRowSurplus(a.metrics);
  const acceptableB = hasOnlyAcceptableRowSurplus(b.metrics);
  if (acceptableA !== acceptableB) return acceptableA > acceptableB ? 1 : -1;
  if (!acceptableA && a.metrics.normalizedSurplus !== b.metrics.normalizedSurplus) return a.metrics.normalizedSurplus < b.metrics.normalizedSurplus ? 1 : -1;
  const item = compareItemPriority(a.metrics.itemPriority, b.metrics.itemPriority); if (item) return item;
  // 余り0〜2を同等扱いする分、スコア同点でも供給価値がずれる。ここで明示的に詰める。
  if (surplusA !== surplusB) return surplusA < surplusB ? 1 : -1;
  if (a.metrics.surplusExp !== b.metrics.surplusExp) return a.metrics.surplusExp < b.metrics.surplusExp ? 1 : -1;
  if (a.usage.shards !== b.usage.shards) return a.usage.shards < b.usage.shards ? 1 : -1;
  return includeStableOrder ? compareStableOrder(a, b) : 0;
}
function stateForWitness(witness: FeasibilityWitness, input: NormalizedInput): State {
  return stateForChoices(witness.rows.map((row, index) => candidateFromFeasibleRow(row, input.pokemonList[index], index)), input.options.itemCompareMode);
}
function compareSurplusFirstBoundaryState(a: State, b: State, includeStableOrder = true): number {
  if (a.reachedPrefixCount !== b.reachedPrefixCount) return a.reachedPrefixCount > b.reachedPrefixCount ? 1 : -1;
  if (a.metrics.reachedSurplus !== b.metrics.reachedSurplus) return a.metrics.reachedSurplus < b.metrics.reachedSurplus ? 1 : -1;
  const boundaryProgress = compareBoundaryProgress(a, b);
  if (boundaryProgress) return boundaryProgress;
  if (a.metrics.zeroSurplusCount !== b.metrics.zeroSurplusCount) return a.metrics.zeroSurplusCount > b.metrics.zeroSurplusCount ? 1 : -1;
  if (a.metrics.rawSurplus !== b.metrics.rawSurplus) return a.metrics.rawSurplus < b.metrics.rawSurplus ? 1 : -1;
  const item = compareItemPriority(a.metrics.itemPriority, b.metrics.itemPriority);
  if (item) return item;
  if (a.metrics.surplusExp !== b.metrics.surplusExp) return a.metrics.surplusExp < b.metrics.surplusExp ? 1 : -1;
  if (a.usage.shards !== b.usage.shards) return a.usage.shards < b.usage.shards ? 1 : -1;
  return includeStableOrder ? compareStableOrder(a, b) : 0;
}
function compareSurplusGateBoundaryState(a: State, b: State, includeStableOrder = true): number {
  if (a.reachedPrefixCount !== b.reachedPrefixCount) return a.reachedPrefixCount > b.reachedPrefixCount ? 1 : -1;
  const acceptableA = hasOnlyAcceptableRowSurplus(a.metrics);
  const acceptableB = hasOnlyAcceptableRowSurplus(b.metrics);
  if (acceptableA !== acceptableB) return acceptableA ? 1 : -1;
  if (!acceptableA && a.metrics.normalizedSurplus !== b.metrics.normalizedSurplus) return a.metrics.normalizedSurplus < b.metrics.normalizedSurplus ? 1 : -1;
  const boundaryProgress = compareBoundaryProgress(a, b);
  if (boundaryProgress) return boundaryProgress;
  const item = compareItemPriority(a.metrics.itemPriority, b.metrics.itemPriority);
  if (item) return item;
  // 余り0〜2を同等扱いする分、スコア同点でも供給価値がずれる。ここで明示的に詰める。
  if (a.metrics.rawSurplus !== b.metrics.rawSurplus) return a.metrics.rawSurplus < b.metrics.rawSurplus ? 1 : -1;
  if (a.metrics.surplusExp !== b.metrics.surplusExp) return a.metrics.surplusExp < b.metrics.surplusExp ? 1 : -1;
  if (a.usage.shards !== b.usage.shards) return a.usage.shards < b.usage.shards ? 1 : -1;
  return includeStableOrder ? compareStableOrder(a, b) : 0;
}
function boundarySearchSummary(
  witness: FeasibilityWitness,
  input: NormalizedInput,
  params: {
    mode: ItemCompareMode;
    boundaryIndex: number;
    targetTotalCandy: number;
    maxFeasibleTotalCandy: number;
    maxFeasibleScope: BoundarySearchSummary['maxFeasibleScope'];
    checkedLowerTotals: number;
    feasibleLowerTotals: number;
    rejectedLowerTotals: number;
    inconclusiveLowerTotals: number;
    rowSurplusGateSkippedTotals: number;
    decisionRejectedLowerTotals: number;
    firstZeroRawSurplusTotalCandy?: number;
    stoppedReason: BoundarySearchSummary['stoppedReason'];
    rawSurplusTrend: BoundarySearchSummary['rawSurplusTrend'];
    samplesTruncated: boolean;
    samples: BoundarySearchSummary['samples'];
  },
): BoundarySearchSummary {
  const state = stateForWitness(witness, input);
  const selected = witness.rows[params.boundaryIndex];
  return {
    mode: params.mode,
    boundaryIndex: params.boundaryIndex,
    targetTotalCandy: params.targetTotalCandy,
    maxFeasibleTotalCandy: params.maxFeasibleTotalCandy,
    maxFeasibleScope: params.maxFeasibleScope,
    selectedTotalCandy: selected?.totalCandy ?? 0,
    checkedLowerTotals: params.checkedLowerTotals,
    feasibleLowerTotals: params.feasibleLowerTotals,
    rejectedLowerTotals: params.rejectedLowerTotals,
    inconclusiveLowerTotals: params.inconclusiveLowerTotals,
    rowSurplusGateSkippedTotals: params.rowSurplusGateSkippedTotals,
    decisionRejectedLowerTotals: params.decisionRejectedLowerTotals,
    firstZeroRawSurplusTotalCandy: params.firstZeroRawSurplusTotalCandy,
    selectedRawSurplus: state.metrics.rawSurplus,
    selectedNormalizedSurplus: state.metrics.normalizedSurplus,
    selectedBoundaryLevel: witness.boundaryLevel,
    selectedBoundaryExpInLevel: witness.boundaryExpInLevel,
    stoppedReason: params.stoppedReason,
    rawSurplusTrend: params.rawSurplusTrend,
    samplesTruncated: params.samplesTruncated,
    samples: params.samples,
  };
}
const FBL01D_DEFAULT_DEADLINE_MS = 30_000;
const FBL01D_FAST_REFINE_MS = 250;
/**
 * 下位行の合同探索に許す時間（§14.4.1）。下位は到達数の保証対象ではないので、
 * refine と同じ「任意の品質改善には上限を切る」扱いにする。主探索が 200ms で終わった入力で、
 * この処理だけが残り 29.8 秒を使い切って体感を壊すことを防ぐ。
 */
const FBL01D_LOWER_JOINT_DEADLINE_MS = 1_000;
const FBL01D_REFINE_SKIP_AFTER_FEASIBILITY_MS = 1_750;
const FBL01D_FRONTIER_CACHE_LIMIT = 256;
const FBL01D_BOUNDARY_SEARCH_SAMPLE_LIMIT = 200;
const fbl01dFrontierCache = new Map<string, unknown>();
const fbl01dGlobalPrefixCache = new Map<string, unknown>();
const fbl01dRowFrontierCache = new Map<string, unknown>();

function fbl01dSolverOptions(input: NormalizedInput, deadlineAt: number): FeasibilitySolverOptions {
  const remainingDeadline = Math.max(0, deadlineAt - performance.now());
  return {
    // 相対の `deadlineMs` は context ごとに測り直されるため、prefix 二分探索では
    // probe ごとに満額使えてしまう。絶対締切も渡して合計を押さえる。
    deadlineAt,
    boostKind: input.boost.kind,
    boostLimit: input.boost.limit,
    dreamShards: input.dreamShards,
    itemCompareMode: input.options.itemCompareMode,
    deadlineMs: remainingDeadline,
    logPerformance: isPerfEnabled(),
  };
}

function trimFbl01dFrontierCache(): void {
  while (fbl01dFrontierCache.size > FBL01D_FRONTIER_CACHE_LIMIT) {
    const oldestKey = fbl01dFrontierCache.keys().next().value;
    if (oldestKey === undefined) return;
    fbl01dFrontierCache.delete(oldestKey);
  }
  while (fbl01dGlobalPrefixCache.size > FBL01D_FRONTIER_CACHE_LIMIT) {
    const oldestKey = fbl01dGlobalPrefixCache.keys().next().value;
    if (oldestKey === undefined) return;
    fbl01dGlobalPrefixCache.delete(oldestKey);
  }
  while (fbl01dRowFrontierCache.size > FBL01D_FRONTIER_CACHE_LIMIT) {
    const oldestKey = fbl01dRowFrontierCache.keys().next().value;
    if (oldestKey === undefined) return;
    fbl01dRowFrontierCache.delete(oldestKey);
  }
}

function feasibilityPreferZeroSurplus(
  pokemon: NormalizedPokemon,
  input: NormalizedInput,
  reachedLv: number,
  expInLevel: number,
): boolean {
  return Boolean(pokemon.preferZeroSurplus)
    || (usesZeroSurplusPriority(input.options.itemCompareMode) && reachedLv >= maxLevel && expInLevel === 0);
}

function targetDemandRowForPokemon(
  pokemon: NormalizedPokemon,
  input: NormalizedInput,
  remainingBoost = Number.POSITIVE_INFINITY,
  remainingShards = Number.POSITIVE_INFINITY,
): FeasibilityDemandRow {
  if (pokemon.candyTarget) {
    const totalCandy = pokemon.candyTarget.totalCandyUnits;
    const requestedBoost = fixedCandyTargetBoostBudget(pokemon, input.boost.kind, totalCandy, remainingBoost);
    const reached = simulateCandyBudget(pokemon, requestedBoost, totalCandy, remainingShards, input.boost.kind);
    const used = reached.boostUsed + reached.normalUsed;
    const candyTargetReached = used >= totalCandy;
    const candyDemandMet = candyTargetReached || reached.level >= maxLevel;
    return {
      pokemonId: pokemon.pokemonId,
      pokedexId: pokemon.pokedexId,
      candyFamilyKey: pokemon.candyFamilyKey,
      type: pokemon.type,
      totalCandy: candyTargetReached ? totalCandy : used,
      boostCandy: reached.boostUsed,
      normalCandy: candyTargetReached ? Math.max(0, totalCandy - reached.boostUsed) : reached.normalUsed,
      shards: reached.shards,
      reachedLv: reached.level,
      expInLevel: reached.expInLevel,
      candyDemandMet,
      preferZeroSurplus: feasibilityPreferZeroSurplus(pokemon, input, reached.level, reached.expInLevel),
    };
  }
  const boost = maxBoostFor(pokemon, input.boost.kind, remainingBoost);
  const mixed = targetMixed(pokemon, input.boost.kind, boost);
  const reached = simulate(pokemon, mixed.boostCandy, mixed.normalCandy, remainingShards, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
  const candyDemandMet = cmpLevel(reached, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) >= 0;
  return {
    pokemonId: pokemon.pokemonId,
    pokedexId: pokemon.pokedexId,
    candyFamilyKey: pokemon.candyFamilyKey,
    type: pokemon.type,
    totalCandy: reached.boostUsed + reached.normalUsed,
    boostCandy: reached.boostUsed,
    normalCandy: reached.normalUsed,
    shards: reached.shards,
    reachedLv: reached.level,
    expInLevel: reached.expInLevel,
    candyDemandMet,
    preferZeroSurplus: feasibilityPreferZeroSurplus(pokemon, input, reached.level, reached.expInLevel),
  };
}

function demandRowForCandyBudget(
  pokemon: NormalizedPokemon,
  input: NormalizedInput,
  totalCandy: number,
  remainingBoost: number,
  remainingShards: number,
): FeasibilityDemandRow {
  const total = Math.max(0, totalCandy);
  if (pokemon.candyTarget) {
    const requestedBoost = fixedCandyTargetBoostBudget(pokemon, input.boost.kind, total, remainingBoost);
    const reached = simulateCandyBudget(pokemon, requestedBoost, total, remainingShards, input.boost.kind);
    const used = reached.boostUsed + reached.normalUsed;
    const candyDemandMet = used >= (pokemon.candyTarget?.totalCandyUnits ?? total) || reached.level >= maxLevel;
    return {
      pokemonId: pokemon.pokemonId,
      pokedexId: pokemon.pokedexId,
      candyFamilyKey: pokemon.candyFamilyKey,
      type: pokemon.type,
      totalCandy: used,
      boostCandy: reached.boostUsed,
      normalCandy: reached.normalUsed,
      shards: reached.shards,
      reachedLv: reached.level,
      expInLevel: reached.expInLevel,
      candyDemandMet,
      preferZeroSurplus: feasibilityPreferZeroSurplus(pokemon, input, reached.level, reached.expInLevel),
    };
  }
  const boost = Math.min(maxBoostFor(pokemon, input.boost.kind, remainingBoost), total);
  const reached = simulate(pokemon, boost, Math.max(0, total - boost), remainingShards, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
  return {
    pokemonId: pokemon.pokemonId,
    pokedexId: pokemon.pokedexId,
    candyFamilyKey: pokemon.candyFamilyKey,
    type: pokemon.type,
    totalCandy: reached.boostUsed + reached.normalUsed,
    boostCandy: reached.boostUsed,
    normalCandy: reached.normalUsed,
    shards: reached.shards,
    reachedLv: reached.level,
    expInLevel: reached.expInLevel,
    candyDemandMet: cmpLevel(reached, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) >= 0,
    preferZeroSurplus: feasibilityPreferZeroSurplus(pokemon, input, reached.level, reached.expInLevel),
  };
}

function targetDemandRowsForInput(input: NormalizedInput): FeasibilityDemandRow[] {
  let remainingBoost = input.boost.limit;
  let remainingShards = input.dreamShards;
  return input.pokemonList.map(pokemon => {
    const row = targetDemandRowForPokemon(pokemon, input, remainingBoost, remainingShards);
    remainingBoost -= row.boostCandy;
    remainingShards -= row.shards;
    return row;
  });
}

function remainingBoostAfterRows(input: NormalizedInput, rows: FeasibilityDemandRow[]): number {
  return Math.max(0, input.boost.limit - rows.reduce((sum, row) => sum + row.boostCandy, 0));
}

function remainingShardsAfterRows(input: NormalizedInput, rows: FeasibilityDemandRow[]): number {
  return Math.max(0, input.dreamShards - rows.reduce((sum, row) => sum + row.shards, 0));
}

function supplyFromFeasibleRow(row: FeasibilityWitness['rows'][number]): CandySupplyBreakdown {
  return {
    species: row.supply.species,
    type: { s: row.supply.typeS, m: row.supply.typeM },
    universal: { s: row.supply.universalS, m: row.supply.universalM, l: row.supply.universalL },
  };
}

function candidateFromFeasibleRow(row: FeasibilityWitness['rows'][number], pokemon: NormalizedPokemon, stableIndex: number): Candidate {
  const supply = supplyFromFeasibleRow(row);
  const expGained = calcExp(pokemon.currentLevel, row.reachedLv, pokemon.expType) + row.expInLevel - pokemon.currentExpInLevel;
  const expToTarget = pokemon.candyTarget
    ? 0
    : Math.max(0, calcExp(row.reachedLv, pokemon.targetLevel, pokemon.expType) + pokemon.targetExpInLevel - row.expInLevel);
  const line: PokemonPlanLine = {
    level: row.reachedLv,
    expInLevel: row.reachedLv >= maxLevel ? 0 : row.expInLevel,
    expToNextLevel: row.reachedLv >= maxLevel ? 0 : Math.max(0, calcExp(row.reachedLv, row.reachedLv + 1, pokemon.expType) - row.expInLevel),
    expToTarget,
    totalCandyUnitsUsed: row.totalCandy,
    boostedCandyUnits: row.boostCandy,
    nonBoostCandyUnits: row.normalCandy,
    candySupply: supply,
    dreamShardsUsed: row.shards,
    expGained,
    surplusExp: Math.max(0, row.expInLevel - pokemon.targetExpInLevel),
    surplusCandyValue: Math.max(0, supplyValue(supply) - row.totalCandy),
    candyDemandMet: row.candyDemandMet,
    effectiveTargetReached: reachedEffectiveTarget(pokemon, { level: row.reachedLv, expInLevel: row.expInLevel }),
  };
  return { p: pokemon, line, usage: usageFrom(pokemon, line), stableIndex };
}

function shouldRunFbl01dRefine(witness: FeasibilityWitness | null, feasibilityMs: number): boolean {
  if (!witness) return false;
  // refineは余り改善の任意処理。feasibilityが重い入力では、締切超過後に
  // witnessへ戻るだけの250msになりやすいため、到達数/境界EXPを優先して省く。
  return feasibilityMs < FBL01D_REFINE_SKIP_AFTER_FEASIBILITY_MS;
}

/** 候補の資源使用が、その時点の残資源に収まっているか。フェーズ3の安全弁。 */
function candidateFitsResidual(
  candidate: Candidate,
  pokemon: NormalizedPokemon,
  inventory: CandyInventory,
  remainingBoost: number,
  remainingShards: number,
): boolean {
  const { usage } = candidate;
  if (usage.boost > remainingBoost || usage.shards > remainingShards) return false;
  if ((usage.species[speciesKey(pokemon)] ?? 0) > (inventory.species[speciesKey(pokemon)] ?? 0)) return false;
  const typeStock = inventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
  const typeUsed = usage.type[pokemon.type] ?? { s: 0, m: 0 };
  if (typeUsed.s > typeStock.s || typeUsed.m > typeStock.m) return false;
  return usage.universal.s <= inventory.universal.s
    && usage.universal.m <= inventory.universal.m
    && usage.universal.l <= inventory.universal.l;
}

/**
 * 下位行どうしが同じ資源を取り合うか。
 *
 * 逐次処理は行ごとに最良の供給を選ぶので、**取り合いがあると per-row 最適が全体で負けうる。**
 * 種族アメに限った話ではない（外部レビューで反例が出た）:
 *
 * - 同タイプ2行・水タイプS13個/M2個・需要50と51 →
 *   逐次は需要50へ typeS13（余り2）を渡し、残る typeM2（価値50）では需要51が未達。
 *   typeM2 と typeS13 を入れ替えれば両方到達する
 * - 水17と炎20・水タイプM1個/万能M1個 →
 *   逐次は需要17へ万能M（余り3）を渡し、炎20は水アメを使えず0個。
 *   水タイプMと万能Mを入れ替えれば両方到達する
 *
 * **万能アメは全行が使えるので、残っていればそれだけで取り合いになる。**
 * 在庫が無い次元は取り合いにならないので、在庫の有無まで見て判定する。
 */
function lowerRowsContendForResources(pokemonList: NormalizedPokemon[], inventory: CandyInventory): boolean {
  if (pokemonList.length < 2) return false;
  if (inventory.universal.s > 0 || inventory.universal.m > 0 || inventory.universal.l > 0) return true;
  const families = new Set<string>();
  const types = new Set<string>();
  for (const pokemon of pokemonList) {
    const family = speciesKey(pokemon);
    if (families.has(family) && (inventory.species[family] ?? 0) > 0) return true;
    families.add(family);
    const typeStock = inventory.typeCandy[pokemon.type] ?? { s: 0, m: 0 };
    if (types.has(pokemon.type) && (typeStock.s > 0 || typeStock.m > 0)) return true;
    types.add(pokemon.type);
  }
  return false;
}

/** 残資源（在庫・かけら・アメブ枠）を前提にした、下位行だけの入力を組み直す。 */
function residualInputFor(
  input: NormalizedInput,
  inventory: CandyInventory,
  usage: Usage,
  pokemonList: NormalizedPokemon[],
): NormalizedInput {
  const base = {
    ...input,
    pokemonList,
    candyInventory: inventory,
    boost: { ...input.boost, limit: Math.max(0, input.boost.limit - usage.boost) },
    dreamShards: Math.max(0, input.dreamShards - usage.shards),
  };
  // 競合の解析は行の顔ぶれと在庫で決まるので、下位行だけの組で取り直す。
  const speciesNeeds = calculateSpeciesNeeds(base);
  const contention = analyzeContention(base, speciesNeeds);
  return { ...base, speciesNeeds, contention, contentionKeys: buildContentionKeys(contention) };
}

/**
 * 下位行が資源を取り合うとき、残資源で feasibility solver を回して到達 prefix を最大化する。
 *
 * **正本**: `fbl01d_feasibility_witness境界EXP改善_設計書.md` §6「種族アメ原則」/ §14.4.1。
 *
 * 逐次処理は行ごとに最良の供給を選ぶため、**per-row 最適が全体で負ける**ことがある。
 * 種族アメでは §6 の反例（同系統2行 `totalCandy` = 25 と 4・種族在庫 4・タイプM 1個）が、
 * タイプアメ・万能アメでも `lowerRowsContendForResources` の docblock にある2つの反例が起きる。
 * 合同な分配の探索はブロックDP（§10）が既に解いているので、そちらへ委ねる。
 *
 * - **境界EXP最大化（フェーズ2）は行わない。** §14.4「下位は到達数＋境界EXPの保証対象ではない」を維持し、
 *   到達 prefix の最大化だけに絞る
 * - **再帰しない。** この prefix に入らなかった行は、呼び出し元の逐次処理がそのまま扱う
 * - 取り合いが無ければ solver を呼ばない（在庫が無い次元は取り合いにならない）
 * - frontier キャッシュは共有しない。下位の部分問題は小さく、本探索のキャッシュを
 *   別の行集合で汚さないほうが安全
 * - **`deadlineAt` は呼び出し元が一度だけ決めた絶対締切。** この関数は複数回呼ばれうるので、
 *   ここで測り直すと合計が上限を超える
 */
function solveLowerContendedPrefix(
  input: NormalizedInput,
  inventory: CandyInventory,
  usage: Usage,
  startIndex: number,
  deadlineAt: number,
): Candidate[] {
  const lowerPokemon = input.pokemonList.slice(startIndex);
  if (!lowerRowsContendForResources(lowerPokemon, inventory)) return [];

  const residualInput = residualInputFor(input, inventory, usage, lowerPokemon);
  const rows = targetDemandRowsForInput(residualInput);
  const options = fbl01dSolverOptions(residualInput, deadlineAt);

  // フェーズ1と同じ単調性（k 到達可能 ⇒ k-1 到達可能）で二分探索する。
  const session = createPrefixDecisionSession(rows, inventory, options);
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const decision = session.canSolvePrefix(mid);
    // `inconclusive` は「不可行」ではない。infeasible と畳むと、証拠が無いまま
    // 短い prefix を合同解として採用してしまう。全面的に逐次処理へ縮退させる。
    if (decision.status === 'inconclusive') return [];
    if (decision.status === 'feasible') low = mid;
    else high = mid - 1;
  }
  if (low === 0) return [];

  const result = solveFeasibilityForFixedRows(rows.slice(0, low), inventory, options);
  // 締切超過（inconclusive）でも解なしでも、呼び出し元の逐次貪欲がそのまま引き受ける。
  if (result.status !== 'feasible') return [];
  return result.witness.rows.map((row, offset) => candidateFromFeasibleRow(row, lowerPokemon[offset], startIndex + offset));
}

/**
 * フェーズ3: 境界より下の行を残資源で処理する。
 *
 * **正本**: `fbl01d_feasibility_witness境界EXP改善_設計書.md` §14.4「フェーズ3: 下位行」/
 * `level-planner-allocation-policy-spec.md` §4-5「下位は残資源のみ」。
 *
 * feasibility witness は「到達prefix ＋ 境界」までしか行を持たない。それ以降を
 * `zeroLine` へ倒すと、**下位行に自分の種族アメとかけらが丸ごと残っていても0個**になる
 * （上位の在庫不足だけを理由に、無関係な系統の行が育たなくなる）。
 *
 * 下位行は到達数・境界EXPの保証対象ではないので合同最適化には含めず、
 * witness が確定した残資源から**優先順位順に逐次**確定させる。
 *
 * **この関数に行の anchor（個数指定の有無）による分岐を足さないこと。**
 * その分岐は `candidateForBoost` が唯一の正本として持っている。
 */
function allocateLowerRowsFromResidual(input: NormalizedInput, upperChoices: Candidate[], deadlineAt: number): Candidate[] {
  if (upperChoices.length >= input.pokemonList.length) return [];
  const inventory = structuredClone(input.candyInventory);
  let usage = emptyUsage();
  for (const candidate of upperChoices) {
    consumeInventory(inventory, candidate.p, candidate.line);
    usage = mergeUsage(usage, candidate.usage);
  }
  const lower: Candidate[] = [];
  // 合同探索の総時間はここで一度だけ決める。下でループしても合計はこの締切を超えない。
  const jointDeadlineAt = Math.min(deadlineAt, performance.now() + FBL01D_LOWER_JOINT_DEADLINE_MS);
  let index = upperChoices.length;
  while (index < input.pokemonList.length) {
    // §14.4.1: 取り合いがある下位行は逐次では解けないので、先に合同で到達prefixを取る。
    const joint = solveLowerContendedPrefix(input, inventory, usage, index, jointDeadlineAt);
    if (joint.length > 0) {
      for (const candidate of joint) {
        lower.push(candidate);
        consumeInventory(inventory, candidate.p, candidate.line);
        usage = mergeUsage(usage, candidate.usage);
      }
      index += joint.length;
      continue;
    }
    // 合同で1行も取れないとき（先頭が到達しえない・締切超過・取り合い無し）は、
    // **その行だけ**逐次で確定して次へ進む。到達しえない行が1つあるだけで、
    // その後ろ全部が合同探索の対象から外れてしまうのを防ぐ。
    const pokemon = input.pokemonList[index];
    const remainingBoost = Math.max(0, input.boost.limit - usage.boost);
    const remainingShards = Math.max(0, input.dreamShards - usage.shards);
    const residualInput: NormalizedInput = {
      ...input,
      candyInventory: inventory,
      boost: { ...input.boost, limit: remainingBoost },
    };
    // 0配分は必ず残す。残資源が無い行の受け皿であり、候補が全滅しても落ちないようにする。
    const zeroCandidate: Candidate = { p: pokemon, line: zeroLine(pokemon), usage: emptyUsage(), stableIndex: -1 };
    const candidates = withStableIndexes([
      zeroCandidate,
      ...candidateForBoost(
        pokemon,
        residualInput,
        maxBoostFor(pokemon, input.boost.kind, remainingBoost),
        remainingShards,
        false,
        availableInventoryValue(residualInput, pokemon),
        inventory,
      ),
    ].filter(candidate => candidateFitsResidual(candidate, pokemon, inventory, remainingBoost, remainingShards)));
    let best = candidates[0] ?? zeroCandidate;
    for (const candidate of candidates) {
      if (compareCandidate(candidate, best, input.options.itemCompareMode) > 0) best = candidate;
    }
    const chosen: Candidate = { ...best, stableIndex: index };
    lower.push(chosen);
    consumeInventory(inventory, pokemon, chosen.line);
    usage = mergeUsage(usage, chosen.usage);
    index++;
  }
  return lower;
}

function selectFbl01dChoices(input: NormalizedInput): { choices: Candidate[]; optimized: CandyExpOptimizationResult; adopted: 'feasibility' } {
  const previousTuning = activeTuning;
  activeTuning = {
    ...activeTuning,
    maxSupplyCandidates: Number.POSITIVE_INFINITY,
    maxSharedSpeciesSupplyCandidates: Number.POSITIVE_INFINITY,
  };
  try {
  const startedAt = performance.now();
  const feasibilityStartedAt = startedAt;
  const solverDeadlineAt = startedAt + FBL01D_DEFAULT_DEADLINE_MS;
  const options = (
    maxRowSurplus?: number,
    itemCompareMode: PlannerOptions['itemCompareMode'] = input.options.itemCompareMode,
  ) => ({
    ...fbl01dSolverOptions(input, solverDeadlineAt),
    itemCompareMode,
    ...(maxRowSurplus === undefined ? {} : { maxRowSurplus }),
    frontierCache: fbl01dFrontierCache,
    globalPrefixCache: fbl01dGlobalPrefixCache,
    rowFrontierCache: fbl01dRowFrontierCache,
  });
  const targetRows = targetDemandRowsForInput(input);
  /**
   * 先頭から続く「アメを1個も要さない行」の数（§14.4.3）。
   *
   * 目標到達済み・`candyTarget.totalCandyUnits === 0`・「すべて睡眠」の行は、**探索が何もしなくても
   * 到達扱いになる。** ゲート内再試行の判定を単純な「到達0匹」で書くと、この手の行が先頭にあるだけで
   * 到達数が1以上になり、**落ちるべきときに落ちない。** 判定は「アメを要する行が新しく到達したか」で行う。
   */
  const trivialReachedPrefixCount = (() => {
    let count = 0;
    for (const row of targetRows) {
      if (row.totalCandy > 0) break;
      count++;
    }
    return count;
  })();
  // surplusFirst first treats row surplus 0..2 as a hard constraint. If that
  // cannot produce a useful witness, retry without the hard gate.
  const searchMaxRowSurplusAttempts: Array<number | undefined> = input.options.itemCompareMode === 'surplusFirst' && targetRows.length > 1
    ? [MAX_ACCEPTABLE_SURPLUS, undefined]
    : [undefined];
  let mainSearchMaxRowSurplus: number | undefined = searchMaxRowSurplusAttempts[0];
  /**
   * 探索が実際に使っている比較モード。**2周目へ落ちたらバランスになる（§14.4.3）。**
   *
   * ループを抜けたあとも最後の attempt の値が残るので、**これが「この入力で最終的に採った方式」**である。
   * refine とフェーズ3にも同じ値を渡すこと。`input.options.itemCompareMode`（＝ユーザーが選んだ方式）を
   * 渡すと、**到達prefixと境界だけバランス・供給内訳は余り最小**という第3のモードになり、
   * UI の案内「到達できるポケモンが1匹もいない場合はバランスの配分に切り替えます」と食い違う。
   */
  let mainSearchItemCompareMode: PlannerOptions['itemCompareMode'] = input.options.itemCompareMode;
  const mainOptions = () => options(mainSearchMaxRowSurplus, mainSearchItemCompareMode);
  let canSearch = false;
  let solvedCandidates = 0;
  let supplyRejectedCandidates = 0;
  let supplyInconclusiveCandidates = 0;
  let prefixRows: FeasibilityDemandRow[] = [];
  let selectedWitness: FeasibilityWitness | null = null;
  let boundaryIndex: number | null = null;
  let shouldSearchBoundary = false;
  let boundarySearch: BoundarySearchSummary | undefined;
  let prefixSearch: PrefixSearchSummary | undefined;
  /**
   * attempt ごとの `prefixSearch`（`[0]` が1周目）。
   *
   * `prefixSearch` は周の開始時に捨てられるので、fallback が発火すると1周目の値が残らない。
   * **周ごとの探索量・探索結果を検証するテストはこちらを読む**（§14.4.2 / §14.4.3）。
   */
  const prefixSearchAttempts: PrefixSearchSummary[] = [];
  type SurplusLimits = { maxRowSurplus?: number; maxTotalSurplus?: number; maxReachedSurplus?: number };
  const normalizeLimits = (limits: SurplusLimits = {}): SurplusLimits => {
    if (limits.maxTotalSurplus === undefined) return limits;
    const inheritedMaxRowSurplus = limits.maxRowSurplus ?? mainSearchMaxRowSurplus;
    return {
      ...limits,
      maxRowSurplus: inheritedMaxRowSurplus === undefined
        ? limits.maxTotalSurplus
        : Math.min(inheritedMaxRowSurplus, limits.maxTotalSurplus),
    };
  };

  for (const attemptMaxRowSurplus of searchMaxRowSurplusAttempts) {
    mainSearchMaxRowSurplus = attemptMaxRowSurplus;
    mainSearchItemCompareMode = input.options.itemCompareMode === 'surplusFirst' && targetRows.length > 1 && attemptMaxRowSurplus === undefined
      ? 'surplusGateFirst'
      : input.options.itemCompareMode;
    const emptyResult = solveFeasibilityForFixedRows([], input.candyInventory, mainOptions());
    canSearch = emptyResult.status === 'feasible';
    solvedCandidates = canSearch ? 1 : 0;
    supplyRejectedCandidates = 0;
    supplyInconclusiveCandidates = emptyResult.status === 'inconclusive' ? 1 : 0;
    prefixRows = [];
    selectedWitness = null;
    boundaryIndex = null;
    shouldSearchBoundary = false;
    boundarySearch = undefined;
    prefixSearch = undefined;

  if (canSearch && supplyInconclusiveCandidates === 0) {
    type PrefixSearchResult = {
      low: number;
      witness: FeasibilityWitness | null;
      solved: number;
      rejected: number;
      inconclusive: number;
      /** §14.4.2 の上側スキャンだけで走らせた probe 数（探索量の上限をテストで固定するための診断値）。 */
      upperScanProbes: number;
      limits: SurplusLimits;
    };
    const findPrefix = (
      rawLimits: SurplusLimits = {},
      restoreWitness = true,
    ): PrefixSearchResult => {
      const limits = normalizeLimits(rawLimits);
      const prefixOptions = () => ({
        ...mainOptions(),
        ...(limits.maxRowSurplus === undefined ? {} : { maxRowSurplus: limits.maxRowSurplus }),
        ...(limits.maxTotalSurplus === undefined ? {} : { maxTotalSurplus: limits.maxTotalSurplus }),
        ...(limits.maxReachedSurplus === undefined ? {} : { maxReachedSurplus: limits.maxReachedSurplus }),
      });
      let low = 0;
      let high = targetRows.length;
      let solved = 0;
      let rejected = 0;
      let inconclusive = 0;
      let upperScanProbes = 0;
      const prefixDecisionSession = createPrefixDecisionSession(targetRows, input.candyInventory, prefixOptions());
      let bestPrefixDecision: ReturnType<typeof solveFeasibilityDecisionForFixedRows> | null = null;
      let bestPrefixDecisionLength = 0;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const result = prefixDecisionSession.canSolvePrefix(mid);
        if (result.status === 'feasible') {
          solved++;
          bestPrefixDecision = result;
          bestPrefixDecisionLength = mid;
          low = mid;
          continue;
        }
        if (result.status === 'inconclusive') inconclusive++;
        else rejected++;
        high = mid - 1;
      }
      // §14.4.2: **余りゲートの下では prefix の可解性が単調にならない。**
      //
      // §6 の「系統の種族アメ使用合計 = min(系統在庫, 系統内の需要合計)」により、
      // prefix が短いほど種族アメの受け取り先が減り、余りとして計上される。
      // 同系統2行（需要25と4）・種族在庫4・タイプM1個なら、prefix1 は種族4を使い切るために
      // タイプMも足して余り4（ゲート超過で infeasible）だが、prefix2 は B が種族4を引き受けて
      // 両行とも余り0（feasible）になる。**行を増やしたほうが解ける。**
      //
      // 二分探索は単調性を前提にしているので、打ち切った上側を降順に確かめ直す。
      // ゲートが無ければ制約は資源だけになり、長い prefix ほど需要が増えて厳しくなる一方なので走らせない。
      // `inconclusive` を見たあとも走らせない（判定できていないものを feasible 側へ倒さない）。
      const hasSurplusGate = limits.maxRowSurplus !== undefined
        || limits.maxTotalSurplus !== undefined
        || limits.maxReachedSurplus !== undefined;
      if (hasSurplusGate && inconclusive === 0 && low < targetRows.length) {
        for (let length = targetRows.length; length > low; length--) {
          const result = prefixDecisionSession.canSolvePrefix(length);
          upperScanProbes++;
          if (result.status === 'feasible') {
            solved++;
            bestPrefixDecision = result;
            bestPrefixDecisionLength = length;
            low = length;
            break;
          }
          if (result.status === 'inconclusive') {
            inconclusive++;
            break;
          }
          rejected++;
        }
      }
      if (low === 0) return { low, witness: null, solved, rejected, inconclusive, upperScanProbes, limits };
      if (!restoreWitness && low < targetRows.length) return { low, witness: null, solved, rejected, inconclusive, upperScanProbes, limits };
      const selectedResult = bestPrefixDecisionLength === low && bestPrefixDecision?.toWitness
        ? bestPrefixDecision.toWitness()
        : solveFeasibilityForFixedRows(targetRows.slice(0, low), input.candyInventory, prefixOptions());
      if (selectedResult.status === 'feasible') return { low, witness: selectedResult.witness, solved: solved + 1, rejected, inconclusive, upperScanProbes, limits };
      if (selectedResult.status === 'inconclusive') return { low: 0, witness: null, solved, rejected, inconclusive: inconclusive + 1, upperScanProbes, limits };
      return { low: 0, witness: null, solved, rejected: rejected + 1, inconclusive, upperScanProbes, limits };
    };

    const findSurplusFirstPrefix = (): PrefixSearchResult => findPrefix({
      maxRowSurplus: MAX_ACCEPTABLE_SURPLUS,
    });

    const relaxationRejectsPrefix = (length: number): boolean => {
      if (length <= 0 || length > targetRows.length) return false;
      return fixedRowsFailFeasibilityRelaxation(
        targetRows.slice(0, length),
        input.candyInventory,
        mainOptions(),
      );
    };
    let prefix: PrefixSearchResult;
    if (input.options.itemCompareMode === 'surplusFirst' && attemptMaxRowSurplus !== undefined) {
      prefix = findSurplusFirstPrefix();
    } else if (input.options.itemCompareMode === 'surplusGateFirst') {
      const gatedPrefix = findPrefix({ maxRowSurplus: MAX_ACCEPTABLE_SURPLUS });
      const gatedCountIsGloballyMaximal = gatedPrefix.low === targetRows.length
        || relaxationRejectsPrefix(gatedPrefix.low + 1);
      if (gatedCountIsGloballyMaximal) {
        prefix = gatedPrefix;
      } else {
        const unrestrictedPrefix = findPrefix();
        prefix = {
          ...unrestrictedPrefix,
          solved: gatedPrefix.solved + unrestrictedPrefix.solved,
          rejected: gatedPrefix.rejected + unrestrictedPrefix.rejected,
          inconclusive: gatedPrefix.inconclusive + unrestrictedPrefix.inconclusive,
          upperScanProbes: gatedPrefix.upperScanProbes + unrestrictedPrefix.upperScanProbes,
        };
      }
    } else {
      prefix = findPrefix();
    }
    solvedCandidates += prefix.solved;
    supplyRejectedCandidates += prefix.rejected;
    supplyInconclusiveCandidates += prefix.inconclusive;
    prefixSearch = {
      solved: prefix.solved,
      rejected: prefix.rejected,
      inconclusive: prefix.inconclusive,
      upperScanProbes: prefix.upperScanProbes,
      maxFeasiblePrefix: prefix.low,
    };
    prefixSearchAttempts.push(prefixSearch);
    if (prefix.witness) {
      selectedWitness = prefix.witness;
    }
    prefixRows = targetRows.slice(0, prefix.low);
    const canSearchBoundaryForPrefix = prefix.low < targetRows.length
      && (input.options.itemCompareMode !== 'surplusFirst' || attemptMaxRowSurplus === MAX_ACCEPTABLE_SURPLUS || attemptMaxRowSurplus === undefined);
    if (canSearchBoundaryForPrefix) {
      boundaryIndex = prefix.low;
      shouldSearchBoundary = supplyInconclusiveCandidates === 0;
    }
  }

  if (canSearch && shouldSearchBoundary && boundaryIndex !== null && boundaryIndex < input.pokemonList.length) {
    const boundarySearchMode = mainSearchItemCompareMode;
    const currentBoundaryIndex = boundaryIndex;
    const boundaryPokemon = input.pokemonList[currentBoundaryIndex];
    const targetTotalCandy = targetRows[currentBoundaryIndex]?.totalCandy ?? 0;
    const remainingBoost = remainingBoostAfterRows(input, prefixRows);
    const remainingShards = remainingShardsAfterRows(input, prefixRows);
    let low = 0;
    let high = targetTotalCandy;
    let bestWitness: FeasibilityWitness | null = null;
    let bestWitnessTotalCandy = 0;
    let maxFeasibleScope: BoundarySearchSummary['maxFeasibleScope'] = 'unknown';
    let foundBoundary = false;
    let checkedLowerTotals = 0;
    let feasibleLowerTotals = 0;
    let rejectedLowerTotals = 0;
    let inconclusiveLowerTotals = 0;
    let rowSurplusGateSkippedTotals = 0;
    let decisionRejectedLowerTotals = 0;
    let firstZeroRawSurplusTotalCandy: number | undefined;
    let surplusFirstZeroBudgetExhausted = false;
    let keepExistingSurplusFirstPrefix = false;
    let stoppedReason: BoundarySearchSummary['stoppedReason'] = 'exp_first';
    let lastRawSurplus: number | undefined;
    let rawSurplusTrend: BoundarySearchSummary['rawSurplusTrend'] = 'not_checked';
    let samplesTruncated = false;
    const samples: BoundarySearchSummary['samples'] = [];
    const appendBoundarySearchSample = (sample: BoundarySearchSummary['samples'][number]): void => {
      if (samples.length < FBL01D_BOUNDARY_SEARCH_SAMPLE_LIMIT) samples.push(sample);
      else samplesTruncated = true;
    };
    const isBoundaryRowGateInfeasible = (decision: { status: string; reason?: string } | null): boolean => (
      decision?.status === 'infeasible'
      && (decision.reason === 'boundary_row_surplus_gate_impossible'
        || decision.reason === 'boundary_row_total_surplus_gate_impossible'
        || decision.reason === 'boundary_row_zero_surplus_impossible')
    );
    const observeRawSurplusTrend = (rawSurplus: number): void => {
      if (lastRawSurplus === undefined) {
        lastRawSurplus = rawSurplus;
        rawSurplusTrend = 'flat';
        return;
      }
      const direction = rawSurplus < lastRawSurplus ? 'nonincreasing' : rawSurplus > lastRawSurplus ? 'nondecreasing' : 'flat';
      if (rawSurplusTrend === 'flat') rawSurplusTrend = direction;
      else if (direction !== 'flat' && rawSurplusTrend !== direction) rawSurplusTrend = 'mixed';
      lastRawSurplus = rawSurplus;
    };
    const boundaryOptions = () => ({ ...mainOptions(), fallbackWitness: selectedWitness ?? undefined });
    let independentBoundarySession: ReturnType<typeof createIndependentBoundaryFeasibilitySession> | undefined;
    const getIndependentBoundarySession = (): ReturnType<typeof createIndependentBoundaryFeasibilitySession> => {
      if (independentBoundarySession === undefined) {
        independentBoundarySession = createIndependentBoundaryFeasibilitySession(prefixRows, input.candyInventory, boundaryOptions());
      }
      return independentBoundarySession;
    };
    const gateMaxRowSurplus = boundarySearchMode === 'surplusGateFirst' || boundarySearchMode === 'surplusFirst'
        ? MAX_ACCEPTABLE_SURPLUS
        : undefined;
    const gatedBoundarySession = gateMaxRowSurplus === undefined
      ? null
      : createIndependentBoundaryFeasibilitySession(prefixRows, input.candyInventory, { ...boundaryOptions(), maxRowSurplus: gateMaxRowSurplus });
    const minimumReachedSurplus = selectedWitness
      ? stateForWitness(selectedWitness, input).metrics.reachedSurplus
      : 0;
    const boundaryRowForTotal = (totalCandy: number): FeasibilityDemandRow => (
      demandRowForCandyBudget(boundaryPokemon, input, totalCandy, remainingBoost, remainingShards)
    );
    type BoundaryLimits = SurplusLimits;
    const boundaryCacheKey = (totalCandy: number, limits: BoundaryLimits): string => (
      `${totalCandy}|row:${limits.maxRowSurplus ?? ''}|total:${limits.maxTotalSurplus ?? ''}|reached:${limits.maxReachedSurplus ?? ''}`
    );
    const boundaryDecisionCache = new Map<string, ReturnType<typeof solveFeasibilityDecisionForFixedRows>>();
    const boundarySolveCache = new Map<string, ReturnType<typeof solveFeasibilityForFixedRows>>();
    const decideBoundaryTotal = (totalCandy: number, rawLimits: BoundaryLimits = {}) => {
      const limits = normalizeLimits(rawLimits);
      const cacheKey = boundaryCacheKey(totalCandy, limits);
      const cachedSolve = boundarySolveCache.get(cacheKey);
      if (cachedSolve) {
        if (cachedSolve.status === 'feasible') return { status: 'feasible' as const, stats: cachedSolve.stats };
        return cachedSolve;
      }
      const cachedDecision = boundaryDecisionCache.get(cacheKey);
      if (cachedDecision) return cachedDecision;
      const row = boundaryRowForTotal(totalCandy);
      if (limits.maxRowSurplus !== undefined && !hasSingleRowSupplyWithinSurplus(row, input.candyInventory, limits.maxRowSurplus)) {
        rowSurplusGateSkippedTotals++;
        const result = {
          status: 'infeasible',
          reason: 'boundary_row_surplus_gate_impossible',
          stats: emptyFeasibilityStats(),
        } as const;
        boundaryDecisionCache.set(cacheKey, result);
        return result;
      }
      if (limits.maxTotalSurplus !== undefined && !hasSingleRowSupplyWithinSurplus(row, input.candyInventory, limits.maxTotalSurplus)) {
        rowSurplusGateSkippedTotals++;
        const result = {
          status: 'infeasible',
          reason: 'boundary_row_total_surplus_gate_impossible',
          stats: emptyFeasibilityStats(),
        } as const;
        boundaryDecisionCache.set(cacheKey, result);
        return result;
      }
      const session = limits.maxReachedSurplus === minimumReachedSurplus
        && limits.maxRowSurplus === MAX_ACCEPTABLE_SURPLUS
        && limits.maxTotalSurplus === undefined
        ? gatedBoundarySession
        : limits.maxReachedSurplus === undefined && limits.maxRowSurplus !== undefined && gatedBoundarySession
          ? gatedBoundarySession
          : limits.maxReachedSurplus === undefined
            ? getIndependentBoundarySession()
            : null;
      const result = session?.canSolve(row, {
        maxTotalSurplus: limits.maxTotalSurplus,
        maxReachedSurplus: limits.maxReachedSurplus,
      })
        ?? solveFeasibilityDecisionForFixedRows([...prefixRows, row], input.candyInventory, {
          ...boundaryOptions(),
          ...(limits.maxRowSurplus === undefined ? {} : { maxRowSurplus: limits.maxRowSurplus }),
          ...(limits.maxTotalSurplus === undefined ? {} : { maxTotalSurplus: limits.maxTotalSurplus }),
          ...(limits.maxReachedSurplus === undefined ? {} : { maxReachedSurplus: limits.maxReachedSurplus }),
        });
      boundaryDecisionCache.set(cacheKey, result);
      return result;
    };
    const solveBoundaryTotal = (totalCandy: number, rawLimits: BoundaryLimits = {}): ReturnType<typeof solveFeasibilityForFixedRows> => {
      const limits = normalizeLimits(rawLimits);
      const cacheKey = boundaryCacheKey(totalCandy, limits);
      const cached = boundarySolveCache.get(cacheKey);
      if (cached) return cached;
      const row = boundaryRowForTotal(totalCandy);
      const session = limits.maxReachedSurplus === minimumReachedSurplus
        && limits.maxRowSurplus === MAX_ACCEPTABLE_SURPLUS
        && limits.maxTotalSurplus === undefined
        ? gatedBoundarySession
        : limits.maxReachedSurplus === undefined && limits.maxRowSurplus === undefined && limits.maxTotalSurplus === undefined
          ? getIndependentBoundarySession()
          : limits.maxReachedSurplus === undefined && limits.maxRowSurplus !== undefined && limits.maxTotalSurplus === undefined
            ? gatedBoundarySession
            : null;
      const result = session?.solve(row, {
        maxTotalSurplus: limits.maxTotalSurplus,
        maxReachedSurplus: limits.maxReachedSurplus,
      })
        ?? solveFeasibilityForFixedRows([...prefixRows, row], input.candyInventory, {
          ...boundaryOptions(),
          ...(limits.maxRowSurplus === undefined ? {} : { maxRowSurplus: limits.maxRowSurplus }),
          ...(limits.maxTotalSurplus === undefined ? {} : { maxTotalSurplus: limits.maxTotalSurplus }),
          ...(limits.maxReachedSurplus === undefined ? {} : { maxReachedSurplus: limits.maxReachedSurplus }),
        });
      boundarySolveCache.set(cacheKey, result);
      if (result.status === 'feasible') boundaryDecisionCache.set(cacheKey, { status: 'feasible', stats: result.stats });
      else boundaryDecisionCache.set(cacheKey, result);
      return result;
    };
    if (boundarySearchMode === 'surplusGateFirst') {
      const result = gatedBoundarySession?.solveMaxBoundaryTotal(
        boundaryRowForTotal(targetTotalCandy),
        targetTotalCandy,
        boundaryRowForTotal,
      );
      const directGatedMax = result?.status === 'feasible'
        ? result.witness.rows.at(-1)?.totalCandy
        : undefined;
      if (result?.status === 'feasible' && directGatedMax !== undefined && directGatedMax >= 0) {
        checkedLowerTotals++;
        feasibleLowerTotals++;
        solvedCandidates++;
        const candidateState = stateForWitness(result.witness, input);
        observeRawSurplusTrend(candidateState.metrics.rawSurplus);
        appendBoundarySearchSample({
          totalCandy: directGatedMax,
          status: 'feasible',
          rawSurplus: candidateState.metrics.rawSurplus,
          normalizedSurplus: candidateState.metrics.normalizedSurplus,
          boundaryLevel: result.witness.boundaryLevel,
          boundaryExpInLevel: result.witness.boundaryExpInLevel,
        });
        bestWitness = result.witness;
        bestWitnessTotalCandy = directGatedMax;
        low = directGatedMax;
        maxFeasibleScope = 'rowSurplusGate';
        foundBoundary = true;
        stoppedReason = 'first_acceptable_surplus';
      } else if (result?.status === 'inconclusive') {
        supplyInconclusiveCandidates++;
        inconclusiveLowerTotals++;
        stoppedReason = 'inconclusive';
        appendBoundarySearchSample({ totalCandy: targetTotalCandy, status: 'inconclusive' });
      }
    }
    if (boundarySearchMode === 'surplusFirst' && !foundBoundary) {
      // First fix the minimum surplus of the maximum reached prefix, then
      // maximize the final boundary within its independent row-surplus gate.
      const maximumBoundaryCandy = targetTotalCandy;
      const gatedUpperResult = gatedBoundarySession?.solveMaxBoundaryTotal(
        boundaryRowForTotal(maximumBoundaryCandy),
        maximumBoundaryCandy,
        boundaryRowForTotal,
      );
      const gatedUpper = gatedUpperResult?.status === 'feasible'
        ? gatedUpperResult.witness.rows.at(-1)?.totalCandy ?? maximumBoundaryCandy
        : maximumBoundaryCandy;
      for (let total = gatedUpper; total >= 0; total--) {
        checkedLowerTotals++;
        const limits = {
          maxRowSurplus: MAX_ACCEPTABLE_SURPLUS,
          maxReachedSurplus: minimumReachedSurplus,
        };
        const decision = decideBoundaryTotal(total, limits);
        if (decision?.status === 'infeasible') {
          rejectedLowerTotals++;
          decisionRejectedLowerTotals++;
          continue;
        }
        if (decision?.status === 'inconclusive') {
          supplyInconclusiveCandidates++;
          inconclusiveLowerTotals++;
          stoppedReason = 'inconclusive';
          appendBoundarySearchSample({ totalCandy: total, status: 'inconclusive' });
          break;
        }
        const result = solveBoundaryTotal(total, limits);
        if (result.status === 'feasible') {
          foundBoundary = true;
          feasibleLowerTotals++;
          solvedCandidates++;
          low = total;
          bestWitness = result.witness;
          bestWitnessTotalCandy = total;
          const candidateState = stateForWitness(result.witness, input);
          maxFeasibleScope = 'rowSurplusGate';
          observeRawSurplusTrend(candidateState.metrics.rawSurplus);
          appendBoundarySearchSample({
            totalCandy: total,
            status: 'feasible',
            rawSurplus: candidateState.metrics.rawSurplus,
            normalizedSurplus: candidateState.metrics.normalizedSurplus,
            boundaryLevel: result.witness.boundaryLevel,
            boundaryExpInLevel: result.witness.boundaryExpInLevel,
          });
          if (candidateState.metrics.rawSurplus === 0) firstZeroRawSurplusTotalCandy = total;
          stoppedReason = 'first_acceptable_surplus';
          break;
        }
        if (result.status === 'inconclusive') {
          supplyInconclusiveCandidates++;
          inconclusiveLowerTotals++;
          stoppedReason = 'inconclusive';
          appendBoundarySearchSample({ totalCandy: total, status: 'inconclusive' });
          break;
        }
        rejectedLowerTotals++;
        decisionRejectedLowerTotals++;
      }
    }
    if (boundarySearchMode === 'surplusFirst' && !foundBoundary && stoppedReason !== 'inconclusive' && selectedWitness) {
      const prefixState = stateForWitness(selectedWitness, input);
      keepExistingSurplusFirstPrefix = prefixState.metrics.rawSurplus === 0;
    }
    if (boundarySearchMode === 'surplusFirst' && !foundBoundary && stoppedReason !== 'inconclusive') surplusFirstZeroBudgetExhausted = true;
    if (!keepExistingSurplusFirstPrefix && !foundBoundary && stoppedReason !== 'inconclusive' && boundarySearchMode === 'legacyImproved') {
      const directMax = getIndependentBoundarySession()?.maxBoundaryTotal(boundaryRowForTotal(targetTotalCandy), targetTotalCandy);
      if (directMax !== undefined && directMax !== null && directMax > 0) {
        const result = solveBoundaryTotal(directMax);
        if (result.status === 'feasible') {
          bestWitness = result.witness;
          bestWitnessTotalCandy = directMax;
          foundBoundary = true;
          low = directMax;
          maxFeasibleScope = 'unrestricted';
          solvedCandidates++;
        } else if (result.status === 'inconclusive') {
          supplyInconclusiveCandidates++;
          stoppedReason = 'inconclusive';
        } else {
          supplyRejectedCandidates++;
        }
      }
    }
    while (!keepExistingSurplusFirstPrefix && !(boundarySearchMode === 'surplusGateFirst' && stoppedReason === 'first_acceptable_surplus') && (boundarySearchMode === 'legacyImproved' || boundarySearchMode === 'surplusGateFirst' || !foundBoundary) && stoppedReason !== 'inconclusive' && low < high) {
      const mid = Math.ceil((low + high) / 2);
      const decision = decideBoundaryTotal(mid);
      if (decision?.status === 'feasible') {
        foundBoundary = true;
        solvedCandidates++;
        low = mid;
        maxFeasibleScope = 'unrestricted';
        continue;
      }
      if (isBoundaryRowGateInfeasible(decision)) {
        supplyRejectedCandidates++;
        high = mid - 1;
        continue;
      }
      if (decision?.status === 'inconclusive') {
        supplyInconclusiveCandidates++;
        break;
      }
      const result = solveBoundaryTotal(mid);
      if (result.status === 'feasible') {
        bestWitness = result.witness ?? null;
        bestWitnessTotalCandy = mid;
        foundBoundary = true;
        solvedCandidates++;
        low = mid;
        maxFeasibleScope = 'unrestricted';
      } else {
        if (result.status === 'inconclusive') {
          supplyInconclusiveCandidates++;
          break;
        }
        supplyRejectedCandidates++;
        high = mid - 1;
      }
    }
    if (!keepExistingSurplusFirstPrefix && foundBoundary && (!bestWitness || bestWitnessTotalCandy !== low)) {
      const result = solveBoundaryTotal(low);
      if (result.status === 'feasible') {
        bestWitness = result.witness;
        bestWitnessTotalCandy = low;
        maxFeasibleScope = maxFeasibleScope === 'unknown' ? 'unrestricted' : maxFeasibleScope;
        solvedCandidates++;
      } else if (result.status === 'inconclusive') {
        supplyInconclusiveCandidates++;
        foundBoundary = false;
        stoppedReason = 'inconclusive';
      } else {
        supplyRejectedCandidates++;
        foundBoundary = false;
      }
    }
    if (!keepExistingSurplusFirstPrefix && foundBoundary && !bestWitness && boundarySearchMode === 'surplusFirst') {
      const lowDecision = decideBoundaryTotal(low, { maxTotalSurplus: 0 });
      if (lowDecision?.status === 'feasible') {
        const result = solveBoundaryTotal(low, { maxTotalSurplus: 0 });
        if (result.status === 'feasible') {
          feasibleLowerTotals++;
          solvedCandidates++;
          bestWitness = result.witness;
          bestWitnessTotalCandy = low;
          const candidateState = stateForWitness(result.witness, input);
          maxFeasibleScope = 'totalSurplusGate';
          observeRawSurplusTrend(candidateState.metrics.rawSurplus);
          appendBoundarySearchSample({
            totalCandy: low,
            status: 'max_feasible',
            rawSurplus: candidateState.metrics.rawSurplus,
            normalizedSurplus: candidateState.metrics.normalizedSurplus,
            boundaryLevel: result.witness.boundaryLevel,
            boundaryExpInLevel: result.witness.boundaryExpInLevel,
          });
          firstZeroRawSurplusTotalCandy = low;
          stoppedReason = 'first_zero_raw_surplus';
        } else if (result.status === 'inconclusive') {
          supplyInconclusiveCandidates++;
          inconclusiveLowerTotals++;
          stoppedReason = 'inconclusive';
          appendBoundarySearchSample({ totalCandy: low, status: 'inconclusive' });
        }
      } else if (lowDecision?.status === 'inconclusive') {
        supplyInconclusiveCandidates++;
        inconclusiveLowerTotals++;
        stoppedReason = 'inconclusive';
        appendBoundarySearchSample({ totalCandy: low, status: 'inconclusive' });
      }
      for (let total = low - 1; total >= 0; total--) {
        if (bestWitness || stoppedReason === 'inconclusive') break;
        checkedLowerTotals++;
        const decision = decideBoundaryTotal(total, { maxTotalSurplus: 0 });
        if (decision?.status === 'infeasible') {
          rejectedLowerTotals++;
          decisionRejectedLowerTotals++;
          continue;
        }
        if (decision?.status === 'inconclusive') {
          supplyInconclusiveCandidates++;
          inconclusiveLowerTotals++;
          stoppedReason = 'inconclusive';
          appendBoundarySearchSample({ totalCandy: total, status: 'inconclusive' });
          break;
        }
        const result = solveBoundaryTotal(total, { maxTotalSurplus: 0 });
        if (result.status === 'feasible') {
          feasibleLowerTotals++;
          solvedCandidates++;
          bestWitness = result.witness;
          bestWitnessTotalCandy = total;
          const candidateState = stateForWitness(result.witness, input);
          maxFeasibleScope = 'totalSurplusGate';
          observeRawSurplusTrend(candidateState.metrics.rawSurplus);
          appendBoundarySearchSample({
            totalCandy: total,
            status: 'feasible',
            rawSurplus: candidateState.metrics.rawSurplus,
            normalizedSurplus: candidateState.metrics.normalizedSurplus,
            boundaryLevel: result.witness.boundaryLevel,
            boundaryExpInLevel: result.witness.boundaryExpInLevel,
          });
          firstZeroRawSurplusTotalCandy = total;
          stoppedReason = 'first_zero_raw_surplus';
          break;
        }
        if (result.status === 'inconclusive') {
          supplyInconclusiveCandidates++;
          inconclusiveLowerTotals++;
          stoppedReason = 'inconclusive';
          appendBoundarySearchSample({ totalCandy: total, status: 'inconclusive' });
          break;
        }
        rejectedLowerTotals++;
      }
      surplusFirstZeroBudgetExhausted = !bestWitness && stoppedReason !== 'inconclusive';
    }
    if (!keepExistingSurplusFirstPrefix && foundBoundary && !bestWitness) {
      const result = solveBoundaryTotal(low);
      if (result.status === 'feasible') {
        bestWitness = result.witness;
        bestWitnessTotalCandy = low;
        maxFeasibleScope = maxFeasibleScope === 'unknown' ? 'unrestricted' : maxFeasibleScope;
        solvedCandidates++;
      } else if (result.status === 'inconclusive') {
        supplyInconclusiveCandidates++;
        foundBoundary = false;
      } else {
        supplyRejectedCandidates++;
        foundBoundary = false;
      }
    }
    if (!keepExistingSurplusFirstPrefix && foundBoundary && bestWitness && (boundarySearchMode === 'surplusFirst' || boundarySearchMode === 'surplusGateFirst')) {
      if (stoppedReason !== 'first_zero_raw_surplus' && stoppedReason !== 'first_acceptable_surplus') stoppedReason = 'exhausted';
      let bestState = stateForWitness(bestWitness, input);
      observeRawSurplusTrend(bestState.metrics.rawSurplus);
      appendBoundarySearchSample({
        totalCandy: bestWitnessTotalCandy,
        status: bestWitnessTotalCandy === low ? 'max_feasible' : 'feasible',
        rawSurplus: bestState.metrics.rawSurplus,
        normalizedSurplus: bestState.metrics.normalizedSurplus,
        boundaryLevel: bestWitness.boundaryLevel,
        boundaryExpInLevel: bestWitness.boundaryExpInLevel,
      });
      if (boundarySearchMode === 'surplusFirst' && bestState.metrics.rawSurplus === 0) {
        firstZeroRawSurplusTotalCandy = bestWitnessTotalCandy;
        stoppedReason = 'first_zero_raw_surplus';
      } else if (boundarySearchMode === 'surplusGateFirst' && hasOnlyAcceptableRowSurplus(bestState.metrics)) {
        stoppedReason = 'first_acceptable_surplus';
      }
      const shouldScanLower = stoppedReason === 'exhausted';
      let rowSurplusBoundProved = false;
      if (shouldScanLower && boundarySearchMode === 'surplusGateFirst' && bestState.metrics.normalizedSurplus > 0) {
        const improvingRowSurplusCap = bestState.metrics.normalizedSurplus - 1;
        const improvingOptions = {
          ...boundaryOptions(),
          maxRowSurplus: improvingRowSurplusCap,
        };
        const improvingPrefixDecision = solveFeasibilityDecisionForFixedRows(prefixRows, input.candyInventory, improvingOptions);
        if (improvingPrefixDecision.status === 'infeasible') {
          rowSurplusBoundProved = true;
        } else if (improvingPrefixDecision.status === 'feasible') {
          const improvingBoundarySession = createIndependentBoundaryFeasibilitySession(prefixRows, input.candyInventory, improvingOptions);
          const improvingMaxTotal = improvingBoundarySession?.maxBoundaryTotal(
            boundaryRowForTotal(targetTotalCandy),
            targetTotalCandy,
          );
          rowSurplusBoundProved = improvingMaxTotal !== null
            && improvingMaxTotal !== undefined
            && improvingMaxTotal < 0;
        }
      }
      let foundByGatedScan = false;
      if (shouldScanLower && boundarySearchMode === 'surplusFirst' && bestState.metrics.rawSurplus > 0) {
        let selectedSurplusBudget: number | undefined;
        const firstSurplusBudget = surplusFirstZeroBudgetExhausted ? 1 : 0;
        // A coarse unrestricted probe can land below a better candidate with the
        // same total surplus. Surplus-first must still compare reach/EXP within
        // the chosen surplus budget, so scan the full boundary range for the
        // gated proof pass.
        const lowerSearchStart = targetTotalCandy;
        for (let surplusBudget = firstSurplusBudget; surplusBudget <= bestState.metrics.rawSurplus; surplusBudget++) {
          for (let total = lowerSearchStart; total >= 0; total--) {
            if (surplusBudget === bestState.metrics.rawSurplus && total === bestWitnessTotalCandy) continue;
            checkedLowerTotals++;
            const decision = decideBoundaryTotal(total, { maxTotalSurplus: surplusBudget });
            if (decision?.status === 'infeasible') {
              rejectedLowerTotals++;
              decisionRejectedLowerTotals++;
              continue;
            }
            if (decision?.status === 'inconclusive') {
              supplyInconclusiveCandidates++;
              inconclusiveLowerTotals++;
              stoppedReason = 'inconclusive';
              appendBoundarySearchSample({ totalCandy: total, status: 'inconclusive' });
              foundByGatedScan = true;
              break;
            }
            const result = solveBoundaryTotal(total, { maxTotalSurplus: surplusBudget });
            if (result.status === 'feasible') {
              feasibleLowerTotals++;
              solvedCandidates++;
              const candidateState = stateForWitness(result.witness, input);
              observeRawSurplusTrend(candidateState.metrics.rawSurplus);
              appendBoundarySearchSample({
                totalCandy: total,
                status: 'feasible',
                rawSurplus: candidateState.metrics.rawSurplus,
                normalizedSurplus: candidateState.metrics.normalizedSurplus,
                boundaryLevel: result.witness.boundaryLevel,
                boundaryExpInLevel: result.witness.boundaryExpInLevel,
              });
              if (candidateState.metrics.rawSurplus === 0 && firstZeroRawSurplusTotalCandy === undefined) {
                firstZeroRawSurplusTotalCandy = total;
              }
              const comparison = compareSurplusFirstBoundaryState(candidateState, bestState);
              if (comparison > 0) {
                bestWitness = result.witness;
                bestWitnessTotalCandy = total;
                bestState = candidateState;
                selectedSurplusBudget = surplusBudget;
                maxFeasibleScope = 'totalSurplusGate';
                stoppedReason = surplusBudget === 0 ? 'first_zero_raw_surplus' : 'exhausted';
              }
              foundByGatedScan = selectedSurplusBudget !== undefined;
              break;
            }
            if (result.status === 'inconclusive') {
              supplyInconclusiveCandidates++;
              inconclusiveLowerTotals++;
              stoppedReason = 'inconclusive';
              appendBoundarySearchSample({ totalCandy: total, status: 'inconclusive' });
              foundByGatedScan = true;
              break;
            }
            rejectedLowerTotals++;
          }
          if (foundByGatedScan || selectedSurplusBudget !== undefined) break;
        }
      }
      if (!rowSurplusBoundProved && (shouldScanLower || (boundarySearchMode === 'surplusGateFirst' && stoppedReason !== 'first_acceptable_surplus')) && gateMaxRowSurplus !== undefined) {
        const checkedBeforeGatedScan = checkedLowerTotals;
        const feasibleBeforeGatedScan = feasibleLowerTotals;
        const rejectedBeforeGatedScan = rejectedLowerTotals;
        const inconclusiveBeforeGatedScan = inconclusiveLowerTotals;
        const skippedBeforeGatedScan = rowSurplusGateSkippedTotals;
        const decisionRejectedBeforeGatedScan = decisionRejectedLowerTotals;
        if (boundarySearchMode === 'surplusGateFirst') {
          // Balance wants the highest boundary total that still satisfies the row surplus gate.
          // For independent boundary rows, the session can answer and restore that candidate directly.
          const result = gatedBoundarySession?.solveMaxBoundaryTotal(
            boundaryRowForTotal(targetTotalCandy),
            targetTotalCandy,
            boundaryRowForTotal,
          );
          const directGatedMax = result?.status === 'feasible'
            ? result.witness.rows.at(-1)?.totalCandy
            : undefined;
          if (result && directGatedMax !== undefined && directGatedMax >= 0 && directGatedMax !== bestWitnessTotalCandy) {
            checkedLowerTotals++;
            if (result.status === 'feasible') {
              feasibleLowerTotals++;
              solvedCandidates++;
              const candidateState = stateForWitness(result.witness, input);
              observeRawSurplusTrend(candidateState.metrics.rawSurplus);
              appendBoundarySearchSample({
                totalCandy: directGatedMax,
                status: 'feasible',
                rawSurplus: candidateState.metrics.rawSurplus,
                normalizedSurplus: candidateState.metrics.normalizedSurplus,
                boundaryLevel: result.witness.boundaryLevel,
                boundaryExpInLevel: result.witness.boundaryExpInLevel,
              });
              bestWitness = result.witness;
              bestWitnessTotalCandy = directGatedMax;
              if (directGatedMax > low) low = directGatedMax;
              bestState = candidateState;
              maxFeasibleScope = 'rowSurplusGate';
              stoppedReason = 'first_acceptable_surplus';
              foundByGatedScan = true;
            } else if (result.status === 'inconclusive') {
              supplyInconclusiveCandidates++;
              inconclusiveLowerTotals++;
              stoppedReason = 'inconclusive';
              appendBoundarySearchSample({ totalCandy: directGatedMax, status: 'inconclusive' });
              foundByGatedScan = true;
            } else {
              rejectedLowerTotals++;
            }
          }
        }
        const gatedSearchStart = foundBoundary ? Math.min(targetTotalCandy, low) : targetTotalCandy;
        for (let total = foundByGatedScan ? -1 : gatedSearchStart; total >= 0; total--) {
          if (total === bestWitnessTotalCandy) continue;
          checkedLowerTotals++;
          const decision = decideBoundaryTotal(total, { maxRowSurplus: gateMaxRowSurplus });
          if (decision?.status === 'infeasible') {
            rejectedLowerTotals++;
            decisionRejectedLowerTotals++;
            continue;
          }
          if (decision?.status === 'inconclusive') {
            supplyInconclusiveCandidates++;
            inconclusiveLowerTotals++;
            stoppedReason = 'inconclusive';
            appendBoundarySearchSample({ totalCandy: total, status: 'inconclusive' });
            foundByGatedScan = true;
            break;
          }
          const result = solveBoundaryTotal(total, { maxRowSurplus: gateMaxRowSurplus });
          if (result.status === 'feasible') {
            feasibleLowerTotals++;
            solvedCandidates++;
            const candidateState = stateForWitness(result.witness, input);
            observeRawSurplusTrend(candidateState.metrics.rawSurplus);
            appendBoundarySearchSample({
              totalCandy: total,
              status: 'feasible',
              rawSurplus: candidateState.metrics.rawSurplus,
              normalizedSurplus: candidateState.metrics.normalizedSurplus,
              boundaryLevel: result.witness.boundaryLevel,
              boundaryExpInLevel: result.witness.boundaryExpInLevel,
            });
            if (boundarySearchMode === 'surplusFirst' && candidateState.metrics.rawSurplus === 0 && firstZeroRawSurplusTotalCandy === undefined) {
              firstZeroRawSurplusTotalCandy = total;
            }
            bestWitness = result.witness;
            bestWitnessTotalCandy = total;
            if (total > low) low = total;
            bestState = candidateState;
            maxFeasibleScope = 'rowSurplusGate';
            stoppedReason = boundarySearchMode === 'surplusFirst'
              ? 'first_zero_raw_surplus'
              : 'first_acceptable_surplus';
            foundByGatedScan = true;
            break;
          }
          if (result.status === 'inconclusive') {
            supplyInconclusiveCandidates++;
            inconclusiveLowerTotals++;
            stoppedReason = 'inconclusive';
            appendBoundarySearchSample({ totalCandy: total, status: 'inconclusive' });
            foundByGatedScan = true;
            break;
          }
          rejectedLowerTotals++;
        }
        if (!foundByGatedScan) {
          checkedLowerTotals = checkedBeforeGatedScan;
          feasibleLowerTotals = feasibleBeforeGatedScan;
          rejectedLowerTotals = rejectedBeforeGatedScan;
          inconclusiveLowerTotals = inconclusiveBeforeGatedScan;
          rowSurplusGateSkippedTotals = skippedBeforeGatedScan;
          decisionRejectedLowerTotals = decisionRejectedBeforeGatedScan;
        }
      }
      for (let total = shouldScanLower && !foundByGatedScan && !rowSurplusBoundProved ? low - 1 : -1; total >= 0; total--) {
        checkedLowerTotals++;
        const result = solveBoundaryTotal(total);
        if (result.status === 'feasible') {
          feasibleLowerTotals++;
          solvedCandidates++;
          const candidateState = stateForWitness(result.witness, input);
          observeRawSurplusTrend(candidateState.metrics.rawSurplus);
          appendBoundarySearchSample({
            totalCandy: total,
            status: 'feasible',
            rawSurplus: candidateState.metrics.rawSurplus,
            normalizedSurplus: candidateState.metrics.normalizedSurplus,
            boundaryLevel: result.witness.boundaryLevel,
            boundaryExpInLevel: result.witness.boundaryExpInLevel,
          });
          if (candidateState.metrics.rawSurplus === 0 && firstZeroRawSurplusTotalCandy === undefined) {
            firstZeroRawSurplusTotalCandy = total;
          }
          const comparison = boundarySearchMode === 'surplusGateFirst'
            ? compareSurplusGateBoundaryState(candidateState, bestState)
            : compareSurplusFirstBoundaryState(candidateState, bestState);
          if (comparison > 0) {
            bestWitness = result.witness;
            bestWitnessTotalCandy = total;
            bestState = candidateState;
            maxFeasibleScope = 'unrestricted';
            if (boundarySearchMode === 'surplusFirst' && candidateState.metrics.rawSurplus === 0) {
              stoppedReason = 'first_zero_raw_surplus';
              break;
            }
            if (boundarySearchMode === 'surplusGateFirst' && hasOnlyAcceptableRowSurplus(candidateState.metrics)) {
              stoppedReason = 'first_acceptable_surplus';
              break;
            }
          }
          continue;
        }
        if (result.status === 'inconclusive') {
          supplyInconclusiveCandidates++;
          inconclusiveLowerTotals++;
          stoppedReason = 'inconclusive';
          appendBoundarySearchSample({ totalCandy: total, status: 'inconclusive' });
          break;
        }
        rejectedLowerTotals++;
        supplyRejectedCandidates++;
        appendBoundarySearchSample({ totalCandy: total, status: 'infeasible' });
      }
      if (rowSurplusBoundProved && stoppedReason === 'exhausted') stoppedReason = 'row_surplus_bound';
    }
    if (foundBoundary) {
      selectedWitness = bestWitness;
      if (bestWitness) {
        boundarySearch = boundarySearchSummary(bestWitness, input, {
          mode: boundarySearchMode,
          boundaryIndex: currentBoundaryIndex,
          targetTotalCandy,
          maxFeasibleTotalCandy: Math.max(low, bestWitnessTotalCandy),
          maxFeasibleScope,
          checkedLowerTotals,
          feasibleLowerTotals,
          rejectedLowerTotals,
          inconclusiveLowerTotals,
          rowSurplusGateSkippedTotals,
          decisionRejectedLowerTotals,
          firstZeroRawSurplusTotalCandy,
          stoppedReason,
          rawSurplusTrend,
          samplesTruncated,
          samples,
        });
      }
    }
  }

    const selectedUnreachedIndex = selectedWitness?.rows.findIndex(row => !row.candyDemandMet) ?? -1;
    const selectedBoundaryReached = Boolean(
      selectedWitness
        && selectedWitness.rows.length >= targetRows.length
        && selectedUnreachedIndex === -1,
    );
    /**
     * §14.4.3。**ゲート内で1匹も新しく育っていないなら、ハードゲートを外して探し直す。**
     *
     * 旧条件は `attemptMaxRowSurplus < MAX_ACCEPTABLE_SURPLUS`（＝ `2 < 2`）で**構造上決して真にならず**、
     * 導入時（`bf794c7`）から死んでいた。実際に効いていたのは「witness が1つも作れなかったとき」だけで、
     * **境界行1つだけの witness（到達0匹）ができれば「使い物になる答え」として確定していた。**
     *
     * 根拠は `level-planner-priority-guide.md` §72「余り0〜2はハード制約ではない。0〜2にできないときも
     * 計算を不成立にせず、3以上を許して結果を返す」。**これは解が無いときの縮退規則**であって、
     * 「到達数のためにゲートを捨ててよい」ではない（それは §258 と正面から衝突する）。
     * だから落ちる条件は**到達数の比較ではなく「ゲート内で何も作れなかったか」**にする。
     */
    const selectedReachedPrefix = selectedWitness
      ? (selectedUnreachedIndex === -1 ? selectedWitness.rows.length : selectedUnreachedIndex)
      : 0;
    const gatedProducedNothing = selectedReachedPrefix <= trivialReachedPrefixCount;
    const shouldTryNextSurplusFirstGate = Boolean(
      selectedWitness
        && input.options.itemCompareMode === 'surplusFirst'
        && targetRows.length > 1
        && attemptMaxRowSurplus !== undefined
        && gatedProducedNothing
        && !selectedBoundaryReached,
    );
    const shouldTryNextGate = Boolean(
      attemptMaxRowSurplus !== undefined
        && input.options.itemCompareMode === 'surplusFirst'
        && (!selectedWitness || shouldTryNextSurplusFirstGate),
    );
    if (supplyInconclusiveCandidates > 0 || !shouldTryNextGate) break;
  }

  /**
   * §14.4.3。**1周目（ゲート内）の witness を床として退避してはいけない。**
   *
   * 2周目へ落ちる条件そのものが `gatedProducedNothing` なので、1周目の witness は
   * **定義上「アメを要する行が1つも到達していない」。** それを最終解に採ると
   * `rows[0..境界]` がゲートに縛られた配分に固定され、**フェーズ3がその行を育てられなくなる。**
   * `witness = null` ならフェーズ3が全行を扱い、到達 prefix 長は最低でもアメ不要行の数（＝床の到達 prefix 長）になる。
   * **つまり床が到達 prefix 長で null を上回ることは構造上ありえない。**
   *
   * 実測でも、2周目を強制的に `inconclusive` にした 400 件の掃引で
   * **床の復元は 154 件で到達 prefix 長を下げ、改善は0件**だった（フェーズ3も締切超過へ落とした条件でも同じ）。
   * 2026-08-01 に一度 `gatedFloor` として実装したが、この計測を受けて削除した。**戻さないこと。**
   *
   * `canSearch` によるガードもここでは不要になる。`selectedWitness` が入るのは
   * `canSearch` が真の枝だけなので、**`canSearch === false` なら `selectedWitness` は必ず null** である。
   */
  const witness = selectedWitness;
  const feasibilityMs = performance.now() - feasibilityStartedAt;
  const refineStartedAt = performance.now();
  const shouldRefine = shouldRunFbl01dRefine(witness, feasibilityMs);
  const refined = witness && shouldRefine
    ? refineFeasibilityWitness(witness, input.candyInventory, mainSearchItemCompareMode, {
        boostKind: input.boost.kind,
        boostLimit: input.boost.limit,
        dreamShards: input.dreamShards,
        itemCompareMode: mainSearchItemCompareMode,
        ...(mainSearchItemCompareMode === 'surplusFirst' && mainSearchMaxRowSurplus !== undefined
          ? {
              maxRowSurplus: MAX_ACCEPTABLE_SURPLUS,
              maxReachedSurplus: witness
                ? stateForWitness(witness, input).metrics.reachedSurplus
                : 0,
            }
          : {}),
        deadlineMs: FBL01D_FAST_REFINE_MS,
        logPerformance: isPerfEnabled(),
      })
    : null;
  const finalWitness = refined?.witness ?? witness;

  const witnessChoices = witness
    ? (finalWitness?.rows ?? witness.rows).map((row, index) => candidateFromFeasibleRow(row, input.pokemonList[index], index))
    : [];
  // フェーズ3: witness に含まれない行（境界より下）は残資源で逐次確定させる。
  // **探索が実際に採った方式を渡す**（§14.4.3）。2周目へ落ちた入力は下位行もバランスで解く。
  const effectiveInput: NormalizedInput = mainSearchItemCompareMode === input.options.itemCompareMode
    ? input
    : { ...input, options: { ...input.options, itemCompareMode: mainSearchItemCompareMode } };
  const choices = [...witnessChoices, ...allocateLowerRowsFromResidual(effectiveInput, witnessChoices, solverDeadlineAt)];
  const refineMs = refined ? performance.now() - refineStartedAt : 0;
  const finalChoices = choices;
  trimFbl01dFrontierCache();
  return {
    choices: finalChoices,
    adopted: 'feasibility',
    optimized: {
      solvedCandidates,
      supplyRejectedCandidates,
      supplyInconclusiveCandidates,
      feasibilityMs: roundMs(feasibilityMs),
      refineMs: roundMs(refineMs),
      refineStatus: refined?.refineStatus ?? 'skipped',
      refineReason: refined?.reason ?? (refined ? undefined : (witness ? 'feasibility_too_slow' : 'no_feasible_witness')),
      boundarySearch,
      prefixSearch,
      prefixSearchAttempts,
    },
  };
  } finally {
    trimFbl01dFrontierCache();
    activeTuning = previousTuning;
  }
}
function zeroLine(pokemon: NormalizedPokemon): PokemonPlanLine {
  const candyDemandMet = pokemon.candyTarget
    ? pokemon.candyTarget.totalCandyUnits <= 0
    : cmpLevel({ level: pokemon.currentLevel, expInLevel: pokemon.currentExpInLevel }, { level: pokemon.targetLevel, expInLevel: pokemon.targetExpInLevel }) >= 0;
  return { level: pokemon.currentLevel, expInLevel: pokemon.currentExpInLevel, expToNextLevel: Math.max(0, calcExp(pokemon.currentLevel, pokemon.currentLevel + 1, pokemon.expType) - pokemon.currentExpInLevel), expToTarget: Math.max(0, calcExp(pokemon.currentLevel, pokemon.targetLevel, pokemon.expType) + pokemon.targetExpInLevel - pokemon.currentExpInLevel), totalCandyUnitsUsed: 0, boostedCandyUnits: 0, nonBoostCandyUnits: 0, candySupply: emptySupply(), dreamShardsUsed: 0, expGained: 0, surplusExp: 0, surplusCandyValue: 0, candyDemandMet, effectiveTargetReached: reachedEffectiveTarget(pokemon, { level: pokemon.currentLevel, expInLevel: pokemon.currentExpInLevel }) };
}
/**
 * 目標まで行が既存の配分（到達可能行、および個数指定に対して作られた配分）を正本として流用できるか。
 *
 * 流用できるのは、その配分が「目標到達に必要なアメ数ちょうど」に対して作られている場合だけ。
 * 補填は万能Sを足すことしかできないため、需要が食い違う土台を使うと内訳がそのまま漏れ出す。
 * - 個数指定は「このポケモンに何個まで使うか」というユーザーの自己制約であり、目標到達に必要な量ではない。
 *   これを土台にすると、目標まで行が個数指定に左右されてしまう。
 * - かけら・アメブ・在庫律速で目標需要に届かない実配分も、残りを万能Sだけで補うと
 *   実際には使える在庫（種族アメ・万能M/L・タイプアメ）を無視した内訳になる。
 *
 * 需要が一致しない場合は、その行の時点の在庫から目標需要ぶんを組み直す。
 */
function canReuseDisplaySupplyBase(baseTotalCandy: number | undefined, targetTotalCandy: number): boolean {
  return baseTotalCandy === targetTotalCandy;
}
/**
 * 「目標まで」行（§4.5.1）。
 *
 * - totalCandyUnitsUsed = 予定アメ数（個数指定があればその値、なければ目標到達に必要な最小数）
 * - level / expInLevel  = 予定アメを使い終えた地点（睡眠EXPを含まない）
 *
 * 到達判定・残EXPは effectiveLevel/effectiveExp（＝アメが担当する到達点）を基準にする。
 * 個数指定なしの行では effective == target なので、従来と同じ結果になる。
 */
function displayLine(pokemon: NormalizedPokemon, input: NormalizedInput, inventory: CandyInventory, total: number, requestedBoost: number, baseSupply?: CandySupplyBreakdown, baseTotalCandy?: number): PokemonPlanLine {
  const boost = input.boost.kind === 'none' ? 0 : Math.min(Math.max(0, requestedBoost), total);
  const reached = simulate(pokemon, boost, Math.max(0, total - boost), Infinity, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
  const used = reached.boostUsed + reached.normalUsed;
  const supply = baseSupply && canReuseDisplaySupplyBase(baseTotalCandy, used)
    ? addTheoreticalSupplyFill(baseSupply, used, pokemon, inventory)
    : resolveDisplayCandySupply(used, pokemon, inventory, true, prefersMinSurplusDisplay(input));
  return {
    level: reached.level, expInLevel: reached.expInLevel,
    expToNextLevel: Math.max(0, calcExp(reached.level, reached.level + 1, pokemon.expType) - reached.expInLevel),
    expToTarget: Math.max(0, calcExp(reached.level, pokemon.effectiveLevel, pokemon.expType) + pokemon.effectiveExp - reached.expInLevel),
    totalCandyUnitsUsed: used, boostedCandyUnits: reached.boostUsed, nonBoostCandyUnits: reached.normalUsed,
    candySupply: supply, dreamShardsUsed: reached.shards, expGained: reached.expGained,
    surplusExp: Math.max(0, reached.expInLevel - pokemon.effectiveExp), surplusCandyValue: Math.max(0, supplyValue(supply) - used),
    candyDemandMet: cmpLevel(reached, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) >= 0,
    effectiveTargetReached: reachedEffectiveTarget(pokemon, reached),
  };
}

/** 「目標まで」行の予定アメ数と、そのうちアメブに回す数（§4.5.1）。 */
function plannedCandyForDisplay(pokemon: NormalizedPokemon, input: NormalizedInput): { total: number; boost: number } {
  // 「アメブ1個 → 通常アメ1個」置換（仕様§4 / 設計書§3.8-e）は maxBoostFor に入っている。
  // 表示行もそれを通さないと、実配分がアメブ n-1 + 通常1 なのに目標まで行だけ全アメブになり、
  // アメブ内訳とかけらが実配分とズレる。
  // グローバル上限は掛けない（理論値行なので、枠不足は shortage.boostCandyUnavailable で別途出す）。
  const boost = maxBoostFor(pokemon, input.boost.kind, Number.POSITIVE_INFINITY);
  if (pokemon.candyTarget) {
    return { total: pokemon.candyTarget.totalCandyUnits, boost };
  }
  const mixed = calcExpAndCandyMixed({
    srcLevel: pokemon.currentLevel, dstLevel: pokemon.effectiveLevel, dstExpInLevel: pokemon.effectiveExp,
    expType: pokemon.expType, nature: pokemon.nature, boost: input.boost.kind,
    boostCandy: boost, expGot: pokemon.currentExpInLevel,
  });
  return { total: mixed.boostCandy + mixed.normalCandy, boost: mixed.boostCandy };
}
/**
 * 指定したアメブ枠を確保できなかった量。
 *
 * **目標に到達したかどうかとは切り離す。** 「目標まで」行のアメブ数（`plannedCandyForDisplay`）は
 * グローバル上限を掛けない理論値なので、枠が回ってこなかったことはここでしか表現できない。
 * 到達していれば黙るようにすると、上位行に枠を取られて指定どおり使えていない行が
 * 何の警告もなく通ってしまう。
 *
 * アメブ枠が 0 の場合も同じ扱いにする。上限を 0 にする操作自体は `recalculateAllRows` が
 * 全行のアメブを 0 へ再割当てするので通常は起きないが、**保存データの復元では
 * 「上限 0 ＋ 行のアメブ個数あり」が復元されうる**（初期化時に再割当てを通らないため）。
 * その状態こそ指定が満たせていないので黙ってはいけない。
 *
 * `diagnosis.isBoostShortage` は「目標未達の原因がアメブか」を指す別概念なので、条件を共有しない。
 * 到達している行の `limitingFactor` は null のままであること。
 */
function boostQuotaShortfall(
  input: NormalizedInput,
  requestedBoost: number,
  remainingBoost: number,
  actualBoostUsed: number,
): number {
  if (input.boost.kind === 'none') return 0;
  // 枠を使い切っているときだけ「枠が足りなかった」と言える。
  // かけら・アメ在庫で先に止まった行はアメブ枠が余っており、要求量が残枠を超えていても
  // 原因はアメブではない（例: かけら律速で Lv61 止まり、残枠1,623に対し実使用1,129）。
  // ここを見ないと、サマリーに「アメブ未使用」と「アメブ不足」が同時に並ぶ。
  if (actualBoostUsed < remainingBoost) return 0;
  return Math.max(0, requestedBoost - remainingBoost);
}

/**
 * 最も制限的な要因を1つ選ぶ。
 *
 * **固定優先順位（`shardsShortage ? 'shards' : …`）で決めてはいけない。**
 * 各 `xxxShortage` は「その制約だけを課したら目標に届かない」というブール値なので、
 * かけらが1でも足りなければ、アメが1個も配れない行でも `'shards'` と答えてしまう。
 *
 * > 実測: アメ在庫0・かけら500,000（必要537,974）の行で、アメだけを課すと Lv10（元Lvのまま）、
 * > かけらだけを課すと Lv59+1,193。旧固定優先順位は `'shards'` を返していた。
 *
 * 行に出す不足量は `limitingFactor` で1つに絞る（設計書 §10.12）ため、
 * ここでの誤診はそのまま誤った数値の表示になる（上の例では「かけら不足 37,974」だけが出て、
 * 実際に足りていないアメ 1,853 が隠れる）。
 *
 * 旧仕様（`a5ca21f` の `selectFinalLevelAndExp`）と同じく、**各制約だけを課したときの到達点を比べ、
 * 最も低い要因**を選ぶ。同点は candy > boost > shards（旧の配列順・安定ソートと同じ）。
 */
function pickLimitingFactor(
  candidates: Array<{ factor: ShortageType; reached: { level: number; expInLevel: number }; isShort: boolean }>,
): ShortageType | null {
  let best: { factor: ShortageType; reached: { level: number; expInLevel: number } } | null = null;
  for (const c of candidates) {
    if (!c.isShort) continue;
    if (best === null || cmpLevel(c.reached, best.reached) < 0) best = c;
  }
  return best?.factor ?? null;
}

function calcDiagnosis(pokemon: NormalizedPokemon, line: PokemonPlanLine, usage: Usage, input: NormalizedInput): { shortage: PokemonShortage; diagnosis: PokemonConstraintDiagnosis } {
  const remainingBoost = Math.max(0, input.boost.limit - usage.boost); const remainingShards = Math.max(0, input.dreamShards - usage.shards);
  const availableCandy = remainingCandyValue(input, usage, pokemon);
  if (pokemon.candyTarget) {
    const total = pokemon.candyTarget.totalCandyUnits;
    const targetBoost = Math.min(candyTargetBoostCap(pokemon, pokemon.requestedBoostCandy, input.boost.kind), total);
    const boostCap = Math.min(targetBoost, remainingBoost, total);
    // **各制約を1つだけ課した到達点**を作る（個数指定なし経路と同じ構造）。
    // byCandy / byShards にアメブ枠（boostCap）を混ぜると3つとも同じ到達点になり、
    // `pickLimitingFactor` が同点タイブレークで常に 'candy' を返す（実測: アメブ枠0の行で
    // 原因がアメブなのに 'candy' と出た）。
    const byCandy = simulateCandyBudget(pokemon, Math.min(targetBoost, availableCandy), Math.min(total, availableCandy), Infinity, input.boost.kind);
    const byBoost = simulateCandyBudget(pokemon, boostCap, total, Infinity, input.boost.kind);
    const byShards = simulateCandyBudget(pokemon, targetBoost, total, remainingShards, input.boost.kind);
    // 制約を1つも課さない理論到達点。かけら不足量の算出と、下の「律速なし」判定に使う。
    const unconstrained = simulateCandyBudget(pokemon, targetBoost, total, Infinity, input.boost.kind);
    const theoreticalShards = unconstrained.shards;
    // 門番は「アメ到達」（§11.3）。`candyDemandMet`（＝予定アメを配れたか）を使うと、
    // アメブ枠不足で通常アメへ置換された行が未達のまま「律速なし」になる。
    //
    // ただし**制約を全部外しても届かない行に律速は無い**。個数指定が目標に対して
    // そもそも足りないだけで、資源を増やしても解決しない（`limitingFactor` は
    // 「その制約が無ければ届いたはず」の要因を指す）。
    const noLimitToReport = line.effectiveTargetReached || !reachedEffectiveTarget(pokemon, unconstrained);
    // **到達点で比較する**（§11.3）。「使ったアメ数」で比べると、総アメ数が `candyTarget` に
    // 固定されている行では常に `used === total` になり、アメブ枠・かけらの不足で
    // アメブが通常アメへ落ちた（＝同じ個数で得られるEXPが減った）ことを検出できない。
    // 旧仕様（`a5ca21f` の `selectFinalLevelAndExp`）と個数指定なし経路も到達点で比べている。
    const inventoryShortage = !noLimitToReport && !reachedEffectiveTarget(pokemon, byCandy);
    const boostShortage = !noLimitToReport && input.boost.kind !== 'none' && !reachedEffectiveTarget(pokemon, byBoost);
    const shardsShortage = !noLimitToReport && !reachedEffectiveTarget(pokemon, byShards);
    const unallocatedShortage = !noLimitToReport && !inventoryShortage && !boostShortage && !shardsShortage;
    const expToActualTarget = Math.max(0, calcExp(line.level, pokemon.targetLevel, pokemon.expType) + pokemon.targetExpInLevel - line.expInLevel);
    return {
      shortage: {
        expToTarget: expToActualTarget,
        candyToTarget: inventoryShortage || unallocatedShortage ? Math.max(0, total - line.totalCandyUnitsUsed) : 0,
        dreamShardShortage: shardsShortage ? Math.max(0, theoreticalShards - remainingShards) : 0,
        boostCandyUnavailable: boostQuotaShortfall(input, targetBoost, remainingBoost, line.boostedCandyUnits),
      },
      diagnosis: { byCandyInventory: { level: byCandy.level, expInLevel: byCandy.expInLevel, candyUsed: byCandy.boostUsed + byCandy.normalUsed }, byBoostLimit: { level: byBoost.level, expInLevel: byBoost.expInLevel, candyUsed: byBoost.boostUsed + byBoost.normalUsed }, byDreamShards: { level: byShards.level, expInLevel: byShards.expInLevel, candyUsed: byShards.boostUsed + byShards.normalUsed }, limitingFactor: noLimitToReport ? null : pickLimitingFactor([{ factor: 'candy', reached: byCandy, isShort: inventoryShortage || unallocatedShortage }, { factor: 'boost', reached: byBoost, isShort: boostShortage }, { factor: 'shards', reached: byShards, isShort: shardsShortage }]), isInventoryShortage: inventoryShortage || unallocatedShortage, isBoostShortage: boostShortage, isShardsShortage: shardsShortage },
    };
  }
  const mixed = targetMixed(pokemon, input.boost.kind, Math.min(pokemon.requestedBoostCandy, remainingBoost));
  const byCandy = simulate(pokemon, Math.min(mixed.boostCandy, availableCandy), Math.max(0, availableCandy - mixed.boostCandy), Infinity, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
  const byBoost = simulate(pokemon, Math.min(pokemon.requestedBoostCandy, remainingBoost), mixed.normalCandy, Infinity, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
  const byShards = simulate(pokemon, mixed.boostCandy, mixed.normalCandy, remainingShards, pokemon.effectiveLevel, pokemon.effectiveExp, input.boost.kind);
  const inventoryShortage = cmpLevel(byCandy, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) < 0;
  const boostShortage = input.boost.kind !== 'none' && cmpLevel(byBoost, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) < 0;
  const shardsShortage = cmpLevel(byShards, { level: pokemon.effectiveLevel, expInLevel: pokemon.effectiveExp }) < 0;
  const unallocatedShortage = !line.effectiveTargetReached && !inventoryShortage && !boostShortage && !shardsShortage;
  const expToActualTarget = Math.max(0, calcExp(line.level, pokemon.targetLevel, pokemon.expType) + pokemon.targetExpInLevel - line.expInLevel);
  const requestedTarget = targetMixed(pokemon, input.boost.kind, pokemon.requestedBoostCandy);
  const candyToTarget = inventoryShortage || unallocatedShortage
    ? Math.max(0, mixed.boostCandy + mixed.normalCandy - line.totalCandyUnitsUsed)
    : 0;
  return {
    shortage: {
      expToTarget: expToActualTarget,
      candyToTarget,
      dreamShardShortage: shardsShortage ? Math.max(0, mixed.shards - remainingShards) : 0,
      boostCandyUnavailable: boostQuotaShortfall(input, requestedTarget.boostCandy, remainingBoost, line.boostedCandyUnits),
    },
    diagnosis: { byCandyInventory: { level: byCandy.level, expInLevel: byCandy.expInLevel, candyUsed: byCandy.boostUsed + byCandy.normalUsed }, byBoostLimit: { level: byBoost.level, expInLevel: byBoost.expInLevel, candyUsed: byBoost.boostUsed + byBoost.normalUsed }, byDreamShards: { level: byShards.level, expInLevel: byShards.expInLevel, candyUsed: byShards.boostUsed + byShards.normalUsed }, limitingFactor: line.effectiveTargetReached ? null : pickLimitingFactor([{ factor: 'candy', reached: byCandy, isShort: inventoryShortage || unallocatedShortage }, { factor: 'boost', reached: byBoost, isShort: boostShortage }, { factor: 'shards', reached: byShards, isShort: shardsShortage }]), isInventoryShortage: inventoryShortage || unallocatedShortage, isBoostShortage: boostShortage, isShardsShortage: shardsShortage },
  };
}
function consumeInventory(inventory: CandyInventory, pokemon: NormalizedPokemon, line: PokemonPlanLine): void {
  const supply = line.candySupply; const key = speciesKey(pokemon);
  inventory.species[key] = Math.max(0, (inventory.species[key] ?? 0) - supply.species);
  const type = inventory.typeCandy[pokemon.type] ?? (inventory.typeCandy[pokemon.type] = { s: 0, m: 0 });
  type.s = Math.max(0, type.s - supply.type.s); type.m = Math.max(0, type.m - supply.type.m);
  inventory.universal.s = Math.max(0, inventory.universal.s - supply.universal.s); inventory.universal.m = Math.max(0, inventory.universal.m - supply.universal.m); inventory.universal.l = Math.max(0, inventory.universal.l - supply.universal.l);
}
export function solveLevelPlan(rawInput: LevelPlannerInput): LevelPlannerResult {
  const perfEnabled = isPerfEnabled();
  const started = perfEnabled || DEBUG_LEVEL_PLANNER ? performance.now() : 0;
  const previousLossLedger = activeLossLedger;
  const lossLedger = createPlannerLossLedger();
  activeLossLedger = lossLedger;
  let phaseStarted = started;
  const phases: Record<string, number> = {};
  const markPhase = (name: string): void => {
    if (!perfEnabled) return;
    const now = performance.now();
    phases[name] = roundMs(now - phaseStarted);
    phaseStarted = now;
  };
  const input = normalizeInput(rawInput);
  markPhase('normalize');
  const selectedPlan = selectFbl01dChoices(input);
  const optimized = selectedPlan.optimized;
  markPhase('optimize');
  const choices = input.pokemonList.map((pokemon, index) => selectedPlan.choices[index] ?? { p: pokemon, line: zeroLine(pokemon), usage: emptyUsage(), stableIndex: 0 });
  const boundaryIndex = boundaryIndexForChoices(choices);
  markPhase('selectChoices');
  const inventory = structuredClone(input.candyInventory); let snapshot = emptyUsage();
  const pokemonResults: PokemonPlanResult[] = choices.map((candidate, index) => {
    const pokemon = candidate.p;
    const planned = plannedCandyForDisplay(pokemon, input);
    const targetLine = displayLine(pokemon, input, inventory, planned.total, planned.boost, candidate.line.candySupply, candidate.line.totalCandyUnitsUsed);
    const diagnostic = calcDiagnosis(pokemon, candidate.line, snapshot, input);
    const role = boundaryIndex === null || index < boundaryIndex ? 'upper' : index === boundaryIndex ? 'boundary' : 'lower';
    consumeInventory(inventory, pokemon, candidate.line); snapshot = mergeUsage(snapshot, candidate.usage);
    return { pokemonId: pokemon.pokemonId, pokedexId: pokemon.pokedexId, name: pokemon.name, currentLevel: pokemon.currentLevel, currentExpInLevel: pokemon.currentExpInLevel, targetLevel: pokemon.targetLevel, targetExpInLevel: pokemon.targetExpInLevel, targetLine, reachableLine: candidate.line, candyDemandMet: candidate.line.candyDemandMet, shortage: diagnostic.shortage, constraintDiagnosis: diagnostic.diagnosis, role };
  });
  markPhase('renderResults');
  const boostUsed = pokemonResults.reduce((sum, result) => sum + result.reachableLine.boostedCandyUnits, 0);
  const candyShortages = pokemonResults.filter(result => result.shortage.candyToTarget > 0).map(result => ({ pokemonId: result.pokemonId, name: result.name, amount: result.shortage.candyToTarget }));
  const shardShortages = pokemonResults.filter(result => result.shortage.dreamShardShortage > 0).map(result => ({ pokemonId: result.pokemonId, name: result.name, amount: result.shortage.dreamShardShortage }));
  if (perfEnabled) {
    console.info('[perf] solveLevelPlan', {
      totalMs: roundMs(performance.now() - started),
      phases,
      pokemonCount: input.pokemonList.length,
      fbl01d: {
        solvedCandidates: optimized.solvedCandidates,
        supplyRejectedCandidates: optimized.supplyRejectedCandidates,
        supplyInconclusiveCandidates: optimized.supplyInconclusiveCandidates,
        feasibilityMs: optimized.feasibilityMs,
        refineMs: optimized.refineMs,
        refineStatus: optimized.refineStatus,
        refineReason: optimized.refineReason,
        boundarySearch: optimized.boundarySearch,
        prefixSearch: optimized.prefixSearch,
        prefixSearchAttempts: optimized.prefixSearchAttempts,
      },
      lossLedger: toPublicPlannerLossLedger(lossLedger),
      cache: { candidates: candidateCache.size, supplyCandidates: supplyCandidateCache.size },
      adopted: selectedPlan.adopted,
    });
  } else if (DEBUG_LEVEL_PLANNER) console.debug(`[level-planner] solve ${roundMs(performance.now() - started)}ms`);
  const result: LevelPlannerResult = {
    pokemonResults,
    summary: {
      totalDreamShardsUsed: snapshot.shards, dreamShardsRemaining: Math.max(0, input.dreamShards - snapshot.shards), boost: { kind: input.boost.kind, boostLimit: input.boost.limit, boostUsed, boostRemaining: Math.max(0, input.boost.limit - boostUsed) }, speciesCandyUsed: snapshot.species, typeCandyUsed: snapshot.type, universalCandyUsed: snapshot.universal, speciesCandyRemaining: inventory.species, typeCandyRemaining: inventory.typeCandy, universalCandyRemaining: inventory.universal,
      itemUsageRanking: pokemonResults.map(result => ({ pokemonId: result.pokemonId, name: result.name, typeS: result.reachableLine.candySupply.type.s, typeM: result.reachableLine.candySupply.type.m, universalS: result.reachableLine.candySupply.universal.s, universalM: result.reachableLine.candySupply.universal.m, universalL: result.reachableLine.candySupply.universal.l, totalValue: supplyValue({ species: 0, type: result.reachableLine.candySupply.type, universal: result.reachableLine.candySupply.universal }) })).sort((a, b) => b.totalValue - a.totalValue),
      totalNeed: { totalCandyUnits: pokemonResults.reduce((sum, result) => sum + result.reachableLine.totalCandyUnitsUsed, 0), totalDreamShards: pokemonResults.reduce((sum, result) => sum + result.reachableLine.dreamShardsUsed, 0), totalBoostCandyRequested: boostUsed },
      totalSupplied: { totalCandyValue: pokemonResults.reduce((sum, result) => sum + supplyValue(result.reachableLine.candySupply), 0), totalBoostedCandyUnits: boostUsed, totalNonBoostCandyUnits: pokemonResults.reduce((sum, result) => sum + result.reachableLine.nonBoostCandyUnits, 0), totalDreamShards: snapshot.shards }, boundaryPokemonId: boundaryIndex === null ? undefined : input.pokemonList[boundaryIndex]?.pokemonId, fullyReachedCount: boundaryIndex ?? pokemonResults.length,
    },
    shortages: { hasShortage: candyShortages.length > 0 || shardShortages.length > 0, totalExpToTargets: pokemonResults.reduce((sum, result) => sum + result.shortage.expToTarget, 0), totalCandyShortage: candyShortages.reduce((sum, result) => sum + result.amount, 0), totalDreamShardShortage: shardShortages.reduce((sum, result) => sum + result.amount, 0), candyShortages, shardShortages },
    lossLedger: toPublicPlannerLossLedger(lossLedger),
    performance: {
      feasibilityMs: optimized.feasibilityMs,
      refineMs: optimized.refineMs,
      refineStatus: optimized.refineStatus,
      refineReason: optimized.refineReason,
      boundarySearch: optimized.boundarySearch,
      prefixSearch: optimized.prefixSearch,
      prefixSearchAttempts: optimized.prefixSearchAttempts,
    },
  };
  activeLossLedger = previousLossLedger;
  return result;
}

function boundaryIndexForChoices(choices: Candidate[]): number | null {
  const index = choices.findIndex(candidate => !candidate.line.candyDemandMet);
  return index >= 0 ? index : null;
}

function renderMixedResult(input: NormalizedInput, choices: Candidate[], lossLedger: InternalPlannerLossLedger): LevelPlannerResult {
  const normalizedChoices = input.pokemonList.map((pokemon, index) => choices[index] ?? { p: pokemon, line: zeroLine(pokemon), usage: emptyUsage(), stableIndex: 0 });
  const boundaryIndex = boundaryIndexForChoices(normalizedChoices);
  const inventory = structuredClone(input.candyInventory);
  let snapshot = emptyUsage();
  const pokemonResults: PokemonPlanResult[] = normalizedChoices.map((candidate, index) => {
    const pokemon = candidate.p;
    const planned = plannedCandyForDisplay(pokemon, input);
    const targetLine = displayLine(pokemon, input, inventory, planned.total, planned.boost, candidate.line.candySupply, candidate.line.totalCandyUnitsUsed);
    const diagnostic = calcDiagnosis(pokemon, candidate.line, snapshot, input);
    const role = boundaryIndex === null || index < boundaryIndex ? 'upper' : index === boundaryIndex ? 'boundary' : 'lower';
    consumeInventory(inventory, pokemon, candidate.line);
    snapshot = mergeUsage(snapshot, candidate.usage);
    return { pokemonId: pokemon.pokemonId, pokedexId: pokemon.pokedexId, name: pokemon.name, currentLevel: pokemon.currentLevel, currentExpInLevel: pokemon.currentExpInLevel, targetLevel: pokemon.targetLevel, targetExpInLevel: pokemon.targetExpInLevel, targetLine, reachableLine: candidate.line, candyDemandMet: candidate.line.candyDemandMet, shortage: diagnostic.shortage, constraintDiagnosis: diagnostic.diagnosis, role };
  });
  const boostUsed = pokemonResults.reduce((sum, result) => sum + result.reachableLine.boostedCandyUnits, 0);
  const candyShortages = pokemonResults.filter(result => result.shortage.candyToTarget > 0).map(result => ({ pokemonId: result.pokemonId, name: result.name, amount: result.shortage.candyToTarget }));
  const shardShortages = pokemonResults.filter(result => result.shortage.dreamShardShortage > 0).map(result => ({ pokemonId: result.pokemonId, name: result.name, amount: result.shortage.dreamShardShortage }));
  return {
    pokemonResults,
    summary: {
      totalDreamShardsUsed: snapshot.shards,
      dreamShardsRemaining: Math.max(0, input.dreamShards - snapshot.shards),
      boost: { kind: input.boost.kind, boostLimit: input.boost.limit, boostUsed, boostRemaining: Math.max(0, input.boost.limit - boostUsed) },
      speciesCandyUsed: snapshot.species,
      typeCandyUsed: snapshot.type,
      universalCandyUsed: snapshot.universal,
      speciesCandyRemaining: inventory.species,
      typeCandyRemaining: inventory.typeCandy,
      universalCandyRemaining: inventory.universal,
      itemUsageRanking: pokemonResults.map(result => ({ pokemonId: result.pokemonId, name: result.name, typeS: result.reachableLine.candySupply.type.s, typeM: result.reachableLine.candySupply.type.m, universalS: result.reachableLine.candySupply.universal.s, universalM: result.reachableLine.candySupply.universal.m, universalL: result.reachableLine.candySupply.universal.l, totalValue: supplyValue({ species: 0, type: result.reachableLine.candySupply.type, universal: result.reachableLine.candySupply.universal }) })).sort((a, b) => b.totalValue - a.totalValue),
      totalNeed: { totalCandyUnits: pokemonResults.reduce((sum, result) => sum + result.reachableLine.totalCandyUnitsUsed, 0), totalDreamShards: pokemonResults.reduce((sum, result) => sum + result.reachableLine.dreamShardsUsed, 0), totalBoostCandyRequested: boostUsed },
      totalSupplied: { totalCandyValue: pokemonResults.reduce((sum, result) => sum + supplyValue(result.reachableLine.candySupply), 0), totalBoostedCandyUnits: boostUsed, totalNonBoostCandyUnits: pokemonResults.reduce((sum, result) => sum + result.reachableLine.nonBoostCandyUnits, 0), totalDreamShards: snapshot.shards },
      boundaryPokemonId: boundaryIndex === null ? undefined : input.pokemonList[boundaryIndex]?.pokemonId,
      fullyReachedCount: boundaryIndex ?? pokemonResults.length,
    },
    shortages: { hasShortage: candyShortages.length > 0 || shardShortages.length > 0, totalExpToTargets: pokemonResults.reduce((sum, result) => sum + result.shortage.expToTarget, 0), totalCandyShortage: candyShortages.reduce((sum, result) => sum + result.amount, 0), totalDreamShardShortage: shardShortages.reduce((sum, result) => sum + result.amount, 0), candyShortages, shardShortages },
    lossLedger: toPublicPlannerLossLedger(lossLedger),
  };
}

function chooseMixedChoices(input: NormalizedInput): MixedChoiceResult {
  const feasibility = selectFbl01dChoices(input);
  return { choices: feasibility.choices, source: 'feasibility', exactPrefixCount: 0 };
}

/** deadline付き実行のworker/store境界用API。通常のsolveLevelPlanは従来通り結果だけを返す。 */
export function solveLevelPlanWithBudget(rawInput: LevelPlannerInput, options: PlannerSolveOptions): PlannerSolveOutcome {
  const started = performance.now();
  const previousLossLedger = activeLossLedger;
  const previousDeadline = activeDeadline;
  const previousTuning = activeTuning;
  const mixedLedger = createPlannerLossLedger();
  const tuning = options.tuning;
  if (tuning) activeTuning = { ...activeTuning, ...tuning };
  activeDeadline = options.abortAfterExpansions !== undefined
    ? { startedAt: started, deadlineAt: undefined, abortAfterExpansions: options.abortAfterExpansions, checks: 0, maxNextStates: 0, maxOutputStates: 0, reachedIndex: -1, expansions: 0, prefix: { state: emptyPlannerState(), completedPrefixCount: 0 } }
    : null;
  try {
    if (options.calculationMode === 'exact') deadlineCheckpoint(-1, 0, emptyPlannerState(), 0, true);
    if (options.calculationMode === 'prefixLocalMixed') {
      const input = normalizeInput(rawInput);
      activeLossLedger = mixedLedger;
      const mixed = chooseMixedChoices(input);
      const durationMs = roundMs(performance.now() - started);
      return {
        kind: 'result',
        result: renderMixedResult(input, mixed.choices, mixedLedger),
        durationMs,
        mixedMeta: { source: mixed.source, exactPrefixCount: mixed.exactPrefixCount, localSuffixCount: input.pokemonList.length - mixed.exactPrefixCount },
      };
    }
    const result = solveLevelPlan(rawInput);
    return { kind: 'result', result, durationMs: roundMs(performance.now() - started) };
  } catch (error) {
    if (!(error instanceof PlannerDeadlineExceeded)) throw error;
    const input = normalizeInput(rawInput);
    // solveLevelPlan が deadline 例外で脱出した場合、内部exact用ledgerが
    // 復元される前にここへ来る。ミックス計算の候補生成・描画は専用ledgerへ切り替える。
    activeLossLedger = mixedLedger;
    activeDeadline = null;
    const mixed = chooseMixedChoices(input);
    const mixedResult = renderMixedResult(input, mixed.choices, mixedLedger);
    return {
      kind: 'deadlineExceeded',
      meta: error.meta,
      mixedResult,
      durationMs: roundMs(performance.now() - started),
      mixedMeta: { source: mixed.source, exactPrefixCount: mixed.exactPrefixCount, localSuffixCount: input.pokemonList.length - mixed.exactPrefixCount },
    };
  } finally {
    activeLossLedger = previousLossLedger;
    activeDeadline = previousDeadline;
    activeTuning = previousTuning;
  }
}

/** テスト用の観測点。公開APIではなく、候補メモ化の回帰確認だけに使う。 */
export const __levelPlannerTestHooks = {
  clearCandidateCache: () => {
    candidateCache.clear();
    supplyCandidateCache.clear();
    fbl01dFrontierCache.clear();
    fbl01dGlobalPrefixCache.clear();
    fbl01dRowFrontierCache.clear();
  },
  candidateCacheSize: () => candidateCache.size,
  fbl01dFrontierCacheSize: () => fbl01dFrontierCache.size + fbl01dGlobalPrefixCache.size + fbl01dRowFrontierCache.size,
  compareSyntheticStatesForTest: (
    a: Array<Partial<PokemonPlanLine> & { candyDemandMet: boolean; effectiveTargetReached: boolean; level: number; expInLevel: number; species?: number; surplusCandyValue?: number }>,
    b: Array<Partial<PokemonPlanLine> & { candyDemandMet: boolean; effectiveTargetReached: boolean; level: number; expInLevel: number; species?: number; surplusCandyValue?: number }>,
    mode: PlannerOptions['itemCompareMode'] = 'legacyImproved',
  ) => {
    const toCandidate = (line: Partial<PokemonPlanLine> & { candyDemandMet: boolean; effectiveTargetReached: boolean; level: number; expInLevel: number; species?: number; surplusCandyValue?: number }, index: number): Candidate => {
      const supply = { ...emptySupply(), species: line.species ?? 0 };
      const totalCandyUnitsUsed = line.totalCandyUnitsUsed ?? 0;
      const planLine: PokemonPlanLine = {
        level: line.level,
        expInLevel: line.expInLevel,
        expToNextLevel: line.expToNextLevel ?? 0,
        expToTarget: line.expToTarget ?? 0,
        totalCandyUnitsUsed,
        boostedCandyUnits: line.boostedCandyUnits ?? 0,
        nonBoostCandyUnits: line.nonBoostCandyUnits ?? totalCandyUnitsUsed,
        candySupply: line.candySupply ?? supply,
        dreamShardsUsed: line.dreamShardsUsed ?? 0,
        expGained: line.expGained ?? 0,
        surplusExp: line.surplusExp ?? 0,
        surplusCandyValue: line.surplusCandyValue ?? Math.max(0, supplyValue(line.candySupply ?? supply) - totalCandyUnitsUsed),
        candyDemandMet: line.candyDemandMet,
        // §11.3 の2述語は畳まない。`?? line.candyDemandMet` を戻すと、
        // 2つを混同する回帰をこのフックを使うテストが構造的に検出できなくなる。
        effectiveTargetReached: line.effectiveTargetReached,
      };
      return {
        p: {
          pokemonId: `synthetic-${index}`,
          pokedexId: index + 1,
          name: `synthetic-${index}`,
          type: 'synthetic',
          currentLevel: 1,
          currentExpInLevel: 0,
          targetLevel: 100,
          targetExpInLevel: 0,
          requestedBoostCandy: 0,
          boostAllowed: true,
          expType: 600,
          nature: 'normal',
          priorityIndex: index,
          effectiveLevel: 100,
          effectiveExp: 0,
          preferZeroSurplus: false,
        } as NormalizedPokemon,
        line: planLine,
        usage: emptyUsage(),
        stableIndex: index,
      };
    };
    return compareState(stateForChoices(a.map(toCandidate), mode), stateForChoices(b.map(toCandidate), mode), mode);
  },
  withTuningForTest: <T>(tuning: Partial<InternalPlannerTuning>, run: () => T): T => {
    const previous = activeTuning;
    activeTuning = { ...activeTuning, ...tuning };
    candidateCache.clear();
    supplyCandidateCache.clear();
    fbl01dFrontierCache.clear();
    fbl01dGlobalPrefixCache.clear();
    fbl01dRowFrontierCache.clear();
    try {
      return run();
    } finally {
      activeTuning = previous;
      candidateCache.clear();
      supplyCandidateCache.clear();
      fbl01dFrontierCache.clear();
      fbl01dGlobalPrefixCache.clear();
      fbl01dRowFrontierCache.clear();
    }
  },
  speciesNeedsForTest: (rawInput: LevelPlannerInput) => normalizeInput(rawInput).speciesNeeds,
  candidatesForTest: (rawInput: LevelPlannerInput, pokemonIndex: number) => {
    const input = normalizeInput(rawInput);
    return generatePokemonCandidates(input.pokemonList[pokemonIndex], input).map(candidate => ({
      level: candidate.line.level,
      expInLevel: candidate.line.expInLevel,
      candyDemandMet: candidate.line.candyDemandMet,
      totalCandyUnitsUsed: candidate.line.totalCandyUnitsUsed,
      boostedCandyUnits: candidate.line.boostedCandyUnits,
      surplusCandyValue: candidate.line.surplusCandyValue,
      surplusExp: candidate.line.surplusExp,
      supply: candidate.line.candySupply,
    }));
  },
  supplyCandidatesForTest: (rawInput: LevelPlannerInput, pokemonIndex: number, totalCandyUnits: number) => {
    const input = normalizeInput(rawInput);
    return enumerateCandySupplyCandidates(totalCandyUnits, input.pokemonList[pokemonIndex], input);
  },
};
