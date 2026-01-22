/**
 * エッジケーステスト（Test 46-53）
 *
 * 境界条件やバグ再現のテスト
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 *
 * 注意: expGot=0に統一
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../core';
import { pokemon, inventory, config, getPokemon } from './helpers';
import { calcExpPerCandy } from '../../pokesleep/exp';

describe('エッジケーステスト', () => {
  // ========================================
  // テスト46: 個数指定時に在庫が足りている場合（remaining=0、赤字なし）
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - ダークライ Lv30 → Lv60
  // - あとEXP: 1604
  // - アメ在庫: 500
  // - 個数指定: 1500
  // - 必要アイテム: あくM 1(25) + 万能S 325(975) + 種族アメ500 = 1500価値
  // - 万能S 在庫: 500（個体としては325で足りている）
  //
  // 問題（修正前）:
  // - 万能S 325 が赤字表示
  // - アメ不足 0 が表示
  //
  // 期待（修正後）:
  // - remaining = 0（在庫は足りている）
  // - 赤字なし（primaryShortageType = null）
  // - 「アメ不足 0」は表示されない
  describe('Test46: 個数指定時に在庫が足りている場合', () => {
    it('remaining=0、primaryShortageType=null', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'darkrai',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 30,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 1739,
          boostOrExpAdjustment: 1739,
          candyTarget: 1500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'darkrai');
      expect(p.reachableItems.totalCandyCount).toBe(1500);
      expect(p.shortage.candy).toBe(0);
      expect(p.reachableItems.speciesCandy).toBe(500);
      expect(p.reachableItems.typeM).toBe(1);
      expect(p.reachableItems.universalS).toBe(325);
      expect(p.diagnosis.limitingFactor).toBe(null);
    });
  });

  // ========================================
  // テスト47: 上位の個数指定→返却されたアメを下位が使用
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - ダークライ: 個数指定1500、目標まで1739アメ必要
  // - イワパレス: 個数指定なし、目標まで418アメ必要
  // - ミカルゲ: 個数指定なし、目標まで430アメ必要
  //
  // 在庫:
  // - 種族アメ: ダークライ500、イワパレス57、ミカルゲ197
  // - タイプアメ: あくM 1個
  // - 万能アメ: S 500, M 90, L 0
  //
  // 期待:
  // - ダークライ: 個数指定1500分のみ消費、差分がプールに戻る
  // - イワパレス: 万能S 121程度、余り 2
  // - ミカルゲ: 万能S 51, 万能M 4
  // - イワパレスとミカルゲは目標到達（不足なし）
  describe('Test47: 返却されたアメを下位が使用', () => {
    it('イワパレスとミカルゲは目標に到達', () => {
      const result = planLevelUp(
        [
          pokemon({
            id: 'darkrai',
            pokedexId: 491,
            pokemonName: 'ダークライ',
            type: 'dark',
            srcLevel: 30,
            dstLevel: 60,
            expType: 1320,
            nature: 'normal',
            expGot: 0,
            candyNeed: 1739,
            boostOrExpAdjustment: 1739,
            candyTarget: 1500,
          }),
          pokemon({
            id: 'iwapalace',
            pokedexId: 558,
            pokemonName: 'イワパレス',
            type: 'bug',
            srcLevel: 50,
            dstLevel: 60,
            expType: 600,
            nature: 'normal',
            expGot: 0,
            candyNeed: 418,
            boostOrExpAdjustment: 418,
          }),
          pokemon({
            id: 'spiritomb',
            pokedexId: 442,
            pokemonName: 'ミカルゲ',
            type: 'ghost',
            srcLevel: 50,
            dstLevel: 60,
            expType: 600,
            nature: 'normal',
            expGot: 0,
            candyNeed: 430,
            boostOrExpAdjustment: 430,
          }),
        ],
        inventory({
          species: { '491': 500, '558': 57, '442': 197 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 90, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 4000000 })
      );

      const darkrai = getPokemon(result, 'darkrai');
      const iwapalace = getPokemon(result, 'iwapalace');
      const spiritomb = getPokemon(result, 'spiritomb');

      // ダークライ: 個数指定1500分のみ消費
      expect(darkrai.reachableItems.totalSupply).toBe(1500);
      expect(darkrai.reachableItems.totalCandyCount).toBe(1500);

      // イワパレス: 目標到達、不足なし
      expect(iwapalace.shortage.candy).toBe(0);
      expect(iwapalace.diagnosis.limitingFactor).toBe(null);
      // イワパレス: 万能S約121個（57種族＋万能S121×3＝420価値≒418＋余り2）
      expect(iwapalace.reachableItems.universalS).toBe(121);
      expect(iwapalace.reachableItems.surplus).toBe(2);

      // ミカルゲ: 目標到達、不足なし
      expect(spiritomb.shortage.candy).toBe(0);
      expect(spiritomb.diagnosis.limitingFactor).toBe(null);
      // ミカルゲ: 種族197＋万能Sと万能Mで残りを補填
      expect(spiritomb.reachableItems.speciesCandy).toBe(197);
    });
  });

  // ========================================
  // テスト48: 個数指定時のかけら計算（目標まで行と到達可能行の一致）
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - エンテイ: Lv28→42、EXP下降補正（▼）
  // - あとEXP: 1235（= Lv28→29の必要EXP全体、つまり expGot = 0）
  // - アメの個数指定: 500
  // - アメ在庫: 0
  //
  // 仕様:
  // - かけらは「投入予定の全アメ分」を表示
  // - 目標Lvまでに必要なかけらではなく、アメを投入した際にもらえるかけら
  //
  // 期待:
  // - 目標まで行と到達可能行のかけらが一致（392,245）
  // - 到達Lv = 42（目標Lv到達）
  // - 不足なし（primaryShortageType = null）
  describe('Test48: 個数指定時のかけら計算', () => {
    it('かけら=392,245', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'entei',
          pokedexId: 244,
          pokemonName: 'エンテイ',
          type: 'fire',
          srcLevel: 28,
          dstLevel: 42,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 500,
          boostOrExpAdjustment: 500,
          candyTarget: 500,
        })],
        inventory({
          species: { '244': 0 },
          typeCandy: { fire: { s: 100, m: 10 } },
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'entei');
      expect(p.reachableItems.shardsCount).toBe(392245);
      expect(p.reachedLevel).toBe(42);
      expect(p.diagnosis.limitingFactor).toBe(null);
    });
  });

  // ========================================
  // テスト49: アメ合計＜個数指定の時、通常アメで補填しない
  // ========================================
  // シナリオ（スクリーンショットより）:
  // - エンテイ: 現在Lv 28 → 目標Lv 40
  // - EXP下降補正（nature: down）
  // - アメブ個数: 398（アメ合計）
  // - アメの個数指定: 500
  // - アメ在庫: 0（種族アメなし）
  // - 在庫∞: オフ
  //
  // 問題:
  // - 現在: アメ合計398 < 個数指定500 → 通常アメ102を追加して500にする
  // - 期待: アメ合計398までしか使わない（在庫∞オンの時と同じ動作）
  //
  // 期待結果:
  // - アメブ: 398
  // - 通常アメ: 0（通常アメで補填しない）
  // - アメ合計: 398
  describe('Test49: アメ合計＜個数指定の時、通常アメで補填しない', () => {
    it('normalCount=0, totalSupply=398', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'entei',
          pokedexId: 244,
          pokemonName: 'エンテイ',
          type: 'fire',
          srcLevel: 28,
          dstLevel: 40,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 398,
          boostOrExpAdjustment: 398,
          candyTarget: 500,
        })],
        inventory({
          species: { '244': 0 },
          typeCandy: { fire: { s: 10, m: 4 } },
          universal: { s: 120, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'entei');
      expect(p.reachableItems.normalCount).toBe(0);
      expect(p.reachableItems.boostCount).toBe(398);
      expect(p.reachableItems.totalSupply).toBe(398);
    });
  });

  // ========================================
  // テスト50: 個数指定行（理論値モード）でも通常アメで補填しない
  // ========================================
  // シナリオ:
  // - エンテイ: 現在Lv 28 → 目標Lv 40
  // - アメブ個数: 398（アメ合計）
  // - アメの個数指定: 500
  // - アメブ・アメ・かけらのどれかが不足 → 個数指定行が表示される
  // - 個数指定行でも通常アメで補填しないことを確認
  //
  // 期待:
  // - 個数指定行: アメブ398, 通常アメ0, アメ合計398
  describe('Test50: 個数指定行でも通常アメで補填しない', () => {
    it('candyTargetItems.normalCount=0, totalCandyCount=398', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'entei',
          pokedexId: 244,
          pokemonName: 'エンテイ',
          type: 'fire',
          srcLevel: 28,
          dstLevel: 40,
          expType: 1080,
          nature: 'down',
          expGot: 0,
          candyNeed: 398,
          boostOrExpAdjustment: 398,
          candyTarget: 500,  // 個数指定 > アメ合計
        })],
        inventory({
          species: { '244': 0 },
          typeCandy: { fire: { s: 10, m: 4 } },
          universal: { s: 120, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 100, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'entei');

      // 個数指定行（candyTargetItems）でも通常アメで補填しない
      expect(p.candyTargetNormal).toBe(0);
      expect(p.candyTargetBoost).toBe(398);
      expect(p.candyTargetItems!.totalCandyCount).toBe(398);
    });
  });

  // ========================================
  // テスト51: アメ合計＜個数指定 + アメブ不足 + かけら不足の時のバグ
  // ========================================
  // シナリオ（スクリーンショットより）:
  // - 75スイクン: Lv50 → Lv60
  // - アメブ個数: 922（アメ合計）
  // - アメの個数指定: 1000
  // - アメ在庫: 167
  // - アメブ上限: 0（完全に不足）
  // - かけら上限: 796,773（バグ発生）vs 796,774（正常）
  //
  // バグ:
  // - かけら上限 796,773: 到達可能行でアメブ453, 通常アメ3使用
  // - かけら上限 796,774: 到達可能行でアメブ0, 通常アメ0（正常）
  //
  // 期待:
  // - アメブ上限0なので、到達可能行ではアメブ0, 通常アメ0, アメ合計0
  describe('Test51: アメブ上限0、かけら不足', () => {
    it('アメブ上限0なので配分なし', () => {
      // かけら上限 796,773
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
          candyTarget: 1000,
        })],
        inventory({
          species: { '245': 167 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 0, globalShardsLimit: 796773 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachableItems.boostCount).toBe(0);
      expect(p.reachableItems.totalSupply).toBe(0);
    });
  });

  // ========================================
  // テスト52: かけら上限1/0での不足表示
  // ========================================
  // かけら上限1でかけら不足が主要因
  describe('Test52: かけら上限1での不足表示', () => {
    it('primaryShortageType=shards', () => {
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
          candyTarget: 1000,
        })],
        inventory({
          species: { '245': 167 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 1 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.diagnosis.limitingFactor).toBe('shards');
    });
  });

  // ========================================
  // テスト53: アメブ上限0、かけらも不足（アメブが主要因）
  // ========================================
  // シナリオ:
  // - スイクン Lv50 → Lv60
  // - アメブ上限: 0（アメブ使用不可）
  // - かけら上限: 10,000（不足）
  //
  // 仕様:
  // - アメブ上限0 + かけら不足の場合、アメブが主要因
  // - boostKind = 'full' の場合、アメブがないとレベルアップ不可
  //
  // 期待:
  // - reachedLevel = 50（アメブ0でLvアップ不可）
  // - primaryShortageType = boost（アメブが主要因）
  describe('Test53: アメブ上限0、かけらも不足', () => {
    it('primaryShortageType=boost', () => {
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
          species: { '245': 167 },
          typeCandy: { water: { s: 5, m: 0 } },
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 0, globalShardsLimit: 10000 })
      );

      const p = getPokemon(result, 'suicune');
      expect(p.reachedLevel).toBe(50);
      expect(p.diagnosis.limitingFactor).toBe('boost');
    });
  });
  // ========================================
  // テスト54: 同Lv内でのEXP獲得（srcLevel === dstLevel）
  // ========================================
  // シナリオ（スクリーンショットより）:
  // - 75スイクン: Lv50 → Lv50（同一レベル）
  // - あとEXP: 2,451
  // - アメ在庫: 100
  // - アメブ個数: 50（アメの個数指定）
  //
  // 問題:
  // - srcLevel === dstLevel の場合、アメブ0, 通常アメ0, 合計0になる
  // - 目標Lvに到達済みでも、アメを使えばEXPは増えるはず
  //
  // 期待:
  // - アメブ: 50（個数指定通り）
  // - EXPが計算される（0ではない）
  describe('Test54: 同Lv内でのEXP獲得', () => {
    it('srcLevel === dstLevel でもアメブとEXPが計算される', () => {
      // アメブ50個分のEXPを計算
      const boostCandyCount = 50;
      const expPerCandy = calcExpPerCandy(50, 'normal', 'full');
      const dstExpInLevel = boostCandyCount * expPerCandy;

      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 50,
          dstLevel: 50,  // 同一レベル
          dstExpInLevel,  // 目標EXP
          expType: 1080,
          nature: 'normal',
          expGot: 0,
          candyNeed: 50,  // 50アメ投入予定
          boostOrExpAdjustment: 50,
          candyTarget: 50,
        })],
        inventory({
          species: { '245': 100 },
          typeCandy: { water: { s: 0, m: 0 } },
          universal: { s: 0, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'suicune');
      // アメブ50が配分されるべき
      expect(p.reachableItems.boostCount).toBe(50);
      expect(p.reachableItems.totalCandyCount).toBe(50);
      // EXPが計算されるべき（0ではない）
      expect(p.reachableItems.shardsCount).toBeGreaterThan(0);
    });
  });

  // ========================================
  // テスト55: タツベイ EXPタイプ900 実機検証
  // ========================================
  // シナリオ（実際のゲームで確認）:
  // - タツベイ: Lv16 → Lv46
  // - EXPタイプ: 900（600族）
  // - 性格補正: なし（normal）
  // - あとEXP: 681（= Lv16→17の全EXP、expGot = 0）
  // - boost: none（通常アメのみ使用）
  //
  // 実機確認結果:
  // - 通常アメ: 1,198
  // - かけら: 180,728
  describe('Test55: タツベイ EXPタイプ900 実機検証', () => {
    it('通常アメ=1198、かけら=180728（実機確認値）', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'bagon',
          pokedexId: 371,
          pokemonName: 'タツベイ',
          type: 'dragon',
          srcLevel: 16,
          dstLevel: 46,
          expType: 900,
          nature: 'normal',
          expGot: 0,
          candyNeed: 1198,
          boostOrExpAdjustment: 1198,
        })],
        inventory({
          species: { '371': 2000 },  // 十分な在庫
          typeCandy: { dragon: { s: 0, m: 0 } },
          universal: { s: 0, m: 0, l: 0 },
        }),
        config({ boostKind: 'none', globalBoostLimit: 0, globalShardsLimit: 10000000 })
      );

      const p = getPokemon(result, 'bagon');

      // 実機確認値と一致
      expect(p.targetNormal).toBe(1198);
      expect(p.targetShards).toBe(180728);
      expect(p.reachedLevel).toBe(46);
    });
  });

  // ========================================
  // テスト56: グローバルアメブ上限がアメ在庫制限より優先される
  // ========================================
  // シナリオ（ユーザー報告バグ）:
  // - スイクン: Lv58 → Lv65
  // - アメ在庫: 147（種族アメ）
  // - タイプM: 6個（= 150価値）
  // - 合計アメ在庫価値: 147 + 6*25 = 297
  // - グローバルアメブ上限: 150（イベント途中の残数）
  // - 目標まで必要: アメブ790
  //
  // バグ（修正前）:
  // - アメブ個数を手動で643～297に設定すると、到達可能行のアメブが297（在庫制限）になる
  // - アメブ個数を手動で296～151に設定すると、到達可能行のアメブが入力値になる
  // - いずれもグローバル上限150を超えている
  //
  // 期待（修正後）:
  // - 到達可能行のアメブは常にグローバル上限150以下
  // - アメ在庫制限よりグローバル上限が優先される
  describe('Test56: グローバルアメブ上限がアメ在庫制限より優先される', () => {
    it('到達可能行はグローバル上限150を守る（アメブ入力297の場合）', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 58,
          dstLevel: 65,
          expType: 1080,
          nature: 'normal',
          expGot: 0,
          candyNeed: 790,  // 目標まで790アメ必要
          boostOrExpAdjustment: 297,  // ユーザーがアメブ297に設定
        })],
        inventory({
          species: { '245': 147 },  // 種族アメ147
          typeCandy: { water: { s: 0, m: 6 } },  // タイプM 6個 = 価値150
          universal: { s: 0, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 150, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'suicune');
      // 到達可能行のアメブはグローバル上限150以下であるべき
      expect(p.reachableItems.boostCount).toBeLessThanOrEqual(150);
    });

    it('到達可能行はグローバル上限150を守る（アメブ入力151の場合）', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 58,
          dstLevel: 65,
          expType: 1080,
          nature: 'normal',
          expGot: 0,
          candyNeed: 790,
          boostOrExpAdjustment: 151,  // ユーザーがアメブ151に設定（上限+1）
        })],
        inventory({
          species: { '245': 147 },
          typeCandy: { water: { s: 0, m: 6 } },
          universal: { s: 0, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 150, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'suicune');
      // 到達可能行のアメブはグローバル上限150以下であるべき
      expect(p.reachableItems.boostCount).toBeLessThanOrEqual(150);
    });

    it('アメブ100%でも到達可能行はグローバル上限150を守る', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'suicune',
          pokedexId: 245,
          pokemonName: 'スイクン',
          type: 'water',
          srcLevel: 58,
          dstLevel: 65,
          expType: 1080,
          nature: 'normal',
          expGot: 0,
          candyNeed: 790,
          boostOrExpAdjustment: 790,  // アメブ100%
        })],
        inventory({
          species: { '245': 147 },
          typeCandy: { water: { s: 0, m: 6 } },
          universal: { s: 0, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 150, globalShardsLimit: 4000000 })
      );

      const p = getPokemon(result, 'suicune');
      // 到達可能行のアメブはグローバル上限150であるべき（ユーザー確認済み正常動作）
      expect(p.reachableItems.boostCount).toBe(150);
    });
  });
});
