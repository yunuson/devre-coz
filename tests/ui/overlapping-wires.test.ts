import { describe, expect, it } from 'vitest';
import { connectionMarks, EMPTY_SCHEMATIC, addComponent, addWire, type Schematic, type WireItem } from '../../src/ui/editor/schematic';
import { electricalSignature, moveWithWires } from '../../src/ui/editor/wire-follow';

type Segment = [number, number, number, number];

const segments = (schematic: Schematic): Segment[] =>
  schematic.items
    .filter((item): item is WireItem => item.kind === 'wire')
    .map((wire): Segment => {
      const forward = wire.x1 < wire.x2 || (wire.x1 === wire.x2 && wire.y1 <= wire.y2);
      return forward ? [wire.x1, wire.y1, wire.x2, wire.y2] : [wire.x2, wire.y2, wire.x1, wire.y1];
    })
    .sort((a, b) => a.join().localeCompare(b.join(), undefined, { numeric: true }));

const dots = (schematic: Schematic): string[] =>
  connectionMarks(schematic)
    .filter(({ connections }) => connections >= 3)
    .map(({ cell }) => `${cell.x},${cell.y}`)
    .sort();

function moved(schematic: Schematic, id: string, dx: number, dy: number): Schematic {
  const result = moveWithWires(schematic, id, dx, dy);
  if (result.status !== 'moved') throw new Error('blocked');
  return result.schematic;
}

/**
 * The case in the screenshot: an output wire running right, and a feedback wire coming down onto
 * its middle. A resistor at each end keeps the wires from simply stretching.
 */
function teeOnWire(): { schematic: Schematic; branchId: string } {
  let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: -2, y: 10 }); // ends at 0
  schematic = addComponent(schematic, 'resistor', { x: 22, y: 10 }); // starts at 20
  schematic = addComponent(schematic, 'resistor', { x: 10, y: -2 }, 1); // bottom end at (10, 0)
  schematic = addWire(schematic, { x: 0, y: 10 }, { x: 20, y: 10 });
  schematic = addWire(schematic, { x: 10, y: 0 }, { x: 10, y: 10 });
  return { schematic, branchId: schematic.items.at(-1)!.id };
}

describe('moving a wire that joins another wire partway along', () => {
  it('slides the joint along, leaving no extra piece or second dot', () => {
    const { schematic, branchId } = teeOnWire();
    expect(dots(schematic)).toEqual(['10,10']);
    const after = moved(schematic, branchId, 1, 0);
    expect(segments(after)).toEqual([
      [0, 10, 20, 10],
      [11, 0, 11, 10],
      [10, 0, 11, 0],
    ].sort((a, b) => a.join().localeCompare(b.join(), undefined, { numeric: true })) as Segment[]);
    expect(dots(after)).toEqual(['11,10']);
    expect(electricalSignature(after)).toBe(electricalSignature(schematic));
  });

  it.each([2, 5, -4])('does the same for a slide of %i', (dx) => {
    const { schematic, branchId } = teeOnWire();
    const after = moved(schematic, branchId, dx, 0);
    expect(dots(after)).toEqual([`${10 + dx},10`]);
    expect(segments(after).filter(([, y1, , y2]) => y1 === 10 && y2 === 10)).toEqual([[0, 10, 20, 10]]);
  });

  it('grows the wire it joins when it slides past that wire’s end, without overlapping it', () => {
    const { schematic, branchId } = teeOnWire();
    // Past x = 20 the long wire has to reach further. The resistor sitting there blocks it, so go left instead.
    const after = moved(schematic, branchId, -13, 0);
    const horizontal = segments(after).filter(([, y1, , y2]) => y1 === 10 && y2 === 10);
    for (let i = 0; i < horizontal.length; i++) {
      for (let j = i + 1; j < horizontal.length; j++) {
        const [a1, , a2] = horizontal[i]!;
        const [b1, , b2] = horizontal[j]!;
        expect(Math.min(a2, b2) - Math.max(a1, b1), 'overlapping pieces').toBeLessThanOrEqual(0);
      }
    }
    expect(electricalSignature(after)).toBe(electricalSignature(schematic));
  });
});

describe('wires lying on top of each other', () => {
  it('merge into one when one covers part of the other', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: -2, y: 0 });
    schematic = addComponent(schematic, 'resistor', { x: 22, y: 0 });
    schematic = addComponent(schematic, 'resistor', { x: 5, y: -4 }, 1); // bottom end at (5, -2)
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 20, y: 0 });
    schematic = addWire(schematic, { x: 5, y: -2 }, { x: 5, y: 0 });
    // Moving the small resistor drags its wire end along the long wire.
    const after = moved(schematic, schematic.items[2]!.id, 3, 0);
    expect(segments(after).filter(([, y1, , y2]) => y1 === 0 && y2 === 0)).toEqual([[0, 0, 20, 0]]);
  });

  it('stay apart where a crossing wire passes through an end that merging would remove', () => {
    // Two overlapping wires, 0–12 and 10–20. A vertical wire passes through (12, 0), the first
    // wire's end, and that end is the only thing connecting it. Merging would cut it off.
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 12, y: -7 }, 1); // bottom end at (12, -5)
    schematic = addComponent(schematic, 'resistor', { x: 40, y: 40 }); // unrelated, to move
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 12, y: 0 });
    schematic = addWire(schematic, { x: 10, y: 0 }, { x: 20, y: 0 });
    schematic = addWire(schematic, { x: 12, y: -5 }, { x: 12, y: 5 });
    const after = moved(schematic, schematic.items[1]!.id, 0, 3);
    expect(electricalSignature(after)).toBe(electricalSignature(schematic));
    expect(segments(after).filter(([, y1, , y2]) => y1 === 0 && y2 === 0)).toEqual([
      [0, 0, 12, 0],
      [10, 0, 20, 0],
    ]);
  });
});
