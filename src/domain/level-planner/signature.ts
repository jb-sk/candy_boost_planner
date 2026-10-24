import type { LevelPlannerInput } from './types';
import { entriesToObject } from '../../utils/entriesToObject';

/**
 * JSONのキー順に依存しない canonical JSON。
 * 配列の順序は solver の優先順位を表すため維持する。
 */
export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (typeof item === 'number') {
      if (Number.isNaN(item)) return 'NaN';
      if (item === Number.POSITIVE_INFINITY) return 'Infinity';
      if (item === Number.NEGATIVE_INFINITY) return '-Infinity';
      if (Object.is(item, -0)) return 0;
      return item;
    }
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      const object = item as Record<string, unknown>;
      return entriesToObject(
        Object.keys(object).sort().map(key => [key, normalize(object[key])]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

export function buildPlannerInputSignature(input: LevelPlannerInput): string {
  return canonicalJson(input);
}
