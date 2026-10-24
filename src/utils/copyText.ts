/**
 * 文字をクリップボードへコピーする。成功したら true。
 *
 * `navigator.clipboard` が無い端末（iOS 13.4 未満など）は、テキスト欄を選んで `execCommand("copy")` する。
 * **iOS Safari は `select()` だけでは選択しない**（読み取り専用の欄では特に）。`setSelectionRange` で全体を選ぶ。
 * 押した操作の中で同期的に呼ばないと iOS はコピーを拒むので、`navigator.clipboard` が無いときは await を挟まない。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 拒否されたら下の方法を試す（操作の外になるので、端末によっては失敗する）
    }
  }
  return copyTextBySelection(text);
}

function copyTextBySelection(text: string): boolean {
  const textarea = document.createElement("textarea");
  // 16px 未満だと iOS が拡大表示する。画面外でも、今のスクロール位置に置いて画面が飛ばないようにする
  textarea.style.fontSize = "16px";
  textarea.style.border = "0";
  textarea.style.padding = "0";
  textarea.style.margin = "0";
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  textarea.style.top = `${window.pageYOffset || document.documentElement.scrollTop}px`;
  // 読み取り専用にしてソフトウェアキーボードを出さない
  textarea.setAttribute("readonly", "");
  textarea.value = text;
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    window.getSelection()?.removeAllRanges();
  }
}
