<template>
  <nav class="mobileNav">
    <button
      class="mobileNav__utility mobileNav__home"
      type="button"
      :aria-label="t('nav.top')"
      @click="$emit('scroll-top')"
    >
      <!-- Home icon (SVG) -->
      <svg class="mobileNav__homeIcon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2.5 L2 9.5 L4 9.5 L4 16 L8 16 L8 11 L12 11 L12 16 L16 16 L16 9.5 L18 9.5 Z" />
      </svg>
    </button>
    <div class="mobileNav__panelTabs" role="tablist" :aria-label="t('nav.panels')">
      <button
        id="mobile-panel-tab-calc"
        ref="calcTab"
        class="mobileNav__item"
        data-testid="mobile-nav-calc"
        :class="{ 'mobileNav__item--active': activePanel === 'calc' }"
        type="button"
        role="tab"
        aria-controls="neo-calc"
        :aria-selected="activePanel === 'calc'"
        :tabindex="activePanel === 'calc' ? 0 : -1"
        @click="emit('select-panel', 'calc')"
        @keydown="onKeydown($event, 'calc')"
      >
        {{ t("nav.calc") }}
      </button>
      <button
        id="mobile-panel-tab-box"
        ref="boxTab"
        class="mobileNav__item"
        data-testid="mobile-nav-box"
        :class="{ 'mobileNav__item--active': activePanel === 'box' }"
        type="button"
        role="tab"
        aria-controls="neo-box"
        :aria-selected="activePanel === 'box'"
        :tabindex="activePanel === 'box' ? 0 : -1"
        @click="emit('select-panel', 'box')"
        @keydown="onKeydown($event, 'box')"
      >
        {{ t("nav.box") }}
      </button>
    </div>
    <button
      class="mobileNav__utility"
      type="button"
      data-testid="settings-open-button-mobile"
      :aria-label="t('common.settings')"
      @click="$emit('open-settings')"
    >
      <svg class="mobileNav__utilityIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path d="M4 6h10m4 0h2M4 12h2m4 0h10M4 18h8m4 0h4" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="8" cy="12" r="2" />
        <circle cx="14" cy="18" r="2" />
      </svg>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";

type PanelId = 'calc' | 'box';

defineProps<{
  activePanel: PanelId;
}>();

const emit = defineEmits<{
  (e: "open-settings"): void;
  (e: "scroll-top"): void;
  (e: "select-panel", panel: PanelId): void;
}>();

const { t } = useI18n();
const calcTab = ref<HTMLButtonElement | null>(null);
const boxTab = ref<HTMLButtonElement | null>(null);

function onKeydown(event: KeyboardEvent, current: PanelId): void {
  let next: PanelId | null = null;
  if (
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight" ||
    event.key === "ArrowUp" ||
    event.key === "ArrowDown"
  ) {
    next = current === "calc" ? "box" : "calc";
  } else if (event.key === "Home") {
    next = "calc";
  } else if (event.key === "End") {
    next = "box";
  }
  if (!next) return;

  event.preventDefault();
  emit("select-panel", next);
  (next === "calc" ? calcTab.value : boxTab.value)?.focus();
}
</script>
