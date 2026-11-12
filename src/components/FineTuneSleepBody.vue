<template>
  <!-- 睡眠: 1段目に 200h〜2000h・睡眠・おひるね島、2段目にチケット・アメ在庫（睡眠・おひるね島のときだけ） -->
  <div class="fineTuneEditor__line">
    <div class="fineTuneEditor__options" data-testid="fine-tune-editor-sleep" role="group" :aria-label="t('calc.fineTune.field.sleep')">
      <button
        v-for="option in sleepEditor.options"
        :key="option.key"
        class="fineTuneEditor__option"
        :class="{ 'fineTuneEditor__option--on': option.selected, 'fineTuneEditor__option--wide': option.choice.base === 'napIsland' }"
        type="button"
        data-testid="fine-tune-editor-sleep-option"
        :data-option="option.key"
        :aria-pressed="option.selected"
        :disabled="busy"
        @click="chooseSleep(option.choice)"
      >
        <template v-if="option.short !== option.label">
          <span class="fineTuneEditor__optionLabel fineTuneEditor__optionLabel--full">{{ option.label }}</span>
          <span class="fineTuneEditor__optionLabel fineTuneEditor__optionLabel--short">{{ option.short }}</span>
        </template>
        <template v-else>{{ option.label }}</template>
      </button>
    </div>
  </div>
  <div class="fineTuneEditor__line">
    <div class="fineTuneEditor__checks">
      <button
        class="fineTuneEditor__toggle"
        :class="{ 'fineTuneEditor__toggle--on': sleepEditor.ticket }"
        type="button"
        data-testid="fine-tune-editor-sleep-ticket"
        :aria-pressed="sleepEditor.ticket"
        :disabled="busy || !sleepEditor.canTicket"
        @click="toggleSleep('ticket')"
      ><span class="fineTuneEditor__toggleIcon" aria-hidden="true">{{ SLEEP_TICKET_EMOJI }}</span>{{ t("calc.fineTune.sleepOption.ticket") }}</button>
      <button
        class="fineTuneEditor__toggle"
        :class="{ 'fineTuneEditor__toggle--on': sleepEditor.stock }"
        type="button"
        data-testid="fine-tune-editor-sleep-stock"
        :aria-pressed="sleepEditor.stock"
        :disabled="busy || !sleepEditor.canStock"
        @click="toggleSleep('stock')"
      ><span class="fineTuneEditor__toggleIcon" aria-hidden="true">{{ SLEEP_STOCK_EMOJI }}</span>{{ t("calc.fineTune.sleepOption.stock") }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp } from "../domain/fine-tune/draft";
import type { FineTuneRowView } from "../domain/fine-tune/rowView";
import { SLEEP_TARGET_HOURS_OPTIONS } from "../domain/types";
import { sleepTargetOfChoice, type SleepTargetChoice } from "../domain/sleep-target";
import { SLEEP_STOCK_EMOJI, SLEEP_TICKET_EMOJI, sleepTargetText } from "../utils/fineTuneView";

/**
 * 調整バーの操作の2段のうち、睡眠の欄（選択肢とチケット・アメ在庫のトグル）。
 * 選んだ睡眠目標は `sleepSet` の op で親へ返す（反映は親の下書き）。
 */
const props = defineProps<{
  row: FineTuneRowView;
  busy: boolean;
}>();

const emit = defineEmits<{
  (e: "op", op: FineTuneOp): void;
}>();

const { t } = useI18n();

/** 睡眠の選択肢。`key` は E2E の data-option（none・h200〜h2000・sleep・nap）。`short` はとても狭い幅での名前 */
interface SleepOption {
  key: string;
  label: string;
  short: string;
  choice: SleepTargetChoice;
  selected: boolean;
}

const sleepEditor = computed(() => {
  const current = props.row.sleepTarget.choice;
  const stock = (current.base === "sleep" || current.base === "napIsland") && current.stock;
  const ticket = current.base === "napIsland" && current.ticket;
  const none = t("calc.fineTune.sleepOption.none");
  const all = t("calc.fineTune.sleepOption.all");
  // おひるね島だけ、とても狭い幅では「島」と縮める（表の睡眠の欄と同じ）
  const options: SleepOption[] = [
    { key: "none", label: none, short: none, choice: { base: "none" }, selected: current.base === "none" },
    ...SLEEP_TARGET_HOURS_OPTIONS.map((hours): SleepOption => {
      const name = sleepTargetText(t, { base: "hours", hours }).name;
      return {
        key: `h${hours}`,
        label: name,
        short: name,
        choice: { base: "hours", hours },
        selected: current.base === "hours" && current.hours === hours,
      };
    }),
    // 睡眠・おひるね島へ移るときは、アメ在庫の印を持ち越す（チケットはおひるね島どうしだけ）
    { key: "sleep", label: all, short: all, choice: { base: "sleep", stock }, selected: current.base === "sleep" },
    {
      key: "nap",
      label: t("calc.fineTune.sleepOption.nap"),
      short: t("calc.fineTune.sleepOption.napShort"),
      choice: { base: "napIsland", stock, ticket },
      selected: current.base === "napIsland",
    },
  ];
  return {
    options,
    stock,
    ticket,
    canStock: current.base === "sleep" || current.base === "napIsland",
    canTicket: current.base === "napIsland",
  };
});

function chooseSleep(choice: SleepTargetChoice): void {
  emit("op", { kind: "sleepSet", rowId: props.row.id, target: sleepTargetOfChoice(choice) });
}

function toggleSleep(which: "stock" | "ticket"): void {
  const current = props.row.sleepTarget.choice;
  if (current.base === "sleep" && which === "stock") chooseSleep({ ...current, stock: !current.stock });
  if (current.base === "napIsland") chooseSleep({ ...current, [which]: !current[which] });
}
</script>
