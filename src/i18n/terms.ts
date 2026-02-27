import { termJaToEn } from "./_generated/terms";
import type { AppLocale } from "./index";

// Manual overrides for app UI terms that are not present in the upstream glossary.
// Keep this in non-generated code so it won't be overwritten by scripts.
const manualJaToEn: Record<string, string> = {
  "スキル": "Skills",
  "オール": "All",
};

const manualEnToJa: Record<string, string> = {
  "skills": "スキル",
  "all": "オール",
};

export function translateTermJaToEn(ja: string): string | null {
  const key = String(ja ?? "").trim();
  if (!key) return null;
  if (manualJaToEn[key]) return manualJaToEn[key];
  const v = (termJaToEn as Record<string, string>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const termEnToJa = (() => {
  const m = new Map<string, string>();
  for (const [ja, en] of Object.entries(termJaToEn)) {
    if (typeof en === "string") m.set(en.toLowerCase(), ja);
  }
  return m;
})();

export function translateTermEnToJa(en: string): string | null {
  const key = String(en ?? "").trim().toLowerCase();
  if (!key) return null;
  if (manualEnToJa[key]) return manualEnToJa[key];
  return termEnToJa.get(key) ?? null;
}

export function localizeGameTerm(ja: string, locale: AppLocale): string {
  if (locale !== "en") return ja;
  return translateTermJaToEn(ja) ?? ja;
}

export function localizeNature(en: string, locale: AppLocale): string {
  if (locale === "ja") {
    return translateTermEnToJa(en) ?? en;
  }
  return en;
}
