import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebugExportContext } from '../../../src/domain/level-planner/debugExport';
import type { LevelPlannerResult, PokemonPlanLine, PokemonPlanResult } from '../../../src/domain/level-planner/types';

const heavySolverSpies = vi.hoisted(() => ({
  refineExactSupply: vi.fn(() => { throw new Error('debug export must not run refineExactSupply'); }),
  solveLevelPlanWithBudget: vi.fn(() => { throw new Error('debug export must not run solveLevelPlanWithBudget'); }),
}));

vi.mock('../../../src/domain/level-planner/core/exactSupplyRefine', () => ({
  refineExactSupply: heavySolverSpies.refineExactSupply,
}));
vi.mock('../../../src/domain/level-planner/core/solveLevelPlan', () => ({
  solveLevelPlanWithBudget: heavySolverSpies.solveLevelPlanWithBudget,
}));

import { buildDebugExportTsv } from '../../../src/domain/level-planner/debugExport';

function planLine(): PokemonPlanLine {
  return {
    level: 20,
    expInLevel: 0,
    expToNextLevel: 100,
    expToTarget: 0,
    totalCandyUnitsUsed: 5,
    boostedCandyUnits: 0,
    nonBoostCandyUnits: 5,
    candySupply: {
      species: 3,
      type: { s: 0, m: 0 },
      universal: { s: 1, m: 0, l: 0 },
    },
    dreamShardsUsed: 1,
    expGained: 125,
    surplusExp: 0,
    surplusCandyValue: 1,
    targetReached: true,
  };
}

function pokemonPlan(): PokemonPlanResult {
  const line = planLine();
  return {
    pokemonId: 'row\t1',
    pokedexId: 25,
    name: 'Pika\tChu\nLine',
    currentLevel: 10,
    currentExpInLevel: 5,
    targetLevel: 20,
    targetExpInLevel: 0,
    targetLine: line,
    reachableLine: line,
    targetReached: true,
    shortage: { expToTarget: 0, candyToTarget: 0, dreamShardShortage: 0, boostCandyUnavailable: 0 },
    constraintDiagnosis: {
      byCandyInventory: { level: 20, expInLevel: 0, candyUsed: 5 },
      byBoostLimit: { level: 20, expInLevel: 0, candyUsed: 5 },
      byDreamShards: { level: 20, expInLevel: 0, candyUsed: 5 },
      limitingFactor: null,
      isInventoryShortage: false,
      isBoostShortage: false,
      isShardsShortage: false,
    },
    role: 'upper',
  };
}

function result(): LevelPlannerResult {
  const plan = pokemonPlan();
  return {
    pokemonResults: [plan],
    summary: {
      totalDreamShardsUsed: 1,
      dreamShardsRemaining: 999,
      boost: { kind: 'none', boostLimit: 0, boostUsed: 0, boostRemaining: 0 },
      speciesCandyUsed: { '25': 3 },
      typeCandyUsed: { electric: { s: 0, m: 0 } },
      universalCandyUsed: { s: 1, m: 0, l: 0 },
      speciesCandyRemaining: { '25': 0 },
      typeCandyRemaining: { electric: { s: 2, m: 0 } },
      universalCandyRemaining: { s: 0, m: 1, l: 1 },
      itemUsageRanking: [],
      totalNeed: { totalCandyUnits: 5, totalDreamShards: 1, totalBoostCandyRequested: 0 },
      totalSupplied: { totalCandyValue: 6, totalBoostedCandyUnits: 0, totalNonBoostCandyUnits: 5, totalDreamShards: 1 },
      fullyReachedCount: 1,
    },
    shortages: {
      hasShortage: false,
      totalExpToTargets: 0,
      totalCandyShortage: 0,
      totalDreamShardShortage: 0,
      candyShortages: [],
      shardShortages: [],
    },
    lossLedger: { hasLoss: false, supplyCandidateCuts: [], frontierCuts: [], stateCaps: [], expansionCapReductions: [] },
    performance: { feasibilityMs: 12.5, refineMs: 2.5, refineStatus: 'ok' },
  };
}

function context(): DebugExportContext {
  const plannerResult = result();
  return {
    result: plannerResult,
    rows: [{
      id: 'row\t1',
      name: 'Pika\tChu\nLine',
      pokedexId: 25,
      candyFamilyKey: '25',
      type: 'electric',
      nature: 'normal',
      currentLevel: 10,
      currentExpInLevel: 5,
      expRemaining: 95,
      targetLevel: 20,
      targetExpInLevel: 0,
      candyTarget: 5,
      plan: plannerResult.pokemonResults[0],
    }],
    itemCompareMode: 'surplusGateFirst',
    inventorySnapshot: {
      species: { '25': 3 },
      typeCandy: { electric: { s: 2, m: 0 } },
      universal: { s: 1, m: 1, l: 1 },
    },
    boost: { kind: 'none', limit: 0 },
    dreamShards: 1_000,
    displayed: {
      result: plannerResult,
      calculationMode: 'prefixLocalMixed',
      loss: false,
      durationMs: 15,
      mixedPrefixCount: 0,
      mixedSource: 'feasibility',
    },
    performanceProfile: {
      policy: 'autoMixed',
      structuralProbeStatus: 'exactCompleted',
      lastDeadlineMs: 2_000,
      mixedPrefixCount: 0,
    },
    verificationMode: 'normalPathSnapshot',
  };
}

const mainColumns = [
  'index', 'id', 'name', 'pokedexId', 'candyFamilyKey', 'type', 'nature',
  'currentLv', 'currentExpInLevel', 'expRemaining', 'targetLv', 'targetExpInLevel', 'candyTarget',
  'boostKind', 'itemCompareMode', 'calculationScope', 'reachedLv', 'targetReached', 'role', 'expToNext', 'expToTarget',
  'shortageCandy', 'shortageBoost', 'shortageShards', 'limitingFactor', 'initialSpeciesStock',
  'reachableBoost', 'reachableNormal', 'reachableTotalCandy', 'reachableShards',
  'reachableSpecies', 'reachableTypeS', 'reachableTypeM', 'reachableUniversalS', 'reachableUniversalM', 'reachableUniversalL',
  'reachableTotalSupply', 'reachableItemValue', 'reachableNonSpeciesItemValue', 'reachableSurplus',
  'targetBoost', 'targetNormal', 'targetTotalCandy', 'targetShards',
  'targetSpecies', 'targetTypeS', 'targetTypeM', 'targetUniversalS', 'targetUniversalM', 'targetUniversalL',
  'targetTotalSupply', 'targetItemValue', 'targetNonSpeciesItemValue', 'targetSurplus',
  // targetLv/targetExpInLevel は睡眠後の最終目標。アメを使い終えた地点は別列（設計書§6.4）。
  'plannedCandyEndLevel', 'plannedCandyEndExpInLevel',
  'reachableCandyEndLevel', 'reachableCandyEndExpInLevel',
];

describe('level planner debug TSV golden contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fixes section order, columns, escaping, and normal-path-only verification', () => {
    const input = context();
    const first = buildDebugExportTsv(input);
    const second = buildDebugExportTsv(input);
    const sections = first.split('\n\n');

    expect(first).toBe(second);
    expect(sections.map(section => section.split('\n')[0])).toEqual([
      mainColumns.join('\t'),
      'CALCULATION_POLICY',
      'BOUNDARY_SEARCH',
      'LOSS_LEDGER',
      'EXACT_VERIFICATION',
      'FBL01D_FEASIBILITY',
    ]);
    expect(sections[0].split('\n')[0].split('\t')).toEqual(mainColumns);
    expect(sections[1].split('\n')[1]).toBe('mode\tpolicy\tstructuralProbeStatus\tdeadlineMs\tactualDurationMs\tfeasibilityMs\trefineMs\trefineStatus\trefineReason\tloss\tsource\texactPrefixCount\tlocalStartIndex\tlocalSuffixCount');
    expect(sections[4].split('\n')[1]).toBe('status\tselectedIsExactBest\tmode\trows\tlocalCandidateCounts\tdpFinalStates\tscope\texactPrefixCount\tlocalSuffixCount\tnote');
    expect(sections[5].split('\n')[1]).toBe('status\tselectedValid\tsolverStatus\trefineStatus\trows\treachedCount\tboundaryIndex\tboundaryLv\tboundaryExp\tdurationMs\tglobalKeyCount\ttransitions\twitnessRestoreMs\treason');
    // タブ・改行のエスケープは name（'Pika\tChu\nLine'）で検証する
    expect(first).toContain('Pika Chu Line');
    expect(first).not.toContain('Pika\tChu');
    expect(first).not.toContain('Pika\nChu');
    expect(first).toContain('normal-path fixed-demand refine snapshot; export solver disabled');
    expect(first).toContain('heavy_solver_disabled_in_tsv_export');
    expect(heavySolverSpies.refineExactSupply).not.toHaveBeenCalled();
    expect(heavySolverSpies.solveLevelPlanWithBudget).not.toHaveBeenCalled();
  });
});
