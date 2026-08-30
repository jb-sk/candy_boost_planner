import { describe, expect, it } from "vitest";

import type { PokemonPlanLine } from "../../../src/domain/level-planner/types";
import { fmtNumOrDash, isSameDisplayedLine } from "../../../src/utils/resultRowDisplay";

function planLine(overrides: Partial<PokemonPlanLine> = {}): PokemonPlanLine {
  return {
    level: 20,
    expInLevel: 0,
    expToNextLevel: 100,
    expToTarget: 0,
    totalCandyUnitsUsed: 100,
    boostedCandyUnits: 40,
    nonBoostCandyUnits: 60,
    candySupply: {
      species: 40,
      type: { s: 0, m: 0 },
      universal: { s: 20, m: 0, l: 0 },
    },
    dreamShardsUsed: 1234,
    expGained: 1000,
    surplusExp: 0,
    surplusCandyValue: 0,
    candyDemandMet: true,
    effectiveTargetReached: true,
    ...overrides,
  };
}

function withSupply(
  line: PokemonPlanLine,
  supply: PokemonPlanLine["candySupply"],
  overrides: Partial<PokemonPlanLine> = {},
): PokemonPlanLine {
  return { ...line, ...overrides, candySupply: supply };
}

describe("isSameDisplayedLine", () => {
  const base = planLine();
  const cases: Array<{
    name: string;
    other: PokemonPlanLine;
    expected: boolean;
  }> = [
    { name: "完全一致", other: planLine(), expected: true },
    { name: "アメ合計だけ違う", other: planLine({ totalCandyUnitsUsed: 101 }), expected: false },
    {
      name: "アメブ／通常の内訳だけ違う",
      other: planLine({ boostedCandyUnits: 41, nonBoostCandyUnits: 59 }),
      expected: false,
    },
    { name: "かけらだけ違う", other: planLine({ dreamShardsUsed: 1235 }), expected: false },
    {
      name: "アイテム内訳だけ違う（価値換算は同じ）",
      other: withSupply(base, {
        species: 40,
        type: { s: 0, m: 0 },
        universal: { s: 0, m: 3, l: 0 },
      }),
      expected: false,
    },
    { name: "余りだけ違う", other: planLine({ surplusCandyValue: 1 }), expected: false },
    {
      name: "species だけ違い、余りを含む表示値は同じ",
      other: withSupply(
        base,
        { species: 39, type: { s: 0, m: 0 }, universal: { s: 20, m: 0, l: 0 } },
        { surplusCandyValue: 0 },
      ),
      expected: true,
    },
  ];

  it.each(cases)("$name", ({ other, expected }) => {
    expect(isSameDisplayedLine(base, other)).toBe(expected);
  });
});

describe("fmtNumOrDash", () => {
  const fmt = (value: number) => value.toLocaleString("en-US");

  it.each([
    { value: undefined, expected: "-" },
    { value: null, expected: "-" },
    { value: 0, expected: "0" },
    { value: 1234, expected: "1,234" },
  ])("$value -> $expected", ({ value, expected }) => {
    expect(fmtNumOrDash(value, fmt)).toBe(expected);
  });
});
