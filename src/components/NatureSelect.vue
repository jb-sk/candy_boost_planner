<template>
  <div
    class="natureSelect"
    :class="{
      'natureSelect--open': isOpen,
      'natureSelect--compact': compact,
    }"
  >
    <button
      ref="triggerRef"
      type="button"
      class="natureSelect__trigger field__input"
      data-testid="nature-select-trigger"
      @click="toggle"
      @blur="handleBlur"
      :aria-label="label"
      :aria-expanded="isOpen"
    >
      <span v-if="caption" class="natureSelect__caption" aria-hidden="true">{{ caption }}</span>
      <span class="natureSelect__symbol" :class="`natureSelect__symbol--${modelValue}`" v-html="symbolSvg(modelValue)" aria-hidden="true"></span>
      <span class="natureSelect__sr">{{ currentLabel }}</span>
      <svg class="natureSelect__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none">
        <polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2" fill="none"/>
      </svg>
    </button>
    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="dropdownRef"
        class="natureSelect__dropdown"
        :class="{ 'natureSelect__dropdown--compact': compact }"
        data-testid="nature-select-dropdown"
        :style="dropdownStyle"
      >
        <button
          type="button"
          v-for="option in options"
          :key="option.value"
          class="natureSelect__option"
          data-testid="nature-select-option"
          :class="{ 'natureSelect__option--selected': option.value === modelValue }"
          @mousedown.prevent="select(option.value)"
        >
          <span class="natureSelect__symbol" :class="`natureSelect__symbol--${option.value}`" v-html="symbolSvg(option.value)" aria-hidden="true"></span>
          <span class="natureSelect__sr">{{ option.label }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';

const props = defineProps<{
  modelValue: 'normal' | 'up' | 'down';
  label: string;
  labelNormal: string;
  labelUp: string;
  labelDown: string;
  compact?: boolean;
  /**
   * 記号の上に出す小見出し。**ラベルを置く余地が無い場所でだけ使う。**
   * 計算機の行ヘッダは他の入力と違って項目名を置く場所が無く、▲▲ だけでは
   * 何の補正か読み取れないため「EXP」を添える。読み上げは `aria-label` が担当する。
   */
  caption?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: 'normal' | 'up' | 'down'): void;
}>();

const triggerRef = ref<HTMLButtonElement | null>(null);
const dropdownRef = ref<HTMLDivElement | null>(null);
const isOpen = ref(false);
const dropdownPos = ref({ top: 0, left: 0, width: 0 });

const dropdownStyle = computed(() => ({
  position: 'fixed' as const,
  top: `${dropdownPos.value.top}px`,
  left: `${dropdownPos.value.left}px`,
  width: `${dropdownPos.value.width}px`,
}));

function updateDropdownPos() {
  if (!triggerRef.value) return;
  const rect = triggerRef.value.getBoundingClientRect();
  const gap = 2;
  const dropdownHeight = dropdownRef.value?.offsetHeight ?? 0;
  const topBelow = rect.bottom + gap;
  const top = dropdownHeight > 0 && topBelow + dropdownHeight > window.innerHeight
    ? Math.max(gap, rect.top - gap - dropdownHeight)
    : topBelow;
  dropdownPos.value = {
    top,
    left: rect.left,
    width: rect.width,
  };
}

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
  // Visible symbols only: "-", "▲▲", "▼▼" (use SVG for legibility/weight).
  if (value === "up") {
    return `
      <svg width="28" height="14" viewBox="0 0 32 16" role="img" focusable="false" aria-hidden="true">
        <path d="M8 3 L14 13 H2 Z" fill="currentColor"/>
        <path d="M24 3 L30 13 H18 Z" fill="currentColor"/>
      </svg>
    `.trim();
  }
  if (value === "down") {
    return `
      <svg width="28" height="14" viewBox="0 0 32 16" role="img" focusable="false" aria-hidden="true">
        <path d="M2 3 H14 L8 13 Z" fill="currentColor"/>
        <path d="M18 3 H30 L24 13 Z" fill="currentColor"/>
      </svg>
    `.trim();
  }
  return `
    <svg width="14" height="14" viewBox="0 0 16 16" role="img" focusable="false" aria-hidden="true">
      <path d="M3 8 H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `.trim();
}

async function toggle() {
  if (isOpen.value) {
    isOpen.value = false;
    return;
  }
  updateDropdownPos();
  isOpen.value = true;
  await nextTick();
  // Teleport 後の実寸で、画面下に収まらない場合だけトリガーの上へ出す。
  updateDropdownPos();
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
