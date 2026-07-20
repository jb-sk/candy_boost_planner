/**
 * 睡眠育成機能のテスト
 *
 * @see .agent/DESIGN_SLEEP_GROWTH.md
 *
 * テスト方針:
 * - Test1-5: markForSleep 単体テスト
 * - Test6-7: calcSleepTimeForExp 単体テスト
 * - Test8以降の旧レベルプランナー疑似E2Eは fbl01 の新パイプライン移行で削除。
 */

import { describe, it, expect } from 'vitest';
import { markForSleep, calcSleepTimeForExp } from '../sleep-growth';

describe('睡眠育成機能', () => {
  describe('markForSleep', () => {
    it('Test0: 0hなら0日・0EXP', () => {
      const result = markForSleep({
        targetSleepHours: 0,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      expect(result.requiredDays).toBe(0);
      expect(result.sleepExp).toBe(0);
    });

    it('Test1: 2000h、8.5h/日、性格normal、GSDオン', () => {
      const result = markForSleep({
        targetSleepHours: 2000,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // requiredDays = ceil(2000 / 8.5) = 236
      expect(result.requiredDays).toBe(236);

      // dailyExp = 100 (8.5h, nature normal, bonus 1.0)
      // gsdCycles = floor(236 / 29.53) = 7
      // gsdBonus = 7 * 400 = 2800
      // sleepExp = 100 * 236 + 2800 = 26400
      expect(result.sleepExp).toBe(26400);
    });

    it('Test2: 1000h、8.5h/日、性格normal、GSDオン', () => {
      const result = markForSleep({
        targetSleepHours: 1000,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // requiredDays = ceil(1000 / 8.5) = 118
      expect(result.requiredDays).toBe(118);

      // gsdCycles = floor(118 / 29.53) = 3
      // gsdBonus = 3 * 400 = 1200
      // sleepExp = 100 * 118 + 1200 = 13000
      expect(result.sleepExp).toBe(13000);
    });

    it('Test3: 性格upで睡眠EXPが増加', () => {
      const result = markForSleep({
        targetSleepHours: 2000,
        nature: 'up',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // dailyExp = floor(100 * 1.18) = 118
      // sleepExp = 118 * 236 + 2800 = 30648
      expect(result.sleepExp).toBe(30648);
    });

    it('Test4: 性格downで睡眠EXPが減少', () => {
      const result = markForSleep({
        targetSleepHours: 2000,
        nature: 'down',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      // dailyExp = floor(100 * 0.82) = 82
      // sleepExp = 82 * 236 + 2800 = 22152
      expect(result.sleepExp).toBe(22152);
    });

    it('Test5: GSDオフでGSDボーナスなし', () => {
      const result = markForSleep({
        targetSleepHours: 2000,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: false,
      });

      // sleepExp = 100 * 236 + 0 = 23600
      expect(result.sleepExp).toBe(23600);
    });
  });

  describe('calcSleepTimeForExp', () => {
    it('Test6: 残EXP 26400を8.5h/日でカバー → 236日必要', () => {
      const result = calcSleepTimeForExp({
        expToTarget: 26400,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      expect(result.requiredDays).toBe(236);
      expect(result.requiredHours).toBe(236 * 8.5);
    });

    it('Test7: 残EXP 0 → 0日必要', () => {
      const result = calcSleepTimeForExp({
        expToTarget: 0,
        nature: 'normal',
        dailySleepHours: 8.5,
        sleepExpBonus: 1.0,
        includeGSD: true,
      });

      expect(result.requiredDays).toBe(0);
      expect(result.requiredHours).toBe(0);
    });
  });
});
