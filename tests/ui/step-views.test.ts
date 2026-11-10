import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { Fraction, solveWithSteps, type KclConvention, type SolutionStep } from '../../src/core';
import {
  dcEquivalentView,
  fractionTex,
  measuredRow,
  mnaTex,
  nameTex,
  nodeTex,
  revealsCurrents,
  revealsNodeValues,
  stepView,
  valueTex,
  type StepView,
} from '../../src/ui/steps-panel/step-views';
import { mixedSources, supernode, twoCurrentSources, voltageDivider } from '../core/fixtures';
import { randomCircuit } from '../core/random-circuit';

const labelOf = (id: string): string => id;

function viewsOf(circuit: Parameters<typeof solveWithSteps>[0], convention: KclConvention = 'entering-equals-leaving'): StepView[] {
  const solution = solveWithSteps(circuit);
  if (solution.status !== 'solved') throw new Error('not solved');
  return solution.steps.map((step) => stepView(step, convention, labelOf));
}

const viewOf = (views: readonly StepView[], type: SolutionStep['type'], index = 0): StepView =>
  views.filter((view) => view.type === type)[index]!;

/** LaTeX with its spacing normalised, so tests read naturally. */
const texts = (view: StepView): string[] => view.lines.map((line) => line.tex);

describe('numbers', () => {
  it.each([
    ['7', '7'],
    ['-3', '-3'],
    ['0.5', '0{,}5'],
    ['1.5', '1{,}5'],
    ['-0.25', '-0{,}25'],
    ['0.002', '0{,}002'],
  ])('writes %s as %s', (value, expected) => {
    expect(fractionTex(Fraction.from(value))).toBe(expected);
  });

  it('keeps repeating values as exact fractions', () => {
    expect(fractionTex(Fraction.ratio(22n, 3n))).toBe('\\frac{22}{3}');
    expect(fractionTex(Fraction.ratio(-4n, 3n))).toBe('-\\frac{4}{3}');
  });

  it('adds a decimal only when the value needs one', () => {
    expect(valueTex(Fraction.ratio(22n, 3n), 'V')).toBe('\\frac{22}{3} \\approx 7{,}333\\,\\text{V}');
    expect(valueTex(Fraction.from(6), 'V')).toBe('6\\,\\text{V}');
  });
});

describe('names', () => {
  it('uses letters for nodes', () => {
    expect(nodeTex(1)).toBe('V_{A}');
    expect(nodeTex(2)).toBe('V_{B}');
    expect(nodeTex(0)).toBe('0');
  });

  it('writes element names with subscripts', () => {
    expect(nameTex('R1')).toBe('R_{\\mathrm{1}}');
    expect(nameTex('Rf')).toBe('R_{\\mathrm{f}}');
    expect(nameTex('V')).toBe('V');
  });

  it('keeps anything unusual as plain text and cannot run LaTeX commands', () => {
    expect(nameTex('Ç1')).toBe('\\text{Ç1}');
    expect(nameTex('a b')).toBe('\\text{a b}');
    expect(nameTex('\\href{x}{y}')).toBe('\\text{\\textbackslash{}href\\{x\\}\\{y\\}}');
  });
});

describe('example 1: voltage divider', () => {
  const views = viewsOf(voltageDivider);

  it('follows the course order', () => {
    expect(views.map((view) => view.type)).toEqual([
      'nodes',
      'reference',
      'known-voltages',
      'kcl',
      'node-voltages',
      'element-results',
      'verification',
    ]);
  });

  it('reads the known voltage directly', () => {
    expect(texts(viewOf(views, 'known-voltages'))).toEqual(['V_{A} = 10\\,\\text{V}']);
  });

  it('writes the law, numeric values and simplified equation', () => {
    const kcl = viewOf(views, 'kcl');
    expect(kcl.title).toBe('VB düğümünde Kirchhoff’un Akım Kanunu');
    expect(texts(kcl)).toEqual([
      'I_{R_{\\mathrm{1}}} = I_{R_{\\mathrm{2}}} \\Rightarrow ' +
        '\\frac{V_{A} - V_{B}}{R_{\\mathrm{1}}} = \\frac{V_{B}}{R_{\\mathrm{2}}}',
      '\\frac{10 - V_{B}}{2\\,\\text{k}} = \\frac{V_{B}}{3\\,\\text{k}}',
      'V_{B} = 6\\,\\text{V}',
    ]);
  });

  it('gives the answer', () => {
    expect(texts(viewOf(views, 'node-voltages'))).toEqual([
      'V_{A} = 10\\,\\text{V}',
      'V_{B} = 6\\,\\text{V}',
    ]);
  });
});

describe('example 2: two current sources', () => {
  const views = viewsOf(twoCurrentSources);

  it('puts the source entering the node on the left', () => {
    const first = texts(viewOf(views, 'kcl', 0));
    expect(first[0]).toBe(
      'I_{\\mathrm{1}} = I_{R_{\\mathrm{1}}} + I_{R_{\\mathrm{2}}} \\Rightarrow ' +
        'I_{\\mathrm{1}} = \\frac{V_{A}}{R_{\\mathrm{1}}} + \\frac{V_{A} - V_{B}}{R_{\\mathrm{2}}}',
    );
    expect(first.at(-2)).toBe('2 = \\frac{V_{A}}{4} + \\frac{V_{A} - V_{B}}{2}');
    expect(first.at(-1)).toBe('3\\,V_{A} - 2\\,V_{B} = 8');
  });

  it('shows the matrix', () => {
    expect(texts(viewOf(views, 'system'))[0]).toBe(
      '\\begin{bmatrix} 3 & -2 \\\\ 3 & -4 \\end{bmatrix} ' +
        '\\begin{bmatrix} V_{A} \\\\ V_{B} \\end{bmatrix} = \\begin{bmatrix} 8 \\\\ -6 \\end{bmatrix}',
    );
  });

  it('gives exact answers with decimals', () => {
    expect(texts(viewOf(views, 'node-voltages'))).toEqual([
      'V_{A} = \\frac{22}{3} \\approx 7{,}333\\,\\text{V}',
      'V_{B} = 7\\,\\text{V}',
    ]);
  });

  it('marks the assumed current directions for the drawing', () => {
    expect(viewOf(views, 'kcl', 0).assumedCurrents).toEqual([
      { elementId: 'I1', fromNode: null, name: 'I1' },
      { elementId: 'R1', fromNode: 1, name: 'IR1' },
      { elementId: 'R2', fromNode: 1, name: 'IR2' },
    ]);
  });
});

describe('example 3: voltage and current source together', () => {
  const views = viewsOf(mixedSources);

  it('solves one equation in one unknown, without a matrix', () => {
    const kcl = viewOf(views, 'kcl');
    expect(texts(kcl).at(-1)).toBe(
      '3\\,V_{B} = 25 \\Rightarrow V_{B} = \\frac{25}{3} \\approx 8{,}333\\,\\text{V}',
    );
  });

  it('balances the power', () => {
    expect(viewOf(views, 'verification').notes).toEqual([
      'Her düğümde giren akım çıkan akıma eşit.',
      'Üretilen güç = tüketilen güç = 7,5 W',
    ]);
  });

  it('says which elements deliver and which absorb', () => {
    const rows = viewOf(views, 'element-results').rows;
    expect(rows.find((row) => row.name === 'V1')?.power).toBe('3,333 W üretir');
    expect(rows.find((row) => row.name === 'R2')?.power).toBe('6,944 W tüketir');
    expect(rows.find((row) => row.name === 'R1')?.current).toBe('0,333 A');
  });
});

describe('example 4: supernode', () => {
  const views = viewsOf(supernode);

  it('states the relation between the nodes', () => {
    expect(texts(viewOf(views, 'supernode'))).toEqual(['V_{B} = V_{A} + 6']);
  });

  it('writes one equation for the whole supernode, using that relation', () => {
    const kcl = viewOf(views, 'kcl');
    expect(kcl.title).toBe('VA, VB süper düğümünde Kirchhoff’un Akım Kanunu');
    const lines = texts(kcl);
    expect(lines[0]).toBe(
      'I_{\\mathrm{1}} + I_{R_{\\mathrm{1}}} = I_{R_{\\mathrm{2}}} \\Rightarrow ' +
        'I_{\\mathrm{1}} + \\frac{0 - V_{A}}{R_{\\mathrm{1}}} = \\frac{V_{B}}{R_{\\mathrm{2}}}',
    );
    expect(lines.at(-2)).toBe('2 + \\frac{0 - V_{A}}{4} = \\frac{V_{A} + 6}{2}');
    expect(lines.at(-1)).toBe(
      '3\\,V_{A} = -4 \\Rightarrow V_{A} = -\\frac{4}{3} \\approx -1{,}333\\,\\text{V}',
    );
  });
});

describe('equation forms', () => {
  it('writes the leaving-sum form with everything on one side', () => {
    const lines = texts(viewOf(viewsOf(twoCurrentSources, 'leaving-sum'), 'kcl', 0));
    expect(lines[0]).toBe(
      '-I_{\\mathrm{1}} + I_{R_{\\mathrm{1}}} + I_{R_{\\mathrm{2}}} = 0 \\Rightarrow ' +
        '-I_{\\mathrm{1}} + \\frac{V_{A}}{R_{\\mathrm{1}}} + \\frac{V_{A} - V_{B}}{R_{\\mathrm{2}}} = 0',
    );
    expect(lines.at(-2)).toBe('-2 + \\frac{V_{A}}{4} + \\frac{V_{A} - V_{B}}{2} = 0');
    expect(lines.at(-1)).toBe('3\\,V_{A} - 2\\,V_{B} = 8');
  });

  it('explains the form in use', () => {
    expect(viewOf(viewsOf(voltageDivider, 'entering-equals-leaving'), 'kcl').why).toContain('eşittir');
    expect(viewOf(viewsOf(voltageDivider, 'leaving-sum'), 'kcl').why).toContain('sıfırdır');
  });
});

describe('the DC equivalent step', () => {
  const view = dcEquivalentView([
    { id: 'a', label: 'C1', kind: 'capacitor' },
    { id: 'b', label: 'L1', kind: 'inductor' },
    { id: 'c', label: 'S1', kind: 'switch', closed: false },
    { id: 'd', label: 'S2', kind: 'switch', closed: true },
    { id: 'e', label: 'A1', kind: 'ammeter' },
    { id: 'f', label: 'Vm1', kind: 'voltmeter' },
  ]);

  it('says what each element turns into, by name', () => {
    expect(view.facts).toEqual([
      'C1: Kondansatör DC’de açık devre olur, akım geçmez.',
      'L1: Bobin DC’de kısa devre olur, tel gibi davranır.',
      'S1: Anahtar açık, bu koldan akım geçmez.',
      'S2: Anahtar kapalı, tel gibi davranır.',
      'A1: İdeal ampermetrenin direnci sıfırdır, tel gibi davranır ve devreyi etkilemez.',
      'Vm1: İdeal voltmetreden akım geçmez, açık devre gibi davranır ve devreyi etkilemez.',
    ]);
  });

  it('highlights those elements and reveals no answers', () => {
    expect(view.elementIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(revealsNodeValues(view.type)).toBe(false);
    expect(revealsCurrents(view.type)).toBe(false);
  });

  it('shows readings in the results table, with no power used', () => {
    expect(measuredRow({ label: 'A1', voltage: Fraction.ZERO, current: Fraction.ratio(-1n, 100n) })).toEqual({
      name: 'A1',
      voltage: '0 V',
      current: '10 mA',
      power: '0 W',
    });
    expect(measuredRow({ label: 'C1', voltage: null, current: Fraction.ZERO }).voltage).toBe('belirsiz');
  });
});

describe('MNA form', () => {
  it('adds the source current as an unknown', () => {
    const solution = solveWithSteps(mixedSources);
    if (solution.status !== 'solved') throw new Error('not solved');
    const tex = mnaTex(solution.mna, labelOf);
    expect(tex).toContain('I_{V_{\\mathrm{1}}}');
    expect(tex).toContain('V_{A} \\\\ V_{B}');
  });
});

describe('every generated equation is valid LaTeX', () => {
  const render = (tex: string): void => {
    katex.renderToString(tex, { throwOnError: true, strict: false, displayMode: true });
  };

  it.each(['entering-equals-leaving', 'leaving-sum'] as const)('on 200 random circuits, %s', (convention) => {
    for (let seed = 0; seed < 200; seed++) {
      const solution = solveWithSteps(randomCircuit(seed));
      if (solution.status !== 'solved') throw new Error(`seed ${seed}`);
      for (const step of solution.steps) {
        stepView(step, convention, labelOf).lines.forEach((line) => render(line.tex));
      }
      render(mnaTex(solution.mna, labelOf));
    }
    // Rendering every line of 200 solutions takes close to Vitest's 5-second default when the whole
    // suite runs in parallel, and task 23 adds a line for every resistor.
  }, 30_000);

  it('with awkward names', () => {
    const names = ['R$1', '%x', '#', '_a', 'R^2', '~', '{', '}', '\\end{bmatrix}', 'Ş1', 'a b', '<b>'];
    for (const name of names) {
      const solution = solveWithSteps(voltageDivider);
      if (solution.status !== 'solved') throw new Error('not solved');
      for (const step of solution.steps) {
        stepView(step, 'entering-equals-leaving', () => name).lines.forEach((line) => render(line.tex));
      }
      render(mnaTex(solution.mna, () => name));
    }
  });
});
