import { MAX_GROWTH_INCENSE_STOCK, type GrowthIncenseGsdDays, type GrowthIncenseStock } from "../types";

export const DEFAULT_GROWTH_INCENSE_GSD_DAYS: GrowthIncenseGsdDays = {
  beforeFullMoon: false,
  fullMoon: false,
  afterFullMoon: false,
};

export function normalizeGrowthIncenseGsdDays(value: unknown): GrowthIncenseGsdDays | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.beforeFullMoon !== "boolean"
    || typeof candidate.fullMoon !== "boolean"
    || typeof candidate.afterFullMoon !== "boolean"
  ) {
    return null;
  }
  return {
    beforeFullMoon: candidate.beforeFullMoon,
    fullMoon: candidate.fullMoon,
    afterFullMoon: candidate.afterFullMoon,
  };
}

/**
 * 手持ちの成長のお香。**`null`（無制限）は有効な値**なので、受け付けられない入力は `undefined` で返す。
 *
 * 保存の読み込みと設定画面の入力で同じ規則を使う（上限・下限を二重に書かない）。
 * 壊れた値を 0（1個も使えない）へ倒すと計画が別物になるため、無効は「未設定」として扱う。
 */
export function normalizeGrowthIncenseStock(value: unknown): GrowthIncenseStock | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value >= 0 && value <= MAX_GROWTH_INCENSE_STOCK ? value : undefined;
}

/** 未リリース版で一時的に保存していた5択を、独立した3日指定へ移す。 */
export function migrateGrowthIncenseGsdPolicy(value: unknown): GrowthIncenseGsdDays | null {
  switch (value) {
    case "none":
      return { beforeFullMoon: false, fullMoon: false, afterFullMoon: false };
    case "fullMoon":
      return { beforeFullMoon: false, fullMoon: true, afterFullMoon: false };
    case "oneFlank":
      return { beforeFullMoon: true, fullMoon: false, afterFullMoon: false };
    case "bothFlanks":
      return { beforeFullMoon: true, fullMoon: false, afterFullMoon: true };
    case "all":
      return { beforeFullMoon: true, fullMoon: true, afterFullMoon: true };
    default:
      return null;
  }
}
