import type { ElementId } from './circuit';
import { Fraction } from './fraction';
import { solveLinearSystem } from './linear';
import { REFERENCE_NODE, type NetComponent, type Netlist, type NodeId } from './netlist';

/**
 * The node voltage method as written on paper. Unlike MNA it adds no source-current unknowns:
 * a voltage source either fixes a node's voltage or ties nodes into a supernode.
 * This is an independent route to the answer, so the tests can compare it with MNA.
 */

/** V(node) = V(parent) + delta, as stated by one voltage source. */
export interface VoltageRelation {
  readonly node: NodeId;
  readonly parent: NodeId;
  readonly delta: Fraction;
  readonly sourceId: ElementId;
}

/** A node voltage in terms of an unknown: V = V(unknown) + offset. With no unknown, it's just offset. */
export interface NodeExpression {
  readonly unknown: NodeId | null;
  readonly offset: Fraction;
}

export interface NodeGroup {
  /** Null for the group tied to ground, whose voltages are all known. */
  readonly representative: NodeId | null;
  /** Nodes in the group. The reference node is never listed. */
  readonly nodes: readonly NodeId[];
  readonly relations: readonly VoltageRelation[];
}

export type KclTerm =
  | {
      readonly kind: 'resistor';
      readonly elementId: ElementId;
      /** The current leaving the node: (V(from) − V(to)) / resistance. */
      readonly from: NodeId;
      readonly to: NodeId;
      readonly resistance: Fraction;
    }
  | {
      readonly kind: 'current-source';
      readonly elementId: ElementId;
      readonly direction: 'entering' | 'leaving';
      readonly current: Fraction;
    };

export interface KclEquation {
  /** One node, or all the nodes of a supernode. */
  readonly nodes: readonly NodeId[];
  readonly terms: readonly KclTerm[];
  /** The equation after substitution: Σ coefficients[i] · V(unknowns[i]) = rhs. */
  readonly coefficients: readonly Fraction[];
  readonly rhs: Fraction;
}

export interface NodalSolution {
  readonly unknowns: readonly NodeId[];
  readonly knownGroup: NodeGroup | null;
  readonly supernodes: readonly NodeGroup[];
  readonly expressions: ReadonlyMap<NodeId, NodeExpression>;
  readonly equations: readonly KclEquation[];
  /** Includes the reference node at 0 V. */
  readonly nodeVoltages: ReadonlyMap<NodeId, Fraction>;
}

function collectGroup(
  start: NodeId,
  sources: readonly NetComponent[],
  visited: Set<NodeId>,
): { nodes: NodeId[]; relations: VoltageRelation[] } {
  const nodes = [start];
  const relations: VoltageRelation[] = [];
  visited.add(start);

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    for (const { element, a, b } of sources) {
      if (element.kind !== 'voltage-source' || (a !== node && b !== node)) continue;
      const next = a === node ? b : a;
      if (visited.has(next)) continue;
      visited.add(next);
      nodes.push(next);
      // The source fixes V(a) − V(b), where a is its plus terminal.
      const delta = a === node ? element.voltage.neg() : element.voltage;
      relations.push({ node: next, parent: node, delta, sourceId: element.id });
    }
  }
  return { nodes, relations };
}

/** Collects the nodes fixed by voltage sources connected to the reference node. */
export function knownVoltageGroup(netlist: Netlist, redundantSources: ReadonlySet<ElementId>): NodeGroup | null {
  const sources = netlist.components.filter(
    ({ element }) => element.kind === 'voltage-source' && !redundantSources.has(element.id),
  );
  const fromGround = collectGroup(REFERENCE_NODE, sources, new Set<NodeId>());
  const nodes = fromGround.nodes.filter((node) => node !== REFERENCE_NODE);
  return nodes.length > 0 ? { representative: null, nodes, relations: fromGround.relations } : null;
}

function kclTerms(netlist: Netlist, group: ReadonlySet<NodeId>): KclTerm[] {
  const terms: KclTerm[] = [];
  for (const { element, a, b } of netlist.components) {
    const aInside = group.has(a);
    if (aInside === group.has(b)) continue;
    if (element.kind === 'resistor') {
      terms.push({
        kind: 'resistor',
        elementId: element.id,
        from: aInside ? a : b,
        to: aInside ? b : a,
        resistance: element.resistance,
      });
    } else if (element.kind === 'current-source') {
      terms.push({
        kind: 'current-source',
        elementId: element.id,
        direction: aInside ? 'leaving' : 'entering',
        current: element.current,
      });
    }
  }
  return terms;
}

function buildEquation(
  nodes: readonly NodeId[],
  terms: readonly KclTerm[],
  unknowns: readonly NodeId[],
  expressions: ReadonlyMap<NodeId, NodeExpression>,
): KclEquation {
  const coefficients = new Array<Fraction>(unknowns.length).fill(Fraction.ZERO);
  let constant = Fraction.ZERO;

  const addVoltage = (node: NodeId, factor: Fraction): void => {
    const expression = expressions.get(node)!;
    constant = constant.add(expression.offset.mul(factor));
    if (expression.unknown !== null) {
      const index = unknowns.indexOf(expression.unknown);
      coefficients[index] = coefficients[index]!.add(factor);
    }
  };

  for (const term of terms) {
    if (term.kind === 'resistor') {
      const conductance = Fraction.ONE.div(term.resistance);
      addVoltage(term.from, conductance);
      addVoltage(term.to, conductance.neg());
    } else {
      constant = term.direction === 'leaving' ? constant.add(term.current) : constant.sub(term.current);
    }
  }

  return { nodes, terms, coefficients, rhs: constant.neg() };
}

/**
 * Solves a circuit that has already passed validation. `redundantSources` close a loop of voltage
 * sources whose voltages agree; they add no information, so they are left out.
 * Returns null when the system is singular.
 *
 * An op-amp changes the count twice, and the two cancel out. Its rule V(+) = V(−) removes an
 * unknown, because one input can be written using the other. And its output's node loses its
 * equation, because the output supplies whatever current that node needs. Unlike a supernode, the
 * two inputs keep separate equations: no current passes between them.
 */
export function solveNodal(netlist: Netlist, redundantSources: ReadonlySet<ElementId>): NodalSolution | null {
  const visited = new Set<NodeId>();
  const knownGroup = knownVoltageGroup(netlist, redundantSources);
  const sources = netlist.components.filter(
    ({ element }) => element.kind === 'voltage-source' && !redundantSources.has(element.id),
  );
  const fromGround = collectGroup(REFERENCE_NODE, sources, visited);

  const otherGroups: NodeGroup[] = [];
  for (const node of netlist.nodeIds) {
    if (visited.has(node)) continue;
    const { nodes, relations } = collectGroup(node, sources, visited);
    otherGroups.push({ representative: node, nodes, relations });
  }

  // Each group's nodes relative to its first node, as its voltage sources state them.
  const startOfNode = new Map<NodeId, NodeId>();
  const localOffset = new Map<NodeId, Fraction>();
  const addGroup = (start: NodeId, nodes: readonly NodeId[], relations: readonly VoltageRelation[]): void => {
    nodes.forEach((node) => startOfNode.set(node, start));
    localOffset.set(start, Fraction.ZERO);
    for (const { node, parent, delta } of relations) {
      localOffset.set(node, localOffset.get(parent)!.add(delta));
    }
  };
  addGroup(REFERENCE_NODE, fromGround.nodes, fromGround.relations);
  otherGroups.forEach((group) => addGroup(group.representative!, group.nodes, group.relations));

  // Then what each group's first node equals, spreading outward through the op-amp input rules.
  const startExpression = new Map<NodeId, NodeExpression>([
    [REFERENCE_NODE, { unknown: null, offset: Fraction.ZERO }],
  ]);
  const spread = (): void => {
    for (let changed = true; changed; ) {
      changed = false;
      for (const { inverting, nonInverting } of netlist.opAmps) {
        const startA = startOfNode.get(inverting)!;
        const startB = startOfNode.get(nonInverting)!;
        const a = startExpression.get(startA);
        const b = startExpression.get(startB);
        // V(startA) + localA = V(startB) + localB
        const difference = localOffset.get(inverting)!.sub(localOffset.get(nonInverting)!);
        if (a && !b) {
          startExpression.set(startB, { unknown: a.unknown, offset: a.offset.add(difference) });
          changed = true;
        } else if (b && !a) {
          startExpression.set(startA, { unknown: b.unknown, offset: b.offset.sub(difference) });
          changed = true;
        }
      }
    }
  };
  spread();

  const unknowns: NodeId[] = [];
  for (const { representative } of otherGroups) {
    if (startExpression.has(representative!)) continue;
    unknowns.push(representative!);
    startExpression.set(representative!, { unknown: representative, offset: Fraction.ZERO });
    spread();
  }

  const expressions = new Map<NodeId, NodeExpression>();
  for (const [node, start] of startOfNode) {
    const { unknown, offset } = startExpression.get(start)!;
    expressions.set(node, { unknown, offset: offset.add(localOffset.get(node)!) });
  }

  const outputs = new Set(netlist.opAmps.map(({ output }) => output));
  const equations = otherGroups
    .filter((group) => !group.nodes.some((node) => outputs.has(node)))
    .map((group) => buildEquation(group.nodes, kclTerms(netlist, new Set(group.nodes)), unknowns, expressions));
  // Input rules that repeat or contradict each other remove no unknown, which leaves too few equations.
  if (equations.length !== unknowns.length) return null;

  const values = solveLinearSystem(
    equations.map((equation) => equation.coefficients),
    equations.map((equation) => equation.rhs),
  );
  if (!values) return null;

  const nodeVoltages = new Map<NodeId, Fraction>();
  for (const [node, { unknown, offset }] of expressions) {
    const base = unknown === null ? Fraction.ZERO : values[unknowns.indexOf(unknown)]!;
    nodeVoltages.set(node, base.add(offset));
  }

  return {
    unknowns,
    knownGroup,
    supernodes: otherGroups.filter((group) => group.nodes.length > 1),
    expressions,
    equations,
    nodeVoltages,
  };
}

export type KclConvention = 'leaving-sum' | 'entering-equals-leaving';

/** "Entering = leaving" is how the course notes this project follows write it; the other form is optional. */
export const DEFAULT_KCL_CONVENTION: KclConvention = 'entering-equals-leaving';

export interface SignedKclTerm {
  readonly sign: 1 | -1;
  readonly term: KclTerm;
}

export interface ArrangedKcl {
  readonly left: readonly SignedKclTerm[];
  /** An empty side means zero. */
  readonly right: readonly SignedKclTerm[];
}

/** Writes one equation in the chosen form. Both describe the same physics, just arranged differently. */
export function arrangeKcl(
  terms: readonly KclTerm[],
  convention: KclConvention,
  directions?: readonly ('entering' | 'leaving')[],
): ArrangedKcl {
  const isEntering = (term: KclTerm, index: number): boolean =>
    directions ? directions[index] === 'entering' : term.kind === 'current-source' && term.direction === 'entering';

  if (convention === 'leaving-sum') {
    return {
      left: terms.map((term) => ({
        sign: term.kind === 'current-source' && term.direction === 'entering' ? -1 : 1,
        term,
      })),
      right: [],
    };
  }
  return {
    left: terms.filter((term, index) => isEntering(term, index)).map((term) => ({ sign: 1, term })),
    right: terms.filter((term, index) => !isEntering(term, index)).map((term) => ({ sign: 1, term })),
  };
}
