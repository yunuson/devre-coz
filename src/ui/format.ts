import { Fraction } from '../core';

export type Unit = 'Ω' | 'V' | 'A' | 'W' | 'F' | 'H';

const PREFIX_FACTORS: Readonly<Record<string, Fraction>> = {
  p: Fraction.from('1e-12'),
  n: Fraction.from('1e-9'),
  u: Fraction.from('1e-6'),
  µ: Fraction.from('1e-6'),
  μ: Fraction.from('1e-6'),
  m: Fraction.from('1e-3'),
  k: Fraction.from('1e3'),
  K: Fraction.from('1e3'),
  M: Fraction.from('1e6'),
  G: Fraction.from('1e9'),
};

const DISPLAY_PREFIXES = [
  { symbol: 'G', factor: 1e9 },
  { symbol: 'M', factor: 1e6 },
  { symbol: 'k', factor: 1e3 },
  { symbol: '', factor: 1 },
  { symbol: 'm', factor: 1e-3 },
  { symbol: 'µ', factor: 1e-6 },
  { symbol: 'n', factor: 1e-9 },
  { symbol: 'p', factor: 1e-12 },
];

/** Values from 0.1 up to 1000 keep the base unit, so 0.5 A reads as 0,5 A rather than 500 mA. */
const SMALLEST_BASE_UNIT_VALUE = 0.1;

const QUANTITY_PATTERN = /^([+\-−]?[\d.,]+(?:e[+-]?\d+)?)\s*([pnuµμmkKMG]?)\s*(Ω|ω|ohm|V|A|F|H)?$/i;

export type QuantityResult =
  | { readonly ok: true; readonly value: Fraction }
  | { readonly ok: false; readonly reason: 'format' | 'unit' };

/** Reads what a person types: "2 kΩ", "2k", "1,5 A", "4.7u". Prefix case matters: m is milli, M is mega. */
export function parseQuantity(text: string, unit: Exclude<Unit, 'W'>): QuantityResult {
  const match = QUANTITY_PATTERN.exec(text.trim());
  if (!match) return { ok: false, reason: 'format' };

  const [, numberText = '', typedPrefix = '', typedUnit = ''] = match;
  const prefixInText = PREFIX_FACTORS[typedPrefix];
  if (typedPrefix !== '' && !prefixInText) return { ok: false, reason: 'format' };

  if (typedUnit !== '') {
    const normalized = /^(ω|ohm)$/i.test(typedUnit) ? 'Ω' : typedUnit.toUpperCase();
    if (normalized !== unit) return { ok: false, reason: 'unit' };
  }

  try {
    const base = Fraction.from(numberText.replace(',', '.').replace('−', '-'));
    return { ok: true, value: prefixInText ? base.mul(prefixInText) : base };
  } catch {
    return { ok: false, reason: 'format' };
  }
}

/** Node 1 is A, 26 is Z, 27 is AA. Letters keep node voltages (VA) apart from sources named V1. */
export function nodeLetter(node: number): string {
  let remaining = node;
  let letters = '';
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + index) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/** Element names are typed by the user, so they must be escaped before going into markup. */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

const numberFormat = new Intl.NumberFormat('tr-TR', {
  maximumFractionDigits: 3,
  useGrouping: false,
});

/**
 * Formats a value with a suitable SI prefix and Turkish decimals.
 * Shows at most 4 significant digits and at most 3 digits after the decimal comma.
 * If rounding reaches 1000, moves to the next prefix (e.g. 999,96 V → 1 kV).
 */
export function formatQuantity(value: Fraction, unit: Unit): string {
  const number = value.toNumber();
  const magnitude = Math.abs(number);
  if (magnitude === 0) return `0 ${unit}`;

  let prefix =
    magnitude >= SMALLEST_BASE_UNIT_VALUE && magnitude < 1000
      ? DISPLAY_PREFIXES[3]!
      : (DISPLAY_PREFIXES.find(({ factor }) => magnitude >= factor) ?? DISPLAY_PREFIXES.at(-1)!);

  let scaled = number / prefix.factor;
  scaled = roundToSigFigs(scaled);

  // Move to the next prefix when rounding reaches 1000.
  if (Math.abs(scaled) >= 1000 && indexOf(prefix) > 0) {
    prefix = DISPLAY_PREFIXES[indexOf(prefix) - 1]!;
    scaled = roundToSigFigs(number / prefix.factor);
  }

  const text = numberFormat.format(scaled).replace('-', '−');
  return `${text} ${prefix.symbol}${unit}`;
}

export function formatBeta(value: Fraction): string {
  return `β = ${formatBetaValue(value)}`;
}

export function formatBetaValue(value: Fraction): string {
  return numberFormat.format(value.toNumber()).replace('-', '−');
}

export function parseBeta(text: string): QuantityResult {
  const match = /^\s*(?:β\s*=\s*)?([+\-−]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*$/.exec(text);
  if (!match) return { ok: false, reason: 'format' };
  try {
    return { ok: true, value: Fraction.from(match[1]!.replace(',', '.').replace('−', '-')) };
  } catch {
    return { ok: false, reason: 'format' };
  }
}

/** Rounds a number to at most 4 significant digits and at most 3 decimal places. */
function roundToSigFigs(x: number): number {
  if (x === 0) return 0;
  const places = Math.min(3, Math.max(0, 4 - Math.floor(Math.log10(Math.abs(x))) - 1));
  return Math.round(x * 10 ** places) / 10 ** places;
}

/** Returns the index of a prefix in DISPLAY_PREFIXES. */
function indexOf(prefix: { readonly symbol: string; readonly factor: number }): number {
  return DISPLAY_PREFIXES.findIndex(({ symbol }) => symbol === prefix.symbol);
}
