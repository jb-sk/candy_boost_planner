/**
 * 複合シナリオテスト（Test 14, 16-20）
 *
 * 複数の制限要因が絡む複雑なシナリオ
 * 旧テスト（tests/candy-allocator.test.ts）から完全移植
 *
 * 注意: expGot=0に統一（旧テストのexpGotは誤り）
 */

import { describe, it, expect } from 'vitest';
import { planLevelUp } from '../../../src/domain/level-planner/core';
import { pokemon, inventory, config, getPokemon } from './helpers';

describe('複合シナリオテスト', () => {
  // ========================================
  // テスト14: 全て不足時はアメ在庫上限を超えない
  // ========================================
  // シナリオ（ユーザースクリーンショットより）:
  // - ダークライ Lv10→60
  // - アメブ上限2000、かけら上限200万
  // - 在庫: 種アメ500 + あくM1(25) + 万能S100(300) = 825価値のみ
  //
  // 問題（修正前）:
  // - かけら200万では到達可能が867になってしまうバグ
  //
  // 期待:
  // - アメ合計 ≤ 在庫上限825（在庫を超えて使用しない）
  // - アメブ ≤ 在庫上限825
  // - かけら ≤ 200万
  describe('Test14: 全て不足時', () => {
    it('アメ在庫上限を超えない', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test14',
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
          universal: { s: 100, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 2000, globalShardsLimit: 2000000 })
      );

      const p = getPokemon(result, 'test14');
      const candyInventory = 500 + 25 + 300; // 825
      expect(p.reachableItems.totalCandyCount).toBeLessThanOrEqual(candyInventory);
      expect(p.reachableItems.boostCount).toBeLessThanOrEqual(candyInventory);
      expect(p.reachableItems.shardsCount).toBeLessThanOrEqual(2000000);
    });
  });

  // ========================================
  // テスト16: 上位ポケモンの制限により余ったアイテムを下位に振り分け
  // ========================================
  // シナリオ:
  // - ダークライ: 個数指定1500、かけら制限で925しか使えない
  //   → 万能S404が必要だが、133しか使用しない
  //   → 271個分が余る → 下位ポケモンに振り分け可能
  // - イワパレス: アメ418必要、アメ在庫57 → 361不足
  //   → ダークライから余った万能Sで補填できるはず
  //
  // ただし、かけら上限が100万なのでダークライが使い切り、
  // イワパレスはかけら不足でアイテム配分なし
  //
  // 期待:
  // - ダークライ: reachedLevel < 60（かけら制限）
  // - イワパレス: shardsShortage > 0（かけら不足でLvアップ不可）
  describe('Test16: 上位制限→下位へ再配分', () => {
    it('上位がかけら制限で制限され、下位もかけら不足', () => {
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
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: 1000000 })
      );

      const darkrai = getPokemon(result, 'darkrai');
      const crustle = getPokemon(result, 'crustle');

      // ダークライはかけら制限で目標未達
      expect(darkrai.reachedLevel).toBeLessThan(60);

      // イワパレスはかけら不足でレベルアップできない
      expect(crustle.shortage.shards).toBeGreaterThan(0);

      // イワパレスはかけら不足時、アイテム配分も0
      if (crustle.reachableItems.shardsCount === 0 && crustle.shortage.shards > 0) {
        expect(crustle.reachableItems.universalS).toBe(0);
        expect(crustle.reachableItems.totalCandyCount).toBe(0);
      }
    });
  });

  // ========================================
  // テスト17: グローバルアメブ制限時のアイテム配分（余り2以下）
  // ========================================
  // シナリオ:
  // - ダークライ: Lv30 → Lv60
  // - あとEXP: 1604
  // - アメ在庫: 500（種族アメ）
  // - タイプM: 1（価値25）
  // - 万能S: 500（十分ある）
  // - グローバルアメブ上限: 1000
  //
  // 期待:
  // - totalUsed = 1000（グローバル制限で上限に達する）
  // - アイテム: 種族500 + タイプM 1(25) + 万能S 159(477) = 1002価値
  // - 余り: 2（アイテム合計1002 - totalUsed 1000）
  // - 万能Sが十分に配分される（158ではなく159以上）
  describe('Test17: グローバルアメブ制限', () => {
    it('totalUsed=グローバル制限、余り2以下', () => {
      const result = planLevelUp(
        [pokemon({
          id: 'test17',
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
        })],
        inventory({
          species: { '491': 500 },
          typeCandy: { dark: { s: 0, m: 1 } },
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 1000, globalShardsLimit: Infinity })
      );

      const p = getPokemon(result, 'test17');

      // boostCount + normalCount = 1000（グローバル制限）
      expect(p.reachableItems.totalCandyCount).toBe(1000);
      expect(p.reachableItems.boostCount).toBe(1000);
      expect(p.reachableItems.normalCount).toBe(0);

      // totalSupply = アイテム価値合計 = 1002（余り2込み）
      expect(p.reachableItems.totalSupply).toBe(1002);

      // アイテム価値 >= 使用アメ価値
      expect(p.reachableItems.totalSupply).toBeGreaterThanOrEqual(
        p.reachableItems.boostCount + p.reachableItems.normalCount
      );

      // 余り <= 2
      expect(p.reachableItems.surplus).toBeLessThanOrEqual(2);

      // 万能S使用が159±1（500 + 25 + 159*3 = 1002）
      const expectedUniS = Math.ceil((1000 - 500 - 25) / 3);  // = 159
      expect(Math.abs(p.reachableItems.universalS - expectedUniS)).toBeLessThanOrEqual(1);
    });
  });


  // ========================================
  // テスト18: 複合シナリオ（個数指定→理論値切替、下位への再配分）
  // ========================================
  // シナリオ:
  // - グローバルアメブ上限: 1000
  // - ダークライ: candyNeed=1739, 個数指定900, 100%アメブ
  //   → 個数指定900により900に制限される
  //   → 種族500 + タイプM 25 + 万能S 125 = 900使用
  //   → 万能S残り: 500 - 125 = 375個
  // - イワパレス: candyNeed=418, 100%アメブ
  //   → グローバルアメブ残り: 1000 - 900 = 100
  //   → boostCount = 100しか使えない
  //   → 種族57 + 万能Sで補填
  // - ミカルゲ: candyNeed=430, 100%アメブ
  //   → グローバルアメブ残り: 1000 - 900 - 100 = 0
  //   → 使用アイテム = 0（アメブがないため）
  //
  // 期待:
  // - ダークライ: boostCount = 900, totalSupply ≤ 902（余り2以下）
  // - イワパレス: boostCount = 100, アイテム配分あり
  // - ミカルゲ: boostCount = 0, totalSupply = 0（アメブ不足）
  describe('Test18: 3匹のアメブ分配', () => {
    it('個数指定→グローバル残り→0の順で分配', () => {
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
            candyTarget: 900,
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
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 1000, globalShardsLimit: Infinity })
      );

      const darkrai = getPokemon(result, 'darkrai');
      const crustle = getPokemon(result, 'crustle');
      const spiritomb = getPokemon(result, 'spiritomb');

      expect(darkrai.reachableItems.boostCount).toBe(900);
      expect(darkrai.reachableItems.totalSupply).toBeLessThanOrEqual(902);

      expect(crustle.reachableItems.boostCount).toBe(100);

      // ミカルゲはアメブ不足で全てのアイテム配分が0
      expect(spiritomb.reachableItems.boostCount).toBe(0);
      expect(spiritomb.reachableItems.totalCandyCount).toBe(0);
      expect(spiritomb.reachableItems.totalSupply).toBe(0);
      expect(spiritomb.reachableItems.universalS).toBe(0);
      expect(spiritomb.reachableItems.speciesCandy).toBe(0);
    });
  });

  // ========================================
  // テスト19: かけら不足時のアイテム使用（かけら0ならアイテムも0）
  // ========================================
  // シナリオ:
  // - グローバルアメブ無制限、かけら上限100万
  // - ダークライ: candyNeed=1739、かけらを使い切る
  // - イワパレス: ダークライの後、かけら残0
  //   → かけら0でレベルアップ不可 → アイテム配分も0
  //
  // 期待:
  // - ダークライ: shardsCount > 0, totalSupply > 0
  // - イワパレス: shardsCount = 0 → totalSupply = 0, universalS = 0
  // - イワパレス: shortage.shards > 0
  describe('Test19: かけら不足時のアイテム使用', () => {
    it('かけら0のポケモンはアイテムも0', () => {
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
          universal: { s: 500, m: 0, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: Infinity, globalShardsLimit: 1000000 })
      );

      const darkrai = getPokemon(result, 'darkrai');
      const crustle = getPokemon(result, 'crustle');

      expect(darkrai.reachableItems.shardsCount).toBeGreaterThan(0);
      expect(darkrai.reachableItems.totalSupply).toBeGreaterThan(0);

      // イワパレスはかけら不足でアイテムも0
      expect(crustle.shortage.shards).toBeGreaterThan(0);
      if (crustle.reachableItems.shardsCount === 0) {
        expect(crustle.reachableItems.totalSupply).toBe(0);
        expect(crustle.reachableItems.universalS).toBe(0);
      }
    });
  });

  // ========================================
  // テスト20: 目標まで行のアイテム配分（上位の個数指定で在庫消費制限）
  // ========================================
  // シナリオ:
  // - ダークライ: 個数指定1500（理論値）、candyNeed=1739（目標Lvベース）
  //   → 在庫消費は1500分のみ（種族500 + タイプM 25 + 万能S 325 = 1500）
  //   → 目標まで行の表示はcandyNeed=1739（不足分239は万能Sで補填）
  // - イワパレス: 個数指定なし、candyNeed=418
  //   → ダークライが1500分しか消費しないので、残りの万能Sを使用可能
  //   → 万能Sが175個残っている = 価値525 → イワパレスに十分
  //
  // 期待:
  // - ダークライ: totalUsed = 1500（理論値で在庫消費）
  // - イワパレス: 万能Sのみで418を賄える（万能M不要）
  // - イワパレス: totalUsed = 418 ± 2
  describe('Test20: 個数指定で在庫消費制限', () => {
    it('上位の個数指定で在庫消費が制限され、下位に回る', () => {
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
          universal: { s: 500, m: 90, l: 0 },
        }),
        config({ boostKind: 'full', globalBoostLimit: 3500, globalShardsLimit: Infinity })
      );

      const darkrai = getPokemon(result, 'darkrai');
      const crustle = getPokemon(result, 'crustle');

      expect(darkrai.reachableItems.totalSupply).toBe(1500);

      // イワパレスは万能Mを使わずに賄える
      expect(crustle.reachableItems.universalM).toBe(0);

      // イワパレスの万能S使用は必要量以上
      // 必要: 418 - 57(種族) = 361価値 → ceil(361/3) = 121個
      const crustle20UniSNeeded = Math.ceil((418 - 57) / 3);
      expect(crustle.reachableItems.universalS).toBe(crustle20UniSNeeded);

      // イワパレスの到達可能は418に達する（余り2以下）
      expect(Math.abs(crustle.reachableItems.totalCandyCount - 418)).toBeLessThanOrEqual(2);
      expect(Math.abs(crustle.reachableItems.totalSupply - 418)).toBeLessThanOrEqual(2);
    });
  });
});
