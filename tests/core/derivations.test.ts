import { describe, expect, it } from 'vitest';
import {
  currentSource,
  diode,
  ground,
  npn,
  resistor,
  solveWithSteps,
  voltageSource,
  zener,
  type Circuit,
  type SolutionStep,
} from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { stepView } from '../../src/ui/steps-panel/step-views';

/**
 * Task 23: numbers that used to appear from nowhere now come with the line that produces them.
 * - The voltage across a removed diode, when a two-resistor divider gives it: V = RL / (RS + RL) · Vi.
 * - Each resistor's current, by Ohm's law from the node voltages.
 * - A conducting diode's current, by Kirchhoff's Current Law at one of its nodes: IZ = IR − IL.
 * Values below are ours, not the notes' questions.
 */

type Solved = Extract<ReturnType<typeof solveWithSteps>, { status: 'solved' }>;
type StepOf<T extends SolutionStep['type']> = Extract<SolutionStep, { type: T }>;

function solved(circuit: Circuit): Solved {
  const solution = solveWithSteps(circuit);
  if (solution.status !== 'solved') {
    throw new Error(`Not solved: ${solution.issues.map((issue) => issue.code).join(', ')}`);
  }
  return solution;
}

const stepOf = <T extends SolutionStep['type']>(circuit: Circuit, type: T): StepOf<T> => {
  const step = solved(circuit).steps.find((candidate): candidate is StepOf<T> => candidate.type === type);
  if (!step) throw new Error(`no ${type} step`);
  return step;
};

const viewOf = (circuit: Circuit, type: SolutionStep['type']) =>
  solved(circuit)
    .steps.map((step) => stepView(step, 'entering-equals-leaving', (id) => id))
    .find((view) => view.type === type)!;

const texts = (circuit: Circuit, type: SolutionStep['type']): string[] => viewOf(circuit, type).lines.map(({ tex }) => tex);

/** Vi = 15 V, RS = 1 kΩ, a 10 V Zener and the load RL across it. Node A is the source, node B the Zener. */
const regulator = (load: number): Circuit => ({
  elements: [
    voltageSource('Vi', 'a', 'gnd', 15),
    resistor('RS', 'a', 'b', 1000),
    zener('Z1', 'gnd', 'b', 10),
    resistor('RL', 'b', 'gnd', load),
    ground('G', 'gnd'),
  ],
});

/** The same regulator with the Zener turned round, so it conducts forward. */
const forward: Circuit = {
  elements: [
    voltageSource('Vi', 'a', 'gnd', 15),
    resistor('RS', 'a', 'b', 1000),
    zener('Z1', 'b', 'gnd', 10),
    resistor('RL', 'b', 'gnd', 3000),
    ground('G', 'gnd'),
  ],
};

/** A plain diode across the lower resistor of a divider: 12 V · 1 k / (3 k + 1 k) = 3 V > 0,7 V. */
const diodeOnDivider: Circuit = {
  elements: [
    voltageSource('V1', 'a', 'gnd', 12),
    resistor('R1', 'a', 'b', 3000),
    resistor('R2', 'b', 'gnd', 1000),
    diode('D1', 'b', 'gnd'),
    ground('G', 'gnd'),
  ],
};

/** 10 V, a diode and 1 kΩ in series: I = (10 − 0,7) / 1 k = 9,3 mA. */
const series: Circuit = {
  elements: [voltageSource('E', 'a', 'gnd', 10), diode('D1', 'a', 'b'), resistor('R', 'b', 'gnd', 1000), ground('G', 'gnd')],
};

/** Two diodes in series: I = (10 − 1,4) / 1 k = 8,6 mA. */
const twoInSeries: Circuit = {
  elements: [
    voltageSource('E', 'a', 'gnd', 10),
    diode('D1', 'a', 'm'),
    diode('D2', 'm', 'b'),
    resistor('R', 'b', 'gnd', 1000),
    ground('G', 'gnd'),
  ],
};

/**
 * 2 mA into node A, which R2 = 1 kΩ ties to ground; a diode leads on to node B and R1 = 1 kΩ.
 * VA − VB = 0,7 and VA + VB = 2, so VA = 1,35 V and VB = 0,65 V.
 */
const fedByCurrentSource: Circuit = {
  elements: [
    currentSource('I1', 'gnd', 'a', '0.002'),
    resistor('R2', 'a', 'gnd', 1000),
    diode('D1', 'a', 'b'),
    resistor('R1', 'b', 'gnd', 1000),
    ground('G', 'gnd'),
  ],
};

/** A source of −5 V: the current through R1 flows from ground up to node A. */
const negativeSource: Circuit = {
  elements: [voltageSource('V1', 'a', 'gnd', -5), resistor('R1', 'a', 'gnd', 1000), ground('G', 'gnd')],
};

const fixedBias: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 12),
    resistor('RB', 'vcc', 'b', 226000),
    resistor('RC', 'vcc', 'c', 1000),
    npn('Q1', 'b', 'c', 'gnd'),
    ground('G', 'gnd'),
  ],
};

describe('where the voltage across a removed diode comes from', () => {
  it('names the divider when two resistors and a source to ground give it', () => {
    expect(stepOf(regulator(3000), 'diode-states').diodes[0]?.divider).toMatchObject({
      sourceId: 'Vi',
      upperId: 'RS',
      lowerId: 'RL',
      sign: 1,
    });
    expect(stepOf(diodeOnDivider, 'diode-states').diodes[0]?.divider).toMatchObject({
      sourceId: 'V1',
      upperId: 'R1',
      lowerId: 'R2',
      sign: 1,
    });
  });

  it('turns the sign round when the diode is measured the other way', () => {
    expect(stepOf(forward, 'diode-states').diodes[0]?.divider).toMatchObject({ sourceId: 'Vi', sign: -1 });
  });

  it('names nothing when the circuit is not that simple', () => {
    // No divider: the diode sits between the source and a single resistor.
    expect(stepOf(series, 'diode-states').diodes[0]?.divider).toBeNull();
    // Taken out, both diodes leave an end floating.
    expect(stepOf(twoInSeries, 'diode-states').diodes.map(({ divider }) => divider)).toEqual([null, null]);
    // A third resistor at the node.
    const threeResistors: Circuit = { elements: [...regulator(3000).elements, resistor('R3', 'b', 'gnd', 3000)] };
    expect(stepOf(threeResistors, 'diode-states').diodes[0]?.divider).toBeNull();
    // The source has its minus on the divider's side, so its name would not stand for the node's voltage.
    const turnedSource: Circuit = {
      elements: [
        voltageSource('Vi', 'gnd', 'a', -15),
        resistor('RS', 'a', 'b', 1000),
        zener('Z1', 'gnd', 'b', 10),
        resistor('RL', 'b', 'gnd', 3000),
        ground('G', 'gnd'),
      ],
    };
    expect(stepOf(turnedSource, 'diode-states').diodes[0]?.divider).toBeNull();
  });

  it('writes the divider above the comparison, with names and then with values', () => {
    const view = viewOf(regulator(3000), 'diode-states');
    expect(view.lines).toEqual([
      {
        caption: tr.learn.diode.open.replace('{name}', 'Z1'),
        tex: 'V_{Z_{\\mathrm{1}}} = \\frac{R_{\\mathrm{L}}}{R_{\\mathrm{S}} + R_{\\mathrm{L}}} \\cdot V_{\\mathrm{i}} = \\frac{3\\,\\text{k}}{1\\,\\text{k} + 3\\,\\text{k}} \\cdot 15',
      },
      { tex: 'V_{Z_{\\mathrm{1}}} = 11{,}25\\,\\text{V} \\geq 10\\,\\text{V}' },
    ]);
    expect(tr.learn.diode.open).toBe('{name} çıkarılınca');
  });

  it('does the same for a Zener that stays off and for a plain diode', () => {
    expect(texts(regulator(1000), 'diode-states')).toEqual([
      'V_{Z_{\\mathrm{1}}} = \\frac{R_{\\mathrm{L}}}{R_{\\mathrm{S}} + R_{\\mathrm{L}}} \\cdot V_{\\mathrm{i}} = \\frac{1\\,\\text{k}}{1\\,\\text{k} + 1\\,\\text{k}} \\cdot 15',
      'V_{Z_{\\mathrm{1}}} = 7{,}5\\,\\text{V} < 10\\,\\text{V}',
    ]);
    expect(texts(diodeOnDivider, 'diode-states')).toEqual([
      'V_{D_{\\mathrm{1}}} = \\frac{R_{\\mathrm{2}}}{R_{\\mathrm{1}} + R_{\\mathrm{2}}} \\cdot V_{\\mathrm{1}} = \\frac{1\\,\\text{k}}{3\\,\\text{k} + 1\\,\\text{k}} \\cdot 12',
      'V_{D_{\\mathrm{1}}} = 3\\,\\text{V} > 0{,}7\\,\\text{V}',
    ]);
  });

  it('puts a minus in front when the diode is measured against the divider', () => {
    expect(texts(forward, 'diode-states')).toEqual([
      'V_{Z_{\\mathrm{1}}} = -\\frac{R_{\\mathrm{L}}}{R_{\\mathrm{S}} + R_{\\mathrm{L}}} \\cdot V_{\\mathrm{i}} = -\\frac{3\\,\\text{k}}{1\\,\\text{k} + 3\\,\\text{k}} \\cdot 15',
      'V_{Z_{\\mathrm{1}}} = -11{,}25\\,\\text{V} \\leq -0{,}7\\,\\text{V}',
    ]);
  });

  it('leaves the step as it was when there is no divider', () => {
    expect(texts(series, 'diode-states')).toEqual(['V_{D_{\\mathrm{1}}} = 10\\,\\text{V} > 0{,}7\\,\\text{V}']);
    expect(texts(twoInSeries, 'diode-states')).toEqual([]);
  });
});

describe('how each current is found', () => {
  it('lists Ohm’s law for every resistor, then the diodes that conduct', () => {
    expect(stepOf(regulator(3000), 'element-results').derivations).toMatchObject([
      { kind: 'ohm', elementId: 'RS' },
      { kind: 'ohm', elementId: 'RL' },
      { kind: 'kcl', elementId: 'Z1', plus: ['RS'], minus: ['RL'] },
    ]);
  });

  it('writes the regulator as the notes do: IR, IL, then IZ = IR − IL', () => {
    const view = viewOf(regulator(3000), 'element-results');
    expect(view.lines).toEqual([
      {
        caption: tr.learn.elements.ohm,
        tex: 'I_{R_{\\mathrm{S}}} = \\frac{V_{A} - V_{B}}{R_{\\mathrm{S}}} = \\frac{15 - 10}{1\\,\\text{k}} = \\text{5 mA}',
      },
      { tex: 'I_{R_{\\mathrm{L}}} = \\frac{V_{B}}{R_{\\mathrm{L}}} = \\frac{10}{3\\,\\text{k}} = \\text{3,333 mA}' },
      {
        caption: tr.learn.elements.kcl,
        tex: 'I_{Z_{\\mathrm{1}}} = I_{R_{\\mathrm{S}}} - I_{R_{\\mathrm{L}}} = \\text{5 mA} - \\text{3,333 mA} = \\text{1,667 mA}',
      },
    ]);
    expect(tr.learn.elements.ohm).toBe('Ohm Kanunu');
    expect(tr.learn.elements.kcl).toBe('Kirchhoff’un Akım Kanunu');
    // The table stays below the lines.
    expect(view.rows.map(({ name }) => name)).toEqual(['Vi', 'RS', 'RL', 'Z1']);
  });

  it('writes no line for a diode that carries no current', () => {
    expect(stepOf(regulator(1000), 'element-results').derivations.map(({ kind, elementId }) => [kind, elementId])).toEqual([
      ['ohm', 'RS'],
      ['ohm', 'RL'],
    ]);
    expect(texts(regulator(1000), 'element-results')).toEqual([
      'I_{R_{\\mathrm{S}}} = \\frac{V_{A} - V_{B}}{R_{\\mathrm{S}}} = \\frac{15 - 7{,}5}{1\\,\\text{k}} = \\text{7,5 mA}',
      'I_{R_{\\mathrm{L}}} = \\frac{V_{B}}{R_{\\mathrm{L}}} = \\frac{7{,}5}{1\\,\\text{k}} = \\text{7,5 mA}',
    ]);
  });

  it('says a series diode carries the resistor’s current, without repeating the number', () => {
    expect(texts(series, 'element-results')).toEqual([
      'I_{R} = \\frac{V_{B}}{R} = \\frac{9{,}3}{1\\,\\text{k}} = \\text{9,3 mA}',
      'I_{D_{\\mathrm{1}}} = I_{R} = \\text{9,3 mA}',
    ]);
  });

  it('works along a chain: a diode whose only neighbour is a diode already found', () => {
    expect(stepOf(twoInSeries, 'element-results').derivations).toMatchObject([
      { kind: 'ohm', elementId: 'R' },
      { kind: 'kcl', elementId: 'D2', plus: ['R'], minus: [] },
      { kind: 'kcl', elementId: 'D1', plus: ['D2'], minus: [] },
    ]);
    expect(texts(twoInSeries, 'element-results').slice(1)).toEqual([
      'I_{D_{\\mathrm{2}}} = I_{R} = \\text{8,6 mA}',
      'I_{D_{\\mathrm{1}}} = I_{D_{\\mathrm{2}}} = \\text{8,6 mA}',
    ]);
  });

  it('counts a current source at the node by its own name', () => {
    expect(texts(fedByCurrentSource, 'element-results')).toEqual([
      'I_{R_{\\mathrm{2}}} = \\frac{V_{A}}{R_{\\mathrm{2}}} = \\frac{1{,}35}{1\\,\\text{k}} = \\text{1,35 mA}',
      'I_{R_{\\mathrm{1}}} = \\frac{V_{B}}{R_{\\mathrm{1}}} = \\frac{0{,}65}{1\\,\\text{k}} = \\text{650 µA}',
      'I_{D_{\\mathrm{1}}} = I_{\\mathrm{1}} - I_{R_{\\mathrm{2}}} = \\text{2 mA} - \\text{1,35 mA} = \\text{650 µA}',
    ]);
  });

  it('writes the current from the higher voltage to the lower, so it is never negative', () => {
    expect(texts(negativeSource, 'element-results')).toEqual([
      'I_{R_{\\mathrm{1}}} = \\frac{0 - V_{A}}{R_{\\mathrm{1}}} = \\frac{0 - \\left(-5\\right)}{1\\,\\text{k}} = \\text{5 mA}',
    ]);
    // Drawn the other way round, the resistor reads the same.
    const turned: Circuit = {
      elements: [voltageSource('V1', 'a', 'gnd', 5), resistor('R1', 'gnd', 'a', 1000), ground('G', 'gnd')],
    };
    expect(texts(turned, 'element-results')).toEqual([
      'I_{R_{\\mathrm{1}}} = \\frac{V_{A}}{R_{\\mathrm{1}}} = \\frac{5}{1\\,\\text{k}} = \\text{5 mA}',
    ]);
  });

  it('adds nothing to a transistor circuit, where the loops already give the currents', () => {
    expect(stepOf(fixedBias, 'element-results').derivations).toEqual([]);
    expect(viewOf(fixedBias, 'element-results').lines).toEqual([]);
  });
});

/**
 * Review of task 23: the node voltages belong to the solved equivalent, whose node numbers can differ
 * from the drawn circuit's. A diode drawn first and then dropped (off), or a Zener drawn first and turned
 * round into a source (breakdown), used to shift the numbers and put the wrong node on a resistor's line.
 */
describe('Task 23 review: lines name the nodes the node-voltages step names', () => {
  /** D1 is reversed and off; R2 sits on B only. 12 V · 1 k / (1 k + 1 k) = 6 V at B. */
  const offDiodeFirst: Circuit = {
    elements: [
      diode('D1', 'gnd', 'b'),
      voltageSource('V1', 'a', 'gnd', 12),
      resistor('R1', 'a', 'b', 1000),
      resistor('R2', 'b', 'gnd', 1000),
      ground('G', 'gnd'),
    ],
  };

  /** Z1 breaks down at 5 V between B (cathode) and C (anode): (12 − 5) / 2 k = 3,5 mA. */
  const zenerFirst: Circuit = {
    elements: [
      zener('Z1', 'c', 'b', 5),
      voltageSource('V1', 'a', 'gnd', 12),
      resistor('R1', 'a', 'b', 1000),
      resistor('R2', 'c', 'gnd', 1000),
      ground('G', 'gnd'),
    ],
  };

  it.each([['off diode drawn first', offDiodeFirst], ['Zener in breakdown drawn first', zenerFirst]])(
    '%s: every Ohm line uses the node voltages and the current of its own resistor',
    (_, circuit) => {
      const steps = solved(circuit).steps;
      const nodeStep = steps.find((step): step is StepOf<'node-voltages'> => step.type === 'node-voltages')!;
      const resultStep = steps.find((step): step is StepOf<'element-results'> => step.type === 'element-results')!;
      const voltageOf = new Map(nodeStep.values.map(({ node, voltage }) => [node, voltage]));
      const ohms = resultStep.derivations.filter((derivation) => derivation.kind === 'ohm');
      expect(ohms).toHaveLength(2);
      for (const derivation of ohms) {
        if (derivation.kind !== 'ohm') continue;
        const at = (node: typeof derivation.from) => (node === 0 ? 0 : voltageOf.get(node)!.toNumber());
        expect(derivation.fromVoltage.toNumber()).toBe(at(derivation.from));
        expect(derivation.toVoltage.toNumber()).toBe(at(derivation.to));
        const current = resultStep.results.find(({ elementId }) => elementId === derivation.elementId)!.current!;
        const magnitude = current.num < 0n ? current.neg() : current;
        expect(derivation.current.equals(magnitude)).toBe(true);
        expect(derivation.fromVoltage.sub(derivation.toVoltage).div(derivation.resistance).equals(magnitude)).toBe(true);
      }
    },
  );

  it('off diode drawn first: R2 reads 6 / 1 k from node B', () => {
    expect(texts(offDiodeFirst, 'element-results')).toEqual([
      'I_{R_{\\mathrm{1}}} = \\frac{V_{A} - V_{B}}{R_{\\mathrm{1}}} = \\frac{12 - 6}{1\\,\\text{k}} = \\text{6 mA}',
      'I_{R_{\\mathrm{2}}} = \\frac{V_{B}}{R_{\\mathrm{2}}} = \\frac{6}{1\\,\\text{k}} = \\text{6 mA}',
    ]);
  });

  it('Zener in breakdown drawn first: its current comes from the resistor on its anode', () => {
    expect(stepOf(zenerFirst, 'element-results').derivations).toMatchObject([
      { kind: 'ohm', elementId: 'R1' },
      { kind: 'ohm', elementId: 'R2' },
      { kind: 'kcl', elementId: 'Z1', plus: ['R2'], minus: [] },
    ]);
    expect(texts(zenerFirst, 'element-results')[2]).toBe('I_{Z_{\\mathrm{1}}} = I_{R_{\\mathrm{2}}} = \\text{3,5 mA}');
  });
});
