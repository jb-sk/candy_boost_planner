import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import { useBoxStore } from "./useBoxStore";

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

describe("useBoxStore", () => {
  beforeEach(() => {
    installLocalStorageMock();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps sleepHours=0 when creating a manual entry", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });

    store.addLabel.value = "test";
    store.addSleepHours.value = "0";

    store.onCreateManual({ mode: "toBox" });

    expect(store.boxEntries.value).toHaveLength(1);
    expect(store.boxEntries.value[0]?.planner?.sleepHours).toBe(0);
  });
});
