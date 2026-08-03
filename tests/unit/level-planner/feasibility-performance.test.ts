import { describe, expect, it } from 'vitest';
import { isPerfWallClockEnabled } from '../../helpers/isPerfWallClockEnabled';
import { perfBudgetMs } from './perfBudget';
import { solveFeasibilityForFixedRows } from '../../../src/domain/level-planner/core/feasibilityWitness';
import { solveLevelPlan } from '../../../src/domain/level-planner/core/solveLevelPlan';
import type {
  CandyInventory,
  FeasibilityDemandRow,
  FeasibilityStats,
  LevelPlannerInput,
  LevelPlannerResult,
  SolverItemCompareMode,
} from '../../../src/domain/level-planner/types';

const allModes: SolverItemCompareMode[] = [
  'surplusFirst',
  'surplusGateFirst',
  'legacyImproved',
];

function requestedModes(): SolverItemCompareMode[] {
  const raw = process.env.LEVEL_PLANNER_FEASIBILITY_PERF_MODES;
  if (!raw) return allModes;
  const requested = new Set(raw.split(',').map(value => value.trim()).filter(Boolean));
  const selected = allModes.filter(mode => requested.has(mode));
  return selected.length ? selected : allModes;
}

function demandRow(
  pokemonId: string,
  pokedexId: number,
  type: string,
  totalCandy: number,
  candyDemandMet = true,
): FeasibilityDemandRow {
  return {
    pokemonId,
    pokedexId,
    candyFamilyKey: String(pokedexId),
    type,
    totalCandy,
    boostCandy: 0,
    normalCandy: totalCandy,
    shards: 0,
    reachedLv: candyDemandMet ? 70 : 69,
    expInLevel: candyDemandMet ? 0 : 123,
    candyDemandMet,
    preferZeroSurplus: candyDemandMet,
  };
}

function fixedDemandFixture(): { rows: FeasibilityDemandRow[]; inventory: CandyInventory } {
  return {
    rows: [
      demandRow('alpha-17', 10_001, 'alpha', 17),
      demandRow('alpha-24', 10_002, 'alpha', 24),
      demandRow('alpha-31', 10_003, 'alpha', 31),
      demandRow('beta-19', 10_004, 'beta', 19),
      demandRow('beta-25', 10_005, 'beta', 25),
      demandRow('gamma-99', 10_006, 'gamma', 99, false),
    ],
    inventory: {
      species: {
        '10001': 3,
        '10002': 4,
        '10003': 2,
        '10004': 1,
        '10005': 5,
        '10006': 20,
      },
      typeCandy: {
        alpha: { s: 8, m: 2 },
        beta: { s: 5, m: 2 },
        gamma: { s: 4, m: 2 },
      },
      universal: { s: 24, m: 8, l: 2 },
    },
  };
}

function fullPlanFixture(mode: SolverItemCompareMode): LevelPlannerInput {
  const { rows, inventory } = fixedDemandFixture();
  return {
    pokemonList: rows.map((row, index) => ({
      pokemonId: row.pokemonId,
      pokedexId: row.pokedexId,
      candyFamilyKey: row.candyFamilyKey,
      name: row.pokemonId,
      type: row.type,
      currentLevel: 10,
      currentExpInLevel: 0,
      targetLevel: 70,
      expType: 600,
      nature: 'normal',
      requestedBoostCandy: 0,
      boostAllowed: true,
      candyTarget: { totalCandyUnits: row.totalCandy },
      priorityIndex: index,
    })),
    dreamShards: Number.POSITIVE_INFINITY,
    boost: { kind: 'none', limit: 0 },
    candyInventory: inventory,
    options: { itemCompareMode: mode },
  };
}

function reportedLegacyTenRowFixture(mode: ItemCompareMode = 'legacyImproved'): LevelPlannerInput {
  const rows = [
    ['latias', 380, 'Dragon', 55, 0, 70, 1080, 'normal', 993],
    ['drampa', 780, 'Dragon', 25, 0, 60, 600, 'down', 696],
    ['suicune', 245, 'Water', 61, 0, 65, 1080, 'down', 514],
    ['spiritomb', 442, 'Dark', 63, 0, 70, 600, 'normal', 0],
    ['dedenne-boundary', 702, 'Electric', 63, 0, 70, 600, 'down', 0],
    ['dedenne-lower', 702, 'Electric', 65, 0, 70, 600, 'normal', 0],
    ['vikavolt', 738, 'Bug', 25, 0, 60, 600, 'down', 0],
    ['swalot', 317, 'Poison', 57, 1553, 60, 600, 'down', 0],
    ['heracross', 214, 'Bug', 65, 0, 70, 600, 'normal', 0],
    ['cresselia', 488, 'Psychic', 65, 0, 70, 1080, 'normal', 0],
  ] as const;
  return {
    pokemonList: rows.map(([pokemonId, pokedexId, type, currentLevel, currentExpInLevel, targetLevel, expType, nature, requestedBoostCandy], priorityIndex) => ({
      pokemonId,
      pokedexId,
      candyFamilyKey: String(pokedexId),
      name: pokemonId,
      type,
      currentLevel,
      currentExpInLevel,
      targetLevel,
      targetExpInLevel: 0,
      expType,
      nature,
      requestedBoostCandy,
      boostAllowed: true,
      priorityIndex,
    })),
    dreamShards: 10_000_000,
    boost: { kind: 'full', limit: 3_500 },
    candyInventory: {
      species: {
        '380': 320,
        '780': 656,
        '245': 478,
        '442': 0,
        '702': 0,
        '738': 0,
        '317': 272,
        '214': 0,
        '488': 500,
      },
      typeCandy: {
        Dragon: { s: 13, m: 0 },
        Water: { s: 0, m: 0 },
        Dark: { s: 0, m: 3 },
        Electric: { s: 0, m: 0 },
        Bug: { s: 0, m: 0 },
        Poison: { s: 0, m: 0 },
        Psychic: { s: 0, m: 0 },
      },
      universal: { s: 432, m: 102, l: 9 },
    },
    options: { itemCompareMode: mode },
  };
}

function reportedLongSurplusBoundaryFixture(): LevelPlannerInput {
  const base = reportedLegacyTenRowFixture('surplusFirst');
  const rows = new Map(base.pokemonList.map(row => [row.pokemonId, row]));
  const update = (pokemonId: string, values: Partial<LevelPlannerInput['pokemonList'][number]>) => ({
    ...rows.get(pokemonId)!,
    ...values,
  });
  return {
    ...base,
    candyInventory: {
      ...base.candyInventory,
      typeCandy: {
        ...base.candyInventory.typeCandy,
        Psychic: { s: 18, m: 10 },
      },
    },
    pokemonList: [
      update('latias', { targetLevel: 65, requestedBoostCandy: 992 }),
      update('drampa', { requestedBoostCandy: 998 }),
      update('suicune', {}),
      update('spiritomb', {}),
      update('dedenne-boundary', {}),
      update('dedenne-lower', {}),
      update('cresselia', { currentLevel: 25, targetLevel: 70 }),
      update('heracross', { currentLevel: 25 }),
      update('vikavolt', {}),
      update('swalot', {}),
    ].map((row, priorityIndex) => ({ ...row, priorityIndex })),
  };
}

function reportedSharedSpeciesBoundaryFixture(mode: ItemCompareMode, boostKind: 'full' | 'mini' = 'full'): LevelPlannerInput {
  const base = reportedLongSurplusBoundaryFixture();
  const rows = new Map(base.pokemonList.map(row => [row.pokemonId, row]));
  const update = (pokemonId: string, values: Partial<LevelPlannerInput['pokemonList'][number]>) => ({
    ...rows.get(pokemonId)!,
    ...values,
  });
  return {
    ...base,
    boost: { kind: boostKind, limit: boostKind === 'mini' ? 350 : 3_500 },
    candyInventory: {
      ...base.candyInventory,
      species: { ...base.candyInventory.species, '702': 100 },
      typeCandy: {
        ...base.candyInventory.typeCandy,
        Dark: { s: 0, m: 0 },
        Psychic: { s: 0, m: 0 },
      },
    },
    pokemonList: [
      update('dedenne-lower', { requestedBoostCandy: 316 }),
      update('latias', {}),
      update('drampa', {}),
      update('suicune', {}),
      // 実マスター外のIDを明示familyへ寄せ、pokedexId一致へ偶然依存しない性能fixtureにする。
      update('dedenne-boundary', { pokedexId: 1_702, candyFamilyKey: '702', requestedBoostCandy: 522 }),
      update('spiritomb', {}),
      update('cresselia', {}),
      update('heracross', {}),
      update('vikavolt', {}),
      update('swalot', {}),
    ].map((row, priorityIndex) => ({ ...row, priorityIndex })),
    options: { itemCompareMode: mode },
  };
}

function reportedFullPostSwitchFixture(mode: ItemCompareMode): LevelPlannerInput {
  const base = reportedLongSurplusBoundaryFixture();
  const rows = new Map(base.pokemonList.map(row => [row.pokemonId, row]));
  const update = (pokemonId: string, values: Partial<LevelPlannerInput['pokemonList'][number]>) => ({
    ...rows.get(pokemonId)!,
    ...values,
  });
  return {
    ...base,
    candyInventory: {
      ...base.candyInventory,
      species: { ...base.candyInventory.species, '702': 100 },
    },
    pokemonList: [
      update('dedenne-lower', { requestedBoostCandy: 0 }),
      update('latias', { requestedBoostCandy: 992 }),
      update('drampa', { requestedBoostCandy: 696 }),
      update('suicune', { requestedBoostCandy: 514 }),
      update('dedenne-boundary', { requestedBoostCandy: 0 }),
      update('spiritomb', { requestedBoostCandy: 158 }),
      update('cresselia', { requestedBoostCandy: 0 }),
      update('heracross', { requestedBoostCandy: 0 }),
      update('vikavolt', { requestedBoostCandy: 0 }),
      update('swalot', { requestedBoostCandy: 0 }),
    ].map((row, priorityIndex) => ({ ...row, priorityIndex })),
    options: { itemCompareMode: mode },
  };
}

function max(values: number[]): number {
  return values.length ? Math.max(...values) : 0;
}

function expectBoundedStats(stats: FeasibilityStats, rowCount: number): void {
  expect(stats.rowOptionCounts).toHaveLength(rowCount);
  expect(stats.rowFrontierCounts).toHaveLength(rowCount);
  expect(stats.typeBlockFrontierCounts).toHaveLength(3);
  expect(stats.rowOptionCounts.every(Number.isFinite)).toBe(true);
  expect(stats.typeBlockFrontierCounts.every(Number.isFinite)).toBe(true);

  // These are structural ceilings, not wall-clock microbenchmarks. A regression must
  // increase one of the exact frontier/transition dimensions by a meaningful margin.
  expect(max(stats.rowOptionCounts)).toBeLessThanOrEqual(128);
  expect(max(stats.typeBlockFrontierCounts)).toBeLessThanOrEqual(64);
  expect(stats.globalKeyCount).toBeLessThanOrEqual(128);
  expect(stats.transitions).toBeLessThanOrEqual(5_000);
  if (isPerfWallClockEnabled()) {
    expect(stats.durationMs).toBeLessThan(perfBudgetMs(1_000));
  }
}

/**
 * 全行の資源使用が入力の在庫・かけら・アメブ枠に収まっていることを固定する。
 *
 * **⚠ かつてここは「境界より下の行は `totalCandyUnitsUsed === 0`」を固定していた。**
 * それは `solveLevelPlan` が witness に含まれない行を `zeroLine` へ倒していた
 * 実装の写しであって、仕様ではない。`level-planner-allocation-policy-spec.md` §4-5 と
 * `fbl01d_feasibility_witness境界EXP改善_設計書.md` §14.4（フェーズ3）は
 * **「下位は残資源で優先順位順に個別処理する」**と決めており、0固定はそれを禁じてしまう。
 *
 * 境界そのものは各テストの `lines[boundaryIndex]` で従来どおり厳密に固定している。
 * ここが見るのは「下位処理が資源を作り出していないか」だけ。
 */
function expectResourceUsageWithinInput(result: LevelPlannerResult, input: LevelPlannerInput): void {
  const lines = result.pokemonResults.map(row => row.reachableLine);
  expect(lines.reduce((sum, line) => sum + line.dreamShardsUsed, 0)).toBeLessThanOrEqual(input.dreamShards);
  expect(lines.reduce((sum, line) => sum + line.boostedCandyUnits, 0)).toBeLessThanOrEqual(input.boost.limit);

  const species: Record<string, number> = {};
  const type: Record<string, { s: number; m: number }> = {};
  const universal = { s: 0, m: 0, l: 0 };
  result.pokemonResults.forEach((row, index) => {
    const pokemon = input.pokemonList[index]!;
    const supply = row.reachableLine.candySupply;
    species[pokemon.candyFamilyKey] = (species[pokemon.candyFamilyKey] ?? 0) + supply.species;
    const stock = type[pokemon.type] ?? { s: 0, m: 0 };
    type[pokemon.type] = { s: stock.s + supply.type.s, m: stock.m + supply.type.m };
    universal.s += supply.universal.s;
    universal.m += supply.universal.m;
    universal.l += supply.universal.l;
  });
  for (const [key, used] of Object.entries(species)) {
    expect(used).toBeLessThanOrEqual(input.candyInventory.species[key] ?? 0);
  }
  for (const [key, used] of Object.entries(type)) {
    const stock = input.candyInventory.typeCandy[key] ?? { s: 0, m: 0 };
    expect(used.s).toBeLessThanOrEqual(stock.s);
    expect(used.m).toBeLessThanOrEqual(stock.m);
  }
  expect(universal.s).toBeLessThanOrEqual(input.candyInventory.universal.s);
  expect(universal.m).toBeLessThanOrEqual(input.candyInventory.universal.m);
  expect(universal.l).toBeLessThanOrEqual(input.candyInventory.universal.l);
}

describe('fbl01d feasibility performance fixture', () => {
  it.each(requestedModes())('frontier statistics stay bounded: %s', mode => {
    const { rows, inventory } = fixedDemandFixture();
    const result = solveFeasibilityForFixedRows(rows, inventory, {
      boostKind: 'none',
      boostLimit: 0,
      dreamShards: Number.POSITIVE_INFINITY,
      itemCompareMode: mode,
    });

    expect(result.status).toBe('feasible');
    expectBoundedStats(result.stats, rows.length);

    const fullPlan = solveLevelPlan(fullPlanFixture(mode));
    const feasibilityMs = fullPlan.performance?.feasibilityMs;
    expect(feasibilityMs).toEqual(expect.any(Number));
    if (isPerfWallClockEnabled()) {
      expect(feasibilityMs ?? Number.POSITIVE_INFINITY).toBeLessThan(perfBudgetMs(10_000));
    }

    console.info('[level-planner-feasibility-perf] result', JSON.stringify({
      mode,
      status: result.status,
      feasibilityMs,
      fixedDemandMs: Math.round(result.stats.durationMs * 100) / 100,
      rowOptionCounts: result.stats.rowOptionCounts,
      typeBlockFrontierCounts: result.stats.typeBlockFrontierCounts,
      globalKeyCount: result.stats.globalKeyCount,
      transitions: result.stats.transitions,
    }));
  }, 60_000);

  it('keeps the reported 10-row legacy case exact and bounded', () => {
    const startedAt = performance.now();
    const input = reportedLegacyTenRowFixture();
    const result = solveLevelPlan(input);
    const durationMs = performance.now() - startedAt;
    const lines = result.pokemonResults.map(row => row.reachableLine);

    expect(lines.slice(0, 4).every(line => line.candyDemandMet)).toBe(true);
    expect(lines[4]).toMatchObject({ level: 69, candyDemandMet: false, totalCandyUnitsUsed: 995 });
    expectResourceUsageWithinInput(result, input);
    expect(result.lossLedger.hasLoss).toBe(false);
    console.info('[level-planner-reported-legacy-perf]', JSON.stringify({
      durationMs: Math.round(durationMs * 100) / 100,
      feasibilityMs: result.performance?.feasibilityMs,
      refineMs: result.performance?.refineMs,
      refineStatus: result.performance?.refineStatus,
    }));
  }, 60_000);

  it('allows row surplus up to two while maximizing the reported surplus-first boundary', () => {
    const input = reportedLegacyTenRowFixture('surplusFirst');
    const result = solveLevelPlan(input);
    const lines = result.pokemonResults.map(row => row.reachableLine);

    expect(lines.slice(0, 4).every(line => line.candyDemandMet)).toBe(true);
    expect(lines[4]).toMatchObject({ level: 69, candyDemandMet: false, totalCandyUnitsUsed: 995 });
    expectResourceUsageWithinInput(result, input);
    expect(result.performance?.boundarySearch).toMatchObject({
      mode: 'surplusFirst',
      boundaryIndex: 4,
      selectedTotalCandy: 995,
      selectedRawSurplus: 1,
      stoppedReason: 'first_acceptable_surplus',
    });
    expect(result.lossLedger.hasLoss).toBe(false);
  }, 60_000);

  it('finds the distant surplus-first boundary without descending one candy at a time', () => {
    const startedAt = performance.now();
    const input = reportedLongSurplusBoundaryFixture();
    const result = solveLevelPlan(input);
    const durationMs = performance.now() - startedAt;
    const lines = result.pokemonResults.map(row => row.reachableLine);

    expect(lines.slice(0, 6).every(line => line.candyDemandMet)).toBe(true);
    expect(lines[6]).toMatchObject({ level: 51, candyDemandMet: false, totalCandyUnitsUsed: 1579 });
    expectResourceUsageWithinInput(result, input);
    expect(result.performance?.boundarySearch).toMatchObject({
      mode: 'surplusFirst',
      boundaryIndex: 6,
      targetTotalCandy: 2411,
      selectedTotalCandy: 1579,
      selectedRawSurplus: 1,
      checkedLowerTotals: 1,
      stoppedReason: 'first_acceptable_surplus',
    });
    expect(result.lossLedger.hasLoss).toBe(false);
    console.info('[level-planner-distant-surplus-boundary-perf]', JSON.stringify({
      durationMs: Math.round(durationMs * 100) / 100,
      feasibilityMs: result.performance?.feasibilityMs,
      checkedLowerTotals: result.performance?.boundarySearch?.checkedLowerTotals,
    }));
  }, 60_000);

  it.each(allModes)('keeps the cross-pokedex family boundary exact and bounded: %s', mode => {
    const startedAt = performance.now();
    const result = solveLevelPlan(reportedSharedSpeciesBoundaryFixture(mode));
    const durationMs = performance.now() - startedAt;
    const lines = result.pokemonResults.map(row => row.reachableLine);

    expect(lines.slice(0, 4).every(line => line.candyDemandMet)).toBe(true);
    expect(lines[4]).toMatchObject({ candyDemandMet: false });
    expect(lines[0].candySupply.species).toBe(100);
    expect(lines[4].candySupply.species).toBe(0);
    expect(result.lossLedger.hasLoss).toBe(false);
    console.info('[level-planner-shared-species-boundary-perf]', JSON.stringify({
      mode,
      durationMs: Math.round(durationMs * 100) / 100,
      feasibilityMs: result.performance?.feasibilityMs,
    }));
  }, 60_000);

  it.each(allModes)('keeps the mini-boost cross-pokedex family boundary exact and bounded: %s', mode => {
    const startedAt = performance.now();
    const result = solveLevelPlan(reportedSharedSpeciesBoundaryFixture(mode, 'mini'));
    const durationMs = performance.now() - startedAt;
    const lines = result.pokemonResults.map(row => row.reachableLine);

    expect(lines.slice(0, 4).every(line => line.candyDemandMet)).toBe(true);
    expect(lines[4]).toMatchObject({ candyDemandMet: false, totalCandyUnitsUsed: 550 });
    expect(lines[0].candySupply.species).toBe(100);
    expect(lines[4].candySupply.species).toBe(0);
    if (mode === 'surplusFirst') {
      expect(lines[1].candySupply).toEqual({
        species: 320,
        type: { s: 13, m: 0 },
        universal: { s: 13, m: 77, l: 0 },
      });
      expect(lines[2].candySupply).toEqual({
        species: 656,
        type: { s: 0, m: 0 },
        universal: { s: 80, m: 25, l: 6 },
      });
    } else {
      expect(lines[1].candySupply).toEqual({
        species: 320,
        type: { s: 2, m: 0 },
        universal: { s: 1, m: 51, l: 6 },
      });
      expect(lines[2].candySupply).toEqual({
        species: 656,
        type: { s: 11, m: 0 },
        universal: { s: 92, m: 51, l: 0 },
      });
    }
    expect(result.lossLedger.hasLoss).toBe(false);
    console.info('[level-planner-mini-shared-species-boundary-perf]', JSON.stringify({
      mode,
      durationMs: Math.round(durationMs * 100) / 100,
      feasibilityMs: result.performance?.feasibilityMs,
      boundarySearch: result.performance?.boundarySearch,
    }));
  }, 60_000);

  it('maximizes EXP on a later shared-type boundary in legacyImproved', () => {
    const input = reportedSharedSpeciesBoundaryFixture('legacyImproved', 'mini');
    const rows = new Map(input.pokemonList.map(row => [row.pokemonId, row]));
    input.pokemonList = [
      rows.get('dedenne-lower')!,
      rows.get('latias')!,
      rows.get('suicune')!,
      rows.get('dedenne-boundary')!,
      rows.get('drampa')!,
      rows.get('spiritomb')!,
      rows.get('cresselia')!,
      rows.get('heracross')!,
      rows.get('vikavolt')!,
      rows.get('swalot')!,
    ].map((row, priorityIndex) => ({ ...row, priorityIndex }));

    const result = solveLevelPlan(input);
    const lines = result.pokemonResults.map(row => row.reachableLine);

    expect(lines.slice(0, 4).every(line => line.candyDemandMet)).toBe(true);
    expect(lines[4]).toMatchObject({ candyDemandMet: false, totalCandyUnitsUsed: 1_502 });
    expect(result.performance?.boundarySearch).toMatchObject({
      mode: 'legacyImproved',
      boundaryIndex: 4,
      selectedTotalCandy: 1_502,
    });
    expect(result.lossLedger.hasLoss).toBe(false);
  }, 60_000);

  it.each(allModes)('keeps the reported full post-switch boundary exact: %s', mode => {
    const startedAt = performance.now();
    const input = reportedFullPostSwitchFixture(mode);
    const result = solveLevelPlan(input);
    const durationMs = performance.now() - startedAt;
    const lines = result.pokemonResults.map(row => row.reachableLine);

    expect(lines.slice(0, 6).every(line => line.candyDemandMet)).toBe(true);
    expect(lines[6]).toMatchObject({
      level: 50,
      expInLevel: 1_700,
      candyDemandMet: false,
      totalCandyUnitsUsed: 1_535,
    });
    expectResourceUsageWithinInput(result, input);
    if (mode === 'surplusFirst') {
      const reachedSurplus = lines.slice(0, 6).reduce((sum, line) => sum + line.surplusCandyValue, 0);
      expect(reachedSurplus).toBeLessThanOrEqual(2);
      expect(lines[6].surplusCandyValue).toBeLessThanOrEqual(2);
      expect(reachedSurplus + lines[6].surplusCandyValue).toBeLessThanOrEqual(4);
    } else {
      expect(lines[6].candySupply).toEqual({
        species: 500,
        type: { s: 18, m: 10 },
        universal: { s: 11, m: 34, l: 0 },
      });
      expect(lines[0].candySupply).toEqual({
        species: 100,
        type: { s: 0, m: 0 },
        universal: { s: 4, m: 1, l: 5 },
      });
      expect(lines[4].candySupply).toEqual({
        species: 0,
        type: { s: 0, m: 0 },
        universal: { s: 8, m: 31, l: 4 },
      });
    }
    expect(result.performance?.boundarySearch).toMatchObject({
      mode,
      boundaryIndex: 6,
      selectedTotalCandy: 1_535,
    });
    expect(result.lossLedger.hasLoss).toBe(false);
    console.info('[level-planner-full-post-switch-perf]', JSON.stringify({
      mode,
      durationMs: Math.round(durationMs * 100) / 100,
      feasibilityMs: result.performance?.feasibilityMs,
      boundarySearch: result.performance?.boundarySearch,
    }));
  }, 60_000);
});
