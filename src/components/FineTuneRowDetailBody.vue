<template>
  <!-- 行の詳細（名前を押したとき）: 1段目に現在Lv（目標Lv・アメブ目標Lvと同じ形の Lv の欄）・あとEXP・アメ在庫の欄
       （直接打つ。タッチ端末はテンキー）、2段目に動かせない理由と「計算機から削除」 -->
  <div class="fineTuneEditor__line">
    <div class="fineTuneEditor__props">
      <FineTuneLevelField
        kind="srcLevel"
        :label="t('calc.row.srcLevel')"
        :value="row.individual.srcLevel.value"
        :base="row.individual.srcLevel.base"
        :min="row.individual.srcLevel.min"
        :max="row.individual.srcLevel.max"
        :disabled="busy || !row.individual.editable"
        @set="(level, coalesce) => emit('op', { kind: 'srcLevelSet', rowId: row.id, level }, coalesce)"
      />
      <label
        v-for="prop in rowProps"
        :key="prop.key"
        class="fineTuneEditor__prop"
        :class="{ 'fineTuneEditor__prop--changed': prop.value !== prop.base, 'fineTuneEditor__prop--disabled': prop.disabled }"
      >
        <span class="fineTuneEditor__propLabel">{{ prop.label }}</span>
        <FineTuneNumberInput
          class="fineTuneEditor__propInput"
          data-testid="fine-tune-editor-prop"
          :data-prop="prop.key"
          :value="prop.value"
          :input-label="prop.inputLabel"
          :max-length="prop.maxLength"
          :disabled="busy || prop.disabled"
          :fmt="fmt"
          @commit="(value) => emit('op', prop.op(value))"
        />
      </label>
    </div>
  </div>
  <!-- 左に「LvUp!でアメブ固定」（LvUp! にこのポケモンのアメブを動かさせない。開いている間だけ）。出すのは LvUp! がアメブを動かす行
       （固定している行は外せるよう出したまま）。動かせない理由が出る行は LvUp! も元から動かさないので、理由とは同時に出ない。
       右端に「計算機から削除」（下書き。OK で計算機の行から外す。ボックスの個体は消さない。元に戻す・キャンセルで戻せるので確認は出さない）。
       最後の1匹は外せない（行が無いとプレビューを計算できない。全員を外すのは計算機のクリアで） -->
  <div class="fineTuneEditor__line fineTuneEditor__line--detail">
    <button
      v-if="boostLock !== null"
      class="fineTuneEditor__switchBox fineTuneEditor__lock"
      :class="{ 'fineTuneEditor__switchBox--changed': boostLock.on }"
      type="button"
      role="switch"
      data-testid="fine-tune-editor-boost-lock"
      :aria-checked="boostLock.on"
      :disabled="busy"
      @click="emit('op', { kind: 'boostLockSet', rowId: row.id, on: !boostLock.on })"
    >
      <span class="fineTuneEditor__switchLabel"><FineTuneStackedLabel :text="t('calc.fineTune.boostLock')" /></span>
      <span class="fineTuneEditor__switch" :class="{ 'fineTuneEditor__switch--on': boostLock.on }" aria-hidden="true"></span>
    </button>
    <p v-else-if="noteText !== null" class="fineTuneEditor__note" data-testid="fine-tune-editor-note">{{ noteText }}</p>
    <button
      class="fineTuneEditor__remove"
      type="button"
      data-testid="fine-tune-editor-remove"
      :disabled="busy || !canRemove"
      @click="emit('remove')"
    >{{ t("calc.fineTune.removeRow") }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp } from "../domain/fine-tune/draft";
import type { FineTuneRowView } from "../domain/fine-tune/rowView";
import type { HistoryRecordOptions } from "../composables/useHistory";
import { EXCLUSION_TEXT } from "../utils/fineTuneView";
import FineTuneLevelField from "./FineTuneLevelField.vue";
import FineTuneNumberInput from "./FineTuneNumberInput.vue";
import FineTuneStackedLabel from "./FineTuneStackedLabel.vue";

/**
 * 調整バーの操作の2段のうち、行の詳細（名前を押したとき）。
 * 現在Lv・あとEXP（個体）とアメ在庫を直接打って変え、LvUp!でアメブ固定・動かせない理由・計算機から削除を置く。
 */
const props = defineProps<{
  row: FineTuneRowView;
  busy: boolean;
  /** 計算機から削除できる（下書きに2匹以上いる。最後の1匹は外せない） */
  canRemove: boolean;
  fmt: (n: number) => string;
}>();

const emit = defineEmits<{
  /** `coalesce` は Lv の欄のスライダーの1回のドラッグの目印（元に戻すの1件にまとめる） */
  (e: "op", op: FineTuneOp, coalesce?: HistoryRecordOptions): void;
  /** 行の詳細の「計算機から削除」（選んでいるポケモンを下書きから外す。選択は外れる） */
  (e: "remove"): void;
}>();

const { t } = useI18n();

// ===== 行の詳細の欄（あとEXP・アメ在庫）。欄は FineTuneNumberInput =====
/** 現在Lvは Lv の欄（`FineTuneLevelField`）で動かすので、ここには入れない */
type RowPropKey = "exp" | "stock";

interface RowProp {
  key: RowPropKey;
  label: string;
  inputLabel: string;
  /** 今の値（種族不明の行の在庫は null） */
  value: number | null;
  base: number | null;
  disabled: boolean;
  /** テンキーで打てる桁数 */
  maxLength: number;
  op: (value: number) => FineTuneOp;
}

const rowProps = computed<RowProp[]>(() => {
  const { row } = props;
  const rowId = row.id;
  const { expRemaining, editable } = row.individual;
  const inputLabelOf = (label: string) => t("calc.fineTune.inputAria", { field: label, name: row.title });
  const expLabel = t("calc.row.expRemaining");
  const stockLabel = t("calc.row.speciesCandy");
  return [
    {
      key: "exp",
      label: expLabel,
      inputLabel: inputLabelOf(expLabel),
      value: expRemaining.value,
      base: expRemaining.base,
      // Lv70 は次のLvが無い
      disabled: !editable || expRemaining.max <= 0,
      maxLength: 6,
      op: (exp) => ({ kind: "expRemainingSet", rowId, exp }),
    },
    {
      key: "stock",
      label: stockLabel,
      inputLabel: inputLabelOf(stockLabel),
      value: row.stock?.value ?? null,
      base: row.stock?.base ?? null,
      disabled: row.stock === null,
      maxLength: 7,
      op: (count) => ({ kind: "stockSet", rowId, count }),
    },
  ];
});

/**
 * 「LvUp!でアメブ固定」。アメブのあるスロットで、LvUp! がアメブを動かす行（`lockable`）か、固定している行だけ出す
 */
const boostLock = computed(() => {
  const boost = props.row.boost;
  if (boost === null || (!boost.lockable && !boost.locked)) return null;
  return { on: boost.locked };
});

/**
 * アメブを動かせない理由。
 * 「ポケモンが不明」は、行の詳細では直し方（ボックスの再リンク）まで出す。
 * 睡眠の欄は詳細の段を到達Lvなどと分け合い、長い文は切れるので短いまま。
 * リンク切れの行はボックスに個体が無く再リンクできないので、短いまま
 */
const noteText = computed(() => {
  const { row } = props;
  if (row.exclusion === "unknownPokemon" && row.individual.editable) return t("calc.fineTune.unknownPokemonHint");
  const key = row.exclusion === null ? null : EXCLUSION_TEXT[row.exclusion];
  return key === null ? null : t(key);
});
</script>
