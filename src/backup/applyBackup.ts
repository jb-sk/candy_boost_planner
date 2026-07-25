import { BOX_STORAGE_KEY, serializeBox } from "../persistence/box";
import {
  CANDY_STORAGE_KEY,
  CANDY_STORAGE_KEY_V1,
  serializeCandyInventory,
} from "../persistence/candy";
import {
  ACTIVE_SLOT_STORAGE_KEY,
  BOOST_CANDY_REMAINING_KEY,
  CALC_SLOTS_STORAGE_KEY,
  SLEEP_SETTINGS_KEY,
  TOTAL_SHARDS_KEY,
  serializeCalcSlots,
} from "../persistence/calc";
import { cancelPersist, flushPersist } from "../persistence/deferredPersist";
import type { CandyBoostPlannerBackupV3 } from "./types";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ApplyBackupOptions = {
  storage?: StorageLike;
  flush?: () => void;
  cancelPending?: () => void;
  reload?: () => void;
};

function restoreInternalBoxEntries(backup: CandyBoostPlannerBackupV3) {
  return backup.data.box.entries.map((entry) => ({
    ...entry,
    source: entry.rawText.trim() ? "nitoyon" as const : "manual" as const,
  }));
}

export function applyBackup(backup: CandyBoostPlannerBackupV3, options: ApplyBackupOptions = {}): void {
  const storage = options.storage ?? localStorage;
  const flush = options.flush ?? (() => flushPersist());
  const cancelPending = options.cancelPending ?? (() => cancelPersist());
  const reload = options.reload ?? (() => window.location.reload());
  const writes = new Map<string, string | null>([
    [BOX_STORAGE_KEY, serializeBox(restoreInternalBoxEntries(backup))],
    [CANDY_STORAGE_KEY, serializeCandyInventory(backup.data.globalSettings.candyInventory)],
    [CANDY_STORAGE_KEY_V1, null],
    [CALC_SLOTS_STORAGE_KEY, serializeCalcSlots(backup.data.calculator.slots)],
    [TOTAL_SHARDS_KEY, String(backup.data.globalSettings.totalShards)],
    [SLEEP_SETTINGS_KEY, JSON.stringify(backup.data.globalSettings.sleepSettings)],
    [ACTIVE_SLOT_STORAGE_KEY, String(backup.data.calculator.activeSlotIndex)],
    [BOOST_CANDY_REMAINING_KEY, null],
  ]);

  flush();
  const previous = new Map<string, string | null>();
  for (const key of writes.keys()) previous.set(key, storage.getItem(key));

  try {
    for (const [key, value] of writes) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    for (const [key, expected] of writes) {
      if (storage.getItem(key) !== expected) throw new Error(`Backup verification failed for ${key}`);
    }
    cancelPending();
  } catch (cause) {
    for (const [key, value] of previous) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        // Continue restoring the remaining keys.
      }
    }
    throw cause;
  }

  reload();
}
