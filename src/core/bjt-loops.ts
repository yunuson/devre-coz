import type { AnalysisResult } from './analyze';
import type { Bjt, ElementId } from './circuit';
import { Fraction } from './fraction';
import { REFERENCE_NODE, type NetComponent, type Netlist, type NodeId } from './netlist';
import { knownVoltageGroup } from './nodal';

export type BjtLoopPattern = 'known-base' | 'fixed' | 'emitter-resistor' | 'divider';

export interface LoopSide {
  readonly node: NodeId | null;
  readonly voltage: Fraction;
  readonly sourceId: ElementId | null;
  readonly resistorId: ElementId | null;
  readonly resistance: Fraction;
}

export interface BjtTheveninData {
  readonly transistorId: ElementId;
  readonly upper: LoopSide;
  readonly lower: LoopSide;
  readonly eth: Fraction;
  readonly rth: Fraction;
  readonly elementIds: readonly ElementId[];
}

export interface BjtInputLoopData {
  readonly transistorId: ElementId;
  readonly polarity: Bjt['polarity'];
  readonly pattern: BjtLoopPattern;
  readonly beta: Fraction;
  readonly vbe: Fraction;
  readonly base: LoopSide;
  readonly emitter: LoopSide;
  readonly ib: Fraction;
  readonly ic: Fraction;
  readonly ie: Fraction;
  readonly elementIds: readonly ElementId[];
}

export interface BjtOutputLoopData {
  readonly transistorId: ElementId;
  readonly polarity: Bjt['polarity'];
  readonly collector: LoopSide;
  readonly emitter: LoopSide;
  readonly ic: Fraction;
  readonly ie: Fraction;
  readonly vce: Fraction;
  readonly elementIds: readonly ElementId[];
}

export interface BjtVoltagesData {
  readonly transistorId: ElementId;
  readonly polarity: Bjt['polarity'];
  readonly vb: Fraction;
  readonly vc: Fraction;
  readonly ve: Fraction;
  readonly elementIds: readonly ElementId[];
}

export interface BjtLoopTransistor {
  readonly transistorId: ElementId;
  readonly thevenin: BjtTheveninData | null;
  readonly input: BjtInputLoopData;
  readonly output: BjtOutputLoopData;
  readonly voltages: BjtVoltagesData;
}

const zero = Fraction.ZERO;

function sourceAt(netlist: Netlist, node: NodeId): ElementId | null {
  const direct = netlist.components.filter(({ element, a, b }) =>
    element.kind === 'voltage-source' && ((a === node && b === REFERENCE_NODE) || (b === node && a === REFERENCE_NODE)),
  );
  return direct.length === 1 ? direct[0]!.element.id : null;
}

function componentsAt(netlist: Netlist, node: NodeId): NetComponent[] {
  return netlist.components.filter(({ a, b }) => a === node || b === node);
}

function onlyBjtAndComponents(netlist: Netlist, node: NodeId, transistorId: ElementId, componentIds: ReadonlySet<ElementId>): boolean {
  const bjtTerminals = (netlist.bjts ?? []).flatMap(({ element, base, collector, emitter }) =>
    [base, collector, emitter].flatMap((terminal) => terminal === node ? [element.id] : []),
  );
  if (bjtTerminals.length !== 1 || bjtTerminals[0] !== transistorId) return false;
  const otherIds = [
    ...componentsAt(netlist, node).map(({ element }) => element.id),
    ...(netlist.diodes ?? []).flatMap(({ element, a, b }) => a === node || b === node ? [element.id] : []),
    ...netlist.opAmps.flatMap(({ element, inverting, nonInverting, output }) =>
      inverting === node || nonInverting === node || output === node ? [element.id] : []),
  ];
  return otherIds.length === componentIds.size && otherIds.every((id) => componentIds.has(id));
}

function resistorEnd(component: NetComponent, node: NodeId): NodeId {
  return component.a === node ? component.b : component.a;
}

function directSide(node: NodeId, voltage: Fraction, netlist: Netlist): LoopSide {
  return { node, voltage, sourceId: sourceAt(netlist, node), resistorId: null, resistance: zero };
}

function sideWithResistor(
  netlist: Netlist,
  node: NodeId,
  knownNodes: ReadonlySet<NodeId>,
  voltages: ReadonlyMap<NodeId, Fraction>,
  transistorId: ElementId,
): LoopSide | null {
  const incident = componentsAt(netlist, node);
  if (incident.length !== 1 || incident[0]!.element.kind !== 'resistor') return null;
  const component = incident[0]!;
  const other = resistorEnd(component, node);
  if (!knownNodes.has(other) || !onlyBjtAndComponents(netlist, node, transistorId, new Set([component.element.id]))) return null;
  const element = component.element;
  if (element.kind !== 'resistor') return null;
  return {
    node: other,
    voltage: voltages.get(other)!,
    sourceId: sourceAt(netlist, other),
    resistorId: element.id,
    resistance: element.resistance,
  };
}

function analyzeOne(
  analysis: Extract<AnalysisResult, { status: 'solved' }>,
  transistorId: ElementId,
  knownNodes: ReadonlySet<NodeId>,
): BjtLoopTransistor | null {
  const netlist = analysis.netlist;
  const bjt = netlist.bjts!.find(({ element }) => element.id === transistorId)!;
  const { element, base, collector, emitter } = bjt;
  const nodeVoltages = analysis.nodeVoltages;
  const baseKnown = knownNodes.has(base);
  const baseResistors = componentsAt(netlist, base);
  const emitterSide = knownNodes.has(emitter)
    ? directSide(emitter, nodeVoltages.get(emitter)!, netlist)
    : sideWithResistor(netlist, emitter, knownNodes, nodeVoltages, transistorId);
  const collectorSide = knownNodes.has(collector)
    ? directSide(collector, nodeVoltages.get(collector)!, netlist)
    : sideWithResistor(netlist, collector, knownNodes, nodeVoltages, transistorId);
  if (!emitterSide || !collectorSide) return null;

  let pattern: BjtLoopPattern;
  let baseSide: LoopSide;
  let baseResistorIds: ElementId[];
  let thevenin: BjtTheveninData | null = null;
  if (baseKnown && emitterSide.resistorId !== null) {
    pattern = 'known-base';
    baseSide = directSide(base, nodeVoltages.get(base)!, netlist);
    baseResistorIds = [];
  } else if (!baseKnown && baseResistors.length === 1) {
    const candidate = sideWithResistor(netlist, base, knownNodes, nodeVoltages, transistorId);
    if (!candidate) return null;
    pattern = emitterSide.resistorId === null ? 'fixed' : 'emitter-resistor';
    baseSide = candidate;
    baseResistorIds = [candidate.resistorId!];
  } else if (!baseKnown && baseResistors.length === 2) {
    if (!onlyBjtAndComponents(netlist, base, transistorId, new Set(baseResistors.map(({ element }) => element.id)))) return null;
    const candidates = baseResistors.map((component) => {
      if (component.element.kind !== 'resistor') return null;
      const other = resistorEnd(component, base);
      if (!knownNodes.has(other)) return null;
      return {
        node: other,
        voltage: nodeVoltages.get(other)!,
        sourceId: sourceAt(netlist, other),
        resistorId: component.element.id,
        resistance: component.element.resistance,
      } satisfies LoopSide;
    });
    if (candidates.some((side) => side === null)) return null;
    const sides = candidates as LoopSide[];
    const [first, second] = sides;
    const upperIndex = first!.voltage.sub(second!.voltage).num < 0n ? 1 : 0;
    const upper = sides[upperIndex]!;
    const lower = sides[1 - upperIndex]!;
    const eth = lower.voltage.add(upper.voltage.sub(lower.voltage).mul(lower.resistance).div(upper.resistance.add(lower.resistance)));
    const rth = upper.resistance.mul(lower.resistance).div(upper.resistance.add(lower.resistance));
    thevenin = {
      transistorId,
      upper,
      lower,
      eth,
      rth,
      elementIds: [upper.resistorId!, lower.resistorId!],
    };
    pattern = 'divider';
    baseSide = { node: null, voltage: eth, sourceId: null, resistorId: null, resistance: rth };
    baseResistorIds = [upper.resistorId!, lower.resistorId!];
  } else {
    return null;
  }

  if (baseKnown && pattern !== 'known-base') return null;
  const beta = element.beta;
  const betaPlusOne = beta.add(Fraction.from(1));
  const numerator = element.polarity === 'npn'
    ? baseSide.voltage.sub(emitterSide.voltage).sub(element.vbe)
    : emitterSide.voltage.sub(baseSide.voltage).sub(element.vbe);
  const ib = numerator.div(baseSide.resistance.add(betaPlusOne.mul(emitterSide.resistance)));
  const ic = beta.mul(ib);
  const ie = betaPlusOne.mul(ib);
  const input: BjtInputLoopData = {
    transistorId, polarity: element.polarity, pattern, beta, vbe: element.vbe,
    base: baseSide, emitter: emitterSide, ib, ic, ie,
    elementIds: [transistorId, ...baseResistorIds, ...(emitterSide.resistorId ? [emitterSide.resistorId] : [])],
  };
  const vce = element.polarity === 'npn'
    ? collectorSide.voltage.sub(collectorSide.resistance.mul(ic)).sub(emitterSide.voltage).sub(emitterSide.resistance.mul(ie))
    : emitterSide.voltage.sub(emitterSide.resistance.mul(ie)).sub(collectorSide.voltage).sub(collectorSide.resistance.mul(ic));
  const output: BjtOutputLoopData = {
    transistorId, polarity: element.polarity, collector: collectorSide, emitter: emitterSide, ic, ie, vce,
    elementIds: [transistorId, ...(collectorSide.resistorId ? [collectorSide.resistorId] : []), ...(emitterSide.resistorId ? [emitterSide.resistorId] : [])],
  };
  const ve = element.polarity === 'npn'
    ? emitterSide.voltage.add(emitterSide.resistance.mul(ie))
    : emitterSide.voltage.sub(emitterSide.resistance.mul(ie));
  const vb = element.polarity === 'npn' ? ve.add(element.vbe) : ve.sub(element.vbe);
  const vc = element.polarity === 'npn'
    ? collectorSide.voltage.sub(collectorSide.resistance.mul(ic))
    : collectorSide.voltage.add(collectorSide.resistance.mul(ic));
  return {
    transistorId,
    thevenin,
    input,
    output,
    voltages: { transistorId, polarity: element.polarity, vb, vc, ve, elementIds: [transistorId] },
  };
}

/** Returns textbook loop data only when every transistor and every unknown node matches a supported pattern. */
export function analyzeBjtLoops(analysis: Extract<AnalysisResult, { status: 'solved' }>, redundantSources: ReadonlySet<ElementId>): BjtLoopTransistor[] | null {
  const netlist = analysis.netlist;
  const bjts = netlist.bjts ?? [];
  if (bjts.length === 0 || analysis.transistorStates?.some(({ state }) => state !== 'active')) return null;
  const knownGroup = knownVoltageGroup(netlist, redundantSources);
  const knownNodes = new Set([REFERENCE_NODE, ...(knownGroup?.nodes ?? [])]);
  const transistorNodes = new Set(bjts.flatMap(({ base, collector, emitter }) => [base, collector, emitter]));
  if (netlist.nodeIds.some((node) => !knownNodes.has(node) && !transistorNodes.has(node))) return null;
  const portCount = new Map<NodeId, number>();
  for (const { base, collector, emitter } of bjts) {
    for (const node of [base, collector, emitter]) portCount.set(node, (portCount.get(node) ?? 0) + 1);
  }
  if ([...portCount].some(([node, count]) => !knownNodes.has(node) && count !== 1)) return null;
  const result = bjts.map(({ element }) => analyzeOne(analysis, element.id, knownNodes));
  return result.some((item) => item === null) ? null : result as BjtLoopTransistor[];
}
