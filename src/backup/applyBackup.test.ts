import { describe, expect, it, vi } from "vitest";
import { BOX_STORAGE_KEY } from "../persistence/box";
import {
  ACTIVE_SLOT_STORAGE_KEY,
  BOOST_CANDY_REMAINING_KEY,
  CALC_SLOTS_STORAGE_KEY,
  DEFAULT_BOOST_REACH_LEVEL_KEY,
  SLEEP_SETTINGS_KEY,
  TOTAL_SHARDS_KEY,
} from "../persistence/calc";
import { CANDY_STORAGE_KEY, CANDY_STORAGE_KEY_V1 } from "../persistence/candy";
import { applyBackup, BackupRollbackError } from "./applyBackup";
import { createBackup } from "./createBackup";
import {
  promotePendingBackupRestoreOnStartup,
  RESTORE_PENDING_KEY,
  serializePendingRestore,
} from "./pendingRestore";

function backup() {
  return createBackup({
    boxEntries: [],
    totalShards: 9876,
    sleepSettings: { dailySleepHours: 7.5, sleepExpBonusCount: 2, includeGSD: false },
    candyInventory: { schemaVersion: 2, universal: { s: 1, m: 2, l: 3 }, typeCandy: {}, species: {} },
    defaultBoostReachLevel: null,
    calculator: { activeSlotIndex: 2, slots: [null, null, null] },
  }, new Date("2026-07-22T07:30:00.000Z"));
}

type StorageOperation = {
  kind: "set" | "remove";
  key: string;
  value?: string;
};

const TARGET_KEYS = [
  BOX_STORAGE_KEY,
  CANDY_STORAGE_KEY,
  CANDY_STORAGE_KEY_V1,
  CALC_SLOTS_STORAGE_KEY,
  TOTAL_SHARDS_KEY,
  SLEEP_SETTINGS_KEY,
  ACTIVE_SLOT_STORAGE_KEY,
  BOOST_CANDY_REMAINING_KEY,
  DEFAULT_BOOST_REACH_LEVEL_KEY,
];

function storageMock(
  initial: Record<string, string> = {},
  beforeOperation?: (operation: StorageOperation) => void,
) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        beforeOperation?.({ kind: "set", key, value });
        values.set(key, value);
      },
      removeItem: (key: string) => {
        beforeOperation?.({ kind: "remove", key });
        values.delete(key);
      },
    },
  };
}

function targetSnapshot(values: Map<string, string>): Record<string, string | null> {
  return Object.fromEntries(TARGET_KEYS.map((key) => [key, values.get(key) ?? null]));
}

describe("applyBackup", () => {
  it("flushes first, replaces every target, removes obsolete compatibility keys, then reloads", () => {
    const oldV1 = "leave-this-v1-value-untouched";
    const order: string[] = [];
    const mock = storageMock({
      [BOOST_CANDY_REMAINING_KEY]: "999",
      [DEFAULT_BOOST_REACH_LEVEL_KEY]: "55",
      [CANDY_STORAGE_KEY_V1]: oldV1,
    }, (operation) => {
      if (operation.kind === "remove" && operation.key === RESTORE_PENDING_KEY) {
        order.push("commit");
      }
    });
    applyBackup(backup(), {
      storage: mock.storage,
      flush: () => order.push("flush"),
      cancelPending: () => order.push("cancel"),
      reload: () => order.push("reload"),
    });
    expect(order).toEqual(["flush", "commit", "cancel", "reload"]);
    expect(mock.values.get("candy-boost-planner:calc:totalShards")).toBe("9876");
    expect(mock.values.get("candy-boost-planner:calc:activeSlot")).toBe("2");
    expect(mock.values.has(BOOST_CANDY_REMAINING_KEY)).toBe(false);
    // 未設定のバックアップを復元したら、復元先に残っていた設定を持ち越さない
    expect(mock.values.has(DEFAULT_BOOST_REACH_LEVEL_KEY)).toBe(false);
    expect(JSON.parse(mock.values.get(CANDY_STORAGE_KEY) ?? "null").schemaVersion).toBe(2);
    expect(mock.values.has(CANDY_STORAGE_KEY_V1)).toBe(false);
    expect(mock.values.has(RESTORE_PENDING_KEY)).toBe(false);
  });

  it("restores a set defaultBoostReachLevel", () => {
    const value = backup();
    value.data.globalSettings.defaultBoostReachLevel = 35;
    const mock = storageMock({ [DEFAULT_BOOST_REACH_LEVEL_KEY]: "55" });

    applyBackup(value, { storage: mock.storage, flush: () => {}, cancelPending: () => {}, reload: () => {} });

    expect(mock.values.get(DEFAULT_BOOST_REACH_LEVEL_KEY)).toBe("35");
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

  it("does not touch any target key when staging the pending restore fails", () => {
    const initial = Object.fromEntries(TARGET_KEYS.map((key) => [key, `old:${key}`]));
    const mock = storageMock(initial, (operation) => {
      if (operation.kind === "set" && operation.key === RESTORE_PENDING_KEY) {
        throw new Error("pending quota");
      }
    });
    const before = targetSnapshot(mock.values);
    const reload = vi.fn();

    expect(() => applyBackup(backup(), {
      storage: mock.storage,
      flush: vi.fn(),
      cancelPending: vi.fn(),
      reload,
    })).toThrow("pending quota");

    expect(targetSnapshot(mock.values)).toEqual(before);
    expect(mock.values.has(RESTORE_PENDING_KEY)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("rolls every key back, clears pending, and exposes the original cause after a partial write failure", () => {
    const initial = {
      [BOX_STORAGE_KEY]: "old-box",
      [CANDY_STORAGE_KEY]: "old-candy",
      [CANDY_STORAGE_KEY_V1]: "old-candy-v1",
      [CALC_SLOTS_STORAGE_KEY]: "old-slots",
      [TOTAL_SHARDS_KEY]: "old-shards",
      [SLEEP_SETTINGS_KEY]: "old-sleep",
      [ACTIVE_SLOT_STORAGE_KEY]: "old-active",
      [BOOST_CANDY_REMAINING_KEY]: "old-mirror",
    };
    let failed = false;
    const mock = storageMock(initial, (operation) => {
      if (!failed && operation.kind === "set" && operation.key === TOTAL_SHARDS_KEY) {
        failed = true;
        throw new Error("quota");
      }
    });
    const reload = vi.fn();
    let caught: unknown;
    try {
      applyBackup(backup(), { storage: mock.storage, flush: vi.fn(), cancelPending: vi.fn(), reload });
    } catch (cause) {
      caught = cause;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("quota");
    expect(targetSnapshot(mock.values)).toEqual(targetSnapshot(new Map(Object.entries(initial))));
    expect(mock.values.has(RESTORE_PENDING_KEY)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("promotes a pending restore retained by failed rollback and removes it after convergence", () => {
    const initial = {
      [BOX_STORAGE_KEY]: "old-box",
      [CANDY_STORAGE_KEY]: "old-candy",
      [CANDY_STORAGE_KEY_V1]: "old-candy-v1",
      [CALC_SLOTS_STORAGE_KEY]: "old-slots",
      [TOTAL_SHARDS_KEY]: "old-shards",
    };
    let applyingFailed = false;
    let rollbackFailed = false;
    const mock = storageMock(initial, (operation) => {
      if (
        !applyingFailed
        && operation.kind === "set"
        && operation.key === TOTAL_SHARDS_KEY
        && operation.value === "9876"
      ) {
        applyingFailed = true;
        throw new Error("quota");
      }
      if (
        applyingFailed
        && !rollbackFailed
        && operation.kind === "set"
        && operation.key === BOX_STORAGE_KEY
        && operation.value === "old-box"
      ) {
        rollbackFailed = true;
        throw new Error("rollback quota");
      }
    });

    expect(() => applyBackup(backup(), {
      storage: mock.storage,
      flush: vi.fn(),
      cancelPending: vi.fn(),
      reload: vi.fn(),
    })).toThrow(BackupRollbackError);
    expect(mock.values.has(RESTORE_PENDING_KEY)).toBe(true);

    expect(promotePendingBackupRestoreOnStartup(mock.storage)).toBe("promoted");
    expect(mock.values.get(TOTAL_SHARDS_KEY)).toBe("9876");
    expect(mock.values.get(ACTIVE_SLOT_STORAGE_KEY)).toBe("2");
    expect(mock.values.has(CANDY_STORAGE_KEY_V1)).toBe(false);
    expect(mock.values.has(RESTORE_PENDING_KEY)).toBe(false);
  });

  it("discards malformed pending data without rejecting the startup side-effect module", async () => {
    const mock = storageMock({ [RESTORE_PENDING_KEY]: "{not-json" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("localStorage", mock.storage);
    vi.resetModules();
    try {
      await expect(import("./promotePendingRestoreOnStartup")).resolves.toBeDefined();
      expect(mock.values.has(RESTORE_PENDING_KEY)).toBe(false);
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      consoleError.mockRestore();
    }
  });

  it("bounds repeated startup apply failures and never throws or retries after discarding pending", () => {
    const payload = serializePendingRestore(new Map([[TOTAL_SHARDS_KEY, "new-shards"]]));
    const mock = storageMock({ [RESTORE_PENDING_KEY]: payload }, (operation) => {
      if (operation.kind === "set" && operation.key === TOTAL_SHARDS_KEY) {
        throw new Error("quota");
      }
    });
    const report = vi.fn();

    expect(() => promotePendingBackupRestoreOnStartup(mock.storage, report)).not.toThrow();
    expect(JSON.parse(mock.values.get(RESTORE_PENDING_KEY) ?? "{}").attempts).toBe(1);
    expect(() => promotePendingBackupRestoreOnStartup(mock.storage, report)).not.toThrow();
    expect(JSON.parse(mock.values.get(RESTORE_PENDING_KEY) ?? "{}").attempts).toBe(2);
    expect(() => promotePendingBackupRestoreOnStartup(mock.storage, report)).not.toThrow();
    expect(mock.values.has(RESTORE_PENDING_KEY)).toBe(false);
    expect(promotePendingBackupRestoreOnStartup(mock.storage, report)).toBe("none");
    expect(report).toHaveBeenCalledTimes(3);
  });

  it("reports failed rollback keys and the keys that remain mixed", () => {
    const initial = {
      [BOX_STORAGE_KEY]: "old-box",
      [CANDY_STORAGE_KEY]: "old-candy",
      [CANDY_STORAGE_KEY_V1]: "old-candy-v1",
      [CALC_SLOTS_STORAGE_KEY]: "old-slots",
      [TOTAL_SHARDS_KEY]: "old-shards",
    };
    let applyingFailed = false;
    const mock = storageMock(initial, (operation) => {
      if (
        !applyingFailed
        && operation.kind === "set"
        && operation.key === TOTAL_SHARDS_KEY
        && operation.value === "9876"
      ) {
        applyingFailed = true;
        throw new Error("apply quota");
      }
      if (
        applyingFailed
        && operation.kind === "set"
        && operation.key === BOX_STORAGE_KEY
        && operation.value === "old-box"
      ) {
        throw new Error("rollback quota");
      }
    });

    let caught: unknown;
    try {
      applyBackup(backup(), {
        storage: mock.storage,
        flush: vi.fn(),
        cancelPending: vi.fn(),
        reload: vi.fn(),
      });
    } catch (cause) {
      caught = cause;
    }

    expect(caught).toBeInstanceOf(BackupRollbackError);
    const error = caught as BackupRollbackError;
    expect(error.originalCause).toEqual(new Error("apply quota"));
    expect(error.failedRollbackKeys).toEqual([BOX_STORAGE_KEY]);
    expect(error.mixedKeys).toContain(BOX_STORAGE_KEY);
    expect(error.errors).toEqual([
      expect.objectContaining({ message: "apply quota" }),
      expect.objectContaining({ message: "rollback quota" }),
    ]);
    expect(mock.values.get(BOX_STORAGE_KEY)).not.toBe("old-box");
    expect(mock.values.has(RESTORE_PENDING_KEY)).toBe(true);
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
