import { describe, expect, it } from 'vitest';
import { buildNetlist, ground, REFERENCE_NODE, resistor, voltageSource, wire } from '../../src/core';
import {
  currentOf,
  mixedSources,
  solve,
  supernode,
  twoCurrentSources,
  voltageDivider,
  voltageDividerWithWires,
  volts,
} from './fixtures';

describe('hand-solved circuits', () => {
  it('example 1: voltage divider', () => {
    const result = solve(voltageDivider);
    expect(volts(result, 'mid')).toBe('6');
    expect(currentOf(result, 'R1')).toBe('1/500');
    expect(currentOf(result, 'R2')).toBe('1/500');
    expect(result.issues).toEqual([]);
  });

  it('example 2: two current sources', () => {
    const result = solve(twoCurrentSources);
    expect(volts(result, 'n1')).toBe('22/3');
    expect(volts(result, 'n2')).toBe('7');
  });

  it('example 3: voltage and current source together', () => {
    const result = solve(mixedSources);
    expect(volts(result, 'n1')).toBe('10');
    expect(volts(result, 'n2')).toBe('25/3');
    expect(currentOf(result, 'R1')).toBe('1/3');
  });

  it('example 4: supernode', () => {
    const result = solve(supernode);
    expect(volts(result, 'n1')).toBe('-4/3');
    expect(volts(result, 'n2')).toBe('14/3');
  });
});

describe('element results', () => {
  it('reports the source current and delivered power with passive signs', () => {
    const v1 = solve(voltageDivider).elements.get('V1');
    expect(v1?.voltage.toString()).toBe('10');
    expect(v1?.current?.toString()).toBe('-1/500');
    expect(v1?.power?.toString()).toBe('-1/50');
  });

  it('balances the power of example 3 at 7.5 W', () => {
    const { elements } = solve(mixedSources);
    const power = (id: string): string | undefined => elements.get(id)?.power?.toString();
    expect(power('V1')).toBe('-10/3');
    expect(power('I1')).toBe('-25/6');
    expect(power('R1')).toBe('5/9');
    expect(power('R2')).toBe('125/18');
  });
});

describe('buildNetlist', () => {
  it('merges points joined by wires into one node', () => {
    const netlist = buildNetlist(voltageDividerWithWires);
    expect(netlist.nodeIds).toEqual([1, 2]);
    expect(netlist.pointToNode.get('v+')).toBe(netlist.pointToNode.get('r1-a'));
    expect(netlist.pointToNode.get('r1-b')).toBe(netlist.pointToNode.get('r2-a'));
    expect(netlist.pointToNode.get('r2-b')).toBe(REFERENCE_NODE);
  });

  it('gives the same answer drawn with or without wires', () => {
    const result = solve(voltageDividerWithWires);
    expect(volts(result, 'r2-a')).toBe('6');
    expect(currentOf(result, 'R1')).toBe('1/500');
  });

  it('treats every ground symbol as the same node', () => {
    const result = solve({
      elements: [
        voltageSource('V1', 'a', 'gnd1', 12),
        resistor('R1', 'a', 'b', 1),
        resistor('R2', 'b', 'gnd2', 1),
        ground('G1', 'gnd1'),
        ground('G2', 'gnd2'),
      ],
    });
    expect(volts(result, 'b')).toBe('6');
    expect(volts(result, 'gnd2')).toBe('0');
  });

  it('keeps wires apart unless they share an end point', () => {
    const netlist = buildNetlist({
      elements: [
        resistor('R1', 'left', 'gnd', 1),
        resistor('R2', 'top', 'gnd', 1),
        wire('horizontal', 'left', 'right'),
        wire('vertical', 'top', 'bottom'),
        ground('G', 'gnd'),
      ],
    });
    expect(netlist.pointToNode.get('left')).toBe(netlist.pointToNode.get('right'));
    expect(netlist.pointToNode.get('top')).toBe(netlist.pointToNode.get('bottom'));
    expect(netlist.pointToNode.get('left')).not.toBe(netlist.pointToNode.get('top'));
  });

  it('adds no unknown for a wire that touches nothing', () => {
    const netlist = buildNetlist({
      elements: [resistor('R1', 'a', 'gnd', 1), wire('stray', 'x', 'y'), ground('G', 'gnd')],
    });
    expect(netlist.nodeIds).toEqual([1]);
    expect(netlist.pointToNode.has('x')).toBe(false);
  });
});
