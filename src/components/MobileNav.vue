<template>
  <nav class="mobileNav">
    <button
      class="mobileNav__home"
      type="button"
      :aria-label="t('nav.top')"
      @click="$emit('scroll-top')"
    >
      <!-- Home icon (SVG) -->
      <svg class="mobileNav__homeIcon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2.5 L2 9.5 L4 9.5 L4 16 L8 16 L8 11 L12 11 L12 16 L16 16 L16 9.5 L18 9.5 Z" />
      </svg>
    </button>
    <a href="#neo-calc" class="mobileNav__item" @click.prevent="scrollToPanel('neo-calc')">
      {{ t("nav.calc") }}
    </a>
    <a href="#neo-box" class="mobileNav__item" @click.prevent="scrollToPanel('neo-box')">
      {{ t("nav.box") }}
    </a>
    <a href="#" class="mobileNav__item" data-testid="settings-open-button-mobile" @click.prevent="$emit('open-settings')">
      {{ t("common.settings") }}
    </a>
  </nav>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  scrollToPanel: (id: string) => void;
}>();

defineEmits<{
  (e: "open-settings"): void;
  (e: "scroll-top"): void;
}>();

const { t } = useI18n();
</script>
