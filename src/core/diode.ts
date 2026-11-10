import type { AnalysisResult } from './analyze';
import type { Bjt, BjtRegion, Circuit, Diode, ElementId, Zener } from './circuit';
import { Fraction } from './fraction';
import { voltageSource } from './circuit';
import { buildNetlist, REFERENCE_NODE, type Netlist } from './netlist';
import type { Issue } from './validate';

export type DiodeState = 'on' | 'off' | 'zener';

export interface DiodeStateResult {
  readonly diodeId: ElementId;
  readonly openVoltage: Fraction | null;
  readonly divider: {
    readonly sourceId: ElementId;
    readonly sourceVoltage: Fraction;
    readonly upperId: ElementId;
    readonly upperResistance: Fraction;
    readonly lowerId: ElementId;
    readonly lowerResistance: Fraction;
    readonly sign: 1 | -1;
  } | null;
  readonly threshold: Fraction;
  readonly zenerVoltage: Fraction | null;
  readonly guess: DiodeState;
  readonly state: DiodeState;
}

type Rectifier = Diode | Zener;
export interface TransistorStateResult {
  readonly transistorId: ElementId;
  readonly polarity: Bjt['polarity'];
  readonly beta: Fraction;
  readonly guess: BjtRegion;
  readonly state: BjtRegion;
}
type AnalyzeEquivalent = (circuit: Circuit, states: ReadonlyMap<ElementId, BjtRegion>) => AnalysisResult;

function diodeCircuit(
  circuit: Circuit,
  rectifiers: readonly Rectifier[],
  states: ReadonlyMap<ElementId, DiodeState>,
): Circuit {
  const nodes = new Map((buildNetlist(circuit).diodes ?? []).map(({ element, a, b }) => [element.id, { a, b }]));
  const groups = new Map<string, Rectifier[]>();
  for (const element of rectifiers) {
    const state = states.get(element.id);
    if (state === 'off') continue;
    const pair = nodes.get(element.id);
    if (!pair) continue;
    const forward = state === 'on';
    const plus = forward ? pair.a : pair.b;
    const minus = forward ? pair.b : pair.a;
    const voltage = forward ? element.threshold : element.kind === 'zener' ? element.zenerVoltage : null;
    const key = `${plus}:${minus}:${state}:${voltage?.toString() ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), element]);
  }
  const representative = new Map<ElementId, ElementId>();
  for (const group of groups.values()) group.forEach(({ id }) => representative.set(id, group[0]!.id));

  return {
    elements: circuit.elements.flatMap((element) => {
      if (element.kind !== 'diode' && element.kind !== 'zener') return [element];
      if (representative.get(element.id) !== element.id) return [];
      const state = states.get(element.id);
      if (state === 'on') return [voltageSource(element.id, element.anode, element.cathode, element.threshold)];
      if (state === 'zener' && element.kind === 'zener') {
        return [voltageSource(element.id, element.cathode, element.anode, element.zenerVoltage)];
      }
      return [];
    }),
  };
}

function parallelGroups(
  circuit: Circuit,
  rectifiers: readonly Rectifier[],
  states: ReadonlyMap<ElementId, DiodeState>,
): Rectifier[][] {
  const netDiodes = new Map((buildNetlist(circuit).diodes ?? []).map(({ element, a, b }) => [element.id, { a, b }]));
  const groups = new Map<string, Rectifier[]>();
  for (const element of rectifiers) {
    const state = states.get(element.id);
    if (state === 'off') continue;
    const nodes = netDiodes.get(element.id);
    if (!nodes) continue;
    const forward = state === 'on';
    const plus = forward ? nodes.a : nodes.b;
    const minus = forward ? nodes.b : nodes.a;
    const voltage = forward ? element.threshold : element.kind === 'zener' ? element.zenerVoltage : null;
    const key = `${plus}:${minus}:${state}:${voltage?.toString() ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), element]);
  }
  return [...groups.values()];
}

function voltageAtPoint(analysis: Extract<AnalysisResult, { status: 'solved' }>, point: string): Fraction | undefined {
  const node = analysis.netlist.pointToNode.get(point);
  return node === undefined ? undefined : analysis.nodeVoltages.get(node);
}

function openVoltages(rectifiers: readonly Rectifier[], analysis: Extract<AnalysisResult, { status: 'solved' }>): (Fraction | null)[] {
  return rectifiers.map((element) => {
    const anode = voltageAtPoint(analysis, element.anode);
    const cathode = voltageAtPoint(analysis, element.cathode);
    return anode === undefined || cathode === undefined ? null : anode.sub(cathode);
  });
}

function dividerFor(
  element: Rectifier,
  openVoltage: Fraction | null,
  netlist: Netlist,
): DiodeStateResult['divider'] {
  if (openVoltage === null || !netlist.hasReference) return null;
  const anode = netlist.pointToNode.get(element.anode);
  const cathode = netlist.pointToNode.get(element.cathode);
  if (anode === undefined || cathode === undefined || anode === cathode) return null;

  const dividerNode = anode === REFERENCE_NODE ? cathode : cathode === REFERENCE_NODE ? anode : null;
  if (dividerNode === null) return null;

  const connected = netlist.components.filter(({ a, b }) => a === dividerNode || b === dividerNode);
  if (connected.length !== 2 || connected.some(({ element: attached }) => attached.kind !== 'resistor')) return null;
  if (netlist.opAmps.some(({ inverting, nonInverting, output }) => [inverting, nonInverting, output].includes(dividerNode))) return null;
  if (netlist.bjts?.some(({ base, collector, emitter }) => [base, collector, emitter].includes(dividerNode))) return null;

  const resistors = connected.flatMap(({ element: attached, a, b }) => attached.kind === 'resistor'
    ? [{ element: attached, other: a === dividerNode ? b : a }]
    : []);
  const lower = resistors.find(({ other }) => other === REFERENCE_NODE);
  const upper = resistors.find(({ other }) => other !== REFERENCE_NODE);
  if (!lower || !upper || lower === upper || upper.other === dividerNode) return null;

  const sourceConnections = netlist.components.filter(({ element: attached, a, b }) =>
    attached.kind === 'voltage-source' && ((a === upper.other && b === REFERENCE_NODE) || (b === upper.other && a === REFERENCE_NODE)),
  );
  if (sourceConnections.length !== 1) return null;
  const sourceConnection = sourceConnections[0]!;
  if (sourceConnection.element.kind !== 'voltage-source' || sourceConnection.a !== upper.other || sourceConnection.b !== REFERENCE_NODE) return null;

  const sourceVoltage = sourceConnection.element.voltage;
  const upperResistance = upper.element.resistance;
  const lowerResistance = lower.element.resistance;
  const dividerVoltage = sourceVoltage.mul(lowerResistance).div(upperResistance.add(lowerResistance));
  const positiveNode = element.kind === 'zener' ? cathode : anode;
  const sign: 1 | -1 = positiveNode === dividerNode ? 1 : -1;
  const measuredOpenVoltage = element.kind === 'zener' ? openVoltage.neg() : openVoltage;
  if (!dividerVoltage.mul(Fraction.from(sign)).equals(measuredOpenVoltage)) return null;

  return {
    sourceId: sourceConnection.element.id,
    sourceVoltage,
    upperId: upper.element.id,
    upperResistance,
    lowerId: lower.element.id,
    lowerResistance,
    sign,
  };
}

/** A plain diode has no Zener region, so trying it there would only triple the search for nothing. */
type NonlinearDevice = { readonly kind: 'rectifier'; readonly element: Rectifier } | { readonly kind: 'bjt'; readonly element: Bjt };
type OperatingState = DiodeState | BjtRegion;

function assignmentsNear(devices: readonly NonlinearDevice[], guess: readonly OperatingState[]): OperatingState[][] {
  const statesOf = (index: number): readonly OperatingState[] =>
    devices[index]!.kind === 'bjt'
      ? ['active', 'saturation', 'cutoff']
      : devices[index]!.element.kind === 'zener' ? ['on', 'off', 'zener'] : ['on', 'off'];
  const values: OperatingState[][] = [guess.slice()];
  const visit = (distance: number, start: number, current: OperatingState[]): void => {
    if (current.filter((state, index) => state !== guess[index]).length === distance) {
      values.push(current);
      return;
    }
    const changed = current.filter((state, index) => state !== guess[index]).length;
    if (changed >= distance) return;
    for (let index = start; index < guess.length; index++) {
      if (current[index] !== guess[index]) continue;
      for (const state of statesOf(index)) {
        if (state === guess[index]) continue;
        const next = current.slice();
        next[index] = state;
        visit(distance, index + 1, next);
      }
    }
  };
  for (let distance = 1; distance <= guess.length; distance++) visit(distance, 0, guess.slice());
  return values;
}

function statesMap(rectifiers: readonly Rectifier[], states: readonly DiodeState[]): Map<ElementId, DiodeState> {
  return new Map(rectifiers.map(({ id }, index) => [id, states[index]!]));
}

function sharedCurrents(
  circuit: Circuit,
  rectifiers: readonly Rectifier[],
  states: readonly DiodeState[],
  analysis: Extract<AnalysisResult, { status: 'solved' }>,
): Map<ElementId, Fraction | null> {
  const stateById = statesMap(rectifiers, states);
  const currents = new Map<ElementId, Fraction | null>(rectifiers.map(({ id }) => [id, Fraction.ZERO]));
  for (const group of parallelGroups(circuit, rectifiers, stateById)) {
    const total = analysis.elements.get(group[0]!.id)?.current ?? null;
    const share = total === null ? null : total.div(Fraction.from(group.length));
    const signedShare = stateById.get(group[0]!.id) === 'zener' ? share?.neg() ?? null : share;
    group.forEach(({ id }) => currents.set(id, signedShare));
  }
  return currents;
}

function holdsRectifiers(
  rectifiers: readonly Rectifier[],
  states: readonly DiodeState[],
  analysis: Extract<AnalysisResult, { status: 'solved' }>,
  currents: ReadonlyMap<ElementId, Fraction | null>,
): boolean {
  return rectifiers.every((element, index) => {
    const state = states[index]!;
    const current = currents.get(element.id);
    if (state === 'on') return current !== null && current !== undefined && current.num >= 0n;
    if (state === 'zener') return current !== null && current !== undefined && current.num <= 0n;
    const anode = voltageAtPoint(analysis, element.anode);
    const cathode = voltageAtPoint(analysis, element.cathode);
    if (anode === undefined || cathode === undefined) return false;
    const forwardVoltage = anode.sub(cathode);
    return !forwardVoltage.sub(element.threshold).isPositive() &&
      (element.kind !== 'zener' || !cathode.sub(anode).sub(element.zenerVoltage).isPositive());
  });
}

/** Solves all diode, Zener and transistor regions together, closest assumption first. */
export function resolveNonlinear(circuit: Circuit, analyzeEquivalent: AnalyzeEquivalent): NonlinearResolution {
  const rectifiers = circuit.elements.filter((element): element is Rectifier => element.kind === 'diode' || element.kind === 'zener');
  const bjts = circuit.elements.filter((element): element is Bjt => element.kind === 'bjt');
  const devices: NonlinearDevice[] = [];
  for (const element of circuit.elements) {
    if (element.kind === 'diode' || element.kind === 'zener') devices.push({ kind: 'rectifier', element });
    else if (element.kind === 'bjt') devices.push({ kind: 'bjt', element });
  }
  // The open-circuit estimate only guesses the diodes. Transistors stay active in it, as on paper,
  // unless the active model can't be solved at all (a base tied straight to a source, an open
  // collector): then it is taken with the transistors cut off, and without diodes it isn't needed.
  const openWith = (region: BjtRegion) =>
    analyzeEquivalent(diodeCircuit(circuit, rectifiers, new Map()), new Map(bjts.map(({ id }) => [id, region])));
  let openAnalysis = openWith('active');
  if (openAnalysis.status !== 'solved' && bjts.length > 0) openAnalysis = openWith('cutoff');
  if (openAnalysis.status !== 'solved' && (bjts.length === 0 || rectifiers.length > 0)) {
    return { status: 'invalid', issues: [{ severity: 'error', code: 'diode-no-solution', elementIds: devices.map(({ element }) => element.id), wireIds: [] }] };
  }
  const voltages = openAnalysis.status === 'solved' ? openVoltages(rectifiers, openAnalysis) : [];
  let diodeIndex = 0;
  const guesses: OperatingState[] = devices.map(({ kind, element }): OperatingState => {
    if (kind === 'bjt') return 'active';
    const voltage = voltages[diodeIndex++]!;
    if (element.kind === 'diode') return voltage === null || voltage.sub(element.threshold).isPositive() ? 'on' : 'off';
    if (voltage === null || voltage.neg().equals(element.zenerVoltage) || voltage.neg().sub(element.zenerVoltage).isPositive()) return 'zener';
    return voltage.sub(element.threshold).isPositive() ? 'on' : 'off';
  });

  for (const candidate of assignmentsNear(devices, guesses)) {
    const rectifierStates = new Map<ElementId, DiodeState>();
    const transistorStates = new Map<ElementId, BjtRegion>();
    devices.forEach(({ kind, element }, index) => {
      if (kind === 'rectifier') rectifierStates.set(element.id, candidate[index] as DiodeState);
      else transistorStates.set(element.id, candidate[index] as BjtRegion);
    });
    const analysis = analyzeEquivalent(diodeCircuit(circuit, rectifiers, rectifierStates), transistorStates);
    if (analysis.status !== 'solved') continue;
    const rectifierCandidate = rectifiers.map(({ id }) => rectifierStates.get(id)!);
    const bjtCandidate = bjts.map(({ id }) => transistorStates.get(id)!);
    const currents = sharedCurrents(circuit, rectifiers, rectifierCandidate, analysis);
    if (!holdsRectifiers(rectifiers, rectifierCandidate, analysis, currents)) continue;
    if (!holdsTransistors(bjts, bjtCandidate, analysis)) continue;
    let guessIndex = 0;
    return {
      status: 'solved',
      analysis,
      diodeCurrents: currents,
      diodes: rectifiers.map((element, index) => ({
        diodeId: element.id,
        openVoltage: voltages[index]!,
        divider: openAnalysis.status === 'solved' ? dividerFor(element, voltages[index]!, openAnalysis.netlist) : null,
        threshold: element.threshold,
        zenerVoltage: element.kind === 'zener' ? element.zenerVoltage : null,
        guess: guesses[devices.findIndex((device) => device.element.id === element.id)] as DiodeState,
        state: rectifierCandidate[index]!,
      })),
      transistors: bjts.map((element) => {
        const position = devices.findIndex((device) => device.element.id === element.id);
        return { transistorId: element.id, polarity: element.polarity, beta: element.beta, guess: guesses[position] as BjtRegion, state: bjtCandidate[guessIndex++]! };
      }),
    };
  }
  return { status: 'invalid', issues: [{ severity: 'error', code: 'diode-no-solution', elementIds: devices.map(({ element }) => element.id), wireIds: [] }] };
}

function holdsTransistors(
  bjts: readonly Bjt[],
  states: readonly BjtRegion[],
  analysis: Extract<AnalysisResult, { status: 'solved' }>,
): boolean {
  return bjts.every((bjt, index) => {
    const state = states[index]!;
    const result = analysis.transistors?.get(bjt.id);
    if (!result) return false;
    const vce = bjt.polarity === 'npn' ? result.vc.sub(result.ve) : result.ve.sub(result.vc);
    if (state === 'active') return !result.ib.num || result.ib.num > 0n ? !vce.num || vce.num > 0n : false;
    if (state === 'saturation') return result.ib.num >= 0n && result.ic.num >= 0n && !result.ic.sub(bjt.beta.mul(result.ib)).isPositive();
    const vbe = bjt.polarity === 'npn' ? result.vb.sub(result.ve) : result.ve.sub(result.vb);
    return !vbe.sub(bjt.vbe).isPositive();
  });
}

export type NonlinearResolution =
  | { readonly status: 'solved'; readonly analysis: Extract<AnalysisResult, { status: 'solved' }>; readonly diodes: readonly DiodeStateResult[]; readonly diodeCurrents: ReadonlyMap<ElementId, Fraction | null>; readonly transistors: readonly TransistorStateResult[] }
  | { readonly status: 'invalid'; readonly issues: readonly Issue[] };
