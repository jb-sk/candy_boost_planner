<template>
  <div
    ref="rootRef"
    class="designSwitch"
    :class="{ 'designSwitch--open': isOpen }"
    @focusout="onFocusOut"
    @keydown.esc="close(true)"
  >
    <button
      ref="triggerRef"
      type="button"
      class="designSwitch__trigger"
      data-testid="theme-select-trigger"
      :data-value="modelValue"
      :aria-disabled="disabled ? 'true' : undefined"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :aria-labelledby="labelledby ? `${labelledby} ${valueId}` : undefined"
      @click="toggle"
      @keydown.down.prevent="open(true)"
      @keydown.up.prevent="open(true)"
    >
      <span :id="valueId" class="designSwitch__value">{{ currentLabel }}</span>
      <!-- 幅を一番長い名前に合わせる（標準の <select> と同じ）。テーマを替えても幅と一覧の幅が変わらない -->
      <span class="designSwitch__sizer" aria-hidden="true">
        <span v-for="theme in themes" :key="theme.id">{{ theme.label }}</span>
      </span>
    </button>
    <ul
      v-if="isOpen"
      ref="listRef"
      class="designSwitch__list"
      data-testid="theme-select-list"
      role="listbox"
      :aria-labelledby="labelledby"
      @keydown="onListKeydown"
    >
      <li
        v-for="theme in themes"
        :key="theme.id"
        class="designSwitch__option"
        data-testid="theme-select-option"
        :data-value="theme.id"
        role="option"
        tabindex="-1"
        :aria-selected="theme.id === modelValue"
        @click="select(theme.id)"
      >{{ theme.label }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * テーマの自作ドロップダウン。標準の `<select>` は開いた一覧を OS が描くので、角丸のボタンと一覧の間に
 * 隙間ができる（一覧の位置・幅・角丸を CSS で変えられない）。一覧をボタンの真下にボタンと同じ幅で出し、つなげる。
 *
 * - 一覧は body へ移さずボタンの下に置く（ページと一緒にスクロールするので、スクロールで閉じなくてよい）。
 * - 確定は select() の1か所（行の click と、一覧の中の Enter / Space）。
 * - 切り替え中（disabled）は `disabled` 属性ではなく aria-disabled で止める。`disabled` にすると、
 *   選んだ直後にボタンからフォーカスが外れ、キーボードで続けて操作できなくなる。
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import type { ThemeDef } from "../config/themes";
import { listenDocumentPress } from "../utils/listenDocumentPress";
import { focusWithoutScroll } from "../utils/focusWithoutScroll";

const props = defineProps<{
  themes: readonly ThemeDef[];
  modelValue: string;
  disabled?: boolean;
  /** 見出し（「テーマ」）の id。読み上げは「見出し＋今のテーマ名」にする */
  labelledby?: string;
}>();

const emit = defineEmits<{
  (e: "change", id: string): void;
}>();

const valueId = `designSwitch-value-${useId()}`;
const rootRef = ref<HTMLDivElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const listRef = ref<HTMLUListElement | null>(null);
const isOpen = ref(false);

const currentLabel = computed(() => props.themes.find((theme) => theme.id === props.modelValue)?.label ?? props.modelValue);

function options(): HTMLElement[] {
  return listRef.value ? (Array.from(listRef.value.children) as HTMLElement[]) : [];
}

/**
 * 行へフォーカスを移す。キーボードでは、行が画面の外（横向きのスマホなど）なら見えるまでページをスクロールさせる
 * （標準の focus）。指やマウスでは、開いただけでページが動かないようにする。
 */
function focusOption(item: HTMLElement, byKeyboard: boolean): void {
  if (byKeyboard) item.focus();
  else focusWithoutScroll(item);
}

/** 開いたまま Shift+Tab でボタンへ戻ったときの ↓ も、一覧の行へ入り直す */
async function open(byKeyboard: boolean): Promise<void> {
  if (props.disabled) return;
  if (!isOpen.value) {
    isOpen.value = true;
    await nextTick();
  }
  const items = options();
  const selected = items.find((item) => item.dataset.value === props.modelValue) ?? items[0];
  if (selected) focusOption(selected, byKeyboard);
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

function select(id: string): void {
  close(true);
  if (id !== props.modelValue) emit("change", id);
}

function onListKeydown(ev: KeyboardEvent): void {
  const items = options();
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (ev.key === "Tab") {
    close();
    return;
  }
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    const id = items[index]?.dataset.value;
    if (id) select(id);
    return;
  }
  const next = ev.key === "ArrowDown" ? Math.min(index + 1, items.length - 1)
    : ev.key === "ArrowUp" ? Math.max(index - 1, 0)
    : ev.key === "Home" ? 0
    : ev.key === "End" ? items.length - 1
    : -1;
  if (next < 0) return;
  ev.preventDefault();
  focusOption(items[next], true);
}

/**
 * フォーカスが部品の外の要素へ移ったら閉じる（Tab で外へ出たとき）。
 * 行き先が無い（body に落ちた）ときは閉じない: Safari は押した要素にフォーカスを入れないことがある。外側を押したときは下の onPressOutside が閉じる。
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

watch(isOpen, (open) => listenDocumentPress(onPressOutside, open));
onBeforeUnmount(() => listenDocumentPress(onPressOutside, false));
</script>
