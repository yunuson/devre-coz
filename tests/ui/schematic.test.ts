import { describe, expect, it } from 'vitest';
import { analyze, Fraction, voltageAt } from '../../src/core';
import { buildExample, EXAMPLE_IDS, type ExampleId } from '../../src/ui/editor/examples';
import { drawSchematic, occupiedBoxes, placeNodeLabels } from '../../src/ui/editor/render';
import {
  addComponent,
  addGround,
  addWire,
  connectionMarks,
  EMPTY_SCHEMATIC,
  hasSameStructure,
  insertIntoWire,
  labelProblem,
  MAX_LABEL_LENGTH,
  moveItem,
  removeItem,
  rotateItem,
  setItemLabel,
  setItemValue,
  terminalsOf,
  toCircuit,
  wireRoute,
  type ComponentItem,
  type ComponentKind,
  type Rotation,
  type Schematic,
} from '../../src/ui/editor/schematic';

function solved(schematic: Schematic) {
  const result = analyze(toCircuit(schematic));
  if (result.status !== 'solved') {
    throw new Error(`Not solved: ${result.issues.map((issue) => issue.code).join(', ')}`);
  }
  return result;
}

const voltage = (schematic: Schematic, x: number, y: number): string | undefined =>
  voltageAt(solved(schematic), `${x},${y}`)?.toString();

describe('built-in examples', () => {
  const expected: Record<ExampleId, [x: number, y: number, volts: string][]> = {
    'voltage-divider': [
      [8, 8, '10'],
      [22, 8, '6'],
    ],
    'two-current-sources': [
      [6, 8, '22/3'],
      [34, 8, '7'],
    ],
    'mixed-sources': [
      [6, 8, '10'],
      [30, 8, '25/3'],
    ],
    supernode: [
      [6, 8, '-4/3'],
      [27, 8, '14/3'],
    ],
    'inverting-amplifier': [
      [26, 12, '-5'],
      [22, 11, '0'],
    ],
    'non-inverting-amplifier': [
      [32, 12, '6'],
      [28, 13, '3/2'],
    ],
    'voltage-follower': [
      [26, 12, '3'],
      [22, 13, '3'],
    ],
    'summing-amplifier': [
      [32, 12, '-4'],
      [28, 11, '0'],
    ],
    'difference-amplifier': [
      [32, 12, '3'],
      [28, 13, '5/2'],
    ],
    // 12 V less the diode's 0,7 V.
    'diode-series': [
      [8, 8, '12'],
      [22, 8, '113/10'],
    ],
    // 15 V through 1 kΩ supplies a 10 V Zener and a 3 kΩ load in parallel.
    'zener-regulator': [
      [8, 10, '15'],
      [22, 10, '10'],
    ],
    // The 5 V source loses 2 V across the LED, leaving 3 V at the resistor.
    'led-series': [
      [8, 10, '5'],
      [22, 10, '3'],
    ],
    // The transistor examples are measured at the transistor's own terminals, wherever it is drawn:
    // see bjt-drawing.test.ts. Here they only have to solve without issues.
    'bjt-fixed-bias': [],
    'bjt-voltage-divider': [],
  };

  it.each(EXAMPLE_IDS)('%s solves to the hand-calculated voltages', (id) => {
    const result = solved(buildExample(id));
    expect(result.issues).toEqual([]);
    for (const [x, y, volts] of expected[id]) {
      expect(voltageAt(result, `${x},${y}`)?.toString()).toBe(volts);
    }
  });
});

describe('node labels', () => {
  it.each(EXAMPLE_IDS)('%s: labels overlap nothing and each other', (id) => {
    const schematic = buildExample(id);
    const labels = placeNodeLabels(schematic, solved(schematic));
    expect(labels.length).toBeGreaterThan(0);
    const boxes = [...occupiedBoxes(schematic)];
    for (const { box, text } of labels) {
      for (const other of boxes) {
        const separate =
          box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom;
        expect(separate, `${text} overlaps ${JSON.stringify(other)}`).toBe(true);
      }
      boxes.push(box);
    }
  });

  it('moves a label away from a neighbouring current readout', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'voltage-source', { x: 8, y: 10 }, 1);
    schematic = addComponent(schematic, 'resistor', { x: 14, y: 6 });
    schematic = addComponent(schematic, 'resistor', { x: 20, y: 10 }, 1);
    schematic = addGround(schematic, { x: 14, y: 14 });
    schematic = addWire(schematic, { x: 8, y: 8 }, { x: 12, y: 6 });
    schematic = addWire(schematic, { x: 16, y: 6 }, { x: 20, y: 8 });
    schematic = addWire(schematic, { x: 8, y: 12 }, { x: 14, y: 14 });
    schematic = addWire(schematic, { x: 20, y: 12 }, { x: 14, y: 14 });
    const labels = placeNodeLabels(schematic, solved(schematic));
    const boxes = occupiedBoxes(schematic);
    for (const { box } of labels) {
      for (const other of boxes) {
        expect(
          box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom,
        ).toBe(true);
      }
    }
  });
});

describe('insertIntoWire', () => {
  const component = (x: number, y: number, rotation: Rotation = 0, kind: ComponentKind = 'resistor'): ComponentItem => ({
    kind,
    id: 'new',
    label: 'Rx',
    x,
    y,
    rotation,
    value: Fraction.from(1000),
  });
  const horizontal = addWire(EMPTY_SCHEMATIC, { x: 0, y: 0 }, { x: 10, y: 0 });
  const wires = (schematic: Schematic): [number, number, number, number][] =>
    schematic.items.flatMap((item) => (item.kind === 'wire' ? [[item.x1, item.y1, item.x2, item.y2]] : [])) as [
      number,
      number,
      number,
      number,
    ][];

  it('leaves an element alone when its center is off the wire', () => {
    expect(insertIntoWire(horizontal, component(5, 3))).toEqual({ status: 'none' });
    expect(insertIntoWire(horizontal, component(12, 0))).toEqual({ status: 'none' });
  });

  it('opens the wire where the element sits', () => {
    const result = insertIntoWire(horizontal, component(5, 0));
    if (result.status !== 'inserted') throw new Error(result.status);
    expect(wires(result.schematic)).toEqual([
      [0, 0, 3, 0],
      [7, 0, 10, 0],
    ]);
    expect(result.item.rotation).toBe(0);
  });

  it('gives each wire piece its own id', () => {
    const result = insertIntoWire(horizontal, component(5, 0));
    if (result.status !== 'inserted') throw new Error(result.status);
    const ids = result.schematic.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.schematic.nextId).toBe(horizontal.nextId + 1);
  });

  it('works on a wire drawn in the opposite direction', () => {
    const reversed = addWire(EMPTY_SCHEMATIC, { x: 10, y: 0 }, { x: 0, y: 0 });
    const result = insertIntoWire(reversed, component(5, 0));
    if (result.status !== 'inserted') throw new Error(result.status);
    expect(wires(result.schematic)).toEqual([
      [10, 0, 7, 0],
      [3, 0, 0, 0],
    ]);
  });

  it('removes the wire when the element fills it exactly', () => {
    const exact = addWire(EMPTY_SCHEMATIC, { x: 0, y: 0 }, { x: 4, y: 0 });
    const result = insertIntoWire(exact, component(2, 0));
    if (result.status !== 'inserted') throw new Error(result.status);
    expect(wires(result.schematic)).toEqual([]);
  });

  it('keeps one piece when the element reaches one end', () => {
    const result = insertIntoWire(horizontal, component(2, 0));
    if (result.status !== 'inserted') throw new Error(result.status);
    expect(wires(result.schematic)).toEqual([[4, 0, 10, 0]]);
  });

  it('turns an element arriving across the wire', () => {
    const across = insertIntoWire(horizontal, component(5, 0, 1, 'voltage-source'));
    if (across.status !== 'inserted') throw new Error(across.status);
    expect(across.item.rotation % 2).toBe(0);

    const vertical = addWire(EMPTY_SCHEMATIC, { x: 0, y: 0 }, { x: 0, y: 10 });
    const upright = insertIntoWire(vertical, component(0, 5, 0));
    if (upright.status !== 'inserted') throw new Error(upright.status);
    expect(upright.item.rotation % 2).toBe(1);
  });

  it('keeps a rotation that already follows the wire', () => {
    const result = insertIntoWire(horizontal, component(5, 0, 2));
    if (result.status !== 'inserted') throw new Error(result.status);
    expect(result.item.rotation).toBe(2);
  });

  it('refuses a wire that is too short', () => {
    const short = addWire(EMPTY_SCHEMATIC, { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(insertIntoWire(short, component(1, 0))).toMatchObject({ status: 'blocked', reason: 'too-short' });
    expect(insertIntoWire(horizontal, component(1, 0))).toMatchObject({ status: 'blocked', reason: 'too-short' });
  });

  it('refuses a spot with a branch under the body', () => {
    const branched = addWire(horizontal, { x: 5, y: 0 }, { x: 5, y: 3 });
    expect(insertIntoWire(branched, component(5, 0))).toMatchObject({ status: 'blocked', reason: 'occupied' });
    const grounded = addGround(horizontal, { x: 4, y: 0 });
    expect(insertIntoWire(grounded, component(5, 0))).toMatchObject({ status: 'blocked', reason: 'occupied' });
  });

  it('refuses when another wire crosses the body or a terminal', () => {
    const crossingBody = addWire(horizontal, { x: 5, y: -3 }, { x: 5, y: 3 });
    expect(insertIntoWire(crossingBody, component(5, 0))).toMatchObject({ status: 'blocked', reason: 'occupied' });
    const crossingTerminal = addWire(horizontal, { x: 3, y: -3 }, { x: 3, y: 3 });
    expect(insertIntoWire(crossingTerminal, component(5, 0))).toMatchObject({ status: 'blocked', reason: 'occupied' });
  });

  it('accepts a branch that meets exactly at a terminal, which stays connected', () => {
    const branched = addWire(horizontal, { x: 3, y: 0 }, { x: 3, y: 3 });
    expect(insertIntoWire(branched, component(5, 0)).status).toBe('inserted');
  });

  it('puts the element in series in a real circuit', () => {
    // A source closed through one wire and a resistor, with a second resistor dropped on the wire.
    let circuit = addComponent(EMPTY_SCHEMATIC, 'voltage-source', { x: 0, y: 2 }, 1, Fraction.from(10));
    circuit = addComponent(circuit, 'resistor', { x: 12, y: 2 }, 1, Fraction.from(1000));
    circuit = addWire(circuit, { x: 0, y: 0 }, { x: 12, y: 0 });
    circuit = addWire(circuit, { x: 0, y: 4 }, { x: 12, y: 4 });
    circuit = addGround(circuit, { x: 6, y: 4 });
    expect(voltage(circuit, 12, 0)).toBe('10');

    const result = insertIntoWire(circuit, { ...component(6, 0), value: Fraction.from(3000) });
    if (result.status !== 'inserted') throw new Error(result.status);
    expect(voltage(result.schematic, 12, 0)).toBe('5/2');
    expect(voltage(result.schematic, 0, 0)).toBe('10');
  });
});

describe('hasSameStructure', () => {
  const base = buildExample('voltage-divider');

  it('ignores names and values', () => {
    const edited = setItemValue(setItemLabel(base, 'e2', 'Rf'), 'e2', Fraction.from(5));
    expect(hasSameStructure(base, edited)).toBe(true);
  });

  it('notices moved, rotated, added and removed elements', () => {
    expect(hasSameStructure(base, moveItem(base, 'e2', 1, 0))).toBe(false);
    expect(hasSameStructure(base, rotateItem(base, 'e2'))).toBe(false);
    expect(hasSameStructure(base, addGround(base, { x: 1, y: 1 }))).toBe(false);
    expect(hasSameStructure(base, removeItem(base, 'e2'))).toBe(false);
  });
});

describe('element names', () => {
  let named = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 0, y: 0 });
  named = addComponent(named, 'resistor', { x: 5, y: 0 });

  it('accepts a free name and trims it', () => {
    expect(labelProblem(named, 'e1', '  Rf  ')).toBeNull();
    expect((setItemLabel(named, 'e1', '  Rf  ').items[0] as ComponentItem).label).toBe('Rf');
  });

  it('lets an element keep its own name', () => {
    expect(labelProblem(named, 'e1', 'R1')).toBeNull();
  });

  it('rejects empty, overlong and taken names', () => {
    expect(labelProblem(named, 'e1', '   ')).toBe('empty');
    expect(labelProblem(named, 'e1', 'x'.repeat(MAX_LABEL_LENGTH + 1))).toBe('too-long');
    expect(labelProblem(named, 'e1', 'R2')).toBe('taken');
    expect(labelProblem(named, 'e1', 'r2')).toBe('taken');
  });

  it('gives the next new element a free number after a rename', () => {
    const renamed = setItemLabel(named, 'e1', 'Rf');
    const next = addComponent(renamed, 'resistor', { x: 10, y: 0 });
    expect((next.items[2] as ComponentItem).label).toBe('R1');
  });

  it('does not change the solution', () => {
    const example = buildExample('voltage-divider');
    const renamed = setItemLabel(example, 'e2', 'Rload');
    expect(voltage(renamed, 22, 8)).toBe('6');
  });

  it('escapes a name when drawing it', () => {
    const renamed = setItemLabel(named, 'e1', '<img src=x>');
    const markup = drawSchematic(renamed, { selectedId: null, highlights: new Map(), solved: null });
    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;img src=x&gt;');
  });
});

describe('labels and terminals', () => {
  it('numbers each kind on its own and reuses free numbers', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 0, y: 0 });
    schematic = addComponent(schematic, 'voltage-source', { x: 5, y: 0 });
    schematic = addComponent(schematic, 'resistor', { x: 10, y: 0 });
    const labels = schematic.items.map((item) => (item as ComponentItem).label);
    expect(labels).toEqual(['R1', 'V1', 'R2']);
  });

  it('rotates in 90 degree steps around the center and returns after four', () => {
    const position = { x: 10, y: 10 };
    expect(terminalsOf({ ...position, rotation: 0 })).toEqual([{ x: 8, y: 10 }, { x: 12, y: 10 }]);
    expect(terminalsOf({ ...position, rotation: 1 })).toEqual([{ x: 10, y: 8 }, { x: 10, y: 12 }]);
    expect(terminalsOf({ ...position, rotation: 2 })).toEqual([{ x: 12, y: 10 }, { x: 8, y: 10 }]);
    expect(terminalsOf({ ...position, rotation: 3 })).toEqual([{ x: 10, y: 12 }, { x: 10, y: 8 }]);

    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', position);
    for (let i = 0; i < 4; i++) schematic = rotateItem(schematic, 'e1');
    expect((schematic.items[0] as ComponentItem).rotation).toBe(0);
  });

  it('moves components and whole wires', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 1, y: 1 });
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 4, y: 0 });
    schematic = moveItem(schematic, 'e1', 2, 3);
    schematic = moveItem(schematic, 'e2', 1, 1);
    expect(schematic.items[0]).toMatchObject({ x: 3, y: 4 });
    expect(schematic.items[1]).toMatchObject({ x1: 1, y1: 1, x2: 5, y2: 1 });
  });
});

describe('wires', () => {
  it('routes horizontally first and skips empty pieces', () => {
    expect(wireRoute({ x: 0, y: 0 }, { x: 3, y: 2 })).toEqual([
      { from: { x: 0, y: 0 }, to: { x: 3, y: 0 } },
      { from: { x: 3, y: 0 }, to: { x: 3, y: 2 } },
    ]);
    expect(wireRoute({ x: 0, y: 0 }, { x: 3, y: 0 })).toHaveLength(1);
    expect(wireRoute({ x: 1, y: 1 }, { x: 1, y: 1 })).toHaveLength(0);
  });

  it('connects a wire end that lands on the middle of another wire', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'voltage-source', { x: 0, y: 2 }, 1);
    schematic = addComponent(schematic, 'resistor', { x: 10, y: 2 }, 1);
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 10, y: 0 });
    schematic = addWire(schematic, { x: 5, y: 0 }, { x: 5, y: -3 });
    schematic = addWire(schematic, { x: 0, y: 4 }, { x: 10, y: 4 });
    schematic = addGround(schematic, { x: 5, y: 4 });
    expect(voltage(schematic, 5, -3)).toBe('10');
  });

  it('connects a component terminal that sits on the middle of a wire', () => {
    let schematic = addWire(EMPTY_SCHEMATIC, { x: 0, y: 0 }, { x: 10, y: 0 });
    schematic = addComponent(schematic, 'voltage-source', { x: 0, y: 2 }, 1, undefined);
    schematic = addComponent(schematic, 'resistor', { x: 5, y: 2 }, 1);
    schematic = addGround(schematic, { x: 0, y: 4 });
    schematic = addWire(schematic, { x: 0, y: 4 }, { x: 5, y: 4 });
    expect(voltage(schematic, 5, 0)).toBe('10');
    expect(solved(schematic).elements.get('e3')?.current?.toNumber()).toBeCloseTo(0.01);
  });

  it('does not connect wires that only cross', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'voltage-source', { x: 0, y: 2 }, 1);
    schematic = addComponent(schematic, 'resistor', { x: 10, y: 2 }, 1);
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 10, y: 0 });
    schematic = addWire(schematic, { x: 5, y: -5 }, { x: 5, y: 5 });
    schematic = addWire(schematic, { x: 0, y: 4 }, { x: 10, y: 4 });
    schematic = addGround(schematic, { x: 0, y: 4 });
    const result = analyze(toCircuit(schematic));
    expect(result.netlist.pointToNode.get('5,-5')).toBeUndefined();
  });

  it('keeps the drawn wire id on every split piece, so issues can point at it', () => {
    let schematic = addWire(EMPTY_SCHEMATIC, { x: 0, y: 0 }, { x: 10, y: 0 });
    schematic = addGround(schematic, { x: 5, y: 0 });
    const wires = toCircuit(schematic).elements.filter((element) => element.kind === 'wire');
    expect(wires).toHaveLength(2);
    expect(new Set(wires.map((element) => element.id))).toEqual(new Set(['e1']));
  });

  it('marks junctions and open ends', () => {
    let schematic = addWire(EMPTY_SCHEMATIC, { x: 0, y: 0 }, { x: 10, y: 0 });
    schematic = addWire(schematic, { x: 5, y: 0 }, { x: 5, y: 3 });
    const at = (x: number, y: number): number | undefined =>
      connectionMarks(schematic).find(({ cell }) => cell.x === x && cell.y === y)?.connections;
    expect(at(5, 0)).toBe(3);
    expect(at(0, 0)).toBe(1);
    expect(at(5, 3)).toBe(1);
  });
});
