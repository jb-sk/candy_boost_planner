import { eventNameJaToEn, eventNameJaToEnByPeriod } from "./_generated/event-name-en";
import type { AppLocale } from "./index";

export function localizeEventName(ja: string, locale: AppLocale, from?: string): string {
  if (locale !== "en") return ja;
  if (from) {
    const byPeriod = eventNameJaToEnByPeriod[`${ja}@${from}`];
    if (typeof byPeriod === "string" && byPeriod.trim()) return byPeriod;
  }
  const translated = eventNameJaToEn[ja];
  return typeof translated === "string" && translated.trim() ? translated : ja;
}
