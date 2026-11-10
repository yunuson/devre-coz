import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  ground,
  opAmp,
  resistor,
  solveWithSteps,
  voltageSource,
  type Circuit,
  type KclConvention,
  type SolutionStep,
} from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { buildExample } from '../../src/ui/editor/examples';
import { toCircuit } from '../../src/ui/editor/schematic';
import { resistanceTex, stepView, type LabelOf, type StepView } from '../../src/ui/steps-panel/step-views';
import { mixedSources, twoCurrentSources, voltageDivider } from '../core/fixtures';

/**
 * Task 10: the current equation written the way the course's exam solutions write it.
 * One line from the law to the formula, resistances in k, and an equation with whole numbers.
 */

type Solved = Extract<ReturnType<typeof solveWithSteps>, { status: 'solved' }>;
type KclStep = Extract<SolutionStep, { type: 'kcl' }>;

function solved(circuit: Circuit): Solved {
  const solution = solveWithSteps(circuit);
  if (solution.status !== 'solved') throw new Error('not solved');
  return solution;
}

function viewsOf(circuit: Circuit, convention: KclConvention = 'entering-equals-leaving', labelOf: LabelOf = (id) => id): StepView[] {
  return solved(circuit).steps.map((step) => stepView(step, convention, labelOf));
}

const kclViews = (views: readonly StepView[]): StepView[] => views.filter(({ type }) => type === 'kcl');
const texts = (view: StepView): string[] => view.lines.map(({ tex }) => tex);
const captions = (view: StepView): (string | undefined)[] => view.lines.map(({ caption }) => caption);

const inverting: Circuit = {
  elements: [
    voltageSource('Vi', 'in', 'gnd', 2),
    resistor('R1', 'in', 'x', 1000),
    resistor('Rf', 'x', 'out', 5000),
    opAmp('U1', 'x', 'gnd', 'out'),
    ground('G', 'gnd'),
  ],
};

describe('resistances in k and M', () => {
  it.each([
    ['470', '470'],
    ['1000', '1\\,\\text{k}'],
    ['2000', '2\\,\\text{k}'],
    ['4700', '4{,}7\\,\\text{k}'],
    ['10000', '10\\,\\text{k}'],
    ['1000000', '1\\,\\text{M}'],
    ['2200000', '2{,}2\\,\\text{M}'],
  ])('writes %s Ω as %s', async (value, expected) => {
    const { Fraction } = await import('../../src/core');
    expect(resistanceTex(Fraction.from(value))).toBe(expected);
  });
});

describe('the current directions follow the solution in "giren = çıkan"', () => {
  it('stores one direction per term in the core step', () => {
    const kcl = solved(voltageDivider).steps.find((step): step is KclStep => step.type === 'kcl')!;
    expect(kcl.directions).toEqual(['entering', 'leaving']);
  });

  it('puts the current coming from the source on the left, so the equation is never 0 = …', () => {
    const [kcl] = kclViews(viewsOf(voltageDivider));
    expect(texts(kcl!)[0]).toBe(
      'I_{R_{\\mathrm{1}}} = I_{R_{\\mathrm{2}}} \\Rightarrow ' +
        '\\frac{V_{A} - V_{B}}{R_{\\mathrm{1}}} = \\frac{V_{B}}{R_{\\mathrm{2}}}',
    );
  });

  it('draws the arrows the same way', () => {
    const [kcl] = kclViews(viewsOf(voltageDivider));
    expect(kcl!.assumedCurrents).toEqual([
      { elementId: 'R1', fromNode: 1, name: 'IR1' },
      { elementId: 'R2', fromNode: 2, name: 'IR2' },
    ]);
  });

  it('writes a resistor current entering the node with the other node first', () => {
    const [, second] = kclViews(viewsOf(twoCurrentSources));
    expect(texts(second!)[0]).toBe(
      'I_{\\mathrm{2}} + I_{R_{\\mathrm{2}}} = I_{R_{\\mathrm{3}}} \\Rightarrow ' +
        'I_{\\mathrm{2}} + \\frac{V_{A} - V_{B}}{R_{\\mathrm{2}}} = \\frac{V_{B}}{R_{\\mathrm{3}}}',
    );
    expect(texts(second!)[1]).toBe('1 + \\frac{V_{A} - V_{B}}{2} = \\frac{V_{B}}{6}');
    expect(second!.assumedCurrents).toEqual([
      { elementId: 'I2', fromNode: null, name: 'I2' },
      { elementId: 'R2', fromNode: 1, name: 'IR2' },
      { elementId: 'R3', fromNode: 2, name: 'IR3' },
    ]);
  });

  it('leaves "çıkanlar toplamı = 0" as it was: every resistor current leaves', () => {
    const [kcl] = kclViews(viewsOf(voltageDivider, 'leaving-sum'));
    expect(texts(kcl!)[0]).toBe(
      'I_{R_{\\mathrm{1}}} + I_{R_{\\mathrm{2}}} = 0 \\Rightarrow ' +
        '\\frac{V_{B} - V_{A}}{R_{\\mathrm{1}}} + \\frac{V_{B}}{R_{\\mathrm{2}}} = 0',
    );
    expect(kcl!.assumedCurrents.map(({ fromNode }) => fromNode)).toEqual([2, 2]);
  });
});

describe('three lines per equation, as in the exam solutions', () => {
  it('writes the law, the values and the simplified equation', () => {
    const [kcl] = kclViews(viewsOf(voltageDivider));
    expect(captions(kcl!)).toEqual([tr.learn.kcl.law, tr.learn.kcl.numeric, tr.learn.kcl.simplify]);
    expect(texts(kcl!)).toEqual([
      'I_{R_{\\mathrm{1}}} = I_{R_{\\mathrm{2}}} \\Rightarrow ' +
        '\\frac{V_{A} - V_{B}}{R_{\\mathrm{1}}} = \\frac{V_{B}}{R_{\\mathrm{2}}}',
      '\\frac{10 - V_{B}}{2\\,\\text{k}} = \\frac{V_{B}}{3\\,\\text{k}}',
      'V_{B} = 6\\,\\text{V}',
    ]);
  });

  it('solves the inverting amplifier like the exam: 2/1k = (0 − Vo)/5k, so Vo = −10 V', () => {
    const [kcl] = kclViews(viewsOf(inverting));
    expect(texts(kcl!)).toEqual([
      'I_{R_{\\mathrm{1}}} = I_{R_{\\mathrm{f}}} \\Rightarrow ' +
        '\\frac{V_{A} - V_{B}}{R_{\\mathrm{1}}} = \\frac{V_{B} - V_{C}}{R_{\\mathrm{f}}}',
      '\\frac{2}{1\\,\\text{k}} = \\frac{0 - V_{C}}{5\\,\\text{k}}',
      'V_{C} = -10\\,\\text{V}',
    ]);
  });

  it('clears the fractions: whole numbers, the first one positive', () => {
    const [first, second] = kclViews(viewsOf(twoCurrentSources));
    expect(texts(first!).at(-1)).toBe('3\\,V_{A} - 2\\,V_{B} = 8');
    expect(texts(second!).at(-1)).toBe('3\\,V_{A} - 4\\,V_{B} = -6');
  });

  it('writes the matrix with the same whole numbers', () => {
    const system = viewsOf(twoCurrentSources).find(({ type }) => type === 'system')!;
    expect(texts(system)[0]).toBe(
      '\\begin{bmatrix} 3 & -2 \\\\ 3 & -4 \\end{bmatrix} ' +
        '\\begin{bmatrix} V_{A} \\\\ V_{B} \\end{bmatrix} = \\begin{bmatrix} 8 \\\\ -6 \\end{bmatrix}',
    );
  });

  it('writes the difference amplifier example with the current coming in from the output', () => {
    const schematic = buildExample('difference-amplifier');
    const labels = new Map(schematic.items.flatMap((item) => ('label' in item ? [[item.id, item.label] as const] : [])));
    const views = viewsOf(toCircuit(schematic), 'entering-equals-leaving', (id) => labels.get(id) ?? id);
    const atC = kclViews(views).find((view) => view.title.startsWith('VC '))!;
    expect(texts(atC)[0]).toBe(
      'I_{R_{\\mathrm{4}}} = I_{R_{\\mathrm{1}}} \\Rightarrow ' +
        '\\frac{V_{E} - V_{C}}{R_{\\mathrm{4}}} = \\frac{V_{C} - V_{A}}{R_{\\mathrm{1}}}',
    );
    // Task 11 solves VD first, so VC is already known here and only VE is left.
    expect(texts(atC).at(-1)).toBe('V_{E} = 3\\,\\text{V}');
  });
});

describe('the op-amp step', () => {
  it('no longer uses the words "sanal toprak", which the course notes never use', () => {
    expect(tr.learn.opAmp.virtualGround).not.toMatch(/sanal toprak/i);
    const view = viewsOf(inverting).find(({ type }) => type === 'op-amp')!;
    expect(view.facts.join(' ')).not.toMatch(/sanal toprak/i);
  });
});

describe('everything still renders', () => {
  it('as valid LaTeX in both forms', () => {
    for (const convention of ['entering-equals-leaving', 'leaving-sum'] as const) {
      for (const circuit of [voltageDivider, twoCurrentSources, mixedSources, inverting]) {
        for (const view of viewsOf(circuit, convention)) {
          for (const { tex } of view.lines) {
            expect(() => katex.renderToString(tex, { throwOnError: true, strict: false })).not.toThrow();
          }
        }
      }
    }
  });
});
