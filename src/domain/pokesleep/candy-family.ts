import { candyFamilyByPokedexId } from "./_generated/candy-family";

export type CandyFamilyKey = string;

function normalizePokedexId(pokedexId: number): number | null {
  return Number.isSafeInteger(pokedexId) && pokedexId > 0 ? pokedexId : null;
}

/**
 * Pokémon Sleepの同名アメを共有する進化系の保存・計算キー。
 * 既知IDは系統内の最小全国図鑑番号、未知IDはデータ保持のため自身へ解決する。
 */
export function getCandyFamilyKey(pokedexId: number): CandyFamilyKey {
  const normalized = normalizePokedexId(pokedexId);
  if (normalized === null) return String(pokedexId);
  const representative = (candyFamilyByPokedexId as Readonly<Record<string, number>>)[String(normalized)];
  return String(representative ?? normalized);
}

/** family表更新後も旧代表キーを現行代表へ寄せ、競合は系統内最大値で解決する。 */
export function normalizeSpeciesCandyByFamily(
  species: Readonly<Record<string, number>>,
): Record<CandyFamilyKey, number> {
  const normalized: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(species)) {
    if (!/^[1-9]\d*$/.test(rawKey)) continue;
    const pokedexId = Number(rawKey);
    if (!Number.isSafeInteger(pokedexId)) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) continue;
    const key = getCandyFamilyKey(pokedexId);
    normalized[key] = Math.max(normalized[key] ?? 0, Math.floor(value));
  }
  return normalized;
}

export function isKnownCandyFamilyPokedexId(pokedexId: number): boolean {
  return Object.hasOwn(candyFamilyByPokedexId, String(pokedexId));
}
