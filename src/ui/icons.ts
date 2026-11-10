const icon = (body: string): string =>
  `<svg class="icon" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;

export const icons = {
  resistor: icon('<path d="M2 16h6l2-5 4 10 4-10 4 10 2-5h6"/>'),
  'variable-resistor': icon('<path d="M2 18h6l2-5 4 10 4-10 4 10 2-5h6M8 27 24 7M24 7h-6M24 7v6"/>'),
  capacitor: icon('<path d="M2 16h11M19 16h11M13 7v18M19 7v18"/>'),
  capacitorCurved: icon('<path d="M2 16h11M19 16h11M13 7v18M19 7Q9 16 19 25"/>'),
  inductor: icon('<path d="M2 18h4a3.3 3.3 0 0 1 6.6 0 3.3 3.3 0 0 1 6.6 0 3.3 3.3 0 0 1 6.6 0H30"/>'),
  switch: icon('<path d="M2 20h7L22 11M23 20h7"/><circle cx="9" cy="20" r="1.6"/><circle cx="23" cy="20" r="1.6"/>'),
  ammeter: icon('<circle cx="16" cy="16" r="9"/><path d="M2 16h5M25 16h5M12 21l4-10 4 10M13.5 17.5h5"/>'),
  voltmeter: icon('<circle cx="16" cy="16" r="9"/><path d="M2 16h5M25 16h5M12 11l4 10 4-10"/>'),
  'voltage-source': icon(
    '<circle cx="16" cy="16" r="9"/><path d="M16 2v5M16 25v5M13 12.5h6M16 9.5v6M13 20.5h6"/>',
  ),
  'current-source': icon(
    '<circle cx="16" cy="16" r="9"/><path d="M16 2v5M16 25v5M16 21V11M12.5 14.5 16 11l3.5 3.5"/>',
  ),
  'voltage-point': icon('<path d="M3 16h12"/><circle cx="21" cy="16" r="5"/>'),
  diode: icon('<path d="M2 16h8m12 0h8M10 8l12 8-12 8zM22 8v16"/>'),
  zener: icon('<path d="M2 16h8m12 0h8M10 8l12 8-12 8zM14 9l4 3v8l4 3"/>'),
  led: icon('<path d="M2 16h8m12 0h8M10 8l12 8-12 8zM22 8v16M13 10l5-5m-1 0h-4m4 0v4M17 15l5-5m-1 0h-4m4 0v4"/>'),
  'op-amp': icon('<path d="M8 5v22l18-11zM2 11h6M2 21h6M26 16h4M10.5 11h4M10.5 21h4M12.5 19v4"/>'),
  npn: icon('<path d="M2 16h10m0-7v14m0-12 9-6v-4m-9 14 9 6v4m-4-7 5 1-3-5"/>'),
  pnp: icon('<path d="M2 16h10m0-7v14m0-12 9-6v-4m-9 14 9 6v4m-5-5-4-5 6 1"/>'),
  ground: icon('<path d="M16 4v13M7 17h18M11 22h10M14.5 27h3"/>'),
  wire: icon('<path d="M5 25h11V7h11"/><circle cx="5" cy="25" r="2"/><circle cx="27" cy="7" r="2"/>'),
  select: icon('<path d="m9 5 15 11-7 1.5L13 25z"/>'),
  remove: icon('<path d="M6 9h20M13 9V5h6v4M9 9l1.5 18h11L23 9"/>'),
  undo: icon('<path d="M11 7 5 13l6 6M5 13h14a7 7 0 0 1 0 14h-4"/>'),
  redo: icon('<path d="m21 7 6 6-6 6M27 13H13a7 7 0 0 0 0 14h4"/>'),
  run: icon('<path d="M10 6v20l16-10z"/>'),
  stop: icon('<rect x="8" y="8" width="16" height="16" rx="2"/>'),
  steps: icon('<path d="M13 7h15M13 16h15M13 25h15"/><circle cx="5" cy="7" r="1.5"/><circle cx="5" cy="16" r="1.5"/><circle cx="5" cy="25" r="1.5"/>'),
  panel: icon('<rect x="4" y="6" width="24" height="20" rx="3"/><path d="M20 6v20"/>'),
  error: icon('<circle cx="16" cy="16" r="12"/><path d="M16 9v9M16 22.5v.5"/>'),
  warning: icon('<path d="M16 5 3 27h26zM16 13v7M16 23.5v.5"/>'),
  ok: icon('<path d="m6 17 7 7 13-15"/>'),
};
