import { beforeAll, describe, expect, it } from 'vitest';
import { analyze, solveWithSteps, voltageAt } from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { buildExample, EXAMPLE_IDS } from '../../src/ui/editor/examples';
import { occupiedBoxes } from '../../src/ui/editor/render';
import {
  connectionMarks,
  isComponent,
  terminalsOf,
  toCircuit,
  wiresUnderOpAmps,
  type ComponentItem,
  type Schematic,
  type WireItem,
} from '../../src/ui/editor/schematic';
import { parseSchematic, serializeSchematic } from '../../src/ui/editor/storage';

/**
 * The op-amp examples: their results, and how cleanly and readably each one is drawn.
 * Each row: id, menu name, expected output voltage, source values, resistor values.
 */
const CASES = [
  ['inverting-amplifier', 'Tersleyen yükselteç', '-5', ['1'], ['2000', '10000']],
  ['non-inverting-amplifier', 'Terslemeyen yükselteç', '6', ['3/2'], ['2000', '6000']],
  ['voltage-follower', 'Gerilim izleyici', '3', ['3'], ['2000']],
  ['summing-amplifier', 'Toplayıcı yükselteç', '-4', ['1', '1/2'], ['1000', '2000', '4000']],
  ['difference-amplifier', 'Fark yükselteci', '3', ['2', '5'], ['1000', '1000', '1000', '1000']],
] as const;

const OLD_IDS = ['voltage-divider', 'two-current-sources', 'mixed-sources', 'supernode'];

type AnyId = Parameters<typeof buildExample>[0];
const build = (id: string): Schematic => buildExample(id as AnyId);
const components = (schematic: Schematic): ComponentItem[] => schematic.items.filter(isComponent);
const wires = (schematic: Schematic): WireItem[] =>
  schematic.items.filter((item): item is WireItem => item.kind === 'wire');
const sorted = (values: readonly string[]): string[] => [...values].sort();

const overlapArea = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

describe('the examples menu', () => {
  it('keeps the old examples first, in their order, and adds the five op-amp examples after them', () => {
    // Task 13 added the diode example at the end, task 14 the Zener and LED examples after it,
    // task 22 the two transistor examples after those.
    expect(EXAMPLE_IDS).toEqual([
      ...OLD_IDS,
      ...CASES.map(([id]) => id),
      'diode-series',
      'zener-regulator',
      'led-series',
      'bjt-fixed-bias',
      'bjt-voltage-divider',
    ]);
  });

  it.each(CASES)('names %s as in the course notes', (id, name) => {
    expect((tr.examples as Record<string, string>)[id]).toBe(name);
  });
});

describe.each(CASES)('%s', (id, _name, expected, sourceValues, resistorValues) => {
  let schematic: Schematic;
  let opAmps: ComponentItem[];
  beforeAll(() => {
    schematic = build(id);
    opAmps = components(schematic).filter((item) => item.kind === 'op-amp');
  });

  it('has exactly one op-amp, and the specified sources and resistors', () => {
    expect(opAmps).toHaveLength(1);
    const values = (kind: string): string[] =>
      sorted(components(schematic).filter((item) => item.kind === kind).map((item) => item.value.toString()));
    expect(values('voltage-source')).toEqual(sorted(sourceValues));
    expect(values('resistor')).toEqual(sorted(resistorValues));
    expect(components(schematic).every((item) => ['op-amp', 'voltage-source', 'resistor'].includes(item.kind))).toBe(true);
    expect(schematic.items.some((item) => item.kind === 'ground')).toBe(true);
  });

  it(`solves with no errors or warnings, and the output is ${expected} V`, () => {
    const analysis = analyze(toCircuit(schematic));
    if (analysis.status !== 'solved') throw new Error(analysis.issues.map((issue) => issue.code).join(', '));
    expect(analysis.issues).toEqual([]);
    const output = terminalsOf(opAmps[0]!)[2]!;
    expect(voltageAt(analysis, `${output.x},${output.y}`)?.toString()).toBe(expected);
  });

  it('opens in Learn mode with the op-amp step', () => {
    const solution = solveWithSteps(toCircuit(schematic));
    if (solution.status !== 'solved') throw new Error('not solved');
    expect(solution.steps.map((step) => step.type)).toContain('op-amp');
  });

  it('is drawn cleanly: straight wires, unique ids, nothing under the op-amp, no loose ends', () => {
    for (const wire of wires(schematic)) {
      expect(wire.x1 === wire.x2 || wire.y1 === wire.y2, `diagonal ${wire.id}`).toBe(true);
      expect(wire.x1 === wire.x2 && wire.y1 === wire.y2, `empty ${wire.id}`).toBe(false);
    }
    const ids = schematic.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(wiresUnderOpAmps(schematic)).toBe(0);
    const loose = connectionMarks(schematic).filter(({ connections }) => connections === 1);
    expect(loose.map(({ cell }) => `${cell.x},${cell.y}`)).toEqual([]);
  });

  it('has no two wires lying on top of each other', () => {
    const all = wires(schematic);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        const sameLine =
          (a.y1 === a.y2 && b.y1 === b.y2 && a.y1 === b.y1) || (a.x1 === a.x2 && b.x1 === b.x2 && a.x1 === b.x1);
        if (!sameLine) continue;
        const horizontal = a.y1 === a.y2;
        const [a1, a2] = horizontal ? [Math.min(a.x1, a.x2), Math.max(a.x1, a.x2)] : [Math.min(a.y1, a.y2), Math.max(a.y1, a.y2)];
        const [b1, b2] = horizontal ? [Math.min(b.x1, b.x2), Math.max(b.x1, b.x2)] : [Math.min(b.y1, b.y2), Math.max(b.y1, b.y2)];
        expect(Math.min(a2, b2) - Math.max(a1, b1), `${a.id} and ${b.id} overlap`).toBeLessThanOrEqual(0);
      }
    }
  });

  it('has no element drawn over another, and no wire running through an element', () => {
    const bodies = components(schematic).map((item) => ({ item, box: occupiedBoxes({ ...schematic, items: [item] })[0]! }));
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        expect(overlapArea(bodies[i]!.box, bodies[j]!.box), `${bodies[i]!.item.label} / ${bodies[j]!.item.label}`).toBe(0);
      }
    }
    for (const item of components(schematic).filter((component) => component.kind !== 'op-amp')) {
      for (const wire of wires(schematic)) {
        const covers =
          item.x >= Math.min(wire.x1, wire.x2) && item.x <= Math.max(wire.x1, wire.x2) &&
          item.y >= Math.min(wire.y1, wire.y2) && item.y <= Math.max(wire.y1, wire.y2);
        expect(covers, `${wire.id} runs through ${item.label}`).toBe(false);
      }
    }
  });

  it('reads easily: no wire runs through the name or value of an element', () => {
    const segments = wires(schematic).map((wire) => ({
      id: wire.id,
      left: Math.min(wire.x1, wire.x2) * 20,
      right: Math.max(wire.x1, wire.x2) * 20,
      top: Math.min(wire.y1, wire.y2) * 20,
      bottom: Math.max(wire.y1, wire.y2) * 20,
    }));
    for (const item of components(schematic)) {
      const label = occupiedBoxes({ ...schematic, items: [item] })[1]!;
      for (const wire of segments) {
        const crosses =
          wire.right > label.left && wire.left < label.right && wire.bottom > label.top && wire.top < label.bottom;
        expect(crosses, `${wire.id} runs through the text of ${item.label}`).toBe(false);
      }
    }
  });

  it('reads easily: no two wires cross each other', () => {
    const all = wires(schematic);
    for (const a of all.filter((wire) => wire.y1 === wire.y2)) {
      for (const b of all.filter((wire) => wire.x1 === wire.x2)) {
        const x = b.x1;
        const y = a.y1;
        const crosses =
          x > Math.min(a.x1, a.x2) && x < Math.max(a.x1, a.x2) && y > Math.min(b.y1, b.y2) && y < Math.max(b.y1, b.y2);
        expect(crosses, `${a.id} crosses ${b.id} at (${x}, ${y})`).toBe(false);
      }
    }
  });

  it('saves and opens again unchanged', () => {
    expect(parseSchematic(serializeSchematic(schematic))).toEqual(schematic);
  });
});
