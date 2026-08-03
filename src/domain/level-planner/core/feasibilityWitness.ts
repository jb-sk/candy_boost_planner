import { CANDY_VALUES } from '../constants';
import { isCandyFamilyKey } from '../../pokesleep/candy-family';
import { refineExactSupply } from './exactSupplyRefine';
import { addItemPriority, compareItemPriority, emptyItemPriority, itemCountsFromPriority, itemPriorityOf } from './itemPriority';
import type { ItemPriorityTuple } from './itemPriority';
import type {
  CandyInventory,
  FeasiblePlanRow,
  FeasibleResourceState,
  FeasibilityDemandRow,
  FeasibilityRefineResult,
  FeasibilityRefineStatus,
  FeasibilityResult,
  FeasibilitySolverOptions,
  FeasibilityStats,
  FeasibilityValidationResult,
  FeasibilityWitness,
  SolverItemCompareMode,
  TypeCandyStock,
  UniversalCandyStock,
} from '../types';

type Supply = FeasiblePlanRow['supply'];

type PreparedRow = FeasibilityDemandRow & {
  readonly speciesLexOrder: number;
};

function prepareRows(rows: FeasibilityDemandRow[]): PreparedRow[] {
  return rows.map((row, originalIndex) => ({
    ...row,
    speciesLexOrder: -originalIndex,
  }));
}

type PathNode = {
  rowIndex: number;
  option: Supply;
  previous: PathNode | null;
};

type RepresentativeQuality = {
  zeroSurplusCount: number;
  normalizedSurplus: number;
  maxSurplus: number;
  rawSurplus: number;
  reachedSurplus: number;
  totalCandy: number;
  speciesLex: number;
  priority: ItemPriorityTuple;
};

type ResourceState = {
  typeS: Record<string, number>;
  typeM: Record<string, number>;
  universalS: number;
  universalM: number;
  universalL: number;
  quality: RepresentativeQuality;
  path: PathNode | null;
};

type SharedResourceState = ResourceState & {
  // 共有種族の総量制約を満たすための内部状態。目的関数のキーではない。
  speciesUsed: number;
};

type BlockState = {
  universalS: number;
  universalM: number;
  universalL: number;
  quality: RepresentativeQuality;
  path: PathNode | null;
};

type CachedTypeBlockFrontier = {
  frontier: BlockState[];
  rowOptionCounts: Array<[number, number]>;
  rowFrontierCounts: Array<[number, number]>;
  typeBlockFrontierCount: number;
};

type CachedRowFrontier = {
  frontier: GroupFrontier;
  optionCount: number;
  rowFrontierCount: number;
};

type InternalFeasibilitySolverOptions = FeasibilitySolverOptions & {
  frontierCache?: Map<string, CachedTypeBlockFrontier>;
  globalPrefixCache?: Map<string, BlockState[]>;
  rowFrontierCache?: Map<string, CachedRowFrontier>;
  decisionOnly?: boolean;
  sharedSpeciesStrategy?: 'complete' | 'topDownCandidate';
};

type GroupFrontier = ResourceState[];

type SolverContext = {
  startedAt: number;
  options: InternalFeasibilitySolverOptions;
  stats: FeasibilityStats;
};

export type FeasibilityDecisionResult =
  | { status: 'feasible'; stats: FeasibilityStats; toWitness?: () => FeasibilityResult }
  | { status: 'infeasible'; reason: string; stats: FeasibilityStats }
  | { status: 'inconclusive'; reason: string; stats: FeasibilityStats };

type FeasibilityDecisionPayload =
  | { status: 'feasible'; toWitness?: () => FeasibilityResult }
  | { status: 'infeasible'; reason: string }
  | { status: 'inconclusive'; reason: string };

type UniversalDecisionEnvelope = {
  minUniversalS: Int32Array;
  mediumDim: number;
  largeDim: number;
  impossible: number;
};

class FeasibilityRefineAbort extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'FeasibilityRefineAbort';
  }
}

class FeasibilityAbort extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'FeasibilityAbort';
  }
}

const NON_SPECIES_KEYS = ['typeS', 'typeM', 'universalS', 'universalM', 'universalL'] as const;
const SINGLE_TYPE_SPARSE_PRUNE_MAX_STATES = 4096;

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function ceilDiv(value: number, divisor: number): number {
  return Math.max(0, Math.ceil(value / divisor));
}

function supplyValue(supply: Supply): number {
  return supply.species
    + supply.typeS * CANDY_VALUES.type.s
    + supply.typeM * CANDY_VALUES.type.m
    + supply.universalS * CANDY_VALUES.universal.s
    + supply.universalM * CANDY_VALUES.universal.m
    + supply.universalL * CANDY_VALUES.universal.l;
}

function emptyQuality(): RepresentativeQuality {
  return {
    zeroSurplusCount: 0,
    normalizedSurplus: 0,
    maxSurplus: 0,
    rawSurplus: 0,
    reachedSurplus: 0,
    totalCandy: 0,
    speciesLex: 0,
    priority: emptyItemPriority(),
  };
}

function qualityForOption(supply: Supply, totalCandy: number, preferZeroSurplus = false, speciesLexOrder = 0, candyDemandMet = true): RepresentativeQuality {
  const surplus = Math.max(0, supplyValue(supply) - totalCandy);
  return {
    zeroSurplusCount: preferZeroSurplus && surplus === 0 ? 1 : 0,
    normalizedSurplus: surplus <= 2 ? 0 : surplus,
    maxSurplus: surplus,
    rawSurplus: surplus,
    reachedSurplus: candyDemandMet ? surplus : 0,
    totalCandy,
    speciesLex: supply.species * speciesLexOrder,
    priority: itemPriorityOf(supply),
  };
}

function addQuality(a: RepresentativeQuality, b: RepresentativeQuality): RepresentativeQuality {
  return {
    zeroSurplusCount: a.zeroSurplusCount + b.zeroSurplusCount,
    normalizedSurplus: a.normalizedSurplus + b.normalizedSurplus,
    maxSurplus: Math.max(a.maxSurplus, b.maxSurplus),
    rawSurplus: a.rawSurplus + b.rawSurplus,
    reachedSurplus: a.reachedSurplus + b.reachedSurplus,
    totalCandy: a.totalCandy + b.totalCandy,
    speciesLex: a.speciesLex + b.speciesLex,
    priority: addItemPriority(a.priority, b.priority),
  };
}

function compareQuality(a: RepresentativeQuality, b: RepresentativeQuality, mode?: SolverItemCompareMode): number {
  if (mode === 'surplusFirst') {
    if (a.reachedSurplus !== b.reachedSurplus) return a.reachedSurplus < b.reachedSurplus ? 1 : -1;
    if (a.zeroSurplusCount !== b.zeroSurplusCount) return a.zeroSurplusCount > b.zeroSurplusCount ? 1 : -1;
    if (a.rawSurplus !== b.rawSurplus) return a.rawSurplus < b.rawSurplus ? 1 : -1;
    if (a.totalCandy !== b.totalCandy) return a.totalCandy > b.totalCandy ? 1 : -1;
    if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
    return compareItemPriority(a.priority, b.priority);
  }
  if (mode === 'legacyImproved' || mode === 'surplusGateFirst') {
    if (a.zeroSurplusCount !== b.zeroSurplusCount) return a.zeroSurplusCount > b.zeroSurplusCount ? 1 : -1;
    const acceptableA = a.normalizedSurplus === 0;
    const acceptableB = b.normalizedSurplus === 0;
    if (acceptableA !== acceptableB) return acceptableA ? 1 : -1;
    if (!acceptableA && a.normalizedSurplus !== b.normalizedSurplus) return a.normalizedSurplus < b.normalizedSurplus ? 1 : -1;
    if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
    const priority = compareItemPriority(a.priority, b.priority);
    if (priority) return priority;
    // 余り0〜2を同等扱いする分、スコア同点でも供給価値がずれる。ここで明示的に詰める。
    if (a.rawSurplus !== b.rawSurplus) return a.rawSurplus < b.rawSurplus ? 1 : -1;
    return 0;
  }
  if (a.zeroSurplusCount !== b.zeroSurplusCount) return a.zeroSurplusCount > b.zeroSurplusCount ? 1 : -1;
  if (a.normalizedSurplus !== b.normalizedSurplus) return a.normalizedSurplus < b.normalizedSurplus ? 1 : -1;
  if (a.maxSurplus !== b.maxSurplus) return a.maxSurplus < b.maxSurplus ? 1 : -1;
  if (a.rawSurplus !== b.rawSurplus) return a.rawSurplus < b.rawSurplus ? 1 : -1;
  if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
  return 0;
}

function shouldKeepDecisionSurplusQuality(context?: SolverContext): boolean {
  return Boolean(context?.options.decisionOnly
    && (context.options.maxTotalSurplus !== undefined || context.options.maxReachedSurplus !== undefined));
}

function qualityAtLeast(a: RepresentativeQuality, b: RepresentativeQuality, context?: SolverContext): boolean {
  if (context?.options.decisionOnly) {
    return !shouldKeepDecisionSurplusQuality(context) || compareQuality(a, b, context.options.itemCompareMode) >= 0;
  }
  return compareQuality(a, b, context?.options.itemCompareMode) >= 0;
}

function qualityGreater(a: RepresentativeQuality, b: RepresentativeQuality, context?: SolverContext): boolean {
  if (context?.options.decisionOnly) {
    return shouldKeepDecisionSurplusQuality(context) && compareQuality(a, b, context.options.itemCompareMode) > 0;
  }
  return compareQuality(a, b, context?.options.itemCompareMode) > 0;
}

function withinTotalSurplusBudget(quality: RepresentativeQuality, context?: SolverContext): boolean {
  const maxTotalSurplus = context?.options.maxTotalSurplus;
  const maxReachedSurplus = context?.options.maxReachedSurplus;
  return (maxTotalSurplus === undefined || quality.rawSurplus <= maxTotalSurplus)
    && (maxReachedSurplus === undefined || quality.reachedSurplus <= maxReachedSurplus);
}

function compareFinalBlockState(a: BlockState, b: BlockState, mode?: SolverItemCompareMode): number {
  if (mode === 'surplusFirst') {
    const quality = compareQuality(a.quality, b.quality, mode);
    if (quality !== 0) return quality;
    if (a.universalS !== b.universalS) return a.universalS > b.universalS ? 1 : -1;
    if (a.universalM !== b.universalM) return a.universalM > b.universalM ? 1 : -1;
    if (a.universalL !== b.universalL) return a.universalL > b.universalL ? 1 : -1;
    return 0;
  }
  if (mode === 'legacyImproved' || mode === 'surplusGateFirst') {
    const quality = compareQuality(a.quality, b.quality, mode);
    if (quality !== 0) return quality;
  }
  if (a.universalS !== b.universalS) return a.universalS < b.universalS ? 1 : -1;
  if (a.universalM !== b.universalM) return a.universalM < b.universalM ? 1 : -1;
  if (a.universalL !== b.universalL) return a.universalL < b.universalL ? 1 : -1;
  return compareQuality(a.quality, b.quality, mode);
}

function nonSpeciesValue(supply: Supply): number {
  return supplyValue(supply) - supply.species;
}

function itemValue(key: typeof NON_SPECIES_KEYS[number]): number {
  switch (key) {
    case 'typeS': return CANDY_VALUES.type.s;
    case 'typeM': return CANDY_VALUES.type.m;
    case 'universalS': return CANDY_VALUES.universal.s;
    case 'universalM': return CANDY_VALUES.universal.m;
    case 'universalL': return CANDY_VALUES.universal.l;
  }
}

function resourceKey(state: ResourceState, speciesUsed?: number): string {
  const prefix = speciesUsed === undefined ? '' : `${speciesUsed}|`;
  return `${prefix}${JSON.stringify({
    typeS: Object.entries(state.typeS).sort(([a], [b]) => a.localeCompare(b)),
    typeM: Object.entries(state.typeM).sort(([a], [b]) => a.localeCompare(b)),
    universalS: state.universalS,
    universalM: state.universalM,
    universalL: state.universalL,
  })}`;
}

function addResourceState(a: ResourceState, b: ResourceState, path: PathNode | null): ResourceState {
  const typeS = { ...a.typeS };
  const typeM = { ...a.typeM };
  for (const [type, amount] of Object.entries(b.typeS)) typeS[type] = (typeS[type] ?? 0) + amount;
  for (const [type, amount] of Object.entries(b.typeM)) typeM[type] = (typeM[type] ?? 0) + amount;
  return {
    typeS,
    typeM,
    universalS: a.universalS + b.universalS,
    universalM: a.universalM + b.universalM,
    universalL: a.universalL + b.universalL,
    quality: addQuality(a.quality, b.quality),
    path,
  };
}

function pathEntries(path: PathNode | null): Array<{ rowIndex: number; option: Supply }> {
  const entries: Array<{ rowIndex: number; option: Supply }> = [];
  let current = path;
  while (current) {
    entries.push({ rowIndex: current.rowIndex, option: current.option });
    current = current.previous;
  }
  entries.reverse();
  return entries;
}

function appendPath(base: PathNode | null, addition: PathNode | null): PathNode | null {
  let result = base;
  for (const entry of pathEntries(addition)) {
    result = { rowIndex: entry.rowIndex, option: entry.option, previous: result };
  }
  return result;
}

function pathFromEntries(entries: Array<{ rowIndex: number; option: Supply }>): PathNode | null {
  let result: PathNode | null = null;
  for (const entry of entries) {
    result = { rowIndex: entry.rowIndex, option: entry.option, previous: result };
  }
  return result;
}

function supplyKey(supply: Supply): string {
  return `${supply.species}|${supply.typeS}|${supply.typeM}|${supply.universalS}|${supply.universalM}|${supply.universalL}`;
}

function isMinimumCover(supply: Supply, need: number): boolean {
  if (supplyValue(supply) < need) return false;
  for (const key of NON_SPECIES_KEYS) {
    if (supply[key] > 0 && supplyValue(supply) - itemValue(key) >= need) return false;
  }
  return true;
}

/**
 * §9.1 の閉形式 S 埋め。L/M/typeM を固定した後、typeS ごとに必要な
 * universalS を一意に計算する。S 同士の二重列挙は行わない。
 */
function enumerateMinimumCoverOptions(
  need: number,
  species: number,
  typeStock: TypeCandyStock,
  universalStock: UniversalCandyStock,
  context?: SolverContext,
): Supply[] {
  if (need === 0) return [{ species, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0 }];

  const result: Supply[] = [];
  const seen = new Set<string>();
  const add = (typeS: number, typeM: number, universalS: number, universalM: number, universalL: number): void => {
    const option: Supply = { species, typeS, typeM, universalS, universalM, universalL };
    if (!isMinimumCover(option, need + species)) return;
    const key = supplyKey(option);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(option);
  };

  const maxUniversalL = Math.min(universalStock.l, ceilDiv(need, CANDY_VALUES.universal.l));
  for (let universalL = 0; universalL <= maxUniversalL; universalL++) {
    if (context) checkpoint(context);
    const afterL = need - universalL * CANDY_VALUES.universal.l;
    if (afterL <= 0) {
      add(0, 0, 0, 0, universalL);
      continue;
    }

    const maxUniversalM = Math.min(universalStock.m, ceilDiv(afterL, CANDY_VALUES.universal.m));
    for (let universalM = 0; universalM <= maxUniversalM; universalM++) {
      if (context) checkpoint(context);
      const afterM = afterL - universalM * CANDY_VALUES.universal.m;
      if (afterM <= 0) {
        add(0, 0, 0, universalM, universalL);
        continue;
      }

      const maxTypeM = Math.min(typeStock.m, ceilDiv(afterM, CANDY_VALUES.type.m));
      for (let typeM = 0; typeM <= maxTypeM; typeM++) {
        if (context) checkpoint(context);
        const residual = afterM - typeM * CANDY_VALUES.type.m;
        if (residual <= 0) {
          add(0, typeM, 0, universalM, universalL);
          continue;
        }

        const maxTypeS = Math.min(typeStock.s, ceilDiv(residual + CANDY_VALUES.type.s - 1, CANDY_VALUES.type.s));
        for (let typeS = 0; typeS <= maxTypeS; typeS++) {
          if (context) checkpoint(context);
          const afterTypeS = residual - typeS * CANDY_VALUES.type.s;
          const universalS = afterTypeS > 0 ? ceilDiv(afterTypeS, CANDY_VALUES.universal.s) : 0;
          if (universalS > universalStock.s) continue;
          add(typeS, typeM, universalS, universalM, universalL);
        }
      }
    }
  }
  return result;
}

function dominates(a: ResourceState, b: ResourceState, mode?: SolverItemCompareMode): boolean {
  const typeKeys = new Set([...Object.keys(a.typeS), ...Object.keys(b.typeS), ...Object.keys(a.typeM), ...Object.keys(b.typeM)]);
  const noMoreType = [...typeKeys].every(type => (a.typeS[type] ?? 0) <= (b.typeS[type] ?? 0) && (a.typeM[type] ?? 0) <= (b.typeM[type] ?? 0));
  const strictlyLessType = [...typeKeys].some(type => (a.typeS[type] ?? 0) < (b.typeS[type] ?? 0) || (a.typeM[type] ?? 0) < (b.typeM[type] ?? 0));
  const noMore = noMoreType
    && a.universalS <= b.universalS
    && a.universalM <= b.universalM
    && a.universalL <= b.universalL;
  if (!noMore || compareQuality(a.quality, b.quality, mode) < 0) return false;
  const strictlyLess = strictlyLessType
    || a.universalS < b.universalS
    || a.universalM < b.universalM
    || a.universalL < b.universalL
    || compareQuality(a.quality, b.quality, mode) > 0;
  return noMore && strictlyLess;
}

function decisionDominates(a: ResourceState, b: ResourceState, context?: SolverContext): boolean {
  const typeKeys = new Set([...Object.keys(a.typeS), ...Object.keys(b.typeS), ...Object.keys(a.typeM), ...Object.keys(b.typeM)]);
  const noMoreType = [...typeKeys].every(type => (a.typeS[type] ?? 0) <= (b.typeS[type] ?? 0) && (a.typeM[type] ?? 0) <= (b.typeM[type] ?? 0));
  if (!noMoreType) return false;
  const noMore = a.universalS <= b.universalS && a.universalM <= b.universalM && a.universalL <= b.universalL;
  if (!noMore) return false;
  if (!qualityAtLeast(a.quality, b.quality, context)) return false;
  return [...typeKeys].some(type => (a.typeS[type] ?? 0) < (b.typeS[type] ?? 0) || (a.typeM[type] ?? 0) < (b.typeM[type] ?? 0))
    || a.universalS < b.universalS
    || a.universalM < b.universalM
    || a.universalL < b.universalL
    || qualityGreater(a.quality, b.quality, context);
}

function singleTypeKey<T extends ResourceState>(states: T[]): string | null {
  const keys = new Set<string>();
  for (const state of states) {
    for (const key of Object.keys(state.typeS)) keys.add(key);
    for (const key of Object.keys(state.typeM)) keys.add(key);
    if (keys.size > 1) return null;
  }
  return [...keys][0] ?? '';
}

function pruneSingleTypeResourceStates<T extends ResourceState>(states: T[], type: string, context?: SolverContext): T[] {
  const exact = new Map<string, T>();
  for (const state of states) {
    if (context) checkpoint(context);
    const key = resourceKey(state);
    const previous = exact.get(key);
    if (!previous || qualityGreater(state.quality, previous.quality, context)) exact.set(key, state);
  }

  const byMediumLarge = new Map<string, T[]>();
  for (const state of exact.values()) {
    if (context) checkpoint(context);
    const key = `${state.typeM[type] ?? 0}|${state.universalM}|${state.universalL}`;
    const list = byMediumLarge.get(key);
    if (list) list.push(state);
    else byMediumLarge.set(key, [state]);
  }

  const cheapPruned: T[] = [];
  for (const list of byMediumLarge.values()) {
    list.sort((a, b) => {
      const typeS = (a.typeS[type] ?? 0) - (b.typeS[type] ?? 0);
      return typeS || (a.universalS - b.universalS);
    });
    let bestLowerS: T | undefined;
    for (const state of list) {
      if (context) checkpoint(context);
      const dominatedByLowerS =
        bestLowerS !== undefined
        && (bestLowerS.typeS[type] ?? 0) <= (state.typeS[type] ?? 0)
        && bestLowerS.universalS <= state.universalS
        && qualityAtLeast(bestLowerS.quality, state.quality, context);
      if (!dominatedByLowerS) cheapPruned.push(state);
      if (!bestLowerS || qualityGreater(state.quality, bestLowerS.quality, context)) {
        bestLowerS = state;
      }
    }
  }
  if (cheapPruned.length > SINGLE_TYPE_SPARSE_PRUNE_MAX_STATES) return cheapPruned;

  type SparseEntry = { universalS: number; quality: RepresentativeQuality };
  const unique = cheapPruned;
  const typeSValues = [...new Set(unique.map(state => state.typeS[type] ?? 0))].sort((a, b) => a - b);
  const typeMValues = [...new Set(unique.map(state => state.typeM[type] ?? 0))].sort((a, b) => a - b);
  const universalMValues = [...new Set(unique.map(state => state.universalM))].sort((a, b) => a - b);
  const universalLValues = [...new Set(unique.map(state => state.universalL))].sort((a, b) => a - b);
  const rankOf = (values: number[], value: number): number => values.indexOf(value) + 1;
  const cellKey = (typeS: number, typeM: number, universalM: number, universalL: number): string =>
    `${typeS}|${typeM}|${universalM}|${universalL}`;
  const tree = new Map<string, SparseEntry[]>();

  const entryDominates = (entry: SparseEntry, state: T): boolean =>
    entry.universalS <= state.universalS
    && qualityAtLeast(entry.quality, state.quality, context);

  const queryDominated = (state: T): boolean => {
    const typeSRank = rankOf(typeSValues, state.typeS[type] ?? 0);
    const typeMRank = rankOf(typeMValues, state.typeM[type] ?? 0);
    const universalMRank = rankOf(universalMValues, state.universalM);
    const universalLRank = rankOf(universalLValues, state.universalL);
    for (let typeSIndex = typeSRank; typeSIndex > 0; typeSIndex -= typeSIndex & -typeSIndex) {
      for (let typeMIndex = typeMRank; typeMIndex > 0; typeMIndex -= typeMIndex & -typeMIndex) {
        for (let universalMIndex = universalMRank; universalMIndex > 0; universalMIndex -= universalMIndex & -universalMIndex) {
          for (let universalLIndex = universalLRank; universalLIndex > 0; universalLIndex -= universalLIndex & -universalLIndex) {
            if (context) checkpoint(context);
            const entries = tree.get(cellKey(typeSIndex, typeMIndex, universalMIndex, universalLIndex));
            if (entries?.some(entry => entryDominates(entry, state))) return true;
          }
        }
      }
    }
    return false;
  };

  const insertState = (state: T): void => {
    const typeSRank = rankOf(typeSValues, state.typeS[type] ?? 0);
    const typeMRank = rankOf(typeMValues, state.typeM[type] ?? 0);
    const universalMRank = rankOf(universalMValues, state.universalM);
    const universalLRank = rankOf(universalLValues, state.universalL);
    const entry: SparseEntry = { universalS: state.universalS, quality: state.quality };
    for (let typeSIndex = typeSRank; typeSIndex <= typeSValues.length; typeSIndex += typeSIndex & -typeSIndex) {
      for (let typeMIndex = typeMRank; typeMIndex <= typeMValues.length; typeMIndex += typeMIndex & -typeMIndex) {
        for (let universalMIndex = universalMRank; universalMIndex <= universalMValues.length; universalMIndex += universalMIndex & -universalMIndex) {
          for (let universalLIndex = universalLRank; universalLIndex <= universalLValues.length; universalLIndex += universalLIndex & -universalLIndex) {
            if (context) checkpoint(context);
            const key = cellKey(typeSIndex, typeMIndex, universalMIndex, universalLIndex);
            const entries = tree.get(key) ?? [];
            if (entries.some(existing => existing.universalS <= entry.universalS && qualityAtLeast(existing.quality, entry.quality, context))) continue;
            const filtered = entries.filter(existing =>
              !(entry.universalS <= existing.universalS && qualityAtLeast(entry.quality, existing.quality, context)),
            );
            filtered.push(entry);
            tree.set(key, filtered);
          }
        }
      }
    }
  };

  const result: T[] = [];
  for (const state of unique.sort((a, b) => {
    const typeS = (a.typeS[type] ?? 0) - (b.typeS[type] ?? 0);
    const typeM = (a.typeM[type] ?? 0) - (b.typeM[type] ?? 0);
    return typeS || typeM || (a.universalM - b.universalM) || (a.universalL - b.universalL) || (a.universalS - b.universalS);
  })) {
    if (context) checkpoint(context);
    if (!queryDominated(state)) {
      result.push(state);
      insertState(state);
    }
  }
  return result;
}

function pruneResourceStates<T extends ResourceState & { speciesUsed?: number }>(states: T[], includeSpecies: boolean, context?: SolverContext): T[] {
  const type = singleTypeKey(states);
  if (type !== null) {
    if (!includeSpecies) return pruneSingleTypeResourceStates(states, type, context);
    const bySpeciesUsed = new Map<number, T[]>();
    for (const state of states) {
      const speciesUsed = state.speciesUsed ?? 0;
      const group = bySpeciesUsed.get(speciesUsed);
      if (group) group.push(state);
      else bySpeciesUsed.set(speciesUsed, [state]);
    }
    return [...bySpeciesUsed.values()].flatMap(group => pruneSingleTypeResourceStates(group, type, context));
  }

  const exact = new Map<string, T>();
  for (const state of states) {
    if (context) checkpoint(context);
    const key = resourceKey(state, includeSpecies ? state.speciesUsed : undefined);
    const previous = exact.get(key);
    if (!previous || qualityGreater(state.quality, previous.quality, context)) exact.set(key, state);
  }
  const unique = [...exact.values()];
  const result: T[] = [];
  for (let index = 0; index < unique.length; index++) {
    const state = unique[index];
    let dominated = false;
    for (let otherIndex = 0; otherIndex < unique.length; otherIndex++) {
      if (context) checkpoint(context);
      if (index === otherIndex) continue;
      const other = unique[otherIndex];
      if (includeSpecies && other.speciesUsed !== state.speciesUsed) continue;
      if (context?.options.decisionOnly ? decisionDominates(other, state, context) : dominates(other, state, context?.options.itemCompareMode)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) result.push(state);
  }
  return result;
}

function blockDominates(a: BlockState, b: BlockState, mode?: SolverItemCompareMode): boolean {
  const noMore = a.universalS <= b.universalS && a.universalM <= b.universalM && a.universalL <= b.universalL;
  if (!noMore || compareQuality(a.quality, b.quality, mode) < 0) return false;
  const strictlyLess = a.universalS < b.universalS || a.universalM < b.universalM || a.universalL < b.universalL;
  return strictlyLess || compareQuality(a.quality, b.quality, mode) > 0;
}

function decisionBlockDominates(a: BlockState, b: BlockState, context?: SolverContext): boolean {
  const noMore = a.universalS <= b.universalS && a.universalM <= b.universalM && a.universalL <= b.universalL;
  if (!noMore) return false;
  if (!qualityAtLeast(a.quality, b.quality, context)) return false;
  return a.universalS < b.universalS
    || a.universalM < b.universalM
    || a.universalL < b.universalL
    || qualityGreater(a.quality, b.quality, context);
}

function blockStateKey(state: BlockState): string {
  return `${state.universalS}|${state.universalM}|${state.universalL}`;
}

function blockStateMediumLargeKey(state: BlockState): string {
  return `${state.universalM}|${state.universalL}`;
}

function keepBestExactBlockState(map: Map<string, BlockState>, state: BlockState, mode?: SolverItemCompareMode): void {
  const key = blockStateKey(state);
  const previous = map.get(key);
  if (!previous || compareQuality(state.quality, previous.quality, mode) > 0) map.set(key, state);
}

function keepBestBlockState(map: Map<string, BlockState>, state: BlockState, context: SolverContext): void {
  const key = blockStateKey(state);
  const previous = map.get(key);
  if (!previous || qualityGreater(state.quality, previous.quality, context)) map.set(key, state);
}

function pruneBlockStates(states: BlockState[], context?: SolverContext): BlockState[] {
  const exact = new Map<string, BlockState>();
  for (const state of states) {
    if (context) checkpoint(context);
    if (context) keepBestBlockState(exact, state, context);
    else keepBestExactBlockState(exact, state, undefined);
  }
  const byMediumLarge = new Map<string, BlockState[]>();
  for (const state of exact.values()) {
    if (context) checkpoint(context);
    const key = blockStateMediumLargeKey(state);
    const list = byMediumLarge.get(key);
    if (list) list.push(state);
    else byMediumLarge.set(key, [state]);
  }
  const universalSPruned: BlockState[] = [];
  for (const list of byMediumLarge.values()) {
    list.sort((a, b) => a.universalS - b.universalS);
    let bestLowerS: BlockState | undefined;
    for (const state of list) {
      if (context) checkpoint(context);
      const dominatedByLowerS =
        bestLowerS !== undefined
        && qualityAtLeast(bestLowerS.quality, state.quality, context);
      if (!dominatedByLowerS) universalSPruned.push(state);
      if (!bestLowerS || qualityGreater(state.quality, bestLowerS.quality, context)) {
        bestLowerS = state;
      }
    }
  }
  const unique = universalSPruned;
  const result: BlockState[] = [];
  for (let index = 0; index < unique.length; index++) {
    const state = unique[index];
    let dominated = false;
    for (let otherIndex = 0; otherIndex < unique.length; otherIndex++) {
      if (context) checkpoint(context);
      if (otherIndex === index) continue;
      if (context?.options.decisionOnly ? decisionBlockDominates(unique[otherIndex], state, context) : blockDominates(unique[otherIndex], state, context?.options.itemCompareMode)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) result.push(state);
  }
  return result;
}

function buildUniversalDecisionEnvelope(
  prefixStates: BlockState[],
  inventory: CandyInventory,
  maxRawSurplus?: number,
  maxReachedSurplus?: number,
): UniversalDecisionEnvelope {
  const mediumDim = inventory.universal.m + 1;
  const largeDim = inventory.universal.l + 1;
  const impossible = inventory.universal.s + 1;
  const minUniversalS = new Int32Array(mediumDim * largeDim);
  minUniversalS.fill(impossible);

  for (const state of prefixStates) {
    if (maxRawSurplus !== undefined && state.quality.rawSurplus > maxRawSurplus) continue;
    if (maxReachedSurplus !== undefined && state.quality.reachedSurplus > maxReachedSurplus) continue;
    if (state.universalM > inventory.universal.m || state.universalL > inventory.universal.l || state.universalS > inventory.universal.s) continue;
    const index = state.universalM * largeDim + state.universalL;
    if (state.universalS < minUniversalS[index]) minUniversalS[index] = state.universalS;
  }

  for (let medium = 0; medium < mediumDim; medium++) {
    for (let large = 0; large < largeDim; large++) {
      const index = medium * largeDim + large;
      let best = minUniversalS[index];
      if (medium > 0) best = Math.min(best, minUniversalS[(medium - 1) * largeDim + large]);
      if (large > 0) {
        best = Math.min(best, minUniversalS[medium * largeDim + large - 1]);
      }
      minUniversalS[index] = best;
    }
  }

  return { minUniversalS, mediumDim, largeDim, impossible };
}

function canCombineWithUniversalDecisionEnvelope(
  envelope: UniversalDecisionEnvelope,
  boundaryState: BlockState,
  inventory: CandyInventory,
): boolean {
  const remainingS = inventory.universal.s - boundaryState.universalS;
  const remainingM = inventory.universal.m - boundaryState.universalM;
  const remainingL = inventory.universal.l - boundaryState.universalL;
  if (remainingS < 0 || remainingM < 0 || remainingL < 0) return false;
  if (remainingM >= envelope.mediumDim || remainingL >= envelope.largeDim) return false;
  return envelope.minUniversalS[remainingM * envelope.largeDim + remainingL] <= remainingS;
}

function createContext(options: InternalFeasibilitySolverOptions): SolverContext {
  return {
    startedAt: performance.now(),
    options,
    stats: {
      rowOptionCounts: [],
      rowFrontierCounts: [],
      typeBlockFrontierCounts: [],
      globalKeyCount: 0,
      transitions: 0,
      witnessRestoreMs: 0,
      durationMs: 0,
      elapsedMs: 0,
    },
  };
}

function checkpoint(context: SolverContext): void {
  const { abortAfterTransitions, deadlineMs, deadlineAt } = context.options;
  if (abortAfterTransitions !== undefined && context.stats.transitions >= abortAfterTransitions) {
    throw new FeasibilityAbort('transition_budget_exceeded');
  }
  // `deadlineMs` は context ごとに測り直されるので、prefix 二分探索のように context を
  // 何度も作る経路では probe ごとに満額使えてしまう。絶対締切は全 context で共有する。
  if (deadlineAt !== undefined && performance.now() >= deadlineAt) {
    throw new FeasibilityAbort('deadline_exceeded');
  }
  if (deadlineMs !== undefined && performance.now() - context.startedAt >= deadlineMs) {
    throw new FeasibilityAbort('deadline_exceeded');
  }
}

function transition(context: SolverContext): void {
  context.stats.transitions++;
  if (context.options.abortAfterTransitions !== undefined || (context.stats.transitions & 0x3ff) === 0) {
    checkpoint(context);
  }
}

function inventoryType(inventory: CandyInventory, type: string): TypeCandyStock {
  return inventory.typeCandy[type] ?? { s: 0, m: 0 };
}

function resourceWithinInventory(state: ResourceState, inventory: CandyInventory): boolean {
  for (const [type, amount] of Object.entries(state.typeS)) if (amount > inventoryType(inventory, type).s) return false;
  for (const [type, amount] of Object.entries(state.typeM)) if (amount > inventoryType(inventory, type).m) return false;
  return state.universalS <= inventory.universal.s
    && state.universalM <= inventory.universal.m
    && state.universalL <= inventory.universal.l;
}

function normalizeNonSpeciesSupply(supply: Supply, targetResidual: number): Supply {
  const normalized = { ...supply };
  for (const key of ['universalS', 'typeS', 'universalM', 'typeM', 'universalL'] as const) {
    while (normalized[key] > 0 && nonSpeciesValue(normalized) - itemValue(key) >= targetResidual) normalized[key]--;
  }
  return normalized;
}

function topDownSpeciesDistribution(rows: FeasibilityDemandRow[], supplies: Supply[], targetSpecies: number): number[] | null {
  const required = supplies.map((supply, index) => Math.max(0, rows[index].totalCandy - nonSpeciesValue(supply)));
  const requiredTotal = required.reduce((sum, value) => sum + value, 0);
  if (requiredTotal > targetSpecies) return null;

  const suffixRequired = new Array(required.length + 1).fill(0) as number[];
  for (let index = required.length - 1; index >= 0; index--) suffixRequired[index] = suffixRequired[index + 1] + required[index];

  const result: number[] = [];
  let remaining = targetSpecies;
  for (let index = 0; index < rows.length; index++) {
    const maxForRow = remaining - suffixRequired[index + 1];
    const species = Math.min(rows[index].totalCandy, maxForRow);
    if (species < required[index] || species < 0) return null;
    result.push(species);
    remaining -= species;
  }
  return remaining === 0 ? result : null;
}

function normalizeSharedGroup(
  rows: PreparedRow[],
  state: SharedResourceState,
  targetSpecies: number,
  context: SolverContext,
): ResourceState | null {
  const entries = pathEntries(state.path).sort((a, b) => a.rowIndex - b.rowIndex);
  if (entries.length !== rows.length) return null;
  let supplies = entries.map(entry => entry.option);

  const seen = new Set<string>();
  while (true) {
    const previousSignature = supplies.map(supplyKey).join(';');
    let normalizedSupplies = supplies.map((supply, index) => normalizeNonSpeciesSupply({ ...supply }, Math.max(0, rows[index].totalCandy - supply.species)));
    const speciesDistribution = topDownSpeciesDistribution(rows, normalizedSupplies, targetSpecies);
    if (!speciesDistribution) return null;
    normalizedSupplies = normalizedSupplies.map((supply, index) => ({ ...supply, species: speciesDistribution[index] }));
    const nextSignature = normalizedSupplies.map(supplyKey).join(';');
    if (nextSignature === previousSignature) {
      supplies = normalizedSupplies;
      break;
    }
    if (seen.has(nextSignature)) return null;
    seen.add(previousSignature);
    supplies = normalizedSupplies;
  }

  const normalizedEntries = entries.map((entry, index) => ({
    rowIndex: entry.rowIndex,
    option: supplies[index],
  }));
  if (context.options.maxRowSurplus !== undefined && normalizedEntries.some((entry, index) => (
    Math.max(0, supplyValue(entry.option) - rows[index].totalCandy) > context.options.maxRowSurplus!
  ))) return null;
  const normalizedPath = pathFromEntries(normalizedEntries);
  const normalized = normalizedEntries.reduce<ResourceState>((acc, entry, index) => ({
    typeS: { ...acc.typeS, [rows[index].type]: (acc.typeS[rows[index].type] ?? 0) + entry.option.typeS },
    typeM: { ...acc.typeM, [rows[index].type]: (acc.typeM[rows[index].type] ?? 0) + entry.option.typeM },
    universalS: acc.universalS + entry.option.universalS,
    universalM: acc.universalM + entry.option.universalM,
    universalL: acc.universalL + entry.option.universalL,
    quality: addQuality(acc.quality, qualityForOption(entry.option, rows[index].totalCandy, rows[index].preferZeroSurplus, rows[index].speciesLexOrder, rows[index].candyDemandMet)),
    path: normalizedPath,
  }), { typeS: {}, typeM: {}, universalS: 0, universalM: 0, universalL: 0, quality: emptyQuality(), path: normalizedPath });
  return withinTotalSurplusBudget(normalized.quality, context) ? normalized : null;
}

function rowOptionsForSpecies(
  row: PreparedRow,
  species: number,
  inventory: CandyInventory,
  context?: SolverContext,
): Supply[] {
  const options = enumerateMinimumCoverOptions(
    Math.max(0, row.totalCandy - species),
    species,
    inventoryType(inventory, row.type),
    inventory.universal,
    context,
  );
  const maxRowSurplus = context?.options.maxRowSurplus;
  const maxTotalSurplus = context?.options.maxTotalSurplus;
  if (maxRowSurplus === undefined && maxTotalSurplus === undefined) return options;
  return options.filter(option => {
    const surplus = Math.max(0, supplyValue(option) - row.totalCandy);
    return (maxRowSurplus === undefined || surplus <= maxRowSurplus)
      && (maxTotalSurplus === undefined || surplus <= maxTotalSurplus);
  });
}

function buildRowFrontierForSpecies(
  rowIndex: number,
  row: PreparedRow,
  species: number,
  inventory: CandyInventory,
  context: SolverContext,
): { frontier: GroupFrontier; optionCount: number } {
  const options = rowOptionsForSpecies(row, species, inventory, context);
  const states: ResourceState[] = [];
  for (const option of options) {
    checkpoint(context);
    const quality = qualityForOption(option, row.totalCandy, row.preferZeroSurplus, row.speciesLexOrder, row.candyDemandMet);
    if (!withinTotalSurplusBudget(quality, context)) continue;
    const state: ResourceState = {
      typeS: option.typeS > 0 ? { [row.type]: option.typeS } : {},
      typeM: option.typeM > 0 ? { [row.type]: option.typeM } : {},
      universalS: option.universalS,
      universalM: option.universalM,
      universalL: option.universalL,
      quality,
      path: { rowIndex, option, previous: null },
    };
    if (resourceWithinInventory(state, inventory)) states.push(state);
  }
  return {
    frontier: pruneResourceStates(states, false, context),
    optionCount: options.length,
  };
}

function buildUniqueGroupFrontier(
  rowIndex: number,
  row: PreparedRow,
  inventory: CandyInventory,
  context: SolverContext,
): GroupFrontier {
  const cacheKey = rowFrontierCacheKey(
    rowIndex,
    row,
    inventory,
    context.options.itemCompareMode,
    context.options.maxRowSurplus,
    context.options.maxTotalSurplus,
    context.options.maxReachedSurplus,
    context.options.decisionOnly,
  );
  const cached = context.options.rowFrontierCache?.get(cacheKey);
  if (cached) {
    context.stats.rowOptionCounts[rowIndex] = cached.optionCount;
    context.stats.rowFrontierCounts[rowIndex] = cached.rowFrontierCount;
    return cached.frontier;
  }
  const species = Math.min(inventory.species[row.candyFamilyKey] ?? 0, row.totalCandy);
  const built = buildRowFrontierForSpecies(rowIndex, row, species, inventory, context);
  context.stats.rowOptionCounts[rowIndex] = built.optionCount;
  context.stats.rowFrontierCounts[rowIndex] = built.frontier.length;
  context.options.rowFrontierCache?.set(cacheKey, {
    frontier: built.frontier,
    optionCount: built.optionCount,
    rowFrontierCount: built.frontier.length,
  });
  return built.frontier;
}

/**
 * A shared family normally needs species-distribution search because a lower
 * row may require species candy while an upper row is covered by indivisible
 * type/universal items. There is one important exact fast path: when every row
 * belongs to this family, the greedy top-down distribution itself can realize
 * zero surplus and its strictly descending lexicographic weights prove that no
 * alternative distribution can improve any earlier quality axis.
 */
function buildCertifiedTopDownSharedGroupFrontier(
  rowIndexes: number[],
  rows: PreparedRow[],
  inventory: CandyInventory,
  context: SolverContext,
  targetSpecies: number,
): GroupFrontier | null {
  const isGlobalCandidate = context.options.sharedSpeciesStrategy === 'topDownCandidate';
  if (!isGlobalCandidate && rowIndexes.length !== rows.length) return null;

  let remainingSpecies = targetSpecies;
  const speciesByRow = rowIndexes.map(rowIndex => {
    const species = Math.min(rows[rowIndex].totalCandy, remainingSpecies);
    remainingSpecies -= species;
    return species;
  });
  if (remainingSpecies !== 0) return null;

  const totalDemand = rowIndexes.reduce((sum, rowIndex) => sum + rows[rowIndex].totalCandy, 0);
  const weights = rowIndexes.map(rowIndex => rows[rowIndex].speciesLexOrder);
  const hasUniqueTopDownLexMaximum = targetSpecies === 0
    || targetSpecies === totalDemand
    || weights.every((weight, index) => index === weights.length - 1 || weight > weights[index + 1]);
  if (!context.options.decisionOnly && !hasUniqueTopDownLexMaximum) return null;

  let states: ResourceState[] = [{
    typeS: {},
    typeM: {},
    universalS: 0,
    universalM: 0,
    universalL: 0,
    quality: emptyQuality(),
    path: null,
  }];
  for (let index = 0; index < rowIndexes.length; index++) {
    const rowIndex = rowIndexes[index];
    const built = buildRowFrontierForSpecies(
      rowIndex,
      rows[rowIndex],
      speciesByRow[index],
      inventory,
      context,
    );
    context.stats.rowOptionCounts[rowIndex] = built.optionCount;
    context.stats.rowFrontierCounts[rowIndex] = built.frontier.length;
    if (built.frontier.length === 0) return null;
    states = combineResourceFrontierWithGroup(states, built.frontier, inventory, context);
    if (states.length === 0) return null;
  }

  // A decision query only asks whether at least one valid allocation exists.
  if (context.options.decisionOnly) return states;

  const expectedSpeciesLex = speciesByRow.reduce(
    (sum, species, index) => sum + species * weights[index],
    0,
  );
  const expectedZeroSurplusCount = rowIndexes.reduce(
    (sum, rowIndex) => sum + (rows[rowIndex].preferZeroSurplus ? 1 : 0),
    0,
  );
  const hasOptimalityCertificate = states.some(state => (
    state.quality.rawSurplus === 0
    && state.quality.reachedSurplus === 0
    && state.quality.zeroSurplusCount === expectedZeroSurplusCount
    && state.quality.speciesLex === expectedSpeciesLex
  ));
  return hasOptimalityCertificate || isGlobalCandidate ? states : null;
}

function buildSharedGroupFrontier(
  rowIndexes: number[],
  rows: PreparedRow[],
  inventory: CandyInventory,
  context: SolverContext,
): GroupFrontier {
  const STREAM_PRUNE_THRESHOLD = 65_536;
  const speciesKey = rows[rowIndexes[0]].candyFamilyKey;
  const targetSpecies = Math.min(
    inventory.species[speciesKey] ?? 0,
    rowIndexes.reduce((sum, rowIndex) => sum + rows[rowIndex].totalCandy, 0),
  );
  const certifiedTopDown = buildCertifiedTopDownSharedGroupFrontier(
    rowIndexes,
    rows,
    inventory,
    context,
    targetSpecies,
  );
  if (certifiedTopDown) return certifiedTopDown;
  if (context.options.sharedSpeciesStrategy === 'topDownCandidate') return [];

  const sharedType = rowIndexes.every(rowIndex => rows[rowIndex].type === rows[rowIndexes[0]].type)
    ? rows[rowIndexes[0]].type
    : null;
  const suffixDemand = new Array(rowIndexes.length + 1).fill(0) as number[];
  for (let index = rowIndexes.length - 1; index >= 0; index--) {
    suffixDemand[index] = suffixDemand[index + 1] + rows[rowIndexes[index]].totalCandy;
  }
  let states: SharedResourceState[] = [{ speciesUsed: 0, typeS: {}, typeM: {}, universalS: 0, universalM: 0, universalL: 0, quality: emptyQuality(), path: null }];

  for (let groupIndex = 0; groupIndex < rowIndexes.length; groupIndex++) {
    const rowIndex = rowIndexes[groupIndex];
    const row = rows[rowIndex];
    const speciesStockForRow = Math.min(targetSpecies, row.totalCandy);
    const optionsBySpecies = Array.from({ length: speciesStockForRow + 1 }, () => [] as Supply[]);
    let optionCount = 0;
    const prefixDemandBeforeRow = suffixDemand[0] - suffixDemand[groupIndex];
    const minSpeciesForAnyPath = Math.max(
      0,
      targetSpecies - prefixDemandBeforeRow - suffixDemand[groupIndex + 1],
    );
    for (let species = minSpeciesForAnyPath; species <= speciesStockForRow; species++) {
      checkpoint(context);
      const options = rowOptionsForSpecies(row, species, inventory, context);
      optionsBySpecies[species] = options;
      optionCount += options.length;
    }
    context.stats.rowOptionCounts[rowIndex] = optionCount;
    let next: SharedResourceState[] = [];
    const previousStates = states;
    const typeStock = inventoryType(inventory, row.type);
    for (const state of previousStates) {
      // Every surviving shared-group witness must consume targetSpecies. A suffix
      // cannot absorb more species candy than its total demand, so exclude only
      // paths that could never satisfy the existing final equality check.
      const minSpeciesAfterRow = Math.max(0, targetSpecies - suffixDemand[groupIndex + 1]);
      const minSpeciesForRow = Math.max(0, minSpeciesAfterRow - state.speciesUsed);
      const maxSpeciesForRow = Math.min(speciesStockForRow, targetSpecies - state.speciesUsed);
      for (let species = minSpeciesForRow; species <= maxSpeciesForRow; species++) {
        for (const option of optionsBySpecies[species]) {
          transition(context);
          const typeS = (state.typeS[row.type] ?? 0) + option.typeS;
          const typeM = (state.typeM[row.type] ?? 0) + option.typeM;
          const universalS = state.universalS + option.universalS;
          const universalM = state.universalM + option.universalM;
          const universalL = state.universalL + option.universalL;
          if (typeS > typeStock.s
            || typeM > typeStock.m
            || universalS > inventory.universal.s
            || universalM > inventory.universal.m
            || universalL > inventory.universal.l) continue;
          const quality = addQuality(state.quality, qualityForOption(option, row.totalCandy, row.preferZeroSurplus, row.speciesLexOrder, row.candyDemandMet));
          if (!withinTotalSurplusBudget(quality, context)) continue;
          const candidate: SharedResourceState = {
            speciesUsed: state.speciesUsed + option.species,
            typeS: sharedType === null ? { ...state.typeS, [row.type]: typeS } : { [sharedType]: typeS },
            typeM: sharedType === null ? { ...state.typeM, [row.type]: typeM } : { [sharedType]: typeM },
            universalS,
            universalM,
            universalL,
            quality,
            path: { rowIndex, option, previous: state.path },
          };
          next.push(candidate);
          // Pareto dominance is monotone: a state dominated within a partial
          // stream cannot become necessary when more candidates are appended.
          // Compact large shared-species products while generating them instead
          // of retaining the complete Cartesian product until the row ends.
          if (next.length >= STREAM_PRUNE_THRESHOLD) {
            next = pruneResourceStates(next, true, context);
          }
        }
      }
    }
    states = pruneResourceStates(next, true, context);
    context.stats.rowFrontierCounts[rowIndex] = states.length;
  }

  const normalized: ResourceState[] = [];
  for (const state of states) {
    if (state.speciesUsed !== targetSpecies) continue;
    const normalizedState = normalizeSharedGroup(rowIndexes.map(index => rows[index]), state, targetSpecies, context);
    if (normalizedState && withinTotalSurplusBudget(normalizedState.quality, context)) normalized.push(normalizedState);
  }
  return pruneResourceStates(normalized, false, context);
}

type ExactJoinEntry = {
  state: ResourceState;
  order: number;
};

type ExactJoinClass = {
  entries: ExactJoinEntry[];
  byUniversalM: Map<number, ExactJoinEntry>;
  minUniversalM: number;
  maxUniversalM: number;
  step: number | null;
  rangeMinimum: ExactJoinEntry[][];
};

type ExactJoinBucket = {
  typeS: number;
  typeM: number;
  universalL: number;
  classes: ExactJoinClass[];
};

/**
 * Groups states that become indistinguishable after joining by total universal M.
 * Universal S is then fixed by the configured S/M value invariant (currently 3S + 20M),
 * and every M-dependent quality component
 * is recoverable from total M. Classes without a complete common-step sequence
 * deliberately fall back to the original Cartesian enumeration.
 */
function exactJoinTranslationKey(state: ResourceState): string {
  const quality = state.quality;
  const smallValue = CANDY_VALUES.universal.s;
  const mediumValue = CANDY_VALUES.universal.m;
  // 同値判定はスコアではなく使用個数で行う。スコアだけを見ると、
  // 同点だが個数の違う状態を同じクラスへ畳んでしまう。
  const used = itemCountsFromPriority(quality.priority);
  return JSON.stringify([
    state.universalS * smallValue + state.universalM * mediumValue,
    quality.zeroSurplusCount,
    quality.normalizedSurplus,
    quality.maxSurplus,
    quality.rawSurplus,
    quality.reachedSurplus,
    quality.totalCandy,
    quality.speciesLex,
    used.typeS,
    used.typeM,
    used.universalS * smallValue + used.universalM * mediumValue,
    used.universalM - state.universalM,
    used.universalL,
  ]);
}

function buildExactJoinClass(entries: ExactJoinEntry[]): ExactJoinClass {
  entries.sort((a, b) => a.state.universalM - b.state.universalM || a.order - b.order);
  let step: number | null = entries.length > 1
    ? entries[1].state.universalM - entries[0].state.universalM
    : null;
  if (step !== null && (step <= 0 || entries.some((entry, index) => (
    index > 0 && entry.state.universalM - entries[index - 1].state.universalM !== step
  )))) step = null;
  const rangeMinimum: ExactJoinEntry[][] = [entries];
  for (let width = 2; width <= entries.length; width *= 2) {
    const previous = rangeMinimum.at(-1)!;
    const half = width / 2;
    const level: ExactJoinEntry[] = [];
    for (let index = 0; index + width <= entries.length; index++) {
      const left = previous[index];
      const right = previous[index + half];
      level.push(left.order <= right.order ? left : right);
    }
    rangeMinimum.push(level);
  }
  return {
    entries,
    byUniversalM: new Map(entries.map(entry => [entry.state.universalM, entry])),
    minUniversalM: entries[0].state.universalM,
    maxUniversalM: entries.at(-1)!.state.universalM,
    step,
    rangeMinimum,
  };
}

function exactJoinBuckets(
  frontier: ResourceState[],
  type: string,
  optionTraversalOrder: boolean,
): ExactJoinBucket[] {
  const buckets = new Map<string, { typeS: number; typeM: number; universalL: number; entries: ExactJoinEntry[] }>();
  for (let index = 0; index < frontier.length; index++) {
    const state = frontier[index];
    const typeS = state.typeS[type] ?? 0;
    const typeM = state.typeM[type] ?? 0;
    const key = `${typeS}|${typeM}|${state.universalL}`;
    const bucket = buckets.get(key);
    const entry = { state, order: index };
    if (bucket) bucket.entries.push(entry);
    else buckets.set(key, { typeS, typeM, universalL: state.universalL, entries: [entry] });
  }
  if (optionTraversalOrder) {
    let order = 0;
    for (const bucket of buckets.values()) {
      bucket.entries.sort((a, b) => a.state.universalM - b.state.universalM || a.order - b.order);
      for (const entry of bucket.entries) entry.order = order++;
    }
  }
  return [...buckets.values()].map(bucket => {
    const classes = new Map<string, ExactJoinEntry[]>();
    for (const entry of bucket.entries) {
      const key = exactJoinTranslationKey(entry.state);
      const group = classes.get(key);
      if (group) group.push(entry);
      else classes.set(key, [entry]);
    }
    return {
      typeS: bucket.typeS,
      typeM: bucket.typeM,
      universalL: bucket.universalL,
      classes: [...classes.values()].map(buildExactJoinClass),
    };
  });
}

function rangeMinimumOrder(joinClass: ExactJoinClass, lower: number, upper: number): ExactJoinEntry | null {
  if (joinClass.step === null) return null;
  const lowerIndex = Math.max(0, Math.ceil((lower - joinClass.minUniversalM) / joinClass.step));
  const upperIndex = Math.min(joinClass.entries.length - 1, Math.floor((upper - joinClass.minUniversalM) / joinClass.step));
  if (lowerIndex > upperIndex) return null;
  const length = upperIndex - lowerIndex + 1;
  const level = Math.floor(Math.log2(length));
  const width = 2 ** level;
  const left = joinClass.rangeMinimum[level][lowerIndex];
  const right = joinClass.rangeMinimum[level][upperIndex - width + 1];
  return left.order <= right.order ? left : right;
}

function forEachExactJoinRepresentative(
  left: ExactJoinClass,
  right: ExactJoinClass,
  visit: (left: ExactJoinEntry, right: ExactJoinEntry) => void,
): void {
  if (left.entries.length === 1) {
    for (const rightEntry of right.entries) visit(left.entries[0], rightEntry);
    return;
  }
  if (right.entries.length === 1) {
    for (const leftEntry of left.entries) visit(leftEntry, right.entries[0]);
    return;
  }
  if (left.step !== null && left.step === right.step) {
    const step = left.step;
    for (let total = left.minUniversalM + right.minUniversalM; total <= left.maxUniversalM + right.maxUniversalM; total += step) {
      const lower = Math.max(left.minUniversalM, total - right.maxUniversalM);
      const upper = Math.min(left.maxUniversalM, total - right.minUniversalM);
      const leftEntry = rangeMinimumOrder(left, lower, upper);
      if (!leftEntry) continue;
      const rightEntry = right.byUniversalM.get(total - leftEntry.state.universalM);
      if (rightEntry) visit(leftEntry, rightEntry);
    }
    return;
  }
  for (const leftEntry of left.entries) {
    for (const rightEntry of right.entries) visit(leftEntry, rightEntry);
  }
}

function combineLargeSingleTypeFrontiers(
  states: ResourceState[],
  groupFrontier: GroupFrontier,
  type: string,
  inventory: CandyInventory,
  context: SolverContext,
): ResourceState[] {
  const stateBuckets = exactJoinBuckets(states, type, false);
  const optionBuckets = exactJoinBuckets(groupFrontier, type, true);
  const stock = inventoryType(inventory, type);
  const exact = new Map<string, { state: ResourceState; stateOrder: number; optionOrder: number }>();

  for (const stateBucket of stateBuckets) {
    checkpoint(context);
    for (const optionBucket of optionBuckets) {
      const typeS = stateBucket.typeS + optionBucket.typeS;
      const typeM = stateBucket.typeM + optionBucket.typeM;
      const universalL = stateBucket.universalL + optionBucket.universalL;
      if (typeS > stock.s || typeM > stock.m || universalL > inventory.universal.l) continue;
      for (const stateClass of stateBucket.classes) {
        for (const optionClass of optionBucket.classes) {
          forEachExactJoinRepresentative(stateClass, optionClass, (stateEntry, optionEntry) => {
            const universalS = stateEntry.state.universalS + optionEntry.state.universalS;
            const universalM = stateEntry.state.universalM + optionEntry.state.universalM;
            if (universalS > inventory.universal.s || universalM > inventory.universal.m) return;
            transition(context);
            const key = `${typeS}|${typeM}|${universalS}|${universalM}|${universalL}`;
            const previous = exact.get(key);
            const quality = addQuality(stateEntry.state.quality, optionEntry.state.quality);
            if (!withinTotalSurplusBudget(quality, context)) return;
            if (previous) {
              const comparison = compareQuality(quality, previous.state.quality, context.options.itemCompareMode);
              const earlier = stateEntry.order < previous.stateOrder
                || (stateEntry.order === previous.stateOrder && optionEntry.order < previous.optionOrder);
              if (comparison < 0 || (comparison === 0 && !earlier)) return;
            }
            exact.set(key, {
              state: {
                typeS: typeS > 0 ? { [type]: typeS } : {},
                typeM: typeM > 0 ? { [type]: typeM } : {},
                universalS,
                universalM,
                universalL,
                quality,
                path: appendPath(stateEntry.state.path, optionEntry.state.path),
              },
              stateOrder: stateEntry.order,
              optionOrder: optionEntry.order,
            });
          });
        }
      }
    }
  }
  return pruneResourceStates([...exact.values()].map(entry => entry.state), false, context);
}

function combineResourceFrontierWithGroup(
  states: ResourceState[],
  groupFrontier: GroupFrontier,
  inventory: CandyInventory,
  context: SolverContext,
): ResourceState[] {
  const stateType = singleTypeKey(states);
  const optionType = singleTypeKey(groupFrontier);
  const fastType = stateType !== null && optionType !== null && (stateType === '' || optionType === '' || stateType === optionType)
    ? (stateType === '' ? optionType : stateType)
    : null;
  if (fastType !== null && !context.options.decisionOnly && states.length * groupFrontier.length >= 100_000) {
    return combineLargeSingleTypeFrontiers(states, groupFrontier, fastType, inventory, context);
  }
  const next: ResourceState[] = fastType === null
    ? []
    : [];
  const nextByKey = fastType === null ? null : new Map<string | number, ResourceState>();
  const stock = fastType === null ? null : inventoryType(inventory, fastType);
  const numericKeyAvailable = Boolean(stock)
    && [stock?.s, stock?.m, inventory.universal.s, inventory.universal.m, inventory.universal.l].every(value => Number.isFinite(value));
  const typeMDim = numericKeyAvailable && stock ? stock.m + 1 : 0;
  const universalSDim = numericKeyAvailable ? inventory.universal.s + 1 : 0;
  const universalMDim = numericKeyAvailable ? inventory.universal.m + 1 : 0;
  const universalLDim = numericKeyAvailable ? inventory.universal.l + 1 : 0;
  const fastOptionCount = fastType === null ? 0 : groupFrontier.length;
  const fastOptionTypeS = fastType === null ? null : new Int32Array(fastOptionCount);
  const fastOptionTypeM = fastType === null ? null : new Int32Array(fastOptionCount);
  const fastOptionUniversalS = fastType === null ? null : new Int32Array(fastOptionCount);
  const fastOptionUniversalM = fastType === null ? null : new Int32Array(fastOptionCount);
  const fastOptionUniversalL = fastType === null ? null : new Int32Array(fastOptionCount);
  const fastOptionQualities: RepresentativeQuality[] = [];
  const fastOptionPaths: Array<PathNode | null> = [];
  const fastOptionBucketMap = new Map<string, {
    typeS: number;
    typeM: number;
    universalL: number;
    optionIndexes: number[];
  }>();
  if (fastType !== null && fastOptionTypeS && fastOptionTypeM && fastOptionUniversalS && fastOptionUniversalM && fastOptionUniversalL) {
    for (let index = 0; index < groupFrontier.length; index++) {
      const option = groupFrontier[index];
      fastOptionTypeS[index] = option.typeS[fastType] ?? 0;
      fastOptionTypeM[index] = option.typeM[fastType] ?? 0;
      fastOptionUniversalS[index] = option.universalS;
      fastOptionUniversalM[index] = option.universalM;
      fastOptionUniversalL[index] = option.universalL;
      fastOptionQualities[index] = option.quality;
      fastOptionPaths[index] = option.path;
      const bucketKey = `${fastOptionTypeS[index]}|${fastOptionTypeM[index]}|${fastOptionUniversalL[index]}`;
      const bucket = fastOptionBucketMap.get(bucketKey);
      if (bucket) bucket.optionIndexes.push(index);
      else {
        fastOptionBucketMap.set(bucketKey, {
          typeS: fastOptionTypeS[index],
          typeM: fastOptionTypeM[index],
          universalL: fastOptionUniversalL[index],
          optionIndexes: [index],
        });
      }
    }
  }
  const fastOptionBuckets = [...fastOptionBucketMap.values()];
  for (const bucket of fastOptionBuckets) {
    bucket.optionIndexes.sort((a, b) => fastOptionUniversalM![a] - fastOptionUniversalM![b]);
  }
  const decisionResourceOnly = context.options.decisionOnly
    && context.options.maxTotalSurplus === undefined
    && context.options.maxReachedSurplus === undefined;
  const decisionEmptyQuality = decisionResourceOnly ? emptyQuality() : null;
  for (const state of states) {
    if (fastType !== null && stock && fastOptionTypeS && fastOptionTypeM && fastOptionUniversalS && fastOptionUniversalM && fastOptionUniversalL && nextByKey) {
      const stateTypeS = state.typeS[fastType] ?? 0;
      const stateTypeM = state.typeM[fastType] ?? 0;
      const stateUniversalS = state.universalS;
      const stateUniversalM = state.universalM;
      const stateUniversalL = state.universalL;
      const stateQuality = state.quality;
      const statePath = state.path;
      const remainingTypeS = stock.s - stateTypeS;
      const remainingTypeM = stock.m - stateTypeM;
      const remainingUniversalS = inventory.universal.s - stateUniversalS;
      const remainingUniversalM = inventory.universal.m - stateUniversalM;
      const remainingUniversalL = inventory.universal.l - stateUniversalL;
      checkpoint(context);
      for (const bucket of fastOptionBuckets) {
        if (bucket.typeS > remainingTypeS
          || bucket.typeM > remainingTypeM
          || bucket.universalL > remainingUniversalL) continue;
        for (const optionIndex of bucket.optionIndexes) {
          if (fastOptionUniversalM[optionIndex] > remainingUniversalM) break;
          if (fastOptionUniversalS[optionIndex] > remainingUniversalS) continue;
          transition(context);
          const typeS = stateTypeS + bucket.typeS;
          const typeM = stateTypeM + bucket.typeM;
          const universalS = stateUniversalS + fastOptionUniversalS[optionIndex];
          const universalM = stateUniversalM + fastOptionUniversalM[optionIndex];
          const universalL = stateUniversalL + bucket.universalL;
          const key = numericKeyAvailable
            ? ((((typeS * typeMDim + typeM) * universalSDim + universalS) * universalMDim + universalM) * universalLDim + universalL)
            : `${typeS}|${typeM}|${universalS}|${universalM}|${universalL}`;
          const previous = nextByKey.get(key);
          if (previous && context.options.decisionOnly) continue;
          const quality = decisionEmptyQuality
            ?? addQuality(stateQuality, fastOptionQualities[optionIndex]);
          if (!withinTotalSurplusBudget(quality, context)) continue;
          if (previous && compareQuality(quality, previous.quality, context.options.itemCompareMode) <= 0) continue;
          nextByKey.set(key, {
            typeS: typeS > 0 ? { [fastType]: typeS } : {},
            typeM: typeM > 0 ? { [fastType]: typeM } : {},
            universalS,
            universalM,
            universalL,
            quality,
            path: decisionResourceOnly ? null : appendPath(statePath, fastOptionPaths[optionIndex]),
          });
        }
      }
      continue;
    }
    for (const option of groupFrontier) {
      transition(context);
      const candidate = addResourceState(state, option, appendPath(state.path, option.path));
      if (!withinTotalSurplusBudget(candidate.quality, context)) continue;
      if (!resourceWithinInventory(candidate, inventory)) continue;
      next.push(candidate);
    }
  }
  const merged = nextByKey ? [...nextByKey.values()] : next;
  return pruneResourceStates(merged, false, context);
}

function projectTypeBlockFrontier(states: ResourceState[], context: SolverContext): BlockState[] {
  const projected = new Map<string, BlockState>();
  for (const state of states) {
    checkpoint(context);
    const key = `${state.universalS}|${state.universalM}|${state.universalL}`;
    const candidate: BlockState = {
      universalS: state.universalS,
      universalM: state.universalM,
      universalL: state.universalL,
      quality: state.quality,
      path: state.path,
    };
    const previous = projected.get(key);
    if (!previous || qualityGreater(candidate.quality, previous.quality, context)) {
      projected.set(key, candidate);
    }
  }
  return pruneBlockStates([...projected.values()], context);
}

function buildTypeBlockResourceStates(
  rowIndexes: number[],
  rows: PreparedRow[],
  inventory: CandyInventory,
  context: SolverContext,
): ResourceState[] {
  const groups: number[][] = [];
  const groupBySpecies = new Map<string, number[]>();
  for (const rowIndex of rowIndexes) {
    const key = rows[rowIndex].candyFamilyKey;
    const group = groupBySpecies.get(key);
    if (group) group.push(rowIndex);
    else {
      const created = [rowIndex];
      groupBySpecies.set(key, created);
      groups.push(created);
    }
  }

  const groupFrontiers = groups.map((group, originalIndex) => ({
    originalIndex,
    frontier: group.length === 1
      ? buildUniqueGroupFrontier(group[0], rows[group[0]], inventory, context)
      : buildSharedGroupFrontier(group, rows, inventory, context),
  })).sort((a, b) => (a.frontier.length - b.frontier.length) || (a.originalIndex - b.originalIndex));

  let states: ResourceState[] = [{ typeS: {}, typeM: {}, universalS: 0, universalM: 0, universalL: 0, quality: emptyQuality(), path: null }];
  for (const group of groupFrontiers) {
    states = combineResourceFrontierWithGroup(states, group.frontier, inventory, context);
  }
  return states;
}

function buildTypeBlockFrontier(
  rowIndexes: number[],
  rows: PreparedRow[],
  inventory: CandyInventory,
  context: SolverContext,
  cacheKey = typeBlockFrontierCacheKey(rowIndexes, rows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly),
): BlockState[] {
  const cached = context.options.frontierCache?.get(cacheKey);
  if (cached) {
    for (const [rowIndex, count] of cached.rowOptionCounts) context.stats.rowOptionCounts[rowIndex] = count;
    for (const [rowIndex, count] of cached.rowFrontierCounts) context.stats.rowFrontierCounts[rowIndex] = count;
    context.stats.typeBlockFrontierCounts.push(cached.typeBlockFrontierCount);
    return cached.frontier;
  }

  const states = buildTypeBlockResourceStates(rowIndexes, rows, inventory, context);
  const frontier = projectTypeBlockFrontier(states, context);
  context.stats.typeBlockFrontierCounts.push(frontier.length);
  context.options.frontierCache?.set(cacheKey, {
    frontier,
    rowOptionCounts: rowIndexes
      .filter(rowIndex => context.stats.rowOptionCounts[rowIndex] !== undefined)
      .map(rowIndex => [rowIndex, context.stats.rowOptionCounts[rowIndex]]),
    rowFrontierCounts: rowIndexes
      .filter(rowIndex => context.stats.rowFrontierCounts[rowIndex] !== undefined)
      .map(rowIndex => [rowIndex, context.stats.rowFrontierCounts[rowIndex]]),
    typeBlockFrontierCount: frontier.length,
  });
  return frontier;
}

function globalPrefixCacheKey(blockKeys: string[]): string {
  return blockKeys.join('\u001f');
}

function demandRowCacheKey(row: PreparedRow): string {
  return [
    row.pokemonId,
    row.pokedexId,
    row.candyFamilyKey,
    row.type,
    row.totalCandy,
    row.boostCandy,
    row.normalCandy,
    row.shards,
    row.reachedLv,
    row.expInLevel,
    row.candyDemandMet ? 1 : 0,
    row.preferZeroSurplus ? 1 : 0,
    row.speciesLexOrder,
  ].join(':');
}

function rowFrontierCacheKey(
  rowIndex: number,
  row: PreparedRow,
  inventory: CandyInventory,
  mode?: SolverItemCompareMode,
  maxRowSurplus?: number,
  maxTotalSurplus?: number,
  maxReachedSurplus?: number,
  decisionOnly?: boolean,
): string {
  return JSON.stringify({
    rowIndex,
    row: demandRowCacheKey(row),
    mode: mode ?? '',
    maxRowSurplus: maxRowSurplus ?? '',
    maxTotalSurplus: maxTotalSurplus ?? '',
    maxReachedSurplus: maxReachedSurplus ?? '',
    decisionOnly: decisionOnly ? 1 : 0,
    species: inventory.species[row.candyFamilyKey] ?? 0,
    type: inventoryType(inventory, row.type),
    universal: inventory.universal,
  });
}

function typeBlockFrontierCacheKey(
  rowIndexes: number[],
  rows: PreparedRow[],
  inventory: CandyInventory,
  mode?: SolverItemCompareMode,
  maxRowSurplus?: number,
  maxTotalSurplus?: number,
  maxReachedSurplus?: number,
  decisionOnly?: boolean,
): string {
  const typeKeys = [...new Set(rowIndexes.map(index => rows[index].type))].sort();
  const speciesKeys = [...new Set(rowIndexes.map(index => rows[index].candyFamilyKey))].sort();
  return JSON.stringify({
    mode: mode ?? '',
    maxRowSurplus: maxRowSurplus ?? '',
    maxTotalSurplus: maxTotalSurplus ?? '',
    maxReachedSurplus: maxReachedSurplus ?? '',
    decisionOnly: decisionOnly ? 1 : 0,
    rows: rowIndexes.map(index => [index, demandRowCacheKey(rows[index])]),
    species: speciesKeys.map(key => [key, inventory.species[key] ?? 0]),
    types: typeKeys.map(type => [type, inventoryType(inventory, type)]),
    universal: inventory.universal,
  });
}

/** 共有種族で接続されたタイプを同一ブロックに閉じ込める。 */
function buildTypeBlockComponents(rows: PreparedRow[]): number[][] {
  const parent = new Map<string, string>();
  const find = (type: string): string => {
    const current = parent.get(type);
    if (!current || current === type) {
      parent.set(type, type);
      return type;
    }
    const root = find(current);
    parent.set(type, root);
    return root;
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  const speciesTypes = new Map<string, string[]>();
  rows.forEach(row => {
    find(row.type);
    const types = speciesTypes.get(row.candyFamilyKey);
    if (types) types.push(row.type);
    else speciesTypes.set(row.candyFamilyKey, [row.type]);
  });
  for (const types of speciesTypes.values()) for (let index = 1; index < types.length; index++) union(types[0], types[index]);

  const components = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const root = find(row.type);
    const component = components.get(root);
    if (component) component.push(index);
    else components.set(root, [index]);
  });
  return [...components.values()].sort((a, b) => a[0] - b[0]);
}

function relaxationInfeasible(rows: FeasibilityDemandRow[], inventory: CandyInventory): string | null {
  const residualByType: Record<string, number> = {};
  const speciesRows = new Map<string, FeasibilityDemandRow[]>();
  for (const row of rows) {
    const key = row.candyFamilyKey;
    const group = speciesRows.get(key);
    if (group) group.push(row);
    else speciesRows.set(key, [row]);
  }
  for (const [speciesKey, group] of speciesRows) {
    const total = group.reduce((sum, row) => sum + row.totalCandy, 0);
    const residual = total - Math.min(inventory.species[speciesKey] ?? 0, total);
    const types = new Set(group.map(row => row.type));
    if (types.size > 1) continue;
    const type = group[0].type;
    residualByType[type] = (residualByType[type] ?? 0) + residual;
  }

  let deficit = 0;
  for (const [type, residual] of Object.entries(residualByType)) {
    const stock = inventoryType(inventory, type);
    const typeValue = stock.s * CANDY_VALUES.type.s + stock.m * CANDY_VALUES.type.m;
    deficit += Math.max(0, residual - typeValue);
  }
  const universalValue = inventory.universal.s * CANDY_VALUES.universal.s
    + inventory.universal.m * CANDY_VALUES.universal.m
    + inventory.universal.l * CANDY_VALUES.universal.l;
  return deficit > universalValue ? 'relaxation_insufficient_type_or_universal_value' : null;
}

function validateDemandRows(
  rows: FeasibilityDemandRow[],
  options: FeasibilitySolverOptions,
): string | null {
  let seenUnreached = false;
  let boostUsed = 0;
  let shardsUsed = 0;
  for (const row of rows) {
    if (!isCandyFamilyKey(row.candyFamilyKey)) return `invalid_candy_family_key:${row.pokemonId}`;
    const values = [row.totalCandy, row.boostCandy, row.normalCandy, row.shards, row.reachedLv, row.expInLevel];
    if (!values.every(isNonNegativeInteger)) return `invalid_row_values:${row.pokemonId}`;
    if (row.boostCandy + row.normalCandy !== row.totalCandy) return `candy_split_mismatch:${row.pokemonId}`;
    if (seenUnreached && row.candyDemandMet) return 'prefix_violation';
    if (!row.candyDemandMet) seenUnreached = true;
    boostUsed += row.boostCandy;
    shardsUsed += row.shards;
  }
  const boostKind = options.boostKind ?? 'none';
  if (boostKind === 'none' && boostUsed > 0) return 'boost_used_with_none';
  if (options.boostLimit !== undefined && boostUsed > options.boostLimit) return 'boost_limit_exceeded';
  if (options.dreamShards !== undefined && shardsUsed > options.dreamShards) return 'dream_shards_exceeded';
  return null;
}

/** Cheap necessary-condition check. A true result proves fixed rows infeasible; false is inconclusive. */
export function fixedRowsFailFeasibilityRelaxation(
  rows: FeasibilityDemandRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): boolean {
  return validateDemandRows(rows, options) !== null || relaxationInfeasible(rows, inventory) !== null;
}

function expectedRemaining(
  rows: FeasiblePlanRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions,
): FeasibleResourceState {
  const speciesUsed: Record<string, number> = {};
  const typeUsed: Record<string, TypeCandyStock> = {};
  let boostCandy = 0;
  let dreamShards = 0;
  let universalS = 0;
  let universalM = 0;
  let universalL = 0;
  for (const row of rows) {
    const speciesKey = row.candyFamilyKey;
    speciesUsed[speciesKey] = (speciesUsed[speciesKey] ?? 0) + row.supply.species;
    const type = typeUsed[row.type] ?? { s: 0, m: 0 };
    type.s += row.supply.typeS;
    type.m += row.supply.typeM;
    typeUsed[row.type] = type;
    universalS += row.supply.universalS;
    universalM += row.supply.universalM;
    universalL += row.supply.universalL;
    boostCandy += row.boostCandy;
    dreamShards += row.shards;
  }
  const species: Record<string, number> = {};
  for (const [key, amount] of Object.entries(inventory.species)) species[key] = amount - (speciesUsed[key] ?? 0);
  for (const key of Object.keys(speciesUsed)) if (!(key in species)) species[key] = -(speciesUsed[key] ?? 0);
  const typeCandy: Record<string, TypeCandyStock> = {};
  for (const [key, stock] of Object.entries(inventory.typeCandy)) {
    const used = typeUsed[key] ?? { s: 0, m: 0 };
    typeCandy[key] = { s: stock.s - used.s, m: stock.m - used.m };
  }
  for (const key of Object.keys(typeUsed)) if (!(key in typeCandy)) typeCandy[key] = { s: -typeUsed[key].s, m: -typeUsed[key].m };
  return {
    species,
    typeCandy,
    universal: {
      s: inventory.universal.s - universalS,
      m: inventory.universal.m - universalM,
      l: inventory.universal.l - universalL,
    },
    boostCandy: (options.boostLimit ?? Infinity) - boostCandy,
    dreamShards: (options.dreamShards ?? Infinity) - dreamShards,
  };
}

function expectedBoundary(rows: FeasibilityDemandRow[]): { reachedCount: number; boundaryIndex: number | null; boundaryLevel: number; boundaryExpInLevel: number } {
  const boundaryIndex = rows.findIndex(row => !row.candyDemandMet);
  return {
    reachedCount: boundaryIndex === -1 ? rows.length : boundaryIndex,
    boundaryIndex: boundaryIndex === -1 ? null : boundaryIndex,
    boundaryLevel: boundaryIndex === -1 ? 0 : rows[boundaryIndex].reachedLv,
    boundaryExpInLevel: boundaryIndex === -1 ? 0 : rows[boundaryIndex].expInLevel,
  };
}

function finish(context: SolverContext, payload: Omit<Extract<FeasibilityResult, { status: 'feasible' }>, 'stats'> | Omit<Extract<FeasibilityResult, { status: 'infeasible' }>, 'stats'> | Omit<Extract<FeasibilityResult, { status: 'inconclusive' }>, 'stats'>): FeasibilityResult {
  context.stats.elapsedMs = performance.now() - context.startedAt;
  context.stats.durationMs = context.stats.elapsedMs;
  if (context.options.logPerformance) {
    console.info('[perf] levelPlanner.feasibilityWitness', {
      rowOptionCounts: context.stats.rowOptionCounts,
      rowFrontierCounts: context.stats.rowFrontierCounts,
      typeBlockFrontierCounts: context.stats.typeBlockFrontierCounts,
      globalKeyCount: context.stats.globalKeyCount,
      transitions: context.stats.transitions,
      witnessRestoreMs: context.stats.witnessRestoreMs,
      durationMs: context.stats.durationMs,
      elapsedMs: context.stats.elapsedMs,
    });
  }
  return { ...payload, stats: { ...context.stats, rowOptionCounts: [...context.stats.rowOptionCounts], rowFrontierCounts: [...context.stats.rowFrontierCounts], typeBlockFrontierCounts: [...context.stats.typeBlockFrontierCounts] } } as FeasibilityResult;
}

function finishDecision(context: SolverContext, payload: FeasibilityDecisionPayload): FeasibilityDecisionResult {
  context.stats.elapsedMs = performance.now() - context.startedAt;
  context.stats.durationMs = context.stats.elapsedMs;
  return {
    ...payload,
    stats: {
      ...context.stats,
      rowOptionCounts: [...context.stats.rowOptionCounts],
      rowFrontierCounts: [...context.stats.rowFrontierCounts],
      typeBlockFrontierCounts: [...context.stats.typeBlockFrontierCounts],
    },
  } as FeasibilityDecisionResult;
}

function fallbackResult(
  context: SolverContext,
  reason: string,
  rows?: FeasibilityDemandRow[],
  inventory?: CandyInventory,
): FeasibilityResult {
  const fallback = context.options.fallbackWitness;
  const validFallback = fallback && rows && inventory
    ? validateFeasibilityWitness(fallback, rows, inventory, context.options).valid
    : Boolean(fallback);
  return finish(context, fallback
    && validFallback
    ? { status: 'inconclusive', reason, witness: fallback }
    : { status: 'inconclusive', reason });
}

function validateSupplyAndInventory(
  rows: FeasiblePlanRow[],
  inventory: CandyInventory,
): string | null {
  const speciesUsed: Record<string, number> = {};
  const typeSUsed: Record<string, number> = {};
  const typeMUsed: Record<string, number> = {};
  let universalS = 0;
  let universalM = 0;
  let universalL = 0;
  for (const row of rows) {
    if (!Object.values(row.supply).every(isNonNegativeInteger)) return `invalid_supply_values:${row.pokemonId}`;
    if (supplyValue(row.supply) < row.totalCandy) return `row_supply_short:${row.pokemonId}`;
    const key = row.candyFamilyKey;
    speciesUsed[key] = (speciesUsed[key] ?? 0) + row.supply.species;
    typeSUsed[row.type] = (typeSUsed[row.type] ?? 0) + row.supply.typeS;
    typeMUsed[row.type] = (typeMUsed[row.type] ?? 0) + row.supply.typeM;
    universalS += row.supply.universalS;
    universalM += row.supply.universalM;
    universalL += row.supply.universalL;
  }
  for (const [key, amount] of Object.entries(speciesUsed)) if (amount > (inventory.species[key] ?? 0)) return `species_stock_exceeded:${key}`;
  for (const [type, amount] of Object.entries(typeSUsed)) if (amount > inventoryType(inventory, type).s) return `type_s_stock_exceeded:${type}`;
  for (const [type, amount] of Object.entries(typeMUsed)) if (amount > inventoryType(inventory, type).m) return `type_m_stock_exceeded:${type}`;
  if (universalS > inventory.universal.s) return 'universal_s_stock_exceeded';
  if (universalM > inventory.universal.m) return 'universal_m_stock_exceeded';
  if (universalL > inventory.universal.l) return 'universal_l_stock_exceeded';
  return null;
}

function validateSpeciesNormalForm(rows: FeasiblePlanRow[], inventory: CandyInventory): string[] {
  const errors: string[] = [];
  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const key = row.candyFamilyKey;
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  });
  for (const [key, indexes] of groups) {
    const target = Math.min(inventory.species[key] ?? 0, indexes.reduce((sum, index) => sum + rows[index].totalCandy, 0));
    const used = indexes.reduce((sum, index) => sum + rows[index].supply.species, 0);
    if (used !== target) {
      errors.push(`species_total_not_max:${key}`);
      continue;
    }
    const groupRows = indexes.map(index => rows[index]);
    const groupSupplies = indexes.map(index => rows[index].supply);
    const canonical = topDownSpeciesDistribution(groupRows, groupSupplies, target);
    if (!canonical) {
      errors.push(`species_distribution_not_feasible:${key}`);
      continue;
    }
    indexes.forEach((index, position) => {
      if (rows[index].supply.species !== canonical[position]) errors.push(`species_distribution_not_top_down:${key}`);
    });
  }
  return errors;
}

function compareRemaining(a: FeasibleResourceState, b: FeasibleResourceState): string[] {
  const errors: string[] = [];
  const speciesKeys = new Set([...Object.keys(a.species), ...Object.keys(b.species)]);
  for (const key of speciesKeys) if (a.species[key] !== b.species[key]) errors.push(`remaining_species_mismatch:${key}`);
  const typeKeys = new Set([...Object.keys(a.typeCandy), ...Object.keys(b.typeCandy)]);
  for (const key of typeKeys) {
    if (a.typeCandy[key]?.s !== b.typeCandy[key]?.s) errors.push(`remaining_type_s_mismatch:${key}`);
    if (a.typeCandy[key]?.m !== b.typeCandy[key]?.m) errors.push(`remaining_type_m_mismatch:${key}`);
  }
  if (a.universal.s !== b.universal.s) errors.push('remaining_universal_s_mismatch');
  if (a.universal.m !== b.universal.m) errors.push('remaining_universal_m_mismatch');
  if (a.universal.l !== b.universal.l) errors.push('remaining_universal_l_mismatch');
  if (a.boostCandy !== b.boostCandy) errors.push('remaining_boost_mismatch');
  if (a.dreamShards !== b.dreamShards) errors.push('remaining_shards_mismatch');
  return errors;
}

function validateFeasibilityWitnessInternal(
  witness: FeasibilityWitness,
  demandRows: FeasibilityDemandRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
  requireMinimumCover = true,
  requireSpeciesNormalForm = true,
): FeasibilityValidationResult {
  const errors: string[] = [];
  if (witness.rows.length !== demandRows.length) errors.push('row_count_mismatch');
  const rowCount = Math.min(witness.rows.length, demandRows.length);
  let totalSurplus = 0;
  let reachedSurplus = 0;
  for (let index = 0; index < rowCount; index++) {
    const expected = demandRows[index];
    const actual = witness.rows[index];
    for (const key of ['pokemonId', 'pokedexId', 'candyFamilyKey', 'type', 'totalCandy', 'boostCandy', 'normalCandy', 'shards', 'reachedLv', 'expInLevel', 'candyDemandMet'] as const) {
      if (actual[key] !== expected[key]) errors.push(`row_field_mismatch:${index}:${key}`);
    }
    if (validateSupplyAndInventory([actual], {
      species: inventory.species,
      typeCandy: { [actual.type]: inventoryType(inventory, actual.type) },
      universal: inventory.universal,
    })) errors.push(`invalid_row_supply:${index}`);
    if (requireMinimumCover) {
      const residual = Math.max(0, actual.totalCandy - actual.supply.species);
      if (!isMinimumCover({ ...actual.supply, species: 0 }, residual)) errors.push(`row_option_not_minimum_cover:${index}`);
    }
    const rowSurplus = Math.max(0, supplyValue(actual.supply) - actual.totalCandy);
    totalSurplus += rowSurplus;
    if (actual.candyDemandMet) reachedSurplus += rowSurplus;
    if (options.maxRowSurplus !== undefined && rowSurplus > options.maxRowSurplus) {
      errors.push(`max_row_surplus_exceeded:${index}`);
    }
  }
  if (options.maxTotalSurplus !== undefined && totalSurplus > options.maxTotalSurplus) errors.push('max_total_surplus_exceeded');
  if (options.maxReachedSurplus !== undefined && reachedSurplus > options.maxReachedSurplus) errors.push('max_reached_surplus_exceeded');

  const demandError = validateDemandRows(demandRows, options);
  if (demandError) errors.push(demandError);
  const supplyError = validateSupplyAndInventory(witness.rows, inventory);
  if (supplyError) errors.push(supplyError);
  if (requireSpeciesNormalForm) errors.push(...validateSpeciesNormalForm(witness.rows, inventory));

  const boundary = expectedBoundary(demandRows);
  if (witness.reachedCount !== boundary.reachedCount) errors.push('reached_count_mismatch');
  if (witness.boundaryIndex !== boundary.boundaryIndex) errors.push('boundary_index_mismatch');
  if (witness.boundaryLevel !== boundary.boundaryLevel) errors.push('boundary_level_mismatch');
  if (witness.boundaryExpInLevel !== boundary.boundaryExpInLevel) errors.push('boundary_exp_mismatch');

  const expected = expectedRemaining(witness.rows, inventory, options);
  errors.push(...compareRemaining(witness.remaining, expected));
  return errors.length === 0 ? { valid: true } : { valid: false, errors: [...new Set(errors)] };
}

export function validateFeasibilityWitness(
  witness: FeasibilityWitness,
  demandRows: FeasibilityDemandRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): FeasibilityValidationResult {
  return validateFeasibilityWitnessInternal(witness, demandRows, inventory, options, true);
}

function hasSharedCandyFamily(rows: FeasibilityDemandRow[]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.candyFamilyKey)) return true;
    seen.add(row.candyFamilyKey);
  }
  return false;
}

/**
 * The candidate pass fixes each shared family's species candy in strict
 * priority order. It is globally exact only when the restored plan reaches
 * every surplus axis that precedes speciesLex in the active mode, and the
 * species distribution is the unique lexicographic maximum for every shared
 * family.
 */
function hasGlobalTopDownOptimalityCertificate(
  result: FeasibilityResult,
  rows: PreparedRow[],
  inventory: CandyInventory,
  mode?: SolverItemCompareMode,
): boolean {
  if (result.status !== 'feasible' || result.witness.rows.length !== rows.length) return false;
  const surpluses = result.witness.rows.map(row => supplyValue(row.supply) - row.totalCandy);
  const hasOptimalSurplusPrefix = mode === 'legacyImproved' || mode === 'surplusGateFirst'
    ? surpluses.every((surplus, index) => surplus <= 2 && (!rows[index].preferZeroSurplus || surplus === 0))
    : surpluses.every(surplus => surplus === 0);
  if (!hasOptimalSurplusPrefix) return false;

  const indexesByFamily = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const indexes = indexesByFamily.get(row.candyFamilyKey);
    if (indexes) indexes.push(index);
    else indexesByFamily.set(row.candyFamilyKey, [index]);
  });
  for (const [familyKey, rowIndexes] of indexesByFamily) {
    if (rowIndexes.length < 2) continue;
    const totalDemand = rowIndexes.reduce((sum, rowIndex) => sum + rows[rowIndex].totalCandy, 0);
    const targetSpecies = Math.min(inventory.species[familyKey] ?? 0, totalDemand);
    const weights = rowIndexes.map(rowIndex => rows[rowIndex].speciesLexOrder);
    const hasUniqueTopDownLexMaximum = targetSpecies === 0
      || targetSpecies === totalDemand
      || weights.every((weight, index) => index === weights.length - 1 || weight > weights[index + 1]);
    if (!hasUniqueTopDownLexMaximum) return false;

    let remainingSpecies = targetSpecies;
    for (const rowIndex of rowIndexes) {
      const expectedSpecies = Math.min(rows[rowIndex].totalCandy, remainingSpecies);
      if (result.witness.rows[rowIndex].supply.species !== expectedSpecies) return false;
      remainingSpecies -= expectedSpecies;
    }
    if (remainingSpecies !== 0) return false;
  }
  return true;
}

function candidateSolverOptions(
  options: InternalFeasibilitySolverOptions,
): InternalFeasibilitySolverOptions {
  return {
    ...options,
    // Restricted block/global frontiers must not share a cache key with the
    // complete search. Fixed-species row frontiers remain safe to reuse.
    frontierCache: undefined,
    globalPrefixCache: undefined,
    sharedSpeciesStrategy: 'topDownCandidate',
  };
}

function completeSolverOptionsAfter(
  options: InternalFeasibilitySolverOptions,
  startedAt: number,
): InternalFeasibilitySolverOptions {
  if (options.deadlineMs === undefined) return { ...options, sharedSpeciesStrategy: 'complete' };
  return {
    ...options,
    deadlineMs: Math.max(0, options.deadlineMs - (performance.now() - startedAt)),
    sharedSpeciesStrategy: 'complete',
  };
}

function solveFeasibilityForFixedRowsOnce(
  rows: PreparedRow[],
  inventory: CandyInventory,
  options: InternalFeasibilitySolverOptions,
): FeasibilityResult {
  const context = createContext(options);
  const demandError = validateDemandRows(rows, options);
  if (demandError) return finish(context, { status: 'infeasible', reason: demandError });
  const relaxationError = relaxationInfeasible(rows, inventory);
  if (relaxationError) return finish(context, { status: 'infeasible', reason: relaxationError });

  try {
    checkpoint(context);
    const blockFrontiers = buildTypeBlockComponents(rows).map(rowIndexes => {
      const key = typeBlockFrontierCacheKey(rowIndexes, rows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly);
      return { key, frontier: buildTypeBlockFrontier(rowIndexes, rows, inventory, context, key) };
    });
    if (blockFrontiers.some(block => block.frontier.length === 0)) return finish(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });

    const combined = combineGlobalBlockFrontiers(blockFrontiers, inventory, context);
    if (combined.status === 'infeasible') return finish(context, { status: 'infeasible', reason: combined.reason });
    return restoreWitnessResult(rows, inventory, context, combined.global);
  } catch (error) {
    if (error instanceof FeasibilityAbort) return fallbackResult(context, error.reason, rows, inventory);
    throw error;
  }
}

function solveFeasibilityForFixedRowsPrepared(
  rows: PreparedRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): FeasibilityResult {
  const internal = options as InternalFeasibilitySolverOptions;
  const shouldTryTopDownCandidate = internal.sharedSpeciesStrategy === undefined
    && internal.abortAfterTransitions === undefined
    && hasSharedCandyFamily(rows);
  if (!shouldTryTopDownCandidate) {
    return solveFeasibilityForFixedRowsOnce(rows, inventory, {
      ...internal,
      sharedSpeciesStrategy: internal.sharedSpeciesStrategy ?? 'complete',
    });
  }

  const startedAt = performance.now();
  const candidate = solveFeasibilityForFixedRowsOnce(rows, inventory, candidateSolverOptions(internal));
  const candidateCertified = candidate.status === 'feasible'
    && hasGlobalTopDownOptimalityCertificate(candidate, rows, inventory, internal.itemCompareMode);
  if (candidateCertified) {
    return candidate;
  }
  if (candidate.status === 'inconclusive') return candidate;
  return solveFeasibilityForFixedRowsOnce(rows, inventory, completeSolverOptionsAfter(internal, startedAt));
}

export function solveFeasibilityForFixedRows(
  rows: FeasibilityDemandRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): FeasibilityResult {
  return solveFeasibilityForFixedRowsPrepared(prepareRows(rows), inventory, options);
}

function solveFeasibilityDecisionForFixedRowsOnce(
  rows: PreparedRow[],
  inventory: CandyInventory,
  options: InternalFeasibilitySolverOptions,
): FeasibilityDecisionResult {
  const context = createContext({ ...options, decisionOnly: true });
  const demandError = validateDemandRows(rows, options);
  if (demandError) return finishDecision(context, { status: 'infeasible', reason: demandError });
  const relaxationError = relaxationInfeasible(rows, inventory);
  if (relaxationError) return finishDecision(context, { status: 'infeasible', reason: relaxationError });

  try {
    checkpoint(context);
    const blockFrontiers = buildTypeBlockComponents(rows).map(rowIndexes => {
      const key = typeBlockFrontierCacheKey(rowIndexes, rows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly);
      return { key, frontier: buildTypeBlockFrontier(rowIndexes, rows, inventory, context, key) };
    });
    if (blockFrontiers.some(block => block.frontier.length === 0)) return finishDecision(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });
    const combined = combineGlobalBlockFrontiers(blockFrontiers, inventory, context);
    if (combined.status === 'infeasible') return finishDecision(context, { status: 'infeasible', reason: combined.reason });
    return finishDecision(context, { status: 'feasible' });
  } catch (error) {
    if (error instanceof FeasibilityAbort) return finishDecision(context, { status: 'inconclusive', reason: error.reason });
    throw error;
  }
}

function solveFeasibilityDecisionForFixedRowsPrepared(
  rows: PreparedRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): FeasibilityDecisionResult {
  const internal = options as InternalFeasibilitySolverOptions;
  const shouldTryTopDownCandidate = internal.sharedSpeciesStrategy === undefined
    && internal.abortAfterTransitions === undefined
    && hasSharedCandyFamily(rows);
  if (!shouldTryTopDownCandidate) {
    return solveFeasibilityDecisionForFixedRowsOnce(rows, inventory, {
      ...internal,
      sharedSpeciesStrategy: internal.sharedSpeciesStrategy ?? 'complete',
    });
  }

  const startedAt = performance.now();
  const candidate = solveFeasibilityDecisionForFixedRowsOnce(rows, inventory, candidateSolverOptions(internal));
  if (candidate.status === 'feasible' || candidate.status === 'inconclusive') return candidate;
  return solveFeasibilityDecisionForFixedRowsOnce(rows, inventory, completeSolverOptionsAfter(internal, startedAt));
}

export function solveFeasibilityDecisionForFixedRows(
  rows: FeasibilityDemandRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): FeasibilityDecisionResult {
  return solveFeasibilityDecisionForFixedRowsPrepared(prepareRows(rows), inventory, options);
}

export function createPrefixDecisionSession(
  rows: FeasibilityDemandRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): { canSolvePrefix: (length: number) => FeasibilityDecisionResult } {
  const preparedRows = prepareRows(rows);
  const rowFrontierCache = (options as InternalFeasibilitySolverOptions).rowFrontierCache ?? new Map<string, CachedRowFrontier>();
  const sessionOptions: InternalFeasibilitySolverOptions = {
    ...options,
    rowFrontierCache,
    decisionOnly: true,
  };
  const context = createContext(sessionOptions);
  const witnessOptions = (): InternalFeasibilitySolverOptions => ({
    ...sessionOptions,
    decisionOnly: false,
  });
  const decisions = new Map<number, FeasibilityDecisionResult>();
  const prefixRows: PreparedRow[] = [];
  const speciesSeen = new Set<string>();
  const blockByType = new Map<string, {
    dirty: boolean;
    frontier: BlockState[];
    key: string;
    rowIndexes: number[];
    states: ResourceState[];
    type: string;
  }>();
  const blockOrder: string[] = [];
  let builtLength = 0;
  let complexFrom = Number.POSITIVE_INFINITY;

  const tryIndependentDecisionSearch = (length: number): FeasibilityDecisionResult | null => {
    if (sessionOptions.abortAfterTransitions !== undefined
      || sessionOptions.maxTotalSurplus !== undefined
      || sessionOptions.maxReachedSurplus !== undefined) return null;
    const searchRows = preparedRows.slice(0, length);
    if (new Set(searchRows.map(row => row.candyFamilyKey)).size !== searchRows.length) return null;
    const searchContext = createContext({ ...sessionOptions, logPerformance: false });
    const demandError = validateDemandRows(searchRows, searchContext.options);
    if (demandError) return finishDecision(searchContext, { status: 'infeasible', reason: demandError });
    const relaxationError = relaxationInfeasible(searchRows, inventory);
    if (relaxationError) return finishDecision(searchContext, { status: 'infeasible', reason: relaxationError });

    const groups = searchRows.map((row, rowIndex) => ({
      row,
      rowIndex,
      frontier: buildUniqueGroupFrontier(rowIndex, row, inventory, searchContext),
    }));
    if (groups.some(group => group.frontier.length === 0)) {
      return finishDecision(searchContext, { status: 'infeasible', reason: 'no_row_feasible_state' });
    }
    let cartesianSize = 1;
    for (const group of groups) cartesianSize = Math.min(1_000_000, cartesianSize * group.frontier.length);
    if (cartesianSize < 1_000_000) return null;

    const ordered = groups
      .map(group => ({
        ...group,
        frontier: [...group.frontier].sort((a, b) => {
          const universalValueA = a.universalS * CANDY_VALUES.universal.s
            + a.universalM * CANDY_VALUES.universal.m
            + a.universalL * CANDY_VALUES.universal.l;
          const universalValueB = b.universalS * CANDY_VALUES.universal.s
            + b.universalM * CANDY_VALUES.universal.m
            + b.universalL * CANDY_VALUES.universal.l;
          return universalValueA - universalValueB
            || a.universalL - b.universalL
            || a.universalM - b.universalM
            || a.universalS - b.universalS;
        }),
      }))
      .sort((a, b) => a.frontier.length - b.frontier.length || a.rowIndex - b.rowIndex);
    const relevantTypes = [...new Set(searchRows.map(row => row.type))].sort();
    const typeS: Record<string, number> = {};
    const typeM: Record<string, number> = {};
    const dead = new Set<string>();
    let universalS = 0;
    let universalM = 0;
    let universalL = 0;
    let visits = 0;
    let gaveUp = false;
    const visitLimit = 50_000;

    const search = (index: number): boolean => {
      if (index >= ordered.length) return true;
      const memoKey = `${index}|${relevantTypes.map(type => `${typeS[type] ?? 0},${typeM[type] ?? 0}`).join(';')}|${universalS},${universalM},${universalL}`;
      if (dead.has(memoKey)) return false;
      const group = ordered[index];
      const stock = inventoryType(inventory, group.row.type);
      for (const option of group.frontier) {
        visits++;
        if (visits > visitLimit) {
          gaveUp = true;
          return false;
        }
        const optionTypeS = option.typeS[group.row.type] ?? 0;
        const optionTypeM = option.typeM[group.row.type] ?? 0;
        const nextTypeS = (typeS[group.row.type] ?? 0) + optionTypeS;
        const nextTypeM = (typeM[group.row.type] ?? 0) + optionTypeM;
        if (nextTypeS > stock.s || nextTypeM > stock.m
          || universalS + option.universalS > inventory.universal.s
          || universalM + option.universalM > inventory.universal.m
          || universalL + option.universalL > inventory.universal.l) continue;
        typeS[group.row.type] = nextTypeS;
        typeM[group.row.type] = nextTypeM;
        universalS += option.universalS;
        universalM += option.universalM;
        universalL += option.universalL;
        if (search(index + 1)) return true;
        universalS -= option.universalS;
        universalM -= option.universalM;
        universalL -= option.universalL;
        typeS[group.row.type] = nextTypeS - optionTypeS;
        typeM[group.row.type] = nextTypeM - optionTypeM;
        if (gaveUp) return false;
      }
      dead.add(memoKey);
      return false;
    };

    const feasible = search(0);
    if (gaveUp) return null;
    searchContext.stats.transitions += visits;
    return finishDecision(searchContext, feasible
      ? {
          status: 'feasible',
          toWitness: () => solveFeasibilityForFixedRowsPrepared(searchRows, inventory, witnessOptions()),
        }
      : { status: 'infeasible', reason: 'no_global_feasible_state' });
  };

  const fallback = (length: number): FeasibilityDecisionResult => {
    const clamped = Math.max(0, Math.min(preparedRows.length, Math.floor(length)));
    const cached = decisions.get(clamped);
    if (cached) return cached;
    if (sessionOptions.maxTotalSurplus === undefined && sessionOptions.maxReachedSurplus === undefined) {
      // Shared-species prefixes need the full type-block construction anyway
      // when the selected prefix is restored or extended by a boundary row.
      // Build it once under the witness cache key instead of first building a
      // separate decision-only frontier that cannot be reused. Total-surplus
      // budget probes keep the decision-only path because most are not restored.
      const full = solveFeasibilityForFixedRowsPrepared(preparedRows.slice(0, clamped), inventory, witnessOptions());
      const result: FeasibilityDecisionResult = full.status === 'feasible'
        ? { status: 'feasible', stats: full.stats, toWitness: () => full }
        : full;
      decisions.set(clamped, result);
      return result;
    }
    const result = solveFeasibilityDecisionForFixedRowsPrepared(preparedRows.slice(0, clamped), inventory, sessionOptions);
    decisions.set(clamped, result);
    return result;
  };

  const evaluateCurrentPrefix = (length: number): FeasibilityDecisionResult => {
    const demandError = validateDemandRows(prefixRows, sessionOptions);
    if (demandError) return finishDecision(context, { status: 'infeasible', reason: demandError });
    const relaxationError = relaxationInfeasible(prefixRows, inventory);
    if (relaxationError) return finishDecision(context, { status: 'infeasible', reason: relaxationError });
    for (const block of blockByType.values()) {
      if (!block.dirty) continue;
      block.frontier = projectTypeBlockFrontier(block.states, context);
      block.key = typeBlockFrontierCacheKey(block.rowIndexes, preparedRows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly);
      block.dirty = false;
      rememberTypeBlock(block);
    }
    const blockFrontiers = blockOrder.map(type => {
      const block = blockByType.get(type);
      if (!block) throw new Error(`missing_incremental_type_block:${type}`);
      return { key: block.key, frontier: block.frontier };
    });
    if (blockFrontiers.some(block => block.frontier.length === 0)) return finishDecision(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });
    const combined = combineGlobalBlockFrontiers(blockFrontiers, inventory, context);
    if (combined.status === 'infeasible') return finishDecision(context, { status: 'infeasible', reason: combined.reason });
    return finishDecision(context, {
      status: 'feasible',
      toWitness: () => solveFeasibilityForFixedRowsPrepared(preparedRows.slice(0, length), inventory, witnessOptions()),
    });
  };

  const rememberTypeBlock = (block: NonNullable<ReturnType<typeof blockByType.get>>): void => {
    context.stats.typeBlockFrontierCounts.push(block.frontier.length);
    context.options.frontierCache?.set(block.key, {
      frontier: block.frontier,
      rowOptionCounts: block.rowIndexes
        .filter(rowIndex => context.stats.rowOptionCounts[rowIndex] !== undefined)
        .map(rowIndex => [rowIndex, context.stats.rowOptionCounts[rowIndex]]),
      rowFrontierCounts: block.rowIndexes
        .filter(rowIndex => context.stats.rowFrontierCounts[rowIndex] !== undefined)
        .map(rowIndex => [rowIndex, context.stats.rowFrontierCounts[rowIndex]]),
      typeBlockFrontierCount: block.frontier.length,
    });
  };

  const extendTo = (length: number): void => {
    while (builtLength < length && builtLength < complexFrom) {
      checkpoint(context);
      const rowIndex = builtLength;
      const row = preparedRows[rowIndex];
      const speciesKey = row.candyFamilyKey;
      if (speciesSeen.has(speciesKey)) {
        complexFrom = rowIndex + 1;
        return;
      }
      speciesSeen.add(speciesKey);
      prefixRows.push(row);
      const groupFrontier = buildUniqueGroupFrontier(rowIndex, row, inventory, context);
      const existing = blockByType.get(row.type);
      const rowIndexes = existing ? [...existing.rowIndexes, rowIndex] : [rowIndex];
      const states = existing
        ? combineResourceFrontierWithGroup(existing.states, groupFrontier, inventory, context)
        : groupFrontier;
      const block = {
        dirty: true,
        frontier: existing?.frontier ?? [],
        key: existing?.key ?? '',
        rowIndexes,
        states,
        type: row.type,
      };
      blockByType.set(row.type, block);
      if (!existing) blockOrder.push(row.type);
      builtLength = rowIndex + 1;
    }
  };

  return {
    canSolvePrefix(length: number): FeasibilityDecisionResult {
      const clamped = Math.max(0, Math.min(preparedRows.length, Math.floor(length)));
      const cached = decisions.get(clamped);
      if (cached) return cached;
      if (clamped === 0) {
        const result = finishDecision(context, { status: 'feasible', toWitness: () => solveFeasibilityForFixedRowsPrepared([], inventory, witnessOptions()) });
        decisions.set(0, result);
        return result;
      }
      let independentDecision: FeasibilityDecisionResult | null;
      try {
        independentDecision = tryIndependentDecisionSearch(clamped);
      } catch (error) {
        if (error instanceof FeasibilityAbort) {
          const result = finishDecision(context, { status: 'inconclusive', reason: error.reason });
          decisions.set(clamped, result);
          return result;
        }
        throw error;
      }
      if (independentDecision) {
        decisions.set(clamped, independentDecision);
        return independentDecision;
      }
      if (clamped >= complexFrom) return fallback(clamped);
      try {
        extendTo(clamped);
      } catch (error) {
        if (error instanceof FeasibilityAbort) {
          const result = finishDecision(context, { status: 'inconclusive', reason: error.reason });
          decisions.set(clamped, result);
          return result;
        }
        throw error;
      }
      if (clamped >= complexFrom) return fallback(clamped);
      if (clamped < builtLength) return fallback(clamped);
      const result = evaluateCurrentPrefix(clamped);
      decisions.set(clamped, result);
      return result;
    },
  };
}

function combineGlobalBlockFrontiers(
  blockFrontiers: Array<{ key: string; frontier: BlockState[] }>,
  inventory: CandyInventory,
  context: SolverContext,
): { status: 'ok'; global: BlockState[] } | { status: 'infeasible'; reason: string } {
  const orderedBlockFrontiers = blockFrontiers
    .map((block, originalIndex) => ({ ...block, originalIndex }))
    .sort((a, b) => (a.frontier.length - b.frontier.length) || (a.originalIndex - b.originalIndex));
  let global: BlockState[] = [{ universalS: 0, universalM: 0, universalL: 0, quality: emptyQuality(), path: null }];
  let startBlockIndex = 0;
  if (context.options.globalPrefixCache && orderedBlockFrontiers.length > 1) {
    const blockKeys = orderedBlockFrontiers.map(block => block.key);
    for (let count = blockKeys.length - 1; count > 0; count--) {
      const cached = context.options.globalPrefixCache.get(globalPrefixCacheKey(blockKeys.slice(0, count)));
      if (cached) {
        global = cached;
        startBlockIndex = count;
        break;
      }
    }
  }

  for (let blockIndex = startBlockIndex; blockIndex < orderedBlockFrontiers.length; blockIndex++) {
    const block = orderedBlockFrontiers[blockIndex].frontier;
    const next = new Map<string, BlockState>();
    for (const globalState of global) {
      for (const blockState of block) {
        transition(context);
        const candidate: BlockState = {
          universalS: globalState.universalS + blockState.universalS,
          universalM: globalState.universalM + blockState.universalM,
          universalL: globalState.universalL + blockState.universalL,
          quality: addQuality(globalState.quality, blockState.quality),
          path: appendPath(globalState.path, blockState.path),
        };
        if (candidate.universalS > inventory.universal.s || candidate.universalM > inventory.universal.m || candidate.universalL > inventory.universal.l) continue;
        if (!withinTotalSurplusBudget(candidate.quality, context)) continue;
        keepBestBlockState(next, candidate, context);
      }
    }
    global = pruneBlockStates([...next.values()], context);
    context.stats.globalKeyCount = Math.max(context.stats.globalKeyCount, global.length);
    if (global.length === 0) return { status: 'infeasible', reason: 'no_global_feasible_state' };
    if (context.options.globalPrefixCache && blockIndex < orderedBlockFrontiers.length - 1) {
      const key = globalPrefixCacheKey(orderedBlockFrontiers.slice(0, blockIndex + 1).map(entry => entry.key));
      context.options.globalPrefixCache.set(key, global);
    }
  }
  return { status: 'ok', global };
}

function restoreWitnessResult(
  rows: PreparedRow[],
  inventory: CandyInventory,
  context: SolverContext,
  global: BlockState[],
): FeasibilityResult {
  const selected = [...global].sort((a, b) => -compareFinalBlockState(a, b, context.options.itemCompareMode))[0];
  if (!selected) return finish(context, { status: 'infeasible', reason: 'no_global_feasible_state' });

  const restoreStarted = performance.now();
  const entries = pathEntries(selected.path);
  const optionsByRow = new Map(entries.map(entry => [entry.rowIndex, entry.option]));
  if (optionsByRow.size !== rows.length) return fallbackResult(context, 'witness_restore_missing_row', rows, inventory);
  const witnessRows: FeasiblePlanRow[] = rows.map((row, index) => {
    const { speciesLexOrder: _speciesLexOrder, ...demandRow } = row;
    return {
      ...demandRow,
      supply: optionsByRow.get(index) ?? { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0 },
    };
  });
  const boundary = expectedBoundary(rows);
  const witness: FeasibilityWitness = {
    ...boundary,
    rows: witnessRows,
    remaining: expectedRemaining(witnessRows, inventory, context.options),
  };
  context.stats.witnessRestoreMs = performance.now() - restoreStarted;
  const validation = validateFeasibilityWitnessInternal(witness, rows, inventory, context.options, true, false);
  if (!validation.valid) return fallbackResult(context, `witness_validation_failed:${validation.errors.join(',')}`, rows, inventory);
  return finish(context, { status: 'feasible', witness });
}

function solveFeasibilityForIndependentBoundaryPrepared(
  prefixRows: PreparedRow[],
  boundaryRow: PreparedRow,
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): FeasibilityResult | null {
  if (prefixRows.some(row => row.type === boundaryRow.type || row.candyFamilyKey === boundaryRow.candyFamilyKey)) return null;
  const rows = [...prefixRows, boundaryRow];
  const context = createContext(options);
  const demandError = validateDemandRows(rows, options);
  if (demandError) return finish(context, { status: 'infeasible', reason: demandError });
  const relaxationError = relaxationInfeasible(rows, inventory);
  if (relaxationError) return finish(context, { status: 'infeasible', reason: relaxationError });

  try {
    checkpoint(context);
    const prefixComponents = buildTypeBlockComponents(prefixRows);
    const prefixBlockFrontiers = prefixComponents.map(rowIndexes => {
      const key = typeBlockFrontierCacheKey(rowIndexes, rows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly);
      return { key, frontier: buildTypeBlockFrontier(rowIndexes, rows, inventory, context, key) };
    });
    if (prefixBlockFrontiers.some(block => block.frontier.length === 0)) return finish(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });
    const prefixCombined = combineGlobalBlockFrontiers(prefixBlockFrontiers, inventory, context);
    if (prefixCombined.status === 'infeasible') return finish(context, { status: 'infeasible', reason: prefixCombined.reason });

    const boundaryRowIndex = prefixRows.length;
    const boundaryKey = typeBlockFrontierCacheKey([boundaryRowIndex], rows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly);
    const boundaryFrontier = buildTypeBlockFrontier([boundaryRowIndex], rows, inventory, context, boundaryKey);
    if (boundaryFrontier.length === 0) return finish(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });

    const next = new Map<string, BlockState>();
    for (const prefixState of prefixCombined.global) {
      for (const boundaryState of boundaryFrontier) {
        transition(context);
        const candidate: BlockState = {
          universalS: prefixState.universalS + boundaryState.universalS,
          universalM: prefixState.universalM + boundaryState.universalM,
          universalL: prefixState.universalL + boundaryState.universalL,
          quality: addQuality(prefixState.quality, boundaryState.quality),
          path: appendPath(prefixState.path, boundaryState.path),
        };
        if (candidate.universalS > inventory.universal.s || candidate.universalM > inventory.universal.m || candidate.universalL > inventory.universal.l) continue;
        if (!withinTotalSurplusBudget(candidate.quality, context)) continue;
        keepBestBlockState(next, candidate, context);
      }
    }
    const global = pruneBlockStates([...next.values()], context);
    context.stats.globalKeyCount = Math.max(context.stats.globalKeyCount, global.length);
    if (global.length === 0) return finish(context, { status: 'infeasible', reason: 'no_global_feasible_state' });
    return restoreWitnessResult(rows, inventory, context, global);
  } catch (error) {
    if (error instanceof FeasibilityAbort) return fallbackResult(context, error.reason, rows, inventory);
    throw error;
  }
}

export function solveFeasibilityForIndependentBoundary(
  prefixRows: FeasibilityDemandRow[],
  boundaryRow: FeasibilityDemandRow,
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): FeasibilityResult | null {
  const preparedRows = prepareRows([...prefixRows, boundaryRow]);
  return solveFeasibilityForIndependentBoundaryPrepared(
    preparedRows.slice(0, -1),
    preparedRows[preparedRows.length - 1],
    inventory,
    options,
  );
}

function createIndependentBoundaryFeasibilitySessionPrepared(
  prefixRows: PreparedRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): {
  solve: (boundaryRow: FeasibilityDemandRow, limits?: { maxTotalSurplus?: number; maxReachedSurplus?: number }) => FeasibilityResult | null;
  canSolve: (boundaryRow: FeasibilityDemandRow, limits?: { maxTotalSurplus?: number; maxReachedSurplus?: number }) => FeasibilityDecisionResult | null;
  canSolveSupply: (boundaryRow: FeasibilityDemandRow, supply: Supply, limits?: { maxTotalSurplus?: number; maxReachedSurplus?: number }) => FeasibilityDecisionResult | null;
  maxBoundaryTotal: (boundaryRow: FeasibilityDemandRow, maxTotalCandy: number) => number | null;
  solveMaxBoundaryTotal: (
    boundaryRow: FeasibilityDemandRow,
    maxTotalCandy: number,
    boundaryRowForTotal: (totalCandy: number) => FeasibilityDemandRow,
  ) => FeasibilityResult | null;
  maxBoundaryUniversalS: (boundaryRow: FeasibilityDemandRow, universalM: number, universalL: number, limits?: { maxTotalSurplus?: number }) => number | null;
} | null {
  const prefixTypes = new Set(prefixRows.map(row => row.type));
  const prefixSpecies = new Set(prefixRows.map(row => row.candyFamilyKey));
  const prepareBoundaryRow = (row: FeasibilityDemandRow): PreparedRow => ({
    ...row,
    speciesLexOrder: -prefixRows.length,
  });
  const context = createContext(options);
  const demandError = validateDemandRows(prefixRows, options);
  if (demandError) return null;
  const relaxationError = relaxationInfeasible(prefixRows, inventory);
  if (relaxationError) return null;

  try {
    checkpoint(context);
    const prefixComponents = buildTypeBlockComponents(prefixRows);
    const prefixBlockFrontiers = prefixComponents.map(rowIndexes => {
      const key = typeBlockFrontierCacheKey(rowIndexes, prefixRows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly);
      return { key, frontier: buildTypeBlockFrontier(rowIndexes, prefixRows, inventory, context, key) };
    });
    if (prefixBlockFrontiers.some(block => block.frontier.length === 0)) return null;
    const prefixCombined = combineGlobalBlockFrontiers(prefixBlockFrontiers, inventory, context);
    if (prefixCombined.status === 'infeasible') return null;
    const affectedPrefixStateCache = new Map<number, ResourceState[]>();
    const unaffectedDecisionEnvelopeCache = new Map<number, UniversalDecisionEnvelope | null>();
    const affectedPrefixStatesFor = (componentIndex: number): ResourceState[] => {
      const cached = affectedPrefixStateCache.get(componentIndex);
      if (cached) return cached;
      const states = buildTypeBlockResourceStates(prefixComponents[componentIndex], prefixRows, inventory, context);
      affectedPrefixStateCache.set(componentIndex, states);
      return states;
    };
    const sameTypeBoundaryComponentIndex = (boundaryRow: PreparedRow): number | null => {
      if (!prefixTypes.has(boundaryRow.type) || prefixSpecies.has(boundaryRow.candyFamilyKey)) return null;
      const stock = inventoryType(inventory, boundaryRow.type);
      if (
        (context.options.itemCompareMode === 'surplusGateFirst'
          || context.options.itemCompareMode === 'legacyImproved')
        && stock.s <= 0
        && stock.m <= 0
      ) return null;
      const affectedComponentIndex = prefixComponents.findIndex(component => (
        component.some(rowIndex => prefixRows[rowIndex].type === boundaryRow.type)
      ));
      return affectedComponentIndex < 0 ? null : affectedComponentIndex;
    };
    const unaffectedDecisionEnvelopeFor = (componentIndex: number): UniversalDecisionEnvelope | null => {
      if (unaffectedDecisionEnvelopeCache.has(componentIndex)) return unaffectedDecisionEnvelopeCache.get(componentIndex) ?? null;
      const otherBlockFrontiers = prefixBlockFrontiers.filter((_, index) => index !== componentIndex);
      const otherCombined = otherBlockFrontiers.length === 0
        ? { status: 'ok' as const, global: [{ universalS: 0, universalM: 0, universalL: 0, quality: emptyQuality(), path: null }] }
        : combineGlobalBlockFrontiers(otherBlockFrontiers, inventory, context);
      const envelope = otherCombined.status === 'ok'
        ? buildUniversalDecisionEnvelope(otherCombined.global, inventory)
        : null;
      unaffectedDecisionEnvelopeCache.set(componentIndex, envelope);
      return envelope;
    };
    const sameTypeAffectedFrontier = (
      boundaryRow: PreparedRow,
      componentIndex: number,
    ): BlockState[] => {
      const boundaryRowIndex = prefixRows.length;
      const boundaryFrontier = buildUniqueGroupFrontier(boundaryRowIndex, boundaryRow, inventory, context);
      if (boundaryFrontier.length === 0) return [];
      const affectedStates = combineResourceFrontierWithGroup(
        affectedPrefixStatesFor(componentIndex),
        boundaryFrontier,
        inventory,
        context,
      );
      const affectedFrontier = projectTypeBlockFrontier(affectedStates, context);
      context.stats.typeBlockFrontierCounts.push(affectedFrontier.length);
      return affectedFrontier;
    };
    const sameTypeBoundaryDecision = (boundaryRow: PreparedRow): FeasibilityDecisionResult | null => {
      const componentIndex = sameTypeBoundaryComponentIndex(boundaryRow);
      if (componentIndex === null) return null;
      try {
        checkpoint(context);
        const envelope = unaffectedDecisionEnvelopeFor(componentIndex);
        if (!envelope) return finishDecision(context, { status: 'infeasible', reason: 'no_global_feasible_state' });
        const boundaryRowIndex = prefixRows.length;
        const species = Math.min(inventory.species[boundaryRow.candyFamilyKey] ?? 0, boundaryRow.totalCandy);
        const boundaryOptions = rowOptionsForSpecies(boundaryRow, species, inventory, context);
        context.stats.rowOptionCounts[boundaryRowIndex] = boundaryOptions.length;
        context.stats.rowFrontierCounts[boundaryRowIndex] = boundaryOptions.length;
        if (boundaryOptions.length === 0) return finishDecision(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });
        const affectedStates = affectedPrefixStatesFor(componentIndex);
        const stock = inventoryType(inventory, boundaryRow.type);
        for (const option of boundaryOptions) {
          const optionQuality = qualityForOption(option, boundaryRow.totalCandy, boundaryRow.preferZeroSurplus, boundaryRow.speciesLexOrder, boundaryRow.candyDemandMet);
          if (!withinTotalSurplusBudget(optionQuality, context)) continue;
          for (const state of affectedStates) {
            transition(context);
            const typeS = (state.typeS[boundaryRow.type] ?? 0) + option.typeS;
            const typeM = (state.typeM[boundaryRow.type] ?? 0) + option.typeM;
            const universalS = state.universalS + option.universalS;
            const universalM = state.universalM + option.universalM;
            const universalL = state.universalL + option.universalL;
            if (typeS > stock.s || typeM > stock.m || universalS > inventory.universal.s || universalM > inventory.universal.m || universalL > inventory.universal.l) continue;
            const quality = addQuality(state.quality, optionQuality);
            if (!withinTotalSurplusBudget(quality, context)) continue;
            if (canCombineWithUniversalDecisionEnvelope(envelope, { universalS, universalM, universalL, quality, path: null }, inventory)) {
              return finishDecision(context, { status: 'feasible' });
            }
          }
        }
        return finishDecision(context, { status: 'infeasible', reason: 'no_global_feasible_state' });
      } catch (error) {
        if (error instanceof FeasibilityAbort) return finishDecision(context, { status: 'inconclusive', reason: error.reason });
        throw error;
      }
    };
    const sameTypeBoundaryBlockFrontiers = (
      boundaryRow: PreparedRow,
      rows: PreparedRow[],
    ): Array<{ key: string; frontier: BlockState[] }> | null => {
      const affectedComponentIndex = sameTypeBoundaryComponentIndex(boundaryRow);
      if (affectedComponentIndex === null) return null;
      const affectedFrontier = sameTypeAffectedFrontier(boundaryRow, affectedComponentIndex);
      if (affectedFrontier.length === 0) return [];
      return prefixBlockFrontiers.map((block, componentIndex) => {
        if (componentIndex !== affectedComponentIndex) return block;
        const boundaryRowIndex = prefixRows.length;
        const rowIndexes = [...prefixComponents[componentIndex], boundaryRowIndex];
        return {
          key: typeBlockFrontierCacheKey(rowIndexes, rows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly),
          frontier: affectedFrontier,
        };
      });
    };
    const sameTypeBoundarySolve = (boundaryRow: PreparedRow, rows: PreparedRow[]): FeasibilityResult | null => {
      try {
        checkpoint(context);
        const blockFrontiers = sameTypeBoundaryBlockFrontiers(boundaryRow, rows);
        if (blockFrontiers === null) return null;
        if (blockFrontiers.some(block => block.frontier.length === 0)) return finish(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });
        const combined = combineGlobalBlockFrontiers(blockFrontiers, inventory, context);
        if (combined.status === 'infeasible') return finish(context, { status: 'infeasible', reason: combined.reason });
        return restoreWitnessResult(rows, inventory, context, combined.global);
      } catch (error) {
        if (error instanceof FeasibilityAbort) return fallbackResult(context, error.reason, rows, inventory);
        throw error;
      }
    };
    const decisionEnvelope = buildUniversalDecisionEnvelope(prefixCombined.global, inventory);
    const surplusDecisionEnvelopes = new Map<string, UniversalDecisionEnvelope>();
    const decisionEnvelopeForSurplusBudget = (maxRawSurplus?: number, maxReachedSurplus?: number): UniversalDecisionEnvelope => {
      if (maxRawSurplus === undefined && maxReachedSurplus === undefined) return decisionEnvelope;
      const key = `${maxRawSurplus ?? ''}|${maxReachedSurplus ?? ''}`;
      const cached = surplusDecisionEnvelopes.get(key);
      if (cached) return cached;
      const envelope = buildUniversalDecisionEnvelope(prefixCombined.global, inventory, maxRawSurplus, maxReachedSurplus);
      surplusDecisionEnvelopes.set(key, envelope);
      return envelope;
    };
    const maxBoundaryUniversalSFor = (
      boundaryRow: PreparedRow,
      universalM: number,
      universalL: number,
      limits: { maxTotalSurplus?: number } = {},
    ): number | null => {
      if (sameTypeBoundaryComponentIndex(boundaryRow) !== null || prefixSpecies.has(boundaryRow.candyFamilyKey)) return null;
      const maxTotalSurplus = limits.maxTotalSurplus ?? context.options.maxTotalSurplus;
      const envelope = maxTotalSurplus === undefined
        ? decisionEnvelope
        : decisionEnvelopeForSurplusBudget(maxTotalSurplus);
      const remainingM = inventory.universal.m - universalM;
      const remainingL = inventory.universal.l - universalL;
      if (remainingM < 0 || remainingL < 0 || remainingM >= envelope.mediumDim || remainingL >= envelope.largeDim) return -1;
      const requiredPrefixS = envelope.minUniversalS[remainingM * envelope.largeDim + remainingL];
      if (requiredPrefixS >= envelope.impossible) return -1;
      return inventory.universal.s - requiredPrefixS;
    };
    const findMaxSameTypeBoundaryTotal = (
      boundaryRow: PreparedRow,
      maxTotalCandy: number,
    ): number | null => {
      const componentIndex = sameTypeBoundaryComponentIndex(boundaryRow);
      if (componentIndex === null || context.options.maxRowSurplus === undefined || context.options.maxTotalSurplus !== undefined) return null;
      const envelope = unaffectedDecisionEnvelopeFor(componentIndex);
      if (!envelope) return -1;
      const affectedStates = affectedPrefixStatesFor(componentIndex);
      const stock = inventoryType(inventory, boundaryRow.type);
      const maxTotal = Math.max(0, Math.floor(maxTotalCandy));
      const rowSurplusLimit = context.options.maxRowSurplus;
      const speciesStock = inventory.species[boundaryRow.candyFamilyKey] ?? 0;
      let best = -1;

      for (const state of affectedStates) {
        checkpoint(context);
        const typeSAvailable = stock.s - (state.typeS[boundaryRow.type] ?? 0);
        const typeMAvailable = stock.m - (state.typeM[boundaryRow.type] ?? 0);
        if (typeSAvailable < 0 || typeMAvailable < 0) continue;

        if (maxTotal <= speciesStock && canCombineWithUniversalDecisionEnvelope(envelope, {
          universalS: state.universalS,
          universalM: state.universalM,
          universalL: state.universalL,
          quality: state.quality,
          path: null,
        }, inventory)) {
          best = maxTotal;
          break;
        }

        const species = Math.min(speciesStock, maxTotal);
        const maxSupplyValue = maxTotal + rowSurplusLimit;
        const maxUniversalL = Math.min(
          inventory.universal.l - state.universalL,
          Math.floor(Math.max(0, maxSupplyValue - species) / CANDY_VALUES.universal.l),
        );
        for (let universalL = 0; universalL <= maxUniversalL; universalL++) {
          checkpoint(context);
          const remainingL = inventory.universal.l - state.universalL - universalL;
          const valueAfterL = species + universalL * CANDY_VALUES.universal.l;
          const maxUniversalM = Math.min(
            inventory.universal.m - state.universalM,
            Math.floor(Math.max(0, maxSupplyValue - valueAfterL) / CANDY_VALUES.universal.m),
          );
          for (let universalM = 0; universalM <= maxUniversalM; universalM++) {
            const remainingM = inventory.universal.m - state.universalM - universalM;
            if (remainingM < 0 || remainingM >= envelope.mediumDim || remainingL < 0 || remainingL >= envelope.largeDim) continue;
            const requiredEnvelopeS = envelope.minUniversalS[remainingM * envelope.largeDim + remainingL];
            if (requiredEnvelopeS >= envelope.impossible) continue;
            const maxUniversalS = inventory.universal.s - state.universalS - requiredEnvelopeS;
            if (maxUniversalS < 0) continue;

            const valueAfterM = valueAfterL + universalM * CANDY_VALUES.universal.m;
            const maxTypeM = Math.min(
              typeMAvailable,
              Math.floor(Math.max(0, maxSupplyValue - valueAfterM) / CANDY_VALUES.type.m),
            );
            for (let typeM = 0; typeM <= maxTypeM; typeM++) {
              const valueAfterTypeM = valueAfterM + typeM * CANDY_VALUES.type.m;
              const maxTypeS = Math.min(
                typeSAvailable,
                Math.floor(Math.max(0, maxSupplyValue - valueAfterTypeM) / CANDY_VALUES.type.s),
              );
              for (let typeS = 0; typeS <= maxTypeS; typeS++) {
                transition(context);
                const valueBeforeUniversalS = valueAfterTypeM + typeS * CANDY_VALUES.type.s;
                const universalS = Math.min(
                  maxUniversalS,
                  Math.floor(Math.max(0, maxSupplyValue - valueBeforeUniversalS) / CANDY_VALUES.universal.s),
                );
                const supplyValueForBoundary = valueBeforeUniversalS + universalS * CANDY_VALUES.universal.s;
                const total = Math.min(maxTotal, supplyValueForBoundary);
                if (total <= speciesStock && supplyValueForBoundary !== total) continue;
                if (supplyValueForBoundary < total || supplyValueForBoundary - total > rowSurplusLimit) continue;
                if (total > best) best = total;
                if (best === maxTotal) return best;
              }
            }
          }
        }
      }

      return best;
    };
    const findMaxBoundaryTotal = (boundaryRow: PreparedRow, maxTotalCandy: number): number | null => {
      if (sameTypeBoundaryComponentIndex(boundaryRow) !== null || prefixSpecies.has(boundaryRow.candyFamilyKey)) return null;
      const cappedTotal = Math.max(0, Math.floor(maxTotalCandy));
      const species = Math.min(inventory.species[boundaryRow.candyFamilyKey] ?? 0, cappedTotal);
      const typeStock = inventoryType(inventory, boundaryRow.type);
      const rowSurplusAllowed = (supply: Supply, totalCandy: number): boolean => (
        context.options.maxRowSurplus === undefined
        || Math.max(0, supplyValue(supply) - totalCandy) <= context.options.maxRowSurplus
      );
      let best = -1;
      const maxUniversalL = Math.min(inventory.universal.l, Math.ceil(Math.max(0, cappedTotal - species) / CANDY_VALUES.universal.l));
      for (let universalL = 0; universalL <= maxUniversalL; universalL++) {
        const valueAfterL = species + universalL * CANDY_VALUES.universal.l;
        const maxUniversalM = Math.min(inventory.universal.m, Math.ceil(Math.max(0, cappedTotal - valueAfterL) / CANDY_VALUES.universal.m));
        for (let universalM = 0; universalM <= maxUniversalM; universalM++) {
          const maxUniversalS = maxBoundaryUniversalSFor(boundaryRow, universalM, universalL);
          if (maxUniversalS === null) return null;
          if (maxUniversalS < 0) continue;
          const valueAfterM = valueAfterL + universalM * CANDY_VALUES.universal.m;
          const maxTypeM = Math.min(typeStock.m, Math.ceil(Math.max(0, cappedTotal - valueAfterM) / CANDY_VALUES.type.m));
          for (let typeM = 0; typeM <= maxTypeM; typeM++) {
            const valueAfterTypeM = valueAfterM + typeM * CANDY_VALUES.type.m;
            const maxTypeS = Math.min(typeStock.s, Math.ceil(Math.max(0, cappedTotal - valueAfterTypeM) / CANDY_VALUES.type.s));
            for (let typeS = 0; typeS <= maxTypeS; typeS++) {
              const valueBeforeS = valueAfterTypeM + typeS * CANDY_VALUES.type.s;
              if (valueBeforeS >= cappedTotal) {
                const supply: Supply = { species, typeS, typeM, universalS: 0, universalM, universalL };
                if (rowSurplusAllowed(supply, cappedTotal) && isMinimumCover(supply, cappedTotal)) best = cappedTotal;
                continue;
              }
              const universalS = Math.min(maxUniversalS, Math.floor((cappedTotal - valueBeforeS) / CANDY_VALUES.universal.s));
              if (universalS < 0) continue;
              const supplyValueForTotal = valueBeforeS + universalS * CANDY_VALUES.universal.s;
              if (supplyValueForTotal > best) best = supplyValueForTotal;
              if (universalS < maxUniversalS) {
                const overshootSupply: Supply = { species, typeS, typeM, universalS: universalS + 1, universalM, universalL };
                if (rowSurplusAllowed(overshootSupply, cappedTotal) && isMinimumCover(overshootSupply, cappedTotal)) best = cappedTotal;
              }
            }
          }
        }
      }
      return Math.min(best, cappedTotal);
    };

    const solveWithBoundaryFrontier = (
      rows: PreparedRow[],
      boundaryFrontier: BlockState[],
      limits: { maxTotalSurplus?: number; maxReachedSurplus?: number } = {},
    ): FeasibilityResult => {
      const next = new Map<string, BlockState>();
      for (const prefixState of prefixCombined.global) {
        for (const boundaryState of boundaryFrontier) {
          transition(context);
          const candidate: BlockState = {
            universalS: prefixState.universalS + boundaryState.universalS,
            universalM: prefixState.universalM + boundaryState.universalM,
            universalL: prefixState.universalL + boundaryState.universalL,
            quality: addQuality(prefixState.quality, boundaryState.quality),
            path: appendPath(prefixState.path, boundaryState.path),
          };
          if (candidate.universalS > inventory.universal.s || candidate.universalM > inventory.universal.m || candidate.universalL > inventory.universal.l) continue;
          if (!withinTotalSurplusBudget(candidate.quality, context)) continue;
          if (limits.maxTotalSurplus !== undefined && candidate.quality.rawSurplus > limits.maxTotalSurplus) continue;
          if (limits.maxReachedSurplus !== undefined && candidate.quality.reachedSurplus > limits.maxReachedSurplus) continue;
          keepBestBlockState(next, candidate, context);
        }
      }
      const global = pruneBlockStates([...next.values()], context);
      context.stats.globalKeyCount = Math.max(context.stats.globalKeyCount, global.length);
      if (global.length === 0) return finish(context, { status: 'infeasible', reason: 'no_global_feasible_state' });
      return restoreWitnessResult(rows, inventory, context, global);
    };

    return {
      canSolve(boundaryRow: FeasibilityDemandRow, limits: { maxTotalSurplus?: number; maxReachedSurplus?: number } = {}): FeasibilityDecisionResult | null {
        const preparedBoundaryRow = prepareBoundaryRow(boundaryRow);
        const rows = [...prefixRows, preparedBoundaryRow];
        const rowError = validateDemandRows(rows, options);
        if (rowError) return finishDecision(context, { status: 'infeasible', reason: rowError });
        const rowRelaxationError = relaxationInfeasible(rows, inventory);
        if (rowRelaxationError) return finishDecision(context, { status: 'infeasible', reason: rowRelaxationError });
        if (prefixSpecies.has(preparedBoundaryRow.candyFamilyKey)) return null;
        if (context.options.maxTotalSurplus !== undefined) return null;
        if (limits.maxTotalSurplus !== undefined && limits.maxTotalSurplus !== context.options.maxTotalSurplus) return null;
        // Type candy stock is shared with the prefix in every policy. Treating
        // this row as an independent block can restore an over-stock witness.
        if (sameTypeBoundaryComponentIndex(preparedBoundaryRow) !== null) {
          if (limits.maxReachedSurplus !== undefined) return null;
          return sameTypeBoundaryDecision(preparedBoundaryRow);
        }
        try {
          checkpoint(context);
          const boundaryRowIndex = prefixRows.length;
          const boundaryKey = typeBlockFrontierCacheKey([boundaryRowIndex], rows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly);
          const boundaryFrontier = buildTypeBlockFrontier([boundaryRowIndex], rows, inventory, context, boundaryKey);
          if (boundaryFrontier.length === 0) return finishDecision(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });
          const maxTotalSurplus = limits.maxTotalSurplus ?? context.options.maxTotalSurplus;
          for (const boundaryState of boundaryFrontier) {
            transition(context);
            const remainingSurplusBudget = maxTotalSurplus === undefined
              ? undefined
              : maxTotalSurplus - boundaryState.quality.rawSurplus;
            const remainingReachedSurplusBudget = limits.maxReachedSurplus === undefined
              ? undefined
              : limits.maxReachedSurplus - boundaryState.quality.reachedSurplus;
            if (remainingSurplusBudget !== undefined && remainingSurplusBudget < 0) continue;
            if (remainingReachedSurplusBudget !== undefined && remainingReachedSurplusBudget < 0) continue;
            const feasible = canCombineWithUniversalDecisionEnvelope(
              decisionEnvelopeForSurplusBudget(remainingSurplusBudget, remainingReachedSurplusBudget),
              boundaryState,
              inventory,
            );
            if (feasible) {
              return finishDecision(context, { status: 'feasible' });
            }
          }
          return finishDecision(context, { status: 'infeasible', reason: 'no_global_feasible_state' });
        } catch (error) {
          if (error instanceof FeasibilityAbort) return finishDecision(context, { status: 'inconclusive', reason: error.reason });
          throw error;
        }
      },
      canSolveSupply(boundaryRow: FeasibilityDemandRow, supply: Supply, limits: { maxTotalSurplus?: number; maxReachedSurplus?: number } = {}): FeasibilityDecisionResult | null {
        const preparedBoundaryRow = prepareBoundaryRow(boundaryRow);
        if (sameTypeBoundaryComponentIndex(preparedBoundaryRow) !== null || prefixSpecies.has(preparedBoundaryRow.candyFamilyKey)) return null;
        const rows = [...prefixRows, preparedBoundaryRow];
        const rowError = validateDemandRows(rows, options);
        if (rowError) return finishDecision(context, { status: 'infeasible', reason: rowError });
        const rowRelaxationError = relaxationInfeasible(rows, inventory);
        if (rowRelaxationError) return finishDecision(context, { status: 'infeasible', reason: rowRelaxationError });
        try {
          checkpoint(context);
          const boundaryState: BlockState = {
            universalS: supply.universalS,
            universalM: supply.universalM,
            universalL: supply.universalL,
            quality: qualityForOption(supply, preparedBoundaryRow.totalCandy, preparedBoundaryRow.preferZeroSurplus, preparedBoundaryRow.speciesLexOrder, preparedBoundaryRow.candyDemandMet),
            path: null,
          };
          if (!resourceWithinInventory({
            typeS: { [preparedBoundaryRow.type]: supply.typeS },
            typeM: { [preparedBoundaryRow.type]: supply.typeM },
            universalS: supply.universalS,
            universalM: supply.universalM,
            universalL: supply.universalL,
            quality: boundaryState.quality,
            path: null,
          }, inventory)) return finishDecision(context, { status: 'infeasible', reason: 'boundary_supply_stock_exceeded' });

          const maxTotalSurplus = limits.maxTotalSurplus ?? context.options.maxTotalSurplus;
          const remainingSurplusBudget = maxTotalSurplus === undefined
            ? undefined
            : maxTotalSurplus - boundaryState.quality.rawSurplus;
          const remainingReachedSurplusBudget = limits.maxReachedSurplus === undefined
            ? undefined
            : limits.maxReachedSurplus - boundaryState.quality.reachedSurplus;
          if (remainingSurplusBudget !== undefined && remainingSurplusBudget < 0) {
            return finishDecision(context, { status: 'infeasible', reason: 'boundary_supply_surplus_exceeded' });
          }
          if (remainingReachedSurplusBudget !== undefined && remainingReachedSurplusBudget < 0) {
            return finishDecision(context, { status: 'infeasible', reason: 'boundary_supply_reached_surplus_exceeded' });
          }
          const feasible = canCombineWithUniversalDecisionEnvelope(
            decisionEnvelopeForSurplusBudget(remainingSurplusBudget, remainingReachedSurplusBudget),
            boundaryState,
            inventory,
          );
          return finishDecision(context, feasible
            ? { status: 'feasible' }
            : { status: 'infeasible', reason: 'no_global_feasible_state' });
        } catch (error) {
          if (error instanceof FeasibilityAbort) return finishDecision(context, { status: 'inconclusive', reason: error.reason });
          throw error;
        }
      },
      maxBoundaryTotal(boundaryRow: FeasibilityDemandRow, maxTotalCandy: number): number | null {
        return findMaxBoundaryTotal(prepareBoundaryRow(boundaryRow), maxTotalCandy);
      },
      solveMaxBoundaryTotal(
        boundaryRow: FeasibilityDemandRow,
        maxTotalCandy: number,
        boundaryRowForTotal: (totalCandy: number) => FeasibilityDemandRow,
      ): FeasibilityResult | null {
        const preparedBoundaryRow = prepareBoundaryRow(boundaryRow);
        if (sameTypeBoundaryComponentIndex(preparedBoundaryRow) !== null && context.options.itemCompareMode !== 'legacyImproved' && context.options.maxRowSurplus !== undefined && context.options.maxTotalSurplus === undefined) {
          const maxTotal = findMaxSameTypeBoundaryTotal(preparedBoundaryRow, maxTotalCandy);
          if (maxTotal === null) return null;
          if (maxTotal >= 0) {
            const row = prepareBoundaryRow(boundaryRowForTotal(maxTotal));
            const result = sameTypeBoundarySolve(row, [...prefixRows, row]);
            if (result) return result;
          }
          return finish(context, { status: 'infeasible', reason: 'no_global_feasible_state' });
        }
        const maxTotal = findMaxBoundaryTotal(preparedBoundaryRow, maxTotalCandy);
        if (maxTotal === null) return null;
        if (maxTotal < 0) return finish(context, { status: 'infeasible', reason: 'no_global_feasible_state' });
        const row = prepareBoundaryRow(boundaryRowForTotal(maxTotal));
        if (sameTypeBoundaryComponentIndex(row) !== null || prefixSpecies.has(row.candyFamilyKey)) return null;
        const rows = [...prefixRows, row];
        const rowError = validateDemandRows(rows, options);
        if (rowError) return finish(context, { status: 'infeasible', reason: rowError });
        const rowRelaxationError = relaxationInfeasible(rows, inventory);
        if (rowRelaxationError) return finish(context, { status: 'infeasible', reason: rowRelaxationError });
        try {
          checkpoint(context);
          const boundaryRowIndex = prefixRows.length;
          const boundaryKey = typeBlockFrontierCacheKey([boundaryRowIndex], rows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly);
          const boundaryFrontier = buildTypeBlockFrontier([boundaryRowIndex], rows, inventory, context, boundaryKey);
          if (boundaryFrontier.length === 0) return finish(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });
          return solveWithBoundaryFrontier(rows, boundaryFrontier);
        } catch (error) {
          if (error instanceof FeasibilityAbort) return fallbackResult(context, error.reason, rows, inventory);
          throw error;
        }
      },
      maxBoundaryUniversalS(boundaryRow: FeasibilityDemandRow, universalM: number, universalL: number, limits: { maxTotalSurplus?: number } = {}): number | null {
        return maxBoundaryUniversalSFor(prepareBoundaryRow(boundaryRow), universalM, universalL, limits);
      },
      solve(boundaryRow: FeasibilityDemandRow, limits: { maxTotalSurplus?: number; maxReachedSurplus?: number } = {}): FeasibilityResult | null {
        const preparedBoundaryRow = prepareBoundaryRow(boundaryRow);
        const rows = [...prefixRows, preparedBoundaryRow];
        const rowError = validateDemandRows(rows, options);
        if (rowError) return finish(context, { status: 'infeasible', reason: rowError });
        const rowRelaxationError = relaxationInfeasible(rows, inventory);
        if (rowRelaxationError) return finish(context, { status: 'infeasible', reason: rowRelaxationError });
        if (prefixSpecies.has(preparedBoundaryRow.candyFamilyKey)) return null;
        if (sameTypeBoundaryComponentIndex(preparedBoundaryRow) !== null) {
          if (limits.maxTotalSurplus !== undefined || limits.maxReachedSurplus !== undefined) return null;
          return sameTypeBoundarySolve(preparedBoundaryRow, rows);
        }
        try {
          checkpoint(context);
          const boundaryRowIndex = prefixRows.length;
          const boundaryKey = typeBlockFrontierCacheKey([boundaryRowIndex], rows, inventory, context.options.itemCompareMode, context.options.maxRowSurplus, context.options.maxTotalSurplus, context.options.maxReachedSurplus, context.options.decisionOnly);
          const boundaryFrontier = buildTypeBlockFrontier([boundaryRowIndex], rows, inventory, context, boundaryKey);
          if (boundaryFrontier.length === 0) return finish(context, { status: 'infeasible', reason: 'no_type_block_feasible_state' });
          return solveWithBoundaryFrontier(rows, boundaryFrontier, limits);
        } catch (error) {
          if (error instanceof FeasibilityAbort) return fallbackResult(context, error.reason, rows, inventory);
          throw error;
        }
      },
    };
  } catch (error) {
    if (error instanceof FeasibilityAbort) return null;
    throw error;
  }
}

export function createIndependentBoundaryFeasibilitySession(
  prefixRows: FeasibilityDemandRow[],
  inventory: CandyInventory,
  options: FeasibilitySolverOptions = {},
): ReturnType<typeof createIndependentBoundaryFeasibilitySessionPrepared> {
  return createIndependentBoundaryFeasibilitySessionPrepared(prepareRows(prefixRows), inventory, options);
}

export function hasSingleRowSupplyWithinSurplus(
  row: FeasibilityDemandRow,
  inventory: CandyInventory,
  maxRowSurplus: number,
): boolean {
  const preparedRow = prepareRows([row])[0];
  const context = createContext({ maxRowSurplus });
  const species = Math.min(inventory.species[preparedRow.candyFamilyKey] ?? 0, preparedRow.totalCandy);
  const options = rowOptionsForSpecies(preparedRow, species, inventory, context);
  return options.some(option => resourceWithinInventory({
    typeS: { [preparedRow.type]: option.typeS },
    typeM: { [preparedRow.type]: option.typeM },
    universalS: option.universalS,
    universalM: option.universalM,
    universalL: option.universalL,
    quality: qualityForOption(option, preparedRow.totalCandy, preparedRow.preferZeroSurplus, preparedRow.speciesLexOrder, preparedRow.candyDemandMet),
    path: null,
  }, inventory));
}

function demandRowsFromWitness(witness: FeasibilityWitness): FeasibilityDemandRow[] {
  return witness.rows.map(({ supply: _supply, ...row }) => row);
}

function refinedSupplyRow(row: FeasiblePlanRow, speciesLexOrder: number): {
  id: string;
  name: string;
  pokedexId: number;
  candyFamilyKey: string;
  type: string;
  totalCandyCount: number;
  fixedSpecies: number;
  readonly speciesLexOrder: number;
  legacyZeroSurplusPriority?: boolean;
  candyDemandMet: boolean;
  selected: {
    species: number;
    typeS: number;
    typeM: number;
    universalS: number;
    universalM: number;
    universalL: number;
    supply: number;
    surplus: number;
  };
} {
  const supply = supplyValue(row.supply);
  return {
    id: row.pokemonId,
    name: row.pokemonId,
    pokedexId: row.pokedexId,
    candyFamilyKey: row.candyFamilyKey,
    type: row.type,
    totalCandyCount: row.totalCandy,
    fixedSpecies: row.supply.species,
    speciesLexOrder,
    legacyZeroSurplusPriority: row.preferZeroSurplus,
    candyDemandMet: row.candyDemandMet,
    selected: { ...row.supply, supply, surplus: supply - row.totalCandy },
  };
}

export function refineFeasibilityWitness(
  witness: FeasibilityWitness,
  inventory: CandyInventory,
  mode: SolverItemCompareMode,
  options: FeasibilitySolverOptions = {},
): FeasibilityRefineResult {
  const startedAt = performance.now();
  const demandRows = demandRowsFromWitness(witness);
  const preparedDemandRows = prepareRows(demandRows);
  const baselineValidation = validateFeasibilityWitness(witness, demandRows, inventory, options);
  if (!baselineValidation.valid) {
    return {
      status: 'baseline',
      witness,
      refineStatus: 'invalid_selected',
      durationMs: performance.now() - startedAt,
      reason: `baseline_witness_invalid:${baselineValidation.errors.join(',')}`,
    };
  }

  let refined;
  try {
    refined = refineExactSupply(
      witness.rows.map((row, index) => refinedSupplyRow(row, preparedDemandRows[index].speciesLexOrder)),
      inventory,
      mode,
      () => {
        if (options.deadlineMs !== undefined && performance.now() - startedAt >= options.deadlineMs) {
          throw new FeasibilityRefineAbort('deadline_exceeded');
        }
      },
    );
  } catch (error) {
    if (!(error instanceof FeasibilityRefineAbort)) throw error;
    const durationMs = performance.now() - startedAt;
    if (options.logPerformance) {
      console.info('[perf] levelPlanner.feasibilityRefine', {
        status: 'inconclusive',
        durationMs,
        rows: witness.rows.length,
        reason: error.reason,
      });
    }
    return {
      status: 'baseline',
      witness,
      refineStatus: 'inconclusive',
      durationMs,
      reason: error.reason,
    };
  }
  const durationMs = performance.now() - startedAt;
  if (options.logPerformance) {
    console.info('[perf] levelPlanner.feasibilityRefine', {
      status: refined.status,
      durationMs,
      rows: witness.rows.length,
      reason: refined.status === 'ok' ? undefined : refined.reason,
    });
  }
  if (refined.status !== 'ok') {
    return {
      status: 'baseline',
      witness,
      refineStatus: refined.status as FeasibilityRefineStatus,
      durationMs,
      reason: refined.reason,
    };
  }

  if (refined.bestRows.length !== witness.rows.length) {
    return {
      status: 'baseline',
      witness,
      refineStatus: 'ok',
      durationMs,
      reason: 'refined_row_count_mismatch',
    };
  }

  const refinedRows: FeasiblePlanRow[] = witness.rows.map((row, index) => ({
    ...row,
    supply: {
      species: refined.bestRows[index].species,
      typeS: refined.bestRows[index].typeS,
      typeM: refined.bestRows[index].typeM,
      universalS: refined.bestRows[index].universalS,
      universalM: refined.bestRows[index].universalM,
      universalL: refined.bestRows[index].universalL,
    },
  }));
  const refinedWitness: FeasibilityWitness = {
    ...witness,
    rows: refinedRows,
    remaining: expectedRemaining(refinedRows, inventory, options),
  };
  const refinedValidation = validateFeasibilityWitnessInternal(refinedWitness, demandRows, inventory, options, false);
  if (!refinedValidation.valid) {
    return {
      status: 'baseline',
      witness,
      refineStatus: 'ok',
      durationMs,
      reason: `refined_witness_invalid:${refinedValidation.errors.join(',')}`,
    };
  }
  return { status: 'refined', witness: refinedWitness, refineStatus: 'ok', durationMs };
}
