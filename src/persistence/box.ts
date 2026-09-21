import type {
  BoxCustomTag,
  BoxEntrySource,
  BoxSubSkillSlotV1,
  IngredientType,
  PokemonBoxEntryV1,
  PokemonSpecialty,
} from "../domain/types";
import { toExpGainNature, toExpType, toInt } from "./shared";
import { perfSpan } from "../utils/perf";

export const BOX_STORAGE_KEY = "candy-boost-planner:box:v1";
const SCHEMA_VERSION = 2 as const;

export const MAX_BOX_CUSTOM_TAGS = 30;
export const MAX_BOX_CUSTOM_TAG_NAME_LENGTH = 20;

type BoxStoreV2 = {
  schemaVersion: typeof SCHEMA_VERSION;
  entries: PokemonBoxEntryV1[];
  tags?: BoxCustomTag[];
};

export type LoadedBoxData = {
  entries: PokemonBoxEntryV1[];
  tags: BoxCustomTag[];
};

export function loadBox(): PokemonBoxEntryV1[] {
  return loadBoxData().entries;
}

export function loadBoxData(): LoadedBoxData {
  try {
    const raw = localStorage.getItem(BOX_STORAGE_KEY);
    if (!raw) return { entries: [], tags: [] };
    const json = JSON.parse(raw);
    // legacy: array of entries
    const arr = Array.isArray(json)
      ? json
      : json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).entries)
        ? (json as Record<string, unknown>).entries as unknown[]
        : null;
    if (!arr) return { entries: [], tags: [] };
    const tags = normalizeTags(
      !Array.isArray(json) && json && typeof json === "object"
        ? (json as Record<string, unknown>).tags
        : undefined,
    );
    const tagIds = new Set(tags.map((tag) => tag.id));
    // できるだけ壊れに強く（最低限の形だけ保証）
    const entries = arr
      .filter((x: unknown): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x) => normalizeEntry(x, tagIds))
      .slice(0, 300);
    return { entries, tags };
  } catch {
    return { entries: [], tags: [] };
  }
}

export function saveBox(entries: PokemonBoxEntryV1[], tags: BoxCustomTag[] = []) {
  try {
    const serialized = perfSpan("persist.box.serialize", () => serializeBox(entries, tags));
    perfSpan("persist.box.write", () => localStorage.setItem(BOX_STORAGE_KEY, serialized));
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}

export function serializeBox(entries: PokemonBoxEntryV1[], tags: BoxCustomTag[] = []): string {
  const v: BoxStoreV2 = { schemaVersion: SCHEMA_VERSION, entries, tags };
  return JSON.stringify(v);
}

function normalizeTags(value: unknown): BoxCustomTag[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const tags: BoxCustomTag[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string"
      ? row.name.trim().slice(0, MAX_BOX_CUSTOM_TAG_NAME_LENGTH)
      : "";
    const normalizedName = name.toLocaleLowerCase();
    if (!id || !name || seenIds.has(id) || seenNames.has(normalizedName)) continue;
    seenIds.add(id);
    seenNames.add(normalizedName);
    tags.push({ id, name });
    if (tags.length >= MAX_BOX_CUSTOM_TAGS) break;
  }
  return tags;
}

function normalizeEntry(x: Record<string, unknown>, validTagIds = new Set<string>()): PokemonBoxEntryV1 {
  const now = new Date().toISOString();
  const source: BoxEntrySource = x.source === "manual" ? "manual" : "nitoyon";

  const d = typeof x.derived === "object" && x.derived ? (x.derived as Record<string, unknown>) : null;
  const derived = d
    ? {
        pokedexId: toInt(d.pokedexId, 0),
        form: toInt(d.form, 0),
        level: toInt(d.level, 1),
        expType: toExpType(d.expType, 600),
        expGainNature: toExpGainNature(d.expGainNature, "normal"),
        natureName: typeof d.natureName === "string" ? d.natureName : "",
      }
    : undefined;

  const p = typeof x.planner === "object" && x.planner ? (x.planner as Record<string, unknown>) : null;
  const planner = p
    ? {
        level: p.level === undefined ? undefined : toInt(p.level, 1),
        expRemaining: p.expRemaining === undefined ? undefined : toInt(p.expRemaining, 0),
        sleepHours: p.sleepHours === undefined ? undefined : toInt(p.sleepHours, 0),
        expType: p.expType === undefined ? undefined : toExpType(p.expType, 600),
        expGainNature:
          p.expGainNature === undefined
            ? undefined
            : toExpGainNature(p.expGainNature, "normal"),
        specialty: p.specialty === undefined ? undefined : toSpecialty(p.specialty),
        ingredientType:
          p.ingredientType === undefined
            ? undefined
            : toIngredientType(p.ingredientType),
        subSkills:
          p.subSkills === undefined
            ? undefined
            : toSubSkills(p.subSkills),
      }
    : undefined;

  return {
    id: String(x.id ?? cryptoRandomId()),
    source,
    rawText: typeof x.rawText === "string" ? x.rawText : "",
    label: typeof x.label === "string" ? x.label : "",
    favorite: !!x.favorite,
    tagIds: Array.isArray(x.tagIds)
      ? [...new Set(x.tagIds.filter((id): id is string => typeof id === "string" && validTagIds.has(id)))]
      : undefined,
    derived,
    planner,
    createdAt: typeof x.createdAt === "string" ? x.createdAt : now,
    updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : now,
  };
}

function toSpecialty(v: unknown): PokemonSpecialty | undefined {
  const s = typeof v === "string" ? v : String(v ?? "");
  if (s === "Berries" || s === "Ingredients" || s === "Skills" || s === "All" || s === "unknown") return s;
  return undefined;
}

function toIngredientType(v: unknown): IngredientType | undefined {
  const s = typeof v === "string" ? v : String(v ?? "");
  if (s === "AAA" || s === "AAB" || s === "AAC" || s === "ABA" || s === "ABB" || s === "ABC") return s;
  return undefined;
}

export function toSubSkills(v: unknown): BoxSubSkillSlotV1[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: BoxSubSkillSlotV1[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const lv = Number(r.lv);
    const nameEn = String(r.nameEn ?? "").trim();
    if (!nameEn) continue;
    const migrated = lv === 75 ? 70 : lv === 100 ? 80 : lv;
    if (migrated !== 10 && migrated !== 25 && migrated !== 50 && migrated !== 70 && migrated !== 80) continue;
    out.push({ lv: migrated as 10 | 25 | 50 | 70 | 80, nameEn });
  }
  return out.length ? out : undefined;
}

export function cryptoRandomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
