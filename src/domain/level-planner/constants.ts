/** レベルプランナーで共有するゲーム定数。 */

/** 通常アメ1個を価値1としたアメ価値の正本。 */
export const CANDY_VALUES = {
  species: 1,
  type: {
    s: 4,
    m: 25,
  },
  universal: {
    s: 3,
    m: 20,
    l: 100,
  },
} as const;

/** `surplusFirst` が各行に許容する最大余り。 */
export const MAX_ACCEPTABLE_SURPLUS = 2;

/**
 * ソルバー1回の締切（ms）。超えると、それまでに見つけた配り方を返す（計算機の待ち時間の上限）。
 * シンプルの「全体のLvを伸ばす」の時間の上限もこれに合わせる（`RAISE_TIME_BUDGET_MS`）。
 */
export const PLANNER_DEADLINE_MS = 30_000;
