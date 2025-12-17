import type { AppLocale } from "../../i18n";
import { getPokemonNameEnByDexNo } from "./_generated/pokemon-name-en";
import { getPokemonNameJa } from "./pokemon-names";

const formLabelJaToEn: Record<string, string> = {
  "ホリデー": "Holiday",
  "ハロウィン": "Halloween",
  "アローラ": "Alola",
  "パルデア": "Paldea",
  // Toxtricity forms (Sleep uses JP labels "ハイ/ロー")
  "ハイ": "Amped",
  "ロー": "Low Key",
  // Pumpkaboo / Gourgeist sizes
  "おおだま": "Large",
  "ちゅうだま": "Average",
  "こだま": "Small",
  "ギガだま": "Super",
};

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
