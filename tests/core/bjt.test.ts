import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  diode,
  Fraction,
  ground,
  npn,
  pnp,
  resistor,
  solveWithSteps,
  voltageAt,
  voltageSource,
  zener,
  type Circuit,
  type SolutionStep,
} from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { formatQuantity } from '../../src/ui/format';
import { mnaTex, stepView } from '../../src/ui/steps-panel/step-views';

/**
 * Task 15: the BJT in the core. As in the Elektronik 1 exam solutions, a transistor is first
 * assumed to be in its active region (VBE = 0,7 V, IC = β·IB), the circuit is solved, and the
 * assumption is checked at the end (VC > VB for an NPN). Saturation takes VCE = 0 V, cutoff
 * carries no current. Values are ours; the reference values come from an independent exact MNA.
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

const stepOf = <T extends SolutionStep['type']>(solution: Solved, type: T): StepOf<T> => {
  const step = solution.steps.find((candidate): candidate is StepOf<T> => candidate.type === type);
  if (!step) throw new Error(`no ${type} step`);
  return step;
};

function solvedResult(circuit: Circuit) {
  const result = analyze(circuit);
  if (result.status !== 'solved') {
    throw new Error(`Not solved: ${result.issues.map((issue) => issue.code).join(', ')}`);
  }
  return result;
}

const transistor = (circuit: Circuit, id = 'Q1') => {
  const result = solvedResult(circuit).transistors?.get(id);
  if (!result) throw new Error(`no result for ${id}`);
  return result;
};

const text = (value: { toString(): string }) => value.toString();
const f = (value: string) => {
  const [num, den = '1'] = value.split('/');
  return Fraction.from(num!).div(Fraction.from(den));
};

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

/** Too much base current for 1 kΩ: active would put VC at −83 V, so it saturates with IC = 10 mA. */
const saturated: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 10),
    resistor('RB', 'vcc', 'b', 10000),
    resistor('RC', 'vcc', 'c', 1000),
    npn('Q1', 'b', 'c', 'gnd'),
    ground('G', 'gnd'),
  ],
};

/** The base pulled to −2 V: the transistor is cut off and VC sits at 10 V. */
const cutOff: Circuit = {
  elements: [
    voltageSource('VCC', 'vcc', 'gnd', 10),
    voltageSource('VBB', 'bb', 'gnd', -2),
    resistor('RB', 'bb', 'b', 10000),
    resistor('RC', 'vcc', 'c', 1000),
    npn('Q1', 'b', 'c', 'gnd'),
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

/** Two direct-coupled stages: Q2's base is Q1's collector. Both active. */
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

const ALL = [fixedBias, emitterResistor, divider, pnpCircuit, saturated, cutOff, regulator, twoStages];

describe('the element', () => {
  it('is an NPN or a PNP with β = 100 and VBE = 0,7 V unless told otherwise', () => {
    const q = npn('Q1', 'b', 'c', 'e');
    expect(q).toMatchObject({ kind: 'bjt', id: 'Q1', polarity: 'npn', base: 'b', collector: 'c', emitter: 'e' });
    expect(text(q.beta)).toBe('100');
    expect(text(q.vbe)).toBe('7/10');
    expect(text(npn('Q1', 'b', 'c', 'e', 50).beta)).toBe('50');
    expect(pnp('Q2', 'b', 'c', 'e')).toMatchObject({ kind: 'bjt', polarity: 'pnp' });
  });
});

describe('solving in the active region', () => {
  it('fixed bias: IB = (VCC − 0,7)/RB, IC = β·IB, IE = (β + 1)·IB', () => {
    const q = transistor(fixedBias);
    expect(text(q.ib)).toBe('93/2000000');
    expect(text(q.ic)).toBe('93/20000');
    expect(text(q.ie)).toBe('9393/2000000');
    expect(text(q.vc)).toBe('107/20');
    expect(text(q.vb)).toBe('7/10');
    expect(text(q.ve)).toBe('0');
  });

  it('emitter resistor: the (β + 1)·RE of the input loop', () => {
    const q = transistor(emitterResistor);
    expect(text(q.ib)).toBe('143/4010000');
    expect(text(q.ic)).toBe('143/40100');
    expect(text(q.vc)).toBe('3155/401');
    expect(text(q.ve)).toBe('14443/4010');
    expect(text(q.vb)).toBe('1725/401');
  });

  it('voltage divider: the same answer as ETH and RTH on paper', () => {
    const q = transistor(divider);
    // (2,4 − 0,7)/(8 kΩ + 101·1 kΩ)
    expect(text(q.ib)).toBe('17/1090000');
    expect(text(q.ic)).toBe('17/10900');
    expect(text(q.vc)).toBe('628/109');
    expect(text(q.ve)).toBe('1717/1090');
  });

  it('PNP: currents leave the base and the collector, VEB = 0,7 V', () => {
    const q = transistor(pnpCircuit);
    // (10 − 0,7)/(100 kΩ + 101·2 kΩ)
    expect(text(q.ib)).toBe('93/3020000');
    expect(text(q.ic)).toBe('93/30200');
    expect(text(q.ve)).toBe('5707/1510');
    expect(text(q.vb)).toBe('465/151');
    expect(text(q.vc)).toBe('-115/151');
  });

  it('keeps IE = IB + IC and reports the transistor on the drawing by its collector', () => {
    for (const circuit of ALL) {
      const result = solvedResult(circuit);
      for (const [id, q] of result.transistors ?? []) {
        expect(text(q.ie)).toBe(text(q.ib.add(q.ic)));
        expect(text(result.elements.get(id)!.voltage)).toBe(text(q.vc.sub(q.ve)));
      }
    }
  });

  it('solves the Zener regulator: Vo = Vz − 0,7 V', () => {
    const result = solvedResult(regulator);
    expect(text(voltageAt(result, 'out')!)).toBe('113/10');
    const q = transistor(regulator);
    expect(text(q.ie)).toBe('113/10000');
    expect(text(q.ib)).toBe('113/510000');
    // IZ = IR1 − IB = 8 mA − 0,2216 mA
    expect(text(result.elements.get('Z1')!.current!.neg())).toBe('3967/510000');
  });

  it('solves two direct-coupled stages', () => {
    const result = solvedResult(twoStages);
    expect(text(voltageAt(result, 'c1')!)).toBe('6513211/689215');
    expect(text(voltageAt(result, 'c2')!)).toBe('1669575/137843');
    expect(text(transistor(twoStages, 'Q1').ib)).toBe('61/4490000');
  });
});

describe('the other regions', () => {
  it('saturates when active would push VC below VE: VCE = 0 V, IC < β·IB', () => {
    const q = transistor(saturated);
    expect(text(q.vc)).toBe('0');
    expect(text(q.ic)).toBe('1/100');
    expect(text(q.ib)).toBe('93/100000');
  });

  it('is cut off when the base is pulled below 0,7 V: no current anywhere', () => {
    const q = transistor(cutOff);
    expect(text(q.ib)).toBe('0');
    expect(text(q.ic)).toBe('0');
    expect(text(q.vc)).toBe('10');
  });

  it('counts transistors with diodes towards the limit of ten', () => {
    const elements: Circuit['elements'] = [voltageSource('E', 'p0', 'gnd', 100), ground('G', 'gnd')];
    const diodes = Array.from({ length: 8 }, (_, index) => diode(`D${index + 1}`, `p${index}`, `p${index + 1}`));
    const transistors = [npn('Q1', 'p8', 'p0', 'x1'), npn('Q2', 'p8', 'p0', 'x2'), npn('Q3', 'p8', 'p0', 'x3')];
    const loads = ['x1', 'x2', 'x3'].map((point, index) => resistor(`RL${index}`, point, 'gnd', 1000));
    const solution = solveWithSteps({ elements: [...elements, ...diodes, ...transistors, ...loads, resistor('R', 'p8', 'gnd', 1000)] });
    expect(solution.status).toBe('invalid');
    expect(solution.issues.map((issue) => issue.code)).toContain('too-many-diodes');
  });

  it('gives no warnings the drawing does not have', () => {
    for (const circuit of ALL) expect(solvedResult(circuit).issues).toEqual([]);
  });
});

describe('the paper solution', () => {
  it('assumes the region first, then sets up the equations, then checks', () => {
    // Circuits outside the textbook patterns; the patterns themselves are in bjt-loops.test.ts.
    expect(solved(twoStages).steps.map(({ type }) => type)).toEqual([
      'transistor-states',
      'nodes',
      'reference',
      'transistor-equations',
      'node-voltages',
      'element-results',
      'transistor-currents',
      'transistor-check',
      'verification',
    ]);
  });

  it('decides the Zener before the transistor and checks it before the transistor too', () => {
    const loaded: Circuit = { elements: [...regulator.elements, resistor('RL', 'out', 'gnd', 2000)] };
    expect(solved(loaded).steps.map(({ type }) => type)).toEqual([
      'diode-states',
      'transistor-states',
      'nodes',
      'reference',
      'transistor-equations',
      'node-voltages',
      'element-results',
      'transistor-currents',
      'diode-check',
      'transistor-check',
      'verification',
    ]);
  });

  it('always guesses active, as the exams do, and says when that was wrong', () => {
    const states = (circuit: Circuit) =>
      stepOf(solved(circuit), 'transistor-states').transistors.map(({ transistorId, guess, state }) => [transistorId, guess, state]);
    expect(states(fixedBias)).toEqual([['Q1', 'active', 'active']]);
    expect(states(saturated)).toEqual([['Q1', 'active', 'saturation']]);
    expect(states(cutOff)).toEqual([['Q1', 'active', 'cutoff']]);
    expect(states(twoStages)).toEqual([['Q1', 'active', 'active'], ['Q2', 'active', 'active']]);
    expect(stepOf(solved(fixedBias), 'transistor-states').elementIds).toEqual(['Q1']);
  });

  it('sets up the equations with the base current as an unknown', () => {
    const step = stepOf(solved(twoStages), 'transistor-equations');
    expect(step.mna.unknowns).toContainEqual({ kind: 'base-current', elementId: 'Q1' });
    expect(step.mna.unknowns.some((unknown) => unknown.kind === 'source-current' && unknown.elementId.startsWith('Q1'))).toBe(false);
    expect(step.mna.matrix).toHaveLength(step.mna.unknowns.length);
    for (const row of step.mna.matrix) expect(row).toHaveLength(step.mna.unknowns.length);
  });

  it('lists the transistor currents', () => {
    const [q1] = stepOf(solved(fixedBias), 'transistor-currents').transistors;
    expect(q1).toMatchObject({ transistorId: 'Q1', polarity: 'npn', state: 'active' });
    expect(text(q1!.ib)).toBe('93/2000000');
    expect(text(q1!.ic)).toBe('93/20000');
    expect(text(q1!.ie)).toBe('9393/2000000');
    expect(text(q1!.vce)).toBe('107/20');
  });

  it('checks every transistor against its region', () => {
    const check = (circuit: Circuit) =>
      stepOf(solved(circuit), 'transistor-check').checks.map(({ transistorId, state, holds }) => [transistorId, state, holds]);
    expect(check(fixedBias)).toEqual([['Q1', 'active', true]]);
    expect(check(saturated)).toEqual([['Q1', 'saturation', true]]);
    expect(check(cutOff)).toEqual([['Q1', 'cutoff', true]]);
    expect(check(pnpCircuit)).toEqual([['Q1', 'active', true]]);
  });

  it('lists the transistor with the other elements', () => {
    const results = stepOf(solved(fixedBias), 'element-results').results;
    expect(results.find(({ elementId }) => elementId === 'Q1')).toMatchObject({ kind: 'bjt' });
  });

  it('balances in the final check: every node and the power', () => {
    for (const circuit of ALL) {
      const verification = stepOf(solved(circuit), 'verification');
      expect(verification.nodeCurrents.every(({ sum }) => sum.isZero())).toBe(true);
      expect(verification.powerAbsorbed).not.toBeNull();
      expect(text(verification.powerAbsorbed!)).toBe(text(verification.powerDelivered!));
    }
  });

  it('leaves circuits without transistors exactly as they were', () => {
    const plain: Circuit = {
      elements: [voltageSource('E', 'a', 'gnd', 10), resistor('R1', 'a', 'b', 1000), resistor('R2', 'b', 'gnd', 1000), ground('G', 'gnd')],
    };
    expect(solved(plain).steps.map(({ type }) => type)).toEqual(['nodes', 'reference', 'known-voltages', 'kcl', 'node-voltages', 'element-results', 'verification']);
  });
});

describe('what the student reads', () => {
  const views = (circuit: Circuit) =>
    solved(circuit).steps.map((step) => stepView(step, 'entering-equals-leaving', (id) => id));
  const viewOf = (circuit: Circuit, type: string) => views(circuit).find((view) => view.type === type)!;
  const fill = (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template);

  it('states the assumption', () => {
    const view = viewOf(fixedBias, 'transistor-states');
    expect(view.title).toBe(tr.learn.transistor.title);
    expect(view.why).toBe(tr.learn.transistor.why);
    expect(view.facts).toEqual([fill(tr.learn.transistor.activeNpn, { name: 'Q1', i: '1', vbe: '0,7 V' })]);
    expect(view.notes).toEqual([]);
    expect(viewOf(pnpCircuit, 'transistor-states').facts).toEqual([fill(tr.learn.transistor.activePnp, { name: 'Q1', i: '1', vbe: '0,7 V' })]);
  });

  it('says when the active assumption failed', () => {
    const sat = viewOf(saturated, 'transistor-states');
    expect(sat.facts).toEqual([fill(tr.learn.transistor.saturationNpn, { name: 'Q1', i: '1', vbe: '0,7 V' })]);
    expect(sat.notes).toEqual([fill(tr.learn.transistor.revisedSaturation, { name: 'Q1' })]);
    const cut = viewOf(cutOff, 'transistor-states');
    expect(cut.facts).toEqual([fill(tr.learn.transistor.cutoff, { name: 'Q1' })]);
    expect(cut.notes).toEqual([fill(tr.learn.transistor.revisedCutoff, { name: 'Q1' })]);
  });

  it('shows the equations as a system with IB1 among the unknowns', () => {
    const view = viewOf(twoStages, 'transistor-equations');
    expect(view.title).toBe(tr.learn.transistorEquations.title);
    expect(view.why).toBe(tr.learn.transistorEquations.why);
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]!.tex).toContain('I_{B1}');
    const step = stepOf(solved(twoStages), 'transistor-equations');
    expect(mnaTex(step.mna, (id) => id)).toContain('I_{B1}');
  });

  it('writes the currents in words, the way the exams list them', () => {
    const q = transistor(fixedBias);
    expect(viewOf(fixedBias, 'transistor-currents').facts).toEqual([
      fill(tr.learn.transistorCurrents.active, {
        name: 'Q1',
        i: '1',
        ib: formatQuantity(q.ib, 'A'),
        ic: formatQuantity(q.ic, 'A'),
        ie: formatQuantity(q.ie, 'A'),
        vce: formatQuantity(q.vc.sub(q.ve), 'V'),
      }),
    ]);
  });

  it('checks the region the way the exams do: VC > VB', () => {
    const q = transistor(fixedBias);
    expect(viewOf(fixedBias, 'transistor-check').facts).toEqual([
      fill(tr.learn.transistorCheck.activeNpn, { name: 'Q1', i: '1', vc: formatQuantity(q.vc, 'V'), vb: formatQuantity(q.vb, 'V') }),
    ]);
    const p = transistor(pnpCircuit);
    expect(viewOf(pnpCircuit, 'transistor-check').facts).toEqual([
      fill(tr.learn.transistorCheck.activePnp, { name: 'Q1', i: '1', vc: formatQuantity(p.vc, 'V'), vb: formatQuantity(p.vb, 'V') }),
    ]);
    const s = transistor(saturated);
    expect(viewOf(saturated, 'transistor-check').facts).toEqual([
      fill(tr.learn.transistorCheck.saturation, { name: 'Q1', i: '1', ic: formatQuantity(s.ic, 'A'), betaIb: formatQuantity(s.ib.mul(f('100')), 'A') }),
    ]);
    expect(viewOf(cutOff, 'transistor-check').facts).toEqual([
      fill(tr.learn.transistorCheck.cutoffNpn, { name: 'Q1', i: '1', vbe: formatQuantity(f('-2'), 'V'), threshold: '0,7 V' }),
    ]);
  });

  it('uses the words of the exam solutions', () => {
    expect(tr.learn.transistor.title).toBe('Transistörlerin çalışma bölgesini varsay');
    expect(tr.learn.transistor.activeNpn).toBe('{name}: aktif bölgede varsayılır: VBE{i} = {vbe} ve IC{i} = β·IB{i}.');
    expect(tr.learn.transistor.activePnp).toBe('{name}: aktif bölgede varsayılır: VEB{i} = {vbe} ve IC{i} = β·IB{i}.');
    expect(tr.learn.transistorCurrents.active).toBe('{name}: IB{i} = {ib}, IC{i} = β·IB{i} = {ic}, IE{i} = (β + 1)·IB{i} = {ie}, VCE{i} = {vce}.');
    expect(tr.learn.transistorCheck.activeNpn).toBe('{name}: VC{i} = {vc} > VB{i} = {vb} olduğu için aktif bölgededir. Varsayım doğru.');
    expect(tr.learn.transistorCheck.activePnp).toBe('{name}: VC{i} = {vc} < VB{i} = {vb} olduğu için aktif bölgededir. Varsayım doğru.');
  });

  it('renders as valid LaTeX', () => {
    for (const circuit of ALL) {
      for (const view of views(circuit)) {
        for (const { tex } of view.lines) {
          expect(() => katex.renderToString(tex, { throwOnError: true, strict: false })).not.toThrow();
        }
      }
    }
  });
});
