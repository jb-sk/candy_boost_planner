import type { PokemonBoxEntryV1, SleepSettings } from "../domain/types";
import type { CalcSaveSlotV1 } from "../persistence/calc";
import type { CandyInventoryV2 } from "../persistence/candy";
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, type BackupBoxEntryV1, type CandyBoostPlannerBackupV3 } from "./types";

export type BackupSnapshotSources = {
  boxEntries: readonly PokemonBoxEntryV1[];
  totalShards: number;
  sleepSettings: SleepSettings;
  candyInventory: CandyInventoryV2;
  calculator: {
    activeSlotIndex: 0 | 1 | 2;
    slots: [CalcSaveSlotV1 | null, CalcSaveSlotV1 | null, CalcSaveSlotV1 | null];
  };
};

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) copy[key] = clone(item);
    }
    return copy as T;
  }
  return value;
}

function toBackupBoxEntry(entry: PokemonBoxEntryV1): BackupBoxEntryV1 {
  const copy = clone(entry) as unknown as Record<string, unknown>;
  delete copy.source;
  return copy as BackupBoxEntryV1;
}

export function createBackup(sources: BackupSnapshotSources, now = new Date()): CandyBoostPlannerBackupV3 {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    data: {
      box: { entries: sources.boxEntries.map((entry) => toBackupBoxEntry(entry)) },
      globalSettings: {
        totalShards: sources.totalShards,
        sleepSettings: clone(sources.sleepSettings),
        candyInventory: clone(sources.candyInventory),
      },
      calculator: clone(sources.calculator),
    },
  };
}
