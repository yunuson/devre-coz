import { describe, expect, it } from 'vitest';
import { Fraction } from '../../src/core';
import { escapeHtml, formatQuantity, nodeLetter, parseQuantity, type Unit } from '../../src/ui/format';

describe('parseQuantity', () => {
  it.each<[string, Exclude<Unit, 'W'>, string]>([
    ['4', 'Ω', '4'],
    ['4 Ω', 'Ω', '4'],
    ['2 kΩ', 'Ω', '2000'],
    ['2k', 'Ω', '2000'],
    ['2K', 'Ω', '2000'],
    ['2kohm', 'Ω', '2000'],
    ['2,2 kΩ', 'Ω', '2200'],
    ['1 MΩ', 'Ω', '1000000'],
    ['12 V', 'V', '12'],
    ['-5 V', 'V', '-5'],
    ['−5 V', 'V', '-5'],
    ['500 mV', 'V', '1/2'],
    ['1.5 A', 'A', '3/2'],
    ['1,5 A', 'A', '3/2'],
    ['2 mA', 'A', '1/500'],
    ['4.7u', 'A', '47/10000000'],
    ['10 µA', 'A', '1/100000'],
  ])('reads "%s" in %s as %s', (text, unit, expected) => {
    expect(parseQuantity(text, unit)).toEqual({ ok: true, value: parseExpected(expected) });
  });

  it('keeps milli and mega apart', () => {
    const milli = parseQuantity('2 m', 'V');
    const mega = parseQuantity('2 M', 'V');
    expect(milli.ok && milli.value.toString()).toBe('1/500');
    expect(mega.ok && mega.value.toString()).toBe('2000000');
  });

  it.each(['', 'abc', '1,2,3', '1.2.3', '5 x', '..', 'k'])('rejects "%s"', (text) => {
    expect(parseQuantity(text, 'V')).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects the wrong unit', () => {
    expect(parseQuantity('5 V', 'Ω')).toEqual({ ok: false, reason: 'unit' });
    expect(parseQuantity('5 A', 'V')).toEqual({ ok: false, reason: 'unit' });
  });
});

describe('nodeLetter', () => {
  it.each([
    [1, 'A'],
    [2, 'B'],
    [26, 'Z'],
    [27, 'AA'],
    [28, 'AB'],
    [52, 'AZ'],
    [53, 'BA'],
  ])('names node %d as %s', (node, letter) => {
    expect(nodeLetter(node)).toBe(letter);
  });
});

describe('escapeHtml', () => {
  it('escapes everything that could break out of markup', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

function parseExpected(text: string): Fraction {
  const [num = '0', den = '1'] = text.split('/');
  return Fraction.ratio(BigInt(num), BigInt(den));
}

describe('formatQuantity', () => {
  it.each<[Fraction, Unit, string]>([
    [Fraction.ZERO, 'V', '0 V'],
    [Fraction.from(6), 'V', '6 V'],
    [Fraction.ratio(25n, 3n), 'V', '8,333 V'],
    [Fraction.ratio(1n, 3n), 'A', '0,333 A'],
    [Fraction.from('0.5'), 'A', '0,5 A'],
    [Fraction.ratio(1n, 500n), 'A', '2 mA'],
    [Fraction.from(2000), 'Ω', '2 kΩ'],
    [Fraction.from(2200), 'Ω', '2,2 kΩ'],
    [Fraction.from(1000000), 'Ω', '1 MΩ'],
    [Fraction.from(-5), 'V', '−5 V'],
    [Fraction.ratio(-4n, 3n), 'V', '−1,333 V'],
    [Fraction.from('1e-6'), 'A', '1 µA'],
    [Fraction.from(999), 'W', '999 W'],
  ])('shows %s %s as %s', (value, unit, expected) => {
    expect(formatQuantity(value, unit)).toBe(expected);
  });
});
