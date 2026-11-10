import { describe, expect, it } from 'vitest';
import { analyze, Fraction, solveWithSteps, voltageAt } from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { drawSchematic, occupiedBoxes } from '../../src/ui/editor/render';
import {
  addComponent,
  addGround,
  addWire,
  COMPONENT_KINDS,
  EMPTY_SCHEMATIC,
  insertIntoWire,
  setItemValue,
  terminalsOf,
  toCircuit,
  type ComponentItem,
  type Schematic,
} from '../../src/ui/editor/schematic';
import { parseSchematic, serializeSchematic } from '../../src/ui/editor/storage';
import { electricalSignature, moveWithWires, removeWithWires } from '../../src/ui/editor/wire-follow';
import { DEFAULT_BINDINGS } from '../../src/ui/shortcuts';

/** The voltage point: the book's "1 V" written at a wire end. */

const KIND = 'voltage-point' as ComponentItem['kind'];

function point(schematic: Schematic, x: number, y: number, volts: string): { schematic: Schematic; id: string } {
  const next = addComponent(schematic, KIND, { x, y });
  const item = next.items.at(-1) as ComponentItem;
  return { schematic: setItemValue(next, item.id, Fraction.from(volts)), id: item.id };
}

function solved(schematic: Schematic) {
  const result = analyze(toCircuit(schematic));
  if (result.status !== 'solved') throw new Error(result.issues.map((issue) => issue.code).join(', '));
  return result;
}

/** A 5 V point, then 1 kΩ and 3 kΩ in series to ground: the middle sits at 3,75 V. */
function divider(): { schematic: Schematic; id: string } {
  const p = point(EMPTY_SCHEMATIC, 4, 4, '5');
  let schematic = addComponent(p.schematic, 'resistor', { x: 8, y: 4 }, 0, Fraction.from(1000)); // (6,4)-(10,4)
  schematic = addComponent(schematic, 'resistor', { x: 12, y: 6 }, 1, Fraction.from(3000)); // (12,4)-(12,8)
  schematic = addWire(schematic, { x: 4, y: 4 }, { x: 6, y: 4 });
  schematic = addWire(schematic, { x: 10, y: 4 }, { x: 12, y: 4 });
  schematic = addGround(schematic, { x: 12, y: 8 });
  return { schematic, id: p.id };
}

describe('the voltage point as an element', () => {
  it('is a component kind with one terminal, at its own cell', () => {
    expect(COMPONENT_KINDS).toContain(KIND);
    const { schematic, id } = divider();
    const item = schematic.items.find((candidate) => candidate.id === id) as ComponentItem;
    expect(terminalsOf(item)).toEqual([{ x: 4, y: 4 }]);
  });

  it('is named "Gerilim noktası", starts at 5 V, and has its own key', () => {
    expect((tr.tools as unknown as Record<string, string>)[KIND]).toBe('Gerilim noktası');
    const fresh = addComponent(EMPTY_SCHEMATIC, KIND, { x: 0, y: 0 }).items[0] as ComponentItem;
    expect(fresh.value.toString()).toBe('5');
    expect((DEFAULT_BINDINGS as Record<string, string | null>)[KIND]).toBe('N');
    const keys = Object.values(DEFAULT_BINDINGS).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('solving with voltage points', () => {
  it('holds its node at its value, measured from ground, with no source or ground drawn for it', () => {
    const result = solved(divider().schematic);
    expect(result.issues).toEqual([]);
    expect(voltageAt(result, '4,4')?.toString()).toBe('5');
    expect(voltageAt(result, '12,4')?.toString()).toBe('15/4');
  });

  it('can be negative', () => {
    const { schematic, id } = divider();
    const result = solved(setItemValue(schematic, id, Fraction.from(-2)));
    expect(voltageAt(result, '12,4')?.toString()).toBe('-3/2');
  });

  it('needs no ground drawn: its ground is implied, as in the book', () => {
    // A 5 V point and a 2 V point with 1 kΩ between them: 3 mA flows from the 5 V side.
    const first = point(EMPTY_SCHEMATIC, 0, 0, '5');
    const second = point(first.schematic, 8, 0, '2');
    let schematic = addComponent(second.schematic, 'resistor', { x: 4, y: 0 }, 0, Fraction.from(1000)); // (2,0)-(6,0)
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 2, y: 0 });
    schematic = addWire(schematic, { x: 6, y: 0 }, { x: 8, y: 0 });
    const result = solved(schematic);
    expect(result.issues).toEqual([]);
    const resistor = schematic.items.find((item) => item.kind === 'resistor')!;
    expect(result.elements.get(resistor.id)?.current?.toString()).toBe('3/1000');
  });

  it('solves the two op-amp question drawn as in the book: Vo = 6 V', () => {
    // A1: − input V1, + input at a 1 V point. A2: − input V2, + input at a 2 V point.
    let s = addComponent(EMPTY_SCHEMATIC, 'op-amp', { x: 21, y: 8 }); // − (19,7), + (19,9), out (23,8)
    s = addComponent(s, 'op-amp', { x: 34, y: 8 }); // − (32,7), + (32,9), out (36,8)
    const resistors: readonly (readonly [number, number, number])[] = [
      [12, 7, 2000], // V1 to ground: (10,7)-(14,7)
      [21, 3, 2000], // A1 feedback: (19,3)-(23,3)
      [28, 8, 2000], // Vo1 to V2: (26,8)-(30,8)
      [24, -1, 1000], // V1 to V2: (22,-1)-(26,-1)
      [35, -1, 2000], // V2 to Vo: (33,-1)-(37,-1)
    ];
    for (const [x, y, ohms] of resistors) s = addComponent(s, 'resistor', { x, y }, 0, Fraction.from(ohms));
    const wires: readonly (readonly [number, number, number, number])[] = [
      [10, 7, 8, 7], [8, 7, 8, 9], [14, 7, 19, 7], [16, 7, 16, 3], [16, 3, 19, 3],
      [23, 3, 25, 3], [25, 3, 25, 8], [23, 8, 26, 8], [30, 8, 30, -1], [22, -1, 16, -1], [16, -1, 16, 3],
      [30, -1, 26, -1], [30, -1, 33, -1], [37, -1, 39, -1], [39, -1, 39, 8], [36, 8, 39, 8], [32, 7, 30, 7],
      [19, 9, 17, 9], [32, 9, 30, 9],
    ];
    for (const [x1, y1, x2, y2] of wires) s = addWire(s, { x: x1, y: y1 }, { x: x2, y: y2 });
    s = addGround(s, { x: 8, y: 9 });
    s = point(s, 17, 9, '1').schematic;
    s = point(s, 30, 9, '2').schematic;
    const result = solved(s);
    expect(result.issues).toEqual([]);
    expect(voltageAt(result, '19,7')?.toString()).toBe('1');
    expect(voltageAt(result, '23,8')?.toString()).toBe('0');
    expect(voltageAt(result, '36,8')?.toString()).toBe('6');
  });

  it('opens in Learn mode, where its node counts as a known voltage', () => {
    const solution = solveWithSteps(toCircuit(divider().schematic));
    if (solution.status !== 'solved') throw new Error('not solved');
    expect(solution.steps.map((step) => step.type)).toContain('known-voltages');
  });
});

describe('editing with voltage points', () => {
  it('connects to a wire it is dropped on, without cutting the wire open', () => {
    const wired = addWire(EMPTY_SCHEMATIC, { x: 0, y: 5 }, { x: 10, y: 5 });
    const item = addComponent(wired, KIND, { x: 4, y: 5 }).items.at(-1) as ComponentItem;
    expect(insertIntoWire(wired, item).status).toBe('none');
  });

  it('drags its wire along when moved, keeping the circuit', () => {
    const { schematic, id } = divider();
    const moved = moveWithWires(schematic, id, 0, -3);
    if (moved.status !== 'moved') throw new Error('blocked');
    expect(electricalSignature(moved.schematic)).toBe(electricalSignature(schematic));
    expect(voltageAt(solved(moved.schematic), '12,4')?.toString()).toBe('15/4');
  });

  it('leaves its wire in place when deleted', () => {
    const { schematic, id } = divider();
    const after = removeWithWires(schematic, id);
    expect(after.items.map((item) => item.id)).toEqual(
      schematic.items.filter((item) => item.id !== id).map((item) => item.id),
    );
  });

  it.each([0, 1, 2, 3] as const)(
    'in rotation %i, keeps its symbol and text on the side away from its wire',
    (rotation) => {
      // Rotation 0: the wire comes in from the right, the stub goes left to a small circle, the text is beyond it.
      // Each further rotation turns this a quarter clockwise, as for every other element.
      const placed = addComponent(EMPTY_SCHEMATIC, KIND, { x: 10, y: 10 }, rotation);
      const item = placed.items[0] as ComponentItem;
      const boxes = occupiedBoxes(placed);
      expect(boxes.length).toBeGreaterThan(0);
      // The cell next to the terminal on the wire side must stay free for the wire.
      const wireSide = [
        { x: 11, y: 10 },
        { x: 10, y: 11 },
        { x: 9, y: 10 },
        { x: 10, y: 9 },
      ][rotation]!;
      const px = { x: wireSide.x * 20, y: wireSide.y * 20 };
      for (const box of boxes) {
        const covers = px.x > box.left && px.x < box.right && px.y > box.top && px.y < box.bottom;
        expect(covers, `${item.kind} rotation ${rotation} covers its wire side`).toBe(false);
      }
      // Nor may its click area reach there, or it would take clicks meant for the wire or the next element.
      const svg = drawSchematic(placed, { selectedId: null, highlights: new Map(), solved: null });
      const hit = /class="hit" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(svg);
      expect(hit, 'a click area is drawn').not.toBeNull();
      const [, hx, , width] = hit!.map(Number);
      // In the symbol's own frame (rotation 0) the wire side is +x: the click area must stop before x = 10.
      expect(hx! + width!, 'click area reaches the wire side').toBeLessThanOrEqual(10);
    },
  );

  it('is drawn with its value, takes up space, and saves and opens again unchanged', () => {
    const { schematic, id } = divider();
    const svg = drawSchematic(schematic, { selectedId: null, highlights: new Map(), solved: null });
    expect(svg).toContain('5 V');
    const item = schematic.items.find((candidate) => candidate.id === id)!;
    expect(occupiedBoxes({ ...schematic, items: [item] }).length).toBeGreaterThan(0);
    expect(parseSchematic(serializeSchematic(schematic))).toEqual(schematic);
  });
});
