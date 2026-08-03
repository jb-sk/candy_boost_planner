import { describe, expect, it } from 'vitest';

import { solveLevelPlan } from '../../../src/domain/level-planner/core/solveLevelPlan';
import { boostRules } from '../../../src/domain/pokesleep/boost-config';
import { simulateCandyRun } from '../../../src/domain/pokesleep/simulateCandyBudget';
import type { BoostKind, LevelPlannerInput } from '../../../src/domain/level-planner/types';

/**
 * `boostKind = 'mini'` に固有の計算が無いことを固定する。
 *
 * 実装上 mini と full の差は `boost-config.ts` の `shardMultiplier`（4 と 5）**1つだけ**で、
 * `expMultiplier` はどちらも 2、mini を条件分岐している箇所は `src/domain/` に存在しない。
 * ここが崩れる（mini 専用の分岐が入る）と、下の2本が落ちる。
 *
 * - **かけら無制限なら配分は完全一致**し、かけらだけが 4:5 の整数比になる
 * - **かけら律速の掃引で mini が full を下回らない**（単価が安いぶん常に同じか有利）
 */

function singleRowInput(kind: BoostKind, dreamShards: number): LevelPlannerInput {
  return {
    pokemonList: [
      {
        pokemonId: 'solo',
        pokedexId: 25,
        candyFamilyKey: '25',
        name: 'solo',
        type: 'electric',
        currentLevel: 10,
        currentExpInLevel: 0,
        targetLevel: 40,
        targetExpInLevel: 0,
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 5_000,
        boostAllowed: true,
        priorityIndex: 0,
      },
    ],
    dreamShards,
    boost: { kind, limit: 5_000 },
    candyInventory: {
      species: { '25': 5_000 },
      typeCandy: {},
      universal: { s: 0, m: 0, l: 0 },
    },
    options: { itemCompareMode: 'surplusGateFirst' },
  };
}

const lineOf = (kind: BoostKind, dreamShards: number) =>
  solveLevelPlan(singleRowInput(kind, dreamShards)).pokemonResults[0]!;

describe("boostKind = 'mini' に固有の計算は無い", () => {
  it('かけら無制限なら配分は full と完全一致し、かけらだけが安くなる', () => {
    const full = lineOf('full', 999_999_999).reachableLine;
    const mini = lineOf('mini', 999_999_999).reachableLine;

    // 手法6: 前提。どちらもアメブ主体で目標へ到達している
    // （末尾1個は §10.5 の「アメブ1個→通常アメ1個」置換で通常アメになる）。
    expect(full.boostedCandyUnits).toBeGreaterThan(0);
    expect(full.level).toBe(40);

    // 配分はかけら以外すべて一致する。ここが mini 固有分岐の検出点。
    expect({ ...mini, dreamShardsUsed: 0 }).toEqual({ ...full, dreamShardsUsed: 0 });
    expect(mini.dreamShardsUsed).toBeLessThan(full.dreamShardsUsed);
  });

  it('消費規則そのもの: アメブだけなら かけらは厳密に 4:5', () => {
    const subject = { currentLevel: 10, currentExpInLevel: 0, expType: 600 as const, nature: 'normal' as const };
    const spec = { boostBudget: 300, normalBudget: 0, totalCap: 300, shardLimit: Infinity, shouldContinue: () => true };
    const full = simulateCandyRun(subject, { ...spec, kind: 'full' });
    const mini = simulateCandyRun(subject, { ...spec, kind: 'mini' });

    expect(full.boostUsed).toBe(300);
    expect(mini.boostUsed).toBe(300);
    expect(mini.level).toBe(full.level);
    expect(mini.expInLevel).toBe(full.expInLevel);
    // 単価は `dreamShardsPerCandy[到達先Lv] × shardMultiplier` だけの違い。整数比なので誤差を許さない。
    expect(mini.shards * boostRules.full.shardMultiplier)
      .toBe(full.shards * boostRules.mini.shardMultiplier);
  });

  it('手法4: かけらを掃引しても mini が full を下回らない', () => {
    const fullMax = lineOf('full', 999_999_999).reachableLine.dreamShardsUsed;
    const budgets = [0, 1, 500, 5_000, 50_000, Math.floor(fullMax / 2), fullMax - 1, fullMax];

    for (const budget of budgets) {
      const full = lineOf('full', budget).reachableLine;
      const mini = lineOf('mini', budget).reachableLine;

      expect(mini.dreamShardsUsed).toBeLessThanOrEqual(budget);
      expect(full.dreamShardsUsed).toBeLessThanOrEqual(budget);
      // 到達点は mini が常に同じか先。単価が安いので逆転してはいけない。
      expect(mini.level * 100_000 + mini.expInLevel)
        .toBeGreaterThanOrEqual(full.level * 100_000 + full.expInLevel);
    }
  });
});
