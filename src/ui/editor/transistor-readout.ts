import type { AnalysisResult, ElementId } from '../../core';
import { tr } from '../../i18n/tr';
import { formatQuantity } from '../format';
import { isTransistor, type ComponentItem } from './schematic';

export interface TransistorReadoutRow {
  readonly label: string;
  readonly value: string;
}

export function transistorReadout(item: ComponentItem, analysis: AnalysisResult | null | undefined): TransistorReadoutRow[] | null {
  if (!isTransistor(item.kind) || !analysis || analysis.status !== 'solved') return null;
  const data = analysis.transistors?.get(item.id as ElementId);
  const state = analysis.transistorStates?.find(({ transistorId }) => transistorId === item.id)?.state;
  if (!data || !state) return null;
  const voltage = item.kind === 'npn' ? data.vc.sub(data.ve) : data.ve.sub(data.vc);
  return [
    { label: tr.inspector.region, value: tr.inspector[state] },
    { label: tr.inspector.transistor.ib, value: formatQuantity(data.ib, 'A') },
    { label: tr.inspector.transistor.ic, value: formatQuantity(data.ic, 'A') },
    { label: tr.inspector.transistor.ie, value: formatQuantity(data.ie, 'A') },
    { label: item.kind === 'npn' ? tr.inspector.transistor.vce : tr.inspector.transistor.vec, value: formatQuantity(voltage, 'V') },
  ];
}
