import type { PokemonBoxEntryV1, SleepSettings } from "../domain/types";
import type { CalcSaveSlotV1 } from "../persistence/calc";
import type { CandyInventoryV1 } from "../persistence/candy";

export const BACKUP_FORMAT = "candy-boost-planner-backup" as const;
export const BACKUP_SCHEMA_VERSION = 1 as const;
export const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
export const BACKUP_MAX_BOX_ENTRIES = 300;
export const BACKUP_MAX_ROWS_PER_SLOT = 60;

export type BackupBoxEntryV1 = Omit<PokemonBoxEntryV1, "source">;

export type CandyBoostPlannerBackupV1 = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  data: {
    box: { entries: BackupBoxEntryV1[] };
    globalSettings: {
      totalShards: number;
      sleepSettings: SleepSettings;
      candyInventory: CandyInventoryV1;
    };
    calculator: {
      activeSlotIndex: 0 | 1 | 2;
      slots: [CalcSaveSlotV1 | null, CalcSaveSlotV1 | null, CalcSaveSlotV1 | null];
    };
  };
};

export type BackupWarning = {
  path: string;
  code: "orphan-box-reference" | "unknown-pokedex-id";
};

export type ValidatedBackup = {
  backup: CandyBoostPlannerBackupV1;
  warnings: BackupWarning[];
};

export class BackupValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "BackupValidationError";
  }
}
