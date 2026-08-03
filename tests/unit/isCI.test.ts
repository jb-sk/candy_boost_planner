import { afterEach, describe, expect, test } from 'vitest';

import { isCI } from '../helpers/isCI';

const originalCI = process.env.CI;

afterEach(() => {
  if (originalCI === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = originalCI;
  }
});

describe('isCI', () => {
  test.each([
    [undefined, false],
    ['', false],
    ['0', false],
    ['false', false],
    ['False', false],
    [' true ', true],
    ['1', true],
    ['true', true],
  ] as const)('CI=%s を %s と判定する', (value, expected) => {
    if (value === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = value;
    }

    expect(isCI()).toBe(expected);
  });
});
