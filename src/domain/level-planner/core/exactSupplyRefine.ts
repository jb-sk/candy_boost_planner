import { CANDY_VALUES, MAX_ACCEPTABLE_SURPLUS } from '../constants';
import type { CandyInventory, SolverItemCompareMode } from '../types';
import { addItemPriority, compareItemPriority, emptyItemPriority, itemPriorityOf } from './itemPriority';
import type { ItemPriorityTuple } from './itemPriority';

export type ExactSupplyMode = SolverItemCompareMode;

export type ExactSupplyUsage = {
  species: number;
  typeS: number;
  typeM: number;
  universalS: number;
  universalM: number;
  universalL: number;
  supply: number;
  surplus: number;
};

export type ExactSupplyRow = {
  id: string;
  name: string;
  pokedexId: number;
  candyFamilyKey: string;
  type: string;
  totalCandyCount: number;
  fixedSpecies?: number;
  legacyZeroSurplusPriority?: boolean;
  /**
   * **必須。** 目的関数の `reachedSurplus` は「需要を満たした行の余りだけ」を数える（§11.3）。
   * 任意にすると、埋め忘れた行が「充足」として黙って集計され、未達行の余りが目的関数へ混ざる。
   * §10.16 修正1（`CandyTargetInput.boostedCandyUnits` をテストだけが設定していた）と同じ形なので、
   * 型で塞いである。
   */
  candyDemandMet: boolean;
  selected: ExactSupplyUsage;
};

export type ExactSupplyDemandRow = Omit<ExactSupplyRow, 'selected'> & {
  fixedSpecies: number;
};

type PreparedRow = ExactSupplyRow & {
  readonly speciesLexOrder: number;
};

type PreparedDemandRow = ExactSupplyDemandRow & {
  readonly speciesLexOrder: number;
};

type PreparedInputRow = PreparedRow | PreparedDemandRow;

type PreparedSourceRow = {
  candyFamilyKey: string;
  type: string;
  totalCandyCount: number;
  fixedSpecies?: number;
  id: string;
  legacyZeroSurplusPriority?: boolean;
  candyDemandMet: boolean;
  readonly speciesLexOrder: number;
};

/**
 * `exactSupplyObjectiveFor` に渡す行の最小形。
 *
 * **`speciesLexOrder` を任意にしないこと。** 省けると「上位から取る」という種族配分の正規形が
 * 黙って無効化され（全行の重みが0になるので `speciesLex` が常に0）、
 * **アイテム優先順位が種族配分を決めてしまう。** 外部型から `speciesLexWeight` を消したのは
 * まさにこの黙った無効化を防ぐためなので、ここで任意に戻すと同じ穴が開く。
 */
type ObjectiveSourceRow = Pick<PreparedSourceRow, 'legacyZeroSurplusPriority' | 'candyDemandMet' | 'speciesLexOrder'>;

function prepareRows(rows: ExactSupplyRow[]): PreparedRow[] {
  return rows.map((row, originalIndex) => ({
    ...row,
    // 余剰プロパティとして渡された値も信用せず、配列順を唯一の入力にする。
    speciesLexOrder: -originalIndex,
  }));
}

export type ExactSupplyObjective = {
  rawSurplus: number;
  reachedSurplus: number;
  normalizedSurplus: number;
  speciesUsed: number;
  speciesLex: number;
  zeroSurplusCount: number;
  priority: ItemPriorityTuple;
};

export type ExactSupplyStats = {
  localCandidateCounts: number[];
  finalStates: number;
};

export type ExactSupplyRefineResult =
  | {
      status: 'ok';
      selectedIsBest: boolean;
      selectedObjective: ExactSupplyObjective;
      bestObjective: ExactSupplyObjective;
      bestRows: ExactSupplyUsage[];
      stats: ExactSupplyStats;
      scope: string;
    }
  | {
      status: 'invalid_selected' | 'unsupported' | 'inconclusive' | 'no_feasible_combination';
      reason: string;
      selectedObjective?: ExactSupplyObjective;
      stats?: Partial<ExactSupplyStats>;
    };

type ExactState = {
  objective: ExactSupplyObjective;
  rows: ExactSupplyUsage[];
  species: Record<string, number>;
  typeS: Record<string, number>;
  typeM: Record<string, number>;
  universalS: number;
  universalM: number;
  universalL: number;
};
type ExactSupplyCheckpoint = () => void;

type ExactSupplyComponent = {
  indexes: number[];
  rows: Array<PreparedInputRow>;
};

type ExactComponentOption = {
  objective: ExactSupplyObjective;
  entries: Array<{ index: number; usage: ExactSupplyUsage }>;
  universalS: number;
  universalM: number;
  universalL: number;
};

type ExactComponentFrontierResult =
  | {
      status: 'ok';
      options: ExactComponentOption[];
      localCandidateCounts: number[];
      finalStates: number;
    }
  | {
      status: 'inconclusive' | 'no_feasible_combination';
      reason: string;
      localCandidateCounts?: number[];
      finalStates?: number;
    };

const MAX_EXACT_LOCAL_OPTIONS = 20_000;
const MAX_EXACT_LOCAL_VISITS = 1_000_000;
const MAX_EXACT_STATES = 200_000;
const MAX_EXACT_TRANSITIONS = 1_000_000;

function isLegacyLikeMode(mode: ExactSupplyMode): boolean {
  return mode === 'legacyImproved' || mode === 'surplusGateFirst';
}

function hasDuplicate(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function buildExactSupplyComponents(rows: PreparedInputRow[]): ExactSupplyComponent[] {
  const parent = rows.map((_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const unite = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const bySpecies = new Map<string, number>();
  const byType = new Map<string, number>();
  rows.forEach((row, index) => {
    const speciesKey = row.candyFamilyKey;
    const previousSpecies = bySpecies.get(speciesKey);
    if (previousSpecies === undefined) bySpecies.set(speciesKey, index);
    else unite(previousSpecies, index);

    const previousType = byType.get(row.type);
    if (previousType === undefined) byType.set(row.type, index);
    else unite(previousType, index);
  });

  const groups = new Map<number, number[]>();
  rows.forEach((_, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(index);
    else groups.set(root, [index]);
  });

  return [...groups.values()]
    .sort((a, b) => a[0] - b[0])
    .map(indexes => ({ indexes, rows: indexes.map(index => rows[index]) }));
}

export function exactSupplyUsageValue(usage: Omit<ExactSupplyUsage, 'supply' | 'surplus'>): number {
  return usage.species
    + usage.typeS * CANDY_VALUES.type.s
    + usage.typeM * CANDY_VALUES.type.m
    + usage.universalS * CANDY_VALUES.universal.s
    + usage.universalM * CANDY_VALUES.universal.m
    + usage.universalL * CANDY_VALUES.universal.l;
}

function emptyExactSupplyObjective(): ExactSupplyObjective {
  return { rawSurplus: 0, reachedSurplus: 0, normalizedSurplus: 0, speciesUsed: 0, speciesLex: 0, zeroSurplusCount: 0, priority: emptyItemPriority() };
}

function addExactSupplyObjective(a: ExactSupplyObjective, b: ExactSupplyObjective): ExactSupplyObjective {
  return {
    rawSurplus: a.rawSurplus + b.rawSurplus,
    reachedSurplus: a.reachedSurplus + b.reachedSurplus,
    normalizedSurplus: a.normalizedSurplus + b.normalizedSurplus,
    speciesUsed: a.speciesUsed + b.speciesUsed,
    speciesLex: a.speciesLex + b.speciesLex,
    zeroSurplusCount: a.zeroSurplusCount + b.zeroSurplusCount,
    priority: addItemPriority(a.priority, b.priority),
  };
}

/**
 * `rows[i]` と `sourceRows[i]` は**位置で対応する**。
 *
 * **`sourceRows` に既定値を置いてはいけない。** 省略できると
 * 「対応が無い」が「全行が需要充足」へ黙って化け、未達行の余りが `reachedSurplus` に混ざる。
 * 使用側が空配列を渡す場合は `exactSupplyObjectiveFor([], [])` のように**明示する**こと。
 */
export function exactSupplyObjectiveFor(rows: ExactSupplyUsage[], sourceRows: ObjectiveSourceRow[]): ExactSupplyObjective {
  return rows.reduce<ExactSupplyObjective>((acc, row, index) => ({
    rawSurplus: acc.rawSurplus + row.surplus,
    reachedSurplus: acc.reachedSurplus + (sourceRows[index]?.candyDemandMet === false ? 0 : row.surplus),
    normalizedSurplus: acc.normalizedSurplus + (row.surplus <= 2 ? 0 : row.surplus),
    speciesUsed: acc.speciesUsed + row.species,
    speciesLex: acc.speciesLex + row.species * (sourceRows[index]?.speciesLexOrder ?? 0),
    zeroSurplusCount: acc.zeroSurplusCount + (sourceRows[index]?.legacyZeroSurplusPriority && row.surplus === 0 ? 1 : 0),
    priority: addItemPriority(acc.priority, itemPriorityOf(row)),
  }), emptyExactSupplyObjective());
}

export function compareExactSupplyObjective(a: ExactSupplyObjective, b: ExactSupplyObjective, mode: ExactSupplyMode): number {
  if (a.speciesUsed !== b.speciesUsed) return a.speciesUsed > b.speciesUsed ? 1 : -1;
  if (mode === 'surplusFirst') {
    if (a.reachedSurplus !== b.reachedSurplus) return a.reachedSurplus < b.reachedSurplus ? 1 : -1;
    if (a.zeroSurplusCount !== b.zeroSurplusCount) return a.zeroSurplusCount > b.zeroSurplusCount ? 1 : -1;
    if (a.rawSurplus !== b.rawSurplus) return a.rawSurplus < b.rawSurplus ? 1 : -1;
    if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
  } else if (isLegacyLikeMode(mode)) {
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
  } else {
    if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
  }
  return compareItemPriority(a.priority, b.priority);
}

function maxSpeciesPotential(rows: ExactSupplyRow[], inventory: CandyInventory): number {
  const needBySpecies: Record<string, number> = {};
  for (const row of rows) {
    const key = row.candyFamilyKey;
    needBySpecies[key] = (needBySpecies[key] ?? 0) + row.totalCandyCount;
  }
  return Object.entries(needBySpecies).reduce(
    (sum, [key, need]) => sum + Math.min(inventory.species[key] ?? 0, need),
    0,
  );
}

function maxCandidateSurplus(
  selectedObjective: ExactSupplyObjective,
  mode: ExactSupplyMode,
  rows: ExactSupplyRow[],
  inventory: CandyInventory,
): number {
  if (isLegacyLikeMode(mode)) {
    const base = Math.max(selectedObjective.normalizedSurplus, selectedObjective.rawSurplus, MAX_ACCEPTABLE_SURPLUS);
    return selectedObjective.speciesUsed < maxSpeciesPotential(rows, inventory)
      ? Math.max(base, CANDY_VALUES.universal.l - CANDY_VALUES.species)
      : base;
  }
  return selectedObjective.speciesUsed < maxSpeciesPotential(rows, inventory)
    ? Math.max(selectedObjective.rawSurplus, CANDY_VALUES.universal.l - CANDY_VALUES.species)
    : selectedObjective.rawSurplus;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function validateSelectedRows(
  rows: ExactSupplyRow[],
  inventory: CandyInventory,
): { ok: true } | { ok: false; reason: string } {
  const speciesUsed: Record<string, number> = {};
  const typeSUsed: Record<string, number> = {};
  const typeMUsed: Record<string, number> = {};
  let universalS = 0;
  let universalM = 0;
  let universalL = 0;

  for (const row of rows) {
    const selected = row.selected;
    const values = [
      selected.species,
      selected.typeS,
      selected.typeM,
      selected.universalS,
      selected.universalM,
      selected.universalL,
      selected.supply,
      selected.surplus,
      row.totalCandyCount,
    ];
    if (!values.every(isNonNegativeInteger)) return { ok: false, reason: `non_integer_or_negative:${row.id}` };

    const value = exactSupplyUsageValue(selected);
    if (value !== selected.supply) return { ok: false, reason: `supply_mismatch:${row.id}` };
    if (selected.supply - row.totalCandyCount !== selected.surplus) return { ok: false, reason: `surplus_mismatch:${row.id}` };

    const speciesKey = row.candyFamilyKey;
    speciesUsed[speciesKey] = (speciesUsed[speciesKey] ?? 0) + selected.species;
    typeSUsed[row.type] = (typeSUsed[row.type] ?? 0) + selected.typeS;
    typeMUsed[row.type] = (typeMUsed[row.type] ?? 0) + selected.typeM;
    universalS += selected.universalS;
    universalM += selected.universalM;
    universalL += selected.universalL;
  }

  for (const [key, amount] of Object.entries(speciesUsed)) {
    if (amount > (inventory.species[key] ?? 0)) return { ok: false, reason: `species_stock_exceeded:${key}` };
  }
  for (const [type, amount] of Object.entries(typeSUsed)) {
    if (amount > (inventory.typeCandy[type]?.s ?? 0)) return { ok: false, reason: `type_s_stock_exceeded:${type}` };
  }
  for (const [type, amount] of Object.entries(typeMUsed)) {
    if (amount > (inventory.typeCandy[type]?.m ?? 0)) return { ok: false, reason: `type_m_stock_exceeded:${type}` };
  }
  if (universalS > inventory.universal.s) return { ok: false, reason: 'universal_s_stock_exceeded' };
  if (universalM > inventory.universal.m) return { ok: false, reason: 'universal_m_stock_exceeded' };
  if (universalL > inventory.universal.l) return { ok: false, reason: 'universal_l_stock_exceeded' };

  return { ok: true };
}

function enumerateRowOptions(
  row: Pick<PreparedSourceRow, 'candyFamilyKey' | 'type' | 'totalCandyCount' | 'fixedSpecies' | 'id' | 'legacyZeroSurplusPriority' | 'candyDemandMet' | 'speciesLexOrder'>,
  inventory: CandyInventory,
  maxSurplus: number,
  allowSpeciesSplit: boolean,
  needsSharedStockTracking: boolean,
  mode: ExactSupplyMode,
  checkpoint?: ExactSupplyCheckpoint,
): ExactSupplyUsage[] | 'too_many_options' | 'too_many_visits' {
  const need = row.totalCandyCount;
  const speciesStock = inventory.species[row.candyFamilyKey] ?? 0;
  const typeStock = inventory.typeCandy[row.type] ?? { s: 0, m: 0 };
  const universalStock = inventory.universal;
  const bestByResource = new Map<string, ExactSupplyUsage>();
  const seen = new Set<string>();
  let visits = 0;

  const fixedSpecies = row.fixedSpecies === undefined ? undefined : Math.max(0, Math.min(row.fixedSpecies, speciesStock, need));
  const minSpecies = fixedSpecies ?? (allowSpeciesSplit ? 0 : Math.min(speciesStock, need));
  const maxSpecies = fixedSpecies ?? Math.min(speciesStock, need);

  for (let surplus = 0; surplus <= maxSurplus; surplus++) {
    checkpoint?.();
    const supply = need + surplus;
    for (let species = minSpecies; species <= maxSpecies; species++) {
      checkpoint?.();
      const residual = supply - species;
      for (let universalL = 0; universalL <= Math.min(universalStock.l, Math.floor(residual / CANDY_VALUES.universal.l)); universalL++) {
        checkpoint?.();
        const afterL = residual - universalL * CANDY_VALUES.universal.l;
        for (let universalM = 0; universalM <= Math.min(universalStock.m, Math.floor(afterL / CANDY_VALUES.universal.m)); universalM++) {
          checkpoint?.();
          const afterM = afterL - universalM * CANDY_VALUES.universal.m;
          for (let typeM = 0; typeM <= Math.min(typeStock.m, Math.floor(afterM / CANDY_VALUES.type.m)); typeM++) {
            checkpoint?.();
            const afterTypeM = afterM - typeM * CANDY_VALUES.type.m;
            const maxTypeS = Math.min(typeStock.s, Math.floor(afterTypeM / CANDY_VALUES.type.s));
            const minTypeS = Math.max(0, Math.ceil((afterTypeM - universalStock.s * CANDY_VALUES.universal.s) / CANDY_VALUES.type.s));
            for (let typeS = maxTypeS; typeS >= minTypeS; typeS--) {
              visits++;
              if (visits % 1024 === 0) checkpoint?.();
              if (visits > MAX_EXACT_LOCAL_VISITS) return 'too_many_visits';
              const afterTypeS = afterTypeM - typeS * CANDY_VALUES.type.s;
              if (afterTypeS < 0 || afterTypeS % CANDY_VALUES.universal.s !== 0) continue;
              const universalS = afterTypeS / CANDY_VALUES.universal.s;
              if (universalS > universalStock.s) continue;
              const key = `${species}/${typeS}/${typeM}/${universalS}/${universalM}/${universalL}`;
              if (seen.has(key)) continue;
              seen.add(key);
              const option = {
                species,
                typeS,
                typeM,
                universalS,
                universalM,
                universalL,
                supply,
                surplus,
              };
              const resourceKey = needsSharedStockTracking
                ? `${option.species}|${option.typeS}|${option.typeM}|${option.universalS}|${option.universalM}|${option.universalL}`
                : `${option.universalS}|${option.universalM}|${option.universalL}`;
              const previous = bestByResource.get(resourceKey);
              if (!previous || compareExactSupplyObjective(exactSupplyObjectiveFor([option], [row]), exactSupplyObjectiveFor([previous], [row]), mode) > 0) {
                bestByResource.set(resourceKey, option);
                if (bestByResource.size > MAX_EXACT_LOCAL_OPTIONS) return 'too_many_options';
              }
            }
          }
        }
      }
    }
  }
  return [...bestByResource.values()];
}

function pruneDominatedRowOptions(
  row: Pick<PreparedSourceRow, 'legacyZeroSurplusPriority' | 'candyDemandMet' | 'speciesLexOrder'>,
  options: ExactSupplyUsage[],
  needsSharedStockTracking: boolean,
  mode: ExactSupplyMode,
): ExactSupplyUsage[] {
  if (needsSharedStockTracking || options.length <= 1) return options;
  const objectives = options.map(option => exactSupplyObjectiveFor([option], [row]));
  return options.filter((option, index) => !options.some((other, otherIndex) => {
    if (index === otherIndex) return false;
    const otherUsesNoMoreUniversal = other.universalS <= option.universalS
      && other.universalM <= option.universalM
      && other.universalL <= option.universalL;
    if (!otherUsesNoMoreUniversal) return false;
    const objectiveCompare = compareExactSupplyObjective(objectives[otherIndex], objectives[index], mode);
    if (objectiveCompare < 0) return false;
    return objectiveCompare > 0
      || other.universalS < option.universalS
      || other.universalM < option.universalM
      || other.universalL < option.universalL;
  }));
}

function bestObjective(options: ExactSupplyObjective[], mode: ExactSupplyMode): ExactSupplyObjective {
  return options.reduce((best, objective) => (
    compareExactSupplyObjective(objective, best, mode) > 0 ? objective : best
  ), exactSupplyObjectiveFor([], []));
}

function remainingUpperBounds(objectives: ExactSupplyObjective[]): ExactSupplyObjective[] {
  const bounds = Array<ExactSupplyObjective>(objectives.length + 1);
  bounds[objectives.length] = exactSupplyObjectiveFor([], []);
  for (let index = objectives.length - 1; index >= 0; index--) {
    bounds[index] = addExactSupplyObjective(objectives[index], bounds[index + 1]);
  }
  return bounds;
}

function cannotBeatIncumbent(
  partial: ExactSupplyObjective,
  remainingUpperBound: ExactSupplyObjective,
  incumbent: ExactSupplyObjective | undefined,
  mode: ExactSupplyMode,
): boolean {
  if (!incumbent) return false;
  const optimistic = addExactSupplyObjective(partial, remainingUpperBound);
  return compareExactSupplyObjective(optimistic, incumbent, mode) < 0;
}

function solveExactSupplyRowsDirect(
  rows: PreparedInputRow[],
  inventory: CandyInventory,
  mode: ExactSupplyMode,
  selectedObjective?: ExactSupplyObjective,
  maxSurplus: number = CANDY_VALUES.universal.l,
  checkpoint?: ExactSupplyCheckpoint,
): ExactSupplyRefineResult {
  const hasSharedSpecies = hasDuplicate(rows.map(row => row.candyFamilyKey));
  const hasSharedType = hasDuplicate(rows.map(row => row.type));
  const needsSharedStockTracking = hasSharedSpecies || hasSharedType;
  const localOptions: ExactSupplyUsage[][] = [];
  for (const row of rows) {
    checkpoint?.();
    const options = enumerateRowOptions(row, inventory, maxSurplus, hasSharedSpecies, needsSharedStockTracking, mode, checkpoint);
    if (options === 'too_many_options' || options === 'too_many_visits') {
      return { status: 'inconclusive', reason: options === 'too_many_options' ? 'too_many_local_options' : options, selectedObjective };
    }
    if (options.length === 0) {
      return { status: 'no_feasible_combination', reason: `no_local_options:${row.id}`, selectedObjective };
    }
    localOptions.push(pruneDominatedRowOptions(row, options, needsSharedStockTracking, mode));
  }
  const workItems = localOptions
    .map((options, index) => ({ index, row: rows[index], options }))
    .sort((a, b) => a.options.length - b.options.length);
  const workItemRemainingUpperBounds = remainingUpperBounds(workItems.map(item => (
    bestObjective(item.options.map(option => exactSupplyObjectiveFor([option], [item.row])), mode)
  )));

  const stateKey = (state: Pick<ExactState, 'species' | 'typeS' | 'typeM' | 'universalS' | 'universalM' | 'universalL'>): string => {
    if (!needsSharedStockTracking) {
      return `${state.universalS}|${state.universalM}|${state.universalL}`;
    }
    return JSON.stringify({
      s: state.species,
      ts: state.typeS,
      tm: state.typeM,
      us: state.universalS,
      um: state.universalM,
      ul: state.universalL,
    });
  };

  const initialState: ExactState = {
    objective: exactSupplyObjectiveFor([], []),
    rows: [],
    species: {},
    typeS: {},
    typeM: {},
    universalS: 0,
    universalM: 0,
    universalL: 0,
  };
  let states = new Map<string, ExactState>();
  states.set(stateKey(initialState), initialState);
  let transitions = 0;

  for (let rowIndex = 0; rowIndex < workItems.length; rowIndex++) {
    const row = workItems[rowIndex].row;
    const rowSpeciesKey = row.candyFamilyKey;
    const next = new Map<string, ExactState>();
    for (const state of states.values()) {
      for (const option of workItems[rowIndex].options) {
        transitions++;
        if (transitions % 1024 === 0) checkpoint?.();
        if (transitions > MAX_EXACT_TRANSITIONS) {
          return {
            status: 'inconclusive',
            reason: 'too_many_transitions',
            selectedObjective,
            stats: { localCandidateCounts: localOptions.map(options => options.length), finalStates: states.size },
          };
        }
        const speciesUsed = (state.species[rowSpeciesKey] ?? 0) + option.species;
        const typeSUsed = (state.typeS[row.type] ?? 0) + option.typeS;
        const typeMUsed = (state.typeM[row.type] ?? 0) + option.typeM;
        const universalS = state.universalS + option.universalS;
        const universalM = state.universalM + option.universalM;
        const universalL = state.universalL + option.universalL;
        if (speciesUsed > (inventory.species[rowSpeciesKey] ?? 0)) continue;
        const typeStock = inventory.typeCandy[row.type] ?? { s: 0, m: 0 };
        if (typeSUsed > typeStock.s || typeMUsed > typeStock.m) continue;
        if (universalS > inventory.universal.s || universalM > inventory.universal.m || universalL > inventory.universal.l) continue;
        const candidateRows = [...state.rows, option];
        const objective = addExactSupplyObjective(state.objective, exactSupplyObjectiveFor([option], [row]));
        if (cannotBeatIncumbent(objective, workItemRemainingUpperBounds[rowIndex + 1], selectedObjective, mode)) continue;
        const species = { ...state.species, [rowSpeciesKey]: speciesUsed };
        const typeS = { ...state.typeS, [row.type]: typeSUsed };
        const typeM = { ...state.typeM, [row.type]: typeMUsed };
        const candidate: ExactState = { objective, rows: candidateRows, species, typeS, typeM, universalS, universalM, universalL };
        const key = stateKey(candidate);
        const previous = next.get(key);
        if (!previous || compareExactSupplyObjective(candidate.objective, previous.objective, mode) > 0) {
          next.set(key, candidate);
          if (next.size > MAX_EXACT_STATES) {
            return {
              status: 'inconclusive',
              reason: 'too_many_states',
              selectedObjective,
              stats: { localCandidateCounts: localOptions.map(options => options.length), finalStates: next.size },
            };
          }
        }
      }
    }
    states = next;
  }

  const best = [...states.values()].sort((a, b) => -compareExactSupplyObjective(a.objective, b.objective, mode))[0];
  if (!best) {
    return {
      status: 'no_feasible_combination',
      reason: 'no_global_state',
      selectedObjective,
      stats: { localCandidateCounts: localOptions.map(options => options.length), finalStates: states.size },
    };
  }
  const bestRows = workItems.reduce<ExactSupplyUsage[]>((acc, item, processedIndex) => {
    acc[item.index] = best.rows[processedIndex];
    return acc;
  }, []);
  const effectiveSelectedObjective = selectedObjective ?? best.objective;
  return {
    status: 'ok',
    selectedIsBest: selectedObjective ? compareExactSupplyObjective(selectedObjective, best.objective, mode) === 0 : true,
    selectedObjective: effectiveSelectedObjective,
    bestObjective: best.objective,
    bestRows,
    stats: { localCandidateCounts: localOptions.map(options => options.length), finalStates: states.size },
    scope: 'fixed-demand',
  };
}

function solveExactSupplyComponentFrontier(
  component: ExactSupplyComponent,
  inventory: CandyInventory,
  mode: ExactSupplyMode,
  maxSurplus: number,
  checkpoint?: ExactSupplyCheckpoint,
): ExactComponentFrontierResult {
  const rows = component.rows;
  const hasSharedSpecies = hasDuplicate(rows.map(row => row.candyFamilyKey));
  const hasSharedType = hasDuplicate(rows.map(row => row.type));
  const needsSharedStockTracking = hasSharedSpecies || hasSharedType;
  const localOptions: ExactSupplyUsage[][] = [];

  for (const row of rows) {
    checkpoint?.();
    const options = enumerateRowOptions(row, inventory, maxSurplus, hasSharedSpecies, needsSharedStockTracking, mode, checkpoint);
    if (options === 'too_many_options' || options === 'too_many_visits') {
      return { status: 'inconclusive', reason: options === 'too_many_options' ? 'too_many_local_options' : options };
    }
    if (options.length === 0) {
      return { status: 'no_feasible_combination', reason: `no_local_options:${row.id}` };
    }
    localOptions.push(pruneDominatedRowOptions(row, options, needsSharedStockTracking, mode));
  }

  const workItems = localOptions
    .map((options, componentIndex) => ({
      index: component.indexes[componentIndex],
      row: rows[componentIndex],
      options,
    }))
    .sort((a, b) => a.options.length - b.options.length);

  const stateKey = (state: Pick<ExactState, 'species' | 'typeS' | 'typeM' | 'universalS' | 'universalM' | 'universalL'>): string => {
    if (!needsSharedStockTracking) {
      return `${state.universalS}|${state.universalM}|${state.universalL}`;
    }
    return JSON.stringify({
      s: state.species,
      ts: state.typeS,
      tm: state.typeM,
      us: state.universalS,
      um: state.universalM,
      ul: state.universalL,
    });
  };

  const initialState: ExactState = {
    objective: exactSupplyObjectiveFor([], []),
    rows: [],
    species: {},
    typeS: {},
    typeM: {},
    universalS: 0,
    universalM: 0,
    universalL: 0,
  };
  let states = new Map<string, ExactState>();
  states.set(stateKey(initialState), initialState);
  let transitions = 0;

  for (let rowIndex = 0; rowIndex < workItems.length; rowIndex++) {
    const row = workItems[rowIndex].row;
    const rowSpeciesKey = row.candyFamilyKey;
    const next = new Map<string, ExactState>();
    for (const state of states.values()) {
      for (const option of workItems[rowIndex].options) {
        transitions++;
        if (transitions % 1024 === 0) checkpoint?.();
        if (transitions > MAX_EXACT_TRANSITIONS) {
          return {
            status: 'inconclusive',
            reason: 'too_many_transitions',
            localCandidateCounts: localOptions.map(options => options.length),
            finalStates: states.size,
          };
        }
        const speciesUsed = (state.species[rowSpeciesKey] ?? 0) + option.species;
        const typeSUsed = (state.typeS[row.type] ?? 0) + option.typeS;
        const typeMUsed = (state.typeM[row.type] ?? 0) + option.typeM;
        const universalS = state.universalS + option.universalS;
        const universalM = state.universalM + option.universalM;
        const universalL = state.universalL + option.universalL;
        if (speciesUsed > (inventory.species[rowSpeciesKey] ?? 0)) continue;
        const typeStock = inventory.typeCandy[row.type] ?? { s: 0, m: 0 };
        if (typeSUsed > typeStock.s || typeMUsed > typeStock.m) continue;
        if (universalS > inventory.universal.s || universalM > inventory.universal.m || universalL > inventory.universal.l) continue;
        const objective = addExactSupplyObjective(state.objective, exactSupplyObjectiveFor([option], [row]));
        const species = { ...state.species, [rowSpeciesKey]: speciesUsed };
        const typeS = { ...state.typeS, [row.type]: typeSUsed };
        const typeM = { ...state.typeM, [row.type]: typeMUsed };
        const candidate: ExactState = {
          objective,
          rows: [...state.rows, option],
          species,
          typeS,
          typeM,
          universalS,
          universalM,
          universalL,
        };
        const key = stateKey(candidate);
        const previous = next.get(key);
        if (!previous || compareExactSupplyObjective(candidate.objective, previous.objective, mode) > 0) {
          next.set(key, candidate);
          if (next.size > MAX_EXACT_STATES) {
            return {
              status: 'inconclusive',
              reason: 'too_many_states',
              localCandidateCounts: localOptions.map(options => options.length),
              finalStates: next.size,
            };
          }
        }
      }
    }
    states = next;
  }

  const projected = new Map<string, ExactComponentOption>();
  for (const state of states.values()) {
    const entries = workItems.map((item, processedIndex) => ({
      index: item.index,
      usage: state.rows[processedIndex],
    }));
    const option: ExactComponentOption = {
      objective: state.objective,
      entries,
      universalS: state.universalS,
      universalM: state.universalM,
      universalL: state.universalL,
    };
    const key = `${option.universalS}|${option.universalM}|${option.universalL}`;
    const previous = projected.get(key);
    if (!previous || compareExactSupplyObjective(option.objective, previous.objective, mode) > 0) {
      projected.set(key, option);
    }
  }

  if (projected.size === 0) {
    return {
      status: 'no_feasible_combination',
      reason: 'no_component_state',
      localCandidateCounts: localOptions.map(options => options.length),
      finalStates: states.size,
    };
  }

  return {
    status: 'ok',
    options: [...projected.values()],
    localCandidateCounts: localOptions.map(options => options.length),
    finalStates: projected.size,
  };
}

function solveExactSupplyRowsByComponents(
  rows: PreparedInputRow[],
  inventory: CandyInventory,
  mode: ExactSupplyMode,
  selectedObjective: ExactSupplyObjective | undefined,
  maxSurplus: number,
  checkpoint?: ExactSupplyCheckpoint,
): ExactSupplyRefineResult {
  const components = buildExactSupplyComponents(rows);
  if (components.length <= 1) {
    return solveExactSupplyRowsDirect(rows, inventory, mode, selectedObjective, maxSurplus, checkpoint);
  }

  const localCandidateCounts = rows.map(() => 0);
  const componentFrontiers: ExactComponentOption[][] = [];
  let componentFinalStates = 0;
  for (const component of components) {
    const frontier = solveExactSupplyComponentFrontier(component, inventory, mode, maxSurplus, checkpoint);
    if (frontier.status !== 'ok') {
      return {
        status: frontier.status,
        reason: frontier.reason,
        selectedObjective,
        stats: { localCandidateCounts, finalStates: frontier.finalStates ?? componentFinalStates },
      };
    }
    frontier.localCandidateCounts.forEach((count, componentIndex) => {
      localCandidateCounts[component.indexes[componentIndex]] = count;
    });
    componentFinalStates += frontier.finalStates;
    componentFrontiers.push(frontier.options);
  }

  type ComponentGlobalState = {
    objective: ExactSupplyObjective;
    rows: ExactSupplyUsage[];
    universalS: number;
    universalM: number;
    universalL: number;
  };

  let states = new Map<string, ComponentGlobalState>();
  states.set('0|0|0', {
    objective: exactSupplyObjectiveFor([], []),
    rows: [],
    universalS: 0,
    universalM: 0,
    universalL: 0,
  });
  let transitions = 0;

  const sortedFrontiers = componentFrontiers
    .map((options, index) => ({ options, index }))
    .sort((a, b) => a.options.length - b.options.length);
  const componentRemainingUpperBounds = remainingUpperBounds(sortedFrontiers.map(frontier => (
    bestObjective(frontier.options.map(option => option.objective), mode)
  )));

  for (let frontierIndex = 0; frontierIndex < sortedFrontiers.length; frontierIndex++) {
    const { options } = sortedFrontiers[frontierIndex];
    const next = new Map<string, ComponentGlobalState>();
    for (const state of states.values()) {
      for (const option of options) {
        transitions++;
        if (transitions % 1024 === 0) checkpoint?.();
        if (transitions > MAX_EXACT_TRANSITIONS) {
          return {
            status: 'inconclusive',
            reason: 'too_many_component_transitions',
            selectedObjective,
            stats: { localCandidateCounts, finalStates: states.size },
          };
        }
        const universalS = state.universalS + option.universalS;
        const universalM = state.universalM + option.universalM;
        const universalL = state.universalL + option.universalL;
        if (universalS > inventory.universal.s || universalM > inventory.universal.m || universalL > inventory.universal.l) continue;

        const candidateRows = state.rows.slice();
        for (const entry of option.entries) {
          candidateRows[entry.index] = entry.usage;
        }
        const objective = addExactSupplyObjective(state.objective, option.objective);
        if (cannotBeatIncumbent(objective, componentRemainingUpperBounds[frontierIndex + 1], selectedObjective, mode)) continue;
        const candidate: ComponentGlobalState = {
          objective,
          rows: candidateRows,
          universalS,
          universalM,
          universalL,
        };
        const key = `${universalS}|${universalM}|${universalL}`;
        const previous = next.get(key);
        if (!previous || compareExactSupplyObjective(candidate.objective, previous.objective, mode) > 0) {
          next.set(key, candidate);
          if (next.size > MAX_EXACT_STATES) {
            return {
              status: 'inconclusive',
              reason: 'too_many_component_states',
              selectedObjective,
              stats: { localCandidateCounts, finalStates: next.size },
            };
          }
        }
      }
    }
    states = next;
  }

  const best = [...states.values()].sort((a, b) => -compareExactSupplyObjective(a.objective, b.objective, mode))[0];
  if (!best || best.rows.length !== rows.length || best.rows.some(row => row === undefined)) {
    return {
      status: 'no_feasible_combination',
      reason: 'no_component_global_state',
      selectedObjective,
      stats: { localCandidateCounts, finalStates: states.size },
    };
  }

  const effectiveSelectedObjective = selectedObjective ?? best.objective;
  return {
    status: 'ok',
    selectedIsBest: selectedObjective ? compareExactSupplyObjective(selectedObjective, best.objective, mode) === 0 : true,
    selectedObjective: effectiveSelectedObjective,
    bestObjective: best.objective,
    bestRows: best.rows,
    stats: { localCandidateCounts, finalStates: states.size + componentFinalStates },
    scope: 'fixed-demand-components',
  };
}

function solveExactSupplyRows(
  rows: PreparedInputRow[],
  inventory: CandyInventory,
  mode: ExactSupplyMode,
  selectedObjective?: ExactSupplyObjective,
  maxSurplus: number = CANDY_VALUES.universal.l,
  checkpoint?: ExactSupplyCheckpoint,
): ExactSupplyRefineResult {
  return solveExactSupplyRowsByComponents(rows, inventory, mode, selectedObjective, maxSurplus, checkpoint);
}

export function solveExactSupplyForFixedRows(
  rows: ExactSupplyDemandRow[],
  inventory: CandyInventory,
  mode: ExactSupplyMode,
  checkpoint?: ExactSupplyCheckpoint,
): ExactSupplyRefineResult {
  const preparedRows: PreparedDemandRow[] = rows.map((row, originalIndex) => ({
    ...row,
    speciesLexOrder: -originalIndex,
  }));
  const speciesUsed: Record<string, number> = {};
  let totalResidual = 0;
  const residualByType: Record<string, number> = {};
  for (const row of preparedRows) {
    const key = row.candyFamilyKey;
    speciesUsed[key] = (speciesUsed[key] ?? 0) + row.fixedSpecies;
    if (speciesUsed[key] > (inventory.species[key] ?? 0)) return { status: 'no_feasible_combination', reason: `species_stock_exceeded:${key}` };
    const residual = Math.max(0, row.totalCandyCount - row.fixedSpecies);
    totalResidual += residual;
    residualByType[row.type] = (residualByType[row.type] ?? 0) + residual;
  }
  const universalValue = inventory.universal.s * CANDY_VALUES.universal.s
    + inventory.universal.m * CANDY_VALUES.universal.m
    + inventory.universal.l * CANDY_VALUES.universal.l;
  const typeValue = Object.values(inventory.typeCandy).reduce((sum, stock) => sum + stock.s * CANDY_VALUES.type.s + stock.m * CANDY_VALUES.type.m, 0);
  if (totalResidual > typeValue + universalValue + preparedRows.length * CANDY_VALUES.universal.l) {
    return { status: 'no_feasible_combination', reason: 'insufficient_total_value' };
  }
  for (const [type, residual] of Object.entries(residualByType)) {
    const stock = inventory.typeCandy[type] ?? { s: 0, m: 0 };
    const localTypeValue = stock.s * CANDY_VALUES.type.s + stock.m * CANDY_VALUES.type.m;
    if (residual > localTypeValue + universalValue + preparedRows.length * CANDY_VALUES.universal.l) {
      return { status: 'no_feasible_combination', reason: `insufficient_type_or_universal_value:${type}` };
    }
  }
  if (isLegacyLikeMode(mode)) {
    const acceptable = solveExactSupplyRows(preparedRows, inventory, mode, undefined, MAX_ACCEPTABLE_SURPLUS, checkpoint);
    if (acceptable.status === 'ok') return acceptable;
    if (acceptable.status !== 'no_feasible_combination') return acceptable;
  } else {
    for (let maxSurplus = 0; maxSurplus <= CANDY_VALUES.universal.l; maxSurplus++) {
      checkpoint?.();
      const solved = solveExactSupplyRows(preparedRows, inventory, mode, undefined, maxSurplus, checkpoint);
      if (solved.status === 'ok') return solved;
      if (solved.status !== 'no_feasible_combination') return solved;
    }
  }
  return solveExactSupplyRows(preparedRows, inventory, mode, undefined, CANDY_VALUES.universal.l, checkpoint);
}

export function refineExactSupply(
  rows: ExactSupplyRow[],
  inventory: CandyInventory,
  mode: ExactSupplyMode,
  checkpoint?: ExactSupplyCheckpoint,
): ExactSupplyRefineResult {
  const preparedRows = prepareRows(rows);
  const selectedRows = preparedRows.map(row => row.selected);
  const selectedObjective = exactSupplyObjectiveFor(selectedRows, preparedRows);
  const selectedValidation = validateSelectedRows(preparedRows, inventory);
  if (!selectedValidation.ok) {
    return { status: 'invalid_selected', reason: selectedValidation.reason, selectedObjective };
  }

  const run = (maxSurplus: number): ExactSupplyRefineResult => {
    const demandRows: PreparedInputRow[] = preparedRows.map(row => ({ ...row, fixedSpecies: row.fixedSpecies }));
    const solved = solveExactSupplyRows(demandRows, inventory, mode, selectedObjective, maxSurplus, checkpoint);
    return solved.status === 'ok' ? { ...solved, scope: `candidate-surplus<=${maxSurplus}` } : solved;
  };

  const broadMaxSurplus = maxCandidateSurplus(selectedObjective, mode, preparedRows, inventory);
  if (isLegacyLikeMode(mode) && selectedObjective.normalizedSurplus > 0 && broadMaxSurplus > MAX_ACCEPTABLE_SURPLUS) {
    const acceptable = run(MAX_ACCEPTABLE_SURPLUS);
    if (acceptable.status === 'ok') return acceptable;
    if (acceptable.status !== 'no_feasible_combination') return acceptable;
  }
  return run(broadMaxSurplus);
}
