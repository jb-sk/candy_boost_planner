<template>
  <div class="modal-overlay fineTune-overlay" data-testid="fine-tune-overlay" @click.self="requestClose">
    <div
      ref="modalRef"
      class="modal fineTuneModal"
      :class="{ 'fineTuneModal--pending': fineTune.stale.value, 'fineTuneModal--busy': fineTune.raising.value }"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      :aria-label="t('calc.fineTune.title')"
      :aria-busy="fineTune.raising.value ? 'true' : undefined"
      data-testid="fine-tune-modal"
    >
      <!-- 見出しは置かず、残りの枠とかけらを × と同じ段に並べる -->
      <header class="modal__header fineTuneModal__header">
        <div v-if="fineTune.ready.value && summary !== null" class="fineTuneSummary" data-testid="fine-tune-summary">
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
          <span v-if="fineTune.previewing.value || fineTune.raising.value" class="fineTuneSummary__calculating" data-testid="fine-tune-calculating" role="status">{{ t("calc.fineTune.calculating") }}</span>
        </div>
        <button ref="closeButtonRef" class="modal__close fineTuneModal__close" data-testid="fine-tune-close" type="button" :aria-label="t('common.close')" @click="requestClose">×</button>
      </header>

      <p v-if="!fineTune.ready.value" class="fineTuneModal__loading" data-testid="fine-tune-loading" role="status">{{ t("calc.fineTune.loading") }}</p>

      <template v-else>
        <p v-if="fineTune.previewFailed.value" class="fineTuneModal__warn" data-testid="fine-tune-preview-failed" role="alert">{{ t("calc.fineTune.previewFailed") }}</p>

        <div
          ref="listRef"
          class="modal__body fineTuneModal__list"
          :class="{ 'fineTuneModal__list--noBoost': !fineTune.hasBoost.value }"
          data-testid="fine-tune-list"
          :data-pending="fineTune.stale.value ? 'true' : undefined"
        >
          <div class="fineTuneHead" aria-hidden="true">
            <span class="fineTuneHead__cell"></span>
            <span class="fineTuneHead__cell fineTuneHead__cell--name">{{ t("calc.fineTune.col.pokemon") }}</span>
            <span class="fineTuneHead__cell" :title="t('calc.fineTune.field.target')">{{ t("calc.fineTune.col.target") }}</span>
            <span class="fineTuneHead__cell fineTuneHead__cell--sleep" :title="t('calc.fineTune.col.sleepTitle')">{{ t("calc.fineTune.col.sleep") }}</span>
            <span class="fineTuneHead__cell" :title="t('calc.fineTune.col.reachTitle')">{{ t("calc.fineTune.col.reach") }}</span>
            <span v-if="fineTune.hasBoost.value" class="fineTuneHead__cell">{{ t("calc.fineTune.col.boost") }}</span>
            <span class="fineTuneHead__cell">{{ t("calc.fineTune.col.candy") }}</span>
            <!-- 長い見出しなので、狭い幅でも崩れないよう2段に分けて置く -->
            <span class="fineTuneHead__cell fineTuneHead__cell--wrap" :title="t('calc.fineTune.col.shardsPerCandyTitle', { rate: shardRate })">
              <span class="fineTuneHead__line">{{ t("calc.fineTune.col.shardsPerCandyLine1") }}</span>
              <span class="fineTuneHead__line">{{ t("calc.fineTune.col.shardsPerCandyLine2") }}</span>
            </span>
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

        <!-- 操作の場所は常に出す。何も選んでいないときは押せないボタンだけ -->
        <FineTuneEditor
          :key="selectedRow !== null && selected !== null ? `${selectedRow.id}:${selected.field}` : 'idle'"
          :row="selectedRow"
          :field="selected?.field ?? null"
          :pending="fineTune.stale.value"
          :busy="fineTune.raising.value"
          :global-minimize="calc.minimizeBoost.value"
          :can-reset="canReset"
          :fmt="calc.fmtNum"
          :title-of="fineTune.titleOf"
          @op="dispatch"
          @reset="resetEdit"
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
        <!-- アメブなしのスロットでは動かすアメブが無いので出さない。
             伸ばせないと分かっているときは押せない見た目にし、押すと理由だけを出す（求め直さない） -->
        <button
          v-if="fineTune.ready.value && fineTune.hasBoost.value"
          class="btn btn--soft fineTuneModal__raise"
          :class="{ 'fineTuneModal__raise--off': raiseBlocked !== null }"
          type="button"
          data-testid="fine-tune-raise"
          :title="raiseBlocked ?? t('calc.fineTune.raiseTitle')"
          :aria-disabled="raiseBlocked !== null ? 'true' : undefined"
          :disabled="fineTune.raising.value"
          @click="raise"
        >{{ fineTune.raising.value ? t("calc.fineTune.raising") : t("calc.fineTune.raise") }}</button>
        <!-- この画面での変更をすべて捨てて閉じる（押した時点で決めたことなので確認は出さない） -->
        <button class="btn fineTuneModal__cancel" type="button" data-testid="fine-tune-cancel" @click="emit('close')">{{ t("calc.fineTune.cancel") }}</button>
        <button class="btn btn--primary fineTuneModal__apply" type="button" data-testid="fine-tune-apply" :disabled="fineTune.isEmpty.value || fineTune.raising.value" @click="applyDraft">{{ t("calc.fineTune.apply") }}</button>
      </footer>
    </div>
    <RowReorderNav :nav="rowDrag.nav" :set-list="rowDrag.setNavList" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { FineTuneOp } from "../domain/fine-tune/draft";
import type { ShortageType } from "../domain/level-planner/types";
import type { Change } from "../domain/fine-tune/rowView";
import { useFineTune, type FineTuneRaiseResult } from "../composables/useFineTune";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useHistoryShortcuts } from "../composables/useHistoryShortcuts";
import type { HistoryRecordOptions } from "../composables/useHistory";
import { useRowReorderDrag } from "../composables/useRowReorderDrag";
import { showToast } from "../composables/useToast";
import type { CalcStore } from "../composables/useCalcStore";
import { boostRules } from "../domain/pokesleep/boost-config";
import { FINE_TUNE_REASON_TOAST, type FineTuneField } from "../utils/fineTuneView";
import FineTuneEditor from "./FineTuneEditor.vue";
import FineTuneRow from "./FineTuneRow.vue";
import HistoryButtons from "./HistoryButtons.vue";
import InlineConfirm from "./InlineConfirm.vue";
import RowReorderNav from "./RowReorderNav.vue";

/**
 * シンプル。計算機の全員を数字だけの表で見渡し、押した欄（目標Lv・アメブ）を下の調整バーで動かす。
 * 「全体のLvを伸ばす」は全員のアメブ（とそれで決まる使うアメ）をまとめて動かす。
 * 状態・プレビュー・適用・日付の停止と再開は `useFineTune`。コンポーネントが外れる（unmount）と、
 * どの閉じ方でもその寿命に結びついた日付の再開と実行役の破棄が走る。
 */
const props = defineProps<{
  calc: CalcStore;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18n();
const calc = props.calc;
const fineTune = useFineTune(calc, { t });

const modalRef = ref<HTMLElement | null>(null);
useFocusTrap(modalRef);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const discardConfirmRef = ref<InstanceType<typeof InlineConfirm> | null>(null);
const listRef = ref<HTMLElement | null>(null);

// ===== op =====
/** `coalesce` は Lvピッカーのスライダーの1回のドラッグの目印（元に戻すの1件にまとめる） */
function dispatch(op: FineTuneOp, coalesce?: HistoryRecordOptions): void {
  fineTune.dispatch(op, coalesce);
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

// ===== リセット（選んだポケモンを、モーダルを開いた時点の状態へまるごと戻す。選択はそのまま） =====
/**
 * 選んだポケモンの、開いた時点の行（基準の行）と、その行の進化系。リセットはここへ戻す
 * （アメの数の記録は外し、進化系の在庫は開いた時点の在庫に戻す）。
 * どの欄で押しても同じで、欄を移ってから戻っても戻す先は変わらない。並べ替えた位置は戻さない
 */
const resetTarget = computed(() => {
  const s = selected.value;
  const baseRow = s === null ? undefined : fineTune.base.value?.rows.find((r) => r.id === s.rowId);
  if (baseRow === undefined) return null;
  return { row: baseRow, familyKey: calc.speciesCandyFamilyOf(baseRow) };
});

/** 選んだポケモンが、開いた時点から変わっている（行・アメの数の記録・その進化系の在庫のどれか） */
const canReset = computed(() => {
  const target = resetTarget.value;
  const state = fineTune.state.value;
  if (target === null || state === null) return false;
  const id = target.row.id;
  return state.rows.find((r) => r.id === id) !== target.row
    || state.candyRecords[id] !== undefined
    || (target.familyKey !== undefined && state.speciesCandy[target.familyKey] !== undefined);
});

/** 開いた時点へ戻す。選択はそのままなので、続けて動かして、また戻せる */
function resetEdit(): void {
  const target = resetTarget.value;
  if (target === null) return;
  dispatch({
    kind: "revertRow",
    rowId: target.row.id,
    row: target.row,
    candyRecord: undefined,
    stock: target.familyKey === undefined ? undefined : { familyKey: target.familyKey, count: undefined },
  });
}

// ===== 並べ替え（取っ手をつかんで動かすのは useRowReorderDrag、取っ手の ↑↓ キーは行。確定は move の op） =====
const rowDrag = useRowReorderDrag({
  items: () => fineTune.rowViews.value.map((row) => ({ id: row.id, title: row.title })),
  onCommit: (rowId, toIndex) => dispatch({ kind: "move", rowId, toIndex }),
});

// ===== 元に戻す・やり直す（Ctrl+Z / Ctrl+Y。確認を出している間と、つかんで動かしている間は効かせない） =====
useHistoryShortcuts({
  isBlocked: () => discardConfirmRef.value?.isOpen === true || rowDrag.draggingId.value !== null || fineTune.raising.value,
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

// ===== 全体のLvを伸ばす。結果はトーストで知らせる（伸びた行は太字になる） =====

const UNCHANGED_TOAST: Readonly<Record<ShortageType, string>> = {
  candy: "calc.fineTune.raiseUnchangedCandy",
  shards: "calc.fineTune.raiseUnchangedShards",
  boost: "calc.fineTune.raiseUnchangedBoost",
};

/** 結果の文言。伸びなかったときは、先頭の届かない行を止めているものを添える */
function raiseToastKey(result: FineTuneRaiseResult): string | null {
  switch (result.kind) {
    case "raised":
      return "calc.fineTune.raised";
    case "allReached":
      return "calc.fineTune.raiseAllReached";
    case "unchanged":
      return result.limitingFactor === null ? "calc.fineTune.raiseUnchanged" : UNCHANGED_TOAST[result.limitingFactor];
    case "failed":
      return "calc.fineTune.raiseFailed";
    default:
      return null;
  }
}

/** 伸ばせないと分かっているときの理由（ボタンのホバーに出す）。伸ばせるかもしれなければ null */
const raiseBlocked = computed(() => {
  const check = fineTune.raiseCheck.value;
  if (check.kind === "possible") return null;
  const key = raiseToastKey(check);
  return key === null ? "" : t(key);
});

async function raise(): Promise<void> {
  // 個数欄に打ちかけの値があれば、先に確定させる（blur で op が通る）
  if (document.activeElement instanceof HTMLInputElement && modalRef.value?.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  // 伸ばせないと分かっていれば求めず、理由だけを出す
  const check = fineTune.raiseCheck.value;
  const result = check.kind === "possible" ? await fineTune.raiseAll() : check;
  // 全員の値が変わるので、選んでいた欄の「押す前の値」は当てにならない。選択を外す
  if (result.kind === "raised") selected.value = null;
  const key = raiseToastKey(result);
  if (key === null) return;
  // 伸ばせなかった理由（何が足りないか・どうすれば伸びるか）は長いので、読み切れるよう長めに出し、折り返す。
  // 読んだら画面のどこかを押すとすぐ消える
  const explains = result.kind === "unchanged" && result.limitingFactor !== null;
  showToast(t(key), explains ? FINE_TUNE_REASON_TOAST : {});
}

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

/** アメブで与えたときのかけらの倍率（見出しのホバーに出す） */
const shardRate = computed(() => boostRules[calc.boostKind.value].shardMultiplier);

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
</script>
