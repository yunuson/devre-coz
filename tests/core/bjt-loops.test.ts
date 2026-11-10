import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  ground,
  npn,
  pnp,
  resistor,
  solveWithSteps,
  voltageSource,
  zener,
  type Circuit,
  type SolutionStep,
} from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { formatQuantity } from '../../src/ui/format';
import {
  nameTex,
  quantityTex,
  resistanceTex,
  revealsCurrents,
  revealsNodeValues,
  stepView,
} from '../../src/ui/steps-panel/step-views';

/**
 * The BJT the way the exams solve it: a Kirchhoff's voltage law loop through the base, IB from it,
 * IC = β·IB and IE = (β + 1)·IB, a second loop through the collector for VCE, then the terminal
 * voltages. Only for transistors in one of the textbook bias patterns, in the active region; any
 * other circuit keeps the general solution of task 15. Values are ours; the reference values come
 * from an independent exact calculation of each loop.
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

const types = (circuit: Circuit) => solved(circuit).steps.map(({ type }) => type);

const stepsOf = <T extends SolutionStep['type']>(circuit: Circuit, type: T): StepOf<T>[] =>
  solved(circuit).steps.filter((step): step is StepOf<T> => step.type === type);

const stepOf = <T extends SolutionStep['type']>(circuit: Circuit, type: T): StepOf<T> => {
  const [step] = stepsOf(circuit, type);
  if (!step) throw new Error(`no ${type} step`);
  return step;
};

const text = (value: { toString(): string }) => value.toString();

/** Fixed bias: 10 V, RB = 200 kΩ, RC = 1 kΩ, β = 100. IB = 9,3 V/200 kΩ = 46,5 µA. */
const fixedBias: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 10),
    resistor('RB', 'vcc', 'b', 200000),
    resistor('RC', 'vcc', 'c', 1000),
    npn('Q1', 'b', 'c', 'gnd'),
    ground('G', 'gnd'),
  ],
};

/** Emitter resistor: 15 V, RB = 300 kΩ, RC = 2 kΩ, RE = 1 kΩ. IB = 14,3/(300k + 101·1k). */
const emitterResistor: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 15),
    resistor('RB', 'vcc', 'b', 300000),
    resistor('RC', 'vcc', 'c', 2000),
    resistor('RE', 'e', 'gnd', 1000),
    npn('Q1', 'b', 'c', 'e'),
    ground('G', 'gnd'),
  ],
};

/** Voltage divider: 12 V, R1 = 40 kΩ, R2 = 10 kΩ, RC = 4 kΩ, RE = 1 kΩ. ETH = 2,4 V, RTH = 8 kΩ. */
const divider: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 12),
    resistor('R1', 'vcc', 'b', 40000),
    resistor('R2', 'b', 'gnd', 10000),
    resistor('RC', 'vcc', 'c', 4000),
    resistor('RE', 'e', 'gnd', 1000),
    npn('Q1', 'b', 'c', 'e'),
    ground('G', 'gnd'),
  ],
};

/** PNP: emitter through 2 kΩ to +10 V, base through 100 kΩ to ground, collector through 3 kΩ to −10 V. */
const pnpCircuit: Circuit = {
  elements: [
    voltageSource('VEE', 'vee', 'gnd', 10),
    voltageSource('VCC', 'vcc', 'gnd', -10),
    resistor('RE', 'vee', 'e', 2000),
    resistor('RB', 'b', 'gnd', 100000),
    resistor('RC', 'c', 'vcc', 3000),
    pnp('Q1', 'b', 'c', 'e'),
    ground('G', 'gnd'),
  ],
};

/** A series regulator: a 12 V Zener holds the base, Vo = 12 − 0,7 = 11,3 V across 1 kΩ, β = 50. */
const regulator: Circuit = {
  elements: [
    voltageSource('Vi', 'a', 'gnd', 20),
    resistor('R1', 'a', 'b', 1000),
    zener('Z1', 'gnd', 'b', 12),
    npn('Q1', 'b', 'a', 'out', 50),
    resistor('R2', 'out', 'gnd', 1000),
    ground('G', 'gnd'),
  ],
};

/** Two separate stages on one 12 V supply: Q1 fixed bias (β = 100), Q2 with an emitter resistor (β = 50). */
const twoSeparate: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 12),
    resistor('RB1', 'vcc', 'b1', 470000),
    resistor('RC1', 'vcc', 'c1', 2000),
    npn('Q1', 'b1', 'c1', 'gnd'),
    resistor('RB2', 'vcc', 'b2', 220000),
    resistor('RC2', 'vcc', 'c2', 1000),
    resistor('RE2', 'e2', 'gnd', 470),
    npn('Q2', 'b2', 'c2', 'e2', 50),
    ground('G', 'gnd'),
  ],
};

/** Collector feedback: RF from the collector to the base. Not one of the patterns. */
const collectorFeedback: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 10),
    resistor('RC', 'vcc', 'c', 1000),
    resistor('RF', 'c', 'b', 100000),
    npn('Q1', 'b', 'c', 'gnd'),
    ground('G', 'gnd'),
  ],
};

/** Fixed bias with a load on the collector: two resistors meet there, so it isn't a pattern. */
const collectorLoad: Circuit = {
  elements: [...fixedBias.elements, resistor('RL', 'c', 'gnd', 1000)],
};

/** Fixed bias plus an unrelated divider elsewhere: node m belongs to no transistor. */
const extraNode: Circuit = {
  elements: [...fixedBias.elements, resistor('R3', 'vcc', 'm', 1000), resistor('R4', 'm', 'gnd', 1000)],
};

/** Too much base current for 1 kΩ: the transistor saturates. */
const saturated: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 10),
    resistor('RB', 'vcc', 'b', 10000),
    resistor('RC', 'vcc', 'c', 1000),
    npn('Q1', 'b', 'c', 'gnd'),
    ground('G', 'gnd'),
  ],
};

/** Two direct-coupled stages: Q2's base is Q1's collector. */
const twoStages: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 15),
    resistor('R1', 'vcc', 'b1', 90000),
    resistor('R2', 'b1', 'gnd', 30000),
    resistor('RC1', 'vcc', 'c1', 4000),
    resistor('RE1', 'e1', 'gnd', 2000),
    npn('Q1', 'b1', 'c1', 'e1'),
    resistor('RC2', 'vcc', 'c2', 1000),
    resistor('RE2', 'e2', 'gnd', 3000),
    npn('Q2', 'c1', 'c2', 'e2'),
    ground('G', 'gnd'),
  ],
};

const PATTERNS = [fixedBias, emitterResistor, divider, pnpCircuit, regulator, twoSeparate];
const GENERAL = [collectorFeedback, collectorLoad, extraNode, saturated, twoStages];

describe('which circuits are solved with loops', () => {
  it('recognises each textbook pattern', () => {
    const pattern = (circuit: Circuit) => stepsOf(circuit, 'bjt-input-loop').map((step) => [step.transistorId, step.pattern]);
    expect(pattern(fixedBias)).toEqual([['Q1', 'fixed']]);
    expect(pattern(emitterResistor)).toEqual([['Q1', 'emitter-resistor']]);
    expect(pattern(divider)).toEqual([['Q1', 'divider']]);
    expect(pattern(pnpCircuit)).toEqual([['Q1', 'emitter-resistor']]);
    expect(pattern(regulator)).toEqual([['Q1', 'known-base']]);
    expect(pattern(twoSeparate)).toEqual([['Q1', 'fixed'], ['Q2', 'emitter-resistor']]);
  });

  it('writes loops instead of the matrix', () => {
    for (const circuit of PATTERNS) {
      expect(types(circuit)).not.toContain('transistor-equations');
      expect(types(circuit)).toContain('bjt-output-loop');
    }
  });

  it('keeps the general solution when any transistor is outside the patterns or not active', () => {
    for (const circuit of GENERAL) {
      expect(types(circuit)).toContain('transistor-equations');
      for (const type of ['bjt-thevenin', 'bjt-input-loop', 'bjt-output-loop', 'bjt-voltages']) {
        expect(types(circuit)).not.toContain(type);
      }
    }
  });

  it('still gives the matrix for the advanced view', () => {
    const solution = solved(fixedBias);
    expect(solution.mna.unknowns).toContainEqual({ kind: 'base-current', elementId: 'Q1' });
  });
});

describe('the order of a paper solution', () => {
  it('goes input loop, output loop, terminal voltages, then the checks', () => {
    expect(types(fixedBias)).toEqual([
      'transistor-states',
      'nodes',
      'reference',
      'known-voltages',
      'bjt-input-loop',
      'bjt-output-loop',
      'bjt-voltages',
      'node-voltages',
      'element-results',
      'transistor-currents',
      'transistor-check',
      'verification',
    ]);
  });

  it('replaces the divider by its Thevenin equivalent first', () => {
    expect(types(divider).slice(4, 8)).toEqual(['bjt-thevenin', 'bjt-input-loop', 'bjt-output-loop', 'bjt-voltages']);
  });

  it('decides the Zener first and checks it before the transistor', () => {
    expect(types(regulator)).toEqual([
      'diode-states',
      'transistor-states',
      'nodes',
      'reference',
      'known-voltages',
      'bjt-input-loop',
      'bjt-output-loop',
      'bjt-voltages',
      'node-voltages',
      'element-results',
      'transistor-currents',
      'diode-check',
      'transistor-check',
      'verification',
    ]);
  });

  it('solves one transistor completely before the next', () => {
    const loops = solved(twoSeparate).steps.flatMap((step) =>
      step.type === 'bjt-input-loop' || step.type === 'bjt-output-loop' || step.type === 'bjt-voltages'
        ? [`${step.type}:${step.transistorId}`]
        : [],
    );
    expect(loops).toEqual([
      'bjt-input-loop:Q1', 'bjt-output-loop:Q1', 'bjt-voltages:Q1',
      'bjt-input-loop:Q2', 'bjt-output-loop:Q2', 'bjt-voltages:Q2',
    ]);
  });
});

describe('the loops', () => {
  it('fixed bias: the base loop has no emitter resistor', () => {
    const step = stepOf(fixedBias, 'bjt-input-loop');
    expect(step).toMatchObject({ transistorId: 'Q1', polarity: 'npn' });
    expect(step.base).toMatchObject({ sourceId: 'VCC', resistorId: 'RB' });
    expect(text(step.base.voltage)).toBe('10');
    expect(text(step.base.resistance)).toBe('200000');
    expect(step.emitter).toMatchObject({ sourceId: null, resistorId: null });
    expect(text(step.emitter.voltage)).toBe('0');
    expect(text(step.emitter.resistance)).toBe('0');
    expect([text(step.ib), text(step.ic), text(step.ie)]).toEqual(['93/2000000', '93/20000', '9393/2000000']);
    expect(text(step.beta)).toBe('100');
    expect(text(step.vbe)).toBe('7/10');
    expect(step.elementIds).toEqual(['Q1', 'RB']);
  });

  it('emitter resistor: IB = (VCC − VBE)/(RB + (β + 1)·RE)', () => {
    const step = stepOf(emitterResistor, 'bjt-input-loop');
    expect(step.emitter).toMatchObject({ resistorId: 'RE' });
    expect(text(step.emitter.resistance)).toBe('1000');
    expect([text(step.ib), text(step.ic), text(step.ie)]).toEqual(['143/4010000', '143/40100', '14443/4010000']);
    expect(step.elementIds).toEqual(['Q1', 'RB', 'RE']);
  });

  it('voltage divider: ETH = R2/(R1 + R2)·VCC, RTH = R1 ∥ R2, then the same loop', () => {
    const thevenin = stepOf(divider, 'bjt-thevenin');
    expect(thevenin.transistorId).toBe('Q1');
    expect(thevenin.upper).toMatchObject({ sourceId: 'VCC', resistorId: 'R1' });
    expect(thevenin.lower).toMatchObject({ sourceId: null, resistorId: 'R2' });
    expect([text(thevenin.upper.voltage), text(thevenin.lower.voltage)]).toEqual(['12', '0']);
    expect([text(thevenin.eth), text(thevenin.rth)]).toEqual(['12/5', '8000']);
    expect(thevenin.elementIds).toEqual(['R1', 'R2']);

    const loop = stepOf(divider, 'bjt-input-loop');
    expect(loop.base).toMatchObject({ node: null, sourceId: null, resistorId: null });
    expect([text(loop.base.voltage), text(loop.base.resistance)]).toEqual(['12/5', '8000']);
    expect([text(loop.ib), text(loop.ic), text(loop.ie)]).toEqual(['17/1090000', '17/10900', '1717/1090000']);
    expect(loop.elementIds).toEqual(['Q1', 'R1', 'R2', 'RE']);
  });

  it('PNP: the loop starts at the emitter supply, −VEE + IE·RE + VEB + IB·RB = 0', () => {
    const step = stepOf(pnpCircuit, 'bjt-input-loop');
    expect(step.polarity).toBe('pnp');
    expect(step.emitter).toMatchObject({ sourceId: 'VEE', resistorId: 'RE' });
    expect(step.base).toMatchObject({ sourceId: null, resistorId: 'RB' });
    expect([text(step.ib), text(step.ic), text(step.ie)]).toEqual(['93/3020000', '93/30200', '9393/3020000']);
  });

  it('known base: VE = VB − VBE, IE through RE, IB = IE/(β + 1)', () => {
    const step = stepOf(regulator, 'bjt-input-loop');
    expect(step.base).toMatchObject({ sourceId: 'Z1', resistorId: null });
    expect([text(step.base.voltage), text(step.base.resistance)]).toEqual(['12', '0']);
    expect(step.emitter).toMatchObject({ resistorId: 'R2' });
    expect([text(step.ib), text(step.ic), text(step.ie)]).toEqual(['113/510000', '113/10200', '113/10000']);
    expect(step.elementIds).toEqual(['Q1', 'R2']);
  });

  it('output loop: VCE from the collector supply, the collector resistor and the emitter side', () => {
    const vce = (circuit: Circuit) => stepsOf(circuit, 'bjt-output-loop').map((step) => text(step.vce));
    expect(vce(fixedBias)).toEqual(['107/20']);
    expect(vce(emitterResistor)).toEqual(['17107/4010']);
    expect(vce(divider)).toEqual(['4563/1090']);
    expect(vce(regulator)).toEqual(['87/10']);
    expect(vce(twoSeparate)).toEqual(['338/47', '2091779/243970']);

    const step = stepOf(emitterResistor, 'bjt-output-loop');
    expect(step.collector).toMatchObject({ sourceId: 'VCC', resistorId: 'RC' });
    expect(step.emitter).toMatchObject({ resistorId: 'RE' });
    expect([text(step.ic), text(step.ie)]).toEqual(['143/40100', '14443/4010000']);
    expect(step.elementIds).toEqual(['Q1', 'RC', 'RE']);
  });

  it('output loop of a PNP gives VEC, positive in the active region', () => {
    const step = stepOf(pnpCircuit, 'bjt-output-loop');
    expect(text(step.vce)).toBe('6857/1510');
    expect(step.collector).toMatchObject({ sourceId: 'VCC', resistorId: 'RC' });
    expect(text(step.collector.voltage)).toBe('-10');
  });

  it('output loop of the regulator: the collector sits right on Vi', () => {
    const step = stepOf(regulator, 'bjt-output-loop');
    expect(step.collector).toMatchObject({ sourceId: 'Vi', resistorId: null });
    expect(text(step.collector.voltage)).toBe('20');
    expect(text(step.collector.resistance)).toBe('0');
  });

  it('terminal voltages', () => {
    const voltages = (circuit: Circuit) =>
      stepsOf(circuit, 'bjt-voltages').map((step) => [step.transistorId, text(step.vb), text(step.vc), text(step.ve)]);
    expect(voltages(fixedBias)).toEqual([['Q1', '7/10', '107/20', '0']]);
    expect(voltages(emitterResistor)).toEqual([['Q1', '1725/401', '3155/401', '14443/4010']]);
    expect(voltages(divider)).toEqual([['Q1', '248/109', '628/109', '1717/1090']]);
    expect(voltages(pnpCircuit)).toEqual([['Q1', '465/151', '-115/151', '5707/1510']]);
    expect(voltages(regulator)).toEqual([['Q1', '12', '20', '113/10']]);
    expect(stepOf(fixedBias, 'bjt-voltages').elementIds).toEqual(['Q1']);
  });

  it('agrees with the general solution', () => {
    for (const circuit of PATTERNS) {
      const solution = solved(circuit);
      for (const step of stepsOf(circuit, 'bjt-voltages')) {
        const result = solution.analysis.transistors!.get(step.transistorId)!;
        expect([text(step.vb), text(step.vc), text(step.ve)]).toEqual([text(result.vb), text(result.vc), text(result.ve)]);
      }
      for (const step of stepsOf(circuit, 'bjt-input-loop')) {
        const result = solution.analysis.transistors!.get(step.transistorId)!;
        expect([text(step.ib), text(step.ic), text(step.ie)]).toEqual([text(result.ib), text(result.ic), text(result.ie)]);
      }
    }
  });
});

describe('what the student reads', () => {
  const views = (circuit: Circuit) =>
    solved(circuit).steps.map((step) => stepView(step, 'entering-equals-leaving', (id) => id));
  const viewsOf = (circuit: Circuit, type: string) => views(circuit).filter((view) => view.type === type);
  const viewOf = (circuit: Circuit, type: string) => viewsOf(circuit, type)[0]!;
  const fill = (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template);
  const texts = (circuit: Circuit, type: string) => viewOf(circuit, type).lines.map(({ tex }) => tex);

  it('writes results as rounded quantities', () => {
    expect(quantityTex(stepOf(fixedBias, 'bjt-input-loop').ib, 'A')).toBe(`\\text{${formatQuantity(stepOf(fixedBias, 'bjt-input-loop').ib, 'A')}}`);
  });

  it('names each step after its transistor', () => {
    expect(viewOf(fixedBias, 'bjt-input-loop').title).toBe(fill(tr.learn.bjtInputLoop.title, { name: 'Q1' }));
    expect(viewOf(fixedBias, 'bjt-output-loop').title).toBe(fill(tr.learn.bjtOutputLoop.title, { name: 'Q1' }));
    expect(viewOf(fixedBias, 'bjt-voltages').title).toBe(fill(tr.learn.bjtVoltages.title, { name: 'Q1' }));
    expect(viewOf(divider, 'bjt-thevenin').title).toBe(fill(tr.learn.bjtThevenin.title, { name: 'Q1' }));
    expect(viewsOf(twoSeparate, 'bjt-input-loop').map(({ title }) => title)).toEqual([
      fill(tr.learn.bjtInputLoop.title, { name: 'Q1' }),
      fill(tr.learn.bjtInputLoop.title, { name: 'Q2' }),
    ]);
    expect(viewOf(fixedBias, 'bjt-input-loop').why).toBe(tr.learn.bjtInputLoop.why);
    expect(viewOf(regulator, 'bjt-input-loop').why).toBe(tr.learn.bjtInputLoop.whyKnownBase);
    expect(viewOf(fixedBias, 'bjt-output-loop').why).toBe(tr.learn.bjtOutputLoop.why);
    expect(viewOf(fixedBias, 'bjt-voltages').why).toBe(tr.learn.bjtVoltages.why);
    expect(viewOf(divider, 'bjt-thevenin').why).toBe(tr.learn.bjtThevenin.why);
  });

  it('input loop: the law, IE = (β + 1)·IB put in, IB, then IC and IE', () => {
    const step = stepOf(emitterResistor, 'bjt-input-loop');
    const lines = viewOf(emitterResistor, 'bjt-input-loop').lines;
    expect(lines.map(({ caption }) => caption)).toEqual([
      tr.learn.bjtInputLoop.law,
      tr.learn.bjtInputLoop.substitute,
      tr.learn.bjtInputLoop.solve,
      undefined,
      undefined,
    ]);
    const [law, substituted, ib, ic, ie] = lines.map(({ tex }) => tex);
    expect(law).toContain(nameTex('VCC'));
    expect(law).toContain(`I_{B1} ${nameTex('RB')}`);
    expect(law).toContain('V_{BE1}');
    expect(law).toContain(`I_{E1} ${nameTex('RE')}`);
    expect(law!.endsWith('= 0')).toBe(true);
    expect(substituted).toContain(`(\\beta + 1) I_{B1} ${nameTex('RE')}`);
    expect(substituted).not.toContain('I_{E1}');
    expect(ib!.startsWith('I_{B1} =')).toBe(true);
    expect(ib).toContain(resistanceTex(step.base.resistance));
    expect(ib!.endsWith(`= ${quantityTex(step.ib, 'A')}`)).toBe(true);
    expect(ic).toBe(`I_{C1} = \\beta I_{B1} = ${quantityTex(step.ic, 'A')}`);
    expect(ie).toBe(`I_{E1} = (\\beta + 1) I_{B1} = ${quantityTex(step.ie, 'A')}`);
  });

  it('input loop without an emitter resistor has nothing to put in', () => {
    const lines = viewOf(fixedBias, 'bjt-input-loop').lines;
    expect(lines.map(({ caption }) => caption)).toEqual([tr.learn.bjtInputLoop.law, tr.learn.bjtInputLoop.solve, undefined, undefined]);
    expect(lines[0]!.tex).not.toContain('I_{E1}');
  });

  it('PNP loop with VEB and the emitter supply first', () => {
    const [law] = texts(pnpCircuit, 'bjt-input-loop');
    expect(law).toContain('V_{EB1}');
    expect(law).not.toContain('V_{BE1}');
    expect(law!.indexOf(nameTex('VEE'))).toBeLessThan(law!.indexOf('V_{EB1}'));
  });

  it('divider: ETH and RTH in the Thevenin step, and in the loop', () => {
    const step = stepOf(divider, 'bjt-thevenin');
    const [eth, rth] = texts(divider, 'bjt-thevenin');
    expect(eth!.startsWith('E_{TH} =')).toBe(true);
    expect(eth).toContain(nameTex('R2'));
    expect(eth!.endsWith(`= ${quantityTex(step.eth, 'V')}`)).toBe(true);
    expect(rth!.startsWith('R_{TH} =')).toBe(true);
    expect(rth).toContain('\\parallel');
    expect(rth!.endsWith(`= ${resistanceTex(step.rth)}`)).toBe(true);
    const [law] = texts(divider, 'bjt-input-loop');
    expect(law).toContain('E_{TH}');
    expect(law).toContain('R_{TH}');
  });

  it('known base: VE, IE, IB, IC', () => {
    const step = stepOf(regulator, 'bjt-input-loop');
    const lines = texts(regulator, 'bjt-input-loop');
    expect(lines).toHaveLength(4);
    expect(lines[0]!.startsWith('V_{E1} = V_{B1} - V_{BE1}')).toBe(true);
    expect(lines[1]!.startsWith('I_{E1} =')).toBe(true);
    expect(lines[1]!.endsWith(`= ${quantityTex(step.ie, 'A')}`)).toBe(true);
    expect(lines[2]).toBe(`I_{B1} = \\frac{I_{E1}}{\\beta + 1} = ${quantityTex(step.ib, 'A')}`);
    expect(lines[3]).toBe(`I_{C1} = \\beta I_{B1} = ${quantityTex(step.ic, 'A')}`);
  });

  it('output loop: the law, then VCE', () => {
    const step = stepOf(emitterResistor, 'bjt-output-loop');
    const [law, vce] = texts(emitterResistor, 'bjt-output-loop');
    expect(law).toContain(`I_{C1} ${nameTex('RC')}`);
    expect(law).toContain('V_{CE1}');
    expect(law).toContain(`I_{E1} ${nameTex('RE')}`);
    expect(law!.endsWith('= 0')).toBe(true);
    expect(vce!.startsWith('V_{CE1} =')).toBe(true);
    expect(vce!.endsWith(`= ${quantityTex(step.vce, 'V')}`)).toBe(true);
    const [pnpLaw, vec] = texts(pnpCircuit, 'bjt-output-loop');
    expect(pnpLaw).toContain('V_{EC1}');
    expect(vec!.startsWith('V_{EC1} =')).toBe(true);
  });

  it('terminal voltages: VE, VB, VC', () => {
    const step = stepOf(emitterResistor, 'bjt-voltages');
    const lines = texts(emitterResistor, 'bjt-voltages');
    expect(lines).toHaveLength(3);
    expect(lines[0]!.startsWith('V_{E1} =')).toBe(true);
    expect(lines[0]!.endsWith(`= ${quantityTex(step.ve, 'V')}`)).toBe(true);
    expect(lines[1]!.startsWith('V_{B1} =')).toBe(true);
    expect(lines[1]!.endsWith(`= ${quantityTex(step.vb, 'V')}`)).toBe(true);
    expect(lines[2]!.startsWith('V_{C1} =')).toBe(true);
    expect(lines[2]!.endsWith(`= ${quantityTex(step.vc, 'V')}`)).toBe(true);
  });

  it('PNP currents are listed with VEC', () => {
    const step = stepOf(pnpCircuit, 'transistor-currents');
    const [q] = step.transistors;
    expect(viewOf(pnpCircuit, 'transistor-currents').facts).toEqual([
      fill(tr.learn.transistorCurrents.activePnp, {
        name: 'Q1',
        i: '1',
        ib: formatQuantity(q!.ib, 'A'),
        ic: formatQuantity(q!.ic, 'A'),
        ie: formatQuantity(q!.ie, 'A'),
        vec: formatQuantity(q!.vce.neg(), 'V'),
      }),
    ]);
    expect(tr.learn.transistorCurrents.activePnp).toBe('{name}: IB{i} = {ib}, IC{i} = β·IB{i} = {ic}, IE{i} = (β + 1)·IB{i} = {ie}, VEC{i} = {vec}.');
  });

  it('uses the words of the exam solutions', () => {
    expect(tr.learn.bjtInputLoop.law).toBe("Kirchhoff'un Gerilim Kanunu");
    expect(tr.learn.bjtInputLoop.title).toBe('{name}: giriş çevresi');
    expect(tr.learn.bjtOutputLoop.title).toBe('{name}: çıkış çevresi');
    expect(tr.learn.bjtThevenin.title).toBe('{name}: bazın Thevenin eşdeğeri');
    expect(tr.learn.bjtVoltages.title).toBe('{name}: uç gerilimleri');
  });

  it('puts voltages on the drawing from the terminal voltages on, currents only from the results', () => {
    expect(revealsNodeValues('bjt-voltages')).toBe(true);
    for (const type of ['bjt-thevenin', 'bjt-input-loop', 'bjt-output-loop'] as const) {
      expect(revealsNodeValues(type)).toBe(false);
      expect(revealsCurrents(type)).toBe(false);
    }
    expect(revealsCurrents('bjt-voltages')).toBe(false);
  });

  it('renders as valid LaTeX', () => {
    for (const circuit of [...PATTERNS, ...GENERAL]) {
      for (const view of views(circuit)) {
        for (const { tex } of view.lines) {
          expect(() => katex.renderToString(tex, { throwOnError: true, strict: false })).not.toThrow();
        }
      }
    }
  });
});
