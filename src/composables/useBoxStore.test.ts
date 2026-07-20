import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import type { Composer } from "vue-i18n";
import { useBoxStore } from "./useBoxStore";
import { cancelPersist, flushPersist } from "../persistence/deferredPersist";

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
    cancelPersist();
    installLocalStorageMock();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cancelPersist();
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

  it("defers Box persistence until the queue is flushed", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });

    store.addLabel.value = "deferred";
    store.onCreateManual({ mode: "toBox" });
    await nextTick();

    expect(localStorage.getItem("candy-boost-planner:box:v1")).toBeNull();
    flushPersist("box");
    const saved = JSON.parse(localStorage.getItem("candy-boost-planner:box:v1") ?? "null");
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]?.label).toBe("deferred");
  });

  it("persists immutable entry edits with the shallow Box watcher", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });

    store.addLabel.value = "before";
    store.addFavorite.value = false;
    store.onCreateManual({ mode: "toBox" });
    store.selectedBoxId.value = store.boxEntries.value[0]?.id ?? null;
    store.onEditSelectedLabel("after");
    store.toggleSelectedFavorite();
    await nextTick();

    flushPersist("box");
    const saved = JSON.parse(localStorage.getItem("candy-boost-planner:box:v1") ?? "null");
    expect(saved.entries[0]?.label).toBe("after");
    expect(saved.entries[0]?.favorite).toBe(true);
  });

  it("persists delete and undo array replacements", async () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useBoxStore({ locale: ref("ja"), t });

    store.addLabel.value = "undo-target";
    store.onCreateManual({ mode: "toBox" });
    const entryId = store.boxEntries.value[0]?.id;
    store.selectedBoxId.value = entryId ?? null;
    store.onDeleteSelected();
    expect(store.boxEntries.value).toEqual([]);

    store.onUndo();
    await nextTick();
    flushPersist("box");

    const saved = JSON.parse(localStorage.getItem("candy-boost-planner:box:v1") ?? "null");
    expect(saved.entries.map((entry: { id: string }) => entry.id)).toEqual([entryId]);
  });
});
