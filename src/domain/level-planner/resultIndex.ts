import type { LevelPlannerResult, PokemonPlanResult } from "./types";

/** 結果の行を行ID（`pokemonId`）で引く表。結果が無ければ空 */
export function pokemonResultsById(result: LevelPlannerResult | null | undefined): Map<string, PokemonPlanResult> {
  const map = new Map<string, PokemonPlanResult>();
  for (const p of result?.pokemonResults ?? []) map.set(p.pokemonId, p);
  return map;
}
