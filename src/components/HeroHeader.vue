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
        <button class="lang__btn lang__btn--help" type="button" @click="openHelp">{{ locale === 'ja' ? '使い方' : 'Help' }}</button>
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
  openHelp: () => void;
}>();

const { t } = useI18n();
</script>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 18px;
  align-items: start;
  margin-top: 16px;
  margin-bottom: 12px;
}
.kicker {
  font-family: var(--font-body);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 12px;
  color: color-mix(in oklab, var(--ink) 55%, transparent);
}
.title {
  font-family: var(--font-heading);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.05;
  font-size: clamp(34px, 5vw, 56px);
  margin: 10px 0 10px;
}
.lede {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.7;
  color: color-mix(in oklab, var(--ink) 72%, transparent);
  max-width: min(74ch, 100%);
}
.lang {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.lang__btn {
  appearance: none;
  font: inherit;
  cursor: pointer;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 94%, var(--ink) 6%);
  color: color-mix(in oklab, var(--ink) 70%, transparent);
  letter-spacing: 0.08em;
  font-size: 12px;
}
.lang__btn:hover {
  border-color: color-mix(in oklab, var(--ink) 22%, transparent);
}
.lang__btn--on {
  background: color-mix(in oklab, var(--accent-warm) 20%, var(--paper) 80%);
  color: color-mix(in oklab, var(--ink) 90%, transparent);
  box-shadow: 0 10px 22px color-mix(in oklab, var(--accent-warm) 12%, transparent);
}

.lang__help {
  appearance: none;
  font-family: var(--font-heading);
  font-weight: 700;
  cursor: pointer;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 94%, var(--ink) 6%);
  color: color-mix(in oklab, var(--ink) 70%, transparent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  font-size: 14px;
  line-height: 1;
}
.lang__help:hover {
  border-color: color-mix(in oklab, var(--ink) 22%, transparent);
  color: var(--accent);
  background: var(--paper);
}

.support {
  display: grid;
  justify-items: end;
  gap: 8px;
}
.support__label {
  margin: 0;
  font-family: var(--font-body);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 11px;
  color: color-mix(in oklab, var(--ink) 55%, transparent);
}
.support__links {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.support__link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  font: inherit;
  cursor: pointer;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--ink) 14%, transparent);
  background: color-mix(in oklab, var(--paper) 94%, var(--ink) 6%);
  color: color-mix(in oklab, var(--ink) 72%, transparent);
  font-size: 12px;
}
.support__link:hover {
  border-color: color-mix(in oklab, var(--ink) 22%, transparent);
  color: color-mix(in oklab, var(--ink) 86%, transparent);
}
.support__link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 18%, transparent);
}

@media (max-width: 560px) {
  .hero {
    grid-template-columns: 1fr; /* stack support under title */
    gap: 14px;
  }
  .support {
    justify-items: start;
  }
  .support__links {
    justify-content: flex-start;
    max-width: 100%;
  }
  .support__link {
    font-size: 11px;
    padding: 6px 9px;
    max-width: 100%;
    white-space: normal; /* allow wrap instead of overflowing */
  }
}
</style>
