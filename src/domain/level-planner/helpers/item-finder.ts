/**
 * LevelPlanner - アイテム配分探索
 *
 * 目標価値を達成するための最適なアイテム組み合わせを探索する。
 * 「最適」とは使用優先順位を守りつつ、余りを最小化すること。
 */

import { CANDY_VALUES, MAX_ACCEPTABLE_SURPLUS } from '../constants';
import type { ItemAllocationResult, UniversalAllocationResult } from '../types';

// ============================================================
// タイプアメ + 万能アメの配分探索
// ============================================================

/**
 * 目標価値を達成する最適なアイテム組み合わせを探索
 *
 * 探索の優先順位:
 * 1. 余り ≤ 2 を達成する組み合わせを優先
 * 2. タイプS > タイプM > 万能S > 万能M > 万能L の順で多く使う
 * 3. 余りが同じなら優先順位順
 *
 * @param targetValue 目標価値
 * @param typeStock タイプアメ在庫 { s, m }
 * @param universalStock 万能アメ在庫 { s, m, l }
 * @returns 最適な配分結果
 */
export function findBestItemAllocation(
  targetValue: number,
  typeStock: { s: number; m: number },
  universalStock: { s: number; m: number; l: number }
): ItemAllocationResult {
  if (targetValue <= 0) {
    return { typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supplied: 0 };
  }

  const typeS_VALUE = CANDY_VALUES.type.s;
  const typeM_VALUE = CANDY_VALUES.type.m;
  const uniS_VALUE = CANDY_VALUES.universal.s;
  const uniM_VALUE = CANDY_VALUES.universal.m;
  const uniL_VALUE = CANDY_VALUES.universal.l;

  let best: ItemAllocationResult | null = null;

  // 全組み合わせを探索
  const maxTypeS = Math.min(typeStock.s, Math.ceil(targetValue / typeS_VALUE));
  const maxTypeM = Math.min(typeStock.m, Math.ceil(targetValue / typeM_VALUE));

  for (let typeS = 0; typeS <= maxTypeS; typeS++) {
    for (let typeM = 0; typeM <= maxTypeM; typeM++) {
      const typeValue = typeS * typeS_VALUE + typeM * typeM_VALUE;
      if (typeValue > targetValue + MAX_ACCEPTABLE_SURPLUS) continue;

      const remaining = targetValue - typeValue;
      if (remaining <= 0) {
        const candidate: ItemAllocationResult = {
          typeS,
          typeM,
          universalS: 0,
          universalM: 0,
          universalL: 0,
          supplied: typeValue,
        };
        if (!best || isBetterAllocation(candidate, best, targetValue)) {
          best = candidate;
        }
        continue;
      }

      // 万能アメで残りを埋める
      const maxUniL = Math.min(universalStock.l, Math.ceil(remaining / uniL_VALUE));
      for (let uniL = 0; uniL <= maxUniL; uniL++) {
        const afterL = remaining - uniL * uniL_VALUE;
        if (afterL < 0 && uniL > 0) {
          // Lを1つ減らして探索
          const candidate = tryWithUniversal(typeS, typeM, typeValue, remaining, uniL - 1, universalStock);
          if (candidate && (!best || isBetterAllocation(candidate, best, targetValue))) {
            best = candidate;
          }
        }

        const maxUniM = Math.min(universalStock.m, Math.ceil(Math.max(0, afterL) / uniM_VALUE));
        for (let uniM = 0; uniM <= maxUniM; uniM++) {
          const afterM = afterL - uniM * uniM_VALUE;
          if (afterM < 0) continue;

          const uniS = Math.min(universalStock.s, Math.ceil(afterM / uniS_VALUE));
          const supplied =
            typeValue +
            uniL * uniL_VALUE +
            uniM * uniM_VALUE +
            uniS * uniS_VALUE;

          const candidate: ItemAllocationResult = {
            typeS,
            typeM,
            universalS: uniS,
            universalM: uniM,
            universalL: uniL,
            supplied,
          };

          if (!best || isBetterAllocation(candidate, best, targetValue)) {
            best = candidate;
          }
        }
      }
    }
  }

  return best ?? {
    typeS: 0,
    typeM: 0,
    universalS: 0,
    universalM: 0,
    universalL: 0,
    supplied: 0,
  };
}

/**
 * 万能アメのみで目標を達成する組み合わせを探索
 */
function tryWithUniversal(
  typeS: number,
  typeM: number,
  typeValue: number,
  remaining: number,
  uniL: number,
  stock: { s: number; m: number; l: number }
): ItemAllocationResult | null {
  const uniL_VALUE = CANDY_VALUES.universal.l;
  const uniM_VALUE = CANDY_VALUES.universal.m;
  const uniS_VALUE = CANDY_VALUES.universal.s;

  const afterL = remaining - uniL * uniL_VALUE;
  if (afterL < 0) return null;

  const maxUniM = Math.min(stock.m, Math.ceil(afterL / uniM_VALUE));
  for (let uniM = 0; uniM <= maxUniM; uniM++) {
    const afterM = afterL - uniM * uniM_VALUE;
    if (afterM < 0) continue;

    const uniS = Math.min(stock.s, Math.ceil(afterM / uniS_VALUE));
    const supplied =
      typeValue +
      uniL * uniL_VALUE +
      uniM * uniM_VALUE +
      uniS * uniS_VALUE;

    return {
      typeS,
      typeM,
      universalS: uniS,
      universalM: uniM,
      universalL: uniL,
      supplied,
    };
  }

  return null;
}

// ============================================================
// 万能アメのみの配分探索
// ============================================================

/**
 * 万能アメのみで目標価値を達成する最適な組み合わせを探索
 *
 * @param targetValue 目標価値
 * @param stock 万能アメ在庫 { s, m, l }
 * @returns 最適な配分結果
 */
export function findBestUniversalAllocation(
  targetValue: number,
  stock: { s: number; m: number; l: number }
): UniversalAllocationResult {
  if (targetValue <= 0) {
    return { s: 0, m: 0, l: 0, supplied: 0 };
  }

  const L_VALUE = CANDY_VALUES.universal.l;

  let best: UniversalAllocationResult | null = null;

  const maxL = Math.min(stock.l, Math.ceil(targetValue / L_VALUE));
  for (let l = 0; l <= maxL; l++) {
    const afterL = targetValue - l * L_VALUE;
    if (afterL < 0 && l > 0) {
      // Lが多すぎる場合、1つ減らして探索
      const candidate = findBestWithL(targetValue, l - 1, stock);
      if (candidate && (!best || isBetterUniversalAllocation(candidate, best, targetValue))) {
        best = candidate;
      }
      continue;
    }

    const candidate = findBestWithL(targetValue, l, stock);
    if (candidate && (!best || isBetterUniversalAllocation(candidate, best, targetValue))) {
      best = candidate;
    }
  }

  return best ?? { s: 0, m: 0, l: 0, supplied: 0 };
}

/**
 * L個数を固定してM, Sを探索
 */
function findBestWithL(
  targetValue: number,
  l: number,
  stock: { s: number; m: number; l: number }
): UniversalAllocationResult | null {
  const S_VALUE = CANDY_VALUES.universal.s;
  const M_VALUE = CANDY_VALUES.universal.m;
  const L_VALUE = CANDY_VALUES.universal.l;

  const afterL = targetValue - l * L_VALUE;

  const maxM = Math.min(stock.m, Math.ceil(Math.max(0, afterL) / M_VALUE));
  for (let m = 0; m <= maxM; m++) {
    const afterM = afterL - m * M_VALUE;
    if (afterM < 0) continue;

    const s = Math.min(stock.s, Math.ceil(afterM / S_VALUE));
    const supplied = l * L_VALUE + m * M_VALUE + s * S_VALUE;

    return { s, m, l, supplied };
  }

  return null;
}

// ============================================================
// 比較関数
// ============================================================

/**
 * 配分結果を比較（aがbより良いか）
 *
 * 比較順序:
 * 1. 余り 0-2 を達成している方が優先（余り0-2は同等扱い）
 * 2. 余り0-2同士の場合: 優先順位（万能L少 > 万能M少 > タイプS多 > タイプM多）で選ぶ
 * 3. 余りが負の場合: 余りが大きい方（0に近い方 = より多く供給）を優先
 * 4. 余り3以上の場合: 余りが小さい方を優先
 */
function isBetterAllocation(
  a: ItemAllocationResult,
  b: ItemAllocationResult,
  targetValue: number
): boolean {
  const surplusA = a.supplied - targetValue;
  const surplusB = b.supplied - targetValue;
  const within2A = surplusA >= 0 && surplusA <= MAX_ACCEPTABLE_SURPLUS;
  const within2B = surplusB >= 0 && surplusB <= MAX_ACCEPTABLE_SURPLUS;

  // 1. 余り 0-2 を満たす方が優先
  if (within2A && !within2B) return true;
  if (!within2A && within2B) return false;

  // 両方が余り 0-2 を満たす場合: 優先順位で選ぶ（余りは比較しない）
  if (within2A && within2B) {
    if (a.universalL !== b.universalL) return a.universalL < b.universalL;  // L節約
    if (a.universalM !== b.universalM) return a.universalM < b.universalM;  // M節約
    if (a.typeS !== b.typeS) return a.typeS > b.typeS;  // タイプS使い切り
    if (a.typeM !== b.typeM) return a.typeM > b.typeM;  // タイプM使い切り
    // 万能Sは他が同じなら一意に決まるため比較不要
    return false;
  }

  // 余りが負の場合: 余りが大きい方（0に近い = より多く供給）を優先
  if (surplusA < 0 || surplusB < 0) {
    if (surplusA !== surplusB) return surplusA > surplusB;
  } else {
    // 両方が余り > 2 の場合: 余りが小さい方を優先
    if (surplusA !== surplusB) return surplusA < surplusB;
  }

  // 余りが同じ場合: 優先順位で比較
  if (a.universalL !== b.universalL) return a.universalL < b.universalL;
  if (a.universalM !== b.universalM) return a.universalM < b.universalM;
  if (a.typeS !== b.typeS) return a.typeS > b.typeS;
  if (a.typeM !== b.typeM) return a.typeM > b.typeM;
  return false;
}

/**
 * 万能アメ配分結果を比較（aがbより良いか）
 *
 * 余り0-2は同等扱い。余り3以上の場合は余りが小さい方を優先。
 */
function isBetterUniversalAllocation(
  a: UniversalAllocationResult,
  b: UniversalAllocationResult,
  targetValue: number
): boolean {
  const surplusA = a.supplied - targetValue;
  const surplusB = b.supplied - targetValue;
  const within2A = surplusA >= 0 && surplusA <= MAX_ACCEPTABLE_SURPLUS;
  const within2B = surplusB >= 0 && surplusB <= MAX_ACCEPTABLE_SURPLUS;

  // 1. 余り 0-2 を満たす方が優先
  if (within2A && !within2B) return true;
  if (!within2A && within2B) return false;

  // 両方が余り 0-2 を満たす場合: 優先順位で選ぶ（余りは比較しない）
  if (within2A && within2B) {
    if (a.s !== b.s) return a.s > b.s;
    if (a.m !== b.m) return a.m > b.m;
    if (a.l !== b.l) return a.l < b.l;
    // 余り0-2は同等なので、これ以上の比較は不要
    return false;
  }

  // 両方が余り > 2 の場合: 余りが小さい方を優先
  if (surplusA !== surplusB) return surplusA < surplusB;

  // 余りが同じ場合: 優先順位で比較
  if (a.s !== b.s) return a.s > b.s;
  if (a.m !== b.m) return a.m > b.m;
  if (a.l !== b.l) return a.l < b.l;
  return false;
}
