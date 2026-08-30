import { describe, expect, it } from 'vitest';
import { isPerfWallClockEnabled } from '../../helpers/isPerfWallClockEnabled';
import { perfBudgetMs } from './perfBudget';
import { solveFeasibilityForFixedRows } from '../../../src/domain/level-planner/core/feasibilityWitness';
import {
  __levelPlannerTestHooks,
  solveLevelPlanWithBudget,
} from '../../../src/domain/level-planner/core/solveLevelPlan';
import type {
  CandyInventory,
  FeasibilityDemandRow,
  LevelPlannerInput,
  SolverItemCompareMode,
} from '../../../src/domain/level-planner/types';

const inventory: CandyInventory = {
  species: { '921': 0, '845': 0, '133': 1000, '147': 578, '316': 272 },
  typeCandy: {
    Electric: { s: 0, m: 0 },
    Flying: { s: 0, m: 0 },
    Fairy: { s: 0, m: 10 },
    Dragon: { s: 13, m: 0 },
    Poison: { s: 0, m: 4 },
    Fire: { s: 0, m: 0 },
  },
  universal: { s: 432, m: 102, l: 9 },
};

const fixedRows: FeasibilityDemandRow[] = [
  {
    pokemonId: 'pawmot',
    pokedexId: 923,
    candyFamilyKey: '921',
    type: 'Electric',
    totalCandy: 161,
    boostCandy: 0,
    normalCandy: 161,
    shards: 165_084,
    reachedLv: 67,
    expInLevel: 1099,
    candyDemandMet: true,
    preferZeroSurplus: false,
  },
  {
    pokemonId: 'cramorant',
    pokedexId: 845,
    candyFamilyKey: '845',
    type: 'Flying',
    totalCandy: 298,
    boostCandy: 0,
    normalCandy: 298,
    shards: 364_899,
    reachedLv: 70,
    expInLevel: 0,
    candyDemandMet: true,
    preferZeroSurplus: true,
  },
  {
    pokemonId: 'sylveon',
    pokedexId: 700,
    candyFamilyKey: '133',
    type: 'Fairy',
    totalCandy: 825,
    boostCandy: 350,
    normalCandy: 475,
    shards: 1_235_190,
    reachedLv: 65,
    expInLevel: 1540,
    candyDemandMet: true,
    preferZeroSurplus: false,
  },
  {
    pokemonId: 'dragonite',
    pokedexId: 149,
    candyFamilyKey: '147',
    type: 'Dragon',
    totalCandy: 585,
    boostCandy: 0,
    normalCandy: 585,
    shards: 598_346,
    reachedLv: 68,
    expInLevel: 1157,
    candyDemandMet: true,
    preferZeroSurplus: false,
  },
  {
    pokemonId: 'swalot',
    pokedexId: 317,
    candyFamilyKey: '316',
    type: 'Poison',
    totalCandy: 1089,
    boostCandy: 0,
    normalCandy: 1089,
    shards: 773_802,
    reachedLv: 65,
    expInLevel: 1547,
    candyDemandMet: true,
    preferZeroSurplus: false,
  },
  {
    pokemonId: 'flareon',
    pokedexId: 136,
    candyFamilyKey: '133',
    type: 'Fire',
    totalCandy: 0,
    boostCandy: 0,
    normalCandy: 0,
    shards: 0,
    reachedLv: 50,
    expInLevel: 0,
    candyDemandMet: false,
    preferZeroSurplus: false,
  },
];

const modes = [
  'surplusFirst',
  'surplusGateFirst',
  'legacyImproved',
] satisfies SolverItemCompareMode[];

function input(mode: SolverItemCompareMode): LevelPlannerInput {
  return {
    pokemonList: [
      {
        pokemonId: 'pawmot',
        pokedexId: 923,
        candyFamilyKey: '921',
        name: '80パーモット',
        type: 'Electric',
        currentLevel: 66,
        currentExpInLevel: 190,
        targetLevel: 70,
        targetExpInLevel: 0,
        candyTarget: { totalCandyUnits: 161, boostedCandyUnits: 0 },
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 0,
        boostAllowed: true,
        priorityIndex: 0,
      },
      {
        pokemonId: 'cramorant',
        pokedexId: 845,
        candyFamilyKey: '845',
        name: '70ウッウ（油）',
        type: 'Flying',
        currentLevel: 68,
        currentExpInLevel: 198,
        targetLevel: 70,
        targetExpInLevel: 0,
        expType: 600,
        nature: 'down',
        requestedBoostCandy: 0,
        boostAllowed: true,
        priorityIndex: 1,
      },
      {
        pokemonId: 'sylveon',
        pokedexId: 700,
        candyFamilyKey: '133',
        name: '70仮ニンフィア',
        type: 'Fairy',
        currentLevel: 56,
        currentExpInLevel: 2144,
        targetLevel: 70,
        targetExpInLevel: 0,
        // アメブ上限は総数と同じ（＝内数の制約なし）。requestedBoostCandy 350 が実効上限になる
        candyTarget: { totalCandyUnits: 825, boostedCandyUnits: 825 },
        expType: 600,
        nature: 'down',
        requestedBoostCandy: 350,
        boostAllowed: true,
        priorityIndex: 2,
      },
      {
        pokemonId: 'dragonite',
        pokedexId: 149,
        candyFamilyKey: '147',
        name: '80カイリュー',
        type: 'Dragon',
        currentLevel: 65,
        currentExpInLevel: 564,
        targetLevel: 70,
        targetExpInLevel: 0,
        candyTarget: { totalCandyUnits: 585, boostedCandyUnits: 0 },
        expType: 900,
        nature: 'normal',
        requestedBoostCandy: 0,
        boostAllowed: true,
        priorityIndex: 3,
      },
      {
        pokemonId: 'swalot',
        pokedexId: 317,
        candyFamilyKey: '316',
        name: '70マルノーム',
        type: 'Poison',
        currentLevel: 57,
        currentExpInLevel: 1553,
        targetLevel: 70,
        targetExpInLevel: 0,
        candyTarget: { totalCandyUnits: 1089, boostedCandyUnits: 0 },
        expType: 600,
        nature: 'down',
        requestedBoostCandy: 0,
        boostAllowed: true,
        priorityIndex: 4,
      },
      {
        pokemonId: 'flareon',
        pokedexId: 136,
        candyFamilyKey: '133',
        name: 'ブースター',
        type: 'Fire',
        currentLevel: 50,
        currentExpInLevel: 0,
        targetLevel: 60,
        targetExpInLevel: 0,
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 350,
        boostAllowed: true,
        priorityIndex: 5,
      },
    ],
    dreamShards: 10_000_000,
    boost: { kind: 'mini', limit: 350 },
    candyInventory: inventory,
    options: { itemCompareMode: mode },
  };
}

describe('reported six-row reproduction', () => {
  it.each(modes)('solves the selected fixed rows exactly: %s', mode => {
    const result = solveFeasibilityForFixedRows(fixedRows, inventory, {
      boostKind: 'mini',
      boostLimit: 350,
      dreamShards: 10_000_000,
      itemCompareMode: mode,
      deadlineMs: 5_000,
    });
    expect(result.status).toBe('feasible');
    expect(Math.max(...result.stats.rowOptionCounts)).toBeLessThanOrEqual(1_200);
    expect(Math.max(...result.stats.typeBlockFrontierCounts)).toBeLessThanOrEqual(512);
    expect(result.stats.globalKeyCount).toBeLessThanOrEqual(2_000);
    expect(result.stats.transitions).toBeLessThanOrEqual(75_000);
    if (isPerfWallClockEnabled()) {
      expect(result.stats.durationMs).toBeLessThan(perfBudgetMs(1_000));
    }
    console.info('[reported-six-row-fixed]', mode, result.status, result.stats);
  }, 60_000);

  it.each(modes)('solves the full reported plan exactly and quickly: %s', mode => {
    __levelPlannerTestHooks.clearCandidateCache();
    const startedAt = performance.now();
    const outcome = solveLevelPlanWithBudget(input(mode), {
      calculationMode: 'exact',
      deadlineMs: 2_000,
    });
    const durationMs = performance.now() - startedAt;

    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    const result = outcome.result;
    const lines = result.pokemonResults.map(row => row.reachableLine);

    expect(lines.map(line => line.totalCandyUnitsUsed)).toEqual([161, 298, 825, 585, 1089, 860]);
    expect(lines.map(line => [line.level, line.expInLevel])).toEqual([
      [67, 1099],
      [70, 0],
      [65, 1540],
      [68, 1157],
      [65, 1547],
      [60, 0],
    ]);
    expect(lines.map(line => line.candySupply.species)).toEqual([0, 0, 825, 578, 272, 175]);
    expect(lines.every(line => line.candyDemandMet)).toBe(true);
    if (mode === 'surplusFirst') {
      expect(lines.every(line => line.surplusCandyValue === 0)).toBe(true);
    } else {
      expect(lines.every(line => line.surplusCandyValue <= 2)).toBe(true);
      expect(lines[1].surplusCandyValue).toBe(0);
    }
    expect(result.lossLedger.hasLoss).toBe(false);
    if (isPerfWallClockEnabled()) {
      expect(result.performance?.feasibilityMs).toBeLessThan(perfBudgetMs(1_000));
      expect(durationMs).toBeLessThan(perfBudgetMs(2_000));
    }
    console.info('[reported-six-row-full-plan]', mode, {
      durationMs,
      feasibilityMs: result.performance?.feasibilityMs,
      refineMs: result.performance?.refineMs,
      refineStatus: result.performance?.refineStatus,
    });
  }, 60_000);
});
