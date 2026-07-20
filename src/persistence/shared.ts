import type { ExpGainNature, ExpType } from "../domain/types";

export function toInt(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.floor(numberValue);
}

export function toExpType(value: unknown, fallback: ExpType): ExpType {
  const numberValue = toInt(value, fallback);
  if (numberValue === 600 || numberValue === 900 || numberValue === 1080 || numberValue === 1320) return numberValue;
  return fallback;
}

export function toExpGainNature(value: unknown, fallback: ExpGainNature): ExpGainNature {
  const stringValue = typeof value === "string" ? value : String(value ?? "");
  if (stringValue === "up" || stringValue === "down" || stringValue === "normal") return stringValue;
  return fallback;
}
