/**
 * LevelPlanner - 計画コンテキスト
 *
 * 計画実行に必要な設定と初期状態を保持する不変オブジェクト。
 * 各Phaseはこのコンテキストを参照しながら処理を行う。
 */

import type {
  CandyInventory,
  PlanConfig,
  PlanContext,
  PhaseState,
  PokemonLevelUpRequest,
  PokemonWorkingState,
  ItemUsage,
} from './types';

// ============================================================
// コンテキスト生成
// ============================================================

/**
 * 計画コンテキストを生成
 */
export function createContext(
  inventory: CandyInventory,
  config: PlanConfig
): PlanContext {
  return {
    config,
    initialInventory: deepFreeze(structuredClone(inventory)),
  };
}

// ============================================================
// 初期状態生成
// ============================================================

/**
 * 空のアイテム使用量を生成
 */
export function createEmptyItemUsage(): ItemUsage {
  return {
    speciesCandy: 0,
    typeS: 0,
    typeM: 0,
    universalS: 0,
    universalM: 0,
    universalL: 0,
    totalSupply: 0,
    boostCount: 0,
    normalCount: 0,
    totalCandyCount: 0,
    shardsCount: 0,
    surplus: 0,
  };
}

/**
 * リクエストから作業状態を初期化
 */
export function initializeWorkingState(
  request: PokemonLevelUpRequest,
  _config: PlanConfig
): PokemonWorkingState {
  return {
    ...request,
    reachedLevel: request.srcLevel,
    reachableItems: createEmptyItemUsage(),
    targetItems: createEmptyItemUsage(),
  };
}

/**
 * Phase処理の初期状態を生成
 */
export function initializePhaseState(
  requests: PokemonLevelUpRequest[],
  inventory: CandyInventory,
  config: PlanConfig
): PhaseState {
  return {
    pokemons: requests.map(req => initializeWorkingState(req, config)),
    inventory: structuredClone(inventory),
    boostRemaining: config.globalBoostLimit,
    shardsRemaining: config.globalShardsLimit,
  };
}

// ============================================================
// 在庫操作
// ============================================================

/**
 * 在庫をディープコピー
 */
export function cloneInventory(inventory: CandyInventory): CandyInventory {
  return structuredClone(inventory);
}

/**
 * 種族アメを消費
 */
export function consumeSpeciesCandy(
  inventory: CandyInventory,
  pokedexId: number,
  amount: number
): void {
  const key = String(pokedexId);
  inventory.species[key] = Math.max(0, (inventory.species[key] ?? 0) - amount);
}

/**
 * タイプアメを消費
 */
export function consumeTypeCandy(
  inventory: CandyInventory,
  type: string,
  sAmount: number,
  mAmount: number
): void {
  if (!inventory.typeCandy[type]) {
    inventory.typeCandy[type] = { s: 0, m: 0 };
  }
  inventory.typeCandy[type].s = Math.max(0, inventory.typeCandy[type].s - sAmount);
  inventory.typeCandy[type].m = Math.max(0, inventory.typeCandy[type].m - mAmount);
}

/**
 * 万能アメを消費
 */
export function consumeUniversalCandy(
  inventory: CandyInventory,
  sAmount: number,
  mAmount: number,
  lAmount: number
): void {
  inventory.universal.s = Math.max(0, inventory.universal.s - sAmount);
  inventory.universal.m = Math.max(0, inventory.universal.m - mAmount);
  inventory.universal.l = Math.max(0, inventory.universal.l - lAmount);
}

/**
 * 種族アメを返却
 */
export function returnSpeciesCandy(
  inventory: CandyInventory,
  pokedexId: number,
  amount: number
): void {
  const key = String(pokedexId);
  inventory.species[key] = (inventory.species[key] ?? 0) + amount;
}

/**
 * タイプアメを返却
 */
export function returnTypeCandy(
  inventory: CandyInventory,
  type: string,
  sAmount: number,
  mAmount: number
): void {
  if (!inventory.typeCandy[type]) {
    inventory.typeCandy[type] = { s: 0, m: 0 };
  }
  inventory.typeCandy[type].s += sAmount;
  inventory.typeCandy[type].m += mAmount;
}

/**
 * 万能アメを返却
 */
export function returnUniversalCandy(
  inventory: CandyInventory,
  sAmount: number,
  mAmount: number,
  lAmount: number
): void {
  inventory.universal.s += sAmount;
  inventory.universal.m += mAmount;
  inventory.universal.l += lAmount;
}

// ============================================================
// ユーティリティ
// ============================================================

/**
 * オブジェクトを再帰的にフリーズ
 */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      deepFreeze(value);
    }
  }
  return obj;
}
