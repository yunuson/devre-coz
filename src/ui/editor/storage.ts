import { Fraction } from '../../core';
import {
  COMPONENT_KINDS,
  EMPTY_SCHEMATIC,
  type ComponentItem,
  type ComponentKind,
  type Rotation,
  type Schematic,
  type SchematicItem,
} from './schematic';

/**
 * Keeps the drawing across page reloads, in this browser only. The format has a version, so a
 * later change can still read or knowingly drop what an older version saved.
 */

const STORAGE_KEY = 'devre-coz.drawing';
const FORMAT_VERSION = 1;

type Stored = Record<string, unknown>;

const fractionText = (value: Fraction): string => `${value.num}/${value.den}`;

function parseFraction(value: unknown): Fraction | null {
  if (typeof value !== 'string') return null;
  const match = /^(-?\d{1,400})\/(\d{1,400})$/.exec(value);
  if (!match || /^0+$/.test(match[2]!)) return null;
  return Fraction.ratio(BigInt(match[1]!), BigInt(match[2]!));
}

const isCellNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000;

const isRotation = (value: unknown): value is Rotation => value === 0 || value === 1 || value === 2 || value === 3;

function storedItem(item: SchematicItem): Stored {
  if (item.kind === 'wire' || item.kind === 'ground') return { ...item };
  const { value, maxValue, ...rest } = item;
  return {
    ...rest,
    value: fractionText(value),
    ...(maxValue ? { maxValue: fractionText(maxValue) } : {}),
  };
}

export function serializeSchematic(schematic: Schematic): string {
  return JSON.stringify({ version: FORMAT_VERSION, items: schematic.items.map(storedItem) });
}

function parseItem(raw: unknown): SchematicItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Stored;
  if (typeof item.id !== 'string' || !/^e\d{1,9}$/.test(item.id)) return null;
  const id = item.id;

  if (item.kind === 'wire') {
    const { x1, y1, x2, y2 } = item;
    if (!isCellNumber(x1) || !isCellNumber(y1) || !isCellNumber(x2) || !isCellNumber(y2)) return null;
    const wire = { kind: 'wire', id, x1, y1, x2, y2 } as const;
    // Wires are always straight and never empty.
    if ((wire.x1 !== wire.x2 && wire.y1 !== wire.y2) || (wire.x1 === wire.x2 && wire.y1 === wire.y2)) return null;
    return wire;
  }
  if (!isCellNumber(item.x) || !isCellNumber(item.y)) return null;
  if (item.kind === 'ground') return { kind: 'ground', id, x: item.x, y: item.y };

  if (!(COMPONENT_KINDS as readonly unknown[]).includes(item.kind)) return null;
  if (typeof item.label !== 'string' || item.label.trim() === '' || item.label.length > 40) return null;
  if (!isRotation(item.rotation)) return null;
  const value = parseFraction(item.value);
  if (!value) return null;
  const maxValue = item.maxValue === undefined ? undefined : parseFraction(item.maxValue);
  if (maxValue === null) return null;

  const component: ComponentItem = {
    kind: item.kind as ComponentKind,
    id,
    label: item.label,
    x: item.x,
    y: item.y,
    rotation: item.rotation,
    value,
    ...(typeof item.closed === 'boolean' ? { closed: item.closed } : {}),
    ...(maxValue ? { maxValue } : {}),
    ...(item.mirrored === true ? { mirrored: true } : {}),
  };
  return component;
}

/** Null when the text isn't a drawing this version can read, so nothing half-broken is loaded. */
export function parseSchematic(text: string): Schematic | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { version, items } = data as Stored;
  if (version !== FORMAT_VERSION || !Array.isArray(items)) return null;

  const parsed: SchematicItem[] = [];
  for (const raw of items) {
    const item = parseItem(raw);
    if (!item) return null;
    parsed.push(item);
  }
  const ids = parsed.map((item) => item.id);
  if (new Set(ids).size !== ids.length) return null;

  // New elements must never reuse an id, so the counter starts past the largest one saved.
  const largest = Math.max(0, ...ids.map((id) => Number(id.slice(1))));
  return { items: parsed, nextId: largest + 1 };
}

// Storage can throw or come back empty (private window, blocked site data), so drawing still works without it.
export function loadDrawing(): Schematic {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return (text && parseSchematic(text)) || EMPTY_SCHEMATIC;
  } catch {
    return EMPTY_SCHEMATIC;
  }
}

export function saveDrawing(schematic: Schematic): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeSchematic(schematic));
  } catch {
    // The drawing still works; it just won't survive a reload.
  }
}

/** File name for a saved drawing: devre-YYYY-MM-DD.json. */
export function drawingFileName(date: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `devre-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}
