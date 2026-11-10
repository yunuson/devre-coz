import { describe, expect, it } from 'vitest';
import { Fraction, voltageAt, type AnalysisResult } from '../../src/core';
import { analyzeDrawing, dcEquivalentItems } from '../../src/ui/editor/measurements';
import {
  addComponent,
  addGround,
  addWire,
  EMPTY_SCHEMATIC,
  hasValue,
  labelProblem,
  requiresPositiveValue,
  setItemValue,
  toCircuit,
  toggleSwitch,
  type ComponentItem,
  type ComponentKind,
  type Schematic,
} from '../../src/ui/editor/schematic';
import { electricalSignature, moveWithWires } from '../../src/ui/editor/wire-follow';
import { formatQuantity, parseQuantity } from '../../src/ui/format';

type Solved = Extract<AnalysisResult, { status: 'solved' }>;

/**
 * A loop: source on the left, then `middle` on top, then R2 on the right.
 *   (6,0) --middle-- (10,0) --wire-- (14,0)
 * The element under test sits in series with a 1 kΩ resistor, across a 10 V source.
 */
function loopWith(kind: ComponentKind, value?: Fraction): Schematic {
  let schematic = addComponent(EMPTY_SCHEMATIC, 'voltage-source', { x: 0, y: 2 }, 1, Fraction.from(10)); // e1
  schematic = addComponent(schematic, kind, { x: 8, y: 0 }, 0, value); // e2, the element under test.
  schematic = addComponent(schematic, 'resistor', { x: 14, y: 2 }, 1, Fraction.from(1000)); // e3
  schematic = addWire(schematic, { x: 0, y: 0 }, { x: 6, y: 0 });
  schematic = addWire(schematic, { x: 10, y: 0 }, { x: 14, y: 0 });
  schematic = addWire(schematic, { x: 0, y: 4 }, { x: 14, y: 4 });
  return addGround(schematic, { x: 7, y: 4 });
}

function solve(schematic: Schematic) {
  const { analysis, measurements } = analyzeDrawing(schematic);
  if (analysis.status !== 'solved') throw new Error(analysis.issues.map((issue) => issue.code).join());
  return { analysis: analysis as Solved, measurements };
}

const currentThroughR = (schematic: Schematic): string | undefined =>
  solve(schematic).analysis.elements.get('e3')?.current?.toString();

describe('in DC steady state', () => {
  it('a variable resistor is a resistor', () => {
    expect(currentThroughR(loopWith('variable-resistor', Fraction.from(4000)))).toBe('1/500');
  });

  it('a capacitor blocks the current, and takes the whole voltage', () => {
    const schematic = loopWith('capacitor');
    expect(currentThroughR(schematic)).toBe('0');
    const reading = solve(schematic).measurements.get('e2');
    expect(reading?.current?.isZero()).toBe(true);
    expect(reading?.voltage?.toString()).toBe('10');
  });

  it('an inductor passes the current, with no voltage across it', () => {
    const schematic = loopWith('inductor');
    expect(currentThroughR(schematic)).toBe('1/100');
    const reading = solve(schematic).measurements.get('e2');
    expect(reading?.voltage?.isZero()).toBe(true);
    expect(reading?.current?.toString()).toBe('1/100');
  });

  it('an ammeter changes nothing and reads the current', () => {
    const schematic = loopWith('ammeter');
    expect(currentThroughR(schematic)).toBe('1/100');
    expect(solve(schematic).measurements.get('e2')?.current?.toString()).toBe('1/100');
  });

  it('a voltmeter across a resistor changes nothing and reads its voltage', () => {
    let schematic = loopWith('ammeter');
    schematic = addComponent(schematic, 'voltmeter', { x: 18, y: 2 }, 1); // Next to R, top and bottom wired.
    schematic = addWire(schematic, { x: 14, y: 0 }, { x: 18, y: 0 });
    schematic = addWire(schematic, { x: 14, y: 4 }, { x: 18, y: 4 });
    const { analysis, measurements } = solve(schematic);
    expect(analysis.elements.get('e3')?.current?.toString()).toBe('1/100');
    const voltmeter = schematic.items.find(
      (item): item is ComponentItem => item.kind === 'voltmeter',
    )!;
    expect(measurements.get(voltmeter.id)?.voltage?.toString()).toBe('10');
    expect(measurements.get(voltmeter.id)?.current?.isZero()).toBe(true);
  });

  it('reads an ammeter in the direction of its terminals', () => {
    const reversed = addComponent(EMPTY_SCHEMATIC, 'voltage-source', { x: 0, y: 2 }, 1, Fraction.from(10));
    let schematic = addComponent(reversed, 'ammeter', { x: 8, y: 0 }, 2); // Rotated: first terminal on the right.
    schematic = addComponent(schematic, 'resistor', { x: 14, y: 2 }, 1, Fraction.from(1000));
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 6, y: 0 });
    schematic = addWire(schematic, { x: 10, y: 0 }, { x: 14, y: 0 });
    schematic = addWire(schematic, { x: 0, y: 4 }, { x: 14, y: 4 });
    schematic = addGround(schematic, { x: 7, y: 4 });
    expect(solve(schematic).measurements.get('e2')?.current?.toString()).toBe('-1/100');
  });
});

describe('switches', () => {
  it('start open, which breaks the loop', () => {
    const schematic = loopWith('switch');
    expect(currentThroughR(schematic)).toBe('0');
    expect(solve(schematic).measurements.get('e2')?.voltage?.toString()).toBe('10');
  });

  it('pass the current once closed', () => {
    const closed = toggleSwitch(loopWith('switch'), 'e2');
    expect(currentThroughR(closed)).toBe('1/100');
    expect(solve(closed).measurements.get('e2')?.current?.toString()).toBe('1/100');
  });

  it('toggle back and forth', () => {
    const schematic = toggleSwitch(toggleSwitch(loopWith('switch'), 'e2'), 'e2');
    expect(currentThroughR(schematic)).toBe('0');
  });

  it('short a source when closed across it, which is reported', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'voltage-source', { x: 0, y: 2 }, 1); // e1, 0,0 to 0,4.
    schematic = addComponent(schematic, 'switch', { x: 4, y: 2 }, 1); // e2, 4,0 to 4,4.
    schematic = addWire(schematic, { x: 0, y: 0 }, { x: 4, y: 0 });
    schematic = addWire(schematic, { x: 0, y: 4 }, { x: 4, y: 4 });
    schematic = addGround(schematic, { x: 0, y: 4 });
    expect(analyzeDrawing(schematic).analysis.status).toBe('solved');
    const { analysis } = analyzeDrawing(toggleSwitch(schematic, 'e2'));
    expect(analysis.issues.map((issue) => issue.code)).toEqual(['voltage-source-shorted']);
    expect(analysis.issues[0]?.wireIds).toContain('e2');
  });
});

describe('open circuit readings', () => {
  it('say nothing fixes the voltage of an element floating on its own', () => {
    let schematic = loopWith('ammeter');
    schematic = addComponent(schematic, 'capacitor', { x: 30, y: 30 });
    const capacitor = schematic.items.find((item): item is ComponentItem => item.kind === 'capacitor')!;
    expect(solve(schematic).measurements.get(capacitor.id)?.voltage).toBeNull();
  });

  it('do not disturb a circuit with no other reason to fail', () => {
    const { analysis } = solve(loopWith('capacitor'));
    expect(voltageAt(analysis, '14,0')?.isZero()).toBe(true);
  });
});

describe('parallel shorts', () => {
  it('still give voltages, and say the split between them is unknown', () => {
    let schematic = loopWith('ammeter');
    schematic = addComponent(schematic, 'ammeter', { x: 8, y: 3 }, 0); // A second ammeter across the first.
    schematic = addWire(schematic, { x: 6, y: 0 }, { x: 6, y: 3 });
    schematic = addWire(schematic, { x: 10, y: 0 }, { x: 10, y: 3 });
    const { analysis, measurements } = solve(schematic);
    expect(analysis.elements.get('e3')?.current?.toString()).toBe('1/100');
    expect(measurements.get('e2')?.current).toBeNull();
  });
});

describe('moving keeps these elements attached', () => {
  it.each<ComponentKind>(['capacitor', 'voltmeter', 'switch', 'inductor', 'ammeter', 'variable-resistor'])(
    '%s stays wired when moved',
    (kind) => {
      const schematic = loopWith(kind);
      const signature = electricalSignature(schematic);
      const result = moveWithWires(schematic, 'e2', 0, -3);
      if (result.status !== 'moved') throw new Error('blocked');
      expect(electricalSignature(result.schematic)).toBe(signature);
    },
  );

  it('notices a capacitor losing its wire', () => {
    const schematic = loopWith('capacitor');
    const withoutWire = { ...schematic, items: schematic.items.filter((item) => item.id !== 'e4') };
    expect(electricalSignature(withoutWire)).not.toBe(electricalSignature(schematic));
  });
});

describe('the DC equivalent step lists', () => {
  it('only elements that change', () => {
    expect(dcEquivalentItems(loopWith('resistor'))).toEqual([]);
    expect(dcEquivalentItems(loopWith('variable-resistor'))).toEqual([]);
    for (const kind of ['capacitor', 'inductor', 'switch', 'ammeter', 'voltmeter'] as const) {
      expect(dcEquivalentItems(loopWith(kind)).map((item) => item.id)).toEqual(['e2']);
    }
  });
});

describe('element details', () => {
  it('numbers each kind with its letter from the notes', () => {
    const kinds: [ComponentKind, string][] = [
      ['capacitor', 'C1'],
      ['inductor', 'L1'],
      ['switch', 'S1'],
      ['ammeter', 'A1'],
      ['voltmeter', 'Vm1'],
      ['variable-resistor', 'R1'],
    ];
    for (const [kind, label] of kinds) {
      const schematic = addComponent(EMPTY_SCHEMATIC, kind, { x: 0, y: 0 });
      expect((schematic.items[0] as ComponentItem).label).toBe(label);
    }
  });

  it('shares numbers between both kinds of resistor', () => {
    let schematic = addComponent(EMPTY_SCHEMATIC, 'resistor', { x: 0, y: 0 });
    schematic = addComponent(schematic, 'variable-resistor', { x: 5, y: 0 });
    expect((schematic.items[1] as ComponentItem).label).toBe('R2');
    expect(labelProblem(schematic, 'e2', 'R1')).toBe('taken');
  });

  it('knows which elements have a value and which must be positive', () => {
    expect(hasValue('capacitor')).toBe(true);
    expect(hasValue('switch')).toBe(false);
    expect(hasValue('ammeter')).toBe(false);
    expect(requiresPositiveValue('inductor')).toBe(true);
    expect(requiresPositiveValue('voltage-source')).toBe(false);
  });

  it('widens the slider range when a larger value is typed', () => {
    const schematic = addComponent(EMPTY_SCHEMATIC, 'variable-resistor', { x: 0, y: 0 });
    const item = (s: Schematic): ComponentItem => s.items[0] as ComponentItem;
    expect(item(schematic).maxValue?.toString()).toBe('10000');
    expect(item(setItemValue(schematic, 'e1', Fraction.from(500))).maxValue?.toString()).toBe('10000');
    expect(item(setItemValue(schematic, 'e1', Fraction.from(50000))).maxValue?.toString()).toBe('50000');
  });

  it('reads and writes the new units', () => {
    const read = (text: string, unit: 'F' | 'H'): string | null => {
      const parsed = parseQuantity(text, unit);
      return parsed.ok ? parsed.value.toString() : null;
    };
    expect(read('10 µF', 'F')).toBe('1/100000');
    expect(read('10u', 'F')).toBe('1/100000');
    expect(read('5 mH', 'H')).toBe('1/200');
    expect(read('5 V', 'H')).toBeNull();
    expect(formatQuantity(Fraction.from('1e-5'), 'F')).toBe('10 µF');
    expect(formatQuantity(Fraction.from('1e-3'), 'H')).toBe('1 mH');
  });

  it('leaves the solver unaware of open elements', () => {
    expect(toCircuit(loopWith('capacitor')).elements.some((element) => element.id === 'e2')).toBe(false);
    expect(toCircuit(loopWith('inductor')).elements.find((element) => element.id === 'e2')?.kind).toBe('wire');
  });
});
