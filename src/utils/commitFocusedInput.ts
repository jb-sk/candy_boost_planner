/**
 * container 内の入力欄にフォーカスがあれば外して、入力中の値を確定させる。
 *
 * フォーカスを残したまま v-if で閉じたり画面ごと消したりすると、blur が起きずに入力欄ごと消え、
 * 打った値が保存されない。閉じる前に自分で blur して、通常の確定経路（@blur）を通す。
 */
export function commitFocusedInput(container: HTMLElement | null): void {
  const active = document.activeElement;
  if (container && active instanceof HTMLElement && container.contains(active)) active.blur();
}
