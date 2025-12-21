<template>
  <header class="hero">
    <div>
      <p class="kicker">{{ t("app.kicker") }}</p>
      <h1 class="title">{{ t("app.title") }}</h1>
      <p class="lede">
        {{ t("app.lede") }}
      </p>
      <div class="lang">
        <button class="lang__btn" type="button" :class="{ 'lang__btn--on': locale === 'ja' }" @click="setLocale('ja')">JP</button>
        <button class="lang__btn" type="button" :class="{ 'lang__btn--on': locale === 'en' }" @click="setLocale('en')">EN</button>
      </div>
    </div>
    <div class="support" v-if="supportLinks.length">
      <p class="support__label">{{ t("common.support") }}</p>
      <div class="support__links">
        <a
          v-for="l in supportLinks"
          :key="l.id"
          class="support__link"
          :href="l.href"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="l.ariaLabel"
        >
          {{ l.label }}
        </a>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

export type SupportLink = { id: "ofuse" | "bmac"; label: string; href: string; ariaLabel: string };

defineProps<{
  locale: "ja" | "en";
  supportLinks: SupportLink[];
  setLocale: (next: "ja" | "en") => void;
}>();

const { t } = useI18n();
</script>
