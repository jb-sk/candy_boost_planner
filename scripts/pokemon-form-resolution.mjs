import { MAX_FORM_NO, isValidFormNo } from "./pokemon-db-validation.mjs";

function normalize(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function hasOwnForm(formJaToNumber, formLabelJa) {
  return Object.prototype.hasOwnProperty.call(formJaToNumber, formLabelJa);
}

/**
 * form-ja-to-number.json の全エントリが idForm 符号化に収まる有効なフォーム番号かを検証する。
 * @param {Record<string, unknown>} formJaToNumber
 * @param {string} [sourceLabel]
 */
export function assertValidFormJaToNumberMap(formJaToNumber, sourceLabel = "form-ja-to-number.json") {
  if (!formJaToNumber || typeof formJaToNumber !== "object" || Array.isArray(formJaToNumber)) {
    throw new Error(`${sourceLabel}: オブジェクトではありません`);
  }
  for (const [label, num] of Object.entries(formJaToNumber)) {
    if (!isValidFormNo(num)) {
      throw new Error(
        `${sourceLabel}: "${label}" のフォーム番号は 0..${MAX_FORM_NO} の整数である必要があります (${String(num)})`,
      );
    }
  }
}

/**
 * Wiki の日本語ポケモン名からベース名・フォーム番号・フォーム括弧名を分離する。
 * - 括弧なし: `{ baseNameJa, form: 0, formLabelJa: null }`
 * - 登録済み括弧名: `{ baseNameJa, form: number, formLabelJa }`
 * - 未登録括弧名: `{ baseNameJa, form: null, formLabelJa }`（通常フォーム 0 へ丸めない）
 *
 * @param {unknown} nameJa
 * @param {Record<string, number>} formJaToNumber
 * @returns {{ baseNameJa: string, form: number | null, formLabelJa: string | null }}
 */
export function splitPokemonNameAndForm(nameJa, formJaToNumber) {
  const normalizedName = normalize(nameJa);
  const match = normalizedName.match(/^(.+?)\s*[\(（]([^)）]+)[\)）]\s*$/);
  if (!match) {
    return { baseNameJa: normalizedName, form: 0, formLabelJa: null };
  }

  const baseNameJa = normalize(match[1]);
  const formLabelJa = normalize(match[2]);
  if (!hasOwnForm(formJaToNumber, formLabelJa)) {
    return { baseNameJa, form: null, formLabelJa };
  }

  const rawForm = formJaToNumber[formLabelJa];
  if (!isValidFormNo(rawForm)) {
    throw new Error(
      `フォーム "${formLabelJa}" の番号は 0..${MAX_FORM_NO} の整数である必要があります (${String(rawForm)})`,
    );
  }
  return { baseNameJa, form: rawForm, formLabelJa };
}

export function collectUnknownFormLabels(items, formJaToNumber) {
  const unknownFormLabels = new Set();
  for (const item of items) {
    const { form, formLabelJa } = splitPokemonNameAndForm(item?.nameJa, formJaToNumber);
    if (formLabelJa && form === null) {
      unknownFormLabels.add(formLabelJa);
    }
  }
  return unknownFormLabels;
}

export function assertNoUnknownFormLabels(items, formJaToNumber) {
  const unknownFormLabels = collectUnknownFormLabels(items, formJaToNumber);
  if (unknownFormLabels.size === 0) return;

  const labels = [...unknownFormLabels].sort();
  throw new Error(`未知フォームが未解決のため、MasterDB の生成を中断しました: ${labels.join(", ")}`);
}
