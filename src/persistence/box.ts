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
      : json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).entries)
        ? (json as Record<string, unknown>).entries as unknown[]
        : null;
    if (!arr) return [];
    // できるだけ壊れに強く（最低限の形だけ保証）
    return arr
      .filter((x: unknown): x is Record<string, unknown> => x != null && typeof x === "object")
      .map((x) => normalizeEntry(x))
      .slice(0, 300);
  } catch {
    return [];
  }
}

export function saveBox(entries: PokemonBoxEntryV1[]) {
  try {
    const v: BoxStoreV1 = { schemaVersion: SCHEMA_VERSION, entries };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // localStorage can throw (quota exceeded / blocked). Persistence must not break UI.
  }
}

function normalizeEntry(x: Record<string, unknown>): PokemonBoxEntryV1 {
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
    const r = x as Record<string, unknown>;
    const lv = Number(r.lv);
    const nameEn = String(r.nameEn ?? "").trim();
    if (!nameEn) continue;
    if (lv !== 10 && lv !== 25 && lv !== 50 && lv !== 75 && lv !== 100) continue;
    out.push({ lv: lv as 10 | 25 | 50 | 75 | 100, nameEn });
  }
  return out.length ? out : undefined;
}

export function cryptoRandomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
