import { describe, expect, it } from 'vitest';
import { analyze, Fraction, type ElementResult } from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { analyzeDrawing } from '../../src/ui/editor/measurements';
import { CELL_SIZE, drawComponentGhost, drawSchematic, occupiedBoxes, placeNodeLabels, type SolvedAnalysis } from '../../src/ui/editor/render';
import {
  addComponent,
  addGround,
  addWire,
  EMPTY_SCHEMATIC,
  hasSameStructure,
  insertIntoWire,
  isComponent,
  removeItem,
  setItemValue,
  terminalsOf,
  toCircuit,
  wiresUnderOpAmps,
  type ComponentItem,
  type ComponentKind,
  type Rotation,
  type Schematic,
} from '../../src/ui/editor/schematic';
import { actionForCombo, DEFAULT_BINDINGS } from '../../src/ui/shortcuts';
import {
  electricalSignature,
  flipItem,
  keepsConnections,
  moveWithWires,
  removeWithWires,
  rotateWithWires,
} from '../../src/ui/editor/wire-follow';

const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

function add(schematic: Schematic, kind: ComponentKind, x: number, y: number, value?: number, rotation?: Rotation) {
  const next = addComponent(schematic, kind, { x, y }, rotation);
  const item = next.items.at(-1) as ComponentItem;
  return {
    schematic: value === undefined ? next : setItemValue(next, item.id, Fraction.from(value)),
    id: item.id,
  };
}

function wired(schematic: Schematic, ...cells: readonly (readonly [number, number])[]): Schematic {
  let current = schematic;
  for (let i = 0; i + 1 < cells.length; i++) {
    const [x1, y1] = cells[i]!;
    const [x2, y2] = cells[i + 1]!;
    current = addWire(current, { x: x1, y: y1 }, { x: x2, y: y2 });
  }
  return current;
}

/** Vo = −(Rf / R1) · Vi = −(5 k / 1 k) · 2 V = −10 V, with the op-amp at (20, 10). */
function invertingAmplifier(): { schematic: Schematic; opAmpId: string } {
  const opAmp = add(EMPTY_SCHEMATIC, 'op-amp', 20, 10);
  const source = add(opAmp.schematic, 'voltage-source', 6, 12, 2);
  const r1 = add(source.schematic, 'resistor', 12, 9, 1000);
  const rf = add(r1.schematic, 'resistor', 20, 5, 5000);
  let schematic = wired(rf.schematic, [6, 10], [6, 9], [10, 9]);
  schematic = wired(schematic, [14, 9], [18, 9], [18, 5]);
  schematic = wired(schematic, [22, 5], [22, 10]);
  schematic = addGround(schematic, { x: 18, y: 11 });
  schematic = addGround(schematic, { x: 6, y: 14 });
  return { schematic, opAmpId: opAmp.id };
}

const opAmpOf = (schematic: Schematic, id: string): ComponentItem =>
  schematic.items.find((item) => item.id === id) as ComponentItem;

function result(schematic: Schematic, id: string): ElementResult {
  const analysis = analyze(toCircuit(schematic));
  if (analysis.status !== 'solved') {
    throw new Error(analysis.issues.map((issue) => issue.code).join(', '));
  }
  return analysis.elements.get(id)!;
}

function solvedOf(schematic: Schematic): SolvedAnalysis {
  const analysis = analyze(toCircuit(schematic));
  if (analysis.status !== 'solved') throw new Error('not solved');
  return analysis;
}

describe('where an op-amp’s terminals are', () => {
  const at = { x: 10, y: 10, kind: 'op-amp' as const };

  it('has − above + on its left, and its output on the right', () => {
    expect(terminalsOf({ ...at, rotation: 0 })).toEqual([
      { x: 8, y: 9 },
      { x: 8, y: 11 },
      { x: 12, y: 10 },
    ]);
  });

  it('turns all three together, clockwise', () => {
    expect(terminalsOf({ ...at, rotation: 1 })).toEqual([
      { x: 11, y: 8 },
      { x: 9, y: 8 },
      { x: 10, y: 12 },
    ]);
    expect(terminalsOf({ ...at, rotation: 2 })).toEqual([
      { x: 12, y: 11 },
      { x: 12, y: 9 },
      { x: 8, y: 10 },
    ]);
    expect(terminalsOf({ ...at, rotation: 3 })).toEqual([
      { x: 9, y: 12 },
      { x: 11, y: 12 },
      { x: 10, y: 8 },
    ]);
  });

  it('swaps only the inputs when mirrored', () => {
    for (const rotation of ROTATIONS) {
      const [minus, plus, output] = terminalsOf({ ...at, rotation });
      expect(terminalsOf({ ...at, rotation, mirrored: true })).toEqual([plus, minus, output]);
    }
  });

  it('leaves two-terminal elements as they were', () => {
    expect(terminalsOf({ x: 10, y: 10, rotation: 0, kind: 'resistor' })).toEqual([
      { x: 8, y: 10 },
      { x: 12, y: 10 },
    ]);
  });
});

describe('solving a drawn op-amp', () => {
  it('gives the hand-calculated answer', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    expect(result(schematic, opAmpId).voltage.toString()).toBe('-10');
  });

  it('warns past its supply, using the value typed into the drawing', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    expect(analyze(toCircuit(schematic)).issues).toEqual([]);
    const lowered = setItemValue(schematic, opAmpId, Fraction.from(5));
    expect(analyze(toCircuit(lowered)).issues.map((issue) => issue.code)).toEqual(['op-amp-saturated']);
    expect(result(lowered, opAmpId).voltage.toString()).toBe('-10');
  });

  it('starts at ±15 V, named OP1, not yet mirrored', () => {
    const item = addComponent(EMPTY_SCHEMATIC, 'op-amp', { x: 5, y: 5 }).items[0] as ComponentItem;
    expect(item.value.toString()).toBe('15');
    expect(item.label).toBe('OP1');
    expect(item.mirrored).toBeUndefined();
  });

  it('treats a capacitor in the feedback path as open, so there is no feedback in DC', () => {
    const { schematic } = invertingAmplifier();
    const swapped: Schematic = {
      ...schematic,
      items: schematic.items.map((item) =>
        isComponent(item) && item.value.toString() === '5000' ? { ...item, kind: 'capacitor' } : item,
      ),
    };
    expect(analyze(toCircuit(swapped)).issues.map((issue) => issue.code)).toEqual(['op-amp-no-feedback']);
  });

  it('reads the output current through an ammeter in the feedback path', () => {
    const { schematic } = invertingAmplifier();
    // The wire from Rf's right end down to the output becomes an ammeter between (22, 6) and (22, 10).
    const withoutWire = schematic.items.filter(
      (item) => !(item.kind === 'wire' && item.x1 === 22 && item.y1 === 5),
    );
    const ammeter = add({ ...schematic, items: withoutWire }, 'ammeter', 22, 8, undefined, 1);
    const closed = wired(ammeter.schematic, [22, 5], [22, 6]);
    const reading = analyzeDrawing(closed).measurements.get(ammeter.id);
    // Vi / R1 = 2 mA runs from the input, through Rf, down into the output at −10 V.
    expect(reading?.current?.toString()).toBe('1/500');
    expect(reading?.voltage?.isZero()).toBe(true);
  });
});

describe('moving and turning with three terminals', () => {
  // Straight down is the hard case: − and + share a column, and + is sitting on a ground that stays put.
  it.each([
    [3, 0],
    [0, 1],
    [0, 4],
    [0, 8],
    [-2, 3],
    [5, 2],
  ])('keeps the circuit when moved by (%i, %i)', (dx, dy) => {
    const { schematic, opAmpId } = invertingAmplifier();
    const moved = moveWithWires(schematic, opAmpId, dx, dy);
    if (moved.status !== 'moved') throw new Error('blocked');
    expect(electricalSignature(moved.schematic)).toBe(electricalSignature(schematic));
    expect(result(moved.schematic, opAmpId).voltage.toString()).toBe('-10');
    const item = opAmpOf(moved.schematic, opAmpId);
    expect([item.x, item.y]).toEqual([20 + dx, 10 + dy]);
  });

  /** A follower with a load: every terminal has its own wire leading well away from the op-amp. */
  function roomyFollower(): { schematic: Schematic; opAmpId: string } {
    const opAmp = add(EMPTY_SCHEMATIC, 'op-amp', 20, 10);
    const source = add(opAmp.schematic, 'voltage-source', 6, 14, 3);
    const load = add(source.schematic, 'resistor', 34, 10, 1000);
    let schematic = wired(load.schematic, [6, 12], [6, 11], [18, 11]);
    schematic = wired(schematic, [18, 9], [18, 2], [30, 2], [30, 10]);
    schematic = wired(schematic, [22, 10], [32, 10]);
    schematic = addGround(addGround(schematic, { x: 36, y: 10 }), { x: 6, y: 16 });
    return { schematic, opAmpId: opAmp.id };
  }

  it('turns a quarter with its wires following', () => {
    const { schematic, opAmpId } = roomyFollower();
    expect(result(schematic, opAmpId).voltage.toString()).toBe('3');
    const turned = rotateWithWires(schematic, opAmpId);
    if (turned.status !== 'moved') throw new Error('blocked');
    expect(opAmpOf(turned.schematic, opAmpId).rotation).toBe(1);
    expect(electricalSignature(turned.schematic)).toBe(electricalSignature(schematic));
    expect(result(turned.schematic, opAmpId).voltage.toString()).toBe('3');
  });

  it.each([
    ['tightly wired', invertingAmplifier, '-10'],
    ['roomy', roomyFollower, '3'],
  ] as const)('when turning a %s circuit, it either keeps the circuit or refuses', (_, build, expected) => {
    const { schematic, opAmpId } = build();
    let current = schematic;
    for (let turn = 0; turn < 4; turn++) {
      const turned = rotateWithWires(current, opAmpId);
      if (turned.status !== 'moved') continue;
      current = turned.schematic;
      expect(electricalSignature(current)).toBe(electricalSignature(schematic));
      expect(result(current, opAmpId).voltage.toString()).toBe(expected);
      expect(wiresUnderOpAmps(current)).toBe(0);
    }
  });

  it('never routes a wire under the triangle when moving', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    for (let dx = -6; dx <= 6; dx++) {
      for (let dy = -6; dy <= 6; dy++) {
        const moved = moveWithWires(schematic, opAmpId, dx, dy);
        if (moved.status === 'moved') expect(wiresUnderOpAmps(moved.schematic), `(${dx}, ${dy})`).toBe(0);
      }
    }
  });

  it('notices when any one terminal loses its connection', () => {
    const { schematic } = invertingAmplifier();
    const cases: readonly (readonly [string, (item: Schematic['items'][number]) => boolean])[] = [
      ['− input', (item) => item.kind === 'wire' && item.x2 === 18 && item.y2 === 9],
      ['+ input', (item) => item.kind === 'ground' && item.x === 18],
      ['output', (item) => item.kind === 'wire' && item.y2 === 10 && item.x2 === 22],
    ];
    for (const [name, matches] of cases) {
      const target = schematic.items.find(matches);
      expect(target, name).toBeDefined();
      const without = removeItem(schematic, target!.id);
      expect(electricalSignature(without), name).not.toBe(electricalSignature(schematic));
      expect(keepsConnections(schematic, without), name).toBe(false);
    }
  });

  it('still refuses a drop that would short its own terminals', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    // The − input would land on the ground that the + input stays connected to.
    expect(moveWithWires(schematic, opAmpId, 0, 2).status).toBe('blocked');
  });

  it('refuses the same when + reaches that ground through a wire', () => {
    // − at (18, 9), + wired down to a ground at (18, 13). Moving down 4 puts − on that ground.
    const opAmp = add(EMPTY_SCHEMATIC, 'op-amp', 20, 10);
    const source = add(opAmp.schematic, 'voltage-source', 6, 12, 2);
    const r1 = add(source.schematic, 'resistor', 12, 9, 1000);
    const rf = add(r1.schematic, 'resistor', 20, 5, 5000);
    let schematic = wired(rf.schematic, [6, 10], [6, 9], [10, 9]);
    schematic = wired(schematic, [14, 9], [18, 9], [18, 5]);
    schematic = wired(schematic, [22, 5], [22, 10]);
    schematic = wired(schematic, [18, 11], [18, 13]);
    schematic = addGround(addGround(schematic, { x: 18, y: 13 }), { x: 6, y: 14 });
    expect(result(schematic, opAmp.id).voltage.toString()).toBe('-10');

    expect(moveWithWires(schematic, opAmp.id, 0, 4).status).toBe('blocked');
    const further = moveWithWires(schematic, opAmp.id, 0, 5);
    if (further.status !== 'moved') throw new Error('blocked');
    expect(result(further.schematic, opAmp.id).voltage.toString()).toBe('-10');
  });

  it('refuses a two-terminal element dropped with both ends on one node', () => {
    // A resistor's ends land on two points of the same wire run, which would short it.
    const r = add(EMPTY_SCHEMATIC, 'resistor', 5, 5);
    const schematic = wired(r.schematic, [20, 5], [20, 9], [24, 9], [24, 5]);
    expect(moveWithWires(schematic, r.id, 17, 0).status).toBe('blocked');
  });

  it('still allows a deliberate drop that connects one terminal to something new', () => {
    const r = add(EMPTY_SCHEMATIC, 'resistor', 5, 5);
    const schematic = wired(r.schematic, [20, 5], [30, 5]);
    const moved = moveWithWires(schematic, r.id, 13, 0);
    expect(moved.status).toBe('moved');
  });

  it('answers quickly even when refusing, since this runs on every cell of a drag', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    const start = performance.now();
    for (let i = 0; i < 10; i++) moveWithWires(schematic, opAmpId, 0, 2);
    expect((performance.now() - start) / 10).toBeLessThan(100);
  });

  it('remembers mirroring through moves and turns', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    const flipped = flipItem(schematic, opAmpId);
    const moved = moveWithWires(flipped, opAmpId, 3, 2);
    if (moved.status !== 'moved') throw new Error('blocked');
    expect(opAmpOf(moved.schematic, opAmpId).mirrored).toBe(true);
    expect(electricalSignature(moved.schematic)).toBe(electricalSignature(flipped));
  });
});

describe('Yönünü çevir on an op-amp', () => {
  it('swaps + and −, which turns this circuit into positive feedback', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    const flipped = flipItem(schematic, opAmpId);
    expect(analyze(toCircuit(flipped)).issues.map((issue) => issue.code)).toEqual(['op-amp-positive-feedback']);
  });

  it('leaves every wire and the output in place', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    const flipped = flipItem(schematic, opAmpId);
    expect(flipped.items.filter((item) => item.kind === 'wire')).toEqual(
      schematic.items.filter((item) => item.kind === 'wire'),
    );
    const before = opAmpOf(schematic, opAmpId);
    const after = opAmpOf(flipped, opAmpId);
    expect(after.rotation).toBe(before.rotation);
    expect(terminalsOf(after)[2]).toEqual(terminalsOf(before)[2]);
  });

  it('counts as a change to the structure, and flipping twice undoes it', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    const flipped = flipItem(schematic, opAmpId);
    expect(hasSameStructure(schematic, flipped)).toBe(false);
    const back = flipItem(flipped, opAmpId);
    expect(result(back, opAmpId).voltage.toString()).toBe('-10');
  });

  it('still turns a two-terminal element end for end', () => {
    const source = add(EMPTY_SCHEMATIC, 'voltage-source', 5, 5);
    const flipped = flipItem(source.schematic, source.id);
    const item = opAmpOf(flipped, source.id);
    expect(item.rotation).toBe(3);
    expect(item.mirrored).toBeUndefined();
  });
});

describe('deleting an op-amp', () => {
  it('removes only the op-amp and joins nothing', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    const after = removeWithWires(schematic, opAmpId);
    expect(after.items.map((item) => item.id)).toEqual(
      schematic.items.filter((item) => item.id !== opAmpId).map((item) => item.id),
    );
  });

  it('does not bridge the wires on either side of it, as it would for a resistor', () => {
    const opAmp = add(EMPTY_SCHEMATIC, 'op-amp', 20, 10);
    const schematic = wired(wired(opAmp.schematic, [10, 10], [18, 10]), [22, 10], [30, 10]);
    const wiresBefore = schematic.items.filter((item) => item.kind === 'wire').length;
    const after = removeWithWires(schematic, opAmp.id);
    expect(after.items).toHaveLength(wiresBefore);
    expect(after.items.every((item) => item.kind === 'wire')).toBe(true);
  });
});

describe('dropping an op-amp near wires', () => {
  const across = addWire(EMPTY_SCHEMATIC, { x: 0, y: 10 }, { x: 20, y: 10 });

  it('refuses a drop with its center on a wire, saying why', () => {
    const item = addComponent(across, 'op-amp', { x: 10, y: 10 }).items.at(-1) as ComponentItem;
    expect(insertIntoWire(across, item)).toEqual({ status: 'blocked', reason: 'three-terminals', rotation: 0 });
    expect(tr.placement['three-terminals']).toContain('Op-amp');
  });

  it('refuses a wire anywhere under its triangle, not just at its center', () => {
    const item = addComponent(across, 'op-amp', { x: 10, y: 9 }).items.at(-1) as ComponentItem;
    expect(insertIntoWire(across, item).status).toBe('blocked');
  });

  it('allows one with its center clear of the wire', () => {
    const item = addComponent(across, 'op-amp', { x: 10, y: 5 }).items.at(-1) as ComponentItem;
    expect(insertIntoWire(across, item)).toEqual({ status: 'none' });
  });

  it('joins a wire that a terminal lands on, as with any element', () => {
    // Turned to point down, its output at (10, 10) sits partway along the wire, which splits there.
    const onWire = addComponent(across, 'op-amp', { x: 10, y: 8 }, 1);
    expect(terminalsOf(onWire.items.at(-1) as ComponentItem)[2]).toEqual({ x: 10, y: 10 });
    expect(toCircuit(onWire).elements.filter((element) => element.kind === 'wire')).toHaveLength(2);
  });
});

describe('drawing an op-amp', () => {
  const options = { selectedId: null, highlights: new Map(), solved: null };
  const signCenters = (svg: string): { minus: { x: number; y: number }; plus: { x: number; y: number } } => {
    const match = /<\/g><path class="line" d="M(-?[\d.]+) (-?[\d.]+)H-?[\d.]+M(-?[\d.]+) (-?[\d.]+)H/.exec(svg);
    if (!match) throw new Error('no signs drawn');
    const [, mx, my, px, py] = match.map(Number);
    return { minus: { x: mx! + 4, y: my! }, plus: { x: px! + 4, y: py! } };
  };

  it('shows its name and supply', () => {
    const { schematic } = invertingAmplifier();
    const svg = drawSchematic(schematic, options);
    expect(svg).toContain('OP1');
    expect(svg).toContain('±15 V');
  });

  it('keeps its text clear of a feedback wire rising from either end of the triangle', () => {
    for (const rotation of [0, 2] as const) {
      const placed = addComponent(EMPTY_SCHEMATIC, 'op-amp', { x: 20, y: 10 }, rotation);
      const [, label] = occupiedBoxes(placed);
      const x = 20 * CELL_SIZE;
      expect(label!.left, `rotation ${rotation}`).toBeGreaterThan(x - 2 * CELL_SIZE);
      expect(label!.right, `rotation ${rotation}`).toBeLessThan(x + 2 * CELL_SIZE);
    }
  });

  it('keeps each sign beside its own terminal, in every rotation and mirrored', () => {
    for (const rotation of ROTATIONS) {
      for (const mirrored of [false, true]) {
        const placed = addComponent(EMPTY_SCHEMATIC, 'op-amp', { x: 10, y: 10 }, rotation);
        const item = { ...(placed.items[0] as ComponentItem), mirrored };
        const svg = drawSchematic({ ...placed, items: [item] }, options);
        const { minus, plus } = signCenters(svg);
        const [minusTerminal, plusTerminal] = terminalsOf(item);
        const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
          Math.hypot(a.x - b.x * CELL_SIZE, a.y - b.y * CELL_SIZE);
        const label = `rotation ${rotation}, mirrored ${mirrored}`;
        expect(distance(minus, minusTerminal!), label).toBeLessThan(distance(minus, plusTerminal!));
        expect(distance(plus, plusTerminal!), label).toBeLessThan(distance(plus, minusTerminal!));
        // Inside the wide end of the triangle, just past where the lead meets it.
        expect(distance(minus, minusTerminal!), label).toBeLessThan(30);
        expect(distance(plus, plusTerminal!), label).toBeLessThan(30);
      }
    }
  });

  it('also draws the signs on the ghost shown while placing', () => {
    const ghost = drawComponentGhost('op-amp', { x: 10, y: 10 }, 0);
    expect(signCenters(ghost).minus.y).toBeLessThan(signCenters(ghost).plus.y);
  });

  it('shows the output current with an arrow when solved', () => {
    const { schematic } = invertingAmplifier();
    const svg = drawSchematic(schematic, { ...options, solved: solvedOf(schematic) });
    // Vi / R1 = 2 mA: the same current through the source, R1, Rf and the op-amp's output.
    expect(svg.match(/class="current"[^>]*>2 mA/g)).toHaveLength(4);
  });

  it('points the output arrow toward the op-amp when current flows into the output', () => {
    const { schematic } = invertingAmplifier();
    const svg = drawSchematic(schematic, { ...options, solved: solvedOf(schematic) });
    // The current comes from the input through Rf and enters the output, which ends at x = 440.
    expect(svg).toContain('<path class="current-arrow" d="M440 210L426 210');
  });

  it('points it away from the op-amp when the output delivers current', () => {
    const { schematic } = invertingAmplifier();
    const negative = schematic.items.find((item) => isComponent(item) && item.kind === 'voltage-source')!;
    const reversed = setItemValue(schematic, negative.id, Fraction.from(-2));
    const svg = drawSchematic(reversed, { ...options, solved: solvedOf(reversed) });
    expect(svg).toContain('<path class="current-arrow" d="M426 210L440 210');
  });

  it('keeps node labels off its body', () => {
    const { schematic, opAmpId } = invertingAmplifier();
    const body = occupiedBoxes({ ...schematic, items: [opAmpOf(schematic, opAmpId)] })[0]!;
    for (const { box } of placeNodeLabels(schematic, solvedOf(schematic))) {
      const overlaps =
        box.left < body.right && box.right > body.left && box.top < body.bottom && box.bottom > body.top;
      expect(overlaps).toBe(false);
    }
  });
});

describe('the op-amp tool', () => {
  it('has its own key, not shared with anything else', () => {
    expect(DEFAULT_BINDINGS['op-amp']).toBe('O');
    expect(actionForCombo(DEFAULT_BINDINGS, 'O')).toBe('op-amp');
    // Tools without a key (the LED, the PNP) are all null, which is not a shared key.
    const keys = Object.values(DEFAULT_BINDINGS).filter((key) => key !== null);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is named in the toolbar and the shortcuts list', () => {
    expect(tr.tools['op-amp']).toBe('Op-amp');
    expect(tr.shortcuts.actions['op-amp']).toBe('Op-amp');
    expect(tr.inspector.flipInputs).toContain('+');
  });
});
