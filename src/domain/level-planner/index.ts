/**
 * LevelPlanner - 公開API
 *
 * レベルアップ計画モジュール。
 * ポケモンのレベルアップに必要なアメ配分を計算する。
 */

// ────────────────────────────────────────
// 型定義
// ────────────────────────────────────────
export type {
  // 入力型
  PokemonLevelUpRequest,
  PlanConfig,
  CandyInventory,
  TypeCandyStock,
  UniversalCandyStock,

  // 出力型
  LevelUpPlanResult,
  PokemonLevelUpResult,
  ItemUsage,
  ShortageInfo,
  ConstraintDiagnosis,
  ReachableInfo,
  ResourceSnapshot,
  ItemUsageRankingEntry,

  // 定数型
  BoostKind,
  ShortageType,
  PokemonType,
} from './types';

// ────────────────────────────────────────
// 定数
// ────────────────────────────────────────
export {
  CANDY_VALUES,
  BOOST_EXP_MULTIPLIER,
  BOOST_SHARDS_MULTIPLIER,
  MAX_ACCEPTABLE_SURPLUS,
  ITEM_PRIORITY,
  calcItemValue,
  calcInventoryValue,
} from './constants';

// ────────────────────────────────────────
// コア関数
// ────────────────────────────────────────
export { planLevelUp } from './core';

// ────────────────────────────────────────
// ヘルパー（上級者向け）
// ────────────────────────────────────────
export {
  findBestItemAllocation,
  findBestUniversalAllocation,
} from './helpers';

// ────────────────────────────────────────
// コンテキスト（上級者向け）
// ────────────────────────────────────────
export {
  createContext,
  initializePhaseState,
  createEmptyItemUsage,
  cloneInventory,
} from './context';
