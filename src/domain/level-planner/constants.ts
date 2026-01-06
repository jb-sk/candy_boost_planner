/**
 * LevelPlanner - 定数定義
 *
 * アメの価値、使用優先順位、ブースト倍率などの定数。
 */

// ============================================================
// アメ価値
// ============================================================

/**
 * アメの価値（通常アメ1個 = 価値1として換算）
 */
export const CANDY_VALUES = {
  /** 種族アメ（ポケモンのアメ） */
  species: 1,

  /** タイプアメ */
  type: {
    s: 4,
    m: 25,
  },

  /** 万能アメ */
  universal: {
    s: 3,
    m: 20,
    l: 100,
  },
} as const;

// ============================================================
// ブースト設定
// ============================================================

/**
 * ブースト種別ごとのEXP倍率
 */
export const BOOST_EXP_MULTIPLIER = {
  none: 1,
  mini: 2,
  full: 2,
} as const;

/**
 * ブースト種別ごとのかけら倍率
 */
export const BOOST_SHARDS_MULTIPLIER = {
  none: 1,
  mini: 4,
  full: 5,
} as const;

// ============================================================
// 配分ルール
// ============================================================

/**
 * 許容される最大余り（これ以下なら最適とみなす）
 */
export const MAX_ACCEPTABLE_SURPLUS = 2;

/**
 * アイテム使用優先順位（高い方から使う）
 *
 * 1. 種族アメ（価値1、バッグ圧縮効果最大）
 * 2. タイプS（価値4）
 * 3. タイプM（価値25）
 * 4. 万能S（価値3）
 * 5. 万能M（価値20）
 * 6. 万能L（価値100）
 */
export const ITEM_PRIORITY = [
  'species',
  'typeS',
  'typeM',
  'universalS',
  'universalM',
  'universalL',
] as const;

export type ItemPriority = typeof ITEM_PRIORITY[number];

// ============================================================
// 性格補正
// ============================================================

/**
 * 性格補正によるEXP/アメ（レベル帯別）
 */
export const EXP_PER_CANDY_BY_NATURE = {
  /** Lv < 25 */
  low: {
    up: 41,
    neutral: 35,
    down: 29,
  },
  /** 25 <= Lv < 30 */
  mid: {
    up: 35,
    neutral: 30,
    down: 25,
  },
  /** Lv >= 30 */
  high: {
    up: 30,
    neutral: 25,
    down: 21,
  },
} as const;

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * アイテムの合計価値を計算
 */
export function calcItemValue(items: {
  speciesCandy?: number;
  typeS?: number;
  typeM?: number;
  universalS?: number;
  universalM?: number;
  universalL?: number;
}): number {
  return (
    (items.speciesCandy ?? 0) * CANDY_VALUES.species +
    (items.typeS ?? 0) * CANDY_VALUES.type.s +
    (items.typeM ?? 0) * CANDY_VALUES.type.m +
    (items.universalS ?? 0) * CANDY_VALUES.universal.s +
    (items.universalM ?? 0) * CANDY_VALUES.universal.m +
    (items.universalL ?? 0) * CANDY_VALUES.universal.l
  );
}

/**
 * 在庫の合計価値を計算
 */
export function calcInventoryValue(inventory: {
  species?: Record<string, number>;
  typeCandy?: Record<string, { s: number; m: number }>;
  universal?: { s: number; m: number; l: number };
}): number {
  let total = 0;

  // 種族アメ
  if (inventory.species) {
    for (const count of Object.values(inventory.species)) {
      total += count * CANDY_VALUES.species;
    }
  }

  // タイプアメ
  if (inventory.typeCandy) {
    for (const { s, m } of Object.values(inventory.typeCandy)) {
      total += s * CANDY_VALUES.type.s + m * CANDY_VALUES.type.m;
    }
  }

  // 万能アメ
  if (inventory.universal) {
    total +=
      inventory.universal.s * CANDY_VALUES.universal.s +
      inventory.universal.m * CANDY_VALUES.universal.m +
      inventory.universal.l * CANDY_VALUES.universal.l;
  }

  return total;
}
