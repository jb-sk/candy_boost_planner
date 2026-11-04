<template>
  <!-- シンプルの操作パネルで Lv を動かす欄（現在Lv・目標Lv・アメブ目標Lv）。3つとも同じ形にする。
       枠の中に欄の名前と Lv を置き、Lv は直接打てる（タッチ端末はテンキー）。右の ▾ で計算機と同じ Lvピッカーを開く -->
  <div
    class="fineTuneLevelField"
    :class="{ 'fineTuneLevelField--changed': value !== base, 'fineTuneLevelField--disabled': disabled }"
    data-testid="fine-tune-editor-level-field"
    :data-level-field="kind"
  >
    <span class="fineTuneLevelField__label" aria-hidden="true">{{ label }}</span>
    <LevelPicker
      class="fineTuneLevelField__pick"
      keypad
      :model-value="value"
      :min="min"
      :max="max"
      :disabled="disabled"
      :placeholder="placeholder"
      :label="`${label}: ${value === null ? placeholder : `Lv${value}`}`"
      boundary=".fineTuneModal"
      @update:model-value="(level, coalesce) => emit('set', level, coalesce)"
      @clear="emit('clear')"
    >
      <!-- 計算機のピッカーと同じ見出し（目標Lv・アメブ目標Lvは現在Lvからの矢印。空欄は文言） -->
      <template #title>{{ label }}: <template v-if="from !== undefined">Lv{{ from }} → </template>{{ value === null ? placeholder : `Lv${value}` }}</template>
    </LevelPicker>
  </div>
</template>

<script setup lang="ts">
import LevelPicker from "./LevelPicker.vue";
import type { HistoryRecordOptions } from "../composables/useHistory";

/**
 * シンプルの Lv の欄。値と範囲は親（`FineTuneRowView`）から受け取り、選んだ Lv を `set` で返すだけ（範囲に収めるのは reducer）。
 * 開いた時点の値（base）と違えば、ほかの欄と同じく変えた見た目にする。
 */
defineProps<{
  /** どの Lv か（E2E が見分ける印）。defaultBoostLevel は設定欄の既定のアメブ目標Lv */
  kind: "srcLevel" | "target" | "boostLevel" | "defaultBoostLevel";
  label: string;
  /** null は空欄（`placeholder` のある欄だけ） */
  value: number | null;
  base: number | null;
  min: number;
  max: number;
  disabled?: boolean;
  /** ピッカーの見出しに「Lv{from} → 」を付ける（目標Lv・アメブ目標Lv。現在Lvは付けない） */
  from?: number;
  /** 空欄を許す欄の、空欄の文言（既定のアメブ目標Lvの「目標Lvと同じ」）。空欄で確定すると `clear` */
  placeholder?: string;
}>();

const emit = defineEmits<{
  /** `coalesce` はスライダーの1回のドラッグの目印（`LevelPicker` から受け取ったまま渡す） */
  (e: "set", level: number, coalesce?: HistoryRecordOptions): void;
  /** 空欄で確定した（`placeholder` のある欄だけ） */
  (e: "clear"): void;
}>();
</script>
