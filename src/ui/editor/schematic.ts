import {
  currentSource,
  diode,
  npn,
  pnp,
  zener as zenerElement,
  DEFAULT_OP_AMP_SUPPLY,
  Fraction,
  ground,
  opAmp,
  resistor,
  voltageSource,
  wire,
  type Circuit,
  type CircuitElement,
  type ElementId,
  type PointId,
} from '../../core';
import type { Unit } from '../format';

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export const COMPONENT_KINDS = [
  'resistor',
  'variable-resistor',
  'capacitor',
  'inductor',
  'voltage-source',
  'current-source',
  'voltage-point',
  'diode',
  'zener',
  'led',
  'npn',
  'pnp',
  'op-amp',
  'switch',
  'ammeter',
  'voltmeter',
] as const;

export type ComponentKind = (typeof COMPONENT_KINDS)[number];
export type ValuedKind = Exclude<ComponentKind, 'switch' | 'ammeter' | 'voltmeter'>;
export type UnitValuedKind = Exclude<ValuedKind, 'npn' | 'pnp'>;
export type Rotation = 0 | 1 | 2 | 3;

export interface ComponentItem {
  readonly kind: ComponentKind;
  readonly id: ElementId;
  readonly label: string;
  /** Reference position; terminal layout depends on the component kind. */
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
  /** An op-amp's supply or a transistor's current gain. */
  readonly value: Fraction;
  /** Switches only. A new switch starts open. */
  readonly closed?: boolean;
  /** Variable resistors only: the top of the slider's range. */
  readonly maxValue?: Fraction;
  /** Op-amps only: the + input takes the place the − input normally has. */
  readonly mirrored?: boolean;
}

export interface WireItem {
  readonly kind: 'wire';
  readonly id: ElementId;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface GroundItem {
  readonly kind: 'ground';
  readonly id: ElementId;
  readonly x: number;
  readonly y: number;
}

export type SchematicItem = ComponentItem | WireItem | GroundItem;

export interface Schematic {
  readonly items: readonly SchematicItem[];
  readonly nextId: number;
}

export const EMPTY_SCHEMATIC: Schematic = { items: [], nextId: 1 };

export const TERMINAL_OFFSET = 2;
/** How far an op-amp's inputs sit either side of its center line, in cells. */
const OP_AMP_INPUT_OFFSET = 1;
const BJT_TERMINAL_BASE: Cell = { x: -2, y: 0 };
const BJT_TERMINAL_COLLECTOR: Cell = { x: 1, y: -2 };
const BJT_TERMINAL_EMITTER: Cell = { x: 1, y: 2 };

/** Letters follow the course notes where they name one: C, L and "S anahtarı". */
const LABEL_PREFIX: Readonly<Record<ComponentKind, string>> = {
  resistor: 'R',
  'variable-resistor': 'R',
  capacitor: 'C',
  inductor: 'L',
  'voltage-source': 'V',
  'current-source': 'I',
  'voltage-point': 'V',
  diode: 'D',
  zener: 'Z',
  led: 'LED',
  npn: 'Q',
  pnp: 'Q',
  'op-amp': 'OP',
  switch: 'S',
  ammeter: 'A',
  voltmeter: 'Vm',
};

export const UNIT_OF: Readonly<Record<UnitValuedKind, Exclude<Unit, 'W'>>> = {
  resistor: 'Ω',
  'variable-resistor': 'Ω',
  capacitor: 'F',
  inductor: 'H',
  'voltage-source': 'V',
  'current-source': 'A',
  'voltage-point': 'V',
  diode: 'V',
  zener: 'V',
  led: 'V',
  'op-amp': 'V',
};

export const hasValue = (kind: ComponentKind): kind is ValuedKind =>
  kind !== 'switch' && kind !== 'ammeter' && kind !== 'voltmeter';

export const isTransistor = (kind: ComponentKind): kind is 'npn' | 'pnp' => kind === 'npn' || kind === 'pnp';

export const isThreeTerminal = (kind: ComponentKind): boolean => kind === 'op-amp' || isTransistor(kind);

/** Passive valued parts and op-amp supplies must be positive; voltage sources and points may be signed. */
export const requiresPositiveValue = (kind: ComponentKind): boolean =>
  kind === 'resistor' ||
  kind === 'variable-resistor' ||
  kind === 'capacitor' ||
  kind === 'inductor' ||
  kind === 'op-amp' ||
  isTransistor(kind) ||
  kind === 'zener' ||
  kind === 'led';

export const isComponentValueValid = (kind: ValuedKind, value: Fraction): boolean =>
  (kind !== 'diode' || value.num >= 0n) && (!requiresPositiveValue(kind) || value.isPositive());

export const DEFAULT_VALUE: Readonly<Record<ComponentKind, Fraction>> = {
  resistor: Fraction.from(1000),
  'variable-resistor': Fraction.from(1000),
  capacitor: Fraction.from('1e-5'),
  inductor: Fraction.from('1e-3'),
  'voltage-source': Fraction.from(10),
  'current-source': Fraction.from(1),
  'voltage-point': Fraction.from(5),
  diode: Fraction.from('0.7'),
  zener: Fraction.from(10),
  led: Fraction.from(2),
  'op-amp': DEFAULT_OP_AMP_SUPPLY,
  npn: Fraction.from(100),
  pnp: Fraction.from(100),
  switch: Fraction.ZERO,
  ammeter: Fraction.ZERO,
  voltmeter: Fraction.ZERO,
};

const DEFAULT_MAX_RESISTANCE = Fraction.from(10000);

/** Sources start upright: voltage source plus on top, current source pushing upward. */
export const DEFAULT_ROTATION: Readonly<Record<ComponentKind, Rotation>> = {
  resistor: 0,
  'variable-resistor': 0,
  capacitor: 0,
  inductor: 0,
  'voltage-source': 1,
  'current-source': 3,
  'voltage-point': 0,
  diode: 0,
  zener: 0,
  led: 0,
  'op-amp': 0,
  npn: 0,
  pnp: 0,
  switch: 0,
  ammeter: 0,
  voltmeter: 1,
};

const DIRECTION: Readonly<Record<Rotation, Cell>> = {
  0: { x: 1, y: 0 },
  1: { x: 0, y: 1 },
  2: { x: -1, y: 0 },
  3: { x: 0, y: -1 },
};

export const isComponent = (item: SchematicItem): item is ComponentItem =>
  item.kind !== 'wire' && item.kind !== 'ground';

/** An offset from an element's center, drawn for rotation 0, once the element has been turned. */
export function turnOffset(dx: number, dy: number, rotation: Rotation): Cell {
  const { x, y } = DIRECTION[rotation];
  return { x: dx * x - dy * y, y: dx * y + dy * x };
}

/** A two-terminal element's ends. First is resistor `a`, voltage source plus, current source `from`. */
export function endsOf(item: Pick<ComponentItem, 'x' | 'y' | 'rotation'>): readonly [Cell, Cell] {
  const direction = DIRECTION[item.rotation];
  return [
    { x: item.x - direction.x * TERMINAL_OFFSET, y: item.y - direction.y * TERMINAL_OFFSET },
    { x: item.x + direction.x * TERMINAL_OFFSET, y: item.y + direction.y * TERMINAL_OFFSET },
  ];
}

/** Which side of an op-amp's center line its − input is on, as drawn for rotation 0. */
export const invertingSide = (item: Pick<ComponentItem, 'mirrored'>): 1 | -1 => (item.mirrored ? 1 : -1);

/** Every terminal. An op-amp's are in the order −, +, output; a transistor's B, C, E. */
export function terminalsOf(
  item: Pick<ComponentItem, 'x' | 'y' | 'rotation'> & Partial<Pick<ComponentItem, 'kind' | 'mirrored'>>,
): readonly Cell[] {
  if (item.kind === 'voltage-point') return [{ x: item.x, y: item.y }];
  if (item.kind && isTransistor(item.kind)) {
    const base = turnOffset(BJT_TERMINAL_BASE.x, BJT_TERMINAL_BASE.y, item.rotation);
    const collector = turnOffset(BJT_TERMINAL_COLLECTOR.x, item.mirrored ? -BJT_TERMINAL_COLLECTOR.y : BJT_TERMINAL_COLLECTOR.y, item.rotation);
    const emitter = turnOffset(BJT_TERMINAL_EMITTER.x, item.mirrored ? -BJT_TERMINAL_EMITTER.y : BJT_TERMINAL_EMITTER.y, item.rotation);
    return [base, collector, emitter].map(({ x, y }) => ({ x: item.x + x, y: item.y + y }));
  }
  if (item.kind !== 'op-amp') return endsOf(item);
  const side = invertingSide(item) * OP_AMP_INPUT_OFFSET;
  const at = (dx: number, dy: number): Cell => {
    const offset = turnOffset(dx, dy, item.rotation);
    return { x: item.x + offset.x, y: item.y + offset.y };
  };
  return [at(-TERMINAL_OFFSET, side), at(-TERMINAL_OFFSET, -side), at(TERMINAL_OFFSET, 0)];
}

export const nextRotation = (rotation: Rotation): Rotation => ((rotation + 1) % 4) as Rotation;

const pointId = ({ x, y }: Cell): PointId => `${x},${y}`;

export function parsePointId(point: PointId): Cell {
  const [x = 0, y = 0] = point.split(',').map(Number);
  return { x, y };
}

/** The first free name for a kind: R1, R2, ... Case is ignored, as in `labelProblem`. */
export function nextLabel(items: readonly SchematicItem[], kind: ComponentKind): string {
  const used = new Set(items.flatMap((item) => (isComponent(item) ? [item.label.toLocaleLowerCase('tr')] : [])));
  const prefix = LABEL_PREFIX[kind];
  let number = 1;
  while (used.has(`${prefix}${number}`.toLocaleLowerCase('tr'))) number++;
  return `${prefix}${number}`;
}

export function addComponent(
  schematic: Schematic,
  kind: ComponentKind,
  cell: Cell,
  rotation: Rotation = DEFAULT_ROTATION[kind],
  value: Fraction = DEFAULT_VALUE[kind],
  label?: string,
): Schematic {
  const item: ComponentItem = {
    kind,
    id: `e${schematic.nextId}`,
    label: label ?? nextLabel(schematic.items, kind),
    x: cell.x,
    y: cell.y,
    rotation,
    value,
    ...(kind === 'switch' ? { closed: false } : {}),
    ...(kind === 'variable-resistor' ? { maxValue: DEFAULT_MAX_RESISTANCE } : {}),
  };
  return { items: [...schematic.items, item], nextId: schematic.nextId + 1 };
}

export function addGround(schematic: Schematic, cell: Cell): Schematic {
  const item: GroundItem = { kind: 'ground', id: `e${schematic.nextId}`, x: cell.x, y: cell.y };
  return { items: [...schematic.items, item], nextId: schematic.nextId + 1 };
}

/** The straight pieces of a wire drawn between two cells: horizontal first, then vertical. */
export function wireRoute(start: Cell, end: Cell): { from: Cell; to: Cell }[] {
  const corner: Cell = { x: end.x, y: start.y };
  return [
    { from: start, to: corner },
    { from: corner, to: end },
  ].filter(({ from, to }) => from.x !== to.x || from.y !== to.y);
}

export function addWire(schematic: Schematic, start: Cell, end: Cell): Schematic {
  let nextId = schematic.nextId;
  const pieces = wireRoute(start, end).map(
    ({ from, to }): WireItem => ({
      kind: 'wire',
      id: `e${nextId++}`,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
    }),
  );
  return { items: [...schematic.items, ...pieces], nextId };
}

export function removeItem(schematic: Schematic, id: ElementId): Schematic {
  return { ...schematic, items: schematic.items.filter((item) => item.id !== id) };
}

function replaceItem(schematic: Schematic, id: ElementId, change: (item: SchematicItem) => SchematicItem): Schematic {
  return { ...schematic, items: schematic.items.map((item) => (item.id === id ? change(item) : item)) };
}

export function moveItem(schematic: Schematic, id: ElementId, dx: number, dy: number): Schematic {
  return replaceItem(schematic, id, (item) =>
    item.kind === 'wire'
      ? { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy }
      : { ...item, x: item.x + dx, y: item.y + dy },
  );
}

export function rotateItem(schematic: Schematic, id: ElementId): Schematic {
  return replaceItem(schematic, id, (item) =>
    isComponent(item) ? { ...item, rotation: nextRotation(item.rotation) } : item,
  );
}

export function setItemValue(schematic: Schematic, id: ElementId, value: Fraction): Schematic {
  return replaceItem(schematic, id, (item) => {
    if (!isComponent(item)) return item;
    // A typed value above the slider's range widens the range, so the slider still fits.
    const widen = item.maxValue && value.sub(item.maxValue).isPositive() ? { maxValue: value } : {};
    return { ...item, value, ...widen };
  });
}

export function toggleSwitch(schematic: Schematic, id: ElementId): Schematic {
  return replaceItem(schematic, id, (item) =>
    isComponent(item) && item.kind === 'switch' ? { ...item, closed: !item.closed } : item,
  );
}

/** True when a wire runs under an op-amp's triangle, where it would look connected to it. */
export function runsUnderOpAmp(wire: WireItem, opAmp: Pick<ComponentItem, 'x' | 'y'>): boolean {
  const reach = TERMINAL_OFFSET - 1;
  return (
    Math.max(wire.x1, wire.x2) >= opAmp.x - reach &&
    Math.min(wire.x1, wire.x2) <= opAmp.x + reach &&
    Math.max(wire.y1, wire.y2) >= opAmp.y - reach &&
    Math.min(wire.y1, wire.y2) <= opAmp.y + reach
  );
}

export function wiresUnderBodies(schematic: Schematic): number {
  const bodies = schematic.items.filter((item) => isComponent(item) && isThreeTerminal(item.kind)) as ComponentItem[];
  return countWiresUnderBodies(schematic, bodies);
}

function countWiresUnderBodies(schematic: Schematic, bodies: readonly ComponentItem[]): number {
  const wires = schematic.items.filter((item): item is WireItem => item.kind === 'wire');
  return bodies.reduce((count, body) => count + wires.filter((wire) => runsUnderOpAmp(wire, body)).length, 0);
}

/** How many wires run under an op-amp anywhere on the drawing. */
export function wiresUnderOpAmps(schematic: Schematic): number {
  const opAmps = schematic.items.filter((item) => isComponent(item) && item.kind === 'op-amp') as ComponentItem[];
  return countWiresUnderBodies(schematic, opAmps);
}

export type WireInsertion =
  /** The element's center isn't on a wire, so it is placed normally. */
  | { readonly status: 'none' }
  | { readonly status: 'inserted'; readonly schematic: Schematic; readonly item: ComponentItem }
  /** The element can't fit here. Placing it anyway would silently short it, so it isn't placed. */
  | { readonly status: 'blocked'; readonly reason: 'too-short' | 'occupied' | 'three-terminals'; readonly rotation: Rotation };

const isHorizontalWire = (item: WireItem): boolean => item.y1 === item.y2;

const cellsBetween = (a: Cell, b: Cell): Cell[] => {
  const cells: Cell[] = [];
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  for (let x = a.x + dx, y = a.y + dy; x !== b.x || y !== b.y; x += dx, y += dy) {
    cells.push({ x, y });
  }
  return cells;
};

const onSegment = (cell: Cell, item: WireItem): boolean =>
  isInsideWire(cell, item) ||
  (cell.x === item.x1 && cell.y === item.y1) ||
  (cell.x === item.x2 && cell.y === item.y2);

const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;

/**
 * Drops a component onto a wire: the wire opens where the component sits, and the component takes
 * its place in the circuit. `schematic` must not contain the component yet. A component arriving
 * across the wire is turned to follow it. Refuses anything that would change other connections.
 */
export function insertIntoWire(
  schematic: Schematic,
  component: ComponentItem,
  ignoredWires: ReadonlySet<ElementId> = new Set(),
): WireInsertion {
  if (component.kind === 'voltage-point') return { status: 'none' };
  // An op-amp has no two ends to open a wire with, and a wire under its body would look connected.
  if (isThreeTerminal(component.kind)) {
    const covered = schematic.items.some((item) => item.kind === 'wire' && !ignoredWires.has(item.id) && runsUnderOpAmp(item, component));
    return covered
      ? { status: 'blocked', reason: 'three-terminals', rotation: component.rotation }
      : { status: 'none' };
  }

  const target = schematic.items.find(
    (item): item is WireItem =>
      item.kind === 'wire' && !ignoredWires.has(item.id) && isInsideWire(component, item),
  );
  if (!target) return { status: 'none' };

  const aligned = (component.rotation % 2 === 0) === isHorizontalWire(target);
  const rotation = aligned ? component.rotation : nextRotation(component.rotation);
  const item: ComponentItem = { ...component, rotation };
  const [first, second] = endsOf(item);

  if (!onSegment(first, target) || !onSegment(second, target)) {
    return { status: 'blocked', reason: 'too-short', rotation };
  }

  const covered = cellsBetween(first, second);
  const hasConnectionInside = connectionCells(schematic).some((cell) =>
    covered.some((inner) => sameCell(cell, inner)),
  );
  const otherWires = schematic.items.filter(
    (other): other is WireItem => other.kind === 'wire' && other.id !== target.id,
  );
  // A wire passing under the body would look connected, and one passing under a terminal would become so.
  const hasWireCrossing = otherWires.some(
    (other) =>
      covered.some((inner) => onSegment(inner, other)) ||
      isInsideWire(first, other) ||
      isInsideWire(second, other),
  );
  if (hasConnectionInside || hasWireCrossing) {
    return { status: 'blocked', reason: 'occupied', rotation };
  }

  const start: Cell = { x: target.x1, y: target.y1 };
  const end: Cell = { x: target.x2, y: target.y2 };
  const firstIsNearer =
    Math.abs(first.x - start.x) + Math.abs(first.y - start.y) <=
    Math.abs(second.x - start.x) + Math.abs(second.y - start.y);
  const near = firstIsNearer ? first : second;
  const far = firstIsNearer ? second : first;

  let nextId = schematic.nextId;
  const pieces: WireItem[] = [];
  if (!sameCell(start, near)) {
    pieces.push({ ...target, x2: near.x, y2: near.y });
  }
  if (!sameCell(far, end)) {
    pieces.push({
      kind: 'wire',
      id: pieces.length === 0 ? target.id : `e${nextId++}`,
      x1: far.x,
      y1: far.y,
      x2: end.x,
      y2: end.y,
    });
  }

  return {
    status: 'inserted',
    item,
    schematic: {
      items: [...schematic.items.filter((other) => other.id !== target.id), ...pieces, item],
      nextId,
    },
  };
}

/** True when two drawings differ at most in names and values, so the same wiring still applies. */
export function hasSameStructure(a: Schematic, b: Schematic): boolean {
  const shape = (schematic: Schematic): string =>
    JSON.stringify(
      schematic.items.map((item) =>
        isComponent(item) ? [item.id, item.kind, item.x, item.y, item.rotation, item.mirrored === true] : item,
      ),
    );
  return shape(a) === shape(b);
}

export const MAX_LABEL_LENGTH = 12;

export type LabelProblem = 'empty' | 'too-long' | 'taken';

/**
 * Names can be anything short, but must be unique: the solution steps refer to elements by
 * name, so two elements called R1 would make them ambiguous. Case doesn't make a name different.
 */
export function labelProblem(schematic: Schematic, id: ElementId, label: string): LabelProblem | null {
  const name = label.trim();
  if (name === '') return 'empty';
  if (name.length > MAX_LABEL_LENGTH) return 'too-long';
  const normalized = name.toLocaleLowerCase('tr');
  const taken = schematic.items.some(
    (item) => isComponent(item) && item.id !== id && item.label.toLocaleLowerCase('tr') === normalized,
  );
  return taken ? 'taken' : null;
}

export function setItemLabel(schematic: Schematic, id: ElementId, label: string): Schematic {
  return replaceItem(schematic, id, (item) => (isComponent(item) ? { ...item, label: label.trim() } : item));
}

/** Every cell where a connection can happen: terminals, ground points and wire ends. */
export function connectionCells(schematic: Schematic): Cell[] {
  const cells = new Map<PointId, Cell>();
  const add = (cell: Cell): void => void cells.set(pointId(cell), cell);
  for (const item of schematic.items) {
    if (item.kind === 'wire') {
      add({ x: item.x1, y: item.y1 });
      add({ x: item.x2, y: item.y2 });
    } else if (item.kind === 'ground') {
      add(item);
    } else {
      terminalsOf(item).forEach(add);
    }
  }
  return [...cells.values()];
}

function isInsideWire(cell: Cell, item: WireItem): boolean {
  if (item.y1 === item.y2 && cell.y === item.y1) {
    return cell.x > Math.min(item.x1, item.x2) && cell.x < Math.max(item.x1, item.x2);
  }
  if (item.x1 === item.x2 && cell.x === item.x1) {
    return cell.y > Math.min(item.y1, item.y2) && cell.y < Math.max(item.y1, item.y2);
  }
  return false;
}

export interface ConnectionMark {
  readonly cell: Cell;
  /** How many wire, terminal or ground ends meet here. A wire passing through counts as two. */
  readonly connections: number;
}

/** Tells the renderer where to draw junction dots (3 or more) and open ends (just 1). */
export function connectionMarks(schematic: Schematic): ConnectionMark[] {
  return connectionCells(schematic).map((cell) => {
    let connections = 0;
    const count = (other: Cell): void => {
      if (other.x === cell.x && other.y === cell.y) connections++;
    };
    for (const item of schematic.items) {
      if (item.kind === 'wire') {
        count({ x: item.x1, y: item.y1 });
        count({ x: item.x2, y: item.y2 });
        if (isInsideWire(cell, item)) connections += 2;
      } else if (item.kind === 'ground') {
        count(item);
      } else {
        terminalsOf(item).forEach(count);
      }
    }
    return { cell, connections };
  });
}

/**
 * Converts the drawing for the solver. A wire is split wherever another connection point lies on
 * it, so joining a wire's middle works, while wires that only cross stay unconnected.
 * The split pieces keep the original wire's id, so issues can still point at the drawn wire.
 *
 * In DC steady state a capacitor, an open switch and an ideal voltmeter carry no current, so they
 * add nothing. An inductor, a closed switch and an ideal ammeter drop no voltage, so they act as
 * wires. With `shorts: 'zero-sources'` those become 0 V sources instead, which makes the solver
 * report the current through them. See measurements.ts.
 */
export function toCircuit(schematic: Schematic, shorts: 'wires' | 'zero-sources' = 'wires'): Circuit {
  const cells = connectionCells(schematic);
  const elements: CircuitElement[] = [];

  for (const item of schematic.items) {
    if (item.kind === 'wire') {
      const start: Cell = { x: item.x1, y: item.y1 };
      const end: Cell = { x: item.x2, y: item.y2 };
      const stops = cells
        .filter((cell) => isInsideWire(cell, item))
        .sort((a, b) => Math.abs(a.x - start.x) + Math.abs(a.y - start.y) - (Math.abs(b.x - start.x) + Math.abs(b.y - start.y)));
      const path = [start, ...stops, end];
      for (let i = 0; i + 1 < path.length; i++) {
        elements.push(wire(item.id, pointId(path[i]!), pointId(path[i + 1]!)));
      }
    } else if (item.kind === 'ground') {
      elements.push(ground(item.id, pointId(item)));
    } else if (item.kind === 'voltage-point') {
      const negative = `${item.id}:ground`;
      elements.push(voltageSource(item.id, pointId(item), negative, item.value));
      elements.push(ground(negative, negative));
    } else if (item.kind === 'op-amp') {
      const [inverting, nonInverting, output] = terminalsOf(item).map(pointId);
      elements.push(opAmp(item.id, inverting!, nonInverting!, output!, item.value));
    } else if (isTransistor(item.kind)) {
      const [base, collector, emitter] = terminalsOf(item).map(pointId);
      elements.push(item.kind === 'npn'
        ? npn(item.id, base!, collector!, emitter!, item.value)
        : pnp(item.id, base!, collector!, emitter!, item.value));
    } else {
      const [first, second] = endsOf(item);
      const a = pointId(first);
      const b = pointId(second);
      const short = (): CircuitElement =>
        shorts === 'wires' ? wire(item.id, a, b) : voltageSource(item.id, a, b, 0);
      switch (item.kind) {
        case 'resistor':
        case 'variable-resistor':
          elements.push(resistor(item.id, a, b, item.value));
          break;
        case 'voltage-source':
          elements.push(voltageSource(item.id, a, b, item.value));
          break;
        case 'current-source':
          elements.push(currentSource(item.id, a, b, item.value));
          break;
        case 'diode':
          elements.push(diode(item.id, a, b, item.value));
          break;
        case 'zener':
          elements.push(zenerElement(item.id, a, b, item.value));
          break;
        case 'led':
          elements.push(diode(item.id, a, b, item.value));
          break;
        case 'inductor':
        case 'ammeter':
          elements.push(short());
          break;
        case 'switch':
          if (item.closed) elements.push(short());
          break;
        case 'capacitor':
        case 'voltmeter':
          break;
      }
    }
  }

  return { elements };
}

/**
 * The drawing's wiring alone, whatever the elements do: every component becomes a one ohm resistor.
 * Moving an element must keep a capacitor or an open switch attached just like anything else.
 * An op-amp becomes two, one from each input to its output, so all three terminals are tracked.
 */
export function toTopologyCircuit(schematic: Schematic): Circuit {
  const asResistors: Schematic = {
    ...schematic,
    items: schematic.items.map((item) =>
      isComponent(item) && !isThreeTerminal(item.kind) && item.kind !== 'voltage-point'
        ? { ...item, kind: 'resistor', value: Fraction.ONE }
        : item,
    ),
  };
  return {
    elements: toCircuit(asResistors).elements.flatMap((element) =>
      element.kind === 'op-amp'
        ? [
            resistor(`${element.id}:inverting`, element.inverting, element.output, 1),
            resistor(`${element.id}:non-inverting`, element.nonInverting, element.output, 1),
          ]
        : element.kind === 'bjt'
          ? [
              resistor(`${element.id}:base-collector`, element.base, element.collector, 1),
              resistor(`${element.id}:base-emitter`, element.base, element.emitter, 1),
            ]
        : [element],
    ),
  };
}
