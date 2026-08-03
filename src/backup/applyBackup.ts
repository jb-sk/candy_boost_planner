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
  DEFAULT_BOOST_REACH_LEVEL_KEY,
  SLEEP_SETTINGS_KEY,
  TOTAL_SHARDS_KEY,
  serializeCalcSlots,
} from "../persistence/calc";
import { cancelPersist, flushPersist } from "../persistence/deferredPersist";
import type { CandyBoostPlannerBackupV3 } from "./types";
import {
  applyRestoreWrites,
  RESTORE_PENDING_KEY,
  serializePendingRestore,
} from "./pendingRestore";
import type { StorageLike } from "./pendingRestore";

export type ApplyBackupOptions = {
  storage?: StorageLike;
  flush?: () => void;
  cancelPending?: () => void;
  reload?: () => void;
};

export class BackupRollbackError extends AggregateError {
  readonly originalCause: unknown;
  readonly failedRollbackKeys: string[];
  readonly mixedKeys: string[];

  constructor(
    originalCause: unknown,
    rollbackFailures: Array<{ key: string; cause: unknown }>,
    mixedKeys: string[],
  ) {
    super(
      [originalCause, ...rollbackFailures.map((failure) => failure.cause)],
      `Backup restore failed and rollback left mixed keys: ${mixedKeys.join(", ") || "(unknown)"}`,
      { cause: originalCause },
    );
    this.name = "BackupRollbackError";
    this.originalCause = originalCause;
    this.failedRollbackKeys = rollbackFailures.map((failure) => failure.key);
    this.mixedKeys = mixedKeys;
  }
}

function restoreInternalBoxEntries(backup: CandyBoostPlannerBackupV3) {
  return backup.data.box.entries.map((entry) => ({
    ...entry,
    source: entry.rawText.trim() ? "nitoyon" as const : "manual" as const,
  }));
}

function clearPendingAfterRollback(storage: StorageLike): { cause: unknown } | null {
  try {
    storage.removeItem(RESTORE_PENDING_KEY);
    if (storage.getItem(RESTORE_PENDING_KEY) !== null) {
      throw new Error("Pending backup restore could not be cleared after rollback");
    }
    return null;
  } catch (cause) {
    return { cause };
  }
}

export function applyBackup(backup: CandyBoostPlannerBackupV3, options: ApplyBackupOptions = {}): void {
  const storage = options.storage ?? localStorage;
  const flush = options.flush ?? (() => flushPersist());
  const cancelPending = options.cancelPending ?? (() => cancelPersist());
  const reload = options.reload ?? (() => window.location.reload());
  // 旧形式には無い項目。`null`（未設定＝目標Lvと同じ）ならキーごと消して、
  // 復元先の端末に残っていた設定を持ち越さない。
  const defaultBoostReachLevel = backup.data.globalSettings.defaultBoostReachLevel;
  const writes = new Map<string, string | null>([
    [BOX_STORAGE_KEY, serializeBox(restoreInternalBoxEntries(backup))],
    [CANDY_STORAGE_KEY, serializeCandyInventory(backup.data.globalSettings.candyInventory)],
    [CANDY_STORAGE_KEY_V1, null],
    [CALC_SLOTS_STORAGE_KEY, serializeCalcSlots(backup.data.calculator.slots)],
    [TOTAL_SHARDS_KEY, String(backup.data.globalSettings.totalShards)],
    [SLEEP_SETTINGS_KEY, JSON.stringify(backup.data.globalSettings.sleepSettings)],
    [ACTIVE_SLOT_STORAGE_KEY, String(backup.data.calculator.activeSlotIndex)],
    [BOOST_CANDY_REMAINING_KEY, null],
    [DEFAULT_BOOST_REACH_LEVEL_KEY, defaultBoostReachLevel == null ? null : String(defaultBoostReachLevel)],
  ]);

  flush();
  const previous = new Map<string, string | null>();
  for (const key of writes.keys()) previous.set(key, storage.getItem(key));

  // pending の単一 setItem が失敗した場合は、対象9キーへ一切触れていない。
  storage.setItem(RESTORE_PENDING_KEY, serializePendingRestore(writes));

  try {
    applyRestoreWrites(storage, writes);
    storage.removeItem(RESTORE_PENDING_KEY);
    if (storage.getItem(RESTORE_PENDING_KEY) !== null) {
      throw new Error("Pending backup restore could not be committed");
    }
    cancelPending();
  } catch (cause) {
    const rollbackFailures: Array<{ key: string; cause: unknown }> = [];
    for (const [key, value] of previous) {
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch (rollbackCause) {
        rollbackFailures.push({ key, cause: rollbackCause });
      }
    }
    if (rollbackFailures.length > 0) {
      const mixedKeys: string[] = [];
      for (const [key, expected] of previous) {
        try {
          if (storage.getItem(key) !== expected) mixedKeys.push(key);
        } catch {
          mixedKeys.push(key);
        }
      }
      throw new BackupRollbackError(cause, rollbackFailures, mixedKeys);
    }

    // 全対象キーが clean-old へ戻った場合、新値のpendingを残すと次回起動で
    // 失敗した復元が黙って再適用される。巻き戻し成功時はmarkerも必ず片付ける。
    const pendingCleanupFailure = clearPendingAfterRollback(storage);
    if (pendingCleanupFailure) {
      throw new BackupRollbackError(
        cause,
        [{ key: RESTORE_PENDING_KEY, cause: pendingCleanupFailure.cause }],
        [RESTORE_PENDING_KEY],
      );
    }
    throw cause;
  }

  reload();
}
