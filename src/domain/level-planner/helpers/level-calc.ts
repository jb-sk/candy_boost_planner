/**
 * LevelPlanner - レベル計算ヘルパー
 *
 * 各制約での到達可能レベル計算、制約診断などのロジック。
 */

import type {
  ShortageType,
  ReachableInfo,
  ConstraintDiagnosis,
  PokemonWorkingState,
  BoostKind,
} from '../types';
import { calcLevelByCandy, calcLevelByCandyAndShards, calcExp } from '../../pokesleep/exp';
import type { ExpType, ExpGainNature } from '../../types';

// ============================================================
// 到達可能レベル計算
// ============================================================

/**
 * アメのみで到達可能なレベルを計算（かけら制限なし）
 */
export function calcReachableByCandy(
  srcLevel: number,
  dstLevel: number,
  expType: ExpType,
  nature: ExpGainNature,
  boostKind: BoostKind,
  candyValue: number,
  expGot: number
): ReachableInfo {
  if (candyValue <= 0 || srcLevel >= dstLevel) {
    return { level: srcLevel, expInLevel: expGot, candyUsed: 0 };
  }

  const result = calcLevelByCandy({
    srcLevel,
    dstLevel,
    expType,
    nature,
    boost: boostKind,
    candy: candyValue,
    expGot,
  });

  return {
    level: result.level,
    expInLevel: result.expGot,
    candyUsed: result.candyUsed,
  };
}

/**
 * アメブ制限を適用して到達可能なレベルを計算（かけら制限なし）
 *
 * @param boostCandyValue アメブとして使用可能な価値
 * @param normalCandyValue 通常アメとして使用する価値
 */
export function calcReachableByBoostLimit(
  srcLevel: number,
  dstLevel: number,
  expType: ExpType,
  nature: ExpGainNature,
  boostKind: BoostKind,
  boostCandyValue: number,
  normalCandyValue: number,
  expGot: number
): ReachableInfo {
  if (boostKind === 'none') {
    // ブーストなしの場合は通常計算
    return calcReachableByCandy(
      srcLevel,
      dstLevel,
      expType,
      nature,
      'none',
      normalCandyValue,
      expGot
    );
  }

  // アメブ部分
  const boostResult = boostCandyValue > 0
    ? calcLevelByCandy({
      srcLevel,
      dstLevel,
      expType,
      nature,
      boost: boostKind,
      candy: boostCandyValue,
      expGot,
    })
    : { level: srcLevel, expGot, shards: 0, candyUsed: 0 };

  // 通常アメ部分（アメブ後のレベルから）
  const normalResult = normalCandyValue > 0
    ? calcLevelByCandy({
      srcLevel: boostResult.level,
      dstLevel,
      expType,
      nature,
      boost: 'none',
      candy: normalCandyValue,
      expGot: boostResult.expGot,
    })
    : { level: boostResult.level, expGot: boostResult.expGot, shards: 0, candyUsed: 0 };

  return {
    level: normalResult.level,
    expInLevel: normalResult.expGot,
    candyUsed: (boostResult.candyUsed ?? 0) + (normalResult.candyUsed ?? 0),
  };
}

/**
 * かけら制限を適用して到達可能なレベルを計算
 */
export function calcReachableByShardsLimit(
  srcLevel: number,
  dstLevel: number,
  expType: ExpType,
  nature: ExpGainNature,
  boostKind: BoostKind,
  candyValue: number,
  shardsLimit: number,
  expGot: number
): ReachableInfo & { candyUsed: number; shardsUsed: number } {
  if (candyValue <= 0 || srcLevel >= dstLevel) {
    return { level: srcLevel, expInLevel: expGot, candyUsed: 0, shardsUsed: 0 };
  }

  const result = calcLevelByCandyAndShards({
    srcLevel,
    dstLevel,
    expType,
    nature,
    boost: boostKind,
    candy: candyValue,
    shardsLimit,
    expGot,
  });

  return {
    level: result.level,
    expInLevel: result.expGot,
    candyUsed: result.candyUsed,
    shardsUsed: result.shards,
  };
}

// ============================================================
// 制約診断
// ============================================================

/**
 * 最も制限的な要因を判定する
 *
 * 3つの制約（在庫、アメブ、かけら）での到達可能レベル+EXPを比較し、
 * 最も低いレベル（同レベルなら最小EXP）を引き起こす制約を返す。
 *
 * @returns 最も制限的な要因（目標達成時はnull）
 */
export function determineLimitingFactor(
  byInventory: ReachableInfo,
  byBoostLimit: ReachableInfo,
  byShardsLimit: ReachableInfo,
  dstLevel: number
): ShortageType | null {
  // 目標達成時はnull
  if (byShardsLimit.level >= dstLevel) {
    return null;
  }

  // 各制約をタプルとして比較
  type Factor = { type: ShortageType; level: number; exp: number };
  const factors: Factor[] = [
    { type: 'candy', level: byInventory.level, exp: byInventory.expInLevel },
    { type: 'boost', level: byBoostLimit.level, exp: byBoostLimit.expInLevel },
    { type: 'shards', level: byShardsLimit.level, exp: byShardsLimit.expInLevel },
  ];

  // レベルが低い順、同レベルならEXPが低い順にソート
  // 同値の場合の優先順位: inventory > boost > shards（配列順が維持される）
  factors.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return a.exp - b.exp;
  });

  return factors[0].type;
}

/**
 * 制約診断を実行
 */
export function diagnoseConstraints(
  pokemon: PokemonWorkingState,
  byInventory: ReachableInfo,
  byBoostLimit: ReachableInfo,
  byShardsLimit: ReachableInfo
): ConstraintDiagnosis {
  // 独立した不足フラグを計算
  const isInventoryShortage = byInventory.level < pokemon.dstLevel;
  const isBoostShortage = byBoostLimit.level < byInventory.level
    || (byBoostLimit.level === byInventory.level && byBoostLimit.expInLevel < byInventory.expInLevel);
  const isShardsShortage = byShardsLimit.level < byBoostLimit.level
    || (byShardsLimit.level === byBoostLimit.level && byShardsLimit.expInLevel < byBoostLimit.expInLevel);

  return {
    byInventory,
    byBoostLimit,
    byShardsLimit,
    limitingFactor: determineLimitingFactor(
      byInventory,
      byBoostLimit,
      byShardsLimit,
      pokemon.dstLevel
    ),
    isInventoryShortage,
    isBoostShortage,
    isShardsShortage,
  };
}

// ============================================================
// EXP計算ヘルパー
// ============================================================

/**
 * 到達レベルでの残りEXPを計算
 */
export function calcRemainingExpInLevel(
  level: number,
  expInLevel: number,
  expType: ExpType
): number {
  if (level <= 0) return 0;
  const expToNextLevel = calcExp(level, level + 1, expType);
  return Math.max(0, expToNextLevel - expInLevel);
}

/**
 * 目標レベルまでの残りEXPを計算
 */
export function calcRemainingExpToTarget(
  currentLevel: number,
  currentExpInLevel: number,
  dstLevel: number,
  expType: ExpType
): number {
  if (currentLevel >= dstLevel) return 0;
  const totalExpNeeded = calcExp(currentLevel, dstLevel, expType);
  return Math.max(0, totalExpNeeded - currentExpInLevel);
}
