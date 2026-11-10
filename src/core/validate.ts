import type { Circuit, CurrentSource, ElementId, PointId, VoltageSource } from './circuit';
import { Fraction } from './fraction';
import { opAmpFeedback } from './mna';
import { REFERENCE_NODE, type NetComponent, type Netlist, type NodeId } from './netlist';

export type IssueSeverity = 'error' | 'warning';

export type IssueCode =
  | 'empty-circuit'
  | 'no-ground'
  | 'invalid-resistance'
  | 'voltage-source-shorted'
  | 'voltage-source-conflict'
  | 'floating-subcircuit'
  | 'current-source-no-path'
  | 'undetermined-voltage'
  | 'singular-system'
  | 'source-current-indeterminate'
  | 'resistor-shorted'
  | 'dangling-element'
  | 'op-amp-input-open'
  | 'op-amp-output-shorted'
  | 'op-amp-no-feedback'
  | 'op-amp-positive-feedback'
  | 'op-amp-saturated'
  | 'too-many-diodes'
  | 'diode-no-solution';

/** Structured on purpose: the UI layer turns the code into text and highlights the listed elements. */
export interface Issue {
  readonly severity: IssueSeverity;
  readonly code: IssueCode;
  readonly elementIds: readonly ElementId[];
  /** Wires that form the short circuit, when there is one to highlight. */
  readonly wireIds: readonly ElementId[];
}

export interface VoltageSourceLoops {
  /** Sources that close a loop of voltage sources whose voltages agree. The solver leaves these out. */
  readonly redundantIds: ReadonlySet<ElementId>;
  /** Every source in such a loop: node voltages are known but these currents are not. */
  readonly indeterminateIds: ReadonlySet<ElementId>;
  readonly shorted: readonly VoltageSource[];
  /** Each conflict lists the sources of one loop whose voltages disagree. */
  readonly conflicts: readonly (readonly ElementId[])[];
  readonly agreeing: readonly (readonly ElementId[])[];
}

const issue = (
  severity: IssueSeverity,
  code: IssueCode,
  elementIds: readonly ElementId[] = [],
  wireIds: readonly ElementId[] = [],
): Issue => ({ severity, code, elementIds, wireIds });

interface SourcePath {
  readonly sources: readonly VoltageSource[];
  /** V(start) − V(end) along the path. */
  readonly drop: Fraction;
}

function findSourcePath(accepted: readonly NetComponent[], start: NodeId, end: NodeId): SourcePath | null {
  const visited = new Set<NodeId>([start]);
  const queue: { node: NodeId; path: SourcePath }[] = [
    { node: start, path: { sources: [], drop: Fraction.ZERO } },
  ];
  for (let step = queue.shift(); step; step = queue.shift()) {
    if (step.node === end) return step.path;
    for (const edge of accepted) {
      if (edge.a !== step.node && edge.b !== step.node) continue;
      const next = edge.a === step.node ? edge.b : edge.a;
      if (visited.has(next)) continue;
      visited.add(next);
      const source = edge.element as VoltageSource;
      const change = edge.a === step.node ? source.voltage : source.voltage.neg();
      queue.push({
        node: next,
        path: { sources: [...step.path.sources, source], drop: step.path.drop.add(change) },
      });
    }
  }
  return null;
}

/** Finds voltage sources whose terminals are already tied together by wires or by other sources. */
export function findVoltageSourceLoops(netlist: Netlist): VoltageSourceLoops {
  const redundantIds = new Set<ElementId>();
  const indeterminateIds = new Set<ElementId>();
  const shorted: VoltageSource[] = [];
  const conflicts: ElementId[][] = [];
  const agreeing: ElementId[][] = [];
  const accepted: NetComponent[] = [];

  for (const component of netlist.components) {
    if (component.element.kind !== 'voltage-source') continue;
    const source = component.element;

    if (component.a === component.b && !source.voltage.isZero()) {
      shorted.push(source);
      continue;
    }

    const path = findSourcePath(accepted, component.a, component.b);
    if (!path) {
      accepted.push(component);
      continue;
    }

    const loop = [...path.sources.map((member) => member.id), source.id];
    if (path.drop.equals(source.voltage)) {
      agreeing.push(loop);
      redundantIds.add(source.id);
      loop.forEach((id) => indeterminateIds.add(id));
    } else {
      conflicts.push(loop);
    }
  }

  return { redundantIds, indeterminateIds, shorted, conflicts, agreeing };
}

function shortCircuitWires(circuit: Circuit, start: PointId, end: PointId): ElementId[] {
  const visited = new Set<PointId>([start]);
  const queue: { point: PointId; wires: ElementId[] }[] = [{ point: start, wires: [] }];
  for (let step = queue.shift(); step; step = queue.shift()) {
    if (step.point === end) return step.wires;
    for (const element of circuit.elements) {
      if (element.kind !== 'wire') continue;
      if (element.a !== step.point && element.b !== step.point) continue;
      const next = element.a === step.point ? element.b : element.a;
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push({ point: next, wires: [...step.wires, element.id] });
    }
  }
  return [];
}

/** Groups nodes that are connected through the given components. */
function connectedGroups(components: readonly Pick<NetComponent, 'a' | 'b'>[]): Map<NodeId, Set<NodeId>> {
  const groupOf = new Map<NodeId, Set<NodeId>>();
  const groupFor = (node: NodeId): Set<NodeId> => {
    let group = groupOf.get(node);
    if (!group) {
      group = new Set([node]);
      groupOf.set(node, group);
    }
    return group;
  };
  for (const { a, b } of components) {
    const first = groupFor(a);
    const second = groupFor(b);
    if (first === second) continue;
    for (const node of second) {
      first.add(node);
      groupOf.set(node, first);
    }
  }
  return groupOf;
}

/** An op-amp's output is driven from its unseen supplies, which are referred to ground. */
const opAmpOutputs = (netlist: Netlist): ReadonlySet<NodeId> =>
  new Set(netlist.opAmps.map(({ output }) => output));

const opAmpInputs = (netlist: Netlist): ReadonlySet<NodeId> =>
  new Set(netlist.opAmps.flatMap(({ inverting, nonInverting }) => [inverting, nonInverting]));

const includesAny = (group: ReadonlySet<NodeId>, nodes: ReadonlySet<NodeId>): boolean =>
  [...nodes].some((node) => group.has(node));

function floatingIssues(netlist: Netlist): Issue[] {
  const bjtBranches = (netlist.bjts ?? []).flatMap(({ element, base, collector, emitter }) => [
    { element, a: base, b: collector }, { element, a: collector, b: emitter }, { element, a: emitter, b: base },
  ]);
  const components = [...netlist.components, ...(netlist.diodes ?? []), ...bjtBranches];
  const groupOf = connectedGroups(components);
  const outputs = opAmpOutputs(netlist);
  // A part hanging only from an op-amp input is reported as that open input instead.
  const inputs = opAmpInputs(netlist);
  const members = new Map<Set<NodeId>, ElementId[]>();
  for (const { element, a } of components) {
    const group = groupOf.get(a)!;
    if (group.has(REFERENCE_NODE) || includesAny(group, outputs) || includesAny(group, inputs)) continue;
    members.set(group, [...(members.get(group) ?? []), element.id]);
  }
  return [...members.values()].map((ids) => issue('error', 'floating-subcircuit', ids));
}

/**
 * Nodes joined to ground only through current sources: Kirchhoff's current law either has
 * no solution (the current has nowhere to go) or does not pin down the voltage.
 */
function currentSourceIssues(netlist: Netlist): Issue[] {
  const conductive = netlist.components.filter(({ element }) => element.kind !== 'current-source');
  const bjtBranches = (netlist.bjts ?? []).flatMap(({ element, base, collector, emitter }) => [
    { element, a: base, b: collector }, { element, a: collector, b: emitter }, { element, a: emitter, b: base },
  ]);
  const groupOf = connectedGroups([...conductive, ...(netlist.diodes ?? []), ...bjtBranches]);
  const outputs = opAmpOutputs(netlist);
  const seen = new Set<Set<NodeId>>();
  const issues: Issue[] = [];

  for (const node of netlist.nodeIds) {
    const group = groupOf.get(node) ?? new Set([node]);
    if (groupOf.has(node)) {
      if (seen.has(group)) continue;
      seen.add(group);
    }
    if (group.has(REFERENCE_NODE) || includesAny(group, outputs)) continue;

    let net = Fraction.ZERO;
    const ids: ElementId[] = [];
    for (const { element, a, b } of netlist.components) {
      if (element.kind !== 'current-source') continue;
      const source: CurrentSource = element;
      const leaves = group.has(a);
      const enters = group.has(b);
      if (leaves === enters) continue;
      net = enters ? net.add(source.current) : net.sub(source.current);
      ids.push(source.id);
    }
    // Without a current source this is an open op-amp input, which has a problem of its own.
    if (ids.length === 0) continue;
    issues.push(issue('error', net.isZero() ? 'undetermined-voltage' : 'current-source-no-path', ids));
  }
  return issues;
}

/** Wiring problems that leave an op-amp without a meaningful solution. */
function opAmpWiringIssues(netlist: Netlist, redundantSources: ReadonlySet<ElementId>): Issue[] {
  const issues: Issue[] = [];

  // Summing the current equations of a part with no way to ground or to an output gives 0 = 0, so
  // an input on such a part can never be solved, even if the other input has a known voltage.
  const partOf = connectedGroups(netlist.components);
  const outputs = opAmpOutputs(netlist);
  const isOpen = (node: NodeId): boolean => {
    const part = partOf.get(node) ?? new Set([node]);
    return !part.has(REFERENCE_NODE) && !includesAny(part, outputs);
  };
  for (const { element, inverting, nonInverting } of netlist.opAmps) {
    if (isOpen(inverting) || isOpen(nonInverting)) {
      issues.push(issue('error', 'op-amp-input-open', [element.id]));
    }
  }

  // An output held by ground, a voltage source or another output can't go where the op-amp needs.
  const groupOf = connectedGroups(
    netlist.components.filter(
      ({ element }) => element.kind === 'voltage-source' && !redundantSources.has(element.id),
    ),
  );
  const groupFor = (node: NodeId): ReadonlySet<NodeId> => groupOf.get(node) ?? new Set([node]);
  netlist.opAmps.forEach(({ element, output }, index) => {
    const group = groupFor(output);
    const heldByAnother = netlist.opAmps.some(
      (other, otherIndex) => otherIndex !== index && group.has(other.output),
    );
    if (group.has(REFERENCE_NODE) || heldByAnother) {
      issues.push(issue('error', 'op-amp-output-shorted', [element.id]));
    }
  });
  return issues;
}

/** The ideal rules only describe negative feedback. Anything else would give a meaningless answer. */
function opAmpFeedbackIssues(netlist: Netlist, redundantSources: ReadonlySet<ElementId>): Issue[] {
  return netlist.opAmps.flatMap(({ element }, index) => {
    const feedback = opAmpFeedback(netlist, index, redundantSources);
    if (feedback === null) return [];
    if (feedback.isZero()) return [issue('error', 'op-amp-no-feedback', [element.id])];
    return feedback.isPositive() ? [issue('error', 'op-amp-positive-feedback', [element.id])] : [];
  });
}

/** Repeatedly removes components hanging from a node with no other connection. They carry no current. */
function danglingElementIds(netlist: Netlist): ElementId[] {
  let remaining: { readonly element: { readonly id: ElementId }; readonly a: NodeId; readonly b: NodeId }[] = [
    ...netlist.components,
    ...(netlist.diodes ?? []),
  ].filter(({ a, b }) => a !== b);
  const dangling: ElementId[] = [];
  // A resistor into an op-amp input carries no current either, but that's how the circuit is meant to work.
  const onOpAmp = new Set([...opAmpInputs(netlist), ...opAmpOutputs(netlist), ...(netlist.bjts ?? []).flatMap(({ base, collector, emitter }) => [base, collector, emitter])]);

  for (;;) {
    const degree = new Map<NodeId, number>();
    for (const { a, b } of remaining) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
    const isLeaf = (node: NodeId): boolean =>
      node !== REFERENCE_NODE && !onOpAmp.has(node) && degree.get(node) === 1;
    const next = remaining.filter(({ element, a, b }) => {
      if (!isLeaf(a) && !isLeaf(b)) return true;
      dangling.push(element.id);
      return false;
    });
    if (next.length === remaining.length) return dangling;
    remaining = next;
  }
}

function danglingBjtIds(netlist: Netlist): ElementId[] {
  const externallyConnected = new Map<NodeId, number>();
  const mark = (node: NodeId): void => { externallyConnected.set(node, (externallyConnected.get(node) ?? 0) + 1); };
  for (const { a, b } of [...netlist.components, ...(netlist.diodes ?? [])]) { mark(a); mark(b); }
  for (const bjt of netlist.bjts ?? []) {
    mark(bjt.base); mark(bjt.collector); mark(bjt.emitter);
  }
  const opAmpNodes = new Set(netlist.opAmps.flatMap(({ inverting, nonInverting, output }) => [inverting, nonInverting, output]));
  return (netlist.bjts ?? []).flatMap(({ element, base, collector, emitter }) => {
    const ownNodes = [base, collector, emitter];
    const missing = ownNodes.some((node) =>
      node !== REFERENCE_NODE && !opAmpNodes.has(node) && (externallyConnected.get(node) ?? 0) <= ownNodes.filter((other) => other === node).length,
    );
    return missing ? [element.id] : [];
  });
}

/**
 * Checks the circuit's structure before anything is solved. Reports only root causes:
 * while there are errors, their follow-up problems and all warnings stay out of the list.
 */
export function validate(circuit: Circuit, netlist: Netlist): Issue[] {
  if (netlist.components.length === 0 && (netlist.diodes?.length ?? 0) === 0 && netlist.opAmps.length === 0) {
    return [issue('error', 'empty-circuit')];
  }
  if (!netlist.hasReference) return [issue('error', 'no-ground')];

  const invalidResistors = netlist.components.flatMap(({ element }) =>
    element.kind === 'resistor' && !element.resistance.isPositive() ? [element.id] : [],
  );
  if (invalidResistors.length > 0) {
    return [issue('error', 'invalid-resistance', invalidResistors)];
  }

  const loops = findVoltageSourceLoops(netlist);
  const floating = floatingIssues(netlist);
  const errors: Issue[] = [
    ...floating,
    ...loops.shorted.map((source) =>
      issue(
        'error',
        'voltage-source-shorted',
        [source.id],
        shortCircuitWires(circuit, source.plus, source.minus),
      ),
    ),
    ...loops.conflicts.map((ids) => issue('error', 'voltage-source-conflict', ids)),
  ];
  if (floating.length === 0) errors.push(...currentSourceIssues(netlist));
  errors.push(...opAmpWiringIssues(netlist, loops.redundantIds));
  if (errors.length > 0) return errors;

  const feedbackIssues = opAmpFeedbackIssues(netlist, loops.redundantIds);
  if (feedbackIssues.length > 0) return feedbackIssues;

  const shortedResistors = netlist.components.flatMap(({ element, a, b }) =>
    element.kind === 'resistor' && a === b ? [element] : [],
  );
  const dangling = [...danglingElementIds(netlist), ...danglingBjtIds(netlist)];

  return [
    ...loops.agreeing.map((ids) => issue('warning', 'source-current-indeterminate', ids)),
    ...shortedResistors.map((element) =>
      issue('warning', 'resistor-shorted', [element.id], shortCircuitWires(circuit, element.a, element.b)),
    ),
    ...(dangling.length > 0 ? [issue('warning', 'dangling-element', dangling)] : []),
  ];
}
