<template>
  <div class="natureSelect" :class="{ 'natureSelect--open': isOpen }">
    <button
      type="button"
      class="natureSelect__trigger field__input"
      @click="toggle"
      @blur="handleBlur"
      :aria-label="label"
    >
      <span class="natureSelect__symbol" v-html="symbolSvg(modelValue)" aria-hidden="true"></span>
      <span class="natureSelect__sr">{{ currentLabel }}</span>
      <svg class="natureSelect__chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div v-if="isOpen" class="natureSelect__dropdown">
      <button
        type="button"
        v-for="option in options"
        :key="option.value"
        class="natureSelect__option"
        :class="{ 'natureSelect__option--selected': option.value === modelValue }"
        @mousedown.prevent="select(option.value)"
      >
        <span class="natureSelect__symbol" v-html="symbolSvg(option.value)" aria-hidden="true"></span>
        <span class="natureSelect__sr">{{ option.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  modelValue: 'normal' | 'up' | 'down';
  label: string;
  labelNormal: string;
  labelUp: string;
  labelDown: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: 'normal' | 'up' | 'down'): void;
}>();

const isOpen = ref(false);

const options = computed(() => [
  { value: 'normal' as const, label: props.labelNormal },
  { value: 'up' as const, label: props.labelUp },
  { value: 'down' as const, label: props.labelDown },
]);

const currentLabel = computed(() => {
  const option = options.value.find(o => o.value === props.modelValue);
  return option?.label ?? props.labelNormal;
});

function symbolSvg(value: 'normal' | 'up' | 'down'): string {
  // Visible symbols only: "-", "▲", "▼" (use SVG for legibility/weight).
  if (value === "up") {
    return `
      <svg width="14" height="14" viewBox="0 0 16 16" role="img" focusable="false" aria-hidden="true">
        <path d="M8 3 L14 13 H2 Z" fill="currentColor"/>
      </svg>
    `.trim();
  }
  if (value === "down") {
    return `
      <svg width="14" height="14" viewBox="0 0 16 16" role="img" focusable="false" aria-hidden="true">
        <path d="M2 3 H14 L8 13 Z" fill="currentColor"/>
      </svg>
    `.trim();
  }
  return `
    <svg width="14" height="14" viewBox="0 0 16 16" role="img" focusable="false" aria-hidden="true">
      <path d="M3 8 H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `.trim();
}

function toggle() {
  isOpen.value = !isOpen.value;
}

function handleBlur() {
  setTimeout(() => {
    isOpen.value = false;
  }, 200);
}

function select(value: 'normal' | 'up' | 'down') {
  emit('update:modelValue', value);
  isOpen.value = false;
}
</script>

<style scoped>
.natureSelect {
  position: relative;
  width: 100%;
}

.natureSelect__trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  cursor: pointer;
  text-align: left;
  padding-right: 8px;
}

.natureSelect__symbol {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}

.natureSelect__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.natureSelect__chevron {
  flex-shrink: 0;
  transition: transform 0.2s;
  opacity: 0.5;
}

.natureSelect--open .natureSelect__chevron {
  transform: rotate(180deg);
}

.natureSelect__dropdown {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  /* Opaque background: avoid seeing text behind the dropdown */
  background: color-mix(in oklab, var(--paper) 98%, var(--ink) 2%);
  border: 1px solid color-mix(in oklab, var(--ink) 20%, transparent);
  border-radius: 12px;
  box-shadow: 0 4px 12px color-mix(in oklab, var(--ink) 10%, transparent);
  z-index: 1000;
  overflow: hidden;
}

.natureSelect__option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--ink);
  text-align: left;
  transition: background-color 0.15s;
}

.natureSelect__option:hover {
  background: color-mix(in oklab, var(--accent) 10%, var(--paper));
}

.natureSelect__option--selected {
  background: color-mix(in oklab, var(--ink) 8%, var(--paper));
  font-weight: 600;
}

.natureSelect__option:focus {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
</style>
