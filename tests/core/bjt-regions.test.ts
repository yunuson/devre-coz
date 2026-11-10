import { describe, expect, it } from 'vitest';
import { analyze, diode, ground, npn, resistor, voltageSource, type Circuit } from '../../src/core';

/**
 * Circuits where the transistor's active model can't be solved at all: the base-emitter source
 * would sit across another source, or β·IB would have nowhere to go. The other regions still
 * have to be tried instead of giving up on the first guess.
 */

function solvedResult(circuit: Circuit) {
  const result = analyze(circuit);
  if (result.status !== 'solved') {
    throw new Error(`Not solved: ${result.issues.map((issue) => issue.code).join(', ')}`);
  }
  return result;
}

const states = (circuit: Circuit) => solvedResult(circuit).transistorStates?.map(({ state }) => state);

describe('a transistor whose active model has no solution', () => {
  it('is cut off with its base and emitter both on ground', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('VCC', 'vcc', 'gnd', 10),
        resistor('RC', 'vcc', 'c', 1000),
        npn('Q1', 'gnd', 'c', 'gnd'),
        ground('G', 'gnd'),
      ],
    };
    expect(states(circuit)).toEqual(['cutoff']);
    expect(solvedResult(circuit).transistors?.get('Q1')?.vc.toString()).toBe('10');
  });

  it('is cut off with 0,5 V straight on its base', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('VCC', 'vcc', 'gnd', 10),
        voltageSource('VB', 'b', 'gnd', 0.5),
        resistor('RC', 'vcc', 'c', 1000),
        npn('Q1', 'b', 'c', 'gnd'),
        ground('G', 'gnd'),
      ],
    };
    expect(states(circuit)).toEqual(['cutoff']);
  });

  it('carries only its base current with the collector left open, and says the collector is open', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('VCC', 'vcc', 'gnd', 10),
        resistor('RB', 'vcc', 'b', 10000),
        npn('Q1', 'b', 'c', 'gnd'),
        ground('G', 'gnd'),
      ],
    };
    const result = solvedResult(circuit);
    const q = result.transistors?.get('Q1');
    expect(q?.ib.toString()).toBe('93/100000');
    expect(q?.ic.toString()).toBe('0');
    expect(result.issues.map(({ code }) => code)).toContain('dangling-element');
  });

  it('still guesses the diodes, from the circuit with the transistor cut off', () => {
    // Q1's base is on ground; D1 and R2 hang from its collector: (10 − 0,7) V over 2 kΩ.
    const circuit: Circuit = {
      elements: [
        voltageSource('VCC', 'vcc', 'gnd', 10),
        resistor('RC', 'vcc', 'c', 1000),
        npn('Q1', 'gnd', 'c', 'gnd'),
        diode('D1', 'c', 'x'),
        resistor('R2', 'x', 'gnd', 1000),
        ground('G', 'gnd'),
      ],
    };
    const result = solvedResult(circuit);
    expect(result.transistorStates?.map(({ state }) => state)).toEqual(['cutoff']);
    expect(result.diodeStates?.map(({ guess, state }) => [guess, state])).toEqual([['on', 'on']]);
    expect(result.elements.get('D1')?.current?.toString()).toBe('93/20000');
  });
});
