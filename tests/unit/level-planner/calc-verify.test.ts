/**
 * calcLevelByCandy 検証テスト（Test 54）
 *
 * 到達Lv+EXP計算の正確性を検証するためのテスト
 * アメ1個の差が到達EXPに反映されることを確認
 */

import { describe, it, expect } from 'vitest';
import { calcLevelByCandy } from '../../../src/domain/pokesleep/exp';

describe('calcLevelByCandy 検証テスト', () => {
  // ========================================
  // テスト54: アメ1個の差が到達EXPに反映される
  // ========================================
  // シナリオ:
  // - スイクン: Lv50 → Lv65、EXP下降補正
  // - 500アメ vs 501アメで到達EXPを比較
  //
  // 期待:
  // - 501アメの方が到達EXPが高い
  describe('Test54: スイクン 500 vs 501 アメブ', () => {
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
