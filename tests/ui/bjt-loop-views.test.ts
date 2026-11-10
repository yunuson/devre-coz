import { describe, expect, it } from 'vitest';
import { ground, npn, pnp, resistor, solveWithSteps, voltageSource, type Circuit, type SolutionStep } from '../../src/core';
import { stepView } from '../../src/ui/steps-panel/step-views';

const fixedBias: Circuit = { elements: [
  voltageSource('VCC', 'vcc', 'gnd', 10), resistor('RB', 'vcc', 'b', 200000),
  resistor('RC', 'vcc', 'c', 1000), npn('Q1', 'b', 'c', 'gnd'), ground('G', 'gnd'),
] };
const emitterResistor: Circuit = { elements: [
  voltageSource('VCC', 'vcc', 'gnd', 15), resistor('RB', 'vcc', 'b', 300000),
  resistor('RC', 'vcc', 'c', 2000), resistor('RE', 'e', 'gnd', 1000),
  npn('Q1', 'b', 'c', 'e'), ground('G', 'gnd'),
] };
const divider: Circuit = { elements: [
  voltageSource('VCC', 'vcc', 'gnd', 12), resistor('R1', 'vcc', 'b', 40000),
  resistor('R2', 'b', 'gnd', 10000), resistor('RC', 'vcc', 'c', 4000),
  resistor('RE', 'e', 'gnd', 1000), npn('Q1', 'b', 'c', 'e'), ground('G', 'gnd'),
] };
const pnpCircuit: Circuit = { elements: [
  voltageSource('VEE', 'vee', 'gnd', 10), voltageSource('VCC', 'vcc', 'gnd', -10),
  resistor('RE', 'vee', 'e', 2000), resistor('RB', 'b', 'gnd', 100000),
  resistor('RC', 'c', 'vcc', 3000), pnp('Q1', 'b', 'c', 'e'), ground('G', 'gnd'),
] };
const pnpGroundCollector: Circuit = { elements: [
  voltageSource('VEE', 'vee', 'gnd', 10), resistor('RE', 'vee', 'e', 1000),
  resistor('RB', 'b', 'gnd', 100000), resistor('RC', 'c', 'gnd', 500),
  pnp('Q1', 'b', 'c', 'e'), ground('G', 'gnd'),
] };
const negativeEmitterSupply: Circuit = { elements: [
  voltageSource('VCC', 'vcc', 'gnd', 12), voltageSource('VEE', 'gnd', 'vee', 5),
  resistor('RB', 'vcc', 'b', 1000000), resistor('RC', 'vcc', 'c', 1000),
  resistor('RE', 'vee', 'e', 10000), npn('Q1', 'b', 'c', 'e'), ground('G', 'gnd'),
] };

function lines(circuit: Circuit, type: Extract<SolutionStep, { type: 'bjt-input-loop' | 'bjt-output-loop' | 'bjt-thevenin' | 'bjt-voltages' }>['type']): string[] {
  const solution = solveWithSteps(circuit);
  if (solution.status !== 'solved') throw new Error('Circuit did not solve');
  return solution.steps
    .map((step) => stepView(step, 'entering-equals-leaving', (id) => id))
    .find((view) => view.type === type)!.lines.map(({ tex }) => tex);
}

describe('BJT loop equation views', () => {
  it('writes source labels once in input, output, and Thevenin equations', () => {
    expect(lines(fixedBias, 'bjt-input-loop')[0]).toBe('-V_{\\mathrm{CC}} + I_{B1} R_{\\mathrm{B}} + V_{BE1} = 0');
    expect(lines(fixedBias, 'bjt-output-loop')[0]).toBe('-V_{\\mathrm{CC}} + I_{C1} R_{\\mathrm{C}} + V_{CE1} = 0');
    expect(lines(divider, 'bjt-thevenin')[0]).toBe('E_{TH} = \\frac{R_{\\mathrm{2}}}{R_{\\mathrm{1}} + R_{\\mathrm{2}}} \\cdot V_{\\mathrm{CC}} = \\text{2,4 V}');
  });

  it('substitutes IE in the emitter resistor term for PNP without changing other terms', () => {
    expect(lines(pnpCircuit, 'bjt-input-loop')[1]).toBe('-V_{\\mathrm{EE}} + (\\beta + 1) I_{B1} R_{\\mathrm{E}} + V_{EB1} + I_{B1} R_{\\mathrm{B}} = 0');
  });

  it('shows the multiplication sign in the numeric beta-plus-one denominator', () => {
    expect(lines(emitterResistor, 'bjt-input-loop')[2]).toBe('I_{B1} = \\frac{15 - 0{,}7}{300\\,\\text{k} + 101 \\cdot 1\\,\\text{k}} = \\text{35,66 µA}');
  });

  it('omits zero voltage terms and parenthesizes a negative known emitter voltage', () => {
    expect(lines(fixedBias, 'bjt-input-loop')[1]).toBe('I_{B1} = \\frac{10 - 0{,}7}{200\\,\\text{k}} = \\text{46,5 µA}');
    expect(lines(negativeEmitterSupply, 'bjt-input-loop')[2]).toBe('I_{B1} = \\frac{12 - \\left(-5\\right) - 0{,}7}{1\\,\\text{M} + 101 \\cdot 10\\,\\text{k}} = \\text{8,109 µA}');
  });

  it('derives terminal voltages from their own sides and the junction relation', () => {
    expect(lines(fixedBias, 'bjt-voltages')).toEqual([
      'V_{E1} = 0 = \\text{0 V}',
      'V_{B1} = V_{E1} + V_{BE1} = \\text{0,7 V}',
      'V_{C1} = V_{\\mathrm{CC}} - I_{C1} R_{\\mathrm{C}} = \\text{5,35 V}',
    ]);
    expect(lines(emitterResistor, 'bjt-voltages')[0]).toBe('V_{E1} = I_{E1} R_{\\mathrm{E}} = \\text{3,602 V}');
    expect(lines(pnpCircuit, 'bjt-voltages')[0]).toBe('V_{E1} = V_{\\mathrm{EE}} - I_{E1} R_{\\mathrm{E}} = \\text{3,779 V}');
    expect(lines(pnpGroundCollector, 'bjt-voltages')[2]).toBe('V_{C1} = I_{C1} R_{\\mathrm{C}} = \\text{2,313 V}');
  });

  it('uses the compact divider Thevenin formula when the lower resistor ends at ground', () => {
    expect(lines(divider, 'bjt-thevenin')[0]).toBe('E_{TH} = \\frac{R_{\\mathrm{2}}}{R_{\\mathrm{1}} + R_{\\mathrm{2}}} \\cdot V_{\\mathrm{CC}} = \\text{2,4 V}');
  });
});
