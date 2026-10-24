import { nextTick, onUnmounted, reactive, ref, computed, type Ref } from "vue";
import { trackPress, type Press } from "../utils/trackPress";

/**
 * 行をつかんで動かす並べ替え（計算機・やりくりモーダルで共用）。
 *
 * 取っ手の押下を追跡し、画面の横に浮かぶ名前の一覧（RowReorderNav.vue）の位置と、落とす位置を出す。
 * 確定は `onCommit(rowId, toIndex)` で呼び出し側へ返す（計算機は `calc.moveRow`）。
 * 行の強調（計算機のストアの `dragRowId` など）は呼び出し側の都合なので持たず、
 * つかんでいる行と落とす位置の行を `draggingId` / `overId` で返す。
 *
 * Popover API / HTML Drag and Drop API は使わない。Pointer Events 非対応の古いSafari向けに
 * Touch Events と Mouse Events も同じ処理へ流す（trackPress.ts）。
 * 指での並べ替え中にページ・モーダル本文をスクロールさせないのは、trackPress が動きを受けている間
 * touchmove を止めるため（スクロールする要素を問わない）。body に付けるクラスは選択の抑止だけ。
 */
export type RowReorderItem = { id: string; title: string };

/** RowReorderNav.vue が表示に使う状態。 */
export type RowReorderNavState = {
  visible: boolean;
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  /** 落とす位置へ動かしたあとの並び。 */
  previewItems: RowReorderItem[];
  movingId: string | null;
  /** 落とす位置（0 始まり）。 */
  targetIndex: number;
  total: number;
};

const ITEM_HEIGHT = 34;
const NAV_HEADER_HEIGHT = 28;
const NAV_MARGIN = 8;
const START_THRESHOLD = 5;
const REORDERING_BODY_CLASS = "calcRowReordering";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function useRowReorderDrag(options: {
  /** つかんだ時点の並び。 */
  items: () => RowReorderItem[];
  /** 離したときに、動かした行と落とす位置を返す。取り消し・位置が決まらないときは呼ばない。 */
  onCommit: (rowId: string, toIndex: number) => void;
}) {
  const visible = ref(false);
  const left = ref(0);
  const top = ref(0);
  const width = ref(240);
  const maxHeight = ref(200);
  const listEl = ref<HTMLElement | null>(null);
  const items = ref<RowReorderItem[]>([]);
  const targetIndex = ref(0);
  /** つかんでいる行。つかんでいなければ null。 */
  const draggingId = ref<string | null>(null);
  /** 落とす位置にある（今その位置に並んでいる）行。つかんでいなければ null。 */
  const overId = ref<string | null>(null);
  const previewItems = computed(() => {
    const list = [...items.value];
    const from = list.findIndex((item) => item.id === draggingId.value);
    if (from < 0) return list;
    const [moving] = list.splice(from, 1);
    if (!moving) return list;
    list.splice(Math.max(0, Math.min(list.length, targetIndex.value)), 0, moving);
    return list;
  });

  let startY = 0;
  /** つかんでいる指・ポインターの追跡（入力のまとめは trackPress.ts）。 */
  let press: Press | null = null;

  function begin(rowId: string, clientY: number, handle: HTMLElement) {
    if (draggingId.value) return;
    const list = options.items();
    const startIndex = list.findIndex((item) => item.id === rowId);
    if (startIndex < 0) return;

    draggingId.value = rowId;
    startY = clientY;
    items.value = list;
    targetIndex.value = startIndex;
    overId.value = rowId;
    window.getSelection()?.removeAllRanges();
    document.body.classList.add(REORDERING_BODY_CLASS);

    const viewportWidth = Math.max(240, window.innerWidth);
    const viewportHeight = Math.max(240, window.innerHeight);
    const navWidth = Math.min(280, viewportWidth - NAV_MARGIN * 2);
    const contentHeight = list.length * ITEM_HEIGHT + NAV_HEADER_HEIGHT;
    const navMaxHeight = Math.min(contentHeight, viewportHeight - NAV_MARGIN * 2);
    const rect = handle.getBoundingClientRect();
    let navLeft = rect.right + NAV_MARGIN;
    if (navLeft + navWidth > viewportWidth - NAV_MARGIN) navLeft = rect.left - navWidth - NAV_MARGIN;
    navLeft = clamp(navLeft, NAV_MARGIN, viewportWidth - navWidth - NAV_MARGIN);
    const desiredTop = clientY - NAV_HEADER_HEIGHT - (startIndex + 0.5) * ITEM_HEIGHT;

    width.value = navWidth;
    maxHeight.value = navMaxHeight;
    left.value = navLeft;
    top.value = clamp(desiredTop, NAV_MARGIN, viewportHeight - navMaxHeight - NAV_MARGIN);
    visible.value = true;

    void nextTick(() => {
      const el = listEl.value;
      if (!el) return;
      const relativePointerY = clientY - el.getBoundingClientRect().top;
      const wantedScrollTop = (startIndex + 0.5) * ITEM_HEIGHT - relativePointerY;
      el.scrollTop = clamp(wantedScrollTop, 0, el.scrollHeight - el.clientHeight);
    });
  }

  function update(clientY: number) {
    if (!draggingId.value) return;
    if (Math.abs(clientY - startY) < START_THRESHOLD) return;
    const el = listEl.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const edge = Math.min(28, rect.height / 3);
    if (clientY < rect.top + edge) el.scrollTop -= ITEM_HEIGHT;
    else if (clientY > rect.bottom - edge) el.scrollTop += ITEM_HEIGHT;

    const contentY = clientY - rect.top + el.scrollTop;
    const index = clamp(Math.floor(contentY / ITEM_HEIGHT), 0, items.value.length - 1);
    targetIndex.value = index;
    overId.value = items.value[index]?.id ?? draggingId.value;
  }

  /** 取っ手を押したらドラッグを始める。指での並べ替え中はページをスクロールさせない。 */
  function onHandlePress(rowId: string, ev: Event) {
    if (draggingId.value) return;
    const tracked = trackPress(ev, {
      move: ({ y }) => {
        update(y);
        return true;
      },
      end: finish,
    });
    if (!tracked) return;
    ev.preventDefault();
    press = tracked;
    begin(rowId, tracked.y, ev.currentTarget as HTMLElement);
    if (!draggingId.value) finish(false);
  }

  function finish(commit: boolean) {
    const movingId = draggingId.value;
    const index = targetIndex.value;
    if (commit && movingId) options.onCommit(movingId, index);
    draggingId.value = null;
    press?.stop();
    press = null;
    visible.value = false;
    items.value = [];
    overId.value = null;
    document.body.classList.remove(REORDERING_BODY_CLASS);
  }

  /** つかんでいる途中なら、確定せずにやめる。 */
  function cancel() {
    if (draggingId.value) finish(false);
  }

  onUnmounted(cancel);

  const nav = reactive({
    visible,
    left,
    top,
    width,
    maxHeight,
    previewItems,
    movingId: draggingId,
    targetIndex,
    total: computed(() => items.value.length),
  }) as RowReorderNavState;

  return {
    /** つかんでいる行。 */
    draggingId: draggingId as Readonly<Ref<string | null>>,
    /** 落とす位置の行。 */
    overId: overId as Readonly<Ref<string | null>>,
    onHandlePress,
    cancel,
    nav,
    /** RowReorderNav.vue の一覧の要素（端での自動スクロールと位置の計算に使う）。 */
    setNavList: (el: unknown) => {
      listEl.value = el instanceof HTMLElement ? el : null;
    },
  };
}
