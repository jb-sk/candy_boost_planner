import { describe, expect, it } from "vitest";
import { pokemonMaster } from "../pokemon-master";
import {
  getCandyFamilyKey,
  isKnownCandyFamilyPokedexId,
  normalizeSpeciesCandyByFamily,
} from "../candy-family";

describe("candy family", () => {
  it.each([
    [172, "25"],
    [25, "25"],
    [26, "25"],
    [35, "35"],
    [173, "35"],
    [133, "133"],
    [134, "133"],
    [700, "133"],
    [79, "79"],
    [199, "79"],
    [280, "280"],
    [475, "280"],
    [194, "194"],
    [980, "194"],
  ])("resolves #%i to family %s", (pokedexId, expected) => {
    expect(getCandyFamilyKey(pokedexId)).toBe(expected);
  });

  it("covers every known pokedex id, including IDs shared by forms", () => {
    const ids = new Set(pokemonMaster.map(entry => entry.pokedexId));
    expect([...ids].every(isKnownCandyFamilyPokedexId)).toBe(true);
  });

  it("keeps unknown future IDs separate", () => {
    expect(getCandyFamilyKey(999_999)).toBe("999999");
  });

  it("normalizes legacy keys with the family maximum instead of summing", () => {
    expect(normalizeSpeciesCandyByFamily({
      "172": 30,
      "25": 100,
      "26": 50,
      "133": 4,
      "700": 9,
      "999999": 7,
    })).toEqual({
      "25": 100,
      "133": 9,
      "999999": 7,
    });
  });
});
