import { describe, expect, it } from 'vitest';

import { solveLevelPlan } from '../../../src/domain/level-planner/core/solveLevelPlan';
import { targetFromCandy } from '../../../src/domain/level-planner/deriveTarget';
import type {
  BoostKind,
  LevelPlannerInput,
  LevelPlannerResult,
} from '../../../src/domain/level-planner/types';

type PokemonInput = LevelPlannerInput['pokemonList'][number];

function fixedCandyRow(params: {
  id: string;
  pokedexId: number;
  type: string;
  totalCandy: number;
  boostCandy: number;
  boostKind: BoostKind;
  priorityIndex: number;
}): PokemonInput {
  const target = targetFromCandy({
    srcLevel: 10,
    expGot: 0,
    candyTarget: params.totalCandy,
    boostCandy: params.boostCandy,
    expType: 600,
    nature: 'normal',
    boostKind: params.boostKind,
  });
  return {
    pokemonId: params.id,
    pokedexId: params.pokedexId,
    candyFamilyKey: String(params.pokedexId),
    name: params.id,
    type: params.type,
    currentLevel: 10,
    currentExpInLevel: 0,
    targetLevel: target.level,
    targetExpInLevel: target.expInLevel,
    expType: 600,
    nature: 'normal',
    requestedBoostCandy: params.boostCandy,
    boostAllowed: true,
    candyTarget: {
      totalCandyUnits: params.totalCandy,
      boostedCandyUnits: params.boostCandy,
    },
    priorityIndex: params.priorityIndex,
  };
}

function targetLevelRow(params: {
  id: string;
  pokedexId: number;
  type: string;
  targetLevel: number;
  requestedBoostCandy?: number;
  priorityIndex: number;
}): PokemonInput {
  return {
    pokemonId: params.id,
    pokedexId: params.pokedexId,
    candyFamilyKey: String(params.pokedexId),
    name: params.id,
    type: params.type,
    currentLevel: 10,
    currentExpInLevel: 0,
    targetLevel: params.targetLevel,
    targetExpInLevel: 0,
    expType: 600,
    nature: 'normal',
    requestedBoostCandy: params.requestedBoostCandy ?? 0,
    boostAllowed: true,
    priorityIndex: params.priorityIndex,
  };
}

function shardLimitedInput(
  boostKind: BoostKind,
  boostLimit: number,
  dreamShards: number,
): LevelPlannerInput {
  return {
    pokemonList: [
      fixedCandyRow({
        id: 'fixed-upper',
        pokedexId: 25,
        type: 'electric',
        totalCandy: 300,
        boostCandy: 300,
        boostKind,
        priorityIndex: 0,
      }),
      targetLevelRow({
        id: 'reached-lower',
        pokedexId: 133,
        type: 'normal',
        targetLevel: 20,
        priorityIndex: 1,
      }),
      targetLevelRow({
        id: 'shard-boundary',
        pokedexId: 4,
        type: 'fire',
        targetLevel: 60,
        priorityIndex: 2,
      }),
      targetLevelRow({
        id: 'after-boundary',
        pokedexId: 1,
        type: 'grass',
        targetLevel: 20,
        priorityIndex: 3,
      }),
    ],
    dreamShards,
    boost: { kind: boostKind, limit: boostLimit },
    candyInventory: {
      species: {
        '25': 300,
        '133': 5_000,
        '4': 5_000,
        '1': 5_000,
      },
      typeCandy: {},
      universal: { s: 0, m: 0, l: 0 },
    },
    options: { itemCompareMode: 'surplusGateFirst' },
  };
}

function boostContentionInput(boostLimit: number): LevelPlannerInput {
  return {
    pokemonList: [
      fixedCandyRow({
        id: 'boost-upper',
        pokedexId: 25,
        type: 'electric',
        totalCandy: 300,
        boostCandy: 300,
        boostKind: 'full',
        priorityIndex: 0,
      }),
      fixedCandyRow({
        id: 'boost-lower',
        pokedexId: 133,
        type: 'normal',
        totalCandy: 150,
        boostCandy: 150,
        boostKind: 'full',
        priorityIndex: 1,
      }),
      targetLevelRow({
        id: 'inventory-boundary',
        pokedexId: 4,
        type: 'fire',
        targetLevel: 60,
        priorityIndex: 2,
      }),
    ],
    dreamShards: 999_999_999,
    boost: { kind: 'full', limit: boostLimit },
    candyInventory: {
      species: { '25': 300, '133': 150, '4': 0 },
      typeCandy: {},
      universal: { s: 0, m: 0, l: 0 },
    },
    options: { itemCompareMode: 'surplusGateFirst' },
  };
}

function observation(result: LevelPlannerResult) {
  return {
    boundaryIndex: result.summary.boundaryPokemonId === undefined
      ? null
      : result.pokemonResults.findIndex(
        row => row.pokemonId === result.summary.boundaryPokemonId,
      ),
    reachedCount: result.summary.fullyReachedCount,
    surplusTotal: result.pokemonResults.reduce(
      (sum, row) => sum + row.reachableLine.surplusCandyValue,
      0,
    ),
    shardRemaining: result.summary.dreamShardsRemaining,
    rows: result.pokemonResults.map(row => ({
      id: row.pokemonId,
      role: row.role,
      boost: row.reachableLine.boostedCandyUnits,
      normal: row.reachableLine.nonBoostCandyUnits,
      shards: row.reachableLine.dreamShardsUsed,
      level: row.reachableLine.level,
      expInLevel: row.reachableLine.expInLevel,
      surplus: row.reachableLine.surplusCandyValue,
      supply: row.reachableLine.candySupply,
      candyDemandMet: row.reachableLine.candyDemandMet,
      effectiveTargetReached: row.reachableLine.effectiveTargetReached,
      boostUnavailable: row.shortage.boostCandyUnavailable,
      limitingFactor: row.constraintDiagnosis.limitingFactor,
    })),
  };
}

/**
 * B-4 の実測検証（設計書 §11.3 / §12）を固定する。
 *
 * **⚠ このファイルには2種類のアサーションが混ざっている。落ちたときの扱いが違う。**
 *
 * 1. **不変条件** — B-4 の主張そのもの。値ではなく「関係」を見ている。
 *    - 下位行が対照間で一致すること（`toEqual`）
 *    - 浮いたかけらで境界行が改善すること（`toBeGreaterThan`）
 *    - 境界より下が悪化しないこと（`toBeGreaterThanOrEqual`）
 *    - `boundaryIndex` / `reachedCount` / 余り合計が対照間で一致すること
 *    - 前提の成立（`limitingFactor === 'shards'`、かけら残 < 50）
 *
 * 2. **ゴールデン値** — `shards: 122_178` のような実測の固定値。
 *    配分器を正当に改善すれば動きうる。
 *
 * **ゴールデン値が落ちたときに、1 の行まで一緒に書き換えてはならない。**
 * 1 が落ちたなら B-4 の結論（上位が未達でも下位配分は劣化しない）が崩れているので、
 * 数値を更新する前に設計書 §11.3 へ戻って再検証すること。
 *
 * 検出力: 個数指定行の `candyDemandMet` 生成経路を `effectiveTargetReached` 側へ戻すと
 * 3件とも落ちることを確認済み（2026-07-29）。
 */
describe('B-4: 個数指定の上位がアメブ不足でも下位配分を劣化させない', () => {
  it.each([
    {
      boostKind: 'full',
      enoughBoundary: {
        boost: 0, normal: 60, shards: 3_329, level: 15, expInLevel: 424,
      },
      insufficientBoundary: {
        boost: 0, normal: 832, shards: 122_178, level: 46, expInLevel: 149,
      },
      enoughAfterBoundary: {
        boost: 0, normal: 0, shards: 0, level: 10, expInLevel: 0,
      },
      insufficientAfterBoundary: {
        boost: 0, normal: 0, shards: 0, level: 10, expInLevel: 0,
      },
      enoughShardRemaining: 13,
      insufficientShardRemaining: 7,
      freedShards: 118_843,
    },
    {
      boostKind: 'mini',
      enoughBoundary: {
        boost: 0, normal: 401, shards: 39_253, level: 34, expInLevel: 185,
      },
      insufficientBoundary: {
        boost: 0, normal: 861, shards: 129_428, level: 46, expInLevel: 874,
      },
      enoughAfterBoundary: {
        boost: 0, normal: 1, shards: 50, level: 10, expInLevel: 40,
      },
      insufficientAfterBoundary: {
        boost: 0, normal: 2, shards: 100, level: 10, expInLevel: 80,
      },
      enoughShardRemaining: 36,
      insufficientShardRemaining: 10,
      freedShards: 90_199,
    },
  ] as const)('$boostKind: かけら律速下で浮いたかけらが下位を改善する', fixture => {
    const { boostKind } = fixture;
    const enough = observation(
      solveLevelPlan(shardLimitedInput(boostKind, 300, 190_000)),
    );
    const insufficient = observation(
      solveLevelPlan(shardLimitedInput(boostKind, 100, 190_000)),
    );

    // 前提1: 足りない版だけ、個数指定の最上位が需要を満たしたまま目標未達になる。
    expect(enough.rows[0]).toMatchObject({
      boost: 300,
      normal: 0,
      candyDemandMet: true,
      effectiveTargetReached: true,
      boostUnavailable: 0,
      limitingFactor: null,
    });
    expect(insufficient.rows[0]).toMatchObject({
      boost: 100,
      normal: 200,
      candyDemandMet: true,
      effectiveTargetReached: false,
      boostUnavailable: 200,
      limitingFactor: 'boost',
    });
    expect(enough.rows[0]!.shards - insufficient.rows[0]!.shards).toBe(
      fixture.freedShards,
    );

    // 前提2: 本題の比較対象は両方とも実際にかけら律速で、かけらをほぼ使い切る。
    expect(enough.rows[2]!.limitingFactor).toBe('shards');
    expect(insufficient.rows[2]!.limitingFactor).toBe('shards');
    expect(enough.shardRemaining).toBe(fixture.enoughShardRemaining);
    expect(insufficient.shardRemaining).toBe(fixture.insufficientShardRemaining);
    expect(enough.shardRemaining).toBeLessThan(50);
    expect(insufficient.shardRemaining).toBeLessThan(50);

    // 個数指定行より下の到達済み上位は、対照間で完全一致する。
    expect(insufficient.rows[1]).toEqual(enough.rows[1]);
    expect(enough.rows[1]).toMatchObject({
      boost: 0,
      normal: 108,
      shards: 6_673,
      level: 20,
      expInLevel: 1,
      candyDemandMet: true,
      effectiveTargetReached: true,
    });

    // 浮いたかけらは境界以降を悪化させず、境界行を必ず改善する。
    expect(enough.rows[2]).toMatchObject(fixture.enoughBoundary);
    expect(insufficient.rows[2]).toMatchObject(fixture.insufficientBoundary);
    expect(insufficient.rows[2]!.level).toBeGreaterThan(enough.rows[2]!.level);
    expect(enough.rows[3]).toMatchObject(fixture.enoughAfterBoundary);
    expect(insufficient.rows[3]).toMatchObject(fixture.insufficientAfterBoundary);
    expect(insufficient.rows[3]!.level).toBeGreaterThanOrEqual(enough.rows[3]!.level);
    expect(insufficient.rows[3]!.expInLevel).toBeGreaterThanOrEqual(
      enough.rows[3]!.expInLevel,
    );

    // 上位がアメ到達だけ失っても、需要充足prefixと余り品質は維持される。
    expect(enough.boundaryIndex).toBe(2);
    expect(insufficient.boundaryIndex).toBe(2);
    expect(enough.reachedCount).toBe(2);
    expect(insufficient.reachedCount).toBe(2);
    expect(enough.surplusTotal).toBe(0);
    expect(insufficient.surplusTotal).toBe(0);
  });

  it('アメブ枠を上位から順に配る対照値を固定する', () => {
    const largerCap = observation(solveLevelPlan(boostContentionInput(400)));
    const smallerCap = observation(solveLevelPlan(boostContentionInput(200)));

    // 上位が要求300を先取りし、下位は残りだけを受け取る。
    expect(largerCap.rows.map(row => row.boost)).toEqual([300, 100, 0]);
    expect(largerCap.rows.map(row => row.normal)).toEqual([0, 50, 0]);
    expect(largerCap.rows[0]).toMatchObject({
      candyDemandMet: true,
      effectiveTargetReached: true,
      boostUnavailable: 0,
    });
    expect(largerCap.rows[1]).toMatchObject({
      candyDemandMet: true,
      effectiveTargetReached: false,
      boostUnavailable: 50,
    });

    // 枠を200へ減らすと全量を最上位へ配り、下位へ先回りさせない。
    expect(smallerCap.rows.map(row => row.boost)).toEqual([200, 0, 0]);
    expect(smallerCap.rows.map(row => row.normal)).toEqual([100, 150, 0]);
    expect(smallerCap.rows[0]).toMatchObject({
      candyDemandMet: true,
      effectiveTargetReached: false,
      boostUnavailable: 100,
    });
    expect(smallerCap.rows[1]).toMatchObject({
      candyDemandMet: true,
      effectiveTargetReached: false,
      boostUnavailable: 150,
    });

    expect(largerCap.rows.reduce((sum, row) => sum + row.boost, 0)).toBe(400);
    expect(smallerCap.rows.reduce((sum, row) => sum + row.boost, 0)).toBe(200);
    expect(largerCap.boundaryIndex).toBe(2);
    expect(smallerCap.boundaryIndex).toBe(2);
    expect(largerCap.reachedCount).toBe(2);
    expect(smallerCap.reachedCount).toBe(2);
    expect(largerCap.surplusTotal).toBe(0);
    expect(smallerCap.surplusTotal).toBe(0);
  });
});
