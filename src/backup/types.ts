import type { PokemonBoxEntryV1, SleepSettings } from "../domain/types";
import type { CalcSaveSlotV1 } from "../persistence/calc";
import type { CandyInventoryV1, CandyInventoryV2 } from "../persistence/candy";

export const BACKUP_FORMAT = "candy-boost-planner-backup" as const;
export const BACKUP_SCHEMA_VERSION = 3 as const;
export const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
export const BACKUP_MAX_BOX_ENTRIES = 300;
export const BACKUP_MAX_ROWS_PER_SLOT = 60;

export type BackupBoxEntryV1 = Omit<PokemonBoxEntryV1, "source">;

type CandyBoostPlannerBackupData<TCandyInventory> = {
  box: { entries: BackupBoxEntryV1[] };
  globalSettings: {
    totalShards: number;
    sleepSettings: SleepSettings;
    candyInventory: TCandyInventory;
  };
  calculator: {
    activeSlotIndex: 0 | 1 | 2;
    slots: [CalcSaveSlotV1 | null, CalcSaveSlotV1 | null, CalcSaveSlotV1 | null];
  };
};

export type CandyBoostPlannerBackupV1 = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: 1;
  exportedAt: string;
  data: CandyBoostPlannerBackupData<CandyInventoryV1>;
};

export type CandyBoostPlannerBackupV2 = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: 2;
  exportedAt: string;
  data: CandyBoostPlannerBackupData<CandyInventoryV2>;
};

/** V3での変更点は CalcRowV1.sleepTargetHours の追加のみ。candyInventory のスキーマは V2 のまま。 */
export type CandyBoostPlannerBackupV3 = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  data: CandyBoostPlannerBackupData<CandyInventoryV2>;
};

export type BackupWarning = {
  path: string;
  code: "orphan-box-reference" | "unknown-pokedex-id";
};

export type ValidatedBackup = {
  /** V1/V2入力もfamilyキーへ移行済みのV3として返す。 */
  backup: CandyBoostPlannerBackupV3;
  warnings: BackupWarning[];
};

export class BackupValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "BackupValidationError";
  }
}
