/**
 * 目標まで行テスト（Test 42-45）
 *
 * 理論値計算・目標到達計算のテスト
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 *
 * 注意: expGot=0に統一
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../core';
import { pokemon, inventory, config, getPokemon } from './helpers';

describe('目標まで行テスト', () => {
  // ========================================
  // テスト42: 基本的な目標まで計算（在庫無限、補填あり）
  // ========================================
  // シナリオ:
  // - スイクン Lv50 → Lv60
  // - アメ在庫: 100（種族）+ みずS 5個（価値20）+ 万能S 100個（価値300）= 420価値
  // - 必要アメ: 922
  // - 不足分: 502 → 万能S 168個で補填（3×168=504、余り2）
  //
  // 期待:
  // - 補填後は remaining = 0
  // - 補填前の不足を保持（originalRemaining > 0）
  // - totalUsed = candyNeed
  // - 種族アメ100を使用
  // - みずS 5個を使用
  // - 万能S: 在庫100 + 補填分
  describe('Test42: 基本的な目標まで計算', () => {
    it('補填後はremaining=0、在庫を超えて配分', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 50,
          dstLevel: 60,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 922,
          boostOrExpAdjustment: 922,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 100, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 3000000 })
      );

      const p = getPokemon(result, 'suicune');

      // targetItems（目標まで行）は補填を含む
      expect(p.targetBoost).toBe(922);

      // totalCandyCount = candyNeed（理論値）
      expect(p.targetItems.totalCandyCount).toBe(922);

      // totalSupply = candyNeed + 余り（余り2以内）
      expect(p.targetItems.totalSupply).toBeGreaterThanOrEqual(922);
      expect(p.targetItems.totalSupply).toBeLessThanOrEqual(924);

      // 種族アメ100を使用
      expect(p.targetItems.speciesCandy).toBe(100);

      // みずS 5個を使用
      expect(p.targetItems.typeS).toBe(5);

      // 万能S: 在庫100 + 補填分
      expect(p.targetItems.universalS).toBeGreaterThan(100);
    });
  });

  // ========================================
  // テスト43: 個数指定あり（limitXXX フィールド）
  // ========================================
  // シナリオ:
  // - スイクン Lv50 → Lv60
  // - 目標まで必要アメ: 922
  // - 個数指定: 500
  // - limitXXX フィールドは 500 ベースで計算されるべき
  //
  // 期待:
  // - limitTotalUsed = 個数指定 = 500
  // - limitBoostCandyUsed = 500（100%アメブなので）
  // - 個数指定が保持されている
  describe('Test43: 個数指定あり', () => {
    it('limitTotalUsed=個数指定', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 50,
          dstLevel: 60,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 922,
          boostOrExpAdjustment: 922,
          candyTarget: 500,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 300, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 3000000 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.candyTarget).toBe(500);
      expect(p.candyTargetBoost).toBe(500); // 100%アメブなので
      expect(p.candyTargetNormal).toBe(0);

      // 期待されるアイテム配分:
      // 優先順位: 種族アメ → タイプS → 万能S
      // 種族アメ: 100（価値100）
      // タイプS: 5（価値20）
      // 万能S: (500 - 100 - 20) / 3 = 126.67 → 127個（価値381、余り1）
      expect(p.candyTargetItems!.speciesCandy).toBe(100);
      expect(p.candyTargetItems!.typeS).toBe(5);
      expect(p.candyTargetItems!.universalS).toBe(127);
      expect(p.candyTargetItems!.totalSupply).toBe(501); // 100 + 20 + 381 = 501（余り1込み）
      expect(p.candyTargetItems!.surplus).toBeLessThanOrEqual(2);
    });
  });

  // ========================================
  // テスト44: グローバルアメブ不足の検出
  // ========================================
  // シナリオ:
  // - 複数ポケモンでグローバルアメブを消費
  // - 後のポケモンがアメブ不足になる
  // - 1匹目: candyNeed=200、グローバルアメブ250を使用
  // - 2匹目: candyNeed=200、グローバルアメブ残り50
  //
  // 期待:
  // - 1匹目はアメブ不足なし
  // - 2匹目はアメブ不足 = 200 - 50 = 150
  // - 2匹目の配分時点のアメブ残数 = 50
  describe('Test44: グローバルアメブ不足の検出', () => {
    it('2匹目はアメブ不足=150', () => {
      const result = planLevelUp(
        [
          pokemon({
            id: 'poke1',
            pokedexId: 25,
            pokemonName: 'ピカチュウ',
            type: 'electric',
            srcLevel: 10,
            dstLevel: 30,
            expType: 600,
            nature: 'normal',
            expGot: 0,
            candyNeed: 200,
            boostOrExpAdjustment: 200,
          }),
          pokemon({
            id: 'poke2',
            pokedexId: 26,
            pokemonName: 'ライチュウ',
            type: 'electric',
            srcLevel: 10,
            dstLevel: 30,
            expType: 600,
            nature: 'normal',
            expGot: 0,
            candyNeed: 200,
            boostOrExpAdjustment: 200,
          }),
        ],
        inventory({
          species: {},
          typeCandy: {},
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 250, globalShardsLimit: 3000000 })
      );

      const poke1 = getPokemon(result, 'poke1');
      const poke2 = getPokemon(result, 'poke2');

      expect(poke1.shortage.boost).toBe(0);
      expect(poke2.shortage.boost).toBe(150);
    });
  });

  // ========================================
  // テスト45: かけら不足の検出
  // ========================================
  // シナリオ:
  // - 目標まで 500 アメ
  // - かけら上限: 500,000
  // - 目標かけら > かけら上限 → かけら不足
  //
  // 期待:
  // - shardsShortage > 0
  // - limitingFactor = 'shards'
  // - 配分時点のかけら残数 = 500,000
  describe('Test45: かけら不足の検出', () => {
    it('かけら不足が正しく計算される', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 50,
          dstLevel: 56,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 500,
          boostOrExpAdjustment: 500,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 200, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 500000 })
      );

      const p = getPokemon(result, 'suicune');

      // かけら不足 > 0
      expect(p.shortage.shards).toBeGreaterThan(0);

      // かけらが主要な制限要因
      expect(p.diagnosis.limitingFactor).toBe('shards');

      // 配分時点のかけら残数 = 500,000
      expect(p.resourceSnapshot.availableShards).toBe(500000);
    });
  });
});
