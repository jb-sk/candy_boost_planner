import { describe, expect, it } from 'vitest';
import { CANDY_VALUES } from '../../../src/domain/level-planner/constants';
import {
  addItemPriority, compareItemPriority, emptyItemPriority, itemCountsFromPriority, itemPriorityOf, itemScoreOf,
} from '../../../src/domain/level-planner/core/itemPriority';
import type { ItemCounts } from '../../../src/domain/level-planner/core/itemPriority';

function counts(typeS: number, typeM: number, universalS: number, universalM: number, universalL: number): ItemCounts {
  return { typeS, typeM, universalS, universalM, universalL };
}

function valueOf(item: ItemCounts): number {
  return item.typeS * CANDY_VALUES.type.s
    + item.typeM * CANDY_VALUES.type.m
    + item.universalS * CANDY_VALUES.universal.s
    + item.universalM * CANDY_VALUES.universal.m
    + item.universalL * CANDY_VALUES.universal.l;
}

/** どれも価値ちょうど100。同じ余りの候補どうしを比べる状況を再現する。 */
const equalValueCases: Array<{ label: string; item: ItemCounts }> = [
  { label: 'タイプS 25', item: counts(25, 0, 0, 0, 0) },
  { label: 'タイプM 3 + タイプS 4 + 万能S 3', item: counts(4, 3, 3, 0, 0) },
  { label: 'タイプM 4', item: counts(0, 4, 0, 0, 0) },
  { label: 'タイプM 3 + タイプS 1 + 万能S 7', item: counts(1, 3, 7, 0, 0) },
  // 万能Mを使ってでもタイプアメを多く使う。万能Sが在庫に残るのはその副作用
  { label: 'タイプS 5 + 万能M 4', item: counts(5, 0, 0, 4, 0) },
  { label: 'タイプS 1 + 万能S 32', item: counts(1, 0, 32, 0, 0) },
  { label: '万能M 5', item: counts(0, 0, 0, 5, 0) },
  { label: '万能L 1', item: counts(0, 0, 0, 0, 1) },
];

describe('アイテム使用優先度スコア', () => {
  it('比較ケースはすべて同じ供給価値である', () => {
    for (const { label, item } of equalValueCases) {
      expect(valueOf(item), label).toBe(100);
    }
  });

  it('同じ供給価値なら価値あたりの重みが高いアイテムで埋めた配分ほど高くなる', () => {
    const ranked = [...equalValueCases].sort((a, b) => itemScoreOf(b.item) - itemScoreOf(a.item));
    expect(ranked.map(entry => entry.label)).toEqual(equalValueCases.map(entry => entry.label));
  });

  it('タイプM 1個は万能S 8個（ほぼ同価値）より優先される', () => {
    // 価値25 対 24。個数だけを数える評価だと 1 対 8 で万能Sが勝ってしまう
    expect(itemScoreOf(counts(0, 1, 0, 0, 0))).toBeGreaterThan(itemScoreOf(counts(0, 0, 8, 0, 0)));
  });

  it('価値あたりではタイプSをタイプMより優先する', () => {
    // タイプM 4個(100) より タイプM 3 + タイプS 4 + 万能S 3(100) を選ぶ、という要求そのもの
    expect(itemScoreOf(counts(4, 3, 3, 0, 0))).toBeGreaterThan(itemScoreOf(counts(0, 4, 0, 0, 0)));
  });

  it('万能アメは小さいものから使う（同価値なら S > M > L）', () => {
    expect(itemScoreOf(counts(0, 0, 20, 0, 0))).toBeGreaterThan(itemScoreOf(counts(0, 0, 0, 3, 0)));
    expect(itemScoreOf(counts(0, 0, 0, 5, 0))).toBeGreaterThan(itemScoreOf(counts(0, 0, 0, 0, 1)));
  });

  it('タプルから個数を復元できる', () => {
    for (const { label, item } of equalValueCases) {
      expect(itemCountsFromPriority(itemPriorityOf(item)), label).toEqual(item);
    }
  });

  it('複数行を合算したタプルからも合計個数を復元できる', () => {
    const rows = [counts(3, 1, 7, 2, 1), counts(0, 4, 11, 0, 0), counts(9, 0, 0, 5, 3)];
    const total = rows.reduce(
      (acc, row) => addItemPriority(acc, itemPriorityOf(row)),
      emptyItemPriority(),
    );
    expect(itemCountsFromPriority(total)).toEqual(counts(12, 5, 18, 7, 4));
  });

  it('タプルが同点なら配分も一意である', () => {
    // 同じ供給価値・同じスコアになる配分を総当たりし、タプル一致 ⇒ 個数一致 を確かめる
    const seen = new Map<string, ItemCounts>();
    for (let typeS = 0; typeS <= 25; typeS++) {
      for (let typeM = 0; typeM <= 4; typeM++) {
        for (let universalS = 0; universalS <= 33; universalS++) {
          for (let universalM = 0; universalM <= 5; universalM++) {
            for (let universalL = 0; universalL <= 1; universalL++) {
              const item = counts(typeS, typeM, universalS, universalM, universalL);
              if (valueOf(item) !== 100) continue;
              const key = JSON.stringify(itemPriorityOf(item));
              const previous = seen.get(key);
              if (previous) expect(previous).toEqual(item);
              else seen.set(key, item);
            }
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('供給価値が1違う候補どうしでは、価値が小さい（＝余りが小さい）方へ寄る', () => {
    // 余り0〜2を同等扱いする surplusGateFirst / legacyImproved では、供給価値が
    // 最大2ずれた候補がスコアで直接比較される。減点方式はここで価値が小さい方へ寄る。
    // これはスコアの一部として許容している仕様であって、後段の余り比較が補正するのではない
    // （内訳が違うので、そもそも後段へ到達しない）。重みを変えるとこの方針が変わる。
    const zeroSurplus = counts(0, 2, 10, 1, 0);  // 需要100に対し供給100 = 余り0
    const oneSurplus = counts(3, 0, 23, 1, 0);   // 需要100に対し供給101 = 余り1
    expect(valueOf(zeroSurplus)).toBe(100);
    expect(valueOf(oneSurplus)).toBe(101);
    expect(itemScoreOf(zeroSurplus)).toBe(-20);
    expect(itemScoreOf(oneSurplus)).toBe(-25);
    expect(compareItemPriority(itemPriorityOf(zeroSurplus), itemPriorityOf(oneSurplus))).toBe(1);
  });

  it('比較は合計タプルの辞書順で、スコアが同点なら内訳で決まる', () => {
    const higherScore = itemPriorityOf(counts(25, 0, 0, 0, 0));
    const lowerScore = itemPriorityOf(counts(0, 0, 0, 5, 0));
    expect(compareItemPriority(higherScore, lowerScore)).toBe(1);
    expect(compareItemPriority(lowerScore, higherScore)).toBe(-1);
    expect(compareItemPriority(higherScore, [...higherScore])).toBe(0);
  });
});
