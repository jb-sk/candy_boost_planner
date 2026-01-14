/**
 * 個数指定テスト（Test 6, 15）
 *
 * candyTarget（アメ使用上限）が設定されている到達可能行のテスト
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../core';
import { pokemon, inventory, config, getPokemon } from './helpers';

describe('個数指定テスト', () => {
  // ========================================
  // テスト6: 個数指定のみ
  // ========================================
  // 使用ポケモン: ダークライ
  // Lv: 10→30
  // candyNeed: 500, boostCandyLimit: 500
  // candyTarget: 100（アメ個数指定: 100まで）
  //
  // 条件:
  //   グローバルアメブ上限: 無制限
  //   かけら上限: 無制限
  //   在庫: 種族200 + タイプM 10個(250) + 万能S 500(1500) + M 50(1000) + L 5(500) = 十分
  //
  // 期待:
  //   totalCandyCount: ≤ 100（個数指定以下）
  describe('Test6: 個数指定のみ - 指定量まで使用', () => {
    it('使用量 ≤ 個数指定 100', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test6',
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
          candyTarget: 100,
        })],
        inventory({
          species: { '491': 200 },
          typeCandy: { dark: { s: 0, m: 10 } },
          universal: { s: 500, m: 50, l: 5 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test6');
      // 種族アメ200 + タイプM 10個(250) = 450で、個数指定100を超える
      // 個数指定は万能アメだけでなく、アメの総数上限
      expect(p.reachableItems.totalCandyCount).toBeLessThanOrEqual(100);
    });
  });

  // ========================================
  // テスト15: アメ個数指定500
  // ========================================
  // 使用ポケモン: ダークライ
  // Lv: 10→60
  // candyNeed: 2084（Lv60に必要なアメブ量、100%アメブ）
  // boostCandyLimit: 2084
  // candyTarget: 500
  //
  // 条件:
  //   グローバルアメブ上限: 2000
  //   かけら上限: 200万
  //   在庫: 種族500 + タイプM 1個(25) + 万能S 520(1560) = 十分
  //
  // 期待:
  //   totalCandyCount: ≤ 500（個数指定以下）
  //   boostCount: ≤ 500（個数指定以下）
  describe('Test15: アメ個数指定500', () => {
    it('アメ合計 ≤ 個数指定500、アメブ ≤ 個数指定500', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test15',
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
          candyTarget: 500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 520, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 2000, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test15');
      expect(p.reachableItems.totalCandyCount).toBeLessThanOrEqual(500);
      expect(p.reachableItems.boostCount).toBeLessThanOrEqual(500);
    });
  });
});
