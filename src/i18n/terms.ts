import { termJaToEn } from "./_generated/terms";
import type { AppLocale } from "./index";

export function translateTermJaToEn(ja: string): string | null {
  const key = String(ja ?? "").trim();
  if (!key) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = (termJaToEn as any)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function localizeGameTerm(ja: string, locale: AppLocale): string {
  if (locale !== "en") return ja;
  return translateTermJaToEn(ja) ?? ja;
}
