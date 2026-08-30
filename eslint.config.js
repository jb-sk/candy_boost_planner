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
  // 生成物を独立に照合する正当性テストだけはdevDependencyを直接使う。
  {
    files: ["src/domain/pokesleep/__tests__/lunar-calendar.test.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
);
