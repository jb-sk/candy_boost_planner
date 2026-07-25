import type { BoxSubSkillSlotV1, IngredientType, PokemonSpecialty } from "../domain/types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { pokemonMaster } from "../domain/pokesleep/pokemon-master";
import { PokemonTypes } from "../domain/pokesleep/pokemon-types";
import { migrateLegacyPeakCandyTarget, SLEEP_TARGET_HOURS_OPTIONS, type CalcRowV1, type CalcSaveSlotV1 } from "../persistence/calc";
import {
  migrateCandyInventoryV1,
  normalizeCandyInventoryV2,
  type CandyInventoryV1,
  type CandyInventoryV2,
} from "../persistence/candy";
import {
  BACKUP_FORMAT,
  BACKUP_MAX_BOX_ENTRIES,
  BACKUP_MAX_BYTES,
  BACKUP_MAX_ROWS_PER_SLOT,
  BACKUP_SCHEMA_VERSION,
  BackupValidationError,
  type BackupBoxEntryV1,
  type BackupWarning,
  type CandyBoostPlannerBackupV3,
  type ValidatedBackup,
} from "./types";

const knownPokedexIds = new Set(pokemonMaster.map((entry) => entry.pokedexId));
const pokemonTypes = new Set<string>(PokemonTypes);
const expTypes = new Set([600, 900, 1080, 1320]);
const natures = new Set(["down", "normal", "up"]);
const boostKinds = new Set(["none", "mini", "full"]);
const compareModes = new Set(["surplusFirst", "surplusGateFirst", "legacyImproved"]);
const sleepTargetHoursValues = new Set<number>(SLEEP_TARGET_HOURS_OPTIONS);
const specialties = new Set(["Berries", "Ingredients", "Skills", "All", "unknown"]);
const ingredientTypes = new Set(["AAA", "AAB", "AAC", "ABA", "ABB", "ABC"]);
const subSkillLevels = new Set([10, 25, 50, 70, 80]);

function fail(path: string, message: string): never {
  throw new BackupValidationError(path, message);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "object is required");
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "array is required");
  return value;
}

function stringAt(value: unknown, path: string, allowEmpty = true): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) fail(path, "string is required");
  return value;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "boolean is required");
  return value;
}

function numberAt(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER, integer = true): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "finite number is required");
  if (integer && !Number.isInteger(value)) fail(path, "integer is required");
  if (value < min || value > max) fail(path, `must be between ${min} and ${max}`);
  return value;
}

function enumAt<T>(value: unknown, path: string, values: Set<T>): T {
  if (!values.has(value as T)) fail(path, "unsupported value");
  return value as T;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringAt(value, path, false);
}

function optionalNumber(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
  return value === undefined ? undefined : numberAt(value, path, min, max);
}

function validateIso(value: unknown, path: string): string {
  const iso = stringAt(value, path, false);
  const timestamp = Date.parse(iso);
  const match = iso.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/);
  const normalized = match
    ? `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`
    : "";
  if (
    !Number.isFinite(timestamp)
    || !match
    || new Date(timestamp).toISOString() !== normalized
  ) {
    fail(path, "UTC ISO 8601 date is required");
  }
  return iso;
}

function validateSubSkills(value: unknown, path: string): BoxSubSkillSlotV1[] | undefined {
  if (value === undefined) return undefined;
  return arrayAt(value, path).map((item, index) => {
    const p = `${path}[${index}]`;
    const row = objectAt(item, p);
    return {
      lv: enumAt(row.lv, `${p}.lv`, subSkillLevels) as BoxSubSkillSlotV1["lv"],
      nameEn: stringAt(row.nameEn, `${p}.nameEn`, false),
    };
  });
}

function validateBoxEntry(value: unknown, path: string): BackupBoxEntryV1 {
  const row = objectAt(value, path);
  const derivedValue = row.derived;
  const plannerValue = row.planner;
  const derived = derivedValue === undefined ? undefined : (() => {
    const d = objectAt(derivedValue, `${path}.derived`);
    return {
      pokedexId: numberAt(d.pokedexId, `${path}.derived.pokedexId`, 1),
      form: numberAt(d.form, `${path}.derived.form`, 0),
      level: numberAt(d.level, `${path}.derived.level`, 1, MAX_LEVEL),
      expType: enumAt(d.expType, `${path}.derived.expType`, expTypes) as 600 | 900 | 1080 | 1320,
      expGainNature: enumAt(d.expGainNature, `${path}.derived.expGainNature`, natures) as "down" | "normal" | "up",
      natureName: stringAt(d.natureName, `${path}.derived.natureName`),
    };
  })();
  const planner = plannerValue === undefined ? undefined : (() => {
    const p = objectAt(plannerValue, `${path}.planner`);
    return {
      level: optionalNumber(p.level, `${path}.planner.level`, 1, MAX_LEVEL),
      expRemaining: optionalNumber(p.expRemaining, `${path}.planner.expRemaining`, 0, 999999),
      sleepHours: optionalNumber(p.sleepHours, `${path}.planner.sleepHours`, 0),
      expType: p.expType === undefined ? undefined : enumAt(p.expType, `${path}.planner.expType`, expTypes) as 600 | 900 | 1080 | 1320,
      expGainNature: p.expGainNature === undefined ? undefined : enumAt(p.expGainNature, `${path}.planner.expGainNature`, natures) as "down" | "normal" | "up",
      specialty: p.specialty === undefined ? undefined : enumAt(p.specialty, `${path}.planner.specialty`, specialties) as PokemonSpecialty,
      ingredientType: p.ingredientType === undefined ? undefined : enumAt(p.ingredientType, `${path}.planner.ingredientType`, ingredientTypes) as IngredientType,
      subSkills: validateSubSkills(p.subSkills, `${path}.planner.subSkills`),
    };
  })();
  return {
    id: stringAt(row.id, `${path}.id`, false),
    rawText: stringAt(row.rawText, `${path}.rawText`),
    label: stringAt(row.label, `${path}.label`),
    favorite: row.favorite === undefined ? undefined : booleanAt(row.favorite, `${path}.favorite`),
    derived,
    planner,
    createdAt: validateIso(row.createdAt, `${path}.createdAt`),
    updatedAt: validateIso(row.updatedAt, `${path}.updatedAt`),
  };
}

function validateRow(value: unknown, path: string): CalcRowV1 {
  const row = objectAt(value, path);
  const srcLevel = numberAt(row.srcLevel, `${path}.srcLevel`, 1, MAX_LEVEL);
  const dstLevel = numberAt(row.dstLevel, `${path}.dstLevel`, srcLevel, MAX_LEVEL);
  return {
    id: stringAt(row.id, `${path}.id`, false),
    boxId: optionalString(row.boxId, `${path}.boxId`),
    pokedexId: optionalNumber(row.pokedexId, `${path}.pokedexId`, 1),
    pokemonType: row.pokemonType === undefined ? undefined : enumAt(row.pokemonType, `${path}.pokemonType`, pokemonTypes),
    title: stringAt(row.title, `${path}.title`),
    srcLevel,
    dstLevel,
    dstLevelText: row.dstLevelText === undefined ? undefined : stringAt(row.dstLevelText, `${path}.dstLevelText`),
    expRemaining: numberAt(row.expRemaining, `${path}.expRemaining`, 0, 999999),
    expType: enumAt(row.expType, `${path}.expType`, expTypes) as 600 | 900 | 1080 | 1320,
    nature: enumAt(row.nature, `${path}.nature`, natures) as "down" | "normal" | "up",
    boostReachLevel: numberAt(row.boostReachLevel, `${path}.boostReachLevel`, srcLevel, dstLevel),
    boostOrExpAdjustment: optionalNumber(row.boostOrExpAdjustment, `${path}.boostOrExpAdjustment`, 0),
    // 旧 mode:"peak" 行は candyTarget へ移行する（設計書§6.1）。
    // mode / candyPeak / boostRatioPct は V3 で廃止したため、あっても読み捨てる。
    candyTarget: optionalNumber(row.candyTarget, `${path}.candyTarget`, 0) ?? migrateLegacyPeakCandyTarget(row),
    sleepHours: optionalNumber(row.sleepHours, `${path}.sleepHours`, 0),
    sleepTargetHours: row.sleepTargetHours === undefined
      ? undefined
      : enumAt(row.sleepTargetHours, `${path}.sleepTargetHours`, sleepTargetHoursValues),
  };
}

function validateSlot(value: unknown, path: string): CalcSaveSlotV1 | null {
  if (value === null) return null;
  const slot = objectAt(value, path);
  const rawRows = arrayAt(slot.rows, `${path}.rows`);
  if (rawRows.length > BACKUP_MAX_ROWS_PER_SLOT) fail(`${path}.rows`, `maximum is ${BACKUP_MAX_ROWS_PER_SLOT}`);
  const rows = rawRows.map((row, index) => validateRow(row, `${path}.rows[${index}]`));
  const rowIds = new Set<string>();
  rows.forEach((row, index) => {
    if (rowIds.has(row.id)) fail(`${path}.rows[${index}].id`, "duplicate id");
    rowIds.add(row.id);
  });
  const activeRowId = slot.activeRowId === null ? null : stringAt(slot.activeRowId, `${path}.activeRowId`, false);
  if (activeRowId !== null && !rowIds.has(activeRowId)) fail(`${path}.activeRowId`, "must reference a row in this slot");
  return {
    slotId: stringAt(slot.slotId, `${path}.slotId`, false),
    savedAt: validateIso(slot.savedAt, `${path}.savedAt`),
    rows,
    activeRowId,
    boostKind: enumAt(slot.boostKind, `${path}.boostKind`, boostKinds) as "none" | "mini" | "full",
    boostCandyRemaining: slot.boostCandyRemaining === undefined
      ? undefined
      : slot.boostCandyRemaining === null ? null : numberAt(slot.boostCandyRemaining, `${path}.boostCandyRemaining`, 0),
    itemCompareMode: slot.itemCompareMode === undefined
      ? undefined
      : enumAt(slot.itemCompareMode, `${path}.itemCompareMode`, compareModes) as "surplusFirst" | "surplusGateFirst" | "legacyImproved",
  };
}

function validateCandy(
  value: unknown,
  path: string,
  schemaVersion: 1 | 2,
): CandyInventoryV2 {
  const candy = objectAt(value, path);
  if (candy.schemaVersion !== schemaVersion) fail(`${path}.schemaVersion`, `must be ${schemaVersion}`);
  const universal = objectAt(candy.universal, `${path}.universal`);
  const typeCandyObject = objectAt(candy.typeCandy, `${path}.typeCandy`);
  const typeCandy: CandyInventoryV1["typeCandy"] = {};
  for (const [type, item] of Object.entries(typeCandyObject)) {
    if (!pokemonTypes.has(type)) fail(`${path}.typeCandy.${type}`, "unknown Pokemon type");
    const counts = objectAt(item, `${path}.typeCandy.${type}`);
    typeCandy[type] = {
      s: numberAt(counts.s, `${path}.typeCandy.${type}.s`, 0),
      m: numberAt(counts.m, `${path}.typeCandy.${type}.m`, 0),
    };
  }
  const speciesObject = objectAt(candy.species, `${path}.species`);
  const species: Record<string, number> = {};
  for (const [id, count] of Object.entries(speciesObject)) {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
      fail(`${path}.species.${id}`, "canonical positive pokedex id is required");
    }
    species[id] = numberAt(count, `${path}.species.${id}`, 0);
  }
  const common = {
    universal: {
      s: numberAt(universal.s, `${path}.universal.s`, 0),
      m: numberAt(universal.m, `${path}.universal.m`, 0),
      l: numberAt(universal.l, `${path}.universal.l`, 0),
    },
    typeCandy,
    species,
  };
  return schemaVersion === 1
    ? migrateCandyInventoryV1({ schemaVersion: 1, ...common })
    : normalizeCandyInventoryV2({ schemaVersion: 2, ...common });
}

export function parseBackup(text: string): ValidatedBackup {
  if (new TextEncoder().encode(text).byteLength > BACKUP_MAX_BYTES) fail("$", `maximum size is ${BACKUP_MAX_BYTES} bytes`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("$", "invalid JSON");
  }
  const root = objectAt(parsed, "$");
  if (root.format !== BACKUP_FORMAT) fail("$.format", `must be ${BACKUP_FORMAT}`);
  if (typeof root.schemaVersion !== "number") fail("$.schemaVersion", "number is required");
  if (root.schemaVersion > BACKUP_SCHEMA_VERSION) fail("$.schemaVersion", "future schema version is not supported");
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2 && root.schemaVersion !== BACKUP_SCHEMA_VERSION) fail("$.schemaVersion", "schema version is not supported");
  const sourceSchemaVersion = root.schemaVersion as 1 | 2 | 3;
  // candyInventory 自体のスキーマは V2 のまま（V3での変更は CalcRowV1.sleepTargetHours の追加のみ）。
  const candyInventorySchemaVersion: 1 | 2 = sourceSchemaVersion === 1 ? 1 : 2;
  const data = objectAt(root.data, "$.data");
  const box = objectAt(data.box, "$.data.box");
  const rawEntries = arrayAt(box.entries, "$.data.box.entries");
  if (rawEntries.length > BACKUP_MAX_BOX_ENTRIES) fail("$.data.box.entries", `maximum is ${BACKUP_MAX_BOX_ENTRIES}`);
  const entries = rawEntries.map((entry, index) => validateBoxEntry(entry, `$.data.box.entries[${index}]`));
  const boxIds = new Set<string>();
  entries.forEach((entry, index) => {
    if (boxIds.has(entry.id)) fail(`$.data.box.entries[${index}].id`, "duplicate id");
    boxIds.add(entry.id);
  });
  const globals = objectAt(data.globalSettings, "$.data.globalSettings");
  const sleep = objectAt(globals.sleepSettings, "$.data.globalSettings.sleepSettings");
  const calculator = objectAt(data.calculator, "$.data.calculator");
  const rawSlots = arrayAt(calculator.slots, "$.data.calculator.slots");
  if (rawSlots.length !== 3) fail("$.data.calculator.slots", "exactly 3 slots are required");
  const slots = rawSlots.map((slot, index) => validateSlot(slot, `$.data.calculator.slots[${index}]`)) as [CalcSaveSlotV1 | null, CalcSaveSlotV1 | null, CalcSaveSlotV1 | null];
  const slotIds = new Set<string>();
  slots.forEach((slot, index) => {
    if (!slot?.slotId) return;
    if (slotIds.has(slot.slotId)) fail(`$.data.calculator.slots[${index}].slotId`, "duplicate id");
    slotIds.add(slot.slotId);
  });
  const backup: CandyBoostPlannerBackupV3 = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: validateIso(root.exportedAt, "$.exportedAt"),
    data: {
      box: { entries },
      globalSettings: {
        totalShards: numberAt(globals.totalShards, "$.data.globalSettings.totalShards", 0),
        sleepSettings: {
          dailySleepHours: numberAt(sleep.dailySleepHours, "$.data.globalSettings.sleepSettings.dailySleepHours", 1, 13, false),
          sleepExpBonusCount: numberAt(sleep.sleepExpBonusCount, "$.data.globalSettings.sleepSettings.sleepExpBonusCount", 0, 5),
          includeGSD: booleanAt(sleep.includeGSD, "$.data.globalSettings.sleepSettings.includeGSD"),
        },
        candyInventory: validateCandy(
          globals.candyInventory,
          "$.data.globalSettings.candyInventory",
          candyInventorySchemaVersion,
        ),
      },
      calculator: {
        activeSlotIndex: numberAt(calculator.activeSlotIndex, "$.data.calculator.activeSlotIndex", 0, 2) as 0 | 1 | 2,
        slots,
      },
    },
  };
  const warnings: BackupWarning[] = [];
  entries.forEach((entry, index) => {
    const id = entry.derived?.pokedexId;
    if (id && !knownPokedexIds.has(id)) warnings.push({ path: `$.data.box.entries[${index}].derived.pokedexId`, code: "unknown-pokedex-id" });
  });
  slots.forEach((slot, slotIndex) => slot?.rows.forEach((row, rowIndex) => {
    const path = `$.data.calculator.slots[${slotIndex}].rows[${rowIndex}]`;
    if (row.boxId && !boxIds.has(row.boxId)) warnings.push({ path: `${path}.boxId`, code: "orphan-box-reference" });
    if (row.pokedexId && !knownPokedexIds.has(row.pokedexId)) warnings.push({ path: `${path}.pokedexId`, code: "unknown-pokedex-id" });
  }));
  Object.keys(backup.data.globalSettings.candyInventory.species).forEach((id) => {
    if (!knownPokedexIds.has(Number(id))) warnings.push({ path: `$.data.globalSettings.candyInventory.species.${id}`, code: "unknown-pokedex-id" });
  });
  return { backup, warnings };
}

export function stringifyBackup(backup: CandyBoostPlannerBackupV3): string {
  return JSON.stringify(backup, null, 2);
}
