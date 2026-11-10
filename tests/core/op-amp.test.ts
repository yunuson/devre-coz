import { describe, expect, it } from 'vitest';
import {
  analyze,
  arrangeKcl,
  buildMnaSystem,
  buildNetlist,
  findVoltageSourceLoops,
  Fraction,
  ground,
  opAmp,
  resistor,
  solveMna,
  solveNodal,
  solveWithSteps,
  voltageAt,
  voltageSource,
  wire,
  currentSource,
  type Circuit,
  type CircuitElement,
  type Solution,
  type SolutionStep,
} from '../../src/core';
import { randomCircuit } from './random-circuit';

type Solved = Extract<ReturnType<typeof analyze>, { status: 'solved' }>;
type StepOf<T extends SolutionStep['type']> = Extract<SolutionStep, { type: T }>;

function solved(circuit: Circuit): Solved {
  const result = analyze(circuit);
  if (result.status !== 'solved') {
    throw new Error(`Not solved: ${result.issues.map((issue) => issue.code).join(', ')}`);
  }
  return result;
}

const volts = (result: Solved, point: string): string | undefined => voltageAt(result, point)?.toString();

function stepsOf<T extends SolutionStep['type']>(solution: Solution, type: T): StepOf<T>[] {
  if (solution.status !== 'solved') throw new Error('not solved');
  return solution.steps.filter((step): step is StepOf<T> => step.type === type);
}

/** Vo = −(Rf / R1) · Vi */
const invertingAmp = (vi: number, r1: number, rf: number): CircuitElement[] => [
  voltageSource('Vi', 'in', 'gnd', vi),
  resistor('R1', 'in', 'x', r1),
  resistor('Rf', 'x', 'out', rf),
  opAmp('U1', 'x', 'gnd', 'out'),
  ground('G', 'gnd'),
];

describe('the circuits in the course notes', () => {
  it('inverting amplifier: Vo = −(Rf / R1) · Vi', () => {
    const result = solved({ elements: invertingAmp(2, 1000, 5000) });
    expect(volts(result, 'out')).toBe('-10');
    expect(volts(result, 'x')).toBe('0');
    expect(result.issues).toEqual([]);
  });

  it('non-inverting amplifier: Vo = (1 + Rf / R1) · Vi', () => {
    const result = solved({
      elements: [
        voltageSource('Vi', 'plus', 'gnd', 1),
        opAmp('U1', 'x', 'plus', 'out'),
        resistor('R1', 'x', 'gnd', 1000),
        resistor('Rf', 'x', 'out', 4000),
        ground('G', 'gnd'),
      ],
    });
    expect(volts(result, 'out')).toBe('5');
    expect(volts(result, 'x')).toBe('1');
  });

  it('voltage follower: Vo = Vi', () => {
    const result = solved({
      elements: [
        voltageSource('Vi', 'plus', 'gnd', 3),
        opAmp('U1', 'out', 'plus', 'out'),
        resistor('RL', 'out', 'gnd', 1000),
        ground('G', 'gnd'),
      ],
    });
    expect(volts(result, 'out')).toBe('3');
  });

  it('summing amplifier: Vo = −Rf · (V1/R1 + V2/R2 + V3/R3)', () => {
    const result = solved({
      elements: [
        voltageSource('V1', 'a', 'gnd', 1),
        voltageSource('V2', 'b', 'gnd', 2),
        voltageSource('V3', 'c', 'gnd', -1),
        resistor('R1', 'a', 'x', 1000),
        resistor('R2', 'b', 'x', 1000),
        resistor('R3', 'c', 'x', 1000),
        resistor('Rf', 'x', 'out', 2000),
        opAmp('U1', 'x', 'gnd', 'out'),
        ground('G', 'gnd'),
      ],
    });
    expect(volts(result, 'out')).toBe('-4');
  });

  it('difference amplifier: Vo = (R3 / (R2 + R3)) · (1 + Rf / R1) · V2 − (Rf / R1) · V1', () => {
    const result = solved({
      elements: [
        voltageSource('V1', 'a', 'gnd', 1),
        voltageSource('V2', 'b', 'gnd', 3),
        resistor('R1', 'a', 'minus', 1000),
        resistor('Rf', 'minus', 'out', 1000),
        resistor('R2', 'b', 'plus', 1000),
        resistor('R3', 'plus', 'gnd', 1000),
        opAmp('U1', 'minus', 'plus', 'out'),
        ground('G', 'gnd'),
      ],
    });
    expect(volts(result, 'out')).toBe('2');
    expect(volts(result, 'minus')).toBe('3/2');
    expect(volts(result, 'plus')).toBe('3/2');
  });
});

describe('op-amps in larger circuits', () => {
  it('two stages in a row multiply their gains', () => {
    const result = solved({
      elements: [
        voltageSource('Vi', 'in', 'gnd', 1),
        opAmp('U1', 'x1', 'in', 'mid'),
        resistor('R1', 'x1', 'gnd', 1000),
        resistor('R2', 'x1', 'mid', 1000),
        resistor('R3', 'mid', 'x2', 1000),
        resistor('R4', 'x2', 'out', 1000),
        opAmp('U2', 'x2', 'gnd', 'out'),
        ground('G', 'gnd'),
      ],
    });
    expect(volts(result, 'mid')).toBe('2');
    expect(volts(result, 'out')).toBe('-2');
  });

  it('a load on the output does not change its voltage, only the current it supplies', () => {
    const result = solved({
      elements: [...invertingAmp(1, 1000, 2000), resistor('RL', 'out', 'gnd', 1000)],
    });
    expect(volts(result, 'out')).toBe('-2');
    // The output pulls 2 mA through the load and 1 mA through Rf.
    expect(result.elements.get('U1')?.current?.toString()).toBe('3/1000');
  });

  it('a current source into the virtual ground works as a current-to-voltage converter', () => {
    const result = solved({
      elements: [
        currentSource('I1', 'gnd', 'x', '0.001'),
        resistor('Rf', 'x', 'out', 2000),
        opAmp('U1', 'x', 'gnd', 'out'),
        ground('G', 'gnd'),
      ],
    });
    expect(volts(result, 'out')).toBe('-2');
  });

  /** U1 sums Vi and the fed-back output of U2, an inverter with a gain of −1. */
  const loopThroughInverter = (minus: string, plus: string): CircuitElement[] => [
    voltageSource('Vi', 'in', 'gnd', 1),
    resistor('R1', 'in', 'sum', 1000),
    resistor('R2', 'out2', 'sum', 1000),
    opAmp('U1', minus, plus, 'out1'),
    resistor('R3', 'out1', 'x', 1000),
    resistor('R4', 'x', 'out2', 1000),
    opAmp('U2', 'x', 'gnd', 'out2'),
    ground('G', 'gnd'),
  ];

  it('an inverter in the feedback path turns the + input into the one to feed back to', () => {
    const result = solved({ elements: loopThroughInverter('gnd', 'sum') });
    expect(volts(result, 'sum')).toBe('0');
    expect(volts(result, 'out2')).toBe('-1');
    expect(volts(result, 'out1')).toBe('1');
  });

  it('the same loop into the − input is positive feedback overall', () => {
    expect(analyze({ elements: loopThroughInverter('sum', 'gnd') }).issues.map((issue) => issue.code)).toEqual([
      'op-amp-positive-feedback',
    ]);
  });

  it('a supernode on an input moves its voltage by the source between them', () => {
    const result = solved({
      elements: [
        voltageSource('Vi', 'in', 'gnd', 2),
        resistor('R1', 'in', 'a', 1000),
        voltageSource('Vs', 'x', 'a', 1),
        resistor('R2', 'x', 'gnd', 1000),
        opAmp('U1', 'y', 'a', 'out'),
        resistor('R3', 'y', 'gnd', 1000),
        resistor('Rf', 'y', 'out', 1000),
        ground('G', 'gnd'),
      ],
    });
    // The current from Vi flows through R1, Vs and R2: 2 = 1000·i + (−1) + 1000·i, so i = 3/2 mA.
    expect(volts(result, 'a')).toBe('1/2');
    expect(volts(result, 'x')).toBe('3/2');
    expect(volts(result, 'y')).toBe('1/2');
    expect(volts(result, 'out')).toBe('1');
  });

  it('wires are followed like any other connection', () => {
    const result = solved({
      elements: [
        ...invertingAmp(2, 1000, 5000),
        wire('W', 'out', 'far'),
      ],
    });
    expect(volts(result, 'far')).toBe('-10');
  });
});

describe('power', () => {
  it('balances, with the op-amp delivering power from its unseen supplies', () => {
    const { elements } = solved({
      elements: [...invertingAmp(1, 1000, 2000), resistor('RL', 'out', 'gnd', 1000)],
    });
    const power = (id: string): string | undefined => elements.get(id)?.power?.toString();
    expect(power('Vi')).toBe('-1/1000');
    expect(power('R1')).toBe('1/1000');
    expect(power('Rf')).toBe('1/500');
    expect(power('RL')).toBe('1/250');
    expect(power('U1')).toBe('-3/500');
  });
});

describe('problems an op-amp can have', () => {
  const codes = (circuit: Circuit): string[] => analyze(circuit).issues.map((issue) => issue.code);

  it('no feedback: the output never reaches the inputs', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('Vi', 'in', 'gnd', 1),
        opAmp('U1', 'gnd', 'in', 'out'),
        resistor('RL', 'out', 'gnd', 1000),
        ground('G', 'gnd'),
      ],
    };
    expect(codes(circuit)).toEqual(['op-amp-no-feedback']);
    expect(analyze(circuit).status).toBe('invalid');
  });

  it('positive feedback: the inputs swapped, which the equations alone would accept', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('Vi', 'in', 'gnd', 2),
        resistor('R1', 'in', 'x', 1000),
        resistor('Rf', 'x', 'out', 5000),
        opAmp('U1', 'gnd', 'x', 'out'),
        ground('G', 'gnd'),
      ],
    };
    expect(codes(circuit)).toEqual(['op-amp-positive-feedback']);
    expect(analyze(circuit).status).toBe('invalid');
  });

  it('positive feedback in a non-inverting layout', () => {
    expect(
      codes({
        elements: [
          voltageSource('Vi', 'minus', 'gnd', 1),
          opAmp('U1', 'minus', 'plus', 'out'),
          resistor('R1', 'plus', 'gnd', 1000),
          resistor('Rf', 'plus', 'out', 4000),
          ground('G', 'gnd'),
        ],
      }),
    ).toEqual(['op-amp-positive-feedback']);
  });

  it('no feedback is the real problem when the output only feeds a resistor going nowhere', () => {
    expect(
      codes({
        elements: [
          voltageSource('Vi', 'in', 'gnd', 1),
          opAmp('U1', 'gnd', 'in', 'out'),
          resistor('RL', 'out', 'nowhere', 1000),
          ground('G', 'gnd'),
        ],
      }),
    ).toEqual(['op-amp-no-feedback']);
  });

  it('input rules that contradict each other have no solution in either method', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('Vi', 'in', 'gnd', 1),
        resistor('R1', 'in', 'a', 1000),
        resistor('Rf1', 'a', 'o1', 1000),
        voltageSource('Vs', 'a2', 'a', 1),
        opAmp('U1', 'a', 'b', 'o1'),
        opAmp('U2', 'b', 'a2', 'o2'),
        resistor('Rf2', 'b', 'o2', 1000),
        resistor('R3', 'b', 'gnd', 1000),
        ground('G', 'gnd'),
      ],
    };
    // V(a) = V(b) from U1, but V(b) = V(a) + 1 from U2.
    expect(analyze(circuit).status).toBe('invalid');
    const netlist = buildNetlist(circuit);
    expect(solveNodal(netlist, new Set())).toBeNull();
    expect(solveMna(netlist, new Set())).toBeNull();
  });

  it('an input left open', () => {
    expect(
      codes({
        elements: [
          opAmp('U1', 'out', 'open', 'out'),
          resistor('RL', 'out', 'gnd', 1000),
          ground('G', 'gnd'),
        ],
      }),
    ).toEqual(['op-amp-input-open']);
  });

  it('an input whose only connection is a resistor leading nowhere', () => {
    expect(
      codes({
        elements: [
          opAmp('U1', 'out', 'plus', 'out'),
          resistor('Rs', 'plus', 'nowhere', 1000),
          resistor('RL', 'out', 'gnd', 1000),
          ground('G', 'gnd'),
        ],
      }),
    ).toEqual(['op-amp-input-open']);
  });

  it('an input between two current sources that cancel out has no set voltage', () => {
    expect(
      codes({
        elements: [
          currentSource('I1', 'gnd', 'plus', 1),
          currentSource('I2', 'plus', 'gnd', 1),
          opAmp('U1', 'out', 'plus', 'out'),
          resistor('RL', 'out', 'gnd', 1000),
          ground('G', 'gnd'),
        ],
      }),
    ).toEqual(['undetermined-voltage']);
  });

  it('a current source into an input has nowhere to go', () => {
    expect(
      codes({
        elements: [
          currentSource('I1', 'gnd', 'plus', 1),
          opAmp('U1', 'out', 'plus', 'out'),
          resistor('RL', 'out', 'gnd', 1000),
          ground('G', 'gnd'),
        ],
      }),
    ).toEqual(['current-source-no-path']);
  });

  it('an output held to ground', () => {
    expect(
      codes({
        elements: [
          voltageSource('Vi', 'in', 'gnd', 1),
          resistor('R1', 'in', 'x', 1000),
          opAmp('U1', 'x', 'gnd', 'gnd'),
          ground('G', 'gnd'),
        ],
      }),
    ).toEqual(['op-amp-output-shorted']);
  });

  it('an output held by a voltage source', () => {
    expect(
      codes({
        elements: [
          voltageSource('V1', 'out', 'gnd', 5),
          resistor('R1', 'out', 'x', 1000),
          resistor('R2', 'x', 'gnd', 1000),
          opAmp('U1', 'x', 'gnd', 'out'),
          ground('G', 'gnd'),
        ],
      }),
    ).toEqual(['op-amp-output-shorted']);
  });

  it('two outputs joined', () => {
    const issues = analyze({
      elements: [
        voltageSource('V1', 'a', 'gnd', 1),
        voltageSource('V2', 'b', 'gnd', 2),
        opAmp('U1', 'out', 'a', 'out'),
        opAmp('U2', 'out', 'b', 'out'),
        ground('G', 'gnd'),
      ],
    }).issues;
    expect(issues.map((issue) => issue.code)).toEqual(['op-amp-output-shorted', 'op-amp-output-shorted']);
    expect(issues.map((issue) => issue.elementIds[0])).toEqual(['U1', 'U2']);
  });

  it('still needs a ground', () => {
    expect(codes({ elements: [opAmp('U1', 'a', 'b', 'c')] })).toEqual(['no-ground']);
  });

  it('does not call a resistor into an input dangling', () => {
    const result = solved({
      elements: [
        voltageSource('Vi', 'in', 'gnd', 3),
        resistor('Rs', 'in', 'plus', 1000),
        opAmp('U1', 'out', 'plus', 'out'),
        resistor('RL', 'out', 'gnd', 1000),
        ground('G', 'gnd'),
      ],
    });
    expect(result.issues).toEqual([]);
    expect(volts(result, 'out')).toBe('3');
    expect(result.elements.get('Rs')?.current?.isZero()).toBe(true);
  });
});

describe('saturation (ideal answer plus a warning)', () => {
  it('warns past the supply, keeping the ideal answer', () => {
    const result = solved({ elements: invertingAmp(2, 1000, 10000) });
    expect(volts(result, 'out')).toBe('-20');
    expect(result.issues).toEqual([
      { severity: 'warning', code: 'op-amp-saturated', elementIds: ['U1'], wireIds: [] },
    ]);
  });

  it('accepts exactly the supply voltage', () => {
    expect(solved({ elements: invertingAmp(3, 1000, 5000) }).issues).toEqual([]);
  });

  it('uses each op-amp’s own supply', () => {
    const lowSupply: CircuitElement[] = [
      voltageSource('Vi', 'in', 'gnd', 2),
      resistor('R1', 'in', 'x', 1000),
      resistor('Rf', 'x', 'out', 5000),
      opAmp('U1', 'x', 'gnd', 'out', 5),
      ground('G', 'gnd'),
    ];
    expect(solved({ elements: lowSupply }).issues.map((issue) => issue.code)).toEqual(['op-amp-saturated']);
  });
});

describe('the paper solution', () => {
  const inverting = solveWithSteps({ elements: invertingAmp(2, 1000, 5000) });

  it('applies the op-amp rules before writing equations', () => {
    if (inverting.status !== 'solved') throw new Error('not solved');
    expect(inverting.steps.map((step) => step.type)).toEqual([
      'nodes',
      'reference',
      'known-voltages',
      'op-amp',
      'kcl',
      'node-voltages',
      'element-results',
      'verification',
    ]);
  });

  it('recognises the virtual ground', () => {
    const [step] = stepsOf(inverting, 'op-amp');
    expect(step?.opAmps[0]).toMatchObject({ elementId: 'U1', virtualGround: true });
    expect(step?.opAmps[0]?.inputs.offset.isZero()).toBe(true);
  });

  it('recognises a virtual ground on the + input too', () => {
    const solution = solveWithSteps({
      elements: [
        voltageSource('Vi', 'in', 'gnd', 1),
        resistor('R1', 'in', 'sum', 1000),
        resistor('R2', 'out2', 'sum', 1000),
        opAmp('U1', 'gnd', 'sum', 'out1'),
        resistor('R3', 'out1', 'x', 1000),
        resistor('R4', 'x', 'out2', 1000),
        opAmp('U2', 'x', 'gnd', 'out2'),
        ground('G', 'gnd'),
      ],
    });
    expect(stepsOf(solution, 'op-amp')[0]?.opAmps.map((rule) => rule.virtualGround)).toEqual([true, true]);
  });

  it('does not call a known, non-zero input a virtual ground', () => {
    const solution = solveWithSteps({
      elements: [
        voltageSource('Vi', 'plus', 'gnd', 1),
        opAmp('U1', 'x', 'plus', 'out'),
        resistor('R1', 'x', 'gnd', 1000),
        resistor('Rf', 'x', 'out', 4000),
        ground('G', 'gnd'),
      ],
    });
    const rule = stepsOf(solution, 'op-amp')[0]?.opAmps[0];
    expect(rule?.virtualGround).toBe(false);
    expect(rule?.inputs.unknown).toBeNull();
    expect(rule?.inputs.offset.toString()).toBe('1');
  });

  it('writes one current equation, at the input, and none at the output', () => {
    const kcl = stepsOf(inverting, 'kcl');
    expect(kcl).toHaveLength(1);
    expect(kcl[0]?.terms.map((term) => term.elementId)).toEqual(['R1', 'Rf']);
    // (0 − 2)/1000 + (0 − Vo)/5000 = 0, so −Vo/5000 = 1/500.
    expect(kcl[0]?.coefficients.map(String)).toEqual(['-1/5000']);
    expect(kcl[0]?.rhs.toString()).toBe('1/500');
  });

  it('keeps the two inputs in separate equations, unlike a supernode', () => {
    const difference = solveWithSteps({
      elements: [
        voltageSource('V1', 'a', 'gnd', 1),
        voltageSource('V2', 'b', 'gnd', 3),
        resistor('R1', 'a', 'minus', 1000),
        resistor('Rf', 'minus', 'out', 1000),
        resistor('R2', 'b', 'plus', 1000),
        resistor('R3', 'plus', 'gnd', 1000),
        opAmp('U1', 'minus', 'plus', 'out'),
        ground('G', 'gnd'),
      ],
    });
    const kcl = stepsOf(difference, 'kcl');
    expect(kcl).toHaveLength(2);
    expect(kcl.map((step) => step.terms.map((term) => term.elementId))).toEqual([
      ['R2', 'R3'],
      ['R1', 'Rf'],
    ]);
    expect(stepsOf(difference, 'supernode')).toEqual([]);
    expect(stepsOf(difference, 'op-amp')[0]?.opAmps[0]?.virtualGround).toBe(false);
  });

  it('checks out, with the op-amp in the power balance', () => {
    const solution = solveWithSteps({
      elements: [...invertingAmp(1, 1000, 2000), resistor('RL', 'out', 'gnd', 1000)],
    });
    const [check] = stepsOf(solution, 'verification');
    expect(check?.nodeCurrents.every(({ sum }) => sum.isZero())).toBe(true);
    expect(check?.powerAbsorbed?.toString()).toBe('7/1000');
    expect(check?.powerDelivered?.toString()).toBe('7/1000');
  });

  it('lists the op-amp in the results', () => {
    const [results] = stepsOf(inverting, 'element-results');
    expect(results?.results.map(({ elementId }) => elementId)).toEqual(['Vi', 'R1', 'Rf', 'U1']);
  });

  it('shows the op-amp current in the MNA form', () => {
    const netlist = buildNetlist({ elements: invertingAmp(2, 1000, 5000) });
    expect(buildMnaSystem(netlist).unknowns).toContainEqual({ kind: 'op-amp-current', elementId: 'U1' });
  });
});

/** Adds an op-amp with a feedback resistor to a random circuit, on randomly chosen nodes. */
function randomOpAmpCircuit(seed: number): Circuit {
  const base = randomCircuit(seed);
  const names = [
    ...new Set(
      base.elements.flatMap((element) =>
        element.kind === 'resistor' ? [element.a, element.b] : [],
      ),
    ),
  ].sort();
  const minus = names[(seed * 7) % names.length]!;
  const plus = names[(seed * 11 + 3) % names.length]!;
  return {
    elements: [
      ...base.elements,
      opAmp('U', minus, plus, 'out', 1000000),
      resistor('Rf', minus, 'out', (seed % 90) + 10),
    ],
  };
}

describe('300 random op-amp circuits', () => {
  const seeds = Array.from({ length: 300 }, (_, seed) => seed);
  const usable = seeds.filter((seed) => analyze(randomOpAmpCircuit(seed)).status === 'solved');

  it('include plenty the solver accepts and some it refuses', () => {
    expect(usable.length).toBeGreaterThan(50);
    expect(usable.length).toBeLessThan(300);
  });

  it('refuse only for op-amp reasons or other real problems, never by failing to solve', () => {
    for (const seed of seeds) {
      const codes = analyze(randomOpAmpCircuit(seed)).issues.map((issue) => issue.code);
      expect(codes, `seed ${seed}`).not.toContain('singular-system');
    }
  });

  it('agree between the paper method and MNA', () => {
    for (const seed of usable) {
      const netlist = buildNetlist(randomOpAmpCircuit(seed));
      const { redundantIds } = findVoltageSourceLoops(netlist);
      const nodal = solveNodal(netlist, redundantIds);
      const mna = solveMna(netlist, redundantIds);
      if (!nodal || !mna) throw new Error(`seed ${seed}: a solver found no solution`);
      for (const [node, voltage] of mna.nodeVoltages) {
        expect(nodal.nodeVoltages.get(node)?.toString(), `seed ${seed}, node ${node}`).toBe(voltage.toString());
      }
    }
  });

  it('obey the op-amp rules, Kirchhoff and the power balance', () => {
    for (const seed of usable) {
      const result = solved(randomOpAmpCircuit(seed));
      const { nodeVoltages, netlist, elements } = result;

      for (const { inverting, nonInverting } of netlist.opAmps) {
        expect(nodeVoltages.get(inverting)?.equals(nodeVoltages.get(nonInverting)!), `seed ${seed}`).toBe(true);
      }

      const net = new Map<number, Fraction>();
      const add = (node: number, value: Fraction): void => {
        net.set(node, (net.get(node) ?? Fraction.ZERO).add(value));
      };
      let power = Fraction.ZERO;
      for (const { element, a, b } of netlist.components) {
        const { current, power: elementPower } = elements.get(element.id)!;
        add(a, current!);
        add(b, current!.neg());
        power = power.add(elementPower!);
      }
      for (const { element, output } of netlist.opAmps) {
        const { current, power: elementPower } = elements.get(element.id)!;
        add(output, current!);
        power = power.add(elementPower!);
      }
      for (const [node, sum] of net) {
        if (node !== 0) expect(sum.isZero(), `seed ${seed}, KCL at ${node}`).toBe(true);
      }
      expect(power.isZero(), `seed ${seed}, power`).toBe(true);
    }
  });

  it('produce equations that hold in both written forms', () => {
    for (const seed of usable) {
      const solution = solveWithSteps(randomOpAmpCircuit(seed));
      if (solution.status !== 'solved') throw new Error(`seed ${seed}`);
      const voltages = solution.analysis.nodeVoltages;
      for (const step of stepsOf(solution, 'kcl')) {
        const total = step.unknowns.reduce(
          (sum, unknown, index) => sum.add(step.coefficients[index]!.mul(voltages.get(unknown)!)),
          Fraction.ZERO,
        );
        expect(total.equals(step.rhs), `seed ${seed}`).toBe(true);
        const form = arrangeKcl(step.terms, 'entering-equals-leaving');
        expect(form.left.length + form.right.length).toBe(step.terms.length);
      }
    }
  });
});
