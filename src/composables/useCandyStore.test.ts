import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { cancelPersist, flushPersist } from "../persistence/deferredPersist";
import { useCandyStore } from "./useCandyStore";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
}

describe("useCandyStore", () => {
  beforeEach(async () => {
    cancelPersist();
    installLocalStorageMock();
    useCandyStore().resetInventory();
    await nextTick();
    cancelPersist();
  });

  afterEach(() => {
    cancelPersist();
  });

  it("coalesces inventory edits and persists the latest state on flush", async () => {
    const store = useCandyStore();

    store.updateUniversalCandy({ s: 1 });
    store.updateUniversalCandy({ s: 3, m: 4 });
    store.updateSpeciesCandy(245, 12);
    await nextTick();

    expect(localStorage.getItem("candy-boost-planner:candy-inventory:v2")).toBeNull();
    flushPersist("candy");
    const saved = JSON.parse(localStorage.getItem("candy-boost-planner:candy-inventory:v2") ?? "null");
    expect(saved.universal).toEqual({ s: 3, m: 4, l: 0 });
    expect(saved.species["245"]).toBe(12);
  });

  it("shares one value across different pokedex IDs in the same family", () => {
    const store = useCandyStore();
    store.updateSpeciesCandy(172, 100);
    expect(store.getSpeciesCandyFor(25)).toBe(100);
    expect(store.getSpeciesCandyFor(26)).toBe(100);

    store.updateSpeciesCandy(26, 40);
    expect(store.getSpeciesCandyFor(172)).toBe(40);
  });
});
