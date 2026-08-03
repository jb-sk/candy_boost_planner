export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const RESTORE_PENDING_KEY = "candy-boost-planner:restore:pending";

const PENDING_RESTORE_SCHEMA_VERSION = 1 as const;
const MAX_PENDING_RESTORE_ATTEMPTS = 3;

type PendingRestoreV1 = {
  schemaVersion: typeof PENDING_RESTORE_SCHEMA_VERSION;
  /** 起動時の前進復旧に失敗した回数。旧payloadでは未定義＝0回。 */
  attempts?: number;
  writes: Array<[string, string | null]>;
};

type ParsedPendingRestore = {
  attempts: number;
  writes: Map<string, string | null>;
};

export class InvalidPendingRestoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidPendingRestoreError";
  }
}

function parsePendingRestore(raw: string): ParsedPendingRestore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new InvalidPendingRestoreError("Pending backup restore is not valid JSON", { cause });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new InvalidPendingRestoreError("Pending backup restore is not an object");
  }
  const record = parsed as Partial<PendingRestoreV1>;
  if (record.schemaVersion !== PENDING_RESTORE_SCHEMA_VERSION || !Array.isArray(record.writes)) {
    throw new InvalidPendingRestoreError("Pending backup restore has an unsupported schema");
  }
  const attempts = record.attempts ?? 0;
  if (!Number.isInteger(attempts) || attempts < 0) {
    throw new InvalidPendingRestoreError("Pending backup restore has an invalid attempt count");
  }

  const writes = new Map<string, string | null>();
  for (const entry of record.writes) {
    if (
      !Array.isArray(entry)
      || entry.length !== 2
      || typeof entry[0] !== "string"
      || entry[0] === RESTORE_PENDING_KEY
      || (entry[1] !== null && typeof entry[1] !== "string")
      || writes.has(entry[0])
    ) {
      throw new InvalidPendingRestoreError("Pending backup restore contains an invalid write");
    }
    writes.set(entry[0], entry[1]);
  }
  return { attempts, writes };
}

export function serializePendingRestore(
  writes: ReadonlyMap<string, string | null>,
  attempts = 0,
): string {
  const pending: PendingRestoreV1 = {
    schemaVersion: PENDING_RESTORE_SCHEMA_VERSION,
    attempts,
    writes: [...writes],
  };
  return JSON.stringify(pending);
}

export function applyRestoreWrites(
  storage: StorageLike,
  writes: ReadonlyMap<string, string | null>,
): void {
  for (const [key, value] of writes) {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
  for (const [key, expected] of writes) {
    if (storage.getItem(key) !== expected) {
      throw new Error(`Backup verification failed for ${key}`);
    }
  }
}

function removePendingRestore(storage: StorageLike): void {
  storage.removeItem(RESTORE_PENDING_KEY);
  if (storage.getItem(RESTORE_PENDING_KEY) !== null) {
    throw new Error("Pending backup restore could not be committed");
  }
}

export type StartupPendingRestoreResult =
  | "none"
  | "promoted"
  | "retryScheduled"
  | "discardedInvalid"
  | "discardedAfterRetryLimit"
  | "discardedAfterRetryTrackingFailure"
  | "storageUnavailable";

type PendingRestoreReporter = (message: string, cause: unknown) => void;

function reportSafely(
  report: PendingRestoreReporter,
  message: string,
  cause: unknown,
): void {
  try {
    report(message, cause);
  } catch {
    // 復旧失敗の報告処理によってアプリ起動を止めない。
  }
}

function discardPendingSafely(storage: StorageLike): unknown {
  try {
    removePendingRestore(storage);
    return null;
  } catch (cause) {
    return cause;
  }
}

/**
 * アプリ起動専用の非throw前進復旧。
 *
 * 決定的に不正なpayloadは即破棄する。書き込み失敗など再試行可能な失敗は最大3回までに制限し、
 * 試行回数を保存できない場合も無限再試行を避けるためpendingを破棄する。
 */
export function promotePendingBackupRestoreOnStartup(
  storage: StorageLike,
  report: PendingRestoreReporter = (message, cause) => console.error(message, cause),
): StartupPendingRestoreResult {
  let raw: string | null;
  try {
    raw = storage.getItem(RESTORE_PENDING_KEY);
  } catch (cause) {
    reportSafely(report, "Could not read pending backup restore", cause);
    return "storageUnavailable";
  }
  if (raw === null) return "none";

  let pending: ParsedPendingRestore;
  try {
    pending = parsePendingRestore(raw);
  } catch (cause) {
    const cleanupCause = discardPendingSafely(storage);
    reportSafely(report, "Discarded invalid pending backup restore", cleanupCause ?? cause);
    return "discardedInvalid";
  }

  try {
    applyRestoreWrites(storage, pending.writes);
    removePendingRestore(storage);
    return "promoted";
  } catch (cause) {
    const nextAttempts = pending.attempts + 1;
    if (nextAttempts >= MAX_PENDING_RESTORE_ATTEMPTS) {
      const cleanupCause = discardPendingSafely(storage);
      reportSafely(report, "Discarded pending backup restore after retry limit", cleanupCause ?? cause);
      return "discardedAfterRetryLimit";
    }

    try {
      const nextPayload = serializePendingRestore(pending.writes, nextAttempts);
      storage.setItem(RESTORE_PENDING_KEY, nextPayload);
      if (storage.getItem(RESTORE_PENDING_KEY) !== nextPayload) {
        throw new Error("Pending backup restore attempt count could not be verified", { cause });
      }
    } catch (trackingCause) {
      const cleanupCause = discardPendingSafely(storage);
      reportSafely(
        report,
        "Discarded pending backup restore because retry count could not be stored",
        cleanupCause ?? trackingCause,
      );
      return "discardedAfterRetryTrackingFailure";
    }

    reportSafely(report, `Pending backup restore retry ${nextAttempts} failed`, cause);
    return "retryScheduled";
  }
}
