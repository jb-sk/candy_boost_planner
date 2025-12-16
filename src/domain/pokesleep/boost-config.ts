import type { BoostEvent } from "../types";

export type BoostRule = Readonly<{
  /** アメ投入による経験値倍率 */
  expMultiplier: number;
  /** ゆめのかけら消費倍率（通常アメ=1） */
  shardMultiplier: number;
}>;

/**
 * イベント倍率（運用で変わり得る設定）
 *
 * - 手動で編集してOK
 * - もしくは `node scripts/set-boost-config.mjs ...` で更新
 */
export const boostRules = {
  none: { expMultiplier: 1, shardMultiplier: 1 },
  mini: { expMultiplier: 2, shardMultiplier: 4 },
  full: { expMultiplier: 2, shardMultiplier: 5 },
} as const satisfies Record<BoostEvent, BoostRule>;
