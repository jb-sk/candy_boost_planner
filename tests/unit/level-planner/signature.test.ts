import { describe, expect, it } from 'vitest';
import { buildPlannerInputSignature } from '../../../src/domain/level-planner/signature';
import type { LevelPlannerInput } from '../../../src/domain/level-planner/types';

const baseInput: LevelPlannerInput = {
  pokemonList: [{ pokemonId: 'p', pokedexId: 25, candyFamilyKey: '25', name: 'P', type: 'electric', currentLevel: 10, currentExpInLevel: 2, targetLevel: 20, expType: 600, nature: 'normal', requestedBoostCandy: 20, boostAllowed: true, priorityIndex: 0 }],
  dreamShards: 100,
  boost: { kind: 'full', limit: 350 },
  candyInventory: { species: { '25': 10 }, typeCandy: { electric: { s: 2, m: 1 } }, universal: { s: 3, m: 4, l: 5 } },
  options: { itemCompareMode: 'surplusFirst' },
};

describe('planner signatures', () => {
  it('inventory key insertion order does not change the input signature', () => {
    const reordered: LevelPlannerInput = {
      ...baseInput,
      candyInventory: {
        species: { '25': 10 },
        typeCandy: { electric: { m: 1, s: 2 } },
        universal: { l: 5, s: 3, m: 4 },
      },
    };

    expect(buildPlannerInputSignature(reordered)).toBe(buildPlannerInputSignature(baseInput));
  });

  it('candy-target presence changes the input signature', () => {
    const changed: LevelPlannerInput = {
      ...baseInput,
      pokemonList: [{ ...baseInput.pokemonList[0], candyTarget: { totalCandyUnits: 20, boostedCandyUnits: 20 } }],
    };

    expect(buildPlannerInputSignature(changed)).not.toBe(buildPlannerInputSignature(baseInput));
  });

  it('family key の変更は入力の署名を変える', () => {
    const changed: LevelPlannerInput = {
      ...baseInput,
      pokemonList: [{ ...baseInput.pokemonList[0], candyFamilyKey: '172' }],
    };

    expect(buildPlannerInputSignature(changed)).not.toBe(buildPlannerInputSignature(baseInput));
  });
});
