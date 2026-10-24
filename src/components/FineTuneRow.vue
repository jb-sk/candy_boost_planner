<template>
  <div
    class="fineTuneRow"
    :class="{
      'fineTuneRow--noBoost': !hasBoost,
      'fineTuneRow--yield': mode === 'yield',
      'fineTuneRow--give': mode === 'yield' && row.giver !== null,
      'fineTuneRow--excluded': row.exclusion !== null,
      'fineTuneRow--dragging': dragging,
      'fineTuneRow--dragOver': dragOver,
      'fineTuneRow--pending': pending,
    }"
    data-testid="fine-tune-row"
    :data-row-id="row.id"
    :data-reached="row.reached.value === null ? undefined : String(row.reached.value)"
  >
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
      @keydown="onHandleKeydown"
    >
      <svg class="fineTuneRow__handleIcon" aria-hidden="true" viewBox="0 0 16 17" width="14" height="15"><path d="M4.5 5.5L8 2 11.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 11.5L8 15 11.5 11.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>

    <div class="fineTuneRow__name" :title="nameTitle">
      <span class="fineTuneRow__title" data-testid="fine-tune-row-title">{{ row.title }}</span>
      <span v-if="natureMark !== null" class="fineTuneRow__nature" :class="`fineTuneRow__nature--${row.nature}`" aria-hidden="true">{{ natureMark }}</span>
      <button
        v-if="mode === 'yield' && row.receivable"
        data-testid="fine-tune-row-receive"
        class="btn btn--soft fineTuneRow__chip"
        type="button"
        :disabled="pending"
        @click="emit('op', { kind: 'receiverSelect', rowId: row.id })"
      >{{ t("calc.fineTune.receive") }}</button>
    </div>

    <div v-if="mode === 'raise' && hasBoost" class="fineTuneRow__cell fineTuneRow__cell--advice">
      <span v-if="rankText !== null" class="fineTuneRow__rank" data-testid="fine-tune-row-rank" :title="rankTitle">{{ rankText }}</span>
      <button
        v-if="recommendation !== null"
        data-testid="fine-tune-row-recommend"
        class="btn btn--soft fineTuneRow__chip"
        type="button"
        :title="recommendTitle"
        :disabled="pending"
        @click="emit('op', { kind: 'set', rowId: row.id, boost: recommendation.boost })"
      >{{ recommendLabel }}</button>
    </div>

    <div class="fineTuneRow__cell fineTuneRow__cell--target">
      <span class="fineTuneRow__label">{{ t("calc.row.dstLevel") }}</span>
      <button v-if="raiseControls" data-testid="fine-tune-row-target-down" class="fineTuneRow__step" type="button" :aria-label="t('calc.fineTune.targetDown')" :disabled="!row.targetRange.canDown" @click="emit('op', { kind: 'targetStep', rowId: row.id, by: -1 })">▼</button>
      <span class="fineTuneRow__value" :class="{ 'fineTuneRow__value--changed': row.targetLevel.base !== row.targetLevel.value }" data-testid="fine-tune-row-target-level">{{ row.targetLevel.value }}</span>
      <button v-if="raiseControls" data-testid="fine-tune-row-target-up" class="fineTuneRow__step" type="button" :aria-label="t('calc.fineTune.targetUp')" :disabled="!row.targetRange.canUp" @click="emit('op', { kind: 'targetStep', rowId: row.id, by: 1 })">▲</button>
      <!-- 増減は場所を常に取っておく（出たときに ▼▲ と欄が縮んで動かないように） -->
      <span class="fineTuneRow__delta fineTuneRow__delta--target" data-testid="fine-tune-row-target-delta">{{ deltaText(row.targetLevel) }}</span>
    </div>

    <div class="fineTuneRow__cell fineTuneRow__cell--exp">
      <div class="fineTuneBar" data-testid="fine-tune-row-bar" :data-percent="barPercent === null ? undefined : String(Math.round(barPercent))">
        <div class="fineTuneBar__fill" :style="{ width: `${barPercent ?? 0}%` }"></div>
        <div v-if="barBaseMark !== null" class="fineTuneBar__base" :style="{ left: `${barBaseMark}%` }"></div>
        <div v-if="mode === 'yield' && barTarget !== null" class="fineTuneBar__target" data-testid="fine-tune-row-bar-target" :style="{ left: `${barTarget}%` }"></div>
      </div>
      <span v-if="reachLevel !== null" class="fineTuneRow__reach" :class="{ 'fineTuneRow__value--changed': reachChanged, 'fineTuneRow__value--short': short }" :title="reachTitle">
        <span data-testid="fine-tune-row-reach-level">Lv{{ reachLevel }}</span>
        <span v-if="expLeftText !== null" class="fineTuneRow__expLeft" data-testid="fine-tune-row-exp-left">{{ expLeftText }}</span>
      </span>
    </div>

    <div v-if="hasSleep" class="fineTuneRow__cell fineTuneRow__cell--sleep" :title="sleepTitle">
      <span class="fineTuneRow__label">{{ t(sleepLabelKey) }}</span>
      <span
        v-if="row.sleepReach !== null"
        class="fineTuneRow__value"
        :class="{ 'fineTuneRow__value--short': short }"
        data-testid="fine-tune-row-sleep-reach"
        :data-short="String(short)"
      >{{ sleepReachText }}</span>
    </div>

    <div v-if="hasBoost" class="fineTuneRow__cell fineTuneRow__cell--boost" :title="cappedTitle">
      <span class="fineTuneRow__label">{{ t("calc.row.breakdownBoost") }}</span>
      <template v-if="row.boost !== null">
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
        <span v-else class="fineTuneRow__value" :class="{ 'fineTuneRow__value--changed': row.boost.base !== row.boost.value }" data-testid="fine-tune-row-boost-value">{{ fmt(row.boost.value) }}</span>
        <button v-if="raiseControls" data-testid="fine-tune-row-boost-up" class="fineTuneRow__step" type="button" :aria-label="t('calc.fineTune.boostUp')" :disabled="row.boost.value >= row.boost.range.max" @click="emit('op', { kind: 'step', rowId: row.id, by: step })">▲</button>
        <span class="fineTuneRow__delta fineTuneRow__delta--boost" data-testid="fine-tune-row-boost-delta">{{ deltaText(row.boost) }}</span>
      </template>
    </div>

    <div class="fineTuneRow__cell fineTuneRow__cell--candy" :title="changeTitle(row.candy)">
      <span class="fineTuneRow__label">{{ t("calc.row.candy") }}</span>
      <template v-if="mode === 'yield' && row.giver !== null">
        <div class="fineTuneRow__give" data-testid="fine-tune-row-give" :title="giveTitle">
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
          <span class="fineTuneRow__value" :class="{ 'fineTuneRow__value--changed': giveValue !== row.giver.m0 }" data-testid="fine-tune-row-give-value">{{ fmt(giveValue) }}</span>
        </div>
      </template>
      <span v-else class="fineTuneRow__value" :class="{ 'fineTuneRow__value--changed': changed(row.candy) }" data-testid="fine-tune-row-candy">{{ valueText(row.candy) }}</span>
    </div>

    <div class="fineTuneRow__cell fineTuneRow__cell--shards" :title="changeTitle(row.shards)">
      <span class="fineTuneRow__label">{{ t("calc.row.shards") }}</span>
      <span class="fineTuneRow__value" :class="{ 'fineTuneRow__value--changed': changed(row.shards) }" data-testid="fine-tune-row-shards">{{ valueText(row.shards) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp, RowExclusion } from "../domain/fine-tune/draft";
import type { Change, FineTuneRowView, GiverPreview } from "../domain/fine-tune/rowView";
import { maxLevel as MAX_LEVEL } from "../domain/pokesleep/tables";
import { vKeypad } from "../composables/useNumericKeypad";

/**
 * やりくりモーダルの1行（設計書 §4.4）。表示と op を投げることだけを持つ。
 * 上限・順位・診断の計算は持たない（`FineTuneRowView` に入っている値を出すだけ）。
 * 行には値と操作だけを出し、理由や基準の値は title（ホバー）に回す。
 */
const props = defineProps<{
  row: FineTuneRowView;
  mode: "raise" | "yield";
  hasBoost: boolean;
  /** 一覧に睡眠到達Lv の列があるか（睡眠のある行が1匹でもいる） */
  hasSleep: boolean;
  /** 最新の結果が今の下書きの結果でない。変更後の値を薄くし、結果に頼る操作を押せなくする */
  pending: boolean;
  /** 1回に動かす量 */
  step: number;
  isFirst: boolean;
  isLast: boolean;
  dragging: boolean;
  dragOver: boolean;
  fmt: (n: number) => string;
  /** ゆずる側のスライダーを動かしている間の棒（この行のものだけ。無ければ null） */
  live: GiverPreview | null;
  /** 行名を引く（おすすめの対象の名前） */
  titleOf: (rowId: string) => string;
}>();

const emit = defineEmits<{
  (e: "op", op: FineTuneOp): void;
  (e: "handle-press", rowId: string, event: Event): void;
  /** スライダーを動かしている間の値（A の棒と案内に使う。op は投げない） */
  (e: "give-input", rowId: string, candy: number): void;
  /** スライダーを離した（op を投げたあとに上がる） */
  (e: "give-release"): void;
}>();

const { t } = useI18n();

const EXCLUSION_TEXT: Readonly<Record<RowExclusion, string>> = {
  candyTarget: "calc.fineTune.exclusion.candyTarget",
  noCandy: "calc.fineTune.exclusion.noCandy",
  sleepOnly: "calc.fineTune.exclusion.sleepOnly",
  maxLevel: "calc.fineTune.exclusion.maxLevel",
  unknownPokemon: "calc.fineTune.exclusion.unknownPokemon",
};

/** モード1の目標Lv・アメブの操作を出す行 */
const raiseControls = computed(() => props.mode === "raise" && props.row.mode1);

const natureMark = computed(() => {
  if (props.row.nature === "up") return t("calc.row.natureUp");
  if (props.row.nature === "down") return t("calc.row.natureDown");
  return null;
});

/** 操作できない理由（ホバーで出す） */
const nameTitle = computed(() => {
  if (props.row.exclusion !== null) return t(EXCLUSION_TEXT[props.row.exclusion]);
  if (props.row.giverLocked && props.mode === "raise") return t("calc.fineTune.giverLocked");
  return undefined;
});

function signed(delta: number): string {
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${props.fmt(Math.abs(delta))}`;
}

/** 基準からの増減（変わっていなければ空） */
function deltaText(c: Change<number>): string {
  return c.base === c.value ? "" : signed(c.value - c.base);
}

function changed(c: Change<number | null>): boolean {
  return c.base !== null && c.value !== null && c.base !== c.value;
}

function valueText(c: Change<number | null>): string {
  return c.value === null ? "-" : props.fmt(c.value);
}

/** 基準から変わった値は、基準の値をホバーで出す */
function changeTitle(c: Change<number | null>): string | undefined {
  return changed(c) ? `${props.fmt(c.base!)} → ${props.fmt(c.value!)}` : undefined;
}

// ===== EXP の棒と到達Lv・あとEXP（D45。ゲームと同じく到達Lvの中の進み。Lv ちょうどなら空） =====
// ゆずる側のスライダーを動かしている間は、動かしている値の到達点（live）を出す
const barPercent = computed(() => (props.live !== null ? props.live.fill : props.row.bars.progress.value));
const reachLevel = computed(() => (props.live !== null ? props.live.level : props.row.reachLevel.value));
const expToNext = computed(() => (props.live !== null ? props.live.expToNext : props.row.expToNext.value));
const barTarget = computed(() => (props.live !== null ? props.live.target : props.row.bars.yieldTarget));
/** 基準の位置。変わっていないとき（同じ点）と、到達Lvが変わったとき（Lv が変わると棒は一周する）は出さない */
const barBaseMark = computed(() => {
  const { progress } = props.row.bars;
  if (props.live !== null || props.row.reachLevel.base !== props.row.reachLevel.value || progress.base === progress.value) return null;
  return progress.base;
});

function expLeftOf(level: number | null, exp: number | null): string | null {
  if (level === null || level >= MAX_LEVEL || exp === null) return null;
  return t("calc.fineTune.expLeft", { exp: props.fmt(exp) });
}
const expLeftText = computed(() => expLeftOf(reachLevel.value, expToNext.value));
const reachChanged = computed(() => {
  const base = props.row.reachLevel.base;
  return base !== null && reachLevel.value !== null
    && (base !== reachLevel.value || props.row.expToNext.base !== expToNext.value);
});
const reachTitle = computed(() => {
  const base = props.row.reachLevel.base;
  if (!reachChanged.value || base === null) return undefined;
  const join = (level: number | null, text: string | null) => `Lv${level}${text === null ? "" : ` ${text}`}`;
  return `${join(base, expLeftOf(base, props.row.expToNext.base))} → ${join(reachLevel.value, expLeftText.value)}`;
});

// ===== 不足（D47）。目標Lvに届かない行は、到達Lvと睡眠到達Lvを赤にする。睡眠のある行は睡眠のあとも届かない（リソースが足りない） =====
const short = computed(() => props.row.reached.value === false);

// ===== 睡眠到達Lv（D46。島の行は島到達Lv） =====
const sleepLabelKey = computed(() => (props.row.sleepReach?.kind === "napIsland" ? "calc.row.napReachedLv" : "calc.row.sleepReachedLv"));
/** 「60.2」。「約」は付けず、小数第1位が 0（と Lv70）は整数だけ */
const sleepReachText = computed(() => {
  const reach = props.row.sleepReach;
  if (reach === null) return "";
  return reach.tenths === null || reach.tenths === 0 ? `${reach.level}` : `${reach.level}.${reach.tenths}`;
});
const sleepTitle = computed(() => {
  if (props.row.sleepReach === null) return undefined;
  return short.value ? `${t(sleepLabelKey.value)}: ${t("calc.fineTune.sleepReachShort")}` : t(sleepLabelKey.value);
});

const cappedTitle = computed(() => {
  const cappedTo = props.row.boost?.cappedTo ?? null;
  return cappedTo === null ? undefined : t("calc.fineTune.boostCapped", { count: props.fmt(cappedTo) });
});

// ===== おすすめ順・おすすめ量（モード1だけ） =====
const advice = computed(() => (props.mode === "raise" ? props.row.advice : undefined));

const rankText = computed(() => {
  const rank = advice.value?.rank ?? null;
  return rank === null ? null : t("calc.fineTune.rank", { rank });
});

const rankTitle = computed(() => {
  const marginal = advice.value?.marginal;
  if (marginal === null || marginal === undefined) return undefined;
  return t(marginal.to > marginal.from ? "calc.fineTune.rankIncrease" : "calc.fineTune.rankDecrease");
});

const recommendation = computed(() => advice.value?.recommendation ?? null);

/** 入る数の増減（アメブ+120 など）。おすすめの対象の名前は title に回す */
const recommendLabel = computed(() => {
  const rec = recommendation.value;
  if (rec === null || props.row.boost === null) return "";
  return t("calc.fineTune.recommendShort", { delta: signed(rec.boost - props.row.boost.value) });
});

const recommendTitle = computed(() => {
  const rec = recommendation.value;
  if (rec === null) return undefined;
  const name = t(rec.andOthers ? "calc.fineTune.recommendMany" : "calc.fineTune.recommend", { name: props.titleOf(rec.targetRowId) });
  return rec.insufficient ? t("calc.fineTune.recommendInsufficient", { label: name }) : name;
});

// ===== 並べ替え（取っ手をつかんで動かす。キーボードは取っ手の ↑↓ キー） =====
function onHandleKeydown(event: KeyboardEvent): void {
  const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (by === 0) return;
  event.preventDefault();
  if ((by < 0 && props.isFirst) || (by > 0 && props.isLast)) return;
  emit("op", { kind: "move", rowId: props.row.id, toIndex: props.row.index + by });
}

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

// ===== ゆずる側のスライダー（アメの欄に置く。動かしている間は棒と数字だけ。離したとき op を投げる、§6.2） =====
const giveDraft = ref<number | null>(null);
const giveValue = computed(() => giveDraft.value ?? props.row.giver?.value ?? 0);

/** 減らしたとき、適用すると個数指定の行になること（ホバーで出す） */
const giveTitle = computed(() => {
  const giver = props.row.giver;
  if (giver === null || giveValue.value === giver.m0) return undefined;
  return t("calc.fineTune.giveApplyNote", { count: props.fmt(giveValue.value) });
});

function onGiveInput(raw: string): void {
  giveDraft.value = Number(raw);
  emit("give-input", props.row.id, giveDraft.value);
}

function onGiveChange(raw: string): void {
  giveDraft.value = null;
  emit("op", { kind: "giverSet", rowId: props.row.id, candy: Number(raw) });
  emit("give-release");
}
</script>
