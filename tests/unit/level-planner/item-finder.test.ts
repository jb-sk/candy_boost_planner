import { describe, expect, it } from 'vitest';
import { findBestItemAllocation } from '../../../src/domain/level-planner/core/itemAllocation';

describe('item-finder', () => {
  it('万能Sがなくても万能Mの過剰供給で不足1を埋める', () => {
    const result = findBestItemAllocation(1, { s: 0, m: 0 }, { s: 0, m: 1, l: 0 });
    expect(result.supplied).toBe(20);
    expect(result.universalM).toBe(1);
  });

  it('万能S/Mがなくても万能Lの過剰供給で不足1を埋める', () => {
    const result = findBestItemAllocation(1, { s: 0, m: 0 }, { s: 0, m: 0, l: 1 });
    expect(result.supplied).toBe(100);
    expect(result.universalL).toBe(1);
  });

  it('タイプMの過剰供給で不足1を埋める', () => {
    const result = findBestItemAllocation(1, { s: 0, m: 1 }, { s: 0, m: 0, l: 0 });
    expect(result.supplied).toBe(25);
    expect(result.typeM).toBe(1);
  });
});
