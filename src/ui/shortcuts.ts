export const ACTION_IDS = [
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
  'op-amp',
  'npn',
  'pnp',
  'ground',
  'wire',
  'switch',
  'ammeter',
  'voltmeter',
  'select',
  'remove',
  'rotate',
  'flip',
  'delete',
  'select-all',
  'copy',
  'cut',
  'paste',
  'undo',
  'redo',
  'run',
  'save',
  'load',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];
export type Bindings = Readonly<Record<ActionId, string | null>>;

/** Letters follow the course notes where they give one: R, C, L, V, I and "S anahtarı". */
export const DEFAULT_BINDINGS: Bindings = {
  resistor: 'R',
  'variable-resistor': 'P',
  capacitor: 'C',
  inductor: 'L',
  'voltage-source': 'V',
  'current-source': 'I',
  'voltage-point': 'N',
  diode: 'D',
  zener: 'Z',
  led: null,
  'op-amp': 'O',
  npn: 'T',
  pnp: null,
  ground: 'G',
  wire: 'W',
  switch: 'S',
  ammeter: 'A',
  voltmeter: 'M',
  select: 'Q',
  remove: 'X',
  rotate: 'Space',
  flip: 'F',
  delete: 'Delete',
  'select-all': 'Ctrl+A',
  copy: 'Ctrl+C',
  cut: 'Ctrl+X',
  paste: 'Ctrl+V',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Y',
  run: 'Ctrl+Enter',
  save: 'Ctrl+S',
  load: 'Ctrl+O',
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead']);
/** Escape always cancels and Tab always moves focus, so neither can be assigned. */
const RESERVED_KEYS = new Set(['Escape', 'Tab']);

export interface KeyInput {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** "Ctrl+Z", "Space", "R". Returns null for keys that can't be a shortcut. Cmd counts as Ctrl. */
export function comboFromKey(event: KeyInput): string | null {
  if (MODIFIER_KEYS.has(event.key) || RESERVED_KEYS.has(event.key)) return null;
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const parts: string[] = [];
  const hasCommandModifier = event.ctrlKey || event.metaKey || event.altKey;
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  // Shift alone on a character is just that character: the key already reflects it.
  if (event.shiftKey && (key.length > 1 || hasCommandModifier)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

export function actionForCombo(bindings: Bindings, combo: string): ActionId | undefined {
  return ACTION_IDS.find((action) => bindings[action] === combo);
}

/** Assigns a key. A key does one thing only, so any action that held it loses it. */
export function assignBinding(bindings: Bindings, action: ActionId, combo: string | null): Bindings {
  const next: Record<ActionId, string | null> = { ...bindings };
  if (combo !== null) {
    for (const other of ACTION_IDS) {
      if (next[other] === combo) next[other] = null;
    }
  }
  next[action] = combo;
  return next;
}

/** Keeps known actions from saved data and uses the default for anything missing or malformed. */
export function mergeBindings(saved: unknown): Bindings {
  const next: Record<ActionId, string | null> = { ...DEFAULT_BINDINGS };
  if (saved && typeof saved === 'object') {
    const record = saved as Record<string, unknown>;
    for (const action of ACTION_IDS) {
      const value = record[action];
      if (value === null || typeof value === 'string') next[action] = value;
    }
  }
  return next;
}

const STORAGE_KEY = 'devre-coz.shortcuts';

export function loadBindings(): Bindings {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? mergeBindings(JSON.parse(text)) : DEFAULT_BINDINGS;
  } catch {
    return DEFAULT_BINDINGS;
  }
}

export function saveBindings(bindings: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Shortcuts still work for this visit; they just aren't remembered.
  }
}
