/**
 * 不足タイプ判定テスト（Test 37-41）
 *
 * primaryShortageType / limitingFactor の正確な判定テスト
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 *
 * 注意: expGot=0に統一（Test41のみexpGot=1008）
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../../../src/domain/level-planner/core';
import { pokemon, inventory, config, getPokemon } from './helpers';

describe('不足タイプ判定テスト', () => {
  // ========================================
  // テスト37: かけら不足が主要因
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - スイクン Lv50 → 目標Lv60
  // - あとEXP: 2451
  // - アメ在庫: 100
  // - アメブ100%（個数922）
  // - かけら上限: 0（かけら使用不可）
  // - みずS: 5個、万能S: 268個
  //
  // 状況:
  // - 目標までに アメブ922、かけら1,992,925 が必要
  // - しかしかけら上限0なのでレベルアップ不可
  // - 到達可能行: Lv50のまま
  //
  // 期待:
  // - primaryShortageType = "shards"（かけら不足）と表示
  // - かけらが0なのでレベルが上がらないのが主要因
  describe('Test37: かけら不足が主要因', () => {
    it('かけら0でLvアップ不可、primaryShortageType=shards', () => {
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
          universal: { s: 268, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 0 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachedLevel).toBe(50);
      expect(p.diagnosis.limitingFactor).toBe('shards');
    });
  });

  // ========================================
  // テスト38: アメブ上限0が主要因
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - スイクン Lv50 → 目標Lv60
  // - あとEXP: 2451
  // - アメ在庫: 100
  // - アメブ100%（個数922）
  // - アメブ上限: 0（グローバルアメブ0）
  // - かけら上限: 4,000,000（十分）
  // - みずS: 5個、万能S: 268個
  //
  // 状況:
  // - 目標までに アメブ922、かけら1,992,925 が必要
  // - しかしアメブ上限0なのでレベルアップ不可
  // - 到達可能行: Lv50のまま
  //
  // 期待:
  // - primaryShortageType = "boost"（アメブ不足）と表示
  describe('Test38: アメブ上限0が主要因', () => {
    it('アメブ0でLvアップ不可、primaryShortageType=boost', () => {
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
          universal: { s: 268, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 0, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachedLevel).toBe(50);
      expect(p.diagnosis.limitingFactor).toBe('boost');
    });
  });

  // ========================================
  // テスト39: 個数指定＆アメブ上限0
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - スイクン Lv50 → 目標Lv60
  // - あとEXP: 2451
  // - アメ在庫: 100
  // - アメブ100%（個数922）
  // - 個数指定: 500
  // - アメブ上限: 0（グローバルアメブ0）
  // - かけら上限: 4,000,000（十分）
  // - みずS: 5個、万能S: 268個
  //
  // 状況:
  // - 目標までに アメブ922、かけら1,992,925 が必要
  // - 個数指定500の場合、アメブ理論値500、かけら892,720が必要
  // - しかしアメブ上限0なのでレベルアップ不可
  // - 到達可能行: Lv50のまま、アメブ不足500
  //
  // 期待:
  // - primaryShortageType = "boost"（アメブ不足）と表示
  describe('Test39: 個数指定＆アメブ上限0', () => {
    it('個数指定があってもアメブ0が主要因', () => {
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
          universal: { s: 268, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 0, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachedLevel).toBe(50);
      expect(p.diagnosis.limitingFactor).toBe('boost');
      expect(p.shortage.boost).toBe(500);
    });
  });

  // ========================================
  // テスト40: 個数指定＆かけら上限0
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - スイクン Lv50 → 目標Lv60
  // - あとEXP: 2451
  // - アメ在庫: 100
  // - アメブ100%（個数922）
  // - 個数指定: 500
  // - アメブ上限: 3,500（十分）
  // - かけら上限: 0（かけら使用不可）
  // - みずS: 5個、万能S: 268個
  //
  // 状況:
  // - 目標までに アメブ922、かけら1,992,925 が必要
  // - 個数指定500の場合、アメブ500、かけら892,720が必要
  // - しかしかけら上限0なのでレベルアップ不可
  // - 到達可能行: Lv50のまま、かけら不足892,720
  //
  // 期待:
  // - primaryShortageType = "shards"（かけら不足）と表示
  describe('Test40: 個数指定＆かけら上限0', () => {
    it('個数指定があってもかけら0が主要因', () => {
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
          universal: { s: 268, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 0 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachedLevel).toBe(50);
      expect(p.diagnosis.limitingFactor).toBe('shards');
      expect(p.shortage.shards).toBe(892720);
    });
  });

  // ========================================
  // テスト41: shardsShortage計算バグ
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - スイクン Lv50 → 目標Lv56
  // - アメブ個数: 500 → Lv55到達後、余りEXPがexpGotとして蓄積
  // - expGot = 1008（Lv56あとEXP 4300→3292 の差分）
  // - かけら上限: 0（かけら使用不可）
  //
  // スクリーンショットの値:
  // - 目標まで: かけら 892,720
  // - 到達可能: かけら不足 840,280（← 目標までと不一致！これがバグ）
  //
  // 修正後の期待:
  // - shardsShortage = 目標までのかけら と一致（892,720）
  describe('Test41: shardsShortage計算バグ', () => {
    it('expGot増加時もshardsShortageが正しく計算される', () => {
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
          expGot: 1008,  // このテストのみ expGot を使用
          candyNeed: 500,
          boostOrExpAdjustment: 500,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 127, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 0 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachedLevel).toBe(50);
      expect(p.diagnosis.limitingFactor).toBe('shards');
      // 目標までのかけらと不足が一致
      expect(p.shortage.shards).toBe(p.targetShards);
    });
  });
});
