/**
 * 複数ポケモンテスト（Test 7-9）
 * 複合制限テスト（Test 10）
 *
 * 複数ポケモン間でのリソース分配テスト
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../../../src/domain/level-planner/core';
import { pokemon, inventory, config, getPokemon } from './helpers';

describe('複数ポケモンテスト', () => {
  // ========================================
  // テスト7: 2匹でアメブを分け合う
  // ========================================
  // ポケモン1: ダークライ（Lv10→50, candyNeed=1500）
  // ポケモン2: イワパレス（Lv20→40, candyNeed=1000）
  //
  // 条件:
  //   グローバルアメブ上限: 2000（合計2500必要に対して不足）
  //   かけら上限: 無制限
  //   在庫: 種族(491)1000 + 種族(558)500 + タイプM各10(500) + 万能S 500(1500)+M 50(1000)+L 5(500)
  //
  // 期待:
  //   合計boostCount: ≤ 2000
  //   ポケモン1 normalCount: 0（アメブ100%）
  //   ポケモン2 normalCount: 0（アメブ100%）
  describe('Test7: 2匹でアメブを分け合う', () => {
    it('上位が優先、合計がグローバル上限以下', () => {
      const result = planLevelUp(
        [
          pokemon({
            id: 'pokemon1',
            pokedexId: 491,
            pokemonName: 'ダークライ',
            type: 'dark',
            srcLevel: 10,
            dstLevel: 50,
            expType: 1320,
            nature: 'normal',
            expGot: 0,
            candyNeed: 1500,
            boostOrExpAdjustment: 1500,
          }),
          pokemon({
            id: 'pokemon2',
            pokedexId: 558,
            pokemonName: 'イワパレス',
            type: 'rock',
            srcLevel: 20,
            dstLevel: 40,
            expType: 600,
            nature: 'normal',
            expGot: 0,
            candyNeed: 1000,
            boostOrExpAdjustment: 1000,
          }),
        ],
        inventory({
          species: { '491': 1000, '558': 500 },
          typeCandy: { dark: { s: 0, m: 10 }, rock: { s: 0, m: 10 } },
          universal: { s: 500, m: 50, l: 5 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 2000, globalShardsLimit: Infinity })
      );

      const poke1 = getPokemon(result, 'pokemon1');
      const poke2 = getPokemon(result, 'pokemon2');

      expect(poke1.reachableItems.boostCount + poke2.reachableItems.boostCount).toBeLessThanOrEqual(2000);
      expect(poke1.reachableItems.normalCount).toBe(0);
      expect(poke2.reachableItems.normalCount).toBe(0);
    });
  });

  // ========================================
  // テスト8: 2匹でかけらを分け合う
  // ========================================
  // ポケモン1: ダークライ（Lv10→30, candyNeed=500）
  // ポケモン2: イワパレス（Lv10→30, candyNeed=500）
  //
  // 条件:
  //   グローバルアメブ上限: 無制限
  //   かけら上限: 500,000（2匹分は足りない）
  //   在庫: 種族(491)500 + 種族(558)500 + 万能S 500+M 50+L 5
  //
  // 期待:
  //   合計shardsCount: ≤ 500,000
  describe('Test8: 2匹でかけらを分け合う', () => {
    it('上位が優先、合計がグローバル上限以下', () => {
      const result = planLevelUp(
        [
          pokemon({
            id: 'pokemon1',
            pokedexId: 491,
            pokemonName: 'ダークライ',
            type: 'dark',
            srcLevel: 10,
            dstLevel: 30,
            expType: 1320,
            nature: 'normal',
            expGot: 0,
            candyNeed: 500,
            boostOrExpAdjustment: 500,
          }),
          pokemon({
            id: 'pokemon2',
            pokedexId: 558,
            pokemonName: 'イワパレス',
            type: 'rock',
            srcLevel: 10,
            dstLevel: 30,
            expType: 600,
            nature: 'normal',
            expGot: 0,
            candyNeed: 500,
            boostOrExpAdjustment: 500,
          }),
        ],
        inventory({
          species: { '491': 500, '558': 500 },
          typeCandy: {},
          universal: { s: 500, m: 50, l: 5 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: 500000 })
      );

      const p8a = getPokemon(result, 'pokemon1');
      const p8b = getPokemon(result, 'pokemon2');

      expect(p8a.reachableItems.shardsCount + p8b.reachableItems.shardsCount).toBeLessThanOrEqual(500000);
    });
  });

  // ========================================
  // テスト9: 上位に個数指定 → 下位にアイテムが回る
  // ========================================
  // ポケモン1: ダークライ（個数指定50）
  // ポケモン2: イワパレス（個数指定なし）
  //
  // 条件:
  //   在庫: 万能S 200(600) + M 10(200) + L 1(100) = 900価値（万能のみ）
  //
  // 期待:
  //   ポケモン1 totalSupply: ≤ 50
  //   ポケモン2 totalSupply: > 0（アイテムが回ってきた）
  describe('Test9: 上位に個数指定 → 下位にアイテムが回る', () => {
    it('上位の個数指定で制限された分が下位に回る', () => {
      const result = planLevelUp(
        [
          pokemon({
            id: 'pokemon1',
            pokedexId: 491,
            pokemonName: 'ダークライ',
            type: 'dark',
            srcLevel: 10,
            dstLevel: 30,
            expType: 1320,
            nature: 'normal',
            expGot: 0,
            candyNeed: 500,
            boostOrExpAdjustment: 500,
            candyTarget: 50,
          }),
          pokemon({
            id: 'pokemon2',
            pokedexId: 558,
            pokemonName: 'イワパレス',
            type: 'rock',
            srcLevel: 10,
            dstLevel: 30,
            expType: 600,
            nature: 'normal',
            expGot: 0,
            candyNeed: 500,
            boostOrExpAdjustment: 500,
          }),
        ],
        inventory({
          species: {},
          typeCandy: {},
          universal: { s: 200, m: 10, l: 1 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: Infinity })
      );

      const p9a = getPokemon(result, 'pokemon1');
      const p9b = getPokemon(result, 'pokemon2');

      // totalCandyCount = アメ合計
      expect(p9a.reachableItems.totalCandyCount).toBeLessThanOrEqual(50);
      expect(p9b.reachableItems.totalCandyCount).toBeGreaterThan(0);
    });
  });
});

describe('複合制限テスト', () => {
  // ========================================
  // テスト10: アメブ不足 + かけら不足
  // ========================================
  // 使用ポケモン: ダークライ（Lv10→60, candyNeed=2739）
  //
  // 条件:
  //   グローバルアメブ上限: 2000
  //   かけら上限: 1,000,000
  //   在庫: 種族5000 + タイプM 100(2500) + 万能S 5000(15000)+M 500(10000)+L 50(5000) = 十分
  //
  // 期待:
  //   boostCount: ≤ 2000
  //   shardsCount: ≤ 1,000,000
  //   normalCount: 0
  //   少なくとも一方の制限に近い
  describe('Test10: アメブ不足 + かけら不足', () => {
    it('両方の制限を守り、少なくとも一方が制限に近い', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test10',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 10,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2739,
          boostOrExpAdjustment: 2739,
        })],
        inventory({
          species: { '491': 5000 },
          typeCandy: { dark: { s: 0, m: 100 } },
          universal: { s: 5000, m: 500, l: 50 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 2000, globalShardsLimit: 1000000 })
      );

      const p = getPokemon(result, 'test10');
      expect(p.reachableItems.boostCount).toBeLessThanOrEqual(2000);
      expect(p.reachableItems.shardsCount).toBeLessThanOrEqual(1000000);
      expect(p.reachableItems.normalCount).toBe(0);

      // どちらかの制限に達しているはず（在庫は十分なので）
      const isBoostNearLimit = p.reachableItems.boostCount >= 1900;
      const isShardsNearLimit = p.reachableItems.shardsCount >= 900000;
      expect(isBoostNearLimit || isShardsNearLimit).toBe(true);
    });
  });
});
