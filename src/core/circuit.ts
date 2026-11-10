import { Fraction, type FractionInput } from './fraction';

/** A connection point. The editor derives these from grid positions; the core only compares them. */
export type PointId = string;
export type ElementId = string;

export interface Resistor {
  readonly kind: 'resistor';
  readonly id: ElementId;
  readonly a: PointId;
  readonly b: PointId;
  /** Ohms. */
  readonly resistance: Fraction;
}

export interface VoltageSource {
  readonly kind: 'voltage-source';
  readonly id: ElementId;
  readonly plus: PointId;
  readonly minus: PointId;
  /** Volts: V(plus) − V(minus). */
  readonly voltage: Fraction;
}

export interface CurrentSource {
  readonly kind: 'current-source';
  readonly id: ElementId;
  /** The source pushes its current from this point, through itself, to `to`. */
  readonly from: PointId;
  readonly to: PointId;
  /** Amperes. */
  readonly current: Fraction;
}

export interface Diode {
  readonly kind: 'diode';
  readonly id: ElementId;
  readonly anode: PointId;
  readonly cathode: PointId;
  readonly threshold: Fraction;
}

export interface Zener {
  readonly kind: 'zener';
  readonly id: ElementId;
  readonly anode: PointId;
  readonly cathode: PointId;
  readonly zenerVoltage: Fraction;
  readonly threshold: Fraction;
}

export interface Bjt {
  readonly kind: 'bjt';
  readonly id: ElementId;
  readonly polarity: 'npn' | 'pnp';
  readonly base: PointId;
  readonly collector: PointId;
  readonly emitter: PointId;
  readonly beta: Fraction;
  readonly vbe: Fraction;
}

export type BjtRegion = 'active' | 'saturation' | 'cutoff';

export interface Wire {
  readonly kind: 'wire';
  readonly id: ElementId;
  readonly a: PointId;
  readonly b: PointId;
}

export interface Ground {
  readonly kind: 'ground';
  readonly id: ElementId;
  readonly point: PointId;
}

/**
 * An ideal operational amplifier. No current enters its inputs, its inputs sit at equal voltages,
 * and its output supplies whatever current the circuit needs, drawn from supplies that aren't drawn.
 */
export interface OpAmp {
  readonly kind: 'op-amp';
  readonly id: ElementId;
  /** The − input. */
  readonly inverting: PointId;
  /** The + input. */
  readonly nonInverting: PointId;
  readonly output: PointId;
  /** Volts, as ±supply. The ideal solution ignores it; going past it only raises a warning. */
  readonly supply: Fraction;
}

export type Component = Resistor | VoltageSource | CurrentSource;
export type CircuitElement = Component | Diode | Zener | Bjt | OpAmp | Wire | Ground;

export interface Circuit {
  readonly elements: readonly CircuitElement[];
}

export const resistor = (id: ElementId, a: PointId, b: PointId, resistance: FractionInput): Resistor => ({
  kind: 'resistor',
  id,
  a,
  b,
  resistance: Fraction.from(resistance),
});

export const voltageSource = (
  id: ElementId,
  plus: PointId,
  minus: PointId,
  voltage: FractionInput,
): VoltageSource => ({
  kind: 'voltage-source',
  id,
  plus,
  minus,
  voltage: Fraction.from(voltage),
});

export const currentSource = (
  id: ElementId,
  from: PointId,
  to: PointId,
  current: FractionInput,
): CurrentSource => ({
  kind: 'current-source',
  id,
  from,
  to,
  current: Fraction.from(current),
});

export const DEFAULT_DIODE_THRESHOLD = Fraction.from('0.7');

export const diode = (
  id: ElementId,
  anode: PointId,
  cathode: PointId,
  threshold: FractionInput = DEFAULT_DIODE_THRESHOLD,
): Diode => ({ kind: 'diode', id, anode, cathode, threshold: Fraction.from(threshold) });

export const DEFAULT_ZENER_VOLTAGE = Fraction.from(10);

export const zener = (
  id: ElementId,
  anode: PointId,
  cathode: PointId,
  zenerVoltage: FractionInput = DEFAULT_ZENER_VOLTAGE,
  threshold: FractionInput = DEFAULT_DIODE_THRESHOLD,
): Zener => ({ kind: 'zener', id, anode, cathode, zenerVoltage: Fraction.from(zenerVoltage), threshold: Fraction.from(threshold) });

export const DEFAULT_BETA = Fraction.from(100);

const makeBjt = (polarity: Bjt['polarity'], id: ElementId, base: PointId, collector: PointId, emitter: PointId, beta: FractionInput = DEFAULT_BETA): Bjt => ({
  kind: 'bjt', id, polarity, base, collector, emitter, beta: Fraction.from(beta), vbe: DEFAULT_DIODE_THRESHOLD,
});

export const npn = (id: ElementId, base: PointId, collector: PointId, emitter: PointId, beta: FractionInput = DEFAULT_BETA): Bjt =>
  makeBjt('npn', id, base, collector, emitter, beta);

export const pnp = (id: ElementId, base: PointId, collector: PointId, emitter: PointId, beta: FractionInput = DEFAULT_BETA): Bjt =>
  makeBjt('pnp', id, base, collector, emitter, beta);

export const DEFAULT_OP_AMP_SUPPLY = Fraction.from(15);

export const opAmp = (
  id: ElementId,
  inverting: PointId,
  nonInverting: PointId,
  output: PointId,
  supply: FractionInput = DEFAULT_OP_AMP_SUPPLY,
): OpAmp => ({
  kind: 'op-amp',
  id,
  inverting,
  nonInverting,
  output,
  supply: Fraction.from(supply),
});

export const wire = (id: ElementId, a: PointId, b: PointId): Wire => ({ kind: 'wire', id, a, b });

export const ground = (id: ElementId, point: PointId): Ground => ({ kind: 'ground', id, point });
