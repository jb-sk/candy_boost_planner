<template>
  <span
    class="exportList__badge"
    :class="`exportList__badge--${tone ?? 'neutral'}`"
    :role="tone ? 'img' : undefined"
    :aria-label="tone ? label : undefined"
  >
    <svg
      v-if="tone"
      class="exportList__badgeMark"
      :viewBox="`0 0 ${EXPORT_NATURE_MARK_WIDTH} ${EXPORT_NATURE_MARK_HEIGHT}`"
      aria-hidden="true"
    >
      <path :d="EXPORT_NATURE_MARK_PATH[tone]" />
    </svg>
    <span v-else>{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  EXPORT_NATURE_MARK_HEIGHT,
  EXPORT_NATURE_MARK_PATH,
  EXPORT_NATURE_MARK_WIDTH,
  exportNatureTone,
} from "../export/exportNatureMark";

const props = defineProps<{
  label: string;
}>();

const tone = computed(() => exportNatureTone(props.label));
</script>
