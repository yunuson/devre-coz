export type FractionInput = Fraction | bigint | number | string;

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i;
const MAX_EXPONENT = 308;
const MAX_SAFE_BITS = 1000;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

function bitLength(value: bigint): number {
  return (value < 0n ? -value : value).toString(2).length;
}

/** Exact rational number. Immutable and always in lowest terms with a positive denominator. */
export class Fraction {
  static readonly ZERO = new Fraction(0n, 1n);
  static readonly ONE = new Fraction(1n, 1n);

  readonly num: bigint;
  readonly den: bigint;

  private constructor(num: bigint, den: bigint) {
    if (den === 0n) {
      throw new RangeError('Fraction denominator cannot be zero');
    }
    const sign = den < 0n ? -1n : 1n;
    const divisor = gcd(num, den);
    this.num = (sign * num) / divisor;
    this.den = (sign * den) / divisor;
  }

  static ratio(num: bigint, den: bigint): Fraction {
    return new Fraction(num, den);
  }

  /** Numbers and strings are read through their decimal text, so 0.1 becomes exactly 1/10. */
  static from(value: FractionInput): Fraction {
    if (value instanceof Fraction) return value;
    if (typeof value === 'bigint') return new Fraction(value, 1n);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new RangeError(`Not a finite number: ${value}`);
      }
      return Fraction.parseDecimal(String(value));
    }
    return Fraction.parseDecimal(value.trim());
  }

  private static parseDecimal(text: string): Fraction {
    const match = DECIMAL_PATTERN.exec(text);
    const whole = match?.[2] ?? '';
    const decimals = match?.[3] ?? '';
    if (!match || whole.length + decimals.length === 0) {
      throw new SyntaxError(`Not a decimal number: "${text}"`);
    }
    const exponent = Number(match[4] ?? '0') - decimals.length;
    if (Math.abs(exponent) > MAX_EXPONENT) {
      throw new RangeError(`Exponent out of range: "${text}"`);
    }
    const digits = BigInt(whole + decimals);
    const signed = match[1] === '-' ? -digits : digits;
    const scale = 10n ** BigInt(Math.abs(exponent));
    return exponent >= 0 ? new Fraction(signed * scale, 1n) : new Fraction(signed, scale);
  }

  add(other: Fraction): Fraction {
    return new Fraction(this.num * other.den + other.num * this.den, this.den * other.den);
  }

  sub(other: Fraction): Fraction {
    return new Fraction(this.num * other.den - other.num * this.den, this.den * other.den);
  }

  mul(other: Fraction): Fraction {
    return new Fraction(this.num * other.num, this.den * other.den);
  }

  div(other: Fraction): Fraction {
    return new Fraction(this.num * other.den, this.den * other.num);
  }

  neg(): Fraction {
    return new Fraction(-this.num, this.den);
  }

  isZero(): boolean {
    return this.num === 0n;
  }

  isPositive(): boolean {
    return this.num > 0n;
  }

  equals(other: FractionInput): boolean {
    const value = Fraction.from(other);
    return this.num === value.num && this.den === value.den;
  }

  /** Nearest number for display. Never feed the result back into a calculation. */
  toNumber(): number {
    const excess = Math.max(bitLength(this.num), bitLength(this.den)) - MAX_SAFE_BITS;
    if (excess <= 0) return Number(this.num) / Number(this.den);
    const shift = BigInt(excess);
    return Number(this.num >> shift) / Number(this.den >> shift);
  }

  toString(): string {
    return this.den === 1n ? this.num.toString() : `${this.num}/${this.den}`;
  }
}
