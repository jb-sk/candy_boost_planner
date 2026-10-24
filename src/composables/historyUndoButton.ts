import type { InjectionKey, Ref } from "vue";

/**
 * 表示中の「元に戻す」ボタン（スマホ・タブレットは上部のナビ、PC は画面下中央の帯）。
 * 全消去などの取り消せる操作のあと、フォーカスをここへ移してすぐ戻せるようにする
 * （App.vue が provide し、各パネルが inject する）。
 */
export const HISTORY_UNDO_BUTTON_KEY: InjectionKey<Readonly<Ref<HTMLButtonElement | null>>> = Symbol("historyUndoButton");
