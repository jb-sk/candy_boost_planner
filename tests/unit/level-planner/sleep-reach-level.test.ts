/**
 * 睡眠到達Lv（睡眠込みの着地点）の純関数テスト
 *
 * @see .agent/sessions/睡眠育成拡張_設計書.md §3 / §13-6
 *
 * expType 600 の実数値（`tables.ts` の `totalExpToTheLevel`）:
 *   Lv60→61 = 54,358 − 51,493 = 2,865
 *   Lv69→70 = 82,162 − 78,907 = 3,255
 */

import { describe, expect, it } from 'vitest';
import type { ExpType } from '../../../src/domain/types';
import { calcSleepReachLevel } from '../../../src/domain/level-planner/sleepReachLevel';

const EXP_TYPE: ExpType = 600;

/** 到達Lv60ちょうどへ睡眠EXPを足す形。`sleepExp` がそのまま Lv60 内のEXPになる。 */
function atLevel60(sleepExp: number, target: { level: number; expInLevel: number }) {
  return calcSleepReachLevel({
    reachedLevel: 60,
    reachedExpInLevel: 0,
    sleepExp,
    targetLevel: target.level,
    targetExpInLevel: target.expInLevel,
    expType: EXP_TYPE,
  });
}

describe('calcSleepReachLevel: 小数は切り捨て', () => {
  it('60.96 は 60.9 になる（61.0 へ繰り上げない）', () => {
    // 2,751 / 2,865 = 0.9602… → 小数第1位は 9
    expect(atLevel60(2751, { level: 60, expInLevel: 0 })).toEqual({
      shown: true, level: 60, tenths: 9, ratio: 2751 / 2865,
    });
  });

  it('次のLvへ届く直前でも整数部は上がらない', () => {
    // 2,864 / 2,865 = 0.99965… → 60.9
    expect(atLevel60(2864, { level: 60, expInLevel: 0 })).toEqual({
      shown: true, level: 60, tenths: 9, ratio: 2864 / 2865,
    });
  });

  it('1Lvぶん余れば整数部が上がる', () => {
    // Lv61 + 1,432。Lv61→62 = 57,280 − 54,358 = 2,922 なので 1,432 / 2,922 = 0.49… → 61.4
    expect(atLevel60(2865 + 1432, { level: 60, expInLevel: 0 })).toEqual({
      shown: true, level: 61, tenths: 4, ratio: 1432 / 2922,
    });
  });
});

describe('calcSleepReachLevel: Lv70 は小数を付けない', () => {
  it('Lv70 ちょうどに着地したら tenths は null', () => {
    const reach = calcSleepReachLevel({
      reachedLevel: 69,
      reachedExpInLevel: 0,
      sleepExp: 3255,
      targetLevel: 65,
      targetExpInLevel: 0,
      expType: EXP_TYPE,
    });
    expect(reach).toEqual({ shown: true, level: 70, tenths: null, ratio: null });
  });

  it('Lv70 を超える睡眠EXPでも Lv70 / null で止まる', () => {
    const reach = calcSleepReachLevel({
      reachedLevel: 69,
      reachedExpInLevel: 0,
      sleepExp: 100_000,
      targetLevel: 65,
      targetExpInLevel: 0,
      expType: EXP_TYPE,
    });
    expect(reach).toEqual({ shown: true, level: 70, tenths: null, ratio: null });
  });
});

describe('calcSleepReachLevel: 出さない行', () => {
  it('睡眠EXPが 0 なら出さない', () => {
    expect(atLevel60(0, { level: 60, expInLevel: 0 })).toEqual({
      shown: false, reason: 'noSleepExp',
    });
  });

  it('目標Lvへ届かない行では出さない（既存の「残EXP → 約◯日」が答えている）', () => {
    const reach = calcSleepReachLevel({
      reachedLevel: 58,
      reachedExpInLevel: 0,
      sleepExp: 500,
      targetLevel: 60,
      targetExpInLevel: 0,
      expType: EXP_TYPE,
    });
    expect(reach).toEqual({ shown: false, reason: 'notExceedingTarget' });
  });

  it('アメ＋睡眠でちょうど届く行の ceil 余剰では出さない（目標Lv60 の行に約60.0 を出さない）', () => {
    // 100 / 2,865 = 0.034… → 小数第1位は 0。目標を 100EXP 超えてはいるが表示値は 60.0。
    expect(atLevel60(100, { level: 60, expInLevel: 0 })).toEqual({
      shown: false, reason: 'displayEqualsTargetLevel',
    });
  });

  it('小数が 0 でも整数部が目標Lvより高ければ出す（隠すのは目標Lvちょうどの行だけ）', () => {
    // 実測: 元Lv50 / 目標Lv55 / 睡眠2000h（21,648EXP）→ Lv60 + 148EXP。
    // 148 / 2,865 = 0.051… で小数第1位は 0 だが、目標Lv55 より5段上なので出す（約60.0）。
    const reach = calcSleepReachLevel({
      reachedLevel: 50,
      reachedExpInLevel: 0,
      sleepExp: 21_648,
      targetLevel: 55,
      targetExpInLevel: 0,
      expType: EXP_TYPE,
    });
    expect(reach).toEqual({ shown: true, level: 60, tenths: 0, ratio: 148 / 2865 });
  });

  it('目標Lv内EXPがある行で、着地点が目標より下なら出さない', () => {
    // 表示値は 60.5 で目標Lv 60 より高く見えるが、着地点 Lv60+1,432 は目標 Lv60+2,500 に届いていない。
    expect(atLevel60(1432, { level: 60, expInLevel: 2500 })).toEqual({
      shown: false, reason: 'notExceedingTarget',
    });
  });
});

describe('calcSleepReachLevel: 目標Lv内EXPがある行', () => {
  it('目標を超えていて表示値も目標Lvより高ければ出す', () => {
    // 着地 Lv60+2,100 は目標 Lv60+2,000 を 100EXP 超える。2,100 / 2,865 = 0.73… → 60.7
    expect(atLevel60(2100, { level: 60, expInLevel: 2000 })).toEqual({
      shown: true, level: 60, tenths: 7, ratio: 2100 / 2865,
    });
  });
});
