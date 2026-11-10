import {
  analyze,
  currentSource,
  ground,
  resistor,
  voltageSource,
  voltageAt,
  wire,
  type AnalysisResult,
  type Circuit,
} from '../../src/core';

type Solved = Extract<AnalysisResult, { status: 'solved' }>;

export function solve(circuit: Circuit): Solved {
  const result = analyze(circuit);
  if (result.status !== 'solved') {
    throw new Error(`Expected a solved circuit, got: ${result.issues.map((i) => i.code).join(', ')}`);
  }
  return result;
}

/** Voltage at a point as an exact fraction string such as "22/3". */
export function volts(result: Solved, point: string): string {
  const value = voltageAt(result, point);
  if (!value) throw new Error(`No voltage at point ${point}`);
  return value.toString();
}

export function currentOf(result: Solved, id: string): string {
  const value = result.elements.get(id)?.current;
  if (!value) throw new Error(`No current for element ${id}`);
  return value.toString();
}

/** Example 1: voltage divider. */
export const voltageDivider: Circuit = {
  elements: [
    voltageSource('V1', 'top', 'gnd', 10),
    resistor('R1', 'top', 'mid', '2e3'),
    resistor('R2', 'mid', 'gnd', '3e3'),
    ground('G', 'gnd'),
  ],
};

/** Example 2: two nodes, two current sources. */
export const twoCurrentSources: Circuit = {
  elements: [
    currentSource('I1', 'gnd', 'n1', 2),
    currentSource('I2', 'gnd', 'n2', 1),
    resistor('R1', 'n1', 'gnd', 4),
    resistor('R2', 'n1', 'n2', 2),
    resistor('R3', 'n2', 'gnd', 6),
    ground('G', 'gnd'),
  ],
};

/** Example 3: a voltage source and a current source together. */
export const mixedSources: Circuit = {
  elements: [
    voltageSource('V1', 'n1', 'gnd', 10),
    resistor('R1', 'n1', 'n2', 5),
    resistor('R2', 'n2', 'gnd', 10),
    currentSource('I1', 'gnd', 'n2', '0.5'),
    ground('G', 'gnd'),
  ],
};

/** Example 4: a voltage source between two non-reference nodes (supernode). */
export const supernode: Circuit = {
  elements: [
    currentSource('I1', 'gnd', 'n1', 2),
    resistor('R1', 'n1', 'gnd', 4),
    resistor('R2', 'n2', 'gnd', 2),
    voltageSource('V1', 'n2', 'n1', 6),
    ground('G', 'gnd'),
  ],
};

/** Example 1 drawn with wires between the elements, as the editor will produce it. */
export const voltageDividerWithWires: Circuit = {
  elements: [
    voltageSource('V1', 'v+', 'v-', 10),
    wire('W1', 'v+', 'corner'),
    wire('W2', 'corner', 'r1-a'),
    resistor('R1', 'r1-a', 'r1-b', 2000),
    wire('W3', 'r1-b', 'r2-a'),
    resistor('R2', 'r2-a', 'r2-b', 3000),
    wire('W4', 'r2-b', 'v-'),
    ground('G', 'v-'),
  ],
};
