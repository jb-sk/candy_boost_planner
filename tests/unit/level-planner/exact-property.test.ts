import { describe, expect, it } from 'vitest';
import { CANDY_VALUES } from '../../../src/domain/level-planner/constants';
import { refineExactSupply } from '../../../src/domain/level-planner/core/exactSupplyRefine';
import { __levelPlannerTestHooks, solveLevelPlan } from '../../../src/domain/level-planner/core/solveLevelPlan';
import { calcExp, calcExpAndCandyMixed } from '../../../src/domain/pokesleep/exp';
import type {
  BoostKind,
  CandyInventory,
  CandySupplyBreakdown,
  LevelPlannerInput,
  SolverItemCompareMode,
} from '../../../src/domain/level-planner/types';
import type { ExactSupplyRow } from '../../../src/domain/level-planner/core/exactSupplyRefine';
import type { ExpGainNature, ExpType } from '../../../src/domain/types';

type RandomCase = {
  seed: number;
  tags: string[];
  input: LevelPlannerInput;
};

type FailureKind = 'exception' | 'supplyValueMismatch' | 'targetNotReached' | 'exactStatus' | 'notBest';

type VerificationFailure = {
  kind: FailureKind;
  message: string;
};

const modes: SolverItemCompareMode[] = ['surplusFirst', 'legacyImproved'];
const boostKinds: BoostKind[] = ['none', 'mini', 'full'];
const expTypes: ExpType[] = [600, 900, 1080, 1320];
const natures: ExpGainNature[] = ['down', 'normal', 'up'];

function supplyValue(supply: CandySupplyBreakdown): number {
  return supply.species
    + supply.type.s * CANDY_VALUES.type.s
    + supply.type.m * CANDY_VALUES.type.m
    + supply.universal.s * CANDY_VALUES.universal.s
    + supply.universal.m * CANDY_VALUES.universal.m
    + supply.universal.l * CANDY_VALUES.universal.l;
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

function hasDuplicate(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function buildCase(seed: number): RandomCase {
  const rng = createRng(seed);
  const forcedCount = envInt('LEVEL_PLANNER_EXACT_RANDOM_COUNT', 0);
  const count = forcedCount > 0 ? forcedCount : seed % 4 === 0 ? 2 : 1 + (seed % 4);
  const forcedBoostKind = process.env.LEVEL_PLANNER_EXACT_RANDOM_BOOST_KIND as BoostKind | undefined;
  const boostKind = forcedBoostKind && boostKinds.includes(forcedBoostKind) ? forcedBoostKind : pick(rng, boostKinds);
  const sharedSpecies = count > 1 && (seed % 4 === 0 || rng() < 0.25);
  const sharedType = count > 1 && (seed % 5 === 0 || rng() < 0.25);
  const tightInventory = seed % 3 === 0 || rng() < 0.35;
  const tags = [
    boostKind,
    sharedSpecies ? 'sharedSpecies' : 'uniqueSpecies',
    sharedType ? 'sharedType' : 'uniqueType',
    tightInventory ? 'tightInventory' : 'looseInventory',
  ];
  const species: Record<string, number> = {};
  const typeCandy: CandyInventory['typeCandy'] = {};
  const pokemonList: LevelPlannerInput['pokemonList'] = [];
  const needBySpecies: Record<string, number> = {};
  const needByType: Record<string, number> = {};
  let totalInventoryNeed = 0;
  let totalRequestedBoost = 0;

  for (let index = 0; index < count; index++) {
    const pokedexId = sharedSpecies && index > 0 && (index === 1 || rng() < 0.7)
      ? 10_000 + seed * 10
      : 10_000 + seed * 10 + index;
    const type = sharedType && index > 0 && (index === 1 || rng() < 0.7)
      ? `exact_type_${seed}_shared`
      : `exact_type_${seed}_${index}`;
    const currentLevel = int(rng, 8, 40);
    const targetLevel = int(rng, currentLevel + 1, Math.min(70, currentLevel + 3));
    const expType = pick(rng, expTypes);
    const nature = pick(rng, natures);
    const currentExpInLevel = int(rng, 0, Math.max(0, calcExp(currentLevel, currentLevel + 1, expType) - 1));
    const targetExpInLevel = targetLevel >= 70
      ? 0
      : int(rng, 0, Math.floor(calcExp(targetLevel, targetLevel + 1, expType) * 0.7));
    const boostAllowed = rng() >= 0.15;
    const requestedBoostCandy = boostKind === 'none' || !boostAllowed ? 0 : int(rng, 0, 50);
    const target = calcExpAndCandyMixed({
      srcLevel: currentLevel,
      dstLevel: targetLevel,
      dstExpInLevel: targetExpInLevel,
      expType,
      nature,
      boost: boostKind,
      boostCandy: requestedBoostCandy,
      expGot: currentExpInLevel,
    });
    const targetNeed = target.boostCandy + target.normalCandy;
    const hasCandyTarget = targetNeed > 0 && rng() < 0.35;
    const candyTarget = hasCandyTarget
      ? {
          totalCandyUnits: int(rng, Math.max(1, Math.floor(targetNeed * 0.45)), targetNeed),
          boostedCandyUnits: boostKind === 'none' ? 0 : int(rng, 0, Math.min(requestedBoostCandy, targetNeed)),
        }
      : undefined;
    const inventoryNeed = candyTarget?.totalCandyUnits ?? targetNeed;
    const speciesKey = String(pokedexId);
    needBySpecies[speciesKey] = (needBySpecies[speciesKey] ?? 0) + inventoryNeed;
    needByType[type] = (needByType[type] ?? 0) + inventoryNeed;
    totalInventoryNeed += inventoryNeed;
    totalRequestedBoost += candyTarget?.boostedCandyUnits ?? target.boostCandy;
    pokemonList.push({
      pokemonId: `case-${seed}-${index}`,
      pokedexId,
      name: `Case ${seed}-${index}`,
      type,
      currentLevel,
      currentExpInLevel,
      targetLevel,
      targetExpInLevel,
      candyTarget,
      expType,
      nature,
      requestedBoostCandy,
      boostAllowed,
      priorityIndex: index,
    });
  }

  for (const [key, need] of Object.entries(needBySpecies)) {
    species[key] = int(rng, 0, Math.min(need, tightInventory ? Math.ceil(need * 0.8) : need));
  }
  for (const [type, need] of Object.entries(needByType)) {
    typeCandy[type] = {
      s: int(rng, 0, tightInventory ? Math.ceil(need / CANDY_VALUES.type.s / 2) : Math.ceil(need / CANDY_VALUES.type.s) + 1),
      m: int(rng, 0, tightInventory ? Math.ceil(need / CANDY_VALUES.type.m / 2) : Math.ceil(need / CANDY_VALUES.type.m) + 1),
    };
  }
  const speciesValue = Object.values(species).reduce((sum, value) => sum + value, 0);
  const typeValue = Object.values(typeCandy).reduce(
    (sum, value) => sum + value.s * CANDY_VALUES.type.s + value.m * CANDY_VALUES.type.m,
    0,
  );
  const residual = Math.max(0, totalInventoryNeed + (tightInventory ? 2 : 10) - speciesValue - typeValue);
  const universalM = int(rng, 0, tightInventory ? Math.ceil(residual / CANDY_VALUES.universal.m / 2) : Math.ceil(residual / CANDY_VALUES.universal.m) + 1);
  const universalL = int(rng, 0, tightInventory ? 0 : 1);
  const afterLargeUniversal = Math.max(0, residual - universalM * CANDY_VALUES.universal.m - universalL * CANDY_VALUES.universal.l);
  const universalS = Math.ceil(afterLargeUniversal / CANDY_VALUES.universal.s) + (tightInventory ? 2 : 5);
  const guaranteedValue = speciesValue + typeValue + universalM * CANDY_VALUES.universal.m + universalL * CANDY_VALUES.universal.l + universalS;
  const reachabilityBuffer = Math.max(0, totalInventoryNeed - guaranteedValue);

  const result: RandomCase = {
    seed,
    tags,
    input: {
      pokemonList,
      dreamShards: Number.MAX_SAFE_INTEGER,
      boost: {
        kind: boostKind,
        limit: boostKind === 'none' ? 0 : totalRequestedBoost + int(rng, tightInventory ? 0 : 5, tightInventory ? 5 : 40),
      },
      candyInventory: {
        species,
        typeCandy,
        universal: {
          s: universalS + reachabilityBuffer,
          m: universalM,
          l: universalL,
        },
      },
    },
  };
  const universalSReachabilityBuffer = Math.ceil(totalInventoryNeed / CANDY_VALUES.universal.s);
  result.input.candyInventory.universal.s += universalSReachabilityBuffer;
  return result;
}

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function exactPropertySeeds(): number[] {
  const runs = Math.max(0, envInt('LEVEL_PLANNER_EXACT_RANDOM_RUNS', 0));
  if (runs <= 0) return [1, 2, 3, 5, 6, 7, 10, 11, 15];
  const start = envInt('LEVEL_PLANNER_EXACT_RANDOM_START', 1);
  return Array.from({ length: runs }, (_, index) => start + index);
}

function cloneInput(input: LevelPlannerInput): LevelPlannerInput {
  return JSON.parse(JSON.stringify(input)) as LevelPlannerInput;
}

function normalizeInput(input: LevelPlannerInput): LevelPlannerInput {
  const cloned = cloneInput(input);
  const speciesKeys = new Set(cloned.pokemonList.map(pokemon => String(pokemon.pokedexId)));
  const types = new Set(cloned.pokemonList.map(pokemon => pokemon.type));
  cloned.pokemonList = cloned.pokemonList.map((pokemon, index) => ({
    ...pokemon,
    priorityIndex: index,
    candyTarget: pokemon.candyTarget
      ? {
          totalCandyUnits: Math.max(1, pokemon.candyTarget.totalCandyUnits),
          boostedCandyUnits: Math.min(
            Math.max(0, pokemon.candyTarget.boostedCandyUnits ?? 0),
            pokemon.candyTarget.totalCandyUnits,
          ),
        }
      : undefined,
  }));
  cloned.candyInventory.species = Object.fromEntries(
    Object.entries(cloned.candyInventory.species).filter(([key]) => speciesKeys.has(key)),
  );
  cloned.candyInventory.typeCandy = Object.fromEntries(
    [...types].map(type => [type, cloned.candyInventory.typeCandy[type] ?? { s: 0, m: 0 }]),
  );
  if (cloned.boost.kind === 'none') cloned.boost.limit = 0;
  return cloned;
}

function detectFailure({ seed, input, tags }: RandomCase, mode: SolverItemCompareMode): VerificationFailure | null {
  __levelPlannerTestHooks.clearCandidateCache();
  let result: ReturnType<typeof solveLevelPlan>;
  try {
    result = solveLevelPlan({ ...input, options: { itemCompareMode: mode } });
  } catch (error) {
    return {
      kind: 'exception',
      message: `seed=${seed} mode=${mode} tags=${tags.join(',')} exception=${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const rows: ExactSupplyRow[] = [];
  for (const pokemon of result.pokemonResults) {
    const supply = pokemon.reachableLine.candySupply;
    const value = supplyValue(supply);
    const expectedValue = pokemon.reachableLine.totalCandyUnitsUsed + pokemon.reachableLine.surplusCandyValue;
    const source = input.pokemonList.find(p => p.pokemonId === pokemon.pokemonId);

    if (value !== expectedValue) {
      return {
        kind: 'supplyValueMismatch',
        message: `seed=${seed} mode=${mode} tags=${tags.join(',')} row=${pokemon.name} supplyValue=${value} expected=${expectedValue}`,
      };
    }
    if (mode !== 'surplusFirst' && !pokemon.targetReached) {
      return {
        kind: 'targetNotReached',
        message: `seed=${seed} mode=${mode} tags=${tags.join(',')} row=${pokemon.name} target not reached`,
      };
    }

    rows.push({
      id: pokemon.pokemonId,
      name: pokemon.name,
      pokedexId: pokemon.pokedexId,
      type: source?.type ?? '',
      totalCandyCount: pokemon.reachableLine.totalCandyUnitsUsed,
      selected: {
        species: supply.species,
        typeS: supply.type.s,
        typeM: supply.type.m,
        universalS: supply.universal.s,
        universalM: supply.universal.m,
        universalL: supply.universal.l,
        supply: value,
        surplus: pokemon.reachableLine.surplusCandyValue,
      },
    });
  }

  const exact = refineExactSupply(rows, input.candyInventory, mode);
  if (exact.status !== 'ok') {
    return {
      kind: 'exactStatus',
      message: `seed=${seed} mode=${mode} tags=${tags.join(',')} exactStatus=${exact.status} reason=${exact.reason}`,
    };
  }
  if (!exact.selectedIsBest) {
    return {
      kind: 'notBest',
      message: [
        `seed=${seed}`,
        `mode=${mode}`,
        `tags=${tags.join(',')}`,
        `selected=${JSON.stringify(exact.selectedObjective)}`,
        `best=${JSON.stringify(exact.bestObjective)}`,
        `selectedRows=${JSON.stringify(rows.map(row => row.selected))}`,
        `bestRows=${JSON.stringify(exact.bestRows)}`,
      ].join(' '),
    };
  }
  return null;
}

function formatInputLiteral(input: LevelPlannerInput): string {
  return JSON.stringify(input, null, 2)
    .replace(/"([^"]+)":/g, '$1:')
    .replace(/"kind": "([^"]+)"/g, 'kind: \'$1\'')
    .replace(/"pokemonId": "([^"]+)"/g, 'pokemonId: \'$1\'')
    .replace(/"name": "([^"]+)"/g, 'name: \'$1\'')
    .replace(/"type": "([^"]+)"/g, 'type: \'$1\'')
    .replace(/"nature": "([^"]+)"/g, 'nature: \'$1\'')
    .replace(/9007199254740991/g, 'Number.MAX_SAFE_INTEGER');
}

function shrinkCase(original: RandomCase, mode: SolverItemCompareMode, kind: FailureKind): RandomCase {
  let current: RandomCase = { ...original, tags: [...original.tags, 'shrunk'], input: normalizeInput(original.input) };
  const stillFails = (input: LevelPlannerInput): boolean => detectFailure({ ...current, input: normalizeInput(input) }, mode)?.kind === kind;
  const adopt = (input: LevelPlannerInput): boolean => {
    const normalized = normalizeInput(input);
    if (!stillFails(normalized)) return false;
    current = { ...current, input: normalized };
    return true;
  };
  const mutate = (change: (input: LevelPlannerInput) => void): boolean => {
    const candidate = cloneInput(current.input);
    const before = JSON.stringify(candidate);
    change(candidate);
    if (JSON.stringify(candidate) === before) return false;
    return adopt(candidate);
  };
  const reduceNumber = (read: (input: LevelPlannerInput) => number, write: (input: LevelPlannerInput, value: number) => void): boolean => {
    const value = read(current.input);
    const candidates = [...new Set([0, 1, 2, 3, 5, 10, Math.floor(value / 2), value - 1])]
      .filter(candidate => candidate >= 0 && candidate < value)
      .sort((a, b) => a - b);
    for (const candidate of candidates) {
      if (mutate(input => write(input, candidate))) return true;
    }
    return false;
  };

  for (let pass = 0; pass < 100; pass++) {
    let changed = false;

    for (let index = 0; index < current.input.pokemonList.length && current.input.pokemonList.length > 1; index++) {
      changed = mutate(input => input.pokemonList.splice(index, 1)) || changed;
      if (changed) break;
    }
    if (changed) continue;

    for (let index = 0; index < current.input.pokemonList.length; index++) {
      changed = mutate(input => { delete input.pokemonList[index].candyTarget; }) || changed;
      if (changed) break;
      changed = reduceNumber(input => input.pokemonList[index].currentExpInLevel, (input, value) => { input.pokemonList[index].currentExpInLevel = value; }) || changed;
      if (changed) break;
      changed = reduceNumber(input => input.pokemonList[index].targetExpInLevel ?? 0, (input, value) => { input.pokemonList[index].targetExpInLevel = value; }) || changed;
      if (changed) break;
      changed = reduceNumber(input => input.pokemonList[index].requestedBoostCandy, (input, value) => { input.pokemonList[index].requestedBoostCandy = value; }) || changed;
      if (changed) break;
      changed = mutate((input) => {
        const pokemon = input.pokemonList[index];
        pokemon.nature = 'normal';
      }) || changed;
      if (changed) break;
      changed = mutate((input) => {
        const pokemon = input.pokemonList[index];
        pokemon.expType = 600;
      }) || changed;
      if (changed) break;
      changed = mutate((input) => {
        const pokemon = input.pokemonList[index];
        if (pokemon.targetLevel > pokemon.currentLevel + 1) {
          pokemon.targetLevel = pokemon.currentLevel + 1;
          pokemon.targetExpInLevel = 0;
        }
      }) || changed;
      if (changed) break;
      changed = mutate((input) => {
        const pokemon = input.pokemonList[index];
        if (pokemon.currentLevel > 8) {
          pokemon.currentLevel = 8;
          pokemon.targetLevel = 9;
          pokemon.currentExpInLevel = 0;
          pokemon.targetExpInLevel = 0;
        }
      }) || changed;
      if (changed) break;
      if (current.input.pokemonList[index].candyTarget) {
        changed = reduceNumber(input => input.pokemonList[index].candyTarget?.totalCandyUnits ?? 0, (input, value) => {
          if (!input.pokemonList[index].candyTarget) return;
          input.pokemonList[index].candyTarget.totalCandyUnits = Math.max(1, value);
        }) || changed;
        if (changed) break;
        changed = reduceNumber(input => input.pokemonList[index].candyTarget?.boostedCandyUnits ?? 0, (input, value) => {
          if (!input.pokemonList[index].candyTarget) return;
          input.pokemonList[index].candyTarget.boostedCandyUnits = value;
        }) || changed;
        if (changed) break;
      }
    }
    if (changed) continue;

    changed = reduceNumber(input => input.dreamShards, (input, value) => { input.dreamShards = value; }) || changed;
    if (changed) continue;
    changed = reduceNumber(input => input.boost.limit, (input, value) => { input.boost.limit = value; }) || changed;
    if (changed) continue;

    for (const key of Object.keys(current.input.candyInventory.species)) {
      changed = reduceNumber(input => input.candyInventory.species[key] ?? 0, (input, value) => { input.candyInventory.species[key] = value; }) || changed;
      if (changed) break;
    }
    if (changed) continue;

    for (const type of Object.keys(current.input.candyInventory.typeCandy)) {
      changed = reduceNumber(input => input.candyInventory.typeCandy[type]?.s ?? 0, (input, value) => { input.candyInventory.typeCandy[type].s = value; }) || changed;
      if (changed) break;
      changed = reduceNumber(input => input.candyInventory.typeCandy[type]?.m ?? 0, (input, value) => { input.candyInventory.typeCandy[type].m = value; }) || changed;
      if (changed) break;
    }
    if (changed) continue;

    changed = reduceNumber(input => input.candyInventory.universal.s, (input, value) => { input.candyInventory.universal.s = value; }) || changed;
    if (changed) continue;
    changed = reduceNumber(input => input.candyInventory.universal.m, (input, value) => { input.candyInventory.universal.m = value; }) || changed;
    if (changed) continue;
    changed = reduceNumber(input => input.candyInventory.universal.l, (input, value) => { input.candyInventory.universal.l = value; }) || changed;
    if (changed) continue;

    break;
  }

  return current;
}

function verifyCase(current: RandomCase, mode: SolverItemCompareMode): void {
  const failure = detectFailure(current, mode);
  if (!failure) return;
  const shrunk = shrinkCase(current, mode, failure.kind);
  const shrunkFailure = detectFailure(shrunk, mode);
  throw new Error([
    failure.message,
    shrunkFailure ? `shrunkFailure=${shrunkFailure.message}` : 'shrunkFailure=<not reproduced>',
    'Pasteable regression input:',
    `const input: LevelPlannerInput = ${formatInputLiteral(shrunk.input)};`,
  ].join('\n'));
}

const realCaseBaseInput = {
  pokemonList: [
    { pokemonId: 'id_z4cy1n49yzj_mrg52n3n', pokedexId: 923, name: '80パーモット', type: 'electric' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, candyTarget: { totalCandyUnits: 632 }, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
    { pokemonId: 'id_5tlnyjy0ssi_mrg53aly', pokedexId: 845, name: '70ウッウ（油）', type: 'flying' as const, currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, targetExpInLevel: 0, candyTarget: { totalCandyUnits: 298 }, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 1 },
    { pokemonId: 'id_sds1zvu57t_mrg54714', pokedexId: 700, name: '70仮ニンフィア', type: 'fairy' as const, currentLevel: 16, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, candyTarget: { totalCandyUnits: 3598 }, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 2 },
    { pokemonId: 'id_q0yknqotgp_mrg5jsml', pokedexId: 149, name: '80カイリュー', type: 'dragon' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, candyTarget: { totalCandyUnits: 948 }, expType: 900 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 3 },
    { pokemonId: 'id_kwjj92i5lf_mrgdh5jn', pokedexId: 317, name: '70マルノーム', type: 'poison' as const, currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, targetExpInLevel: 0, candyTarget: { totalCandyUnits: 308 }, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 4 },
  ],
  dreamShards: Number.MAX_SAFE_INTEGER,
  boost: { kind: 'none' as const, limit: 0 },
  candyInventory: {
    species: { '923': 181, '845': 0, '700': 2947, '149': 436, '317': 272 },
    typeCandy: {
      electric: { s: 0, m: 0 },
      flying: { s: 0, m: 0 },
      fairy: { s: 0, m: 10 },
      dragon: { s: 13, m: 0 },
      poison: { s: 0, m: 1 },
    },
    universal: { s: 432, m: 17, l: 0 },
  },
} satisfies LevelPlannerInput;

type ExpectedUsage = ExactSupplyRow['selected'];

function expectedRowsForInput(input: LevelPlannerInput, expected: ExpectedUsage[]): ExactSupplyRow[] {
  return input.pokemonList.map((pokemon, index) => ({
    id: pokemon.pokemonId,
    name: pokemon.name,
    pokedexId: pokemon.pokedexId,
    type: pokemon.type,
    totalCandyCount: pokemon.candyTarget?.totalCandyUnits ?? 0,
    legacyZeroSurplusPriority: pokemon.targetLevel >= 70 && (pokemon.targetExpInLevel ?? 0) === 0,
    selected: expected[index],
  }));
}

function rowForResult(input: LevelPlannerInput, result: ReturnType<typeof solveLevelPlan>): ExactSupplyRow[] {
  return result.pokemonResults.map((pokemon) => {
    const source = input.pokemonList.find(row => row.pokemonId === pokemon.pokemonId);
    const supply = pokemon.reachableLine.candySupply;
    return {
      id: pokemon.pokemonId,
      name: pokemon.name,
      pokedexId: pokemon.pokedexId,
      type: source?.type ?? '',
      totalCandyCount: pokemon.reachableLine.totalCandyUnitsUsed,
      legacyZeroSurplusPriority: pokemon.reachableLine.level >= 70 && pokemon.reachableLine.expInLevel === 0,
      selected: {
        species: supply.species,
        typeS: supply.type.s,
        typeM: supply.type.m,
        universalS: supply.universal.s,
        universalM: supply.universal.m,
        universalL: supply.universal.l,
        supply: supplyValue(supply),
        surplus: pokemon.reachableLine.surplusCandyValue,
      },
    };
  });
}

function expectRowsAreExactBest(
  input: LevelPlannerInput,
  mode: SolverItemCompareMode,
  expected: ExpectedUsage[],
): void {
  const exact = refineExactSupply(expectedRowsForInput(input, expected), input.candyInventory, mode);
  expect(exact.status).toBe('ok');
  if (exact.status !== 'ok') return;
  expect(exact.selectedIsBest).toBe(true);
}

function expectPlanIsExactBest(
  input: LevelPlannerInput,
  mode: SolverItemCompareMode,
): ReturnType<typeof refineExactSupply> {
  __levelPlannerTestHooks.clearCandidateCache();
  const result = solveLevelPlan({ ...input, options: { itemCompareMode: mode } });
  const rows = rowForResult(input, result);
  if (mode !== 'surplusFirst') {
    expect(result.pokemonResults.map(pokemon => pokemon.targetReached)).toEqual(input.pokemonList.map(() => true));
  }
  const exact = refineExactSupply(rows, input.candyInventory, mode);
  expect(exact.status).toBe('ok');
  if (exact.status !== 'ok') return exact;
  expect(exact.selectedIsBest, [
    `mode=${mode}`,
    `selected=${JSON.stringify(exact.selectedObjective)}`,
    `best=${JSON.stringify(exact.bestObjective)}`,
    `selectedRows=${JSON.stringify(rows.map(row => row.selected))}`,
    `bestRows=${JSON.stringify(exact.bestRows)}`,
  ].join(' ')).toBe(true);
  return exact;
}

function expectPlanMatchesExactBest(
  input: LevelPlannerInput,
  mode: SolverItemCompareMode,
  expected: ExpectedUsage[],
): void {
  __levelPlannerTestHooks.clearCandidateCache();
  const result = solveLevelPlan({ ...input, options: { itemCompareMode: mode } });
  const rows = rowForResult(input, result);
  expect(rows.map(row => row.selected)).toEqual(expected);
  const exact = refineExactSupply(rows, input.candyInventory, mode);
  expect(exact.status).toBe('ok');
  if (exact.status !== 'ok') return;
  expect(exact.selectedIsBest).toBe(true);
}

describe('level planner exact property checks', () => {
  it('小さなランダムケースでは現行配分が独立exact solverの最良解と一致する', () => {
    const seeds = exactPropertySeeds();
    const cases = seeds.map(seed => buildCase(seed));
    expect(cases.filter(testCase => testCase.input.pokemonList.length > 1).length).toBeGreaterThanOrEqual(9);
    expect(cases.filter(testCase => hasDuplicate(testCase.input.pokemonList.map(pokemon => pokemon.type))).length).toBeGreaterThanOrEqual(1);
    for (const current of cases) {
      for (const mode of modes) {
        verifyCase(current, mode);
      }
    }
  });

  it('実ケース: バッグ圧縮はTSVの選択がexact best相当になる', () => {
    const legacyImprovedRows = [
      { species: 181, typeS: 0, typeM: 0, universalS: 137, universalM: 2, universalL: 0, supply: 632, surplus: 0 },
      { species: 0, typeS: 0, typeM: 0, universalS: 86, universalM: 2, universalL: 0, supply: 298, surplus: 0 },
      { species: 2947, typeS: 0, typeM: 10, universalS: 127, universalM: 1, universalL: 0, supply: 3598, surplus: 0 },
      { species: 436, typeS: 11, typeM: 0, universalS: 76, universalM: 12, universalL: 0, supply: 948, surplus: 0 },
      { species: 272, typeS: 0, typeM: 1, universalS: 4, universalM: 0, universalL: 0, supply: 309, surplus: 1 },
    ];
    expectRowsAreExactBest(realCaseBaseInput, 'legacyImproved', legacyImprovedRows);

    const exact = expectPlanIsExactBest(realCaseBaseInput, 'legacyImproved');
    expect(exact.status).toBe('ok');
    if (exact.status !== 'ok') return;
    expect(exact.selectedObjective.rawSurplus).toBe(1);
    expect(exact.selectedObjective.normalizedSurplus).toBe(0);
    expect(exact.selectedObjective.zeroSurplusCount).toBe(4);
    expect(exact.selectedObjective.legacyPriority).toEqual([0, -17, 11, 11]);
  });

  it('実ケース: アメの余り最小は全行余り0のexact bestを返す', () => {
    expectPlanMatchesExactBest({
      ...realCaseBaseInput,
      candyInventory: {
        ...realCaseBaseInput.candyInventory,
        universal: { s: 432, m: 19, l: 0 },
      },
    }, 'surplusFirst', [
      { species: 181, typeS: 0, typeM: 0, universalS: 137, universalM: 2, universalL: 0, supply: 632, surplus: 0 },
      { species: 0, typeS: 0, typeM: 0, universalS: 86, universalM: 2, universalL: 0, supply: 298, surplus: 0 },
      { species: 2947, typeS: 0, typeM: 10, universalS: 127, universalM: 1, universalL: 0, supply: 3598, surplus: 0 },
      { species: 436, typeS: 13, typeM: 0, universalS: 60, universalM: 14, universalL: 0, supply: 948, surplus: 0 },
      { species: 272, typeS: 0, typeM: 0, universalS: 12, universalM: 0, universalL: 0, supply: 308, surplus: 0 },
    ]);
  });
});
