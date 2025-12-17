import { createI18n } from "vue-i18n";
import { en } from "./en";
import { ja } from "./ja";

export type AppLocale = "ja" | "en";

export const messages = { ja, en } as const;

export function normalizeLocale(x: unknown): AppLocale {
  return x === "en" ? "en" : "ja";
}

export function createAppI18n(locale: AppLocale) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: "ja",
    messages,
  });
}
