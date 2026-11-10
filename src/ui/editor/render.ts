import { REFERENCE_NODE, type AnalysisResult, type ElementId, type Fraction, type IssueSeverity } from '../../core';
import { tr } from '../../i18n/tr';
import { escapeHtml, formatBeta, formatQuantity, nodeLetter } from '../format';
import type { CapacitorStyle } from '../capacitor-style';
import type { Measurement } from './measurements';
import {
  connectionMarks,
  endsOf,
  hasValue,
  invertingSide,
  isComponent,
  isTransistor,
  parsePointId,
  turnOffset,
  UNIT_OF,
  wireRoute,
  type Cell,
  type ComponentItem,
  type ComponentKind,
  type GroundItem,
  type Rotation,
  type Schematic,
  type SchematicItem,
  type WireItem,
} from './schematic';

export const CELL_SIZE = 20;

export type SolvedAnalysis = Extract<AnalysisResult, { status: 'solved' }>;

export interface DrawOptions {
  readonly selectedId: ElementId | null;
  /** Several selected elements, drawn the same way as `selectedId`. */
  readonly selectedIds?: ReadonlySet<ElementId>;
  readonly highlights: ReadonlyMap<ElementId, IssueSeverity>;
  readonly solved: SolvedAnalysis | null;
  /** An element shown faintly because it hasn't been dropped yet. */
  readonly previewId?: ElementId | null;
  /** What the current solution step is about, in Learn mode. */
  readonly step?: StepHighlight | null;
  /** Readings for elements the solver doesn't treat as such: meters, capacitors, and so on. */
  readonly measurements?: ReadonlyMap<ElementId, Measurement> | null;
  readonly capacitorStyle?: CapacitorStyle;
}

export interface StepAssumedCurrent {
  readonly elementId: ElementId;
  /** The node the arrow leaves from. Null means the element's own direction, for a source. */
  readonly fromNode: number | null;
  readonly name: string;
}

export interface StepHighlight {
  readonly elementIds: readonly ElementId[];
  readonly nodes: readonly number[];
  readonly assumedCurrents: readonly StepAssumedCurrent[];
  /** The answers stay off the drawing until the solution reaches them. */
  readonly showNodeValues: boolean;
  readonly showCurrents: boolean;
}

const px = (cell: number): number => cell * CELL_SIZE;

const RESISTOR_PATH = 'M-40 0H-21L-17 -8L-10 8L-3 -8L3 8L10 -8L17 8L21 0H40';
const LEADS_AND_CIRCLE = 'M-40 0H-16M16 0H40';

// Drawn along the x axis from the first terminal (−40) to the second (+40).
const SYMBOLS: Readonly<Record<Exclude<ComponentKind, 'switch'>, string>> = {
  resistor: `<path class="line" d="${RESISTOR_PATH}"/>`,
  'variable-resistor': `<path class="line" d="${RESISTOR_PATH}M-16 14L16 -14M16 -14H9M16 -14V-7"/>`,
  capacitor: '<path class="line" d="M-40 0H-5M5 0H40M-5 -14V14M5 -14V14"/>',
  inductor:
    '<path class="line" d="M-40 0H-24A6 6 0 0 1 -12 0A6 6 0 0 1 0 0A6 6 0 0 1 12 0A6 6 0 0 1 24 0H40"/>',
  'voltage-source': `<path class="line" d="${LEADS_AND_CIRCLE}M-11 0H-3M-7 -4V4M7 -4V4"/><circle class="line" r="16"/>`,
  'current-source': `<path class="line" d="${LEADS_AND_CIRCLE}M-9 0H9M4 -5L9 0L4 5"/><circle class="line" r="16"/>`,
  'voltage-point': '<path class="line" d="M0 0H-16"/><circle class="line" cx="-20" r="4"/>',
  diode: '<path class="line" d="M-40 0H-10M10 0H40M-10 -10L10 0L-10 10ZM10 -10V10"/>',
  zener: '<path class="line" d="M-40 0H-10M10 0H40M-10 -10L10 0L-10 10ZM4 -14L10 -10V10L16 14"/>',
  led: '<path class="line" d="M-40 0H-10M10 0H40M-10 -10L10 0L-10 10ZM10 -10V10M0 -14L8 -22M8 -12L16 -20M4 -22H8V-18M12 -20H16V-16"/>',
  npn: '<path class="line" d="M-40 0H-6M-6 -16V16M-6 -8L20 -24V-40M-6 8L20 24V40M10.2 22.1L18 22.8L13.9 16.2"/>',
  pnp: '<path class="line" d="M-40 0H-6M-6 -16V16M-6 -8L20 -24V-40M-6 8L20 24V40M2 17L-2.1 10.4L5.7 11.1"/>',
  ammeter: `<path class="line" d="${LEADS_AND_CIRCLE}"/><circle class="line" r="16"/>`,
  voltmeter: `<path class="line" d="${LEADS_AND_CIRCLE}"/><circle class="line" r="16"/>`,
  // Pointing along the x axis, with its inputs on the left at y = ±20 and its output on the right.
  'op-amp': '<path class="line" d="M-24 -32L24 0L-24 32ZM-40 -20H-24M-40 20H-24M24 0H40"/>',
};

const CURVED_CAPACITOR = '<path class="line" d="M-40 0H-5M11 -14Q1 0 11 14M6 0H40M-5 -14V14"/>';

const switchSymbol = (closed: boolean): string =>
  `<path class="line" d="M-40 0H-14${closed ? 'L14 0' : 'L10 -13'}M14 0H40"/>` +
  '<circle class="line" cx="-14" r="2.5"/><circle class="line" cx="14" r="2.5"/>';

const METER_LETTER: Partial<Record<ComponentKind, string>> = { ammeter: 'A', voltmeter: 'V' };

function itemClass(item: SchematicItem, options: DrawOptions): string {
  const classes = ['item'];
  if (item.id === options.selectedId || options.selectedIds?.has(item.id)) classes.push('selected');
  if (item.id === options.previewId) classes.push('preview');
  if (options.step?.elementIds.includes(item.id)) classes.push('step-on');
  const severity = options.highlights.get(item.id);
  if (severity) classes.push(`issue-${severity}`);
  return classes.join(' ');
}

function drawWire(item: WireItem, options: DrawOptions): string {
  const line = `M${px(item.x1)} ${px(item.y1)}L${px(item.x2)} ${px(item.y2)}`;
  return `<g class="${itemClass(item, options)}" data-id="${item.id}">
    <path class="hit" d="${line}"/><path class="line" d="${line}"/>
  </g>`;
}

function drawGround(item: GroundItem, options: DrawOptions): string {
  return `<g class="${itemClass(item, options)}" data-id="${item.id}" transform="translate(${px(item.x)} ${px(item.y)})">
    <rect class="hit" x="-16" y="-4" width="32" height="28"/>
    <path class="line" d="M0 0V10M-14 10H14M-9 16H9M-4 22H4"/>
  </g>`;
}

/** The − and + inside an op-amp. Like a meter's letter they stay upright, or the − would turn into a bar. */
function opAmpSigns(x: number, y: number, rotation: Rotation, mirrored: boolean): string {
  const side = invertingSide({ mirrored });
  const center = (dy: number): Cell => {
    const offset = turnOffset(-15, dy, rotation);
    return { x: px(x) + offset.x, y: px(y) + offset.y };
  };
  const minus = center(side * 20);
  const plus = center(-side * 20);
  return `<path class="line" d="M${minus.x - 4} ${minus.y}H${minus.x + 4}M${plus.x - 4} ${plus.y}H${plus.x + 4}M${plus.x} ${plus.y - 4}V${plus.y + 4}"/>`;
}

function drawBody(
  kind: ComponentKind,
  x: number,
  y: number,
  rotation: Rotation,
  closed = false,
  mirrored = false,
  voltagePointHitWidth = 64,
  capacitorStyle: CapacitorStyle = 'straight',
): string {
  // The letter sits outside the rotated group, so it always stays upright.
  const letter = METER_LETTER[kind];
  const upright = letter
    ? `<text class="meter-letter" x="${px(x)}" y="${px(y) + 5}" text-anchor="middle">${letter}</text>`
    : kind === 'op-amp'
      ? opAmpSigns(x, y, rotation, mirrored)
      : '';
  const halfHeight = kind === 'op-amp' ? 32 : 20;
  if (kind === 'voltage-point') {
    return `<g transform="translate(${px(x)} ${px(y)}) rotate(${rotation * 90})">
      <rect class="hit" x="${-voltagePointHitWidth}" y="-12" width="${voltagePointHitWidth + 4}" height="18"/>
      ${SYMBOLS[kind]}
    </g>`;
  }
  if (isTransistor(kind)) {
    return `<g transform="translate(${px(x)} ${px(y)}) rotate(${rotation * 90})">
      <rect class="hit" x="-40" y="-40" width="64" height="80"/>
      <g transform="${mirrored ? 'scale(1 -1)' : ''}">${SYMBOLS[kind]}</g>
    </g>`;
  }
  return `<g transform="translate(${px(x)} ${px(y)}) rotate(${rotation * 90})">
    <rect class="hit" x="-40" y="${-halfHeight}" width="80" height="${halfHeight * 2}"/>
    ${kind === 'switch' ? switchSymbol(closed) : kind === 'capacitor' && capacitorStyle === 'curved' ? CURVED_CAPACITOR : SYMBOLS[kind]}
  </g>${upright}`;
}

/** What's shown beside the name: the value, a switch's state, or nothing for a meter. */
function valueText(item: ComponentItem): string | null {
  if (item.kind === 'switch') return item.closed ? tr.inspector.switchClosed : tr.inspector.switchOpen;
  if (item.kind === 'op-amp') return `±${formatQuantity(item.value, 'V')}`;
  if (isTransistor(item.kind)) return formatBeta(item.value);
  return hasValue(item.kind) ? formatQuantity(item.value, UNIT_OF[item.kind]) : null;
}

function drawComponentLabel(item: ComponentItem): string {
  const name = `<tspan class="name" data-edit="name">${escapeHtml(item.label)}</tspan>`;
  const text = valueText(item);
  const value = text === null ? '' : `<tspan data-edit="value">${text}</tspan>`;
  const x = px(item.x);
  const y = px(item.y);
  if (item.kind === 'voltage-point') {
    const rotation = item.rotation * 90;
    return `<g transform="translate(${x} ${y}) rotate(${rotation})"><text class="label" x="-28" y="5" text-anchor="end" transform="rotate(${-rotation} -28 5)"><tspan class="name" data-edit="name">${escapeHtml(item.label)}</tspan> <tspan data-edit="value">${text ?? ''}</tspan></text></g>`;
  }
  if (item.kind === 'op-amp') {
    // Above the narrow end of the triangle, in two lines, so a feedback wire rising from either end misses it.
    if (item.rotation % 2 === 0) {
      const [at, anchor] = item.rotation === 0 ? [x - 4, 'start'] : [x + 4, 'end'];
      return `<text class="label" x="${at}" y="${y - 36}" text-anchor="${anchor}">${name}</text>
        <text class="label" x="${at}" y="${y - 21}" text-anchor="${anchor}">${value}</text>`;
    }
    return `<text class="label" x="${x + 36}" y="${y - 3}">${name}</text>
      <text class="label" x="${x + 36}" y="${y + 13}">${value}</text>`;
  }
  if (isTransistor(item.kind)) {
    if (item.rotation === 0) return `<text class="label" x="${x + 28}" y="${y - 5}">${name}</text><text class="label" x="${x + 28}" y="${y + 11}">${value}</text>`;
    if (item.rotation === 2) return `<text class="label" x="${x - 28}" y="${y - 5}" text-anchor="end">${name}</text><text class="label" x="${x - 28}" y="${y + 11}" text-anchor="end">${value}</text>`;
    const top = item.rotation === 1;
    return `<text class="label" x="${x + 46}" y="${y + (top ? -19 : 11)}">${name}</text><text class="label" x="${x + 46}" y="${y + (top ? -3 : 27)}">${value}</text>`;
  }
  if (item.rotation % 2 === 0) {
    return `<text class="label" x="${x}" y="${y - 24}" text-anchor="middle">${name} ${value}</text>`;
  }
  return `<text class="label" x="${x + 24}" y="${y - 3}">${name}</text>
    <text class="label" x="${x + 24}" y="${y + 13}">${value}</text>`;
}

function drawComponent(item: ComponentItem, options: DrawOptions): string {
  const pointTextWidth = item.kind === 'voltage-point'
    ? 28 + `${item.label} ${valueText(item) ?? ''}`.length * 7.5
    : 64;
  return `<g class="${itemClass(item, options)}" data-id="${item.id}">
    ${drawBody(
      item.kind,
      item.x,
      item.y,
      item.rotation,
      item.closed,
      item.mirrored,
      pointTextWidth,
      options.capacitorStyle,
    )}
    ${drawComponentLabel(item)}
  </g>`;
}

function arrow(x1: number, y1: number, x2: number, y2: number): string {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const size = 6;
  const hx = x2 - ux * size;
  const hy = y2 - uy * size;
  return `<path class="current-arrow" d="M${x1} ${y1}L${x2} ${y2}M${hx - uy * size * 0.7} ${hy + ux * size * 0.7}L${x2} ${y2}L${hx + uy * size * 0.7} ${hy - ux * size * 0.7}"/>`;
}

/** A label beside an element and, if a direction is given, an arrow: 1 runs first to second terminal. */
function drawArrowWithLabel(item: ComponentItem, direction: 1 | -1 | 0, labelMarkup: string): string {
  const x = px(item.x);
  const y = px(item.y);
  const horizontal = item.rotation % 2 === 0;
  const textAt = horizontal
    ? `x="${x}" y="${y + 40}" text-anchor="middle"`
    : `x="${x - 30}" y="${y + 4}" text-anchor="end"`;
  const label = `<text class="current" ${textAt}>${labelMarkup}</text>`;
  if (direction === 0) return label;

  const [first, second] = endsOf(item);
  const dx = Math.sign(second.x - first.x) * direction;
  const dy = Math.sign(second.y - first.y) * direction;
  const span = 12;
  return (
    (horizontal
      ? arrow(x - dx * span, y + 24, x + dx * span, y + 24)
      : arrow(x - 24, y - dy * span, x - 24, y + dy * span)) + label
  );
}

/** Draws the arrow in the direction current really flows, so the number can always be positive. */
function drawCurrent(item: ComponentItem, current: Fraction | null): string {
  const text = current
    ? formatQuantity(current.isPositive() ? current : current.neg(), 'A')
    : tr.inspector.indeterminate;
  if (!current || current.isZero()) return drawArrowWithLabel(item, 0, text);
  return drawArrowWithLabel(item, current.isPositive() ? 1 : -1, text);
}

/** The current an op-amp's output really carries, beside its output lead. Inputs carry none. */
function drawOutputCurrent(item: ComponentItem, current: Fraction): string {
  const text = formatQuantity(current.isPositive() ? current : current.neg(), 'A');
  const x = px(item.x);
  const y = px(item.y);
  const along = turnOffset(1, 0, item.rotation);
  const horizontal = along.y === 0;
  // An element's current is measured going in, so a negative one is the output delivering current.
  const outward = current.isPositive() ? -1 : 1;
  const from = 33 - outward * 7;
  const to = 33 + outward * 7;
  const label = horizontal
    ? `<text class="current" x="${x + along.x * 33}" y="${y + 28}" text-anchor="middle">${text}</text>`
    : `<text class="current" x="${x - 16}" y="${y + along.y * 33 + 4}" text-anchor="end">${text}</text>`;
  if (current.isZero()) return label;
  const line = horizontal
    ? arrow(x + along.x * from, y + 10, x + along.x * to, y + 10)
    : arrow(x - 10, y + along.y * from, x - 10, y + along.y * to);
  return line + label;
}

/** What a measured element shows: voltmeters and capacitors their voltage, the rest their current. */
function drawMeasurement(item: ComponentItem, measurement: Measurement): string {
  if (item.kind === 'switch') return '';
  if (item.kind === 'voltmeter' || item.kind === 'capacitor') {
    const { voltage } = measurement;
    const text = voltage
      ? formatQuantity(voltage.num < 0n ? voltage.neg() : voltage, 'V')
      : tr.inspector.indeterminate;
    return drawArrowWithLabel(item, 0, text);
  }
  return drawCurrent(item, measurement.current);
}

/** The direction a solution step assumes for a current, named as in its equations. */
function drawAssumedCurrent(item: ComponentItem, assumed: StepAssumedCurrent, solved: SolvedAnalysis): string {
  const component = solved.netlist.components.find(({ element }) => element.id === item.id);
  const direction = assumed.fromNode === null || component?.a === assumed.fromNode ? 1 : -1;
  const name = assumed.name.startsWith('I') && assumed.name.length > 1
    ? `I<tspan class="subscript" dy="4">${escapeHtml(assumed.name.slice(1))}</tspan>`
    : escapeHtml(assumed.name);
  return drawArrowWithLabel(item, direction, name);
}

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface NodeLabel {
  /** The node's letter, shown as a subscript: V with A below it. */
  readonly letter: string;
  readonly value: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly box: Box;
}

const CHARACTER_WIDTH = 7.5;
const LABEL_HEIGHT = 17;

const overlapArea = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** The space each element takes up on the drawing, including its text and current readout. */
export function occupiedBoxes(schematic: Schematic): Box[] {
  return schematic.items.flatMap((item): Box[] => {
    if (item.kind === 'wire') return [];
    const x = px(item.x);
    const y = px(item.y);
    if (item.kind === 'ground') return [{ left: x - 16, top: y, right: x + 16, bottom: y + 24 }];
    if (item.kind === 'voltage-point') {
      const textWidth = `${item.label} ${valueText(item) ?? ''}`.length * CHARACTER_WIDTH;
      const localLeft = -28 - textWidth;
      const bounds: Readonly<Record<Rotation, readonly [number, number, number, number]>> = {
        0: [localLeft, 4, -12, 6],
        1: [-6, 12, localLeft, 4],
        2: [-4, -localLeft, -6, 12],
        3: [-12, 6, -4, -localLeft],
      };
      const [left, right, top, bottom] = bounds[item.rotation];
      return [{ left: x + left, right: x + right, top: y + top, bottom: y + bottom }];
    }
    if (item.kind === 'op-amp') {
      return item.rotation % 2 === 0
        ? [
            { left: x - 40, top: y - 32, right: x + 40, bottom: y + 32 },
            item.rotation === 0
              ? { left: x - 4, top: y - 50, right: x + 38, bottom: y - 17 }
              : { left: x - 38, top: y - 50, right: x + 4, bottom: y - 17 },
          ]
        : [
            { left: x - 32, top: y - 40, right: x + 32, bottom: y + 40 },
            { left: x + 36, top: y - 16, right: x + 92, bottom: y + 18 },
          ];
    }
    if (isTransistor(item.kind)) {
      const body = item.rotation === 0
        ? { left: x - 40, top: y - 40, right: x + 24, bottom: y + 40 }
        : item.rotation === 2
          ? { left: x - 24, top: y - 40, right: x + 40, bottom: y + 40 }
        : item.rotation === 1
          ? { left: x - 40, top: y - 40, right: x + 40, bottom: y + 24 }
          : { left: x - 40, top: y - 24, right: x + 40, bottom: y + 40 };
      const label = item.rotation === 0
        ? { left: x + 26, top: y - 18, right: x + 82, bottom: y + 14 }
        : item.rotation === 2
          ? { left: x - 82, top: y - 18, right: x - 26, bottom: y + 14 }
        : item.rotation === 1
            ? { left: x + 44, top: y - 32, right: x + 100, bottom: y + 1 }
            : { left: x + 44, top: y - 2, right: x + 100, bottom: y + 31 };
      return [body, label];
    }
    return item.rotation % 2 === 0
      ? [
          { left: x - 40, top: y - 20, right: x + 40, bottom: y + 20 },
          { left: x - 52, top: y - 38, right: x + 52, bottom: y - 20 },
          { left: x - 36, top: y + 16, right: x + 36, bottom: y + 44 },
        ]
      : [
          { left: x - 20, top: y - 40, right: x + 20, bottom: y + 40 },
          { left: x + 20, top: y - 16, right: x + 76, bottom: y + 18 },
          { left: x - 80, top: y - 14, right: x - 18, bottom: y + 14 },
        ];
  });
}

/** Label positions around a point, in order of preference: above, right, left, below. */
function labelCandidates(cell: Cell, letter: string, value: string): NodeLabel[] {
  const x = px(cell.x);
  const y = px(cell.y);
  const text = `V${letter} = ${value}`;
  const width = text.length * CHARACTER_WIDTH;
  const candidate = (labelX: number, baseline: number, anchor: NodeLabel['anchor']): NodeLabel => {
    const left = anchor === 'start' ? labelX : anchor === 'end' ? labelX - width : labelX - width / 2;
    return {
      letter,
      value,
      text,
      x: labelX,
      y: baseline,
      anchor,
      box: { left, top: baseline - LABEL_HEIGHT + 4, right: left + width, bottom: baseline + 4 },
    };
  };
  return [
    candidate(x, y - 9, 'middle'),
    candidate(x + 8, y - 6, 'start'),
    candidate(x - 8, y - 6, 'end'),
    candidate(x, y + 20, 'middle'),
  ];
}

/** Chooses, for each node, the free spot with the least overlap with anything already drawn. */
export function placeNodeLabels(schematic: Schematic, solved: SolvedAnalysis): NodeLabel[] {
  const occupied = occupiedBoxes(schematic);
  const components = schematic.items.filter(isComponent);
  const clearance = (cell: Cell): number =>
    Math.min(...components.map((item) => Math.hypot(item.x - cell.x, item.y - cell.y)));

  const pointsByNode = new Map<number, Cell[]>();
  for (const [point, node] of solved.netlist.pointToNode) {
    if (node === REFERENCE_NODE) continue;
    pointsByNode.set(node, [...(pointsByNode.get(node) ?? []), parsePointId(point)]);
  }

  return solved.netlist.nodeIds.flatMap((node) => {
    const points = pointsByNode.get(node);
    const voltage = solved.nodeVoltages.get(node);
    if (!points || !voltage) return [];

    const letter = nodeLetter(node);
    const value = formatQuantity(voltage, 'V');
    const scored = points
      .sort((a, b) => clearance(b) - clearance(a) || a.y - b.y || a.x - b.x)
      .flatMap((cell) => labelCandidates(cell, letter, value))
      .map((label) => ({
        label,
        overlap: occupied.reduce((sum, box) => sum + overlapArea(label.box, box), 0),
      }));
    const best = scored.reduce((a, b) => (b.overlap < a.overlap ? b : a));
    occupied.push(best.label.box);
    return [best.label];
  });
}

function drawNodeLabels(schematic: Schematic, solved: SolvedAnalysis, step: StepHighlight | null | undefined): string {
  const showValues = step?.showNodeValues ?? true;
  const nodeOrder = solved.netlist.nodeIds;
  return placeNodeLabels(schematic, solved)
    .map(({ letter, value, x, y, anchor }, index) => {
      const active = step?.nodes.includes(nodeOrder[index]!) ? ' active' : '';
      const valueText = showValues ? `<tspan dy="-4"> = ${value}</tspan>` : '';
      return `<text class="node-label${active}" x="${x}" y="${y}" text-anchor="${anchor}">V<tspan class="subscript" dy="4">${letter}</tspan>${valueText}</text>`;
    })
    .join('');
}

function drawConnectionMarks(schematic: Schematic): string {
  return connectionMarks(schematic)
    .map(({ cell, connections }) => {
      if (connections >= 3) return `<circle class="junction" cx="${px(cell.x)}" cy="${px(cell.y)}" r="3.5"/>`;
      if (connections === 1) return `<circle class="open-end" cx="${px(cell.x)}" cy="${px(cell.y)}" r="3"/>`;
      return '';
    })
    .join('');
}

export function drawSchematic(schematic: Schematic, options: DrawOptions): string {
  const parts: string[] = [];
  for (const item of schematic.items) {
    if (item.kind === 'wire') parts.push(drawWire(item, options));
  }
  for (const item of schematic.items) {
    if (item.kind === 'ground') parts.push(drawGround(item, options));
    else if (isComponent(item)) parts.push(drawComponent(item, options));
  }
  parts.push(drawConnectionMarks(schematic));

  const { solved, step } = options;
  if (solved) {
    for (const item of schematic.items) {
      if (!isComponent(item)) continue;
      const assumed = step?.assumedCurrents.find((current) => current.elementId === item.id);
      const result = solved.elements.get(item.id);
      const measurement = options.measurements?.get(item.id);
      if (assumed && item.kind !== 'voltage-point' && !isTransistor(item.kind)) parts.push(drawAssumedCurrent(item, assumed, solved));
      else if (step?.showCurrents ?? true) {
        if (result && item.kind === 'op-amp') parts.push(drawOutputCurrent(item, result.current!));
        else if (result && item.kind !== 'voltage-point' && !isTransistor(item.kind)) parts.push(drawCurrent(item, result.current));
        else if (measurement) parts.push(drawMeasurement(item, measurement));
      }
    }
    parts.push(drawNodeLabels(schematic, solved, step));
  }
  return parts.join('');
}

export function drawComponentGhost(
  kind: ComponentKind,
  cell: Cell,
  rotation: Rotation,
  blocked = false,
  capacitorStyle: CapacitorStyle = 'straight',
): string {
  return `<g class="ghost${blocked ? ' blocked' : ''}">${drawBody(kind, cell.x, cell.y, rotation, false, false, 64, capacitorStyle)}</g>`;
}

export function drawGroundGhost(cell: Cell): string {
  return `<g class="ghost" transform="translate(${px(cell.x)} ${px(cell.y)})"><path class="line" d="M0 0V10M-14 10H14M-9 16H9M-4 22H4"/></g>`;
}

export function drawWirePreview(start: Cell, end: Cell): string {
  const path = wireRoute(start, end)
    .map(({ from, to }) => `M${px(from.x)} ${px(from.y)}L${px(to.x)} ${px(to.y)}`)
    .join('');
  return `<g class="ghost"><path class="line" d="${path}"/></g>`;
}

export function drawConnectionTarget(cell: Cell): string {
  return `<circle class="target" cx="${px(cell.x)}" cy="${px(cell.y)}" r="7"/>`;
}
