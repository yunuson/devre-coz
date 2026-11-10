import {
  arrangeKcl,
  DEFAULT_DIODE_THRESHOLD,
  Fraction,
  REFERENCE_NODE,
  type ElementId,
  type KclConvention,
  type KclTerm,
  type MnaSystem,
  type NodeExpression,
  type NodeId,
  type SignedKclTerm,
  type SolutionStep,
} from '../../core';
import { tr } from '../../i18n/tr';
import { formatQuantity, nodeLetter, type Unit } from '../format';

/** Turns the structured steps into what a student reads: Turkish text and LaTeX equations. */

const POWER_TEN_DENOMINATOR_DIGITS = 3;

const decimalFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3, useGrouping: false });

/** A comma needs braces in LaTeX, or it adds a space after itself. */
const texDecimal = (text: string): string => text.replace(',', '{,}').replace('-', '-').replace('−', '-');

function isShortDecimal(value: Fraction): boolean {
  return 10n ** BigInt(POWER_TEN_DENOMINATOR_DIGITS) % value.den === 0n;
}

/** Whole numbers and short decimals as such (0,5), everything else as an exact fraction. */
export function fractionTex(value: Fraction): string {
  if (value.den === 1n) return value.num.toString();
  if (isShortDecimal(value)) return texDecimal(decimalFormat.format(value.toNumber()));
  const sign = value.num < 0n ? '-' : '';
  const magnitude = value.num < 0n ? -value.num : value.num;
  return `${sign}\\frac{${magnitude}}{${value.den}}`;
}

const inParens = (value: Fraction): string =>
  value.num < 0n ? `\\left(${fractionTex(value)}\\right)` : fractionTex(value);

/** The exact value and, when it isn't already short, a decimal to go with it. */
export function valueTex(value: Fraction, unit: string): string {
  const exact = fractionTex(value);
  const unitTex = `\\,\\text{${unit}}`;
  if (value.den === 1n || isShortDecimal(value)) return exact + unitTex;
  return `${exact} \\approx ${texDecimal(decimalFormat.format(value.toNumber()))}${unitTex}`;
}

export const nodeTex = (node: NodeId): string =>
  node === REFERENCE_NODE ? '0' : `V_{${nodeLetter(node)}}`;

const TEXT_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
};

const escapeForText = (text: string): string =>
  text.replace(/[\\{}$%&#_^~]/g, (character) => TEXT_ESCAPES[character] ?? `\\${character}`);

/** R1 becomes R₁ and Rf becomes R_f. Names are typed by the user, so anything else stays plain text. */
export function nameTex(label: string): string {
  const led = /^LED(\d*)$/.exec(label);
  if (led) return led[1] ? `\\mathrm{LED}_{\\mathrm{${led[1]}}}` : '\\mathrm{LED}';
  const match = /^([A-Za-z])([A-Za-z0-9]*)$/.exec(label);
  if (!match) return `\\text{${escapeForText(label)}}`;
  const [, letter = '', rest = ''] = match;
  return rest === '' ? letter : `${letter}_{\\mathrm{${rest}}}`;
}

export type LabelOf = (id: ElementId) => string;

/** A compact rounded quantity for the result of a hand calculation. */
export function quantityTex(value: Fraction, unit: Unit): string {
  return `\\text{${formatQuantity(value, unit)}}`;
}

function bjtVariable(letter: string, transistorId: ElementId, labelOf: LabelOf): string {
  const name = labelOf(transistorId);
  const index = /^Q(\d+)$/.exec(name)?.[1];
  const [symbol, subscript = ''] = letter.split('_');
  return index ? `${symbol}_{${subscript}${index}}` : `${symbol}_{${subscript},${nameTex(name)}}`;
}

function bjtVoltage(letter: string, transistorId: ElementId, labelOf: LabelOf): string {
  const name = labelOf(transistorId);
  const index = /^Q(\d+)$/.exec(name)?.[1];
  return `V_{${letter}${index ?? `,${nameTex(name)}`}}`;
}

function sideSource(side: Extract<SolutionStep, { type: 'bjt-input-loop' }>['base'], labelOf: LabelOf): string {
  if (side.node === null) return 'E_{TH}';
  if (side.voltage.isZero()) return '';
  return side.sourceId === null ? fractionTex(side.voltage) : nameTex(labelOf(side.sourceId));
}

function sideDrop(side: Extract<SolutionStep, { type: 'bjt-input-loop' }>['base'], current: string, labelOf: LabelOf): string | null {
  if (side.node === null) return `${current} R_{TH}`;
  return side.resistorId === null ? null : `${current} ${nameTex(labelOf(side.resistorId))}`;
}

function bjtLoopLaw(
  step: Extract<SolutionStep, { type: 'bjt-input-loop' }> | Extract<SolutionStep, { type: 'bjt-output-loop' }>,
  labelOf: LabelOf,
  substituteEmitter = false,
): string {
  const input = step.type === 'bjt-input-loop';
  const npn = step.polarity === 'npn';
  const firstSide = input ? (npn ? step.base : step.emitter) : (npn ? step.collector : step.emitter);
  const secondSide = input ? (npn ? step.emitter : step.base) : (npn ? step.emitter : step.collector);
  const firstCurrent = input ? (npn ? bjtVariable('I_B', step.transistorId, labelOf) : bjtVariable('I_E', step.transistorId, labelOf))
    : (npn ? bjtVariable('I_C', step.transistorId, labelOf) : bjtVariable('I_E', step.transistorId, labelOf));
  const secondCurrent = input ? (npn ? bjtVariable('I_E', step.transistorId, labelOf) : bjtVariable('I_B', step.transistorId, labelOf))
    : (npn ? bjtVariable('I_E', step.transistorId, labelOf) : bjtVariable('I_C', step.transistorId, labelOf));
  const junction = input
    ? bjtVoltage(npn ? 'BE' : 'EB', step.transistorId, labelOf)
    : bjtVoltage(npn ? 'CE' : 'EC', step.transistorId, labelOf);
  const firstSource = sideSource(firstSide, labelOf);
  const secondSource = sideSource(secondSide, labelOf);
  const emitterCurrent = input && substituteEmitter
    ? `(\\beta + 1) ${bjtVariable('I_B', step.transistorId, labelOf)}`
    : bjtVariable('I_E', step.transistorId, labelOf);
  const firstDrop = sideDrop(firstSide, input && substituteEmitter && firstSide === step.emitter ? emitterCurrent : firstCurrent, labelOf);
  const secondDrop = sideDrop(secondSide, input && substituteEmitter && secondSide === step.emitter ? emitterCurrent : secondCurrent, labelOf);
  const terms = [
    ...(firstSource ? [`-${firstSource}`] : []),
    ...(firstDrop ? [firstDrop] : []),
    junction,
    ...(secondDrop ? [secondDrop] : []),
    ...(secondSource ? [secondSource] : []),
  ];
  return `${terms.length ? terms.join(' + ').replaceAll('+ -', '- ') : '0'} = 0`;
}

type InputLoopStep = Extract<SolutionStep, { type: 'bjt-input-loop' }>;
type OutputLoopStep = Extract<SolutionStep, { type: 'bjt-output-loop' }>;

const bjtLoopContext = new Map<ElementId, { input?: InputLoopStep; output?: OutputLoopStep }>();

function knownSideVoltage(side: InputLoopStep['base'], labelOf: LabelOf): string {
  return sideSource(side, labelOf) || fractionTex(side.voltage);
}

function sideVoltageFromCurrent(
  side: InputLoopStep['base'],
  current: string,
  sign: '+' | '-',
  labelOf: LabelOf,
): string {
  if (side.resistorId === null) return knownSideVoltage(side, labelOf);
  const base = sideSource(side, labelOf);
  const drop = `${current} ${nameTex(labelOf(side.resistorId))}`;
  if (!base) return sign === '+' ? drop : `-${drop}`;
  return `${base} ${sign} ${drop}`;
}

function voltageDifferenceTex(terms: readonly { readonly value: Fraction; readonly sign: 1 | -1 }[]): string {
  return terms.flatMap(({ value, sign }, index) => {
    if (value.isZero()) return [];
    const rendered = value.num < 0n ? `\\left(${fractionTex(value)}\\right)` : fractionTex(value);
    if (index === 0) return [sign < 0 ? `-${rendered}` : fractionTex(value)];
    return [`${sign < 0 ? '-' : '+'} ${rendered}`];
  }).join(' ') || '0';
}

/** A resistor's current is I with the resistor's name below it. A current source is its own name. */
function currentNameTex(term: KclTerm, labelOf: LabelOf): string {
  const name = nameTex(labelOf(term.elementId));
  return term.kind === 'resistor' ? `I_{${name}}` : name;
}

const joinSigned = (terms: readonly SignedKclTerm[], texOf: (term: KclTerm) => string): string => {
  if (terms.length === 0) return '0';
  return terms
    .map(({ sign, term }, index) => {
      if (index === 0) return (sign === 1 ? '' : '-') + texOf(term);
      return `${sign === 1 ? '+' : '-'} ${texOf(term)}`;
    })
    .join(' ');
};

function equationTex(
  terms: readonly KclTerm[],
  convention: KclConvention,
  directions: readonly ('entering' | 'leaving')[],
  texOf: (term: KclTerm, direction: 'entering' | 'leaving') => string,
): string {
  const { left, right } = arrangeKcl(terms, convention, directions);
  const directionOf = (term: KclTerm): 'entering' | 'leaving' => directions[terms.indexOf(term)]!;
  const render = (term: KclTerm): string => texOf(term, directionOf(term));
  return `${joinSigned(left, render)} = ${joinSigned(right, render)}`;
}

function symbolicCurrent(term: KclTerm, direction: 'entering' | 'leaving', labelOf: LabelOf): string {
  const resistorName = nameTex(labelOf(term.elementId));
  if (term.kind !== 'resistor') return resistorName;
  const from = direction === 'entering' ? term.to : term.from;
  const to = direction === 'entering' ? term.from : term.to;
  const top = to === REFERENCE_NODE ? nodeTex(from) : `${nodeTex(from)} - ${nodeTex(to)}`;
  return `\\frac{${top}}{${resistorName}}`;
}

/** A node voltage as it stands now: a known number, an unknown, or an unknown plus a difference. */
function expressionTex({ unknown, offset }: NodeExpression): string {
  if (unknown === null) return fractionTex(offset);
  if (offset.isZero()) return nodeTex(unknown);
  const magnitude = offset.num < 0n ? offset.neg() : offset;
  return `${nodeTex(unknown)} ${offset.num < 0n ? '-' : '+'} ${fractionTex(magnitude)}`;
}

function numericCurrent(
  term: KclTerm,
  direction: 'entering' | 'leaving',
  expressions: ReadonlyMap<NodeId, NodeExpression>,
): string {
  if (term.kind !== 'resistor') return inParens(term.current);
  const fromNode = direction === 'entering' ? term.to : term.from;
  const toNode = direction === 'entering' ? term.from : term.to;
  const from = expressions.get(fromNode)!;
  const to = expressions.get(toNode)!;
  const isZero = to.unknown === null && to.offset.isZero();
  let subtracted = expressionTex(to);
  const needsParens = (to.unknown !== null && !to.offset.isZero()) || (to.unknown === null && to.offset.num < 0n);
  if (needsParens) subtracted = `\\left(${subtracted}\\right)`;
  const top = isZero ? expressionTex(from) : `${expressionTex(from)} - ${subtracted}`;
  return `\\frac{${top}}{${resistanceTex(term.resistance)}}`;
}

export function resistanceTex(value: Fraction): string {
  if (value.num >= 1_000_000n * value.den) {
    return `${fractionTex(value.div(Fraction.from(1_000_000)))}\\,\\text{M}`;
  }
  if (value.num >= 1_000n * value.den) {
    return `${fractionTex(value.div(Fraction.from(1_000)))}\\,\\text{k}`;
  }
  return fractionTex(value);
}

interface NormalizedEquation {
  readonly coefficients: readonly Fraction[];
  readonly rhs: Fraction;
}

function greatestCommonDivisor(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right !== 0n) [left, right] = [right, left % right];
  return left;
}

function normalizeEquation(coefficients: readonly Fraction[], rhs: Fraction): NormalizedEquation {
  const values = [...coefficients, rhs];
  const denominator = values.reduce(
    (multiple, value) => (multiple / greatestCommonDivisor(multiple, value.den)) * value.den,
    1n,
  );
  const integers = values.map((value) => value.num * (denominator / value.den));
  const divisor = integers.reduce((common, value) => greatestCommonDivisor(common, value), 0n) || 1n;
  const firstCoefficient = integers.slice(0, coefficients.length).find((value) => value !== 0n);
  const sign = firstCoefficient !== undefined && firstCoefficient < 0n ? -1n : 1n;
  const normalized = integers.map((value) => Fraction.from((value / divisor) * sign));
  return { coefficients: normalized.slice(0, coefficients.length), rhs: normalized[coefficients.length]! };
}

function simplifiedEquationTex(coefficients: readonly Fraction[], unknowns: readonly NodeId[], rhs: Fraction): string {
  const normalized = normalizeEquation(coefficients, rhs);
  return linearEquationTex(normalized.coefficients, unknowns, normalized.rhs);
}

function solvedEquationTex(
  coefficients: readonly Fraction[],
  unknowns: readonly NodeId[],
  rhs: Fraction,
  solves: Extract<SolutionStep, { type: 'kcl' }>['solves'],
): string {
  const normalized = normalizeEquation(coefficients, rhs);
  if (!solves) return linearEquationTex(normalized.coefficients, unknowns, normalized.rhs);

  const node = nodeTex(solves.node);
  const coefficient = normalized.coefficients[0]!;
  const result = coefficient.equals(1)
    ? `${node} = ${valueTex(solves.value, 'V')}`
    : `${linearEquationTex(normalized.coefficients, unknowns, normalized.rhs)} \\Rightarrow ${node} = ${valueTex(solves.value, 'V')}`;
  return solves.equals === null ? result : `${result},\\; ${nodeTex(solves.equals)} = ${node}`;
}

function linearEquationTex(
  coefficients: readonly Fraction[],
  unknowns: readonly NodeId[],
  rhs: Fraction,
): string {
  const parts: string[] = [];
  coefficients.forEach((coefficient, index) => {
    if (coefficient.isZero()) return;
    const magnitude = coefficient.num < 0n ? coefficient.neg() : coefficient;
    const number = magnitude.equals(1) ? '' : `${fractionTex(magnitude)}\\,`;
    const sign = coefficient.num < 0n ? '-' : parts.length > 0 ? '+' : '';
    parts.push(`${sign} ${number}${nodeTex(unknowns[index]!)}`.trim());
  });
  return `${parts.length > 0 ? parts.join(' ') : '0'} = ${fractionTex(rhs)}`;
}

const matrixTex = (rows: readonly (readonly string[])[]): string =>
  `\\begin{bmatrix} ${rows.map((row) => row.join(' & ')).join(' \\\\ ')} \\end{bmatrix}`;

function systemTex(
  matrix: readonly (readonly Fraction[])[],
  unknowns: readonly string[],
  rhs: readonly Fraction[],
): string {
  return (
    `${matrixTex(matrix.map((row) => row.map(fractionTex)))} ` +
    `${matrixTex(unknowns.map((unknown) => [unknown]))} = ` +
    `${matrixTex(rhs.map((value) => [fractionTex(value)]))}`
  );
}

function simplifiedSystemTex(
  matrix: readonly (readonly Fraction[])[],
  unknowns: readonly string[],
  rhs: readonly Fraction[],
): string {
  const rows = matrix.map((row, index) => normalizeEquation(row, rhs[index]!));
  return systemTex(
    rows.map(({ coefficients }) => coefficients),
    unknowns,
    rows.map(({ rhs: value }) => value),
  );
}

export function mnaTex(mna: MnaSystem, labelOf: LabelOf): string {
  const unknowns = mna.unknowns.map((unknown) => {
    if (unknown.kind === 'node-voltage') return nodeTex(unknown.node);
    if (unknown.kind === 'base-current' || unknown.kind === 'collector-current') {
      const name = labelOf(unknown.elementId);
      const index = /^Q(\d+)$/.exec(name)?.[1];
      const variable = unknown.kind === 'base-current' ? 'B' : 'C';
      return index ? `I_{${variable}${index}}` : `I_{${variable},${nameTex(name)}}`;
    }
    return `I_{${nameTex(labelOf(unknown.elementId))}}`;
  });
  return systemTex(mna.matrix, unknowns, mna.rhs);
}

export interface EquationLine {
  /** A short heading above the equation, such as "Yerine koy". */
  readonly caption?: string;
  readonly tex: string;
}

export interface ResultRow {
  readonly name: string;
  readonly voltage: string;
  readonly current: string;
  readonly power: string;
}

export interface AssumedCurrent {
  readonly elementId: ElementId;
  /** The node the arrow leaves from. Null means the element's own direction, for a source. */
  readonly fromNode: NodeId | null;
  readonly name: string;
}

export type StepViewType = SolutionStep['type'] | 'dc-equivalent';

export interface StepView {
  readonly type: StepViewType;
  readonly title: string;
  readonly why: string;
  readonly lines: readonly EquationLine[];
  readonly rows: readonly ResultRow[];
  /** Plain statements, such as what an element turns into. */
  readonly facts: readonly string[];
  readonly notes: readonly string[];
  readonly elementIds: readonly ElementId[];
  readonly nodes: readonly NodeId[];
  readonly assumedCurrents: readonly AssumedCurrent[];
}

const blank = {
  lines: [] as EquationLine[],
  rows: [] as ResultRow[],
  facts: [] as string[],
  notes: [] as string[],
  nodes: [] as NodeId[],
  assumedCurrents: [] as AssumedCurrent[],
};

const nodeListText = (nodes: readonly NodeId[]): string =>
  nodes.map((node) => `V${nodeLetter(node)}`).join(', ');

const positive = (value: Fraction): Fraction => (value.num < 0n ? value.neg() : value);

function kclView(step: Extract<SolutionStep, { type: 'kcl' }>, convention: KclConvention, labelOf: LabelOf): StepView {
  const text = tr.learn.kcl;
  const title = (step.nodes.length > 1 ? text.titleSuper : text.title).replace('{nodes}', nodeListText(step.nodes));
  const directions = step.terms.map((term, index) =>
    convention === 'leaving-sum' && term.kind === 'resistor' ? 'leaving' : step.directions[index]!,
  );
  const directionOf = (term: KclTerm): 'entering' | 'leaving' => directions[step.terms.indexOf(term)]!;
  const lawTex = (texOf: (term: KclTerm, direction: 'entering' | 'leaving') => string): string => {
    const { left, right } = arrangeKcl(step.terms, convention, directions);
    const render = (term: KclTerm): string => texOf(term, directionOf(term));
    const names = `${joinSigned(left, (term) => currentNameTex(term, labelOf))} = ${joinSigned(right, (term) => currentNameTex(term, labelOf))}`;
    const formulas = `${joinSigned(left, render)} = ${joinSigned(right, render)}`;
    return `${names} \\Rightarrow ${formulas}`;
  };
  const currentEquation = (texOf: (term: KclTerm, direction: 'entering' | 'leaving') => string): string =>
    equationTex(step.terms, convention, directions, texOf);
  const currentArrows = step.terms.map((term, index) => ({
    elementId: term.elementId,
    fromNode:
      term.kind !== 'resistor'
        ? null
        : convention === 'leaving-sum' || directions[index] === 'leaving'
          ? term.from
          : term.to,
    name: term.kind === 'resistor' ? `I${labelOf(term.elementId)}` : labelOf(term.elementId),
  }));

  return {
    ...blank,
    type: 'kcl',
    title,
    why: convention === 'entering-equals-leaving' ? text.whyEntering : text.whyLeaving,
    elementIds: step.elementIds,
    nodes: step.nodes,
    assumedCurrents: currentArrows,
    lines: [
      {
        caption: text.law,
        tex: lawTex((term, direction) => symbolicCurrent(term, direction, labelOf)),
      },
      {
        caption: text.numeric,
        tex: currentEquation((term, direction) => numericCurrent(term, direction, step.expressions)),
      },
      { caption: text.simplify, tex: solvedEquationTex(step.coefficients, step.unknowns, step.rhs, step.solves) },
    ],
  };
}

function elementRow(
  result: Extract<SolutionStep, { type: 'element-results' }>['results'][number],
  labelOf: LabelOf,
): ResultRow {
  const text = tr.learn.elements;
  let power: string = text.indeterminate;
  if (result.power) {
    const role = result.power.isZero() ? '' : ` ${result.power.isPositive() ? text.absorbs : text.delivers}`;
    power = `${formatQuantity(positive(result.power), 'W')}${role}`;
  }
  return {
    name: labelOf(result.elementId),
    voltage: formatQuantity(result.kind === 'op-amp' ? result.voltage : positive(result.voltage), 'V'),
    current: result.current ? formatQuantity(positive(result.current), 'A') : text.indeterminate,
    power,
  };
}

export function stepView(step: SolutionStep, convention: KclConvention, labelOf: LabelOf): StepView {
  const text = tr.learn;
  if (step.type === 'bjt-input-loop') bjtLoopContext.set(step.transistorId, { input: step });
  if (step.type === 'bjt-output-loop') {
    bjtLoopContext.set(step.transistorId, { ...bjtLoopContext.get(step.transistorId), output: step });
  }
  switch (step.type) {
    case 'diode-states':
      return {
        ...blank,
        type: step.type,
        title: text.diode.title,
        why: step.diodes.some(({ zenerVoltage }) => zenerVoltage !== null)
          ? `${text.diode.why} ${text.diode.zenerWhy}`
          : text.diode.why,
        elementIds: step.elementIds,
        lines: step.diodes.flatMap(({ diodeId, openVoltage, divider, threshold, zenerVoltage, guess }) => {
          if (openVoltage === null) return [];
          const lines: EquationLine[] = [];
          if (divider) {
            const sign = divider.sign < 0 ? '-' : '';
            const diodeVoltage = `V_{${nameTex(labelOf(diodeId))}}`;
            const sourceVoltage = divider.sourceVoltage.num < 0n ? inParens(divider.sourceVoltage) : fractionTex(divider.sourceVoltage);
            lines.push({
              caption: text.diode.open.replace('{name}', labelOf(diodeId)),
              tex: `${diodeVoltage} = ${sign}\\frac{${nameTex(labelOf(divider.lowerId))}}{${nameTex(labelOf(divider.upperId))} + ${nameTex(labelOf(divider.lowerId))}} \\cdot ${nameTex(labelOf(divider.sourceId))} = ${sign}\\frac{${resistanceTex(divider.lowerResistance)}}{${resistanceTex(divider.upperResistance)} + ${resistanceTex(divider.lowerResistance)}} \\cdot ${sourceVoltage}`,
            });
          }
          if (zenerVoltage === null) return [...lines, {
            tex: `V_{${nameTex(labelOf(diodeId))}} = ${valueTex(openVoltage, 'V')} ${openVoltage.sub(threshold).isPositive() ? '>' : '\\leq'} ${valueTex(threshold, 'V')}`,
          }];
          const cathodeVoltage = openVoltage.neg();
          const comparator = guess === 'zener' ? '\\geq' : guess === 'on' ? '\\leq' : '<';
          const bound = guess === 'on' ? threshold.neg() : zenerVoltage;
          return [...lines, { tex: `V_{${nameTex(labelOf(diodeId))}} = ${valueTex(cathodeVoltage, 'V')} ${comparator} ${valueTex(bound, 'V')}` }];
        }),
        facts: step.diodes.flatMap(({ diodeId, openVoltage, threshold, zenerVoltage, state }) => {
          const name = labelOf(diodeId);
          const facts = openVoltage === null && zenerVoltage !== null ? [text.zener.floating.replace('{name}', name)] :
            openVoltage === null ? [text.diode.floating.replace('{name}', name)] : [];
          const stateFact = zenerVoltage !== null
            ? state === 'zener'
              ? text.zener.on.replace('{name}', name).replace('{voltage}', formatQuantity(zenerVoltage, 'V'))
              : state === 'on'
                ? text.zener.forward.replace('{name}', name).replace('{threshold}', formatQuantity(threshold, 'V'))
                : text.zener.off.replace('{name}', name)
            : state === 'off'
              ? text.diode.off.replace('{name}', name)
              : (threshold.isZero() ? text.diode.short : text.diode.on)
                .replace('{name}', name)
                .replace('{threshold}', formatQuantity(threshold, 'V'));
          return [...facts, stateFact];
        }),
        notes: step.diodes.flatMap(({ diodeId, guess, state }) =>
          guess === state ? [] : [text.diode.revised.replace('{name}', labelOf(diodeId))],
        ),
      };
    case 'transistor-states': {
      const withIndex = (template: string, name: string): string => template.replaceAll('{name}', name).replaceAll('{i}', /^Q(\d+)$/.exec(name)?.[1] ?? '');
      return {
        ...blank,
        type: step.type,
        title: text.transistor.title,
        why: text.transistor.why,
        elementIds: step.elementIds,
        facts: step.transistors.map(({ transistorId, polarity, state }) => {
          const name = labelOf(transistorId);
          const template = state === 'active' ? (polarity === 'npn' ? text.transistor.activeNpn : text.transistor.activePnp) :
            state === 'saturation' ? (polarity === 'npn' ? text.transistor.saturationNpn : text.transistor.saturationPnp) : text.transistor.cutoff;
          return withIndex(template, name).replace('{vbe}', formatQuantity(DEFAULT_DIODE_THRESHOLD, 'V'));
        }),
        notes: step.transistors.flatMap(({ transistorId, guess, state }) => guess === state ? [] : [
          (state === 'saturation' ? text.transistor.revisedSaturation : text.transistor.revisedCutoff).replaceAll('{name}', labelOf(transistorId)),
        ]),
      };
    }
    case 'transistor-equations':
      return { ...blank, type: step.type, title: text.transistorEquations.title, why: text.transistorEquations.why, elementIds: [], lines: [{ tex: mnaTex(step.mna, labelOf) }] };
    case 'bjt-thevenin': {
      const upperName = nameTex(labelOf(step.upper.resistorId!));
      const lowerName = nameTex(labelOf(step.lower.resistorId!));
      const upperVoltage = sideSource(step.upper, labelOf) || fractionTex(step.upper.voltage);
      const lowerVoltage = sideSource(step.lower, labelOf) || fractionTex(step.lower.voltage);
      const ethFormula = step.lower.node === REFERENCE_NODE
        ? `E_{TH} = \\frac{${lowerName}}{${upperName} + ${lowerName}} \\cdot ${upperVoltage}`
        : `E_{TH} = ${lowerVoltage} + (${upperVoltage} - ${lowerVoltage}) \\cdot \\frac{${lowerName}}{${upperName} + ${lowerName}}`;
      return {
        ...blank,
        type: step.type,
        title: text.bjtThevenin.title.replace('{name}', labelOf(step.transistorId)),
        why: text.bjtThevenin.why,
        elementIds: step.elementIds,
        lines: [
          { tex: `${ethFormula} = ${quantityTex(step.eth, 'V')}` },
          { tex: `R_{TH} = ${nameTex(labelOf(step.upper.resistorId!))} \\parallel ${nameTex(labelOf(step.lower.resistorId!))} = ${resistanceTex(step.rth)}` },
        ],
      };
    }
    case 'bjt-input-loop': {
      const name = labelOf(step.transistorId);
      const baseCurrent = bjtVariable('I_B', step.transistorId, labelOf);
      const collectorCurrent = bjtVariable('I_C', step.transistorId, labelOf);
      const emitterCurrent = bjtVariable('I_E', step.transistorId, labelOf);
      const emitterDrop = sideDrop(step.emitter, emitterCurrent, labelOf);
      const junction = bjtVoltage(step.polarity === 'npn' ? 'BE' : 'EB', step.transistorId, labelOf);
      if (step.pattern === 'known-base') {
        const ve = step.polarity === 'npn' ? step.base.voltage.sub(step.vbe) : step.base.voltage.add(step.vbe);
        const knownBaseLines = [
          { tex: `V_{E${/^Q(\d+)$/.exec(name)?.[1] ?? `,${nameTex(name)}`}} = ${bjtVoltage('B', step.transistorId, labelOf)} ${step.polarity === 'npn' ? '-' : '+'} ${junction} = ${quantityTex(ve, 'V')}` },
          { tex: `${emitterCurrent} = ${emitterDrop ? `\\frac{${fractionTex(step.polarity === 'npn' ? ve.sub(step.emitter.voltage) : step.emitter.voltage.sub(ve))}}{${resistanceTex(step.emitter.resistance)}}` : '0'} = ${quantityTex(step.ie, 'A')}` },
          { tex: `${baseCurrent} = \\frac{${emitterCurrent}}{\\beta + 1} = ${quantityTex(step.ib, 'A')}` },
          { tex: `${collectorCurrent} = \\beta ${baseCurrent} = ${quantityTex(step.ic, 'A')}` },
        ];
        return { ...blank, type: step.type, title: text.bjtInputLoop.title.replace('{name}', name), why: text.bjtInputLoop.whyKnownBase, elementIds: step.elementIds, lines: knownBaseLines };
      }
      const law = bjtLoopLaw(step, labelOf);
      const lines: EquationLine[] = [{ caption: text.bjtInputLoop.law, tex: law }];
      if (step.emitter.resistorId) lines.push({ caption: text.bjtInputLoop.substitute, tex: bjtLoopLaw(step, labelOf, true) });
      const numerator = step.polarity === 'npn'
        ? voltageDifferenceTex([{ value: step.base.voltage, sign: 1 }, { value: step.emitter.voltage, sign: -1 }, { value: step.vbe, sign: -1 }])
        : voltageDifferenceTex([{ value: step.emitter.voltage, sign: 1 }, { value: step.base.voltage, sign: -1 }, { value: step.vbe, sign: -1 }]);
      const denominator = [
        ...(step.base.resistance.isZero() ? [] : [resistanceTex(step.base.resistance)]),
        ...(step.emitter.resistance.isZero() ? [] : [`${fractionTex(step.beta.add(Fraction.from(1)))} \\cdot ${resistanceTex(step.emitter.resistance)}`]),
      ].join(' + ') || '0';
      lines.push({ caption: text.bjtInputLoop.solve, tex: `${baseCurrent} = \\frac{${numerator}}{${denominator}} = ${quantityTex(step.ib, 'A')}` });
      lines.push(
        { tex: `${collectorCurrent} = \\beta ${baseCurrent} = ${quantityTex(step.ic, 'A')}` },
        { tex: `${emitterCurrent} = (\\beta + 1) ${baseCurrent} = ${quantityTex(step.ie, 'A')}` },
      );
      return { ...blank, type: step.type, title: text.bjtInputLoop.title.replace('{name}', name), why: text.bjtInputLoop.why, elementIds: step.elementIds, lines };
    }
    case 'bjt-output-loop': {
      const currentC = bjtVariable('I_C', step.transistorId, labelOf);
      const currentE = bjtVariable('I_E', step.transistorId, labelOf);
      const voltage = bjtVoltage(step.polarity === 'npn' ? 'CE' : 'EC', step.transistorId, labelOf);
      const collectorDrop = sideDrop(step.collector, currentC, labelOf);
      const emitterDrop = sideDrop(step.emitter, currentE, labelOf);
      const terms = step.polarity === 'npn'
        ? [[sideSource(step.collector, labelOf), 1], [collectorDrop, -1], [sideSource(step.emitter, labelOf), -1], [emitterDrop, -1]] as const
        : [[sideSource(step.emitter, labelOf), 1], [emitterDrop, -1], [sideSource(step.collector, labelOf), -1], [collectorDrop, -1]] as const;
      const expression = terms.filter(([term]) => term).map(([term, sign], index) =>
        index === 0 ? (sign < 0 ? `-${term}` : term!) : `${sign < 0 ? '-' : '+'} ${term}`,
      ).join(' ') || '0';
      const solved = `${voltage} = ${expression} = ${quantityTex(step.vce, 'V')}`;
      return { ...blank, type: step.type, title: text.bjtOutputLoop.title.replace('{name}', labelOf(step.transistorId)), why: text.bjtOutputLoop.why, elementIds: step.elementIds, lines: [
        { caption: text.bjtInputLoop.law, tex: bjtLoopLaw(step, labelOf) },
        { tex: solved },
      ] };
    }
    case 'bjt-voltages': {
      const context = bjtLoopContext.get(step.transistorId);
      bjtLoopContext.delete(step.transistorId);
      const baseVoltage = bjtVoltage('B', step.transistorId, labelOf);
      const collectorVoltage = bjtVoltage('C', step.transistorId, labelOf);
      const emitterVoltage = bjtVoltage('E', step.transistorId, labelOf);
      const transistor = step.transistorId;
      const emitterExpression = context?.input
        ? sideVoltageFromCurrent(context.input.emitter, bjtVariable('I_E', transistor, labelOf), context.input.polarity === 'npn' ? '+' : '-', labelOf)
        : fractionTex(step.ve);
      const collectorExpression = context?.output
        ? sideVoltageFromCurrent(context.output.collector, bjtVariable('I_C', transistor, labelOf), context.output.polarity === 'npn' ? '-' : '+', labelOf)
        : fractionTex(step.vc);
      const junction = bjtVoltage(step.polarity === 'npn' ? 'BE' : 'EB', transistor, labelOf);
      const lines = [
        { tex: `${emitterVoltage} = ${emitterExpression} = ${quantityTex(step.ve, 'V')}` },
        { tex: `${baseVoltage} = ${emitterVoltage} ${step.polarity === 'npn' ? '+' : '-'} ${junction} = ${quantityTex(step.vb, 'V')}` },
        { tex: `${collectorVoltage} = ${collectorExpression} = ${quantityTex(step.vc, 'V')}` },
      ];
      return { ...blank, type: step.type, title: text.bjtVoltages.title.replace('{name}', labelOf(transistor)), why: text.bjtVoltages.why, elementIds: step.elementIds, lines };
    }
    case 'transistor-currents': {
      return {
        ...blank,
        type: step.type,
        title: text.transistorCurrents.title,
        why: '',
        elementIds: step.elementIds,
        facts: step.transistors.map((transistor) => {
          const name = labelOf(transistor.transistorId);
          const data = { name, i: /^Q(\d+)$/.exec(name)?.[1] ?? '', ib: formatQuantity(transistor.ib, 'A'), ic: formatQuantity(transistor.ic, 'A'), ie: formatQuantity(transistor.ie, 'A'), vce: formatQuantity(transistor.vce, 'V'), vec: formatQuantity(transistor.vce.neg(), 'V') };
          const template = transistor.state === 'active'
            ? (transistor.polarity === 'pnp' ? text.transistorCurrents.activePnp : text.transistorCurrents.active)
            : transistor.state === 'saturation'
              ? (transistor.polarity === 'pnp' ? text.transistorCurrents.saturationPnp : text.transistorCurrents.saturation)
              : text.transistorCurrents.cutoff;
          let result: string = template;
          for (const [key, value] of Object.entries(data)) result = result.replaceAll(`{${key}}`, value);
          return result;
        }),
      };
    }
    case 'transistor-check': {
      const withValues = (template: string, name: string, values: Record<string, string>): string =>
        Object.entries({ name, i: /^Q(\d+)$/.exec(name)?.[1] ?? '', ...values }).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), template);
      return {
        ...blank,
        type: step.type,
        title: text.transistorCheck.title,
        why: text.transistorCheck.why,
        elementIds: step.elementIds,
        facts: step.checks.map((q) => {
          const name = labelOf(q.transistorId);
          const vc = formatQuantity(q.vc, 'V'); const vb = formatQuantity(q.vb, 'V');
          const vceValue = q.polarity === 'npn' ? q.vc.sub(q.ve) : q.ve.sub(q.vc);
          const vce = formatQuantity(vceValue, 'V');
          if (q.state === 'active') {
            const npnAbove = q.polarity === 'npn' && q.vc.sub(q.vb).isPositive();
            const pnpBelow = q.polarity === 'pnp' && q.vc.sub(q.vb).num < 0n;
            if (npnAbove) return withValues(text.transistorCheck.activeNpn, name, { vc, vb });
            if (pnpBelow) return withValues(text.transistorCheck.activePnp, name, { vc, vb });
            return withValues(q.polarity === 'npn' ? text.transistorCheck.activeNearNpn : text.transistorCheck.activeNearPnp, name, { vce });
          }
          if (q.state === 'saturation') return withValues(text.transistorCheck.saturation, name, { ic: formatQuantity(q.ic, 'A'), betaIb: formatQuantity(q.beta.mul(q.ib), 'A') });
          const vbe = formatQuantity(q.polarity === 'npn' ? q.vb.sub(q.ve) : q.ve.sub(q.vb), 'V');
          return withValues(q.polarity === 'npn' ? text.transistorCheck.cutoffNpn : text.transistorCheck.cutoffPnp, name, { vbe, threshold: formatQuantity(DEFAULT_DIODE_THRESHOLD, 'V') });
        }),
      };
    }
    case 'nodes':
      return {
        ...blank,
        type: step.type,
        title: text.nodes.title,
        why: text.nodes.why,
        elementIds: step.elementIds,
        nodes: step.nodes,
        lines: step.nodes.length > 0 ? [{ tex: step.nodes.map(nodeTex).join(',\\; ') }] : [],
        notes: step.nodes.length > 0 ? [] : [text.nodes.none],
      };
    case 'reference':
      return {
        ...blank,
        type: step.type,
        title: text.reference.title,
        why: text.reference.why,
        elementIds: step.elementIds,
        lines: [{ tex: 'V_{\\text{toprak}} = 0\\,\\text{V}' }],
      };
    case 'known-voltages':
      return {
        ...blank,
        type: step.type,
        title: text.known.title,
        why: text.known.why,
        elementIds: step.elementIds,
        nodes: step.values.map(({ node }) => node),
        lines: step.relations.map(({ node, parent, delta }) => {
          const value = step.values.find((candidate) => candidate.node === node)!.voltage;
          if (parent === REFERENCE_NODE) return { tex: `${nodeTex(node)} = ${valueTex(value, 'V')}` };
          const magnitude = positive(delta);
          const sign = delta.num < 0n ? '-' : '+';
          return {
            tex: `${nodeTex(node)} = ${nodeTex(parent)} ${sign} ${fractionTex(magnitude)} = ${valueTex(value, 'V')}`,
          };
        }),
      };
    case 'supernode':
      return {
        ...blank,
        type: step.type,
        title: text.supernode.title,
        why: text.supernode.why,
        elementIds: step.elementIds,
        nodes: step.nodes,
        lines: step.expressions
          .filter(({ node }) => node !== step.representative)
          .map(({ node, expression }) => ({ tex: `${nodeTex(node)} = ${expressionTex(expression)}` })),
      };
    case 'op-amp':
      return {
        ...blank,
        type: step.type,
        title: text.opAmp.title,
        why: text.opAmp.why,
        elementIds: step.elementIds,
        nodes: step.opAmps.flatMap(({ inverting, nonInverting }) =>
          [inverting, nonInverting].filter((node) => node !== REFERENCE_NODE),
        ),
        facts: step.opAmps.map(({ elementId, virtualGround }) =>
          (virtualGround ? text.opAmp.virtualGround : text.opAmp.rule).replace('{name}', labelOf(elementId)),
        ),
        lines: step.opAmps.map(({ inverting, nonInverting, inputs }) => {
          const equal = [inverting, nonInverting]
            .filter((node) => node !== REFERENCE_NODE)
            .map(nodeTex)
            .join(' = ');
          return { tex: inputs.unknown === null ? `${equal} = ${valueTex(inputs.offset, 'V')}` : equal };
        }),
      };
    case 'kcl':
      return kclView(step, convention, labelOf);
    case 'system': {
      const single = step.unknowns.length === 1;
      return {
        ...blank,
        type: step.type,
        title: single ? text.system.titleSingle : text.system.title,
        why: single ? text.system.whySingle : text.system.why,
        elementIds: step.elementIds,
        nodes: step.unknowns,
        lines: single
          ? [{ tex: simplifiedEquationTex(step.matrix[0]!, step.unknowns, step.rhs[0]!) }]
          : [{ tex: simplifiedSystemTex(step.matrix, step.unknowns.map(nodeTex), step.rhs) }],
      };
    }
    case 'node-voltages':
      return {
        ...blank,
        type: step.type,
        title: text.voltages.title,
        why: text.voltages.why,
        elementIds: step.elementIds,
        nodes: step.values.map(({ node }) => node),
        lines: step.values.map(({ node, voltage }) => ({ tex: `${nodeTex(node)} = ${valueTex(voltage, 'V')}` })),
      };
    case 'element-results':
      {
        const lines: EquationLine[] = [];
        let showedOhm = false;
        let showedKcl = false;
        const resultById = new Map(step.results.map((result) => [result.elementId, result]));
        for (const derivation of step.derivations) {
          if (derivation.kind === 'ohm') {
            const resistorName = nameTex(labelOf(derivation.elementId));
            const top = (from: string, to: string | null): string => to === null ? from : `${from} - ${to}`;
            const symbolicTop = top(
              derivation.from === REFERENCE_NODE ? '0' : nodeTex(derivation.from),
              derivation.to === REFERENCE_NODE ? null : nodeTex(derivation.to),
            );
            const numericFrom = derivation.fromVoltage.isZero() ? '0' : inParens(derivation.fromVoltage);
            const numericTo = derivation.to === REFERENCE_NODE ? null : inParens(derivation.toVoltage);
            const numericTop = top(numericFrom, numericTo);
            lines.push({
              ...(showedOhm ? {} : { caption: text.elements.ohm }),
              tex: `I_{${resistorName}} = \\frac{${symbolicTop}}{${resistorName}} = \\frac{${numericTop}}{${resistanceTex(derivation.resistance)}} = ${quantityTex(derivation.current, 'A')}`,
            });
            showedOhm = true;
            continue;
          }

          const symbolicTerm = (id: ElementId): string => {
            const result = resultById.get(id);
            const name = nameTex(labelOf(id));
            return result?.kind === 'current-source' ? name : `I_{${name}}`;
          };
          const valueTerm = (id: ElementId): string => {
            const current = resultById.get(id)?.current ?? Fraction.ZERO;
            return quantityTex(current.num < 0n ? current.neg() : current, 'A');
          };
          const symbolicPlus = derivation.plus.map(symbolicTerm);
          const symbolicMinus = derivation.minus.map(symbolicTerm);
          const valuePlus = derivation.plus.map(valueTerm);
          const valueMinus = derivation.minus.map(valueTerm);
          const symbolic = symbolicPlus.length && symbolicMinus.length
            ? `${symbolicPlus.join(' + ')} - ${symbolicMinus.join(' - ')}`
            : [...symbolicPlus, ...symbolicMinus].join(' + ');
          const numeric = valuePlus.length && valueMinus.length
            ? `${valuePlus.join(' + ')} - ${valueMinus.join(' - ')}`
            : [...valuePlus, ...valueMinus].join(' + ');
          const target = `I_{${nameTex(labelOf(derivation.elementId))}}`;
          const termsCount = symbolicPlus.length + symbolicMinus.length;
          lines.push({
            ...(showedKcl ? {} : { caption: text.elements.kcl }),
            tex: termsCount === 1
              ? `${target} = ${symbolic} = ${quantityTex(derivation.current, 'A')}`
              : `${target} = ${symbolic} = ${numeric} = ${quantityTex(derivation.current, 'A')}`,
          });
          showedKcl = true;
        }
        return {
          ...blank,
          type: step.type,
          title: text.elements.title,
          why: text.elements.why,
          elementIds: step.elementIds,
          lines,
          rows: step.results.map((result) => elementRow(result, labelOf)),
        };
      }
    case 'diode-check':
      return {
        ...blank,
        type: step.type,
        title: text.diodeCheck.title,
        why: text.diodeCheck.why,
        elementIds: step.elementIds,
        facts: step.checks.map(({ diodeId, state, current, voltage, threshold, zenerVoltage }) =>
          state === 'on'
            ? text.diodeCheck.on.replace('{name}', labelOf(diodeId)).replace('{current}', formatQuantity(current, 'A'))
            : state === 'zener'
              ? text.diodeCheck.zener.replace('{name}', labelOf(diodeId)).replace('{current}', formatQuantity(current.neg(), 'A'))
              : zenerVoltage !== null
                ? text.diodeCheck.zenerOff
                  .replace('{name}', labelOf(diodeId))
                  .replace('{voltage}', formatQuantity(voltage.neg(), 'V'))
                  .replace('{zenerVoltage}', formatQuantity(zenerVoltage, 'V'))
            : text.diodeCheck.off
              .replace('{name}', labelOf(diodeId))
              .replace('{voltage}', formatQuantity(voltage, 'V'))
              .replace('{threshold}', formatQuantity(threshold, 'V')),
        ),
      };
    case 'verification': {
      const balanced = step.nodeCurrents.every(({ sum }) => sum.isZero());
      const powerKnown = step.powerAbsorbed !== null && step.powerDelivered !== null;
      const powerBalanced = powerKnown && step.powerAbsorbed!.equals(step.powerDelivered!);
      const notes: string[] = [];
      if (balanced) notes.push(text.verification.kclOk);
      if (!powerKnown) notes.push(text.verification.powerUnknown);
      else if (powerBalanced) {
        notes.push(text.verification.powerOk.replace('{power}', formatQuantity(step.powerAbsorbed!, 'W')));
      }
      if (!balanced || (powerKnown && !powerBalanced)) notes.push(text.verification.failed);
      return { ...blank, type: step.type, title: text.verification.title, why: text.verification.why, elementIds: step.elementIds, notes };
    }
  }
}

export interface DcElement {
  readonly id: ElementId;
  readonly label: string;
  readonly kind: 'capacitor' | 'inductor' | 'switch' | 'ammeter' | 'voltmeter';
  readonly closed?: boolean;
}

function dcFact(element: DcElement): string {
  const text = tr.learn.dcEquivalent;
  let sentence: string;
  if (element.kind === 'switch') sentence = element.closed ? text.switchClosed : text.switchOpen;
  else sentence = text[element.kind];
  return sentence.replace('{name}', element.label);
}

/** The opening step when a circuit has elements that act as a wire or a gap in DC. */
export function dcEquivalentView(elements: readonly DcElement[]): StepView {
  return {
    ...blank,
    type: 'dc-equivalent',
    title: tr.learn.dcEquivalent.title,
    why: tr.learn.dcEquivalent.why,
    facts: elements.map(dcFact),
    elementIds: elements.map((element) => element.id),
  };
}

export interface MeasuredRow {
  readonly label: string;
  readonly voltage: Fraction | null;
  readonly current: Fraction | null;
}

/** Readings of those same elements, for the table of results. They use no power. */
export function measuredRow({ label, voltage, current }: MeasuredRow): ResultRow {
  const unknown = tr.learn.elements.indeterminate;
  return {
    name: label,
    voltage: voltage ? formatQuantity(positive(voltage), 'V') : unknown,
    current: current ? formatQuantity(positive(current), 'A') : unknown,
    power: formatQuantity(Fraction.ZERO, 'W'),
  };
}

/** Steps from here on may show the answers on the drawing. */
export const revealsNodeValues = (type: StepViewType): boolean =>
  type === 'node-voltages' || type === 'element-results' || type === 'diode-check' || type === 'transistor-currents' || type === 'transistor-check' || type === 'verification' || type === 'bjt-voltages';

export const revealsCurrents = (type: StepViewType): boolean =>
  type === 'element-results' || type === 'diode-check' || type === 'transistor-currents' || type === 'transistor-check' || type === 'verification';
