function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasOwnForm(formJaToNumber, formLabelJa) {
  return Object.prototype.hasOwnProperty.call(formJaToNumber, formLabelJa);
}

export function splitPokemonNameAndForm(nameJa, formJaToNumber) {
  const normalizedName = normalize(nameJa);
  const match = normalizedName.match(/^(.+?)\s*[\(（]([^)）]+)[\)）]\s*$/);
  if (!match) {
    return { baseNameJa: normalizedName, form: 0, formLabelJa: null };
  }

  const baseNameJa = normalize(match[1]);
  const formLabelJa = normalize(match[2]);
  const form = hasOwnForm(formJaToNumber, formLabelJa)
    ? Number(formJaToNumber[formLabelJa])
    : 0;

  return { baseNameJa, form, formLabelJa };
}

export function collectUnknownFormLabels(items, formJaToNumber) {
  const unknownFormLabels = new Set();
  for (const item of items) {
    const { formLabelJa } = splitPokemonNameAndForm(item?.nameJa, formJaToNumber);
    if (formLabelJa && !hasOwnForm(formJaToNumber, formLabelJa)) {
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
