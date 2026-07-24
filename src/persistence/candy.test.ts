import { beforeEach, describe, expect, it } from "vitest";
import {
  CANDY_STORAGE_KEY,
  CANDY_STORAGE_KEY_V1,
  getSpeciesCandy,
  loadCandyInventory,
  normalizeCandyInventoryV2,
  setSpeciesCandy,
} from "./candy";

function installLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
    configurable: true,
    writable: true,
  });
}

describe("persistence/candy V2", () => {
  beforeEach(() => installLocalStorageMock());

  it("migrates V1 species keys by family maximum and removes V1 after saving V2", () => {
    const rawV1 = JSON.stringify({
      schemaVersion: 1,
      universal: { s: 1, m: 2, l: 3 },
      typeCandy: {},
      species: { "172": 30, "25": 100, "26": 50, "999999": 7 },
    });
    installLocalStorageMock({ [CANDY_STORAGE_KEY_V1]: rawV1 });

    const inventory = loadCandyInventory();
    expect(inventory).toEqual({
      schemaVersion: 2,
      universal: { s: 1, m: 2, l: 3 },
      typeCandy: {},
      species: { "25": 100, "999999": 7 },
    });
    expect(localStorage.getItem(CANDY_STORAGE_KEY_V1)).toBeNull();
    expect(JSON.parse(localStorage.getItem(CANDY_STORAGE_KEY) ?? "null")).toEqual(inventory);
  });

  it("keeps V1 when the migrated V2 cannot be saved", () => {
    const rawV1 = JSON.stringify({
      schemaVersion: 1,
      universal: { s: 1, m: 2, l: 3 },
      typeCandy: {},
      species: { "172": 30 },
    });
    const store = new Map([[CANDY_STORAGE_KEY_V1, rawV1]]);
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: () => { throw new Error("quota"); },
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
      configurable: true,
      writable: true,
    });

    expect(loadCandyInventory().species).toEqual({ "25": 30 });
    expect(localStorage.getItem(CANDY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CANDY_STORAGE_KEY_V1)).toBe(rawV1);
  });

  it("does not fall back to V1 when a corrupt V2 exists", () => {
    installLocalStorageMock({
      [CANDY_STORAGE_KEY]: "{",
      [CANDY_STORAGE_KEY_V1]: JSON.stringify({
        schemaVersion: 1,
        universal: { s: 9, m: 0, l: 0 },
        typeCandy: {},
        species: { "25": 99 },
      }),
    });
    expect(loadCandyInventory()).toEqual({
      schemaVersion: 2,
      universal: { s: 0, m: 0, l: 0 },
      typeCandy: {},
      species: {},
    });
  });

  it("does not fall back to V1 when the V2 schema version is invalid", () => {
    installLocalStorageMock({
      [CANDY_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 1,
        universal: { s: 8, m: 0, l: 0 },
        typeCandy: {},
        species: { "25": 88 },
      }),
      [CANDY_STORAGE_KEY_V1]: JSON.stringify({
        schemaVersion: 1,
        universal: { s: 9, m: 0, l: 0 },
        typeCandy: {},
        species: { "25": 99 },
      }),
    });
    expect(loadCandyInventory()).toEqual({
      schemaVersion: 2,
      universal: { s: 0, m: 0, l: 0 },
      typeCandy: {},
      species: {},
    });
  });

  it("re-normalizes V2 keys idempotently", () => {
    const once = normalizeCandyInventoryV2({
      schemaVersion: 2,
      universal: { s: 0, m: 0, l: 0 },
      typeCandy: {},
      species: { "172": 30, "25": 100, "26": 50 },
    });
    expect(once.species).toEqual({ "25": 100 });
    expect(normalizeCandyInventoryV2(once)).toEqual(once);
  });

  it("reads and writes every member through the family key", () => {
    const inventory = normalizeCandyInventoryV2({
      schemaVersion: 2,
      universal: {},
      typeCandy: {},
      species: {},
    });
    setSpeciesCandy(inventory, 172, 12);
    expect(inventory.species).toEqual({ "25": 12 });
    expect(getSpeciesCandy(inventory, 25)).toBe(12);
    expect(getSpeciesCandy(inventory, 26)).toBe(12);
  });
});
