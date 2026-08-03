/**
 * 目標導出まわりの純関数テスト（deriveTarget / targetFromCandy / minCandyForTarget）
 *
 * @see .agent/sessions/個数指定と目標Lvの一本化_設計書.md §4.5, §5.0, §10
 */

import { describe, expect, it } from 'vitest';
import type { BoostEvent, ExpGainNature, ExpType } from '../../../src/domain/types';
import { deriveTarget, targetFromCandy } from '../../../src/domain/level-planner/deriveTarget';
import { minCandyForTarget } from '../../../src/domain/pokesleep/minCandyForTarget';
import { calcExp, calcExpAndCandy, calcExpAndCandyMixed, calcLevelByCandy } from '../../../src/domain/pokesleep/exp';
import { simulateCandyBudget } from '../../../src/domain/pokesleep/simulateCandyBudget';

describe('deriveTarget: 最終目標は保存値が正本', () => {
  it('個数指定なしの目標は dstLevel ちょうど（dstExpInLevel は無視する）', () => {
    const t = deriveTarget({ dstLevel: 30, dstExpInLevel: 12345, expType: 600 });
    expect(t.targetLevel).toBe(30);
    expect(t.targetExpInLevel).toBe(0);
  });

  it('個数指定ありなら保存された dstLevel + dstExpInLevel をそのまま返す', () => {
    const t = deriveTarget({ dstLevel: 34, dstExpInLevel: 123, candyTarget: 40, expType: 600 });
    expect(t.targetLevel).toBe(34);
    expect(t.targetExpInLevel).toBe(123);
  });

  it('明示アメブ個数だけがanchorでも保存された dstLevel + dstExpInLevel を返す', () => {
    const t = deriveTarget({
      dstLevel: 34,
      dstExpInLevel: 123,
      boostOrExpAdjustment: 40,
      expType: 600,
    });
    expect(t).toEqual({ targetLevel: 34, targetExpInLevel: 123 });
  });

  it('アメ個数を変えても目標は動かない（整数アメの丸めを目標へ混ぜない）', () => {
    const base = { dstLevel: 34, dstExpInLevel: 123, expType: 600 as ExpType };
    expect(deriveTarget({ ...base, candyTarget: 40 })).toEqual(deriveTarget({ ...base, candyTarget: 400 }));
  });

  it('dstExpInLevel は次Lvまでの必要EXP未満へ丸められ、MAX_LEVEL では 0 になる', () => {
    const toNext = calcExp(34, 35, 600);
    expect(deriveTarget({ dstLevel: 34, dstExpInLevel: toNext + 999, candyTarget: 40, expType: 600 }).targetExpInLevel)
      .toBe(toNext - 1);
    expect(deriveTarget({ dstLevel: 70, dstExpInLevel: 5000, candyTarget: 4000, expType: 600 }).targetExpInLevel)
      .toBe(0);
  });
});

describe('minCandyForTarget: 目標へ届く最小の総アメ数', () => {
  it('現在のアメブ設定（n）に依存して増減する（通常アメはEXP効率が半分）', () => {
    const base = { srcLevel: 10, expGot: 0, targetLevel: 30, expType: 600 as ExpType, nature: 'normal' as ExpGainNature, boostKind: 'full' as BoostEvent };
    expect(minCandyForTarget({ ...base, boostCandy: 0 }))
      .toBeGreaterThan(minCandyForTarget({ ...base, boostCandy: 100000 }));
  });

  it('n が目標到達に必要な数を超えても総アメ数が膨らまない（内数クランプ。設計書§4.3 / §10.8）', () => {
    const base = { srcLevel: 10, expGot: 0, targetLevel: 30, expType: 600 as ExpType, nature: 'normal' as ExpGainNature, boostKind: 'full' as BoostEvent };
    // 全アメブで目標到達に必要な最小数
    const fullBoost = calcExpAndCandy({
      srcLevel: 10, dstLevel: 30, dstExpInLevel: 0, expType: 600, nature: 'normal', boost: 'full', expGot: 0,
    }).candy;
    expect(minCandyForTarget({ ...base, boostCandy: fullBoost })).toBe(fullBoost);
    expect(minCandyForTarget({ ...base, boostCandy: fullBoost + 500 })).toBe(fullBoost);
  });

  it('calcExpAndCandyMixed(boostCandy=n) の合計と一致する', () => {
    const n = 15;
    const mixed = calcExpAndCandyMixed({
      srcLevel: 20, dstLevel: 25, dstExpInLevel: 0, expType: 900, nature: 'up', boost: 'mini', boostCandy: n, expGot: 30,
    });
    expect(minCandyForTarget({
      srcLevel: 20, expGot: 30, targetLevel: 25, boostCandy: n, expType: 900, nature: 'up', boostKind: 'mini',
    })).toBe(mixed.boostCandy + mixed.normalCandy);
  });

  it('目標Lv内EXPを指定すると、その分だけ必要アメ数が増える', () => {
    const base = { srcLevel: 20, expGot: 0, targetLevel: 25, expType: 900 as ExpType, nature: 'normal' as ExpGainNature, boostKind: 'mini' as BoostEvent, boostCandy: 0 };
    expect(minCandyForTarget({ ...base, targetExpInLevel: calcExp(25, 26, 900) - 1 }))
      .toBeGreaterThan(minCandyForTarget(base));
  });
});

describe('targetFromCandy: 個数指定・アメブから最終目標を求める（アメが先、睡眠が後）', () => {
  it('睡眠なしなら (n, m) の到達点がそのまま最終目標になる', () => {
    const srcLevel = 15; const m = 40; const n = 10;
    const t = targetFromCandy({
      srcLevel, expGot: 0, candyTarget: m, boostCandy: n,
      expType: 600, nature: 'normal', boostKind: 'full',
    });
    const reached = simulateCandyBudget(
      { currentLevel: srcLevel, currentExpInLevel: 0, expType: 600, nature: 'normal' },
      n, m, Infinity, 'full',
    );
    expect(t.level).toBe(reached.level);
    expect(t.expInLevel).toBe(reached.expInLevel);
  });

  it('n が m を超える場合は m にクランプされる', () => {
    const srcLevel = 15; const m = 20;
    const shared = { srcLevel, expGot: 0, candyTarget: m, expType: 600 as ExpType, nature: 'normal' as ExpGainNature, boostKind: 'full' as BoostEvent };
    expect(targetFromCandy({ ...shared, boostCandy: 9999 })).toEqual(targetFromCandy({ ...shared, boostCandy: 20 }));
  });

  it('睡眠EXPはアメ到達点の後に加算される', () => {
    const srcLevel = 15; const m = 20; const n = 5; const sleepExp = 5000;
    const t = targetFromCandy({
      srcLevel, expGot: 0, candyTarget: m, boostCandy: n, sleepExp,
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
    expect(t.level).toBe(level);
    expect(t.expInLevel).toBe(level >= 70 ? 0 : exp);
    // 睡眠EXPを加算した分、アメだけの到達点より確実に先へ進む
    expect(t.level > reached.level || (t.level === reached.level && t.expInLevel > reached.expInLevel)).toBe(true);
  });

  it('Lv30境界をまたぐケースで、アメ先・睡眠後は前倒し加算より高い/同等の到達点になる（設計書§5.0, §9の回帰指標）', () => {
    // Lv28→32付近。Lv28-29はEXP/アメが高効率(35)、Lv30以降は低効率(25)。
    // アメを先に低Lv帯で使い切ってから睡眠EXPを乗せる（採用方式）方が、
    // 睡眠を先に乗せてアメの開始Lvを繰り上げる方式（前倒し加算、却下案）より進む。
    const srcLevel = 28; const m = 6; const n = 0; const sleepExp = 400;

    // 採用方式: targetFromCandy（アメが先、睡眠が後）
    const t = targetFromCandy({
      srcLevel, expGot: 0, candyTarget: m, boostCandy: n, sleepExp,
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

    const cmp = t.level !== afterCandy.level ? t.level - afterCandy.level : t.expInLevel - afterCandy.expGot;
    expect(cmp).toBeGreaterThanOrEqual(0);
  });

  it('累計睡眠時間が睡眠目標時間を超えていて sleepExp=0 の場合、アメだけの到達点と一致する', () => {
    const shared = { srcLevel: 15, expGot: 0, candyTarget: 20, boostCandy: 5, expType: 600 as ExpType, nature: 'normal' as ExpGainNature, boostKind: 'full' as BoostEvent };
    expect(targetFromCandy({ ...shared, sleepExp: 0 })).toEqual(targetFromCandy({ ...shared }));
  });
});
