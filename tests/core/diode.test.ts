import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  diode,
  ground,
  resistor,
  solveWithSteps,
  voltageAt,
  voltageSource,
  type Circuit,
  type SolutionStep,
} from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { stepView } from '../../src/ui/steps-panel/step-views';

/**
 * Task 12: the diode, as Elektronik 1 teaches it. On, it is a source of its threshold voltage
 * (0,7 V for silicon); off, it is an open circuit. The state is found as on paper: take the diode
 * out, look at the voltage across it, assume, solve, then check the assumption.
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

const resultOf = (circuit: Circuit, id: string) => {
  const result = analyze(circuit);
  if (result.status !== 'solved') throw new Error('not solved');
  return result.elements.get(id)!;
};

/** Boylestad's first series example: 10 V, a silicon diode and 2,2 kΩ. */
const series = (threshold?: string): Circuit => ({
  elements: [
    voltageSource('E', 'a', 'gnd', 10),
    threshold === undefined ? diode('D1', 'a', 'b') : diode('D1', 'a', 'b', threshold),
    resistor('R', 'b', 'gnd', 2200),
    ground('G', 'gnd'),
  ],
});

/** The same circuit with the diode turned round. */
const reversed: Circuit = {
  elements: [
    voltageSource('E', 'a', 'gnd', 10),
    diode('D1', 'b', 'a'),
    resistor('R', 'b', 'gnd', 2200),
    ground('G', 'gnd'),
  ],
};

/** An OR gate: 10 V on one input, 0 V on the other. Only D1 conducts and Vo = 9,3 V. */
const orGate: Circuit = {
  elements: [
    voltageSource('E', 'in1', 'gnd', 10),
    diode('D1', 'in1', 'out'),
    diode('D2', 'gnd', 'out'),
    resistor('R', 'out', 'gnd', 1000),
    ground('G', 'gnd'),
  ],
};

/**
 * Two sources racing for the same output. With the diodes taken out both look forward biased,
 * but both cannot conduct: the 5 V side has to turn off. Vo = 9,3 V.
 */
const race: Circuit = {
  elements: [
    voltageSource('E1', 'in1', 'gnd', 10),
    voltageSource('E2', 'in2', 'gnd', 5),
    diode('D1', 'in1', 'out'),
    diode('D2', 'in2', 'out'),
    resistor('R', 'out', 'gnd', 1000),
    ground('G', 'gnd'),
  ],
};

describe('the element', () => {
  it('is 0,7 V silicon unless told otherwise', () => {
    expect(diode('D1', 'a', 'b')).toMatchObject({ kind: 'diode', id: 'D1', anode: 'a', cathode: 'b' });
    expect(diode('D1', 'a', 'b').threshold.toString()).toBe('7/10');
    expect(diode('D1', 'a', 'b', '0.3').threshold.toString()).toBe('3/10');
  });
});

describe('solving', () => {
  it('conducts when forward biased: 0,7 V across it and (10 − 0,7)/2,2k through it', () => {
    const circuit = series();
    const d1 = resultOf(circuit, 'D1');
    expect(d1.voltage.toString()).toBe('7/10');
    expect(d1.current?.toString()).toBe('93/22000');
    const result = analyze(circuit);
    if (result.status !== 'solved') throw new Error('not solved');
    expect(voltageAt(result, 'b')?.toString()).toBe('93/10');
  });

  it('blocks when turned round: no current and the whole 10 V across it', () => {
    const d1 = resultOf(reversed, 'D1');
    expect(d1.current?.toString()).toBe('0');
    expect(d1.voltage.toString()).toBe('-10');
    expect(resultOf(reversed, 'R').current?.toString()).toBe('0');
  });

  it('uses the threshold it is given: 0 for an ideal diode, 0,3 V for germanium', () => {
    expect(resultOf(series('0'), 'D1').current?.toString()).toBe('1/220');
    expect(resultOf(series('0.3'), 'D1').current?.toString()).toBe('97/22000');
  });

  it('finds which diode of an OR gate conducts', () => {
    expect(resultOf(orGate, 'D1').current?.toString()).toBe('93/10000');
    expect(resultOf(orGate, 'D2').current?.toString()).toBe('0');
    expect(resultOf(orGate, 'D2').voltage.toString()).toBe('-93/10');
  });

  it('corrects a first guess that cannot hold', () => {
    expect(resultOf(race, 'D1').current?.toString()).toBe('93/10000');
    expect(resultOf(race, 'D2').current?.toString()).toBe('0');
    expect(resultOf(race, 'D2').voltage.toString()).toBe('-43/10');
  });

  it('refuses more than ten diodes rather than trying every combination', () => {
    const elements: Circuit['elements'] = [voltageSource('E', 'p0', 'gnd', 10), ground('G', 'gnd')];
    const many = Array.from({ length: 11 }, (_, index) => diode(`D${index + 1}`, `p${index}`, `p${index + 1}`));
    const solution = solveWithSteps({ elements: [...elements, ...many, resistor('R', 'p11', 'gnd', 1000)] });
    expect(solution.status).toBe('invalid');
    expect(solution.issues.map((issue) => issue.code)).toContain('too-many-diodes');
  });
});

describe('the paper solution', () => {
  it('decides the diodes first and checks them at the end', () => {
    expect(solved(series()).steps.map(({ type }) => type)).toEqual([
      'diode-states',
      'nodes',
      'reference',
      'known-voltages',
      'node-voltages',
      'element-results',
      'diode-check',
      'verification',
    ]);
  });

  it('takes the diode out and looks at the voltage across it', () => {
    const step = stepOf(solved(series()), 'diode-states');
    expect(step.elementIds).toEqual(['D1']);
    expect(step.diodes).toHaveLength(1);
    const [d1] = step.diodes;
    expect(d1).toMatchObject({ diodeId: 'D1', guess: 'on', state: 'on' });
    expect(d1!.openVoltage?.toString()).toBe('10');
    expect(d1!.threshold.toString()).toBe('7/10');
  });

  it('then treats a conducting diode as a source of its threshold voltage', () => {
    const known = stepOf(solved(series()), 'known-voltages');
    expect(known.relations.map((relation) => [relation.sourceId, relation.delta.toString()])).toEqual([
      ['E', '10'],
      ['D1', '-7/10'],
    ]);
  });

  it('says when the first guess was wrong', () => {
    const step = stepOf(solved(race), 'diode-states');
    expect(step.diodes.map(({ diodeId, guess, state }) => [diodeId, guess, state])).toEqual([
      ['D1', 'on', 'on'],
      ['D2', 'on', 'off'],
    ]);
  });

  it('checks every diode against its state', () => {
    const check = stepOf(solved(orGate), 'diode-check');
    expect(check.elementIds).toEqual(['D1', 'D2']);
    expect(check.checks.map(({ diodeId, state, holds }) => [diodeId, state, holds])).toEqual([
      ['D1', 'on', true],
      ['D2', 'off', true],
    ]);
  });

  it('lists the diode with the other elements', () => {
    const results = stepOf(solved(series()), 'element-results').results;
    expect(results.find(({ elementId }) => elementId === 'D1')).toMatchObject({ kind: 'diode' });
  });
});

describe('what the student reads', () => {
  const views = (circuit: Circuit) =>
    solved(circuit).steps.map((step) => stepView(step, 'entering-equals-leaving', (id) => id));
  const viewOf = (circuit: Circuit, type: string) => views(circuit).find((view) => view.type === type)!;

  it('compares the voltage across the diode with its threshold', () => {
    const on = viewOf(series(), 'diode-states');
    expect(on.title).toBe(tr.learn.diode.title);
    expect(on.lines.map(({ tex }) => tex)).toEqual(['V_{D_{\\mathrm{1}}} = 10\\,\\text{V} > 0{,}7\\,\\text{V}']);
    expect(on.facts).toEqual([tr.learn.diode.on.replace('{name}', 'D1').replace('{threshold}', '0,7 V')]);

    const off = viewOf(reversed, 'diode-states');
    expect(off.lines.map(({ tex }) => tex)).toEqual(['V_{D_{\\mathrm{1}}} = -10\\,\\text{V} \\leq 0{,}7\\,\\text{V}']);
    expect(off.facts).toEqual([tr.learn.diode.off.replace('{name}', 'D1')]);
  });

  it('says an ideal diode that conducts is a wire', () => {
    expect(viewOf(series('0'), 'diode-states').facts).toEqual([tr.learn.diode.short.replace('{name}', 'D1')]);
  });

  it('notes a corrected guess', () => {
    expect(viewOf(race, 'diode-states').notes).toEqual([tr.learn.diode.revised.replace('{name}', 'D2')]);
  });

  it('states each check in words', () => {
    const check = viewOf(orGate, 'diode-check');
    expect(check.title).toBe(tr.learn.diodeCheck.title);
    expect(check.facts).toEqual([
      tr.learn.diodeCheck.on.replace('{name}', 'D1').replace('{current}', '9,3 mA'),
      tr.learn.diodeCheck.off.replace('{name}', 'D2').replace('{voltage}', '−9,3 V').replace('{threshold}', '0,7 V'),
    ]);
  });

  it('renders as valid LaTeX', () => {
    for (const circuit of [series(), reversed, orGate, race, series('0')]) {
      for (const view of views(circuit)) {
        for (const { tex } of view.lines) {
          expect(() => katex.renderToString(tex, { throwOnError: true, strict: false })).not.toThrow();
        }
      }
    }
  });
});
