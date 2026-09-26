import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/domain/pokesleep/_generated/**",
      "src/i18n/_generated/**",
    ],
  },

  // Base JS recommended
  eslint.configs.recommended,

  // TypeScript recommended (type-aware disabled — fast)
  ...tseslint.configs.recommended,

  // Vue recommended (uses vue-eslint-parser internally)
  ...pluginVue.configs["flat/recommended"],

  // Browser globals (window, document, navigator, etc.)
  {
    files: ["src/**/*.{ts,vue}", "tests/**/*.{ts,vue}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Operational Node.js scripts are production tooling. Keep no-undef and the
  // other recommended correctness rules enabled while tolerating source-data
  // regexes and whitespace that are intentionally copied verbatim.
  {
    files: ["scripts/**/*.{mjs,mts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: "module",
    },
    rules: {
      "no-useless-escape": "off",
      "no-irregular-whitespace": "off",
    },
  },

  // Vue files: use typescript parser for <script lang="ts">
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  // Project-specific rules
  {
    rules: {
      // Strict: no any allowed (all resolved)
      "@typescript-eslint/no-explicit-any": "error",

      // Unused vars: error, but allow _-prefixed
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Allow non-null assertions (common in Vue refs)
      "@typescript-eslint/no-non-null-assertion": "off",

      // Vue: disable opinionated formatting/ordering rules
      "vue/html-indent": "off",
      "vue/html-self-closing": "off",
      "vue/html-closing-bracket-spacing": "off",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/multiline-html-element-content-newline": "off",
      "vue/html-closing-bracket-newline": "off",
      "vue/first-attribute-linebreak": "off",
      "vue/multi-word-component-names": "off",
      "vue/attribute-hyphenation": "off",
      "vue/v-on-event-hyphenation": "off",
      "vue/require-default-prop": "off",
      "vue/require-prop-types": "off",
      "vue/attributes-order": "off",
      "vue/no-v-html": "off",
    },
  },

  // astronomy-engine は生成・正当性テスト専用。src の実行時コードへ再導入しない。
  {
    files: ["src/**/*.{ts,vue}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "astronomy-engine",
              message: "Runtime code must use the generated full-moon date table.",
            },
          ],
          // `paths` は完全一致しか見ないため、サブパス（astronomy-engine/esm/astronomy）が素通りする。
          patterns: [
            {
              group: ["astronomy-engine/*"],
              message: "Runtime code must use the generated full-moon date table.",
            },
          ],
        },
      ],
    },
  },
  // 古い端末でも動かすため、ビルドで変換されない実行時の新しい機能を使わない（vite.config.ts の build.target）。
  // 構文はビルドで古い形へ変換されるが、メソッドや組み込み関数は変換されず、無い端末では例外になる。
  // 使いたいときは対応開始の版を確かめ、備え（typeof による分岐など）を付けたうえで、その行だけ許可すること。
  {
    files: ["src/**/*.{ts,vue}"],
    ignores: ["src/**/*.test.ts", "src/**/__tests__/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "structuredClone", message: "iOS 15.4・Chrome 98 から。値に合わせて自前でコピーする。" },
        { name: "queueMicrotask", message: "iOS 12.2・Chrome 71 から。Promise.resolve().then を使う。" },
        { name: "AggregateError", message: "iOS 14・Chrome 85 から。継承すると読み込んだ時点で起動が止まる。Error を継承して errors を自前で持つ。" },
        { name: "WeakRef", message: "iOS 14.5・Chrome 84 から。" },
        { name: "FinalizationRegistry", message: "iOS 14.5・Chrome 84 から。" },
        { name: "globalThis", message: "iOS 12.2・Chrome 71 から。requestIdleCallback や crypto などの名前を直接参照する（typeof で有無を確かめる）。" },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Object", property: "hasOwn", message: "iOS 15.4・Chrome 93 から。Object.prototype.hasOwnProperty.call を使う。" },
        { object: "Promise", property: "allSettled", message: "iOS 13・Chrome 76 から。失敗を catch してから Promise.all で待つ。" },
        { object: "Promise", property: "any", message: "iOS 14・Chrome 85 から。" },
        { object: "Object", property: "fromEntries", message: "iOS 12.2・Chrome 73 から。entriesToObject（src/utils/entriesToObject.ts）を使う。" },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.property.name='at']", message: "Array/String の at は iOS 15.4・Chrome 92 から。lastOf（src/utils/lastOf.ts）か添字を使う。" },
        { selector: "CallExpression[callee.property.name='replaceAll']", message: "iOS 13.4・Chrome 85 から。g フラグ付きの正規表現で replace する。" },
        { selector: "CallExpression[callee.property.name=/^(findLast|findLastIndex|toSorted|toReversed|toSpliced)$/]", message: "iOS 15.4〜16・Chrome 97〜110 から。" },
        { selector: "CallExpression[callee.property.name='flatMap']", message: "iOS 12・Chrome 69 から。flatMapOf（src/utils/flatMapOf.ts）を使う。" },
        { selector: "CallExpression[callee.property.name='flat']", message: "iOS 12・Chrome 69 から。" },
        { selector: "CallExpression[callee.property.name=/^(matchAll|trimStart|trimEnd)$/]", message: "matchAll は iOS 13・Chrome 73、trimStart/trimEnd は iOS 12・Chrome 66 から。" },
      ],
    },
  },
  // 生成物を独立に照合する正当性テストだけはdevDependencyを直接使う。
  {
    files: ["src/domain/pokesleep/__tests__/lunar-calendar.test.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
