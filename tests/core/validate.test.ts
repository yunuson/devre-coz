import { describe, expect, it } from 'vitest';
import {
  analyze,
  currentSource,
  Fraction,
  ground,
  resistor,
  voltageSource,
  wire,
  type Circuit,
  type Issue,
} from '../../src/core';
import { currentOf, solve, volts } from './fixtures';

const issuesOf = (circuit: Circuit): readonly Issue[] => analyze(circuit).issues;
const codesOf = (circuit: Circuit): string[] => issuesOf(circuit).map((issue) => issue.code);

function expectInvalid(circuit: Circuit, code: string): Issue {
  const result = analyze(circuit);
  expect(result.status).toBe('invalid');
  const found = result.issues.find((issue) => issue.code === code);
  expect(found, `expected ${code}, got ${result.issues.map((i) => i.code).join(', ')}`).toBeDefined();
  expect(found?.severity).toBe('error');
  return found!;
}

describe('errors', () => {
  it('reports an empty circuit', () => {
    expect(codesOf({ elements: [] })).toEqual(['empty-circuit']);
    expect(codesOf({ elements: [ground('G', 'a'), wire('W', 'a', 'b')] })).toEqual(['empty-circuit']);
  });

  it('reports only the root cause when there is no ground', () => {
    const circuit: Circuit = {
      elements: [voltageSource('V1', 'a', 'a', 5), resistor('R1', 'x', 'y', 1)],
    };
    expect(codesOf(circuit)).toEqual(['no-ground']);
  });

  it.each([0, -5])('rejects a resistance of %d', (value) => {
    const issue = expectInvalid(
      { elements: [resistor('R1', 'a', 'gnd', value), voltageSource('V1', 'a', 'gnd', 5), ground('G', 'gnd')] },
      'invalid-resistance',
    );
    expect(issue.elementIds).toEqual(['R1']);
  });

  it('finds a voltage source shorted by wires and returns the wire path', () => {
    const issue = expectInvalid(
      {
        elements: [
          voltageSource('V1', 'plus', 'minus', 12),
          wire('W1', 'plus', 'corner'),
          wire('W2', 'corner', 'minus'),
          wire('other', 'minus', 'elsewhere'),
          ground('G', 'minus'),
        ],
      },
      'voltage-source-shorted',
    );
    expect(issue.elementIds).toEqual(['V1']);
    expect(issue.wireIds).toEqual(['W1', 'W2']);
  });

  it('finds a voltage source shorted through two ground symbols', () => {
    expectInvalid(
      {
        elements: [voltageSource('V1', 'a', 'b', 12), ground('G1', 'a'), ground('G2', 'b')],
      },
      'voltage-source-shorted',
    );
  });

  it('finds two parallel voltage sources with different values', () => {
    const issue = expectInvalid(
      {
        elements: [
          voltageSource('V1', 'a', 'gnd', 10),
          voltageSource('V2', 'a', 'gnd', 5),
          resistor('R1', 'a', 'gnd', 1),
          ground('G', 'gnd'),
        ],
      },
      'voltage-source-conflict',
    );
    expect(issue.elementIds).toEqual(['V1', 'V2']);
  });

  it('finds a conflicting loop of three voltage sources', () => {
    const issue = expectInvalid(
      {
        elements: [
          voltageSource('V1', 'a', 'gnd', 2),
          voltageSource('V2', 'b', 'a', 3),
          voltageSource('V3', 'b', 'gnd', 9),
          ground('G', 'gnd'),
        ],
      },
      'voltage-source-conflict',
    );
    expect([...issue.elementIds].sort()).toEqual(['V1', 'V2', 'V3']);
  });

  it('finds a separate circuit part with no ground', () => {
    const issue = expectInvalid(
      {
        elements: [
          voltageSource('V1', 'a', 'gnd', 5),
          resistor('R1', 'a', 'gnd', 1),
          resistor('R2', 'x', 'y', 1),
          resistor('R3', 'y', 'x', 1),
          ground('G', 'gnd'),
        ],
      },
      'floating-subcircuit',
    );
    expect(issue.elementIds).toEqual(['R2', 'R3']);
  });

  it('finds a fully disconnected element and an unconnected ground', () => {
    expectInvalid(
      {
        elements: [resistor('R1', 'a', 'gnd', 1), resistor('lost', 'x', 'y', 1), ground('G', 'gnd')],
      },
      'floating-subcircuit',
    );
    expectInvalid(
      { elements: [voltageSource('V1', 'a', 'b', 5), resistor('R1', 'a', 'b', 1), ground('G', 'gnd')] },
      'floating-subcircuit',
    );
  });

  it('finds a current source whose current has nowhere to go', () => {
    const issue = expectInvalid(
      { elements: [currentSource('I1', 'gnd', 'open', 2), ground('G', 'gnd')] },
      'current-source-no-path',
    );
    expect(issue.elementIds).toEqual(['I1']);
  });

  it('finds two different current sources in series', () => {
    expectInvalid(
      {
        elements: [
          currentSource('I1', 'gnd', 'mid', 2),
          currentSource('I2', 'mid', 'gnd', 1),
          ground('G', 'gnd'),
        ],
      },
      'current-source-no-path',
    );
  });

  it('finds equal current sources in series, which leave the middle voltage open', () => {
    expectInvalid(
      {
        elements: [
          currentSource('I1', 'gnd', 'mid', 2),
          currentSource('I2', 'mid', 'gnd', 2),
          ground('G', 'gnd'),
        ],
      },
      'undetermined-voltage',
    );
  });

  it('finds a resistor group fed only by a current source', () => {
    expectInvalid(
      {
        elements: [
          currentSource('I1', 'gnd', 'a', 1),
          resistor('R1', 'a', 'b', 1),
          ground('G', 'gnd'),
        ],
      },
      'current-source-no-path',
    );
  });

  it('reports no follow-up warnings while there are errors', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('V1', 'a', 'a', 5),
        resistor('short', 'gnd', 'gnd', 1),
        resistor('R1', 'a', 'gnd', 1),
        ground('G', 'gnd'),
      ],
    };
    expect(codesOf(circuit)).toEqual(['voltage-source-shorted']);
  });
});

describe('warnings still give a solution', () => {
  it('shorted resistor carries no current', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('V1', 'a', 'gnd', 12),
        resistor('R1', 'a', 'b', 2),
        resistor('R2', 'b', 'gnd', 4),
        wire('short', 'b', 'gnd'),
        ground('G', 'gnd'),
      ],
    };
    const result = solve(circuit);
    expect(result.issues).toEqual([
      { severity: 'warning', code: 'resistor-shorted', elementIds: ['R2'], wireIds: ['short'] },
    ]);
    expect(volts(result, 'b')).toBe('0');
    expect(currentOf(result, 'R1')).toBe('6');
    expect(result.elements.get('R2')?.current?.isZero()).toBe(true);
  });

  it('marks a whole dangling chain, which carries no current', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('V1', 'a', 'gnd', 12),
        resistor('R1', 'a', 'gnd', 3),
        resistor('tail1', 'a', 'b', 1),
        resistor('tail2', 'b', 'open', 1),
        ground('G', 'gnd'),
      ],
    };
    const result = solve(circuit);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('dangling-element');
    expect([...(result.issues[0]?.elementIds ?? [])].sort()).toEqual(['tail1', 'tail2']);
    expect(volts(result, 'open')).toBe('12');
    expect(result.elements.get('tail2')?.current?.isZero()).toBe(true);
  });

  it('does not call a normal loop dangling', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('V1', 'a', 'gnd', 12),
        resistor('R1', 'a', 'b', 1),
        resistor('R2', 'b', 'gnd', 1),
        ground('G', 'gnd'),
      ],
    };
    expect(codesOf(circuit)).toEqual([]);
  });

  it('solves equal parallel voltage sources but leaves their currents unknown', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('V1', 'a', 'gnd', 5),
        voltageSource('V2', 'a', 'gnd', 5),
        resistor('R1', 'a', 'gnd', 2),
        ground('G', 'gnd'),
      ],
    };
    const result = solve(circuit);
    expect(result.issues.map((issue) => issue.code)).toEqual(['source-current-indeterminate']);
    expect(result.issues[0]?.severity).toBe('warning');
    expect(volts(result, 'a')).toBe('5');
    expect(currentOf(result, 'R1')).toBe('5/2');
    for (const id of ['V1', 'V2']) {
      expect(result.elements.get(id)?.current).toBeNull();
      expect(result.elements.get(id)?.power).toBeNull();
      expect(result.elements.get(id)?.voltage.equals(Fraction.from(5))).toBe(true);
    }
  });

  it('treats a shorted 0 V source as indeterminate rather than a conflict', () => {
    const circuit: Circuit = {
      elements: [
        voltageSource('V0', 'a', 'a', 0),
        voltageSource('V1', 'a', 'gnd', 5),
        resistor('R1', 'a', 'gnd', 5),
        ground('G', 'gnd'),
      ],
    };
    const result = solve(circuit);
    expect(result.issues.map((issue) => issue.code)).toEqual(['source-current-indeterminate']);
    expect(result.elements.get('V0')?.current).toBeNull();
    expect(currentOf(result, 'V1')).toBe('-1');
  });
});
