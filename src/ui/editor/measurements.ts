import { analyze, Fraction, voltageAt, type AnalysisResult, type ElementId } from '../../core';
import { endsOf, isComponent, toCircuit, type ComponentItem, type Schematic } from './schematic';

/**
 * Readings for the elements the solver doesn't see as such. In DC steady state these are open
 * circuits or plain wires, so the circuit is solved without them and they are read afterwards.
 */

export interface Measurement {
  /** From the first terminal to the second. Null when nothing fixes it, as with both ends floating. */
  readonly voltage: Fraction | null;
  /** From the first terminal to the second. Null when parallel wires leave the split unknown. */
  readonly current: Fraction | null;
}

export interface DrawingAnalysis {
  readonly analysis: AnalysisResult;
  readonly measurements: ReadonlyMap<ElementId, Measurement>;
}

const actsAsWire = (item: ComponentItem): boolean =>
  item.kind === 'inductor' || item.kind === 'ammeter' || (item.kind === 'switch' && item.closed === true);

const actsAsOpen = (item: ComponentItem): boolean =>
  item.kind === 'capacitor' || item.kind === 'voltmeter' || (item.kind === 'switch' && !item.closed);

function cellId(cell: { x: number; y: number }): string {
  return `${cell.x},${cell.y}`;
}

export function analyzeDrawing(schematic: Schematic): DrawingAnalysis {
  const analysis = analyze(toCircuit(schematic));
  const measurements = new Map<ElementId, Measurement>();
  if (analysis.status !== 'solved') return { analysis, measurements };

  const components = schematic.items.filter(isComponent);

  // A second solve in which each wire-like element is a 0 V source, whose current the solver reports.
  const withCurrents = components.some(actsAsWire) ? analyze(toCircuit(schematic, 'zero-sources')) : null;

  for (const item of components) {
    if (actsAsWire(item)) {
      const current = withCurrents?.status === 'solved' ? (withCurrents.elements.get(item.id)?.current ?? null) : null;
      measurements.set(item.id, { voltage: Fraction.ZERO, current });
    } else if (actsAsOpen(item)) {
      const [first, second] = endsOf(item);
      const a = voltageAt(analysis, cellId(first));
      const b = voltageAt(analysis, cellId(second));
      measurements.set(item.id, { voltage: a && b ? a.sub(b) : null, current: Fraction.ZERO });
    }
  }

  return { analysis, measurements };
}

/** The elements a student must replace before solving, for the first step of the solution. */
export function dcEquivalentItems(schematic: Schematic): ComponentItem[] {
  return schematic.items.filter(isComponent).filter((item) => actsAsWire(item) || actsAsOpen(item));
}
