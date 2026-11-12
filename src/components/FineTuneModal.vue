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
        <button ref="closeButtonRef" class="modal__close fineTuneModal__close" data-testid="fine-tune-close" type="button" :aria-label="t('common.close')" @click="requestClose">
          <!-- × は細い線の絵にする（文字の × はフォントで太さが変わる） -->
          <svg class="fineTuneModal__closeIcon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
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
          <!-- 見出しの説明（ツールチップ）は付けない（スマホで出ないため） -->
          <div class="fineTuneHead" aria-hidden="true">
            <!-- 取っ手の列（PC幅だけ） -->
            <span class="fineTuneHead__cell fineTuneHead__cell--handle"></span>
            <!-- スマホ幅は取っ手が無いので、名前をつかんで並べ替えられることを ⌃⌄ の印で匂わせる（計算機の行の並べ替えの印と同じ形。
                 PC幅は取っ手のグリップがあるので出さない） -->
            <span class="fineTuneHead__cell fineTuneHead__cell--name"><svg class="fineTuneHead__reorderIcon" data-testid="fine-tune-head-reorder-icon" viewBox="0 0 16 17" width="9" height="10"><path d="M4.5 5.5L8 2 11.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 11.5L8 15 11.5 11.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{{ t("calc.fineTune.col.pokemon") }}</span>
            <span class="fineTuneHead__cell">{{ t("calc.fineTune.col.target") }}</span>
            <span class="fineTuneHead__cell fineTuneHead__cell--sleep">{{ t("calc.fineTune.col.sleep") }}</span>
            <span class="fineTuneHead__cell">{{ t("calc.fineTune.col.reach") }}</span>
            <span v-if="fineTune.hasBoost.value" class="fineTuneHead__cell">{{ t("calc.fineTune.col.boost") }}</span>
            <span class="fineTuneHead__cell">{{ fineTune.hasBoost.value ? t("calc.fineTune.col.candyTotal") : t("calc.fineTune.col.candy") }}</span>
            <!-- 長い見出しなので、狭い幅でも崩れないよう2段に分けて置く -->
            <span class="fineTuneHead__cell fineTuneHead__cell--wrap">
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
            @op="fineTune.dispatch"
            @select="(field) => select(row.id, field)"
            @handle-press="rowDrag.onHandlePress"
            @name-press="rowDrag.onItemPress"
            @name-touchmove="rowDrag.onItemTouchMove"
          />
        </div>

        <!-- 操作の場所は常に出す。何も選んでいないときは設定欄（最小限のアメブ・既定のアメブ目標Lv・かけら・万能アメ） -->
        <FineTuneEditor
          :key="selectedRow !== null && selected !== null ? `${selectedRow.id}:${selected.field}` : 'idle'"
          :row="selectedRow"
          :field="selected?.field ?? null"
          :busy="fineTune.raising.value"
          :can-reset="canReset"
          :can-remove="fineTune.rowViews.value.length > 1"
          :settings="fineTune.settings.value"
          :has-boost="fineTune.hasBoost.value"
          :fmt="calc.fmtNum"
          @op="fineTune.dispatch"
          @reset="resetEdit"
          @remove="removeSelected"
          @open-settings="requestOpenSettings"
        />
      </template>

      <!-- 下書きを捨てる確認。閉じるとき（×・Escape・背景）と、計算機の設定を開くとき（設定欄の「こちら」）で文言を変える -->
      <div class="fineTuneModal__confirm">
        <InlineConfirm
          ref="discardConfirmRef"
          id-prefix="fine-tune-discard"
          :question="t(discardAction === 'settings' ? 'calc.fineTune.discardSettingsQuestion' : 'calc.fineTune.discardQuestion')"
          :note="t('calc.fineTune.discardNote')"
          :confirm-label="t(discardAction === 'settings' ? 'calc.fineTune.discardSettingsConfirm' : 'calc.fineTune.discardConfirm')"
          :cancel-label="t('common.cancel')"
          test-id="fine-tune-discard-confirm"
          confirm-test-id="fine-tune-discard-confirm-yes"
          cancel-test-id="fine-tune-discard-confirm-no"
          @confirm="discardAction === 'settings' ? emit('open-settings') : emit('close')"
        />
      </div>

      <footer class="fineTuneModal__footer">
        <div class="fineTuneModal__history">
          <HistoryButtons :history="fineTune.history" undo-test-id="fine-tune-undo-button" redo-test-id="fine-tune-redo-button" />
        </div>
        <!-- アメブなしのスロットでは動かすアメブが無いので出さない。
             伸ばせないと分かっているときは押せない見た目にし、押すと理由だけを出す（求め直さない）。
             求めている間は「LvUp中止」になり、押すと取り消す（下書きは押す前のまま） -->
        <button
          v-if="fineTune.ready.value && fineTune.hasBoost.value"
          ref="raiseButtonRef"
          class="btn btn--soft fineTuneModal__raise"
          :class="{ 'fineTuneModal__raise--off': raiseBlocked !== null && !fineTune.raising.value }"
          type="button"
          data-testid="fine-tune-raise"
          :data-raising="fineTune.raising.value ? 'true' : undefined"
          :aria-disabled="raiseBlocked !== null && !fineTune.raising.value ? 'true' : undefined"
          @click="raise"
        >
          <!-- 機械がまとめて調整する印（キラキラ）。求めている間は明滅する -->
          <svg class="fineTuneModal__raiseIcon" aria-hidden="true" viewBox="0 0 16 16" width="14" height="14"><path :d="SPARKLE_PATH" fill="currentColor"/></svg>
          <span>{{ fineTune.raising.value ? t("calc.fineTune.raiseStop") : t("calc.fineTune.raise") }}</span>
        </button>
        <!-- この画面での変更をすべて捨てて閉じる（押した時点で決めたことなので確認は出さない） -->
        <button class="btn fineTuneModal__cancel" type="button" data-testid="fine-tune-cancel" @click="emit('close')">{{ t("calc.fineTune.cancel") }}</button>
        <button class="btn btn--primary fineTuneModal__apply" type="button" data-testid="fine-tune-apply" :disabled="fineTune.isEmpty.value || fineTune.raising.value" @click="applyDraft">{{ t("calc.fineTune.apply") }}</button>
      </footer>

      <!-- 全体のLvを伸ばしたときの小窓（変わった行ごとの増減。アメ節約・かけら節約で結果が違えばタブ） -->
      <FineTuneRaiseReport
        v-if="raiseReport !== null"
        :options="raiseReport.options"
        :selected="raiseReport.selected"
        :pending="raiseReport.pending"
        :fmt="calc.fmtNum"
        @select="selectRaiseOption"
        @close="closeRaiseReport"
        @cancel="cancelRaiseReport"
      />
    </div>
    <RowReorderNav :nav="rowDrag.nav" :set-list="rowDrag.setNavList" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ShortageType } from "../domain/level-planner/types";
import type { RaiseOption } from "../domain/fine-tune/raise";
import type { Change } from "../domain/fine-tune/rowView";
import { focusWithoutScroll } from "../utils/focusWithoutScroll";
import { useFineTune, type FineTuneRaiseResult } from "../composables/useFineTune";
import { useFocusTrap } from "../composables/useFocusTrap";
import { useHistoryShortcuts } from "../composables/useHistoryShortcuts";
import { useRowReorderDrag } from "../composables/useRowReorderDrag";
import { showToast } from "../composables/useToast";
import type { CalcStore } from "../composables/useCalcStore";
import { deltaText, FINE_TUNE_REASON_TOAST, SPARKLE_PATH, type FineTuneField } from "../utils/fineTuneView";
import FineTuneEditor from "./FineTuneEditor.vue";
import FineTuneRaiseReport from "./FineTuneRaiseReport.vue";
import FineTuneRow from "./FineTuneRow.vue";
import HistoryButtons from "./HistoryButtons.vue";
import InlineConfirm from "./InlineConfirm.vue";
import { closeOpenLevelPicker } from "./LevelPicker.vue";
import RowReorderNav from "./RowReorderNav.vue";

/**
 * シンプル。計算機の全員を数字だけの表で見渡し、押した欄（睡眠・アメブ・アメ）を下の調整バーで動かす
 * （目標Lvは欄を押すとその場で Lvピッカーを開く）。
 * 「全体のLvを伸ばす」は全員のアメブ（とそれで決まる使うアメ）をまとめて動かす。
 * 状態・プレビュー・適用・日付の停止と再開は `useFineTune`。コンポーネントが外れる（unmount）と、
 * どの閉じ方でもその寿命に結びついた日付の再開と実行役の破棄が走る。
 */
const props = defineProps<{
  calc: CalcStore;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  /** 計算機の設定（在庫・睡眠設定）を開く。シンプルは閉じる（開いている間は計算機を変えないため、重ねて開かない） */
  (e: "open-settings"): void;
}>();

const { t } = useI18n();
const calc = props.calc;
const fineTune = useFineTune(calc, { t });

const modalRef = ref<HTMLElement | null>(null);
useFocusTrap(modalRef);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
const discardConfirmRef = ref<InstanceType<typeof InlineConfirm> | null>(null);
const listRef = ref<HTMLElement | null>(null);

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

/**
 * 選んだポケモンが、開いた時点から変わっている（行・アメの数の記録・その進化系の在庫のどれか）。
 * 何も選んでいないときは、設定欄の設定を変えている
 */
const canReset = computed(() => {
  const target = resetTarget.value;
  const state = fineTune.state.value;
  if (state === null) return false;
  if (selected.value === null) return Object.keys(state.settings).length > 0;
  if (target === null) return false;
  const id = target.row.id;
  return state.rows.find((r) => r.id === id) !== target.row
    || state.candyRecords[id] !== undefined
    || state.nicknames[id] !== undefined
    || (target.familyKey !== undefined && state.speciesCandy[target.familyKey] !== undefined);
});

// ===== 計算機から削除（行の詳細。下書きから外し、OK で計算機の行から外す。元に戻す・キャンセルで戻せる） =====
/** 選択を外す（行が無くなるので操作パネルは設定欄に戻る。元に戻したときに外したポケモンの操作パネルが急に出ないように） */
function removeSelected(): void {
  const s = selected.value;
  if (s === null) return;
  const out = fineTune.dispatch({ kind: "removeRow", rowId: s.rowId });
  if ("state" in out) selected.value = null;
}

/** 開いた時点へ戻す。選択はそのままなので、続けて動かして、また戻せる。何も選んでいないときは設定を戻す */
function resetEdit(): void {
  if (selected.value === null) {
    fineTune.dispatch({ kind: "settingsReset" });
    return;
  }
  const target = resetTarget.value;
  if (target === null) return;
  fineTune.dispatch({
    kind: "revertRow",
    rowId: target.row.id,
    row: target.row,
    candyRecord: undefined,
    stock: target.familyKey === undefined ? undefined : { familyKey: target.familyKey, count: undefined },
  });
}

// ===== 並べ替え（取っ手・名前をつかんで動かすのは useRowReorderDrag、取っ手の ↑↓ キーは行。確定は move の op） =====
const rowDrag = useRowReorderDrag({
  items: () => fineTune.rowViews.value.map((row) => ({ id: row.id, title: row.title })),
  onCommit: (rowId, toIndex) => fineTune.dispatch({ kind: "move", rowId, toIndex }),
});

// ===== 元に戻す・やり直す（Ctrl+Z / Ctrl+Y。確認を出している間と、つかんで動かしている間は効かせない） =====
useHistoryShortcuts({
  isBlocked: () => discardConfirmRef.value?.isOpen === true || rowDrag.draggingId.value !== null || fineTune.raising.value
    || raiseReport.value !== null,
  step: (direction) => {
    if (direction === "undo") fineTune.undo();
    else fineTune.redo();
  },
});

// ===== 閉じる・計算機の設定を開く（下書きがあれば確認） =====
/** 確認で「破棄して〇〇」を押したときにすること */
const discardAction = ref<"close" | "settings">("close");

function requestClose(): void {
  if (rowDrag.draggingId.value !== null) {
    rowDrag.cancel();
    return;
  }
  if (!fineTune.isEmpty.value) {
    discardAction.value = "close";
    discardConfirmRef.value?.open(closeButtonRef.value);
    return;
  }
  emit("close");
}

/**
 * 設定欄の「その他の設定はこちら」。シンプルを閉じてから計算機の設定を開く（書き出し→設定と同じく重ねない。
 * 設定を変えると、開いた時点の計算機と食い違うため）。下書きがあれば、捨ててよいかを先に確かめる
 */
function requestOpenSettings(trigger: HTMLElement | null): void {
  if (rowDrag.draggingId.value !== null) rowDrag.cancel();
  if (!fineTune.isEmpty.value) {
    discardAction.value = "settings";
    discardConfirmRef.value?.open(trigger ?? closeButtonRef.value);
    return;
  }
  emit("open-settings");
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  // 全体のLvを伸ばしたときの小窓が出ていれば、それだけを閉じる
  if (raiseReport.value !== null) {
    closeRaiseReport();
    return;
  }
  // Lvピッカー（表の目標Lv・調整バーの Lv の欄）が開いていれば、まずそれだけを閉じる
  if (closeOpenLevelPicker()) return;
  // 調整バーが出ていれば、先にそれを閉じる
  if (selected.value !== null && discardConfirmRef.value?.isOpen !== true) {
    selected.value = null;
    return;
  }
  requestClose();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

// ===== 全体のLvを伸ばす。伸びたときは変わった行ごとの増減を小窓で、伸びなかったときは理由をトーストで知らせる =====

const raiseButtonRef = ref<HTMLButtonElement | null>(null);
/**
 * 伸びたときの結果の通り（アメ節約・かけら節約。結果が同じなら1つ）と、下書きに入っている通り（`selected`）と、その下書きの版。
 * `pending` は残りの節約するもの（かけら節約）を裏で求めている間。小窓を出している間だけ null でない
 */
const raiseReport = ref<{ options: readonly RaiseOption[]; selected: number; version: number; pending: boolean } | null>(null);

/** タブで別の通りを選んだ。下書きもその結果に替える（元に戻すは1件のまま） */
function selectRaiseOption(index: number): void {
  const view = raiseReport.value;
  const option = view?.options[index];
  if (view === null || option === undefined || index === view.selected) return;
  const version = fineTune.selectRaiseOption(option, view.version);
  if (version !== null) raiseReport.value = { ...view, selected: index, version };
}

/** 小窓を閉じ、フォーカスを「全体のLvを伸ばす」へ戻す（求めている間はボタンが無効で、フォーカスが外れているため） */
function closeRaiseReport(): void {
  raiseReport.value = null;
  // 裏で求めているかけら節約は、もう出す先が無い
  fineTune.stopRaiseMore();
  void nextTick(() => {
    if (raiseButtonRef.value !== null) focusWithoutScroll(raiseButtonRef.value);
  });
}

/** 小窓のキャンセル。伸ばした結果を取りやめて押す前の下書きへ戻し（元に戻す1回と同じ）、小窓を閉じる */
function cancelRaiseReport(): void {
  const view = raiseReport.value;
  if (view !== null) fineTune.revertRaise(view.version);
  closeRaiseReport();
}

const UNCHANGED_TOAST: Readonly<Record<ShortageType, string>> = {
  candy: "calc.fineTune.raiseUnchangedCandy",
  shards: "calc.fineTune.raiseUnchangedShards",
  boost: "calc.fineTune.raiseUnchangedBoost",
};

/** 伸びなかったときのトーストの文言。先頭の届かない行を止めているものを添える（伸びたときは小窓で出す） */
function raiseToastKey(result: FineTuneRaiseResult): string | null {
  switch (result.kind) {
    case "allReached":
      return "calc.fineTune.raiseAllReached";
    case "unchanged":
      // 余りゲートで捨てたときは、足りないものより先に、配分方針を変えると伸ばせることを知らせる
      if (result.surplusGated === true) return "calc.fineTune.raiseUnchangedSurplus";
      return result.limitingFactor === null ? "calc.fineTune.raiseUnchanged" : UNCHANGED_TOAST[result.limitingFactor];
    case "failed":
      return "calc.fineTune.raiseFailed";
    default:
      return null;
  }
}

/** 伸ばせないと分かっているときの理由（押すとトーストに出す）。伸ばせるかもしれなければ null */
const raiseBlocked = computed(() => {
  const check = fineTune.raiseCheck.value;
  if (check.kind === "possible") return null;
  const key = raiseToastKey(check);
  return key === null ? "" : t(key);
});

async function raise(): Promise<void> {
  // 求めている間は「LvUp中止」。押すと取り消す（下書きは押す前のまま）
  if (fineTune.raising.value) {
    fineTune.cancelRaise();
    return;
  }
  commitPendingInput();
  // 伸ばせないと分かっていれば求めず、理由だけを出す
  const check = fineTune.raiseCheck.value;
  const result = check.kind === "possible" ? await fineTune.raiseAll() : check;
  // 全員の値が変わるので、選んでいた欄の「押す前の値」は当てにならない。選択を外す。何が変わったかは小窓で出す
  if (result.kind === "raised") {
    selected.value = null;
    const more = result.more;
    const view = { options: result.options, selected: 0, version: result.version, pending: more !== null };
    raiseReport.value = view;
    // かけら節約を求め終えたら、結果が違えばタブを押せるようにし、同じ（・止めた・失敗した）ならタブを消す。
    // その間に小窓を閉じた・押し直したなら何もしない。はじめに両方とも求めた（アメ節約で伸びなかった）なら待たない
    if (more === null) return;
    void more.then((options) => {
      if (raiseReport.value?.version !== view.version || !raiseReport.value.pending) return;
      raiseReport.value = { ...raiseReport.value, options: options ?? raiseReport.value.options, pending: false };
    });
    return;
  }
  const key = raiseToastKey(result);
  if (key === null) return;
  // 伸ばせなかった理由（何が足りないか・どうすれば伸びるか）は長いので、読み切れるよう長めに出し、折り返す。
  // 読んだら画面のどこかを押すとすぐ消える
  const explains = result.kind === "unchanged" && (result.limitingFactor !== null || result.surplusGated === true);
  showToast(t(key), explains ? FINE_TUNE_REASON_TOAST : {});
}

/** 個数欄に打ちかけの値があれば、先に確定させる（blur で op が通る） */
function commitPendingInput(): void {
  if (document.activeElement instanceof HTMLInputElement && modalRef.value?.contains(document.activeElement)) {
    document.activeElement.blur();
  }
}

// ===== 適用。適用してから閉じる。日付の再開は unmount 側 =====
function applyDraft(): void {
  commitPendingInput();
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
  return base === null || value === null ? "" : deltaText(base, value, calc.fmtNum) ?? "";
}
</script>
