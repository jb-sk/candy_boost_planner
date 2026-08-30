import { MAX_GROWTH_INCENSE_STOCK, normalizeBlueSeedIncenseDays, normalizeBlueSeedPlantWeekday, normalizeUseProjectedEvents, type BoxSubSkillSlotV1, type IngredientType, type ManualEventBonus, type PokemonSpecialty, type SleepSettings } from "../domain/types";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { maxTargetExpInLevel } from "../domain/level-planner/deriveTarget";
import { pokemonMaster } from "../domain/pokesleep/pokemon-master";
import { PokemonTypes } from "../domain/pokesleep/pokemon-types";
import { DEFAULT_SLEEP_SETTINGS, migrateLegacyPeakCandyTarget, SLEEP_TARGET_HOURS_OPTIONS, type CalcRowV1, type CalcSaveSlotV1 } from "../persistence/calc";
import { compareGameDates, normalizeGameDate, normalizeTimeZone } from "../domain/pokesleep/game-date";
import {
  DEFAULT_GROWTH_INCENSE_GSD_DAYS,
  migrateGrowthIncenseGsdPolicy,
  normalizeGrowthIncenseGsdDays,
} from "../domain/pokesleep/growth-incense";
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
  type BackupMigrationNotice,
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
const sleepTargetModes = new Set<"all" | "stock">(["all", "stock"]);
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

function backupTimeZone(value: unknown, path: string): string {
  if (value === undefined) return DEFAULT_SLEEP_SETTINGS.timeZone;
  const normalized = normalizeTimeZone(value);
  if (!normalized) fail(path, "valid IANA time zone is required");
  return normalized;
}

function backupGrowthIncenseGsdDays(
  value: unknown,
  legacyPolicy: unknown,
  path: string,
): SleepSettings["growthIncenseGsdDays"] {
  if (value !== undefined) {
    const normalized = normalizeGrowthIncenseGsdDays(value);
    if (!normalized) fail(path, "three boolean day flags are required");
    return normalized;
  }
  if (legacyPolicy !== undefined) {
    const migrated = migrateGrowthIncenseGsdPolicy(legacyPolicy);
    if (!migrated) fail(path.replace(/growthIncenseGsdDays$/, "growthIncenseGsdPolicy"), "unsupported value");
    return migrated;
  }
  return { ...DEFAULT_GROWTH_INCENSE_GSD_DAYS };
}

function backupGrowthIncenseNormalPerWeek(value: unknown, path: string): SleepSettings["growthIncenseNormalPerWeek"] {
  if (value === undefined) return 0;
  return numberAt(value, path, 0, 7) as SleepSettings["growthIncenseNormalPerWeek"];
}

/** 手持ちのお香。未設定と `null` はどちらも無制限。 */
function backupGrowthIncenseStock(value: unknown, path: string): SleepSettings["growthIncenseStock"] {
  if (value === undefined || value === null) return null;
  return numberAt(value, path, 0, MAX_GROWTH_INCENSE_STOCK);
}

function backupUseProjectedEvents(value: unknown, path: string): SleepSettings["useProjectedEvents"] {
  if (value === undefined) return DEFAULT_SLEEP_SETTINGS.useProjectedEvents;
  const normalized = normalizeUseProjectedEvents(value);
  if (normalized === undefined) fail(path, "unsupported value");
  return normalized;
}

function backupBlueSeedPlantWeekday(value: unknown, path: string): SleepSettings["blueSeedPlantWeekday"] {
  if (value === undefined) return DEFAULT_SLEEP_SETTINGS.blueSeedPlantWeekday;
  const normalized = normalizeBlueSeedPlantWeekday(value);
  if (normalized === undefined) fail(path, "unsupported value");
  return normalized;
}

function backupBlueSeedIncenseDays(value: unknown, path: string): SleepSettings["blueSeedIncenseDays"] {
  if (value === undefined) return DEFAULT_SLEEP_SETTINGS.blueSeedIncenseDays;
  const normalized = normalizeBlueSeedIncenseDays(value);
  if (normalized === undefined) fail(path, "unsupported value");
  return normalized;
}

function backupManualEventBonuses(
  value: unknown,
  path: string,
): ManualEventBonus[] {
  // schemaVersion 3 は manualEventBonuses の公開前から使われていたため、
  // 現行版番号でも項目が無いバックアップを旧形式として受け入れる。
  if (value === undefined) return [];
  const rows = arrayAt(value, path);
  if (rows.length > 10) fail(path, "maximum is 10");
  return rows.map((item, index) => {
    const rowPath = `${path}[${index}]`;
    const row = objectAt(item, rowPath);
    const from = normalizeGameDate(row.from);
    const to = normalizeGameDate(row.to);
    if (!from) fail(`${rowPath}.from`, "valid game date is required");
    if (!to) fail(`${rowPath}.to`, "valid game date is required");
    if (compareGameDates(from, to) > 0) fail(rowPath, "from must not be after to");
    return {
      from,
      to,
      multiplier: numberAt(row.multiplier, `${rowPath}.multiplier`, Number.MIN_VALUE, 10, false),
    };
  });
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

function validateRow(value: unknown, path: string, sourceSchemaVersion: 1 | 2 | 3): CalcRowV1 {
  const row = objectAt(value, path);
  const srcLevel = numberAt(row.srcLevel, `${path}.srcLevel`, 1, MAX_LEVEL);
  const dstLevel = numberAt(row.dstLevel, `${path}.dstLevel`, srcLevel, MAX_LEVEL);
  const expType = enumAt(row.expType, `${path}.expType`, expTypes) as 600 | 900 | 1080 | 1320;
  const sleepTargetMode = row.sleepTargetMode === undefined
    ? undefined
    : enumAt(row.sleepTargetMode, `${path}.sleepTargetMode`, sleepTargetModes);
  // 旧 mode:"peak" 行は candyTarget へ移行する（設計書§6.1）。
  // mode / candyPeak / boostRatioPct は V3 で廃止したため、あっても読み捨てる。
  const candyTarget = sleepTargetMode !== undefined
    ? undefined
    : optionalNumber(row.candyTarget, `${path}.candyTarget`, 0) ?? migrateLegacyPeakCandyTarget(row);
  // 不変条件（設計書§4.3 / §10改訂A）。バックアップは正規化せず、違反を拒否する。
  const dstExpInLevel = sleepTargetMode !== undefined || row.dstExpInLevel === undefined
    ? undefined
    : numberAt(row.dstExpInLevel, `${path}.dstExpInLevel`, 0, maxTargetExpInLevel(dstLevel, expType));
  // V2 以前は導出値と手入力値を保存値から区別できない（旧仕様では自動最大化が既定で、
  // 値の大半は自動値）。復元して明示入力として扱うと §11.4 の非可逆が復活するため落とす。
  const storedBoostOrExpAdjustment = sourceSchemaVersion >= 3
    ? optionalNumber(row.boostOrExpAdjustment, `${path}.boostOrExpAdjustment`, 0)
    : undefined;
  const boostOrExpAdjustment = storedBoostOrExpAdjustment === undefined
    ? undefined
    : candyTarget === undefined
      ? storedBoostOrExpAdjustment
      : Math.min(storedBoostOrExpAdjustment, candyTarget);
  if (candyTarget === undefined && boostOrExpAdjustment === undefined && dstExpInLevel !== undefined && dstExpInLevel > 0) {
    fail(`${path}.dstExpInLevel`, "must be 0 without a candy-count anchor");
  }
  return {
    id: stringAt(row.id, `${path}.id`, false),
    boxId: optionalString(row.boxId, `${path}.boxId`),
    pokedexId: optionalNumber(row.pokedexId, `${path}.pokedexId`, 1),
    pokemonType: row.pokemonType === undefined ? undefined : enumAt(row.pokemonType, `${path}.pokemonType`, pokemonTypes),
    title: stringAt(row.title, `${path}.title`),
    srcLevel,
    dstLevel,
    dstExpInLevel,
    dstLevelText: row.dstLevelText === undefined ? undefined : stringAt(row.dstLevelText, `${path}.dstLevelText`),
    expRemaining: numberAt(row.expRemaining, `${path}.expRemaining`, 0, 999999),
    expType,
    nature: enumAt(row.nature, `${path}.nature`, natures) as "down" | "normal" | "up",
    boostReachLevel: numberAt(row.boostReachLevel, `${path}.boostReachLevel`, srcLevel, MAX_LEVEL),
    boostOrExpAdjustment,
    candyTarget,
    sleepHours: optionalNumber(row.sleepHours, `${path}.sleepHours`, 0),
    sleepTargetHours: sleepTargetMode !== undefined || row.sleepTargetHours === undefined
      ? undefined
      : enumAt(row.sleepTargetHours, `${path}.sleepTargetHours`, sleepTargetHoursValues),
    sleepTargetMode,
  };
}

function validateSlot(value: unknown, path: string, sourceSchemaVersion: 1 | 2 | 3): CalcSaveSlotV1 | null {
  if (value === null) return null;
  const slot = objectAt(value, path);
  const rawRows = arrayAt(slot.rows, `${path}.rows`);
  if (rawRows.length > BACKUP_MAX_ROWS_PER_SLOT) fail(`${path}.rows`, `maximum is ${BACKUP_MAX_ROWS_PER_SLOT}`);
  const rows = rawRows.map((row, index) => validateRow(row, `${path}.rows[${index}]`, sourceSchemaVersion));
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

/**
 * 既定のアメブ目標Lv。V3 で追加した項目。
 *
 * **省略を許すのは旧形式（V2 以前）だけ。** 現行形式は必ず書き出すので、
 * 欠けているなら壊れた入力であり、黙って未設定へ寄せると原因が見えなくなる。
 */
function validateDefaultBoostReachLevel(value: unknown, sourceSchemaVersion: 1 | 2 | 3): number | null {
  const path = "$.data.globalSettings.defaultBoostReachLevel";
  if (value === undefined || value === null) {
    if (sourceSchemaVersion >= BACKUP_SCHEMA_VERSION && value === undefined) {
      fail(path, "is required");
    }
    return null;
  }
  return numberAt(value, path, 1, MAX_LEVEL);
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
  if (
    root.schemaVersion !== 1
    && root.schemaVersion !== 2
    && root.schemaVersion !== BACKUP_SCHEMA_VERSION
  ) {
    fail("$.schemaVersion", "schema version is not supported");
  }
  const sourceSchemaVersion = root.schemaVersion as 1 | 2 | 3;
  // candyInventory 自体のスキーマは V2 のまま（V3 の変更対象は計算機行とグローバル設定）。
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
  const slots = rawSlots.map((slot, index) => validateSlot(slot, `$.data.calculator.slots[${index}]`, sourceSchemaVersion)) as [CalcSaveSlotV1 | null, CalcSaveSlotV1 | null, CalcSaveSlotV1 | null];
  let legacyBoostValueCount = 0;
  if (sourceSchemaVersion < 3) {
    rawSlots.forEach((slot, slotIndex) => {
      if (slot === null) return;
      const rawSlot = objectAt(slot, `$.data.calculator.slots[${slotIndex}]`);
      const rawRows = arrayAt(rawSlot.rows, `$.data.calculator.slots[${slotIndex}].rows`);
      rawRows.forEach((row, rowIndex) => {
        const rawRow = objectAt(row, `$.data.calculator.slots[${slotIndex}].rows[${rowIndex}]`);
        if (typeof rawRow.boostOrExpAdjustment === "number" && rawRow.boostOrExpAdjustment > 0) {
          legacyBoostValueCount++;
        }
      });
    });
  }
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
        defaultBoostReachLevel: validateDefaultBoostReachLevel(globals.defaultBoostReachLevel, sourceSchemaVersion),
        totalShards: numberAt(globals.totalShards, "$.data.globalSettings.totalShards", 0),
        sleepSettings: {
          dailySleepHours: numberAt(sleep.dailySleepHours, "$.data.globalSettings.sleepSettings.dailySleepHours", 1, 13, false),
          sleepExpBonusCount: numberAt(sleep.sleepExpBonusCount, "$.data.globalSettings.sleepSettings.sleepExpBonusCount", 0, 5),
          includeGSD: booleanAt(sleep.includeGSD, "$.data.globalSettings.sleepSettings.includeGSD"),
          timeZone: backupTimeZone(sleep.timeZone, "$.data.globalSettings.sleepSettings.timeZone"),
          growthIncenseGsdDays: backupGrowthIncenseGsdDays(
            sleep.growthIncenseGsdDays,
            sleep.growthIncenseGsdPolicy,
            "$.data.globalSettings.sleepSettings.growthIncenseGsdDays",
          ),
          growthIncenseNormalPerWeek: backupGrowthIncenseNormalPerWeek(sleep.growthIncenseNormalPerWeek, "$.data.globalSettings.sleepSettings.growthIncenseNormalPerWeek"),
          growthIncenseStock: backupGrowthIncenseStock(sleep.growthIncenseStock, "$.data.globalSettings.sleepSettings.growthIncenseStock"),
          manualEventBonuses: backupManualEventBonuses(
            sleep.manualEventBonuses,
            "$.data.globalSettings.sleepSettings.manualEventBonuses",
          ),
          useProjectedEvents: backupUseProjectedEvents(
            sleep.useProjectedEvents,
            "$.data.globalSettings.sleepSettings.useProjectedEvents",
          ),
          blueSeedPlantWeekday: backupBlueSeedPlantWeekday(
            sleep.blueSeedPlantWeekday,
            "$.data.globalSettings.sleepSettings.blueSeedPlantWeekday",
          ),
          blueSeedIncenseDays: backupBlueSeedIncenseDays(
            sleep.blueSeedIncenseDays,
            "$.data.globalSettings.sleepSettings.blueSeedIncenseDays",
          ),
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
  const migrationNotices: BackupMigrationNotice[] = legacyBoostValueCount > 0
    ? [{ code: "legacy-boost-values-rederived", affectedRowCount: legacyBoostValueCount }]
    : [];
  return { backup, warnings, migrationNotices };
}

export function stringifyBackup(backup: CandyBoostPlannerBackupV3): string {
  return JSON.stringify(backup, null, 2);
}
