import { beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";
import type { Composer } from "vue-i18n";
import { useCalcStore } from "./useCalcStore";

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

describe("useCalcStore", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("preserves sleepHours=0 when importing from box", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.upsertFromBox({
      boxId: "box-1",
      srcLevel: 10,
      expType: 600,
      nature: "normal",
      sleepHours: 0,
    });

    expect(store.rows.value).toHaveLength(1);
    expect(store.rows.value[0]?.sleepHours).toBe(0);
  });

  it("preserves sleepHours=0 in planner patch after row edit", () => {
    const t = ((key: string) => key) as unknown as Composer["t"];
    const store = useCalcStore({ locale: ref("ja"), t });

    store.upsertFromBox({
      boxId: "box-1",
      srcLevel: 10,
      expType: 600,
      nature: "normal",
      sleepHours: 12,
    });

    const rowId = store.rows.value[0]?.id;
    expect(rowId).toBeTruthy();

    store.setRowSleepHours(rowId!, 0);

    const patch = store.buildPlannerPatchFromRow(rowId);
    expect(patch).not.toBeNull();
    expect(patch?.sleepHours).toBe(0);
  });
});
