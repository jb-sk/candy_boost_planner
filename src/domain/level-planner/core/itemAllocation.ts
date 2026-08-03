/**
 * LevelPlanner - 表示用アイテム配分探索
 *
 * 目標価値を達成するための最適なアイテム組み合わせを探索する。
 * 「最適」とは使用優先順位を守りつつ、余りを最小化すること。
 */

import { CANDY_VALUES, MAX_ACCEPTABLE_SURPLUS } from '../constants';
import type { ItemAllocationResult } from '../types';
import { compareItemPriority, itemPriorityOf } from './itemPriority';

// ============================================================
// タイプアメ + 万能アメの配分探索
// ============================================================

/**
 * 目標価値を達成する最適なアイテム組み合わせを探索
 *
 * 探索の優先順位:
 * 1. 余り ≤ 2 を達成する組み合わせを優先
 * 2. 余り ≤ 2 同士は使用優先度スコア（`itemPriority.ts`）で選ぶ。
 *    余り最小 (`preferMinSurplus`) だけは、その前に余りが小さい方を選ぶ
 * 3. 余り3以上同士なら余りが小さい方、供給不足同士なら供給が多い方
 *
 * @param targetValue 目標価値
 * @param typeStock タイプアメ在庫 { s, m }
 * @param universalStock 万能アメ在庫 { s, m, l }
 * @param preferMinSurplus 配分方針「余り最小」(`surplusFirst`) 用。余り0-2の中でも余りが小さい方を優先する
 * @returns 最適な配分結果
 */
export function findBestItemAllocation(
  targetValue: number,
  typeStock: { s: number; m: number },
  universalStock: { s: number; m: number; l: number },
  preferMinSurplus = false
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
        if (!best || isBetterAllocation(candidate, best, targetValue, preferMinSurplus)) {
          best = candidate;
        }
        continue;
      }

      // 万能アメで残りを埋める
      const maxUniL = Math.min(universalStock.l, Math.ceil(remaining / uniL_VALUE));
      for (let uniL = 0; uniL <= maxUniL; uniL++) {
        const afterL = remaining - uniL * uniL_VALUE;
        if (afterL <= 0) {
          const supplied = typeValue + uniL * uniL_VALUE;
          const candidate: ItemAllocationResult = {
            typeS,
            typeM,
            universalS: 0,
            universalM: 0,
            universalL: uniL,
            supplied,
          };
          if (!best || isBetterAllocation(candidate, best, targetValue, preferMinSurplus)) best = candidate;
          continue;
        }

        const maxUniM = Math.min(universalStock.m, Math.ceil(afterL / uniM_VALUE));
        for (let uniM = 0; uniM <= maxUniM; uniM++) {
          const afterM = afterL - uniM * uniM_VALUE;
          if (afterM <= 0) {
            const supplied = typeValue + uniL * uniL_VALUE + uniM * uniM_VALUE;
            const candidate: ItemAllocationResult = {
              typeS,
              typeM,
              universalS: 0,
              universalM: uniM,
              universalL: uniL,
              supplied,
            };
            if (!best || isBetterAllocation(candidate, best, targetValue, preferMinSurplus)) best = candidate;
            continue;
          }

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

          if (!best || isBetterAllocation(candidate, best, targetValue, preferMinSurplus)) {
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

// ============================================================
// 比較関数
// ============================================================

/**
 * 配分結果を比較（aがbより良いか）
 *
 * 比較順序:
 * 1. 余り 0-2 を達成している方が優先（余り0-2は同等扱い）
 * 2. 余り0-2同士の場合: 使用優先度スコア（`itemPriority.ts`）で選ぶ。
 *    ただし `preferMinSurplus`（配分方針「余り最小」）では、先に余りが小さい方を選ぶ
 * 3. 余りが負の場合: 余りが大きい方（0に近い方 = より多く供給）を優先
 * 4. 余り3以上の場合: 余りが小さい方を優先
 *
 * ソルバー本体と同じ順序にしないと、同じ需要でも表示だけ別の内訳になる。
 */
function isBetterAllocation(
  a: ItemAllocationResult,
  b: ItemAllocationResult,
  targetValue: number,
  preferMinSurplus = false
): boolean {
  const surplusA = a.supplied - targetValue;
  const surplusB = b.supplied - targetValue;
  const within2A = surplusA >= 0 && surplusA <= MAX_ACCEPTABLE_SURPLUS;
  const within2B = surplusB >= 0 && surplusB <= MAX_ACCEPTABLE_SURPLUS;

  // 1. 余り 0-2 を満たす方が優先
  if (within2A && !within2B) return true;
  if (!within2A && within2B) return false;

  // 両方が余り 0-2 を満たす場合
  if (within2A && within2B) {
    // 配分方針「余り最小」(surplusFirst) だけは余りを先に見る
    if (preferMinSurplus && surplusA !== surplusB) return surplusA < surplusB;
    return compareItemPriority(itemPriorityOf(a), itemPriorityOf(b)) > 0;
  }

  // 余りが負の場合: 余りが大きい方（0に近い = より多く供給）を優先
  if (surplusA < 0 || surplusB < 0) {
    if (surplusA !== surplusB) return surplusA > surplusB;
  } else {
    // 両方が余り > 2 の場合: 余りが小さい方を優先
    if (surplusA !== surplusB) return surplusA < surplusB;
  }

  return compareItemPriority(itemPriorityOf(a), itemPriorityOf(b)) > 0;
}
