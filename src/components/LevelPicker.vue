<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
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
const presets = [10, 25, 30, 40, 50, 55, 57, 60, 65];

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
      @click.stop="isOpen = !isOpen"
    >
      {{ modelValue }}
    </button>

    <div v-if="isOpen" class="levelPick__popover" role="dialog" style="z-index: 100">
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
