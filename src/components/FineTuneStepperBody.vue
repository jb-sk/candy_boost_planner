<template>
  <!-- アメブ・アメ: 1段目にアメブ目標Lv・最小限のアメブ・再割当（アメブのとき）、2段目に刻みのボタンと個数欄 -->
  <div class="fineTuneEditor__line">
    <div v-if="boostTools !== null" class="fineTuneEditor__tools">
      <!-- アメブ目標Lv（計算機のアメブ目標Lvと同じ。選ぶと個数は自動へ戻り、そのLvまでをアメブで賄う）。
           現在Lv・目標Lvと同じ形の Lv の欄（目標Lvと同じ幅） -->
      <FineTuneLevelField
        v-if="boostTools.level !== null"
        class="fineTuneEditor__levelField"
        kind="boostLevel"
        :label="t('calc.row.boostReachLevel')"
        :value="boostTools.level.value"
        :base="boostTools.level.base"
        :min="boostTools.level.range.min"
        :max="boostTools.level.range.max"
        :from="row.individual.srcLevel.value"
        :disabled="busy || boostTools.level.disabled"
        @set="(level, coalesce) => emit('op', { kind: 'boostLevelSet', rowId: row.id, level }, coalesce)"
      />
      <!-- 最小限のアメブ（手持ちのアメから最小限のアメブを自動で決める）と再割当（計算機の行の ↺ と同じ。自動の値へ戻す） -->
      <!-- 入れられないとき（設定で全員が最小限のアメブ・個数指定・アメ在庫の睡眠目標）は押せない見た目にし、押すと理由を出す。
           アメが足りなくても入れられる（計算機と同じ）。入っていてアメが足りない（既定のアメブ目標Lvを使っている）ときは警告の色 -->
      <!-- 名前は計算機の設定と同じ「目標Lvに届く最小限のアメブ個数」。長いので2行に分けて出す（文言の改行の位置） -->
      <button
        class="fineTuneEditor__tool fineTuneEditor__tool--stacked"
        :class="{
          'fineTuneEditor__tool--on': boostTools.minimized && !boostTools.warn,
          'fineTuneEditor__tool--warn': boostTools.warn,
          'fineTuneEditor__tool--off': boostTools.blocked,
        }"
        type="button"
        data-testid="fine-tune-editor-minimize"
        :data-warn="boostTools.warn ? 'true' : undefined"
        :aria-pressed="boostTools.minimized"
        :aria-disabled="boostTools.blocked ? 'true' : undefined"
        :disabled="busy"
        @click="toggleMinimize"
      ><FineTuneStackedLabel :text="t('calc.fineTune.boostMinimize')" /></button>
      <button
        class="fineTuneEditor__tool"
        type="button"
        data-testid="fine-tune-editor-boost-reset"
        :disabled="busy || !boostTools.manual"
        @click="emit('op', { kind: 'boostReset', rowId: row.id })"
      >{{ t("calc.fineTune.boostReset") }}</button>
    </div>
  </div>
  <div class="fineTuneEditor__line">
    <!-- 減らす3つ・増やす3つは、それぞれ1本の溝（トラック）に並べた鍵の形にする -->
    <div class="fineTuneEditor__stepper">
      <div class="fineTuneEditor__stepGroup">
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
      </div>
      <FineTuneNumberInput
        class="field__input fineTuneEditor__input"
        data-testid="fine-tune-editor-input"
        :value="stepper.value"
        :input-label="stepper.inputLabel"
        :disabled="busy"
        :fmt="fmt"
        @commit="(value) => emit('op', stepper.setOp(value))"
      />
      <div class="fineTuneEditor__stepGroup">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp } from "../domain/fine-tune/draft";
import type { FineTuneRowView, MinimizeBlock } from "../domain/fine-tune/rowView";
import type { HistoryRecordOptions } from "../composables/useHistory";
import { showToast } from "../composables/useToast";
import { FINE_TUNE_REASON_TOAST, type FineTuneField, type FineTuneStepper } from "../utils/fineTuneView";
import FineTuneLevelField from "./FineTuneLevelField.vue";
import FineTuneNumberInput from "./FineTuneNumberInput.vue";
import FineTuneStackedLabel from "./FineTuneStackedLabel.vue";

/**
 * 調整バーの操作の2段のうち、アメブ・アメの欄（刻みのボタンと個数欄）。
 * アメブのときは1段目にアメブ目標Lv・最小限のアメブ・再割当も置く。値と範囲は親が作った `stepper` を使い、op を返すだけ。
 */
const props = defineProps<{
  row: FineTuneRowView;
  field: FineTuneField | null;
  stepper: FineTuneStepper;
  busy: boolean;
  fmt: (n: number) => string;
}>();

const emit = defineEmits<{
  /** `coalesce` は Lv の欄のスライダーの1回のドラッグの目印（元に戻すの1件にまとめる） */
  (e: "op", op: FineTuneOp, coalesce?: HistoryRecordOptions): void;
}>();

const { t } = useI18n();

// ===== アメブの最小限のアメブ・再割当 =====
/** 最小限のアメブを入れられない理由の文言 */
const MINIMIZE_BLOCK_TEXT: Readonly<Record<MinimizeBlock, string>> = {
  global: "calc.fineTune.boostMinimizeGlobal",
  candyTarget: "calc.fineTune.boostMinimizeCandyTarget",
  sleepTarget: "calc.fineTune.boostMinimizeSleepTarget",
  unavailable: "calc.fineTune.boostMinimizeUnavailable",
};

const boostTools = computed(() => {
  const { row, field } = props;
  if (field !== "boost" || row.exclusion !== null || row.boost === null) return null;
  const { minimized, minimizeBlocked, shortCandy, manual } = row.boost;
  const blockedReason = minimizeBlocked === null ? null : t(MINIMIZE_BLOCK_TEXT[minimizeBlocked]);
  return {
    level: row.boost.level,
    minimized,
    manual,
    /** この行に入っていて、アメが足りず元のアメブ個数・アメブ目標Lvを使っている（警告の色。設定で全員のときはボタンが押せない見た目なので塗らない） */
    warn: minimized && shortCandy,
    blocked: blockedReason !== null,
    blockedReason,
  };
});

/**
 * 最小限のアメブを切り替える。入れられないときは理由だけを出す。
 * アメが足りない行も入れる（計算機と同じ）。そのときはボタンが警告の色になり、詳細に要るアメの数が出る
 * （トーストでは知らせない。同じ警告が二重に出るため）
 */
function toggleMinimize(): void {
  const tools = boostTools.value;
  if (tools === null) return;
  if (tools.blockedReason !== null) {
    showToast(tools.blockedReason, FINE_TUNE_REASON_TOAST);
    return;
  }
  emit("op", { kind: "boostMinimize", rowId: props.row.id, on: !tools.minimized });
}

// ===== 刻みのボタン =====
function stepBy(by: number): void {
  emit("op", props.stepper.stepOp(by));
}
</script>
