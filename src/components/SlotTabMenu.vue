<template>
  <div
    ref="rootRef"
    class="slotTabMenu"
    :class="{ 'slotTabMenu--open': isOpen }"
    @focusout="onFocusOut"
    @keydown.esc="close(true)"
  >
    <button
      ref="triggerRef"
      type="button"
      class="slotTabMenu__trigger"
      data-testid="calc-slot-menu-trigger"
      :data-value="boostKind"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      @click="toggle"
      @keydown.down.prevent="open(true)"
      @keydown.up.prevent="open(true)"
    >
      <span class="slotTabMenu__value">{{ currentLabel }}</span>
      <!-- 背景画像の SVG は currentColor が効かない（黒になる）ので、要素で置いて文字と同じ色にする -->
      <svg class="slotTabMenu__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2" fill="none" />
      </svg>
    </button>
    <!-- 一覧の上で押してもタブの並べ替えを始めない（外側を押したら閉じる処理は document の capture で受けるので届く） -->
    <ul
      v-if="isOpen"
      ref="listRef"
      class="slotTabMenu__list"
      data-testid="calc-slot-menu"
      role="menu"
      :aria-label="t('calc.slotMenuLabel')"
      @keydown="onListKeydown"
      @pointerdown.stop
      @mousedown.stop
      @touchstart.passive.stop
    >
      <li
        v-for="kind in kinds"
        :key="kind.value"
        class="slotTabMenu__item"
        data-testid="calc-slot-menu-kind"
        :data-value="kind.value"
        role="menuitemradio"
        tabindex="-1"
        :aria-checked="kind.value === boostKind ? 'true' : 'false'"
        @click="selectKind(kind.value)"
      >{{ kind.label }}</li>
      <li class="slotTabMenu__separator" role="separator"></li>
      <li
        class="slotTabMenu__item"
        data-testid="calc-slot-menu-copy"
        role="menuitem"
        tabindex="-1"
        :aria-disabled="rowCount > 0 ? undefined : 'true'"
        :title="t('calc.copySlotTitle')"
        @click="run('copy', rowCount > 0)"
      >{{ t("calc.copySlot") }}</li>
      <!-- コピーしたかどうかはメニューを開くまで見えないので、貼り付けると入る体数を添える -->
      <li
        class="slotTabMenu__item"
        data-testid="calc-slot-menu-paste"
        role="menuitem"
        tabindex="-1"
        :aria-disabled="pasteCount > 0 ? undefined : 'true'"
        :title="t('calc.pasteSlotTitle')"
        @click="run('paste', pasteCount > 0)"
      >{{ pasteCount > 0 ? t("calc.pasteSlotWithCount", { count: pasteCount }) : t("calc.pasteSlot") }}</li>
      <!-- 全員を消す操作は区切って最後に置く（元に戻すで戻せるので確認は出さない） -->
      <li class="slotTabMenu__separator" role="separator"></li>
      <li
        class="slotTabMenu__item slotTabMenu__item--danger"
        data-testid="calc-slot-menu-clear"
        role="menuitem"
        tabindex="-1"
        :aria-disabled="rowCount > 0 ? undefined : 'true'"
        :title="t('calc.clearPokemons')"
        @click="run('clear', rowCount > 0)"
      >{{ t("calc.clearPokemonsShort") }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * 選択中のスロットタブのメニュー。アメブの種類の選択と、そのスロットへの操作（コピー・ペースト・クリア）をまとめる。
 * 標準の `<select>` に操作を混ぜると iOS の一覧で種類の1つに見えるので自作にした。作りはテーマの選択（DesignSwitcher.vue）と同じ:
 * - 一覧は body へ移さず、タブ（CalcPanel.css の `.slotTab--active`）を基準に真下へ置く（スクロールで閉じなくてよい）。
 * - 確定は行の click の1か所（一覧の中の Enter / Space も行の click を呼ぶ）。
 * - 押せない行は `aria-disabled` で薄くし、押しても閉じない。矢印キーでは止まる（WAI-ARIA のメニューと同じ）。
 * - タブの並べ替えはトリガーの上から始めてよい。ドラッグの後の click は CalcPanel が捨てるので開かない。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { BoostEvent } from "../domain/types";
import { listenDocumentPress } from "../utils/listenDocumentPress";
import { focusWithoutScroll } from "../utils/focusWithoutScroll";

type SlotMenuAction = "copy" | "paste" | "clear";

const props = defineProps<{
  boostKind: BoostEvent;
  kinds: readonly { value: BoostEvent; label: string }[];
  /** スロットの行の数。0 ならコピー・クリアできない */
  rowCount: number;
  /** 貼り付けると入る体数。0 ならペーストできない */
  pasteCount: number;
}>();

const emit = defineEmits<{
  (e: "select-kind", kind: BoostEvent): void;
  (e: SlotMenuAction): void;
}>();

const { t } = useI18n();

const rootRef = ref<HTMLDivElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const listRef = ref<HTMLUListElement | null>(null);
const isOpen = ref(false);

const currentLabel = computed(() => props.kinds.find((kind) => kind.value === props.boostKind)?.label ?? "");

/** 矢印キーで移る行（区切り線を除く） */
function menuItems(): HTMLElement[] {
  return listRef.value ? Array.from(listRef.value.querySelectorAll<HTMLElement>('[role^="menuitem"]')) : [];
}

/** キーボードでは行が見えるまでページをスクロールさせる。指やマウスでは、開いただけでページが動かないようにする */
function focusItem(item: HTMLElement, byKeyboard: boolean): void {
  if (byKeyboard) item.focus();
  else focusWithoutScroll(item);
}

/** 開いたら選んでいる種類の行へフォーカスを入れる（標準の select と同じ）。開いたまま ↓ を押したときも入り直す */
async function open(byKeyboard: boolean): Promise<void> {
  if (!isOpen.value) {
    isOpen.value = true;
    await nextTick();
  }
  const items = menuItems();
  const checked = items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0];
  if (checked) focusItem(checked, byKeyboard);
}

function close(returnFocus = false): void {
  if (!isOpen.value) return;
  isOpen.value = false;
  if (returnFocus && triggerRef.value) focusWithoutScroll(triggerRef.value);
}

/** キーボードの Enter / Space で押した click は detail が 0 */
function toggle(ev: MouseEvent): void {
  if (isOpen.value) close();
  else void open(ev.detail === 0);
}

function selectKind(kind: BoostEvent): void {
  close(true);
  if (kind !== props.boostKind) emit("select-kind", kind);
}

function run(action: SlotMenuAction, enabled: boolean): void {
  if (!enabled) return;
  close(true);
  emit(action);
}

function onListKeydown(ev: KeyboardEvent): void {
  const items = menuItems();
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (ev.key === "Tab") {
    close();
    return;
  }
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    items[index]?.click();
    return;
  }
  const next = ev.key === "ArrowDown" ? Math.min(index + 1, items.length - 1)
    : ev.key === "ArrowUp" ? Math.max(index - 1, 0)
    : ev.key === "Home" ? 0
    : ev.key === "End" ? items.length - 1
    : -1;
  if (next < 0) return;
  ev.preventDefault();
  focusItem(items[next], true);
}

/**
 * フォーカスが部品の外の要素へ移ったら閉じる（Tab で外へ出たとき）。
 * 行き先が無い（body に落ちた）ときは閉じない: Safari は押した要素にフォーカスを入れないことがある（外側を押したときは onPressOutside が閉じる）。
 */
function onFocusOut(ev: FocusEvent): void {
  const to = ev.relatedTarget;
  if (to instanceof Node && !rootRef.value?.contains(to)) close();
}

/** 外側を押したら閉じる。トリガーは click で開閉するので除く */
function onPressOutside(ev: Event): void {
  if (ev.target instanceof Node && rootRef.value?.contains(ev.target)) return;
  close();
}

watch(isOpen, (opened) => listenDocumentPress(onPressOutside, opened));
onBeforeUnmount(() => listenDocumentPress(onPressOutside, false));
</script>
