<template>
  <!-- 常に出す。何も選んでいないときは案内と押せない刻みのボタンだけ（選んでも高さが変わらない） -->
  <section
    class="fineTuneEditor"
    :class="{ 'fineTuneEditor--idle': row === null }"
    data-testid="fine-tune-editor"
    :data-field="row === null ? undefined : field ?? undefined"
    :data-row-id="row?.id"
    :aria-label="row?.title ?? t('calc.fineTune.hint')"
  >
    <div class="fineTuneEditor__head">
      <template v-if="row !== null">
        <span class="fineTuneEditor__name" data-testid="fine-tune-editor-name">{{ row.title }}</span>
        <span v-if="stepper !== null" class="fineTuneEditor__field">{{ stepper.label }}</span>
        <span v-else-if="field === 'sleep'" class="fineTuneEditor__field">{{ t("calc.fineTune.field.sleep") }}</span>
        <!-- 目標Lvは個数欄が無いので、今の値をここに出す -->
        <span v-if="field === 'target' && stepper !== null && changeText === null" class="fineTuneEditor__change" data-testid="fine-tune-editor-level-value">Lv{{ stepper.value }}</span>
        <span v-if="changeText !== null" class="fineTuneEditor__change" data-testid="fine-tune-editor-change">{{ changeText }}</span>
        <span class="fineTuneEditor__spacer"></span>
        <!-- この欄を押してからの変更を取り消して、押す前の値へ戻す -->
        <button
          class="btn btn--soft btn--sm fineTuneEditor__cancel"
          type="button"
          data-testid="fine-tune-editor-cancel"
          :disabled="busy || !canCancel"
          @click="emit('cancel')"
        >{{ t("calc.fineTune.cancelEdit") }}</button>
      </template>
      <span v-else class="fineTuneEditor__hint" data-testid="fine-tune-hint">{{ t("calc.fineTune.hint") }}</span>
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
      @click="emit('op', { kind: 'set', rowId: row!.id, boost: recommendation.boost })"
    >
      <span class="fineTuneEditor__recommendLabel">{{ recommendLabel }}</span>
      <span class="fineTuneEditor__recommendDelta" data-testid="fine-tune-editor-recommend-delta">{{ t("calc.fineTune.field.boost") }}{{ recommendDelta }}</span>
      <span v-if="recommendation.insufficient" class="fineTuneEditor__recommendNote">{{ t("calc.fineTune.recommendInsufficient") }}</span>
    </button>

    <!-- アメブ: 最小アメブ（手持ちのアメから最小限のアメブを自動で決める）とリセット（自動の値へ戻す） -->
    <div v-if="boostTools !== null" class="fineTuneEditor__tools">
      <button
        class="fineTuneEditor__tool"
        :class="{ 'fineTuneEditor__tool--on': boostTools.minimized }"
        type="button"
        data-testid="fine-tune-editor-minimize"
        :aria-pressed="boostTools.minimized"
        :title="boostTools.minimizeTitle"
        :disabled="busy || (!boostTools.minimized && !boostTools.canMinimize)"
        @click="emit('op', { kind: 'boostMinimize', rowId: row!.id, on: !boostTools.minimized })"
      >{{ t("calc.fineTune.boostMinimize") }}</button>
      <button
        class="fineTuneEditor__tool"
        type="button"
        data-testid="fine-tune-editor-boost-reset"
        :title="t('calc.fineTune.boostResetTitle')"
        :disabled="busy || !boostTools.manual"
        @click="emit('op', { kind: 'boostReset', rowId: row!.id })"
      >{{ t("calc.fineTune.boostReset") }}</button>
    </div>

    <!-- 睡眠: 200h〜2000h・全て・おひるね島と、アメ在庫・チケット（全て・おひるね島のときだけ） -->
    <div v-if="sleepEditor !== null" class="fineTuneEditor__sleep" data-testid="fine-tune-editor-sleep">
      <div class="fineTuneEditor__options">
        <button
          v-for="option in sleepEditor.options"
          :key="option.key"
          class="fineTuneEditor__option"
          :class="{ 'fineTuneEditor__option--on': option.selected }"
          type="button"
          data-testid="fine-tune-editor-sleep-option"
          :data-option="option.key"
          :aria-pressed="option.selected"
          :disabled="busy"
          @click="chooseSleep(option.choice)"
        >{{ option.label }}</button>
      </div>
      <div class="fineTuneEditor__checks">
        <button
          class="fineTuneEditor__option"
          :class="{ 'fineTuneEditor__option--on': sleepEditor.ticket }"
          type="button"
          data-testid="fine-tune-editor-sleep-ticket"
          :aria-pressed="sleepEditor.ticket"
          :disabled="busy || !sleepEditor.canTicket"
          @click="toggleSleep('ticket')"
        ><span aria-hidden="true">{{ SLEEP_TICKET_EMOJI }}</span>{{ t("calc.fineTune.sleepOption.ticket") }}</button>
        <button
          class="fineTuneEditor__option"
          :class="{ 'fineTuneEditor__option--on': sleepEditor.stock }"
          type="button"
          data-testid="fine-tune-editor-sleep-stock"
          :aria-pressed="sleepEditor.stock"
          :disabled="busy || !sleepEditor.canStock"
          @click="toggleSleep('stock')"
        ><span aria-hidden="true">{{ SLEEP_STOCK_EMOJI }}</span>{{ t("calc.fineTune.sleepOption.stock") }}</button>
      </div>
    </div>

    <!-- 目標Lv: Lvピッカーと同じ形（スライダーと左右の ◀ ▶、2段目に Lv の丸いボタン） -->
    <div v-else-if="stepper !== null && field === 'target'" class="fineTuneEditor__level" data-testid="fine-tune-editor-level">
      <div class="levelPick__sliderRow fineTuneEditor__levelRow">
        <button
          class="fineTuneEditor__step fineTuneEditor__levelStep"
          type="button"
          data-testid="fine-tune-editor-step"
          data-delta="-1"
          :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: '−1' })"
          :disabled="busy || stepper.value <= stepper.min"
          @click="stepBy(-1)"
        >◀</button>
        <input
          class="levelPick__range fineTuneEditor__levelRange"
          type="range"
          data-testid="fine-tune-editor-level-range"
          :aria-label="stepper.inputLabel"
          :min="stepper.min"
          :max="stepper.max"
          step="1"
          :value="stepper.value"
          :disabled="busy"
          @input="setLevel(($event.target as HTMLInputElement).value)"
        />
        <button
          class="fineTuneEditor__step fineTuneEditor__levelStep"
          type="button"
          data-testid="fine-tune-editor-step"
          data-delta="1"
          :aria-label="t('calc.fineTune.stepAria', { field: stepper.label, delta: '+1' })"
          :disabled="busy || stepper.value >= stepper.max"
          @click="stepBy(1)"
        >▶</button>
      </div>
      <div class="levelPick__chips fineTuneEditor__levelChips">
        <button
          v-for="lv in LEVEL_PRESETS"
          :key="lv"
          type="button"
          class="levelChip"
          :class="{ 'levelChip--on': lv === stepper.value }"
          data-testid="fine-tune-editor-level-chip"
          :data-level="lv"
          :disabled="busy || lv < stepper.min || lv > stepper.max"
          @click="setLevel(String(lv))"
        >{{ lv }}</button>
      </div>
    </div>

    <div v-else-if="stepper !== null" class="fineTuneEditor__stepper" :class="`fineTuneEditor__stepper--${stepper.steps.length}`">
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
    <!-- 動かせる欄を選んでいないとき: 同じ形の押せないボタンを置き、操作の場所を見せたままにする -->
    <div v-else class="fineTuneEditor__stepper fineTuneEditor__stepper--3" data-testid="fine-tune-editor-idle" aria-hidden="true">
      <button v-for="amount in IDLE_STEPS" :key="`down-${amount}`" class="fineTuneEditor__step" type="button" tabindex="-1" disabled>−{{ amount }}</button>
      <input class="field__input fineTuneEditor__input" type="text" tabindex="-1" disabled value="" />
      <button v-for="amount in [...IDLE_STEPS].reverse()" :key="`up-${amount}`" class="fineTuneEditor__step" type="button" tabindex="-1" disabled>+{{ amount }}</button>
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
import {
  FINE_TUNE_STEPS,
  LEVEL_PRESETS,
  SLEEP_STOCK_EMOJI,
  SLEEP_TICKET_EMOJI,
  sleepReachText,
  sleepTargetText,
  type FineTuneField,
} from "../utils/fineTuneView";
import { SLEEP_TARGET_HOURS_OPTIONS } from "../domain/types";
import { sleepTargetOfChoice, type SleepTargetChoice } from "../domain/sleep-target";

/**
 * かんたんの調整バー。表で押した欄（目標Lv・アメブ・アメ）を刻みのボタンと個数欄で、睡眠を選択肢で動かす。
 * 目標Lvは Lvピッカーと同じ形（スライダー・◀ ▶・Lv の丸いボタン）。アメブには最小アメブ・リセットも置く。
 * キャンセルは、この欄を押してからの変更を取り消す（戻すのは親。`canCancel` と `cancel`）。
 * 行の詳細（到達・睡眠のあと・足りないもの・動かせない理由）と「〇〇のLvを上げる」もここに出す。
 * 値と範囲は `FineTuneRowView` に入っているものを使い、op を投げるだけ（範囲に収めるのは reducer）。
 */
const props = defineProps<{
  /** 選んだ行。何も選んでいなければ null（案内だけを出す） */
  row: FineTuneRowView | null;
  field: FineTuneField | null;
  /** 最新の結果が今の下書きの結果でない。結果に頼る操作（おすすめ）を押せなくする */
  pending: boolean;
  /** 「全体のLvを伸ばす」を求めている間。どの操作も押せなくする */
  busy: boolean;
  /** 設定で全員に最小アメブを使っている（行ごとの最小アメブは切り替えられない） */
  globalMinimize: boolean;
  /** この欄を押してから変えた（キャンセルで押す前へ戻せる） */
  canCancel: boolean;
  fmt: (n: number) => string;
  titleOf: (rowId: string) => string;
}>();

const emit = defineEmits<{
  (e: "op", op: FineTuneOp): void;
  /** キャンセル（この欄を押す前の値へ戻して、選択を外す） */
  (e: "cancel"): void;
}>();

/** 何も選んでいないときに並べる、押せない刻みのボタン */
const IDLE_STEPS = FINE_TUNE_STEPS.boost;

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
  if (row === null) return null;
  const rowId = row.id;
  const labelOf = (key: "target" | "boost" | "candy") => t(`calc.fineTune.field.${key}`);
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
      // 目標Lvは刻みのボタンでなく、Lvピッカーと同じ形（◀ ▶・スライダー・Lv の丸いボタン）で動かす
      steps: [],
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
  if (field === "candy" && row.candyEdit !== null) {
    const label = labelOf("candy");
    return {
      label,
      inputLabel: inputLabelOf(label),
      value: row.candyEdit.value,
      base: row.candyEdit.base,
      min: row.candyEdit.min,
      max: row.candyEdit.max,
      steps: FINE_TUNE_STEPS.candy,
      stepOp: (by) => ({ kind: "candyStep", rowId, by }),
      setOp: (candy) => ({ kind: "candySet", rowId, candy }),
    };
  }
  return null;
});

/** 基準からの変化（変わっていなければ null）。睡眠は目標の名前で出す */
const changeText = computed(() => {
  const { row, field } = props;
  if (row !== null && field === "sleep") {
    if (!row.sleepTarget.changed) return null;
    const label = (choice: SleepTargetChoice) => {
      const text = sleepTargetText(t, choice);
      return `${choice.base === "none" ? t("calc.fineTune.sleepOption.none") : text.name}${text.icons}`;
    };
    return `${label(row.sleepTarget.base)} → ${label(row.sleepTarget.choice)}`;
  }
  const s = stepper.value;
  if (s === null || s.value === s.base) return null;
  return `${props.fmt(s.base)} → ${props.fmt(s.value)}`;
});

// ===== 行の詳細 =====
const infoItems = computed(() => {
  const { row } = props;
  const items: Array<{ text: string; short: boolean }> = [];
  if (row === null) return items;
  const level = row.reachLevel.value;
  if (level !== null) {
    const exp = row.expToNext.value;
    // 計算機の行と同じ「到達Lv 63（あとEXP 358）」。あとEXP は次のLvまでのEXP
    const left = level < MAX_LEVEL && exp !== null && exp > 0 ? t("calc.fineTune.expLeft", { exp: props.fmt(exp) }) : "";
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

/** 目標Lv・アメブを動かせない理由（アメの欄では出さない） */
const noteText = computed(() => {
  const { row, field } = props;
  if (row === null || field === "candy") return null;
  if (row.candyEdited) return t("calc.fineTune.candyEdited");
  return row.exclusion === null ? null : t(EXCLUSION_TEXT[row.exclusion]);
});

// ===== 「〇〇のLvを上げる」（行の詳細とアメブで出す） =====
const recommendation = computed(() => {
  if (props.row === null || (props.field !== "row" && props.field !== "boost")) return null;
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
  const current = props.row?.boost?.value;
  if (rec === null || current === undefined) return "";
  const delta = rec.boost - current;
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${props.fmt(Math.abs(delta))}`;
});

// ===== アメブの最小アメブ・リセット =====
const boostTools = computed(() => {
  const { row, field } = props;
  if (row === null || field !== "boost" || !row.levelAdjustable || row.boost === null) return null;
  const { minimized, canMinimize, manual } = row.boost;
  const minimizeTitle = props.globalMinimize
    ? t("calc.fineTune.boostMinimizeGlobal")
    : canMinimize || minimized ? t("calc.fineTune.boostMinimizeTitle") : t("calc.fineTune.boostMinimizeUnavailable");
  return { minimized, canMinimize, manual, minimizeTitle };
});

// ===== 睡眠目標 =====
const sleepEditor = computed(() => {
  const { row, field } = props;
  if (row === null || field !== "sleep") return null;
  const current = row.sleepTarget.choice;
  const stock = (current.base === "sleep" || current.base === "napIsland") && current.stock;
  const ticket = current.base === "napIsland" && current.ticket;
  const options: Array<{ key: string; label: string; choice: SleepTargetChoice; selected: boolean }> = [
    { key: "none", label: t("calc.fineTune.sleepOption.none"), choice: { base: "none" }, selected: current.base === "none" },
    ...SLEEP_TARGET_HOURS_OPTIONS.map((hours) => ({
      key: `h${hours}`,
      label: sleepTargetText(t, { base: "hours", hours }).name,
      choice: { base: "hours", hours } as SleepTargetChoice,
      selected: current.base === "hours" && current.hours === hours,
    })),
    // 全て・おひるね島へ移るときは、アメ在庫の印を持ち越す（チケットはおひるね島どうしだけ）
    { key: "sleep", label: t("calc.fineTune.sleepOption.all"), choice: { base: "sleep", stock }, selected: current.base === "sleep" },
    { key: "nap", label: t("calc.fineTune.sleepOption.nap"), choice: { base: "napIsland", stock, ticket }, selected: current.base === "napIsland" },
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
  if (props.row === null) return;
  emit("op", { kind: "sleepSet", rowId: props.row.id, target: sleepTargetOfChoice(choice) });
}

function toggleSleep(which: "stock" | "ticket"): void {
  const current = props.row?.sleepTarget.choice;
  if (current === undefined) return;
  if (current.base === "sleep" && which === "stock") chooseSleep({ ...current, stock: !current.stock });
  if (current.base === "napIsland") chooseSleep({ ...current, [which]: !current[which] });
}

// ===== 刻みのボタンと個数欄（確定は blur。テンキーは ui_spec §8） =====
function stepBy(by: number): void {
  const s = stepper.value;
  if (s !== null) emit("op", s.stepOp(by));
}

/** 目標Lvのスライダー・Lv の丸いボタン */
function setLevel(raw: string): void {
  const s = stepper.value;
  const level = Number(raw);
  if (s !== null && Number.isFinite(level) && level !== s.value) emit("op", s.setOp(level));
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
