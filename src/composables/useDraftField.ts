import { computed, ref, type ComputedRef } from "vue";

export type DraftField = {
  /** 入力欄へ渡す表示値。編集中はドラフト、それ以外は保存値。 */
  text: ComputedRef<string>;
  focus: () => void;
  input: (value: string) => void;
  blur: () => void;
};

/**
 * 数値入力欄のドラフト方式（仕様書 §8.1）。
 *
 * **`:value` へ保存値を直結してはいけない。** 確定前に再描画が走ると、打っている途中の値が
 * 保存値へ引き戻される（§11.13 で累計睡眠時間が 0 に戻るバグとして出た）。
 * フォーカス中はドラフトを表示し、blur で確定する。
 *
 * 確定は**値が変わったときだけ**呼ぶ。同じ値で確定すると、副作用のある経路
 * （アメブ上限の再割り当てなど）が空振りで走る。この規則を欄ごとに書き写すと
 * 1箇所直し忘れる（実際 §11.13 は書き写しからの漏れだった）ので、ここに1つだけ置く。
 *
 * @param read   保存値の表示文字列を返す
 * @param commit 確定処理。`read()` と異なる値になったときだけ呼ばれる
 */
export function useDraftField(read: () => string, commit: (value: string) => void): DraftField {
  const draft = ref<string | null>(null);
  return {
    text: computed(() => draft.value ?? read()),
    focus: () => { draft.value = read(); },
    input: (value: string) => { draft.value = value; },
    blur: () => {
      const value = draft.value;
      if (value === null) return;
      draft.value = null;
      if (value !== read()) commit(value);
    },
  };
}
