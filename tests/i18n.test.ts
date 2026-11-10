import { describe, expect, it } from 'vitest';
import { tr } from '../src/i18n/tr';

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

describe('tr', () => {
  it('has no empty interface strings', () => {
    const strings = collectStrings(tr);

    expect(strings.length).toBeGreaterThan(0);
    for (const text of strings) {
      expect(text.trim()).not.toBe('');
    }
  });
});
