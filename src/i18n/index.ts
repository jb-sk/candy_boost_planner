import { createI18n } from "vue-i18n";
import { ja } from "./ja";

export type AppLocale = "ja" | "en";

type AppMessages = Record<string, unknown>;

const messageLoaders: Record<AppLocale, () => Promise<AppMessages>> = {
  ja: async () => ja,
  en: async () => (await import("./en")).en,
};

export function normalizeLocale(x: unknown): AppLocale {
  return x === "en" ? "en" : "ja";
}

export function createAppI18n(locale: AppLocale) {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: "ja",
    messages: { ja },
  });
}

export async function ensureLocaleMessagesLoaded(
  i18n:
    | ReturnType<typeof createAppI18n>
    | {
        availableLocales: string[];
        setLocaleMessage: (locale: string, message: AppMessages) => void;
      },
  locale: AppLocale,
): Promise<void> {
  // createI18n は初期投入した ja のリテラル構造へ Composer を狭めるが、この関数は
  // en を後から追加する境界。ここだけ実際に使う遅延ロード用インターフェースへ戻す。
  const composer = ("global" in i18n ? i18n.global : i18n) as unknown as {
    availableLocales: readonly string[];
    setLocaleMessage: (locale: AppLocale, message: AppMessages) => void;
  };
  const requiredLocales: AppLocale[] = locale === "ja" ? ["ja"] : ["ja", locale];

  await Promise.all(requiredLocales.map(async (targetLocale) => {
    if (composer.availableLocales.includes(targetLocale)) return;
    const messages = await messageLoaders[targetLocale]();
    composer.setLocaleMessage(targetLocale, messages);
  }));
}
