import { buildNetlist, REFERENCE_NODE, type ElementId } from '../../core';
import {
  endsOf,
  isComponent,
  isTransistor,
  isThreeTerminal,
  nextRotation,
  terminalsOf,
  toTopologyCircuit,
  turnOffset,
  wiresUnderBodies,
  type Cell,
  type ComponentItem,
  type Schematic,
  type SchematicItem,
  type WireItem,
} from './schematic';

/**
 * Keeps wires attached when an element moves or turns. Wires stretch and bend at right angles,
 * and a move is refused rather than letting a new bend touch something and change the circuit.
 */

export type MoveResult = { readonly status: 'moved'; readonly schematic: Schematic } | { readonly status: 'blocked' };

/** How one wire reaches its new end: by sliding a corner, or with a new bend either way round. */
type RouteStyle = 'slide' | 'axis' | 'cross';

const ROUTE_STYLES: readonly RouteStyle[] = ['slide', 'axis', 'cross'];

/** How far a detour steps sideways, in cells. Two widths, so two detours can avoid each other. */
const DETOUR_WIDTHS: readonly number[] = [1, 2];

/** Beyond this many wires to reroute, trying every combination would take too long. */
const MAX_COMBINED_ROUTES = 5;

const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;
const isWire = (item: SchematicItem): item is WireItem => item.kind === 'wire';
const isHorizontal = (wire: WireItem): boolean => wire.y1 === wire.y2;
const wireStart = (wire: WireItem): Cell => ({ x: wire.x1, y: wire.y1 });
const wireEnd = (wire: WireItem): Cell => ({ x: wire.x2, y: wire.y2 });
const isZeroLength = (wire: WireItem): boolean => sameCell(wireStart(wire), wireEnd(wire));

function isStrictlyInside(cell: Cell, wire: WireItem): boolean {
  if (wire.y1 === wire.y2 && cell.y === wire.y1) {
    return cell.x > Math.min(wire.x1, wire.x2) && cell.x < Math.max(wire.x1, wire.x2);
  }
  if (wire.x1 === wire.x2 && cell.x === wire.x1) {
    return cell.y > Math.min(wire.y1, wire.y2) && cell.y < Math.max(wire.y1, wire.y2);
  }
  return false;
}

/** The cells where an element connects to the rest of the drawing. */
export function attachmentCells(item: SchematicItem): readonly Cell[] {
  if (isWire(item)) return [wireStart(item), wireEnd(item)];
  if (item.kind === 'ground') return [item];
  return terminalsOf(item);
}

/** Wires ending exactly on one of this element's connection cells. */
export function attachedWireIds(schematic: Schematic, item: SchematicItem): ReadonlySet<ElementId> {
  const cells = attachmentCells(item);
  return new Set(
    schematic.items
      .filter(isWire)
      .filter(
        (wire) =>
          wire.id !== item.id &&
          cells.some((cell) => sameCell(cell, wireStart(wire)) || sameCell(cell, wireEnd(wire))),
      )
      .map((wire) => wire.id),
  );
}

interface CellConnections {
  /** Wires that end on this cell. */
  readonly wireEnds: readonly WireItem[];
  /** Everything else here: terminals, grounds and wires passing straight through. */
  readonly others: number;
}

function connectionsAt(items: readonly SchematicItem[], cell: Cell): CellConnections {
  const wireEnds: WireItem[] = [];
  let others = 0;
  for (const item of items) {
    if (isWire(item)) {
      if (sameCell(wireStart(item), cell) || sameCell(wireEnd(item), cell)) wireEnds.push(item);
      else if (isStrictlyInside(cell, item)) others++;
    } else if (attachmentCells(item).some((other) => sameCell(other, cell))) {
      others++;
    }
  }
  return { wireEnds, others };
}

interface Workspace {
  items: SchematicItem[];
  nextId: number;
}

function replaceWire(space: Workspace, id: ElementId, from: Cell, to: Cell): void {
  space.items = space.items.map((item) =>
    item.id === id ? { kind: 'wire', id, x1: from.x, y1: from.y, x2: to.x, y2: to.y } : item,
  );
}

function addWirePiece(space: Workspace, from: Cell, to: Cell): void {
  space.items.push({ kind: 'wire', id: `e${space.nextId++}`, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
}

/** Moves one end of a wire, keeping every piece horizontal or vertical. */
function stretchWire(space: Workspace, wire: WireItem, oldEnd: Cell, newEnd: Cell, style: RouteStyle): void {
  const far = sameCell(wireStart(wire), oldEnd) ? wireEnd(wire) : wireStart(wire);
  const horizontal = isHorizontal(wire);

  if (style === 'slide') {
    // A plain corner can slide along, so an L-shaped run stays L-shaped instead of gaining bends.
    const atFar = connectionsAt(space.items, far);
    const neighbour = atFar.wireEnds.find((other) => other.id !== wire.id);
    if (
      atFar.others === 0 &&
      atFar.wireEnds.length === 2 &&
      neighbour &&
      isHorizontal(neighbour) !== horizontal &&
      !isZeroLength(neighbour)
    ) {
      const corner: Cell = horizontal ? { x: far.x, y: newEnd.y } : { x: newEnd.x, y: far.y };
      const neighbourFar = sameCell(wireStart(neighbour), far) ? wireEnd(neighbour) : wireStart(neighbour);
      replaceWire(space, wire.id, corner, newEnd);
      replaceWire(space, neighbour.id, neighbourFar, corner);
      return;
    }
  }

  // Normally the wire keeps its direction first and turns at the end; 'cross' turns first.
  const keepDirection = style !== 'cross';
  const corner: Cell = horizontal === keepDirection ? { x: newEnd.x, y: far.y } : { x: far.x, y: newEnd.y };
  replaceWire(space, wire.id, far, corner);
  if (!sameCell(corner, newEnd)) addWirePiece(space, corner, newEnd);
}

function reconnect(space: Workspace, oldCell: Cell, newCell: Cell, style: RouteStyle): void {
  if (sameCell(oldCell, newCell)) return;
  const here = connectionsAt(space.items, oldCell);

  if (here.wireEnds.length === 1 && here.others === 0) {
    stretchWire(space, here.wireEnds[0]!, oldCell, newCell, style);
  } else if (here.wireEnds.length > 0 || here.others > 0) {
    // A junction stays where it is; a new wire runs from it to the moved element.
    const horizontalFirst = style !== 'cross';
    const corner: Cell = horizontalFirst ? { x: newCell.x, y: oldCell.y } : { x: oldCell.x, y: newCell.y };
    if (!sameCell(oldCell, corner)) addWirePiece(space, oldCell, corner);
    if (!sameCell(corner, newCell)) addWirePiece(space, corner, newCell);
  }
}

/**
 * A route that reaches the terminal from outside the element, so it doesn't run under its body.
 * An op-amp's inputs share a column, so a straight wire to one can run through the other.
 */
function approachFromOutside(
  space: Workspace,
  oldCell: Cell,
  newCell: Cell,
  outward: Cell,
  width: number,
  horizontalFirst: boolean,
): void {
  const entry: Cell = { x: newCell.x + outward.x * width, y: newCell.y + outward.y * width };
  const corner: Cell = horizontalFirst ? { x: entry.x, y: oldCell.y } : { x: oldCell.x, y: entry.y };
  addWirePiece(space, oldCell, corner);
  addWirePiece(space, corner, entry);
  addWirePiece(space, entry, newCell);
}

/**
 * Joins two wires lying partly on top of each other into one. Overlapping wires are always on the
 * same node, so this changes nothing, unless a third wire crosses through an end that disappears:
 * that end is what connected the crossing wire, so those two stay as they are.
 */
function mergeOverlap(items: readonly SchematicItem[]): SchematicItem[] | null {
  const all = items.filter(isWire);
  for (const first of all) {
    for (const second of all) {
      if (first.id >= second.id || isHorizontal(first) !== isHorizontal(second)) continue;
      const horizontal = isHorizontal(first);
      const line = (wire: WireItem): number => (horizontal ? wire.y1 : wire.x1);
      if (line(first) !== line(second)) continue;
      const span = (wire: WireItem): [number, number] => {
        const [a, b] = horizontal ? [wire.x1, wire.x2] : [wire.y1, wire.y2];
        return [Math.min(a, b), Math.max(a, b)];
      };
      const [a1, a2] = span(first);
      const [b1, b2] = span(second);
      if (Math.max(a1, b1) >= Math.min(a2, b2)) continue;

      const low = Math.min(a1, b1);
      const high = Math.max(a2, b2);
      const at = (position: number): Cell =>
        horizontal ? { x: position, y: line(first) } : { x: line(first), y: position };
      const lost = [a1, a2, b1, b2].filter((position) => position !== low && position !== high).map(at);
      const others = all.filter((wire) => wire.id !== first.id && wire.id !== second.id);
      if (lost.some((cell) => others.some((wire) => isStrictlyInside(cell, wire)))) continue;

      const start = at(low);
      const end = at(high);
      const joined: WireItem = { kind: 'wire', id: first.id, x1: start.x, y1: start.y, x2: end.x, y2: end.y };
      return items.filter((item) => item.id !== second.id).map((item) => (item.id === first.id ? joined : item));
    }
  }
  return null;
}

/** Removes empty wires, joins straight runs that were left in two pieces, and merges overlaps. */
function tidyWires(items: readonly SchematicItem[]): SchematicItem[] {
  let current = items.filter((item) => !isWire(item) || !isZeroLength(item));

  for (let merged = true; merged; ) {
    merged = false;
    const overlapFree = mergeOverlap(current);
    if (overlapFree) {
      current = overlapFree;
      merged = true;
      continue;
    }
    for (const first of current.filter(isWire)) {
      for (const cell of [wireStart(first), wireEnd(first)]) {
        const { wireEnds, others } = connectionsAt(current, cell);
        if (others !== 0 || wireEnds.length !== 2) continue;
        const second = wireEnds.find((wire) => wire.id !== first.id);
        if (!second || isHorizontal(second) !== isHorizontal(first)) continue;

        const firstFar = sameCell(wireStart(first), cell) ? wireEnd(first) : wireStart(first);
        const secondFar = sameCell(wireStart(second), cell) ? wireEnd(second) : wireStart(second);
        const joined: SchematicItem = {
          kind: 'wire',
          id: first.id,
          x1: firstFar.x,
          y1: firstFar.y,
          x2: secondFar.x,
          y2: secondFar.y,
        };
        current = current
          .filter((item) => item.id !== second.id)
          .map((item) => (item.id === first.id ? joined : item))
          .filter((item) => !isWire(item) || !isZeroLength(item));
        merged = true;
        break;
      }
      if (merged) break;
    }
  }
  return current;
}

/** Which terminals are electrically joined. Two drawings with the same signature are the same circuit. */
export function electricalSignature(schematic: Schematic): string {
  const netlist = buildNetlist(toTopologyCircuit(schematic));
  const names = new Map<number, number>();
  const nameOf = (node: number): string => {
    if (netlist.hasReference && node === 0) return 'G';
    if (!names.has(node)) names.set(node, names.size + 1);
    return String(names.get(node));
  };
  return [...netlist.components]
    .sort((a, b) => (a.element.id < b.element.id ? -1 : 1))
    .map(({ element, a, b }) => `${element.id}:${nameOf(a)}-${nameOf(b)}`)
    .join(',');
}

/**
 * True when everything joined in `before` is still joined in `after`. New connections are fine,
 * since dropping an element onto something is a way of connecting it, but none may be lost.
 */
export function keepsConnections(before: Schematic, after: Schematic): boolean {
  const nodesOf = (schematic: Schematic) => {
    const netlist = buildNetlist(toTopologyCircuit(schematic));
    const nodes = new Map<string, number>();
    for (const { element, a, b } of netlist.components) {
      nodes.set(`${element.id}:a`, a);
      nodes.set(`${element.id}:b`, b);
    }
    return { nodes, hasReference: netlist.hasReference };
  };
  const first = nodesOf(before);
  const second = nodesOf(after);

  const destination = new Map<number, number>();
  // Whatever was on ground must still be on ground.
  if (first.hasReference && second.hasReference) destination.set(REFERENCE_NODE, REFERENCE_NODE);
  for (const [terminal, node] of first.nodes) {
    const next = second.nodes.get(terminal);
    if (next === undefined) return false;
    const expected = destination.get(node);
    if (expected !== undefined && expected !== next) return false;
    destination.set(node, next);
  }
  return true;
}

/** True when a moved element ends up on something it wasn't touching. That is a deliberate new connection. */
export function landsOnSomething(schematic: Schematic, before: SchematicItem, after: SchematicItem): boolean {
  const others = schematic.items.filter((item) => item.id !== before.id);
  const own = attachedWireIds(schematic, before);
  const fixed = others.filter((item) => !own.has(item.id));
  const oldCells = attachmentCells(before);
  return attachmentCells(after).some((cell) => {
    if (oldCells.some((old) => sameCell(old, cell))) return false;
    const { wireEnds, others: rest } = connectionsAt(fixed, cell);
    return wireEnds.length > 0 || rest > 0;
  });
}

/**
 * True when a move ties together two terminals of the moved element that weren't tied before.
 * Dropping an element onto something connects it, but nobody means to short an element to itself.
 */
function joinsOwnTerminals(before: Schematic, after: Schematic, oldItem: SchematicItem, newItem: SchematicItem): boolean {
  if (!isComponent(oldItem) || !isComponent(newItem)) return false;
  const nodesOf = (schematic: Schematic, item: ComponentItem): number[] => {
    const { pointToNode } = buildNetlist(toTopologyCircuit(schematic));
    return terminalsOf(item).map(({ x, y }) => pointToNode.get(`${x},${y}`)!);
  };
  const oldNodes = nodesOf(before, oldItem);
  const newNodes = nodesOf(after, newItem);
  return newNodes.some((node, first) =>
    newNodes.some((other, second) => second > first && node === other && oldNodes[first] !== oldNodes[second]),
  );
}

function relocate(
  schematic: Schematic,
  before: SchematicItem,
  after: SchematicItem,
  mayConnect: boolean,
): MoveResult {
  const index = schematic.items.findIndex((item) => item.id === before.id);
  const newCells = attachmentCells(after);
  const moves = attachmentCells(before).map((from, terminal) => ({ from, to: newCells[terminal]! }));

  // Whatever joins a moved wire partway along must come with it, not just what's at its ends.
  if (isWire(before) && isWire(after)) {
    const dx = after.x1 - before.x1;
    const dy = after.y1 - before.y1;
    const seen = new Set<string>();
    for (const item of schematic.items) {
      if (item.id === before.id) continue;
      for (const cell of attachmentCells(item)) {
        const key = `${cell.x},${cell.y}`;
        if (seen.has(key) || !isStrictlyInside(cell, before)) continue;
        seen.add(key);
        moves.push({ from: cell, to: { x: cell.x + dx, y: cell.y + dy } });
      }
    }
  }

  const signature = electricalSignature(schematic);
  const deliberate = mayConnect && landsOnSomething(schematic, before, after);
  const underBefore = wiresUnderBodies(schematic);
  const accepts = (result: Schematic): boolean =>
    wiresUnderBodies(result) <= underBefore &&
    (deliberate
      ? keepsConnections(schematic, result) && !joinsOwnTerminals(schematic, result, before, after)
      : electricalSignature(result) === signature);

  // Every combination of routes, neatest first. A rotation often needs each end to take a different one.
  const combinations =
    moves.length <= MAX_COMBINED_ROUTES
      ? moves.reduce<RouteStyle[][]>(
          (partial) => partial.flatMap((styles) => ROUTE_STYLES.map((style) => [...styles, style])),
          [[]],
        )
      : ROUTE_STYLES.map((style) => moves.map(() => style));

  for (const styles of combinations) {
    const space: Workspace = {
      items: schematic.items.filter((item) => item.id !== before.id),
      nextId: schematic.nextId,
    };
    moves.forEach(({ from, to }, position) => reconnect(space, from, to, styles[position]!));

    const items = [...space.items];
    items.splice(index, 0, after);
    const result: Schematic = { items: tidyWires(items), nextId: space.nextId };
    if (accepts(result)) return { status: 'moved', schematic: result };
  }
  return isComponent(before) && isThreeTerminal(before.kind)
    ? relocateWithDetours(schematic, before, after as ComponentItem, moves, index, accepts)
    : { status: 'blocked' };
}

/** The last resort for an op-amp: any terminal's wire may go around and come in from outside. */
function relocateWithDetours(
  schematic: Schematic,
  before: ComponentItem,
  after: ComponentItem,
  moves: readonly { readonly from: Cell; readonly to: Cell }[],
  index: number,
  accepts: (result: Schematic) => boolean,
): MoveResult {
  type Route =
    | { readonly style: RouteStyle }
    | { readonly width: number; readonly horizontalFirst: boolean };
  const routes: readonly Route[] = [
    ...ROUTE_STYLES.map((style) => ({ style })),
    ...DETOUR_WIDTHS.flatMap((width) => [
      { width, horizontalFirst: true },
      { width, horizontalFirst: false },
    ]),
  ];
  const combinations = moves.reduce<Route[][]>(
    (partial) => partial.flatMap((chosen) => routes.map((route) => [...chosen, route])),
    [[]],
  );

  // Op-amp inputs face backward; transistor terminals follow their own branch directions.
  const outwardOf = (terminal: number): Cell => {
    if (isTransistor(after.kind)) {
      const point = terminalsOf(after)[terminal]!;
      const dx = point.x - after.x;
      const dy = point.y - after.y;
      return Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    }
    return turnOffset(terminal === 2 ? 1 : -1, 0, after.rotation);
  };

  for (const chosen of combinations) {
    const space: Workspace = {
      items: schematic.items.filter((item) => item.id !== before.id),
      nextId: schematic.nextId,
    };
    moves.forEach(({ from, to }, position) => {
      const route = chosen[position]!;
      if (sameCell(from, to)) return;
      if ('style' in route) reconnect(space, from, to, route.style);
      else approachFromOutside(space, from, to, outwardOf(position), route.width, route.horizontalFirst);
    });

    const items = [...space.items];
    items.splice(index, 0, after);
    const result: Schematic = { items: tidyWires(items), nextId: space.nextId };
    if (accepts(result)) return { status: 'moved', schematic: result };
  }
  return { status: 'blocked' };
}

/**
 * Moves several elements together. They keep their shape among themselves, and only the wires
 * leading out of the group stretch. A group move must leave the circuit exactly as it was: it
 * never counts as dropping something onto a new connection.
 */
export function moveGroupWithWires(
  schematic: Schematic,
  ids: ReadonlySet<ElementId>,
  dx: number,
  dy: number,
): MoveResult {
  const group = schematic.items.filter((item) => ids.has(item.id));
  if (group.length === 0) return { status: 'blocked' };
  if (group.length === 1) return moveWithWires(schematic, group[0]!.id, dx, dy);

  const outside = schematic.items.filter((item) => !ids.has(item.id));
  const shift = (cell: Cell): Cell => ({ x: cell.x + dx, y: cell.y + dy });
  const moved = group.map((item): SchematicItem =>
    isWire(item)
      ? { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy }
      : { ...item, x: item.x + dx, y: item.y + dy },
  );

  // Where the group meets the rest: its own connection points, and points partway along its wires.
  const seen = new Set<string>();
  const moves: { from: Cell; to: Cell }[] = [];
  const addMove = (cell: Cell): void => {
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    const { wireEnds, others } = connectionsAt(outside, cell);
    if (wireEnds.length > 0 || others > 0) moves.push({ from: cell, to: shift(cell) });
  };
  group.forEach((item) => attachmentCells(item).forEach(addMove));
  for (const wire of group.filter(isWire)) {
    outside.forEach((item) =>
      attachmentCells(item).filter((cell) => isStrictlyInside(cell, wire)).forEach(addMove),
    );
  }

  const signature = electricalSignature(schematic);
  const underBefore = wiresUnderBodies(schematic);
  const combinations =
    moves.length <= MAX_COMBINED_ROUTES
      ? moves.reduce<RouteStyle[][]>(
          (partial) => partial.flatMap((styles) => ROUTE_STYLES.map((style) => [...styles, style])),
          [[]],
        )
      : ROUTE_STYLES.map((style) => moves.map(() => style));

  for (const styles of combinations) {
    const space: Workspace = { items: [...outside], nextId: schematic.nextId };
    moves.forEach(({ from, to }, position) => reconnect(space, from, to, styles[position]!));
    const result: Schematic = { items: tidyWires([...space.items, ...moved]), nextId: space.nextId };
    if (electricalSignature(result) === signature && wiresUnderBodies(result) <= underBefore) {
      return { status: 'moved', schematic: result };
    }
  }
  return { status: 'blocked' };
}

export function moveWithWires(schematic: Schematic, id: ElementId, dx: number, dy: number): MoveResult {
  const before = schematic.items.find((item) => item.id === id);
  if (!before) return { status: 'blocked' };
  const after: SchematicItem = isWire(before)
    ? { ...before, x1: before.x1 + dx, y1: before.y1 + dy, x2: before.x2 + dx, y2: before.y2 + dy }
    : { ...before, x: before.x + dx, y: before.y + dy };
  return relocate(schematic, before, after, true);
}

/**
 * Turns an element while its wires follow, so each terminal stays on the same wire.
 * Unlike dropping an element somewhere, turning one is never a request for a new connection.
 */
export function rotateWithWires(schematic: Schematic, id: ElementId): MoveResult {
  const before = schematic.items.find((item) => item.id === id);
  if (!before || !isComponent(before)) return { status: 'blocked' };
  return relocate(schematic, before, { ...before, rotation: nextRotation(before.rotation) }, false);
}

/**
 * Deletes an element and joins the wires it was holding apart. The ends stay open when one side
 * has nothing connected, or when joining them would silently short another element. An op-amp's
 * ends always stay open: nothing says which of its three terminals belong together.
 */
export function removeWithWires(schematic: Schematic, id: ElementId): Schematic {
  const item = schematic.items.find((candidate) => candidate.id === id);
  const items = schematic.items.filter((candidate) => candidate.id !== id);
  const plain: Schematic = { ...schematic, items };
  if (!item || !isComponent(item) || isThreeTerminal(item.kind) || item.kind === 'voltage-point') return plain;

  const [first, second] = endsOf(item);
  const isConnected = (cell: Cell): boolean => {
    const { wireEnds, others } = connectionsAt(items, cell);
    return wireEnds.length > 0 || others > 0;
  };
  if (!isConnected(first) || !isConnected(second)) return plain;

  const bridge: WireItem = {
    kind: 'wire',
    id: `e${schematic.nextId}`,
    x1: first.x,
    y1: first.y,
    x2: second.x,
    y2: second.y,
  };
  const joined: Schematic = { items: tidyWires([...items, bridge]), nextId: schematic.nextId + 1 };

  const shortedIds = (candidate: Schematic): Set<ElementId> =>
    new Set(
      buildNetlist(toTopologyCircuit(candidate))
        .components.filter(({ a, b }) => a === b)
        .map(({ element }) => element.id),
    );
  const alreadyShorted = shortedIds(plain);
  const newlyShorted = [...shortedIds(joined)].some((shorted) => !alreadyShorted.has(shorted));
  return newlyShorted ? plain : joined;
}

/**
 * Swaps an element's terminals in place, leaving every wire alone. This is how a source's polarity
 * is reversed, and how an op-amp's + and − inputs change places. Its output stays where it is.
 */
export function flipItem(schematic: Schematic, id: ElementId): Schematic {
  return {
    ...schematic,
    items: schematic.items.map((item) => {
      if (item.id !== id || !isComponent(item)) return item;
      if (item.kind === 'voltage-point') return item;
      return item.kind === 'op-amp'
        ? { ...item, mirrored: !item.mirrored }
        : isTransistor(item.kind)
          ? { ...item, mirrored: !item.mirrored }
        : { ...item, rotation: nextRotation(nextRotation(item.rotation)) };
    }),
  };
}
