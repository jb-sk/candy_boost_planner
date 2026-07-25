/**
 * deriveTarget の純関数テスト
 *
 * @see .agent/sessions/個数指定と目標Lvの一本化_設計書.md §4.5, §5.0
 */

import { describe, expect, it } from 'vitest';
import type { BoostEvent, ExpGainNature, ExpType } from '../../../src/domain/types';
import { deriveTarget } from '../../../src/domain/level-planner/deriveTarget';
import { calcExp, calcExpAndCandy, calcExpAndCandyMixed, calcLevelByCandy } from '../../../src/domain/pokesleep/exp';
import { simulateCandyBudget } from '../../../src/domain/pokesleep/simulateCandyBudget';

describe('deriveTarget: 個数指定なし', () => {
  it('目標は常に dstLevel ちょうど（targetExpInLevel=0）になる', () => {
    const t = deriveTarget({
      srcLevel: 10, expGot: 50, dstLevel: 30, boostCandy: 20,
      expType: 600, nature: 'normal', boostKind: 'full',
    });
    expect(t.targetLevel).toBe(30);
    expect(t.targetExpInLevel).toBe(0);
  });

  it('requiredCandy は現在のアメブ設定（n）に依存して増減する（通常アメはEXP効率が半分）', () => {
    const base = { srcLevel: 10, expGot: 0, dstLevel: 30, expType: 600 as ExpType, nature: 'normal' as ExpGainNature, boostKind: 'full' as BoostEvent };
    const withoutBoost = deriveTarget({ ...base, boostCandy: 0 });
    const withFullBoost = deriveTarget({ ...base, boostCandy: 100000 });
    expect(withoutBoost.requiredCandy).toBeGreaterThan(withFullBoost.requiredCandy);
  });

  it('n が目標到達に必要な数を超えても requiredCandy が膨らまない（内数クランプ。設計書§4.3）', () => {
    const base = { srcLevel: 10, expGot: 0, dstLevel: 30, expType: 600 as ExpType, nature: 'normal' as ExpGainNature, boostKind: 'full' as BoostEvent };
    // 全アメブで目標到達に必要な最小数
    const fullBoost = calcExpAndCandy({
      srcLevel: 10, dstLevel: 30, dstExpInLevel: 0, expType: 600, nature: 'normal', boost: 'full', expGot: 0,
    }).candy;
    const atCap = deriveTarget({ ...base, boostCandy: fullBoost });
    const overCap = deriveTarget({ ...base, boostCandy: fullBoost + 500 });
    expect(atCap.requiredCandy).toBe(fullBoost);
    expect(overCap.requiredCandy).toBe(fullBoost);
  });

  it('sleepExp を渡しても無視される（個数指定なしは呼び出し側が S=0 を保証する契約）', () => {
    const withSleep = deriveTarget({
      srcLevel: 10, expGot: 0, dstLevel: 30, boostCandy: 0, sleepExp: 999999,
      expType: 600, nature: 'normal', boostKind: 'full',
    });
    expect(withSleep.targetLevel).toBe(30);
    expect(withSleep.targetExpInLevel).toBe(0);
  });

  it('requiredCandy は calcExpAndCandyMixed(boostCandy=n) の合計と一致する', () => {
    const n = 15;
    const t = deriveTarget({
      srcLevel: 20, expGot: 30, dstLevel: 25, boostCandy: n,
      expType: 900, nature: 'up', boostKind: 'mini',
    });
    const mixed = calcExpAndCandyMixed({
      srcLevel: 20, dstLevel: 25, dstExpInLevel: 0, expType: 900, nature: 'up', boost: 'mini', boostCandy: n, expGot: 30,
    });
    expect(t.requiredCandy).toBe(mixed.boostCandy + mixed.normalCandy);
  });
});

describe('deriveTarget: 個数指定あり（睡眠なし）', () => {
  it('(n, m) の到達点がそのまま目標になり、requiredCandy は m と一致する', () => {
    const srcLevel = 15; const m = 40; const n = 10;
    const t = deriveTarget({
      srcLevel, expGot: 0, dstLevel: 60, candyTarget: m, boostCandy: n,
      expType: 600, nature: 'normal', boostKind: 'full',
    });
    const reached = simulateCandyBudget(
      { currentLevel: srcLevel, currentExpInLevel: 0, expType: 600, nature: 'normal' },
      n, m, Infinity, 'full',
    );
    expect(t.targetLevel).toBe(reached.level);
    expect(t.targetExpInLevel).toBe(reached.expInLevel);
    expect(t.requiredCandy).toBe(m);
  });

  it('n が m を超える場合は m にクランプされる', () => {
    const srcLevel = 15; const m = 20;
    const t1 = deriveTarget({
      srcLevel, expGot: 0, dstLevel: 60, candyTarget: m, boostCandy: 20,
      expType: 600, nature: 'normal', boostKind: 'full',
    });
    const t2 = deriveTarget({
      srcLevel, expGot: 0, dstLevel: 60, candyTarget: m, boostCandy: 9999,
      expType: 600, nature: 'normal', boostKind: 'full',
    });
    expect(t2).toEqual(t1);
  });

  it('dstLevel（保存値）は目標導出に一切使われない（個数指定ありでは無視される）', () => {
    const base = { srcLevel: 15, expGot: 0, candyTarget: 40, boostCandy: 10, expType: 600 as ExpType, nature: 'normal' as ExpGainNature, boostKind: 'full' as BoostEvent };
    const t1 = deriveTarget({ ...base, dstLevel: 60 });
    const t2 = deriveTarget({ ...base, dstLevel: 20 });
    expect(t1).toEqual(t2);
  });
});

describe('deriveTarget: 個数指定あり + 睡眠あり（アメが先、睡眠が後）', () => {
  it('睡眠EXPはアメ到達点の後に加算される', () => {
    const srcLevel = 15; const m = 20; const n = 5; const sleepExp = 5000;
    const t = deriveTarget({
      srcLevel, expGot: 0, dstLevel: 60, candyTarget: m, boostCandy: n, sleepExp,
      expType: 600, nature: 'normal', boostKind: 'full',
    });
    const reached = simulateCandyBudget(
      { currentLevel: srcLevel, currentExpInLevel: 0, expType: 600, nature: 'normal' },
      n, m, Infinity, 'full',
    );
    // アメ到達点に睡眠EXPを足した地点を、独立した calcLevelByCandy 系ではなく手計算で検証
    let level = reached.level;
    let exp = reached.expInLevel + sleepExp;
    while (level < 70) {
      const needed = calcExp(level, level + 1, 600);
      if (exp < needed) break;
      exp -= needed;
      level++;
    }
    expect(t.targetLevel).toBe(level);
    expect(t.targetExpInLevel).toBe(level >= 70 ? 0 : exp);
    // 睡眠EXPを加算した分、アメだけの到達点より確実に先へ進む
    expect(t.targetLevel > reached.level || (t.targetLevel === reached.level && t.targetExpInLevel > reached.expInLevel)).toBe(true);
  });

  it('Lv30境界をまたぐケースで、アメ先・睡眠後は前倒し加算より高い/同等の到達点になる（設計書§5.0, §9の回帰指標）', () => {
    // Lv28→32付近。Lv28-29はEXP/アメが高効率(35)、Lv30以降は低効率(25)。
    // アメを先に低Lv帯で使い切ってから睡眠EXPを乗せる（採用方式）方が、
    // 睡眠を先に乗せてアメの開始Lvを繰り上げる方式（前倒し加算、却下案）より進む。
    const srcLevel = 28; const m = 6; const n = 0; const sleepExp = 400;

    // 採用方式: deriveTarget（アメが先、睡眠が後）
    const t = deriveTarget({
      srcLevel, expGot: 0, dstLevel: 60, candyTarget: m, boostCandy: n, sleepExp,
      expType: 600, nature: 'normal', boostKind: 'full',
    });

    // 却下案の再現: 睡眠EXPを先に足してから、その地点からアメ m 個を使う
    let preLevel = srcLevel; let preExp = sleepExp;
    while (preLevel < 70) {
      const needed = calcExp(preLevel, preLevel + 1, 600);
      if (preExp < needed) break;
      preExp -= needed;
      preLevel++;
    }
    // n=0 なので、アメはすべて通常アメ。却下案側も同じ条件で比較する。
    const afterCandy = calcLevelByCandy({
      srcLevel: preLevel, dstLevel: 70, expType: 600, nature: 'normal', boost: 'none', candy: m, expGot: preExp,
    });

    const cmp = t.targetLevel !== afterCandy.level ? t.targetLevel - afterCandy.level : t.targetExpInLevel - afterCandy.expGot;
    expect(cmp).toBeGreaterThanOrEqual(0);
  });

  it('累計睡眠時間が睡眠目標時間を超えていて sleepExp=0 の場合、アメだけの到達点と一致する', () => {
    const srcLevel = 15; const m = 20; const n = 5;
    const withZeroSleep = deriveTarget({
      srcLevel, expGot: 0, dstLevel: 60, candyTarget: m, boostCandy: n, sleepExp: 0,
      expType: 600, nature: 'normal', boostKind: 'full',
    });
    const withoutSleepParam = deriveTarget({
      srcLevel, expGot: 0, dstLevel: 60, candyTarget: m, boostCandy: n,
      expType: 600, nature: 'normal', boostKind: 'full',
    });
    expect(withZeroSleep).toEqual(withoutSleepParam);
  });
});
