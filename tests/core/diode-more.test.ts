import { describe, expect, it } from 'vitest';
import {
  analyze,
  diode,
  ground,
  resistor,
  solveWithSteps,
  voltageSource,
  type Circuit,
  type SolutionStep,
} from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { stepView } from '../../src/ui/steps-panel/step-views';

/** Task 12, second round: diodes in series, a blocking diode, identical diodes in parallel. */

type StepOf<T extends SolutionStep['type']> = Extract<SolutionStep, { type: T }>;

function solvedResult(circuit: Circuit) {
  const result = analyze(circuit);
  if (result.status !== 'solved') {
    throw new Error(`Not solved: ${result.issues.map((issue) => issue.code).join(', ')}`);
  }
  return result;
}

function stepOf<T extends SolutionStep['type']>(circuit: Circuit, type: T): StepOf<T> {
  const solution = solveWithSteps(circuit);
  if (solution.status !== 'solved') throw new Error('not solved');
  return solution.steps.find((step): step is StepOf<T> => step.type === type)!;
}

/** Two silicon diodes in series: Vo = 12 − 0,7 − 0,7. The point between them touches only diodes. */
const twoInSeries: Circuit = {
  elements: [
    voltageSource('E', 'a', 'gnd', 12),
    diode('D1', 'a', 'b'),
    diode('D2', 'b', 'c'),
    resistor('R', 'c', 'gnd', 5600),
    ground('G', 'gnd'),
  ],
};

/** The second diode turned round: nothing flows. */
const blockedInSeries: Circuit = {
  elements: [
    voltageSource('E', 'a', 'gnd', 12),
    diode('D1', 'a', 'b'),
    diode('D2', 'c', 'b'),
    resistor('R', 'c', 'gnd', 5600),
    ground('G', 'gnd'),
  ],
};

const reversed: Circuit = {
  elements: [
    voltageSource('E', 'a', 'gnd', 10),
    diode('D1', 'b', 'a'),
    resistor('R', 'b', 'gnd', 2200),
    ground('G', 'gnd'),
  ],
};

/** Two identical diodes side by side share the current, as the book solves it: I_D1 = I_D2 = I_R / 2. */
const parallel: Circuit = {
  elements: [
    voltageSource('E', 'a', 'gnd', 10),
    resistor('R', 'a', 'b', 330),
    diode('D1', 'b', 'gnd'),
    diode('D2', 'b', 'gnd'),
    ground('G', 'gnd'),
  ],
};

describe('a point that touches only diodes', () => {
  it('solves two diodes in series', () => {
    const result = solvedResult(twoInSeries);
    expect(result.elements.get('R')?.current?.toString()).toBe('53/28000');
    expect(result.elements.get('D1')?.voltage.toString()).toBe('7/10');
    expect(result.elements.get('D2')?.voltage.toString()).toBe('7/10');
  });

  it('assumes such a diode conducts, since its voltage cannot be read with the diodes out', () => {
    const step = stepOf(twoInSeries, 'diode-states');
    expect(step.diodes.map(({ diodeId, openVoltage, guess, state }) => [diodeId, openVoltage, guess, state])).toEqual([
      ['D1', null, 'on', 'on'],
      ['D2', null, 'on', 'on'],
    ]);
  });

  it('says so in words and writes no comparison for it', () => {
    const view = stepView(stepOf(twoInSeries, 'diode-states'), 'entering-equals-leaving', (id) => id);
    expect(view.lines).toEqual([]);
    expect(view.facts).toEqual([
      tr.learn.diode.floating.replace('{name}', 'D1'),
      tr.learn.diode.on.replace('{name}', 'D1').replace('{threshold}', '0,7 V'),
      tr.learn.diode.floating.replace('{name}', 'D2'),
      tr.learn.diode.on.replace('{name}', 'D2').replace('{threshold}', '0,7 V'),
    ]);
  });

  it('solves a series pair where one diode blocks: no current flows', () => {
    const result = solvedResult(blockedInSeries);
    expect(result.elements.get('R')?.current?.toString()).toBe('0');
    expect(stepOf(blockedInSeries, 'diode-states').diodes.find(({ diodeId }) => diodeId === 'D2')?.state).toBe('off');
  });
});

describe('warnings', () => {
  it('does not warn about a resistor that only hangs loose because a diode is off', () => {
    expect(solvedResult(reversed).issues.map(({ code }) => code)).not.toContain('dangling-element');
  });
});

describe('identical diodes in parallel', () => {
  it('share the current equally', () => {
    const result = solvedResult(parallel);
    expect(result.elements.get('D1')?.current?.toString()).toBe('31/2200');
    expect(result.elements.get('D2')?.current?.toString()).toBe('31/2200');
  });

  it('still balance in the final check: every node and the power', () => {
    const check = stepOf(parallel, 'verification');
    expect(check.nodeCurrents.every(({ sum }) => sum.isZero())).toBe(true);
    expect(check.powerAbsorbed?.equals(check.powerDelivered!)).toBe(true);
  });
});
