import { beforeAll, describe, expect, it } from 'vitest';
import { analyze, Fraction, solveWithSteps, voltageAt } from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { buildExample, EXAMPLE_IDS } from '../../src/ui/editor/examples';
import { CELL_SIZE, drawComponentGhost, drawSchematic, occupiedBoxes, type SolvedAnalysis } from '../../src/ui/editor/render';
import {
  addComponent,
  addGround,
  addWire,
  COMPONENT_KINDS,
  connectionMarks,
  EMPTY_SCHEMATIC,
  hasSameStructure,
  insertIntoWire,
  isComponent,
  isComponentValueValid,
  setItemValue,
  terminalsOf,
  toCircuit,
  wiresUnderBodies,
  type ComponentItem,
  type ComponentKind,
  type Rotation,
  type Schematic,
  type WireItem,
} from '../../src/ui/editor/schematic';
import { parseSchematic, serializeSchematic } from '../../src/ui/editor/storage';
import { transistorReadout } from '../../src/ui/editor/transistor-readout';
import { electricalSignature, flipItem, moveWithWires, removeWithWires, rotateWithWires } from '../../src/ui/editor/wire-follow';
import { formatBeta, parseBeta } from '../../src/ui/format';
import { ACTION_IDS, actionForCombo, DEFAULT_BINDINGS } from '../../src/ui/shortcuts';

/**
 * Task 22: the transistor on the drawing. The solver already knows it (tasks 15 and 17);
 * these tests are about placing it, wiring it, showing it and reading its results.
 */

const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

function add(schematic: Schematic, kind: ComponentKind, x: number, y: number, rotation?: Rotation) {
  const next = addComponent(schematic, kind, { x, y }, rotation);
  return { schematic: next, item: next.items.at(-1) as ComponentItem };
}

const itemOf = (schematic: Schematic, id: string): ComponentItem =>
  schematic.items.find((item) => item.id === id) as ComponentItem;

const wiresOf = (schematic: Schematic): WireItem[] =>
  schematic.items.filter((item): item is WireItem => item.kind === 'wire');

function solvedOf(schematic: Schematic): SolvedAnalysis {
  const analysis = analyze(toCircuit(schematic));
  if (analysis.status !== 'solved') throw new Error(analysis.issues.map((issue) => issue.code).join(', '));
  return analysis;
}

const pointOf = ({ x, y }: { x: number; y: number }): string => `${x},${y}`;

const drawOptions = { selectedId: null, highlights: new Map(), solved: null };

interface BoxLike {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const overlapArea = (a: BoxLike, b: BoxLike): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * A PNP with its emitter on top, as it is usually drawn:
 * VEE = 10 V → RE = 2 kΩ → emitter; base → RB = 100 kΩ → ground; collector → RC = 3 kΩ → VCC = −10 V.
 * IB = (10 − 0,7) / (100 k + 101 · 2 k) = 93/3020000 A.
 */
function pnpCircuit(): { schematic: Schematic; id: string } {
  const transistor = add(EMPTY_SCHEMATIC, 'pnp', 20, 12);
  let schematic = flipItem(transistor.schematic, transistor.item.id);
  schematic = addComponent(schematic, 'voltage-point', { x: 21, y: 4 }, 0, Fraction.from(10));
  schematic = addComponent(schematic, 'resistor', { x: 21, y: 7 }, 1, Fraction.from(2000));
  schematic = addComponent(schematic, 'resistor', { x: 14, y: 12 }, 0, Fraction.from(100000));
  schematic = addComponent(schematic, 'resistor', { x: 21, y: 17 }, 1, Fraction.from(3000));
  schematic = addComponent(schematic, 'voltage-point', { x: 21, y: 20 }, 0, Fraction.from(-10));
  schematic = addWire(schematic, { x: 21, y: 4 }, { x: 21, y: 5 });
  schematic = addWire(schematic, { x: 21, y: 9 }, { x: 21, y: 10 });
  schematic = addWire(schematic, { x: 16, y: 12 }, { x: 18, y: 12 });
  schematic = addWire(schematic, { x: 21, y: 14 }, { x: 21, y: 15 });
  schematic = addWire(schematic, { x: 21, y: 19 }, { x: 21, y: 20 });
  schematic = addGround(schematic, { x: 12, y: 12 });
  return { schematic, id: transistor.item.id };
}

describe('the transistor as an element', () => {
  it('comes in two kinds, NPN and PNP', () => {
    expect(COMPONENT_KINDS).toContain('npn');
    expect(COMPONENT_KINDS).toContain('pnp');
  });

  it('is named Q1, Q2, ... whichever kind it is, and starts with β = 100', () => {
    const first = add(EMPTY_SCHEMATIC, 'npn', 10, 10);
    const second = add(first.schematic, 'pnp', 20, 10);
    const third = add(second.schematic, 'npn', 30, 10);
    expect(first.item.label).toBe('Q1');
    expect(second.item.label).toBe('Q2');
    expect(third.item.label).toBe('Q3');
    expect(first.item.value.toString()).toBe('100');
    expect(second.item.value.toString()).toBe('100');
    expect(first.item.rotation).toBe(0);
    expect(first.item.mirrored).not.toBe(true);
  });

  it('accepts only a positive β', () => {
    expect(isComponentValueValid('npn', Fraction.from(150))).toBe(true);
    expect(isComponentValueValid('pnp', Fraction.from('0.5'))).toBe(true);
    expect(isComponentValueValid('npn', Fraction.ZERO)).toBe(false);
    expect(isComponentValueValid('pnp', Fraction.from(-100))).toBe(false);
  });
});

describe('where a transistor’s terminals are', () => {
  const at = { x: 10, y: 10 };

  it('has its base on the left, its collector above and its emitter below on the right', () => {
    expect(terminalsOf({ ...at, kind: 'npn', rotation: 0 })).toEqual([
      { x: 8, y: 10 },
      { x: 11, y: 8 },
      { x: 11, y: 12 },
    ]);
  });

  it('turns all three together, clockwise', () => {
    expect(terminalsOf({ ...at, kind: 'npn', rotation: 1 })).toEqual([
      { x: 10, y: 8 },
      { x: 12, y: 11 },
      { x: 8, y: 11 },
    ]);
    expect(terminalsOf({ ...at, kind: 'npn', rotation: 2 })).toEqual([
      { x: 12, y: 10 },
      { x: 9, y: 12 },
      { x: 9, y: 8 },
    ]);
    expect(terminalsOf({ ...at, kind: 'npn', rotation: 3 })).toEqual([
      { x: 10, y: 12 },
      { x: 8, y: 9 },
      { x: 12, y: 9 },
    ]);
  });

  it('is laid out the same for a PNP', () => {
    for (const rotation of ROTATIONS) {
      expect(terminalsOf({ ...at, kind: 'pnp', rotation })).toEqual(terminalsOf({ ...at, kind: 'npn', rotation }));
    }
  });

  it('swaps only the collector and the emitter when mirrored', () => {
    for (const kind of ['npn', 'pnp'] as const) {
      for (const rotation of ROTATIONS) {
        const [base, collector, emitter] = terminalsOf({ ...at, kind, rotation });
        expect(terminalsOf({ ...at, kind, rotation, mirrored: true })).toEqual([base, emitter, collector]);
      }
    }
  });
});

describe('handing a drawn transistor to the solver', () => {
  it('gives the base, the collector and the emitter in that order, with β as the value', () => {
    const { schematic, item } = add(EMPTY_SCHEMATIC, 'npn', 10, 10);
    const element = toCircuit(setItemValue(schematic, item.id, Fraction.from(150))).elements.find(
      ({ id }) => id === item.id,
    );
    expect(element).toMatchObject({ kind: 'bjt', polarity: 'npn', base: '8,10', collector: '11,8', emitter: '11,12' });
    expect((element as unknown as { beta: Fraction }).beta.toString()).toBe('150');
  });

  it('keeps the polarity of a PNP', () => {
    const { schematic, item } = add(EMPTY_SCHEMATIC, 'pnp', 10, 10, 2);
    const element = toCircuit(schematic).elements.find(({ id }) => id === item.id);
    expect(element).toMatchObject({ kind: 'bjt', polarity: 'pnp', base: '12,10', collector: '9,12', emitter: '9,8' });
  });

  it('solves a PNP drawn with its emitter on top', () => {
    const { schematic, id } = pnpCircuit();
    const analysis = solvedOf(schematic);
    expect(analysis.issues).toEqual([]);
    expect(analysis.transistorStates?.map(({ state }) => state)).toEqual(['active']);
    expect(analysis.transistors?.get(id)?.ib.toString()).toBe('93/3020000');
    const [, collector, emitter] = terminalsOf(itemOf(schematic, id));
    expect(emitter!.y).toBeLessThan(collector!.y);
    expect(voltageAt(analysis, pointOf(emitter!))?.toString()).toBe('5707/1510');
    expect(voltageAt(analysis, pointOf(collector!))?.toString()).toBe('-115/151');
  });
});

describe('typing and showing β', () => {
  it('reads a plain number, with or without the β in front', () => {
    const value = (text: string): string | null => {
      const parsed = parseBeta(text);
      return parsed.ok ? parsed.value.toString() : null;
    };
    expect(value('150')).toBe('150');
    expect(value('β = 150')).toBe('150');
    expect(value('β=150')).toBe('150');
    expect(value(' 99,5 ')).toBe('199/2');
    expect(value('99.5')).toBe('199/2');
  });

  it('refuses units, prefixes and anything that is not a number', () => {
    for (const text of ['', 'β', 'abc', '100 V', '100 A', '1k', '2 m']) {
      expect(parseBeta(text).ok, text).toBe(false);
    }
  });

  it('writes it as β = 100, with a decimal comma', () => {
    expect(formatBeta(Fraction.from(100))).toBe('β = 100');
    expect(formatBeta(Fraction.from('99.5'))).toBe('β = 99,5');
  });

  it('shows the name and β beside the symbol', () => {
    const { schematic, item } = add(EMPTY_SCHEMATIC, 'npn', 10, 10);
    const svg = drawSchematic(schematic, drawOptions);
    expect(svg).toContain('Q1');
    expect(svg).toContain('β = 100');
    expect(drawSchematic(setItemValue(schematic, item.id, Fraction.from(150)), drawOptions)).toContain('β = 150');
  });
});

describe('drawing a transistor', () => {
  it('draws NPN and PNP differently: the emitter arrow points the other way', () => {
    const npn = drawComponentGhost('npn', { x: 10, y: 10 }, 0);
    const pnp = drawComponentGhost('pnp', { x: 10, y: 10 }, 0);
    expect(npn).toContain('<path');
    expect(pnp).toContain('<path');
    expect(npn).not.toBe(pnp);
  });

  it('draws a mirrored transistor differently, so the arrow follows the emitter', () => {
    const { schematic, item } = add(EMPTY_SCHEMATIC, 'npn', 10, 10);
    expect(drawSchematic(flipItem(schematic, item.id), drawOptions)).not.toBe(drawSchematic(schematic, drawOptions));
  });

  it('reports the space it takes: a body holding all three terminals, and its text clear of the body', () => {
    for (const kind of ['npn', 'pnp'] as const) {
      for (const rotation of ROTATIONS) {
        for (const mirrored of [false, true]) {
          const placed = add(EMPTY_SCHEMATIC, kind, 10, 10, rotation);
          const schematic = mirrored ? flipItem(placed.schematic, placed.item.id) : placed.schematic;
          const boxes = occupiedBoxes(schematic);
          const where = `${kind}, rotation ${rotation}${mirrored ? ', mirrored' : ''}`;
          expect(boxes.length, where).toBeGreaterThanOrEqual(2);
          const [body, text] = boxes as [BoxLike, BoxLike];
          for (const terminal of terminalsOf(itemOf(schematic, placed.item.id))) {
            const x = terminal.x * CELL_SIZE;
            const y = terminal.y * CELL_SIZE;
            expect(x >= body.left && x <= body.right && y >= body.top && y <= body.bottom, where).toBe(true);
          }
          expect(text.right - text.left, where).toBeGreaterThan(0);
          expect(overlapArea(body, text), where).toBe(0);
        }
      }
    }
  });

  it('keeps its text off the wires that leave its terminals', () => {
    // A wire may leave a terminal along its lead or to either side, but not back into the body.
    const reach = 3;
    for (const kind of ['npn', 'pnp'] as const) {
      for (const rotation of ROTATIONS) {
        for (const mirrored of [false, true]) {
          const placed = add(EMPTY_SCHEMATIC, kind, 10, 10, rotation);
          const schematic = mirrored ? flipItem(placed.schematic, placed.item.id) : placed.schematic;
          const item = itemOf(schematic, placed.item.id);
          const text = occupiedBoxes(schematic)[1] as BoxLike;
          terminalsOf(item).forEach((terminal, index) => {
            const dx = terminal.x - item.x;
            const dy = terminal.y - item.y;
            const outward = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
            const sideways = { x: outward.y, y: outward.x };
            for (const direction of [outward, sideways, { x: -sideways.x, y: -sideways.y }]) {
              const end = { x: terminal.x + direction.x * reach, y: terminal.y + direction.y * reach };
              const left = Math.min(terminal.x, end.x) * CELL_SIZE;
              const right = Math.max(terminal.x, end.x) * CELL_SIZE;
              const top = Math.min(terminal.y, end.y) * CELL_SIZE;
              const bottom = Math.max(terminal.y, end.y) * CELL_SIZE;
              const crosses = right > text.left && left < text.right && bottom > text.top && top < text.bottom;
              const where = `${kind}, rotation ${rotation}${mirrored ? ', mirrored' : ''}, terminal ${index}, toward ${direction.x},${direction.y}`;
              expect(crosses, where).toBe(false);
            }
          });
        }
      }
    }
  });

  it('draws a solved circuit without treating the transistor as a two-terminal element', () => {
    const { schematic } = pnpCircuit();
    const svg = drawSchematic(schematic, { ...drawOptions, solved: solvedOf(schematic) });
    expect(svg).toContain('Q1');
    expect(svg).not.toContain('NaN');
  });
});

describe('Yönünü çevir on a transistor', () => {
  it('swaps the collector and the emitter, leaving the base, the rotation and every wire alone', () => {
    const { schematic, id } = pnpCircuit();
    const flipped = flipItem(schematic, id);
    const before = itemOf(schematic, id);
    const after = itemOf(flipped, id);
    expect(after.rotation).toBe(before.rotation);
    expect(terminalsOf(after)).toEqual([terminalsOf(before)[0], terminalsOf(before)[2], terminalsOf(before)[1]]);
    expect(wiresOf(flipped)).toEqual(wiresOf(schematic));
  });

  it('counts as a change to the structure, and flipping twice undoes it', () => {
    const { schematic, id } = pnpCircuit();
    const flipped = flipItem(schematic, id);
    expect(hasSameStructure(schematic, flipped)).toBe(false);
    const back = flipItem(flipped, id);
    expect(hasSameStructure(schematic, back)).toBe(true);
    expect(solvedOf(back).transistors?.get(id)?.ib.toString()).toBe('93/3020000');
  });
});

describe('a transistor and the wires around it', () => {
  const across = addWire(EMPTY_SCHEMATIC, { x: 0, y: 10 }, { x: 20, y: 10 });
  const dropped = (kind: ComponentKind, x: number, y: number, rotation?: Rotation): ComponentItem =>
    addComponent(across, kind, { x, y }, rotation).items.at(-1) as ComponentItem;

  it('refuses a drop with its center on a wire, saying why', () => {
    for (const kind of ['npn', 'pnp'] as const) {
      expect(insertIntoWire(across, dropped(kind, 10, 10))).toEqual({
        status: 'blocked',
        reason: 'three-terminals',
        rotation: 0,
      });
    }
    expect(tr.placement['three-terminals']).toContain('Op-amp');
    expect(tr.placement['three-terminals']).toContain('ransistör');
  });

  it('refuses a wire anywhere under its body, not just at its center', () => {
    expect(insertIntoWire(across, dropped('npn', 10, 9)).status).toBe('blocked');
    expect(insertIntoWire(across, dropped('npn', 10, 11)).status).toBe('blocked');
    expect(insertIntoWire(across, dropped('npn', 9, 10, 1)).status).toBe('blocked');
  });

  it('allows one clear of the wire', () => {
    expect(insertIntoWire(across, dropped('npn', 10, 5))).toEqual({ status: 'none' });
  });

  it('joins a wire that a terminal lands on, as with any element', () => {
    const onWire = addComponent(across, 'npn', { x: 10, y: 8 });
    expect(terminalsOf(onWire.items.at(-1) as ComponentItem)[2]).toEqual({ x: 11, y: 10 });
    expect(toCircuit(onWire).elements.filter((element) => element.kind === 'wire')).toHaveLength(2);
    expect(wiresUnderBodies(onWire)).toBe(0);
  });

  it('counts the wires under transistors and op-amps alike', () => {
    const through = addComponent(across, 'npn', { x: 10, y: 10 });
    expect(wiresUnderBodies(through)).toBe(1);
    expect(wiresUnderBodies(addComponent(across, 'op-amp', { x: 10, y: 10 }))).toBe(1);
    expect(wiresUnderBodies(addComponent(across, 'resistor', { x: 10, y: 5 }))).toBe(0);
  });

  it('is deleted alone: the wires at its three terminals are not joined', () => {
    const transistor = add(EMPTY_SCHEMATIC, 'npn', 20, 10);
    let schematic = addWire(transistor.schematic, { x: 10, y: 10 }, { x: 18, y: 10 });
    schematic = addWire(schematic, { x: 21, y: 8 }, { x: 21, y: 2 });
    schematic = addWire(schematic, { x: 21, y: 12 }, { x: 21, y: 18 });
    const after = removeWithWires(schematic, transistor.item.id);
    expect(after.items).toHaveLength(3);
    expect(after.items.every((item) => item.kind === 'wire')).toBe(true);
  });

  it('keeps the circuit the same when it is moved or turned, and never ends up over a wire', () => {
    const { schematic, id } = pnpCircuit();
    const signature = electricalSignature(schematic);
    let moved = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [3, 0], [-2, 2], [5, -3]] as const) {
      const result = moveWithWires(schematic, id, dx, dy);
      if (result.status === 'blocked') continue;
      moved++;
      expect(electricalSignature(result.schematic), `by ${dx},${dy}`).toBe(signature);
      expect(wiresUnderBodies(result.schematic), `by ${dx},${dy}`).toBe(0);
    }
    expect(moved).toBeGreaterThan(0);

    const turned = rotateWithWires(schematic, id);
    if (turned.status === 'moved') {
      expect(electricalSignature(turned.schematic)).toBe(signature);
      expect(wiresUnderBodies(turned.schematic)).toBe(0);
    }
  });
});

describe('saving a transistor', () => {
  it('brings back its kind, its β and its mirroring', () => {
    const { schematic, id } = pnpCircuit();
    const changed = setItemValue(schematic, id, Fraction.from(150));
    const back = parseSchematic(serializeSchematic(changed));
    expect(back).toEqual(changed);
    expect(itemOf(back!, id)).toMatchObject({ kind: 'pnp', mirrored: true });
    expect(itemOf(back!, id).value.toString()).toBe('150');
  });
});

describe('the transistor tools', () => {
  it('gives the NPN its own key and leaves the PNP without one, like the LED', () => {
    expect(ACTION_IDS).toContain('npn');
    expect(ACTION_IDS).toContain('pnp');
    expect(DEFAULT_BINDINGS.npn).toBe('T');
    expect(DEFAULT_BINDINGS.pnp).toBeNull();
    expect(actionForCombo(DEFAULT_BINDINGS, 'T')).toBe('npn');
  });

  it('names both in the toolbar and the shortcuts list', () => {
    expect(tr.tools.npn).toBe('NPN transistör');
    expect(tr.tools.pnp).toBe('PNP transistör');
    expect(tr.shortcuts.actions.npn).toBe('NPN transistör');
    expect(tr.shortcuts.actions.pnp).toBe('PNP transistör');
  });
});

describe('reading a transistor’s results', () => {
  it('lists the region, the three currents and VEC for a PNP', () => {
    const { schematic, id } = pnpCircuit();
    const rows = transistorReadout(itemOf(schematic, id), solvedOf(schematic));
    expect(rows?.[0]).toEqual({ label: 'Çalışma bölgesi', value: 'Aktif' });
    expect(rows?.map(({ label }) => label)).toEqual(['Çalışma bölgesi', 'IB', 'IC', 'IE', 'VEC']);
    expect(rows?.find(({ label }) => label === 'VEC')?.value).toBe('4,541 V');
  });

  it('says so when the transistor is cut off or saturated', () => {
    const { schematic, id } = pnpCircuit();
    // With the emitter supply at 0 V nothing can turn the base-emitter junction on.
    const source = schematic.items.find((item) => isComponent(item) && item.kind === 'voltage-point') as ComponentItem;
    const cutOff = setItemValue(schematic, source.id, Fraction.ZERO);
    expect(transistorReadout(itemOf(cutOff, id), solvedOf(cutOff))?.[0]).toEqual({
      label: 'Çalışma bölgesi',
      value: 'Kesim',
    });
    // A base resistor of 1 kΩ drives far more base current than the collector resistor can follow.
    const baseResistor = schematic.items.find(
      (item) => isComponent(item) && item.kind === 'resistor' && item.value.toString() === '100000',
    ) as ComponentItem;
    const saturated = setItemValue(schematic, baseResistor.id, Fraction.from(1000));
    expect(transistorReadout(itemOf(saturated, id), solvedOf(saturated))?.[0]).toEqual({
      label: 'Çalışma bölgesi',
      value: 'Doyum',
    });
  });

  it('has nothing to say about other elements', () => {
    const { schematic } = pnpCircuit();
    const resistor = schematic.items.find((item) => isComponent(item) && item.kind === 'resistor') as ComponentItem;
    expect(transistorReadout(resistor, solvedOf(schematic))).toBeNull();
  });
});

/**
 * The two examples. Values are our own, chosen to give round numbers:
 * fixed bias: IB = (12 − 0,7) / 226 k = 50 µA, IC = 5 mA, VC = 12 − 5 mA · 1 k = 7 V.
 * divider: ETH = 2,4 V, RTH = 8 k, IB = 1,7 / (8 k + 101 · 1 k) = 17/1090000 A.
 */
const EXAMPLES = [
  {
    id: 'bjt-fixed-bias',
    name: 'Sabit öngerilimli transistör',
    resistors: { RB: '226000', RC: '1000' },
    voltages: { base: '7/10', collector: '7', emitter: '0' },
    ib: '1/20000',
    thevenin: false,
    readout: { IB: '50 µA', IC: '5 mA', IE: '5,05 mA', VCE: '7 V' },
  },
  {
    id: 'bjt-voltage-divider',
    name: 'Gerilim bölücülü transistör',
    resistors: { R1: '40000', R2: '10000', RC: '4000', RE: '1000' },
    voltages: { base: '248/109', collector: '628/109', emitter: '1717/1090' },
    ib: '17/1090000',
    thevenin: true,
    readout: { IB: '15,6 µA', IC: '1,56 mA', IE: '1,575 mA', VCE: '4,186 V' },
  },
] as const;

describe('the examples menu', () => {
  it('adds the two transistor examples at the end', () => {
    expect(EXAMPLE_IDS.slice(-2)).toEqual(EXAMPLES.map(({ id }) => id));
  });
});

describe.each(EXAMPLES)('$id', ({ id, name, resistors, voltages, ib, thevenin, readout }) => {
  let schematic: Schematic;
  let components: ComponentItem[];
  let transistor: ComponentItem;
  let analysis: SolvedAnalysis;

  beforeAll(() => {
    schematic = buildExample(id as Parameters<typeof buildExample>[0]);
    components = schematic.items.filter(isComponent);
    transistor = components.find((item) => item.kind === 'npn')!;
    analysis = solvedOf(schematic);
  });

  it('is named in the menu', () => {
    expect((tr.examples as Record<string, string>)[id]).toBe(name);
  });

  it('has one NPN called Q1 with β = 100, a 12 V source called VCC, and the resistors named as in a textbook', () => {
    expect(components.filter((item) => item.kind === 'npn' || item.kind === 'pnp')).toHaveLength(1);
    expect(transistor).toMatchObject({ label: 'Q1', rotation: 0 });
    expect(transistor.mirrored).not.toBe(true);
    expect(transistor.value.toString()).toBe('100');

    const sources = components.filter((item) => item.kind === 'voltage-source');
    expect(sources.map((item) => [item.label, item.value.toString()])).toEqual([['VCC', '12']]);

    const named = Object.fromEntries(
      components.filter((item) => item.kind === 'resistor').map((item) => [item.label, item.value.toString()]),
    );
    expect(named).toEqual(resistors);
    expect(components).toHaveLength(2 + Object.keys(resistors).length);
    expect(schematic.items.some((item) => item.kind === 'ground')).toBe(true);
  });

  it('is drawn the way the textbook draws it: base on the left, collector above the emitter, supply at the top', () => {
    const [base, collector, emitter] = terminalsOf(transistor);
    expect(base!.x).toBeLessThan(collector!.x);
    expect(collector!.y).toBeLessThan(emitter!.y);
    const ground = schematic.items.find((item) => item.kind === 'ground') as { y: number };
    expect(ground.y).toBeGreaterThanOrEqual(emitter!.y);
    for (const item of components.filter((component) => component.kind === 'resistor' && component.label === 'RC')) {
      expect(item.y).toBeLessThan(transistor.y);
    }
  });

  it('solves with no errors or warnings, in the active region, to the hand-calculated values', () => {
    expect(analysis.issues).toEqual([]);
    expect(analysis.transistorStates?.map(({ state }) => state)).toEqual(['active']);
    expect(analysis.transistors?.get(transistor.id)?.ib.toString()).toBe(ib);
    const [base, collector, emitter] = terminalsOf(transistor);
    expect(voltageAt(analysis, pointOf(base!))?.toString()).toBe(voltages.base);
    expect(voltageAt(analysis, pointOf(collector!))?.toString()).toBe(voltages.collector);
    expect(voltageAt(analysis, pointOf(emitter!))?.toString()).toBe(voltages.emitter);
  });

  it('is solved with loops, as on paper, not with the matrix', () => {
    const solution = solveWithSteps(toCircuit(schematic));
    if (solution.status !== 'solved') throw new Error('not solved');
    const types = solution.steps.map((step) => step.type);
    expect(types).toContain('bjt-input-loop');
    expect(types).toContain('bjt-output-loop');
    expect(types).not.toContain('transistor-equations');
    expect(types.includes('bjt-thevenin')).toBe(thevenin);
  });

  it('shows the region, the currents and VCE for the selected transistor', () => {
    const rows = transistorReadout(transistor, analysis);
    expect(rows?.map(({ label }) => label)).toEqual(['Çalışma bölgesi', 'IB', 'IC', 'IE', 'VCE']);
    expect(rows?.[0]?.value).toBe('Aktif');
    for (const [label, value] of Object.entries(readout)) {
      expect(rows?.find((row) => row.label === label)?.value, label).toBe(value);
    }
  });

  it('is drawn cleanly: straight wires, unique ids, nothing under the transistor, no loose ends', () => {
    for (const wire of wiresOf(schematic)) {
      expect(wire.x1 === wire.x2 || wire.y1 === wire.y2, `diagonal ${wire.id}`).toBe(true);
      expect(wire.x1 === wire.x2 && wire.y1 === wire.y2, `empty ${wire.id}`).toBe(false);
    }
    const ids = schematic.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(wiresUnderBodies(schematic)).toBe(0);
    const loose = connectionMarks(schematic).filter(({ connections }) => connections === 1);
    expect(loose.map(({ cell }) => pointOf(cell))).toEqual([]);
  });

  it('has no two wires lying on top of each other, and no two wires crossing', () => {
    const all = wiresOf(schematic);
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

  it('has no element drawn over another, and no wire through an element or its text', () => {
    const boxesOf = (item: ComponentItem): BoxLike[] => occupiedBoxes({ ...schematic, items: [item] });
    const bodies = components.map((item) => ({ item, box: boxesOf(item)[0]! }));
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        expect(overlapArea(bodies[i]!.box, bodies[j]!.box), `${bodies[i]!.item.label} / ${bodies[j]!.item.label}`).toBe(0);
      }
    }
    const segments = wiresOf(schematic).map((wire) => ({
      id: wire.id,
      left: Math.min(wire.x1, wire.x2) * CELL_SIZE,
      right: Math.max(wire.x1, wire.x2) * CELL_SIZE,
      top: Math.min(wire.y1, wire.y2) * CELL_SIZE,
      bottom: Math.max(wire.y1, wire.y2) * CELL_SIZE,
    }));
    for (const item of components) {
      const text = boxesOf(item)[1]!;
      for (const wire of segments) {
        const crosses = wire.right > text.left && wire.left < text.right && wire.bottom > text.top && wire.top < text.bottom;
        expect(crosses, `${wire.id} runs through the text of ${item.label}`).toBe(false);
      }
      if (item.kind === 'npn') continue;
      for (const wire of wiresOf(schematic)) {
        const covers =
          item.x >= Math.min(wire.x1, wire.x2) && item.x <= Math.max(wire.x1, wire.x2) &&
          item.y >= Math.min(wire.y1, wire.y2) && item.y <= Math.max(wire.y1, wire.y2);
        expect(covers, `${wire.id} runs through ${item.label}`).toBe(false);
      }
    }
  });

  it('saves and opens again unchanged', () => {
    expect(parseSchematic(serializeSchematic(schematic))).toEqual(schematic);
  });
});
