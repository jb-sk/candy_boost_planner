import { nextTick, reactive, type Directive } from "vue";
import { focusWithoutScroll } from "../utils/focusWithoutScroll";
import { listenDocumentPress } from "../utils/listenDocumentPress";
import { suppressNextClick } from "../utils/suppressNextClick";

/**
 * タッチ端末で数値欄に OS のキーボードを出さず、アプリ内のテンキーで入力させる。
 *
 * iOS はキーボードを出すたびに入力欄が見えるようページをスクロールし、閉じても戻さない。
 * 計算機ではそのたびに行やヒントがサマリーの裏へ潜るので、キーボード自体を出さない。
 *
 * **テンキーは本物の入力欄を操作する。** キーを押すと `value` を書き換えて `input` を送り、
 * 確定は入力欄の blur で行う。各欄のドラフト保持（useDraftField 等）と確定処理を
 * そのまま通すためで、欄ごとにテンキー専用の確定経路を書かないこと（書き写すと漏れる）。
 *
 * PC（ホバーできる細かいポインター）では何もしない。キーボードで直接打てる方が速い。
 */

const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
/**
 * 桁あふれで欄やテンキーの表示が崩れないための上限。どの欄もこれより大きい値は使わない。
 * 欄ごとの上限は `v-keypad` の `maxLength` で渡す（手入力イベントの開始日 YYYYMMDD は 8 桁）。
 * 入力欄の maxlength は流用しない。区切り付きの貼り付けを許すため数字だけの桁数より長いことがある。
 */
const MAX_DIGITS = 7;

export const keypadState = reactive<{
  /** テンキーが操作している入力欄。null なら閉じている。 */
  target: HTMLInputElement | null;
  label: string;
  value: string;
  /** 開いた直後。最初の数字キーで既存の値を置き換える（全選択と同じ感覚）。 */
  fresh: boolean;
  /** 小数点キーを出す（1日の睡眠時間など 0.5 刻みの欄）。 */
  decimal: boolean;
  /** 打てる文字数（小数点を含む。桁区切りは含まない）。 */
  maxLength: number;
  /**
   * 桁区切りの欄（かけら在庫）。入力欄は区切り付きで表示するので、value は区切りを除いた数字で持ち、
   * テンキーの表示欄で区切りを付ける。
   */
  grouping: boolean;
  /** C キーの代わりに出すリセットの名前（アメブ個数など）。null なら通常の C。 */
  resetLabel: string | null;
  /**
   * 空欄のときに表示欄へ札（placeholderChip）と薄く出す値（入力欄のプレースホルダと同じ）。
   * 空欄で確定すると自動の値へ戻る欄に使う（アメブ個数の導出値、アメブ上限・既定のアメブ目標Lvの規定値）。
   * 開いた直後も、打ってから消したときも出す。
   */
  placeholder: string;
  /** placeholder の前の札の文言。導出値は「自動」（既定）、規定値は「デフォルト」。空なら「自動」。 */
  placeholderChip: string;
}>({
  target: null, label: "", value: "", fresh: false, decimal: false, maxLength: MAX_DIGITS, grouping: false,
  resetLabel: null, placeholder: "", placeholderChip: "",
});

/** 開いたとき（リセット後はリセットした直後）の値。「閉じる」で戻すために持つ。 */
let originalValue = "";

/**
 * C キーをリセットに置き換える欄の設定。
 * 自動計算へ戻せる欄（アメブ個数）で、その操作を1回で押せるようにする。
 * 欄の外のリセットボタンだけでは気づきにくいため。空欄で確定しても同じ結果になる。
 *
 * テンキーは閉じずに続けて打てるようにする。action は欄の打ちかけの値（ドラフト）も捨てること。
 * 閉じないので blur が起きず、残したドラフトが表示に出続け、あとの blur でリセット後の状態へ確定されてしまう。
 */
type KeypadReset = { label: string; action: () => void };
type KeypadConfig = {
  label: string;
  decimal: boolean;
  maxLength: number;
  grouping: boolean;
  reset: KeypadReset | null;
  placeholder: string;
  placeholderChip: string;
};
const configs = new WeakMap<HTMLInputElement, KeypadConfig>();
const registered = new Set<HTMLInputElement>();
let mediaQuery: MediaQueryList | null = null;

function isTouchDevice(): boolean {
  return mediaQuery?.matches === true;
}

function ensureMediaQuery(): void {
  if (mediaQuery || typeof window === "undefined" || !window.matchMedia) return;
  mediaQuery = window.matchMedia(TOUCH_QUERY);
  // タブレットにキーボードをつないだ等で入力方法が変わったら、登録済みの欄を切り替える
  mediaQuery.addEventListener?.("change", () => {
    for (const el of registered) applyMode(el);
  });
}

/**
 * readonly なら OS のキーボードは出ない。フォーカスとイベントはそのまま使える。
 * テンプレート側で readonly を束縛しないこと（再描画のたびにここの設定が上書きされる）。
 */
function applyMode(el: HTMLInputElement): void {
  el.readOnly = isTouchDevice();
}

function setValue(value: string): void {
  const el = keypadState.target;
  if (!el) return;
  keypadState.value = value;
  // type="number" は「7.」のような小数点で終わる値を空欄として扱う。入力欄には小数点を除いた
  // 数値を書き、打ちかけの小数点はテンキーの表示欄（keypadState.value）だけに見せる。
  el.value = value.endsWith(".") ? value.slice(0, -1) : value;
  // inputType を付ける。無い input は ▲▼（スピナー）の操作として扱う欄がある（アメブ個数は
  // 未入力なら自動計算の値から1つ動かす）ため、テンキーの打鍵がそちらへ化けないようにする。
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
}

/** 入力欄の値をテンキーの値として読む。桁区切りの欄は区切りを除く。 */
function readValue(el: HTMLInputElement): string {
  return keypadState.grouping ? el.value.replace(/\D/g, "") : el.value;
}

/** 欄の設定をテンキーの表示へ写す（開いたときと、開いている欄の設定が変わったとき）。 */
function showConfig(config: KeypadConfig): void {
  keypadState.label = config.label;
  keypadState.decimal = config.decimal;
  keypadState.maxLength = config.maxLength;
  keypadState.grouping = config.grouping;
  keypadState.resetLabel = config.reset?.label ?? null;
  keypadState.placeholder = config.placeholder;
  keypadState.placeholderChip = config.placeholderChip;
}

function open(el: HTMLInputElement): void {
  if (!isTouchDevice() || el.disabled) return;
  if (keypadState.target === el) return;
  keypadState.target = el;
  showConfig(configs.get(el) ?? toConfig({ label: "" }));
  keypadState.value = readValue(el);
  keypadState.fresh = true;
  originalValue = el.value;
  listenDocumentPress(onPressOutside, true);
}

function close(): void {
  keypadState.target = null;
  listenDocumentPress(onPressOutside, false);
}

export function pressDigit(digit: string): void {
  const current = keypadState.fresh ? "" : keypadState.value;
  keypadState.fresh = false;
  // 先頭の 0 は残さない（「05」ではなく「5」）
  const next = (current === "0" ? "" : current) + digit;
  if (next.length > keypadState.maxLength) return;
  setValue(next);
}

/** 小数点。1つだけ。先頭で押したら「0.」にする。 */
export function pressDecimalPoint(): void {
  if (!keypadState.decimal) return;
  const current = keypadState.fresh ? "" : keypadState.value;
  keypadState.fresh = false;
  if (current.includes(".")) return;
  const next = (current === "" ? "0" : current) + ".";
  if (next.length > keypadState.maxLength) return;
  setValue(next);
}

export function pressBackspace(): void {
  keypadState.fresh = false;
  setValue(keypadState.value.slice(0, -1));
}

export function pressClear(): void {
  keypadState.fresh = false;
  setValue("");
}

/**
 * リセット（C の代わり）。欄のリセット処理を呼び、テンキーは閉じずにリセット後の欄の値を読み直す。
 * リセットは確定した操作（undo で戻す）なので、そのあとの「閉じる」はリセット後の値へ戻す。
 */
export async function pressReset(): Promise<void> {
  const el = keypadState.target;
  const reset = el ? configs.get(el)?.reset : null;
  if (!el || !reset) return;
  reset.action();
  // 欄の value とプレースホルダ（v-keypad の updated）が再描画で変わるのを待つ
  await nextTick();
  if (keypadState.target !== el) return;
  keypadState.value = readValue(el);
  keypadState.fresh = true;
  originalValue = el.value;
}

/** 確定。blur で各欄の確定処理を走らせる。 */
export function confirmKeypad(): void {
  keypadState.target?.blur();
}

/** 閉じる。開いたときの値へ戻してから blur するので、各欄は「変更なし」で終わる。 */
export function cancelKeypad(): void {
  if (!keypadState.target) return;
  if (keypadState.value !== originalValue) setValue(originalValue);
  keypadState.target.blur();
}

/**
 * テンキーと入力欄以外を押したら確定して閉じる。
 * iOS はフォーカスできない場所を押しても入力欄の blur を起こさないので、自分で外す。
 *
 * **入力欄以外を押した指の click は捨てる。** テンキーの縁から少しだけ見えている後ろのボタン
 * （行の削除など）を、閉じるボタンなどと一緒に押してしまうため（2026-09-26 実例: 行が削除された）。
 * 外側のタップは「テンキーを閉じる」だけにする。
 * ほかの入力欄は通す。押した欄のテンキーがそのまま開き直る方が便利なため。
 * ヒントの受け口（外側を押すと閉じる透明な面 `.hintOverlay`）も通す。閉じるだけの面なので、
 * 1回のタップでテンキーとヒントを一緒に閉じる。
 */
function onPressOutside(ev: Event): void {
  const el = keypadState.target;
  const target = ev.target;
  if (!el || !(target instanceof Node)) return;
  if (el.contains(target)) return;
  if (target instanceof Element && target.closest(".numKeypad")) return;
  if (!(target instanceof Element && (isInputField(target) || target.closest(".hintOverlay")))) {
    suppressNextClick(ev.type === "mousedown" ? "mousedown" : "touchstart");
  }
  el.blur();
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "number", "email", "tel", "url", "password"]);

/**
 * 押しても次の入力へ移るだけの欄（テンキーの欄・文字の欄・選択欄）。ボタンやチェックボックスは含めない。
 * 選択欄（テーマなど）を含めないと、テンキーを開いたまま押したとき1回目が閉じるだけになり、2回押す必要がある。
 */
function isInputField(target: Element): boolean {
  const field = target.closest("input, textarea, select");
  if (field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) return true;
  return field instanceof HTMLInputElement && (registered.has(field) || TEXT_INPUT_TYPES.has(field.type));
}

function onFocus(ev: Event): void {
  open(ev.currentTarget as HTMLInputElement);
}

/**
 * タッチ端末では、押したときのフォーカスをブラウザに任せない。
 *
 * iOS は入力欄にフォーカスが入ると、readonly でキーボードが出なくても、キーボードが
 * 出る前提で欄を見せる位置までページをスクロールすることがある。mousedown の既定動作
 * （フォーカス移動）を止め、onClick でスクロールなしのフォーカスを入れ直す。
 * テンキーのキーが入力欄のフォーカスを奪わないのも同じ仕組み（NumericKeypad.vue）。
 */
function onMouseDown(ev: MouseEvent): void {
  if (isTouchDevice()) ev.preventDefault();
}

function onClick(ev: Event): void {
  const el = ev.currentTarget as HTMLInputElement;
  if (!isTouchDevice() || el.disabled) return;
  // フォーカスが入れば onFocus が開く。既にフォーカスがある（テンキーだけ閉じた）欄は直接開く
  if (document.activeElement !== el) focusWithoutScroll(el);
  else open(el);
}

/**
 * 確定は各欄の @blur（input で書いた下書きを blur で保存する useDraftField など）に任せ、
 * ここはテンキーを閉じるだけ。テンキーで書き換えた値では blur 時に change が出ないので、
 * テンキーを付ける欄は change で確定しないこと。
 */
function onBlur(ev: Event): void {
  if (keypadState.target === ev.currentTarget) close();
}

function register(el: HTMLInputElement): void {
  if (registered.has(el)) return;
  ensureMediaQuery();
  registered.add(el);
  applyMode(el);
  el.addEventListener("mousedown", onMouseDown);
  el.addEventListener("focus", onFocus);
  el.addEventListener("click", onClick);
  el.addEventListener("blur", onBlur);
}

function unregister(el: HTMLInputElement): void {
  if (!registered.has(el)) return;
  registered.delete(el);
  el.readOnly = false;
  el.removeEventListener("mousedown", onMouseDown);
  el.removeEventListener("focus", onFocus);
  el.removeEventListener("click", onClick);
  el.removeEventListener("blur", onBlur);
  if (keypadState.target === el) close();
}

type KeypadOptions = {
  label: string;
  decimal?: boolean;
  maxLength?: number;
  grouping?: boolean;
  reset?: KeypadReset;
  placeholder?: string;
  placeholderChip?: string;
};
type KeypadBinding = string | KeypadOptions | false | undefined;

function toConfig(options: KeypadOptions): KeypadConfig {
  return {
    label: options.label,
    decimal: options.decimal ?? false,
    maxLength: options.maxLength ?? MAX_DIGITS,
    grouping: options.grouping ?? false,
    reset: options.reset ?? null,
    placeholder: options.placeholder ?? "",
    placeholderChip: options.placeholderChip ?? "",
  };
}

function bind(el: HTMLInputElement, value: KeypadBinding): void {
  if (value === false) {
    unregister(el);
    return;
  }
  const config = toConfig(typeof value === "object" ? value : { label: value ?? "" });
  configs.set(el, config);
  if (keypadState.target === el) showConfig(config);
  register(el);
}

/**
 * `v-keypad="見出し"` で、タッチ端末ではその数値欄をテンキー入力にする。
 * 見出しはテンキーの上に出す欄の名前。小数を入れる欄は `{ label, decimal: true }`、
 * 既定（7桁）と違う桁数の欄は `{ label, maxLength }`、桁区切りで表示する欄は `{ label, grouping: true }`。
 * C キーをリセットにする欄は `{ label, reset: { label, action } }`（小数の欄では使えない。C の位置が小数点のため）。
 * 空欄が自動の値（導出値・規定値）を表す欄は `{ label, placeholder }` で、その値を札付きで表示欄に薄く出す。
 * 札は既定で「自動」（導出値）。規定値の欄は `placeholderChip` に「デフォルト」を渡す。
 * `false` を渡すと使わない（共用の部品で、呼び出し側ごとに使うかを決めるため）。
 */
export const vKeypad: Directive<HTMLInputElement, KeypadBinding> = {
  mounted(el, binding) {
    bind(el, binding.value);
  },
  updated(el, binding) {
    bind(el, binding.value);
  },
  beforeUnmount(el) {
    unregister(el);
  },
};
