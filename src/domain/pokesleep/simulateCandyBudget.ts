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

/**
 * ブースト予算 boostBudget 個・総予算 totalBudget 個を消費して到達する地点。
 *
 * 「目標までに必要なアメ数」ではなく「与えた予算でどこまで届くか」を求める。
 * ソルバー（solveLevelPlan）と目標導出（deriveTarget）の両方から共有される。
 * UI から solveLevelPlan を静的 import しないよう、独立モジュールに置いている。
 *
 * @param fixedBoost true なら、ブースト予算を消費できなくなった時点で打ち切る（通常アメへフォールバックしない）
 */
export function simulateCandyBudget(
  pokemon: CandyBudgetSubject,
  boostBudget: number,
  totalBudget: number,
  shardLimit: number,
  kind: BoostEvent,
  fixedBoost = false,
): CandyBudgetResult {
  let level = pokemon.currentLevel;
  let expInLevel = pokemon.currentExpInLevel;
  let boost = Math.max(0, Math.floor(boostBudget));
  let remaining = Math.max(0, Math.floor(totalBudget));
  let boostUsed = 0; let normalUsed = 0; let shards = 0;
  const useCandy = (isBoost: boolean): boolean => {
    if (remaining <= 0 || level >= maxLevel) return false;
    if (isBoost && boost <= 0) return false;
    const shard = (dreamShardsPerCandy[level + 1] ?? 0) * (isBoost ? boostRules[kind].shardMultiplier : 1);
    if (shards + shard > shardLimit) return false;
    if (isBoost) { boost--; boostUsed++; } else normalUsed++;
    remaining--;
    expInLevel += calcExpPerCandy(level, pokemon.nature, isBoost ? kind : 'none');
    shards += shard;
    while (level < maxLevel) {
      const needed = calcExp(level, level + 1, pokemon.expType);
      if (expInLevel < needed) break;
      expInLevel -= needed;
      level++;
    }
    return true;
  };
  while (remaining > 0 && level < maxLevel) {
    if (boost > 0) {
      if (useCandy(true)) continue;
      if (fixedBoost) break;
    }
    if (!useCandy(false)) break;
  }
  const expGained = calcExp(pokemon.currentLevel, level, pokemon.expType) + expInLevel - pokemon.currentExpInLevel;
  return { level, expInLevel: level >= maxLevel ? 0 : expInLevel, boostUsed, normalUsed, shards, expGained };
}
