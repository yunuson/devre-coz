import { describe, expect, it } from 'vitest';
import { History } from '../../src/ui/editor/history';
import {
  actionForCombo,
  assignBinding,
  comboFromKey,
  DEFAULT_BINDINGS,
  mergeBindings,
  type KeyInput,
} from '../../src/ui/shortcuts';

const key = (name: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('History', () => {
  it('undoes and redoes in order', () => {
    const history = new History(1);
    history.commit(2);
    history.commit(3);
    expect(history.undo()).toBe(true);
    expect(history.current).toBe(2);
    expect(history.undo()).toBe(true);
    expect(history.current).toBe(1);
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(true);
    expect(history.current).toBe(2);
  });

  it('drops redo steps after a new change', () => {
    const history = new History(1);
    history.commit(2);
    history.undo();
    history.commit(5);
    expect(history.redo()).toBe(false);
    expect(history.current).toBe(5);
  });

  it('treats replace as part of the last step', () => {
    const history = new History(1);
    history.commit(2);
    history.replace(3);
    history.replace(4);
    history.undo();
    expect(history.current).toBe(1);
    history.redo();
    expect(history.current).toBe(4);
  });
});

describe('comboFromKey', () => {
  it('names keys consistently', () => {
    expect(comboFromKey(key('r'))).toBe('R');
    expect(comboFromKey(key('R'))).toBe('R');
    expect(comboFromKey(key(' '))).toBe('Space');
    expect(comboFromKey(key('Delete'))).toBe('Delete');
    expect(comboFromKey(key('z', { ctrlKey: true }))).toBe('Ctrl+Z');
    expect(comboFromKey(key('z', { metaKey: true }))).toBe('Ctrl+Z');
    expect(comboFromKey(key('z', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Z');
    expect(comboFromKey(key('F2', { shiftKey: true }))).toBe('Shift+F2');
  });

  it('treats both Turkish i keys as I', () => {
    expect(comboFromKey(key('i'))).toBe('I');
    expect(comboFromKey(key('ı'))).toBe('I');
  });

  it('ignores modifier keys alone and reserved keys', () => {
    for (const name of ['Control', 'Shift', 'Alt', 'Meta', 'Escape', 'Tab']) {
      expect(comboFromKey(key(name))).toBeNull();
    }
  });
});

describe('bindings', () => {
  it('has no key assigned twice by default', () => {
    // Tools without a key (the LED, the PNP) are all null, which is not a shared key.
    const keys = Object.values(DEFAULT_BINDINGS).filter((key) => key !== null);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('finds the action for a key', () => {
    expect(actionForCombo(DEFAULT_BINDINGS, 'Space')).toBe('rotate');
    // K is still free; Z went to the Zener diode in task 14.
    expect(actionForCombo(DEFAULT_BINDINGS, 'K')).toBeUndefined();
  });

  it('uses the letters from the course notes', () => {
    expect(actionForCombo(DEFAULT_BINDINGS, 'C')).toBe('capacitor');
    expect(actionForCombo(DEFAULT_BINDINGS, 'L')).toBe('inductor');
    expect(actionForCombo(DEFAULT_BINDINGS, 'S')).toBe('switch');
    expect(actionForCombo(DEFAULT_BINDINGS, 'V')).toBe('voltage-source');
  });

  it('moves a key that is reassigned, leaving the old action without one', () => {
    const next = assignBinding(DEFAULT_BINDINGS, 'rotate', 'R');
    expect(next.rotate).toBe('R');
    expect(next.resistor).toBeNull();
    expect(actionForCombo(next, 'R')).toBe('rotate');
    expect(DEFAULT_BINDINGS.resistor).toBe('R');
  });

  it('can clear a key', () => {
    expect(assignBinding(DEFAULT_BINDINGS, 'run', null).run).toBeNull();
  });

  it('survives missing or malformed saved data', () => {
    expect(mergeBindings(null)).toEqual(DEFAULT_BINDINGS);
    expect(mergeBindings('nope')).toEqual(DEFAULT_BINDINGS);
    const merged = mergeBindings({ rotate: 'T', wire: null, undo: 7, unknown: 'Q' });
    expect(merged.rotate).toBe('T');
    expect(merged.wire).toBeNull();
    expect(merged.undo).toBe('Ctrl+Z');
    expect(merged).not.toHaveProperty('unknown');
  });
});
