import type {
  BoxEntrySource,
  BoxSubSkillSlotV1,
  ExpGainNature,
  ExpType,
  IngredientType,
  PokemonBoxEntryV1,
  PokemonSpecialty,
} from "../domain/types";

const STORAGE_KEY = "candy-boost-planner:box:v1";
const SCHEMA_VERSION = 1 as const;

type BoxStoreV1 = {
  schemaVersion: typeof SCHEMA_VERSION;
  entries: PokemonBoxEntryV1[];
};

export function loadBox(): PokemonBoxEntryV1[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const json = JSON.parse(raw);
    // legacy: array of entries
    const arr = Array.isArray(json)
      ? json
      : json && typeof json === "object" && Array.isArray((json as any).entries)
        ? (json as any).entries
        : null;
    if (!arr) return [];
    // できるだけ壊れに強く（最低限の形だけ保証）
    return arr
      .filter((x: any) => x && typeof x === "object")
      .map((x: any) => normalizeEntry(x))
      .slice(0, 300);
  } catch {
    return [];
  }
}

export function saveBox(entries: PokemonBoxEntryV1[]) {
  const v: BoxStoreV1 = { schemaVersion: SCHEMA_VERSION, entries };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

function normalizeEntry(x: any): PokemonBoxEntryV1 {
  const now = new Date().toISOString();
  const source: BoxEntrySource = x.source === "manual" ? "manual" : "nitoyon";

  const derived =
    typeof x.derived === "object" && x.derived
      ? {
          pokedexId: toInt(x.derived.pokedexId, 0),
          form: toInt(x.derived.form, 0),
          level: toInt(x.derived.level, 1),
          expType: toExpType(x.derived.expType, 600),
          expGainNature: toExpGainNature(x.derived.expGainNature, "normal"),
          natureName: typeof x.derived.natureName === "string" ? x.derived.natureName : "",
        }
      : undefined;

  const planner =
    typeof x.planner === "object" && x.planner
      ? {
          level: x.planner.level === undefined ? undefined : toInt(x.planner.level, 1),
          expRemaining: x.planner.expRemaining === undefined ? undefined : toInt(x.planner.expRemaining, 0),
          expType: x.planner.expType === undefined ? undefined : toExpType(x.planner.expType, 600),
          expGainNature:
            x.planner.expGainNature === undefined
              ? undefined
              : toExpGainNature(x.planner.expGainNature, "normal"),
          specialty: x.planner.specialty === undefined ? undefined : toSpecialty(x.planner.specialty),
          ingredientType:
            x.planner.ingredientType === undefined
              ? undefined
              : toIngredientType(x.planner.ingredientType),
          subSkills:
            x.planner.subSkills === undefined
              ? undefined
              : toSubSkills(x.planner.subSkills),
        }
      : undefined;

  return {
    id: String(x.id ?? cryptoRandomId()),
    source,
    rawText: typeof x.rawText === "string" ? x.rawText : "",
    label: typeof x.label === "string" ? x.label : "",
    favorite: !!x.favorite,
    derived,
    planner,
    createdAt: typeof x.createdAt === "string" ? x.createdAt : now,
    updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : now,
  };
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function toExpType(v: unknown, fallback: ExpType): ExpType {
  const n = toInt(v, fallback);
  if (n === 600 || n === 900 || n === 1080 || n === 1320) return n;
  return fallback;
}

function toExpGainNature(v: unknown, fallback: ExpGainNature): ExpGainNature {
  const s = typeof v === "string" ? v : String(v ?? "");
  if (s === "up" || s === "down" || s === "normal") return s;
  return fallback;
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

function toSubSkills(v: unknown): BoxSubSkillSlotV1[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: BoxSubSkillSlotV1[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const lv = Number((x as any).lv);
    const nameEn = String((x as any).nameEn ?? "").trim();
    if (!nameEn) continue;
    if (lv !== 10 && lv !== 25 && lv !== 50 && lv !== 75 && lv !== 100) continue;
    out.push({ lv: lv as any, nameEn });
  }
  return out.length ? out : undefined;
}

export function cryptoRandomId(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
