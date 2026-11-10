import { describe, expect, it } from 'vitest';
import { Fraction, solveLinearSystem } from '../../src/core';

const f = Fraction.from;

describe('Fraction', () => {
  it('keeps values in lowest terms with a positive denominator', () => {
    const value = Fraction.ratio(6n, -8n);
    expect(value.num).toBe(-3n);
    expect(value.den).toBe(4n);
    expect(value.toString()).toBe('-3/4');
  });

  it('does exact arithmetic where floating point would not', () => {
    expect(f(0.1).add(f(0.2)).equals('0.3')).toBe(true);
    expect(f(1).div(f(3)).mul(f(3)).equals(1)).toBe(true);
    expect(f(3).sub(f(3)).neg().toString()).toBe('0');
  });

  it.each([
    ['1.5', '3/2'],
    ['-0.25', '-1/4'],
    ['.5', '1/2'],
    ['2e3', '2000'],
    ['1.5e-3', '3/2000'],
    ['+7', '7'],
  ])('parses %s as %s', (text, expected) => {
    expect(f(text).toString()).toBe(expected);
  });

  it.each(['', '.', 'abc', '1,5', '1.2.3', 'e5', '1e', 'Infinity'])('rejects "%s"', (text) => {
    expect(() => f(text)).toThrow(SyntaxError);
  });

  it('rejects non-finite numbers and a zero denominator', () => {
    expect(() => f(Number.NaN)).toThrow(RangeError);
    expect(() => f(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => Fraction.ratio(1n, 0n)).toThrow(RangeError);
    expect(() => f(1).div(Fraction.ZERO)).toThrow(RangeError);
  });

  it('converts to the nearest number, even for huge terms', () => {
    expect(Fraction.ratio(22n, 3n).toNumber()).toBeCloseTo(7.3333333, 6);
    const huge = 10n ** 400n;
    expect(Fraction.ratio(huge * 3n, huge * 2n + 1n).toNumber()).toBeCloseTo(1.5, 10);
  });
});

describe('solveLinearSystem', () => {
  it('solves a system that needs a row swap', () => {
    const matrix = [
      [f(0), f(1)],
      [f(2), f(1)],
    ];
    const solution = solveLinearSystem(matrix, [f(3), f(5)]);
    expect(solution?.map(String)).toEqual(['1', '3']);
    expect(matrix[0]?.[0]?.isZero()).toBe(true);
  });

  it('returns null for a singular matrix', () => {
    const matrix = [
      [f(1), f(2)],
      [f(2), f(4)],
    ];
    expect(solveLinearSystem(matrix, [f(1), f(2)])).toBeNull();
  });
});
