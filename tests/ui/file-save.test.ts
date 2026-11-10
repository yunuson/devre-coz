import { describe, expect, it } from 'vitest';
import { tr } from '../../src/i18n/tr';
import { buildExample } from '../../src/ui/editor/examples';
import { drawingFileName, parseSchematic, serializeSchematic } from '../../src/ui/editor/storage';
import { actionForCombo, DEFAULT_BINDINGS } from '../../src/ui/shortcuts';

describe('the saved file’s name', () => {
  it('carries the date', () => {
    expect(drawingFileName(new Date(2026, 10, 27))).toBe('devre-2026-11-27.json');
  });

  it('pads a one-digit month and day with a zero', () => {
    expect(drawingFileName(new Date(2026, 2, 5))).toBe('devre-2026-03-05.json');
  });
});

describe('saving to a file and opening it again', () => {
  it('opens exactly the drawing that was saved', () => {
    const drawing = buildExample('supernode');
    expect(parseSchematic(serializeSchematic(drawing))).toEqual(drawing);
  });

  it('refuses a file that is not a drawing, so nothing gets replaced', () => {
    expect(parseSchematic('{"name":"not a circuit"}')).toBeNull();
    expect(tr.actions.fileInvalid).toContain('açılamadı');
  });
});

describe('the shortcuts', () => {
  it('save with Ctrl+S and open with Ctrl+O', () => {
    expect(actionForCombo(DEFAULT_BINDINGS, 'Ctrl+S')).toBe('save');
    expect(actionForCombo(DEFAULT_BINDINGS, 'Ctrl+O')).toBe('load');
  });
});
