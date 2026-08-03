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
    candyDemandMet: true,
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
    candyDemandMet: true,
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
      expType: 600,
      currentLevel: 10,
      currentExpInLevel: 5,
      expRemaining: 95,
      targetLevel: 20,
      targetExpInLevel: 0,
      candyTarget: 5,
      sleep: {
        sleepTargetHours: 1000,
        sleepHours: 500,
        remainingHours: 500,
        requiredDays: 39,
        sleepExp: 4300,
        breakdown: {
          dailySleepMinutes: 780,
          dailyScore: 100,
          dailyExp: 100,
          gsdExtra: 400,
          sleepExpBonus: 1,
          naturePercent: 100,
        },
        needed: { kind: 'long-term-estimate', days: 32, totalMinutes: 24_960 },
      },
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
    sleepSettings: { dailySleepHours: 13, sleepExpBonusCount: 0, includeGSD: true },
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
  'currentLv', 'currentExpInLevel', 'expRemaining', 'targetLv', 'targetExpInLevel', 'candyTarget', 'sleepTargetMode',
  'boostKind', 'itemCompareMode', 'calculationScope', 'reachedLv', 'candyDemandMet', 'role', 'expToNext', 'expToTarget',
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
      'SLEEP_EXP',
      'ALL_SLEEP',
      'CALCULATION_POLICY',
      'BOUNDARY_SEARCH',
      'LOSS_LEDGER',
      'EXACT_VERIFICATION',
      'FBL01D_FEASIBILITY',
    ]);
    expect(sections[0].split('\n')[0].split('\t')).toEqual(mainColumns);
    expect(sections[3].split('\n')[1]).toBe('mode\tpolicy\tstructuralProbeStatus\tdeadlineMs\tactualDurationMs\tfeasibilityMs\trefineMs\trefineStatus\trefineReason\tloss\tsource\texactPrefixCount\tlocalStartIndex\tlocalSuffixCount');
    expect(sections[6].split('\n')[1]).toBe('status\tselectedIsExactBest\tmode\trows\tlocalCandidateCounts\tdpFinalStates\tscope\texactPrefixCount\tlocalSuffixCount\tnote');
    expect(sections[7].split('\n')[1]).toBe('status\tselectedValid\tsolverStatus\trefineStatus\trows\treachedCount\tboundaryIndex\tboundaryLv\tboundaryExp\tdurationMs\tglobalKeyCount\ttransitions\twitnessRestoreMs\treason');

    // 睡眠EXPの中間値: 入力（設定・時間）から合計までを1行に並べ、どこで食い違うか切り分けられるようにする
    const sleepLines = sections[1].split('\n');
    expect(sleepLines[1]).toBe('settings\tdailySleepHours\tsleepExpBonusCount\tsleepExpBonus\tincludeGSD');
    expect(sleepLines[2]).toBe('settings\t13\t0\t1\ttrue');
    expect(sleepLines[3]).toBe([
      'row', 'index', 'id', 'name', 'nature', 'naturePercent',
      'sleepTargetHours', 'sleepHours', 'remainingHours',
      'dailySleepMinutes', 'dailyScore', 'sleepExpBonus', 'dailyExp', 'requiredDays', 'gsdExtra', 'sleepExp',
      'candyTarget', 'targetLv', 'targetExpInLevel', 'expToTarget',
      'sleepReachStatus', 'sleepReachReason', 'sleepReachLevel', 'sleepReachTenths', 'sleepReachDisplay', 'sleepReachRatio',
      'neededKind', 'neededDays', 'neededMinutes', 'neededScore', 'neededMinutesMin', 'neededMinutesMax',
    ].join('\t'));
    expect(sleepLines[4].split('\t').slice(0, 16)).toEqual([
      'row', '1', 'row 1', 'Pika Chu Line', 'normal', '100',
      '1000', '500', '500',
      '780', '100', '1', '100', '39', '400', '4300',
    ]);
    // タブ・改行のエスケープは name（'Pika\tChu\nLine'）で検証する
    expect(first).toContain('Pika Chu Line');
    expect(first).not.toContain('Pika\tChu');
    expect(first).not.toContain('Pika\nChu');
    expect(first).toContain('normal-path fixed-demand refine snapshot; export solver disabled');
    expect(first).toContain('heavy_solver_disabled_in_tsv_export');
    expect(heavySolverSpies.refineExactSupply).not.toHaveBeenCalled();
    expect(heavySolverSpies.solveLevelPlanWithBudget).not.toHaveBeenCalled();
  });

  it('睡眠到達Lvの表示値・生比・非表示理由・Lv70の非該当値をSLEEP_EXPへ出す', () => {
    const input = context();
    const row = input.rows[0]!;
    const plan = row.plan!;
    const reachableLine = { ...plan.reachableLine, level: 60, expInLevel: 0 };
    row.targetLevel = 60;
    row.sleep!.sleepExp = 2751;
    row.plan = {
      ...plan,
      targetLevel: 60,
      targetExpInLevel: 0,
      reachableLine,
    };

    const sleepRow = () => {
      const lines = buildDebugExportTsv(input).split('\n\n')[1]!.split('\n');
      const headers = lines[3]!.split('\t');
      const values = lines[4]!.split('\t');
      return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    };

    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'shown',
      sleepReachReason: '',
      sleepReachLevel: '60',
      sleepReachTenths: '9',
      sleepReachDisplay: '60.9',
      sleepReachRatio: String(2751 / 2865),
    });

    row.sleep!.sleepExp = 100;
    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'hidden',
      sleepReachReason: 'displayEqualsTargetLevel',
    });

    row.sleep!.sleepExp = 0;
    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'hidden',
      sleepReachReason: 'noSleepExp',
    });

    row.sleep!.sleepExp = 500;
    row.plan = {
      ...row.plan,
      targetLevel: 62,
      reachableLine: { ...reachableLine, level: 58 },
    };
    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'hidden',
      sleepReachReason: 'notExceedingTarget',
    });

    row.sleep!.sleepExp = 3255;
    row.plan = {
      ...row.plan,
      targetLevel: 65,
      reachableLine: { ...reachableLine, level: 69 },
    };
    expect(sleepRow()).toMatchObject({
      sleepReachStatus: 'shown',
      sleepReachLevel: '70',
      sleepReachTenths: 'notApplicable',
      sleepReachDisplay: '70',
      sleepReachRatio: 'notApplicable',
    });
  });

  it('すべて睡眠を固定睡眠EXPと混同せず、モード・残EXP・必要時間を判別可能に出す', () => {
    const input = context();
    input.rows[0] = {
      ...input.rows[0]!,
      candyTarget: undefined,
      sleepTargetMode: 'all',
      sleep: undefined,
      plan: {
        ...input.rows[0]!.plan!,
        shortage: {
          ...input.rows[0]!.plan!.shortage,
          expToTarget: 10_000,
        },
      },
    };
    const sections = buildDebugExportTsv(input).split('\n\n');
    expect(sections[0]!.split('\n')[1]!.split('\t')[13]).toBe('all');
    expect(sections[1]).toContain('row\tnone');
    expect(sections[2]).toContain('ALL_SLEEP');
    expect(sections[2]).toContain('long-term-estimate');
    expect(sections[2]).not.toContain('\tsleepExp\t');

    // 「すべて睡眠」の行は SLEEP_EXP 節に出ないので、非表示理由をこちらへ出す。
    // 空欄だと「計算していない」と「出さないと決めた」が区別できない（設計書 §10.1）。
    const allSleepLines = sections[2]!.split('\n');
    const headers = allSleepLines[1]!.split('\t');
    const values = allSleepLines[2]!.split('\t');
    const cells = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    expect(cells).toMatchObject({
      sleepReachStatus: 'hidden',
      sleepReachReason: 'noSleepExp',
      sleepReachLevel: '',
    });
  });
});
