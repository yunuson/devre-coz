import { analyze, type AnalysisResult, type ElementResult } from './analyze';
import type { Bjt, BjtRegion, Circuit, Component, Diode, ElementId, Zener } from './circuit';
import type { DiodeState, DiodeStateResult, TransistorStateResult } from './diode';
import { Fraction } from './fraction';
import { analyzeBjtLoops } from './bjt-loops';
import { buildMnaSystem, type MnaSystem } from './mna';
import { REFERENCE_NODE, type NodeId } from './netlist';
import { knownVoltageGroup, solveNodal, type KclEquation, type KclTerm, type NodeExpression, type VoltageRelation } from './nodal';
import { findVoltageSourceLoops, type Issue } from './validate';

/**
 * The solution as structured data. The UI layer turns it into text and equations,
 * and `elementIds` tells it what to highlight on the drawing for each step.
 */
export type SolutionStep =
  | {
      readonly type: 'diode-states';
      readonly diodes: readonly DiodeStateResult[];
      readonly elementIds: readonly ElementId[];
    }
  | { readonly type: 'transistor-states'; readonly transistors: readonly TransistorStateResult[]; readonly elementIds: readonly ElementId[] }
  | { readonly type: 'transistor-equations'; readonly mna: MnaSystem; readonly elementIds: readonly [] }
  | { readonly type: 'bjt-thevenin'; readonly transistorId: ElementId; readonly upper: import('./bjt-loops').LoopSide; readonly lower: import('./bjt-loops').LoopSide; readonly eth: Fraction; readonly rth: Fraction; readonly elementIds: readonly ElementId[] }
  | { readonly type: 'bjt-input-loop'; readonly transistorId: ElementId; readonly polarity: Bjt['polarity']; readonly pattern: import('./bjt-loops').BjtLoopPattern; readonly beta: Fraction; readonly vbe: Fraction; readonly base: import('./bjt-loops').LoopSide; readonly emitter: import('./bjt-loops').LoopSide; readonly ib: Fraction; readonly ic: Fraction; readonly ie: Fraction; readonly elementIds: readonly ElementId[] }
  | { readonly type: 'bjt-output-loop'; readonly transistorId: ElementId; readonly polarity: Bjt['polarity']; readonly collector: import('./bjt-loops').LoopSide; readonly emitter: import('./bjt-loops').LoopSide; readonly ic: Fraction; readonly ie: Fraction; readonly vce: Fraction; readonly elementIds: readonly ElementId[] }
  | { readonly type: 'bjt-voltages'; readonly transistorId: ElementId; readonly polarity: Bjt['polarity']; readonly vb: Fraction; readonly vc: Fraction; readonly ve: Fraction; readonly elementIds: readonly ElementId[] }
  | {
      readonly type: 'transistor-currents';
      readonly transistors: readonly { readonly transistorId: ElementId; readonly polarity: Bjt['polarity']; readonly state: BjtRegion; readonly beta: Fraction; readonly ib: Fraction; readonly ic: Fraction; readonly ie: Fraction; readonly vce: Fraction }[];
      readonly elementIds: readonly ElementId[];
    }
  | {
      readonly type: 'transistor-check';
      readonly checks: readonly { readonly transistorId: ElementId; readonly polarity: Bjt['polarity']; readonly state: BjtRegion; readonly beta: Fraction; readonly ib: Fraction; readonly ic: Fraction; readonly vb: Fraction; readonly vc: Fraction; readonly ve: Fraction; readonly holds: boolean }[];
      readonly elementIds: readonly ElementId[];
    }
  | { readonly type: 'nodes'; readonly nodes: readonly NodeId[]; readonly elementIds: readonly ElementId[] }
  | { readonly type: 'reference'; readonly elementIds: readonly ElementId[] }
  | {
      /** A voltage source tied to ground fixes these voltages, so they need no equation. */
      readonly type: 'known-voltages';
      readonly relations: readonly VoltageRelation[];
      readonly values: readonly NodeValue[];
      readonly elementIds: readonly ElementId[];
    }
  | {
      readonly type: 'supernode';
      readonly nodes: readonly NodeId[];
      /** The node kept as the unknown. The others are written in terms of it. */
      readonly representative: NodeId;
      readonly relations: readonly VoltageRelation[];
      readonly expressions: readonly { readonly node: NodeId; readonly expression: NodeExpression }[];
      readonly elementIds: readonly ElementId[];
    }
  | {
      /** The rules of an ideal op-amp, applied before any current equation is written. */
      readonly type: 'op-amp';
      readonly opAmps: readonly OpAmpRule[];
      readonly elementIds: readonly ElementId[];
    }
  | {
      readonly type: 'kcl';
      readonly nodes: readonly NodeId[];
      readonly terms: readonly KclTerm[];
      /** Actual current direction for each term, relative to this node or supernode. */
      readonly directions: readonly ('entering' | 'leaving')[];
      /** How each node's voltage is written at this point: a known value or in terms of an unknown. */
      readonly expressions: ReadonlyMap<NodeId, NodeExpression>;
      /** The equation after substitution, with `unknowns` as the variables. */
      readonly unknowns: readonly NodeId[];
      readonly coefficients: readonly Fraction[];
      readonly rhs: Fraction;
      readonly solves: { readonly node: NodeId; readonly value: Fraction; readonly equals: NodeId | null } | null;
      readonly elementIds: readonly ElementId[];
    }
  | {
      /** G · V = I, without any source-current unknowns. */
      readonly type: 'system';
      readonly unknowns: readonly NodeId[];
      readonly matrix: readonly (readonly Fraction[])[];
      readonly rhs: readonly Fraction[];
      readonly elementIds: readonly ElementId[];
    }
  | { readonly type: 'node-voltages'; readonly values: readonly NodeValue[]; readonly elementIds: readonly ElementId[] }
  | {
      readonly type: 'element-results';
      readonly results: readonly (ElementResult & { readonly elementId: ElementId; readonly kind: Component['kind'] | 'op-amp' | 'diode' | 'zener' | 'bjt' })[];
      readonly derivations: readonly (
        | { readonly kind: 'ohm'; readonly elementId: ElementId; readonly from: NodeId; readonly to: NodeId; readonly fromVoltage: Fraction; readonly toVoltage: Fraction; readonly resistance: Fraction; readonly current: Fraction }
        | { readonly kind: 'kcl'; readonly elementId: ElementId; readonly node: NodeId; readonly plus: readonly ElementId[]; readonly minus: readonly ElementId[]; readonly current: Fraction }
      )[];
      readonly elementIds: readonly ElementId[];
    }
  | {
      readonly type: 'diode-check';
      readonly checks: readonly {
        readonly diodeId: ElementId;
        readonly state: DiodeState;
        readonly current: Fraction;
        readonly voltage: Fraction;
        readonly threshold: Fraction;
        readonly zenerVoltage: Fraction | null;
        readonly holds: boolean;
      }[];
      readonly elementIds: readonly ElementId[];
    }
  | {
      readonly type: 'verification';
      /** The sum of currents leaving each node. Every one must be zero. */
      readonly nodeCurrents: readonly { readonly node: NodeId; readonly sum: Fraction }[];
      /** Null when a voltage source's current is indeterminate, so the totals can't be known. */
      readonly powerAbsorbed: Fraction | null;
      readonly powerDelivered: Fraction | null;
      readonly elementIds: readonly ElementId[];
    };

export interface NodeValue {
  readonly node: NodeId;
  readonly voltage: Fraction;
}

type ElementResultRow = Extract<SolutionStep, { type: 'element-results' }>['results'][number];
type ElementDerivation = Extract<SolutionStep, { type: 'element-results' }>['derivations'][number];

function elementDerivations(
  circuit: Circuit,
  analysis: Extract<AnalysisResult, { status: 'solved' }>,
  results: readonly ElementResultRow[],
): ElementDerivation[] {
  // The node voltages belong to the solved equivalent, whose node numbers can differ from the drawn circuit's
  // (an off diode is dropped, a Zener in breakdown becomes a source turned round), so its netlist names the nodes.
  const { netlist } = analysis;
  if ((netlist.bjts?.length ?? 0) > 0) return [];
  const diodeById = new Map(circuit.elements.flatMap((element) => {
    if (element.kind !== 'diode' && element.kind !== 'zener') return [];
    const a = netlist.pointToNode.get(element.anode);
    const b = netlist.pointToNode.get(element.cathode);
    return a === undefined || b === undefined ? [] : [[element.id, { a, b }] as const];
  }));
  // A conducting diode stands in the equivalent as a source carrying its own id; it is still a diode here.
  const rectifierIds = new Set(circuit.elements.flatMap((element) => element.kind === 'diode' || element.kind === 'zener' ? [element.id] : []));
  const components = netlist.components.filter(({ element }) => !rectifierIds.has(element.id));

  const voltageAt = (node: NodeId): Fraction => node === REFERENCE_NODE ? Fraction.ZERO : analysis.nodeVoltages.get(node)!;
  const resultById = new Map(results.map((result) => [result.elementId, result]));
  const derivations: ElementDerivation[] = [];

  for (const result of results) {
    if (result.kind !== 'resistor') continue;
    const component = components.find(({ element }) => element.id === result.elementId);
    if (!component || component.element.kind !== 'resistor') continue;
    const aVoltage = voltageAt(component.a);
    const bVoltage = voltageAt(component.b);
    const from = aVoltage.sub(bVoltage).num >= 0n ? component.a : component.b;
    const to = from === component.a ? component.b : component.a;
    const current = result.current ?? Fraction.ZERO;
    derivations.push({
      kind: 'ohm',
      elementId: result.elementId,
      from,
      to,
      fromVoltage: voltageAt(from),
      toVoltage: voltageAt(to),
      resistance: component.element.resistance,
      current: current.num < 0n ? current.neg() : current,
    });
  }

  const remaining = results.flatMap((result) => {
    if (result.kind !== 'diode' && result.kind !== 'zener') return [];
    const current = result.current;
    return current && !current.isZero() && diodeById.has(result.elementId) ? [result.elementId] : [];
  });
  const found = new Set<ElementId>();

  const canUseNode = (node: NodeId, diodeId: ElementId): boolean => {
    const attached = components.filter(({ a, b }) => a === node || b === node);
    if (attached.some(({ element }) => element.id !== diodeId && element.kind !== 'resistor' && element.kind !== 'current-source')) return false;
    if (netlist.opAmps.some((opAmp) => opAmp.output === node)) return false;
    if (netlist.bjts?.some(({ base, collector, emitter }) => base === node || collector === node || emitter === node)) return false;
    return [...diodeById].every(([id, { a, b }]) =>
      (id === diodeId || (a !== node && b !== node) || found.has(id)),
    );
  };

  while (remaining.length > 0) {
    let nextIndex = -1;
    let nextDerivation: ElementDerivation | null = null;
    for (let index = 0; index < remaining.length; index++) {
      const diodeId = remaining[index]!;
      const diode = diodeById.get(diodeId)!;
      const current = resultById.get(diodeId)?.current;
      if (!current || current.isZero()) continue;
      const candidates = [diode.a, diode.b].filter((node, position, all) => all.indexOf(node) === position);
      const ordered = [...candidates.filter((node) => node !== REFERENCE_NODE), ...candidates.filter((node) => node === REFERENCE_NODE)];
      const node = ordered.find((candidate) => canUseNode(candidate, diodeId));
      if (node === undefined) continue;

      const targetLeaves = current.isPositive() ? diode.a === node : diode.b === node;
      const plus: ElementId[] = [];
      const minus: ElementId[] = [];
      let sumPlus = Fraction.ZERO;
      let sumMinus = Fraction.ZERO;
      for (const result of results) {
        if (result.elementId === diodeId || !result.current || result.current.isZero()) continue;
        const component = components.find(({ element }) => element.id === result.elementId);
        const otherDiode = diodeById.get(result.elementId);
        let a: NodeId | undefined;
        let b: NodeId | undefined;
        let branchCurrent: Fraction | null = result.current;
        if (component) {
          a = component.a;
          b = component.b;
          if (component.element.kind === 'current-source') branchCurrent = component.element.current;
        } else if (otherDiode && found.has(result.elementId)) {
          a = otherDiode.a;
          b = otherDiode.b;
        }
        if (a === undefined || b === undefined || (a !== node && b !== node) || !branchCurrent || branchCurrent.isZero()) continue;
        const enters = branchCurrent.isPositive() ? b === node : a === node;
        const belongsToPlus = targetLeaves ? enters : !enters;
        if (belongsToPlus) {
          plus.push(result.elementId);
          sumPlus = sumPlus.add(branchCurrent.num < 0n ? branchCurrent.neg() : branchCurrent);
        } else {
          minus.push(result.elementId);
          sumMinus = sumMinus.add(branchCurrent.num < 0n ? branchCurrent.neg() : branchCurrent);
        }
      }

      const diodeCurrent = current.num < 0n ? current.neg() : current;
      if (!sumPlus.sub(sumMinus).equals(diodeCurrent)) continue;
      nextIndex = index;
      nextDerivation = { kind: 'kcl', elementId: diodeId, node, plus, minus, current: diodeCurrent };
      break;
    }
    if (nextIndex < 0 || !nextDerivation) break;
    const [diodeId] = remaining.splice(nextIndex, 1);
    found.add(diodeId!);
    derivations.push(nextDerivation);
  }

  return derivations;
}

export interface OpAmpRule {
  readonly elementId: ElementId;
  readonly inverting: NodeId;
  readonly nonInverting: NodeId;
  readonly output: NodeId;
  /** What both inputs equal at this point: a known value or in terms of an unknown. */
  readonly inputs: NodeExpression;
  /** The inputs are at 0 V. A valid circuit never has both wired to ground, so one is a virtual ground. */
  readonly virtualGround: boolean;
}

export type Solution =
  | { readonly status: 'invalid'; readonly issues: readonly Issue[] }
  | {
      readonly status: 'solved';
      readonly issues: readonly Issue[];
      readonly analysis: Extract<AnalysisResult, { status: 'solved' }>;
      readonly steps: readonly SolutionStep[];
      /** The same circuit in MNA form, for students who want to see it. */
      readonly mna: MnaSystem;
    };

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const kclStep = (
  equation: KclEquation,
  expressions: ReadonlyMap<NodeId, NodeExpression>,
  nodeVoltages: ReadonlyMap<NodeId, Fraction>,
  unknowns: readonly NodeId[],
  coefficients: readonly Fraction[],
  rhs: Fraction,
  solves: Extract<SolutionStep, { type: 'kcl' }>['solves'],
): SolutionStep => ({
  type: 'kcl',
  nodes: equation.nodes,
  terms: equation.terms,
  directions: equation.terms.map((term) => {
    if (term.kind === 'current-source') return term.direction;
    const voltageDifference = nodeVoltages.get(term.from)!.sub(nodeVoltages.get(term.to)!);
    return voltageDifference.isPositive() || voltageDifference.isZero() ? 'leaving' : 'entering';
  }),
  expressions,
  unknowns,
  coefficients,
  rhs,
  solves,
  elementIds: unique(equation.terms.map((term) => term.elementId)),
});

function reducedEquation(
  equation: KclEquation,
  unknowns: readonly NodeId[],
  solvedValues: ReadonlyMap<NodeId, Fraction>,
): { readonly unknowns: NodeId[]; readonly coefficients: Fraction[]; readonly rhs: Fraction } {
  let rhs = equation.rhs;
  const remaining: NodeId[] = [];
  const coefficients: Fraction[] = [];
  unknowns.forEach((unknown, index) => {
    const coefficient = equation.coefficients[index]!;
    const solved = solvedValues.get(unknown);
    if (solved) rhs = rhs.sub(coefficient.mul(solved));
    else {
      remaining.push(unknown);
      coefficients.push(coefficient);
    }
  });
  return { unknowns: remaining, coefficients, rhs };
}

function substitutedExpressions(
  expressions: ReadonlyMap<NodeId, NodeExpression>,
  solvedValues: ReadonlyMap<NodeId, Fraction>,
): Map<NodeId, NodeExpression> {
  return new Map([...expressions].map(([node, expression]) => {
    const solved = expression.unknown === null ? undefined : solvedValues.get(expression.unknown);
    return [node, solved === undefined
      ? expression
      : { unknown: null, offset: expression.offset.add(solved) }];
  }));
}

function verificationStep(analysis: Extract<AnalysisResult, { status: 'solved' }>, circuit: Circuit): SolutionStep {
  const { netlist, elements } = analysis;
  const sums = new Map<NodeId, Fraction>(netlist.nodeIds.map((node) => [node, Fraction.ZERO]));
  const incomplete = new Set<NodeId>();
  const diodeElements = circuit.elements.filter((element): element is Diode | Zener => element.kind === 'diode' || element.kind === 'zener');
  const diodeIds = new Set(diodeElements.map(({ id }) => id));
  let powerAbsorbed: Fraction | null = Fraction.ZERO;
  let powerDelivered: Fraction | null = Fraction.ZERO;

  // An op-amp's output current counts at its output's node. Its inputs carry none, so they add nothing.
  for (const { element, output } of netlist.opAmps) {
    const { current, power } = elements.get(element.id)!;
    if (sums.has(output)) sums.set(output, sums.get(output)!.add(current!));
    if (power!.isPositive()) powerAbsorbed = powerAbsorbed.add(power!);
    else powerDelivered = powerDelivered.sub(power!);
  }

  for (const { element, a, b } of netlist.components) {
    if (diodeIds.has(element.id)) continue;
    const { current, power } = elements.get(element.id)!;
    if (!current || !power) {
      incomplete.add(a).add(b);
      powerAbsorbed = null;
      powerDelivered = null;
      continue;
    }
    if (sums.has(a)) sums.set(a, sums.get(a)!.add(current));
    if (sums.has(b)) sums.set(b, sums.get(b)!.sub(current));
    if (powerAbsorbed && powerDelivered) {
      if (power.isPositive()) powerAbsorbed = powerAbsorbed.add(power);
      else powerDelivered = powerDelivered.sub(power);
    }
  }

  for (const element of diodeElements) {
    const a = netlist.pointToNode.get(element.anode);
    const b = netlist.pointToNode.get(element.cathode);
    const { current, power } = elements.get(element.id)!;
    if (!current || !power) {
      if (a !== undefined && sums.has(a)) incomplete.add(a);
      if (b !== undefined && sums.has(b)) incomplete.add(b);
      powerAbsorbed = null;
      powerDelivered = null;
      continue;
    }
    if (a !== undefined && sums.has(a)) sums.set(a, sums.get(a)!.add(current));
    if (b !== undefined && sums.has(b)) sums.set(b, sums.get(b)!.sub(current));
    if (powerAbsorbed && powerDelivered) {
      if (power.isPositive()) powerAbsorbed = powerAbsorbed.add(power);
      else powerDelivered = powerDelivered.sub(power);
    }
  }

  for (const { element, base, collector, emitter } of netlist.bjts ?? []) {
    const transistor = analysis.transistors?.get(element.id);
    if (!transistor) continue;
    const baseCurrent = element.polarity === 'npn' ? transistor.ib : transistor.ib.neg();
    const collectorCurrent = element.polarity === 'npn' ? transistor.ic : transistor.ic.neg();
    const emitterCurrent = element.polarity === 'npn' ? transistor.ie.neg() : transistor.ie;
    if (sums.has(base)) sums.set(base, sums.get(base)!.add(baseCurrent));
    if (sums.has(collector)) sums.set(collector, sums.get(collector)!.add(collectorCurrent));
    if (sums.has(emitter)) sums.set(emitter, sums.get(emitter)!.add(emitterCurrent));
    if (powerAbsorbed && powerDelivered) {
      if (transistor.power.isPositive()) powerAbsorbed = powerAbsorbed.add(transistor.power);
      else powerDelivered = powerDelivered.sub(transistor.power);
    }
  }

  return {
    type: 'verification',
    nodeCurrents: [...sums]
      .filter(([node]) => !incomplete.has(node))
      .map(([node, sum]) => ({ node, sum })),
    powerAbsorbed,
    powerDelivered,
    elementIds: [],
  };
}

export function solveWithSteps(circuit: Circuit): Solution {
  const analysis = analyze(circuit);
  if (analysis.status === 'invalid') return { status: 'invalid', issues: analysis.issues };

  const { netlist } = analysis;
  const { redundantIds } = findVoltageSourceLoops(netlist);
  if ((netlist.bjts?.length ?? 0) > 0 && analysis.transistorStates) {
    const states = new Map(analysis.transistorStates.map(({ transistorId, state }) => [transistorId, state]));
    const mna = buildMnaSystem(netlist, redundantIds, states);
    const steps: SolutionStep[] = [];
    if (analysis.diodeStates) {
      steps.push({ type: 'diode-states', diodes: analysis.diodeStates, elementIds: analysis.diodeStates.map(({ diodeId }) => diodeId) });
    }
    steps.push(
      { type: 'transistor-states', transistors: analysis.transistorStates, elementIds: analysis.transistorStates.map(({ transistorId }) => transistorId) },
      { type: 'nodes', nodes: netlist.nodeIds, elementIds: [] },
      { type: 'reference', elementIds: circuit.elements.flatMap((element) => element.kind === 'ground' ? [element.id] : []) },
    );
    const loopData = analyzeBjtLoops(analysis, redundantIds);
    if (loopData) {
      const knownGroup = knownVoltageGroup(netlist, redundantIds);
      if (knownGroup) {
        steps.push({
          type: 'known-voltages',
          relations: knownGroup.relations,
          values: knownGroup.nodes.map((node) => ({ node, voltage: analysis.nodeVoltages.get(node)! })),
          elementIds: knownGroup.relations.map(({ sourceId }) => sourceId),
        });
      }
      for (const transistor of loopData) {
        if (transistor.thevenin) steps.push({ type: 'bjt-thevenin', ...transistor.thevenin });
        steps.push(
          { type: 'bjt-input-loop', ...transistor.input },
          { type: 'bjt-output-loop', ...transistor.output },
          { type: 'bjt-voltages', ...transistor.voltages },
        );
      }
    } else {
      steps.push({ type: 'transistor-equations', mna, elementIds: [] });
    }
    const values = [...netlist.nodeIds].filter((node) => node !== REFERENCE_NODE).map((node) => ({ node, voltage: analysis.nodeVoltages.get(node)! }));
    const nonlinearIds = new Set([...(analysis.diodeStates?.map(({ diodeId }) => diodeId) ?? []), ...analysis.transistorStates.map(({ transistorId }) => transistorId)]);
    const results = [
      ...[...netlist.components, ...netlist.opAmps].filter(({ element }) => !nonlinearIds.has(element.id)).map(({ element }) => ({ elementId: element.id, kind: element.kind, ...analysis.elements.get(element.id)! })),
      ...circuit.elements.filter((element): element is Diode | Zener => element.kind === 'diode' || element.kind === 'zener').map((element) => ({ elementId: element.id, kind: element.kind, ...analysis.elements.get(element.id)! })),
      ...(netlist.bjts ?? []).map(({ element }) => ({ elementId: element.id, kind: 'bjt' as const, ...analysis.elements.get(element.id)! })),
    ];
    steps.push(
      { type: 'node-voltages', values, elementIds: [] },
      { type: 'element-results', results, derivations: [], elementIds: results.map(({ elementId }) => elementId) },
      {
        type: 'transistor-currents',
        transistors: analysis.transistorStates.map(({ transistorId, polarity, state, beta }) => {
          const transistor = analysis.transistors!.get(transistorId)!;
          return { transistorId, polarity, state, beta, ...transistor, vce: transistor.vc.sub(transistor.ve) };
        }),
        elementIds: analysis.transistorStates.map(({ transistorId }) => transistorId),
      },
    );
    if (analysis.diodeStates) {
      steps.push({
        type: 'diode-check',
        checks: analysis.diodeStates.map(({ diodeId, state, threshold, zenerVoltage }) => {
          const result = analysis.elements.get(diodeId)!;
          const current = result.current ?? Fraction.ZERO;
          const voltage = result.voltage;
          const holds = state === 'on' ? current.num >= 0n : state === 'zener' ? current.num <= 0n :
            !voltage.sub(threshold).isPositive() && (zenerVoltage === null || !voltage.neg().sub(zenerVoltage).isPositive());
          return { diodeId, state, current, voltage, threshold, zenerVoltage, holds };
        }),
        elementIds: analysis.diodeStates.map(({ diodeId }) => diodeId),
      });
    }
    steps.push({
      type: 'transistor-check',
      checks: analysis.transistorStates.map(({ transistorId, polarity, state, beta }) => {
        const transistor = analysis.transistors!.get(transistorId)!;
        const vbe = polarity === 'npn' ? transistor.vb.sub(transistor.ve) : transistor.ve.sub(transistor.vb);
        const vce = polarity === 'npn' ? transistor.vc.sub(transistor.ve) : transistor.ve.sub(transistor.vc);
        const holds = state === 'active' ? transistor.ib.num >= 0n && vce.num >= 0n : state === 'saturation'
          ? transistor.ib.num >= 0n && transistor.ic.num >= 0n && !transistor.ic.sub(beta.mul(transistor.ib)).isPositive()
          : !vbe.sub(netlist.bjts!.find(({ element }) => element.id === transistorId)!.element.vbe).isPositive();
        return { transistorId, polarity, state, beta, ib: transistor.ib, ic: transistor.ic, vb: transistor.vb, vc: transistor.vc, ve: transistor.ve, holds };
      }),
      elementIds: analysis.transistorStates.map(({ transistorId }) => transistorId),
    });
    steps.push(verificationStep(analysis, circuit));
    return { status: 'solved', issues: analysis.issues, analysis, steps, mna };
  }
  const nodal = solveNodal(netlist, redundantIds);
  if (!nodal) {
    const singular: Issue = { severity: 'error', code: 'singular-system', elementIds: [], wireIds: [] };
    return { status: 'invalid', issues: [singular] };
  }

  const value = (node: NodeId): NodeValue => ({ node, voltage: nodal.nodeVoltages.get(node)! });
  const groundIds = circuit.elements.flatMap((element) => (element.kind === 'ground' ? [element.id] : []));

  const steps: SolutionStep[] = [];
  if (analysis.diodeStates) {
    steps.push({
      type: 'diode-states',
      diodes: analysis.diodeStates,
      elementIds: analysis.diodeStates.map(({ diodeId }) => diodeId),
    });
  }
  steps.push(
    { type: 'nodes', nodes: netlist.nodeIds, elementIds: [] },
    { type: 'reference', elementIds: groundIds },
  );

  if (nodal.knownGroup) {
    const { relations, nodes } = nodal.knownGroup;
    steps.push({
      type: 'known-voltages',
      relations,
      values: nodes.map(value),
      elementIds: relations.map((relation) => relation.sourceId),
    });
  }

  for (const group of nodal.supernodes) {
    steps.push({
      type: 'supernode',
      nodes: group.nodes,
      representative: group.representative!,
      relations: group.relations,
      expressions: group.nodes.map((node) => ({ node, expression: nodal.expressions.get(node)! })),
      elementIds: group.relations.map((relation) => relation.sourceId),
    });
  }

  if (netlist.opAmps.length > 0) {
    steps.push({
      type: 'op-amp',
      opAmps: netlist.opAmps.map(({ element, inverting, nonInverting, output }) => {
        const inputs = nodal.expressions.get(inverting)!;
        return {
          elementId: element.id,
          inverting,
          nonInverting,
          output,
          inputs,
          virtualGround: inputs.unknown === null && inputs.offset.isZero(),
        };
      }),
      elementIds: netlist.opAmps.map(({ element }) => element.id),
    });
  }

  const solvedValues = new Map<NodeId, Fraction>();
  const remainingEquations = [...nodal.equations];
  while (remainingEquations.length > 0) {
    const candidates = remainingEquations.map((equation) => ({
      equation,
      reduced: reducedEquation(equation, nodal.unknowns, solvedValues),
    }));
    const candidateIndex = candidates.findIndex(({ reduced }) =>
      reduced.coefficients.filter((coefficient) => !coefficient.isZero()).length === 1,
    );

    if (candidateIndex < 0) {
      const unresolved = nodal.unknowns.filter((unknown) => !solvedValues.has(unknown));
      const rows = candidates.map(({ equation, reduced }) => {
        steps.push(kclStep(
          equation,
          substitutedExpressions(nodal.expressions, solvedValues),
          nodal.nodeVoltages,
          reduced.unknowns,
          reduced.coefficients,
          reduced.rhs,
          null,
        ));
        return unresolved.map((unknown) => {
          const index = reduced.unknowns.indexOf(unknown);
          return index < 0 ? Fraction.ZERO : reduced.coefficients[index]!;
        });
      });
      if (unresolved.length > 0) {
        steps.push({
          type: 'system',
          unknowns: unresolved,
          matrix: rows,
          rhs: candidates.map(({ reduced }) => reduced.rhs),
          elementIds: [],
        });
      }
      break;
    }

    const { equation, reduced } = candidates[candidateIndex]!;
    const remainingIndex = remainingEquations.indexOf(equation);
    remainingEquations.splice(remainingIndex, 1);
    const coefficientIndex = reduced.coefficients.findIndex((coefficient) => !coefficient.isZero());
    const solvedUnknown = reduced.unknowns[coefficientIndex]!;
    const solvedValue = nodal.nodeVoltages.get(solvedUnknown)!;
    let stepUnknown = solvedUnknown;
    let equals: NodeId | null = null;
    let expressions = substitutedExpressions(nodal.expressions, solvedValues);

    if (equation.nodes.length === 1) {
      const node = equation.nodes[0]!;
      const expression = expressions.get(node)!;
      if (expression.unknown === solvedUnknown && expression.offset.isZero() && solvedUnknown !== node) {
        stepUnknown = node;
        equals = solvedUnknown;
        expressions = new Map([...expressions].map(([currentNode, current]) => [
          currentNode,
          current.unknown === solvedUnknown ? { ...current, unknown: node } : current,
        ]));
      }
    }

    steps.push(kclStep(
      equation,
      expressions,
      nodal.nodeVoltages,
      [stepUnknown],
      [reduced.coefficients[coefficientIndex]!],
      reduced.rhs,
      { node: stepUnknown, value: nodal.nodeVoltages.get(stepUnknown)!, equals },
    ));
    solvedValues.set(solvedUnknown, solvedValue);
  }

  const diodeIds = new Set(analysis.diodeStates?.map(({ diodeId }) => diodeId) ?? []);
  const results = [
    ...[...netlist.components, ...netlist.opAmps]
      .filter(({ element }) => !diodeIds.has(element.id))
      .map(({ element }) => ({
        elementId: element.id,
        kind: element.kind,
        ...analysis.elements.get(element.id)!,
      })),
    ...(circuit.elements.filter((element): element is Diode | Zener => element.kind === 'diode' || element.kind === 'zener').map((element) => ({
      elementId: element.id,
      kind: element.kind,
      ...analysis.elements.get(element.id)!,
    }))),
  ];
  const derivations = elementDerivations(circuit, analysis, results);
  steps.push(
    {
      type: 'node-voltages',
      values: netlist.nodeIds.filter((node) => node !== REFERENCE_NODE).map(value),
      elementIds: [],
    },
    {
      type: 'element-results',
      results,
      derivations,
      elementIds: results.map(({ elementId }) => elementId),
    },
  );
  if (analysis.diodeStates) {
    steps.push({
      type: 'diode-check',
      checks: analysis.diodeStates.map(({ diodeId, state, threshold, zenerVoltage }) => {
        const result = analysis.elements.get(diodeId)!;
        const current = result.current ?? Fraction.ZERO;
        const voltage = result.voltage;
        return {
          diodeId,
          state,
          current,
          voltage,
          threshold,
          zenerVoltage,
          holds: state === 'on' ? current.num >= 0n : state === 'zener' ? current.num <= 0n :
            !voltage.sub(threshold).isPositive() && (zenerVoltage === null || !voltage.neg().sub(zenerVoltage).isPositive()),
        };
      }),
      elementIds: analysis.diodeStates.map(({ diodeId }) => diodeId),
    });
  }
  steps.push(verificationStep(analysis, circuit));

  return {
    status: 'solved',
    issues: analysis.issues,
    analysis,
    steps,
    mna: buildMnaSystem(netlist, redundantIds),
  };
}
