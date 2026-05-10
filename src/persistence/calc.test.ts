import { beforeEach, describe, expect, it } from "vitest";
import { loadSleepSettings, saveSleepSettings, DEFAULT_SLEEP_SETTINGS } from "./calc";

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

describe("persistence/calc sleepSettings", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  it("returns defaults when nothing is stored", () => {
    const settings = loadSleepSettings();
    expect(settings).toEqual(DEFAULT_SLEEP_SETTINGS);
  });

  it("round-trips saved settings", () => {
    const custom = { dailySleepHours: 7, sleepExpBonusCount: 3, includeGSD: false };
    saveSleepSettings(custom);
    const loaded = loadSleepSettings();
    expect(loaded).toEqual(custom);
  });

  it("returns defaults after removing settings", () => {
    saveSleepSettings({ dailySleepHours: 6, sleepExpBonusCount: 2, includeGSD: true });
    saveSleepSettings(undefined);
    expect(loadSleepSettings()).toEqual(DEFAULT_SLEEP_SETTINGS);
  });

  it("falls back to defaults for invalid stored JSON", () => {
    localStorage.setItem("candy-boost-planner:calc:sleepSettings", "not-json");
    expect(loadSleepSettings()).toEqual(DEFAULT_SLEEP_SETTINGS);
  });

  it("falls back to defaults for out-of-range values", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:sleepSettings",
      JSON.stringify({ dailySleepHours: 20, sleepExpBonusCount: -1, includeGSD: "yes" }),
    );
    expect(loadSleepSettings()).toEqual(DEFAULT_SLEEP_SETTINGS);
  });

  it("fills missing fields with defaults when partial data is stored", () => {
    localStorage.setItem(
      "candy-boost-planner:calc:sleepSettings",
      JSON.stringify({ dailySleepHours: 10 }),
    );
    const loaded = loadSleepSettings();
    expect(loaded.dailySleepHours).toBe(10);
    expect(loaded.sleepExpBonusCount).toBe(DEFAULT_SLEEP_SETTINGS.sleepExpBonusCount);
    expect(loaded.includeGSD).toBe(DEFAULT_SLEEP_SETTINGS.includeGSD);
  });
});
