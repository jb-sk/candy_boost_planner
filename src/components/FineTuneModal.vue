<template>
  <div class="modal-overlay fineTune-overlay" data-testid="fine-tune-overlay" @click.self="requestClose">
    <div
      ref="modalRef"
      class="modal fineTuneModal"
      :class="{ 'fineTuneModal--pending': fineTune.stale.value }"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      :aria-label="t('calc.fineTune.title')"
      data-testid="fine-tune-modal"
    >
      <header class="modal__header">
        <h2 class="modal__title">{{ t("calc.fineTune.title") }}</h2>
        <button ref="closeButtonRef" class="modal__close" data-testid="fine-tune-close" type="button" :aria-label="t('common.close')" @click="requestClose">×</button>
      </header>

      <div class="fineTuneModal__tabsBar">
        <div class="modalTabs" role="tablist" :aria-label="t('calc.fineTune.modeTabs')" data-testid="fine-tune-tabs">
          <button
            v-for="tab in TABS"
            :key="tab.id"
            class="modalTab"
            :class="{ 'modalTab--active': mode === tab.id }"
            role="tab"
            type="button"
            :aria-selected="mode === tab.id"
            :data-testid="`fine-tune-tab-${tab.id}`"
            @click="mode = tab.id"
          >{{ t(tab.label) }}</button>
        </div>
      </div>

      <p v-if="!fineTune.ready.value" class="fineTuneModal__loading" data-testid="fine-tune-loading" role="status">{{ t("calc.fineTune.loading") }}</p>

      <template v-else>
        <section class="fineTuneModal__top" data-testid="fine-tune-top">
          <dl v-if="summary !== null" class="fineTuneSummary" data-testid="fine-tune-summary">
            <div class="fineTuneSummary__item">
              <dt>{{ t("calc.fineTune.summary.reached") }}</dt>
              <dd data-testid="fine-tune-summary-reached">{{ summaryChange(summary.reached, (n) => `${n}/${summary!.total}`) }}</dd>
            </div>
            <div v-if="summary.boostRemaining !== null" class="fineTuneSummary__item">
              <dt>{{ t("calc.fineTune.summary.boostRemaining") }}</dt>
              <dd data-testid="fine-tune-summary-boost">{{ summaryChange(summary.boostRemaining, calc.fmtNum) }}</dd>
            </div>
            <div class="fineTuneSummary__item">
              <dt>{{ t("calc.fineTune.summary.shardsRemaining") }}</dt>
              <dd data-testid="fine-tune-summary-shards">{{ summaryChange(summary.shardsRemaining, calc.fmtNum) }}</dd>
            </div>
            <div class="fineTuneSummary__item">
              <dt>{{ t("calc.fineTune.summary.candyShortage") }}</dt>
              <dd data-testid="fine-tune-summary-candy">{{ summaryChange(summary.candyShortage, calc.fmtNum) }}</dd>
            </div>
          </dl>
          <p v-if="boostOver > 0" class="fineTuneModal__warn" data-testid="fine-tune-boost-over">{{ t("calc.fineTune.summary.boostOver", { over: calc.fmtNum(boostOver) }) }}</p>

          <div class="fineTuneModal__stepLine">
            <span class="fineTuneModal__stepLabel" id="fine-tune-step-label">{{ t("calc.fineTune.step.label") }}</span>
            <div class="fineTuneModal__stepChoices" role="radiogroup" aria-labelledby="fine-tune-step-label">
              <button
                v-for="option in FINE_TUNE_STEP_OPTIONS"
                :key="option"
                class="fineTuneModal__stepChoice"
                :class="{ 'fineTuneModal__stepChoice--on': fineTune.step.value === option }"
                type="button"
                role="radio"
                :aria-checked="fineTune.step.value === option"
                :data-testid="`fine-tune-step-${option}`"
                @click="fineTune.step.value = option"
              >{{ option }}</button>
            </div>
            <span v-if="fineTune.previewing.value" class="fineTuneModal__calculating" data-testid="fine-tune-calculating" role="status">{{ t("calc.fineTune.calculating") }}</span>
          </div>

          <p v-if="fineTune.previewFailed.value" class="fineTuneModal__warn" data-testid="fine-tune-preview-failed" role="alert">{{ t("calc.fineTune.previewFailed") }}</p>

          <div v-if="diagnosisView !== null" class="fineTuneModal__diagnosis" data-testid="fine-tune-diagnosis" :data-kind="diagnosisView.kind">
            <p>{{ diagnosisView.text }}</p>
            <p v-for="line in diagnosisView.also" :key="line" class="fineTuneModal__also">{{ line }}</p>
          </div>

          <div v-if="mode === 'yield'" class="fineTuneReceiver" data-testid="fine-tune-receiver">
            <div v-if="fineTune.receiver.value !== null" class="fineTuneReceiver__line">
              <span class="fineTuneReceiver__name" data-testid="fine-tune-receiver-name">{{ t("calc.fineTune.receiver", { name: fineTune.receiver.value.title }) }}</span>
              <button class="btn btn--soft" type="button" data-testid="fine-tune-receiver-clear" @click="dispatch({ kind: 'receiverClear' })">{{ t("calc.fineTune.receiverClear") }}</button>
            </div>
            <p v-else class="fineTuneReceiver__hint" data-testid="fine-tune-receiver-hint">{{ t("calc.fineTune.pickReceiver") }}</p>
            <p v-for="(notice, i) in noticeTexts" :key="i" class="fineTuneReceiver__notice" data-testid="fine-tune-notice" :data-kind="notice.kind">{{ notice.text }}</p>
            <p v-if="fineTune.giveDragging.value" class="fineTuneReceiver__notice" data-testid="fine-tune-give-hint">{{ t("calc.fineTune.giveReleaseHint") }}</p>
          </div>
        </section>

        <div class="modal__body fineTuneModal__list" data-testid="fine-tune-list" :data-pending="fineTune.stale.value ? 'true' : undefined">
          <div class="fineTuneHead" :class="{ 'fineTuneHead--noBoost': !fineTune.hasBoost.value }" aria-hidden="true">
            <span class="fineTuneHead__cell fineTuneHead__cell--move"></span>
            <span class="fineTuneHead__cell fineTuneHead__cell--name">{{ t("calc.fineTune.colPokemon") }}</span>
            <span class="fineTuneHead__cell fineTuneHead__cell--target">{{ t("calc.row.dstLevel") }}</span>
            <span class="fineTuneHead__cell fineTuneHead__cell--exp">{{ t("calc.fineTune.colExp") }}</span>
            <span v-if="fineTune.hasBoost.value" class="fineTuneHead__cell fineTuneHead__cell--boost">{{ t("calc.row.breakdownBoost") }}</span>
            <span class="fineTuneHead__cell fineTuneHead__cell--candy">{{ t("calc.row.candy") }}</span>
            <span class="fineTuneHead__cell fineTuneHead__cell--shards">{{ t("calc.row.shards") }}</span>
          </div>
          <FineTuneRow
            v-for="(row, i) in fineTune.rowViews.value"
            :key="row.id"
            :row="row"
            :mode="mode"
            :has-boost="fineTune.hasBoost.value"
            :pending="fineTune.stale.value"
            :step="fineTune.step.value"
            :is-first="i === 0"
            :is-last="i === fineTune.rowViews.value.length - 1"
            :dragging="rowDrag.draggingId.value === row.id"
            :drag-over="rowDrag.overId.value === row.id && rowDrag.draggingId.value !== row.id"
            :fmt="calc.fmtNum"
            :title-of="fineTune.titleOf"
            @op="dispatch"
            @handle-press="rowDrag.onHandlePress"
            :live="fineTune.givePreview.value?.rowId === row.id ? fineTune.givePreview.value : null"
            @give-input="fineTune.setGivePreview"
            @give-release="fineTune.releaseGivePreview"
          />
        </div>
      </template>

      <div class="fineTuneModal__confirm">
        <InlineConfirm
          ref="discardConfirmRef"
          id-prefix="fine-tune-discard"
          :question="t('calc.fineTune.discardQuestion')"
          :note="t('calc.fineTune.discardNote')"
          :confirm-label="t('calc.fineTune.discardConfirm')"
          :cancel-label="t('common.cancel')"
          test-id="fine-tune-discard-confirm"
          confirm-test-id="fine-tune-discard-confirm-yes"
          cancel-test-id="fine-tune-discard-confirm-no"
          @confirm="emit('close')"
        />
      </div>

      <footer class="fineTuneModal__footer">
        <div class="fineTuneModal__history">
          <HistoryButtons :history="fineTune.history" undo-test-id="fine-tune-undo-button" redo-test-id="fine-tune-redo-button" />
          <button
            class="btn btn--soft"
            type="button"
            data-testid="fine-tune-reset"
            :title="t('calc.fineTune.resetTitle')"
            :disabled="fineTune.isEmpty.value"
            @click="dispatch({ kind: 'resetAll' })"
          >{{ t("calc.fineTune.reset") }}</button>
        </div>
        <div class="fineTuneModal__actions">
          <button class="btn btn--soft" type="button" data-testid="fine-tune-cancel" @click="emit('close')">{{ t("calc.fineTune.cancel") }}</button>
          <button class="btn btn--primary" type="button" data-testid="fine-tune-apply" :disabled="fineTune.isEmpty.value" @click="applyDraft">{{ t("calc.fineTune.apply") }}</button>
        </div>
      </footer>
    </div>
    <RowReorderNav :nav="rowDrag.nav" :set-list="rowDrag.setNavList" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Diagnosis, ReceiverNotice } from "../domain/fine-tune/advice";
import type { FineTuneOp } from "../domain/fine-tune/draft";
import type { Change } from "../domain/fine-tune/rowView";
import { useFineTune, FINE_TUNE_STEP_OPTIONS } from "../composables/useFineTune";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useHistoryShortcuts } from "../composables/useHistoryShortcuts";
import { useRowReorderDrag } from "../composables/useRowReorderDrag";
import { showToast } from "../composables/useToast";
import type { CalcStore } from "../composables/useCalcStore";
import FineTuneRow from "./FineTuneRow.vue";
import HistoryButtons from "./HistoryButtons.vue";
import InlineConfirm from "./InlineConfirm.vue";
import RowReorderNav from "./RowReorderNav.vue";

/**
 * やりくりモーダル（設計書 やりくりモーダル_設計書.md）。表示と op を投げることだけを持つ。
 * 状態・プレビュー・適用・日付の停止と再開は `useFineTune`。コンポーネントが外れる（unmount）と、
 * どの閉じ方でもその寿命に結びついた日付の再開と実行役の破棄が走る（§10.3）。
 * 上限・順位・診断はドメインが出す。ここでは kind から文言を引く表で分岐する。
 */
const props = defineProps<{
  calc: CalcStore;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const { t, locale } = useI18n();
const calc = props.calc;
const fineTune = useFineTune(calc, { t });

const TABS = [
  { id: "raise", label: "calc.fineTune.tabRaise" },
  { id: "yield", label: "calc.fineTune.tabYield" },
] as const;
const mode = ref<"raise" | "yield">("raise");
// 順位・効果・おすすめ量はモード1だけで使う。モード2の間は重い計算を求めない
watch(mode, (value) => { fineTune.adviceActive.value = value === "raise"; }, { immediate: true });

const modalRef = ref<HTMLElement | null>(null);
useFocusTrap(modalRef);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const discardConfirmRef = ref<InstanceType<typeof InlineConfirm> | null>(null);

// ===== op =====
function dispatch(op: FineTuneOp): void {
  fineTune.dispatch(op);
}

// ===== 並べ替え（↑↓ は行、つかんで動かすのは useRowReorderDrag。確定は move の op、D33） =====
const rowDrag = useRowReorderDrag({
  items: () => fineTune.rowViews.value.map((row) => ({ id: row.id, title: row.title })),
  onCommit: (rowId, toIndex) => dispatch({ kind: "move", rowId, toIndex }),
});

// ===== 元に戻す・やり直す（Ctrl+Z / Ctrl+Y。確認を出している間と、つかんで動かしている間は効かせない） =====
useHistoryShortcuts({
  isBlocked: () => discardConfirmRef.value?.isOpen === true || rowDrag.draggingId.value !== null,
  step: (direction) => {
    if (direction === "undo") fineTune.undo();
    else fineTune.redo();
  },
});

// ===== 閉じる（下書きがあれば確認、§9.4） =====
function requestClose(): void {
  if (rowDrag.draggingId.value !== null) {
    rowDrag.cancel();
    return;
  }
  if (!fineTune.isEmpty.value) {
    discardConfirmRef.value?.open(closeButtonRef.value);
    return;
  }
  emit("close");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") requestClose();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

// ===== 適用（§10.2）。適用してから閉じる。日付の再開は unmount 側 =====
function applyDraft(): void {
  const result = fineTune.apply();
  if (result === "applied") showToast(t("calc.fineTune.applied"));
  else if (result === "stale") showToast(t("calc.fineTune.applyStale"));
  else return;
  emit("close");
}

// ===== 表示 =====
const summary = fineTune.summary;

/** `基準 → 変更後`。変わっていなければ1つだけ。結果がまだ無いとき（変更後が null）は基準のまま。 */
function summaryChange(change: Change<number | null>, format: (n: number) => string): string {
  const { base, value } = change;
  if (base === null) return "-";
  if (value === null || value === base) return format(base);
  return `${format(base)} → ${format(value)}`;
}

const boostOver = computed(() => {
  const remaining = summary.value?.boostRemaining?.value;
  return remaining !== undefined && remaining < 0 ? -remaining : 0;
});

const DIAGNOSIS_TEXT: Readonly<Record<Diagnosis["kind"], string>> = {
  allReachedRoom: "calc.fineTune.diagnosis.allReachedRoom",
  allReachedNoRoom: "calc.fineTune.diagnosis.allReachedNoRoom",
  candyShortRoom: "calc.fineTune.diagnosis.candyShortRoom",
  candyShortNoSlot: "calc.fineTune.diagnosis.candyShortNoSlot",
  candyShortNoShards: "calc.fineTune.diagnosis.candyShortNoShards",
  shardsShort: "calc.fineTune.diagnosis.shardsShort",
  boostCapShort: "calc.fineTune.diagnosis.boostCapShort",
  noBoostAllReached: "calc.fineTune.diagnosis.noBoostAllReached",
  noBoostShort: "calc.fineTune.diagnosis.noBoostShort",
};

const FACTOR_TEXT = {
  candy: "calc.fineTune.factor.candy",
  shards: "calc.fineTune.factor.shards",
  boost: "calc.fineTune.factor.boost",
} as const;

const diagnosisView = computed(() => {
  const diagnosis = fineTune.diagnosis.value;
  if (diagnosis === null) return null;
  const name = "firstShortId" in diagnosis ? fineTune.titleOf(diagnosis.firstShortId) : "";
  const also = "alsoShort" in diagnosis
    ? diagnosis.alsoShort.map((item) => t("calc.fineTune.diagnosis.alsoShort", {
      name: fineTune.titleOf(item.rowId),
      factor: t(FACTOR_TEXT[item.factor]),
    }))
    : [];
  return { kind: diagnosis.kind, text: t(DIAGNOSIS_TEXT[diagnosis.kind], { name }), also };
});

const NOTICE_TEXT: Readonly<Record<ReceiverNotice["kind"], string>> = {
  noGivers: "calc.fineTune.notice.noGivers",
  belowReceiver: "calc.fineTune.notice.belowReceiver",
  takenFirst: "calc.fineTune.notice.takenFirst",
};

const noticeTexts = computed(() => fineTune.notices.value.map((notice) => {
  const separator = locale.value === "ja" ? "、" : ", ";
  const params = {
    receiver: fineTune.titleOf(notice.receiverId),
    giver: notice.kind === "belowReceiver" ? fineTune.titleOf(notice.giverId)
      : notice.kind === "takenFirst" ? notice.giverIds.map((id) => fineTune.titleOf(id)).join(separator) : "",
    taker: notice.kind === "takenFirst" ? fineTune.titleOf(notice.takerId) : "",
  };
  return { kind: notice.kind, text: t(NOTICE_TEXT[notice.kind], params) };
}));
</script>
