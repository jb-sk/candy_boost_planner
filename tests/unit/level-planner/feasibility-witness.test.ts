import { describe, expect, it, vi } from 'vitest';
import {
  createIndependentBoundaryFeasibilitySession,
  createPrefixDecisionSession,
  refineFeasibilityWitness,
  solveFeasibilityDecisionForFixedRows,
  solveFeasibilityForFixedRows,
  validateFeasibilityWitness,
} from '../../../src/domain/level-planner/core/feasibilityWitness';
import { refineExactSupply } from '../../../src/domain/level-planner/core/exactSupplyRefine';
import { __levelPlannerTestHooks, solveLevelPlan } from '../../../src/domain/level-planner/core/solveLevelPlan';
import type {
  CandyInventory,
  FeasibilityDemandRow,
  FeasibilityWitness,
  LevelPlannerInput,
  SolverItemCompareMode,
} from '../../../src/domain/level-planner/types';

const noBoost = {
  boostKind: 'none' as const,
  boostLimit: 0,
  dreamShards: Infinity,
};

function demandRow(
  pokemonId: string,
  pokedexId: number,
  type: string,
  totalCandy: number,
  overrides: Partial<FeasibilityDemandRow> = {},
): FeasibilityDemandRow {
  return {
    pokemonId,
    pokedexId,
    type,
    totalCandy,
    boostCandy: 0,
    normalCandy: totalCandy,
    shards: 0,
    reachedLv: 20,
    expInLevel: 0,
    targetReached: true,
    ...overrides,
  };
}

function emptyInventory(): CandyInventory {
  return {
    species: {},
    typeCandy: {},
    universal: { s: 0, m: 0, l: 0 },
  };
}

function expectFeasible(
  result: ReturnType<typeof solveFeasibilityForFixedRows>,
): asserts result is Extract<ReturnType<typeof solveFeasibilityForFixedRows>, { status: 'feasible' }> {
  expect(result.status, JSON.stringify(result)).toBe('feasible');
}

describe('fbl01d feasibility witness', () => {
  it('prefix decision sessionは通常solverとprefixごとの可否が一致する', () => {
    const rows = [
      demandRow('p1', 1, 'alpha', 13),
      demandRow('p2', 2, 'alpha', 21),
      demandRow('p3', 3, 'beta', 19),
      demandRow('p4', 4, 'alpha', 34),
    ];
    const inventory: CandyInventory = {
      species: { '1': 4, '2': 5, '3': 0, '4': 8 },
      typeCandy: { alpha: { s: 12, m: 2 }, beta: { s: 1, m: 1 } },
      universal: { s: 16, m: 2, l: 0 },
    };
    const options = { ...noBoost, itemCompareMode: 'legacyImproved' as const };
    const session = createPrefixDecisionSession(rows, inventory, options);

    for (const length of [0, 1, 2, 3, 4]) {
      const expected = solveFeasibilityDecisionForFixedRows(rows.slice(0, length), inventory, options);
      const actual = session.canSolvePrefix(length);
      expect(actual.status).toBe(expected.status);
      if (actual.status !== 'feasible') expect(actual.reason).toBe(expected.reason);
    }
  });

  it('prefix decision sessionは共有種族を含むprefixでは安全に通常solverへ退避する', () => {
    const rows = [
      demandRow('p1', 1, 'alpha', 13),
      demandRow('p2', 1, 'alpha', 21),
      demandRow('p3', 2, 'beta', 19),
    ];
    const inventory: CandyInventory = {
      species: { '1': 20, '2': 0 },
      typeCandy: { alpha: { s: 2, m: 1 }, beta: { s: 4, m: 0 } },
      universal: { s: 8, m: 1, l: 0 },
    };
    const session = createPrefixDecisionSession(rows, inventory, noBoost);

    for (const length of [1, 2, 3]) {
      const expected = solveFeasibilityDecisionForFixedRows(rows.slice(0, length), inventory, noBoost);
      expect(session.canSolvePrefix(length).status).toBe(expected.status);
    }
  });

  it('speciesUsedは§15どおり上位lex目的にしない', () => {
    const compare = __levelPlannerTestHooks.compareSyntheticStatesForTest([
      { targetReached: true, level: 20, expInLevel: 0, totalCandyUnitsUsed: 4, species: 4 },
    ], [
      { targetReached: true, level: 20, expInLevel: 0, totalCandyUnitsUsed: 4, species: 0 },
    ], 'surplusFirst');
    expect(compare).toBe(0);
  });

  it('validatorは供給値・余り・共有在庫・remainingを独立に検証する', () => {
    const rows = [demandRow('p1', 1, 'alpha', 4)];
    const inventory: CandyInventory = {
      species: { '1': 4 },
      typeCandy: { alpha: { s: 1, m: 0 } },
      universal: { s: 0, m: 0, l: 1 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);

    expect(validateFeasibilityWitness(result.witness, rows, inventory, noBoost)).toMatchObject({ valid: true });

    const invalidSupply = structuredClone(result.witness);
    invalidSupply.rows[0].supply.typeS = 1;
    expect(validateFeasibilityWitness(invalidSupply, rows, inventory, noBoost)).toMatchObject({ valid: false });

    const invalidRemaining = structuredClone(result.witness);
    invalidRemaining.remaining.species['1'] = 3;
    expect(validateFeasibilityWitness(invalidRemaining, rows, inventory, noBoost)).toMatchObject({ valid: false });
  });

  it('種族アメは非共有行で使用総量最大になり、余りを種族在庫へ戻さない', () => {
    const rows = [demandRow('p1', 1, 'alpha', 4)];
    const inventory: CandyInventory = {
      species: { '1': 4 },
      typeCandy: { alpha: { s: 1, m: 0 } },
      universal: { s: 0, m: 0, l: 1 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);

    expect(result.witness.rows[0].supply).toMatchObject({ species: 4, typeS: 0, typeM: 0, universalL: 0 });
    expect(result.witness.remaining.species['1']).toBe(0);
    expect(result.witness.remaining.universal.l).toBe(1);
  });

  it('feasible witnessは余り最小では同じ固定需要を満たす代表の中で余りが小さい供給を選ぶ', () => {
    const rows = [demandRow('p1', 1, 'alpha', 98)];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: {},
      universal: { s: 33, m: 5, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, { ...noBoost, itemCompareMode: 'surplusFirst' });
    expectFeasible(result);

    expect(result.witness.rows[0].supply).toMatchObject({ universalS: 26, universalM: 1 });
    expect(result.witness.rows[0].supply.universalS * 3 + result.witness.rows[0].supply.universalM * 20 - rows[0].totalCandy).toBe(0);
  });

  it('バッグ圧縮のfeasible witnessは余り0〜2ゲート候補をアイテム節約候補で落とさない', () => {
    const rows = [demandRow('swalot', 317, 'poison', 308)];
    const inventory: CandyInventory = {
      species: { '317': 272 },
      typeCandy: { poison: { s: 0, m: 2 } },
      universal: { s: 4, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, { ...noBoost, itemCompareMode: 'legacyImproved' });
    expectFeasible(result);

    expect(result.witness.rows[0].supply).toMatchObject({ species: 272, typeM: 1, universalS: 4 });
    expect(result.witness.rows[0].supply.typeM * 25 + result.witness.rows[0].supply.universalS * 3 + result.witness.rows[0].supply.species - rows[0].totalCandy).toBe(1);
  });

  it('バッグ圧縮の余り0〜2ゲートは後続上位の到達に必要な万能Sを奪わない', () => {
    const rows = [
      demandRow('swalot', 317, 'poison', 308),
      demandRow('upper-fire', 244, 'fire', 12),
    ];
    const inventory: CandyInventory = {
      species: { '317': 272 },
      typeCandy: { poison: { s: 0, m: 2 }, fire: { s: 0, m: 0 } },
      universal: { s: 4, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, { ...noBoost, itemCompareMode: 'legacyImproved' });
    expectFeasible(result);

    expect(result.witness.rows[0].supply).toMatchObject({ species: 272, typeM: 2, universalS: 0 });
    expect(result.witness.rows[1].supply).toMatchObject({ universalS: 4 });
    expect(result.witness.rows[0].supply.typeM * 25 + result.witness.rows[0].supply.species - rows[0].totalCandy).toBe(14);
  });

  it('共有種族は総量最大を守り、実行可能な分配の中でトップダウン正規形へ復元する', () => {
    const rows = [
      demandRow('upper', 1, 'alpha', 25),
      demandRow('lower', 1, 'alpha', 4),
    ];
    const inventory: CandyInventory = {
      species: { '1': 4 },
      typeCandy: { alpha: { s: 0, m: 1 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);

    expect(result.witness.rows.map(row => row.supply.species)).toEqual([0, 4]);
    expect(result.witness.rows.map(row => row.supply.typeM)).toEqual([1, 0]);
    expect(validateFeasibilityWitness(result.witness, rows, inventory, noBoost)).toMatchObject({ valid: true });
  });

  it('共有種族が別タイプの行へまたがっても、連結タイプブロック内で解く', () => {
    const rows = [
      demandRow('upper', 1, 'alpha', 25),
      demandRow('lower', 1, 'beta', 4),
    ];
    const inventory: CandyInventory = {
      species: { '1': 4 },
      typeCandy: { alpha: { s: 0, m: 1 }, beta: { s: 0, m: 0 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);
    expect(result.witness.rows.map(row => row.supply.species)).toEqual([0, 4]);
    expect(result.witness.rows[0].supply.typeM).toBe(1);
    expect(validateFeasibilityWitness(result.witness, rows, inventory, noBoost)).toMatchObject({ valid: true });
  });

  it('同タイプ複数行ではタイプ在庫をタイプブロック内だけで共有する', () => {
    const rows = [
      demandRow('alpha-1', 1, 'alpha', 4),
      demandRow('alpha-2', 2, 'alpha', 25),
      demandRow('beta-1', 3, 'beta', 20),
    ];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 1, m: 1 }, beta: { s: 0, m: 0 } },
      universal: { s: 0, m: 1, l: 0 },
    };
    const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(result);

    expect(result.witness.rows[0].supply.typeS + result.witness.rows[1].supply.typeS).toBeLessThanOrEqual(1);
    expect(result.witness.rows[0].supply.typeM + result.witness.rows[1].supply.typeM).toBeLessThanOrEqual(1);
    expect(result.witness.rows[2].supply.universalM).toBe(1);
  });

  it.each([1, 2, 3, 19, 20, 24, 25, 99, 100])(
    '万能L/M/Sの大余りをfeasibleとして扱う: 需要%d',
    totalCandy => {
      const rows = [demandRow(`universal-${totalCandy}`, totalCandy, 'universal-only', totalCandy)];
      const inventory: CandyInventory = {
        species: {},
        typeCandy: { 'universal-only': { s: 0, m: 0 } },
        universal: { s: 0, m: 0, l: 1 },
      };
      const result = solveFeasibilityForFixedRows(rows, inventory, noBoost);
      expectFeasible(result);
      expect(result.witness.rows[0].supply.universalL).toBe(1);
      expect(result.witness.rows[0].supply.universalL * 100).toBeGreaterThanOrEqual(totalCandy);
    },
  );

  it('タイプ偏在と万能共有競合を全体DPで判定する', () => {
    const rows = [
      demandRow('alpha', 10, 'alpha', 4),
      demandRow('beta', 11, 'beta', 20),
    ];
    const feasibleInventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 1, m: 0 }, beta: { s: 0, m: 0 } },
      universal: { s: 0, m: 1, l: 0 },
    };
    const feasible = solveFeasibilityForFixedRows(rows, feasibleInventory, noBoost);
    expectFeasible(feasible);

    const infeasibleInventory: CandyInventory = {
      ...feasibleInventory,
      universal: { s: 0, m: 0, l: 0 },
    };
    const infeasible = solveFeasibilityForFixedRows(rows, infeasibleInventory, noBoost);
    expect(infeasible.status).toBe('infeasible');
  });

  it('独立境界セッションのdecision envelopeはfull solveと同じ可否を返す', () => {
    const prefixRows = [demandRow('prefix', 10, 'alpha', 20)];
    const boundaryRow = demandRow('boundary', 11, 'beta', 20, { targetReached: false, reachedLv: 54, expInLevel: 1004 });
    const blockedInventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 0, m: 0 }, beta: { s: 0, m: 0 } },
      universal: { s: 0, m: 1, l: 0 },
    };
    const blockedSession = createIndependentBoundaryFeasibilitySession(prefixRows, blockedInventory, noBoost);
    expect(blockedSession?.canSolve(boundaryRow).status).toBe('infeasible');
    expect(solveFeasibilityForFixedRows([...prefixRows, boundaryRow], blockedInventory, noBoost).status).toBe('infeasible');

    const feasibleInventory: CandyInventory = {
      ...blockedInventory,
      universal: { s: 0, m: 2, l: 0 },
    };
    const feasibleSession = createIndependentBoundaryFeasibilitySession(prefixRows, feasibleInventory, noBoost);
    expect(feasibleSession?.canSolve(boundaryRow).status).toBe('feasible');
    expectFeasible(solveFeasibilityForFixedRows([...prefixRows, boundaryRow], feasibleInventory, noBoost));
  });

  it('緩和上界が不可行と判定したprefixをsolverがfeasibleにしない', () => {
    const result = solveFeasibilityForFixedRows([demandRow('relaxation-upper', 12, 'alpha', 4)], {
      species: {},
      typeCandy: { alpha: { s: 0, m: 0 } },
      universal: { s: 0, m: 0, l: 0 },
    }, noBoost);
    expect(result.status).toBe('infeasible');
    if (result.status !== 'infeasible') return;
    expect(result.reason).toBe('relaxation_insufficient_type_or_universal_value');
  });

  it('mini/full/none、かけら境界、個数指定の固定値を変更しない', () => {
    const rows = [
      demandRow('mini', 20, 'alpha', 4, { boostCandy: 2, normalCandy: 2, shards: 5, targetReached: true }),
      demandRow('full', 21, 'beta', 20, { boostCandy: 10, normalCandy: 10, shards: 7, targetReached: false, reachedLv: 31, expInLevel: 99 }),
      demandRow('count', 22, 'gamma', 25, { boostCandy: 0, normalCandy: 25, targetReached: false, reachedLv: 31, expInLevel: 99 }),
    ];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 1, m: 0 }, beta: { s: 0, m: 0 }, gamma: { s: 0, m: 1 } },
      universal: { s: 0, m: 1, l: 0 },
    };
    const options = { boostKind: 'full' as const, boostLimit: 12, dreamShards: 12 };
    const result = solveFeasibilityForFixedRows(rows, inventory, options);
    expectFeasible(result);
    expect(result.witness.rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      targetReached: row.targetReached,
    }))).toEqual(rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      targetReached: row.targetReached,
    })));
    expect(result.witness.reachedCount).toBe(1);
    expect(result.witness.boundaryIndex).toBe(1);
    expect(result.witness.boundaryLevel).toBe(31);
    expect(result.witness.boundaryExpInLevel).toBe(99);

    const mini = solveFeasibilityForFixedRows(rows, inventory, { ...options, boostKind: 'mini' });
    expectFeasible(mini);
  });

  it('prefixを飛ばした入力を到達扱いにしない', () => {
    const rows = [
      demandRow('first', 1, 'alpha', 1, { targetReached: true }),
      demandRow('skipped', 2, 'alpha', 1, { targetReached: false }),
      demandRow('after', 3, 'alpha', 1, { targetReached: true }),
    ];
    const result = solveFeasibilityForFixedRows(rows, {
      ...emptyInventory(),
      species: { '1': 1, '2': 1, '3': 1 },
    }, noBoost);
    expect(result.status).toBe('infeasible');
    if (result.status !== 'infeasible') return;
    expect(result.reason).toContain('prefix');
  });

  it('探索打ち切りはinfeasibleではなくinconclusiveで、渡された床witnessを保持する', () => {
    const rows = [demandRow('p1', 1, 'alpha', 25)];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 0, m: 1 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const baseline = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(baseline);

    const stopped = solveFeasibilityForFixedRows(rows, inventory, {
      ...noBoost,
      abortAfterTransitions: 0,
      fallbackWitness: baseline.witness,
    });
    expect(stopped.status).toBe('inconclusive');
    if (stopped.status !== 'inconclusive') return;
    expect(stopped.witness).toEqual(baseline.witness);
  });

  it('refine成功時は供給内訳だけを置換し、失敗時はfeasibility baselineを維持する', () => {
    const rows = [demandRow('refine-ok', 31, 'alpha', 4)];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 1, m: 0 } },
      universal: { s: 0, m: 0, l: 0 },
    };
    const solved = solveFeasibilityForFixedRows(rows, inventory, noBoost);
    expectFeasible(solved);
    const fixedBeforeRefine = solved.witness.rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      targetReached: row.targetReached,
      species: row.supply.species,
    }));

    const refined = refineFeasibilityWitness(solved.witness, inventory, 'surplusFirst', noBoost);
    expect(refined.status).toBe('refined');
    expect(refined.refineStatus).toBe('ok');
    expect(validateFeasibilityWitness(refined.witness, rows, inventory, noBoost)).toMatchObject({ valid: true });
    expect(refined.witness.rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      targetReached: row.targetReached,
      species: row.supply.species,
    }))).toEqual(fixedBeforeRefine);

    const failureRows = Array.from({ length: 6 }, (_, index) => demandRow(`refine-large-${index}`, 20_000 + index, 'shared', 100));
    const failureInventory: CandyInventory = {
      species: {},
      typeCandy: { shared: { s: 500, m: 120 } },
      universal: { s: 500, m: 120, l: 0 },
    };
    const failureWitness: FeasibilityWitness = {
      reachedCount: failureRows.length,
      boundaryIndex: null,
      boundaryLevel: 0,
      boundaryExpInLevel: 0,
      rows: failureRows.map(row => ({
        ...row,
        supply: { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 5, universalL: 0 },
      })),
      remaining: {
        species: Object.fromEntries(failureRows.map(row => [String(row.pokedexId), 0])),
        typeCandy: { shared: { s: 500, m: 120 } },
        universal: { s: 500, m: 90, l: 0 },
        boostCandy: 0,
        dreamShards: Infinity,
      },
    };
    expect(validateFeasibilityWitness(failureWitness, failureRows, failureInventory, noBoost)).toMatchObject({ valid: true });
    const failed = refineFeasibilityWitness(failureWitness, failureInventory, 'legacyImproved', noBoost);
    expect(failed.status).toBe('baseline');
    expect(failed.refineStatus).toBe('inconclusive');
    expect(failed.witness).toBe(failureWitness);
  });

  it('性能ログは指定されたfrontier/遷移/witness復元統計を出す', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const result = solveFeasibilityForFixedRows([demandRow('perf', 1, 'alpha', 4)], {
        species: {},
        typeCandy: { alpha: { s: 1, m: 0 } },
        universal: { s: 0, m: 0, l: 0 },
      }, { ...noBoost, logPerformance: true });
      expectFeasible(result);
      expect(result.stats.durationMs).toBeGreaterThanOrEqual(0);
      const perfCall = info.mock.calls.find(call => call[0] === '[perf] levelPlanner.feasibilityWitness');
      expect(perfCall).toBeDefined();
      expect(perfCall?.[1]).toMatchObject({
        durationMs: expect.any(Number),
        rowFrontierCounts: expect.any(Array),
        typeBlockFrontierCounts: expect.any(Array),
        globalKeyCount: expect.any(Number),
        transitions: expect.any(Number),
        witnessRestoreMs: expect.any(Number),
      });
    } finally {
      info.mockRestore();
    }
  });

  it('frontier cacheは同じ固定需要の結果を変えず、再solveの遷移を減らす', () => {
    const rows = [
      demandRow('cache-a', 61001, 'alpha', 64),
      demandRow('cache-b', 61002, 'beta', 83),
    ];
    const inventory: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 2, m: 3 }, beta: { s: 4, m: 2 } },
      universal: { s: 80, m: 20, l: 3 },
    };
    const frontierCache = new Map();
    const options = { ...noBoost, itemCompareMode: 'legacyImproved' as const, frontierCache };
    const first = solveFeasibilityForFixedRows(rows, inventory, options);
    const second = solveFeasibilityForFixedRows(rows, inventory, options);
    expectFeasible(first);
    expectFeasible(second);
    expect(second.witness.rows.map(row => row.supply)).toEqual(first.witness.rows.map(row => row.supply));
    expect(second.stats.transitions).toBeLessThan(first.stats.transitions);
  });

  it('単一タイプpruneは小規模全列挙oracleと同じqualityのwitnessを残す', () => {
    const cases: Array<{ rows: FeasibilityDemandRow[]; inventory: CandyInventory }> = [];
    for (const totals of [[5, 8], [6, 9], [5, 7, 10], [8, 11, 12]]) {
      for (const typeS of [1, 2, 3]) {
        for (const typeM of [0, 1]) {
          for (const universalS of [2, 4, 6]) {
            cases.push({
              rows: totals.map((total, index) => demandRow(`same-${totals.join('-')}-${index}`, 100 + index, 'alpha', total, { preferZeroSurplus: index % 2 === 0 })),
              inventory: { species: {}, typeCandy: { alpha: { s: typeS, m: typeM } }, universal: { s: universalS, m: 1, l: 0 } },
            });
          }
        }
      }
    }

    for (const mode of ['legacyImproved', 'surplusFirst'] as const) {
      for (const testCase of cases) {
        const expected = bruteForceBestQuality(testCase.rows, testCase.inventory, mode);
        const result = solveFeasibilityForFixedRows(testCase.rows, testCase.inventory, { ...noBoost, itemCompareMode: mode });
        if (!expected) {
          expect(result.status).toBe('infeasible');
          continue;
        }
        expectFeasible(result);
        expect(compareOracleQuality(qualityFromWitness(result.witness, testCase.rows), expected, mode)).toBe(0);
      }
    }
  });


  it('小規模全列挙oracleとfeasibility判定が一致する', () => {
    const cases: Array<{ rows: FeasibilityDemandRow[]; inventory: CandyInventory }> = [
      {
        rows: [demandRow('a', 1, 'alpha', 1), demandRow('b', 1, 'alpha', 2)],
        inventory: { species: { '1': 1 }, typeCandy: { alpha: { s: 1, m: 0 } }, universal: { s: 1, m: 0, l: 0 } },
      },
      {
        rows: [demandRow('a', 2, 'alpha', 4), demandRow('b', 3, 'alpha', 5)],
        inventory: { species: {}, typeCandy: { alpha: { s: 1, m: 0 } }, universal: { s: 2, m: 0, l: 0 } },
      },
      {
        rows: [demandRow('a', 4, 'alpha', 6), demandRow('b', 4, 'alpha', 3)],
        inventory: { species: { '4': 2 }, typeCandy: { alpha: { s: 1, m: 0 } }, universal: { s: 1, m: 0, l: 0 } },
      },
    ];

    for (const testCase of cases) {
      const expected = bruteForceFeasible(testCase.rows, testCase.inventory);
      const actual = solveFeasibilityForFixedRows(testCase.rows, testCase.inventory, noBoost).status === 'feasible';
      expect(actual, JSON.stringify(testCase)).toBe(expected);
    }
  });

  it('小在庫の決定的マトリクスで全列挙oracleとの差を出さない', () => {
    for (let seed = 0; seed < 18; seed++) {
      const shared = seed % 2 === 0;
      const rows = [
        demandRow(`oracle-a-${seed}`, shared ? 40 : 40 + seed, 'alpha', 1 + (seed % 8)),
        demandRow(`oracle-b-${seed}`, shared ? 40 : 41 + seed, 'alpha', 1 + ((seed * 3) % 8)),
      ];
      const inventory: CandyInventory = {
        species: shared ? { '40': seed % 4 } : {},
        typeCandy: { alpha: { s: seed % 3, m: seed % 2 } },
        universal: { s: (seed + 1) % 3, m: seed % 2, l: seed % 2 },
      };
      const expected = bruteForceFeasible(rows, inventory);
      const actual = solveFeasibilityForFixedRows(rows, inventory, noBoost).status === 'feasible';
      expect(actual, `seed=${seed}`).toBe(expected);
    }
  });

  it('小在庫の決定的ランダムoracle 120ケースでfeasible判定を一致させる', () => {
    for (let seed = 0; seed < 120; seed++) {
      const shared = seed % 3 === 0;
      const rows = [
        demandRow(`random-a-${seed}`, shared ? 900 : 900 + seed, 'alpha', 1 + (seed % 10)),
        demandRow(`random-b-${seed}`, shared ? 900 : 1000 + seed, seed % 4 === 0 ? 'beta' : 'alpha', 1 + ((seed * 7) % 10)),
        demandRow(`random-c-${seed}`, 1100 + seed, 'beta', 1 + ((seed * 5) % 7)),
      ];
      const inventory: CandyInventory = {
        species: shared ? { '900': seed % 4 } : { [String(900 + seed)]: seed % 3 },
        typeCandy: { alpha: { s: seed % 3, m: (seed + 1) % 2 }, beta: { s: (seed + 2) % 3, m: seed % 2 } },
        universal: { s: (seed + 1) % 3, m: seed % 2, l: seed % 2 },
      };
      const expected = bruteForceFeasible(rows, inventory);
      const actual = solveFeasibilityForFixedRows(rows, inventory, noBoost).status === 'feasible';
      expect(actual, `seed=${seed}`).toBe(expected);
    }
  });

  it('row/type-block/global frontierと遷移数・witness復元時間を記録する', () => {
    const rows = Array.from({ length: 10 }, (_, index) => demandRow(`p${index}`, 100 + index, 'alpha', 4 + (index % 3)));
    const result = solveFeasibilityForFixedRows(rows, {
      species: {},
      typeCandy: { alpha: { s: 20, m: 0 } },
      universal: { s: 20, m: 0, l: 0 },
    }, noBoost);
    expectFeasible(result);
    expect(result.stats.rowOptionCounts).toHaveLength(rows.length);
    expect(result.stats.rowFrontierCounts).toHaveLength(rows.length);
    expect(result.stats.typeBlockFrontierCounts).toEqual([expect.any(Number)]);
    expect(result.stats.globalKeyCount).toBeGreaterThan(0);
    expect(result.stats.transitions).toBeGreaterThan(0);
    expect(result.stats.witnessRestoreMs).toBeGreaterThanOrEqual(0);
  });

  it('§16の性能マトリクス各ケースでfrontier統計を記録する', () => {
    const cases: Array<{ name: string; rows: FeasibilityDemandRow[]; inventory: CandyInventory; options?: Parameters<typeof solveFeasibilityForFixedRows>[2] }> = [
      {
        name: 'same-type-10',
        rows: Array.from({ length: 10 }, (_, index) => demandRow(`same-type-${index}`, 2_000 + index, 'alpha', 4)),
        inventory: { species: {}, typeCandy: { alpha: { s: 10, m: 0 } }, universal: { s: 0, m: 0, l: 0 } },
      },
      {
        name: 'all-distinct-types',
        rows: Array.from({ length: 6 }, (_, index) => demandRow(`distinct-${index}`, 2_100 + index, `type-${index}`, 4)),
        inventory: { species: {}, typeCandy: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`type-${index}`, { s: 1, m: 0 }])), universal: { s: 0, m: 0, l: 0 } },
      },
      {
        name: 'same-species',
        rows: Array.from({ length: 6 }, (_, index) => demandRow(`same-species-${index}`, 2_200, 'shared', 4)),
        inventory: { species: { '2200': 6 }, typeCandy: { shared: { s: 0, m: 0 } }, universal: { s: 6, m: 0, l: 0 } },
      },
      {
        name: 'universal-only',
        rows: [demandRow('universal-small', 2_300, 'universal', 1), demandRow('universal-large', 2_301, 'universal', 100)],
        inventory: { species: {}, typeCandy: { universal: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 2 } },
      },
      {
        name: 'type-skew',
        rows: [demandRow('type-s', 2_400, 'alpha', 4), demandRow('type-m', 2_401, 'beta', 25)],
        inventory: { species: {}, typeCandy: { alpha: { s: 1, m: 0 }, beta: { s: 0, m: 1 } }, universal: { s: 0, m: 0, l: 0 } },
      },
      {
        name: 'surplus-and-shards',
        rows: [
          demandRow('surplus-1', 2_500, 'gamma', 1, { shards: 4, reachedLv: 29, expInLevel: 99 }),
          demandRow('surplus-99', 2_501, 'gamma', 99, { shards: 5, reachedLv: 30, expInLevel: 1, targetReached: false }),
          demandRow('surplus-100', 2_502, 'gamma', 100, { shards: 6, reachedLv: 30, expInLevel: 2, targetReached: false }),
        ],
        inventory: { species: {}, typeCandy: { gamma: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 3 } },
        options: { boostKind: 'full', boostLimit: 0, dreamShards: 15 },
      },
    ];

    for (const testCase of cases) {
      const result = solveFeasibilityForFixedRows(testCase.rows, testCase.inventory, testCase.options ?? noBoost);
      expectFeasible(result);
      expect(result.stats.rowOptionCounts).toHaveLength(testCase.rows.length);
      expect(result.stats.rowFrontierCounts).toHaveLength(testCase.rows.length);
      expect(result.stats.typeBlockFrontierCounts.length).toBeGreaterThan(0);
      expect(result.stats.globalKeyCount).toBeGreaterThan(0);
      expect(result.stats.transitions, testCase.name).toBeGreaterThan(0);
      expect(result.stats.witnessRestoreMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('feasibility witnessの出力を固定需要行へ変換し、合同solverとrefineを検証できる', () => {
    const input: LevelPlannerInput = {
      pokemonList: [
        { pokemonId: 'upper', pokedexId: 501, name: '上位', type: 'alpha', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 4 }, priorityIndex: 0 },
        { pokemonId: 'second', pokedexId: 502, name: '二体目', type: 'alpha', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 25 }, priorityIndex: 1 },
        { pokemonId: 'boundary', pokedexId: 503, name: '境界', type: 'alpha', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 4 }, priorityIndex: 2 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: { alpha: { s: 1, m: 1 } },
        universal: { s: 0, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'surplusFirst' },
    };
    const baseline = solveLevelPlan(input);
    const fixedRows = baseline.pokemonResults.map((pokemon, index): FeasibilityDemandRow => ({
      pokemonId: pokemon.pokemonId,
      pokedexId: pokemon.pokedexId,
      type: input.pokemonList[index].type,
      totalCandy: pokemon.reachableLine.totalCandyUnitsUsed,
      boostCandy: pokemon.reachableLine.boostedCandyUnits,
      normalCandy: pokemon.reachableLine.nonBoostCandyUnits,
      shards: pokemon.reachableLine.dreamShardsUsed,
      reachedLv: pokemon.reachableLine.level,
      expInLevel: pokemon.reachableLine.expInLevel,
      targetReached: pokemon.reachableLine.targetReached,
    }));
    const solved = solveFeasibilityForFixedRows(fixedRows, input.candyInventory, {
      boostKind: input.boost.kind,
      boostLimit: input.boost.limit,
      dreamShards: input.dreamShards,
      logPerformance: false,
    });
    expectFeasible(solved);
    expect(solved.witness.reachedCount).toBe(baseline.summary.fullyReachedCount);
    expect(solved.witness.boundaryIndex).toBe(fixedRows.findIndex(row => !row.targetReached));

    const exactRows = solved.witness.rows.map((row, index) => {
      const supply = row.supply.species
        + row.supply.typeS * 4
        + row.supply.typeM * 25
        + row.supply.universalS * 3
        + row.supply.universalM * 20
        + row.supply.universalL * 100;
      return {
        id: row.pokemonId,
        name: input.pokemonList[index].name,
        pokedexId: row.pokedexId,
        type: row.type,
        totalCandyCount: row.totalCandy,
        fixedSpecies: row.supply.species,
        selected: {
          species: row.supply.species,
          typeS: row.supply.typeS,
          typeM: row.supply.typeM,
          universalS: row.supply.universalS,
          universalM: row.supply.universalM,
          universalL: row.supply.universalL,
          supply,
          surplus: supply - row.totalCandy,
        },
      };
    });
    const refined = refineExactSupply(exactRows, input.candyInventory, 'surplusFirst');
    expect(refined.status).toBe('ok');
    if (refined.status !== 'ok') return;
    refined.bestRows.forEach((row, index) => {
      expect(row.species).toBe(solved.witness.rows[index].supply.species);
      expect(row.supply).toBeGreaterThanOrEqual(solved.witness.rows[index].totalCandy);
    });

    expect(solved.witness.reachedCount).toBeGreaterThan(1);
  });

  it('実ケース: UIでbaselineへ落ちた6行miniケースを固定需要solverで安全に観測できる', () => {
    const rows: FeasibilityDemandRow[] = [
      demandRow('id_z4cy1n49yzj_mrg52n3n', 923, 'Electric', 316, {
        boostCandy: 316,
        normalCandy: 0,
        shards: 1_383_628,
        reachedLv: 70,
        expInLevel: 0,
      }),
      demandRow('id_5tlnyjy0ssi_mrg53aly', 845, 'Flying', 264, {
        boostCandy: 34,
        normalCandy: 230,
        shards: 444_663,
        reachedLv: 70,
        expInLevel: 0,
      }),
      demandRow('id_sds1zvu57t_mrg54714', 700, 'Fairy', 3_598, {
        boostCandy: 0,
        normalCandy: 3_598,
        shards: 1_995_315,
        reachedLv: 70,
        expInLevel: 0,
      }),
      demandRow('id_q0yknqotgp_mrg5jsml', 149, 'Dragon', 948, {
        boostCandy: 0,
        normalCandy: 948,
        shards: 1_038_059,
        reachedLv: 70,
        expInLevel: 0,
      }),
      demandRow('id_kwjj92i5lf_mrgdh5jn', 317, 'Poison', 308, {
        boostCandy: 0,
        normalCandy: 308,
        shards: 170_630,
        reachedLv: 60,
        expInLevel: 16,
      }),
      demandRow('id_kdcasn6c56_mrkrawto', 488, 'Psychic', 1_138, {
        boostCandy: 0,
        normalCandy: 1_138,
        shards: 1_246_158,
        reachedLv: 70,
        expInLevel: 0,
      }),
    ];
    const inventory: CandyInventory = {
      species: {
        '923': 181,
        '845': 0,
        '700': 2947,
        '149': 436,
        '317': 272,
        '488': 500,
      },
      typeCandy: {
        Electric: { s: 0, m: 0 },
        Flying: { s: 0, m: 0 },
        Fairy: { s: 0, m: 10 },
        Dragon: { s: 31, m: 10 },
        Poison: { s: 0, m: 1 },
        Psychic: { s: 18, m: 10 },
      },
      universal: { s: 432, m: 102, l: 9 },
    };

    const result = solveFeasibilityForFixedRows(rows, inventory, {
      boostKind: 'mini',
      boostLimit: 350,
      dreamShards: 10_000_000,
      deadlineMs: 250,
    });

    expect(result.status).not.toBe('infeasible');
    if (result.status !== 'feasible') {
      expect(result.reason).toBe('deadline_exceeded');
      return;
    }

    expect(validateFeasibilityWitness(result.witness, rows, inventory, {
      boostKind: 'mini',
      boostLimit: 350,
      dreamShards: 10_000_000,
    })).toMatchObject({ valid: true });
    expect(result.witness.reachedCount).toBe(6);
  });

  it('refine後も固定需要・かけら・Lv+EXP・種族アメを変更しない', () => {
    const rows = [
      demandRow('fixed-a', 601, 'alpha', 4, { boostCandy: 2, normalCandy: 2, shards: 7, reachedLv: 31, expInLevel: 17 }),
      demandRow('fixed-b', 602, 'alpha', 20, { boostCandy: 5, normalCandy: 15, shards: 11, reachedLv: 32, expInLevel: 3, targetReached: false }),
    ];
    const inventory: CandyInventory = {
      species: { '601': 1, '602': 0 },
      typeCandy: { alpha: { s: 1, m: 1 } },
      universal: { s: 2, m: 1, l: 0 },
    };
    const solved = solveFeasibilityForFixedRows(rows, inventory, { boostKind: 'full', boostLimit: 7, dreamShards: 18 });
    expectFeasible(solved);
    const fixed = solved.witness.rows.map(row => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      targetReached: row.targetReached,
      species: row.supply.species,
    }));
    const exactRows = solved.witness.rows.map(row => {
      const supply = row.supply.species
        + row.supply.typeS * 4
        + row.supply.typeM * 25
        + row.supply.universalS * 3
        + row.supply.universalM * 20
        + row.supply.universalL * 100;
      return {
        id: row.pokemonId,
        name: row.pokemonId,
        pokedexId: row.pokedexId,
        type: row.type,
        totalCandyCount: row.totalCandy,
        fixedSpecies: row.supply.species,
        selected: { ...row.supply, supply, surplus: supply - row.totalCandy },
      };
    });
    const refined = refineExactSupply(exactRows, inventory, 'surplusFirst');
    expect(refined.status).toBe('ok');
    if (refined.status !== 'ok') return;
    const after = solved.witness.rows.map((row, index) => ({
      totalCandy: row.totalCandy,
      boostCandy: row.boostCandy,
      normalCandy: row.normalCandy,
      shards: row.shards,
      reachedLv: row.reachedLv,
      expInLevel: row.expInLevel,
      targetReached: row.targetReached,
      species: refined.bestRows[index].species,
    }));
    expect(after).toEqual(fixed);
  });
});

type OracleSupply = {
  species: number;
  typeS: number;
  typeM: number;
  universalS: number;
  universalM: number;
  universalL: number;
};

type OracleQuality = {
  zeroSurplusCount: number;
  normalizedSurplus: number;
  maxSurplus: number;
  rawSurplus: number;
  speciesLex: number;
  priority: [number, number, number, number, number];
  legacyPriority: [number, number, number, number];
};

function oracleValue(supply: OracleSupply): number {
  return supply.species
    + supply.typeS * 4
    + supply.typeM * 25
    + supply.universalS * 3
    + supply.universalM * 20
    + supply.universalL * 100;
}

function emptyOracleQuality(): OracleQuality {
  return {
    zeroSurplusCount: 0,
    normalizedSurplus: 0,
    maxSurplus: 0,
    rawSurplus: 0,
    speciesLex: 0,
    priority: [0, 0, 0, 0, 0],
    legacyPriority: [0, 0, 0, 0],
  };
}

function oracleQualityForSupply(supply: OracleSupply, row: FeasibilityDemandRow): OracleQuality {
  const surplus = Math.max(0, oracleValue(supply) - row.totalCandy);
  const speciesLexWeight = row.speciesLexWeight ?? 0;
  return {
    zeroSurplusCount: row.preferZeroSurplus && surplus === 0 ? 1 : 0,
    normalizedSurplus: surplus <= 2 ? 0 : surplus,
    maxSurplus: surplus,
    rawSurplus: surplus,
    speciesLex: supply.species * speciesLexWeight,
    priority: [supply.typeS, supply.typeM, supply.universalS, supply.universalM, supply.universalL],
    legacyPriority: [-supply.universalL, -supply.universalM, supply.typeS, supply.typeM],
  };
}

function addOracleQuality(a: OracleQuality, b: OracleQuality): OracleQuality {
  return {
    zeroSurplusCount: a.zeroSurplusCount + b.zeroSurplusCount,
    normalizedSurplus: a.normalizedSurplus + b.normalizedSurplus,
    maxSurplus: Math.max(a.maxSurplus, b.maxSurplus),
    rawSurplus: a.rawSurplus + b.rawSurplus,
    speciesLex: a.speciesLex + b.speciesLex,
    priority: a.priority.map((value, index) => value + b.priority[index]) as OracleQuality['priority'],
    legacyPriority: a.legacyPriority.map((value, index) => value + b.legacyPriority[index]) as OracleQuality['legacyPriority'],
  };
}

function compareOracleQuality(a: OracleQuality, b: OracleQuality, mode?: SolverItemCompareMode): number {
  if (mode === 'surplusFirst') {
    if (a.rawSurplus !== b.rawSurplus) return a.rawSurplus < b.rawSurplus ? 1 : -1;
    if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
    for (let index = 0; index < a.priority.length; index++) {
      if (a.priority[index] !== b.priority[index]) return a.priority[index] > b.priority[index] ? 1 : -1;
    }
    return 0;
  }
  if (mode === 'legacyImproved') {
    if (a.zeroSurplusCount !== b.zeroSurplusCount) return a.zeroSurplusCount > b.zeroSurplusCount ? 1 : -1;
    const acceptableA = a.normalizedSurplus === 0;
    const acceptableB = b.normalizedSurplus === 0;
    if (acceptableA !== acceptableB) return acceptableA ? 1 : -1;
    if (!acceptableA && a.normalizedSurplus !== b.normalizedSurplus) return a.normalizedSurplus < b.normalizedSurplus ? 1 : -1;
    if (a.speciesLex !== b.speciesLex) return a.speciesLex > b.speciesLex ? 1 : -1;
    for (let index = 0; index < a.legacyPriority.length; index++) {
      if (a.legacyPriority[index] !== b.legacyPriority[index]) return a.legacyPriority[index] > b.legacyPriority[index] ? 1 : -1;
    }
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

function qualityFromWitness(witness: FeasibilityWitness, rows: FeasibilityDemandRow[]): OracleQuality {
  return witness.rows.reduce((quality, row, index) => addOracleQuality(quality, oracleQualityForSupply(row.supply, rows[index])), emptyOracleQuality());
}

function bruteForceBestQuality(rows: FeasibilityDemandRow[], inventory: CandyInventory, mode?: SolverItemCompareMode): OracleQuality | null {
  const options = rows.map(row => {
    const typeStock = inventory.typeCandy[row.type] ?? { s: 0, m: 0 };
    const speciesStock = inventory.species[String(row.pokedexId)] ?? 0;
    const result: OracleSupply[] = [];
    for (let species = 0; species <= speciesStock; species++) {
      for (let typeS = 0; typeS <= typeStock.s; typeS++) {
        for (let typeM = 0; typeM <= typeStock.m; typeM++) {
          for (let universalS = 0; universalS <= inventory.universal.s; universalS++) {
            for (let universalM = 0; universalM <= inventory.universal.m; universalM++) {
              for (let universalL = 0; universalL <= inventory.universal.l; universalL++) {
                const supply = { species, typeS, typeM, universalS, universalM, universalL };
                if (oracleValue(supply) >= row.totalCandy) result.push(supply);
              }
            }
          }
        }
      }
    }
    return result;
  });

  let best: OracleQuality | null = null;
  const search = (
    index: number,
    typeSUsed: Record<string, number>,
    typeMUsed: Record<string, number>,
    universalS: number,
    universalM: number,
    universalL: number,
    quality: OracleQuality,
  ): void => {
    if (index === rows.length) {
      if (!best || compareOracleQuality(quality, best, mode) > 0) best = quality;
      return;
    }
    const row = rows[index];
    for (const option of options[index]) {
      const nextTypeS = (typeSUsed[row.type] ?? 0) + option.typeS;
      const nextTypeM = (typeMUsed[row.type] ?? 0) + option.typeM;
      if (nextTypeS > (inventory.typeCandy[row.type]?.s ?? 0) || nextTypeM > (inventory.typeCandy[row.type]?.m ?? 0)) continue;
      if (universalS + option.universalS > inventory.universal.s) continue;
      if (universalM + option.universalM > inventory.universal.m) continue;
      if (universalL + option.universalL > inventory.universal.l) continue;
      search(
        index + 1,
        { ...typeSUsed, [row.type]: nextTypeS },
        { ...typeMUsed, [row.type]: nextTypeM },
        universalS + option.universalS,
        universalM + option.universalM,
        universalL + option.universalL,
        addOracleQuality(quality, oracleQualityForSupply(option, row)),
      );
    }
  };

  search(0, {}, {}, 0, 0, 0, emptyOracleQuality());
  return best;
}

function bruteForceFeasible(rows: FeasibilityDemandRow[], inventory: CandyInventory): boolean {
  const options = rows.map(row => {
    const typeStock = inventory.typeCandy[row.type] ?? { s: 0, m: 0 };
    const speciesStock = inventory.species[String(row.pokedexId)] ?? 0;
    const result: OracleSupply[] = [];
    for (let species = 0; species <= speciesStock; species++) {
      for (let typeS = 0; typeS <= typeStock.s; typeS++) {
        for (let typeM = 0; typeM <= typeStock.m; typeM++) {
          for (let universalS = 0; universalS <= inventory.universal.s; universalS++) {
            for (let universalM = 0; universalM <= inventory.universal.m; universalM++) {
              for (let universalL = 0; universalL <= inventory.universal.l; universalL++) {
                const supply = { species, typeS, typeM, universalS, universalM, universalL };
                if (oracleValue(supply) >= row.totalCandy) result.push(supply);
              }
            }
          }
        }
      }
    }
    return result;
  });

  const search = (index: number, selected: OracleSupply[]): boolean => {
    if (index === rows.length) {
      const speciesUsed = new Map<string, number>();
      const typeSUsed = new Map<string, number>();
      const typeMUsed = new Map<string, number>();
      let universalS = 0;
      let universalM = 0;
      let universalL = 0;
      rows.forEach((row, rowIndex) => {
        const supply = selected[rowIndex];
        const speciesKey = String(row.pokedexId);
        speciesUsed.set(speciesKey, (speciesUsed.get(speciesKey) ?? 0) + supply.species);
        typeSUsed.set(row.type, (typeSUsed.get(row.type) ?? 0) + supply.typeS);
        typeMUsed.set(row.type, (typeMUsed.get(row.type) ?? 0) + supply.typeM);
        universalS += supply.universalS;
        universalM += supply.universalM;
        universalL += supply.universalL;
      });
      for (const [key, amount] of speciesUsed) {
        if (amount !== Math.min(inventory.species[key] ?? 0, rows.filter(row => String(row.pokedexId) === key).reduce((sum, row) => sum + row.totalCandy, 0))) return false;
      }
      for (const [type, amount] of typeSUsed) if (amount > (inventory.typeCandy[type]?.s ?? 0)) return false;
      for (const [type, amount] of typeMUsed) if (amount > (inventory.typeCandy[type]?.m ?? 0)) return false;
      return universalS <= inventory.universal.s
        && universalM <= inventory.universal.m
        && universalL <= inventory.universal.l;
    }
    return options[index].some(option => search(index + 1, [...selected, option]));
  };

  return search(0, []);
}
