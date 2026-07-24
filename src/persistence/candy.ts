/**
 * アメ在庫の永続化
 * - 万能アメ（S/M/L）
 * - タイプアメ（タイプ別 S/M）
 * - ポケモンのアメ（進化系family別）
 */
import { getCandyFamilyKey, normalizeSpeciesCandyByFamily } from "../domain/pokesleep/candy-family";
import { perfSpan } from "../utils/perf";

export const CANDY_STORAGE_KEY_V1 = "candy-boost-planner:candy-inventory:v1";
export const CANDY_STORAGE_KEY = "candy-boost-planner:candy-inventory:v2";
const SCHEMA_VERSION = 2 as const;

export type UniversalCandyInventory = {
  s: number;
  m: number;
  l: number;
};

export type TypeCandyInventory = {
  s: number;
  m: number;
};

/** 互換読取専用。speciesキーは旧String(pokedexId)。 */
export type CandyInventoryV1 = {
  schemaVersion: 1;
  universal: UniversalCandyInventory;
  typeCandy: Record<string, TypeCandyInventory>;
  species: Record<string, number>;
};

/** 現行形式。speciesキーは進化系を表すCandyFamilyKey。 */
export type CandyInventoryV2 = {
  schemaVersion: typeof SCHEMA_VERSION;
  universal: UniversalCandyInventory;
  typeCandy: Record<string, TypeCandyInventory>;
  species: Record<string, number>;
};

export function createEmptyCandyInventory(): CandyInventoryV2 {
  return {
    schemaVersion: SCHEMA_VERSION,
    universal: { s: 0, m: 0, l: 0 },
    typeCandy: {},
    species: {},
  };
}

export function loadCandyInventory(): CandyInventoryV2 {
  try {
    const rawV2 = localStorage.getItem(CANDY_STORAGE_KEY);
    if (rawV2 !== null) {
      const json = JSON.parse(rawV2);
      if (!json || typeof json !== "object" || json.schemaVersion !== SCHEMA_VERSION) {
        return createEmptyCandyInventory();
      }
      return normalizeCandyInventoryV2(json);
    }

    const rawV1 = localStorage.getItem(CANDY_STORAGE_KEY_V1);
    if (rawV1 === null) return createEmptyCandyInventory();
    const migrated = migrateCandyInventoryV1(JSON.parse(rawV1));
    if (saveCandyInventory(migrated)) {
      try {
        localStorage.removeItem(CANDY_STORAGE_KEY_V1);
      } catch {
        // V2への移行は完了しているため、旧キーの削除失敗だけで読込を失敗させない。
      }
    }
    return migrated;
  } catch {
    // V2が存在する場合も、古いV1を最新値として復活させない。
    return createEmptyCandyInventory();
  }
}

export function saveCandyInventory(inv: CandyInventoryV2): boolean {
  try {
    const serialized = perfSpan("persist.candy.serialize", () => serializeCandyInventory(inv));
    perfSpan("persist.candy.write", () => localStorage.setItem(CANDY_STORAGE_KEY, serialized));
    return true;
  } catch {
    // localStorage can throw (quota exceeded / blocked)
    return false;
  }
}

export function serializeCandyInventory(inv: CandyInventoryV2): string {
  return JSON.stringify(normalizeCandyInventoryV2(inv));
}

function normalizeCandyInventoryValue(value: unknown): CandyInventoryV2 {
  const record = asRecord(value);
  return {
    schemaVersion: SCHEMA_VERSION,
    universal: normalizeUniversal(record.universal),
    typeCandy: normalizeTypeCandy(record.typeCandy),
    species: normalizeSpeciesCandyByFamily(normalizeSpecies(record.species)),
  };
}

export function migrateCandyInventoryV1(value: unknown): CandyInventoryV2 {
  return normalizeCandyInventoryValue(value);
}

/**
 * family表更新で代表IDが変わった場合にも同じV2を再正規化する。
 * 同一familyに複数キーがあれば、V1移行と同じく最大値を採用する。
 */
export function normalizeCandyInventoryV2(value: unknown): CandyInventoryV2 {
  return normalizeCandyInventoryValue(value);
}

// --- 便利関数 ---

export function getSpeciesCandy(inv: CandyInventoryV2, pokedexId: number): number {
  return inv.species[getCandyFamilyKey(pokedexId)] ?? 0;
}

export function setSpeciesCandy(inv: CandyInventoryV2, pokedexId: number, count: number): void {
  inv.species[getCandyFamilyKey(pokedexId)] = Math.max(0, Math.floor(count));
}

export function getTypeCandy(inv: CandyInventoryV2, typeName: string): TypeCandyInventory {
  return inv.typeCandy[typeName] ?? { s: 0, m: 0 };
}

export function setTypeCandy(inv: CandyInventoryV2, typeName: string, candy: TypeCandyInventory): void {
  inv.typeCandy[typeName] = {
    s: Math.max(0, Math.floor(candy.s)),
    m: Math.max(0, Math.floor(candy.m)),
  };
}

export function getUniversalCandy(inv: CandyInventoryV2): UniversalCandyInventory {
  return { ...inv.universal };
}

export function setUniversalCandy(inv: CandyInventoryV2, candy: UniversalCandyInventory): void {
  inv.universal = {
    s: Math.max(0, Math.floor(candy.s)),
    m: Math.max(0, Math.floor(candy.m)),
    l: Math.max(0, Math.floor(candy.l)),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeUniversal(value: unknown): UniversalCandyInventory {
  const record = asRecord(value);
  return {
    s: toNonNegativeInt(record.s, 0),
    m: toNonNegativeInt(record.m, 0),
    l: toNonNegativeInt(record.l, 0),
  };
}

function normalizeTypeCandy(value: unknown): Record<string, TypeCandyInventory> {
  const out: Record<string, TypeCandyInventory> = {};
  for (const [key, item] of Object.entries(asRecord(value))) {
    const record = asRecord(item);
    out[key] = {
      s: toNonNegativeInt(record.s, 0),
      m: toNonNegativeInt(record.m, 0),
    };
  }
  return out;
}

function normalizeSpecies(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(asRecord(value))) {
    const count = toNonNegativeInt(item, 0);
    if (count > 0) out[key] = count;
  }
  return out;
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}
