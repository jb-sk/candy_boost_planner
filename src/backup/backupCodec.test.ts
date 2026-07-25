import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CalcRowV1, CalcSaveSlotV1 } from "../persistence/calc";
import { parseBackup, stringifyBackup } from "./backupCodec";
import { createBackup } from "./createBackup";
import { BACKUP_MAX_BYTES, BackupValidationError, type BackupBoxEntryV1, type CandyBoostPlannerBackupV3 } from "./types";

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
    sleepSettings: { dailySleepHours: 8.5, sleepExpBonusCount: 0, includeGSD: true },
    candyInventory: { schemaVersion: 2, universal: { s: 0, m: 0, l: 0 }, typeCandy: {}, species: {} },
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
    expect(parsed.backup.schemaVersion).toBe(3);
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
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.data.globalSettings.candyInventory).toEqual({
      // candyInventory 自体のスキーマは V2 のまま（V3の変更は candyInventory 以外の部分のみ）。
      schemaVersion: 2,
      universal: legacy.data.globalSettings.candyInventory.universal,
      typeCandy: legacy.data.globalSettings.candyInventory.typeCandy,
      species: { "25": 100 },
    });
    expect(JSON.parse(stringifyBackup(parsed)).schemaVersion).toBe(3);
  });

  it("migrates a V2 backup (schemaVersion 2) to the latest schema, preserving rows", () => {
    const v2 = JSON.parse(
      readFileSync(new URL("../../tests/fixtures/backup-v2.golden.json", import.meta.url), "utf8"),
    );
    expect(v2.schemaVersion).toBe(2);
    const parsed = parseBackup(JSON.stringify(v2)).backup;
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed.data.calculator.slots).toEqual(v2.data.calculator.slots);
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
    ["future schema", JSON.stringify({ ...backup(), schemaVersion: 4 })],
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
    value.data.calculator.slots = [slot("slot-1", [{ ...row("row-1"), sleepTargetHours: 1000 }]), null, null];
    const parsed = parseBackup(JSON.stringify(value)).backup;
    expect(parsed.data.calculator.slots[0]?.rows[0]?.sleepTargetHours).toBe(1000);

    const withoutTarget = backup();
    withoutTarget.data.calculator.slots = [slot("slot-1", [row("row-1")]), null, null];
    expect(parseBackup(JSON.stringify(withoutTarget)).backup.data.calculator.slots[0]?.rows[0]?.sleepTargetHours).toBeUndefined();

    const invalid = backup();
    invalid.data.calculator.slots = [slot("slot-1", [{ ...row("row-1"), sleepTargetHours: 999 } as CalcRowV1]), null, null];
    expect(() => parseBackup(JSON.stringify(invalid))).toThrow("sleepTargetHours");
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
      sleepSettings: { dailySleepHours: 8.5, sleepExpBonusCount: 0, includeGSD: true },
      candyInventory: { schemaVersion: 2, universal: { s: 0, m: 0, l: 0 }, typeCandy: {}, species: {} },
      calculator: { activeSlotIndex: 0, slots: [null, null, null] },
    });
    expect(value.data.box.entries[0]).not.toHaveProperty("source");
    expect(stringifyBackup(value)).not.toContain('"source"');
  });
});
