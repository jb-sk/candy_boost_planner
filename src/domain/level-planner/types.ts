/**
 * LevelPlanner - 型定義
 *
 * レベルアップ計画に必要な全ての型を定義。
 * 入力（Request）、出力（Result）、内部状態（Working State）を明確に分離。
 */

import type { ExpType, ExpGainNature } from '../types';

// ============================================================
// 定数型
// ============================================================

/** アメブースト種類 */
export type BoostKind = 'none' | 'mini' | 'full';

/** ポケモンタイプ（英語） */
export type PokemonType = string;

/** 不足の種類 */
export type ShortageType = 'candy' | 'boost' | 'shards';

// ============================================================
// Lv+EXP 型（目標・到達点の表現）
// ============================================================

/**
 * Lv+EXP のペア
 * 目標や到達点の正確な表現に使用
 */
export type LevelExp = {
  level: number;
  expInLevel: number;
};

/**
 * Lv+EXP を比較
 * @returns 負: a < b, 0: a == b, 正: a > b
 */
export function compareLevelExp(a: LevelExp, b: LevelExp): number {
  if (a.level !== b.level) return a.level - b.level;
  return a.expInLevel - b.expInLevel;
}

/**
 * aがb以上か（目標達成判定用）
 */
export function isLevelExpReached(current: LevelExp, target: LevelExp): boolean {
  return compareLevelExp(current, target) >= 0;
}

/**
 * 2つの LevelExp のうち小さい方を返す
 */
export function minLevelExp(a: LevelExp, b: LevelExp): LevelExp {
  return compareLevelExp(a, b) <= 0 ? a : b;
}

// ============================================================
// 入力型
// ============================================================

/**
 * レベルアップ計画の入力（1匹のポケモン）
 */
export type PokemonLevelUpRequest = {
  /** 一意識別子 */
  id: string;

  /** 図鑑番号 */
  pokedexId: number;

  /** フォーム（デフォルト: 0） */
  form?: number;

  /** ポケモン名 */
  pokemonName: string;

  /** タイプ（英語） */
  type: PokemonType;

  // ────────────────────────────────────────
  // レベル情報
  // ────────────────────────────────────────

  /** 現在Lv */
  srcLevel: number;

  /** 目標Lv */
  dstLevel: number;

  /** 目標Lv内のEXP（省略時=0: ちょうどdstLevelに到達） */
  dstExpInLevel?: number;

  /** EXPタイプ（600, 900, 1080, 1320） */
  expType: ExpType;

  /** 性格補正（up, neutral, down） */
  nature: ExpGainNature;

  /** 現在Lv内の獲得済みEXP */
  expGot: number;

  // ────────────────────────────────────────
  // 必要量（事前計算済み）
  // ────────────────────────────────────────

  /** 目標Lvまでに必要なアメ数（価値換算） */
  candyNeed: number;

  /** 目標Lvまでに必要なEXP */
  expNeed: number;

  // ────────────────────────────────────────
  // 個数設定
  // ────────────────────────────────────────

  /**
   * アメブ時: ブースト個数（残りは通常アメ）＋ EXP調整
   * 通常時: EXP調整量
   */
  boostOrExpAdjustment: number;

  /**
   * アメ個数指定（第2の目標）
   * 指定した個数を使いたい。使えなければ不足表示
   */
  candyTarget?: number;
};

/**
 * 計画設定
 */
export type PlanConfig = {
  /** アメブースト種類 */
  boostKind: BoostKind;

  /** グローバルアメブ上限 */
  globalBoostLimit: number;

  /** グローバルかけら上限 */
  globalShardsLimit: number;
};

// ============================================================
// 在庫型
// ============================================================

/**
 * タイプアメ在庫
 */
export type TypeCandyStock = {
  s: number;
  m: number;
};

/**
 * 万能アメ在庫
 */
export type UniversalCandyStock = {
  s: number;
  m: number;
  l: number;
};

/**
 * アメ在庫
 */
export type CandyInventory = {
  /** 種族アメ（pokedexId → 個数） */
  species: Record<string, number>;

  /** タイプアメ（タイプ名 → 個数） */
  typeCandy: Record<string, TypeCandyStock>;

  /** 万能アメ */
  universal: UniversalCandyStock;
};

// ============================================================
// 出力型
// ============================================================

/**
 * アイテム使用量
 */
export type ItemUsage = {
  /** 種族アメ使用量 */
  speciesCandy: number;

  /** タイプS使用量 */
  typeS: number;

  /** タイプM使用量 */
  typeM: number;

  /** 万能S使用量 */
  universalS: number;

  /** 万能M使用量 */
  universalM: number;

  /** 万能L使用量 */
  universalL: number;

  /** 配分アイテムの供給価値（余り込み） */
  totalSupply: number;

  /** アメブ個数 */
  boostCount: number;

  /** 通常アメ個数 */
  normalCount: number;

  /** アメ合計（boostCount + normalCount） */
  totalCandyCount: number;

  /** かけら個数 */
  shardsCount: number;

  /** アイテム配分の余り（アメ価値）：配分したアイテムの価値 - 必要アメ価値。万能Sで端数調整し、2以下が理想 */
  surplus: number;
};

/**
 * 不足情報（各リソースの独立した不足量。diagnosis.isXxxShortage に基づいて設定）
 */
export type ShortageInfo = {
  /** アメブ不足量（isBoostShortage 時のみ > 0） */
  boost: number;

  /** 通常アメ不足量（isInventoryShortage 時のみ > 0） */
  normal: number;

  /** アメ合計不足量（isInventoryShortage 時のみ > 0） */
  candy: number;

  /** かけら不足量（isShardsShortage 時のみ > 0） */
  shards: number;
};

/**
 * 到達可能情報
 */
export type ReachableInfo = {
  /** 到達可能レベル */
  level: number;

  /** 到達レベル内で稼いだEXP */
  expInLevel: number;

  /** 到達に使用したアメ数（この制限での仮のcandyNeed） */
  candyUsed: number;
};

/**
 * 制約診断（Lvと獲得EXPで比較し、最も制限的な要因を特定）
 */
export type ConstraintDiagnosis = {
  /** 在庫のみを考慮した場合の到達可能情報 */
  byInventory: ReachableInfo;

  /** アメブ制限を適用した場合の到達可能情報 */
  byBoostLimit: ReachableInfo;

  /** かけら制限を適用した場合の到達可能情報 */
  byShardsLimit: ReachableInfo;

  /** 最も制限的な要因（目標達成時はnull） */
  limitingFactor: ShortageType | null;

  // ────────────────────────────────────────
  // 独立した不足フラグ（各項目が赤字かどうか判定用）
  // ────────────────────────────────────────

  /** アメ在庫不足か（在庫が目標に足りない） */
  isInventoryShortage: boolean;

  /** アメブ上限不足か（アメブ残が理論アメブに足りない） */
  isBoostShortage: boolean;

  /** かけら上限不足か（かけら残が理論かけらに足りない） */
  isShardsShortage: boolean;
};

/**
 * 配分時点のリソース状態（診断用）
 */
export type ResourceSnapshot = {
  /** 配分時点のグローバルアメブ残数 */
  availableBoost: number;

  /** 配分時点のグローバルかけら残数 */
  availableShards: number;

  /** 配分時点のアメ在庫価値（このポケモンが使用可能な量） */
  availableInventoryValue: number;

  /** 配分時点の万能S残数 */
  availableUniversalS: number;
};

/**
 * レベルアップ計画の結果（1匹のポケモン）
 */
export type PokemonLevelUpResult = PokemonLevelUpRequest & {
  // ────────────────────────────────────────
  // 到達情報
  // ────────────────────────────────────────

  /** 到達Lv */
  reachedLevel: number;

  /** あとEXP（次レベルまでのEXP） */
  expToNextLevel: number;

  /** 残EXP（目標Lvまでの残りEXP） */
  expToTarget: number;

  // ────────────────────────────────────────
  // アイテム使用量（到達可能行用）
  // ────────────────────────────────────────

  /** 到達可能行用アイテム使用量（配分結果） */
  reachableItems: ItemUsage;

  // ────────────────────────────────────────
  // 不足情報
  // ────────────────────────────────────────

  /** 不足情報 */
  shortage: ShortageInfo;

  // ────────────────────────────────────────
  // 診断情報
  // ────────────────────────────────────────

  /** 制約診断 */
  diagnosis: ConstraintDiagnosis;

  /** 配分時点のリソース状態 */
  resourceSnapshot: ResourceSnapshot;

  // ────────────────────────────────────────
  // 目標まで行用（常にあり）
  // ────────────────────────────────────────

  /** 目標まで: アメブ必要量 */
  targetBoost: number;

  /** 目標まで: 通常アメ必要量 */
  targetNormal: number;

  /** 目標まで: かけら必要量 */
  targetShards: number;

  /** 目標まで: 必要アイテム詳細 */
  targetItems: ItemUsage;

  // ────────────────────────────────────────
  // 第2目標（個数指定行用、candyTargetがある場合のみ）
  // ────────────────────────────────────────

  /** 第2目標: アメブ必要量 */
  candyTargetBoost?: number;

  /** 第2目標: 通常アメ必要量 */
  candyTargetNormal?: number;

  /** 第2目標: かけら必要量 */
  candyTargetShards?: number;

  /** 第2目標: 必要アイテム詳細 */
  candyTargetItems?: ItemUsage;
};

/**
 * レベルアップ計画の全体結果
 */
export type LevelUpPlanResult = {
  /** 各ポケモンの計画結果 */
  pokemons: PokemonLevelUpResult[];

  // ────────────────────────────────────────
  // 在庫使用サマリー（実使用量）
  // ────────────────────────────────────────

  /** 万能アメ使用量 */
  universalUsed: UniversalCandyStock;

  /** 万能アメ残量 */
  universalRemaining: UniversalCandyStock;

  /** タイプアメ使用量 */
  typeCandyUsed: Record<string, TypeCandyStock>;

  /** 種族アメ使用量 */
  speciesCandyUsed: Record<string, number>;

  // ────────────────────────────────────────
  // 理論値サマリー（目標まで行 or 個数指定行）
  // ────────────────────────────────────────

  /** 理論アメブ合計 */
  theoreticalBoostTotal: number;

  /** 理論通常アメ合計 */
  theoreticalNormalTotal: number;

  /** 理論かけら合計 */
  theoreticalShardsTotal: number;

  // ────────────────────────────────────────
  // 実使用サマリー（到達可能行）
  // ────────────────────────────────────────

  /** 実使用アメブ合計 */
  actualBoostTotal: number;

  /** 実使用通常アメ合計 */
  actualNormalTotal: number;

  /** 実使用かけら合計 */
  actualShardsTotal: number;

  // ────────────────────────────────────────
  // 不足サマリー
  // ────────────────────────────────────────

  /** アメ不足しているポケモン */
  candyShortages: Array<{ id: string; pokemonName: string; shortage: number }>;

  /** かけら不足しているポケモン */
  shardsShortages: Array<{ id: string; pokemonName: string; shortage: number }>;

  /** アメ不足合計 */
  totalCandyShortage: number;

  /** かけら不足合計 */
  totalShardsShortage: number;

  // ────────────────────────────────────────
  // ランキング
  // ────────────────────────────────────────

  /** 万能アメ消費ランキング（実使用、価値順） */
  itemUsageRanking: ItemUsageRankingEntry[];

  // ────────────────────────────────────────
  // 合計
  // ────────────────────────────────────────

  /** 必要アメ合計 */
  totalNeed: number;

  /** 供給アメ合計 */
  totalSupplied: number;
};

/**
 * アイテム消費ランキングのエントリ
 */
export type ItemUsageRankingEntry = {
  id: string;
  pokemonName: string;
  /** タイプアメS */
  typeS: number;
  /** タイプアメM */
  typeM: number;
  /** 万能S */
  universalS: number;
  /** 万能M */
  universalM: number;
  /** 万能L */
  universalL: number;
  /** 合計価値（ランキングソート用） */
  totalValue: number;
};

// ============================================================
// 内部作業型
// ============================================================

/**
 * Phase処理中のポケモン状態
 *
 * 新フェーズ設計:
 * - フェーズ1: 配分と制約適用（ポケモンごとに順番・完結）
 * - フェーズ2: スワップ（全ポケモン）
 * - フェーズ3: 結果構築
 */
export type PokemonWorkingState = PokemonLevelUpRequest & {
  // ────────────────────────────────────────
  // 到達情報（フェーズ1で設定）
  // ────────────────────────────────────────

  /** 現在の到達Lv */
  reachedLevel: number;

  /** あとEXP（次レベルまでのEXP） */
  expToNextLevel?: number;

  /** 残EXP（目標までのEXP） */
  expToTarget?: number;

  // ────────────────────────────────────────
  // 目標まで行（フェーズ1で計算、フェーズ3で補填）
  // ────────────────────────────────────────

  /** 目標まで行: 必要アイテム（補填前→フェーズ3で補填） */
  targetItems: ItemUsage;

  /** 目標まで行: アメブ必要量 */
  targetBoost?: number;

  /** 目標まで行: 通常アメ必要量 */
  targetNormal?: number;

  /** 目標まで行: かけら必要量 */
  targetShards?: number;

  // ────────────────────────────────────────
  // 個数指定行（フェーズ1で計算、フェーズ3で補填、candyTarget がある場合のみ）
  // ────────────────────────────────────────

  /** 個数指定行: 必要アイテム（補填前→フェーズ3で補填） */
  candyTargetItems?: ItemUsage;

  /** 個数指定行: アメブ必要量 */
  candyTargetBoost?: number;

  /** 個数指定行: 通常アメ必要量 */
  candyTargetNormal?: number;

  /** 個数指定行: かけら必要量 */
  candyTargetShards?: number;

  // ────────────────────────────────────────
  // 到達可能行（フェーズ1で設定、補填なし）
  // ────────────────────────────────────────

  /** 到達可能行: 実使用アイテム */
  reachableItems: ItemUsage;

  // ────────────────────────────────────────
  // 診断・不足情報（フェーズ1で設定）
  // ────────────────────────────────────────

  /** 各制約での到達可能情報 */
  diagnosis?: ConstraintDiagnosis;

  /** 配分時点のリソース状態 */
  resourceSnapshot?: ResourceSnapshot;

  /** 不足情報 */
  shortage?: ShortageInfo;
};

/**
 * Phase処理の状態
 */
export type PhaseState = {
  /** 処理中のポケモンリスト */
  pokemons: PokemonWorkingState[];

  /** 現在の在庫状態（可変） */
  inventory: CandyInventory;

  /** グローバルアメブ残数 */
  boostRemaining: number;

  /** グローバルかけら残数 */
  shardsRemaining: number;
};

/**
 * 計画コンテキスト
 */
export type PlanContext = {
  /** 設定 */
  config: PlanConfig;

  /** 初期在庫（参照用、変更しない） */
  initialInventory: Readonly<CandyInventory>;
};

// ============================================================
// ヘルパー用の型
// ============================================================

/**
 * アイテム配分の探索結果
 */
export type ItemAllocationResult = {
  typeS: number;
  typeM: number;
  universalS: number;
  universalM: number;
  universalL: number;
  supplied: number;
};

/**
 * 万能アメのみの配分結果
 */
export type UniversalAllocationResult = {
  s: number;
  m: number;
  l: number;
  supplied: number;
};
