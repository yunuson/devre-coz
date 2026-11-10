import { describe, expect, it } from 'vitest';
import { Fraction } from '../../src/core';
import { formatQuantity, type Unit } from '../../src/ui/format';

/**
 * The display rule for numbers: at most 4 significant digits, and at most 3 digits
 * after the decimal comma.
 */

const q = (num: bigint, den: bigint): Fraction => Fraction.ratio(num, den);

describe('long numbers are shortened to 4 significant digits', () => {
  it.each<[Fraction, Unit, string]>([
    [q(8n, 11000n), 'A', '727,3 µA'],
    [q(6n, 11000n), 'A', '545,5 µA'],
    [q(1n, 1010n), 'A', '990,1 µA'],
    [q(100n, 7n), 'V', '14,29 V'],
    [q(1000n, 7n), 'V', '142,9 V'],
    [q(-100n, 7n), 'V', '−14,29 V'],
    [Fraction.from('12345.678'), 'Ω', '12,35 kΩ'],
    [Fraction.from(123456), 'Ω', '123,5 kΩ'],
  ])('%s %s → %s', (value, unit, expected) => {
    expect(formatQuantity(value, unit)).toBe(expected);
  });
});

describe('never more than 3 digits after the comma', () => {
  it.each<[Fraction, Unit, string]>([
    [q(-5n, 11n), 'V', '−0,455 V'],
    [q(43n, 11n), 'V', '3,909 V'],
    [q(1n, 7n), 'A', '0,143 A'],
    [q(1n, 3n), 'A', '0,333 A'],
  ])('%s %s → %s', (value, unit, expected) => {
    expect(formatQuantity(value, unit)).toBe(expected);
  });
});

describe('short numbers stay as they are', () => {
  it.each<[Fraction, Unit, string]>([
    [Fraction.from(10), 'V', '10 V'],
    [Fraction.from(2000), 'Ω', '2 kΩ'],
    [Fraction.from('2.5'), 'V', '2,5 V'],
    [Fraction.ZERO, 'A', '0 A'],
    [Fraction.from(999), 'W', '999 W'],
  ])('%s %s → %s', (value, unit, expected) => {
    expect(formatQuantity(value, unit)).toBe(expected);
  });
});

describe('rounding up to 1000 moves to the next prefix', () => {
  it.each<[Fraction, Unit, string]>([
    [Fraction.from('999.96'), 'V', '1 kV'],
    [Fraction.from('0.00099996'), 'A', '1 mA'],
  ])('%s %s → %s', (value, unit, expected) => {
    expect(formatQuantity(value, unit)).toBe(expected);
  });
});
