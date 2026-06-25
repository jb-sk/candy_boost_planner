/**
 * レベル70キャップテスト（Test 58+）
 *
 * v3.6.0 レベルキャップ70解放の動作検証
 * Lv65-70のEXP・かけらテーブル値が正しく反映されていることを確認
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../../../src/domain/level-planner/core';
import { pokemon, inventory, config, getPokemon, validatePokemonInvariants } from './helpers';

describe('レベル70キャップテスト', () => {
  // ========================================
  // テスト58: サーナイト Lv65→70（EXP600、通常アメ）
  // ========================================
  // ゲーム内データ検証:
  // - EXPタイプ600（一般ポケモン）
  // - 性格補正なし（normal）
  // - あとEXP 3095 = Lv65→66の全EXP → expGot=0
  // - 通常アメ632個、かけら691,983
  //
  // 各レベルの内訳:
  //   Lv65→66: ceil(3095/25)=124個 × 932 = 115,568
  //   Lv66→67: ceil(3111/25)=125個 × 1004 = 125,500
  //   Lv67→68: ceil(3130/25)=126個 × 1084 = 136,584
  //   Lv68→69: ceil(3169/25)=127個 × 1173 = 148,971
  //   Lv69→70: ceil(3249/25)=130個 × 1272 = 165,360
  //   合計: 632個、691,983かけら
  //
  // 在庫:
  //   万能S: 500, M: 100, L: 10（十分）
  //   かけら上限: 400万（十分）
  //
  // 期待:
  //   reachedLevel: 70（目標到達）
  //   normalCount: 632（全て通常アメ）
  //   shardsCount: 691,983
  //   shortage.candy: 0
  //   limitingFactor: null
  describe('Test58: サーナイト Lv65→70（EXP600）', () => {
    it('Lv70到達、通常アメ632、かけら691,983', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test58',
          pokedexId: 282,
          pokemonName: 'サーナイト',
          type: 'psychic',
          srcLevel: 65,
          dstLevel: 70,
          expType: 600,
          nature: 'normal',
          expGot: 0,
          candyNeed: 632,
          boostOrExpAdjustment: 632,
        })],
        inventory({
          universal: { s: 500, m: 100, l: 10 },
        }),
        config({ boostKind: 'none', globalBoostLimit: Infinity, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'test58');
      expect(p.reachedLevel).toBe(70);
      expect(p.reachableItems.boostCount).toBe(0);
      expect(p.reachableItems.shardsCount).toBe(691983);
      expect(p.shortage.candy).toBe(0);
      expect(p.diagnosis.limitingFactor).toBeNull();
      validatePokemonInvariants(p, { globalBoostLimit: Infinity, globalShardsLimit: 4000000, boostKind: 'none' }, 'Test58');
    });
  });

  // ========================================
  // テスト66: クレセリア Lv60→70（EXP1080、準伝説）
  // ========================================
  // ゲーム内データ検証:
  // - EXPタイプ1080（準伝説）
  // - 性格補正なし（normal）→ 25 EXP/candy
  // - あとEXP 5157 = Lv60→61の全EXP → expGot=0
  // - 通常アメ2,209個、かけら2,055,636
  // - 10レベル分のcarry累積を含む計算検証
  //
  // 在庫:
  //   種族アメ: 500、万能S: 500, M: 100, L: 10
  //   かけら上限: 400万（十分）
  //
  // 期待:
  //   reachedLevel: 70（目標到達）
  //   shardsCount: 2,055,636
  //   shortage.candy: 0
  //   limitingFactor: null
  describe('Test66: クレセリア Lv60→70（EXP1080、準伝説）', () => {
    it('Lv70到達、通常アメ2209、かけら2,055,636', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test66',
          pokedexId: 488,
          pokemonName: 'クレセリア',
          type: 'psychic',
          srcLevel: 60,
          dstLevel: 70,
          expType: 1080,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2209,
          boostOrExpAdjustment: 2209,
        })],
        inventory({
          species: { '488': 500 },
          universal: { s: 500, m: 100, l: 10 },
        }),
        config({ boostKind: 'none', globalBoostLimit: Infinity, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'test66');
      expect(p.reachedLevel).toBe(70);
      expect(p.reachableItems.boostCount).toBe(0);
      expect(p.reachableItems.shardsCount).toBe(2055636);
      expect(p.shortage.candy).toBe(0);
      expect(p.diagnosis.limitingFactor).toBeNull();
      validatePokemonInvariants(p, { globalBoostLimit: Infinity, globalShardsLimit: 4000000, boostKind: 'none' }, 'Test66');
    });
  });

  // ========================================
  // テスト67: ミュウ Lv25→70（EXP1320、幻、ミニブ350、アメ不足）
  // ========================================
  // ゲーム内データ検証:
  // - EXPタイプ1320（幻）
  // - 性格補正なし（normal）
  // - あとEXP 1368 = Lv25→26の全EXP → expGot=0
  // - ミニブ350個 + 通常アメ5,684 = 合計6,034個
  // - 目標かけら 3,757,932
  //
  // 在庫（不足シナリオ）:
  //   種族アメ: 270、万能S: 500, M: 100, L: 10
  //   → アメ換算合計4,770（= 270 + 500×3 + 100×20 + 10×100）
  //   → アメ不足 6,034 - 4,770 = 1,264
  //
  // 期待:
  //   reachedLevel: 65（アメ不足で目標未達）
  //   到達可能かけら: 2,352,992
  //   expToNextLevel: 3,638
  //   shortage.candy: 1,264
  //   limitingFactor: 'candy'
  describe('Test67: ミュウ Lv25→70（EXP1320、幻、ミニブ350、アメ不足）', () => {
    it('アメ不足でLv65到達、あとEXP3638、かけら2,352,992', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test67',
          pokedexId: 151,
          pokemonName: 'ミュウ',
          type: 'psychic',
          srcLevel: 25,
          dstLevel: 70,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 6034,
          boostOrExpAdjustment: 350,
        })],
        inventory({
          species: { '151': 270 },
          universal: { s: 500, m: 100, l: 10 },
        }),
        config({ boostKind: 'mini', globalBoostLimit: 350, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'test67');

      // 目標まで行
      expect(p.targetShards).toBe(3757932);

      // 到達可能行
      expect(p.reachedLevel).toBe(65);
      expect(p.expToNextLevel).toBe(3638);
      expect(p.reachableItems.boostCount).toBe(350);
      expect(p.reachableItems.shardsCount).toBe(2352992);
      expect(p.shortage.candy).toBe(1264);
      expect(p.diagnosis.limitingFactor).toBe('candy');

      validatePokemonInvariants(p, { globalBoostLimit: 350, globalShardsLimit: 4000000, boostKind: 'mini' }, 'Test67');
    });
  });

  // ========================================
  // テスト68: ボーマンダ Lv65→70（EXP900、600族、アメブ100%）
  // ========================================
  // ゲーム内データ検証:
  // - EXPタイプ900（600族）
  // - 性格補正なし（normal）
  // - あとEXP 4642 = Lv65→66の全EXP → expGot=0
  // - アメブ100%: 474個、通常アメ0、かけら2,594,700
  //
  // 在庫:
  //   種族アメ: 1218（十分）、万能S: 500, M: 100, L: 10
  //   アメブ上限: 3500（デフォルト）
  //   かけら上限: 400万（十分）
  //
  // 期待:
  //   reachedLevel: 70（目標到達）
  //   boostCount: 474
  //   shardsCount: 2,594,700
  //   shortage.candy: 0
  //   limitingFactor: null
  describe('Test68: ボーマンダ Lv65→70（EXP900、600族、アメブ100%）', () => {
    it('Lv70到達、アメブ474、かけら2,594,700', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test68',
          pokedexId: 373,
          pokemonName: 'ボーマンダ',
          type: 'dragon',
          srcLevel: 65,
          dstLevel: 70,
          expType: 900,
          nature: 'normal',
          expGot: 0,
          candyNeed: 474,
          boostOrExpAdjustment: 474,
        })],
        inventory({
          species: { '373': 1218 },
          universal: { s: 500, m: 100, l: 10 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'test68');
      expect(p.reachedLevel).toBe(70);
      expect(p.reachableItems.boostCount).toBe(474);
      expect(p.reachableItems.shardsCount).toBe(2594700);
      expect(p.shortage.candy).toBe(0);
      expect(p.diagnosis.limitingFactor).toBeNull();
      validatePokemonInvariants(p, { globalBoostLimit: 3500, globalShardsLimit: 4000000, boostKind: 'full' }, 'Test68');
    });
  });

  // ========================================
  // テスト59: ラグラージ Lv64→70（EXP600、性格↓、個数指定883）
  // ========================================
  // スクリーンショット再現:
  // - EXPタイプ600（一般ポケモン）
  // - 性格下降補正（down）→ 21 EXP/candy
  // - 現在Lv64、あとEXP 2761 → expGot = 3077 - 2761 = 316
  // - 目標Lv70、目標アメ884、個数指定883（1個減）
  // - アメ在庫: 1034（種族アメ）
  //
  // 目標まで行:
  //   アメ884、かけら937,884
  //
  // 到達可能行:
  //   アメ883、かけら936,612、到達Lv69、あとEXP17
  //
  // 在庫:
  //   種族アメ: 1034、万能S: 500, M: 100, L: 10（十分）
  //   かけら上限: 400万（十分）
  describe('Test59: ラグラージ Lv64→70（EXP600、性格↓、個数指定883）', () => {
    it('個数指定883でLv69到達、あとEXP17、かけら936,612', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test59',
          pokedexId: 260,
          pokemonName: 'ラグラージ',
          type: 'water',
          srcLevel: 64,
          dstLevel: 70,
          expType: 600,
          nature: 'down',
          expGot: 316,
          candyNeed: 884,
          boostOrExpAdjustment: 884,
          candyTarget: 883,
        })],
        inventory({
          species: { '260': 1034 },
          universal: { s: 500, m: 100, l: 10 },
        }),
        config({ boostKind: 'none', globalBoostLimit: Infinity, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'test59');

      // 目標まで行
      expect(p.targetShards).toBe(937884);

      // 到達可能行: 883個で Lv69、あとEXP17
      expect(p.reachedLevel).toBe(69);
      expect(p.expToNextLevel).toBe(17);
      expect(p.reachableItems.shardsCount).toBe(936612);
      expect(p.reachableItems.boostCount).toBe(0);

      validatePokemonInvariants(p, { globalBoostLimit: Infinity, globalShardsLimit: 4000000, boostKind: 'none' }, 'Test59');
    });
  });
});
