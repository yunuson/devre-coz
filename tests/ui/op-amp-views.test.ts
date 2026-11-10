import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  ground,
  opAmp,
  resistor,
  solveWithSteps,
  voltageSource,
  type CircuitElement,
  type SolutionStep,
} from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { mnaTex, stepView, type StepView } from '../../src/ui/steps-panel/step-views';

const labelOf = (id: string): string => id;

function viewsOf(elements: CircuitElement[]): StepView[] {
  const solution = solveWithSteps({ elements });
  if (solution.status !== 'solved') throw new Error('not solved');
  return solution.steps.map((step: SolutionStep) => stepView(step, 'entering-equals-leaving', labelOf));
}

const opAmpView = (elements: CircuitElement[]): StepView => {
  const view = viewsOf(elements).find(({ type }) => type === 'op-amp');
  if (!view) throw new Error('no op-amp step');
  return view;
};

const inverting: CircuitElement[] = [
  voltageSource('Vi', 'in', 'gnd', 2),
  resistor('R1', 'in', 'x', 1000),
  resistor('Rf', 'x', 'out', 5000),
  opAmp('U1', 'x', 'gnd', 'out'),
  ground('G', 'gnd'),
];

describe('the op-amp step', () => {
  it('names the virtual ground and never writes the ground as a node', () => {
    const view = opAmpView(inverting);
    expect(view.facts).toEqual([tr.learn.opAmp.virtualGround.replace('{name}', 'U1')]);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]?.tex).toMatch(/^V_\{B\} = 0/);
    expect(view.elementIds).toEqual(['U1']);
    expect(view.nodes).toEqual([2]);
  });

  it('gives both inputs their known voltage', () => {
    const view = opAmpView([
      voltageSource('Vi', 'plus', 'gnd', 1),
      opAmp('U1', 'x', 'plus', 'out'),
      resistor('R1', 'x', 'gnd', 1000),
      resistor('Rf', 'x', 'out', 4000),
      ground('G', 'gnd'),
    ]);
    expect(view.facts).toEqual([tr.learn.opAmp.rule.replace('{name}', 'U1')]);
    expect(view.lines[0]?.tex).toMatch(/^V_\{[A-Z]\} = V_\{[A-Z]\} = 1/);
  });

  it('only equates the inputs while their voltage is still unknown', () => {
    const view = opAmpView([
      voltageSource('V1', 'a', 'gnd', 1),
      voltageSource('V2', 'b', 'gnd', 3),
      resistor('R1', 'a', 'minus', 1000),
      resistor('Rf', 'minus', 'out', 1000),
      resistor('R2', 'b', 'plus', 1000),
      resistor('R3', 'plus', 'gnd', 1000),
      opAmp('U1', 'minus', 'plus', 'out'),
      ground('G', 'gnd'),
    ]);
    expect(view.lines[0]?.tex).toMatch(/^V_\{[A-Z]\} = V_\{[A-Z]\}$/);
  });

  it('keeps the same step, with the ground left out, when the − input is the grounded one', () => {
    const view = opAmpView([
      voltageSource('Vi', 'in', 'gnd', 1),
      resistor('R1', 'in', 'sum', 1000),
      resistor('R2', 'out2', 'sum', 1000),
      opAmp('U1', 'gnd', 'sum', 'out1'),
      resistor('R3', 'out1', 'x', 1000),
      resistor('R4', 'x', 'out2', 1000),
      opAmp('U2', 'x', 'gnd', 'out2'),
      ground('G', 'gnd'),
    ]);
    expect(view.lines.every(({ tex }) => /^V_\{[A-Z]\} = 0/.test(tex))).toBe(true);
  });

  it('lists the op-amp among the results and writes its input equation with the right terms', () => {
    const views = viewsOf(inverting);
    const results = views.find(({ type }) => type === 'element-results');
    // Vi / R1 = 2 mA goes through Rf and into the output at −10 V: 20 mW, delivered from the supplies.
    const row = results?.rows.find(({ name }) => name === 'U1');
    expect(row?.voltage).toBe('−10 V');
    expect(row?.current).toBe('2 mA');
    expect(row?.power).toContain('20 mW');
    const kcl = views.find(({ type }) => type === 'kcl');
    const equations = kcl?.lines.map(({ tex }) => tex).join(' ') ?? '';
    expect(equations).toContain('R');
    expect(equations).not.toContain('U');
  });

  it('shows a resistor voltage with its sign removed', () => {
    const elements: CircuitElement[] = [
      voltageSource('V1', 'a', 'gnd', 5),
      resistor('R1', 'gnd', 'a', 1000),
      ground('G', 'gnd'),
    ];
    const views = viewsOf(elements);
    const results = views.find(({ type }) => type === 'element-results');
    const row = results?.rows.find(({ name }) => name === 'R1');
    expect(row?.voltage).toBe('5 V');
  });

  it('renders as valid LaTeX, along with every other step', () => {
    for (const view of viewsOf(inverting)) {
      for (const { tex } of view.lines) {
        expect(() => katex.renderToString(tex, { throwOnError: true })).not.toThrow();
      }
    }
  });

  it('lists the op-amp with its current in the MNA form', () => {
    const solution = solveWithSteps({ elements: inverting });
    if (solution.status !== 'solved') throw new Error('not solved');
    const tex = mnaTex(solution.mna, labelOf);
    expect(tex).toContain('I_{');
    expect(() => katex.renderToString(tex, { throwOnError: true })).not.toThrow();
  });
});

describe('the saturation warning', () => {
  const { title, detail } = tr.issues['op-amp-saturated'];

  it('says the answer shown is still the ideal one, and that it applies when no supply is given', () => {
    expect(title).toContain('gerçek devrede');
    expect(detail).toContain('ideal');
    expect(detail).toContain('besleme verilmediyse');
  });

  it('says how to change the supply', () => {
    expect(detail).toContain('çift tıkla');
  });
});

describe('op-amp problem messages', () => {
  it.each([
    'op-amp-input-open',
    'op-amp-output-shorted',
    'op-amp-no-feedback',
    'op-amp-positive-feedback',
    'op-amp-saturated',
  ] as const)('%s tells the student which op-amp and what to do', (code) => {
    expect(tr.issues[code].title).toContain('{names}');
    expect(tr.issues[code].detail.length).toBeGreaterThan(20);
  });
});
