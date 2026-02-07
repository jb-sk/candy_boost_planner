/**
 * アメブ混合テスト（Test 21-29）
 *
 * アメブと通常アメの混合使用、個数指定、グローバル制限のテスト
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 *
 * 注意: expGot=0に統一（旧テストのexpGotは誤り）
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../../../src/domain/level-planner/core';
import { pokemon, inventory, config, getPokemon } from './helpers';

describe('アメブ混合テスト', () => {
  // ========================================
  // テスト21: 在庫不足時の理論値ベース必要アイテム計算
  // ========================================
  // シナリオ:
  // - ダークライ: 個数指定1500、candyNeed=1500
  // - アメ在庫: 種族500 + あくM 1(25) + 万能S 1000（十分）
  //
  // 理論値計算（個数指定1500を満たすために必要なアイテム）:
  // - 1500 - 500(種族) = 1000を補う必要がある
  // - あくM 1 = 25価値 → 残り975
  // - 万能S 325 = 975価値
  // - 合計: 500 + 25 + 975 = 1500
  //
  // 期待:
  // - totalSupply: 1500（個数指定に到達）
  // - typeM: 1（あくM使用）
  // - universalS: 325（975 / 3）
  // - 余り ≤ 2
  describe('Test21: 理論値ベース必要アイテム計算（ダークライ）', () => {
    it('個数指定行の理論値を正しく計算', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test21',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 30,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 1500,
          boostOrExpAdjustment: 1500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 1000, m: 100, l: 10 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test21');
      expect(p.reachableItems.totalSupply).toBe(1500);
      expect(p.reachableItems.typeM).toBe(1);
      expect(p.reachableItems.universalS).toBe(325);
      expect(p.reachableItems.surplus).toBeLessThanOrEqual(2);
    });

    // ========================================
    // 在庫不足シナリオ
    // ========================================
    // シナリオ:
    // - ダークライ: candyNeed=1500、100%アメブ
    // - 在庫: 種族500 + あくM 1(25) + 万能S 200個(600価値)
    // - 合計在庫価値: 500 + 25 + 600 = 1125
    //
    // 期待:
    // - totalUsed: 1125（在庫全部使用）
    // - 万能S: 200（在庫全部）
    // - remaining: 375（1500 - 1125）
    it('在庫不足時は在庫分のみ配分', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test21-limited',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 30,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 1500,
          boostOrExpAdjustment: 1500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 200, m: 0, l: 0 },  // 万能S 200個のみ
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test21-limited');
      // 在庫ベースの配分: 500 + 25 + 600 = 1125
      expect(p.reachableItems.totalSupply).toBe(1125);
      expect(p.reachableItems.universalS).toBe(200);  // 在庫全部
      expect(p.shortage.candy).toBe(375);  // remaining = 1500 - 1125
    });
  });


  // ========================================
  // テスト22: 万能S在庫の使い切り確認（個数指定あり＋制限なし複数ポケモン）
  // ========================================
  // シナリオ:
  // - 万能S在庫: 200個
  // - ダークライ: 個数指定1000、100%アメブ
  //   → 種族500 + あくM 1(25) + 万能S 159(477) = 1002 → totalUsed=1000, surplus=2
  // - イワパレス: 制限なし、100%アメブ、到達Lv55
  //   → 種族57 + 万能S 41(123) = 180
  //
  // ダークライ計算:
  // - 個数指定1000に対して、種族500+あくM25=525を使用後、残り475が必要
  // - 万能Sで475を満たすには ceil(475/3)=159個(477価値) → 端数調整で159個使用
  // - totalUsed = 1000（個数指定が上限）、surplus = 2
  //
  // イワパレス計算:
  // - 万能S残り: 200 - 159 = 41個
  // - 種族57 + 万能S 41(123) = 180価値使用
  //
  // 期待:
  // - ダークライ: 万能S 159個使用、totalUsed ≤ 1002
  // - イワパレス: 万能S 41個使用（残り在庫全部）
  // - 万能S合計: 159 + 41 = 200（在庫使い切り）
  describe('Test22: 万能S在庫の使い切り（複数ポケモン）', () => {
    it('個数指定あり+制限なしの複数ポケモンで万能Sを適切に分配', () => {
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
            candyTarget: 1000,
          }),
          pokemon({
            id: 'crustle',
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
        ],
        inventory({
          species: { '491': 500, '558': 57 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 200, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 4000000 })
      );

      const darkrai = getPokemon(result, 'darkrai');
      const crustle = getPokemon(result, 'crustle');

      expect(darkrai.reachableItems.totalSupply).toBeLessThanOrEqual(1002);
      expect(darkrai.reachableItems.universalS).toBe(159);
      expect(crustle.reachableItems.universalS).toBe(41);
      expect(result.universalRemaining.s).toBe(0);
    });
  });

  // ========================================
  // テスト23: アメブ＆通常アメ＆個数指定のケース
  // ========================================
  // シナリオ:
  // - 現在Lv: 30, 目標Lv: 60
  // - アメブ目標Lv: 55 (70%アメブ) → boostCandyLimit=1208
  // - アメの個数指定: 1500
  // - あとEXP: 1604
  //
  // 問題:
  // - 目標まで行: アメブ 1,208 + 通常アメ 1,061 = 2,269（個数指定1500を超えている）
  //
  // 仕様:
  // - アメブと通常アメを混合する場合、合計が個数指定を超えないようにする
  // - 使用優先順位はアメブ > 通常アメ
  //
  // 期待:
  // - アメブ: 1208（アメブ優先）
  // - 通常アメ: 292（1500 - 1208 = 292）
  // - アメ合計: ≤ 1502（個数指定1500を守る + 余り2）
  describe('Test23: アメブ＆通常アメ＆個数指定（ダークライ）', () => {
    it('個数指定行はアメブ優先、合計は個数指定を守る', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test23',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 30,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2269,
          boostOrExpAdjustment: 1208,
          candyTarget: 1500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 1000, m: 100, l: 10 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test23');
      expect(p.reachableItems.boostCount).toBe(1208);
      expect(p.reachableItems.normalCount).toBe(292);
      // アメ合計は個数指定1500を守る
      expect(p.reachableItems.totalCandyCount).toBe(1500);
      expect(p.reachableItems.totalSupply).toBeLessThanOrEqual(1502);
    });
  });

  // ========================================
  // テスト24: アメブ混合＆個数指定＆グローバルアメブ不足のケース
  // ========================================
  // シナリオ:
  // - 現在Lv: 30, 目標Lv: 60
  // - アメブ目標Lv: 55 (70%設定) → アメブ上限1208
  // - 個数指定: 1500
  // - グローバルアメブ残数: 1000（制限される）
  //
  // 個数指定理論値:
  // - アメブ: 1208
  // - 通常アメ: 1500 - 1208 = 292
  //
  // 期待（グローバルアメブ制限時）:
  // - アメブ: 1000（グローバル制限）
  // - 通常アメ: 292（個数指定理論値のまま、アメブ不足分を補填しない）
  // - アメ合計: 1292
  // - アメブ不足: 1208 - 1000 = 208
  describe('Test24: グローバルアメブ不足（ダークライ）', () => {
    it('グローバル制限でアメブが減少', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test24',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 30,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2269,
          boostOrExpAdjustment: 1208,
          candyTarget: 1500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 400, m: 90, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 1000, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test24');
      expect(p.reachableItems.boostCount).toBe(1000);
      expect(p.reachableItems.normalCount).toBe(292);
      // アメ合計（到達可能行）は 1000 + 292 = 1292
      expect(p.reachableItems.totalCandyCount).toBe(1292);
      // totalSupply は余り込みで 1294 以下
      expect(p.reachableItems.totalSupply).toBeLessThanOrEqual(1294);
      expect(p.shortage.boost).toBe(208);
    });
  });

  // ========================================
  // テスト25: アメブ混合＆個数指定＆目標まで行はかけら不足＆理論値はかけら十分
  // ========================================
  // シナリオ:
  // - 現在Lv: 30, 目標Lv: 60
  // - アメブ目標Lv: 55 (69%設定) → アメブ上限1200
  // - 個数指定: 1500
  // - グローバルかけら上限: 2,000,000
  // - 目標まで行のかけら: ~2,030,022（上限超過）
  // - 個数指定理論値のかけら: ~1,617,279（上限内）
  //
  // 期待:
  // - 到達可能行: アメブ1200 + 通常アメ300 = 1500
  // - かけら: 上限内、かけら不足0（個数指定理論値を満たしている）
  describe('Test25: 目標はかけら不足、理論値は足りる（ダークライ）', () => {
    it('個数指定理論値でかけら不足0', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test25',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 30,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2277,
          boostOrExpAdjustment: 1200,
          candyTarget: 1500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 90, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test25');
      expect(p.reachableItems.boostCount).toBe(1200);
      expect(p.reachableItems.normalCount).toBe(300);
      expect(p.reachableItems.totalSupply).toBe(1500);
      expect(p.shortage.shards).toBe(0);
    });
  });

  // ========================================
  // テスト26: アメブ混合＆個数指定＆かけら不足（理論値も不足）
  // ========================================
  // シナリオ:
  // - 現在Lv: 30, 目標Lv: 60
  // - アメブ目標Lv: 55 (69%設定) → アメブ上限1200
  // - 個数指定: 1500
  // - グローバルかけら上限: 1,000,000（個数指定理論値1,617,279より少ない）
  //
  // 期待:
  // - まずアメブを最大化（かけら上限内で）
  // - 残りかけらで通常アメを使う（ほぼ0に近い）
  // - かけら上限内
  // - かけら不足あり
  describe('Test26: かけら不足（ダークライ）', () => {
    it('かけら上限内、かけら不足あり', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test26',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 30,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2277,
          boostOrExpAdjustment: 1200,
          candyTarget: 1500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 90, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 1000000 })
      );

      const p = getPokemon(result, 'test26');
      expect(p.reachableItems.shardsCount).toBeLessThanOrEqual(1000000);
      expect(p.reachableItems.normalCount).toBeLessThanOrEqual(10);
      expect(p.shortage.shards).toBeGreaterThan(0);
    });
  });

  // ========================================
  // テスト27: アメブ混合＆個数指定＆アメ在庫不足（万能S不足）
  // ========================================
  // シナリオ:
  // - 現在Lv: 30, 目標Lv: 60
  // - アメブ目標Lv: 55 (69%設定) → アメブ上限1200
  // - 個数指定: 1500
  // - グローバルアメブ残数: 3500（十分）
  // - 万能S在庫: 100個（価値300）→ 不足
  // - アメ在庫合計: 500 + 25 + 300 = 825 < 1500
  //
  // 期待:
  // - primaryShortageType: candy（アメ在庫不足が主要因）
  // - boostShortage: 0（グローバルアメブは足りている）
  // - remaining: > 0（アメ在庫不足）
  describe('Test27: アメ在庫不足（ダークライ）', () => {
    it('アメ在庫不足を検知', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test27',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 30,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2277,
          boostOrExpAdjustment: 1200,
          candyTarget: 1500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 100, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test27');
      expect(p.diagnosis.limitingFactor).toBe('candy');
      expect(p.shortage.boost).toBe(0);
      expect(p.shortage.candy).toBeGreaterThan(0);
    });
  });

  // ========================================
  // テスト28: アメブ混合＆個数指定＆かけら制限＆アメ不足（境界値テスト）
  // ========================================
  // シナリオ:
  // - 現在Lv: 30, 目標Lv: 60
  // - アメブ目標Lv: 55 (69%設定) → アメブ1200
  // - 個数指定: 1500
  // - グローバルアメブ残数: 3500（十分）
  // - かけら上限: 2,030,021（境界値 - アメ不足が検知されない可能性）
  // - アメ在庫: 種族500 + タイプM 25 + 万能S 0 = 525（不足）
  //
  // 期待:
  // - アメ在庫は 500 + 25 = 525 しかないので、1500には足りない
  // - アメ不足が検知されるべき
  // - primaryShortageType: candy（アメ在庫不足が主要因）
  // - remaining: > 0（アメ在庫不足）
  describe('Test28: 境界値テスト（ダークライ）', () => {
    it('かけら境界値でもアメ不足を検知', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test28',
          pokedexId: 491,
          pokemonName: 'ダークライ',
          type: 'dark',
          srcLevel: 30,
          dstLevel: 60,
          expType: 1320,
          nature: 'normal',
          expGot: 0,
          candyNeed: 2277,
          boostOrExpAdjustment: 1200,
          candyTarget: 1500,
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 0, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 2030021 })
      );

      const p = getPokemon(result, 'test28');
      expect(p.shortage.candy).toBeGreaterThan(0);
      expect(p.diagnosis.limitingFactor).toBe('candy');
    });
  });

  // ========================================
  // テスト29: 個数指定＆かけら不足＆アメ不足（アメ不足が主要因）
  // ========================================
  // シナリオ:
  // - 現在Lv: 30, 目標Lv: 60
  // - アメブ目標Lv: 60 (100%設定) → アメブ1739
  // - 個数指定: 1500
  // - グローバルアメブ残数: 3500（十分）
  // - かけら上限: 2,000,000（不足）
  // - アメ在庫: 種族500のみ（万能なし）
  //
  // 期待:
  // - アメ在庫が500しかないので、到達可能はアメブ500、アメ合計500
  // - かけら不足とアメ不足の両方があるが、アメ不足が主要因
  // - boostCount = 500, totalSupply = 500
  // - shortage.candy > 0, limitingFactor = candy
  describe('Test29: アメ不足が主要因（ダークライ）', () => {
    it('アメ在庫のみ使用、アメ不足が主要因', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test29',
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
          typeCandy: { dark: { s: 0, m: 0 } },
          universal: { s: 0, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test29');
      expect(p.reachableItems.boostCount).toBe(500);
      expect(p.reachableItems.totalCandyCount).toBe(500);
      expect(p.shortage.candy).toBeGreaterThan(0);
      expect(p.diagnosis.limitingFactor).toBe('candy');
    });
  });
});
