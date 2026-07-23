import { describe, expect, it, vi } from 'vitest';
import { CANDY_VALUES, MAX_ACCEPTABLE_SURPLUS } from '../../../src/domain/level-planner/constants';
import { __levelPlannerTestHooks, solveLevelPlan, solveLevelPlanWithBudget } from '../../../src/domain/level-planner/core/solveLevelPlan';
import type { CandySupplyBreakdown, LevelPlannerInput, SolverItemCompareMode } from '../../../src/domain/level-planner/types';
import { calcExp } from '../../../src/domain/pokesleep/exp';
import { setPerfEnabled } from '../../../src/utils/perf';

const inventory = {
  species: { '25': 1000 },
  typeCandy: { electric: { s: 100, m: 20 } },
  universal: { s: 1000, m: 100, l: 10 },
};

function supplyValueWithoutSpecies(supply: CandySupplyBreakdown): number {
  return supply.type.s * CANDY_VALUES.type.s
    + supply.type.m * CANDY_VALUES.type.m
    + supply.universal.s * CANDY_VALUES.universal.s
    + supply.universal.m * CANDY_VALUES.universal.m
    + supply.universal.l * CANDY_VALUES.universal.l;
}

function stableSupplies(supplies: CandySupplyBreakdown[]): string[] {
  return supplies.map(supply => JSON.stringify(supply)).sort();
}

function constrainedCandyTargetInput(itemCompareMode: SolverItemCompareMode): LevelPlannerInput {
  return {
    pokemonList: [
      { pokemonId: 'latias', pokedexId: 380, name: '70ラティアス', type: 'dragon', currentLevel: 55, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 1080, nature: 'normal', requestedBoostCandy: 1561, boostAllowed: true, priorityIndex: 0 },
      { pokemonId: 'drampa', pokedexId: 780, name: '80仮ジジーロン', type: 'dragon', currentLevel: 25, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600, nature: 'down', requestedBoostCandy: 998, boostAllowed: true, priorityIndex: 1 },
      { pokemonId: 'suicune', pokedexId: 245, name: '70スイクン', type: 'water', currentLevel: 61, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 1080, nature: 'down', requestedBoostCandy: 941, boostAllowed: true, candyTarget: { totalCandyUnits: 551 }, priorityIndex: 2 },
    ],
    dreamShards: 10_000_000,
    boost: { kind: 'full', limit: 3_500 },
    candyInventory: {
      species: { '380': 319, '780': 656, '245': 478 },
      typeCandy: { dragon: { s: 13, m: 0 }, water: { s: 0, m: 0 } },
      universal: { s: 432, m: 102, l: 9 },
    },
    options: { itemCompareMode },
  };
}

describe('単一最適化パイプライン', () => {
  it('既定で余り最小化・目標到達・3行構造を返す', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'pika', pokedexId: 25, name: 'ピカチュウ', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 20, expType: 600, nature: 'normal', requestedBoostCandy: 1000, boostAllowed: true, priorityIndex: 99 }],
      dreamShards: Infinity,
      boost: { kind: 'full', limit: 1000 },
      candyInventory: inventory,
    });
    const p = result.pokemonResults[0];
    expect(p.targetReached).toBe(true);
    expect(p.role).toBe('upper');
    expect(p.targetLine.level).toBe(20);
    expect(p.reachableLine.boostedCandyUnits).toBeGreaterThan(0);
    expect(result.summary.boost.boostUsed).toBe(p.reachableLine.boostedCandyUnits);
  });

  it('最初に未達となるポケモンを境界として扱い、下位は到達判定に影響しない', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'upper', pokedexId: 25, name: '上位', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, expType: 600, nature: 'normal', requestedBoostCandy: 100, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'boundary', pokedexId: 26, name: '境界', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 30, expType: 600, nature: 'normal', requestedBoostCandy: 100, boostAllowed: true, priorityIndex: 1 },
      ],
      dreamShards: 0,
      boost: { kind: 'full', limit: 200 },
      candyInventory: inventory,
      options: { itemCompareMode: 'surplusFirst' },
    });
    expect(result.pokemonResults[0].role).toBe('boundary');
    expect(result.pokemonResults[1].role).toBe('lower');
    expect(result.pokemonResults[1].targetReached).toBe(false);
    expect(result.pokemonResults[1].reachableLine.targetReached).toBe(false);
    expect(result.pokemonResults[1].shortage.expToTarget).toBeGreaterThan(0);
    expect(result.pokemonResults[1].shortage.dreamShardShortage).toBeGreaterThan(0);
    expect(result.pokemonResults[1].constraintDiagnosis.limitingFactor).toBe('shards');
    expect(result.summary.boundaryPokemonId).toBe('upper');
  });

  it('fbl01d exactはソフト締切でprefixを途中採用せず、到達可能なクレセリアまで配分する', () => {
    const outcome = solveLevelPlanWithBudget({
      pokemonList: [
        { pokemonId: 'pawmot', pokedexId: 923, name: '80パーモット', type: 'electric', currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, expType: 1080, nature: 'normal', requestedBoostCandy: 316, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'cramorant', pokedexId: 845, name: '70ウッウ（油）', type: 'flying', currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, expType: 900, nature: 'down', requestedBoostCandy: 264, boostAllowed: true, priorityIndex: 1 },
        { pokemonId: 'sylveon', pokedexId: 700, name: '70仮ニンフィア', type: 'fairy', currentLevel: 16, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'down', requestedBoostCandy: 3598, boostAllowed: true, priorityIndex: 2 },
        { pokemonId: 'dragonite', pokedexId: 149, name: '80カイリュー', type: 'dragon', currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, expType: 1080, nature: 'normal', requestedBoostCandy: 948, boostAllowed: true, priorityIndex: 3 },
        { pokemonId: 'swalot', pokedexId: 317, name: '70マルノーム', type: 'poison', currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, expType: 1080, nature: 'down', requestedBoostCandy: 308, boostAllowed: true, priorityIndex: 4 },
        { pokemonId: 'cresselia', pokedexId: 488, name: '70仮クレセリア', type: 'psychic', currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, expType: 1080, nature: 'normal', requestedBoostCandy: 1138, boostAllowed: true, priorityIndex: 5 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'mini', limit: 350 },
      candyInventory: {
        species: { '923': 181, '845': 0, '700': 2947, '149': 436, '317': 272, '488': 500 },
        typeCandy: {
          electric: { s: 0, m: 0 },
          flying: { s: 0, m: 0 },
          fairy: { s: 0, m: 10 },
          dragon: { s: 13, m: 0 },
          poison: { s: 0, m: 2 },
          psychic: { s: 18, m: 10 },
        },
        universal: { s: 432, m: 102, l: 9 },
      },
      options: { itemCompareMode: 'legacyImproved' },
    }, { calculationMode: 'exact', deadlineMs: 20 });

    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    const cresselia = outcome.result.pokemonResults.find(row => row.pokemonId === 'cresselia');
    expect(cresselia?.targetReached).toBe(true);
    expect(cresselia?.reachableLine.level).toBe(70);
  });

  it('fbl01d exactは到達不能な下位ゼロ行を到達済み扱いにしない', () => {
    const outcome = solveLevelPlanWithBudget({
      pokemonList: [
        { pokemonId: 'cresselia', pokedexId: 488, name: '70仮クレセリア', type: 'psychic', currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, expType: 1080, nature: 'normal', requestedBoostCandy: 1138, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'lower-zero', pokedexId: 244, name: '下位ゼロ', type: 'fire', currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, expType: 1080, nature: 'down', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 100 }, priorityIndex: 1 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'mini', limit: 350 },
      candyInventory: {
        species: { '488': 500, '244': 0 },
        typeCandy: {
          psychic: { s: 18, m: 10 },
          fire: { s: 0, m: 0 },
        },
        universal: { s: 0, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'legacyImproved' },
    }, { calculationMode: 'exact', deadlineMs: 20 });

    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    const cresselia = outcome.result.pokemonResults.find(row => row.pokemonId === 'cresselia');
    const lowerZero = outcome.result.pokemonResults.find(row => row.pokemonId === 'lower-zero');
    expect(cresselia?.targetReached).toBe(true);
    expect(cresselia?.reachableLine.totalCandyUnitsUsed).toBeGreaterThan(0);
    expect(lowerZero?.targetReached).toBe(false);
    expect(lowerZero?.reachableLine.totalCandyUnitsUsed).toBe(0);
    expect(lowerZero?.constraintDiagnosis.limitingFactor).toBe('candy');
  });

  it.each(['legacyImproved', 'surplusGateFirst'] as const)('%s は同タイプ境界の二分探索を初回feasibleで止めず最大到達量まで伸ばす', itemCompareMode => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'shared-type-prefix', pokedexId: 12001, name: '共有タイプ上位', type: 'fire' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 20 }, priorityIndex: 0 },
        { pokemonId: 'shared-type-boundary', pokedexId: 12002, name: '共有タイプ境界', type: 'fire' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 50 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: { '12001': 20 },
        typeCandy: { fire: { s: 0, m: 1 } },
        universal: { s: 5, m: 0, l: 0 },
      },
      options: { itemCompareMode },
    });

    const boundary = result.pokemonResults.find(row => row.pokemonId === 'shared-type-boundary')?.reachableLine;

    expect(boundary?.targetReached).toBe(false);
    expect(boundary?.totalCandyUnitsUsed).toBe(40);
    expect(result.performance?.boundarySearch).toMatchObject({
      mode: itemCompareMode,
      boundaryIndex: 1,
      maxFeasibleTotalCandy: 40,
      selectedTotalCandy: 40,
    });
  });

  it('fbl01d frontier cacheは連続solveで厳密保証軸を変えない', () => {
    __levelPlannerTestHooks.clearCandidateCache();
    const input: LevelPlannerInput = {
      pokemonList: [
        { pokemonId: 'pawmot', pokedexId: 923, name: '80パーモット', type: 'electric', currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, expType: 1080, nature: 'normal', requestedBoostCandy: 316, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'cramorant', pokedexId: 845, name: '70ウッウ（油）', type: 'flying', currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, expType: 900, nature: 'down', requestedBoostCandy: 264, boostAllowed: true, priorityIndex: 1 },
        { pokemonId: 'sylveon', pokedexId: 700, name: '70仮ニンフィア', type: 'fairy', currentLevel: 16, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'down', requestedBoostCandy: 3598, boostAllowed: true, priorityIndex: 2 },
        { pokemonId: 'dragonite', pokedexId: 149, name: '80カイリュー', type: 'dragon', currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, expType: 1080, nature: 'normal', requestedBoostCandy: 948, boostAllowed: true, priorityIndex: 3 },
        { pokemonId: 'swalot', pokedexId: 317, name: '70マルノーム', type: 'poison', currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, expType: 1080, nature: 'down', requestedBoostCandy: 308, boostAllowed: true, priorityIndex: 4 },
        { pokemonId: 'cresselia', pokedexId: 488, name: '70仮クレセリア', type: 'psychic', currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, expType: 1080, nature: 'normal', requestedBoostCandy: 1138, boostAllowed: true, priorityIndex: 5 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'mini', limit: 350 },
      candyInventory: {
        species: { '923': 181, '845': 0, '700': 2947, '149': 436, '317': 272, '488': 500 },
        typeCandy: {
          electric: { s: 0, m: 0 },
          flying: { s: 0, m: 0 },
          fairy: { s: 0, m: 10 },
          dragon: { s: 13, m: 0 },
          poison: { s: 0, m: 2 },
          psychic: { s: 18, m: 10 },
        },
        universal: { s: 432, m: 102, l: 9 },
      },
      options: { itemCompareMode: 'legacyImproved' },
    };

    const first = solveLevelPlanWithBudget(input, { calculationMode: 'exact', deadlineMs: 30_000 });
    const cacheSize = __levelPlannerTestHooks.fbl01dFrontierCacheSize();
    const second = solveLevelPlanWithBudget(input, { calculationMode: 'exact', deadlineMs: 30_000 });
    expect(first.kind).toBe('result');
    expect(second.kind).toBe('result');
    if (first.kind !== 'result' || second.kind !== 'result') return;
    expect(cacheSize).toBeGreaterThan(0);
    // 供給内訳refineは250msで打ち切る任意処理なので、CPU負荷とcacheの温冷により
    // 同価な行別内訳は変わり得る。cache不変条件はfbl01dが厳密保証する軸に限定する。
    expect(second.result.pokemonResults.map(row => ({
      id: row.pokemonId,
      level: row.reachableLine.level,
      exp: row.reachableLine.expInLevel,
      targetReached: row.reachableLine.targetReached,
      totalCandy: row.reachableLine.totalCandyUnitsUsed,
    }))).toEqual(first.result.pokemonResults.map(row => ({
      id: row.pokemonId,
      level: row.reachableLine.level,
      exp: row.reachableLine.expInLevel,
      targetReached: row.reachableLine.targetReached,
      totalCandy: row.reachableLine.totalCandyUnitsUsed,
    })));
  });

  it('fbl01d本線はfeasibility decisionを使う', () => {
    setPerfEnabled(true);
    __levelPlannerTestHooks.clearCandidateCache();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const input = {
      pokemonList: [
        { pokemonId: 'first', pokedexId: 25, name: '一体目', type: 'electric' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 10, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'second', pokedexId: 26, name: '二体目', type: 'electric' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 10, boostAllowed: true, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: inventory,
    };
    try {
      solveLevelPlan(input);
      expect(__levelPlannerTestHooks.candidateCacheSize()).toBe(0);
      expect(info.mock.calls.some(call => call[0] === '[perf] levelPlanner.feasibilityWitness')).toBe(true);
    } finally {
      info.mockRestore();
      setPerfEnabled(false);
    }
  });

  it('fbl01d本線はfeasible witnessを正本にし、速いfeasibility refineだけ試す', () => {
    setPerfEnabled(true);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      solveLevelPlan({
        pokemonList: [{
          pokemonId: 'quick-accept',
          pokedexId: 10451,
          name: '軽量受理',
          type: 'quick_accept' as const,
          currentLevel: 10,
          currentExpInLevel: 0,
          targetLevel: 60,
          expType: 600 as const,
          nature: 'normal' as const,
          requestedBoostCandy: 0,
          boostAllowed: true,
          candyTarget: { totalCandyUnits: 99 },
          priorityIndex: 0,
        }],
        dreamShards: Infinity,
        boost: { kind: 'none' as const, limit: 0 },
        candyInventory: {
          species: { '10451': 0 },
          typeCandy: { quick_accept: { s: 0, m: 0 } },
          universal: { s: 33, m: 5, l: 0 },
        },
        options: { itemCompareMode: 'surplusFirst' as const },
      });
      expect(info.mock.calls.some(call => call[0] === '[perf] levelPlanner.supplyRefine')).toBe(false);
      expect(info.mock.calls.some(call => call[0] === '[perf] levelPlanner.feasibilityRefine')).toBe(true);
      const solveLog = info.mock.calls.find(call => call[0] === '[perf] solveLevelPlan');
      expect(solveLog?.[1]?.fbl01d).toMatchObject({
        refineStatus: 'ok',
      });
    } finally {
      info.mockRestore();
      setPerfEnabled(false);
    }
  });

  it('fbl01d refineは軽い6行以上でも行数だけではスキップしない', () => {
    setPerfEnabled(true);
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const pokemonList = Array.from({ length: 6 }, (_, index) => ({
        pokemonId: `refine-six-${index}`,
        pokedexId: 10500 + index,
        name: `軽量6行${index}`,
        type: `refine_six_${index}` as const,
        currentLevel: 10,
        currentExpInLevel: 0,
        targetLevel: 60,
        expType: 600 as const,
        nature: 'normal' as const,
        requestedBoostCandy: 0,
        boostAllowed: true,
        candyTarget: { totalCandyUnits: 4 },
        priorityIndex: index,
      }));
      solveLevelPlan({
        pokemonList,
        dreamShards: Infinity,
        boost: { kind: 'none' as const, limit: 0 },
        candyInventory: {
          species: {},
          typeCandy: Object.fromEntries(pokemonList.map(pokemon => [pokemon.type, { s: 1, m: 0 }])),
          universal: { s: 0, m: 0, l: 0 },
        },
        options: { itemCompareMode: 'legacyImproved' as const },
      });
      const solveLog = info.mock.calls.find(call => call[0] === '[perf] solveLevelPlan');
      expect(solveLog?.[1]?.fbl01d).toMatchObject({
        refineStatus: 'ok',
      });
    } finally {
      info.mockRestore();
      setPerfEnabled(false);
    }
  });

  it('loss ledger は切り詰めのない単純ケースを exact 扱いにする', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'loss-none', pokedexId: 10401, name: '切り詰めなし', type: 'loss_none' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 10 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: { species: { '10401': 10 }, typeCandy: { loss_none: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' as const },
    });
    expect(result.lossLedger.hasLoss).toBe(false);
    expect(result.lossLedger.supplyCandidateCuts).toHaveLength(0);
    expect(result.lossLedger.frontierCuts).toHaveLength(0);
  });

  it('fbl01d本線は供給候補上限チューニングで切り詰めlossを出さない', () => {
    const input = {
      pokemonList: [{ pokemonId: 'loss-supply-cut', pokedexId: 10402, name: '供給切り詰め', type: 'loss_cut' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 300 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: { species: { '10402': 0 }, typeCandy: { loss_cut: { s: 100, m: 12 } }, universal: { s: 0, m: 15, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' as const },
    };
    const exact = solveLevelPlan(input);
    expect(exact.lossLedger.supplyCandidateCuts).toHaveLength(0);
    const result = __levelPlannerTestHooks.withTuningForTest({
      maxSupplyCandidates: 12,
      maxSharedSpeciesSupplyCandidates: 12,
    }, () => solveLevelPlan(input));
    expect(result.lossLedger.hasLoss).toBe(false);
    expect(result.lossLedger.supplyCandidateCuts).toHaveLength(0);
  });

  it('アメ在庫で途中停止する未達候補を返し、候補が全滅しない', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'limited', pokedexId: 25, name: '在庫不足', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 20, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 10 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 0 } },
    });
    const line = result.pokemonResults[0].reachableLine;
    expect(line.totalCandyUnitsUsed).toBe(10);
    expect(line.targetReached).toBe(false);
  });

  it('preferZeroSurplus 時でも種族アメを残差調整弁にしない', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'no-residual-valve', pokedexId: 25, name: '残差調整弁禁止', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, preferZeroSurplus: true, candyTarget: { totalCandyUnits: 105 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 10 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 1 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const line = result.pokemonResults[0].reachableLine;
    expect(line.candySupply.species).toBe(10);
    expect(line.candySupply.universal.l).toBe(1);
    expect(line.surplusCandyValue).toBe(5);
  });

  it('目標まで行は在庫不足分を理論値の万能Sで補填し、実配分は在庫内に留める', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'target-limited', pokedexId: 25, name: '目標表示の在庫不足', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 0 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 10, m: 0, l: 0 } },
    });
    const p = result.pokemonResults[0];
    expect(p.targetLine.candySupply.universal.s).toBeGreaterThan(10);
    expect(p.targetLine.surplusCandyValue).toBeLessThanOrEqual(2);
    expect(p.shortage.candyToTarget).toBeGreaterThan(0);
    expect(p.role).toBe('boundary');
    expect(p.reachableLine.candySupply.universal.s).toBe(10);
  });

  it('共有する万能Sは上位と境界の実配分で合計在庫を超えず、境界の理論値だけが補填する', () => {
    const universalSStock = 40;
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'upper', pokedexId: 25, name: '上位', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'boundary', pokedexId: 26, name: '境界', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: {}, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: universalSStock, m: 0, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const [upper, boundary] = result.pokemonResults;
    const actualUniversalS = upper.reachableLine.candySupply.universal.s + boundary.reachableLine.candySupply.universal.s;
    expect(upper.role).toBe('upper');
    expect(upper.targetReached).toBe(true);
    expect(boundary.role).toBe('boundary');
    expect(boundary.targetReached).toBe(false);
    expect(actualUniversalS).toBeLessThanOrEqual(universalSStock);
    expect(boundary.reachableLine.candySupply.universal.s).toBeLessThanOrEqual(universalSStock - upper.reachableLine.candySupply.universal.s);
    expect(boundary.targetLine.candySupply.universal.s).toBeGreaterThan(universalSStock);
    expect(boundary.shortage.candyToTarget).toBeGreaterThan(0);
  });

  it('在庫不足時の目標まで行は、到達可能行との差分を万能S補填だけにする', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'shortage-with-large-candy', pokedexId: 25, name: '不足時の内訳一致', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 0 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 10, m: 10, l: 2 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const p = result.pokemonResults[0];
    expect(p.shortage.candyToTarget).toBeGreaterThan(0);
    expect(p.targetLine.candySupply.species).toBe(p.reachableLine.candySupply.species);
    expect(p.targetLine.candySupply.type).toEqual(p.reachableLine.candySupply.type);
    expect(p.targetLine.candySupply.universal.m).toBe(p.reachableLine.candySupply.universal.m);
    expect(p.targetLine.candySupply.universal.l).toBe(p.reachableLine.candySupply.universal.l);
    expect(p.targetLine.candySupply.universal.s).toBeGreaterThan(p.reachableLine.candySupply.universal.s);
  });

  it('目標まで行は到達可能行の実配分を正本にし、不足分だけ万能S補填する', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'target-display-stock', pokedexId: 76, name: '目標行在庫', type: 'rock', currentLevel: 29, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'mini', limit: 350 },
      candyInventory: { species: { '76': 12 }, typeCandy: { rock: { s: 0, m: 3 } }, universal: { s: 0, m: 0, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const p = result.pokemonResults[0];
    expect(p.shortage.candyToTarget).toBeGreaterThan(0);
    expect(p.targetLine.candySupply.species).toBe(p.reachableLine.candySupply.species);
    expect(p.targetLine.candySupply.type).toEqual(p.reachableLine.candySupply.type);
    expect(p.targetLine.candySupply.universal.m).toBe(p.reachableLine.candySupply.universal.m);
    expect(p.targetLine.candySupply.universal.l).toBe(p.reachableLine.candySupply.universal.l);
    expect(p.targetLine.candySupply.universal.s).toBeGreaterThan(0);
  });

  it('個数指定行は在庫内の万能M/Lを使い切ってから不足分を万能Sで補填する', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'candy-target-shortage', pokedexId: 25, name: '個数指定の不足補填', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 1_000 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 0 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 10, m: 10, l: 2 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const line = result.pokemonResults[0].candyTargetLine!;
    expect(line.totalCandyUnitsUsed).toBe(1_000);
    expect(line.candySupply.universal.m).toBe(10);
    expect(line.candySupply.universal.l).toBe(2);
    expect(line.candySupply.universal.s).toBeGreaterThan(10);
  });

  it('個数指定ありの目標まで行は到達可能行のタイプアメ実配分を引き継いで不足分だけ万能Sで補填する', () => {
    const result = solveLevelPlan({
      pokemonList: [{
        pokemonId: 'golem-target-display',
        pokedexId: 76,
        name: 'ゴローニャ',
        type: 'Rock',
        currentLevel: 29,
        currentExpInLevel: calcExp(29, 30, 600) - 122,
        targetLevel: 60,
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 0,
        boostAllowed: true,
        candyTarget: { totalCandyUnits: 1_500 },
        priorityIndex: 0,
      }],
      dreamShards: Infinity,
      boost: { kind: 'mini', limit: 350 },
      candyInventory: { species: { '76': 0 }, typeCandy: { Rock: { s: 0, m: 3 } }, universal: { s: 0, m: 0, l: 0 } },
      options: { itemCompareMode: 'legacyImproved' },
    });
    const p = result.pokemonResults[0];
    expect(p.candyTargetLine?.candySupply.type.m).toBe(3);
    expect(p.candyTargetLine?.candySupply.universal.s).toBe(475);
    expect(p.targetLine.candySupply.type.m).toBe(3);
    expect(p.targetLine.candySupply.universal.s).toBe(503);
  });

  it('個数指定ありの目標まで行は到達可能行の種族アメ実配分を引き継いで不足分だけ万能Sで補填する', () => {
    const result = solveLevelPlan({
      pokemonList: [{
        pokemonId: 'suicune-target-display',
        pokedexId: 245,
        name: 'スイクン',
        type: 'Water',
        currentLevel: 58,
        currentExpInLevel: calcExp(58, 59, 1080) - 1362,
        targetLevel: 65,
        expType: 1080,
        nature: 'down',
        requestedBoostCandy: 350,
        boostAllowed: true,
        candyTarget: { totalCandyUnits: 50 },
        priorityIndex: 0,
      }],
      dreamShards: 0,
      boost: { kind: 'mini', limit: 350 },
      candyInventory: { species: { '245': 147 }, typeCandy: { Water: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 0 } },
      options: { itemCompareMode: 'legacyImproved' },
    });
    const p = result.pokemonResults[0];
    expect(p.candyTargetLine?.candySupply.species).toBe(50);
    expect(p.targetLine.candySupply.species).toBe(50);
    expect(p.targetLine.candySupply.universal.s).toBe(394);
  });

  it('個数指定がある場合も、サマリ集計は個数指定行ではなく到達可能行を使う', () => {
    const result = solveLevelPlan({
      pokemonList: [{
        pokemonId: 'candy-target-summary',
        pokedexId: 25,
        name: '個数指定集計',
        type: 'electric',
        currentLevel: 10,
        currentExpInLevel: 0,
        targetLevel: 60,
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 1_000,
        boostAllowed: true,
        candyTarget: { totalCandyUnits: 20, boostedCandyUnits: 10 },
        priorityIndex: 0,
      }],
      dreamShards: Infinity,
      boost: { kind: 'full', limit: 1_000 },
      candyInventory: { species: { '25': 100 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 1_000, m: 100, l: 10 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const p = result.pokemonResults[0];
    expect(p.candyTargetLine).toBeDefined();
    expect(p.reachableLine.totalCandyUnitsUsed).toBe(p.candyTargetLine!.totalCandyUnitsUsed);
    expect(result.summary.totalNeed.totalCandyUnits).toBe(p.reachableLine.totalCandyUnitsUsed);
    expect(result.summary.totalNeed.totalDreamShards).toBe(p.reachableLine.dreamShardsUsed);
    expect(result.summary.totalNeed.totalBoostCandyRequested).toBe(p.reachableLine.boostedCandyUnits);
    expect(result.summary.boost.boostRemaining).toBe(1_000 - p.reachableLine.boostedCandyUnits);
  });

  it('在庫が充足する場合は理論値行も実配分も補填せず、不足を出さない', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'sufficient', pokedexId: 25, name: '充足', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 0 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 1_000, m: 0, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const p = result.pokemonResults[0];
    expect(p.role).toBe('upper');
    expect(p.targetReached).toBe(true);
    expect(p.shortage.candyToTarget).toBe(0);
    expect(p.targetLine.candySupply).toEqual(p.reachableLine.candySupply);
    expect(p.targetLine.surplusCandyValue).toBe(p.reachableLine.surplusCandyValue);
  });

  it('種族アメだけで充足して余り0になる場合はタイプアメを使わない', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'species-sufficient', pokedexId: 25, name: '種族充足', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 100 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 100 }, typeCandy: { electric: { s: 25, m: 4 } }, universal: { s: 100, m: 10, l: 1 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const line = result.pokemonResults[0].reachableLine;
    expect(line.candySupply.species).toBe(100);
    expect(line.candySupply.type).toEqual({ s: 0, m: 0 });
    expect(line.candySupply.universal).toEqual({ s: 0, m: 0, l: 0 });
    expect(line.surplusCandyValue).toBe(0);
  });

  it('同種族の共有必要量に種族アメが足りない場合はタイプアメ候補を残す', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'same-species-a', pokedexId: 25, name: '同種族A', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 100 }, priorityIndex: 0 },
        { pokemonId: 'same-species-b', pokedexId: 25, name: '同種族B', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 100 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 100 }, typeCandy: { electric: { s: 0, m: 4 } }, universal: { s: 0, m: 0, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const [first, second] = result.pokemonResults;
    expect(first.targetReached).toBe(true);
    expect(second.targetReached).toBe(true);
    expect(first.reachableLine.candySupply.species + second.reachableLine.candySupply.species).toBe(100);
    expect(first.reachableLine.candySupply.type.m + second.reachableLine.candySupply.type.m).toBe(4);
  });

  it('同種族の共有在庫は後続予約せず、残った在庫で自然に使い切る', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'same-species-stock-a', pokedexId: 25, name: '同種族在庫A', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 20 }, priorityIndex: 0 },
        { pokemonId: 'same-species-stock-b', pokedexId: 25, name: '同種族在庫B', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 20 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 38 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 20, m: 2, l: 0 } },
      options: { itemCompareMode: 'legacyImproved' },
    });

    const [first, second] = result.pokemonResults;
    const speciesUsed = first.reachableLine.candySupply.species + second.reachableLine.candySupply.species;
    const itemValue = supplyValueWithoutSpecies(first.reachableLine.candySupply) + supplyValueWithoutSpecies(second.reachableLine.candySupply);

    expect(speciesUsed).toBe(38);
    expect(itemValue).toBe(3);
    expect(first.reachableLine.candySupply.species).toBe(20);
    expect(second.reachableLine.candySupply.species).toBe(18);
    expect(second.reachableLine.candySupply.universal.s).toBe(1);
    expect(first.targetReached).toBe(true);
    expect(second.targetReached).toBe(true);
  });

  it('下位処理でも残りアメ在庫でちょうど止まる動的候補を生成する', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'upper', pokedexId: 25, name: '上位', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'lower', pokedexId: 26, name: '下位', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: {}, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 15, m: 0, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const [upper, lower] = result.pokemonResults;
    expect(upper.role).toBe('upper');
    expect(lower.role).toBe('boundary');
    expect(upper.reachableLine.candySupply.universal.s + lower.reachableLine.candySupply.universal.s).toBeGreaterThanOrEqual(13);
    expect(lower.reachableLine.surplusCandyValue).toBeLessThanOrEqual(2);
  });

  it('万能Mの中間個数を候補に残し、余り0の供給を選べる', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'middle-m', pokedexId: 25, name: '中間M', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 70, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 2_401 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 0 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 427, m: 102, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const line = result.pokemonResults[0].reachableLine;
    expect(line.surplusCandyValue).toBe(0);
    expect(line.candySupply.universal).toEqual({ s: 427, m: 56, l: 0 });
  });

  it('万能Sがなくても万能Mで不足1を埋めて到達する', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'm-oversupply', pokedexId: 25, name: 'M過剰供給', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 100 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 99 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 0, m: 1, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const p = result.pokemonResults[0];
    expect(p.targetReached).toBe(true);
    expect(p.shortage.candyToTarget).toBe(0);
    expect(p.reachableLine.candySupply.universal.m).toBe(1);
  });

  it('個数指定が最適化目標でも、公開する残EXPはユーザーの目標Lvまでを返す', () => {
    const currentExpInLevel = calcExp(58, 59, 1080) - 1362;
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'candy-target-exp', pokedexId: 245, name: 'スイクン', type: 'water', currentLevel: 58, currentExpInLevel, targetLevel: 65, targetExpInLevel: 0, expType: 1080, nature: 'down', requestedBoostCandy: 350, boostAllowed: true, candyTarget: { totalCandyUnits: 50 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'mini', limit: 50 },
      candyInventory: { species: { '245': 147 }, typeCandy: { water: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });

    const p = result.pokemonResults[0];
    const expectedToActualTarget = Math.max(0, calcExp(p.reachableLine.level, 65, 1080) - p.reachableLine.expInLevel);
    expect(p.reachableLine.expToTarget).toBe(0);
    expect(p.shortage.expToTarget).toBe(expectedToActualTarget);
    expect(p.shortage.expToTarget).toBeGreaterThan(0);
  });

  it.each(['legacyImproved', 'surplusFirst'] as const)('個数指定は指定総数をDP対象にし、%sで通常アメへフォールバックする', itemCompareMode => {
    const result = solveLevelPlan(constrainedCandyTargetInput(itemCompareMode));

    const suicune = result.pokemonResults[2];
    expect(suicune.targetReached).toBe(true);
    expect(suicune.reachableLine.totalCandyUnitsUsed).toBe(551);
    expect(suicune.reachableLine.boostedCandyUnits).toBe(549);
    expect(suicune.reachableLine.nonBoostCandyUnits).toBe(2);
    expect(suicune.candyTargetLine?.totalCandyUnitsUsed).toBe(suicune.reachableLine.totalCandyUnitsUsed);
    expect(suicune.candyTargetLine?.boostedCandyUnits).toBe(suicune.reachableLine.boostedCandyUnits);
    expect(suicune.candyTargetLine?.nonBoostCandyUnits).toBe(suicune.reachableLine.nonBoostCandyUnits);
    expect(suicune.shortage.dreamShardShortage).toBe(0);
    expect(suicune.shortage.boostCandyUnavailable).toBe(0);
    expect(suicune.constraintDiagnosis.isShardsShortage).toBe(false);
    expect(suicune.constraintDiagnosis.limitingFactor).toBeNull();
  });

  it('余り最小の供給検算中は時間deadlineで打ち切らない', () => {
    const outcome = solveLevelPlanWithBudget(constrainedCandyTargetInput('surplusFirst'), {
      calculationMode: 'exact',
      deadlineMs: 0,
    });

    expect(outcome.kind).toBe('result');
    if (outcome.kind !== 'result') return;
    expect(outcome.result.pokemonResults.some(result => result.reachableLine.totalCandyUnitsUsed > 0)).toBe(true);
    expect(outcome.result.pokemonResults[0].reachableLine.totalCandyUnitsUsed).toBeGreaterThan(0);
  });

  it('個数指定のアメブ数が明示されている場合は通常アメに置き換えない', () => {
    const result = solveLevelPlan({
      pokemonList: [{
        pokemonId: 'fixed-boost-target',
        pokedexId: 25,
        name: '個数指定アメブ固定',
        type: 'electric',
        currentLevel: 10,
        currentExpInLevel: 0,
        targetLevel: 60,
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 10,
        boostAllowed: true,
        candyTarget: { totalCandyUnits: 12, boostedCandyUnits: 10 },
        priorityIndex: 0,
      }],
      dreamShards: 1_200,
      boost: { kind: 'full', limit: 10 },
      candyInventory: { species: { '25': 12 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 0, m: 0, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });

    const p = result.pokemonResults[0];
    expect(p.targetReached).toBe(false);
    expect(p.reachableLine.boostedCandyUnits).toBeGreaterThan(0);
    expect(p.reachableLine.nonBoostCandyUnits).toBe(0);
    expect(p.constraintDiagnosis.isShardsShortage).toBe(true);
    expect(p.constraintDiagnosis.limitingFactor).toBe('shards');
  });

  it('種族アメだけでは足りない場合も通常は種族アメを使えるだけ使う', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'non-contended-surplus', pokedexId: 25, name: '非競合余り', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 103 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 99 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 0, m: 1, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });
    const line = result.pokemonResults[0].reachableLine;
    expect(line.targetReached).toBe(true);
    expect(line.candySupply.species).toBe(99);
    expect(line.candySupply.universal.m).toBe(1);
    expect(line.surplusCandyValue).toBe(16);
  });

  it('種族アメが不足していてもアイテム余り調整弁にせず先に使い切る', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'species-first-large', pokedexId: 923, name: '種族先使い切り', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 632 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '923': 319 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 200, m: 20, l: 0 } },
      options: { itemCompareMode: 'legacyImproved' },
    });

    const line = result.pokemonResults[0].reachableLine;
    expect(line.targetReached).toBe(true);
    expect(line.candySupply.species).toBe(319);
  });

  it('バランスは上位が万能Sを使い切った後でも下位を残った万能Mで到達させる', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'uses-s', pokedexId: 26, name: 'S使用', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 3 }, priorityIndex: 0 },
        { pokemonId: 'uses-m-after-s', pokedexId: 25, name: 'Mで補う', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 100 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 99 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 1, m: 1, l: 0 } },
      options: { itemCompareMode: 'surplusGateFirst' },
    });
    const [upper, lower] = result.pokemonResults;
    expect(upper.targetReached).toBe(true);
    expect(lower.targetReached).toBe(true);
    expect(lower.shortage.candyToTarget).toBe(0);
  });

  it('バランスは初期在庫で万能S余り0でも上位消費後に備えて万能Mの代替候補を残す', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'upper-s', pokedexId: 26, name: '上位S', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 3 }, priorityIndex: 0 },
        { pokemonId: 'lower-m-alternative', pokedexId: 25, name: '下位M代替', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 100 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none', limit: 0 },
      candyInventory: { species: { '25': 97 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 1, m: 1, l: 0 } },
      options: { itemCompareMode: 'surplusGateFirst' },
    });
    const [upper, lower] = result.pokemonResults;
    expect(upper.reachableLine.candySupply.universal.s).toBe(1);
    expect(lower.targetReached).toBe(true);
    expect(lower.reachableLine.candySupply.universal.s).toBe(0);
    expect(lower.reachableLine.candySupply.universal.m).toBe(1);
    expect(lower.reachableLine.candySupply.species).toBe(97);
    expect(lower.reachableLine.surplusCandyValue).toBe(17);
  });

  it('同じ固定値に多数の組合せがあっても、万能Mでタイプアメを温存する供給候補を落とさない', () => {
    const input = {
      pokemonList: [
        { pokemonId: 'fixed-value-frontier', pokedexId: 25, name: '固定値候補', type: 'electric' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 300 }, priorityIndex: 0 },
        { pokemonId: 'future-type-need', pokedexId: 26, name: '後続タイプ要求', type: 'electric' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 104 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: { species: { '25': 0 }, typeCandy: { electric: { s: 100, m: 12 } }, universal: { s: 0, m: 15, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' as const },
    };
    const supplies = __levelPlannerTestHooks.supplyCandidatesForTest(input, 0, 300);
    expect(supplies).toContainEqual({
      species: 0,
      type: { s: 0, m: 0 },
      universal: { s: 0, m: 15, l: 0 },
    });
  });

  it('供給候補キャッシュは余り最小化とバッグ圧縮を混同しない', () => {
    __levelPlannerTestHooks.clearCandidateCache();
    const base = {
      pokemonList: [{ pokemonId: 'mode-cache', pokedexId: 25, name: 'モード切替', type: 'electric' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 103 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: { species: { '25': 99 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 0, m: 1, l: 0 } },
    };
    const surplusFirst = __levelPlannerTestHooks.supplyCandidatesForTest({ ...base, options: { itemCompareMode: 'surplusFirst' as const } }, 0, 103);
    const legacyImproved = __levelPlannerTestHooks.supplyCandidatesForTest({ ...base, options: { itemCompareMode: 'legacyImproved' as const } }, 0, 103);
    expect(surplusFirst).toHaveLength(1);
    expect(legacyImproved).toContainEqual({
      species: 99,
      type: { s: 0, m: 0 },
      universal: { s: 0, m: 1, l: 0 },
    });
  });

  it('供給候補キャッシュは列挙上限を超える在庫差だけを同一視する', () => {
    const base: LevelPlannerInput = {
      pokemonList: [{ pokemonId: 'cache-rounding', pokedexId: 10491, name: 'キャッシュ丸め', type: 'cache_type' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 75 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: { '10491': 12 },
        typeCandy: { cache_type: { s: 44, m: 7 } },
        universal: { s: 175, m: 9, l: 2 },
      },
      options: { itemCompareMode: 'surplusFirst' as const },
    };
    const abundant: LevelPlannerInput = {
      ...base,
      candyInventory: {
        species: { '10491': 12 },
        typeCandy: { cache_type: { s: 999, m: 999 } },
        universal: { s: 999, m: 999, l: 999 },
      },
    };

    __levelPlannerTestHooks.clearCandidateCache();
    const low = stableSupplies(__levelPlannerTestHooks.supplyCandidatesForTest(base, 0, 75));
    __levelPlannerTestHooks.clearCandidateCache();
    const high = stableSupplies(__levelPlannerTestHooks.supplyCandidatesForTest(abundant, 0, 75));
    expect(high).toEqual(low);

    __levelPlannerTestHooks.clearCandidateCache();
    const cachedHigh = stableSupplies(__levelPlannerTestHooks.supplyCandidatesForTest(abundant, 0, 75));
    const cachedLow = stableSupplies(__levelPlannerTestHooks.supplyCandidatesForTest(base, 0, 75));
    expect(cachedLow).toEqual(cachedHigh);
  });

  it('同種族の共有在庫は後続予約せず、上位から種族アメを使い切る', () => {
    const input = {
      pokemonList: [
        { pokemonId: 'shared-species-front', pokedexId: 10490, name: '共有種族前', type: 'alpha' as const, currentLevel: 33, currentExpInLevel: 1003, targetLevel: 35, targetExpInLevel: 223, expType: 1080 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'shared-species-back', pokedexId: 10490, name: '共有種族後', type: 'beta' as const, currentLevel: 17, currentExpInLevel: 581, targetLevel: 19, targetExpInLevel: 79, candyTarget: { totalCandyUnits: 15, boostedCandyUnits: 0 }, expType: 1320 as const, nature: 'up' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 1 },
      ],
      dreamShards: Number.MAX_SAFE_INTEGER,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: { '10490': 99 },
        typeCandy: { alpha: { s: 5, m: 0 }, beta: { s: 1, m: 0 } },
        universal: { s: 44, m: 1, l: 0 },
      },
      options: { itemCompareMode: 'surplusFirst' as const },
    };
    expect(__levelPlannerTestHooks.speciesNeedsForTest(input)['10490']).toBe(114);
    const firstSupplies = __levelPlannerTestHooks.supplyCandidatesForTest(input, 0, 99);
    expect(firstSupplies).toContainEqual({
      species: 99,
      type: { s: 0, m: 0 },
      universal: { s: 0, m: 0, l: 0 },
    });

    const result = solveLevelPlan(input);

    const supplies = result.pokemonResults.map(row => row.reachableLine.candySupply);
    expect(supplies.reduce((sum, supply) => sum + supply.species, 0)).toBe(99);
    expect(supplies[0].species).toBe(99);
    expect(supplies[1].species).toBe(0);
    expect(result.pokemonResults[0].targetReached).toBe(true);
    expect(result.pokemonResults[1].targetReached).toBe(true);
  });

  it('バッグ圧縮は余り2を許して万能Mを温存する', () => {
    const base = {
      pokemonList: [{ pokemonId: 'legacy-slight', pokedexId: 1010, name: 'バッグ圧縮', type: 'dragon' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 564 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: { species: { '1010': 319 }, typeCandy: { dragon: { s: 13, m: 0 } }, universal: { s: 65, m: 2, l: 0 } },
    };

    const surplus = solveLevelPlan({ ...base, options: { itemCompareMode: 'surplusFirst' as const } }).pokemonResults[0].reachableLine;
    expect(surplus.candySupply.universal.m).toBe(2);
    expect(surplus.candySupply.universal.s).toBe(51);
    expect(surplus.surplusCandyValue).toBe(0);

    const legacy = solveLevelPlan({ ...base, options: { itemCompareMode: 'legacyImproved' as const } }).pokemonResults[0].reachableLine;
    expect(legacy.candySupply.universal.m).toBe(0);
    expect(legacy.candySupply.universal.s).toBe(65);
    expect(legacy.surplusCandyValue).toBe(2);
  });

  it('バッグ圧縮は各行が余り0..2なら合計余りが2を超えても万能M温存を優先する', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'legacy-row-a', pokedexId: 1100, name: 'バッグ圧縮行A', type: 'alpha' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 19 }, priorityIndex: 0 },
        { pokemonId: 'legacy-row-b', pokedexId: 1101, name: 'バッグ圧縮行B', type: 'beta' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 19 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: { alpha: { s: 0, m: 0 }, beta: { s: 0, m: 0 } },
        universal: { s: 14, m: 2, l: 0 },
      },
      options: { itemCompareMode: 'legacyImproved' as const },
    });

    const lines = result.pokemonResults.map(result => result.reachableLine);
    expect(lines.every(line => line.candySupply.universal.m === 0)).toBe(true);
    expect(lines.every(line => line.candySupply.universal.s === 7)).toBe(true);
    expect(lines.map(line => line.surplusCandyValue)).toEqual([2, 2]);
  });

  it('バッグ圧縮は余り0..2ゲートをアイテム優先より先に見る', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'legacy-gate', pokedexId: 1011, name: 'バッグ圧縮ゲート', type: 'dragon' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 20 }, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: { species: { '1011': 0 }, typeCandy: { dragon: { s: 0, m: 1 } }, universal: { s: 0, m: 1, l: 0 } },
      options: { itemCompareMode: 'legacyImproved' as const },
    });

    const line = result.pokemonResults[0].reachableLine;
    expect(line.candySupply.universal.m).toBe(1);
    expect(line.candySupply.type.m).toBe(0);
    expect(line.surplusCandyValue).toBe(0);
  });

  it('バッグ圧縮はpreferZeroSurplus対象なら余り0を優先する', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'legacy-zero-count', pokedexId: 1012, name: 'バッグ圧縮余り0割込', type: 'dragon' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 20 }, priorityIndex: 0, preferZeroSurplus: true }],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: { species: { '1012': 0 }, typeCandy: { dragon: { s: 0, m: 0 } }, universal: { s: 7, m: 1, l: 0 } },
      options: { itemCompareMode: 'legacyImproved' as const },
    });

    const line = result.pokemonResults[0].reachableLine;
    expect(line.candySupply.universal.s).toBe(0);
    expect(line.candySupply.universal.m).toBe(1);
    expect(line.surplusCandyValue).toBe(0);
  });

  it.each(['surplusFirst', 'surplusGateFirst', 'legacyImproved'] as const)('%sはLvMAX到達行で余り0を選べる場合は余り0にする', itemCompareMode => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'auto-lvmax-zero-mode', pokedexId: 1014, name: 'LvMAX自動余り0', type: 'dragon' as const, currentLevel: 69, currentExpInLevel: 0, targetLevel: 70, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: { species: { '1014': 0 }, typeCandy: { dragon: { s: 0, m: 0 } }, universal: { s: 44, m: 1, l: 0 } },
      options: { itemCompareMode },
    });

    const line = result.pokemonResults[0].reachableLine;
    expect(line.level).toBe(70);
    expect(line.candySupply.universal.s).toBe(37);
    expect(line.candySupply.universal.m).toBe(1);
    expect(line.surplusCandyValue).toBe(0);
  });

  it('バッグ圧縮はLvMAX未到達の境界行を余り0優先対象にしない', () => {
    const base = {
      pokemonList: [
        { pokemonId: 'latias-lvmax-boundary-regression', pokedexId: 380, name: '70ラティアス', type: 'dragon' as const, currentLevel: 55, currentExpInLevel: 4103, targetLevel: 70, expType: 1080 as const, nature: 'normal' as const, requestedBoostCandy: 1561, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'drampa-lvmax-boundary-regression', pokedexId: 780, name: '80仮ジジーロン', type: 'dragon' as const, currentLevel: 25, currentExpInLevel: 622, targetLevel: 60, expType: 900 as const, nature: 'down' as const, requestedBoostCandy: 998, boostAllowed: true, priorityIndex: 1 },
        { pokemonId: 'suicune-lvmax-boundary-regression', pokedexId: 245, name: '70スイクン', type: 'water' as const, currentLevel: 61, currentExpInLevel: 5259, targetLevel: 70, expType: 1080 as const, nature: 'down' as const, requestedBoostCandy: 941, boostAllowed: true, priorityIndex: 2 },
      ],
      dreamShards: 9_999_329,
      boost: { kind: 'full' as const, limit: 3500 },
      candyInventory: {
        species: { '380': 319, '780': 656, '245': 478 },
        typeCandy: { dragon: { s: 13, m: 0 }, water: { s: 0, m: 0 } },
        universal: { s: 432, m: 102, l: 9 },
      },
    };

    const lines = solveLevelPlan({ ...base, options: { itemCompareMode: 'legacyImproved' as const } }).pokemonResults.map(result => result.reachableLine);

    expect(lines[2].level).toBeLessThan(70);
    expect(lines[2].surplusCandyValue).not.toBe(0);
  });

  it('余り最小でも要求アメブを尊重しつつ、到達後の余分アメブは使わない', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'boost-before-surplus', pokedexId: 25, name: 'アメブ優先', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, expType: 600, nature: 'normal', requestedBoostCandy: 10, boostAllowed: true, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'full', limit: 10 },
      candyInventory: { species: { '25': 0 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 100, m: 100, l: 0 } },
      options: { itemCompareMode: 'surplusFirst' },
    });

    const line = result.pokemonResults[0].reachableLine;
    expect(line.targetReached).toBe(true);
    expect(line.boostedCandyUnits).toBeGreaterThan(0);
    expect(line.boostedCandyUnits).toBeLessThan(10);
  });

  it('通常アメで到達済みならmini上限不足をアメブ不足として表示しない', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'mini-reached-by-normal', pokedexId: 25, name: 'mini通常到達', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, expType: 600, nature: 'normal', requestedBoostCandy: 10, boostAllowed: true, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'mini', limit: 0 },
      candyInventory: { species: { '25': 0 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 100, m: 0, l: 0 } },
      options: { itemCompareMode: 'legacyImproved' },
    });

    const p = result.pokemonResults[0];
    expect(p.reachableLine.targetReached).toBe(true);
    expect(p.reachableLine.boostedCandyUnits).toBe(0);
    expect(p.reachableLine.nonBoostCandyUnits).toBeGreaterThan(0);
    expect(p.shortage.boostCandyUnavailable).toBe(0);
    expect(p.constraintDiagnosis.limitingFactor).toBeNull();
  });

  it('ブースト主体でアメ在庫律速の未達を candy と診断する（到達誤表示の回帰防止）', () => {
    const result = solveLevelPlan({
      pokemonList: [{ pokemonId: 'bycandy', pokedexId: 25, name: 'ブースト主体在庫不足', type: 'electric', currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600, nature: 'normal', requestedBoostCandy: 100000, boostAllowed: true, priorityIndex: 0 }],
      dreamShards: Infinity,
      boost: { kind: 'full', limit: 100000 },
      candyInventory: { species: { '25': 0 }, typeCandy: { electric: { s: 0, m: 0 } }, universal: { s: 5, m: 0, l: 0 } },
      options: { itemCompareMode: 'legacyImproved' },
    });
    const p = result.pokemonResults[0];
    // ブーストアメを在庫で頭打ちにしないと isInventoryShortage=false → limitingFactor=null（到達誤表示）に落ちる
    expect(p.reachableLine.targetReached).toBe(false);
    expect(p.shortage.candyToTarget).toBeGreaterThan(0);
    expect(p.shortage.dreamShardShortage).toBe(0);
    expect(p.constraintDiagnosis.isInventoryShortage).toBe(true);
    expect(p.constraintDiagnosis.limitingFactor).toBe('candy');
  });

  it.each(['none', 'mini', 'full'] as const)('バッグ圧縮は%sでも通常アメだけの目標Lv行を余り0..2ゲートに通す', boostKind => {
    const base: LevelPlannerInput = {
      pokemonList: [
        { pokemonId: `swalot-target-${boostKind}-gate`, pokedexId: 317, name: '70マルノーム', type: 'poison' as const, currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
      ],
      dreamShards: Infinity,
      boost: { kind: boostKind, limit: boostKind === 'none' ? 0 : 350 },
      candyInventory: {
        species: { '317': 272 },
        typeCandy: { poison: { s: 0, m: 4 } },
        universal: { s: 4, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'legacyImproved' as const },
    };

    const line = solveLevelPlan(base).pokemonResults[0].reachableLine;

    expect(line.boostedCandyUnits).toBe(0);
    expect(line.nonBoostCandyUnits).toBe(308);
    expect(line.candySupply).toEqual({
      species: 272,
      type: { s: 0, m: 1 },
      universal: { s: 4, m: 0, l: 0 },
    });
    expect(line.surplusCandyValue).toBe(1);
  });

  it('バッグ圧縮は余り0..2ゲート外ではアイテム優先より余り小を優先する', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'swalot-excess-surplus-gate', pokedexId: 317, name: '70マルノーム', type: 'poison' as const, currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'mini' as const, limit: 350 },
      candyInventory: {
        species: { '317': 272 },
        typeCandy: { poison: { s: 0, m: 4 } },
        universal: { s: 0, m: 2, l: 0 },
      },
      options: { itemCompareMode: 'legacyImproved' as const },
    });

    const line = result.pokemonResults[0].reachableLine;

    expect(line.nonBoostCandyUnits).toBe(308);
    expect(line.candySupply).toEqual({
      species: 272,
      type: { s: 0, m: 0 },
      universal: { s: 0, m: 2, l: 0 },
    });
    expect(line.surplusCandyValue).toBe(4);
  });

  it('バッグ圧縮は全体最適中に万能Sを温存できる状態を混同せずマルノームを余り0..2ゲートへ通す', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'use-s-45', pokedexId: 10001, name: 'S45', type: 'electric' as const, currentLevel: 1, currentExpInLevel: 0, targetLevel: 2, expType: 600 as const, nature: 'normal' as const, candyTarget: { totalCandyUnits: 316 }, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'use-s-88', pokedexId: 10002, name: 'S88', type: 'flying' as const, currentLevel: 1, currentExpInLevel: 0, targetLevel: 2, expType: 600 as const, nature: 'normal' as const, candyTarget: { totalCandyUnits: 264 }, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 1 },
        { pokemonId: 'use-s-142', pokedexId: 10003, name: 'S142', type: 'fairy' as const, currentLevel: 1, currentExpInLevel: 0, targetLevel: 2, expType: 600 as const, nature: 'normal' as const, candyTarget: { totalCandyUnits: 3598 }, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 2 },
        { pokemonId: 'use-s-156', pokedexId: 10004, name: 'S156', type: 'dragon' as const, currentLevel: 1, currentExpInLevel: 0, targetLevel: 2, expType: 600 as const, nature: 'normal' as const, candyTarget: { totalCandyUnits: 948 }, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 3 },
        { pokemonId: 'swalot-global-excess-surplus', pokedexId: 317, name: '70マルノーム', type: 'poison' as const, currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 4 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'mini' as const, limit: 350 },
      candyInventory: {
        species: { '10001': 181, '10002': 0, '10003': 2947, '10004': 436, '317': 272 },
        typeCandy: {
          electric: { s: 0, m: 0 },
          flying: { s: 0, m: 0 },
          fairy: { s: 0, m: 0 },
          dragon: { s: 0, m: 0 },
          poison: { s: 0, m: 4 },
        },
        universal: { s: 431, m: 102, l: 0 },
      },
      options: { itemCompareMode: 'legacyImproved' as const },
    });

    const line = result.pokemonResults.find(pokemon => pokemon.pokemonId === 'swalot-global-excess-surplus')?.reachableLine;

    expect(line).toBeDefined();
    expect(line?.candySupply).toEqual({
      species: 272,
      type: { s: 0, m: 1 },
      universal: { s: 4, m: 0, l: 0 },
    });
    expect(line?.surplusCandyValue).toBe(1);
  });

  it('余り最小は粗い在庫でも余り0〜2ゲート内の全体余りを優先する', () => {
    const base: LevelPlannerInput = {
      pokemonList: [
        { pokemonId: 'surplus-first-upper', pokedexId: 317, name: '上位マルノーム', type: 'poison' as const, currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, candyTarget: { totalCandyUnits: 308 }, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'surplus-first-boundary', pokedexId: 244, name: '境界エンテイ', type: 'fire' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, candyTarget: { totalCandyUnits: 24 }, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: { '317': 272 },
        typeCandy: { poison: { s: 0, m: 2 }, fire: { s: 0, m: 0 } },
        universal: { s: 4, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'surplusFirst' as const },
    };

    const surplusFirst = solveLevelPlan(base);
    const legacyImproved = solveLevelPlan({ ...base, options: { itemCompareMode: 'legacyImproved' as const } });

    const surplusRows = surplusFirst.pokemonResults.map(result => result.reachableLine);
    const legacyRows = legacyImproved.pokemonResults.map(result => result.reachableLine);
    expect(surplusRows[0].surplusCandyValue).toBe(1);
    expect(surplusRows[1].totalCandyUnitsUsed).toBe(0);
    expect(legacyRows[0].surplusCandyValue).toBe(14);
    expect(legacyRows[1].totalCandyUnitsUsed).toBe(12);
    expect(surplusRows.reduce((sum, row) => sum + row.surplusCandyValue, 0))
      .toBeLessThan(legacyRows.reduce((sum, row) => sum + row.surplusCandyValue, 0));
    expect(legacyImproved.performance?.boundarySearch).toMatchObject({
      mode: 'legacyImproved',
      boundaryIndex: 1,
      targetTotalCandy: 24,
      maxFeasibleTotalCandy: 12,
      selectedTotalCandy: 12,
      checkedLowerTotals: 0,
      stoppedReason: 'exp_first',
    });
  });

  it('余り最小は余り0〜2ゲート内で到達数を最大化してから全体余りを比較する', () => {
    const basePokemon = { type: 'normal' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, candyTarget: { totalCandyUnits: 6 }, requestedBoostCandy: 0, boostAllowed: true };
    const result = solveLevelPlan({
      pokemonList: [
        { ...basePokemon, pokemonId: 'surplus-drop-1', pokedexId: 1, name: '余り低下1', priorityIndex: 0 },
        { ...basePokemon, pokemonId: 'surplus-drop-2', pokedexId: 2, name: '余り低下2', priorityIndex: 1 },
        { ...basePokemon, pokemonId: 'surplus-drop-3', pokedexId: 3, name: '余り低下3', priorityIndex: 2 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: {},
        universal: { s: 4, m: 1, l: 0 },
      },
      options: { itemCompareMode: 'surplusFirst' as const },
    });

    expect(result.pokemonResults.map(row => row.targetReached)).toEqual([true, true, false]);
    expect(result.pokemonResults.map(row => row.reachableLine.surplusCandyValue).reduce((sum, value) => sum + value, 0)).toBe(0);
    expect(result.summary.boundaryPokemonId).toBe('surplus-drop-3');
  });

  it('余り最小は各行余り2以内なら到達数を守って上位余りを最小化する', () => {
    const basePokemon = { type: 'normal' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 11, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, candyTarget: { totalCandyUnits: 19 }, requestedBoostCandy: 0, boostAllowed: true };
    const result = solveLevelPlan({
      pokemonList: [
        { ...basePokemon, pokemonId: 'surplus-total-1', pokedexId: 1, name: '全体余り1', priorityIndex: 0 },
        { ...basePokemon, pokemonId: 'surplus-total-2', pokedexId: 2, name: '全体余り2', priorityIndex: 1 },
        { ...basePokemon, pokemonId: 'surplus-total-3', pokedexId: 3, name: '全体余り3', priorityIndex: 2 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: {},
        universal: { s: 0, m: 3, l: 0 },
      },
      options: { itemCompareMode: 'surplusFirst' as const },
    });

    expect(result.pokemonResults.map(row => row.targetReached)).toEqual([true, true, true]);
    expect(result.pokemonResults.map(row => row.reachableLine.surplusCandyValue)).toEqual([1, 1, 1]);
    expect(result.summary.boundaryPokemonId).toBeUndefined();
  });

  it('余り最小は万能Sなしなら粗いアイテムで余りを出さず余り0の境界進捗を採る', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'pawmot-no-s', pokedexId: 923, name: '万能Sなしパーモット', type: 'electric' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 316, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'cramorant-no-s', pokedexId: 845, name: '万能Sなしウッウ', type: 'flying' as const, currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 34, boostAllowed: true, priorityIndex: 1 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'mini' as const, limit: 350 },
      candyInventory: {
        species: { '923': 181, '845': 0 },
        typeCandy: { electric: { s: 0, m: 0 }, flying: { s: 0, m: 0 } },
        universal: { s: 0, m: 20, l: 0 },
      },
      options: { itemCompareMode: 'surplusFirst' as const },
    });

    const boundarySearch = result.performance?.boundarySearch;
    expect(boundarySearch).toBeDefined();
    expect(boundarySearch!.maxFeasibleTotalCandy).toBeGreaterThanOrEqual(boundarySearch!.selectedTotalCandy);
    expect(result.pokemonResults[0].targetReached).toBe(false);
    expect(result.pokemonResults[0].reachableLine.surplusCandyValue).toBe(0);
    expect(result.summary.boundaryPokemonId).toBe('pawmot-no-s');
  });

  it('余り最小は万能M/Lが潤沢でも余り0の境界進捗を優先する', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'pawmot-no-s-rich', pokedexId: 923, name: '万能Sなし潤沢パーモット', type: 'electric' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 316, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'cramorant-no-s-rich', pokedexId: 845, name: '万能Sなし潤沢ウッウ', type: 'flying' as const, currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 34, boostAllowed: true, priorityIndex: 1 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'mini' as const, limit: 350 },
      candyInventory: {
        species: { '923': 181, '845': 0 },
        typeCandy: { electric: { s: 0, m: 0 }, flying: { s: 0, m: 0 } },
        universal: { s: 0, m: 102, l: 9 },
      },
      options: { itemCompareMode: 'surplusFirst' as const },
    });

    expect(result.pokemonResults[0].targetReached).toBe(false);
    expect(result.pokemonResults[0].reachableLine.surplusCandyValue).toBe(0);
    expect(result.pokemonResults[0].reachableLine.candySupply.universal.m).toBe(6);
    expect(result.summary.boundaryPokemonId).toBe('pawmot-no-s-rich');
  });

  it('余り最小は余り0の境界未達なら余り2の到達より余り0を優先する', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'pawmot-few-s', pokedexId: 923, name: '万能S少量パーモット', type: 'electric' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 316, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'cramorant-few-s', pokedexId: 845, name: '万能S少量ウッウ', type: 'flying' as const, currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 34, boostAllowed: true, priorityIndex: 1 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'mini' as const, limit: 350 },
      candyInventory: {
        species: { '923': 181, '845': 0 },
        typeCandy: { electric: { s: 0, m: 0 }, flying: { s: 0, m: 0 } },
        universal: { s: 6, m: 102, l: 9 },
      },
      options: { itemCompareMode: 'surplusFirst' as const },
    });

    expect(result.pokemonResults[0].targetReached).toBe(true);
    expect(result.pokemonResults[1].targetReached).toBe(false);
    expect(result.pokemonResults.map(row => row.reachableLine.surplusCandyValue).reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it('余り最小のハードゲート不可時はバランス評価で境界に残り万能Lを使ってEXPを伸ばす', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'pawmot-few-l', pokedexId: 923, name: '万能L残りパーモット', type: 'electric' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 316, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'cramorant-few-l', pokedexId: 845, name: '万能L残りウッウ', type: 'flying' as const, currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 34, boostAllowed: true, priorityIndex: 1 },
        { pokemonId: 'sylveon-few-l', pokedexId: 700, name: '万能L残りニンフィア', type: 'fairy' as const, currentLevel: 16, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 2 },
        { pokemonId: 'dragonite-few-l', pokedexId: 149, name: '万能L残りカイリュー', type: 'dragon' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 1080 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 3 },
        { pokemonId: 'gulpin-few-l', pokedexId: 317, name: '万能L残りマルノーム', type: 'poison' as const, currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 4 },
        { pokemonId: 'cresselia-few-l', pokedexId: 488, name: '万能L残りクレセリア', type: 'psychic' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 1080 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 5 },
        { pokemonId: 'entei-few-l', pokedexId: 244, name: '万能L残りエンテイ', type: 'fire' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 1080 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 6 },
        { pokemonId: 'flareon-few-l', pokedexId: 136, name: '万能L残りブースター', type: 'fire' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 7 },
        { pokemonId: 'kangaskhan-few-l', pokedexId: 115, name: '万能L残りガルーラ', type: 'normal' as const, currentLevel: 53, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 8 },
        { pokemonId: 'raikou-few-l', pokedexId: 243, name: '万能L残りライコウ', type: 'electric' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 9 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'mini' as const, limit: 350 },
      candyInventory: {
        species: { '923': 181, '845': 0, '700': 2947, '149': 436, '317': 272, '488': 500, '244': 100, '136': 2, '115': 0, '243': 0 },
        typeCandy: {
          electric: { s: 0, m: 0 },
          flying: { s: 0, m: 0 },
          fairy: { s: 0, m: 10 },
          dragon: { s: 13, m: 0 },
          poison: { s: 0, m: 0 },
          psychic: { s: 18, m: 8 },
          fire: { s: 0, m: 0 },
          normal: { s: 0, m: 0 },
        },
        universal: { s: 50, m: 102, l: 9 },
      },
      options: { itemCompareMode: 'surplusFirst' as const },
    });

    const entei = result.pokemonResults[6];
    expect(entei.targetReached).toBe(false);
    expect(entei.reachableLine.totalCandyUnitsUsed).toBeGreaterThan(922);
    expect(result.summary.universalCandyRemaining.s + result.summary.universalCandyRemaining.l).toBe(0);
  });

  it('余り0〜2優先は余りゲート内で境界EXPを伸ばしつつ境界を到達済みにしない', () => {
    const input: LevelPlannerInput = {
      pokemonList: [
        { pokemonId: 'pawmot', pokedexId: 923, name: '80パーモット', type: 'electric' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 316, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'cramorant', pokedexId: 845, name: '70ウッウ（油）', type: 'flying' as const, currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 34, boostAllowed: true, priorityIndex: 1 },
        { pokemonId: 'sylveon', pokedexId: 700, name: '70仮ニンフィア', type: 'fairy' as const, currentLevel: 16, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 2 },
        { pokemonId: 'dragonite', pokedexId: 149, name: '80カイリュー', type: 'dragon' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 900 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 3 },
        { pokemonId: 'swalot', pokedexId: 317, name: '70マルノーム', type: 'poison' as const, currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 4 },
        { pokemonId: 'cresselia', pokedexId: 488, name: '70仮クレセリア', type: 'psychic' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 1080 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 5 },
        { pokemonId: 'entei', pokedexId: 244, name: 'エンテイ', type: 'fire' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 1080 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 6 },
        { pokemonId: 'flareon', pokedexId: 136, name: 'ブースター', type: 'fire' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 7 },
        { pokemonId: 'kangaskhan', pokedexId: 115, name: 'ガルーラ', type: 'normal' as const, currentLevel: 53, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 8 },
        { pokemonId: 'raikou', pokedexId: 243, name: '仮ライコウ', type: 'electric' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 1080 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 9 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'mini' as const, limit: 350 },
      candyInventory: {
        species: { '923': 181, '845': 0, '700': 2947, '149': 436, '317': 272, '488': 500, '244': 100, '136': 2, '115': 0, '243': 0 },
        typeCandy: {
          electric: { s: 0, m: 0 },
          flying: { s: 0, m: 0 },
          fairy: { s: 0, m: 10 },
          dragon: { s: 13, m: 0 },
          poison: { s: 0, m: 0 },
          psychic: { s: 18, m: 10 },
          fire: { s: 0, m: 0 },
          normal: { s: 5, m: 3 },
        },
        universal: { s: 432, m: 102, l: 9 },
      },
      options: { itemCompareMode: 'surplusGateFirst' as const },
    };

    const result = solveLevelPlan(input);
    const kangaskhan = result.pokemonResults.find(row => row.pokemonId === 'kangaskhan')?.reachableLine;
    const raikou = result.pokemonResults.find(row => row.pokemonId === 'raikou')?.reachableLine;

    expect(kangaskhan?.targetReached).toBe(false);
    expect(kangaskhan?.level).toBe(54);
    expect(kangaskhan?.totalCandyUnitsUsed).toBe(118);
    expect(raikou?.targetReached).toBe(false);
    expect(raikou?.surplusCandyValue).toBeLessThanOrEqual(2);
    expect(kangaskhan?.surplusCandyValue).toBeLessThanOrEqual(2);
    expect(result.performance?.boundarySearch).toMatchObject({
      mode: 'surplusGateFirst',
      boundaryIndex: 8,
      targetTotalCandy: 674,
      maxFeasibleTotalCandy: 118,
      selectedTotalCandy: 118,
      firstZeroRawSurplusTotalCandy: undefined,
      stoppedReason: 'first_acceptable_surplus',
    });
    expect(result.performance?.boundarySearch?.checkedLowerTotals).toBeLessThanOrEqual(2);
  });

  it('バランスは同タイプ境界の最大到達量を逐次降下せず求める', () => {
    const input: LevelPlannerInput = {
      pokemonList: [
        { pokemonId: 'pawmot', pokedexId: 923, name: '80パーモット', type: 'electric' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'cramorant', pokedexId: 845, name: '70ウッウ（油）', type: 'flying' as const, currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 1 },
        { pokemonId: 'sylveon', pokedexId: 700, name: '70仮ニンフィア', type: 'fairy' as const, currentLevel: 16, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 2 },
        { pokemonId: 'dragonite', pokedexId: 149, name: '80カイリュー', type: 'dragon' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 900 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 3 },
        { pokemonId: 'swalot', pokedexId: 317, name: '70マルノーム', type: 'poison' as const, currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 4 },
        { pokemonId: 'cresselia', pokedexId: 488, name: '70仮クレセリア', type: 'psychic' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 1080 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 5 },
        { pokemonId: 'entei', pokedexId: 244, name: 'エンテイ', type: 'fire' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 1080 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 6 },
        { pokemonId: 'flareon', pokedexId: 136, name: 'ブースター', type: 'fire' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 7 },
        { pokemonId: 'kangaskhan', pokedexId: 115, name: 'ガルーラ', type: 'normal' as const, currentLevel: 53, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 8 },
        { pokemonId: 'raikou', pokedexId: 243, name: '仮ライコウ', type: 'electric' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 1080 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 9 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: { '923': 181, '845': 0, '700': 2947, '149': 436, '317': 272, '488': 500, '244': 100, '136': 2, '115': 0, '243': 0 },
        typeCandy: {
          electric: { s: 0, m: 0 },
          flying: { s: 0, m: 0 },
          fairy: { s: 0, m: 10 },
          dragon: { s: 13, m: 0 },
          poison: { s: 0, m: 1 },
          psychic: { s: 18, m: 10 },
          fire: { s: 0, m: 0 },
          normal: { s: 5, m: 3 },
        },
        universal: { s: 432, m: 102, l: 9 },
      },
      options: { itemCompareMode: 'surplusGateFirst' as const },
    };

    const result = solveLevelPlan(input);
    const flareon = result.pokemonResults.find(row => row.pokemonId === 'flareon')?.reachableLine;

    expect(flareon?.targetReached).toBe(false);
    expect(flareon?.totalCandyUnitsUsed).toBe(557);
    expect(result.performance?.boundarySearch).toMatchObject({
      mode: 'surplusGateFirst',
      boundaryIndex: 7,
      maxFeasibleTotalCandy: 557,
      maxFeasibleScope: 'rowSurplusGate',
      selectedTotalCandy: 557,
      checkedLowerTotals: 1,
      stoppedReason: 'first_acceptable_surplus',
    });
  });

  it('EXP最大はタイプ在庫ゼロの同タイプ境界を独立境界として扱う', () => {
    const input: LevelPlannerInput = {
      pokemonList: [
        { pokemonId: 'pawmot', pokedexId: 923, name: '80パーモット', type: 'electric' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 0 },
        { pokemonId: 'cramorant', pokedexId: 845, name: '70ウッウ（油）', type: 'flying' as const, currentLevel: 68, currentExpInLevel: 198, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 1 },
        { pokemonId: 'sylveon', pokedexId: 700, name: '70仮ニンフィア', type: 'fairy' as const, currentLevel: 16, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 2 },
        { pokemonId: 'dragonite', pokedexId: 149, name: '80カイリュー', type: 'dragon' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 900 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 3 },
        { pokemonId: 'swalot', pokedexId: 317, name: '70マルノーム', type: 'poison' as const, currentLevel: 57, currentExpInLevel: 1553, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 4 },
        { pokemonId: 'cresselia', pokedexId: 488, name: '70仮クレセリア', type: 'psychic' as const, currentLevel: 65, currentExpInLevel: 0, targetLevel: 70, targetExpInLevel: 0, expType: 1080 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 5 },
        { pokemonId: 'entei', pokedexId: 244, name: 'エンテイ', type: 'fire' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 1080 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 6 },
        { pokemonId: 'flareon', pokedexId: 136, name: 'ブースター', type: 'fire' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 7 },
        { pokemonId: 'kangaskhan', pokedexId: 115, name: 'ガルーラ', type: 'normal' as const, currentLevel: 53, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 8 },
        { pokemonId: 'raikou', pokedexId: 243, name: '仮ライコウ', type: 'electric' as const, currentLevel: 50, currentExpInLevel: 0, targetLevel: 60, targetExpInLevel: 0, expType: 1080 as const, nature: 'down' as const, requestedBoostCandy: 0, boostAllowed: true, priorityIndex: 9 },
      ],
      dreamShards: 10_000_000,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: { '923': 181, '845': 0, '700': 2947, '149': 436, '317': 272, '488': 500, '244': 100, '136': 2, '115': 0, '243': 0 },
        typeCandy: {
          electric: { s: 0, m: 0 },
          flying: { s: 0, m: 0 },
          fairy: { s: 0, m: 10 },
          dragon: { s: 13, m: 0 },
          poison: { s: 0, m: 2 },
          psychic: { s: 18, m: 10 },
          fire: { s: 0, m: 0 },
          normal: { s: 5, m: 3 },
        },
        universal: { s: 432, m: 102, l: 9 },
      },
      options: { itemCompareMode: 'legacyImproved' as const },
    };

    const result = solveLevelPlan(input);
    const flareon = result.pokemonResults.find(row => row.pokemonId === 'flareon')?.reachableLine;

    expect(flareon?.targetReached).toBe(false);
    expect(flareon?.totalCandyUnitsUsed).toBe(569);
    expect(result.performance?.boundarySearch).toMatchObject({
      mode: 'legacyImproved',
      boundaryIndex: 7,
      maxFeasibleTotalCandy: 569,
      maxFeasibleScope: 'unrestricted',
      selectedTotalCandy: 569,
      checkedLowerTotals: 0,
      stoppedReason: 'exp_first',
    });
  });

  it('余り0〜2優先は境界を下げて共有資源をprefixへ戻せる場合を見落とさない', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'prefix-shared-surplus', pokedexId: 9101, name: '共有prefix', type: 'alpha' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 17 }, priorityIndex: 0 },
        { pokemonId: 'boundary-releases-shared', pokedexId: 9102, name: '共有境界', type: 'beta' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 100 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: { alpha: { s: 0, m: 1 }, beta: { s: 0, m: 0 } },
        universal: { s: 6, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'surplusGateFirst' as const },
    });

    const boundarySearch = result.performance?.boundarySearch;
    const prefix = result.pokemonResults.find(row => row.pokemonId === 'prefix-shared-surplus')?.reachableLine;
    const boundary = result.pokemonResults.find(row => row.pokemonId === 'boundary-releases-shared')?.reachableLine;

    expect(prefix?.candySupply.universal.s).toBe(6);
    expect(prefix?.candySupply.type.m).toBe(0);
    expect(prefix?.surplusCandyValue).toBeLessThanOrEqual(MAX_ACCEPTABLE_SURPLUS);
    expect(boundary?.totalCandyUnitsUsed).toBe(0);
    expect(boundarySearch?.checkedLowerTotals).toBeGreaterThan(0);
  });

  it('余り0〜2優先は行余り下限に到達済みなら境界の下方向全探索を省く', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'prefix-bound-surplus', pokedexId: 9201, name: 'prefix下限', type: 'alpha' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 17 }, priorityIndex: 0 },
        { pokemonId: 'boundary-independent', pokedexId: 9202, name: '独立境界', type: 'beta' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 100 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: { alpha: { s: 0, m: 1 }, beta: { s: 0, m: 3 } },
        universal: { s: 0, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'surplusGateFirst' as const },
    });

    const boundarySearch = result.performance?.boundarySearch;
    const prefix = result.pokemonResults.find(row => row.pokemonId === 'prefix-bound-surplus')?.reachableLine;
    const boundary = result.pokemonResults.find(row => row.pokemonId === 'boundary-independent')?.reachableLine;

    expect(prefix?.surplusCandyValue).toBe(8);
    expect(boundary?.totalCandyUnitsUsed).toBe(75);
    expect(boundary?.surplusCandyValue).toBe(0);
    expect(boundarySearch).toMatchObject({
      mode: 'surplusGateFirst',
      selectedTotalCandy: 75,
    });
  });

  it('余り0〜2優先は行余り下限が支配する大量境界候補を再探索しない', () => {
    const result = solveLevelPlan({
      pokemonList: [
        { pokemonId: 'prefix-many-boundary', pokedexId: 9301, name: '大量prefix', type: 'alpha' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 21 }, priorityIndex: 0 },
        { pokemonId: 'many-boundary', pokedexId: 9302, name: '大量境界', type: 'beta' as const, currentLevel: 10, currentExpInLevel: 0, targetLevel: 60, expType: 600 as const, nature: 'normal' as const, requestedBoostCandy: 0, boostAllowed: true, candyTarget: { totalCandyUnits: 1000 }, priorityIndex: 1 },
      ],
      dreamShards: Infinity,
      boost: { kind: 'none' as const, limit: 0 },
      candyInventory: {
        species: {},
        typeCandy: { alpha: { s: 0, m: 1 }, beta: { s: 0, m: 20 } },
        universal: { s: 0, m: 0, l: 0 },
      },
      options: { itemCompareMode: 'surplusGateFirst' as const },
    });

    expect(result.performance?.boundarySearch).toMatchObject({
      mode: 'surplusGateFirst',
      boundaryIndex: 1,
      selectedTotalCandy: 500,
      selectedNormalizedSurplus: 4,
      checkedLowerTotals: 0,
      stoppedReason: 'row_surplus_bound',
    });
  });
});
