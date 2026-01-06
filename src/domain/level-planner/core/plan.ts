/**
 * LevelPlanner - コア関数
 *
 * レベルアップ計画のメインエントリポイント。
 * 各Phaseを順番に実行し、最終結果を返す。
 *
 * 新Phase構成（3Phase）:
 * - Phase 1: Allocate（配分 + 制約適用、ポケモンごとに完結）
 * - Phase 2: Swap（M/L→Sスワップ最適化）
 * - Phase 3: Finalize（補填 + サマリー構築 + 結果構築）
 *
 * UI は戻り値の LevelUpPlanResult を直接使用する。
 * サマリー（理論値/実使用の両方）は Phase 3 で計算済み。
 */

import type {
  PokemonLevelUpRequest,
  CandyInventory,
  PlanConfig,
  LevelUpPlanResult,
} from '../types';
import { createContext, initializePhaseState } from '../context';
import {
  applyPhase1Allocate,
  applyPhase2Swap,
  applyPhase3Finalize,
} from '../phases';

/**
 * レベルアップ計画を立てる
 *
 * 複数のポケモンに対して、在庫と制約を考慮しながら
 * 最適なアイテム配分と到達可能レベルを計算する。
 *
 * @param requests 各ポケモンのレベルアップ要求（優先順位順）
 * @param inventory アメ在庫
 * @param config 計画設定（ブースト種類、グローバル制限）
 * @returns 計画結果（サマリー含む）
 */
export function planLevelUp(
  requests: PokemonLevelUpRequest[],
  inventory: CandyInventory,
  config: PlanConfig
): LevelUpPlanResult {
  // コンテキストを作成
  const context = createContext(inventory, config);

  // 初期状態を作成
  let state = initializePhaseState(requests, inventory, config);

  // 各Phaseを順番に実行（新3Phase構成）
  state = applyPhase1Allocate(state, context);  // 配分 + 制約適用
  state = applyPhase2Swap(state);              // M/L→Sスワップ

  // Phase 3 は LevelUpPlanResult を返す（サマリー含む）
  return applyPhase3Finalize(state);
}
