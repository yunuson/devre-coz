import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  analyze,
  diode,
  Fraction,
  ground,
  resistor,
  solveWithSteps,
  voltageAt,
  voltageSource,
  zener,
  type Circuit,
  type SolutionStep,
} from '../../src/core';
import { tr } from '../../src/i18n/tr';
import { stepView } from '../../src/ui/steps-panel/step-views';

/**
 * Task 14: the Zener diode, as the Elektronik 1 notes teach it. Take it out and find the voltage
 * across it, cathode positive. If that reaches Vz the Zener is "açık" (in the Zener region) and
 * becomes a source of Vz; otherwise it is "kapalı", an open circuit. Forward biased it behaves
 * like a silicon diode (0,7 V). Values below are ours, not the notes' questions.
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

/** Size of a current, whichever way the element's terminals were drawn. */
const size = (value: Fraction | null | undefined) => (value && value.num < 0n ? value.neg() : value)?.toString();

/**
 * The regulator: Vi = 15 V, RS = 1 kΩ, a 10 V Zener and the load RL across it.
 * RL = 3 kΩ: with the Zener out VL = 11,25 V ≥ 10 V, so it is on; IR = 5 mA, IL = 3,333 mA, IZ = 1,667 mA.
 * RL = 1 kΩ: VL = 7,5 V < 10 V, so it is off and VL stays 7,5 V.
 */
const regulator = (load: number): Circuit => ({
  elements: [
    voltageSource('Vi', 'a', 'gnd', 15),
    resistor('RS', 'a', 'b', 1000),
    zener('Z1', 'gnd', 'b', 10),
    resistor('RL', 'b', 'gnd', load),
    ground('G', 'gnd'),
  ],
});

/** The same regulator with the Zener turned round: it conducts forward, like a silicon diode. */
const forward: Circuit = {
  elements: [
    voltageSource('Vi', 'a', 'gnd', 15),
    resistor('RS', 'a', 'b', 1000),
    zener('Z1', 'b', 'gnd', 10),
    resistor('RL', 'b', 'gnd', 3000),
    ground('G', 'gnd'),
  ],
};

/** Two Zeners in series for a 6 + 4 = 10 V reference. The point between them touches only Zeners. */
const twoInSeries: Circuit = {
  elements: [
    voltageSource('Vi', 'a', 'gnd', 20),
    resistor('R', 'a', 'b', 1000),
    zener('Z1', 'm', 'b', 6),
    zener('Z2', 'gnd', 'm', 4),
    ground('G', 'gnd'),
  ],
};

/** A Zener and a silicon diode in series: 6 + 0,7 = 6,7 V. */
const withDiode: Circuit = {
  elements: [
    voltageSource('Vi', 'a', 'gnd', 20),
    resistor('R', 'a', 'b', 1000),
    zener('Z1', 'm', 'b', 6),
    diode('D1', 'm', 'gnd'),
    ground('G', 'gnd'),
  ],
};

/**
 * Back to back: one Zener in its Zener region, the other forward biased. Vo = 6 + 0,7 V, and with
 * the source turned round the roles swap: Vo = −(4 + 0,7) V.
 */
const backToBack = (source: number): Circuit => ({
  elements: [
    voltageSource('Vi', 'a', 'gnd', source),
    resistor('R', 'a', 'b', 1000),
    zener('Z1', 'm', 'b', 6),
    zener('Z2', 'm', 'gnd', 4),
    ground('G', 'gnd'),
  ],
});

describe('the element', () => {
  it('is a 10 V Zener with a 0,7 V forward threshold unless told otherwise', () => {
    const z = zener('Z1', 'a', 'b');
    expect(z).toMatchObject({ kind: 'zener', id: 'Z1', anode: 'a', cathode: 'b' });
    expect(z.zenerVoltage.toString()).toBe('10');
    expect(z.threshold.toString()).toBe('7/10');
    expect(zener('Z1', 'a', 'b', '5.1').zenerVoltage.toString()).toBe('51/10');
    expect(zener('Z1', 'a', 'b', 5, '0.3').threshold.toString()).toBe('3/10');
  });
});

describe('solving', () => {
  it('holds the load at Vz when the Zener is on, and the rest of the current goes through it', () => {
    const result = solvedResult(regulator(3000));
    expect(voltageAt(result, 'b')?.toString()).toBe('10');
    expect(size(result.elements.get('RS')!.current)).toBe('1/200');
    expect(size(result.elements.get('RL')!.current)).toBe('1/300');
    // Anode to cathode, as for any diode: −10 V across it and IZ = 1,667 mA flowing cathode to anode.
    const z1 = result.elements.get('Z1')!;
    expect(z1.voltage.toString()).toBe('-10');
    expect(z1.current?.toString()).toBe('-1/600');
    expect(z1.power?.toString()).toBe('1/60');
  });

  it('is off when the load pulls the voltage below Vz: an open circuit', () => {
    const result = solvedResult(regulator(1000));
    expect(voltageAt(result, 'b')?.toString()).toBe('15/2');
    expect(result.elements.get('Z1')!.current?.toString()).toBe('0');
    expect(result.elements.get('Z1')!.voltage.toString()).toBe('-15/2');
  });

  it('conducts forward like a silicon diode when turned round', () => {
    const result = solvedResult(forward);
    expect(voltageAt(result, 'b')?.toString()).toBe('7/10');
    expect(result.elements.get('Z1')!.voltage.toString()).toBe('7/10');
  });

  it('adds up two Zeners in series', () => {
    const result = solvedResult(twoInSeries);
    expect(voltageAt(result, 'b')?.toString()).toBe('10');
    expect(voltageAt(result, 'm')?.toString()).toBe('4');
    expect(result.elements.get('Z1')!.current?.toString()).toBe('-1/100');
    expect(result.elements.get('Z2')!.current?.toString()).toBe('-1/100');
  });

  it('adds a Zener and a diode in series', () => {
    const result = solvedResult(withDiode);
    expect(voltageAt(result, 'b')?.toString()).toBe('67/10');
    expect(result.elements.get('D1')!.current?.toString()).toBe('133/10000');
  });

  it('finds which of two back-to-back Zeners is in its Zener region', () => {
    expect(voltageAt(solvedResult(backToBack(20)), 'b')?.toString()).toBe('67/10');
    expect(voltageAt(solvedResult(backToBack(-20)), 'b')?.toString()).toBe('-47/10');
  });

  it('counts Zeners with diodes towards the limit of ten', () => {
    const elements: Circuit['elements'] = [voltageSource('E', 'p0', 'gnd', 100), ground('G', 'gnd')];
    const many = Array.from({ length: 11 }, (_, index) =>
      index % 2 === 0 ? diode(`D${index + 1}`, `p${index}`, `p${index + 1}`) : zener(`Z${index + 1}`, `p${index + 1}`, `p${index}`),
    );
    const solution = solveWithSteps({ elements: [...elements, ...many, resistor('R', 'p11', 'gnd', 1000)] });
    expect(solution.status).toBe('invalid');
    expect(solution.issues.map((issue) => issue.code)).toContain('too-many-diodes');
  });

  it('gives no warnings the drawing does not have', () => {
    for (const circuit of [regulator(3000), regulator(1000), forward, twoInSeries, withDiode, backToBack(20)]) {
      expect(solvedResult(circuit).issues).toEqual([]);
    }
  });
});

describe('the paper solution', () => {
  it('decides the Zener first and checks it at the end, like a diode', () => {
    const types = solved(regulator(3000)).steps.map(({ type }) => type);
    expect(types[0]).toBe('diode-states');
    expect(types.at(-2)).toBe('diode-check');
    expect(types.at(-1)).toBe('verification');
  });

  it('takes the Zener out and looks at the voltage across it', () => {
    const on = stepOf(solved(regulator(3000)), 'diode-states');
    expect(on.elementIds).toEqual(['Z1']);
    const [z1] = on.diodes;
    expect(z1).toMatchObject({ diodeId: 'Z1', guess: 'zener', state: 'zener' });
    expect(z1!.openVoltage?.toString()).toBe('-45/4');
    expect(z1!.zenerVoltage?.toString()).toBe('10');

    expect(stepOf(solved(regulator(1000)), 'diode-states').diodes[0]).toMatchObject({ guess: 'off', state: 'off' });
    expect(stepOf(solved(forward), 'diode-states').diodes[0]).toMatchObject({ guess: 'on', state: 'on' });
  });

  it('gives a plain diode no Zener voltage', () => {
    const states = stepOf(solved(withDiode), 'diode-states').diodes;
    expect(states.map(({ diodeId, zenerVoltage }) => [diodeId, zenerVoltage?.toString() ?? null])).toEqual([
      ['Z1', '6'],
      ['D1', null],
    ]);
  });

  it('then treats a Zener that is on as a source of Vz', () => {
    const known = stepOf(solved(regulator(3000)), 'known-voltages');
    expect(known.relations.map(({ sourceId }) => sourceId)).toContain('Z1');
    expect(known.values.map(({ voltage }) => voltage.toString())).toContain('10');
  });

  it('assumes a Zener whose end floats is on: series Zeners need no correction', () => {
    const states = stepOf(solved(twoInSeries), 'diode-states').diodes;
    expect(states.map(({ diodeId, openVoltage, guess, state }) => [diodeId, openVoltage, guess, state])).toEqual([
      ['Z1', null, 'zener', 'zener'],
      ['Z2', null, 'zener', 'zener'],
    ]);
  });

  it('corrects the Zener that has to conduct forward', () => {
    const states = stepOf(solved(backToBack(20)), 'diode-states').diodes;
    expect(states.map(({ diodeId, guess, state }) => [diodeId, guess, state])).toEqual([
      ['Z1', 'zener', 'zener'],
      ['Z2', 'zener', 'on'],
    ]);
  });

  it('checks every Zener against its state', () => {
    const check = stepOf(solved(backToBack(20)), 'diode-check');
    expect(check.elementIds).toEqual(['Z1', 'Z2']);
    expect(check.checks.map(({ diodeId, state, holds }) => [diodeId, state, holds])).toEqual([
      ['Z1', 'zener', true],
      ['Z2', 'on', true],
    ]);
    expect(check.checks[0]!.zenerVoltage?.toString()).toBe('6');
  });

  it('lists the Zener with the other elements', () => {
    const results = stepOf(solved(regulator(3000)), 'element-results').results;
    expect(results.find(({ elementId }) => elementId === 'Z1')).toMatchObject({ kind: 'zener' });
  });

  it('balances in the final check', () => {
    for (const circuit of [regulator(3000), regulator(1000), forward, twoInSeries, withDiode, backToBack(20), backToBack(-20)]) {
      const verification = stepOf(solved(circuit), 'verification');
      expect(verification.nodeCurrents.every(({ sum }) => sum.isZero())).toBe(true);
    }
  });
});

describe('what the student reads', () => {
  const views = (circuit: Circuit) =>
    solved(circuit).steps.map((step) => stepView(step, 'entering-equals-leaving', (id) => id));
  const viewOf = (circuit: Circuit, type: string) => views(circuit).find((view) => view.type === type)!;

  it('compares the voltage across the Zener, cathode positive, with Vz', () => {
    const on = viewOf(regulator(3000), 'diode-states');
    expect(on.title).toBe(tr.learn.diode.title);
    // Task 23 put the divider that gives this voltage on a line of its own, above the comparison.
    expect(on.lines.map(({ tex }) => tex)).toEqual([
      'V_{Z_{\\mathrm{1}}} = \\frac{R_{\\mathrm{L}}}{R_{\\mathrm{S}} + R_{\\mathrm{L}}} \\cdot V_{\\mathrm{i}} = \\frac{3\\,\\text{k}}{1\\,\\text{k} + 3\\,\\text{k}} \\cdot 15',
      'V_{Z_{\\mathrm{1}}} = 11{,}25\\,\\text{V} \\geq 10\\,\\text{V}',
    ]);
    expect(on.facts).toEqual([tr.learn.zener.on.replace('{name}', 'Z1').replace('{voltage}', '10 V')]);

    const off = viewOf(regulator(1000), 'diode-states');
    expect(off.lines.map(({ tex }) => tex)).toEqual([
      'V_{Z_{\\mathrm{1}}} = \\frac{R_{\\mathrm{L}}}{R_{\\mathrm{S}} + R_{\\mathrm{L}}} \\cdot V_{\\mathrm{i}} = \\frac{1\\,\\text{k}}{1\\,\\text{k} + 1\\,\\text{k}} \\cdot 15',
      'V_{Z_{\\mathrm{1}}} = 7{,}5\\,\\text{V} < 10\\,\\text{V}',
    ]);
    expect(off.facts).toEqual([tr.learn.zener.off.replace('{name}', 'Z1')]);
  });

  it('writes a forward-biased Zener the same way round', () => {
    const view = viewOf(forward, 'diode-states');
    expect(view.lines.map(({ tex }) => tex)).toEqual([
      'V_{Z_{\\mathrm{1}}} = -\\frac{R_{\\mathrm{L}}}{R_{\\mathrm{S}} + R_{\\mathrm{L}}} \\cdot V_{\\mathrm{i}} = -\\frac{3\\,\\text{k}}{1\\,\\text{k} + 3\\,\\text{k}} \\cdot 15',
      'V_{Z_{\\mathrm{1}}} = -11{,}25\\,\\text{V} \\leq -0{,}7\\,\\text{V}',
    ]);
    expect(view.facts).toEqual([tr.learn.zener.forward.replace('{name}', 'Z1').replace('{threshold}', '0,7 V')]);
  });

  it('explains how a Zener is read only when there is one', () => {
    expect(viewOf(regulator(3000), 'diode-states').why).toBe(`${tr.learn.diode.why} ${tr.learn.diode.zenerWhy}`);
    const onlyDiodes: Circuit = {
      elements: [voltageSource('E', 'a', 'gnd', 10), diode('D1', 'a', 'b'), resistor('R', 'b', 'gnd', 1000), ground('G', 'gnd')],
    };
    expect(viewOf(onlyDiodes, 'diode-states').why).toBe(tr.learn.diode.why);
  });

  it('says why a floating Zener is assumed on', () => {
    const view = viewOf(twoInSeries, 'diode-states');
    expect(view.lines).toEqual([]);
    expect(view.facts).toEqual([
      tr.learn.zener.floating.replace('{name}', 'Z1'),
      tr.learn.zener.on.replace('{name}', 'Z1').replace('{voltage}', '6 V'),
      tr.learn.zener.floating.replace('{name}', 'Z2'),
      tr.learn.zener.on.replace('{name}', 'Z2').replace('{voltage}', '4 V'),
    ]);
    expect(view.notes).toEqual([]);
  });

  it('notes a corrected guess', () => {
    expect(viewOf(backToBack(20), 'diode-states').notes).toEqual([tr.learn.diode.revised.replace('{name}', 'Z2')]);
  });

  it('states each check in words, with IZ flowing cathode to anode', () => {
    expect(viewOf(regulator(3000), 'diode-check').facts).toEqual([
      tr.learn.diodeCheck.zener.replace('{name}', 'Z1').replace('{current}', '1,667 mA'),
    ]);
    expect(viewOf(regulator(1000), 'diode-check').facts).toEqual([
      tr.learn.diodeCheck.zenerOff.replace('{name}', 'Z1').replace('{voltage}', '7,5 V').replace('{zenerVoltage}', '10 V'),
    ]);
    expect(viewOf(forward, 'diode-check').facts).toEqual([
      // (15 − 0,7)/1 kΩ less the 0,7 V/3 kΩ the load takes.
      tr.learn.diodeCheck.on.replace('{name}', 'Z1').replace('{current}', '14,07 mA'),
    ]);
  });

  it('uses the words of the notes', () => {
    expect(tr.learn.zener.on).toBe('{name}: açık (Zener bölgesinde), yerine {voltage}’luk bir kaynak konur.');
    expect(tr.learn.zener.off).toBe('{name}: kapalı, açık devre olur.');
    expect(tr.learn.zener.forward).toBe('{name}: ileri yönde iletimde, yerine {threshold}’luk bir kaynak konur.');
    expect(tr.learn.zener.floating).toBe('{name}: çıkarılınca bir ucu boşta kalıyor, bu yüzden açık (Zener bölgesinde) varsayılır.');
    expect(tr.learn.diodeCheck.zener).toBe('{name}: akımı {current}, katottan anoda. Varsayım doğru.');
    expect(tr.learn.diodeCheck.zenerOff).toBe('{name}: gerilimi {voltage}, {zenerVoltage} değerine ulaşmıyor. Varsayım doğru.');
  });

  it('renders as valid LaTeX', () => {
    for (const circuit of [regulator(3000), regulator(1000), forward, twoInSeries, withDiode, backToBack(20), backToBack(-20)]) {
      for (const view of views(circuit)) {
        for (const { tex } of view.lines) {
          expect(() => katex.renderToString(tex, { throwOnError: true, strict: false })).not.toThrow();
        }
      }
    }
  });
});
