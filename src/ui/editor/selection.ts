import type { ElementId } from '../../core';
import { isComponent, nextLabel, type Cell, type Schematic, type SchematicItem } from './schematic';
import { attachmentCells } from './wire-follow';

/** Working with several elements at once: box selection, copy and paste, deleting a group. */

/** Inclusive, in cells. */
export interface CellBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const boxFromCorners = (a: Cell, b: Cell): CellBox => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  right: Math.max(a.x, b.x),
  bottom: Math.max(a.y, b.y),
});

/** Where an element is, for selecting and copying: its connection points. Its body always lies between them. */
const footprint = (item: SchematicItem): readonly Cell[] => attachmentCells(item);

const inside = (cell: Cell, box: CellBox): boolean =>
  cell.x >= box.left && cell.x <= box.right && cell.y >= box.top && cell.y <= box.bottom;

/** What a selection box takes: only elements entirely inside it, as on the Windows desktop. */
export function itemsInBox(schematic: Schematic, box: CellBox): ElementId[] {
  return schematic.items.filter((item) => footprint(item).every((cell) => inside(cell, box))).map((item) => item.id);
}

export const allIds = (schematic: Schematic): ElementId[] => schematic.items.map((item) => item.id);

/** Deletes a group. Unlike deleting one element, no wires are joined: there is no single gap to close. */
export function removeItems(schematic: Schematic, ids: ReadonlySet<ElementId>): Schematic {
  return { ...schematic, items: schematic.items.filter((item) => !ids.has(item.id)) };
}

export interface Clipboard {
  readonly items: readonly SchematicItem[];
  /** The top-left corner of what was copied. Pasting puts it at the chosen cell. */
  readonly origin: Cell;
}

export function copyItems(schematic: Schematic, ids: ReadonlySet<ElementId>): Clipboard | null {
  const items = schematic.items.filter((item) => ids.has(item.id));
  if (items.length === 0) return null;
  const cells = items.flatMap(footprint);
  return {
    items,
    origin: { x: Math.min(...cells.map((cell) => cell.x)), y: Math.min(...cells.map((cell) => cell.y)) },
  };
}

function shifted(item: SchematicItem, dx: number, dy: number, id: ElementId): SchematicItem {
  return item.kind === 'wire'
    ? { ...item, id, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy }
    : { ...item, id, x: item.x + dx, y: item.y + dy };
}

const onWire = (cell: Cell, wire: SchematicItem): boolean =>
  wire.kind === 'wire' &&
  cell.x >= Math.min(wire.x1, wire.x2) &&
  cell.x <= Math.max(wire.x1, wire.x2) &&
  cell.y >= Math.min(wire.y1, wire.y2) &&
  cell.y <= Math.max(wire.y1, wire.y2);

/** True when the two sets of elements would connect: a connection point of one on any part of the other. */
function touches(first: readonly SchematicItem[], second: readonly SchematicItem[]): boolean {
  const reaches = (from: readonly SchematicItem[], to: readonly SchematicItem[]): boolean => {
    const targets = to.flatMap(footprint);
    return from.flatMap(footprint).some(
      (cell) =>
        targets.some((other) => other.x === cell.x && other.y === cell.y) || to.some((item) => onWire(cell, item)),
    );
  };
  return reaches(first, second) || reaches(second, first);
}

/** How far, in cells, a paste may move to find a free spot before giving up and going where asked. */
const PASTE_SEARCH_RADIUS = 30;

/**
 * The shift that puts the copy's corner at `at`, or the nearest one where it touches nothing, so a
 * paste never quietly joins the copy to what's already drawn there.
 */
function freeShift(existing: readonly SchematicItem[], clipboard: Clipboard, at: Cell): Cell {
  const base = { x: at.x - clipboard.origin.x, y: at.y - clipboard.origin.y };
  for (let radius = 0; radius <= PASTE_SEARCH_RADIUS; radius++) {
    const ring: Cell[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === radius) ring.push({ x: dx, y: dy });
      }
    }
    ring.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    for (const step of ring) {
      const shift = { x: base.x + step.x, y: base.y + step.y };
      const copy = clipboard.items.map((item) => shifted(item, shift.x, shift.y, item.id));
      if (!touches(existing, copy)) return shift;
    }
  }
  return base;
}

/**
 * Adds a copy with its top-left corner at `at`, or as near as it can go without touching anything.
 * Every copy gets a new id, and a name already in use is replaced by the next free one of its
 * kind, so the solution steps never mix two R1s.
 */
export function pasteItems(
  schematic: Schematic,
  clipboard: Clipboard,
  at: Cell,
): { schematic: Schematic; ids: ElementId[] } {
  const { x: dx, y: dy } = freeShift(schematic.items, clipboard, at);
  let nextId = schematic.nextId;
  const items = [...schematic.items];
  const ids: ElementId[] = [];

  for (const original of clipboard.items) {
    const id = `e${nextId++}`;
    let copy = shifted(original, dx, dy, id);
    if (isComponent(copy)) {
      const name = copy.label.toLocaleLowerCase('tr');
      const taken = items.some((item) => isComponent(item) && item.label.toLocaleLowerCase('tr') === name);
      if (taken) copy = { ...copy, label: nextLabel(items, copy.kind) };
    }
    items.push(copy);
    ids.push(id);
  }
  return { schematic: { items, nextId }, ids };
}
