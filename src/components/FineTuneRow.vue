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
      <!-- つかんで動かす印（6つの点のグリップ） -->
      <svg class="fineTuneRow__handleIcon" aria-hidden="true" viewBox="0 0 16 17" width="12" height="13"><g fill="currentColor"><circle cx="5.5" cy="3.5" r="1.6"/><circle cx="10.5" cy="3.5" r="1.6"/><circle cx="5.5" cy="8.5" r="1.6"/><circle cx="10.5" cy="8.5" r="1.6"/><circle cx="5.5" cy="13.5" r="1.6"/><circle cx="10.5" cy="13.5" r="1.6"/></g></svg>
    </button>

    <button
      class="fineTuneRow__name"
      :class="{ 'fineTuneRow__cell--on': selectedField === 'row' }"
      type="button"
      data-testid="fine-tune-row-name"
      :aria-pressed="selectedField === 'row'"
      @click="emit('select', 'row')"
    >
      <span class="fineTuneRow__title" data-testid="fine-tune-row-title">{{ row.title }}</span>
      <span v-if="natureMark !== null" class="fineTuneRow__nature" :class="`fineTuneRow__nature--${row.nature}`" aria-hidden="true">{{ natureMark }}</span>
    </button>

    <button
      class="fineTuneRow__cell"
      :class="cellClass('target', row.targetAdjustable, row.targetLevel.base !== row.targetLevel.value)"
      type="button"
      data-testid="fine-tune-row-target"
      :aria-label="`${t('calc.fineTune.field.target')} ${row.targetLevel.value}`"
      :aria-pressed="selectedField === 'target'"
      @click="emit('select', row.targetAdjustable ? 'target' : 'row')"
    >{{ row.targetLevel.value }}</button>

    <!-- 睡眠目標（200h〜2000h・全て・おひるね島）。アメ在庫・チケットを使うときは印を付ける -->
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
      :class="cellClass('boost', row.levelAdjustable && row.boost !== null, row.boost !== null && row.boost.base !== row.boost.value)"
      type="button"
      data-testid="fine-tune-row-boost"
      :aria-label="`${t('calc.fineTune.field.boost')} ${boostText}`"
      :aria-pressed="selectedField === 'boost'"
      @click="emit('select', row.levelAdjustable && row.boost !== null ? 'boost' : 'row')"
    >
      {{ boostText }}
      <span v-if="hasRecommendation" class="fineTuneRow__mark" data-testid="fine-tune-row-recommend-mark" aria-hidden="true"></span>
    </button>

    <button
      class="fineTuneRow__cell"
      :class="[cellClass('candy', row.candyEdit !== null, candyChanged), { 'fineTuneRow__cell--result': !candyFromDraft }]"
      type="button"
      data-testid="fine-tune-row-candy"
      :aria-label="`${t('calc.fineTune.field.candy')} ${candyText}`"
      :aria-pressed="selectedField === 'candy'"
      @click="emit('select', row.candyEdit !== null ? 'candy' : 'row')"
    >{{ candyText }}</button>

    <span
      class="fineTuneRow__cell fineTuneRow__cell--result fineTuneRow__cell--shards"
      :class="{ 'fineTuneRow__cell--changed': changed(row.shardsPerCandy) }"
      data-testid="fine-tune-row-shards-per-candy"
      :title="shardsTitle"
    >{{ valueText(row.shardsPerCandy) }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp } from "../domain/fine-tune/draft";
import type { Change, FineTuneRowView } from "../domain/fine-tune/rowView";
import { sleepTargetText, type FineTuneField } from "../utils/fineTuneView";

/**
 * シンプルの1行。数字だけを1行に並べ、押した欄（目標Lv・睡眠・アメブ・アメ）を下の調整バー（FineTuneEditor）で動かす。
 * 動かせない欄を押したときは、行の詳細（理由）を開く。計算は持たず、`FineTuneRowView` の値を出すだけ。
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
  (e: "op", op: FineTuneOp): void;
  (e: "select", field: FineTuneField): void;
  (e: "handle-press", rowId: string, event: Event): void;
}>();

const { t } = useI18n();

const natureMark = computed(() => {
  if (props.row.nature === "up") return t("calc.row.natureUp");
  if (props.row.nature === "down") return t("calc.row.natureDown");
  return null;
});

function cellClass(field: FineTuneField, adjustable: boolean, isChanged: boolean): Record<string, boolean> {
  return {
    "fineTuneRow__cell--input": adjustable,
    "fineTuneRow__cell--locked": !adjustable,
    "fineTuneRow__cell--changed": isChanged,
    "fineTuneRow__cell--on": props.selectedField === field,
  };
}

function changed(c: Change<number | null>): boolean {
  return c.base !== null && c.value !== null && c.base !== c.value;
}

function valueText(c: Change<number | null>): string {
  return c.value === null ? "-" : props.fmt(c.value);
}

const boostText = computed(() => (props.row.boost === null ? "-" : props.fmt(props.row.boost.value)));
const hasRecommendation = computed(() => !props.pending && (props.row.advice?.recommendation ?? null) !== null);

/** アメ: 下書きで数を変えた行は下書きの値（すぐ変わる）、ほかは最新の結果で使えた数 */
const candyFromDraft = computed(() => props.row.candyEdit?.changed === true);
const candyText = computed(() => (candyFromDraft.value
  ? props.fmt(props.row.candyEdit!.value)
  : valueText(props.row.candy)));
const candyChanged = computed(() => candyFromDraft.value || changed(props.row.candy));

/** 使うかけらの合計はホバーで出す */
const shardsTitle = computed(() => (props.row.shards.value === null
  ? undefined
  : t("calc.fineTune.shardsTotal", { shards: props.fmt(props.row.shards.value) })));

const sleepText = computed(() => sleepTargetText(t, props.row.sleepTarget.choice));

/** 到達: アメで届くLv（睡眠のあとの着地点は調整バーの詳細） */
const reachText = computed(() => (props.row.reachLevel.value === null ? "-" : String(props.row.reachLevel.value)));
const reachChanged = computed(() => {
  const { reachLevel, expToNext } = props.row;
  return reachLevel.base !== null && reachLevel.value !== null
    && (reachLevel.base !== reachLevel.value || expToNext.base !== expToNext.value);
});

// ===== 並べ替え（取っ手をつかんで動かす。キーボードは取っ手の ↑↓ キー） =====
function onHandleKeydown(event: KeyboardEvent): void {
  const by = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
  if (by === 0) return;
  event.preventDefault();
  if ((by < 0 && props.isFirst) || (by > 0 && props.isLast)) return;
  emit("op", { kind: "move", rowId: props.row.id, toIndex: props.row.index + by });
}
</script>
