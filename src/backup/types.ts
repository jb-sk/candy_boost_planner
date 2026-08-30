import type { PokemonBoxEntryV1, SleepSettings } from "../domain/types";
import type { CalcSaveSlotV1 } from "../persistence/calc";
import type { CandyInventoryV1, CandyInventoryV2 } from "../persistence/candy";

export const BACKUP_FORMAT = "candy-boost-planner-backup" as const;
export const BACKUP_SCHEMA_VERSION = 3 as const;
export const BACKUP_MAX_BYTES = 5 * 1024 * 1024;
export const BACKUP_MAX_BOX_ENTRIES = 300;
export const BACKUP_MAX_ROWS_PER_SLOT = 60;

export type BackupBoxEntryV1 = Omit<PokemonBoxEntryV1, "source">;

type CandyBoostPlannerBackupData<TCandyInventory, TGlobalExtras = object> = {
  box: { entries: BackupBoxEntryV1[] };
  globalSettings: {
    totalShards: number;
    sleepSettings: SleepSettings;
    candyInventory: TCandyInventory;
  } & TGlobalExtras;
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

/**
 * 現行形式。1〜4を含むschema V3は先に公開された。
 *
 * 1. `CalcRowV1.sleepTargetHours` の追加
 * 2. アメブ個数の `undefined` を「導出」、値ありを「明示入力」として区別する（設計書 §10.18）
 * 3. `globalSettings.defaultBoostReachLevel` の追加
 * 4. `CalcRowV1.sleepTargetMode` の追加（`"all"` ／ `"stock"`）
 *
 * V3公開後に追加した`SleepSettings`の項目は、同じ版番号の古いバックアップでは欠落する。
 * そのため、復元時は欠落だけを各項目の既定値で補う。
 *
 * **2 のために版で判別している。** V2 以前は導出値と手入力値を保存値から区別できないため、
 * 読み込み時に `boostOrExpAdjustment` を落とす（`backupCodec.validateRow`）。
 * したがってこの形式を V2 のままにはできない。
 */
export type CandyBoostPlannerBackupV3 = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  data: CandyBoostPlannerBackupData<CandyInventoryV2, {
    /** 既定のアメブ目標Lv。`null` は未設定（＝目標Lvと同じ）。旧形式にはこの項目が無い。 */
    defaultBoostReachLevel: number | null;
  }>;
};

export type BackupWarning = {
  path: string;
  code: "orphan-box-reference" | "unknown-pokedex-id";
};

export type BackupMigrationNotice = {
  code: "legacy-boost-values-rederived";
  affectedRowCount: number;
};

export type ValidatedBackup = {
  /** 旧入力も現行形式へ移行済みのV3として返す。 */
  backup: CandyBoostPlannerBackupV3;
  warnings: BackupWarning[];
  /** 復元は可能だが、旧形式からの移行で保存値の意味が変わることを復元前に知らせる。 */
  migrationNotices: BackupMigrationNotice[];
};

export class BackupValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "BackupValidationError";
  }
}
