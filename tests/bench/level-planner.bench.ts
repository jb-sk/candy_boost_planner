import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { getCandyFamilyKey } from '../../src/domain/pokesleep/candy-family';
import type { LevelPlannerInput, PokemonPlanInput } from '../../src/domain/level-planner/types';
import { LEGACY_BROWSER_TARGET } from '../../vite.config';

type LevelPlannerCore = typeof import('../../src/domain/level-planner/core');

// でんき・EXPタイプ600 の2系統（ピカチュウ・ライチュウ／メリープ・モココ）。同じ種族アメを2匹ずつ共有する
const BENCH_POKEDEX_IDS = [25, 26, 179, 180];
// 系統キーは測る範囲の外で一度だけ求める（src のモジュールを毎回呼ぶと Vitest の export getter が測定に乗る）
const BENCH_FAMILY_KEYS = BENCH_POKEDEX_IDS.map(getCandyFamilyKey);
const [LATIAS_FAMILY, JOLTEON_FAMILY, SUICUNE_FAMILY] = [380, 135, 245].map(getCandyFamilyKey);

function fixture(count: number, contended: boolean): LevelPlannerInput {
  const pokemonList: PokemonPlanInput[] = Array.from({ length: count }, (_, index) => ({
    pokemonId: `bench-${index}`,
    pokedexId: BENCH_POKEDEX_IDS[index % BENCH_POKEDEX_IDS.length]!,
    candyFamilyKey: BENCH_FAMILY_KEYS[index % BENCH_FAMILY_KEYS.length]!,
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
        candyFamilyKey: LATIAS_FAMILY!,
        name: 'Latias',
        type: 'dragon',
        currentLevel: 55,
        currentExpInLevel: 4103,
        targetLevel: 70,
        expType: 1080,
        nature: 'normal',
        requestedBoostCandy: 350,
        boostAllowed: true,
        candyTarget: { totalCandyUnits: 350, boostedCandyUnits: 350 },
        priorityIndex: 0,
      },
      {
        pokemonId: 'jolteon',
        pokedexId: 135,
        candyFamilyKey: JOLTEON_FAMILY!,
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
        candyFamilyKey: SUICUNE_FAMILY!,
        name: 'Suicune',
        type: 'water',
        currentLevel: 61,
        currentExpInLevel: 5259,
        targetLevel: 70,
        expType: 1080,
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
  // src を直接読むと、モジュールをまたぐ呼び出しのたびに Vitest の export getter がはさまり、本番より遅く出る。
  // 本番と同じ Rolldown・target で1ファイルにまとめたものを測る（まとめると内部の呼び出しは直接になる）。
  let outDir = '';
  let solveLevelPlan: LevelPlannerCore['solveLevelPlan'];
  beforeAll(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'level-planner-bench-'));
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        outDir,
        target: LEGACY_BROWSER_TARGET,
        lib: { entry: path.resolve('src/domain/level-planner/core/index.ts'), formats: ['es'], fileName: 'core' },
      },
    });
    ({ solveLevelPlan } = await import(pathToFileURL(path.join(outDir, 'core.js')).href) as LevelPlannerCore);
  });
  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  for (const count of [5, 10, 20]) {
    test(`${count} Pokémon`, async ({ bench }) => {
      await bench.compare(
        bench(`${count} Pokémon / uncontended`, () => { solveLevelPlan(fixture(count, false)); }),
        bench(`${count} Pokémon / contended`, () => { solveLevelPlan(fixture(count, true)); }),
      );
    });
  }
  test('3 Pokémon / high level reload case', async ({ bench }) => {
    await bench('3 Pokémon / high level reload case', () => { solveLevelPlan(highLevelFixture()); }).run();
  });
});
