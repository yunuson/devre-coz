import { describe, expect, it } from 'vitest';
import {
  ground,
  opAmp,
  resistor,
  solveWithSteps,
  voltageSource,
  type Circuit,
  type SolutionStep,
} from '../../src/core';
import { buildExample } from '../../src/ui/editor/examples';
import { toCircuit } from '../../src/ui/editor/schematic';
import { stepView, type LabelOf, type StepView } from '../../src/ui/steps-panel/step-views';
import { randomCircuit } from '../core/random-circuit';
import { mixedSources, supernode, twoCurrentSources, voltageDivider } from '../core/fixtures';

/**
 * Task 11: solved layer by layer, as the exam solutions do. An equation with a single unknown is
 * solved on the spot and its answer is put into the next one. A matrix is left only for equations
 * that really depend on each other.
 */

type Solved = Extract<ReturnType<typeof solveWithSteps>, { status: 'solved' }>;
type KclStep = Extract<SolutionStep, { type: 'kcl' }>;

function solved(circuit: Circuit): Solved {
  const solution = solveWithSteps(circuit);
  if (solution.status !== 'solved') throw new Error('not solved');
  return solution;
}

const kclSteps = (solution: Solved): KclStep[] =>
  solution.steps.filter((step): step is KclStep => step.type === 'kcl');

const views = (solution: Solved, labelOf: LabelOf = (id) => id): StepView[] =>
  solution.steps.map((step) => stepView(step, 'entering-equals-leaving', labelOf));

const kclViews = (all: readonly StepView[]): StepView[] => all.filter(({ type }) => type === 'kcl');
const texts = (view: StepView): string[] => view.lines.map(({ tex }) => tex);

function example(id: Parameters<typeof buildExample>[0]): { solution: Solved; labelOf: LabelOf } {
  const schematic = buildExample(id);
  const labels = new Map(schematic.items.flatMap((item) => ('label' in item ? [[item.id, item.label] as const] : [])));
  return { solution: solved(toCircuit(schematic)), labelOf: (id) => labels.get(id) ?? id };
}

/** Two inverting stages: Vo1 = −(10k/2k)·1 = −5 V, then Vo = −(4k/2k)·(−5) = 10 V. */
const cascade: Circuit = {
  elements: [
    voltageSource('Vi', 'in', 'gnd', 1),
    resistor('R1', 'in', 'x1', 2000),
    resistor('R2', 'x1', 'o1', 10000),
    opAmp('U1', 'x1', 'gnd', 'o1'),
    resistor('R3', 'o1', 'x2', 2000),
    resistor('R4', 'x2', 'o2', 4000),
    opAmp('U2', 'x2', 'gnd', 'o2'),
    ground('G', 'gnd'),
  ],
};

describe('one unknown at a time', () => {
  it('needs no matrix when each equation leaves a single unknown', () => {
    for (const circuit of [voltageDivider, mixedSources, cascade]) {
      expect(solved(circuit).steps.map(({ type }) => type)).not.toContain('system');
    }
    expect(example('difference-amplifier').solution.steps.map(({ type }) => type)).not.toContain('system');
  });

  it('says in the core step which voltage the equation gives', () => {
    const [kcl] = kclSteps(solved(voltageDivider));
    expect(kcl!.solves?.node).toBe(2);
    expect(kcl!.solves?.value.toString()).toBe('6');
  });

  it('writes the answer with its unit, and divides when the number in front is not 1', () => {
    const [kcl] = kclViews(views(solved(mixedSources)));
    expect(texts(kcl!).at(-1)).toBe('3\\,V_{B} = 25 \\Rightarrow V_{B} = \\frac{25}{3} \\approx 8{,}333\\,\\text{V}');
  });

  it('solves the first stage, then puts its answer into the second', () => {
    const solution = solved(cascade);
    const [first, second] = kclViews(views(solution));
    expect(texts(first!)).toEqual([
      'I_{R_{\\mathrm{1}}} = I_{R_{\\mathrm{2}}} \\Rightarrow ' +
        '\\frac{V_{A} - V_{B}}{R_{\\mathrm{1}}} = \\frac{V_{B} - V_{C}}{R_{\\mathrm{2}}}',
      '\\frac{1}{2\\,\\text{k}} = \\frac{0 - V_{C}}{10\\,\\text{k}}',
      'V_{C} = -5\\,\\text{V}',
    ]);
    expect(texts(second!)).toEqual([
      'I_{R_{\\mathrm{4}}} = I_{R_{\\mathrm{3}}} \\Rightarrow ' +
        '\\frac{V_{E} - V_{D}}{R_{\\mathrm{4}}} = \\frac{V_{D} - V_{C}}{R_{\\mathrm{3}}}',
      '\\frac{V_{E}}{4\\,\\text{k}} = \\frac{0 - \\left(-5\\right)}{2\\,\\text{k}}',
      'V_{E} = 10\\,\\text{V}',
    ]);
    expect(kclSteps(solution).map((step) => step.unknowns)).toEqual([[3], [5]]);
  });
});

describe('the difference amplifier example', () => {
  const { solution, labelOf } = example('difference-amplifier');
  const all = views(solution, labelOf);

  it('starts with the node whose equation has a single unknown', () => {
    expect(kclViews(all).map(({ title }) => title.split(' ')[0])).toEqual(['VD', 'VC']);
  });

  it('keeps writing VD in the VD equation instead of switching to VC, then says VC equals it', () => {
    const [atD] = kclViews(all);
    expect(texts(atD!)).toEqual([
      'I_{R_{\\mathrm{2}}} = I_{R_{\\mathrm{3}}} \\Rightarrow ' +
        '\\frac{V_{B} - V_{D}}{R_{\\mathrm{2}}} = \\frac{V_{D}}{R_{\\mathrm{3}}}',
      '\\frac{5 - V_{D}}{1\\,\\text{k}} = \\frac{V_{D}}{1\\,\\text{k}}',
      '2\\,V_{D} = 5 \\Rightarrow V_{D} = 2{,}5\\,\\text{V},\\; V_{C} = V_{D}',
    ]);
    const [step] = kclSteps(solution);
    expect(step!.unknowns).toEqual([4]);
    expect(step!.solves?.node).toBe(4);
  });

  it('then fills in VC = 2,5 V and finds VE', () => {
    const [, atC] = kclViews(all);
    expect(texts(atC!).slice(1)).toEqual([
      '\\frac{V_{E} - 2{,}5}{1\\,\\text{k}} = \\frac{2{,}5 - 2}{1\\,\\text{k}}',
      'V_{E} = 3\\,\\text{V}',
    ]);
  });
});

describe('equations that really depend on each other', () => {
  it('keeps the matrix for them, with nothing solved early', () => {
    const solution = solved(twoCurrentSources);
    expect(solution.steps.map(({ type }) => type)).toContain('system');
    expect(kclSteps(solution).map((step) => step.solves)).toEqual([null, null]);
    const system = solution.steps.find((step) => step.type === 'system');
    expect(system?.type === 'system' && system.unknowns).toEqual([1, 2]);
  });

  it('solves a supernode equation on the spot when it has one unknown', () => {
    const solution = solved(supernode);
    expect(solution.steps.map(({ type }) => type)).not.toContain('system');
    expect(kclSteps(solution)[0]!.solves?.value.toString()).toBe('-4/3');
  });
});

describe('on any circuit', () => {
  it('gives each solved voltage its final value and still lists every voltage at the end', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const solution = solveWithSteps(randomCircuit(seed));
      if (solution.status !== 'solved') continue;
      const final = solution.steps.find((step) => step.type === 'node-voltages');
      if (final?.type !== 'node-voltages') throw new Error(`seed ${seed}: no node voltages`);
      const voltageOf = new Map(final.values.map(({ node, voltage }) => [node, voltage]));
      for (const step of kclSteps(solution)) {
        if (!step.solves) continue;
        expect(step.unknowns, `seed ${seed}`).toEqual([step.solves.node]);
        expect(step.solves.value.equals(voltageOf.get(step.solves.node)!), `seed ${seed}`).toBe(true);
      }
      const system = solution.steps.find((step) => step.type === 'system');
      const unsolved = kclSteps(solution).filter((step) => !step.solves);
      expect(Boolean(system), `seed ${seed}`).toBe(unsolved.length > 0);
    }
  });
});
