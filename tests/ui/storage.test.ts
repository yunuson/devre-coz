import { describe, expect, it } from 'vitest';
import { Fraction } from '../../src/core';
import { buildExample, EXAMPLE_IDS } from '../../src/ui/editor/examples';
import {
  addComponent,
  addGround,
  addWire,
  COMPONENT_KINDS,
  EMPTY_SCHEMATIC,
  setItemValue,
  toggleSwitch,
  type ComponentItem,
  type Schematic,
} from '../../src/ui/editor/schematic';
import { parseSchematic, serializeSchematic } from '../../src/ui/editor/storage';
import { flipItem } from '../../src/ui/editor/wire-follow';

const roundTrip = (schematic: Schematic): Schematic | null => parseSchematic(serializeSchematic(schematic));

/** One of every kind, each with whatever extra state it can have. */
function everything(): Schematic {
  let schematic = EMPTY_SCHEMATIC;
  COMPONENT_KINDS.forEach((kind, index) => {
    schematic = addComponent(schematic, kind, { x: index * 6, y: -3 });
  });
  const byKind = (kind: string): ComponentItem =>
    schematic.items.find((item) => item.kind === kind) as ComponentItem;
  schematic = toggleSwitch(schematic, byKind('switch').id);
  schematic = flipItem(schematic, byKind('op-amp').id);
  schematic = setItemValue(schematic, byKind('capacitor').id, Fraction.from('4.7e-6'));
  schematic = setItemValue(schematic, byKind('voltage-source').id, Fraction.from(-12));
  schematic = setItemValue(schematic, byKind('current-source').id, Fraction.ratio(1n, 3n));
  schematic = addWire(schematic, { x: -5, y: 2 }, { x: 4, y: -7 });
  return addGround(schematic, { x: 0, y: 9 });
}

describe('saving the drawing', () => {
  it('brings back every kind of element exactly, with its state', () => {
    const schematic = everything();
    expect(roundTrip(schematic)).toEqual(schematic);
  });

  it('keeps exact values, such as one third', () => {
    const back = roundTrip(everything())!;
    const source = back.items.find((item) => item.kind === 'current-source') as ComponentItem;
    expect(source.value.toString()).toBe('1/3');
  });

  it('brings back every example', () => {
    for (const id of EXAMPLE_IDS) {
      const schematic = buildExample(id);
      expect(roundTrip(schematic), id).toEqual(schematic);
    }
  });

  it('brings back an empty drawing', () => {
    expect(roundTrip(EMPTY_SCHEMATIC)).toEqual(EMPTY_SCHEMATIC);
  });

  it('continues numbering past the largest id, even after deletions', () => {
    const schematic = everything();
    const withoutFirst = { ...schematic, items: schematic.items.slice(1) };
    const back = roundTrip(withoutFirst)!;
    const largest = Math.max(...back.items.map((item) => Number(item.id.slice(1))));
    expect(back.nextId).toBe(largest + 1);
  });
});

describe('reading something that isn’t a valid drawing', () => {
  const valid = JSON.parse(serializeSchematic(everything())) as { version: number; items: Record<string, unknown>[] };
  const withItem = (change: (item: Record<string, unknown>) => Record<string, unknown>, index = 0): string =>
    JSON.stringify({ ...valid, items: valid.items.map((item, i) => (i === index ? change(item) : item)) });
  const firstWire = valid.items.findIndex((item) => item.kind === 'wire');

  it.each([
    ['not JSON', '{oops'],
    ['not an object', '42'],
    ['another version', JSON.stringify({ ...valid, version: 2 })],
    ['no items', JSON.stringify({ version: 1 })],
    ['an unknown kind', withItem((item) => ({ ...item, kind: 'transistor' }))],
    ['a missing value', withItem(({ value: _, ...item }) => item)],
    ['a value divided by zero', withItem((item) => ({ ...item, value: '1/0' }))],
    ['a value that isn’t a fraction', withItem((item) => ({ ...item, value: '1e5' }))],
    ['a fractional position', withItem((item) => ({ ...item, x: 1.5 }))],
    ['a rotation of 5', withItem((item) => ({ ...item, rotation: 5 }))],
    ['an empty name', withItem((item) => ({ ...item, label: '  ' }))],
    ['a strange id', withItem((item) => ({ ...item, id: 'x1' }))],
    ['a diagonal wire', withItem((item) => ({ ...item, x2: Number(item.x1) + 1, y2: Number(item.y1) + 1 }), firstWire)],
    ['an empty wire', withItem((item) => ({ ...item, x2: item.x1, y2: item.y1 }), firstWire)],
    ['two elements with one id', JSON.stringify({ ...valid, items: [valid.items[0], valid.items[0]] })],
  ])('returns nothing for %s', (_, text) => {
    expect(parseSchematic(text)).toBeNull();
  });
});
