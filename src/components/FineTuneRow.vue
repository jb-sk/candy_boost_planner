<template>
  <div
    class="fineTuneRow"
    :class="{
      'fineTuneRow--selected': selectedField !== null,
      'fineTuneRow--excluded': row.exclusion !== null,
      'fineTuneRow--dragging': dragging,
      'fineTuneRow--dragOver': dragOver,
      'fineTuneRow--pending': pending,
    }"
    data-testid="fine-tune-row"
    :data-row-id="row.id"
    :data-reached="row.reached.value === null ? undefined : String(row.reached.value)"
    :data-reach-level="row.reachLevel.value ?? undefined"
    :data-exp-left="row.expToNext.value ?? undefined"
  >
    <!-- 取っ手は PC幅（680px 以上）だけ出す（スマホ幅は名前の列を広く取るため消し、名前を長押ししてつかむ） -->
    <button
      data-testid="fine-tune-row-handle"
      class="fineTuneRow__handle"
      type="button"
      :aria-label="t('calc.row.dragReorder')"
      @pointerdown="emit('handle-press', row.id, $event)"
      @touchstart="emit('handle-press', row.id, $event)"
      @mousedown="emit('handle-press', row.id, $event)"
      @click.stop
      @keydown="onHandleKeydown"
    >
      <!-- つかんで動かす印（6つの点のグリップ） -->
      <svg class="fineTuneRow__handleIcon" aria-hidden="true" viewBox="0 0 16 17" width="12" height="13"><g fill="currentColor"><circle cx="5.5" cy="3.5" r="1.6"/><circle cx="10.5" cy="3.5" r="1.6"/><circle cx="5.5" cy="8.5" r="1.6"/><circle cx="10.5" cy="8.5" r="1.6"/><circle cx="5.5" cy="13.5" r="1.6"/><circle cx="10.5" cy="13.5" r="1.6"/></g></svg>
    </button>

    <!-- 押すと行の詳細。つかんで並べ替えもできる（マウスは押したまま動かす、指は長押ししてから動かす。指をすぐ動かせば一覧のスクロール） -->
    <button
      class="fineTuneRow__name"
      :class="{ 'fineTuneRow__cell--on': selectedField === 'row' }"
      type="button"
      data-testid="fine-tune-row-name"
      :aria-pressed="selectedField === 'row'"
      @pointerdown="emit('name-press', row.id, $event)"
      @touchstart="emit('name-press', row.id, $event)"
      @mousedown="emit('name-press', row.id, $event)"
      @touchmove="emit('name-touchmove', $event)"
      @click="emit('select', 'row')"
    >
      <!-- 名前と EXP補正の印。狭い画面（375px 未満）では1つの文として2行まで折り返す（印も名前に続けて折り返す） -->
      <span class="fineTuneRow__nameText">
        <span class="fineTuneRow__title" data-testid="fine-tune-row-title">{{ row.title }}</span>
        <span v-if="natureMark !== null" class="fineTuneRow__nature" :class="`fineTuneRow__nature--${row.nature}`" aria-hidden="true">{{ natureMark }}</span>
      </span>
    </button>

    <!-- 目標Lv: 押すと調整バーを使わず、その場で計算機と同じ Lvピッカーを開く（到達Lvは表と各欄の調整バーで見える）。
         吹き出しは一覧の枠で切れないよう body へ出す。LvMax の行は動かせないので、押すと行の詳細 -->
    <LevelPicker
      v-if="row.targetAdjustable"
      class="fineTuneRow__targetPick"
      teleport
      boundary=".fineTuneModal"
      :model-value="row.targetLevel.value"
      :min="row.targetLevel.range.min"
      :max="row.targetLevel.range.max"
      :label="`${t('calc.fineTune.field.target')}: Lv${row.targetLevel.value}`"
      @update:model-value="(level, coalesce) => emit('op', { kind: 'targetSet', rowId: row.id, level }, coalesce)"
      @update:open="(open) => (targetOpen = open)"
    >
      <template #trigger="{ toggle }">
        <button
          class="fineTuneRow__cell"
          :class="cellClass(null, true, row.targetLevel.base !== row.targetLevel.value, targetOpen)"
          type="button"
          data-testid="fine-tune-row-target"
          :aria-label="`${t('calc.fineTune.field.target')} ${row.targetLevel.value}`"
          aria-haspopup="dialog"
          :aria-expanded="targetOpen"
          @click.stop="toggle"
        >{{ row.targetLevel.value }}</button>
      </template>
      <!-- 計算機の目標Lvピッカーと同じ見出し（現在Lvからの矢印） -->
      <template #title>{{ t("calc.fineTune.field.target") }}: Lv{{ row.individual.srcLevel.value }} → Lv{{ row.targetLevel.value }}</template>
    </LevelPicker>
    <button
      v-else
      class="fineTuneRow__cell"
      :class="cellClass(null, false, row.targetLevel.base !== row.targetLevel.value)"
      type="button"
      data-testid="fine-tune-row-target"
      :aria-label="`${t('calc.fineTune.field.target')} ${row.targetLevel.value}`"
      @click="emit('select', 'row')"
    >{{ row.targetLevel.value }}</button>

    <!-- 睡眠目標（200h〜2000h・睡眠・おひるね島。計算機と同じ名前）。アメ在庫・チケットを使うときは印を付ける -->
    <button
      class="fineTuneRow__cell fineTuneRow__cell--sleep"
      :class="cellClass('sleep', true, row.sleepTarget.changed)"
      type="button"
      data-testid="fine-tune-row-sleep"
      :aria-label="`${t('calc.fineTune.field.sleep')} ${sleepText.name}${sleepText.icons}`"
      :aria-pressed="selectedField === 'sleep'"
      @click="emit('select', 'sleep')"
    >
      <!-- おひるね島だけ、狭い幅では「島」と縮める（ほかは名前が同じ） -->
      <template v-if="sleepText.short !== sleepText.name">
        <span class="fineTuneRow__sleepName fineTuneRow__sleepName--full">{{ sleepText.name }}</span>
        <span class="fineTuneRow__sleepName fineTuneRow__sleepName--short">{{ sleepText.short }}</span>
      </template>
      <span v-else class="fineTuneRow__sleepName">{{ sleepText.name }}</span>
      <span v-if="sleepText.icons" class="fineTuneRow__sleepIcons" aria-hidden="true">{{ sleepText.icons }}</span>
    </button>

    <span
      class="fineTuneRow__cell fineTuneRow__cell--result"
      :class="{ 'fineTuneRow__cell--changed': reachChanged, 'fineTuneRow__cell--short': row.reached.value === false }"
      data-testid="fine-tune-row-reach"
      :data-short="String(row.reached.value === false)"
    >{{ reachText }}</span>

    <button
      v-if="hasBoost"
      class="fineTuneRow__cell"
      :class="cellClass('boost', row.exclusion === null && row.boost !== null, row.boost !== null && row.boost.base !== row.boost.value)"
      type="button"
      data-testid="fine-tune-row-boost"
      :data-locked="row.boost?.locked ? 'true' : undefined"
      :aria-label="`${t('calc.fineTune.field.boost')} ${boostText}${row.boost?.locked ? ` ${t('calc.fineTune.boostLocked')}` : ''}`"
      :aria-pressed="selectedField === 'boost'"
      @click="emit('select', row.exclusion === null && row.boost !== null ? 'boost' : 'row')"
    >
      <!-- LvUp! でアメブを固定した行は、欄の隅に小さな錠（数字の幅を取らない） -->
      <svg v-if="row.boost?.locked" class="fineTuneRow__lock" data-testid="fine-tune-row-boost-lock" aria-hidden="true" viewBox="0 0 16 16" width="9" height="9"><path d="M5 7.5V5a3 3 0 0 1 6 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="2.5" y="7" width="11" height="8" rx="1.8" fill="currentColor"/></svg>{{ boostText }}</button>

    <button
      class="fineTuneRow__cell"
      :class="[cellClass('candy', row.candyEdit !== null, candyChanged), { 'fineTuneRow__cell--result': !candyFromDraft }]"
      type="button"
      data-testid="fine-tune-row-candy"
      :aria-label="`${hasBoost ? t('calc.fineTune.field.candyTotal') : t('calc.fineTune.field.candy')} ${candyText}`"
      :aria-pressed="selectedField === 'candy'"
      @click="emit('select', row.candyEdit !== null ? 'candy' : 'row')"
    >{{ candyText }}</button>

    <span
      class="fineTuneRow__cell fineTuneRow__cell--result fineTuneRow__cell--shards"
      :class="{ 'fineTuneRow__cell--changed': changed(row.shardsPerCandy) }"
      data-testid="fine-tune-row-shards-per-candy"
    >{{ valueText(row.shardsPerCandy) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp } from "../domain/fine-tune/draft";
import type { HistoryRecordOptions } from "../composables/useHistory";
import type { Change, FineTuneRowView } from "../domain/fine-tune/rowView";
import { natureMarkText, sleepTargetText, type FineTuneField } from "../utils/fineTuneView";
import LevelPicker from "./LevelPicker.vue";

/**
 * シンプルの1行。数字だけを1行に並べ、押した欄（睡眠・アメブ・アメ）を下の調整バー（FineTuneEditor）で動かす。
 * 目標Lvは押すとその場で Lvピッカーを開く（調整バーは使わない）。動かせない欄を押したときは、行の詳細（理由）を開く。計算は持たず、`FineTuneRowView` の値を出すだけ。
 * 結果から出す欄（到達・使えたアメ・到達Lvでのアメ1個のかけら）は、計算中は薄くする。
 */
const props = defineProps<{
  row: FineTuneRowView;
  hasBoost: boolean;
  /** この行で選んでいる欄。選んでいなければ null */
  selectedField: FineTuneField | null;
  /** 最新の結果が今の下書きの結果でない（結果から出す欄を薄くする） */
  pending: boolean;
  isFirst: boolean;
  isLast: boolean;
  dragging: boolean;
  dragOver: boolean;
  fmt: (n: number) => string;
}>();

const emit = defineEmits<{
  /** `coalesce` は目標Lvの Lvピッカーのスライダーの1回のドラッグの目印（元に戻すの1件にまとめる） */
  (e: "op", op: FineTuneOp, coalesce?: HistoryRecordOptions): void;
  (e: "select", field: FineTuneField): void;
  /** 取っ手を押した（すぐにつかむ） */
  (e: "handle-press", rowId: string, event: Event): void;
  /** 名前を押した（押したまま動かす・長押しでつかむ。そうでなければ click で行の詳細） */
  (e: "name-press", rowId: string, event: Event): void;
  /** 名前の touchmove（passive でない）。指でつかんだあとはスクロールを止める */
  (e: "name-touchmove", event: Event): void;
}>();

const { t } = useI18n();

/** 目標Lvの Lvピッカーを開いている（欄を選んだ見た目にする） */
const targetOpen = ref(false);

const natureMark = computed(() => natureMarkText(t, props.row.nature));

/**
 * 欄の見た目。`field` はその欄を押して調整バーで選ぶ欄（選んでいれば塗る）。調整バーを使わない欄（目標Lv）は null で、
 * 塗るかは `on` で渡す（Lvピッカーを開いている間）
 */
function cellClass(field: FineTuneField | null, adjustable: boolean, isChanged: boolean, on = false): Record<string, boolean> {
  return {
    "fineTuneRow__cell--input": adjustable,
    "fineTuneRow__cell--locked": !adjustable,
    "fineTuneRow__cell--changed": isChanged,
    "fineTuneRow__cell--on": on || (field !== null && props.selectedField === field),
  };
}

function changed(c: Change<number | null>): boolean {
  return c.base !== null && c.value !== null && c.base !== c.value;
}

function valueText(c: Change<number | null>): string {
  return c.value === null ? "-" : props.fmt(c.value);
}

const boostText = computed(() => (props.row.boost === null ? "-" : props.fmt(props.row.boost.value)));

/** アメ: 下書きで数を変えた行は下書きの値（すぐ変わる）、ほかは最新の結果で使えた数 */
const candyFromDraft = computed(() => props.row.candyEdit?.changed === true);
const candyText = computed(() => (candyFromDraft.value
  ? props.fmt(props.row.candyEdit!.value)
  : valueText(props.row.candy)));
const candyChanged = computed(() => candyFromDraft.value || changed(props.row.candy));

const sleepText = computed(() => sleepTargetText(t, props.row.sleepTarget.choice));

/** 到達: アメで届くLv（睡眠のあとの着地点は調整バーの詳細） */
const reachText = computed(() => (props.row.reachLevel.value === null ? "-" : String(props.row.reachLevel.value)));
const reachChanged = computed(() => {
  const { reachLevel, expToNext } = props.row;
  return reachLevel.base !== null && reachLevel.value !== null
    && (reachLevel.base !== reachLevel.value || expToNext.base !== expToNext.value);
});

// ===== 並べ替え（取っ手か名前をつかんで動かす。キーボードは取っ手の ↑↓ キー） =====
function onHandleKeydown(event: KeyboardEvent): void {
  const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (by === 0) return;
  event.preventDefault();
  if ((by < 0 && props.isFirst) || (by > 0 && props.isLast)) return;
  emit("op", { kind: "move", rowId: props.row.id, toIndex: props.row.index + by });
}
</script>
