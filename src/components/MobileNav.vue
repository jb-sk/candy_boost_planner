<template>
  <nav class="mobileNav">
    <a href="#neo-calc" class="mobileNav__item" @click.prevent="scrollToPanel('neo-calc')">
      {{ t("nav.calc") }}
    </a>
    <a href="#neo-box" class="mobileNav__item" @click.prevent="scrollToPanel('neo-box')">
      {{ t("nav.box") }}
    </a>
  </nav>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";

defineProps<{
  scrollToPanel: (id: string) => void;
}>();

const { t } = useI18n();
</script>
