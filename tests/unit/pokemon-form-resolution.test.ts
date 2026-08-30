import { describe, expect, it } from 'vitest';

import {
  assertNoUnknownFormLabels,
  collectUnknownFormLabels,
  splitPokemonNameAndForm,
} from '../../scripts/pokemon-form-resolution.mjs';

const items = [
  { dexNo: 25, nameJa: 'ピカチュウ' },
  { dexNo: 25, nameJa: 'ピカチュウ(キャプテン)' },
];

function toIdForm(pokedexId: number, form: number): number {
  return (pokedexId | 0) + ((form | 0) << 12);
}

describe('pokemon form resolution', () => {
  it('未知フォームを検出し、未解決のままでは生成を許可しない', () => {
    const formJaToNumber = {};

    expect([...collectUnknownFormLabels(items, formJaToNumber)]).toEqual(['キャプテン']);
    expect(() => assertNoUnknownFormLabels(items, formJaToNumber)).toThrow(
      '未知フォームが未解決のため、MasterDB の生成を中断しました: キャプテン',
    );
  });

  it('フォーム登録後は通常フォームと新フォームを別のidFormへ解決する', () => {
    const formJaToNumber = { キャプテン: 11 };

    expect(() => assertNoUnknownFormLabels(items, formJaToNumber)).not.toThrow();

    const normal = splitPokemonNameAndForm(items[0].nameJa, formJaToNumber);
    const captain = splitPokemonNameAndForm(items[1].nameJa, formJaToNumber);

    expect(normal).toEqual({ baseNameJa: 'ピカチュウ', form: 0, formLabelJa: null });
    expect(captain).toEqual({ baseNameJa: 'ピカチュウ', form: 11, formLabelJa: 'キャプテン' });
    expect(toIdForm(25, normal.form)).toBe(25);
    expect(toIdForm(25, captain.form)).toBe(45081);
  });
});
