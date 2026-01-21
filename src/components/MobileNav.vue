<template>
  <nav class="mobileNav">
    <a href="#neo-calc" class="mobileNav__item" @click.prevent="scrollToPanel('neo-calc')">
      {{ t("nav.calc") }}
    </a>
    <a href="#neo-box" class="mobileNav__item" @click.prevent="scrollToPanel('neo-box')">
      {{ t("nav.box") }}
    </a>
    <a href="#" class="mobileNav__item" @click.prevent="$emit('open-settings')">
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
}>();

const { t } = useI18n();
</script>

<style scoped>
.mobileNav {
  display: none;
}
@media (max-width: 1023px) {
  .mobileNav {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 100;
    background: color-mix(in oklab, var(--paper) 95%, var(--ink) 5%);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid color-mix(in oklab, var(--ink) 10%, transparent);
    margin: 0 -18px 16px; /* Negate shell padding */
    padding: 0 18px;
  }
  .mobileNav__item {
    flex: 1;
    text-align: center;
    padding: 6px 0;
    font-weight: 700;
    font-size: 14px;
    color: color-mix(in oklab, var(--ink) 75%, transparent);
    border-bottom: 3px solid transparent;
    cursor: pointer;
    text-decoration: none;
  }
  .mobileNav__item:hover {
    background: rgba(0,0,0,0.02);
    color: var(--ink);
  }
}
</style>
