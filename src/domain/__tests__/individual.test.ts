import { describe, expect, it } from "vitest";
import type { PokemonBoxEntryV1 } from "../types";
import { calcExp } from "../pokesleep/exp";
import { maxLevel } from "../pokesleep/tables";
import { clampExpRemaining, resolveIndividual } from "../individual";

function entry(partial: Partial<PokemonBoxEntryV1> = {}): PokemonBoxEntryV1 {
  return {
    id: "e1",
    source: "manual",
    rawText: "",
    label: "ピカ",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("resolveIndividual", () => {
  it("uses the shared defaults when nothing is set (Lv 1, 600, normal, 0h)", () => {
    expect(resolveIndividual(entry())).toEqual({
      level: 1,
      expRemaining: calcExp(1, 2, 600),
      sleepHours: 0,
      expType: 600,
      nature: "normal",
      label: "ピカ",
      pokedexId: undefined,
      pokemonType: undefined,
    });
  });

  it("prefers planner over derived", () => {
    const e = entry({
      derived: { pokedexId: 149, form: 0, level: 10, expType: 900, expGainNature: "down", natureName: "" },
      planner: { level: 20, expType: 1080, expGainNature: "up", sleepHours: 33 },
    });
    const individual = resolveIndividual(e);
    expect(individual).toMatchObject({ level: 20, expType: 1080, nature: "up", sleepHours: 33, pokedexId: 149 });
    expect(individual.pokemonType).toBeDefined();
  });

  it("falls back to derived when planner has no override", () => {
    const e = entry({
      derived: { pokedexId: 149, form: 0, level: 10, expType: 900, expGainNature: "down", natureName: "" },
    });
    expect(resolveIndividual(e)).toMatchObject({ level: 10, expType: 900, nature: "down" });
  });

  it("treats expRemaining 0 and unset as the whole next level", () => {
    const toNext = calcExp(15, 16, 600);
    expect(resolveIndividual(entry({ planner: { level: 15 } })).expRemaining).toBe(toNext);
    expect(resolveIndividual(entry({ planner: { level: 15, expRemaining: 0 } })).expRemaining).toBe(toNext);
  });

  it("keeps a stored expRemaining and caps it at the next level", () => {
    const toNext = calcExp(15, 16, 600);
    expect(resolveIndividual(entry({ planner: { level: 15, expRemaining: 100 } })).expRemaining).toBe(100);
    expect(resolveIndividual(entry({ planner: { level: 15, expRemaining: toNext + 999 } })).expRemaining).toBe(toNext);
  });

  it("has no EXP left to the next level at the max level", () => {
    expect(resolveIndividual(entry({ planner: { level: maxLevel, expRemaining: 500 } })).expRemaining).toBe(0);
  });
});

describe("clampExpRemaining", () => {
  it("clamps into 0..toNext and floors", () => {
    const toNext = calcExp(15, 16, 600);
    expect(clampExpRemaining(-5, 15, 600)).toBe(0);
    expect(clampExpRemaining(12.9, 15, 600)).toBe(12);
    expect(clampExpRemaining(toNext + 1, 15, 600)).toBe(toNext);
  });
});
