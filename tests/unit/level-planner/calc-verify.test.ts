/**
 * 計算ロジック検証テスト（Test 54b, 69）
 *
 * calcExpPerCandy のレベル帯境界値テスト
 * calcLevelByCandy の到達Lv+EXP計算の正確性検証
 */

import { describe, it, expect } from 'vitest';
import { calcLevelByCandy, calcExpPerCandy } from '../../../src/domain/pokesleep/exp';

describe('Test69: calcExpPerCandy 境界値テスト', () => {
  // Lv24: base=40 (normal), 47 (up), 33 (down)
  // Lv25: base=35 (normal), 41 (up), 29 (down)
  // Lv29: base=35 (normal), 41 (up), 29 (down)
  // Lv30: base=25 (normal), 30 (up), 21 (down)
  it.each([
    // [level, nature, boost, expected]
    [24, 'normal', 'none', 40],
    [24, 'up', 'none', 47],
    [24, 'down', 'none', 33],
    [25, 'normal', 'none', 35],
    [25, 'up', 'none', 41],
    [25, 'down', 'none', 29],
    [29, 'normal', 'none', 35],
    [29, 'up', 'none', 41],
    [29, 'down', 'none', 29],
    [30, 'normal', 'none', 25],
    [30, 'up', 'none', 30],
    [30, 'down', 'none', 21],
    // boost doubles
    [24, 'normal', 'mini', 80],
    [25, 'normal', 'mini', 70],
    [30, 'normal', 'mini', 50],
    [30, 'normal', 'full', 50],
  ] as const)('Lv%i %s %s → %i', (level, nature, boost, expected) => {
    expect(calcExpPerCandy(level, nature, boost)).toBe(expected);
  });
});

describe('calcLevelByCandy 検証テスト', () => {
  // ========================================
  // テスト54b: アメ1個の差が到達EXPに反映される
  // ========================================
  // シナリオ:
  // - スイクン: Lv50 → Lv65、EXP下降補正
  // - 500アメ vs 501アメで到達EXPを比較
  //
  // 期待:
  // - 501アメの方が到達EXPが高い
  describe('Test54b: スイクン 500 vs 501 アメブ', () => {
    it('1アメの差が到達EXPに反映される', () => {
      const base = {
        srcLevel: 50,
        dstLevel: 65,
        expType: 1080 as const,
        nature: 'down' as const,
        boost: 'full' as const,
        expGot: 0,
      };

      const result500 = calcLevelByCandy({ ...base, candy: 500 });
      const result501 = calcLevelByCandy({ ...base, candy: 501 });

      // 1アメの差があるので、到達Lv+EXP は異なるはず
      expect(
        result501.level > result500.level ||
        (result501.level === result500.level && result501.expGot > result500.expGot)
      ).toBe(true);
    });
  });
});
