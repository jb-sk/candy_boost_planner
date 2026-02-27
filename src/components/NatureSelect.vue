<template>
  <div class="natureSelect" :class="{ 'natureSelect--open': isOpen }">
    <button
      type="button"
      class="natureSelect__trigger field__input"
      data-testid="nature-select-trigger"
      @click="toggle"
      @blur="handleBlur"
      :aria-label="label"
    >
      <span class="natureSelect__symbol" v-html="symbolSvg(modelValue)" aria-hidden="true"></span>
      <span class="natureSelect__sr">{{ currentLabel }}</span>
      <svg class="natureSelect__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none">
        <polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2" fill="none"/>
      </svg>
    </button>
    <div v-if="isOpen" class="natureSelect__dropdown" data-testid="nature-select-dropdown">
      <button
        type="button"
        v-for="option in options"
        :key="option.value"
        class="natureSelect__option"
        data-testid="nature-select-option"
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
