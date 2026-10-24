<template>
  <button
    ref="undoButton"
    class="historyBtn"
    type="button"
    :data-testid="undoTestId"
    :disabled="!history.canUndo.value"
    :aria-label="spokenTitle('undo', history.undoLabel.value)"
    aria-keyshortcuts="Control+Z Meta+Z"
    :title="undoTitle"
    @click="stepHistoryWithToast(history, 'undo', t)"
  >
    <span class="historyBtn__content">
      <span class="historyBtn__icon" v-html="iconUndoSvg" aria-hidden="true"></span>
      <span class="historyBtn__label" aria-hidden="true">{{ t("common.undo") }}</span>
    </span>
  </button>
  <button
    class="historyBtn"
    type="button"
    :data-testid="redoTestId"
    :disabled="!history.canRedo.value"
    :aria-label="spokenTitle('redo', history.redoLabel.value)"
    aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z"
    :title="redoTitle"
    @click="stepHistoryWithToast(history, 'redo', t)"
  >
    <span class="historyBtn__content">
      <span class="historyBtn__icon" v-html="iconRedoSvg" aria-hidden="true"></span>
      <span class="historyBtn__label" aria-hidden="true">{{ t("common.redo") }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import iconUndoSvg from "../assets/icons/undo.svg?raw";
import iconRedoSvg from "../assets/icons/redo.svg?raw";
import { stepHistoryWithToast, type HistoryControls } from "../composables/useHistory";
import { historyShortcutLabel, type HistoryDirection } from "../composables/useHistoryShortcuts";

/**
 * 元に戻す・やり直すのボタン（2つ並べるだけで、外枠は置き場所側が持つ）。
 * スマホ・タブレットは上部のナビ（MobileNav）、PC は画面下中央の帯（App の .historyDock）に置く。
 */
const props = withDefaults(defineProps<{
  history: HistoryControls;
  /** 同じ画面に複数の組があるとき（やりくりモーダル）、E2E が取り違えないよう変える。 */
  undoTestId?: string;
  redoTestId?: string;
}>(), {
  undoTestId: "history-undo-button",
  redoTestId: "history-redo-button",
});

const { t } = useI18n();
const undoButton = ref<HTMLButtonElement | null>(null);

/** 読み上げ用の「元に戻す：○○」。戻すものが無ければ操作名を省く */
function spokenTitle(direction: HistoryDirection, label: string | null): string {
  const action = t(direction === "undo" ? "common.undo" : "common.redo");
  return label === null ? action : t("nav.historyWithLabel", { action, label });
}

/** マウスを乗せたときの説明。ショートカットも添える（読み上げは aria-keyshortcuts で伝える） */
const undoTitle = computed(() => `${spokenTitle("undo", props.history.undoLabel.value)} (${historyShortcutLabel("undo")})`);
const redoTitle = computed(() => `${spokenTitle("redo", props.history.redoLabel.value)} (${historyShortcutLabel("redo")})`);

defineExpose({ undoButton });
</script>
