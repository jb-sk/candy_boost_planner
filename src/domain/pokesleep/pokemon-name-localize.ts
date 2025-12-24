import type { AppLocale } from "../../i18n";
import { getPokemonNameEnByDexNo } from "./_generated/pokemon-name-en";
import { formLabelJaToEn } from "./_generated/form-label-ja-to-en";
import { getPokemonNameJa } from "./pokemon-names";


function extractFormLabelJa(fullJa: string): string | null {
  // e.g. ピカチュウ(ホリデー)
  const m = String(fullJa).match(/\((.+)\)\s*$/);
  return m ? m[1] : null;
}

export function getPokemonNameLocalized(pokedexId: number, form: number = 0, locale: AppLocale = "ja"): string | null {
  if (locale !== "en") return getPokemonNameJa(pokedexId, form);
  const baseEn = getPokemonNameEnByDexNo(pokedexId);
  if (!baseEn) return getPokemonNameJa(pokedexId, form);
  if (!form) return baseEn;

  const fullJa = getPokemonNameJa(pokedexId, form);
  const labelJa = fullJa ? extractFormLabelJa(fullJa) : null;
  if (!labelJa) return baseEn;
  const labelEn = formLabelJaToEn[labelJa] ?? labelJa;
  return `${baseEn} (${labelEn})`;
}
