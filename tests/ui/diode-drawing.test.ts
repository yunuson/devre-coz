import { describe, expect, it } from 'vitest';
import { analyze, Fraction } from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { buildExample, EXAMPLE_MENU_IDS } from '../../src/ui/editor/examples';
import { drawSchematic } from '../../src/ui/editor/render';
import {
  addComponent,
  COMPONENT_KINDS,
  DEFAULT_VALUE,
  EMPTY_SCHEMATIC,
  isComponentValueValid,
  terminalsOf,
  toCircuit,
  type ComponentItem,
} from '../../src/ui/editor/schematic';
import { parseSchematic, serializeSchematic } from '../../src/ui/editor/storage';
import { DEFAULT_BINDINGS } from '../../src/ui/shortcuts';
import { flipItem } from '../../src/ui/editor/wire-follow';

describe('drawing diodes', () => {
  it('names them D1 and D2 and starts at a 0.7 V threshold', () => {
    expect(COMPONENT_KINDS).toContain('diode');
    const first = addComponent(EMPTY_SCHEMATIC, 'diode', { x: 0, y: 0 });
    const second = addComponent(first, 'diode', { x: 4, y: 0 });
    expect((first.items[0] as ComponentItem).label).toBe('D1');
    expect((first.items[0] as ComponentItem).value.toString()).toBe('7/10');
    expect((second.items[1] as ComponentItem).label).toBe('D2');
    expect(DEFAULT_VALUE.diode.toString()).toBe('7/10');
  });

  it.each([0, 1, 2, 3] as const)('maps rotation %i first and second terminals to anode and cathode', (rotation) => {
    const schematic = addComponent(EMPTY_SCHEMATIC, 'diode', { x: 5, y: 7 }, rotation);
    const item = schematic.items[0] as ComponentItem;
    const [anode, cathode] = terminalsOf(item);
    const circuitDiode = toCircuit(schematic).elements.find((element) => element.kind === 'diode');
    expect(circuitDiode).toMatchObject({
      kind: 'diode',
      anode: `${anode!.x},${anode!.y}`,
      cathode: `${cathode!.x},${cathode!.y}`,
    });

    const flipped = flipItem(schematic, item.id);
    expect(terminalsOf(flipped.items[0] as ComponentItem)).toEqual([cathode, anode]);
  });

  it('draws the hollow triangle, cathode bar and shared 80 by 40 hit area', () => {
    const schematic = addComponent(EMPTY_SCHEMATIC, 'diode', { x: 0, y: 0 });
    const svg = drawSchematic(schematic, { selectedId: null, highlights: new Map(), solved: null });
    expect(svg).toContain('M-10 -10L10 0L-10 10Z');
    expect(svg).toContain('M10 -10V10');
    expect(svg).toContain('class="hit" x="-40" y="-20" width="80" height="40"');
  });

  it('allows zero threshold and rejects a negative threshold', () => {
    expect(isComponentValueValid('diode', Fraction.ZERO)).toBe(true);
    expect(isComponentValueValid('diode', Fraction.from(-1))).toBe(false);
  });

  it('round trips through drawing files', () => {
    const schematic = addComponent(EMPTY_SCHEMATIC, 'diode', { x: 3, y: 8 }, 2);
    const restored = parseSchematic(serializeSchematic(schematic));
    expect(restored).toEqual(schematic);
  });

  it('solves the diode series example at 11.3 mA', () => {
    expect(EXAMPLE_MENU_IDS).toContain('diode-series');
    expect(tr.examples['diode-series']).toBe('Diyotlu seri devre');
    const schematic = buildExample('diode-series');
    const result = analyze(toCircuit(schematic));
    if (result.status !== 'solved') throw new Error(result.issues.map((issue) => issue.code).join(', '));
    const diode = schematic.items.find((item) => item.kind === 'diode');
    if (!diode || diode.kind !== 'diode') throw new Error('Example has no diode');
    expect(result.elements.get(diode.id)?.current?.toString()).toBe('113/10000');
  });

  it('assigns D as the default tool shortcut', () => {
    expect(DEFAULT_BINDINGS.diode).toBe('D');
  });
});
