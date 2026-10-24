<template>
  <div class="sleepTargetSelect" :class="{ 'sleepTargetSelect--open': isOpen }">
    <button
      ref="triggerRef"
      type="button"
      class="sleepTargetSelect__trigger field__input"
      data-testid="sleepTargetHours"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      :aria-label="triggerAriaLabel"
      @click="toggle"
      @blur="onFocusLeave"
      @keydown.esc="onEscape"
    >
      <span class="sleepTargetSelect__value">{{ triggerName }}<span v-if="triggerEmoji" aria-hidden="true">{{ triggerEmoji }}</span></span>
      <svg class="sleepTargetSelect__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <polyline points="6 9 12 15 18 9" stroke="currentColor" stroke-width="2" fill="none"/>
      </svg>
    </button>
    <Teleport to="body">
      <!--
        中にチェックボックス（操作できる要素）があるので role="listbox" / "option" は使わない（option の中に操作要素を置けない）。
        行の名前を押して確定するのは @click の1経路だけ。mousedown では確定しない（キーボードの Enter / Space が click になるため）。
      -->
      <div
        v-if="isOpen"
        ref="dropdownRef"
        class="sleepTargetSelect__dropdown"
        data-testid="sleep-target-dropdown"
        role="dialog"
        :aria-label="t('calc.row.sleepTarget')"
        :style="dropdownStyle"
        @focusout="onFocusLeave"
        @keydown="onDropdownKeydown"
      >
        <div
          v-for="row in rows"
          :key="row.key"
          class="sleepTargetSelect__row"
          :class="{ 'sleepTargetSelect__row--selected': row.selected }"
        >
          <button
            type="button"
            class="sleepTargetSelect__name"
            data-testid="sleep-target-option"
            :data-option="row.key"
            :aria-pressed="row.selected"
            @click="selectRow(row.key)"
          >{{ row.label }}</button>
          <!--
            チェックボックスは組にして折り返す。1つずつ折り返すと、狭い画面（幅320px）で
            チケットだけが名前の右に残り、アメ在庫が次の段へ落ちる。
          -->
          <span v-if="row.key === 'sleep' || row.key === 'nap'" class="sleepTargetSelect__checks">
            <!-- おひるね島の行は「チケット → アメ在庫」の順（ユーザー指定）。閉じたときの絵文字・読み上げも同じ順にする -->
            <label v-if="row.key === 'nap'" class="sleepTargetSelect__check">
              <input
                type="checkbox"
                data-testid="sleep-target-nap-ticket-check"
                :checked="ticketChecked"
                @change="onTicketChange"
              />
              <span aria-hidden="true">{{ TICKET_EMOJI }}</span>
              <span>{{ t("calc.row.sleepTargetTicketCheck") }}</span>
            </label>
            <label class="sleepTargetSelect__check">
              <input
                type="checkbox"
                :data-testid="row.key === 'sleep' ? 'sleep-target-stock-check' : 'sleep-target-nap-stock-check'"
                :checked="stockChecked"
                @change="onStockChange($event, row.key)"
              />
              <span aria-hidden="true">{{ STOCK_EMOJI }}</span>
              <span>{{ t("calc.row.sleepTargetStockCheck") }}</span>
            </label>
          </span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
/**
 * undo をまとめるセッションの番号。部品（行）ごとではなくモジュールで1つにする。
 * 部品ごとに数えると、別の行の1回目どうしが同じ `sleepTarget:1` になり、ストアが2行の変更を1つの履歴にまとめてしまう。
 */
let sessionCounter = 0;
</script>

<script setup lang="ts">
/**
 * 睡眠目標の自作ドロップダウン。標準の `<select>` はチェックボックスを置けないので作った。
 * 閉じたときは「基本の名前＋絵文字」、開くと行の名前（押すと選んで閉じる）と、その行のチェックボックス（押すと確定、閉じない）が並ぶ。
 *
 * 保存値は作らない。画面の選び方（`SleepTargetChoice`）を `sleepTargetOfChoice` で保存値へ変えて `change` で渡し、
 * 確定は親が `setRowSleepTarget` へ渡す1経路にする。1回開いて閉じるまでの変更は同じ `coalesceKey` を付け、undo 1回にまとめる。
 *
 * `NatureSelect` を下敷きにしているが、写してはいけない点がある:
 * - トリガーの blur で閉じない（チェックボックスを押すとフォーカスが移り、押した直後に閉じる）。閉じるのは
 *   フォーカスがトリガーにも一覧にも無い要素へ移ったときだけ。
 * - 確定は mousedown ではなく click（キーボードの Enter / Space で確定できるように）。
 * - 一覧は body 直下なので、開いたら選択中の行へフォーカスを移し、Tab / Shift+Tab は一覧の中で回す。
 * - 大きさは画面に収める（最大幅・最大高さ。超えたら一覧の中をスクロール）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useDismissOnScroll } from "../composables/useDismissOnScroll";
import { listenDocumentPress } from "../utils/listenDocumentPress";
import { maxFloatingSize, placeNearAnchor } from "../utils/anchoredPlacement";
import { focusWithoutScroll } from "../utils/focusWithoutScroll";
import { sleepTargetOfChoice, type SleepTargetChoice, type SleepTargetMode } from "../domain/sleep-target";
import { sleepTargetHoursLabel as hoursLabel, sleepTargetNameParts } from "../utils/sleepTimeText";

/** 🍬（U+1F36C）。Unicode 6.0 の1文字で、異体字セレクタや ZWJ を伴わない（古い端末で崩れない） */
const STOCK_EMOJI = "\u{1F36C}";
/** 🎫（U+1F3AB）。同じく1文字の絵文字 */
const TICKET_EMOJI = "\u{1F3AB}";
/**
 * 中身ぴったりの幅（`width: max-content`）に足す余裕（px）。古い iOS Safari は、ぴったりの幅を
 * 中身の実寸より端数ぶん狭く出し、行の最後の要素（おひるね島のアメ在庫・チェックの組）が次の段へ落ちる
 */
const INTRINSIC_WIDTH_SLACK = 4;

const props = defineProps<{
  choice: SleepTargetChoice;
  /** 累計睡眠時間。届いた数値の目標に ✓ を付ける */
  sleepHours: number;
  hoursOptions: readonly number[];
}>();

const emit = defineEmits<{
  (e: "change", target: number | SleepTargetMode | undefined, options: { coalesceKey: string; coalesceWindowMs: number }): void;
}>();

const { t } = useI18n();

const triggerRef = ref<HTMLButtonElement | null>(null);
const dropdownRef = ref<HTMLDivElement | null>(null);
const isOpen = ref(false);
const placed = ref(false);
/** width が null の間は CSS の `width: max-content`（中身ぴったり）。実寸を測ってから余裕を足した幅に置き換える */
const position = ref<{ left: number; top: number; width: number | null; minWidth: number; maxWidth: number; maxHeight: number }>(
  { left: 0, top: 0, width: null, minWidth: 0, maxWidth: 0, maxHeight: 0 },
);

const dropdownStyle = computed(() => ({
  left: `${position.value.left}px`,
  top: `${position.value.top}px`,
  width: position.value.width === null ? undefined : `${position.value.width}px`,
  minWidth: `${position.value.minWidth}px`,
  maxWidth: `${position.value.maxWidth}px`,
  maxHeight: `${position.value.maxHeight}px`,
  visibility: placed.value ? ("visible" as const) : ("hidden" as const),
}));

type RowKey = "none" | "sleep" | "nap" | `h${number}`;

/** アメ在庫のチェックは睡眠 ⇔ おひるね島で引き継ぐ（どちらの行にも今の状態を出す） */
const stockChecked = computed(() => (props.choice.base === "sleep" || props.choice.base === "napIsland") && props.choice.stock);
/** チケットは今が「おひるね島＋チケット」のときだけチェック済み */
const ticketChecked = computed(() => props.choice.base === "napIsland" && props.choice.ticket);

const rows = computed(() => {
  const choice = props.choice;
  const list: { key: RowKey; label: string; selected: boolean }[] = [
    { key: "none", label: t("calc.row.sleepTargetNone"), selected: choice.base === "none" },
  ];
  for (const hours of props.hoursOptions) {
    // 達成済みは残したまま、チェックを後ろに付ける（前置すると数字の開始位置がずれて桁が揃わない）。
    // 選択肢を隠すと、選択中の目標を累計が追い越した瞬間にその項目が消える。
    const label = props.sleepHours >= hours ? `${hoursLabel(hours)} ✓` : hoursLabel(hours);
    list.push({ key: `h${hours}`, label, selected: choice.base === "hours" && choice.hours === hours });
  }
  list.push({ key: "sleep", label: t("calc.row.sleepTargetSleep"), selected: choice.base === "sleep" });
  list.push({ key: "nap", label: t("calc.row.sleepTargetNap"), selected: choice.base === "napIsland" });
  return list;
});

/** 閉じたときの表示。数値の目標は累計が届いていれば ✓ を付ける */
const triggerName = computed(() => rows.value.find((row) => row.selected)?.label ?? "");
const triggerEmoji = computed(() => (ticketChecked.value ? TICKET_EMOJI : "") + (stockChecked.value ? STOCK_EMOJI : ""));

/** 読み上げは文字で全部言う（絵文字は aria-hidden） */
const triggerAriaLabel = computed(() => t("calc.row.sleepTargetAriaLabel", sleepTargetNameParts(t, props.choice)));

let coalesceKey = "";

function commit(choice: SleepTargetChoice): void {
  emit("change", sleepTargetOfChoice(choice), { coalesceKey, coalesceWindowMs: Number.POSITIVE_INFINITY });
}

function choiceOfRow(key: RowKey): SleepTargetChoice {
  if (key === "none") return { base: "none" };
  if (key === "sleep") return { base: "sleep", stock: stockChecked.value };
  if (key === "nap") return { base: "napIsland", stock: stockChecked.value, ticket: ticketChecked.value };
  return { base: "hours", hours: Number(key.slice(1)) };
}

/** 行の名前（Enter / Space を含む click）で、その行をチェックの状態ごと選んで閉じる。確定の経路はここと下のチェックの2つだけ */
function selectRow(key: RowKey): void {
  commit(choiceOfRow(key));
  close(true);
}

/** チェックボックス: 選んでいない行のチェックでもその行を選んで確定する。閉じない（続けて別のチェックも操作できる） */
function onStockChange(ev: Event, key: RowKey): void {
  const checked = (ev.target as HTMLInputElement).checked;
  commit(key === "nap"
    ? { base: "napIsland", stock: checked, ticket: ticketChecked.value }
    : { base: "sleep", stock: checked });
}

function onTicketChange(ev: Event): void {
  const checked = (ev.target as HTMLInputElement).checked;
  commit({ base: "napIsland", stock: stockChecked.value, ticket: checked });
}

function insideWidget(target: EventTarget | null): boolean {
  return target instanceof Node
    && (triggerRef.value?.contains(target) === true || dropdownRef.value?.contains(target) === true);
}

function insideDropdown(target: EventTarget | null): boolean {
  return target instanceof Node && dropdownRef.value?.contains(target) === true;
}

function layout(): void {
  const trigger = triggerRef.value;
  const dropdown = dropdownRef.value;
  if (!trigger || !dropdown) return;
  const max = maxFloatingSize(trigger);
  position.value = {
    ...position.value,
    width: null,
    minWidth: Math.min(trigger.getBoundingClientRect().width, max.width),
    maxWidth: max.width,
    maxHeight: max.height,
  };
}

async function place(): Promise<void> {
  layout();
  await nextTick();
  if (!dropdownRef.value) return;
  // 中身ぴったりの実寸に余裕を足して幅を固定する（最大幅は CSS の max-width が抑える）
  position.value = {
    ...position.value,
    width: Math.ceil(dropdownRef.value.getBoundingClientRect().width) + INTRINSIC_WIDTH_SLACK,
  };
  // 最大幅・最大高さと固定した幅を反映した実寸で位置を決める
  await nextTick();
  const trigger = triggerRef.value;
  const dropdown = dropdownRef.value;
  if (!trigger || !dropdown) return;
  const { left, top } = placeNearAnchor(trigger, dropdown);
  position.value = { ...position.value, left, top };
  placed.value = true;
}

function selectedNameButton(): HTMLElement | null {
  return dropdownRef.value?.querySelector<HTMLElement>(".sleepTargetSelect__row--selected .sleepTargetSelect__name")
    ?? dropdownRef.value?.querySelector<HTMLElement>(".sleepTargetSelect__name")
    ?? null;
}

async function open(): Promise<void> {
  sessionCounter += 1;
  coalesceKey = `sleepTarget:${sessionCounter}`;
  placed.value = false;
  isOpen.value = true;
  await nextTick();
  await place();
  await nextTick();
  const dropdown = dropdownRef.value;
  const button = selectedNameButton();
  if (!dropdown || !button) return;
  // 選択中の行が見えるよう、一覧の中だけをスクロールする（ページは動かさない）
  const row = button.parentElement as HTMLElement;
  dropdown.scrollTop = Math.max(0, row.offsetTop - (dropdown.clientHeight - row.offsetHeight) / 2);
  focusWithoutScroll(button);
}

function close(returnFocus = false): void {
  if (!isOpen.value) return;
  isOpen.value = false;
  placed.value = false;
  if (returnFocus && triggerRef.value) focusWithoutScroll(triggerRef.value);
}

function toggle(): void {
  if (isOpen.value) close();
  else void open();
}

function onEscape(): void {
  close(true);
}

/**
 * フォーカスがトリガーにも一覧にも無い要素へ移ったら閉じる（Tab で外へ出たとき）。
 * フォーカスが body に落ちた場合は閉じない: Safari はチェックボックスを押してもフォーカスを入れないので、
 * 押すと body になる。外側を押したときは下の onPressOutside が閉じる。
 */
function onFocusLeave(ev: FocusEvent): void {
  if (insideWidget(ev.relatedTarget)) return;
  setTimeout(() => {
    if (!isOpen.value) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && !insideWidget(active)) close();
  }, 200);
}

function onDropdownKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.preventDefault();
    close(true);
    return;
  }
  if (ev.key !== "Tab") return;
  const dropdown = dropdownRef.value;
  if (!dropdown) return;
  const items = Array.from(dropdown.querySelectorAll<HTMLElement>("button, input:not([disabled])"));
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    revealInDropdown(last);
    focusWithoutScroll(last);
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    revealInDropdown(first);
    focusWithoutScroll(first);
  }
}

/**
 * 先頭 ⇔ 末尾へ回すときは、フォーカスする前に一覧の中だけをスクロールして行を見せる（ページは動かさない）。
 * focusWithoutScroll はスクロールしないので、狭い画面では見えない欄にフォーカスが入ってしまう。
 * フォーカスの後に動かすと、古い端末向けの位置の巻き戻し（focusWithoutScroll）に戻されるので先に動かす。
 */
function revealInDropdown(element: HTMLElement): void {
  const dropdown = dropdownRef.value;
  const row = element.closest<HTMLElement>(".sleepTargetSelect__row");
  if (!dropdown || !row) return;
  if (row.offsetTop < dropdown.scrollTop) {
    dropdown.scrollTop = row.offsetTop;
  } else if (row.offsetTop + row.offsetHeight > dropdown.scrollTop + dropdown.clientHeight) {
    dropdown.scrollTop = row.offsetTop + row.offsetHeight - dropdown.clientHeight;
  }
}

/** 外側を押したら閉じる。トリガーは click で開閉するので除く */
function onPressOutside(ev: Event): void {
  if (insideWidget(ev.target)) return;
  close();
}

function onResize(): void {
  if (!isOpen.value) return;
  void place();
}

// 開いている間に行の中身が変わったら（選んだ行の太字・言語の切り替え）、幅を測り直す。
// 固定した幅のままだと余裕が減り、古い iOS Safari でチェックの組が次の段へ落ちる
watch(rows, () => {
  if (!isOpen.value) return;
  void place();
});

watch(isOpen, (open) => {
  listenDocumentPress(onPressOutside, open);
  if (open) window.addEventListener("resize", onResize);
  else window.removeEventListener("resize", onResize);
});
onBeforeUnmount(() => {
  listenDocumentPress(onPressOutside, false);
  window.removeEventListener("resize", onResize);
});

// 一覧は body 直下に置くので、外側でスクロールしようとしたら閉じる。一覧の中のスクロールでは閉じない
useDismissOnScroll(() => isOpen.value, () => close(), insideDropdown);
</script>
