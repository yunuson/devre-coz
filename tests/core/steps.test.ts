import { describe, expect, it } from 'vitest';
import {
  arrangeKcl,
  currentSource,
  DEFAULT_KCL_CONVENTION,
  ground,
  resistor,
  solveWithSteps,
  voltageSource,
  wire,
  type Circuit,
  type Solution,
  type SolutionStep,
} from '../../src/core';
import { mixedSources, supernode, twoCurrentSources, voltageDivider } from './fixtures';

type Solved = Extract<Solution, { status: 'solved' }>;
type StepOf<T extends SolutionStep['type']> = Extract<SolutionStep, { type: T }>;

function solved(circuit: Circuit): Solved {
  const solution = solveWithSteps(circuit);
  if (solution.status !== 'solved') {
    throw new Error(`Not solved: ${solution.issues.map((issue) => issue.code).join(', ')}`);
  }
  return solution;
}

const stepsOf = <T extends SolutionStep['type']>(solution: Solved, type: T): StepOf<T>[] =>
  solution.steps.filter((step): step is StepOf<T> => step.type === type);

const texts = (values: readonly { toString(): string }[]): string[] => values.map(String);

const voltages = (solution: Solved): Record<number, string> =>
  Object.fromEntries(stepsOf(solution, 'node-voltages')[0]!.values.map((v) => [v.node, v.voltage.toString()]));

const termIds = (step: StepOf<'kcl'>): string[] => step.terms.map((term) => term.elementId);

describe('example 1: voltage divider', () => {
  const solution = solved(voltageDivider);

  it('follows the order of a paper solution', () => {
    expect(solution.steps.map((step) => step.type)).toEqual([
      'nodes',
      'reference',
      'known-voltages',
      'kcl',
      'node-voltages',
      'element-results',
      'verification',
    ]);
  });

  it('reads V1 directly from the source instead of writing an equation for it', () => {
    const [known] = stepsOf(solution, 'known-voltages');
    expect(known?.values.map((v) => [v.node, v.voltage.toString()])).toEqual([[1, '10']]);
    expect(known?.elementIds).toEqual(['V1']);
    expect(stepsOf(solution, 'kcl')).toHaveLength(1);
  });

  it('writes the KCL equation of the middle node', () => {
    const [kcl] = stepsOf(solution, 'kcl');
    expect(kcl?.nodes).toEqual([2]);
    expect(kcl?.terms).toEqual([
      { kind: 'resistor', elementId: 'R1', from: 2, to: 1, resistance: expect.anything() },
      { kind: 'resistor', elementId: 'R2', from: 2, to: 0, resistance: expect.anything() },
    ]);
    expect(texts(kcl?.coefficients ?? [])).toEqual(['1/1200']);
    expect(kcl?.rhs.toString()).toBe('1/200');
  });

  it('solves to 6 V', () => {
    expect(voltages(solution)).toEqual({ 1: '10', 2: '6' });
  });

  it('lists the elements to highlight', () => {
    expect(stepsOf(solution, 'kcl')[0]?.elementIds).toEqual(['R1', 'R2']);
    expect(stepsOf(solution, 'reference')[0]?.elementIds).toEqual(['G']);
  });
});

describe('example 2: two nodes, two current sources', () => {
  const solution = solved(twoCurrentSources);

  it('needs no known-voltage or supernode step', () => {
    expect(stepsOf(solution, 'known-voltages')).toEqual([]);
    expect(stepsOf(solution, 'supernode')).toEqual([]);
  });

  it('writes one KCL equation per node', () => {
    const [first, second] = stepsOf(solution, 'kcl');
    expect(first?.nodes).toEqual([1]);
    expect(termIds(first!)).toEqual(['I1', 'R1', 'R2']);
    expect(second?.nodes).toEqual([2]);
    expect(termIds(second!)).toEqual(['I2', 'R2', 'R3']);
    expect(first?.terms[0]).toMatchObject({ kind: 'current-source', direction: 'entering' });
  });

  it('forms G · V = I', () => {
    const [system] = stepsOf(solution, 'system');
    expect(system?.unknowns).toEqual([1, 2]);
    expect(system?.matrix.map(texts)).toEqual([
      ['3/4', '-1/2'],
      ['-1/2', '2/3'],
    ]);
    expect(texts(system?.rhs ?? [])).toEqual(['2', '1']);
  });

  it('solves to 22/3 V and 7 V', () => {
    expect(voltages(solution)).toEqual({ 1: '22/3', 2: '7' });
  });
});

describe('example 3: voltage and current source together', () => {
  const solution = solved(mixedSources);

  it('has a single unknown, as on paper, where MNA has three', () => {
    const [kcl] = stepsOf(solution, 'kcl');
    expect(kcl?.unknowns).toEqual([2]);
    expect(texts(kcl?.coefficients ?? [])).toEqual(['3/10']);
    expect(kcl?.rhs.toString()).toBe('5/2');
    expect(solution.mna.unknowns).toEqual([
      { kind: 'node-voltage', node: 1 },
      { kind: 'node-voltage', node: 2 },
      { kind: 'source-current', elementId: 'V1' },
    ]);
  });

  it('solves to 10 V and 25/3 V', () => {
    expect(voltages(solution)).toEqual({ 1: '10', 2: '25/3' });
  });

  it('checks out: currents balance and 7.5 W is produced and consumed', () => {
    const [check] = stepsOf(solution, 'verification');
    expect(check?.nodeCurrents.every(({ sum }) => sum.isZero())).toBe(true);
    expect(check?.nodeCurrents.map(({ node }) => node)).toEqual([1, 2]);
    expect(check?.powerAbsorbed?.toString()).toBe('15/2');
    expect(check?.powerDelivered?.toString()).toBe('15/2');
  });
});

describe('example 4: supernode', () => {
  const solution = solved(supernode);

  it('ties both nodes together through the source', () => {
    const [step] = stepsOf(solution, 'supernode');
    expect(step?.nodes).toEqual([1, 2]);
    expect(step?.representative).toBe(1);
    expect(step?.relations.map((r) => [r.node, r.parent, r.delta.toString(), r.sourceId])).toEqual([
      [2, 1, '6', 'V1'],
    ]);
    expect(step?.expressions.map((e) => [e.node, e.expression.unknown, e.expression.offset.toString()])).toEqual([
      [1, 1, '0'],
      [2, 1, '6'],
    ]);
  });

  it('writes one KCL equation around the whole supernode', () => {
    const kcl = stepsOf(solution, 'kcl');
    expect(kcl).toHaveLength(1);
    expect(kcl[0]?.nodes).toEqual([1, 2]);
    expect(termIds(kcl[0]!)).toEqual(['I1', 'R1', 'R2']);
    expect(texts(kcl[0]?.coefficients ?? [])).toEqual(['3/4']);
    expect(kcl[0]?.rhs.toString()).toBe('-1');
  });

  it('solves to −4/3 V and 14/3 V', () => {
    expect(voltages(solution)).toEqual({ 1: '-4/3', 2: '14/3' });
  });
});

describe('KCL conventions', () => {
  const [, second] = stepsOf(solved(twoCurrentSources), 'kcl');

  it('defaults to entering = leaving, as in the course notes', () => {
    expect(DEFAULT_KCL_CONVENTION).toBe('entering-equals-leaving');
  });

  const ids = (terms: readonly { sign: number; term: { elementId: string } }[]): [string, number][] =>
    terms.map(({ sign, term }) => [term.elementId, sign]);

  it('leaving-sum puts everything on the left, equal to zero', () => {
    const { left, right } = arrangeKcl(second!.terms, 'leaving-sum');
    expect(ids(left)).toEqual([
      ['I2', -1],
      ['R2', 1],
      ['R3', 1],
    ]);
    expect(right).toEqual([]);
  });

  it('entering-equals-leaving puts sources entering on the left', () => {
    const { left, right } = arrangeKcl(second!.terms, 'entering-equals-leaving');
    expect(ids(left)).toEqual([['I2', 1]]);
    expect(ids(right)).toEqual([
      ['R2', 1],
      ['R3', 1],
    ]);
  });

  it('keeps a source leaving the node on the leaving side', () => {
    const solution = solved({
      elements: [
        currentSource('out', 'a', 'gnd', 2),
        currentSource('in', 'gnd', 'a', 5),
        resistor('R1', 'a', 'gnd', 3),
        ground('G', 'gnd'),
      ],
    });
    const [kcl] = stepsOf(solution, 'kcl');
    const leaving = arrangeKcl(kcl!.terms, 'leaving-sum');
    expect(ids(leaving.left)).toEqual([
      ['out', 1],
      ['in', -1],
      ['R1', 1],
    ]);
    const balance = arrangeKcl(kcl!.terms, 'entering-equals-leaving');
    expect(ids(balance.left)).toEqual([['in', 1]]);
    expect(ids(balance.right)).toEqual([
      ['out', 1],
      ['R1', 1],
    ]);
    expect(voltages(solution)).toEqual({ 1: '9' });
  });
});

describe('harder circuits', () => {
  it('follows a chain of sources from ground without any equations', () => {
    const solution = solved({
      elements: [
        voltageSource('V1', 'a', 'gnd', 5),
        voltageSource('V2', 'b', 'a', 3),
        voltageSource('V3', 'b', 'c', 2),
        resistor('R1', 'c', 'gnd', 1),
        ground('G', 'gnd'),
      ],
    });
    const [known] = stepsOf(solution, 'known-voltages');
    expect(known?.relations.map((r) => [r.parent, r.delta.toString(), r.sourceId])).toEqual([
      [0, '5', 'V1'],
      [1, '3', 'V2'],
      [2, '-2', 'V3'],
    ]);
    expect(stepsOf(solution, 'kcl')).toEqual([]);
    expect(stepsOf(solution, 'system')).toEqual([]);
    expect(voltages(solution)).toEqual({ 1: '5', 2: '8', 3: '6' });
  });

  it('handles a supernode of three nodes joined by a chain of sources', () => {
    const solution = solved({
      elements: [
        voltageSource('V1', 'b', 'a', 1),
        voltageSource('V2', 'c', 'b', 2),
        resistor('Ra', 'a', 'gnd', 1),
        resistor('Rb', 'b', 'gnd', 1),
        resistor('Rc', 'c', 'gnd', 1),
        ground('G', 'gnd'),
      ],
    });
    // Nodes are numbered by first appearance: 1 is b, 2 is a, 3 is c.
    // By hand: (b − 1) + b + (b + 2) = 0, so b = −1/3.
    const [step] = stepsOf(solution, 'supernode');
    expect(step?.nodes).toHaveLength(3);
    expect(step?.expressions.map((e) => e.expression.offset.toString())).toEqual(['0', '-1', '2']);
    expect(stepsOf(solution, 'kcl')).toHaveLength(1);
    expect(voltages(solution)).toEqual({ 1: '-1/3', 2: '-4/3', 3: '5/3' });
  });

  it('leaves out a resistor inside a supernode, which adds no net current', () => {
    const solution = solved({
      elements: [
        voltageSource('V1', 'b', 'a', 4),
        resistor('inside', 'a', 'b', 2),
        resistor('Ra', 'a', 'gnd', 1),
        resistor('Rb', 'b', 'gnd', 1),
        ground('G', 'gnd'),
      ],
    });
    // Node 1 is b and node 2 is a. By hand: a + (a + 4) = 0, so a = −2 and b = 2.
    expect(termIds(stepsOf(solution, 'kcl')[0]!)).toEqual(['Ra', 'Rb']);
    expect(voltages(solution)).toEqual({ 1: '2', 2: '-2' });
    expect(solution.analysis.elements.get('inside')?.current?.toString()).toBe('-2');
  });

  it('solves a supernode beside an ordinary node', () => {
    const solution = solved({
      elements: [
        currentSource('I1', 'gnd', 'c', 3),
        resistor('R1', 'c', 'a', 1),
        voltageSource('V1', 'b', 'a', 2),
        resistor('R2', 'a', 'gnd', 1),
        resistor('R3', 'b', 'gnd', 1),
        ground('G', 'gnd'),
      ],
    });
    expect(stepsOf(solution, 'kcl').map((step) => step.nodes.length).sort()).toEqual([1, 2]);
    expect(stepsOf(solution, 'system')[0]?.unknowns).toHaveLength(2);
    const verification = stepsOf(solution, 'verification')[0];
    expect(verification?.nodeCurrents.every(({ sum }) => sum.isZero())).toBe(true);
  });

  it('skips a shorted resistor in the equations', () => {
    const solution = solved({
      elements: [
        voltageSource('V1', 'a', 'gnd', 12),
        resistor('R1', 'a', 'b', 2),
        resistor('R2', 'b', 'gnd', 4),
        wire('short', 'b', 'gnd'),
        ground('G', 'gnd'),
      ],
    });
    expect(stepsOf(solution, 'kcl')).toEqual([]);
    expect(solution.issues.map((issue) => issue.code)).toEqual(['resistor-shorted']);
    expect(voltages(solution)).toEqual({ 1: '12' });
  });

  it('gives a dangling node the voltage it hangs from', () => {
    const solution = solved({
      elements: [
        voltageSource('V1', 'a', 'gnd', 12),
        resistor('R1', 'a', 'gnd', 3),
        resistor('tail', 'a', 'open', 1),
        ground('G', 'gnd'),
      ],
    });
    expect(voltages(solution)).toEqual({ 1: '12', 2: '12' });
    expect(solution.issues.map((issue) => issue.code)).toEqual(['dangling-element']);
  });

  it('solves equal parallel sources but says the power totals are unknown', () => {
    const solution = solved({
      elements: [
        voltageSource('V1', 'a', 'gnd', 5),
        voltageSource('V2', 'a', 'gnd', 5),
        resistor('R1', 'a', 'gnd', 2),
        ground('G', 'gnd'),
      ],
    });
    expect(voltages(solution)).toEqual({ 1: '5' });
    const [check] = stepsOf(solution, 'verification');
    expect(check?.powerAbsorbed).toBeNull();
    expect(check?.powerDelivered).toBeNull();
    expect(check?.nodeCurrents).toEqual([]);
    expect(solution.mna.unknowns).toHaveLength(2);
  });

  it('returns the issues instead of steps for an invalid circuit', () => {
    const solution = solveWithSteps({ elements: [resistor('R1', 'a', 'b', 1)] });
    expect(solution.status).toBe('invalid');
    expect(solution.issues.map((issue) => issue.code)).toEqual(['no-ground']);
    expect(solution).not.toHaveProperty('steps');
  });
});
