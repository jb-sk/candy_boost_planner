import { describe, expect, it, vi } from "vitest";
import { BOOST_CANDY_REMAINING_KEY } from "../persistence/calc";
import { CANDY_STORAGE_KEY, CANDY_STORAGE_KEY_V1 } from "../persistence/candy";
import { applyBackup } from "./applyBackup";
import { createBackup } from "./createBackup";

function backup() {
  return createBackup({
    boxEntries: [],
    totalShards: 9876,
    sleepSettings: { dailySleepHours: 7.5, sleepExpBonusCount: 2, includeGSD: false },
    candyInventory: { schemaVersion: 2, universal: { s: 1, m: 2, l: 3 }, typeCandy: {}, species: {} },
    calculator: { activeSlotIndex: 2, slots: [null, null, null] },
  }, new Date("2026-07-22T07:30:00.000Z"));
}

function storageMock(initial: Record<string, string> = {}, failSetAt?: number) {
  const values = new Map(Object.entries(initial));
  let setCount = 0;
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        setCount++;
        if (setCount === failSetAt) throw new Error("quota");
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    },
  };
}

describe("applyBackup", () => {
  it("flushes first, replaces every target, removes obsolete compatibility keys, then reloads", () => {
    const oldV1 = "leave-this-v1-value-untouched";
    const mock = storageMock({
      [BOOST_CANDY_REMAINING_KEY]: "999",
      [CANDY_STORAGE_KEY_V1]: oldV1,
    });
    const order: string[] = [];
    applyBackup(backup(), {
      storage: mock.storage,
      flush: () => order.push("flush"),
      cancelPending: () => order.push("cancel"),
      reload: () => order.push("reload"),
    });
    expect(order).toEqual(["flush", "cancel", "reload"]);
    expect(mock.values.get("candy-boost-planner:calc:totalShards")).toBe("9876");
    expect(mock.values.get("candy-boost-planner:calc:activeSlot")).toBe("2");
    expect(mock.values.has(BOOST_CANDY_REMAINING_KEY)).toBe(false);
    expect(JSON.parse(mock.values.get(CANDY_STORAGE_KEY) ?? "null").schemaVersion).toBe(2);
    expect(mock.values.has(CANDY_STORAGE_KEY_V1)).toBe(false);
  });

  it("reconstructs the internal source without exposing it in the backup DTO", () => {
    const value = backup();
    const timestamp = "2026-07-22T07:30:00.000Z";
    value.data.box.entries = [
      { id: "manual", rawText: "", label: "Manual", createdAt: timestamp, updatedAt: timestamp },
      { id: "imported", rawText: "nitoyon-data", label: "Imported", createdAt: timestamp, updatedAt: timestamp },
    ];
    const mock = storageMock();
    applyBackup(value, { storage: mock.storage, flush: vi.fn(), cancelPending: vi.fn(), reload: vi.fn() });
    const stored = JSON.parse(mock.values.get("candy-boost-planner:box:v1") ?? "{}");
    expect(stored.entries.map((entry: { source: string }) => entry.source)).toEqual(["manual", "nitoyon"]);
  });

  it("rolls every key back and does not reload after a partial write failure", () => {
    const initial = {
      "candy-boost-planner:box:v1": "old-box",
      "candy-boost-planner:candy-inventory:v2": "old-candy",
      [CANDY_STORAGE_KEY_V1]: "old-candy-v1",
      "candy-boost-planner:calc:slots:v1": "old-slots",
      "candy-boost-planner:calc:totalShards": "old-shards",
      "candy-boost-planner:calc:sleepSettings": "old-sleep",
      "candy-boost-planner:calc:activeSlot": "old-active",
      [BOOST_CANDY_REMAINING_KEY]: "old-mirror",
    };
    const mock = storageMock(initial, 3);
    const reload = vi.fn();
    expect(() => applyBackup(backup(), { storage: mock.storage, flush: vi.fn(), cancelPending: vi.fn(), reload })).toThrow("quota");
    expect(Object.fromEntries(mock.values)).toEqual(initial);
    expect(reload).not.toHaveBeenCalled();
  });

  it("flushes an old delayed write before applying so a later pagehide flush cannot overwrite the restore", () => {
    const mock = storageMock();
    let pending: (() => void) | null = () => mock.storage.setItem("candy-boost-planner:box:v1", "old-live-store");
    const flush = () => {
      const job = pending;
      pending = null;
      job?.();
    };
    applyBackup(backup(), { storage: mock.storage, flush, cancelPending: () => { pending = null; }, reload: vi.fn() });
    flush();
    expect(mock.values.get("candy-boost-planner:box:v1")).not.toBe("old-live-store");
  });
});
