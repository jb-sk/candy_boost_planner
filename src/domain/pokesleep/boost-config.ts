import type { BoostEvent } from "../types";
import { maxLevel } from "./tables";

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

/**
 * デフォルトのアメブ種別（新規ユーザーの初期値）
 * - "none": 通常（イベント外）
 * - "mini": ミニブ
 * - "full": アメブ
 */
export const defaultBoostKind: BoostEvent = "mini";

/**
 * 既定のアメブ目標Lvの正規化。**保存・読み込み・バックアップ・設定入力で同じ規則を使う。**
 *
 * `null` は「未設定＝目標Lvと同じ」。Lv として意味を持たない入力（空欄・0・負数・数値でない）は
 * すべて未設定へ倒す。**Lv1 に丸めないこと。** Lv1 は「アメブほぼ0本」という別の指定であり、
 * ユーザーが選んでいない値が保存される。
 *
 * 上限を掛け忘れると、`MAX_LEVEL` 超の値が保存されたままエクスポートされ、
 * 自分で書き出したバックアップをバックアップ検証が弾く状態になる。
 */
export function normalizeDefaultBoostReachLevel(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored < 1) return null;
  return Math.min(floored, maxLevel);
}
