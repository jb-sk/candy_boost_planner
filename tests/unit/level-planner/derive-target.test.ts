import { describe, expect, it } from 'vitest';
import type { BoostEvent, ExpGainNature, ExpType } from '../../../src/domain/types';
import { deriveCandyEndpoint } from '../../../src/domain/level-planner/deriveCandyEndpoint';
import { deriveTarget } from '../../../src/domain/level-planner/deriveTarget';
import { calcExpAndCandy, calcExpAndCandyMixed } from '../../../src/domain/pokesleep/exp';
import { calcCandyTargetFromSleepExp } from '../../../src/domain/pokesleep/sleep-growth';
import { maxLevel as MAX_LEVEL } from '../../../src/domain/pokesleep/tables';

describe('deriveTarget: 保存された正確な最終目標', () => {
  it('個数指定の有無にかかわらず dstLevel + dstExpInLevel をそのまま返す', () => {
    const base = {
      srcLevel: 10,
      expGot: 50,
      dstLevel: 30,
      dstExpInLevel: 137,
      boostCandy: 20,
      expType: 600 as ExpType,
      nature: 'normal' as ExpGainNature,
      boostKind: 'full' as BoostEvent,
    };

    expect(deriveTarget(base)).toMatchObject({ targetLevel: 30, targetExpInLevel: 137 });
    expect(deriveTarget({ ...base, candyTarget: 80 })).toMatchObject({
      targetLevel: 30,
      targetExpInLevel: 137,
      requiredCandy: 80,
    });
  });

  it('LvMAX の Lv内EXP は 0 に正規化する', () => {
    const target = deriveTarget({
      srcLevel: 60,
      expGot: 0,
      dstLevel: MAX_LEVEL,
      dstExpInLevel: 999,
      boostCandy: 0,
      expType: 600,
      nature: 'normal',
      boostKind: 'none',
    });
    expect(target.targetExpInLevel).toBe(0);
  });

  it('個数指定なしではアメブ入力を全アメブ必要数までクランプし、必要数を過大計上しない', () => {
    const base = {
      srcLevel: 10,
      expGot: 0,
      dstLevel: 30,
      dstExpInLevel: 91,
      expType: 600 as ExpType,
      nature: 'normal' as ExpGainNature,
      boostKind: 'full' as BoostEvent,
    };
    const fullBoost = calcExpAndCandy({
      srcLevel: base.srcLevel,
      dstLevel: base.dstLevel,
      dstExpInLevel: base.dstExpInLevel,
      expType: base.expType,
      nature: base.nature,
      boost: base.boostKind,
      expGot: base.expGot,
    }).candy;

    const atCap = deriveTarget({ ...base, boostCandy: fullBoost });
    const overCap = deriveTarget({ ...base, boostCandy: fullBoost + 500 });
    expect(overCap.requiredCandy).toBe(atCap.requiredCandy);
    expect(overCap.requiredCandy).toBe(fullBoost);
  });

  it('個数指定なしの requiredCandy は正確な Lv内EXP を含む mixed 計算と一致する', () => {
    const n = 15;
    const target = deriveTarget({
      srcLevel: 20,
      expGot: 30,
      dstLevel: 25,
      dstExpInLevel: 123,
      boostCandy: n,
      expType: 900,
      nature: 'up',
      boostKind: 'mini',
    });
    const mixed = calcExpAndCandyMixed({
      srcLevel: 20,
      dstLevel: 25,
      dstExpInLevel: 123,
      expType: 900,
      nature: 'up',
      boost: 'mini',
      boostCandy: n,
      expGot: 30,
    });
    expect(target.requiredCandy).toBe(mixed.boostCandy + mixed.normalCandy);
  });

  it('睡眠逆算の整数丸めで順方向到達点が追い越しても、planner の最終目標は固定される', () => {
    const srcLevel = 10;
    const targetLevel = 20;
    const targetExpInLevel = 0;
    const sleepExp = 137;
    const candyTarget = calcCandyTargetFromSleepExp({
      srcLevel,
      dstLevel: targetLevel,
      dstExpInLevel: targetExpInLevel,
      expType: 600,
      nature: 'normal',
      boostKind: 'none',
      targetBoostCandy: 0,
      targetNormalCandy: Number.MAX_SAFE_INTEGER,
      sleepExp,
      expGot: 0,
    });
    const endpoint = deriveCandyEndpoint({
      srcLevel,
      expGot: 0,
      candyTarget,
      boostCandy: 0,
      expType: 600,
      nature: 'normal',
      boostKind: 'none',
      sleepExp,
    });
    const fixed = deriveTarget({
      srcLevel,
      expGot: 0,
      dstLevel: targetLevel,
      dstExpInLevel: targetExpInLevel,
      candyTarget,
      boostCandy: 0,
      expType: 600,
      nature: 'normal',
      boostKind: 'none',
    });

    expect(endpoint.level > targetLevel || (endpoint.level === targetLevel && endpoint.expInLevel >= targetExpInLevel)).toBe(true);
    expect(fixed).toMatchObject({
      targetLevel,
      targetExpInLevel,
      requiredCandy: candyTarget,
    });
  });
});

describe('deriveCandyEndpoint: 個数が駆動側の操作', () => {
  it('同じ総数でも n は m の内数へクランプされる', () => {
    const base = {
      srcLevel: 15,
      expGot: 0,
      candyTarget: 20,
      expType: 600 as ExpType,
      nature: 'normal' as ExpGainNature,
      boostKind: 'full' as BoostEvent,
    };
    expect(deriveCandyEndpoint({ ...base, boostCandy: 20 }))
      .toEqual(deriveCandyEndpoint({ ...base, boostCandy: 9999 }));
  });

  it('睡眠EXPはアメ到達点の後に加算される', () => {
    const withoutSleep = deriveCandyEndpoint({
      srcLevel: 15,
      expGot: 0,
      candyTarget: 20,
      boostCandy: 5,
      expType: 600,
      nature: 'normal',
      boostKind: 'full',
    });
    const withSleep = deriveCandyEndpoint({
      srcLevel: 15,
      expGot: 0,
      candyTarget: 20,
      boostCandy: 5,
      expType: 600,
      nature: 'normal',
      boostKind: 'full',
      sleepExp: 5000,
    });
    expect(withSleep.level > withoutSleep.level || (
      withSleep.level === withoutSleep.level && withSleep.expInLevel > withoutSleep.expInLevel
    )).toBe(true);
  });
});
