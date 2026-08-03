/**
 * LevelPlanner - タイプ/万能アメの使用優先度
 *
 * 比較するのは同じ余りの候補どうしなので、総供給価値も等しい。そのとき
 * 「価値1あたりの重み × 価値 × 個数」の総和を最大化すると、重みの大小が
 * そのまま「どのアイテムで価値を埋めたいか」になる。
 *
 * **個数だけを数えてはいけない。** 価値25のタイプMは、同じ価値を万能アメSで
 * 埋めると8個になる。個数を足すだけの評価では、タイプMを温存して万能Sを
 * 大量に吐き出す側が常に勝ち、「タイプアメを積極的に使う」の逆になる。
 *
 * 重みの基準点はタイプアメと万能アメの境目に置き、タイプアメを加点・万能アメを
 * 減点にした。総供給価値が等しい候補どうしなら全体を定数シフトしても順位は
 * 変わらないので、これは「タイプアメを積極的に使う」と「バッグ圧縮のため
 * 小さいアイテムを吐き出す」を1本の軸で読めるようにするための表現上の選択である。
 *
 * ただし `surplusGateFirst` / `legacyImproved` は余り0〜2を同等に扱うため、
 * 総供給価値が最大2だけ違う候補どうしがここで比較されうる。そこでは減点方式が
 * 「供給価値が小さい方」へわずかに寄る。**この寄りはスコアの一部として許容する。**
 * 余りは小さい方が望ましいので方向は正しく、内訳が違う候補はスコア段階で決着する。
 *
 * **後段に置いた余り比較はこの寄りを打ち消すものではない。** スコアまで同点になった
 * 候補を決定的に並べるためのものである（`compareSupply` / `compareState` /
 * `compareExactSupplyObjective` / `compareQuality`）。
 */

/** 個数あたりの重み。価値あたり重み タイプ16/10・万能 8/7/1 から基準9を引いた形。 */
export const ITEM_SCORE_WEIGHTS = {
  /** 最優先。タイプアメは使い道が限られるので、使えるときに使う */
  typeS: 28,
  /** 同じくタイプアメ。価値あたりで見るとSをわずかに優先する（16 対 10） */
  typeM: 25,
  /** ほぼ中立。タイプアメが尽きたらここから使う */
  universalS: -3,
  /**
   * 万能Sのすぐ下に置く（価値あたり −1 対 −2）。
   *
   * **万能アメSを在庫に残すことは目的関数に書いていない。** ここを万能Sから離すと
   * 「万能Mを1個温存するためにタイプアメSを1個余らせ、万能Sを8個多く吐き出す」配分が
   * 選ばれる。この重みならタイプアメを使い切る側が勝ち、**その副作用として**万能Sが在庫に残る。
   * 端数調整は価値3の万能Sでしか刻めないので、使い切らない方が次回の余り調整に都合がよい。
   *
   * 交換の分岐点は −52（`タイプS+1 / 万能M+1 / 万能S−8` の交換が釣り合う点）。
   * ここより下げると上記の配分が反転する。
   */
  universalM: -40,
  /** 最後の手段 */
  universalL: -800,
} as const;

/** タイプ/万能アメの使用個数。`Supply` や `ExactSupplyUsage` をそのまま渡せる。 */
export type ItemCounts = {
  typeS: number;
  typeM: number;
  universalS: number;
  universalM: number;
  universalL: number;
};

/**
 * 比較タプル `[スコア, タイプS, タイプM, 万能S, -万能M]`。すべて大きい方が良い。
 *
 * 後ろ4要素はスコア同点時のタイブレーク。タイプS/M・万能Sが揃えばスコア式の
 * 万能L項（係数 -800）から万能Lが一意に決まるので、万能Mまで並べれば配分は
 * 一意に定まる。同点候補が残ると dominance の枝刈りが順序依存になるため、
 * ここは削らない。
 */
export type ItemPriorityTuple = [number, number, number, number, number];

export const ITEM_PRIORITY_TUPLE_LENGTH = 5;

export function itemScoreOf(counts: ItemCounts): number {
  return ITEM_SCORE_WEIGHTS.typeS * counts.typeS
    + ITEM_SCORE_WEIGHTS.typeM * counts.typeM
    + ITEM_SCORE_WEIGHTS.universalS * counts.universalS
    + ITEM_SCORE_WEIGHTS.universalM * counts.universalM
    + ITEM_SCORE_WEIGHTS.universalL * counts.universalL;
}

export function itemPriorityOf(counts: ItemCounts): ItemPriorityTuple {
  return [itemScoreOf(counts), counts.typeS, counts.typeM, counts.universalS, -counts.universalM];
}

export function emptyItemPriority(): ItemPriorityTuple {
  return [0, 0, 0, 0, 0];
}

/**
 * タプルから使用個数を復元する。**スコアではなく個数そのものの同値性を見たい場所**
 * （`exactJoinTranslationKey` の合流クラス分け）でだけ使う。
 *
 * 万能Lだけはタプルに直接載っていないのでスコア式から逆算するが、残差は必ず
 * 万能Lの重みの倍数になるので整数のまま割り切れる。誤差は出ない。
 */
export function itemCountsFromPriority(tuple: ItemPriorityTuple): ItemCounts {
  const typeS = tuple[1];
  const typeM = tuple[2];
  const universalS = tuple[3];
  const universalM = -tuple[4];
  const withoutLarge = ITEM_SCORE_WEIGHTS.typeS * typeS
    + ITEM_SCORE_WEIGHTS.typeM * typeM
    + ITEM_SCORE_WEIGHTS.universalS * universalS
    + ITEM_SCORE_WEIGHTS.universalM * universalM;
  return {
    typeS,
    typeM,
    universalS,
    universalM,
    universalL: (withoutLarge - tuple[0]) / -ITEM_SCORE_WEIGHTS.universalL,
  };
}

export function addItemPriority(a: ItemPriorityTuple, b: ItemPriorityTuple): ItemPriorityTuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4]];
}

/** `a` が良ければ 1、`b` が良ければ -1。 */
export function compareItemPriority(a: ItemPriorityTuple, b: ItemPriorityTuple): number {
  for (let index = 0; index < ITEM_PRIORITY_TUPLE_LENGTH; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}
