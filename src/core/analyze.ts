import type { BjtRegion, Circuit, Component, Diode, ElementId, PointId, Zener } from './circuit';
import { resolveNonlinear, type DiodeStateResult, type TransistorStateResult } from './diode';
import { Fraction } from './fraction';
import { solveMna } from './mna';
import { buildNetlist, type NetComponent, type Netlist, type NodeId } from './netlist';
import { findVoltageSourceLoops, validate, type Issue } from './validate';

/**
 * Values use the passive sign convention, from the first terminal to the second
 * (resistor a → b, voltage source plus → minus, current source from → to, op-amp output → ground).
 * Positive power is absorbed; negative power is delivered.
 */
export interface ElementResult {
  readonly voltage: Fraction;
  /** Null when the circuit does not determine this current (voltage sources in a loop). */
  readonly current: Fraction | null;
  readonly power: Fraction | null;
}

export interface TransistorResult {
  readonly ib: Fraction;
  readonly ic: Fraction;
  readonly ie: Fraction;
  readonly vb: Fraction;
  readonly vc: Fraction;
  readonly ve: Fraction;
  readonly power: Fraction;
}

export type AnalysisResult =
  | {
      readonly status: 'solved';
      readonly netlist: Netlist;
      readonly issues: readonly Issue[];
      readonly nodeVoltages: ReadonlyMap<NodeId, Fraction>;
      readonly elements: ReadonlyMap<ElementId, ElementResult>;
      readonly diodeStates?: readonly DiodeStateResult[];
      readonly transistorStates?: readonly TransistorStateResult[];
      readonly transistors?: ReadonlyMap<ElementId, TransistorResult>;
    }
  | {
      readonly status: 'invalid';
      readonly netlist: Netlist;
      readonly issues: readonly Issue[];
    };

function currentThrough(
  element: Component,
  voltage: Fraction,
  sourceCurrents: ReadonlyMap<ElementId, Fraction>,
): Fraction | null {
  switch (element.kind) {
    case 'resistor':
      return voltage.div(element.resistance);
    case 'current-source':
      return element.current;
    case 'voltage-source':
      return sourceCurrents.get(element.id) ?? null;
  }
}

function elementResult(
  { element, a, b }: NetComponent,
  nodeVoltages: ReadonlyMap<NodeId, Fraction>,
  sourceCurrents: ReadonlyMap<ElementId, Fraction>,
  indeterminateIds: ReadonlySet<ElementId>,
): ElementResult {
  const voltage = nodeVoltages.get(a)!.sub(nodeVoltages.get(b)!);
  const current = indeterminateIds.has(element.id) ? null : currentThrough(element, voltage, sourceCurrents);
  return { voltage, current, power: current && voltage.mul(current) };
}

function analyzeLinear(circuit: Circuit, transistorStates: ReadonlyMap<ElementId, BjtRegion> = new Map()): AnalysisResult {
  const netlist = buildNetlist(circuit);
  const issues = validate(circuit, netlist);
  if (issues.some((issue) => issue.severity === 'error')) {
    return { status: 'invalid', netlist, issues };
  }

  const { redundantIds, indeterminateIds } = findVoltageSourceLoops(netlist);
  const solution = solveMna(netlist, redundantIds, transistorStates);
  if (!solution) {
    const singular: Issue = { severity: 'error', code: 'singular-system', elementIds: [], wireIds: [] };
    return { status: 'invalid', netlist, issues: [singular] };
  }

  const elements = new Map<ElementId, ElementResult>();
  for (const component of netlist.components) {
    elements.set(
      component.element.id,
      elementResult(component, solution.nodeVoltages, solution.sourceCurrents, indeterminateIds),
    );
  }

  // Seen from the circuit an op-amp is an element from its output to ground: it can deliver power.
  const saturated: ElementId[] = [];
  for (const { element, output } of netlist.opAmps) {
    const voltage = solution.nodeVoltages.get(output)!;
    const current = solution.opAmpCurrents.get(element.id)!.neg();
    elements.set(element.id, { voltage, current, power: voltage.mul(current) });
    const magnitude = voltage.num < 0n ? voltage.neg() : voltage;
    if (magnitude.sub(element.supply).isPositive()) saturated.push(element.id);
  }

  const transistors = new Map<ElementId, TransistorResult>();
  for (const { element, base, collector, emitter } of netlist.bjts ?? []) {
    const state = transistorStates.get(element.id) ?? 'cutoff';
    const ib = state === 'cutoff' ? Fraction.ZERO : solution.baseCurrents.get(element.id) ?? Fraction.ZERO;
    const ic = state === 'active'
      ? element.beta.mul(ib)
      : state === 'saturation' ? solution.collectorCurrents.get(element.id) ?? Fraction.ZERO : Fraction.ZERO;
    const vb = solution.nodeVoltages.get(base)!;
    const vc = solution.nodeVoltages.get(collector)!;
    const ve = solution.nodeVoltages.get(emitter)!;
    const ie = ib.add(ic);
    const power = element.polarity === 'npn'
      ? vb.sub(ve).mul(ib).add(vc.sub(ve).mul(ic))
      : ve.sub(vb).mul(ib).add(ve.sub(vc).mul(ic));
    transistors.set(element.id, { ib, ic, ie, vb, vc, ve, power });
    elements.set(element.id, {
      voltage: vc.sub(ve),
      current: element.polarity === 'npn' ? ic : ic.neg(),
      power,
    });
  }

  const saturationWarning: Issue[] =
    saturated.length > 0
      ? [{ severity: 'warning', code: 'op-amp-saturated', elementIds: saturated, wireIds: [] }]
      : [];

  return {
    status: 'solved',
    netlist,
    issues: [...issues, ...saturationWarning],
    nodeVoltages: solution.nodeVoltages,
    elements,
    ...(transistors.size > 0 ? { transistors } : {}),
  };
}

export function analyze(circuit: Circuit): AnalysisResult {
  const rectifiers = circuit.elements.filter((element): element is Diode | Zener => element.kind === 'diode' || element.kind === 'zener');
  const bjts = circuit.elements.filter((element) => element.kind === 'bjt');
  if (rectifiers.length === 0 && bjts.length === 0) return analyzeLinear(circuit);
  const nonlinear = circuit.elements.filter((element) => element.kind === 'diode' || element.kind === 'zener' || element.kind === 'bjt');

  const netlist = buildNetlist(circuit);
  if (nonlinear.length > 10) {
    return {
      status: 'invalid',
      netlist,
      issues: [{ severity: 'error', code: 'too-many-diodes', elementIds: nonlinear.map(({ id }) => id), wireIds: [] }],
    };
  }
  const issues = validate(circuit, netlist);
  if (issues.some((issue) => issue.severity === 'error')) return { status: 'invalid', netlist, issues };

  const resolved = resolveNonlinear(circuit, (equivalent, states) => analyzeLinear(equivalent, states));
  if (resolved.status === 'invalid') return { status: 'invalid', netlist, issues: resolved.issues };

  const elements = new Map(resolved.analysis.elements);
  for (const element of rectifiers) {
    const anodeNode = resolved.analysis.netlist.pointToNode.get(element.anode);
    const cathodeNode = resolved.analysis.netlist.pointToNode.get(element.cathode);
    const anodeVoltage = anodeNode === undefined ? undefined : resolved.analysis.nodeVoltages.get(anodeNode);
    const cathodeVoltage = cathodeNode === undefined ? undefined : resolved.analysis.nodeVoltages.get(cathodeNode);
    if (anodeVoltage === undefined || cathodeVoltage === undefined) {
      return {
        status: 'invalid',
        netlist,
        issues: [{ severity: 'error', code: 'diode-no-solution', elementIds: nonlinear.map(({ id }) => id), wireIds: [] }],
      };
    }
    const current = resolved.diodeCurrents.get(element.id) ?? null;
    const voltage = anodeVoltage.sub(cathodeVoltage);
    elements.set(element.id, { voltage, current, power: current === null ? null : voltage.mul(current) });
  }

  return {
    ...resolved.analysis,
    issues: [...issues, ...resolved.analysis.issues.filter((issue) => issue.code === 'op-amp-saturated')],
    elements,
    ...(resolved.diodes.length > 0 ? { diodeStates: resolved.diodes } : {}),
    ...(resolved.transistors.length > 0 ? { transistorStates: resolved.transistors } : {}),
  };
}

/** Voltage at a drawing point, or undefined if the point isn't part of a solved node. */
export function voltageAt(
  result: Extract<AnalysisResult, { status: 'solved' }>,
  point: PointId,
): Fraction | undefined {
  const node = result.netlist.pointToNode.get(point);
  return node === undefined ? undefined : result.nodeVoltages.get(node);
}
