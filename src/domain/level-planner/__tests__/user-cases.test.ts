/**
 * ユーザーケーステスト（Test 11-13）
 *
 * ユーザースクリーンショットの再現テスト
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 *
 * 注意: expGot=0に統一（旧テストのexpGotは誤り）
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../core';
import { pokemon, inventory, config, getPokemon } from './helpers';

describe('ユーザーケーステスト', () => {
  // ========================================
  // テスト11: ダークライ Lv10→60
  // ========================================
  // ユーザーの設定:
  // - アメ在庫: 500
  // - タイプM: 1
  // - 万能S: 500, 万能M: 100, 万能L: 1
  // - アメブ上限: 2000
  // - かけら上限: 200万
  //
  // 期待:
  //   boostCount: ≤ 2000
  //   shardsCount: ≤ 2,000,000
  //   normalCount: 0（アメブ100%）
  describe('Test11: ダークライ Lv10→60', () => {
    it('アメブとかけらの制限内で到達', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test11',
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
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 100, l: 1 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 2000, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test11');

      // かけら200万以下でLv57に到達するための最適なアメブ量
      // かけら制限が主要因となり、到達LvはLv56になる
      expect(p.reachableItems.boostCount).toBeLessThanOrEqual(2000);
      expect(p.reachableItems.shardsCount).toBeLessThanOrEqual(2000000);
      expect(p.reachableItems.normalCount).toBe(0);

      // 到達Lv56、あとEXP592、残EXP18203
      expect(p.reachedLevel).toBe(56);
      expect(p.expToNextLevel).toBe(592);
      expect(p.expToTarget).toBe(18203);

      // かけらが主要な制限要因
      expect(p.diagnosis.limitingFactor).toBe('shards');
    });
  });

  // ========================================
  // テスト11b: アメブ上限3000
  // ========================================
  // 条件:
  //   グローバルアメブ上限: 3000（増加）
  //   かけら上限: 200万（変更なし）
  //
  // 期待:
  //   到達Lvは11と同じ（かけら制限のため）
  describe('Test11b: アメブ上限3000', () => {
    it('アメブ上限が増えても結果は同じ（かけら制限のため）', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test11b',
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
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 100, l: 1 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3000, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test11b');
      expect(p.reachableItems.shardsCount).toBeLessThanOrEqual(2000000);
      expect(p.reachableItems.normalCount).toBe(0);

      // Test11と同じ到達Lv（かけら制限のため）
      expect(p.reachedLevel).toBe(56);
      expect(p.expToNextLevel).toBe(592);
      expect(p.expToTarget).toBe(18203);
      expect(p.diagnosis.limitingFactor).toBe('shards');
    });
  });

  // ========================================
  // テスト12: スクリーンショット完全再現（アメブ上限2000）
  // ========================================
  // スクリーンショットの設定:
  // - 現在Lv: 10
  // - 目標Lv: 60
  // - candyNeed: 2084（スクリーンショットの値）
  // - アメブ上限: 2000
  // - かけら上限: 200万
  //
  // 期待:
  //   reachedLevel: 56
  //   boostCount: 1719
  //   shardsCount: 1,998,660
  //   normalCount: 0
  describe('Test12: スクリーンショット完全再現', () => {
    it('到達Lv56、アメブ1719、かけら1998660', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test12',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 10,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2084,
          boostOrExpAdjustment: 2084,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 100, l: 1 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 2000, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test12');
      expect(p.reachedLevel).toBe(56);
      expect(p.reachableItems.boostCount).toBe(1719);
      expect(p.reachableItems.shardsCount).toBe(1998660);
      expect(p.reachableItems.normalCount).toBe(0);
    });
  });

  // ========================================
  // テスト12b: アメブ上限3000でのテスト
  // ========================================
  // 条件:
  //   グローバルアメブ上限: 3000（増加）
  //   かけら上限: 200万（変更なし）
  //
  // 期待:
  //   Test12と同じ結果（かけら制限が同じなので）
  describe('Test12b: アメブ上限3000でのテスト', () => {
    it('Test12と同じ到達Lv（かけら制限のため）', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test12b',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 10,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2084,
          boostOrExpAdjustment: 2084,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 100, l: 1 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3000, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test12b');
      // Test12と同じ結果（かけら制限が同じなので）
      expect(p.reachedLevel).toBe(56);
      expect(p.reachableItems.boostCount).toBe(1719);
      expect(p.reachableItems.shardsCount).toBe(1998660);
      expect(p.reachableItems.normalCount).toBe(0);
    });
  });

  // ========================================
  // テスト13: リリースバージョン期待値
  // ========================================
  // 設定:
  // - Lv10→60
  // - 100%アメブ
  // - アメブ上限2000
  // - かけら上限200万
  //
  // 期待値:
  // - アメブ1719
  // - かけら1,998,660
  // - 到達Lv56
  // - あとEXP592
  describe('Test13: リリースバージョン期待値', () => {
    it('到達Lv56、アメブ1719、あとEXP592', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test13',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 10,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2084,
          boostOrExpAdjustment: 2084,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 100, l: 1 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 2000, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test13');
      expect(p.reachedLevel).toBe(56);
      expect(p.reachableItems.boostCount).toBe(1719);
      expect(p.reachableItems.shardsCount).toBe(1998660);
      expect(p.expToNextLevel).toBe(592);
      expect(p.reachableItems.normalCount).toBe(0);
    });
  });
});
