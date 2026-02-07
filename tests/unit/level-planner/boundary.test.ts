/**
 * スイクン＆境界値テスト（Test 30-36）
 *
 * EXP下降補正ポケモンでのアメブ不足計算、境界値テスト
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 *
 * 注意: expGot=0に統一（旧テストのexpGotは誤り）
 * 注意: Test34の期待値は修正後のもの（目標まで行のかけら661935、かけら不足651935）
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../../../src/domain/level-planner/core';
import { pokemon, inventory, config, getPokemon } from './helpers';

describe('スイクン＆境界値テスト', () => {
  // ========================================
  // テスト30: スイクン（EXP下降補正）＆個数指定＆アメブ不足
  // ========================================
  // シナリオ:
  // - バンギラス（上位）: 個数指定100、アメブ上限100
  // - スイクン（下位）: 現在Lv 50 → 目標Lv 65、EXP下降補正
  // - スイクン個数指定: 501
  // - グローバルアメブ: 600 → バンギラス100使用後、残り500
  //
  // 期待:
  // - スイクンのアメブ不足 = 501 - 500 = 1
  describe('Test30: スイクン・個数指定501', () => {
    it('アメブ不足=1（501-500）', () => {
      const result = planLevelUp(
        [
          pokemon({
            id: 'bangiras',
            pokedexId: 248,
            pokemonName: 'バンギラス',
            type: 'dark',
            srcLevel: 15,
            dstLevel: 50,
            expType: 900,
            nature: 'normal',
            expGot: 0,
            candyNeed: 733,
            boostOrExpAdjustment: 733,
            candyTarget: 100,
          }),
          pokemon({
            id: 'suicune',
            pokedexId: 245,
            pokemonName: 'スイクン',
            type: 'water',
            srcLevel: 50,
            dstLevel: 65,
            expType: 1080,
            nature: 'down',
            expGot: 0,
            candyNeed: 1559,
            boostOrExpAdjustment: 1559,
            candyTarget: 501,
          }),
        ],
        inventory({
          species: { '248': 0, '245': 100 },
          typeCandy: { dark: { s: 0, m: 1 }, water: { s: 5, m: 0 } },
          universal: { s: 225, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 600, globalShardsLimit: 1500000 })
      );

      const suicune = getPokemon(result, 'suicune');
      expect(suicune.shortage.boost).toBe(1);
      expect(suicune.diagnosis.limitingFactor).toBe('boost');
      expect(suicune.shortage.shards).toBe(0);
    });
  });

  // ========================================
  // テスト31: スイクン・個数指定500（アメブ残数と一致）
  // ========================================
  // シナリオ:
  // - スイクン: 個数指定500 = アメブ残数
  // - グローバルアメブ: 600 - 100 = 500
  //
  // 期待:
  // - アメブ不足なし（500 - 500 = 0）
  // - かけら不足なし（かけらは十分ある）
  describe('Test31: スイクン・個数指定500', () => {
    it('アメブ不足=0', () => {
      const result = planLevelUp(
        [
          pokemon({
            id: 'bangiras',
            pokedexId: 248,
            pokemonName: 'バンギラス',
            type: 'dark',
            srcLevel: 15,
            dstLevel: 50,
            expType: 900,
            nature: 'normal',
            expGot: 0,
            candyNeed: 733,
            boostOrExpAdjustment: 733,
            candyTarget: 100,
          }),
          pokemon({
            id: 'suicune',
            pokedexId: 245,
            pokemonName: 'スイクン',
            type: 'water',
            srcLevel: 50,
            dstLevel: 65,
            expType: 1080,
            nature: 'down',
            expGot: 0,
            candyNeed: 1559,
            boostOrExpAdjustment: 1559,
            candyTarget: 500,
          }),
        ],
        inventory({
          species: { '248': 0, '245': 100 },
          typeCandy: { dark: { s: 0, m: 1 }, water: { s: 5, m: 0 } },
          universal: { s: 225, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 600, globalShardsLimit: 1500000 })
      );

      const suicune = getPokemon(result, 'suicune');
      expect(suicune.shortage.boost).toBe(0);
      expect(suicune.shortage.shards).toBe(0);
    });
  });

  // ========================================
  // テスト32: スイクン・個数指定502
  // ========================================
  // シナリオ:
  // - スイクン: 個数指定502 > アメブ残数500
  //
  // 期待:
  // - アメブ不足 = 502 - 500 = 2
  // - primaryShortageType = boost
  // - かけら不足なし（かけらは十分ある）
  describe('Test32: スイクン・個数指定502', () => {
    it('アメブ不足=2（502-500）', () => {
      const result = planLevelUp(
        [
          pokemon({
            id: 'bangiras',
            pokedexId: 248,
            pokemonName: 'バンギラス',
            type: 'dark',
            srcLevel: 15,
            dstLevel: 50,
            expType: 900,
            nature: 'normal',
            expGot: 0,
            candyNeed: 733,
            boostOrExpAdjustment: 733,
            candyTarget: 100,
          }),
          pokemon({
            id: 'suicune',
            pokedexId: 245,
            pokemonName: 'スイクン',
            type: 'water',
            srcLevel: 50,
            dstLevel: 65,
            expType: 1080,
            nature: 'down',
            expGot: 0,
            candyNeed: 1559,
            boostOrExpAdjustment: 1559,
            candyTarget: 502,
          }),
        ],
        inventory({
          species: { '248': 0, '245': 100 },
          typeCandy: { dark: { s: 0, m: 1 }, water: { s: 5, m: 0 } },
          universal: { s: 225, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 600, globalShardsLimit: 1500000 })
      );

      const suicune = getPokemon(result, 'suicune');
      expect(suicune.shortage.boost).toBe(2);
      expect(suicune.diagnosis.limitingFactor).toBe('boost');
      expect(suicune.shortage.shards).toBe(0);
    });
  });

  // ========================================
  // テスト33: スイクン・個数指定なし・アメブ不足
  // ========================================
  // シナリオ:
  // - スイクン: 現在Lv 50 → 目標Lv 65、EXP下降補正
  // - アメブ割合: 100%（boostCandyLimit = 1559）
  // - 個数指定: なし
  // - グローバルアメブ: 500（不足！）
  // - アメ在庫: 十分
  //
  // 期待:
  // - boostShortage = 1559 - 500 = 1059
  // - remaining = 0（アメ在庫は足りている）
  // - アメブが赤字、アメ合計は黒字
  describe('Test33: スイクン・個数指定なし・アメブ不足', () => {
    it('アメブ不足=1059、アメ不足=0', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 50,
          dstLevel: 65,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 1559,
          boostOrExpAdjustment: 1559,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 500, m: 90, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 500, globalShardsLimit: 5000000 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.shortage.boost).toBe(1059);
      expect(p.shortage.candy).toBe(0);
      expect(p.diagnosis.limitingFactor).toBe('boost');
    });
  });

  // ========================================
  // テスト34: アメブ不足＆アメ不足＆かけら不足（使用アイテムが多すぎるバグ）
  // ========================================
  // シナリオ（ピカチュウ）:
  // - 現在Lv 30 → 目標Lv 55
  // - アメブ割合: 100%（boostCandyLimit = 537）
  // - アメ在庫: 0（種族アメなし）
  // - グローバルアメブ: 175（不足）
  // - かけら上限: 10,000（不足: 目標までのかけら661,935）
  //
  // 期待:
  // - アメブ不足 + アメ不足 + かけら不足 → 全て赤字
  // - 使用アイテムがかけら制限後のアメ合計と一致
  // - アイテム価値 = totalSupply + surplus
  describe('Test34: 全不足時', () => {
    it('目標まで行：アメブ537、かけら661,935', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'pikachu',
          pokedexId: 25,
          pokemonName: 'ピカチュウ',
          type: 'electric',
          srcLevel: 30,
          dstLevel: 55,
          expType: 600,
          nature: 'normal',
          expGot: 0,
          candyNeed: 537,
          boostOrExpAdjustment: 537,
        })],
        inventory({
          species: { '25': 0 },
          typeCandy: { electric: { s: 0, m: 1 } },
          universal: { s: 651, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 175, globalShardsLimit: 10000 })
      );

      const p = getPokemon(result, 'pikachu');
      expect(p.targetBoost).toBe(537);
      expect(p.targetShards).toBe(661935);
    });

    it('到達可能行：アメブ16、かけら9,780、万能S 6', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'pikachu',
          pokedexId: 25,
          pokemonName: 'ピカチュウ',
          type: 'electric',
          srcLevel: 30,
          dstLevel: 55,
          expType: 600,
          nature: 'normal',
          expGot: 0,
          candyNeed: 537,
          boostOrExpAdjustment: 537,
        })],
        inventory({
          species: { '25': 0 },
          typeCandy: { electric: { s: 0, m: 1 } },
          universal: { s: 651, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 175, globalShardsLimit: 10000 })
      );

      const p = getPokemon(result, 'pikachu');
      expect(p.reachableItems.boostCount).toBe(16);
      expect(p.reachableItems.shardsCount).toBe(9780);
      expect(p.reachableItems.universalS).toBe(6);
    });

    it('アイテム価値=totalSupply', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'pikachu',
          pokedexId: 25,
          pokemonName: 'ピカチュウ',
          type: 'electric',
          srcLevel: 30,
          dstLevel: 55,
          expType: 600,
          nature: 'normal',
          expGot: 0,
          candyNeed: 537,
          boostOrExpAdjustment: 537,
        })],
        inventory({
          species: { '25': 0 },
          typeCandy: { electric: { s: 0, m: 1 } },
          universal: { s: 651, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 175, globalShardsLimit: 10000 })
      );

      const p = getPokemon(result, 'pikachu');
      const itemValue =
        p.reachableItems.speciesCandy +
        p.reachableItems.typeS * 4 +
        p.reachableItems.typeM * 25 +
        p.reachableItems.universalS * 3 +
        p.reachableItems.universalM * 20 +
        p.reachableItems.universalL * 100;
      // アイテム価値 = totalSupply（totalSupply は既に surplus 込み）
      expect(itemValue).toBe(p.reachableItems.totalSupply);
    });
  });

  // ========================================
  // テスト35a/35b: かけら境界値テスト
  // ========================================
  // シナリオ:
  // - スイクン Lv50 → Lv65
  // - あとEXP: 2451
  // - アメブ目標Lv: 65（100%アメブ）
  // - アメ在庫: 100
  // かけら上限 91,154 → アメ58個使用
  // かけら上限 91,155 → アメ59個使用
  describe('Test35a: かけら境界値91,154', () => {
    it('かけら上限ぎりぎりでアメ使用', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 50,
          dstLevel: 65,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 1559,
          boostOrExpAdjustment: 1559,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: 91154 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachableItems.totalSupply).toBe(58);
      expect(p.reachableItems.boostCount).toBe(58);
      expect(p.reachableItems.shardsCount).toBe(89610);
      expect(p.reachedLevel).toBe(50);
    });
  });

  // Test 35b: かけら上限 91,155 → 同様にアメ57個使用
  describe('Test35b: かけら境界値91,155', () => {
    it('かけら+1でアメ使用増加', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 50,
          dstLevel: 65,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 1559,
          boostOrExpAdjustment: 1559,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: 91155 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachableItems.totalSupply).toBe(59);
      expect(p.reachableItems.boostCount).toBe(59);
      expect(p.reachableItems.shardsCount).toBe(91155);
      expect(p.reachedLevel).toBe(51);
      expect(p.shortage.shards).toBeGreaterThan(0);
    });
  });

  // ========================================
  // テスト36: 万能S 1個不足バグ
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - スイクン Lv50 → Lv65
  // - あとEXP: 2451
  // - アメ在庫: 100
  // - アメの個数指定: 1000
  // - アメブ100%
  // - みずS: 5個
  // - 万能S: 300個
  // 期待値:
  // - 種族アメ 100個（価値100）
  // - みずS 5個（価値20）
  // - 万能S 294個（価値882）→ 合計1002価値 → 1000使用（余り2）
  // 問題（バグ）:
  // - 万能S 293個しか使われず、合計999価値で1個足りない
  describe('Test36: 万能S 1個不足バグ', () => {
    it('totalUsed=1000、万能S=294', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 50,
          dstLevel: 65,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 1559,
          boostOrExpAdjustment: 1559,
          candyTarget: 1000,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 300, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 3000000 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachableItems.totalSupply).toBe(1002);
      expect(p.reachableItems.speciesCandy).toBe(100);
      expect(p.reachableItems.typeS).toBe(5);
      expect(p.reachableItems.universalS).toBe(294);
    });
  });
});
