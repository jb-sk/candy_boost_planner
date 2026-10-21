<template>
  <div
    class="fineTuneRow"
    :class="{
      'fineTuneRow--noBoost': !hasBoost,
      'fineTuneRow--excluded': row.exclusion !== null,
      'fineTuneRow--dragging': dragging,
      'fineTuneRow--dragOver': dragOver,
      'fineTuneRow--pending': pending,
    }"
    data-testid="fine-tune-row"
    :data-row-id="row.id"
    :data-reached="row.reached.value === null ? undefined : String(row.reached.value)"
  >
    <div class="fineTuneRow__move">
      <button
        data-testid="fine-tune-row-handle"
        class="fineTuneRow__handle"
        type="button"
        :title="t('calc.row.dragReorder')"
        :aria-label="t('calc.row.dragReorder')"
        @pointerdown="emit('handle-press', row.id, $event)"
        @touchstart="emit('handle-press', row.id, $event)"
        @mousedown="emit('handle-press', row.id, $event)"
        @click.stop
      >
        <svg class="fineTuneRow__handleIcon" aria-hidden="true" viewBox="0 0 16 17" width="14" height="15"><path d="M4.5 5.5L8 2 11.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 11.5L8 15 11.5 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="fineTuneRow__arrows">
        <button data-testid="fine-tune-row-up" class="fineTuneRow__arrow" type="button" :aria-label="t('calc.fineTune.rowUp')" :disabled="isFirst" @click="emit('op', { kind: 'move', rowId: row.id, toIndex: row.index - 1 })">↑</button>
        <button data-testid="fine-tune-row-down" class="fineTuneRow__arrow" type="button" :aria-label="t('calc.fineTune.rowDown')" :disabled="isLast" @click="emit('op', { kind: 'move', rowId: row.id, toIndex: row.index + 1 })">↓</button>
      </div>
    </div>

    <div class="fineTuneRow__name">
      <div class="fineTuneRow__titleLine">
        <span class="fineTuneRow__title" data-testid="fine-tune-row-title">{{ row.title }}</span>
        <span v-if="natureMark !== null" class="fineTuneRow__nature" :class="`fineTuneRow__nature--${row.nature}`" aria-hidden="true">{{ natureMark }}</span>
      </div>
      <div class="fineTuneRow__tags">
        <span
          v-if="row.reached.value !== null"
          class="fineTuneRow__tag"
          :class="row.reached.value ? 'fineTuneRow__tag--ok' : 'fineTuneRow__tag--ng'"
          data-testid="fine-tune-row-status"
        >{{ statusText }}</span>
        <span v-if="row.isFirstShort" class="fineTuneRow__tag fineTuneRow__tag--first" data-testid="fine-tune-row-first-short">{{ t("calc.fineTune.statusFirstShort") }}</span>
        <span v-if="orderMoved" class="fineTuneRow__tag fineTuneRow__tag--order" data-testid="fine-tune-row-order">{{ t("calc.fineTune.order", { from: row.baseIndex + 1, to: row.index + 1 }) }} {{ row.index < row.baseIndex ? "↑" : "↓" }}</span>
        <span v-if="rankText !== null" class="fineTuneRow__tag fineTuneRow__tag--rank" data-testid="fine-tune-row-rank">{{ rankText }}</span>
      </div>
    </div>

    <div class="fineTuneRow__cell fineTuneRow__cell--target">
      <span class="fineTuneRow__label">{{ t("calc.row.dstLevel") }}</span>
      <div class="fineTuneRow__stepper">
        <button v-if="raiseControls" data-testid="fine-tune-row-target-down" class="fineTuneRow__step" type="button" :aria-label="t('calc.fineTune.targetDown')" :disabled="!row.targetRange.canDown" @click="emit('op', { kind: 'targetStep', rowId: row.id, by: -1 })">▼</button>
        <span class="fineTuneRow__value" :class="{ 'fineTuneRow__value--changed': row.targetLevel.base !== row.targetLevel.value }" data-testid="fine-tune-row-target-level">{{ row.targetLevel.value }}</span>
        <button v-if="raiseControls" data-testid="fine-tune-row-target-up" class="fineTuneRow__step" type="button" :aria-label="t('calc.fineTune.targetUp')" :disabled="!row.targetRange.canUp" @click="emit('op', { kind: 'targetStep', rowId: row.id, by: 1 })">▲</button>
      </div>
      <span v-if="row.targetLevel.base !== row.targetLevel.value" class="fineTuneRow__delta" data-testid="fine-tune-row-target-delta">{{ row.targetLevel.base }} → {{ row.targetLevel.value }}</span>
    </div>

    <div class="fineTuneRow__cell fineTuneRow__cell--exp">
      <div class="fineTuneBar" data-testid="fine-tune-row-bar" :data-percent="barPercent === null ? undefined : String(Math.round(barPercent))">
        <div class="fineTuneBar__fill" :style="{ width: `${barPercent ?? 0}%` }"></div>
        <div v-if="barBaseMark !== null" class="fineTuneBar__base" :style="{ left: `${barBaseMark}%` }"></div>
        <div v-if="mode === 'yield' && row.bars.yieldTarget !== null" class="fineTuneBar__target" data-testid="fine-tune-row-bar-target" :style="{ left: `${row.bars.yieldTarget}%` }"></div>
      </div>
      <span v-if="row.reachLevel.value !== null" class="fineTuneRow__reach">
        <span class="fineTuneRow__reachLabel">{{ t(row.candyReachLabel ? "calc.row.candyReachedLv" : "calc.row.reachedLv") }}</span>
        <span data-testid="fine-tune-row-reach-level">{{ reachLevelText }}</span>
      </span>
    </div>

    <div v-if="hasBoost" class="fineTuneRow__cell fineTuneRow__cell--boost">
      <span class="fineTuneRow__label">{{ t("calc.row.breakdownBoost") }}</span>
      <template v-if="row.boost !== null">
        <div class="fineTuneRow__stepper">
          <button v-if="raiseControls" data-testid="fine-tune-row-boost-down" class="fineTuneRow__step" type="button" :aria-label="t('calc.fineTune.boostDown')" :disabled="row.boost.value <= row.boost.range.min" @click="emit('op', { kind: 'step', rowId: row.id, by: -step })">▼</button>
          <input
            v-if="raiseControls"
            ref="boostInputRef"
            v-keypad="t('calc.fineTune.boostInput')"
            data-testid="fine-tune-row-boost-input"
            class="field__input fineTuneRow__input"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :aria-label="t('calc.fineTune.boostInput')"
            :value="boostDraft ?? String(row.boost.value)"
            @focus="boostDraft = String(row.boost?.value ?? 0)"
            @input="onBoostInput(($event.target as HTMLInputElement).value)"
            @blur="onBoostBlur"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
          <span v-else class="fineTuneRow__value" :class="{ 'fineTuneRow__value--changed': row.boost.base !== row.boost.value }" data-testid="fine-tune-row-boost-value">{{ changeText(row.boost.base, row.boost.value) }}</span>
          <button v-if="raiseControls" data-testid="fine-tune-row-boost-up" class="fineTuneRow__step" type="button" :aria-label="t('calc.fineTune.boostUp')" :disabled="row.boost.value >= row.boost.range.max" @click="emit('op', { kind: 'step', rowId: row.id, by: step })">▲</button>
        </div>
        <span v-if="row.boost.base !== row.boost.value" class="fineTuneRow__delta" data-testid="fine-tune-row-boost-delta">{{ row.boost.base }} → {{ row.boost.value }} ({{ signed(row.boost.value - row.boost.base) }})</span>
      </template>
    </div>

    <div class="fineTuneRow__cell fineTuneRow__cell--candy">
      <span class="fineTuneRow__label">{{ t("calc.row.candy") }}</span>
      <span class="fineTuneRow__value" :class="{ 'fineTuneRow__value--changed': changed(row.candy) }" data-testid="fine-tune-row-candy">{{ changeNumber(row.candy) }}</span>
      <span v-if="changed(row.candy)" class="fineTuneRow__delta">({{ signed(row.candy.value! - row.candy.base!) }})</span>
    </div>

    <div class="fineTuneRow__cell fineTuneRow__cell--shards">
      <span class="fineTuneRow__label">{{ t("calc.row.shards") }}</span>
      <span class="fineTuneRow__value" :class="{ 'fineTuneRow__value--changed': changed(row.shards) }" data-testid="fine-tune-row-shards">{{ changeNumber(row.shards) }}</span>
      <span v-if="changed(row.shards)" class="fineTuneRow__delta">({{ signed(row.shards.value! - row.shards.base!) }})</span>
    </div>

    <div class="fineTuneRow__sub">
      <p v-if="row.exclusion !== null" class="fineTuneRow__note" data-testid="fine-tune-row-excluded">{{ t(EXCLUSION_TEXT[row.exclusion]) }}</p>
      <p v-if="row.giverLocked && mode === 'raise'" class="fineTuneRow__note" data-testid="fine-tune-row-giver-locked">{{ t("calc.fineTune.giverLocked") }}</p>
      <p v-if="row.giverLocked && row.giver !== null" class="fineTuneRow__note" data-testid="fine-tune-row-give-note">{{ t("calc.fineTune.giveApplyNote", { count: fmt(row.giver.value) }) }}</p>
      <p v-if="row.boost !== null && row.boost.cappedTo !== null" class="fineTuneRow__note" data-testid="fine-tune-row-capped">{{ t("calc.fineTune.boostCapped", { count: fmt(row.boost.cappedTo) }) }}</p>

      <template v-if="mode === 'raise' && row.advice !== undefined">
        <p class="fineTuneRow__advice" data-testid="fine-tune-row-advice">
          <span>{{ adviceText }}</span>
          <span v-if="perBoostText !== null" class="fineTuneRow__perBoost" data-testid="fine-tune-row-per-boost">{{ perBoostText }}</span>
        </p>
        <p v-if="burdenText !== null" class="fineTuneRow__note" data-testid="fine-tune-row-burden">{{ burdenText }}</p>
        <div v-if="row.advice.recommendation !== null" class="fineTuneRow__recommend">
          <button
            data-testid="fine-tune-row-recommend"
            class="btn btn--soft"
            type="button"
            :title="t('calc.fineTune.recommendHint')"
            :disabled="pending"
            @click="emit('op', { kind: 'set', rowId: row.id, boost: row.advice.recommendation.boost })"
          >{{ recommendLabel }}</button>
          <span v-if="row.advice.recommendation.insufficient" class="fineTuneRow__note" data-testid="fine-tune-row-recommend-insufficient">{{ t("calc.fineTune.recommendInsufficient") }}</span>
        </div>
      </template>

      <button
        v-if="mode === 'yield' && row.receivable"
        data-testid="fine-tune-row-receive"
        class="btn btn--soft fineTuneRow__receive"
        type="button"
        :disabled="pending"
        @click="emit('op', { kind: 'receiverSelect', rowId: row.id })"
      >{{ t("calc.fineTune.receive") }}</button>

      <div v-if="mode === 'yield' && row.giver !== null" class="fineTuneRow__give" data-testid="fine-tune-row-give">
        <span class="fineTuneRow__giveLabel">{{ t("calc.fineTune.giveLabel") }}</span>
        <button data-testid="fine-tune-row-give-down" class="fineTuneRow__step" type="button" :aria-label="t('calc.fineTune.giveDown')" :disabled="giveValue <= 0" @click="emit('op', { kind: 'giverStep', rowId: row.id, by: -step })">▼</button>
        <input
          class="fineTuneRow__slider"
          data-testid="fine-tune-row-give-slider"
          type="range"
          min="0"
          :max="row.giver.m0"
          step="1"
          :value="giveValue"
          :aria-label="t('calc.fineTune.giveAdjust', { name: row.title })"
          @input="onGiveInput(($event.target as HTMLInputElement).value)"
          @change="onGiveChange(($event.target as HTMLInputElement).value)"
        />
        <button data-testid="fine-tune-row-give-up" class="fineTuneRow__step" type="button" :aria-label="t('calc.fineTune.giveUp')" :disabled="giveValue >= row.giver.m0" @click="emit('op', { kind: 'giverStep', rowId: row.id, by: step })">▲</button>
        <span class="fineTuneRow__giveValue" data-testid="fine-tune-row-give-value">{{ giveValue === row.giver.m0 ? fmt(giveValue) : `${fmt(row.giver.m0)} → ${fmt(giveValue)}` }}</span>
        <span v-if="row.giver.usable !== null && row.giver.usable < giveValue" class="fineTuneRow__note" data-testid="fine-tune-row-give-usable">{{ t("calc.fineTune.giveUsable", { count: fmt(row.giver.usable) }) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { NoEffectReason, RowAdvice } from "../domain/fine-tune/advice";
import type { FineTuneOp, RowExclusion } from "../domain/fine-tune/draft";
import type { Change, FineTuneRowView } from "../domain/fine-tune/rowView";
import { vKeypad } from "../composables/useNumericKeypad";

/**
 * やりくりモーダルの1行（設計書 §4.4）。表示と op を投げることだけを持つ。
 * 上限・順位・診断の計算は持たない（`FineTuneRowView` に入っている値を出すだけ）。
 * 行の種類・効果の kind から文言を引く表で分岐する。
 */
const props = defineProps<{
  row: FineTuneRowView;
  mode: "raise" | "yield";
  hasBoost: boolean;
  /** 最新の結果が今の下書きの結果でない（プレビュー計算中）。変更後の値を薄くする */
  pending: boolean;
  /** 1回に動かす量 */
  step: number;
  isFirst: boolean;
  isLast: boolean;
  dragging: boolean;
  dragOver: boolean;
  fmt: (n: number) => string;
  /** 行名を引く（効果の札の名前） */
  titleOf: (rowId: string) => string;
}>();

const emit = defineEmits<{
  (e: "op", op: FineTuneOp): void;
  (e: "handle-press", rowId: string, event: Event): void;
  /** スライダーを動かしている間 true（離すと計算する、の案内に使う） */
  (e: "give-active", active: boolean): void;
}>();

const { t } = useI18n();

const EXCLUSION_TEXT: Readonly<Record<RowExclusion, string>> = {
  candyTarget: "calc.fineTune.exclusion.candyTarget",
  noCandy: "calc.fineTune.exclusion.noCandy",
  sleepOnly: "calc.fineTune.exclusion.sleepOnly",
  maxLevel: "calc.fineTune.exclusion.maxLevel",
  unknownPokemon: "calc.fineTune.exclusion.unknownPokemon",
};

const ADVICE_TEXT: Readonly<Record<Exclude<RowAdvice["kind"], "feedsBelow" | "noEffect">, string>> = {
  selfShort: "calc.fineTune.advice.selfShort",
  sameStockMoreExp: "calc.fineTune.advice.sameStockMoreExp",
  saving: "calc.fineTune.advice.saving",
};

const NO_EFFECT_TEXT: Readonly<Record<NoEffectReason, string>> = {
  speciesOnly: "calc.fineTune.advice.speciesOnly",
  belowShortRows: "calc.fineTune.advice.belowShortRows",
  noBoost: "calc.fineTune.advice.noBoost",
  shardsLimited: "calc.fineTune.advice.shardsLimited",
  boostCapLimited: "calc.fineTune.advice.boostCapLimited",
  atFullBoost: "calc.fineTune.advice.atFullBoost",
};

/** モード1の目標Lv・アメブの操作を出す行 */
const raiseControls = computed(() => props.mode === "raise" && props.row.mode1);

const natureMark = computed(() => {
  if (props.row.nature === "up") return t("calc.row.natureUp");
  if (props.row.nature === "down") return t("calc.row.natureDown");
  return null;
});

const orderMoved = computed(() => props.row.baseIndex >= 0 && props.row.baseIndex !== props.row.index);

function changeText(base: number, value: number): string {
  return base === value ? props.fmt(value) : `${props.fmt(base)} → ${props.fmt(value)}`;
}

function signed(delta: number): string {
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${props.fmt(Math.abs(delta))}`;
}

function changed(c: Change<number | null>): boolean {
  return c.base !== null && c.value !== null && c.base !== c.value;
}

function changeNumber(c: Change<number | null>): string {
  if (c.value === null) return "-";
  if (c.base === null || c.base === c.value) return props.fmt(c.value);
  return `${props.fmt(c.base)} → ${props.fmt(c.value)}`;
}

const statusText = computed(() => {
  const { base, value } = props.row.reached;
  const label = (reached: boolean | null) => t(reached ? "calc.fineTune.statusReached" : "calc.fineTune.statusUnreached");
  return base === null || base === value ? label(value) : `${label(base)} → ${label(value)}`;
});

const reachLevelText = computed(() => {
  const { base, value } = props.row.reachLevel;
  if (value === null) return "";
  return base === null || base === value ? `Lv${value}` : `Lv${base} → Lv${value}`;
});

// ===== EXP の棒（D30。モード1は到達Lvの次のLvまで、モード2は現在Lv→基準の目標） =====
const barPercent = computed(() => (props.mode === "raise" ? props.row.bars.raise.value : props.row.bars.yield.value));
const barBaseMark = computed(() => {
  if (props.mode === "yield") return props.row.bars.yield.base;
  // モード1は到達Lvが基準と同じときだけ、基準の位置を重ねる（Lv が変わると棒は一周する）
  return props.row.reachLevel.base === props.row.reachLevel.value ? props.row.bars.raise.base : null;
});

// ===== 順位・効果 =====
const rankText = computed(() => {
  const rank = props.mode === "raise" ? props.row.advice?.rank ?? null : null;
  return rank === null ? null : t("calc.fineTune.rank", { rank });
});

const adviceText = computed(() => {
  const advice = props.row.advice?.advice;
  if (advice === undefined) return "";
  switch (advice.kind) {
    case "feedsBelow":
      return t(advice.beneficiaryIds.length >= 2 ? "calc.fineTune.advice.feedsBelowMany" : "calc.fineTune.advice.feedsBelow", {
        name: props.titleOf(advice.beneficiaryIds[0]!),
      });
    case "noEffect":
      return `${t("calc.fineTune.advice.noEffect")}: ${t(NO_EFFECT_TEXT[advice.reason])}`;
    default:
      return t(ADVICE_TEXT[advice.kind]);
  }
});

/** 1個あたりのかけら（押したときの変化 ÷ 動く個数。符号つき） */
const perBoostText = computed(() => {
  const marginal = props.row.advice?.marginal;
  if (marginal === null || marginal === undefined || marginal.to === marginal.from) return null;
  const perUnit = Math.round(marginal.deltaShards / Math.abs(marginal.to - marginal.from));
  return t("calc.fineTune.shardsPerBoost", { value: signed(perUnit) });
});

const burdenText = computed(() => {
  const burden = props.row.advice?.burden;
  if (burden === null || burden === undefined || burden.extraCandy <= 0) return null;
  return burden.covered
    ? t("calc.fineTune.burden.covered", { count: props.fmt(burden.speciesRemaining - burden.extraCandy) })
    : t("calc.fineTune.burden.short");
});

const recommendLabel = computed(() => {
  const rec = props.row.advice?.recommendation;
  if (rec === null || rec === undefined) return "";
  return t(rec.andOthers ? "calc.fineTune.recommendMany" : "calc.fineTune.recommend", { name: props.titleOf(rec.targetRowId) });
});

// ===== アメブの個数欄（確定は blur。ui_spec §8 のテンキー） =====
const boostInputRef = ref<HTMLInputElement | null>(null);
const boostDraft = ref<string | null>(null);

function onBoostInput(raw: string): void {
  boostDraft.value = raw.replace(/[^0-9]/g, "");
}

function onBoostBlur(): void {
  const draft = boostDraft.value;
  boostDraft.value = null;
  if (draft !== null && draft !== "") {
    emit("op", { kind: "set", rowId: props.row.id, boost: Number(draft) });
  }
  // 値が変わらない（範囲の端に合わせた結果が元の値と同じ）ときも、欄に打ちかけの文字を残さない
  void nextTick(() => {
    const el = boostInputRef.value;
    if (el && props.row.boost !== null) el.value = String(props.row.boost.value);
  });
}

// ===== ゆずる側のスライダー（動かしている間は棒と数字だけ。離したとき op を投げる、§6.2） =====
const giveDraft = ref<number | null>(null);
const giveValue = computed(() => giveDraft.value ?? props.row.giver?.value ?? 0);

function onGiveInput(raw: string): void {
  giveDraft.value = Number(raw);
  emit("give-active", true);
}

function onGiveChange(raw: string): void {
  giveDraft.value = null;
  emit("give-active", false);
  emit("op", { kind: "giverSet", rowId: props.row.id, candy: Number(raw) });
}
</script>
