import type { Bjt, Circuit, Component, Diode, OpAmp, PointId, Zener } from './circuit';

export type NodeId = number;

/** The reference (ground) node always has this id. Other nodes are numbered from 1. */
export const REFERENCE_NODE: NodeId = 0;

export interface NetComponent {
  readonly element: Component;
  /** Node of the first terminal: resistor `a`, voltage source `plus`, current source `from`. */
  readonly a: NodeId;
  /** Node of the second terminal: resistor `b`, voltage source `minus`, current source `to`. */
  readonly b: NodeId;
}

export interface NetDiode {
  readonly element: Diode | Zener;
  readonly a: NodeId;
  readonly b: NodeId;
}

export interface NetOpAmp {
  readonly element: OpAmp;
  readonly inverting: NodeId;
  readonly nonInverting: NodeId;
  readonly output: NodeId;
}

export interface NetBjt {
  readonly element: Bjt;
  readonly base: NodeId;
  readonly collector: NodeId;
  readonly emitter: NodeId;
}

export interface Netlist {
  readonly hasReference: boolean;
  /** Non-reference nodes that have at least one terminal on them, in numbering order. */
  readonly nodeIds: readonly NodeId[];
  readonly components: readonly NetComponent[];
  readonly diodes?: readonly NetDiode[];
  readonly opAmps: readonly NetOpAmp[];
  readonly bjts?: readonly NetBjt[];
  /** Node of each point. Points on wires that touch no component and no ground have no node. */
  readonly pointToNode: ReadonlyMap<PointId, NodeId>;
}

class PointSets {
  private readonly parent = new Map<PointId, PointId>();

  find(point: PointId): PointId {
    let root = point;
    for (let next = this.parent.get(root); next !== undefined && next !== root; next = this.parent.get(root)) {
      root = next;
    }
    this.parent.set(point, root);
    return root;
  }

  union(a: PointId, b: PointId): void {
    this.parent.set(this.find(a), this.find(b));
  }

  points(): PointId[] {
    return [...this.parent.keys()];
  }
}

function terminals(element: Component | Diode | Zener): readonly [PointId, PointId] {
  switch (element.kind) {
    case 'resistor':
      return [element.a, element.b];
    case 'voltage-source':
      return [element.plus, element.minus];
    case 'current-source':
      return [element.from, element.to];
  }
  return [element.anode, element.cathode];
}

/**
 * Merges points joined by wires into nodes. All ground symbols share one reference node.
 * Wires connect only where they share an end point, so two wires that merely cross stay apart.
 */
export function buildNetlist(circuit: Circuit): Netlist {
  const sets = new PointSets();
  const connected: (Component | Diode | Zener | Bjt | OpAmp)[] = [];
  let groundPoint: PointId | undefined;

  for (const element of circuit.elements) {
    switch (element.kind) {
      case 'wire':
        sets.union(element.a, element.b);
        break;
      case 'ground':
        sets.find(element.point);
        if (groundPoint !== undefined) sets.union(groundPoint, element.point);
        groundPoint = element.point;
        break;
      case 'op-amp':
        [element.inverting, element.nonInverting, element.output].forEach((point) => sets.find(point));
        connected.push(element);
        break;
      case 'bjt':
        [element.base, element.collector, element.emitter].forEach((point) => sets.find(point));
        connected.push(element);
        break;
      default:
        terminals(element).forEach((point) => sets.find(point));
        connected.push(element);
    }
  }

  const nodeOfRoot = new Map<PointId, NodeId>();
  if (groundPoint !== undefined) {
    nodeOfRoot.set(sets.find(groundPoint), REFERENCE_NODE);
  }

  const nodeIds: NodeId[] = [];
  const nodeOf = (point: PointId): NodeId => {
    const root = sets.find(point);
    let node = nodeOfRoot.get(root);
    if (node === undefined) {
      node = nodeIds.length + 1;
      nodeIds.push(node);
      nodeOfRoot.set(root, node);
    }
    return node;
  };

  // In drawing order, so a node's number doesn't depend on what kind of element reached it first.
  const netComponents: NetComponent[] = [];
  const netDiodes: NetDiode[] = [];
  const netOpAmps: NetOpAmp[] = [];
  const netBjts: NetBjt[] = [];
  for (const element of connected) {
    if (element.kind === 'op-amp') {
      const inverting = nodeOf(element.inverting);
      const nonInverting = nodeOf(element.nonInverting);
      netOpAmps.push({ element, inverting, nonInverting, output: nodeOf(element.output) });
    } else if (element.kind === 'bjt') {
      netBjts.push({ element, base: nodeOf(element.base), collector: nodeOf(element.collector), emitter: nodeOf(element.emitter) });
    } else if (element.kind === 'diode' || element.kind === 'zener') {
      const [anode, cathode] = terminals(element);
      netDiodes.push({ element, a: nodeOf(anode), b: nodeOf(cathode) });
    } else {
      const [first, second] = terminals(element);
      const a = nodeOf(first);
      netComponents.push({ element, a, b: nodeOf(second) });
    }
  }

  const pointToNode = new Map<PointId, NodeId>();
  for (const point of sets.points()) {
    const node = nodeOfRoot.get(sets.find(point));
    if (node !== undefined) pointToNode.set(point, node);
  }

  return {
    hasReference: groundPoint !== undefined,
    nodeIds,
    components: netComponents,
    diodes: netDiodes,
    opAmps: netOpAmps,
    ...(netBjts.length > 0 ? { bjts: netBjts } : {}),
    pointToNode,
  };
}
