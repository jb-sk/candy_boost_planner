/**
 * toSubSkills マイグレーションテスト
 *
 * v3.6.0 サブスキル解放Lv変更: 75→70, 100→80
 * 旧形式データが正しく新形式に変換されることを検証
 */

import { describe, it, expect } from 'vitest';
import { toSubSkills } from '../../../src/persistence/box';

describe('toSubSkills マイグレーション', () => {
  // 旧形式 → 新形式
  it('lv 75→70, 100→80 に変換される', () => {
    const input = [
      { lv: 10, nameEn: 'Helping Speed M' },
      { lv: 25, nameEn: 'Inventory Up M' },
      { lv: 50, nameEn: 'Ingredient Finder M' },
      { lv: 75, nameEn: 'Skill Trigger M' },
      { lv: 100, nameEn: 'Berry Finding S' },
    ];
    expect(toSubSkills(input)).toEqual([
      { lv: 10, nameEn: 'Helping Speed M' },
      { lv: 25, nameEn: 'Inventory Up M' },
      { lv: 50, nameEn: 'Ingredient Finder M' },
      { lv: 70, nameEn: 'Skill Trigger M' },
      { lv: 80, nameEn: 'Berry Finding S' },
    ]);
  });

  // 新形式はそのまま通過
  it('新形式(70/80)はそのまま保持される', () => {
    const input = [
      { lv: 10, nameEn: 'Helping Speed M' },
      { lv: 70, nameEn: 'Skill Trigger M' },
      { lv: 80, nameEn: 'Berry Finding S' },
    ];
    expect(toSubSkills(input)).toEqual(input);
  });

  // 冪等性: 変換済みデータを再度変換しても同じ
  it('冪等性: 2回変換しても結果が変わらない', () => {
    const input = [
      { lv: 75, nameEn: 'Skill Trigger M' },
      { lv: 100, nameEn: 'Berry Finding S' },
    ];
    const first = toSubSkills(input);
    const second = toSubSkills(first);
    expect(second).toEqual(first);
  });

  // 不正なレベル値はフィルタされる
  it('不正なlv値(99等)はフィルタされる', () => {
    const input = [
      { lv: 10, nameEn: 'Helping Speed M' },
      { lv: 99, nameEn: 'Invalid' },
      { lv: 50, nameEn: 'Ingredient Finder M' },
    ];
    expect(toSubSkills(input)).toEqual([
      { lv: 10, nameEn: 'Helping Speed M' },
      { lv: 50, nameEn: 'Ingredient Finder M' },
    ]);
  });

  // nameEnが空のエントリはスキップ
  it('nameEnが空のエントリはスキップされる', () => {
    const input = [
      { lv: 10, nameEn: '' },
      { lv: 25, nameEn: 'Inventory Up M' },
    ];
    expect(toSubSkills(input)).toEqual([
      { lv: 25, nameEn: 'Inventory Up M' },
    ]);
  });

  // 空配列 → undefined
  it('空配列はundefinedを返す', () => {
    expect(toSubSkills([])).toBeUndefined();
  });

  // 非配列 → undefined
  it('非配列入力はundefinedを返す', () => {
    expect(toSubSkills('not-array')).toBeUndefined();
    expect(toSubSkills(null)).toBeUndefined();
    expect(toSubSkills(undefined)).toBeUndefined();
    expect(toSubSkills(42)).toBeUndefined();
  });

  // 全エントリが不正 → undefined
  it('全エントリが不正な場合はundefinedを返す', () => {
    const input = [
      { lv: 99, nameEn: 'Invalid' },
      { lv: 0, nameEn: 'Also Invalid' },
    ];
    expect(toSubSkills(input)).toBeUndefined();
  });
});
