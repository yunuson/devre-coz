import { describe, expect, it } from 'vitest';
import { analyze, Fraction } from '../../src/core';
import { buildExample, EXAMPLE_IDS } from '../../src/ui/editor/examples';
import {
  addComponent,
  addGround,
  addWire,
  EMPTY_SCHEMATIC,
  isComponent,
  toCircuit,
  type Schematic,
  type SchematicItem,
  type WireItem,
} from '../../src/ui/editor/schematic';
import {
  electricalSignature,
  flipItem,
  keepsConnections,
  landsOnSomething,
  moveWithWires,
  removeWithWires,
  rotateWithWires,
} from '../../src/ui/editor/wire-follow';

type Segment = [number, number, number, number];

const wires = (schematic: Schematic): WireItem[] =>
  schematic.items.filter((item): item is WireItem => item.kind === 'wire');

/** Direction-independent, sorted, so tests don't depend on how a wire was stored. */
const segments = (schematic: Schematic): Segment[] =>
  wires(schematic)
    .map((wire): Segment => {
      const forward = wire.x1 < wire.x2 || (wire.x1 === wire.x2 && wire.y1 <= wire.y2);
      return forward ? [wire.x1, wire.y1, wire.x2, wire.y2] : [wire.x2, wire.y2, wire.x1, wire.y1];
    })
    .sort((a, b) => a.join().localeCompare(b.join(), undefined, { numeric: true }));

function moved(schematic: Schematic, id: string, dx: number, dy: number): Schematic {
  const result = moveWithWires(schematic, id, dx, dy);
  if (result.status !== 'moved') throw new Error('Move was blocked');
  return result.schematic;
}

/** Where an element ends up. A moved wire may then merge with a neighbour, so it's worked out here. */
const shifted = (item: SchematicItem, dx: number, dy: number): SchematicItem =>
  item.kind === 'wire'
    ? { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy }
    : { ...item, x: item.x + dx, y: item.y + dy };

function expectCleanWires(schematic: Schematic): void {
  for (const wire of wires(schematic)) {
    expect(wire.x1 === wire.x2 || wire.y1 === wire.y2, `diagonal wire ${wire.id}`).toBe(true);
    expect(wire.x1 === wire.x2 && wire.y1 === wire.y2, `empty wire ${wire.id}`).toBe(false);
  }
  const ids = schematic.items.map((item) => item.id);
  expect(new Set(ids).size, 'duplicate ids').toBe(ids.length);
}

/** Two resistors in a row: a--R1--b wire c--R2--d. */
const inRow = (): Schematic => {
  let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 2, y: 0 }); // e1, terminals 0 and 4
  schematic = addComponent(schematic, 'resistor', { x: 12, y: 0 }); // e2, terminals 10 and 14
  return addWire(schematic, { x: 4, y: 0 }, { x: 10, y: 0 }); // e3
};

describe('a moved element keeps its wires', () => {
  it('stretches a wire along its own direction', () => {
    expect(segments(moved(inRow(), 'e2', 3, 0))).toEqual([[4, 0, 13, 0]]);
    expect(segments(moved(inRow(), 'e2', -3, 0))).toEqual([[4, 0, 7, 0]]);
  });

  it('bends at a right angle when moved sideways', () => {
    expect(segments(moved(inRow(), 'e2', 0, 5))).toEqual([
      [4, 0, 10, 0],
      [10, 0, 10, 5],
    ]);
  });

  it('removes a wire that shrinks to nothing', () => {
    expect(segments(moved(inRow(), 'e2', -6, 0))).toEqual([]);
  });

  it('slides a corner instead of adding bends', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 12, y: 2 }, 1); // e1, top at 12,0
    schematic = addWire(schematic, { x: 0, y: -4 }, { x: 12, y: -4 }); // e2
    schematic = addWire(schematic, { x: 12, y: -4 }, { x: 12, y: 0 }); // e3
    expect(wires(schematic)).toHaveLength(2);
    const result = moved(schematic, 'e1', 3, 0);
    expect(segments(result)).toEqual([
      [0, -4, 15, -4],
      [15, -4, 15, 0],
    ]);
  });

  it('keeps a junction in place and runs a new wire to the element', () => {
    let schematic = inRow();
    schematic = addWire(schematic, { x: 10, y: 0 }, { x: 10, y: 5 }); // Branch at R2's terminal.
    const signature = electricalSignature(schematic);
    const result = moved(schematic, 'e2', 2, 3);
    expect(segments(result)).toEqual([
      [4, 0, 10, 0],
      [10, 0, 10, 5],
      [10, 0, 12, 0],
      [12, 0, 12, 3],
    ]);
    expect(electricalSignature(result)).toBe(signature);
  });

  it('adds a wire when two terminals were touching directly', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 2, y: 0 });
    schematic = addComponent(schematic, 'resistor', { x: 6, y: 0 }); // Shares the cell 4,0.
    const signature = electricalSignature(schematic);
    const result = moved(schematic, 'e2', 3, 0);
    expect(segments(result)).toEqual([[4, 0, 7, 0]]);
    expect(electricalSignature(result)).toBe(signature);
  });

  it('leaves unconnected terminals alone', () => {
    const schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 2, y: 0 });
    expect(segments(moved(schematic, 'e1', 3, 3))).toEqual([]);
  });

  it('joins a straight run left in two pieces', () => {
    let schematic = inRow();
    schematic = moved(schematic, 'e2', 3, 0);
    expect(wires(schematic)).toHaveLength(1);
  });

  it('moves a ground with its wire', () => {
    let schematic = addGround(EMPTY_SCHEMATIC, { x: 5, y: 5 });
    schematic = addComponent(schematic, 'resistor', { x: 5, y: 2 }, 1); // Bottom at 5,4.
    schematic = addWire(schematic, { x: 5, y: 4 }, { x: 5, y: 5 });
    const result = moved(schematic, 'e1', 0, 3);
    expect(segments(result)).toEqual([[5, 4, 5, 8]]);
  });

  it('keeps a ground attached partway along a moved wire', () => {
    const schematic = buildExample('voltage-divider');
    const bottom = wires(schematic).find((wire) => wire.y1 === 16 && wire.y2 === 16)!;
    const before = electricalSignature(schematic);
    const result = moved(schematic, bottom.id, 0, -2);
    expect(electricalSignature(result)).toBe(before);
    const analysis = analyze(toCircuit(result));
    if (analysis.status !== 'solved') throw new Error(analysis.issues.map((issue) => issue.code).join());
    expect(analysis.elements.get('e2')?.current?.toString()).toBe('1/500');
  });

  it('keeps a branch attached partway along a moved wire', () => {
    const schematic = buildExample('two-current-sources');
    const top = wires(schematic).find((wire) => wire.y1 === 8 && wire.y2 === 8 && wire.x1 === 6)!;
    const before = electricalSignature(schematic);
    expect(electricalSignature(moved(schematic, top.id, 0, -3))).toBe(before);
  });

  it('stretches neighbours when a wire itself is moved', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 0, y: 6 }, 1); // Top at 0,4.
    schematic = addComponent(schematic, 'resistor', { x: 10, y: 6 }, 1); // Top at 10,4.
    schematic = addWire(schematic, { x: 0, y: 4 }, { x: 0, y: 0 }); // e3
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 10, y: 0 }); // e4, the one being moved.
    schematic = addWire(schematic, { x: 10, y: 0 }, { x: 10, y: 4 }); // e5
    const result = moved(schematic, 'e4', 0, -2);
    expect(segments(result)).toEqual([
      [0, -2, 0, 4],
      [0, -2, 10, -2],
      [10, -2, 10, 4],
    ]);
  });
});

describe('a rotated element keeps its wires', () => {
  it('reroutes both terminals and stays the same circuit', () => {
    const schematic = buildExample('voltage-divider');
    const signature = electricalSignature(schematic);
    const result = rotateWithWires(schematic, 'e2');
    if (result.status !== 'moved') throw new Error('blocked');
    expect(electricalSignature(result.schematic)).toBe(signature);
    expectCleanWires(result.schematic);
  });

  it.each(EXAMPLE_IDS)('%s: never changes the circuit, however often an element is turned', (id) => {
    const start = buildExample(id);
    const signature = electricalSignature(start);
    let turns = 0;
    for (const item of start.items.filter(isComponent)) {
      let schematic = start;
      for (let i = 0; i < 8; i++) {
        const result = rotateWithWires(schematic, item.id);
        if (result.status === 'blocked') break;
        turns++;
        schematic = result.schematic;
        expect(electricalSignature(schematic), `${item.id}, turn ${i + 1}`).toBe(signature);
        expectCleanWires(schematic);
      }
    }
    // Turning must actually get exercised. An op-amp in a tightly wired circuit often has no clean
    // route to turn into and is refused instead, which is fine: the circuit still never changes.
    const components = start.items.filter(isComponent);
    const hasOpAmp = components.some((item) => item.kind === 'op-amp');
    expect(turns).toBeGreaterThan(hasOpAmp ? 0 : components.length);
  });

  it('refuses a turn that would land a terminal on another wire', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 10, y: 10 }); // e1
    schematic = addWire(schematic, { x: 0, y: 8 }, { x: 20, y: 8 }); // e2, passes the top terminal's new spot.
    schematic = addWire(schematic, { x: 0, y: 12 }, { x: 20, y: 12 }); // e3, passes the bottom one.
    schematic = addComponent(schematic, 'resistor', { x: 0, y: 10 }, 1); // e4, joins the two wires.
    expect(rotateWithWires(schematic, 'e1').status).toBe('blocked');
  });

  it('keeps each terminal on its wire through a half turn, so the results do not change', () => {
    let schematic = buildExample('voltage-divider');
    const signature = electricalSignature(schematic);
    for (let i = 0; i < 2; i++) {
      const result = rotateWithWires(schematic, 'e1');
      if (result.status !== 'moved') throw new Error('blocked');
      schematic = result.schematic;
    }
    expect(electricalSignature(schematic)).toBe(signature);
    expectCleanWires(schematic);
    const analysis = analyze(toCircuit(schematic));
    if (analysis.status !== 'solved') throw new Error('not solved');
    expect(analysis.elements.get('e2')?.current?.toString()).toBe('1/500');
  });
});

describe('removeWithWires', () => {
  it('joins the two wires of a deleted element into one', () => {
    const schematic = buildExample('voltage-divider');
    const result = removeWithWires(schematic, 'e2'); // R1, on the top run.
    expect(result.items.some((item) => item.id === 'e2')).toBe(false);
    expect(segments(result)).toContainEqual([8, 8, 22, 8]);
    expect(wires(result).filter((wire) => wire.y1 === 8 && wire.y2 === 8)).toHaveLength(1);
    expectCleanWires(result);

    const analysis = analyze(toCircuit(result));
    if (analysis.status !== 'solved') throw new Error('not solved');
    expect(analysis.elements.get('e3')?.current?.toString()).toBe('1/300'); // 10 V across R2 alone.
  });

  it('leaves the ends open when one side has nothing connected', () => {
    const schematic = addWire(addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 2, y: 0 }), { x: 4, y: 0 }, { x: 8, y: 0 });
    expect(segments(removeWithWires(schematic, 'e1'))).toEqual([[4, 0, 8, 0]]);
  });

  it('does not short a parallel resistor', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 5, y: 0 }); // e1, terminals 3 and 7.
    schematic = addComponent(schematic, 'resistor', { x: 5, y: 4 }); // e2, parallel below it.
    schematic = addWire(schematic, { x: 3, y: 0 }, { x: 3, y: 4 });
    schematic = addWire(schematic, { x: 7, y: 0 }, { x: 7, y: 4 });
    const before = segments(schematic);
    expect(segments(removeWithWires(schematic, 'e1'))).toEqual(before);
  });

  it('does not short the only remaining source', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'voltage-source', { x: 0, y: 2 }, 1); // e1
    schematic = addComponent(schematic, 'resistor', { x: 6, y: 0 }); // e2, the one deleted.
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 4, y: 0 });
    schematic = addWire(schematic, { x: 8, y: 0 }, { x: 8, y: 4 });
    schematic = addWire(schematic, { x: 8, y: 4 }, { x: 0, y: 4 });
    const result = removeWithWires(schematic, 'e2');
    expect(wires(result)).toHaveLength(3);
    expect(electricalSignature(result)).toContain('e1');
  });

  it('deletes wires and grounds without adding anything', () => {
    const schematic = buildExample('voltage-divider');
    const wire = wires(schematic)[0]!;
    expect(wires(removeWithWires(schematic, wire.id))).toHaveLength(wires(schematic).length - 1);
    const ground = schematic.items.find((item) => item.kind === 'ground')!;
    expect(wires(removeWithWires(schematic, ground.id))).toHaveLength(wires(schematic).length);
  });

  it('gives every wire its own id', () => {
    expectCleanWires(removeWithWires(buildExample('mixed-sources'), 'e1'));
  });
});

describe('flipItem', () => {
  it('reverses a source and its current, leaving every wire alone', () => {
    const schematic = buildExample('voltage-divider');
    const flipped = flipItem(schematic, 'e1');
    expect(segments(flipped)).toEqual(segments(schematic));
    expect(electricalSignature(flipped)).not.toBe(electricalSignature(schematic));

    const analysis = analyze(toCircuit(flipped));
    if (analysis.status !== 'solved') throw new Error('not solved');
    expect(analysis.elements.get('e2')?.current?.toString()).toBe('-1/500');
  });

  it('returns to the start when done twice', () => {
    const schematic = buildExample('voltage-divider');
    expect(flipItem(flipItem(schematic, 'e1'), 'e1')).toEqual(schematic);
  });

  it('ignores wires and grounds', () => {
    const schematic = addGround(addWire(EMPTY_SCHEMATIC, { x: 0, y: 0 }, { x: 4, y: 0 }), { x: 9, y: 9 });
    expect(flipItem(flipItem(schematic, 'e1'), 'e2')).toEqual(schematic);
  });
});

describe('moves never change the circuit by accident', () => {
  it('refuses a move when every route would touch another connection', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 12, y: 0 }); // e1, left terminal at 10,0.
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 10, y: 0 }); // e2
    schematic = addComponent(schematic, 'resistor', { x: 22, y: 0 }); // e3, terminal where one bend would go.
    schematic = addComponent(schematic, 'resistor', { x: -2, y: 5 }); // e4, terminal where the other would.
    expect(moveWithWires(schematic, 'e1', 10, 5).status).toBe('blocked');
  });

  it('treats landing a terminal on something as a deliberate connection', () => {
    let schematic = inRow();
    schematic = addComponent(schematic, 'resistor', { x: 10, y: 8 }, 1); // e4, top at 10,6.
    const signature = electricalSignature(schematic);
    const result = moveWithWires(schematic, 'e2', 0, 6); // R2's left terminal lands on 10,6.
    if (result.status !== 'moved') throw new Error('blocked');
    expect(electricalSignature(result.schematic)).not.toBe(signature);
  });

  it('tries the other route around an obstacle', () => {
    let schematic = inRow();
    // A wire end sitting exactly where the first choice of bend would go.
    schematic = addWire(schematic, { x: 12, y: 0 }, { x: 12, y: -4 });
    const signature = electricalSignature(schematic);
    const result = moveWithWires(schematic, 'e1', 0, 3);
    if (result.status !== 'moved') throw new Error('blocked');
    expect(electricalSignature(result.schematic)).toBe(signature);
    expectCleanWires(result.schematic);
  });

  const offsets = [-7, -4, -2, -1, 0, 1, 2, 3, 5, 8];

  it.each(EXAMPLE_IDS)('%s: every element moved everywhere stays the same circuit', (id) => {
    const schematic = buildExample(id);
    const signature = electricalSignature(schematic);
    const before = analyze(toCircuit(schematic));
    if (before.status !== 'solved') throw new Error('not solved');
    let movedCount = 0;

    for (const item of schematic.items) {
      for (const dx of offsets) {
        for (const dy of offsets) {
          if (dx === 0 && dy === 0) continue;
          const result = moveWithWires(schematic, item.id, dx, dy);
          if (result.status === 'blocked') continue;
          movedCount++;
          expectCleanWires(result.schematic);

          // Dropping onto something may add connections, but must never lose any.
          expect(keepsConnections(schematic, result.schematic), `${item.id} by ${dx},${dy}`).toBe(true);
          if (landsOnSomething(schematic, item, shifted(item, dx, dy))) continue;

          expect(electricalSignature(result.schematic), `${item.id} by ${dx},${dy}`).toBe(signature);
          const solved = analyze(toCircuit(result.schematic));
          if (solved.status !== 'solved') throw new Error(`${item.id} by ${dx},${dy}: not solved`);
          for (const [elementId, values] of before.elements) {
            expect(solved.elements.get(elementId)?.current?.toString()).toBe(values.current?.toString());
          }
        }
      }
    }
    expect(movedCount).toBeGreaterThan(schematic.items.length * 50);
  }, 30_000);

  it.each(EXAMPLE_IDS)('%s: chains of moves stay the same circuit', (id) => {
    let schematic = buildExample(id);
    const signature = electricalSignature(schematic);
    const components = schematic.items.filter(isComponent);
    const steps: [number, number][] = [
      [2, 0],
      [0, 3],
      [-1, -2],
      [4, 1],
      [-3, 0],
    ];
    for (const item of components) {
      for (const [dx, dy] of steps) {
        const result = moveWithWires(schematic, item.id, dx, dy);
        if (result.status === 'blocked') continue;
        const current = schematic.items.find((other) => other.id === item.id)!;
        expect(keepsConnections(schematic, result.schematic)).toBe(true);
        if (landsOnSomething(schematic, current, shifted(current, dx, dy))) continue;
        schematic = result.schematic;
        expect(electricalSignature(schematic)).toBe(signature);
        expectCleanWires(schematic);
      }
    }
  });
});

describe('keepsConnections', () => {
  const base = buildExample('voltage-divider');

  it('accepts the same circuit and an added connection', () => {
    expect(keepsConnections(base, base)).toBe(true);
    const added = addWire(base, { x: 22, y: 8 }, { x: 22, y: 16 }); // Shorts R2: a new connection.
    expect(keepsConnections(base, added)).toBe(true);
  });

  it('notices a lost wire', () => {
    const top = wires(base).find((wire) => wire.x1 === 17)!;
    const without = { ...base, items: base.items.filter((item) => item.id !== top.id) };
    expect(keepsConnections(base, without)).toBe(false);
  });

  it('notices elements cut off from ground', () => {
    const groundless = {
      ...base,
      items: base.items.map((item) => (item.kind === 'ground' ? { ...item, y: 30 } : item)),
    };
    expect(keepsConnections(base, groundless)).toBe(false);
  });
});

describe('electricalSignature', () => {
  it('ignores values, names and drawing order', () => {
    const a = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 2, y: 0 }, 0, Fraction.from(1));
    const b = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 2, y: 0 }, 0, Fraction.from(9));
    expect(electricalSignature(a)).toBe(electricalSignature(b));
  });

  it('notices a new connection', () => {
    const open = inRow();
    const joined = addWire(open, { x: 0, y: 0 }, { x: 0, y: -5 });
    const closed = addWire(joined, { x: 0, y: -5 }, { x: 14, y: -5 });
    const shorted = addWire(closed, { x: 14, y: -5 }, { x: 14, y: 0 });
    expect(electricalSignature(open)).toBe(electricalSignature(joined));
    expect(electricalSignature(shorted)).not.toBe(electricalSignature(open));
  });
});
