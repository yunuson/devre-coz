import { Fraction } from '../../core';
import {
  addComponent,
  addGround,
  addWire,
  EMPTY_SCHEMATIC,
  type Cell,
  type ComponentKind,
  type Rotation,
  type Schematic,
} from './schematic';

export type ExampleId =
  | 'voltage-divider'
  | 'two-current-sources'
  | 'mixed-sources'
  | 'supernode'
  | 'inverting-amplifier'
  | 'non-inverting-amplifier'
  | 'voltage-follower'
  | 'summing-amplifier'
  | 'difference-amplifier'
  | 'diode-series'
  | 'zener-regulator'
  | 'led-series'
  | 'bjt-fixed-bias'
  | 'bjt-voltage-divider';
/** Kept as an alias so the editor and the menu read naturally. */
export type ExampleMenuId = ExampleId;

type ComponentSpec = readonly [kind: ComponentKind, x: number, y: number, rotation: Rotation, value: string, label?: string];
type WireSpec = readonly [x1: number, y1: number, x2: number, y2: number];

interface ExampleSpec {
  readonly components: readonly ComponentSpec[];
  readonly ground: Cell | readonly Cell[];
  readonly wires: readonly WireSpec[];
}

const SPECS: Readonly<Record<ExampleMenuId, ExampleSpec>> = {
  'voltage-divider': {
    components: [
      ['voltage-source', 8, 12, 1, '10'],
      ['resistor', 15, 8, 0, '2000'],
      ['resistor', 22, 12, 1, '3000'],
    ],
    ground: { x: 15, y: 16 },
    wires: [
      [8, 10, 8, 8],
      [8, 8, 13, 8],
      [17, 8, 22, 8],
      [22, 8, 22, 10],
      [8, 14, 8, 16],
      [8, 16, 22, 16],
      [22, 14, 22, 16],
    ],
  },
  'two-current-sources': {
    components: [
      ['current-source', 6, 12, 3, '2'],
      ['resistor', 13, 12, 1, '4'],
      ['resistor', 20, 8, 0, '2'],
      ['resistor', 27, 12, 1, '6'],
      ['current-source', 34, 12, 3, '1'],
    ],
    ground: { x: 20, y: 16 },
    wires: [
      [6, 10, 6, 8],
      [6, 8, 18, 8],
      [13, 10, 13, 8],
      [22, 8, 34, 8],
      [27, 10, 27, 8],
      [34, 10, 34, 8],
      [6, 14, 6, 16],
      [6, 16, 34, 16],
      [13, 14, 13, 16],
      [27, 14, 27, 16],
      [34, 14, 34, 16],
    ],
  },
  'mixed-sources': {
    components: [
      ['voltage-source', 6, 12, 1, '10'],
      ['resistor', 14, 8, 0, '5'],
      ['resistor', 22, 12, 1, '10'],
      ['current-source', 30, 12, 3, '0.5'],
    ],
    ground: { x: 14, y: 16 },
    wires: [
      [6, 10, 6, 8],
      [6, 8, 12, 8],
      [16, 8, 30, 8],
      [22, 10, 22, 8],
      [30, 10, 30, 8],
      [6, 14, 6, 16],
      [6, 16, 30, 16],
      [22, 14, 22, 16],
      [30, 14, 30, 16],
    ],
  },
  supernode: {
    components: [
      ['current-source', 6, 12, 3, '2'],
      ['resistor', 13, 12, 1, '4'],
      // Rotated so the plus terminal faces right, toward node 2.
      ['voltage-source', 20, 8, 2, '6'],
      ['resistor', 27, 12, 1, '2'],
    ],
    ground: { x: 17, y: 16 },
    wires: [
      [6, 10, 6, 8],
      [6, 8, 18, 8],
      [13, 10, 13, 8],
      [22, 8, 27, 8],
      [27, 8, 27, 10],
      [6, 14, 6, 16],
      [6, 16, 27, 16],
      [13, 14, 13, 16],
      [27, 14, 27, 16],
    ],
  },
  'inverting-amplifier': {
    components: [
      ['voltage-source', 8, 12, 1, '1'],
      ['resistor', 14, 8, 0, '2000'],
      ['resistor', 32, 6, 0, '10000'],
      ['op-amp', 24, 12, 0, '15'],
    ],
    ground: { x: 22, y: 17 },
    wires: [
      [8, 10, 8, 8], [8, 8, 12, 8],
      [16, 8, 20, 8], [20, 8, 20, 11], [20, 11, 22, 11],
      [8, 14, 8, 16], [8, 16, 22, 16], [22, 13, 22, 16], [22, 16, 22, 17],
      [26, 12, 28, 12], [28, 12, 28, 6], [28, 6, 30, 6],
      [34, 6, 36, 6], [36, 6, 36, 4], [36, 4, 22, 4], [22, 4, 22, 11],
    ],
  },
  'non-inverting-amplifier': {
    components: [
      ['voltage-source', 38, 17, 1, '1.5'],
      ['resistor', 22, 17, 1, '2000'],
      ['resistor', 36, 6, 0, '6000'],
      ['op-amp', 30, 12, 0, '15'],
    ],
    ground: [{ x: 22, y: 21 }, { x: 38, y: 20 }],
    wires: [
      [38, 15, 28, 15], [28, 15, 28, 13], [38, 19, 38, 20],
      [28, 11, 22, 11], [22, 11, 22, 15], [22, 19, 22, 21],
      [32, 12, 34, 12], [34, 12, 34, 6],
      [38, 6, 40, 6], [40, 6, 40, 4], [40, 4, 28, 4], [28, 4, 28, 11],
    ],
  },
  'voltage-follower': {
    components: [
      ['voltage-source', 8, 12, 1, '3'],
      ['resistor', 32, 17, 1, '2000'],
      ['op-amp', 24, 12, 0, '15'],
    ],
    ground: { x: 32, y: 19 },
    wires: [
      [8, 10, 8, 8], [8, 8, 18, 8], [18, 8, 18, 13], [18, 13, 22, 13],
      [26, 12, 28, 12], [28, 12, 32, 12], [32, 12, 32, 15],
      [32, 12, 32, 4], [32, 4, 22, 4], [22, 4, 22, 11],
      [8, 14, 8, 20], [8, 20, 32, 20], [32, 20, 32, 19],
    ],
  },
  'summing-amplifier': {
    components: [
      ['voltage-source', 6, 8, 1, '1'],
      ['voltage-source', 6, 20, 1, '0.5'],
      ['resistor', 14, 6, 0, '2000'],
      ['resistor', 14, 18, 0, '1000'],
      ['resistor', 36, 6, 0, '4000'],
      ['op-amp', 30, 12, 0, '15'],
    ],
    ground: [{ x: 6, y: 10 }, { x: 6, y: 22 }, { x: 28, y: 13 }],
    wires: [
      [6, 6, 12, 6],
      [16, 6, 26, 6], [26, 6, 26, 11],
      [6, 18, 12, 18],
      [16, 18, 24, 18], [24, 18, 24, 11], [24, 11, 26, 11], [26, 11, 28, 11],
      [32, 12, 34, 12], [34, 12, 34, 6],
      [38, 6, 40, 6], [40, 6, 40, 4], [40, 4, 28, 4], [28, 4, 28, 11],
    ],
  },
  'difference-amplifier': {
    components: [
      ['voltage-source', 6, 8, 1, '2'],
      ['voltage-source', 6, 20, 1, '5'],
      ['resistor', 14, 6, 0, '1000'],
      ['resistor', 14, 18, 0, '1000'],
      ['resistor', 26, 17, 1, '1000'],
      ['resistor', 36, 6, 0, '1000'],
      ['op-amp', 30, 12, 0, '15'],
    ],
    ground: [{ x: 6, y: 10 }, { x: 6, y: 22 }, { x: 26, y: 19 }],
    wires: [
      [6, 6, 12, 6],
      [16, 6, 26, 6], [26, 6, 26, 11], [26, 11, 28, 11],
      [6, 18, 12, 18],
      [16, 18, 24, 18], [24, 18, 24, 13], [24, 13, 28, 13],
      [28, 13, 28, 15], [28, 15, 26, 15],
      [32, 12, 34, 12], [34, 12, 34, 6],
      [38, 6, 40, 6], [40, 6, 40, 4], [40, 4, 28, 4], [28, 4, 28, 11],
    ],
  },
  // Laid out like the voltage divider, with the diode in place of the top resistor.
  'diode-series': {
    components: [
      ['voltage-source', 8, 12, 1, '12'],
      ['diode', 15, 8, 0, '0.7'],
      ['resistor', 22, 12, 1, '1000'],
    ],
    ground: { x: 15, y: 16 },
    wires: [
      [8, 10, 8, 8],
      [8, 8, 13, 8],
      [17, 8, 22, 8],
      [22, 8, 22, 10],
      [8, 14, 8, 16],
      [8, 16, 22, 16],
      [22, 14, 22, 16],
    ],
  },
  'zener-regulator': {
    components: [
      ['voltage-source', 8, 12, 1, '15'],
      ['resistor', 15, 8, 0, '1000'],
      ['zener', 22, 12, 3, '10'],
      ['resistor', 29, 12, 1, '3000'],
    ],
    ground: { x: 8, y: 16 },
    wires: [
      [8, 10, 8, 8], [8, 8, 13, 8], [17, 8, 22, 8], [22, 8, 22, 10],
      [22, 10, 29, 10], [8, 14, 8, 16], [8, 16, 29, 16],
      [22, 14, 22, 16], [29, 14, 29, 16],
    ],
  },
  'led-series': {
    components: [
      ['voltage-source', 8, 12, 1, '5'],
      ['led', 15, 8, 0, '2'],
      ['resistor', 22, 12, 1, '150'],
    ],
    ground: { x: 15, y: 16 },
    wires: [
      [8, 10, 8, 8], [8, 8, 13, 8], [17, 8, 22, 8], [22, 8, 22, 10],
      [8, 14, 8, 16], [8, 16, 22, 16], [22, 14, 22, 16],
    ],
  },
  'bjt-fixed-bias': {
    components: [
      ['voltage-source', 8, 12, 1, '12', 'VCC'],
      ['resistor', 18, 9, 1, '226000', 'RB'],
      ['resistor', 25, 8, 1, '1000', 'RC'],
      ['npn', 24, 13, 0, '100', 'Q1'],
    ],
    ground: { x: 14, y: 18 },
    wires: [
      [8, 10, 8, 6], [8, 6, 25, 6], [18, 6, 18, 7],
      [18, 11, 18, 13], [18, 13, 22, 13], [25, 10, 25, 11],
      [25, 15, 25, 18], [8, 14, 8, 18], [8, 18, 25, 18],
    ],
  },
  'bjt-voltage-divider': {
    components: [
      ['voltage-source', 8, 12, 1, '12', 'VCC'],
      ['resistor', 18, 9, 1, '40000', 'R1'],
      ['resistor', 18, 16, 1, '10000', 'R2'],
      ['resistor', 25, 8, 1, '4000', 'RC'],
      ['resistor', 25, 18, 1, '1000', 'RE'],
      ['npn', 24, 13, 0, '100', 'Q1'],
    ],
    ground: [{ x: 14, y: 22 }, { x: 18, y: 19 }],
    wires: [
      [8, 10, 8, 6], [8, 6, 25, 6], [18, 6, 18, 7],
      [18, 11, 18, 13], [18, 13, 22, 13], [18, 13, 18, 14], [18, 18, 18, 19],
      [25, 10, 25, 11], [25, 15, 25, 16], [25, 20, 25, 22],
      [8, 14, 8, 22], [8, 22, 25, 22],
    ],
  },
};

export const EXAMPLE_IDS = Object.keys(SPECS) as ExampleId[];
export const EXAMPLE_MENU_IDS = EXAMPLE_IDS;

export function buildExample(id: ExampleMenuId): Schematic {
  const spec = SPECS[id];
  let schematic = EMPTY_SCHEMATIC;
  for (const [kind, x, y, rotation, value, label] of spec.components) {
    schematic = addComponent(schematic, kind, { x, y }, rotation, Fraction.from(value), label);
  }
  for (const [x1, y1, x2, y2] of spec.wires) {
    schematic = addWire(schematic, { x: x1, y: y1 }, { x: x2, y: y2 });
  }
  const grounds = Array.isArray(spec.ground) ? spec.ground : [spec.ground];
  return grounds.reduce((drawing, cell) => addGround(drawing, cell), schematic);
}
