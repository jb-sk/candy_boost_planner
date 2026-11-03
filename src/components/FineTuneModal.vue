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
      <header class="modal__header fineTuneModal__header">
        <h2 class="modal__title">{{ t("calc.fineTune.title") }}</h2>
        <button ref="closeButtonRef" class="modal__close" data-testid="fine-tune-close" type="button" :aria-label="t('common.close')" @click="requestClose">×</button>
      </header>

      <p v-if="!fineTune.ready.value" class="fineTuneModal__loading" data-testid="fine-tune-loading" role="status">{{ t("calc.fineTune.loading") }}</p>

      <template v-else>
        <div v-if="summary !== null" class="fineTuneSummary" data-testid="fine-tune-summary">
          <span class="fineTuneSummary__item" :title="t('calc.fineTune.summary.reachedTitle')">
            <span class="fineTuneSummary__k">{{ t("calc.fineTune.summary.reached") }}</span>
            <span class="fineTuneSummary__v" data-testid="fine-tune-summary-reached">{{ summaryValue(summary.reached, (n) => `${n}/${summary!.total}`) }}</span>
            <span v-if="delta(summary.reached)" class="fineTuneSummary__d">{{ delta(summary.reached) }}</span>
          </span>
          <span
            v-if="summary.boostRemaining !== null"
            class="fineTuneSummary__item"
            :class="{ 'fineTuneSummary__item--over': summary.boostRemaining.value < 0 }"
            :title="summary.boostRemaining.value < 0 ? t('calc.fineTune.summary.boostOverTitle') : undefined"
          >
            <span class="fineTuneSummary__k">{{ t("calc.fineTune.summary.boostRemaining") }}</span>
            <span class="fineTuneSummary__v" data-testid="fine-tune-summary-boost">{{ summaryValue(summary.boostRemaining, calc.fmtNum) }}</span>
            <span v-if="delta(summary.boostRemaining)" class="fineTuneSummary__d">{{ delta(summary.boostRemaining) }}</span>
          </span>
          <span class="fineTuneSummary__item">
            <span class="fineTuneSummary__k">{{ t("calc.fineTune.summary.shardsRemaining") }}</span>
            <span class="fineTuneSummary__v" data-testid="fine-tune-summary-shards">{{ summaryValue(summary.shardsRemaining, calc.fmtNum) }}</span>
            <span v-if="delta(summary.shardsRemaining)" class="fineTuneSummary__d">{{ delta(summary.shardsRemaining) }}</span>
          </span>
          <span v-if="fineTune.previewing.value" class="fineTuneSummary__calculating" data-testid="fine-tune-calculating" role="status">{{ t("calc.fineTune.calculating") }}</span>
        </div>

        <p v-if="fineTune.previewFailed.value" class="fineTuneModal__warn" data-testid="fine-tune-preview-failed" role="alert">{{ t("calc.fineTune.previewFailed") }}</p>

        <div v-if="fineTune.receiver.value !== null" class="fineTuneReceiver" data-testid="fine-tune-receiver">
          <div class="fineTuneReceiver__line">
            <span class="fineTuneReceiver__name" data-testid="fine-tune-receiver-name">{{ t("calc.fineTune.receiver", { name: fineTune.receiver.value.title }) }}</span>
            <button class="btn btn--soft btn--xs" type="button" data-testid="fine-tune-receiver-clear" @click="dispatch({ kind: 'receiverClear' })">{{ t("calc.fineTune.receiverClear") }}</button>
          </div>
          <p v-for="(notice, i) in noticeTexts" :key="i" class="fineTuneReceiver__notice" data-testid="fine-tune-notice" :data-kind="notice.kind">{{ notice.text }}</p>
        </div>

        <div
          ref="listRef"
          class="modal__body fineTuneModal__list"
          data-testid="fine-tune-list"
          :data-pending="fineTune.stale.value ? 'true' : undefined"
        >
          <div class="fineTuneHead" :class="{ 'fineTuneHead--noBoost': !fineTune.hasBoost.value }" aria-hidden="true">
            <span class="fineTuneHead__cell"></span>
            <span class="fineTuneHead__cell fineTuneHead__cell--name">{{ t("calc.fineTune.col.pokemon") }}</span>
            <span class="fineTuneHead__cell" :title="t('calc.fineTune.field.target')">{{ t("calc.fineTune.col.target") }}</span>
            <span class="fineTuneHead__cell" :title="t('calc.fineTune.col.reachTitle')">{{ t("calc.fineTune.col.reach") }}</span>
            <span v-if="fineTune.hasBoost.value" class="fineTuneHead__cell">{{ t("calc.fineTune.col.boost") }}</span>
            <span class="fineTuneHead__cell">{{ t("calc.fineTune.col.candy") }}</span>
            <span class="fineTuneHead__cell">{{ t("calc.fineTune.col.shards") }}</span>
          </div>
          <FineTuneRow
            v-for="(row, i) in fineTune.rowViews.value"
            :key="row.id"
            :row="row"
            :has-boost="fineTune.hasBoost.value"
            :selected-field="selected?.rowId === row.id ? selected.field : null"
            :pending="fineTune.stale.value"
            :is-first="i === 0"
            :is-last="i === fineTune.rowViews.value.length - 1"
            :dragging="rowDrag.draggingId.value === row.id"
            :drag-over="rowDrag.overId.value === row.id && rowDrag.draggingId.value !== row.id"
            :fmt="calc.fmtNum"
            @op="dispatch"
            @select="(field) => select(row.id, field)"
            @handle-press="rowDrag.onHandlePress"
          />
        </div>

        <FineTuneEditor
          v-if="selectedRow !== null && selected !== null"
          :key="`${selectedRow.id}:${selected.field}`"
          :row="selectedRow"
          :field="selected.field"
          :pending="fineTune.stale.value"
          :fmt="calc.fmtNum"
          :title-of="fineTune.titleOf"
          @op="dispatch"
          @close="selected = null"
        />
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
        </div>
        <p v-if="fineTune.ready.value && selected === null" class="fineTuneModal__hint" data-testid="fine-tune-hint">{{ t("calc.fineTune.hint") }}</p>
        <button class="btn btn--primary fineTuneModal__apply" type="button" data-testid="fine-tune-apply" :disabled="fineTune.isEmpty.value" @click="applyDraft">{{ t("calc.fineTune.apply") }}</button>
      </footer>
    </div>
    <RowReorderNav :nav="rowDrag.nav" :set-list="rowDrag.setNavList" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ReceiverNotice } from "../domain/fine-tune/advice";
import type { FineTuneOp } from "../domain/fine-tune/draft";
import type { Change } from "../domain/fine-tune/rowView";
import { useFineTune } from "../composables/useFineTune";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useHistoryShortcuts } from "../composables/useHistoryShortcuts";
import { useRowReorderDrag } from "../composables/useRowReorderDrag";
import { showToast } from "../composables/useToast";
import type { CalcStore } from "../composables/useCalcStore";
import type { FineTuneField } from "../utils/fineTuneView";
import FineTuneEditor from "./FineTuneEditor.vue";
import FineTuneRow from "./FineTuneRow.vue";
import HistoryButtons from "./HistoryButtons.vue";
import InlineConfirm from "./InlineConfirm.vue";
import RowReorderNav from "./RowReorderNav.vue";

/**
 * かんたんモード。計算機の全員を数字だけの表で見渡し、押した欄を下の調整バーで動かす。
 * 目標Lv・アメブ（全体のLvを上げる）と、使うアメ・受け取る（ゆずる・受け取る）を同じ画面で扱う。
 * 状態・プレビュー・適用・日付の停止と再開は `useFineTune`。コンポーネントが外れる（unmount）と、
 * どの閉じ方でもその寿命に結びついた日付の再開と実行役の破棄が走る。
 */
const props = defineProps<{
  calc: CalcStore;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const { t, locale } = useI18n();
const calc = props.calc;
const fineTune = useFineTune(calc, { t });

const modalRef = ref<HTMLElement | null>(null);
useFocusTrap(modalRef);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const discardConfirmRef = ref<InstanceType<typeof InlineConfirm> | null>(null);
const listRef = ref<HTMLElement | null>(null);

// ===== op =====
function dispatch(op: FineTuneOp): void {
  fineTune.dispatch(op);
}

// ===== 選んだ欄（同じ欄をもう一度押すと閉じる） =====
const selected = ref<{ rowId: string; field: FineTuneField } | null>(null);
const selectedRow = computed(() => {
  const s = selected.value;
  return s === null ? null : fineTune.rowViews.value.find((row) => row.id === s.rowId) ?? null;
});

function select(rowId: string, field: FineTuneField): void {
  const current = selected.value;
  if (current !== null && current.rowId === rowId && current.field === field) {
    selected.value = null;
    return;
  }
  selected.value = { rowId, field };
  // 調整バーが出ると一覧が縮むので、選んだ行が隠れないよう寄せる
  void nextTick(() => revealRow(rowId));
}

/**
 * 行が一覧の見えている範囲（見出しの下）に入るよう、一覧だけをスクロールする。
 * scrollIntoView の block: "nearest" は iOS 13 以前の Safari に無く（先頭へ揃えてしまう）、ページ側も動かしうるので使わない。
 */
function revealRow(rowId: string): void {
  const list = listRef.value;
  if (list === null) return;
  const row = [...list.querySelectorAll<HTMLElement>("[data-row-id]")].find((el) => el.dataset.rowId === rowId);
  if (row === undefined) return;
  const headHeight = list.querySelector<HTMLElement>(".fineTuneHead")?.offsetHeight ?? 0;
  const listRect = list.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const above = rowRect.top - (listRect.top + headHeight);
  const below = rowRect.bottom - listRect.bottom;
  if (above < 0) list.scrollTop += above;
  else if (below > 0) list.scrollTop += below;
}

// ===== 並べ替え（取っ手をつかんで動かすのは useRowReorderDrag、取っ手の ↑↓ キーは行。確定は move の op） =====
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

// ===== 閉じる（下書きがあれば確認） =====
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
  if (event.key !== "Escape") return;
  // 調整バーが出ていれば、先にそれを閉じる
  if (selected.value !== null && discardConfirmRef.value?.isOpen !== true) {
    selected.value = null;
    return;
  }
  requestClose();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

// ===== 適用。適用してから閉じる。日付の再開は unmount 側 =====
function applyDraft(): void {
  // 個数欄に打ちかけの値があれば、先に確定させる（blur で op が通る）
  if (document.activeElement instanceof HTMLInputElement && modalRef.value?.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  const result = fineTune.apply();
  if (result === "applied") showToast(t("calc.fineTune.applied"));
  else if (result === "stale") showToast(t("calc.fineTune.applyStale"));
  else return;
  emit("close");
}

// ===== 表示 =====
const summary = fineTune.summary;

/** 今の値。結果がまだ無いとき（変更後が null）は基準のまま。 */
function summaryValue(change: Change<number | null>, format: (n: number) => string): string {
  const value = change.value ?? change.base;
  return value === null ? "-" : format(value);
}

/** 基準からの増減（変わっていなければ空） */
function delta(change: Change<number | null>): string {
  const { base, value } = change;
  if (base === null || value === null || base === value) return "";
  const d = value - base;
  return `${d > 0 ? "+" : "−"}${calc.fmtNum(Math.abs(d))}`;
}

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
