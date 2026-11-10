import type { ElementId } from './circuit';
import type { BjtRegion } from './circuit';
import { Fraction } from './fraction';
import { solveLinearSystem } from './linear';
import { REFERENCE_NODE, type Netlist, type NodeId } from './netlist';

export type MnaUnknown =
  | { readonly kind: 'node-voltage'; readonly node: NodeId }
  | { readonly kind: 'source-current'; readonly elementId: ElementId }
  | { readonly kind: 'op-amp-current'; readonly elementId: ElementId }
  | { readonly kind: 'base-current'; readonly elementId: ElementId }
  | { readonly kind: 'collector-current'; readonly elementId: ElementId };

/** A · x = b, with the meaning of each entry of x listed in `unknowns`. */
export interface MnaSystem {
  readonly unknowns: readonly MnaUnknown[];
  readonly matrix: readonly (readonly Fraction[])[];
  readonly rhs: readonly Fraction[];
}

export interface MnaSolution {
  /** Includes the reference node at 0 V. */
  readonly nodeVoltages: ReadonlyMap<NodeId, Fraction>;
  /** Current through each solved voltage source, from its plus terminal to its minus terminal. */
  readonly sourceCurrents: ReadonlyMap<ElementId, Fraction>;
  /** Current each op-amp's output pushes into the circuit. */
  readonly opAmpCurrents: ReadonlyMap<ElementId, Fraction>;
  readonly baseCurrents: ReadonlyMap<ElementId, Fraction>;
  readonly collectorCurrents: ReadonlyMap<ElementId, Fraction>;
}

/**
 * Modified Nodal Analysis. Unknowns are the node voltages plus one current per voltage source
 * and per op-amp output. Each node's row is Kirchhoff's current law, with currents leaving the
 * node counted positive. An op-amp adds its output current to its output's row, and a row of its
 * own saying V(+) = V(−). No current reaches its inputs, so their rows gain nothing.
 */
export function buildMnaSystem(
  netlist: Netlist,
  skippedSources: ReadonlySet<ElementId> = new Set(),
  transistorStates: ReadonlyMap<ElementId, BjtRegion> = new Map(),
): MnaSystem {
  const sources = netlist.components.flatMap((component) =>
    component.element.kind === 'voltage-source' && !skippedSources.has(component.element.id)
      ? [{ ...component, source: component.element }]
      : [],
  );

  const activeBjts = (netlist.bjts ?? []).filter(({ element }) => transistorStates.get(element.id) !== 'cutoff');
  const saturatedBjts = activeBjts.filter(({ element }) => transistorStates.get(element.id) === 'saturation');
  const size = netlist.nodeIds.length + sources.length + netlist.opAmps.length + activeBjts.length + saturatedBjts.length;
  const matrix = Array.from({ length: size }, () => new Array<Fraction>(size).fill(Fraction.ZERO));
  const rhs = new Array<Fraction>(size).fill(Fraction.ZERO);

  const nodeIndex = new Map(netlist.nodeIds.map((node, index) => [node, index]));
  const indexOf = (node: NodeId): number | undefined =>
    node === REFERENCE_NODE ? undefined : nodeIndex.get(node);
  const addToMatrix = (row: number | undefined, col: number | undefined, value: Fraction): void => {
    if (row === undefined || col === undefined) return;
    matrix[row]![col] = matrix[row]![col]!.add(value);
  };
  const addToRhs = (row: number | undefined, value: Fraction): void => {
    if (row === undefined) return;
    rhs[row] = rhs[row]!.add(value);
  };

  for (const { element, a, b } of netlist.components) {
    const rowA = indexOf(a);
    const rowB = indexOf(b);
    if (element.kind === 'resistor') {
      const conductance = Fraction.ONE.div(element.resistance);
      addToMatrix(rowA, rowA, conductance);
      addToMatrix(rowB, rowB, conductance);
      addToMatrix(rowA, rowB, conductance.neg());
      addToMatrix(rowB, rowA, conductance.neg());
    } else if (element.kind === 'current-source') {
      addToRhs(rowA, element.current.neg());
      addToRhs(rowB, element.current);
    }
  }

  sources.forEach(({ source, a, b }, offset) => {
    const row = netlist.nodeIds.length + offset;
    const rowA = indexOf(a);
    const rowB = indexOf(b);
    addToMatrix(rowA, row, Fraction.ONE);
    addToMatrix(rowB, row, Fraction.ONE.neg());
    addToMatrix(row, rowA, Fraction.ONE);
    addToMatrix(row, rowB, Fraction.ONE.neg());
    rhs[row] = source.voltage;
  });

  netlist.opAmps.forEach(({ inverting, nonInverting, output }, offset) => {
    const row = netlist.nodeIds.length + sources.length + offset;
    // The output current enters the node, so it counts as negative in that node's row.
    addToMatrix(indexOf(output), row, Fraction.ONE.neg());
    addToMatrix(row, indexOf(nonInverting), Fraction.ONE);
    addToMatrix(row, indexOf(inverting), Fraction.ONE.neg());
  });

  const baseCurrentOffset = netlist.nodeIds.length + sources.length + netlist.opAmps.length;
  const collectorCurrentOffset = baseCurrentOffset + activeBjts.length;
  activeBjts.forEach(({ element, base, collector, emitter }, offset) => {
    const row = baseCurrentOffset + offset;
    const baseIsPlus = element.polarity === 'npn';
    const plus = baseIsPlus ? base : emitter;
    const minus = baseIsPlus ? emitter : base;
    const rowPlus = indexOf(plus);
    const rowMinus = indexOf(minus);
    const currentColumn = row;
    addToMatrix(rowPlus, currentColumn, Fraction.ONE);
    addToMatrix(rowMinus, currentColumn, Fraction.ONE.neg());
    addToMatrix(row, rowPlus, Fraction.ONE);
    addToMatrix(row, rowMinus, Fraction.ONE.neg());
    rhs[row] = element.vbe;

    if (transistorStates.get(element.id) === 'active') {
      const control = element.polarity === 'npn' ? element.beta : element.beta.neg();
      addToMatrix(indexOf(collector), currentColumn, control);
      addToMatrix(indexOf(emitter), currentColumn, control.neg());
    }
  });
  saturatedBjts.forEach(({ element, collector, emitter }, offset) => {
    const row = collectorCurrentOffset + offset;
    const plus = element.polarity === 'npn' ? collector : emitter;
    const minus = element.polarity === 'npn' ? emitter : collector;
    const rowPlus = indexOf(plus);
    const rowMinus = indexOf(minus);
    addToMatrix(rowPlus, row, Fraction.ONE);
    addToMatrix(rowMinus, row, Fraction.ONE.neg());
    addToMatrix(row, rowPlus, Fraction.ONE);
    addToMatrix(row, rowMinus, Fraction.ONE.neg());
  });

  const unknowns: MnaUnknown[] = [
    ...netlist.nodeIds.map((node): MnaUnknown => ({ kind: 'node-voltage', node })),
    ...sources.map(({ source }): MnaUnknown => ({ kind: 'source-current', elementId: source.id })),
    ...netlist.opAmps.map(({ element }): MnaUnknown => ({ kind: 'op-amp-current', elementId: element.id })),
    ...activeBjts.map(({ element }): MnaUnknown => ({ kind: 'base-current', elementId: element.id })),
    ...saturatedBjts.map(({ element }): MnaUnknown => ({ kind: 'collector-current', elementId: element.id })),
  ];

  return { unknowns, matrix, rhs };
}

/**
 * How one op-amp's feedback acts: with every source at zero and its output held at +1 V, this
 * returns V(+) − V(−). Negative means raising the output pulls the inputs back together, which is
 * the stable negative feedback the ideal rules rely on. Positive means it pushes them apart, and
 * zero means the output doesn't reach the inputs at all. Null means the circuit has no solution.
 */
export function opAmpFeedback(
  netlist: Netlist,
  index: number,
  skippedSources: ReadonlySet<ElementId> = new Set(),
): Fraction | null {
  const { unknowns, matrix } = buildMnaSystem(netlist, skippedSources);
  const target = netlist.opAmps[index]!;
  const position = (node: NodeId): number =>
    unknowns.findIndex((unknown) => unknown.kind === 'node-voltage' && unknown.node === node);

  const row = unknowns.findIndex(
    (unknown) => unknown.kind === 'op-amp-current' && unknown.elementId === target.element.id,
  );
  const outputColumn = position(target.output);
  if (outputColumn < 0) return null;

  const rows = matrix.map((values) => [...values]);
  rows[row] = rows[row]!.map((_, column) => (column === outputColumn ? Fraction.ONE : Fraction.ZERO));
  const rhs = unknowns.map((_, rowIndex) => (rowIndex === row ? Fraction.ONE : Fraction.ZERO));

  const solution = solveLinearSystem(rows, rhs);
  if (!solution) return null;

  const voltage = (node: NodeId): Fraction =>
    node === REFERENCE_NODE ? Fraction.ZERO : solution[position(node)]!;
  return voltage(target.nonInverting).sub(voltage(target.inverting));
}

/** Returns null when the system is singular. */
export function solveMna(
  netlist: Netlist,
  skippedSources: ReadonlySet<ElementId> = new Set(),
  transistorStates: ReadonlyMap<ElementId, BjtRegion> = new Map(),
): MnaSolution | null {
  const { unknowns, matrix, rhs } = buildMnaSystem(netlist, skippedSources, transistorStates);
  const solution = solveLinearSystem(matrix, rhs);
  if (!solution) return null;

  const nodeVoltages = new Map<NodeId, Fraction>([[REFERENCE_NODE, Fraction.ZERO]]);
  const sourceCurrents = new Map<ElementId, Fraction>();
  const opAmpCurrents = new Map<ElementId, Fraction>();
  const baseCurrents = new Map<ElementId, Fraction>();
  const collectorCurrents = new Map<ElementId, Fraction>();
  unknowns.forEach((unknown, index) => {
    if (unknown.kind === 'node-voltage') nodeVoltages.set(unknown.node, solution[index]!);
    else if (unknown.kind === 'source-current') sourceCurrents.set(unknown.elementId, solution[index]!);
    else if (unknown.kind === 'op-amp-current') opAmpCurrents.set(unknown.elementId, solution[index]!);
    else if (unknown.kind === 'base-current') baseCurrents.set(unknown.elementId, solution[index]!);
    else collectorCurrents.set(unknown.elementId, solution[index]!);
  });

  return { nodeVoltages, sourceCurrents, opAmpCurrents, baseCurrents, collectorCurrents };
}
