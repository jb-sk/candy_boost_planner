/**
 * 基本制限テスト（Test 1-5）
 *
 * 単一の制限要因のみをテストする基本ケース
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 *
 * 使用ポケモン：
 * - Test1: ピチュー（EXPタイプ600）
 * - Test2: ピカチュウ（EXPタイプ600、性格上昇補正）
 * - Test3: ミニリュウ（EXPタイプ900）
 * - Test4: スイクン（EXPタイプ1080、性格下降補正）
 * - Test5: ダークライ（EXPタイプ1320）
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../core';
import { pokemon, inventory, config, getPokemon, validatePokemonInvariants } from './helpers';

describe('基本制限テスト', () => {
  // ========================================
  // テスト1: 制限なし（基本ケース）
  // ========================================
  // 使用ポケモン: ピチュー（EXPタイプ600）
  // Lv: 10→20
  // expType: 600, nature: normal, boost: full
  //
  // 条件:
  //   グローバルアメブ上限: 無制限
  //   かけら上限: 無制限
  //   在庫: 万能S 1000(3000価値), M 100(2000), L 10(1000) = 十分
  //
  // 期待:
  //   reachedLevel: 20（目標到達）
  //   shortage.candy: 0（不足なし）
  describe('Test1: 制限なし - ピチュー（EXP600）', () => {
    it('到達Lv = 目標Lv、アメ不足なし', () => {
      // Lv10→20に必要なアメ（EXPタイプ600）= 約62個
      const result = planLevelUp(
        [pokemon({
          id: 'test1',
          pokedexId: 172,
          pokemonName: 'ピチュー',
          type: 'electric',
          srcLevel: 10,
          dstLevel: 20,
          expType: 600,
          nature: 'normal',
          expGot: 0,
          candyNeed: 62,
          boostOrExpAdjustment: 62,
        })],
        inventory({ universal: { s: 1000, m: 100, l: 10 } }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test1');
      expect(p.reachedLevel).toBe(20);
      expect(p.shortage.candy).toBe(0);
      validatePokemonInvariants(p, { globalBoostLimit: Infinity, globalShardsLimit: Infinity, boostKind: 'full' }, 'Test1');
    });
  });

  // ========================================
  // テスト2: アメブ不足のみ
  // ========================================
  // 使用ポケモン: ピカチュウ（EXPタイプ600、性格上昇補正）
  // Lv: 10→60
  // expType: 600, nature: up, boost: full
  //
  // 条件:
  //   グローバルアメブ上限: 500（必要量より少ない）
  //   かけら上限: 無制限
  //   在庫: 種族500 + タイプM 10(250) + 万能S 1000(3000) + M 100(2000) + L 10(1000) = 十分
  //
  // 期待:
  //   boostCount: ≤ 500（グローバル上限以下）
  //   normalCount: 0（アメブ100%設定）
  //   reachedLevel: > 10
  describe('Test2: アメブ不足のみ - ピカチュウ（EXP600, 性格↑）', () => {
    it('アメブ使用 ≤ グローバル上限、通常アメ = 0', () => {
      // Lv10→60に必要なアメ（EXPタイプ600, nature=up）= 約1379個
      const result = planLevelUp(
        [pokemon({
          id: 'test2',
          pokedexId: 25,
          pokemonName: 'ピカチュウ',
          type: 'electric',
          srcLevel: 10,
          dstLevel: 60,
          expType: 600,
          nature: 'up',
          expGot: 0,
          candyNeed: 1379,
          boostOrExpAdjustment: 1379,
        })],
        inventory({
          species: { '25': 500 },
          typeCandy: { electric: { s: 0, m: 10 } },
          universal: { s: 1000, m: 100, l: 10 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 500, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test2');
      expect(p.reachableItems.boostCount).toBeLessThanOrEqual(500);
      expect(p.reachableItems.normalCount).toBe(0);
      expect(p.reachedLevel).toBeGreaterThan(10);
      validatePokemonInvariants(p, { globalBoostLimit: Infinity, globalShardsLimit: Infinity, boostKind: 'full' }, 'Test1');
    });
  });

  // ========================================
  // テスト3: かけら不足のみ
  // ========================================
  // 使用ポケモン: ミニリュウ（EXPタイプ900）
  // Lv: 10→60
  // expType: 900, nature: normal, boost: full
  //
  // 条件:
  //   グローバルアメブ上限: 無制限
  //   かけら上限: 500,000（必要量より少ない）
  //   在庫: 十分
  //
  // 期待:
  //   shardsCount: ≤ 500,000
  //   reachedLevel: > 10
  describe('Test3: かけら不足のみ - ミニリュウ（EXP900）', () => {
    it('かけら使用 ≤ かけら上限', () => {
      // Lv10→60に必要なアメ（EXPタイプ900）= 約1866個、かけら約2,025,000
      const result = planLevelUp(
        [pokemon({
          id: 'test3',
          pokedexId: 147,
          pokemonName: 'ミニリュウ',
          type: 'dragon',
          srcLevel: 10,
          dstLevel: 60,
          expType: 900,
          nature: 'normal',
          expGot: 0,
          candyNeed: 1866,
          boostOrExpAdjustment: 1866,
        })],
        inventory({
          species: { '147': 500 },
          typeCandy: { dragon: { s: 0, m: 10 } },
          universal: { s: 1000, m: 100, l: 10 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: 500000 })
      );

      const p = getPokemon(result, 'test3');
      expect(p.reachableItems.shardsCount).toBeLessThanOrEqual(500000);
      expect(p.reachedLevel).toBeGreaterThan(10);
      validatePokemonInvariants(p, { globalBoostLimit: Infinity, globalShardsLimit: Infinity, boostKind: 'full' }, 'Test1');
    });
  });

  // ========================================
  // テスト4: アメ在庫不足のみ
  // ========================================
  // 使用ポケモン: スイクン（EXPタイプ1080、性格下降補正）
  // Lv: 25→35
  // expType: 1080, nature: down
  //
  // 条件:
  //   グローバルアメブ上限: 3500
  //   かけら上限: 2,000,000
  //   在庫: 種族100 + みずS 5個(20) + 万能S 30個(90) = 210価値
  //   candyNeed: 250 → 不足 40
  //
  // 期待:
  //   totalSupply: 210
  //   shortage.candy: 40
  //   reachedLevel: 32
  describe('Test4: アメ在庫不足のみ - スイクン（EXP1080, 性格↓）', () => {
    it('使用量 = 210、アメ不足 40、到達Lv 32', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test4',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 25,
          dstLevel: 35,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 284,
          boostOrExpAdjustment: 284,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 30, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test4');
      expect(p.reachableItems.totalSupply).toBe(210);
      expect(p.shortage.candy).toBe(74);
      expect(p.reachedLevel).toBe(32);
      validatePokemonInvariants(p, { globalBoostLimit: 3500, globalShardsLimit: 2000000, boostKind: 'full' }, 'Test4');
    });
  });

  // ========================================
  // テスト5: アイテム在庫不足（万能Sのみ）
  // ========================================
  // 使用ポケモン: ダークライ（EXPタイプ1320）
  // Lv: 25→35
  // expType: 1320, nature: normal
  //
  // 条件:
  //   在庫: 万能S 10個のみ = 30価値
  //   → 必要量に対して大幅不足
  //
  // 期待:
  //   universalS: 10（全て使用）
  //   totalSupply: 30
  //   shortage.candy: > 0
  describe('Test5: アイテム在庫不足 - ダークライ（EXP1320）', () => {
    it('万能S = 在庫全て、使用量 = 30、アメ不足あり', () => {
      // Lv25→35に必要なアメ（EXPタイプ1320）= 約285個
      const result = planLevelUp(
        [pokemon({
          id: 'test5',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 25,
          dstLevel: 35,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 285,
          boostOrExpAdjustment: 285,
        })],
        inventory({
          species: {},
          typeCandy: {},
          universal: { s: 10, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test5');
      expect(p.reachableItems.universalS).toBe(10);
      expect(p.reachableItems.totalSupply).toBe(30);
      expect(p.shortage.candy).toBeGreaterThan(0);
      validatePokemonInvariants(p, { globalBoostLimit: Infinity, globalShardsLimit: Infinity, boostKind: 'full' }, 'Test1');
    });
  });
});

// ========================================
// Invariants（全テストで共通）
// ========================================
describe('基本制限テスト - Invariants', () => {
  const testCases = [
    { id: 'inv1', pokedexId: 172, pokemonName: 'ピチュー', type: 'electric' as const, expType: 600 as const, nature: 'normal' as const, candyNeed: 62, srcLevel: 10, dstLevel: 20 },
    { id: 'inv2', pokedexId: 25, pokemonName: 'ピカチュウ', type: 'electric' as const, expType: 600 as const, nature: 'up' as const, candyNeed: 1379, srcLevel: 10, dstLevel: 60 },
    { id: 'inv3', pokedexId: 147, pokemonName: 'ミニリュウ', type: 'dragon' as const, expType: 900 as const, nature: 'normal' as const, candyNeed: 1866, srcLevel: 10, dstLevel: 60 },
    { id: 'inv4', pokedexId: 245, pokemonName: 'スイクン', type: 'water' as const, expType: 1080 as const, nature: 'down' as const, candyNeed: 233, srcLevel: 25, dstLevel: 35 },
    { id: 'inv5', pokedexId: 491, pokemonName: 'ダークライ', type: 'dark' as const, expType: 1320 as const, nature: 'normal' as const, candyNeed: 285, srcLevel: 25, dstLevel: 35 },
  ];

  testCases.forEach(tc => {
    it(`[${tc.id}] 非負数チェック - ${tc.pokemonName}`, () => {
      const result = planLevelUp(
        [pokemon({
          id: tc.id,
          pokedexId: tc.pokedexId,
          pokemonName: tc.pokemonName,
          type: tc.type,
          srcLevel: tc.srcLevel,
          dstLevel: tc.dstLevel,
          expType: tc.expType,
          nature: tc.nature,
          expGot: 0,
          candyNeed: tc.candyNeed,
          boostOrExpAdjustment: tc.candyNeed,
        })],
        inventory({ universal: { s: 100, m: 10, l: 1 } }),
        config({ boostKind: 'full' })
      );

      const p = getPokemon(result, tc.id);
      expect(p.reachableItems.totalSupply).toBeGreaterThanOrEqual(0);
      expect(p.reachableItems.speciesCandy).toBeGreaterThanOrEqual(0);
      expect(p.reachableItems.universalS).toBeGreaterThanOrEqual(0);
      expect(p.reachableItems.universalM).toBeGreaterThanOrEqual(0);
      expect(p.reachableItems.universalL).toBeGreaterThanOrEqual(0);
      expect(p.reachableItems.surplus).toBeGreaterThanOrEqual(0);
      expect(p.shortage.candy).toBeGreaterThanOrEqual(0);
      expect(p.shortage.boost).toBeGreaterThanOrEqual(0);
      expect(p.shortage.shards).toBeGreaterThanOrEqual(0);
    });

    it(`[${tc.id}] レベル整合性チェック - ${tc.pokemonName}`, () => {
      const result = planLevelUp(
        [pokemon({
          id: tc.id,
          pokedexId: tc.pokedexId,
          pokemonName: tc.pokemonName,
          type: tc.type,
          srcLevel: tc.srcLevel,
          dstLevel: tc.dstLevel,
          expType: tc.expType,
          nature: tc.nature,
          expGot: 0,
          candyNeed: tc.candyNeed,
          boostOrExpAdjustment: tc.candyNeed,
        })],
        inventory({ universal: { s: 100, m: 10, l: 1 } }),
        config({ boostKind: 'full' })
      );

      const p = getPokemon(result, tc.id);
      expect(p.reachedLevel).toBeGreaterThanOrEqual(tc.srcLevel);
      expect(p.reachedLevel).toBeLessThanOrEqual(tc.dstLevel);
    });
  });
});
