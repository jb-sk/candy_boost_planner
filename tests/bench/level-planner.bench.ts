import { bench, describe } from 'vitest';
import { solveLevelPlan } from '../../src/domain/level-planner/core';
import { getCandyFamilyKey } from '../../src/domain/pokesleep/candy-family';
import type { LevelPlannerInput, PokemonPlanInput } from '../../src/domain/level-planner/types';

function fixture(count: number, contended: boolean): LevelPlannerInput {
  const pokemonList: PokemonPlanInput[] = Array.from({ length: count }, (_, index) => ({
    pokemonId: `bench-${index}`,
    pokedexId: 25 + (index % 4),
    candyFamilyKey: getCandyFamilyKey(25 + (index % 4)),
    name: `bench-${index}`,
    type: 'electric',
    currentLevel: 10,
    currentExpInLevel: 0,
    targetLevel: 25,
    expType: 600,
    nature: 'normal',
    requestedBoostCandy: 120,
    boostAllowed: true,
    priorityIndex: index,
  }));
  const stock = contended ? 2 : 10_000;
  return {
    pokemonList,
    dreamShards: contended ? 100 : 1_000_000,
    boost: { kind: 'full', limit: contended ? 20 : 10_000 },
    candyInventory: {
      species: Object.fromEntries(pokemonList.map(pokemon => [pokemon.candyFamilyKey, stock])),
      typeCandy: { electric: { s: stock, m: stock } },
      universal: { s: stock, m: stock, l: stock },
    },
  };
}

function highLevelFixture(): LevelPlannerInput {
  return {
    pokemonList: [
      {
        pokemonId: 'latias',
        pokedexId: 380,
        candyFamilyKey: getCandyFamilyKey(380),
        name: 'Latias',
        type: 'dragon',
        currentLevel: 55,
        currentExpInLevel: 4103,
        targetLevel: 70,
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 350,
        boostAllowed: true,
        candyTarget: { totalCandyUnits: 350, boostedCandyUnits: 350 },
        priorityIndex: 0,
      },
      {
        pokemonId: 'jolteon',
        pokedexId: 135,
        candyFamilyKey: getCandyFamilyKey(135),
        name: 'Jolteon',
        type: 'electric',
        currentLevel: 25,
        currentExpInLevel: 622,
        targetLevel: 60,
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 0,
        boostAllowed: true,
        priorityIndex: 1,
      },
      {
        pokemonId: 'suicune',
        pokedexId: 245,
        candyFamilyKey: getCandyFamilyKey(245),
        name: 'Suicune',
        type: 'water',
        currentLevel: 61,
        currentExpInLevel: 5259,
        targetLevel: 70,
        expType: 600,
        nature: 'normal',
        requestedBoostCandy: 0,
        boostAllowed: true,
        priorityIndex: 2,
      },
    ],
    dreamShards: 4_200_000,
    boost: { kind: 'full', limit: 350 },
    candyInventory: {
      species: { '380': 319, '133': 656, '245': 478 },
      typeCandy: {
        dragon: { s: 13, m: 0 },
        electric: { s: 380, m: 0 },
        water: { s: 536, m: 0 },
      },
      universal: { s: 432, m: 102, l: 9 },
    },
  };
}

describe('level planner reference fixtures (not a CI gate)', () => {
  for (const count of [5, 10, 20]) {
    bench(`${count} Pokémon / uncontended`, () => { solveLevelPlan(fixture(count, false)); });
    bench(`${count} Pokémon / contended`, () => { solveLevelPlan(fixture(count, true)); });
  }
  bench('3 Pokémon / high level reload case', () => { solveLevelPlan(highLevelFixture()); });
});
