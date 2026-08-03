import type { BoostEvent, ExpGainNature, ExpType } from "../types";
import { calcExp, calcExpPerCandy } from "./exp";
import { boostRules } from "./boost-config";
import { dreamShardsPerCandy, maxLevel } from "./tables";

export type CandyBudgetSubject = {
  currentLevel: number;
  currentExpInLevel: number;
  expType: ExpType;
  nature: ExpGainNature;
};

export type CandyBudgetResult = {
  level: number;
  expInLevel: number;
  boostUsed: number;
  normalUsed: number;
  shards: number;
  expGained: number;
};

export type CandyRunSpec = {
  boostBudget: number;
  normalBudget: number;
  totalCap: number;
  shardLimit: number;
  kind: BoostEvent;
  /** false を返した時点で消費を止める。 */
  shouldContinue: (level: number, expInLevel: number) => boolean;
};

/**
 * アメブ優先・かけら課金・EXP加算を一意に実装する消費中核。
 *
 * 呼び出し元ごとの差は、アメブ／通常アメの別枠、総数上限、停止条件だけで表す。
 * **アメブ予算が残っている間は、かけら不足を理由に通常アメへ振り替えない。**
 */
export function simulateCandyRun(
  pokemon: CandyBudgetSubject,
  spec: CandyRunSpec,
): CandyBudgetResult {
  let level = pokemon.currentLevel;
  let expInLevel = pokemon.currentExpInLevel;
  let boost = spec.kind === "none" ? 0 : Math.max(0, Math.floor(spec.boostBudget));
  let normal = Math.max(0, Math.floor(spec.normalBudget));
  const totalCap = Math.max(0, Math.floor(spec.totalCap));
  let boostUsed = 0; let normalUsed = 0; let shards = 0;
  const useCandy = (isBoost: boolean): boolean => {
    if (level >= maxLevel) return false;
    const available = isBoost ? boost : normal;
    if (available <= 0) return false;
    const shard = (dreamShardsPerCandy[level + 1] ?? 0)
      * (isBoost ? boostRules[spec.kind].shardMultiplier : 1);
    if (shards + shard > spec.shardLimit) return false;
    if (isBoost) { boost--; boostUsed++; } else { normal--; normalUsed++; }
    expInLevel += calcExpPerCandy(level, pokemon.nature, isBoost ? spec.kind : 'none');
    shards += shard;
    while (level < maxLevel) {
      const needed = calcExp(level, level + 1, pokemon.expType);
      if (expInLevel < needed) break;
      expInLevel -= needed;
      level++;
    }
    return true;
  };
  while (
    level < maxLevel
    && boostUsed + normalUsed < totalCap
    && spec.shouldContinue(level, expInLevel)
  ) {
    if (boost > 0) {
      if (!useCandy(true)) break;
      continue;
    }
    if (!useCandy(false)) break;
  }
  const expGained = calcExp(pokemon.currentLevel, level, pokemon.expType)
    + expInLevel
    - pokemon.currentExpInLevel;
  return {
    level,
    expInLevel: level >= maxLevel ? 0 : expInLevel,
    boostUsed,
    normalUsed,
    shards,
    expGained,
  };
}

/**
 * ブースト予算 boostBudget 個・総予算 totalBudget 個を消費して到達する地点。
 *
 * 「目標までに必要なアメ数」ではなく「与えた予算でどこまで届くか」を求める。
 * ソルバー（solveLevelPlan）と目標導出（deriveTarget）の両方から共有される。
 * UI から solveLevelPlan を静的 import しないよう、独立モジュールに置いている。
 *
 * **アメブ予算が残っている間は、かけら不足を理由に通常アメへ振り替えない。**
 * 振り替えると、ユーザーが選んでいないアメブ／通常アメの内訳が黙って作られる。
 * アメブを減らしてよいのはグローバル残数を超えているときだけで、その切り詰めは
 * 呼び出し側が `boostBudget` に反映してから渡す。solveLevelPlan の `simulate` と同じ規則。
 */
export function simulateCandyBudget(
  pokemon: CandyBudgetSubject,
  boostBudget: number,
  totalBudget: number,
  shardLimit: number,
  kind: BoostEvent,
): CandyBudgetResult {
  return simulateCandyRun(pokemon, {
    boostBudget,
    normalBudget: Infinity,
    totalCap: totalBudget,
    shardLimit,
    kind,
    shouldContinue: () => true,
  });
}
