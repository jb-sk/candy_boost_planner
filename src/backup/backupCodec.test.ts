import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CalcRowV1, CalcSaveSlotV1 } from "../persistence/calc";
import { DEFAULT_SLEEP_SETTINGS } from "../persistence/calc";
import { parseBackup, stringifyBackup } from "./backupCodec";
import { createBackup } from "./createBackup";
import { BACKUP_MAX_BYTES, BACKUP_SCHEMA_VERSION, BackupValidationError, type BackupBoxEntryV1, type CandyBoostPlannerBackupV3 } from "./types";

function row(id: string, boxId?: string, pokedexId = 25): CalcRowV1 {
  return {
    id,
    boxId,
    pokedexId,
    pokemonType: "Electric",
    title: id,
    srcLevel: 10,
    dstLevel: 20,
    expRemaining: 100,
    expType: 600,
    nature: "normal",
    boostReachLevel: 20,
  };
}

function slot(id: string, rows: CalcRowV1[] = []): CalcSaveSlotV1 {
  return {
    slotId: id,
    savedAt: "2026-07-22T07:30:00.000Z",
    rows,
    activeRowId: rows[0]?.id ?? null,
    boostKind: "full",
    boostCandyRemaining: 123,
    itemCompareMode: "surplusGateFirst",
  };
}

function entry(id: string, pokedexId = 25): BackupBoxEntryV1 {
  return {
    id,
    rawText: "",
    label: id,
    favorite: true,
    derived: { pokedexId, form: 0, level: 10, expType: 600, expGainNature: "normal", natureName: "" },
    planner: { level: 10, expRemaining: 20, sleepHours: 0, expType: 600, expGainNature: "normal" },
    createdAt: "2026-07-22T07:30:00.000Z",
    updatedAt: "2026-07-22T07:30:00.000Z",
  };
}

function backup(): CandyBoostPlannerBackupV3 {
  return createBackup({
    boxEntries: [],
    totalShards: 0,
    sleepSettings: {
      dailySleepHours: 8.5,
      sleepExpBonusCount: 0,
      includeGSD: true,
      timeZone: "Asia/Tokyo",
      growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: true, afterFullMoon: false },
      growthIncenseNormalPerWeek: 1,
      growthIncenseStock: null,
      manualEventBonuses: [],
      useProjectedEvents: false,
      blueSeedPlantWeekday: 1,
      blueSeedIncenseDays: "auto",
    },
    candyInventory: { schemaVersion: 2, universal: { s: 0, m: 0, l: 0 }, typeCandy: {}, species: {} },
    defaultBoostReachLevel: null,
    calculator: { activeSlotIndex: 0, slots: [null, null, null] },
  }, new Date("2026-07-22T07:30:00.000Z"));
}

describe("backup codec", () => {
  it("round-trips the V1 golden fixture", () => {
    const text = readFileSync(new URL("../../tests/fixtures/backup-v1.golden.json", import.meta.url), "utf8");
    const parsed = parseBackup(text);
    expect(parseBackup(stringifyBackup(parsed.backup)).backup).toEqual(parsed.backup);
  });

  it("round-trips the V2 family-key golden fixture as the latest schema", () => {
    const text = readFileSync(new URL("../../tests/fixtures/backup-v2.golden.json", import.meta.url), "utf8");
    const parsed = parseBackup(text);
    expect(parsed.backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(parsed.backup.data.globalSettings.candyInventory.species).toEqual({ "25": 100, "133": 240 });
    expect(parseBackup(stringifyBackup(parsed.backup)).backup).toEqual(parsed.backup);
  });

  it("migrates V1 candy keys by family maximum and exports only the latest schema", () => {
    const legacy = JSON.parse(
      readFileSync(new URL("../../tests/fixtures/backup-v1.golden.json", import.meta.url), "utf8"),
    );
    legacy.data.globalSettings.candyInventory.species = {
      "172": 30,
      "25": 100,
      "26": 50,
    };
    const parsed = parseBackup(JSON.stringify(legacy)).backup;
    expect(parsed.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(parsed.data.globalSettings.candyInventory).toEqual({
      // candyInventory 自体のスキーマは V2 のまま（V3の変更は candyInventory 以外の部分のみ）。
      schemaVersion: 2,
      universal: legacy.data.globalSettings.candyInventory.universal,
      typeCandy: legacy.data.globalSettings.candyInventory.typeCandy,
      species: { "25": 100 },
    });
    expect(JSON.parse(stringifyBackup(parsed)).schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
  });

  it("migrates a V2 backup (schemaVersion 2) to the latest schema, preserving rows", () => {
    const v2 = JSON.parse(
      readFileSync(new URL("../../tests/fixtures/backup-v2.golden.json", import.meta.url), "utf8"),
    );
    expect(v2.schemaVersion).toBe(2);
    const parsed = parseBackup(JSON.stringify(v2)).backup;
    expect(parsed.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(parsed.data.calculator.slots).toEqual(v2.data.calculator.slots);
  });

  it.each([1, 2] as const)("drops V%s boost values whose explicitness cannot be recovered and reports the migration", (schemaVersion) => {
    const legacy = JSON.parse(JSON.stringify(backup()));
    legacy.schemaVersion = schemaVersion;
    legacy.data.globalSettings.candyInventory.schemaVersion = schemaVersion === 1 ? 1 : 2;
    legacy.data.calculator.slots = [
      slot("legacy-slot", [{ ...row("legacy-row"), boostOrExpAdjustment: 123 }]),
      null,
      null,
    ];

    const parsed = parseBackup(JSON.stringify(legacy));
    expect(parsed.backup.data.calculator.slots[0]?.rows[0]?.boostOrExpAdjustment).toBeUndefined();
    expect(parsed.migrationNotices).toEqual([{
      code: "legacy-boost-values-rederived",
      affectedRowCount: 1,
    }]);
  });

  it("does not show a boost migration notice when an old backup has no positive saved boost values", () => {
    const legacy = JSON.parse(JSON.stringify(backup()));
    legacy.schemaVersion = 2;
    legacy.data.calculator.slots = [
      slot("legacy-slot", [{ ...row("legacy-row"), boostOrExpAdjustment: 0 }]),
      null,
      null,
    ];

    expect(parseBackup(JSON.stringify(legacy)).migrationNotices).toEqual([]);
  });

  it("preserves current-schema explicit boost values and recovers n ≤ m", () => {
    const value = backup();
    value.data.calculator.slots = [
      slot("current-slot", [{
        ...row("current-row"),
        boostReachLevel: 40,
        boostOrExpAdjustment: 500,
        candyTarget: 10,
        dstExpInLevel: 12,
      }]),
      null,
      null,
    ];

    const parsed = parseBackup(stringifyBackup(value)).backup;
    const restored = parsed.data.calculator.slots[0]!.rows[0]!;
    expect(restored.boostOrExpAdjustment).toBe(10);
    expect(restored.boostReachLevel).toBe(40);
    expect(restored.dstExpInLevel).toBe(12);
  });

  it("round-trips defaultBoostReachLevel", () => {
    const value = backup();
    value.data.globalSettings.defaultBoostReachLevel = 35;

    const parsed = parseBackup(stringifyBackup(value)).backup;

    expect(parsed.data.globalSettings.defaultBoostReachLevel).toBe(35);
  });

  it("round-trips time zone, Growth Incense, and manual event settings", () => {
    const value = backup();
    value.data.globalSettings.sleepSettings = {
      dailySleepHours: 7,
      sleepExpBonusCount: 2,
      includeGSD: true,
      timeZone: "America/New_York",
      growthIncenseGsdDays: { beforeFullMoon: true, fullMoon: false, afterFullMoon: true },
      growthIncenseNormalPerWeek: 4,
      growthIncenseStock: 20,
      manualEventBonuses: [
        { from: "2026-08-25", to: "2026-08-27", multiplier: 3 },
        { from: "2026-09-01", to: "2026-09-07", multiplier: 1.5 },
      ],
      useProjectedEvents: true,
      blueSeedPlantWeekday: null,
      blueSeedIncenseDays: 5,
    };
    expect(parseBackup(stringifyBackup(value)).backup.data.globalSettings.sleepSettings)
      .toEqual(value.data.globalSettings.sleepSettings);
  });

  it("keeps schema V3 and fills settings added after its release with defaults", () => {
    const legacyV3 = JSON.parse(stringifyBackup(backup()));
    delete legacyV3.data.globalSettings.sleepSettings.growthIncenseGsdDays;
    delete legacyV3.data.globalSettings.sleepSettings.growthIncenseStock;
    delete legacyV3.data.globalSettings.sleepSettings.manualEventBonuses;
    delete legacyV3.data.globalSettings.sleepSettings.useProjectedEvents;
    delete legacyV3.data.globalSettings.sleepSettings.blueSeedPlantWeekday;
    delete legacyV3.data.globalSettings.sleepSettings.blueSeedIncenseDays;
    const parsed = parseBackup(JSON.stringify(legacyV3)).backup;
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.data.globalSettings.sleepSettings).toMatchObject({
      growthIncenseGsdDays: DEFAULT_SLEEP_SETTINGS.growthIncenseGsdDays,
      growthIncenseStock: null,
      manualEventBonuses: [],
      useProjectedEvents: true,
      blueSeedPlantWeekday: 1,
      blueSeedIncenseDays: "auto",
    });
  });

  it("migrates backups created before lunar-calendar settings were added", () => {
    const legacy = JSON.parse(JSON.stringify(backup()));
    delete legacy.data.globalSettings.sleepSettings.timeZone;
    delete legacy.data.globalSettings.sleepSettings.growthIncenseGsdDays;
    delete legacy.data.globalSettings.sleepSettings.growthIncenseGsdPolicy;
    delete legacy.data.globalSettings.sleepSettings.growthIncenseNormalPerWeek;
    delete legacy.data.globalSettings.sleepSettings.manualEventBonuses;
    delete legacy.data.globalSettings.sleepSettings.useProjectedEvents;
    delete legacy.data.globalSettings.sleepSettings.blueSeedPlantWeekday;
    delete legacy.data.globalSettings.sleepSettings.blueSeedIncenseDays;
    legacy.schemaVersion = 2;

    expect(parseBackup(JSON.stringify(legacy)).backup.data.globalSettings.sleepSettings).toMatchObject({
      timeZone: DEFAULT_SLEEP_SETTINGS.timeZone,
      growthIncenseGsdDays: DEFAULT_SLEEP_SETTINGS.growthIncenseGsdDays,
      growthIncenseNormalPerWeek: 0,
      // 旧バックアップに在庫の欄は無い。無いものを0（使えない）に読み替えてはいけない。
      growthIncenseStock: null,
      manualEventBonuses: [],
      useProjectedEvents: true,
      blueSeedPlantWeekday: 1,
      blueSeedIncenseDays: "auto",
    });
  });

  it("未リリース版バックアップの5択GSD設定を3日指定へ移行する", () => {
    const legacy = JSON.parse(JSON.stringify(backup()));
    delete legacy.data.globalSettings.sleepSettings.growthIncenseGsdDays;
    legacy.data.globalSettings.sleepSettings.growthIncenseGsdPolicy = "all";

    expect(parseBackup(JSON.stringify(legacy)).backup.data.globalSettings.sleepSettings.growthIncenseGsdDays)
      .toEqual({ beforeFullMoon: true, fullMoon: true, afterFullMoon: true });
  });

  it.each([
    ["timeZone", "UTC+09:00"],
    ["growthIncenseGsdDays", { beforeFullMoon: true, fullMoon: "sometimes", afterFullMoon: false }],
    ["growthIncenseNormalPerWeek", 8],
    ["growthIncenseStock", 1000],
    ["manualEventBonuses", [{ from: "2026-08-27", to: "2026-08-25", multiplier: 3 }]],
    ["useProjectedEvents", "yes"],
    ["blueSeedPlantWeekday", 7],
    ["blueSeedIncenseDays", 8],
  ])("rejects invalid sleep setting %s", (key, invalidValue) => {
    const value = JSON.parse(JSON.stringify(backup()));
    value.data.globalSettings.sleepSettings[key] = invalidValue;
    expect(() => parseBackup(JSON.stringify(value))).toThrow(`sleepSettings.${key}`);
  });

  it("manualEventBonuses追加前のschema V3バックアップを空配列へ移行する", () => {
    const value = JSON.parse(JSON.stringify(backup()));
    delete value.data.globalSettings.sleepSettings.manualEventBonuses;
    const parsed = parseBackup(JSON.stringify(value)).backup;
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.data.globalSettings.sleepSettings.manualEventBonuses).toEqual([]);
  });

  it("reads a backup without defaultBoostReachLevel as 未設定（目標Lvと同じ）", () => {
    // 旧形式にはこの項目が無い。欠けていることを 0 や既定Lvへ寄せない
    const legacy = JSON.parse(JSON.stringify(backup()));
    legacy.schemaVersion = 2;
    delete legacy.data.globalSettings.defaultBoostReachLevel;

    const parsed = parseBackup(JSON.stringify(legacy)).backup;

    expect(parsed.data.globalSettings.defaultBoostReachLevel).toBeNull();
  });

  it("requires defaultBoostReachLevel on the current schema", () => {
    // 現行形式は必ず書き出す。欠けているのは壊れた入力なので、黙って未設定へ寄せない
    const value = JSON.parse(JSON.stringify(backup()));
    delete value.data.globalSettings.defaultBoostReachLevel;

    expect(() => parseBackup(JSON.stringify(value))).toThrow(BackupValidationError);
  });

  it("rejects a defaultBoostReachLevel outside the level range", () => {
    const value = JSON.parse(JSON.stringify(backup()));
    value.data.globalSettings.defaultBoostReachLevel = 999;

    expect(() => parseBackup(JSON.stringify(value))).toThrow(BackupValidationError);
  });

  it("accepts the box and slot maximums while preserving order and settings", () => {
    const value = backup();
    value.data.box.entries = Array.from({ length: 300 }, (_, index) => entry(`box-${index}`));
    value.data.calculator.activeSlotIndex = 2;
    value.data.calculator.slots = [0, 1, 2].map((slotIndex) => slot(`slot-${slotIndex}`, Array.from({ length: 60 }, (_, rowIndex) => row(`row-${slotIndex}-${rowIndex}`, `box-${rowIndex}`)))) as typeof value.data.calculator.slots;
    const parsed = parseBackup(stringifyBackup(value)).backup;
    expect(parsed.data.box.entries).toHaveLength(300);
    expect(parsed.data.calculator.slots[2]?.rows.map((item) => item.id)).toEqual(value.data.calculator.slots[2]?.rows.map((item) => item.id));
    expect(parsed.data.calculator.slots[2]?.itemCompareMode).toBe("surplusGateFirst");
    expect(parsed.data.calculator.activeSlotIndex).toBe(2);
  });

  it.each([
    ["broken JSON", "{"],
    ["other format", JSON.stringify({ ...backup(), format: "other" })],
    ["future schema", JSON.stringify({ ...backup(), schemaVersion: 5 })],
  ])("rejects %s with an item path", (_name, text) => {
    expect(() => parseBackup(text)).toThrow(BackupValidationError);
    try { parseBackup(text); } catch (error) { expect((error as Error).message).toContain("$"); }
  });

  it("rejects content over 5 MiB before parsing", () => {
    expect(() => parseBackup(" ".repeat(BACKUP_MAX_BYTES + 1))).toThrow(/maximum size/);
  });

  it("rejects missing fields, invalid values, and duplicate IDs", () => {
    const missing = backup() as unknown as { data: { box: { entries?: unknown } } };
    delete missing.data.box.entries;
    expect(() => parseBackup(JSON.stringify(missing))).toThrow("$.data.box.entries");

    const invalid = backup();
    invalid.data.globalSettings.totalShards = -1;
    expect(() => parseBackup(JSON.stringify(invalid))).toThrow("$.data.globalSettings.totalShards");

    const duplicate = backup();
    duplicate.data.box.entries = [entry("same"), entry("same")];
    expect(() => parseBackup(JSON.stringify(duplicate))).toThrow("$.data.box.entries[1].id");
  });

  it("requires canonical UTC timestamps and species keys", () => {
    const invalidDate = backup();
    invalidDate.exportedAt = "July 22, 2026";
    expect(() => parseBackup(JSON.stringify(invalidDate))).toThrow("$.exportedAt");

    const normalizedInvalidDate = backup();
    normalizedInvalidDate.exportedAt = "2026-02-30T07:30:00.000Z";
    expect(() => parseBackup(JSON.stringify(normalizedInvalidDate))).toThrow("$.exportedAt");

    const invalidSpecies = backup();
    invalidSpecies.data.globalSettings.candyInventory.species = { "025": 1 };
    expect(() => parseBackup(JSON.stringify(invalidSpecies))).toThrow("$.data.globalSettings.candyInventory.species.025");
  });

  it("round-trips sleepTargetHours and rejects values outside the dropdown options", () => {
    const value = backup();
    value.data.calculator.slots = [slot("slot-1", [{ ...row("row-1"), candyTarget: 40, sleepTargetHours: 1000 }]), null, null];
    const parsed = parseBackup(JSON.stringify(value)).backup;
    expect(parsed.data.calculator.slots[0]?.rows[0]?.sleepTargetHours).toBe(1000);

    const withoutTarget = backup();
    withoutTarget.data.calculator.slots = [slot("slot-1", [row("row-1")]), null, null];
    expect(parseBackup(JSON.stringify(withoutTarget)).backup.data.calculator.slots[0]?.rows[0]?.sleepTargetHours).toBeUndefined();

    const invalid = backup();
    invalid.data.calculator.slots = [slot("slot-1", [{ ...row("row-1"), candyTarget: 40, sleepTargetHours: 999 } as CalcRowV1]), null, null];
    expect(() => parseBackup(JSON.stringify(invalid))).toThrow("sleepTargetHours");
  });

  it("§13-3: backup V3 は all を往復し、数値との同居はモード優先、不正モードは拒否する", () => {
    const value = backup();
    value.data.calculator.slots = [slot("slot-1", [{
      ...row("row-1"),
      sleepTargetMode: "all",
      sleepTargetHours: 1000,
      candyTarget: 40,
      dstExpInLevel: 10,
      boostOrExpAdjustment: 25,
    }]), null, null];
    const parsed = parseBackup(JSON.stringify(value)).backup;
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.data.calculator.slots[0]?.rows[0]).toMatchObject({
      sleepTargetMode: "all",
      sleepTargetHours: undefined,
      candyTarget: undefined,
      dstExpInLevel: undefined,
      boostOrExpAdjustment: 25,
    });
    expect(parseBackup(stringifyBackup(parsed)).backup).toEqual(parsed);

    const invalid = backup();
    invalid.data.calculator.slots = [slot("slot-1", [{
      ...row("row-1"),
      sleepTargetMode: "everything",
    } as unknown as CalcRowV1]), null, null];
    expect(() => parseBackup(JSON.stringify(invalid))).toThrow("sleepTargetMode");
  });

  it("backup V3 は stock を往復し、個数指定より優先する", () => {
    const value = backup();
    value.data.calculator.slots = [slot("slot-1", [{
      ...row("row-1"),
      sleepTargetMode: "stock",
      sleepTargetHours: 500,
      candyTarget: 40,
      dstExpInLevel: 10,
      boostOrExpAdjustment: 25,
    }]), null, null];
    const parsed = parseBackup(JSON.stringify(value)).backup;
    expect(parsed.data.calculator.slots[0]?.rows[0]).toMatchObject({
      sleepTargetMode: "stock",
      sleepTargetHours: undefined,
      candyTarget: undefined,
      dstExpInLevel: undefined,
      boostOrExpAdjustment: 25,
    });
    expect(parseBackup(stringifyBackup(parsed)).backup).toEqual(parsed);
  });

  it("rejects rows that violate the target invariants", () => {
    // 個数指定なしでも睡眠目標は有効
    const orphanSleep = backup();
    orphanSleep.data.calculator.slots = [slot("slot-1", [{ ...row("row-1"), sleepTargetHours: 1000 }]), null, null];
    expect(parseBackup(JSON.stringify(orphanSleep)).backup.data.calculator.slots[0]?.rows[0]?.sleepTargetHours).toBe(1000);

    // 個数指定なしの目標は Lv ちょうど
    const orphanExp = backup();
    orphanExp.data.calculator.slots = [slot("slot-1", [{ ...row("row-1"), dstExpInLevel: 100 }]), null, null];
    expect(() => parseBackup(JSON.stringify(orphanExp))).toThrow("dstExpInLevel");

    // dstExpInLevel は次Lvまでの必要EXP未満
    const overflow = backup();
    overflow.data.calculator.slots = [slot("slot-1", [{ ...row("row-1"), candyTarget: 40, dstExpInLevel: 9_999_999 }]), null, null];
    expect(() => parseBackup(JSON.stringify(overflow))).toThrow("dstExpInLevel");
  });

  it("round-trips dstExpInLevel for rows with candyTarget", () => {
    const value = backup();
    value.data.calculator.slots = [slot("slot-1", [{ ...row("row-1"), candyTarget: 40, dstExpInLevel: 137 }]), null, null];
    const parsed = parseBackup(JSON.stringify(value)).backup;
    expect(parsed.data.calculator.slots[0]?.rows[0]?.dstExpInLevel).toBe(137);
  });

  it("keeps orphan and unknown pokedex references as warnings", () => {
    const value = backup();
    value.data.box.entries = [entry("box-known")];
    value.data.calculator.slots = [slot("slot-1", [row("row-1", "missing", 999999)]), null, null];
    value.data.globalSettings.candyInventory.species = { "999999": 5 };
    const parsed = parseBackup(JSON.stringify(value));
    expect(parsed.backup.data.calculator.slots[0]?.rows[0]?.boxId).toBe("missing");
    expect(parsed.warnings.map((warning) => warning.code)).toEqual([
      "orphan-box-reference",
      "unknown-pokedex-id",
      "unknown-pokedex-id",
    ]);
  });

  it("does not include temporary calculator state or UI state", () => {
    const text = stringifyBackup(backup());
    expect(text).not.toContain("planResult");
    expect(text).not.toContain("undo");
    expect(text).not.toContain("scroll");
    expect(text).not.toContain("theme");
  });

  it("does not expose the internal Box source field", () => {
    const value = createBackup({
      boxEntries: [{ ...entry("manual-entry"), source: "manual" }],
      totalShards: 0,
      sleepSettings: {
        dailySleepHours: 8.5,
        sleepExpBonusCount: 0,
        includeGSD: true,
        timeZone: "Asia/Tokyo",
        growthIncenseGsdDays: { beforeFullMoon: false, fullMoon: true, afterFullMoon: false },
        growthIncenseNormalPerWeek: 1,
        growthIncenseStock: null,
        manualEventBonuses: [],
        useProjectedEvents: false,
        blueSeedPlantWeekday: 1,
        blueSeedIncenseDays: "auto",
      },
      candyInventory: { schemaVersion: 2, universal: { s: 0, m: 0, l: 0 }, typeCandy: {}, species: {} },
      defaultBoostReachLevel: null,
      calculator: { activeSlotIndex: 0, slots: [null, null, null] },
    });
    expect(value.data.box.entries[0]).not.toHaveProperty("source");
    expect(stringifyBackup(value)).not.toContain('"source"');
  });
});
