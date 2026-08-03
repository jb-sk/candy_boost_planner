import { describe, expect, it } from 'vitest';
import { compareExactSupplyObjective, exactSupplyObjectiveFor, refineExactSupply as refineExactSupplyImpl } from '../../../src/domain/level-planner/core/exactSupplyRefine';
import type { ExactSupplyMode, ExactSupplyRow } from '../../../src/domain/level-planner/core/exactSupplyRefine';
import { itemCountsFromPriority } from '../../../src/domain/level-planner/core/itemPriority';
import type { CandyInventory } from '../../../src/domain/level-planner/types';

/**
 * このファイルの fixture は需要充足だけを扱うので、`candyDemandMet` はここで既定を与える。
 * **本体側（`ExactSupplyRow`）は必須のまま**にしておくこと。任意にすると、未達行を
 * 埋め忘れた呼び出しが「全行が充足」として黙って集計される。
 */
type TestExactSupplyRow = Omit<ExactSupplyRow, 'candyFamilyKey' | 'candyDemandMet'>
  & { candyFamilyKey?: string; candyDemandMet?: boolean };

function withTestDefaults(rows: TestExactSupplyRow[]): ExactSupplyRow[] {
  return rows.map(row => ({
    ...row,
    candyFamilyKey: row.candyFamilyKey ?? String(row.pokedexId),
    candyDemandMet: row.candyDemandMet ?? true,
  }));
}

function refineExactSupply(rows: TestExactSupplyRow[], stock: CandyInventory, mode: ExactSupplyMode) {
  return refineExactSupplyImpl(withTestDefaults(rows), stock, mode);
}

const inventory: CandyInventory = {
  species: {},
  typeCandy: {
    alpha: { s: 0, m: 0 },
    beta: { s: 0, m: 0 },
  },
  universal: { s: 10, m: 1, l: 0 },
};

const rows = [
  {
    id: 'a',
    name: 'A',
    pokedexId: 1,
    type: 'alpha',
    totalCandyCount: 2,
    selected: { species: 0, typeS: 0, typeM: 0, universalS: 1, universalM: 0, universalL: 0, supply: 3, surplus: 1 },
  },
  {
    id: 'b',
    name: 'B',
    pokedexId: 2,
    type: 'beta',
    totalCandyCount: 20,
    selected: { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 1, universalL: 0, supply: 20, surplus: 0 },
  },
];

describe('exactSupplyRefine', () => {
  it('surplusFirstの固定需要refineでも同じ余り合計ならLvMAX余り0達成数を優先する', () => {
    const surplusOne = { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supply: 1, surplus: 1 };
    const surplusZero = { ...surplusOne, supply: 0, surplus: 0 };
    // `speciesLexOrder` は「上位から取る」種族配分の正規形を表す内部順位（先頭が0、以降は負）。
    // **省くと `speciesLex` が常に0になって正規形が黙って無効化される**ので、明示的に渡す。
    const sourceRows = [
      { legacyZeroSurplusPriority: true, candyDemandMet: true, speciesLexOrder: 0 },
      { legacyZeroSurplusPriority: false, candyDemandMet: true, speciesLexOrder: -1 },
    ];
    const lvMaxHasSurplus = exactSupplyObjectiveFor([surplusOne, surplusZero], sourceRows);
    const lvMaxHasZero = exactSupplyObjectiveFor([surplusZero, surplusOne], sourceRows);

    expect(compareExactSupplyObjective(lvMaxHasZero, lvMaxHasSurplus, 'surplusFirst')).toBeGreaterThan(0);
  });

  it('selected行の供給値が不整合ならinvalid_selectedにする', () => {
    const result = refineExactSupply([{
      id: 'invalid-supply',
      name: 'Invalid Supply',
      pokedexId: 99,
      type: 'alpha',
      totalCandyCount: 2,
      selected: { species: 0, typeS: 0, typeM: 0, universalS: 1, universalM: 0, universalL: 0, supply: 2, surplus: 0 },
    }], {
      species: {},
      typeCandy: { alpha: { s: 0, m: 0 } },
      universal: { s: 1, m: 0, l: 0 },
    }, 'surplusFirst');

    expect(result.status).toBe('invalid_selected');
    if (result.status === 'ok') return;
    expect(result.reason).toBe('supply_mismatch:invalid-supply');
  });

  it('selected行が共有在庫を超過していればinvalid_selectedにする', () => {
    const result = refineExactSupply([
      {
        id: 'stock-a',
        name: 'Stock A',
        pokedexId: 101,
        type: 'alpha',
        totalCandyCount: 3,
        selected: { species: 0, typeS: 0, typeM: 0, universalS: 1, universalM: 0, universalL: 0, supply: 3, surplus: 0 },
      },
      {
        id: 'stock-b',
        name: 'Stock B',
        pokedexId: 102,
        type: 'beta',
        totalCandyCount: 3,
        selected: { species: 0, typeS: 0, typeM: 0, universalS: 1, universalM: 0, universalL: 0, supply: 3, surplus: 0 },
      },
    ], {
      species: {},
      typeCandy: { alpha: { s: 0, m: 0 }, beta: { s: 0, m: 0 } },
      universal: { s: 1, m: 0, l: 0 },
    }, 'surplusFirst');

    expect(result.status).toBe('invalid_selected');
    if (result.status === 'ok') return;
    expect(result.reason).toBe('universal_s_stock_exceeded');
  });

  it('異なる図鑑番号でも同じfamilyの種族アメを二重使用できない', () => {
    const result = refineExactSupply([
      {
        id: 'pichu',
        name: 'ピチュー',
        pokedexId: 172,
        candyFamilyKey: '25',
        type: 'electric',
        totalCandyCount: 4,
        selected: { species: 4, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supply: 4, surplus: 0 },
      },
      {
        id: 'pikachu',
        name: 'ピカチュウ',
        pokedexId: 25,
        candyFamilyKey: '25',
        type: 'electric',
        totalCandyCount: 4,
        selected: { species: 4, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supply: 4, surplus: 0 },
      },
    ], {
      species: { '25': 4 },
      typeCandy: { electric: { s: 0, m: 0 } },
      universal: { s: 0, m: 0, l: 0 },
    }, 'surplusFirst');

    expect(result).toMatchObject({ status: 'invalid_selected', reason: 'species_stock_exceeded:25' });
  });

  it('外部からspeciesLexOrderが混入しても配列順から導出し、種族アメを上位へ配る', () => {
    const sharedRows = withTestDefaults([
      {
        id: 'upper',
        name: 'Upper',
        pokedexId: 133,
        candyFamilyKey: '133',
        type: 'normal',
        totalCandyCount: 1,
        selected: { species: 1, typeS: 0, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supply: 1, surplus: 0 },
      },
      {
        id: 'lower',
        name: 'Lower',
        pokedexId: 133,
        candyFamilyKey: '133',
        type: 'normal',
        totalCandyCount: 1,
        selected: { species: 0, typeS: 0, typeM: 0, universalS: 1, universalM: 0, universalL: 0, supply: 3, surplus: 2 },
      },
    ]).map((row, index) => ({
      ...row,
      // 外部入力を信用すると下位行が勝つ逆順位を意図的に混入する。
      speciesLexOrder: index === 0 ? -100 : 100,
    }));

    const result = refineExactSupplyImpl(sharedRows, {
      species: { '133': 1 },
      typeCandy: { normal: { s: 0, m: 0 } },
      universal: { s: 1, m: 0, l: 0 },
    }, 'surplusGateFirst');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.selectedIsBest).toBe(true);
    expect(result.bestRows[0].species).toBe(1);
    expect(result.bestRows[1].species).toBe(0);
    expect(result.bestObjective.speciesLex).toBe(0);
  });

  it('種族アメ使用量を優先するため、余り0の非種族候補より余り1の種族候補をbestにする', () => {
    const result = refineExactSupply([{
      id: 'species-first',
      name: 'Species First',
      pokedexId: 103,
      type: 'alpha',
      totalCandyCount: 4,
      selected: { species: 0, typeS: 1, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supply: 4, surplus: 0 },
    }], {
      species: { '103': 1 },
      typeCandy: { alpha: { s: 1, m: 0 } },
      universal: { s: 0, m: 0, l: 0 },
    }, 'surplusFirst');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.selectedIsBest).toBe(false);
    expect(result.bestObjective.speciesUsed).toBe(1);
    expect(result.bestObjective.rawSurplus).toBe(1);
    expect(result.bestRows[0]).toMatchObject({ species: 1, typeS: 1, surplus: 1 });
  });

  it('surplusFirst は余り0..2を生値で比較し、余り悪化を選ばない', () => {
    const selected = exactSupplyObjectiveFor(
      rows.map(row => row.selected),
      withTestDefaults(rows).map((row, index) => ({ ...row, speciesLexOrder: -index })),
    );
    expect(selected.rawSurplus).toBe(1);
    expect(selected.normalizedSurplus).toBe(0);

    const result = refineExactSupply(rows, inventory, 'surplusFirst');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.selectedIsBest).toBe(true);
    expect(result.bestObjective.normalizedSurplus).toBe(0);
    expect(result.bestObjective.rawSurplus).toBe(1);
    expect(result.bestRows[1].universalM).toBe(1);
  });

  it('surplusFirst は同じ候補集合でも生余りが小さい選択を優先する', () => {
    const result = refineExactSupply(rows, inventory, 'surplusFirst');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.selectedIsBest).toBe(true);
    expect(result.bestObjective.rawSurplus).toBe(1);
    expect(result.bestRows[1].universalM).toBe(1);
  });

  it('surplusFirst は万能M温存よりタイプS使用を優先する', () => {
    const result = refineExactSupply([
      {
        id: 'type-s',
        name: 'Type S',
        pokedexId: 10,
        type: 'alpha',
        totalCandyCount: 24,
        selected: { species: 0, typeS: 6, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supply: 24, surplus: 0 },
      },
      {
        id: 'universal-m',
        name: 'Universal M',
        pokedexId: 11,
        type: 'beta',
        totalCandyCount: 20,
        selected: { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 1, universalL: 0, supply: 20, surplus: 0 },
      },
    ], {
      species: {},
      typeCandy: {
        alpha: { s: 6, m: 0 },
        beta: { s: 0, m: 0 },
      },
      universal: { s: 8, m: 1, l: 0 },
    }, 'surplusFirst');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.selectedIsBest).toBe(true);
    expect(result.bestRows[0].typeS).toBe(6);
    expect(result.bestRows[0].universalM).toBe(0);
    expect(result.bestRows[1].universalM).toBe(1);
  });

  it('資源グラフ分解後も独立部品間で万能在庫を二重使用しない', () => {
    const result = refineExactSupply([
      {
        id: 'component-alpha',
        name: 'Component Alpha',
        pokedexId: 201,
        type: 'alpha',
        totalCandyCount: 3,
        selected: { species: 0, typeS: 0, typeM: 0, universalS: 1, universalM: 0, universalL: 0, supply: 3, surplus: 0 },
      },
      {
        id: 'component-beta',
        name: 'Component Beta',
        pokedexId: 202,
        type: 'beta',
        totalCandyCount: 3,
        selected: { species: 0, typeS: 1, typeM: 0, universalS: 0, universalM: 0, universalL: 0, supply: 4, surplus: 1 },
      },
    ], {
      species: {},
      typeCandy: {
        alpha: { s: 0, m: 0 },
        beta: { s: 1, m: 0 },
      },
      universal: { s: 1, m: 0, l: 0 },
    }, 'surplusFirst');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.bestRows.reduce((sum, row) => sum + row.universalS, 0)).toBe(1);
    expect(result.bestRows[0]).toMatchObject({ universalS: 1, surplus: 0 });
    expect(result.bestRows[1]).toMatchObject({ typeS: 1, universalS: 0, surplus: 1 });
    expect(result.bestObjective.rawSurplus).toBe(1);
    expect(result.scope).toBe('candidate-surplus<=1');
  });

  it('legacyImproved はアイテム優先後に余り0..2を比較する', () => {
    const selected = {
      species: 319,
      typeS: 13,
      typeM: 0,
      universalS: 65,
      universalM: 0,
      universalL: 0,
      supply: 566,
      surplus: 2,
    };
    const row = [{
      id: 'legacy',
      name: 'Legacy',
      pokedexId: 1000,
      type: 'dragon',
      totalCandyCount: 564,
      selected,
    }];
    const stock: CandyInventory = {
      species: { '1000': 319 },
      typeCandy: { dragon: { s: 13, m: 0 } },
      universal: { s: 65, m: 2, l: 0 },
    };

    const legacy = refineExactSupply(row, stock, 'legacyImproved');
    expect(legacy.status).toBe('ok');
    if (legacy.status !== 'ok') return;
    expect(legacy.selectedIsBest).toBe(true);
    expect(legacy.bestRows[0].universalM).toBe(0);
    expect(legacy.bestObjective.rawSurplus).toBe(2);

    const surplus = refineExactSupply(row, stock, 'surplusFirst');
    expect(surplus.status).toBe('ok');
    if (surplus.status !== 'ok') return;
    expect(surplus.selectedIsBest).toBe(false);
    // 余り0にするには万能Mが要る。タイプSを使い切る側を選ぶので2個使い、万能Sは14個残る
    expect(surplus.bestRows[0]).toMatchObject({ typeS: 13, universalS: 51, universalM: 2 });
    expect(surplus.bestObjective.rawSurplus).toBe(0);
  });

  it('legacyImproved は各行が余り0..2なら合計余りが2を超えてもバッグ圧縮ゲート内として扱う', () => {
    const localRows = [
      {
        id: 'legacy-row-a',
        name: 'Legacy Row A',
        pokedexId: 1100,
        type: 'alpha',
        totalCandyCount: 19,
        selected: { species: 0, typeS: 0, typeM: 0, universalS: 7, universalM: 0, universalL: 0, supply: 21, surplus: 2 },
      },
      {
        id: 'legacy-row-b',
        name: 'Legacy Row B',
        pokedexId: 1101,
        type: 'beta',
        totalCandyCount: 19,
        selected: { species: 0, typeS: 0, typeM: 0, universalS: 7, universalM: 0, universalL: 0, supply: 21, surplus: 2 },
      },
    ];
    const stock: CandyInventory = {
      species: {},
      typeCandy: { alpha: { s: 0, m: 0 }, beta: { s: 0, m: 0 } },
      universal: { s: 14, m: 2, l: 0 },
    };

    const result = refineExactSupply(localRows, stock, 'legacyImproved');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.selectedIsBest).toBe(true);
    expect(result.bestObjective.normalizedSurplus).toBe(0);
    expect(result.bestObjective.rawSurplus).toBe(4);
    expect(result.bestRows.every(row => row.universalM === 0)).toBe(true);
  });

  it('legacyImproved は余り0..2ゲートをバッグ圧縮アイテム優先より先に見る', () => {
    const row = [{
      id: 'legacy-gate',
      name: 'Legacy Gate',
      pokedexId: 1001,
      type: 'dragon',
      totalCandyCount: 20,
      selected: { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 1, universalL: 0, supply: 20, surplus: 0 },
    }];
    const stock: CandyInventory = {
      species: { '1001': 0 },
      typeCandy: { dragon: { s: 0, m: 1 } },
      universal: { s: 0, m: 1, l: 0 },
    };

    const legacy = refineExactSupply(row, stock, 'legacyImproved');
    expect(legacy.status).toBe('ok');
    if (legacy.status !== 'ok') return;
    expect(legacy.selectedIsBest).toBe(true);
    expect(legacy.bestRows[0].universalM).toBe(1);
    expect(legacy.bestRows[0].typeM).toBe(0);
    expect(legacy.bestObjective.rawSurplus).toBe(0);
  });

  it('legacyImproved は万能S在庫432では現行配分を在庫内のbestとして扱う', () => {
    const rows = [
      { id: 'pawmot', name: '80パーモット', pokedexId: 923, type: 'electric', totalCandyCount: 632, selected: { species: 181, typeS: 0, typeM: 0, universalS: 144, universalM: 1, universalL: 0, supply: 633, surplus: 1 } },
      { id: 'cramorant', name: '70ウッウ', pokedexId: 845, type: 'flying', totalCandyCount: 298, selected: { species: 0, typeS: 0, typeM: 0, universalS: 66, universalM: 5, universalL: 0, supply: 298, surplus: 0 } },
      { id: 'sylveon', name: '70仮ニンフィア', pokedexId: 700, type: 'fairy', totalCandyCount: 3598, selected: { species: 2947, typeS: 0, typeM: 10, universalS: 87, universalM: 7, universalL: 0, supply: 3598, surplus: 0 } },
      { id: 'dragonite', name: '80カイリュー', pokedexId: 149, type: 'dragon', totalCandyCount: 948, selected: { species: 436, typeS: 13, typeM: 0, universalS: 127, universalM: 4, universalL: 0, supply: 949, surplus: 1 } },
      { id: 'swalot', name: '70マルノーム', pokedexId: 317, type: 'poison', totalCandyCount: 308, selected: { species: 272, typeS: 0, typeM: 1, universalS: 4, universalM: 0, universalL: 0, supply: 309, surplus: 1 } },
    ];
    const stock: CandyInventory = {
      species: { '923': 181, '700': 2947, '149': 436, '317': 272 },
      typeCandy: {
        electric: { s: 0, m: 0 },
        flying: { s: 0, m: 0 },
        fairy: { s: 0, m: 10 },
        dragon: { s: 13, m: 0 },
        poison: { s: 0, m: 1 },
      },
      universal: { s: 432, m: 17, l: 0 },
    };

    const legacy = refineExactSupply(rows, stock, 'legacyImproved');
    expect(legacy.status).toBe('ok');
    if (legacy.status !== 'ok') return;
    expect(legacy.selectedIsBest).toBe(true);
    expect(legacy.bestObjective.rawSurplus).toBe(3);
    expect(itemCountsFromPriority(legacy.bestObjective.priority)).toEqual({
      typeS: 13, typeM: 11, universalS: 428, universalM: 17, universalL: 0,
    });
    expect(legacy.bestRows.reduce((sum, row) => sum + row.universalS, 0)).toBe(428);
    expect(legacy.bestRows.reduce((sum, row) => sum + row.universalM, 0)).toBe(17);
  });

  it('大きい行余りは固定アメ数の供給再配分で救済できる', () => {
    const rows = [
      { id: 'pawmot', name: '80パーモット', pokedexId: 923, type: 'Electric', totalCandyCount: 316, legacyZeroSurplusPriority: true, selected: { species: 181, typeS: 0, typeM: 0, universalS: 45, universalM: 0, universalL: 0, supply: 316, surplus: 0 } },
      { id: 'cramorant', name: '70ウッウ', pokedexId: 845, type: 'Flying', totalCandyCount: 264, legacyZeroSurplusPriority: true, selected: { species: 0, typeS: 0, typeM: 0, universalS: 88, universalM: 0, universalL: 0, supply: 264, surplus: 0 } },
      { id: 'sylveon', name: '70仮ニンフィア', pokedexId: 700, type: 'Fairy', totalCandyCount: 3598, legacyZeroSurplusPriority: true, selected: { species: 2947, typeS: 0, typeM: 10, universalS: 127, universalM: 1, universalL: 0, supply: 3598, surplus: 0 } },
      { id: 'dragonite', name: '80カイリュー', pokedexId: 149, type: 'Dragon', totalCandyCount: 948, legacyZeroSurplusPriority: true, selected: { species: 436, typeS: 13, typeM: 0, universalS: 140, universalM: 2, universalL: 0, supply: 948, surplus: 0 } },
      { id: 'cresselia', name: '70仮クレセリア', pokedexId: 488, type: 'Psychic', totalCandyCount: 1138, legacyZeroSurplusPriority: true, selected: { species: 500, typeS: 18, typeM: 10, universalS: 32, universalM: 11, universalL: 0, supply: 1138, surplus: 0 } },
      { id: 'entei', name: 'エンテイ', pokedexId: 244, type: 'Fire', totalCandyCount: 1843, selected: { species: 100, typeS: 0, typeM: 0, universalS: 0, universalM: 88, universalL: 0, supply: 1860, surplus: 17 } },
      { id: 'swalot', name: '70マルノーム', pokedexId: 317, type: 'Poison', totalCandyCount: 308, selected: { species: 272, typeS: 0, typeM: 2, universalS: 0, universalM: 0, universalL: 0, supply: 322, surplus: 14 } },
    ];
    const stock: CandyInventory = {
      species: { '923': 181, '700': 2947, '149': 436, '488': 500, '244': 100, '317': 272 },
      typeCandy: {
        Electric: { s: 0, m: 0 },
        Flying: { s: 0, m: 0 },
        Fairy: { s: 0, m: 10 },
        Dragon: { s: 13, m: 0 },
        Psychic: { s: 18, m: 10 },
        Fire: { s: 0, m: 0 },
        Poison: { s: 0, m: 2 },
      },
      universal: { s: 432, m: 102, l: 0 },
    };

    const result = refineExactSupply(rows, stock, 'legacyImproved');

    expect(result.status, JSON.stringify(result)).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.selectedIsBest).toBe(false);
    expect(result.bestObjective.normalizedSurplus).toBe(0);
    expect(result.bestObjective.rawSurplus).toBeLessThan(31);
    expect(result.bestRows[5].surplus).toBeLessThanOrEqual(2);
    expect(result.bestRows[6].surplus).toBeLessThanOrEqual(2);
  });

  it('巨大な検算ケースは遷移上限でinconclusiveを返し、処理を続けない', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: `large-${index}`,
      name: `Large ${index}`,
      pokedexId: 20_000 + index,
      type: 'shared',
      totalCandyCount: 100,
      selected: { species: 0, typeS: 0, typeM: 0, universalS: 0, universalM: 5, universalL: 0, supply: 100, surplus: 0 },
    }));
    const stock: CandyInventory = {
      species: {},
      typeCandy: { shared: { s: 500, m: 120 } },
      universal: { s: 500, m: 120, l: 0 },
    };

    const result = refineExactSupply(rows, stock, 'legacyImproved');

    expect(result.status).toBe('inconclusive');
    if (result.status !== 'inconclusive') return;
    expect(['too_many_transitions', 'too_many_states', 'too_many_local_options', 'too_many_visits']).toContain(result.reason);
  });
});
