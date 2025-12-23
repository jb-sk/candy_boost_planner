/**
 * Pokemon type utilities
 */
import type { PokemonType } from "./pokemon-master";

export const PokemonTypes: PokemonType[] = [
  "Normal",
  "Fire",
  "Water",
  "Electric",
  "Grass",
  "Ice",
  "Fighting",
  "Poison",
  "Ground",
  "Flying",
  "Psychic",
  "Bug",
  "Rock",
  "Ghost",
  "Dragon",
  "Dark",
  "Steel",
  "Fairy",
];

export const PokemonTypeMapEnToJa: Record<string, string> = {
  Normal: "ノーマル",
  Fire: "ほのお",
  Water: "みず",
  Electric: "でんき",
  Grass: "くさ",
  Ice: "こおり",
  Fighting: "かくとう",
  Poison: "どく",
  Ground: "じめん",
  Flying: "ひこう",
  Psychic: "エスパー",
  Bug: "むし",
  Rock: "いわ",
  Ghost: "ゴースト",
  Dragon: "ドラゴン",
  Dark: "あく",
  Steel: "はがね",
  Fairy: "フェアリー",
  unknown: "不明",
};

export function getTypeNameJa(typeEn: string): string {
  return PokemonTypeMapEnToJa[typeEn] ?? typeEn;
}

export function getTypeName(typeEn: string, locale: string): string {
  if (locale === "en") {
    return typeEn;
  }
  return PokemonTypeMapEnToJa[typeEn] ?? typeEn;
}
