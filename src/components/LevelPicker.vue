<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";

const props = defineProps<{
  modelValue: number;
  label?: string; // Title inside popover
  min?: number;
  max?: number;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: number): void;
}>();

const { t } = useI18n();

const isOpen = ref(false);
const root = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});
const presets = [10, 25, 30, 40, 50, 55, 60, 65, MAX_LEVEL];

const inputValue = ref(String(props.modelValue));
const isEditing = ref(false);

watch(() => props.modelValue, (v) => {
  if (!isEditing.value) inputValue.value = String(v);
});

const EDGE_GAP = 8; // px from viewport edge

/** Calculate popover position so it never overflows viewport edges */
function adjustPopoverPosition() {
  if (!root.value) return;
  const popover = root.value.querySelector<HTMLElement>(".levelPick__popover");
  if (!popover) return;

  const triggerRect = root.value.getBoundingClientRect();
  const popW = popover.offsetWidth;
  const popH = popover.offsetHeight;
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;

  // --- 水平位置 ---
  // Default: right-align to trigger (same as CSS right:0)
  let left = triggerRect.right - popW;

  // Clamp: don't overflow left edge
  if (left < EDGE_GAP) {
    left = EDGE_GAP;
  }
  // Clamp: don't overflow right edge
  if (left + popW > vpW - EDGE_GAP) {
    left = vpW - EDGE_GAP - popW;
  }

  // Convert to offset from the trigger's left edge (since parent is position:relative)
  const offsetLeft = left - triggerRect.left;

  // --- 垂直位置 ---
  // デフォルトは下（CSS top: calc(100% + 6px)）。下に収まらない場合は上にフリップ。
  // ただし position: fixed（legacy <=560px のセンタリング）時はスキップ。
  const isFixed = getComputedStyle(popover).position === "fixed";
  const gapPx = 6;
  const overflowsBottom = triggerRect.bottom + gapPx + popH > vpH - EDGE_GAP;
  const fitsAbove = triggerRect.top - gapPx - popH > EDGE_GAP;

  if (!isFixed && overflowsBottom && fitsAbove) {
    popoverStyle.value = { left: `${offsetLeft}px`, right: "auto", top: "auto", bottom: `calc(100% + ${gapPx}px)` };
  } else {
    popoverStyle.value = { left: `${offsetLeft}px`, right: "auto" };
  }
}

async function toggle() {
  if (isEditing.value) {
    commitInput();
  }
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    await nextTick();
    adjustPopoverPosition();
  }
}

function close() {
  isOpen.value = false;
}

/**
 * 確定値が現在の modelValue と異なる場合だけ emit する。
 * 未変更でも emit すると、目標Lv欄を開いて閉じただけで個数指定・睡眠目標が解除され、
 * planner が再計算されてしまう（設計書§6.2）。
 */
function setValue(v: number) {
  if (v === props.modelValue) return;
  emit("update:modelValue", v);
}

function update(v: number) {
  if (isEditing.value) {
    commitInput();
  }
  const min = props.min ?? 1;
  const max = props.max ?? MAX_LEVEL;
  if (v < min) v = min;
  if (v > max) v = max;
  inputValue.value = String(v);
  setValue(v);
}

function nudge(delta: number) {
  const base = isEditing.value ? commitInput() : props.modelValue;
  update(base + delta);
}

function effectiveInputNumber() {
  const n = parseInt(inputValue.value);
  return isNaN(n) ? props.modelValue : n;
}

function onInputFocus() {
  isEditing.value = true;
}

function commitInput(): number {
  isEditing.value = false;
  const n = parseInt(inputValue.value);
  if (isNaN(n) || inputValue.value.trim() === "") {
    inputValue.value = String(props.modelValue);
    return props.modelValue;
  }
  const lo = props.min ?? 1;
  const hi = props.max ?? MAX_LEVEL;
  const clamped = Math.max(lo, Math.min(hi, n));
  inputValue.value = String(clamped);
  setValue(clamped);
  return clamped;
}

function onInputBlur() {
  commitInput();
}

function onInputEnter(e: KeyboardEvent) {
  (e.target as HTMLInputElement).blur();
}

function onInputTyping(e: Event) {
  inputValue.value = (e.target as HTMLInputElement).value.replace(/[^0-9]/g, "");
}

function onClickOutside(event: MouseEvent) {
  if (isOpen.value && root.value && !root.value.contains(event.target as Node)) {
    close();
  }
}

onMounted(() => {
  document.addEventListener("click", onClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", onClickOutside);
});
</script>

<template>
  <div class="levelPick" ref="root">
    <input
      type="number"
      inputmode="numeric"
      pattern="[0-9]*"
      :min="min ?? 1"
      :max="max ?? MAX_LEVEL"
      step="1"
      class="field__input levelPick__input"
      data-testid="level-picker-trigger"
      :aria-label="label ?? 'Level'"
      :value="inputValue"
      @focus="onInputFocus"
      @blur="onInputBlur"
      @keydown.enter.prevent="onInputEnter"
      @input="onInputTyping"
    />
    <button
      type="button"
      class="levelPick__chevron"
      data-testid="level-picker-chevron"
      :aria-label="label ? `${label} picker` : 'Level picker'"
      :title="label ? `${label} picker` : 'Level picker'"
      @click.stop="toggle"
    ></button>

    <div v-if="isOpen" class="levelPick__popover" data-testid="level-picker-popover" role="dialog" :style="popoverStyle">
      <div class="levelPick__top">
        <div class="levelPick__title">
          <slot name="title">{{ label }}</slot>
        </div>
        <button
          class="btn btn--ghost btn--xs"
          type="button"
          @mousedown.stop.prevent
          @click.stop.prevent="close"
        >
          {{ t("common.close") }}
        </button>
      </div>

      <div class="levelPick__sliderRow">
        <button
          class="btn btn--ghost btn--xs levelPick__stepButton"
          type="button"
          data-testid="level-picker-decrement"
          @click.stop="nudge(-1)"
          :disabled="effectiveInputNumber() <= (min ?? 1)"
        >
          ◀
        </button>
        <input
          class="levelPick__range"
          type="range"
          :min="min ?? 1"
          :max="max ?? MAX_LEVEL"
          step="1"
          :value="modelValue"
          @input="update(parseInt(($event.target as HTMLInputElement).value))"
          @click.stop
        />
        <button
          class="btn btn--ghost btn--xs levelPick__stepButton"
          type="button"
          data-testid="level-picker-increment"
          @click.stop="nudge(1)"
          :disabled="effectiveInputNumber() >= (max ?? MAX_LEVEL)"
        >
          ▶
        </button>
      </div>

      <div class="levelPick__chips">
        <button
          v-for="lv in presets"
          :key="lv"
          type="button"
          class="levelChip"
          :class="{ 'levelChip--on': lv === modelValue }"
          @click.stop="update(lv)"
          :disabled="lv < (min ?? 1) || lv > (max ?? MAX_LEVEL)"
        >
          {{ lv }}
        </button>
      </div>
    </div>
  </div>
</template>
