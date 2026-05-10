import { beforeEach, describe, expect, it } from "vitest";
import { loadBox } from "./box";

describe("persistence/box", () => {
  beforeEach(() => {
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
  });

  it("restores planner.sleepHours from stored entries", () => {
    const payload = {
      schemaVersion: 1,
      entries: [
        {
          id: "entry-1",
          source: "manual",
          rawText: "",
          label: "test",
          planner: { sleepHours: 123.9 },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    localStorage.setItem("candy-boost-planner:box:v1", JSON.stringify(payload));

    const entries = loadBox();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.planner?.sleepHours).toBe(123);
  });
});
