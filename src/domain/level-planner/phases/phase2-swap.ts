/**
 * LevelPlanner - Phase 2: スワップ最適化
 *
 * 下位ポケモンの余りが ≥ 3 の場合、上位ポケモンとアイテムをスワップして
 * 余りを ≤ 2 にする。
 *
 * スワップ対象:
 * 1. 理論値目標行同士（candyTargetItems ?? targetItems）
 * 2. 到達可能行同士（reachableItems）
 *
 * アルゴリズム:
 * 1. 下位ポケモンから順に、余り ≥ 3 のものを探す
 * 2. M/L を減らして S で補填するパターンを探索
 * 3. 上位ポケモンから S を取得（上位に M/L を渡す）
 * 4. 両方の余り ≤ 2 を維持できる場合のみスワップ実行
 */

import type { PhaseState, PokemonWorkingState, ItemUsage } from '../types';
import { CANDY_VALUES, MAX_ACCEPTABLE_SURPLUS } from '../constants';

// ============================================================
// 型定義
// ============================================================

/** M/L を減らして S で補填するパターン */
type ReductionPattern = {
  mToRemove: number;
  lToRemove: number;
  sToAdd: number;
  newSurplus: number;
};

/** 上位ポケモンの更新情報 */
type UpperUpdate = {
  index: number;
  newItems: ItemUsage;
};

/** スワップ結果 */
type SwapResult = {
  newLowerItems: ItemUsage;
  upperUpdates: UpperUpdate[];
};

// ============================================================
// メインエントリポイント
// ============================================================

/**
 * Phase 2: スワップ最適化
 */
export function applyPhase2Swap(
  state: PhaseState
): PhaseState {
  let pokemons = [...state.pokemons];

  // 1. 理論値目標行同士でスワップ
  pokemons = performSwap(
    pokemons,
    getTheoreticalTargetRow,
    setTheoreticalTargetRow,
    getTheoreticalNeed
  );

  // 2. 到達可能行同士でスワップ
  pokemons = performSwap(
    pokemons,
    p => p.reachableItems,
    (p, items) => ({ ...p, reachableItems: items }),
    p => p.reachableItems.totalSupply - p.reachableItems.surplus
  );

  return { ...state, pokemons };
}

// ============================================================
// 理論値目標行のアクセサ
// ============================================================

/** 理論値目標行を取得 */
function getTheoreticalTargetRow(p: PokemonWorkingState): ItemUsage {
  return p.candyTargetItems ?? p.targetItems;
}

/** 理論値目標行を設定 */
function setTheoreticalTargetRow(
  p: PokemonWorkingState,
  items: ItemUsage
): PokemonWorkingState {
  if (p.candyTargetItems !== undefined) {
    return { ...p, candyTargetItems: items };
  } else {
    return { ...p, targetItems: items };
  }
}

/** 理論値目標行のアメ必要量 */
function getTheoreticalNeed(p: PokemonWorkingState): number {
  return p.candyTarget ?? p.candyNeed;
}

// ============================================================
// 汎用スワップ関数
// ============================================================

/**
 * 汎用スワップ関数
 *
 * 下位ポケモンから順に処理し、余り ≥ 3 のものを M/L → S 置換で最適化。
 * 上位ポケモンから S を取得し、代わりに M/L を渡す。
 */
function performSwap(
  pokemons: PokemonWorkingState[],
  getItems: (p: PokemonWorkingState) => ItemUsage,
  setItems: (p: PokemonWorkingState, items: ItemUsage) => PokemonWorkingState,
  getNeed: (p: PokemonWorkingState) => number
): PokemonWorkingState[] {
  const result = [...pokemons];

  // 下位ポケモンから順に処理
  for (let i = result.length - 1; i >= 0; i--) {
    const lower = result[i];
    const lowerItems = getItems(lower);

    // 余り ≤ 2 なら調整不要
    if (lowerItems.surplus <= MAX_ACCEPTABLE_SURPLUS) continue;

    // M も L も使っていなければスキップ
    if (lowerItems.universalM <= 0 && lowerItems.universalL <= 0) continue;

    // 万能アメで埋める必要量
    const lowerNeed = getNeed(lower);
    const universalNeed = calcUniversalNeed(lowerItems, lowerNeed);
    if (universalNeed <= 0) continue;

    // L/M を減らすパターンを探索
    const pattern = findReductionPattern(lowerItems, universalNeed);
    if (!pattern) continue;

    // 上位ポケモンとスワップを試行
    const uppers = result.slice(0, i);
    const swapResult = trySwapWithUppers(
      lowerItems,
      uppers,
      pattern,
      getItems,
      getNeed
    );

    if (swapResult) {
      // スワップ成功: ポケモンの状態を更新
      result[i] = setItems(lower, swapResult.newLowerItems);
      for (const update of swapResult.upperUpdates) {
        result[update.index] = setItems(result[update.index], update.newItems);
      }
    }
  }

  return result;
}

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * 万能アメで埋める必要量を計算
 */
function calcUniversalNeed(items: ItemUsage, candyNeed: number): number {
  return candyNeed
    - items.speciesCandy * CANDY_VALUES.species
    - items.typeS * CANDY_VALUES.type.s
    - items.typeM * CANDY_VALUES.type.m;
}

/**
 * L/M を減らして S で補填するパターンを探索
 * L は M より価値が大きいので先に減らす
 */
function findReductionPattern(
  items: ItemUsage,
  universalNeed: number
): ReductionPattern | null {
  const currentSSupply = items.universalS * CANDY_VALUES.universal.s;
  const currentMSupply = items.universalM * CANDY_VALUES.universal.m;
  const currentLSupply = items.universalL * CANDY_VALUES.universal.l;

  let best: ReductionPattern | null = null;

  // L を減らすパターン（L は価値が大きいので先に試行）
  for (let lRemove = 1; lRemove <= items.universalL; lRemove++) {
    const pattern = tryReductionPattern(
      universalNeed,
      currentSSupply,
      currentMSupply,
      currentLSupply - lRemove * CANDY_VALUES.universal.l,
      0,
      lRemove
    );
    if (pattern && pattern.newSurplus <= MAX_ACCEPTABLE_SURPLUS) {
      if (!best || pattern.sToAdd < best.sToAdd) {
        best = pattern;
      }
    }
  }

  // M を減らすパターン
  for (let mRemove = 1; mRemove <= items.universalM; mRemove++) {
    const pattern = tryReductionPattern(
      universalNeed,
      currentSSupply,
      currentMSupply - mRemove * CANDY_VALUES.universal.m,
      currentLSupply,
      mRemove,
      0
    );
    if (pattern && pattern.newSurplus <= MAX_ACCEPTABLE_SURPLUS) {
      if (!best || pattern.sToAdd < best.sToAdd) {
        best = pattern;
      }
    }
  }

  return best;
}

/**
 * 減少パターンを試行
 */
function tryReductionPattern(
  universalNeed: number,
  currentSSupply: number,
  newMSupply: number,
  newLSupply: number,
  mRemove: number,
  lRemove: number
): ReductionPattern | null {
  const newSupplyWithoutExtraS = currentSSupply + newMSupply + newLSupply;
  const shortage = universalNeed - newSupplyWithoutExtraS;

  if (shortage <= 0) return null;

  const sToAdd = Math.ceil(shortage / CANDY_VALUES.universal.s);
  const newSSupply = currentSSupply + sToAdd * CANDY_VALUES.universal.s;
  const newTotal = newSSupply + newMSupply + newLSupply;
  const newSurplus = newTotal - universalNeed;

  return { mToRemove: mRemove, lToRemove: lRemove, sToAdd, newSurplus };
}

/**
 * 上位ポケモンとスワップを試行
 */
function trySwapWithUppers(
  lowerItems: ItemUsage,
  uppers: PokemonWorkingState[],
  pattern: ReductionPattern,
  getItems: (p: PokemonWorkingState) => ItemUsage,
  getNeed: (p: PokemonWorkingState) => number
): SwapResult | null {
  let sObtained = 0;
  const upperUpdates: UpperUpdate[] = [];
  let remainingMToGive = pattern.mToRemove;
  let remainingLToGive = pattern.lToRemove;

  for (let j = 0; j < uppers.length && sObtained < pattern.sToAdd; j++) {
    const upper = uppers[j];
    const upperItems = getItems(upper);

    // S がなければスキップ
    if (upperItems.universalS <= 0) continue;

    const upperNeed = getNeed(upper);
    const upperUniversalNeed = calcUniversalNeed(upperItems, upperNeed);
    if (upperUniversalNeed <= 0) continue;

    // 取得可能な S の量（下位がまだ必要な量を上限に）
    const sNeeded = pattern.sToAdd - sObtained;
    const sToTry = Math.min(sNeeded, upperItems.universalS);

    for (let tryGive = sToTry; tryGive >= 1; tryGive--) {
      const mToGive = Math.min(remainingMToGive, pattern.mToRemove);
      const lToGive = Math.min(remainingLToGive, pattern.lToRemove);

      // 上位が M/L を受け取った後のアイテムと、下位に渡す S の総量
      const result = calcUpperSwapResult(
        upperItems,
        upperUniversalNeed,
        tryGive,
        mToGive,
        lToGive,
        sNeeded
      );

      if (result) {
        upperUpdates.push({ index: j, newItems: result.newItems });

        sObtained += result.sToGiveToLower;
        remainingMToGive -= mToGive;
        remainingLToGive -= lToGive;
        break;
      }
    }
  }

  // 完全なスワップができる場合のみ実行
  if (sObtained === pattern.sToAdd) {
    const newLowerItems = applySwapToLower(lowerItems, pattern, sObtained);
    return { newLowerItems, upperUpdates };
  }

  return null;
}

/** スワップ結果 */
type UpperSwapResult = {
  newItems: ItemUsage;
  sToGiveToLower: number;
};

/**
 * 上位ポケモンのスワップ結果を計算
 *
 * M/L を受け取り、S を渡す。余り調整のために自身の S も減らす場合、
 * その分も下位に渡す（ただし下位が必要な量を超えない）。
 */
function calcUpperSwapResult(
  upperItems: ItemUsage,
  upperUniversalNeed: number,
  sToGive: number,
  mToReceive: number,
  lToReceive: number,
  sNeededByLower: number
): UpperSwapResult | null {
  // S を渡した後の状態
  const remainingS = upperItems.universalS - sToGive;
  const newMSupply = (upperItems.universalM + mToReceive) * CANDY_VALUES.universal.m;
  const newLSupply = (upperItems.universalL + lToReceive) * CANDY_VALUES.universal.l;

  // M/L を受け取った後の余りを計算
  const supplySWithRemaining = remainingS * CANDY_VALUES.universal.s;
  const newSupply = supplySWithRemaining + newMSupply + newLSupply;
  const newSurplus = newSupply - upperUniversalNeed;

  // 余り < 0 なら受け入れ不可
  if (newSurplus < 0) return null;

  // 余り ≤ 2 ならそのまま受け入れ可能
  if (newSurplus <= MAX_ACCEPTABLE_SURPLUS) {
    return {
      newItems: {
        ...upperItems,
        universalS: remainingS,
        universalM: upperItems.universalM + mToReceive,
        universalL: upperItems.universalL + lToReceive,
        totalSupply: calcTotalSupply(upperItems, remainingS, upperItems.universalM + mToReceive, upperItems.universalL + lToReceive),
        surplus: newSurplus,
      },
      sToGiveToLower: sToGive,
    };
  }

  // 余り > 2 の場合、自身の S を減らして調整
  // 減らした S は下位に渡す（ただし下位が必要な量を超えない）
  const excessSurplus = newSurplus - MAX_ACCEPTABLE_SURPLUS;
  const maxExcessS = Math.floor(excessSurplus / CANDY_VALUES.universal.s);
  const additionalSToGive = Math.min(maxExcessS, sNeededByLower - sToGive, remainingS);

  if (additionalSToGive <= 0) {
    // 追加で渡せる S がない場合、余りを減らせないのでスキップ
    // ただし余りが許容範囲に収まるまで S を減らせるなら OK
    const sToReduceForSurplus = Math.ceil(excessSurplus / CANDY_VALUES.universal.s);
    if (sToReduceForSurplus > remainingS) return null;

    const finalS = remainingS - sToReduceForSurplus;
    const finalSupply = finalS * CANDY_VALUES.universal.s + newMSupply + newLSupply;
    const finalSurplus = finalSupply - upperUniversalNeed;

    if (finalSurplus < 0 || finalSurplus > MAX_ACCEPTABLE_SURPLUS) return null;

    return {
      newItems: {
        ...upperItems,
        universalS: finalS,
        universalM: upperItems.universalM + mToReceive,
        universalL: upperItems.universalL + lToReceive,
        totalSupply: calcTotalSupply(upperItems, finalS, upperItems.universalM + mToReceive, upperItems.universalL + lToReceive),
        surplus: finalSurplus,
      },
      sToGiveToLower: sToGive + sToReduceForSurplus,
    };
  }

  // 追加の S を下位に渡す
  const finalS = remainingS - additionalSToGive;
  const finalSupply = finalS * CANDY_VALUES.universal.s + newMSupply + newLSupply;
  const finalSurplus = finalSupply - upperUniversalNeed;

  if (finalSurplus < 0 || finalSurplus > MAX_ACCEPTABLE_SURPLUS) return null;

  return {
    newItems: {
      ...upperItems,
      universalS: finalS,
      universalM: upperItems.universalM + mToReceive,
      universalL: upperItems.universalL + lToReceive,
      totalSupply: calcTotalSupply(upperItems, finalS, upperItems.universalM + mToReceive, upperItems.universalL + lToReceive),
      surplus: finalSurplus,
    },
    sToGiveToLower: sToGive + additionalSToGive,
  };
}

/**
 * 下位ポケモンにスワップを適用
 */
function applySwapToLower(
  items: ItemUsage,
  pattern: ReductionPattern,
  sObtained: number
): ItemUsage {
  const newS = items.universalS + sObtained;
  const newM = items.universalM - pattern.mToRemove;
  const newL = items.universalL - pattern.lToRemove;

  return {
    ...items,
    universalS: newS,
    universalM: newM,
    universalL: newL,
    totalSupply: calcTotalSupply(items, newS, newM, newL),
    surplus: pattern.newSurplus,
  };
}

/**
 * totalSupply を再計算
 */
function calcTotalSupply(
  items: ItemUsage,
  universalS: number,
  universalM: number,
  universalL: number
): number {
  return items.speciesCandy * CANDY_VALUES.species
    + items.typeS * CANDY_VALUES.type.s
    + items.typeM * CANDY_VALUES.type.m
    + universalS * CANDY_VALUES.universal.s
    + universalM * CANDY_VALUES.universal.m
    + universalL * CANDY_VALUES.universal.l;
}
