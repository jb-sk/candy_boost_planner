/**
 * アメ在庫の永続化
 * - 万能アメ（S/M/L）
 * - タイプアメ（タイプ別 S/M）
 * - ポケモンのアメ（種族別）
 */

const STORAGE_KEY = "candy-boost-planner:candy-inventory:v1";
const SCHEMA_VERSION = 1 as const;

// アメ換算値
export const CANDY_VALUES = {
  universal: { s: 3, m: 20, l: 100 },
  type: { s: 4, m: 25 },
} as const;

export type UniversalCandyInventory = {
  s: number;
  m: number;
  l: number;
};

export type TypeCandyInventory = {
  s: number;
  m: number;
};

export type CandyInventoryV1 = {
  schemaVersion: typeof SCHEMA_VERSION;
  /** 万能アメ（全ポケモン共通） */
  universal: UniversalCandyInventory;
  /** タイプアメ（タイプ名ごと） */
  typeCandy: Record<string, TypeCandyInventory>;
  /** ポケモンのアメ（pokedexId ごと） */
  species: Record<string, number>;
};

function createEmptyInventory(): CandyInventoryV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    universal: { s: 0, m: 0, l: 0 },
    typeCandy: {},
    species: {},
  };
}

export function loadCandyInventory(): CandyInventoryV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyInventory();
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object") return createEmptyInventory();
    return normalizeInventory(json);
  } catch {
    return createEmptyInventory();
  }
}

export function saveCandyInventory(inv: CandyInventoryV1): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inv));
  } catch {
    // localStorage can throw (quota exceeded / blocked)
  }
}

// --- 便利関数 ---

export function getSpeciesCandy(inv: CandyInventoryV1, pokedexId: number): number {
  return inv.species[String(pokedexId)] ?? 0;
}

export function setSpeciesCandy(inv: CandyInventoryV1, pokedexId: number, count: number): void {
  inv.species[String(pokedexId)] = Math.max(0, Math.floor(count));
}

export function getTypeCandy(inv: CandyInventoryV1, typeName: string): TypeCandyInventory {
  return inv.typeCandy[typeName] ?? { s: 0, m: 0 };
}

export function setTypeCandy(inv: CandyInventoryV1, typeName: string, candy: TypeCandyInventory): void {
  inv.typeCandy[typeName] = {
    s: Math.max(0, Math.floor(candy.s)),
    m: Math.max(0, Math.floor(candy.m)),
  };
}

export function getUniversalCandy(inv: CandyInventoryV1): UniversalCandyInventory {
  return { ...inv.universal };
}

export function setUniversalCandy(inv: CandyInventoryV1, candy: UniversalCandyInventory): void {
  inv.universal = {
    s: Math.max(0, Math.floor(candy.s)),
    m: Math.max(0, Math.floor(candy.m)),
    l: Math.max(0, Math.floor(candy.l)),
  };
}

// --- 正規化 ---

function normalizeInventory(x: any): CandyInventoryV1 {
  const universal = normalizeUniversal(x.universal);
  const typeCandy = normalizeTypeCandy(x.typeCandy);
  const species = normalizeSpecies(x.species);
  return {
    schemaVersion: SCHEMA_VERSION,
    universal,
    typeCandy,
    species,
  };
}

function normalizeUniversal(x: any): UniversalCandyInventory {
  if (!x || typeof x !== "object") return { s: 0, m: 0, l: 0 };
  return {
    s: toNonNegativeInt(x.s, 0),
    m: toNonNegativeInt(x.m, 0),
    l: toNonNegativeInt(x.l, 0),
  };
}

function normalizeTypeCandy(x: any): Record<string, TypeCandyInventory> {
  if (!x || typeof x !== "object") return {};
  const out: Record<string, TypeCandyInventory> = {};
  for (const [key, val] of Object.entries(x)) {
    if (!val || typeof val !== "object") continue;
    const v = val as any;
    out[key] = {
      s: toNonNegativeInt(v.s, 0),
      m: toNonNegativeInt(v.m, 0),
    };
  }
  return out;
}

function normalizeSpecies(x: any): Record<string, number> {
  if (!x || typeof x !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(x)) {
    const n = toNonNegativeInt(val, 0);
    if (n > 0) out[key] = n;
  }
  return out;
}

function toNonNegativeInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}
