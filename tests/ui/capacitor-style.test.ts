import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCapacitorStyle, saveCapacitorStyle } from '../../src/ui/capacitor-style';
import { drawComponentGhost, drawSchematic } from '../../src/ui/editor/render';
import { addComponent, EMPTY_SCHEMATIC, terminalsOf, type ComponentItem, type Rotation } from '../../src/ui/editor/schematic';
import { serializeSchematic } from '../../src/ui/editor/storage';

const options = (capacitorStyle?: 'straight' | 'curved') => ({
  selectedId: null,
  highlights: new Map(),
  solved: null,
  ...(capacitorStyle ? { capacitorStyle } : {}),
});

const capacitor = (rotation: Rotation = 0): ComponentItem =>
  addComponent(EMPTY_SCHEMATIC, 'capacitor', { x: 10, y: 10 }, rotation).items[0] as ComponentItem;

describe('capacitor drawing style', () => {
  it('keeps the straight drawing as the default', () => {
    const item = capacitor();
    const svg = drawSchematic({ ...EMPTY_SCHEMATIC, items: [item] }, options());

    expect(svg).toContain('d="M-40 0H-5M5 0H40M-5 -14V14M5 -14V14"');
  });

  it('draws one curved plate when curved style is selected', () => {
    const item = capacitor();
    const svg = drawSchematic({ ...EMPTY_SCHEMATIC, items: [item] }, options('curved'));

    expect(svg).toContain('M11 -14Q1 0 11 14');
    expect(svg.match(/V14/g)).toHaveLength(1);
  });

  it.each([
    [0, [{ x: 8, y: 10 }, { x: 12, y: 10 }]],
    [1, [{ x: 10, y: 8 }, { x: 10, y: 12 }]],
    [2, [{ x: 12, y: 10 }, { x: 8, y: 10 }]],
    [3, [{ x: 10, y: 12 }, { x: 10, y: 8 }]],
  ] as const)('draws rotation %i without moving its terminals', (rotation, expectedTerminals) => {
    const item = capacitor(rotation);
    const svg = drawSchematic({ ...EMPTY_SCHEMATIC, items: [item] }, options('curved'));

    expect(svg).toContain('M11 -14Q1 0 11 14');
    expect(terminalsOf(item)).toEqual(expectedTerminals);
  });

  it('puts the curved plate on the opposite side after a half turn', () => {
    const first = drawSchematic({ ...EMPTY_SCHEMATIC, items: [capacitor(0)] }, options('curved'));
    const flipped = drawSchematic({ ...EMPTY_SCHEMATIC, items: [capacitor(2)] }, options('curved'));

    expect(first).toContain('rotate(0)');
    expect(flipped).toContain('rotate(180)');
  });

  it('uses the selected style for placement ghosts', () => {
    expect(drawComponentGhost('capacitor', { x: 10, y: 10 }, 0)).not.toContain('Q1 0 11 14');
    expect(drawComponentGhost('capacitor', { x: 10, y: 10 }, 0, false, 'curved')).toContain('M11 -14Q1 0 11 14');
  });

  it('uses straight style when the preference is missing or unknown', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });

    expect(loadCapacitorStyle()).toBe('straight');
    values.set('devre-coz.capacitor-style', 'unknown');
    expect(loadCapacitorStyle()).toBe('straight');
  });

  it('loads and saves the curved preference', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });

    saveCapacitorStyle('curved');

    expect(values.get('devre-coz.capacitor-style')).toBe('curved');
    expect(loadCapacitorStyle()).toBe('curved');
  });

  it('falls back safely when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage unavailable'); },
      setItem: () => { throw new Error('storage unavailable'); },
    });

    expect(loadCapacitorStyle()).toBe('straight');
    expect(() => saveCapacitorStyle('curved')).not.toThrow();
  });

  it('does not add the visual preference to the saved circuit', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    saveCapacitorStyle('curved');

    const saved = serializeSchematic({ ...EMPTY_SCHEMATIC, items: [capacitor()] });
    expect(saved).not.toContain('capacitor-style');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
