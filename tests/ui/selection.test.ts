import { describe, expect, it } from 'vitest';
import { analyze, Fraction, voltageAt } from '../../src/core';
import { buildExample, EXAMPLE_IDS } from '../../src/ui/editor/examples';
import {
  addComponent,
  addGround,
  addWire,
  EMPTY_SCHEMATIC,
  isComponent,
  setItemLabel,
  setItemValue,
  toCircuit,
  type ComponentItem,
  type Schematic,
} from '../../src/ui/editor/schematic';
import {
  allIds,
  boxFromCorners,
  copyItems,
  itemsInBox,
  pasteItems,
  removeItems,
} from '../../src/ui/editor/selection';
import { attachmentCells, electricalSignature, moveGroupWithWires } from '../../src/ui/editor/wire-follow';

/** A 10 V source across two 1 kΩ resistors in series, so the middle sits at 5 V. */
function divider(): Schematic {
  let schematic = addComponent(EMPTY_SCHEMATIC, 'voltage-source', { x: 0, y: 4 }); // e1: + (0,2), − (0,6)
  schematic = addComponent(schematic, 'resistor', { x: 4, y: 2 }); // e2: (2,2)–(6,2)
  schematic = addComponent(schematic, 'resistor', { x: 8, y: 4 }, 1); // e3: (8,2)–(8,6)
  schematic = addWire(schematic, { x: 0, y: 2 }, { x: 2, y: 2 }); // e4
  schematic = addWire(schematic, { x: 6, y: 2 }, { x: 8, y: 2 }); // e5
  schematic = addWire(schematic, { x: 0, y: 6 }, { x: 8, y: 6 }); // e6
  return addGround(schematic, { x: 0, y: 6 }); // e7
}

const labels = (schematic: Schematic): string[] =>
  schematic.items.flatMap((item) => (isComponent(item) ? [item.label] : []));

function solvedVoltage(schematic: Schematic, x: number, y: number): string | undefined {
  const analysis = analyze(toCircuit(schematic));
  if (analysis.status !== 'solved') throw new Error(analysis.issues.map((issue) => issue.code).join(', '));
  return voltageAt(analysis, `${x},${y}`)?.toString();
}

describe('the selection box', () => {
  it('takes only what lies entirely inside it', () => {
    const schematic = divider();
    // Covers the source and the wire to R1, but only half of R1.
    expect(itemsInBox(schematic, boxFromCorners({ x: -1, y: 1 }, { x: 3, y: 7 }))).toEqual(['e1', 'e4', 'e7']);
  });

  it('works whichever corner the drag starts from', () => {
    const schematic = divider();
    const forward = itemsInBox(schematic, boxFromCorners({ x: -1, y: 1 }, { x: 9, y: 7 }));
    const backward = itemsInBox(schematic, boxFromCorners({ x: 9, y: 7 }, { x: -1, y: 1 }));
    expect(forward).toEqual(allIds(schematic));
    expect(backward).toEqual(forward);
  });

  it('counts an element touching the edge as inside', () => {
    const schematic = divider();
    expect(itemsInBox(schematic, boxFromCorners({ x: 2, y: 2 }, { x: 6, y: 2 }))).toEqual(['e2']);
  });

  it('takes nothing from an empty patch', () => {
    expect(itemsInBox(divider(), boxFromCorners({ x: 20, y: 20 }, { x: 30, y: 30 }))).toEqual([]);
  });
});

describe('deleting a group', () => {
  it('removes exactly the chosen elements', () => {
    const after = removeItems(divider(), new Set(['e2', 'e5']));
    expect(after.items.map((item) => item.id)).toEqual(['e1', 'e3', 'e4', 'e6', 'e7']);
    expect(after.nextId).toBe(divider().nextId);
  });
});

describe('copy and paste', () => {
  it('pastes the copy with its top-left corner at the chosen cell', () => {
    const schematic = divider();
    const clipboard = copyItems(schematic, new Set(allIds(schematic)))!;
    expect(clipboard.origin).toEqual({ x: 0, y: 2 });
    const { schematic: after, ids } = pasteItems(schematic, clipboard, { x: 20, y: 12 });
    expect(ids).toHaveLength(7);
    const pastedSource = after.items.find((item) => item.id === ids[0]) as ComponentItem;
    expect([pastedSource.x, pastedSource.y]).toEqual([20, 14]);
  });

  it('gives every copy a new id and keeps counting from there', () => {
    const schematic = divider();
    const { schematic: after, ids } = pasteItems(schematic, copyItems(schematic, new Set(['e2', 'e3']))!, { x: 30, y: 0 });
    expect(ids).toEqual(['e8', 'e9']);
    expect(after.nextId).toBe(10);
    expect(new Set(after.items.map((item) => item.id)).size).toBe(after.items.length);
  });

  it('renames copies whose names are taken, keeping each kind’s letter', () => {
    const schematic = divider();
    const { schematic: after } = pasteItems(schematic, copyItems(schematic, new Set(allIds(schematic)))!, { x: 20, y: 0 });
    expect(labels(after)).toEqual(['V1', 'R1', 'R2', 'V2', 'R3', 'R4']);
  });

  it('keeps a name that is free, such as when pasting into a cleared drawing', () => {
    const schematic = setItemLabel(divider(), 'e2', 'Rf');
    const clipboard = copyItems(schematic, new Set(['e2']))!;
    const { schematic: after } = pasteItems(EMPTY_SCHEMATIC, clipboard, { x: 0, y: 0 });
    expect(labels(after)).toEqual(['Rf']);
  });

  it('treats names differing only in case as the same name', () => {
    const schematic = setItemLabel(divider(), 'e2', 'r9');
    const { schematic: after } = pasteItems(
      { ...schematic, items: [...schematic.items, { ...(schematic.items[1] as ComponentItem), id: 'e99', label: 'R9' }] },
      { items: [schematic.items[1]!], origin: { x: 2, y: 2 } },
      { x: 40, y: 0 },
    );
    expect(labels(after).filter((label) => label.toLowerCase() === 'r9')).toHaveLength(2);
  });

  it('copies values and state exactly', () => {
    let schematic = setItemValue(divider(), 'e2', Fraction.ratio(1n, 3n));
    schematic = addComponent(schematic, 'switch', { x: 30, y: 30 });
    const { schematic: after, ids } = pasteItems(schematic, copyItems(schematic, new Set(['e2']))!, { x: 50, y: 50 });
    expect((after.items.find((item) => item.id === ids[0]) as ComponentItem).value.toString()).toBe('1/3');
  });

  it('pastes a whole working circuit that solves like the original', () => {
    const schematic = divider();
    const { schematic: after } = pasteItems(schematic, copyItems(schematic, new Set(allIds(schematic)))!, { x: 20, y: 0 });
    expect(solvedVoltage(after, 8, 2)).toBe('5');
    expect(solvedVoltage(after, 28, 0)).toBe('5');
  });

  it('never lands a paste on what is already drawn, which would join them', () => {
    const schematic = divider();
    const clipboard = copyItems(schematic, new Set(allIds(schematic)))!;
    // Asked to paste right on top of the original.
    const { schematic: after, ids } = pasteItems(schematic, clipboard, clipboard.origin);
    const pasted = new Set(ids);
    const copy = after.items.filter((item) => pasted.has(item.id));
    const original = after.items.filter((item) => !pasted.has(item.id));
    expect(original).toEqual(schematic.items);

    // No connection point of either one lies on any part of the other.
    const onAny = (cell: { x: number; y: number }, items: typeof original): boolean =>
      items.some((item) =>
        item.kind === 'wire'
          ? cell.x >= Math.min(item.x1, item.x2) && cell.x <= Math.max(item.x1, item.x2) &&
            cell.y >= Math.min(item.y1, item.y2) && cell.y <= Math.max(item.y1, item.y2)
          : attachmentCells(item).some((other) => other.x === cell.x && other.y === cell.y),
      );
    expect(copy.flatMap(attachmentCells).some((cell) => onAny(cell, original))).toBe(false);
    expect(original.flatMap(attachmentCells).some((cell) => onAny(cell, copy))).toBe(false);

    // So each divider still has its own 5 V middle.
    const shiftedSource = copy.find((item) => item.kind === 'voltage-source') as ComponentItem;
    const dx = shiftedSource.x - 0;
    const dy = shiftedSource.y - 4;
    expect(solvedVoltage(after, 8, 2)).toBe('5');
    expect(solvedVoltage(after, 8 + dx, 2 + dy)).toBe('5');
  });

  it('moves a paste just far enough to clear a wire it would have touched', () => {
    const schematic = addWire(EMPTY_SCHEMATIC, { x: 0, y: 10 }, { x: 40, y: 10 });
    const lone = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 2, y: 0 }); // ends at 0 and 4
    const clipboard = copyItems(lone, new Set(['e1']))!;
    // Its left end would land on the long wire.
    const { schematic: after, ids } = pasteItems(schematic, clipboard, { x: 10, y: 10 });
    const copy = after.items.find((item) => item.id === ids[0]) as ComponentItem;
    expect(copy.y).not.toBe(10);
    expect(Math.abs(copy.y - 10) + Math.abs(copy.x - 12)).toBe(1);
  });

  it('pastes exactly where asked when that spot is free', () => {
    const lone = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 2, y: 0 });
    const clipboard = copyItems(lone, new Set(['e1']))!;
    const { schematic: after, ids } = pasteItems(divider(), clipboard, { x: 30, y: 30 });
    const copy = after.items.find((item) => item.id === ids[0]) as ComponentItem;
    expect([copy.x, copy.y]).toEqual([32, 30]);
  });

  it('copies nothing when nothing is chosen', () => {
    expect(copyItems(divider(), new Set())).toBeNull();
  });
});

describe('moving a group', () => {
  it('moves everything together when the whole drawing is chosen', () => {
    const schematic = divider();
    const result = moveGroupWithWires(schematic, new Set(allIds(schematic)), 5, -3);
    if (result.status !== 'moved') throw new Error('blocked');
    expect(solvedVoltage(result.schematic, 13, -1)).toBe('5');
    expect(result.schematic.items).toHaveLength(schematic.items.length);
  });

  it('stretches the wires leading out of the group and keeps the circuit', () => {
    const schematic = divider();
    // R2 with the wire above it moves right; the bottom wire and R1's wire must follow.
    const result = moveGroupWithWires(schematic, new Set(['e3', 'e5']), 4, 0);
    if (result.status !== 'moved') throw new Error('blocked');
    expect(electricalSignature(result.schematic)).toBe(electricalSignature(schematic));
    const r2 = result.schematic.items.find((item) => item.id === 'e3') as ComponentItem;
    expect([r2.x, r2.y]).toEqual([12, 4]);
    expect(solvedVoltage(result.schematic, 12, 2)).toBe('5');
  });

  it('carries along what joins a moved wire partway', () => {
    let schematic = divider();
    // A resistor hanging down from the middle of the bottom wire, its top end at (4, 6).
    schematic = addComponent(schematic, 'resistor', { x: 4, y: 8 }, 1);
    schematic = addWire(schematic, { x: 4, y: 10 }, { x: 8, y: 10 });
    schematic = addWire(schematic, { x: 8, y: 10 }, { x: 8, y: 6 });
    const result = moveGroupWithWires(schematic, new Set(['e6', 'e1', 'e7']), 0, 1);
    if (result.status !== 'moved') throw new Error('blocked');
    expect(electricalSignature(result.schematic)).toBe(electricalSignature(schematic));
  });

  it('treats a group of one like moving that element, so a deliberate drop onto a wire end still works', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 5, y: 5 }); // ends at 3 and 7
    schematic = addComponent(schematic, 'resistor', { x: 32, y: 5 }); // ends at 30 and 34
    schematic = addWire(schematic, { x: 20, y: 5 }, { x: 30, y: 5 });
    // Its right end lands on the free end of the wire, which joins it to the other resistor.
    const result = moveGroupWithWires(schematic, new Set(['e1']), 13, 0);
    if (result.status !== 'moved') throw new Error('blocked');
    expect(electricalSignature(result.schematic)).not.toBe(electricalSignature(schematic));
  });

  it('refuses a move that would change the circuit', () => {
    const schematic = divider();
    // Dropping the source and its wires onto R1's right end would short R1.
    expect(moveGroupWithWires(schematic, new Set(['e1', 'e4', 'e6', 'e7']), 6, 0).status).toBe('blocked');
  });

  it('works for every example moved as a whole', () => {
    for (const id of EXAMPLE_IDS) {
      const schematic = buildExample(id);
      const result = moveGroupWithWires(schematic, new Set(allIds(schematic)), -7, 9);
      expect(result.status, id).toBe('moved');
    }
  });

  it('does nothing for an empty group', () => {
    expect(moveGroupWithWires(divider(), new Set(), 1, 1).status).toBe('blocked');
  });
});
