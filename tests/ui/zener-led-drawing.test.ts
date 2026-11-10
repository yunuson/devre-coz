import { describe, expect, it } from 'vitest';
import { analyze, diode, Fraction, ground, resistor, solveWithSteps, voltageSource } from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { buildExample, EXAMPLE_IDS } from '../../src/ui/editor/examples';
import { drawSchematic } from '../../src/ui/editor/render';
import {
  addComponent,
  COMPONENT_KINDS,
  DEFAULT_VALUE,
  EMPTY_SCHEMATIC,
  isComponentValueValid,
  terminalsOf,
  toCircuit,
  UNIT_OF,
  type ComponentItem,
} from '../../src/ui/editor/schematic';
import { parseSchematic, serializeSchematic } from '../../src/ui/editor/storage';
import { flipItem } from '../../src/ui/editor/wire-follow';
import { ACTION_IDS, DEFAULT_BINDINGS } from '../../src/ui/shortcuts';
import { nameTex, stepView } from '../../src/ui/steps-panel/step-views';

/** Task 14: the Zener diode and the LED on the drawing. */

const draw = (kind: 'zener' | 'led') =>
  drawSchematic(addComponent(EMPTY_SCHEMATIC, kind, { x: 0, y: 0 }), { selectedId: null, highlights: new Map(), solved: null });

describe('drawing Zeners', () => {
  it('names them Z1 and Z2 and starts at Vz = 10 V', () => {
    expect(COMPONENT_KINDS).toContain('zener');
    const first = addComponent(EMPTY_SCHEMATIC, 'zener', { x: 0, y: 0 });
    const second = addComponent(first, 'zener', { x: 4, y: 0 });
    expect((first.items[0] as ComponentItem).label).toBe('Z1');
    expect((second.items[1] as ComponentItem).label).toBe('Z2');
    expect(DEFAULT_VALUE.zener.toString()).toBe('10');
    expect(UNIT_OF.zener).toBe('V');
  });

  it('needs a positive Zener voltage', () => {
    expect(isComponentValueValid('zener', Fraction.from('5.1'))).toBe(true);
    expect(isComponentValueValid('zener', Fraction.ZERO)).toBe(false);
    expect(isComponentValueValid('zener', Fraction.from(-1))).toBe(false);
  });

  it.each([0, 1, 2, 3] as const)('rotation %i: anode on the first terminal, Vz from the value, 0,7 V forward', (rotation) => {
    const schematic = addComponent(EMPTY_SCHEMATIC, 'zener', { x: 5, y: 7 }, rotation);
    const item = schematic.items[0] as ComponentItem;
    const [anode, cathode] = terminalsOf(item);
    const element = toCircuit(schematic).elements.find((candidate) => candidate.kind === 'zener');
    expect(element).toMatchObject({
      kind: 'zener',
      id: item.id,
      anode: `${anode!.x},${anode!.y}`,
      cathode: `${cathode!.x},${cathode!.y}`,
    });
    if (element?.kind !== 'zener') throw new Error('no zener');
    expect(element.zenerVoltage.toString()).toBe('10');
    expect(element.threshold.toString()).toBe('7/10');

    const flipped = flipItem(schematic, item.id);
    expect(terminalsOf(flipped.items[0] as ComponentItem)).toEqual([cathode, anode]);
  });

  it('draws the diode triangle with a bent cathode bar', () => {
    const svg = draw('zener');
    expect(svg).toContain('M-10 -10L10 0L-10 10Z');
    expect(svg).toContain('M4 -14L10 -10V10L16 14');
    expect(svg).not.toContain('M10 -10V10');
    expect(svg).toContain('class="hit" x="-40" y="-20" width="80" height="40"');
  });

  it('round trips through drawing files', () => {
    const schematic = addComponent(EMPTY_SCHEMATIC, 'zener', { x: 3, y: 8 }, 1);
    expect(parseSchematic(serializeSchematic(schematic))).toEqual(schematic);
  });
});

describe('drawing LEDs', () => {
  it('names them LED1 and LED2 and starts at a 2 V threshold', () => {
    expect(COMPONENT_KINDS).toContain('led');
    const first = addComponent(EMPTY_SCHEMATIC, 'led', { x: 0, y: 0 });
    const second = addComponent(first, 'led', { x: 4, y: 0 });
    expect((first.items[0] as ComponentItem).label).toBe('LED1');
    expect((second.items[1] as ComponentItem).label).toBe('LED2');
    expect(DEFAULT_VALUE.led.toString()).toBe('2');
    expect(UNIT_OF.led).toBe('V');
  });

  it('needs a positive threshold', () => {
    expect(isComponentValueValid('led', Fraction.from('1.8'))).toBe(true);
    expect(isComponentValueValid('led', Fraction.ZERO)).toBe(false);
  });

  it.each([0, 1, 2, 3] as const)('rotation %i: solved as a diode with its own threshold', (rotation) => {
    const schematic = addComponent(EMPTY_SCHEMATIC, 'led', { x: 5, y: 7 }, rotation);
    const item = schematic.items[0] as ComponentItem;
    const [anode, cathode] = terminalsOf(item);
    const element = toCircuit(schematic).elements.find((candidate) => candidate.kind === 'diode');
    expect(element).toMatchObject({
      kind: 'diode',
      id: item.id,
      anode: `${anode!.x},${anode!.y}`,
      cathode: `${cathode!.x},${cathode!.y}`,
    });
    if (element?.kind !== 'diode') throw new Error('no diode');
    expect(element.threshold.toString()).toBe('2');
  });

  it('draws a diode with two arrows pointing out', () => {
    const svg = draw('led');
    expect(svg).toContain('M-10 -10L10 0L-10 10Z');
    expect(svg).toContain('M10 -10V10');
    expect(svg).toContain('M0 -14L8 -22');
    expect(svg).toContain('M8 -12L16 -20');
    expect(svg).toContain('class="hit" x="-40" y="-20" width="80" height="40"');
  });

  it('round trips through drawing files', () => {
    const schematic = addComponent(EMPTY_SCHEMATIC, 'led', { x: 3, y: 8 }, 2);
    expect(parseSchematic(serializeSchematic(schematic))).toEqual(schematic);
  });

  it('writes its name upright in the equations', () => {
    expect(nameTex('LED1')).toBe('\\mathrm{LED}_{\\mathrm{1}}');
    expect(nameTex('LED')).toBe('\\mathrm{LED}');
    expect(nameTex('Z1')).toBe('Z_{\\mathrm{1}}');
    expect(nameTex('D1')).toBe('D_{\\mathrm{1}}');

    const solution = solveWithSteps({
      elements: [voltageSource('E', 'a', 'gnd', 5), diode('LED1', 'a', 'b', 2), resistor('R', 'b', 'gnd', 150), ground('G', 'gnd')],
    });
    if (solution.status !== 'solved') throw new Error('not solved');
    const view = stepView(solution.steps[0]!, 'entering-equals-leaving', (id) => id);
    expect(view.lines.map(({ tex }) => tex)).toEqual(['V_{\\mathrm{LED}_{\\mathrm{1}}} = 5\\,\\text{V} > 2\\,\\text{V}']);
    expect(view.facts).toEqual([tr.learn.diode.on.replace('{name}', 'LED1').replace('{threshold}', '2 V')]);
  });
});

describe('the toolbar, the panel and the shortcuts', () => {
  it('names the tools and the value', () => {
    expect(tr.tools.zener).toBe('Zener diyot');
    expect(tr.tools.led).toBe('LED');
    expect(tr.inspector.zenerVoltage).toBe('Zener gerilimi');
  });

  it('gives the Zener Z and leaves the LED for the student to assign', () => {
    expect(ACTION_IDS).toContain('zener');
    expect(ACTION_IDS).toContain('led');
    expect(DEFAULT_BINDINGS.zener).toBe('Z');
    expect(DEFAULT_BINDINGS.led).toBeNull();
  });
});

describe('the examples', () => {
  const solvedExample = (id: (typeof EXAMPLE_IDS)[number]) => {
    const schematic = buildExample(id);
    const result = analyze(toCircuit(schematic));
    if (result.status !== 'solved') throw new Error(result.issues.map((issue) => issue.code).join(', '));
    return { schematic, result };
  };

  it('adds the Zener regulator and the LED circuit after the diode example', () => {
    // Task 22 put the two transistor examples after these three.
    expect(EXAMPLE_IDS.slice(-5, -2)).toEqual(['diode-series', 'zener-regulator', 'led-series']);
    expect(tr.examples['zener-regulator']).toBe('Zener regülatör');
    expect(tr.examples['led-series']).toBe('LED’li seri devre');
  });

  it('regulates: 15 V, 1 kΩ, a 10 V Zener and a 3 kΩ load give IZ = 1,667 mA', () => {
    const { schematic, result } = solvedExample('zener-regulator');
    const kinds = schematic.items.map(({ kind }) => kind).sort();
    expect(kinds.filter((kind) => kind === 'resistor')).toHaveLength(2);
    const z = schematic.items.find((item) => item.kind === 'zener');
    if (!z) throw new Error('no zener');
    expect(result.elements.get(z.id)?.current?.toString()).toBe('-1/600');
    expect(result.elements.get(z.id)?.voltage.toString()).toBe('-10');
  });

  it('lights the LED: 5 V, 150 Ω and a 2 V LED give 20 mA', () => {
    const { schematic, result } = solvedExample('led-series');
    const led = schematic.items.find((item) => item.kind === 'led');
    if (!led) throw new Error('no led');
    expect(result.elements.get(led.id)?.current?.toString()).toBe('1/50');
  });
});
