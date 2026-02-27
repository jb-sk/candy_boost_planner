/// <reference types="vite/client" />

// vue-i18n: Locale 型を "ja" | "en" に絞る
// https://vue-i18n.intlify.dev/guide/advanced/typescript.html
declare module "@intlify/core-base" {
  interface GeneratedTypeConfig {
    locale: "ja" | "en";
  }
}
