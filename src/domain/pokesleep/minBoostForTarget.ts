import type { BoostEvent, ExpGainNature, ExpType } from "../types";
import { calcExp, calcExpAndCandy, calcExpAndCandyMixed, calcExpPerCandy, isTargetReached } from "./exp";
import { maxLevel } from "./tables";

export type MinBoostForTargetParams = {
  srcLevel: number;
  targetLevel: number;
  /** 目標Lv内の到達EXP（未指定なら0＝ちょうど targetLevel に到達） */
  targetExpInLevel?: number;
  expType: ExpType;
  nature: ExpGainNature;
  boostKind: BoostEvent;
  /** アメブ数の上限（グローバル残数、または個数指定時のブースト上限） */
  maxBoost: number;
  /** 現在Lv内で既に得ているEXP（未指定なら0） */
  expGot?: number;
  /**
   * 総アメ数を固定する場合の値（個数指定あり）。
   * 省略時は総アメ数も最小化した上でアメブ数を最小化する（個数指定なし）。
   */
  fixedTotalCandy?: number;
  /**
   * 「アメブ1個 → 通常アメ1個」置換（§3.8-e）を許すか。既定 true。
   *
   * 置換が正当なのは**最後の1個が出す余剰EXPが捨てられる**ときだけである。
   * 睡眠EXPが後ろに乗る行では `targetLevel + targetExpInLevel` がアメの担当終端 `T'` でしかなく、
   * そこを超えたEXPは捨てられずに最終目標へ効く。まだ育成途中なので置換する意味がない
   * （2026-07-30 ユーザー規則）。呼び出し側は `sleepExp > 0` のとき false を渡す。
   */
  allowNormalSwap?: boolean;
};

type ReachPoint = { level: number; expInLevel: number };

/**
 * 目標Lv+EXPに届く最小のアメブ数を返す。
 *
 * - `fixedTotalCandy` 省略時: 総アメ数を最小化した上で、その範囲でもアメブ数を最小化する
 *   （ceil の端数で1個過剰になったアメブを通常アメ1個へ置換できるなら置換する）。
 * - `fixedTotalCandy` あり: 総数を変えずに、同じ到達点を維持できる最小のアメブ数を求める。
 *
 * `targetExpInLevel` を省略（=0扱い）した場合、現行の整数Lv経路と同じ結果を返す互換分岐になる。
 */
export function minBoostForTarget(params: MinBoostForTargetParams): number {
  const { srcLevel, targetLevel, expType, nature, boostKind } = params;
  const targetExpInLevel = targetLevel >= maxLevel ? 0 : (params.targetExpInLevel ?? 0);
  const expGot = params.expGot ?? 0;
  const maxBoost = Math.max(0, Math.floor(params.maxBoost));

  if (boostKind === "none") return 0;
  if (isTargetReached(srcLevel, targetLevel, expGot, targetExpInLevel)) return 0;

  if (params.fixedTotalCandy === undefined) {
    return minBoostFreeTotal({
      srcLevel, targetLevel, targetExpInLevel, expType, nature, boostKind, maxBoost, expGot,
      allowNormalSwap: params.allowNormalSwap ?? true,
    });
  }

  const fixedTotalCandy = Math.max(0, Math.floor(params.fixedTotalCandy));
  return minBoostFixedTotal({ srcLevel, targetLevel, targetExpInLevel, expType, nature, boostKind, maxBoost, expGot, fixedTotalCandy });
}

/**
 * 総アメ数も最小化する経路。
 * 現行 useCalcStore.ts の calcCandyPatch にあった「アメブ→通常アメ置換」の-1パッチと同一ロジック
 * （targetExpInLevel 対応を追加した一般化版）。
 */
function minBoostFreeTotal(params: {
  srcLevel: number; targetLevel: number; targetExpInLevel: number;
  expType: ExpType; nature: ExpGainNature; boostKind: BoostEvent;
  maxBoost: number; expGot: number; allowNormalSwap: boolean;
}): number {
  const { srcLevel, targetLevel, targetExpInLevel, expType, nature, boostKind, maxBoost, expGot } = params;
  const full = calcExpAndCandy({
    srcLevel, dstLevel: targetLevel, dstExpInLevel: targetExpInLevel,
    expType, nature, boost: boostKind, expGot,
  }).candy;
  const capped = Math.min(full, maxBoost);

  if (params.allowNormalSwap && capped > 0 && capped === full) {
    const tryValue = capped - 1;
    const mixed = calcExpAndCandyMixed({
      srcLevel, dstLevel: targetLevel, dstExpInLevel: targetExpInLevel,
      expType, nature, boost: boostKind, boostCandy: tryValue, expGot,
    });
    if (mixed.normalCandy <= 1) return tryValue;
  }
  return capped;
}

/** 総数 fixedTotalCandy を変えずに、同じ到達点を維持できる最小のアメブ数を二分探索で求める。 */
function minBoostFixedTotal(params: {
  srcLevel: number; targetLevel: number; targetExpInLevel: number;
  expType: ExpType; nature: ExpGainNature; boostKind: BoostEvent;
  maxBoost: number; expGot: number; fixedTotalCandy: number;
}): number {
  const { srcLevel, targetLevel, targetExpInLevel, expType, nature, boostKind, maxBoost, expGot, fixedTotalCandy } = params;
  const boostUpper = Math.min(fixedTotalCandy, maxBoost);

  const reach = (boostBudget: number): ReachPoint => reachWithMixedBudget({
    srcLevel, expType, nature, boost: boostKind,
    boostBudget, normalBudget: fixedTotalCandy - boostBudget, expGot,
  });

  if (cmpLevelExp(reach(boostUpper), targetLevel, targetExpInLevel) < 0) {
    // 上限まで使っても目標に届かない場合は、可能な限り使う。
    return boostUpper;
  }

  let lo = 0;
  let hi = boostUpper;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cmpLevelExp(reach(mid), targetLevel, targetExpInLevel) >= 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

function cmpLevelExp(a: ReachPoint, level: number, expInLevel: number): number {
  if (a.level !== level) return a.level - level;
  return a.expInLevel - expInLevel;
}

/**
 * ブースト予算 boostBudget 個・通常予算 normalBudget 個を、低レベル側優先（ブースト優先）で
 * 使い切った場合の到達点。calcExpAndCandyMixed と同じ投入順序の前提だが、
 * 「目標までの必要数」ではなく「固定予算でどこまで届くか」を計算する逆方向の関数。
 */
function reachWithMixedBudget(params: {
  srcLevel: number; expType: ExpType; nature: ExpGainNature; boost: BoostEvent;
  boostBudget: number; normalBudget: number; expGot: number;
}): ReachPoint {
  const { srcLevel, expType, nature, boost, expGot } = params;
  let boostLeft = Math.max(0, Math.floor(params.boostBudget));
  let normalLeft = Math.max(0, Math.floor(params.normalBudget));
  let level = srcLevel;
  let carry = expGot;

  while (level < maxLevel) {
    if (boostLeft <= 0 && normalLeft <= 0) break;

    const needed = calcExp(level, level + 1, expType) - carry;
    const expPerBoost = boost === "none" ? 0 : calcExpPerCandy(level, nature, boost);
    const expPerNormal = calcExpPerCandy(level, nature, "none");

    let useBoost = 0;
    let remaining = needed;
    if (boostLeft > 0 && expPerBoost > 0) {
      useBoost = Math.min(boostLeft, Math.max(0, Math.ceil(remaining / expPerBoost)));
      remaining -= useBoost * expPerBoost;
    }
    let useNormal = 0;
    if (remaining > 0 && normalLeft > 0) {
      useNormal = Math.min(normalLeft, Math.ceil(remaining / expPerNormal));
      remaining -= useNormal * expPerNormal;
    }

    boostLeft -= useBoost;
    normalLeft -= useNormal;

    if (remaining > 0) {
      // 予算不足でこのレベルを超えられない。ここで打ち切り。
      carry += useBoost * expPerBoost + useNormal * expPerNormal;
      return { level, expInLevel: carry };
    }

    carry = -remaining;
    level++;
  }

  return { level, expInLevel: level >= maxLevel ? 0 : carry };
}
