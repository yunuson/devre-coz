import { describe, expect, it } from 'vitest';
import {
  analyze,
  arrangeKcl,
  buildNetlist,
  findVoltageSourceLoops,
  Fraction,
  solveMna,
  solveNodal,
  solveWithSteps,
  type KclTerm,
  type NodeId,
  type SolutionStep,
} from '../../src/core';
import { randomCircuit } from './random-circuit';

const CIRCUIT_COUNT = 300;
const SEEDS = Array.from({ length: CIRCUIT_COUNT }, (_, seed) => seed);

describe(`${CIRCUIT_COUNT} random circuits obey the laws of circuit theory`, () => {
  it.each(SEEDS)('seed %d', (seed) => {
    const result = analyze(randomCircuit(seed));
    if (result.status !== 'solved') {
      throw new Error(`Not solved: ${result.issues.map((issue) => issue.code).join(', ')}`);
    }

    const netCurrent = new Map<number, Fraction>();
    const addCurrent = (node: number, value: Fraction): void => {
      netCurrent.set(node, (netCurrent.get(node) ?? Fraction.ZERO).add(value));
    };
    let totalPower = Fraction.ZERO;

    for (const { element, a, b } of result.netlist.components) {
      const values = result.elements.get(element.id)!;
      const current = values.current!;
      const drop = result.nodeVoltages.get(a)!.sub(result.nodeVoltages.get(b)!);

      expect(values.voltage.equals(drop)).toBe(true);
      if (element.kind === 'resistor') {
        expect(drop.equals(current.mul(element.resistance))).toBe(true);
      } else if (element.kind === 'voltage-source') {
        expect(drop.equals(element.voltage)).toBe(true);
      } else {
        expect(current.equals(element.current)).toBe(true);
      }

      addCurrent(a, current);
      addCurrent(b, current.neg());
      totalPower = totalPower.add(values.power!);
    }

    for (const [node, sum] of netCurrent) {
      expect(sum.isZero(), `Kirchhoff's current law at node ${node}`).toBe(true);
    }
    expect(totalPower.isZero(), 'power balance').toBe(true);
  });
});

describe(`the paper method and MNA agree on ${CIRCUIT_COUNT} random circuits`, () => {
  it.each(SEEDS)('seed %d', (seed) => {
    const netlist = buildNetlist(randomCircuit(seed));
    const { redundantIds } = findVoltageSourceLoops(netlist);
    const nodal = solveNodal(netlist, redundantIds);
    const mna = solveMna(netlist, redundantIds);
    if (!nodal || !mna) throw new Error('A solver found no solution');

    expect(nodal.nodeVoltages.size).toBe(mna.nodeVoltages.size);
    for (const [node, voltage] of mna.nodeVoltages) {
      expect(nodal.nodeVoltages.get(node)?.toString(), `node ${node}`).toBe(voltage.toString());
    }
  });

  it('actually covers known voltages and supernodes', () => {
    const typesOf = (seed: number): readonly SolutionStep['type'][] => {
      const solution = solveWithSteps(randomCircuit(seed));
      return solution.status === 'solved' ? solution.steps.map((step) => step.type) : [];
    };
    const allTypes = SEEDS.map(typesOf);
    const circuitsWith = (type: SolutionStep['type']): number =>
      allTypes.filter((types) => types.includes(type)).length;

    expect(circuitsWith('known-voltages')).toBeGreaterThan(30);
    expect(circuitsWith('supernode')).toBeGreaterThan(30);
    expect(circuitsWith('kcl')).toBeGreaterThan(30);
  });
});

/** Current in the term's own direction: leaving the node for resistors, the source value for sources. */
function termValue(term: KclTerm, voltages: ReadonlyMap<NodeId, Fraction>): Fraction {
  if (term.kind === 'current-source') return term.current;
  return voltages.get(term.from)!.sub(voltages.get(term.to)!).div(term.resistance);
}

describe(`generated steps are consistent on ${CIRCUIT_COUNT} random circuits`, () => {
  it.each(SEEDS)('seed %d', (seed) => {
    const solution = solveWithSteps(randomCircuit(seed));
    if (solution.status !== 'solved') throw new Error('Not solved');
    const voltages = solution.analysis.nodeVoltages;

    const sumOf = (side: ReturnType<typeof arrangeKcl>['left']): Fraction =>
      side.reduce(
        (sum, { sign, term }) => {
          const value = termValue(term, voltages);
          return sign === 1 ? sum.add(value) : sum.sub(value);
        },
        Fraction.ZERO,
      );

    for (const step of solution.steps) {
      if (step.type === 'kcl') {
        // Both ways of writing the equation must hold for the solved voltages.
        for (const convention of ['leaving-sum', 'entering-equals-leaving'] as const) {
          const { left, right } = arrangeKcl(step.terms, convention);
          expect(sumOf(left).equals(sumOf(right)), convention).toBe(true);
        }
        // So must the equation after substitution.
        const total = step.unknowns.reduce(
          (sum, unknown, index) => sum.add(step.coefficients[index]!.mul(voltages.get(unknown)!)),
          Fraction.ZERO,
        );
        expect(total.equals(step.rhs), 'substituted equation').toBe(true);
      }

      if (step.type === 'verification') {
        expect(step.nodeCurrents.every(({ sum }) => sum.isZero())).toBe(true);
        expect(step.powerAbsorbed?.equals(step.powerDelivered!)).toBe(true);
      }
    }

    // The MNA form shown to students must hold for the same answer.
    const { unknowns, matrix, rhs } = solution.mna;
    const x = unknowns.map((unknown) =>
      unknown.kind === 'node-voltage'
        ? voltages.get(unknown.node)!
        : solution.analysis.elements.get(unknown.elementId)!.current!,
    );
    matrix.forEach((row, rowIndex) => {
      const value = row.reduce((sum, entry, col) => sum.add(entry.mul(x[col]!)), Fraction.ZERO);
      expect(value.equals(rhs[rowIndex]!), `MNA row ${rowIndex}`).toBe(true);
    });
  });
});
