<template>
  <section
    class="fineTuneEditor"
    data-testid="fine-tune-editor"
    :data-field="field"
    :data-row-id="row.id"
    :aria-label="row.title"
  >
    <div class="fineTuneEditor__head">
      <span class="fineTuneEditor__name" data-testid="fine-tune-editor-name">{{ row.title }}</span>
      <span v-if="stepper !== null" class="fineTuneEditor__field">{{ stepper.label }}</span>
      <span v-if="changeText !== null" class="fineTuneEditor__change" data-testid="fine-tune-editor-change">{{ changeText }}</span>
      <span class="fineTuneEditor__spacer"></span>
      <button
        class="fineTuneEditor__close"
        type="button"
        data-testid="fine-tune-editor-close"
        :aria-label="t('calc.fineTune.closeEditor')"
        @click="emit('close')"
      >×</button>
    </div>

    <p class="fineTuneEditor__info" data-testid="fine-tune-editor-info">
      <span v-for="(item, i) in infoItems" :key="i" :class="{ 'fineTuneEditor__info--short': item.short }">{{ item.text }}</span>
    </p>
    <p v-if="noteText !== null" class="fineTuneEditor__note" data-testid="fine-tune-editor-note">{{ noteText }}</p>

    <button
      v-if="recommendation !== null"
      class="fineTuneEditor__recommend"
      type="button"
      data-testid="fine-tune-editor-recommend"
      :disabled="pending || busy"
      @click="emit('op', { kind: 'set', rowId: row.id, boost: recommendation.boost })"
    >
      <span class="fineTuneEditor__recommendLabel">{{ recommendLabel }}</span>
      <span class="fineTuneEditor__recommendDelta" data-testid="fine-tune-editor-recommend-delta">{{ t("calc.fineTune.field.boost") }}{{ recommendDelta }}</span>
      <span v-if="recommendation.insufficient" class="fineTuneEditor__recommendNote">{{ t("calc.fineTune.recommendInsufficient") }}</span>
    </button>

    <div v-if="stepper !== null" class="fineTuneEditor__stepper" :class="`fineTuneEditor__stepper--${stepper.steps.length}`">
      <button
        v-for="amount in stepper.steps"
        :key="`down-${amount}`"
        class="fineTuneEditor__step"
        type="button"
        data-testid="fine-tune-editor-step"
        :data-delta="-amount"
        :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: `−${amount}` })"
        :disabled="busy || stepper.value <= stepper.min"
        @click="stepBy(-amount)"
      >−{{ amount }}</button>
      <input
        ref="inputRef"
        v-keypad="stepper.inputLabel"
        class="field__input fineTuneEditor__input"
        data-testid="fine-tune-editor-input"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        :aria-label="stepper.inputLabel"
        :disabled="busy"
        :value="draft ?? String(stepper.value)"
        @focus="draft = String(stepper.value)"
        @input="onInput(($event.target as HTMLInputElement).value)"
        @blur="onBlur"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      />
      <button
        v-for="amount in [...stepper.steps].reverse()"
        :key="`up-${amount}`"
        class="fineTuneEditor__step"
        type="button"
        data-testid="fine-tune-editor-step"
        :data-delta="amount"
        :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: `+${amount}` })"
        :disabled="busy || stepper.value >= stepper.max"
        @click="stepBy(amount)"
      >+{{ amount }}</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp, RowExclusion } from "../domain/fine-tune/draft";
import type { FineTuneRowView } from "../domain/fine-tune/rowView";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { vKeypad } from "../composables/useNumericKeypad";
import { FINE_TUNE_STEPS, sleepReachText, type FineTuneField } from "../utils/fineTuneView";

/**
 * かんたんの調整バー。表で押した欄（目標Lv・アメブ）を、刻みのボタンと個数欄で動かす。
 * 行の詳細（到達・睡眠のあと・足りないもの・動かせない理由）と「〇〇のLvを上げる」もここに出す。
 * 値と範囲は `FineTuneRowView` に入っているものを使い、op を投げるだけ（範囲に収めるのは reducer）。
 */
const props = defineProps<{
  row: FineTuneRowView;
  field: FineTuneField;
  /** 最新の結果が今の下書きの結果でない。結果に頼る操作（おすすめ）を押せなくする */
  pending: boolean;
  /** 「全体のLvを伸ばす」を求めている間。どの操作も押せなくする */
  busy: boolean;
  fmt: (n: number) => string;
  titleOf: (rowId: string) => string;
}>();

const emit = defineEmits<{
  (e: "op", op: FineTuneOp): void;
  (e: "close"): void;
}>();

const { t } = useI18n();

const EXCLUSION_TEXT: Readonly<Record<RowExclusion, string>> = {
  candyTarget: "calc.fineTune.exclusion.candyTarget",
  noCandy: "calc.fineTune.exclusion.noCandy",
  sleepOnly: "calc.fineTune.exclusion.sleepOnly",
  maxLevel: "calc.fineTune.exclusion.maxLevel",
  unknownPokemon: "calc.fineTune.exclusion.unknownPokemon",
};

const FACTOR_TEXT = {
  candy: "calc.fineTune.factor.candy",
  shards: "calc.fineTune.factor.shards",
  boost: "calc.fineTune.factor.boost",
} as const;

interface Stepper {
  label: string;
  inputLabel: string;
  value: number;
  base: number;
  min: number;
  max: number;
  steps: readonly number[];
  stepOp: (by: number) => FineTuneOp;
  setOp: (value: number) => FineTuneOp;
}

/** 選んだ欄の刻み・範囲・op。動かせない欄（行の詳細）は null */
const stepper = computed<Stepper | null>(() => {
  const { row, field } = props;
  const rowId = row.id;
  const labelOf = (key: "target" | "boost") => t(`calc.fineTune.field.${key}`);
  const inputLabelOf = (label: string) => t("calc.fineTune.inputAria", { field: label, name: row.title });
  if (field === "target" && row.levelAdjustable) {
    const label = labelOf("target");
    return {
      label,
      inputLabel: inputLabelOf(label),
      value: row.targetLevel.value,
      base: row.targetLevel.base,
      min: row.targetLevel.range.min,
      max: row.targetLevel.range.max,
      steps: FINE_TUNE_STEPS.target,
      stepOp: (by) => ({ kind: "targetStep", rowId, by }),
      setOp: (level) => ({ kind: "targetSet", rowId, level }),
    };
  }
  if (field === "boost" && row.levelAdjustable && row.boost !== null) {
    const label = labelOf("boost");
    return {
      label,
      inputLabel: inputLabelOf(label),
      value: row.boost.value,
      base: row.boost.base,
      min: row.boost.range.min,
      max: row.boost.range.max,
      steps: FINE_TUNE_STEPS.boost,
      stepOp: (by) => ({ kind: "step", rowId, by }),
      setOp: (boost) => ({ kind: "set", rowId, boost }),
    };
  }
  return null;
});

/** 基準からの変化（変わっていなければ null） */
const changeText = computed(() => {
  const s = stepper.value;
  if (s === null || s.value === s.base) return null;
  return `${props.fmt(s.base)} → ${props.fmt(s.value)}`;
});

// ===== 行の詳細 =====
const infoItems = computed(() => {
  const { row } = props;
  const items: Array<{ text: string; short: boolean }> = [];
  const level = row.reachLevel.value;
  if (level !== null) {
    const exp = row.expToNext.value;
    const left = level < MAX_LEVEL && exp !== null && exp > 0 ? ` ${t("calc.fineTune.expLeft", { exp: props.fmt(exp) })}` : "";
    items.push({ text: `${t("calc.fineTune.reach", { level })}${left}`, short: false });
  }
  if (row.sleepReach !== null) {
    const key = row.sleepReach.kind === "napIsland" ? "calc.fineTune.napReach" : "calc.fineTune.sleepReach";
    items.push({ text: t(key, { level: sleepReachText(row.sleepReach) }), short: false });
  }
  if (row.limitingFactor !== null) {
    items.push({ text: t("calc.fineTune.short", { factor: t(FACTOR_TEXT[row.limitingFactor]) }), short: true });
  }
  const cappedTo = row.boost?.cappedTo ?? null;
  if (props.field === "boost" && cappedTo !== null) {
    items.push({ text: t("calc.fineTune.boostCapped", { count: props.fmt(cappedTo) }), short: false });
  }
  return items;
});

/** 動かせない理由 */
const noteText = computed(() => (props.row.exclusion === null ? null : t(EXCLUSION_TEXT[props.row.exclusion])));

// ===== 「〇〇のLvを上げる」（行の詳細とアメブで出す） =====
const recommendation = computed(() => {
  if (props.field !== "row" && props.field !== "boost") return null;
  if (!props.row.levelAdjustable) return null;
  return props.row.advice?.recommendation ?? null;
});

const recommendLabel = computed(() => {
  const rec = recommendation.value;
  if (rec === null) return "";
  return t(rec.andOthers ? "calc.fineTune.recommendMany" : "calc.fineTune.recommend", { name: props.titleOf(rec.targetRowId) });
});

const recommendDelta = computed(() => {
  const rec = recommendation.value;
  const current = props.row.boost?.value;
  if (rec === null || current === undefined) return "";
  const delta = rec.boost - current;
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${props.fmt(Math.abs(delta))}`;
});

// ===== 刻みのボタンと個数欄（確定は blur。テンキーは ui_spec §8） =====
function stepBy(by: number): void {
  const s = stepper.value;
  if (s !== null) emit("op", s.stepOp(by));
}

const inputRef = ref<HTMLInputElement | null>(null);
const draft = ref<string | null>(null);

function onInput(raw: string): void {
  draft.value = raw.replace(/[^0-9]/g, "");
}

function onBlur(): void {
  const value = draft.value;
  draft.value = null;
  const s = stepper.value;
  if (s !== null && value !== null && value !== "" && Number(value) !== s.value) emit("op", s.setOp(Number(value)));
  // 範囲の端に合わせた結果が元の値と同じときも、欄に打ちかけの文字を残さない
  void nextTick(() => {
    const el = inputRef.value;
    if (el && stepper.value !== null) el.value = String(stepper.value.value);
  });
}
</script>
