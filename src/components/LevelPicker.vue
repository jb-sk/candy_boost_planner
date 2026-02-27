<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";

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
const presets = [10, 25, 30, 40, 50, 55, 60, 65];

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
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    await nextTick();
    adjustPopoverPosition();
  }
}

function close() {
  isOpen.value = false;
}

function setValue(v: number) {
  emit("update:modelValue", v);
}

function update(v: number) {
  const min = props.min ?? 1;
  const max = props.max ?? 65;
  if (v < min) v = min;
  if (v > max) v = max;
  setValue(v);
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
    <button
      type="button"
      class="field__input field__input--button levelPick__button"
      data-testid="level-picker-trigger"
      @click.stop="toggle"
    >
      {{ modelValue }}
    </button>

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
          class="btn btn--ghost btn--xs"
          type="button"
          @click.stop="update(modelValue - 1)"
          :disabled="modelValue <= (min ?? 1)"
        >
          ◀
        </button>
        <input
          class="levelPick__range"
          type="range"
          :min="min ?? 1"
          :max="max ?? 65"
          step="1"
          :value="modelValue"
          @input="update(parseInt(($event.target as HTMLInputElement).value))"
          @click.stop
        />
        <button
          class="btn btn--ghost btn--xs"
          type="button"
          data-testid="level-picker-increment"
          @click.stop="update(modelValue + 1)"
          :disabled="modelValue >= (max ?? 65)"
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
          :disabled="lv < (min ?? 1) || lv > (max ?? 65)"
        >
          {{ lv }}
        </button>
      </div>
    </div>
  </div>
</template>
