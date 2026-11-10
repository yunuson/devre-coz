import {
  Fraction,
  solveWithSteps,
  type AnalysisResult,
  type ElementId,
  type ElementResult,
  type Issue,
  type IssueSeverity,
} from '../../core';
import { tr } from '../../i18n/tr';
import type { PanelControls } from '../app-shell';
import { escapeHtml, formatBeta, formatBetaValue, formatQuantity, parseBeta, parseQuantity } from '../format';
import {
  dcEquivalentView,
  measuredRow,
  revealsCurrents,
  revealsNodeValues,
  type DcElement,
} from '../steps-panel/step-views';
import { createStepsPanel } from '../steps-panel/steps-panel';
import { loadCapacitorStyle, saveCapacitorStyle, type CapacitorStyle } from '../capacitor-style';
import { icons } from '../icons';
import { setupShortcutsDialog } from '../shortcuts-dialog';
import {
  actionForCombo,
  comboFromKey,
  loadBindings,
  saveBindings,
  type ActionId,
  type Bindings,
} from '../shortcuts';
import { buildExample, type ExampleMenuId } from './examples';
import { History } from './history';
import {
  DEFAULT_CAMERA,
  fitCamera,
  panBy,
  visibleArea,
  zoomAt,
  zoomLabel,
  zoomTo,
  ZOOM_STEP,
  type Camera,
  type Size,
} from './camera';
import {
  CELL_SIZE,
  type StepHighlight,
  drawComponentGhost,
  drawConnectionTarget,
  drawGroundGhost,
  drawSchematic,
  drawWirePreview,
  type SolvedAnalysis,
} from './render';
import {
  addComponent,
  addGround,
  addWire,
  COMPONENT_KINDS,
  connectionCells,
  DEFAULT_ROTATION,
  EMPTY_SCHEMATIC,
  hasSameStructure,
  hasValue,
  isComponentValueValid,
  insertIntoWire,
  isComponent,
  isTransistor,
  labelProblem,
  moveItem,
  nextRotation,
  removeItem,
  setItemLabel,
  setItemValue,
  toCircuit,
  toggleSwitch,
  UNIT_OF,
  type Cell,
  type ComponentItem,
  type ComponentKind,
  type Rotation,
  type Schematic,
  type SchematicItem,
  type ValuedKind,
  type WireInsertion,
} from './schematic';
import { analyzeDrawing, dcEquivalentItems, type Measurement } from './measurements';
import { transistorReadout } from './transistor-readout';
import { drawingFileName, loadDrawing, parseSchematic, saveDrawing, serializeSchematic } from './storage';
import { allIds, copyItems, itemsInBox, pasteItems, removeItems, type Clipboard } from './selection';
import {
  attachedWireIds,
  flipItem,
  moveGroupWithWires,
  moveWithWires,
  removeWithWires,
  rotateWithWires,
} from './wire-follow';

type Tool = ComponentKind | 'ground' | 'wire' | 'select' | 'remove';

/** How close (in pixels) the pointer must be to a connection point to start a wire from it. */
const CONNECTION_HIT_RADIUS = 9;
/** A touchpad sends many wheel events per gesture; this makes one gesture one 90° turn. */
const WHEEL_ROTATE_COOLDOWN_MS = 220;
const DOUBLE_CLICK_MS = 400;
/** The slider stops short of 0 Ω, which isn't a valid resistance. */
const SLIDER_MIN_PERCENT = 1;
/** Room below the symbol, clear of the current readout. */
const SLIDER_GAP = 30;
/** Room around a fitted circuit for labels and current readouts, in pixels. */
const FIT_MARGIN_X = 100;
const FIT_MARGIN_Y = 70;
/** Wheel distance, in pixels, that zooms by one step. A touchpad pinch sends many small ones. */
const WHEEL_PIXELS_PER_ZOOM_STEP = 100;
/** Browsers report some wheels in lines or pages instead of pixels. */
const WHEEL_LINE_PIXELS = 40;
const WHEEL_PAGE_PIXELS = 800;
/** How far (in pixels) the pointer must travel before pressing a tool counts as dragging it. */
const PALETTE_DRAG_THRESHOLD = 5;
/** On screen, in pixels. Less than this is a click on an empty spot, which clears the selection. */
const BOX_SELECT_THRESHOLD = 4;

const isComponentTool = (tool: Tool): tool is ComponentKind =>
  (COMPONENT_KINDS as readonly string[]).includes(tool);

interface Drag {
  readonly id: ElementId;
  readonly start: Cell;
  dx: number;
  dy: number;
  /** Moving every selected element, not just the one pressed. */
  readonly group: boolean;
}

type EditPart = 'value' | 'name';

interface InlineEdit {
  readonly id: ElementId;
  readonly part: EditPart;
  readonly box: HTMLElement;
  readonly input: HTMLInputElement;
  readonly error: HTMLElement;
  /** True once this edit has been recorded for undo. Later keystrokes join the same step. */
  recorded: boolean;
}

type Mode = 'design' | 'learn';

export function mountEditor(root: HTMLElement, panel: PanelControls): void {
  const query = <T extends Element>(selector: string): T => root.querySelector<T>(selector)!;
  const canvas = query<HTMLElement>('.canvas');
  const toolbar = query<HTMLElement>('.toolbar');
  const drawing = query<SVGSVGElement>('#drawing');
  const itemsLayer = query<SVGGElement>('#items');
  const overlay = query<SVGGElement>('#overlay');
  const emptyHint = query<HTMLElement>('#canvas-empty');
  const runButton = query<HTMLButtonElement>('#run');
  const examples = query<HTMLSelectElement>('#examples');
  const saveButton = query<HTMLButtonElement>('#save');
  const openButton = query<HTMLButtonElement>('#open');
  const status = query<HTMLElement>('#status');
  const inspectorTitle = query<HTMLElement>('#inspector-title');
  const inspectorNote = query<HTMLElement>('#inspector-note');
  const inspectorResults = query<HTMLElement>('#inspector-results');
  const capacitorStyleSetting = query<HTMLElement>('#capacitor-style-setting');
  const capacitorStyleSelect = query<HTMLSelectElement>('#capacitor-style');
  const inspectorFlip = query<HTMLButtonElement>('#inspector-flip');
  const inspectorDesign = query<HTMLElement>('#inspector-design');
  const inspectorGuide = query<HTMLElement>('#inspector-guide');
  const inspectorProperties = query<HTMLElement>('#inspector-properties');
  const learnPanel = query<HTMLElement>('#learn-panel');
  const appElement = query<HTMLElement>('.app');
  const solveButton = query<HTMLButtonElement>('#solve');
  const zoomLevel = query<HTMLElement>('#zoom-level');
  const zoomControls = query<HTMLElement>('.zoom-controls');

  const history = new History<Schematic>(loadDrawing());
  /** The drawing as last saved, so it's only written again after it changes. */
  let savedDrawing = history.current;
  const placementRotation: Record<ComponentKind, Rotation> = { ...DEFAULT_ROTATION };
  let bindings: Bindings = loadBindings();
  let capacitorStyle: CapacitorStyle = loadCapacitorStyle();

  let tool: Tool = 'select';
  /** Everything selected. Most panels and actions work on a single element, see `selectedId`. */
  let selection: ReadonlySet<ElementId> = new Set();
  /** A selection box being dragged, in drawing coordinates. */
  let box: { start: { x: number; y: number }; end: { x: number; y: number }; adding: boolean } | null = null;
  let clipboard: Clipboard | null = null;
  let cursor: Cell | null = null;
  let nearConnection: Cell | null = null;
  let wireStart: Cell | null = null;
  let wirePressed = false;
  let drag: Drag | null = null;
  let running = false;
  let stoppedByChange = false;
  let analysis: AnalysisResult | null = null;
  let measurements: ReadonlyMap<ElementId, Measurement> = new Map();
  let slider: HTMLInputElement | null = null;
  /** True once the current slider drag has been recorded for undo. */
  let sliderRecorded = false;
  let focusedIssue: number | null = null;
  let lastWheelRotation = 0;
  // The drawing is redrawn on every press, so the browser's own dblclick event isn't reliable here.
  let lastPress: { id: ElementId; time: number } | null = null;
  /** Which text the latest press landed on, so a double click edits that text. */
  let pressedPart: EditPart | null = null;
  let inlineEdit: InlineEdit | null = null;
  let mode: Mode = 'design';
  /** A one-off message, such as why an element wasn't placed. The next action clears it. */
  let notice: string | null = null;
  let paletteDrag: { kind: ComponentKind | 'ground'; startX: number; startY: number; active: boolean } | null = null;
  /** A finished palette drag must not also count as a click on the tool button. */
  let suppressToolClick = false;
  let camera: Camera = DEFAULT_CAMERA;
  /** Dragging the view with the middle mouse button. */
  let pan: { x: number; y: number } | null = null;

  const gridRect = query<SVGRectElement>('#grid-rect');
  const stepsPanel = createStepsPanel(learnPanel, () => renderDrawing());

  const schematic = (): Schematic => history.current;
  /** The one selected element, or null when nothing or several are selected. */
  const selectedId = (): ElementId | null => (selection.size === 1 ? [...selection][0]! : null);
  const selectedItem = (): SchematicItem | undefined =>
    schematic().items.find((item) => item.id === selectedId());
  const select = (ids: Iterable<ElementId>): void => {
    selection = new Set(ids);
  };
  const solved = (): SolvedAnalysis | null => (running && analysis?.status === 'solved' ? analysis : null);

  /** Where a new element would go: into a wire, blocked by one, or simply placed. */
  function attemptPlacement(kind: ComponentKind, cell: Cell) {
    const withItem = addComponent(schematic(), kind, cell, placementRotation[kind]);
    const item = withItem.items.at(-1) as ComponentItem;
    return { withItem, item, plan: insertIntoWire(removeItem(withItem, item.id), item) };
  }

  /** The same question for the element being dragged. Only a single component can go into a wire. */
  function attemptDrag(): WireInsertion {
    if (!drag || drag.group || (drag.dx === 0 && drag.dy === 0)) return { status: 'none' };
    const item = schematic().items.find((candidate) => candidate.id === drag?.id);
    if (!item || !isComponent(item)) return { status: 'none' };
    const moved = { ...item, x: item.x + drag.dx, y: item.y + drag.dy };
    // Sliding along its own wire isn't a drop onto a wire: that wire just follows.
    return insertIntoWire(removeItem(schematic(), item.id), moved, attachedWireIds(schematic(), item));
  }

  /** The drawing after the current drag, with wires following, unless the drag goes into a wire. */
  function draggedResult(): { schematic: Schematic } | { blocked: keyof typeof tr.placement } {
    if (!drag) return { schematic: schematic() };
    const plan = attemptDrag();
    if (plan.status === 'inserted') return { schematic: plan.schematic };
    if (plan.status === 'blocked') return { blocked: plan.reason };
    const moved = drag.group
      ? moveGroupWithWires(schematic(), selection, drag.dx, drag.dy)
      : moveWithWires(schematic(), drag.id, drag.dx, drag.dy);
    return moved.status === 'moved' ? { schematic: moved.schematic } : { blocked: 'wires' };
  }

  interface Preview {
    readonly schematic: Schematic;
    /** A new element shown as if already dropped, with the wire open around it. */
    readonly previewId: ElementId | null;
    readonly blockedIds: ReadonlySet<ElementId>;
    /** The results no longer match what's shown, so they aren't drawn. */
    readonly hidesResults: boolean;
  }

  /** The drawing as it should appear right now, including what's being dragged. */
  function currentPreview(): Preview {
    const plain: Preview = { schematic: schematic(), previewId: null, blockedIds: new Set(), hidesResults: false };
    if (drag && (drag.dx !== 0 || drag.dy !== 0)) {
      const result = draggedResult();
      if ('schematic' in result) return { ...plain, schematic: result.schematic, hidesResults: true };
      // Shown where it would go, in red, without its wires following.
      const blockedIds = drag.group ? selection : new Set([drag.id]);
      let shown = schematic();
      for (const id of blockedIds) shown = moveItem(shown, id, drag.dx, drag.dy);
      return { ...plain, schematic: shown, blockedIds, hidesResults: true };
    }
    if (isComponentTool(tool) && cursor) {
      const { plan, item } = attemptPlacement(tool, cursor);
      if (plan.status === 'inserted') {
        return { ...plain, schematic: plan.schematic, previewId: item.id, hidesResults: true };
      }
    }
    return plain;
  }

  const labelOf = (id: ElementId): string => {
    const item = schematic().items.find((candidate) => candidate.id === id);
    return item && isComponent(item) ? item.label : '';
  };

  function issueHighlights(): Map<ElementId, IssueSeverity> {
    const highlights = new Map<ElementId, IssueSeverity>();
    if (!running || !analysis) return highlights;
    const shown = focusedIssue === null ? analysis.issues : analysis.issues.slice(focusedIssue, focusedIssue + 1);
    for (const issue of shown) {
      for (const id of [...issue.elementIds, ...issue.wireIds]) {
        if (highlights.get(id) !== 'error') highlights.set(id, issue.severity);
      }
    }
    return highlights;
  }

  /** What the solution step on screen points at. Answers stay hidden until it reaches them. */
  function stepHighlight(): StepHighlight | null {
    if (mode !== 'learn' || !solved()) return null;
    const view = stepsPanel.currentView();
    if (!view) return null;
    return {
      elementIds: view.elementIds,
      nodes: view.nodes,
      assumedCurrents: view.assumedCurrents,
      showNodeValues: revealsNodeValues(view.type),
      showCurrents: revealsCurrents(view.type),
    };
  }

  function renderDrawing(): void {
    // Every change ends in a redraw, so this is where the drawing is saved.
    if (history.current !== savedDrawing) {
      savedDrawing = history.current;
      saveDrawing(savedDrawing);
    }
    const preview = currentPreview();
    const highlights = issueHighlights();
    for (const id of preview.blockedIds) highlights.set(id, 'error');
    itemsLayer.innerHTML = drawSchematic(preview.schematic, {
      selectedId: null,
      selectedIds: selection,
      highlights,
      solved: preview.hidesResults ? null : solved(),
      previewId: preview.previewId,
      step: stepHighlight(),
      measurements,
      capacitorStyle,
    });
    emptyHint.hidden = preview.schematic.items.length > 0;
    renderOverlay();
  }

  function renderOverlay(): void {
    const parts: string[] = [];
    if (wireStart && cursor) {
      parts.push(drawWirePreview(wireStart, cursor));
    } else if (cursor && isComponentTool(tool)) {
      const { plan } = attemptPlacement(tool, cursor);
      if (plan.status === 'blocked') parts.push(drawComponentGhost(tool, cursor, plan.rotation, true, capacitorStyle));
      else if (plan.status === 'none') {
        parts.push(drawComponentGhost(tool, cursor, placementRotation[tool], false, capacitorStyle));
      }
    } else if (cursor && tool === 'ground') {
      parts.push(drawGroundGhost(cursor));
    }
    if (wireStart && cursor) parts.push(drawConnectionTarget(cursor));
    else if (tool === 'wire' && cursor) parts.push(drawConnectionTarget(cursor));
    else if (tool === 'select' && nearConnection && !drag && !box) parts.push(drawConnectionTarget(nearConnection));
    if (box) {
      const x = Math.min(box.start.x, box.end.x);
      const y = Math.min(box.start.y, box.end.y);
      const width = Math.abs(box.end.x - box.start.x);
      const height = Math.abs(box.end.y - box.start.y);
      parts.push(`<rect class="selection-box" x="${x}" y="${y}" width="${width}" height="${height}"/>`);
    }
    overlay.innerHTML = parts.join('');

    const cursorStyle = tool === 'select' ? (nearConnection ? 'crosshair' : 'default') : tool === 'remove' ? 'pointer' : 'crosshair';
    drawing.style.cursor = drag ? 'grabbing' : cursorStyle;
  }

  /** Downloads the drawing in the same format the browser keeps it in, so the file opens again as is. */
  function saveToFile(): void {
    const blob = new Blob([serializeSchematic(schematic())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = drawingFileName(new Date());
    link.click();
    URL.revokeObjectURL(url);
  }

  /** Replaces the drawing with a saved one. Undo brings the old drawing back; a bad file changes nothing. */
  function openFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      file
        .text()
        .then((text) => {
          const parsed = parseSchematic(text);
          if (!parsed) throw new Error('not a drawing');
          select([]);
          commitStructure(parsed);
          fitToDrawing();
        })
        .catch(() => {
          notice = tr.actions.fileInvalid;
          renderStatus();
        });
    });
    input.click();
  }

  function renderToolbar(): void {
    for (const [button, action, label] of [
      [saveButton, 'save', tr.actions.save],
      [openButton, 'load', tr.actions.load],
    ] as const) {
      const key = bindings[action];
      button.title = key ? `${label} (${key})` : label;
    }
    root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => {
      const buttonTool = button.dataset.tool as Tool;
      button.setAttribute('aria-pressed', String(buttonTool === tool));
      const key = bindings[buttonTool];
      button.title = key ? `${tr.tools[buttonTool]} (${key})` : tr.tools[buttonTool];
    });
    root.querySelectorAll<HTMLButtonElement>('[data-history]').forEach((button) => {
      const action = button.dataset.history as 'undo' | 'redo';
      const key = bindings[action];
      button.title = key ? `${tr.tools[action]} (${key})` : tr.tools[action];
    });
    const capacitorTool = query<HTMLButtonElement>('.tool[data-tool="capacitor"]');
    capacitorTool.innerHTML = `${capacitorStyle === 'curved' ? icons.capacitorCurved : icons.capacitor}<span>${tr.tools.capacitor}</span>`;
    // Run shows the results on the drawing; the solve button opens them step by step instead.
    const runKey = bindings.run;
    const showingResults = running && mode === 'design';
    const runLabel = showingResults ? tr.actions.stop : tr.actions.run;
    runButton.innerHTML = `${showingResults ? icons.stop : icons.run}<span class="button-label">${runLabel}</span>`;
    runButton.setAttribute('aria-label', runLabel);
    const runHint = showingResults ? tr.actions.stopHint : tr.actions.runHint;
    runButton.title = runKey ? `${runHint} (${runKey})` : runHint;
    const showingSteps = running && mode === 'learn';
    const solveLabel = showingSteps ? tr.learn.closeSolution : tr.learn.solve;
    solveButton.innerHTML = `${icons.steps}<span class="button-label">${solveLabel}</span>`;
    solveButton.title = showingSteps ? tr.learn.closeSolutionHint : tr.learn.solveHint;
    solveButton.setAttribute('aria-label', solveLabel);
    solveButton.setAttribute('aria-pressed', String(showingSteps));
  }

  function resultRows(values: ElementResult | Measurement, isOpAmp: boolean): string {
    const positive = (value: Fraction): Fraction => (value.num < 0n ? value.neg() : value);
    // An op-amp's output is measured from ground, so its sign says something the drawing doesn't.
    const shownVoltage = isOpAmp ? values.voltage : values.voltage && positive(values.voltage);
    const voltage = shownVoltage ? formatQuantity(shownVoltage, 'V') : tr.inspector.indeterminate;
    const current = values.current ? formatQuantity(positive(values.current), 'A') : tr.inspector.indeterminate;
    let power: string = tr.inspector.indeterminate;
    if (!('power' in values)) {
      power = formatQuantity(Fraction.ZERO, 'W');
    } else if (values.power) {
      const role = values.power.isZero() ? '' : ` ${values.power.isPositive() ? tr.inspector.absorbs : tr.inspector.delivers}`;
      power = `${formatQuantity(positive(values.power), 'W')}${role}`;
    }
    return `
      <div><dt>${isOpAmp ? tr.inspector.outputVoltage : tr.inspector.voltage}</dt><dd>${voltage}</dd></div>
      <div><dt>${isOpAmp ? tr.inspector.outputCurrent : tr.inspector.current}</dt><dd>${current}</dd></div>
      <div><dt>${tr.inspector.power}</dt><dd>${escapeHtml(power)}</dd></div>`;
  }

  function renderInspector(): void {
    inspectorDesign.hidden = mode === 'learn';
    learnPanel.hidden = mode !== 'learn';
    capacitorStyleSetting.hidden = true;
    const showGuide = selection.size === 0 && mode !== 'learn';
    inspectorGuide.hidden = !showGuide;
    inspectorProperties.hidden = showGuide;
    if (showGuide) return;

    const item = selectedItem();
    inspectorResults.hidden = true;
    inspectorFlip.hidden = true;
    inspectorNote.hidden = false;

    if (selection.size > 1) {
      inspectorTitle.textContent = tr.inspector.multiple.replace('{count}', String(selection.size));
      inspectorNote.textContent = tr.inspector.multipleHint;
      return;
    }
    if (!item) {
      inspectorTitle.textContent = tr.inspector.title;
      inspectorNote.textContent = tr.inspector.empty;
      return;
    }
    if (item.kind === 'wire') {
      inspectorTitle.textContent = tr.inspector.wire;
      inspectorNote.hidden = true;
      return;
    }
    if (item.kind === 'ground') {
      inspectorTitle.textContent = tr.inspector.ground;
      inspectorNote.textContent = tr.inspector.groundNote;
      return;
    }

    if (item.kind === 'capacitor') {
      capacitorStyleSetting.hidden = false;
      capacitorStyleSelect.value = capacitorStyle;
    }

    inspectorTitle.textContent = `${item.label}: ${tr.tools[item.kind]}`;
    const isOpAmp = item.kind === 'op-amp';
    const transistorSelected = isTransistor(item.kind);
    let valueRow = '';
    if (isOpAmp) {
      valueRow = `<div><dt>${tr.inspector.supply}</dt><dd>±${formatQuantity(item.value, 'V')}</dd></div>`;
    } else if (hasValue(item.kind)) {
      const valueLabel = transistorSelected ? tr.inspector.beta : item.kind === 'zener' ? tr.inspector.zenerVoltage :
        item.kind === 'diode' || item.kind === 'led' ? tr.inspector.threshold : tr.inspector.value;
      valueRow = `<div><dt>${valueLabel}</dt><dd>${transistorSelected ? formatBetaValue(item.value) : formatQuantity(item.value, UNIT_OF[item.kind])}</dd></div>`;
    }
    const values = solved() ? (solved()?.elements.get(item.id) ?? measurements.get(item.id)) : undefined;
    const transistorRows = transistorSelected && solved() ? transistorReadout(item, solved()!) : null;
    const transistorPower = transistorSelected ? solved()?.transistors?.get(item.id)?.power : undefined;
    const readoutHtml = transistorRows?.map(({ label, value }) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('') ?? '';
    const powerRole = transistorPower && !transistorPower.isZero() ? ` ${transistorPower.isPositive() ? tr.inspector.absorbs : tr.inspector.delivers}` : '';
    const powerRow = transistorPower
      ? `<div><dt>${tr.inspector.power}</dt><dd>${formatQuantity(transistorPower.num < 0n ? transistorPower.neg() : transistorPower, 'W')}${powerRole}</dd></div>`
      : '';
    inspectorResults.innerHTML = valueRow + (transistorSelected ? readoutHtml + powerRow : values ? resultRows(values, isOpAmp) : '');
    inspectorResults.hidden = inspectorResults.innerHTML === '';
    inspectorFlip.hidden = false;
    inspectorFlip.textContent = isOpAmp ? tr.inspector.flipInputs : transistorSelected ? tr.inspector.flipTransistor : tr.inspector.flip;
    if (item.kind === 'switch') {
      inspectorNote.textContent = tr.inspector.switchHint;
    } else if (values || transistorRows) {
      inspectorNote.textContent = tr.inspector.editHint;
    } else {
      inspectorNote.textContent = running ? tr.inspector.fixFirst : tr.inspector.runForResults;
    }
  }

  /** The slider under a selected variable resistor. It sits on the canvas, so it needs no panel. */
  function syncSlider(): void {
    const item = selectedItem();
    const show = item && isComponent(item) && item.kind === 'variable-resistor' && item.maxValue && !drag;
    if (!show) {
      slider?.remove();
      slider = null;
      return;
    }

    const body = itemsLayer.querySelector(`[data-id="${item.id}"] .hit`);
    if (!body) return;
    if (!slider) {
      slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'value-slider';
      slider.min = String(SLIDER_MIN_PERCENT);
      slider.max = '100';
      slider.setAttribute('aria-label', tr.inlineEdit.sliderLabel);
      slider.addEventListener('input', onSliderInput);
      slider.addEventListener('pointerdown', () => {
        sliderRecorded = false;
      });
      canvas.append(slider);
    }
    if (document.activeElement !== slider) {
      const percent = item.value.div(item.maxValue!).mul(Fraction.from(100)).toNumber();
      slider.value = String(Math.round(percent));
    }
    const box = body.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();
    const middle = box.left + box.width / 2 - canvasBox.left + canvas.scrollLeft;
    const top = box.bottom - canvasBox.top + canvas.scrollTop + SLIDER_GAP;
    slider.style.left = `${middle - 60}px`;
    slider.style.top = `${top}px`;
  }

  function onSliderInput(): void {
    const item = selectedItem();
    if (!slider || !item || !isComponent(item) || !item.maxValue) return;
    const value = item.maxValue.mul(Fraction.ratio(BigInt(slider.value), 100n));
    const next = setItemValue(schematic(), item.id, value);
    if (sliderRecorded) history.replace(next);
    else history.commit(next);
    sliderRecorded = true;
    if (running) recompute();
    renderDrawing();
    renderInspector();
    renderStatus();
  }

  function toggleSwitchItem(id: ElementId): void {
    history.commit(toggleSwitch(schematic(), id));
    // Flipping a switch is what a running circuit is for, so the results just update.
    if (running) recompute();
    renderAll();
  }

  /**
   * A double click edits the text it landed on. On the symbol it only toggles a switch: anything
   * else stays selected, so Delete removes it instead of erasing text in an edit box.
   */
  function onDoubleClick(id: ElementId, part: EditPart | null): void {
    const item = schematic().items.find((candidate) => candidate.id === id);
    if (!item || !isComponent(item)) return;
    if (part === 'name') openInlineEdit(id, 'name');
    else if (part === 'value' && hasValue(item.kind)) openInlineEdit(id, 'value');
    else if (item.kind === 'switch') toggleSwitchItem(id);
  }

  function issueMessage(issue: Issue): { title: string; detail: string } {
    const names = issue.elementIds.map(labelOf).filter(Boolean).join(', ');
    const text = tr.issues[issue.code];
    return { title: text.title.replace('{names}', names), detail: text.detail };
  }

  function renderStatus(): void {
    if (notice) {
      status.className = 'status';
      status.innerHTML = `<div class="issue issue-warning">${icons.warning}<span>${escapeHtml(notice)}</span></div>`;
      return;
    }
    if (!running || !analysis) {
      let hint: string = tr.status.hints.select;
      if (isComponentTool(tool) || tool === 'ground') hint = tr.status.hints.place;
      else if (tool === 'wire') hint = tr.status.hints.wire;
      else if (tool === 'remove') hint = tr.status.hints.remove;
      status.className = 'status';
      status.textContent = stoppedByChange ? tr.status.stoppedByChange : hint;
      return;
    }

    if (analysis.issues.length === 0) {
      status.className = 'status status-ok';
      status.innerHTML = `${icons.ok}<span>${mode === 'learn' ? tr.status.solved : tr.status.running}</span>`;
      return;
    }

    // Warnings come with a solved circuit, so say that first: orange alone reads as a failure.
    const solvedLine =
      analysis.status === 'solved'
        ? `<div class="status-ok status-line">${icons.ok}<span>${mode === 'learn' ? tr.status.solvedWithWarnings : tr.status.runningWithWarnings}</span></div>`
        : '';
    status.className = 'status';
    status.innerHTML = solvedLine + analysis.issues
      .map((issue, index) => {
        const { title, detail } = issueMessage(issue);
        const active = focusedIssue === index ? ' active' : '';
        return `<button type="button" class="issue issue-${issue.severity}${active}" data-issue="${index}">
          ${issue.severity === 'error' ? icons.error : icons.warning}
          <span><strong>${escapeHtml(title)}</strong> ${escapeHtml(detail)}</span>
        </button>`;
      })
      .join('');
  }

  function renderAll(): void {
    applyCamera();
    renderDrawing();
    renderToolbar();
    renderInspector();
    renderStatus();
    syncSlider();
  }

  function recompute(): void {
    const drawing = analyzeDrawing(schematic());
    analysis = drawing.analysis;
    measurements = drawing.measurements;
    focusedIssue = null;
    if (mode !== 'learn') return;

    const solution = solveWithSteps(toCircuit(schematic()));
    if (solution.status !== 'solved') {
      stepsPanel.clear('fix-first');
      return;
    }
    const equivalents = dcEquivalentItems(schematic());
    stepsPanel.setSolution(solution, labelOf, {
      prelude:
        equivalents.length > 0
          ? dcEquivalentView(
              equivalents.map(
                (item): DcElement => ({
                  id: item.id,
                  label: item.label,
                  kind: item.kind as DcElement['kind'],
                  closed: item.closed === true,
                }),
              ),
            )
          : null,
      rows: equivalents.flatMap((item) => {
        const reading = measurements.get(item.id);
        return reading ? [measuredRow({ label: item.label, ...reading })] : [];
      }),
    });
  }

  function setRunning(next: boolean): void {
    running = next;
    stoppedByChange = false;
    notice = null;
    if (running) {
      if (mode === 'learn') {
        // The panel takes up room, and the highlights are no use outside the visible part.
        panel.open();
        fitToDrawing();
      }
      recompute();
    } else {
      analysis = null;
      stepsPanel.clear('intro');
    }
    renderAll();
  }

  /** Results on the drawing. Pressed while the steps are open, it closes them and shows the results instead. */
  function toggleRun(): void {
    if (mode === 'learn') {
      setMode('design');
      setRunning(true);
    } else {
      setRunning(!running);
    }
  }

  /** The step-by-step solution in the side panel, with answers revealed as the steps reach them. */
  function toggleSolve(): void {
    if (mode === 'learn' && running) {
      setMode('design');
    } else {
      setMode('learn');
      setRunning(true);
    }
  }

  function setMode(next: Mode): void {
    if (next === mode) return;
    mode = next;
    appElement.classList.toggle('learn-mode', mode === 'learn');
    // Switching never carries answers over: in Learn mode they appear only after asking for them.
    running = false;
    stoppedByChange = false;
    analysis = null;
    notice = null;
    stepsPanel.clear('intro');
    if (mode === 'learn') panel.open();
    renderAll();
  }

  /** Any change to the circuit's structure stops it, so half-drawn circuits raise no warnings. */
  function commitStructure(next: Schematic): void {
    history.commit(next);
    afterStructureChange();
  }

  function afterStructureChange(): void {
    if (running) {
      running = false;
      analysis = null;
      stoppedByChange = true;
      stepsPanel.clear('intro');
    }
    const existing = new Set(schematic().items.map((item) => item.id));
    select([...selection].filter((id) => existing.has(id)));
    renderAll();
  }

  function setTool(next: Tool): void {
    tool = next;
    notice = null;
    wireStart = null;
    wirePressed = false;
    stoppedByChange = false;
    renderAll();
  }

  function cancel(): void {
    wireStart = null;
    wirePressed = false;
    drag = null;
    box = null;
    select([]);
    if (paletteDrag?.active) suppressToolClick = true;
    paletteDrag = null;
    cursor = null;
    tool = 'select';
    renderAll();
  }

  /** One element closes the gap it leaves; a group just goes. */
  function deleteSelected(): void {
    const single = selectedId();
    if (single) commitStructure(removeWithWires(schematic(), single));
    else if (selection.size > 1) commitStructure(removeItems(schematic(), selection));
  }

  function selectAll(): void {
    tool = 'select';
    select(allIds(schematic()));
    renderAll();
  }

  function copySelection(): void {
    clipboard = copyItems(schematic(), selection) ?? clipboard;
  }

  function cutSelection(): void {
    copySelection();
    if (selection.size > 0) commitStructure(removeItems(schematic(), selection));
  }

  /** At the pointer if it's over the drawing, otherwise just beside the original, and selected. */
  function paste(): void {
    if (!clipboard) return;
    const at = cursor ?? { x: clipboard.origin.x + 2, y: clipboard.origin.y + 2 };
    const pasted = pasteItems(schematic(), clipboard, at);
    tool = 'select';
    select(pasted.ids);
    commitStructure(pasted.schematic);
  }

  function rotate(): void {
    if (isComponentTool(tool)) {
      placementRotation[tool] = nextRotation(placementRotation[tool]);
      renderDrawing();
      return;
    }
    const item = selectedItem();
    if (!item || !isComponent(item)) return;
    const result = rotateWithWires(schematic(), item.id);
    if (result.status === 'moved') {
      commitStructure(result.schematic);
    } else {
      notice = tr.placement.turn;
      renderStatus();
    }
  }

  function flip(): void {
    const item = selectedItem();
    if (item && isComponent(item) && item.kind !== 'voltage-point') {
      commitStructure(flipItem(schematic(), item.id));
    }
  }

  /** Undoing a name or value keeps a running circuit running; only a wiring change stops it. */
  function afterHistoryMove(previous: Schematic): void {
    if (hasSameStructure(previous, schematic())) {
      if (running) recompute();
      renderAll();
    } else {
      afterStructureChange();
    }
  }

  function undo(): void {
    const previous = schematic();
    if (history.undo()) afterHistoryMove(previous);
  }

  function redo(): void {
    const previous = schematic();
    if (history.redo()) afterHistoryMove(previous);
  }

  /** Works however the drawing is scrolled or scaled. */
  function pointFrom(event: MouseEvent): { x: number; y: number } {
    const matrix = drawing.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    return { x: (event.clientX - matrix.e) / matrix.a, y: (event.clientY - matrix.f) / matrix.d };
  }

  const viewSize = (): Size => ({
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
  });

  /** Shows the part of the endless drawing the camera points at. The grid follows it everywhere. */
  function applyCamera(): void {
    const area = visibleArea(camera, viewSize());
    drawing.setAttribute('viewBox', `${area.x} ${area.y} ${area.width} ${area.height}`);
    for (const [name, value] of Object.entries(area)) gridRect.setAttribute(name, String(value));
    zoomLevel.textContent = zoomLabel(camera);
  }

  function setCamera(next: Camera): void {
    camera = next;
    // Text boxes sit on the page, not in the drawing, so they would be left behind.
    if (inlineEdit) finishInlineEdit('blur');
    applyCamera();
    syncSlider();
  }

  /** The whole circuit on screen, with room for labels. Small circuits stay at full size. */
  function fitToDrawing(): void {
    const cells = connectionCells(schematic());
    if (cells.length === 0) {
      setCamera(DEFAULT_CAMERA);
      return;
    }
    const xs = cells.map((cell) => cell.x * CELL_SIZE);
    const ys = cells.map((cell) => cell.y * CELL_SIZE);
    const bounds = {
      left: Math.min(...xs) - FIT_MARGIN_X,
      top: Math.min(...ys) - FIT_MARGIN_Y,
      right: Math.max(...xs) + FIT_MARGIN_X,
      bottom: Math.max(...ys) + FIT_MARGIN_Y,
    };
    setCamera(fitCamera(bounds, viewSize()));
  }

  /** Screen pixels from the view's top-left corner. */
  const viewPoint = (event: MouseEvent): { x: number; y: number } => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  /** A wheel distance in pixels, whatever unit the browser reports it in. */
  const wheelPixels = (event: WheelEvent, delta: number): number =>
    delta * (event.deltaMode === 1 ? WHEEL_LINE_PIXELS : event.deltaMode === 2 ? WHEEL_PAGE_PIXELS : 1);

  const cellFrom = ({ x, y }: { x: number; y: number }): Cell => ({
    x: Math.round(x / CELL_SIZE),
    y: Math.round(y / CELL_SIZE),
  });

  function connectionNear(point: { x: number; y: number }): Cell | null {
    let best: Cell | null = null;
    let bestDistance = CONNECTION_HIT_RADIUS;
    for (const cell of connectionCells(schematic())) {
      const distance = Math.hypot(cell.x * CELL_SIZE - point.x, cell.y * CELL_SIZE - point.y);
      if (distance <= bestDistance) {
        best = cell;
        bestDistance = distance;
      }
    }
    return best;
  }

  const itemIdFrom = (target: EventTarget | null): ElementId | null =>
    target instanceof Element ? (target.closest<SVGElement>('[data-id]')?.dataset.id ?? null) : null;

  function openInlineEdit(id: ElementId, part: EditPart): void {
    const item = schematic().items.find((candidate) => candidate.id === id);
    if (!item || !isComponent(item)) return;
    if (part === 'value' && !hasValue(item.kind)) return;
    const anchor = itemsLayer.querySelector(`[data-id="${id}"] [data-edit="${part}"]`);
    if (!anchor) return;

    const anchorBox = anchor.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();

    const box = document.createElement('div');
    box.className = 'inline-edit';
    box.style.left = `${anchorBox.left - canvasBox.left + canvas.scrollLeft - 6}px`;
    box.style.top = `${anchorBox.top - canvasBox.top + canvas.scrollTop - 2}px`;

    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', part === 'value' ? tr.inlineEdit.valueLabel : tr.inlineEdit.nameLabel);
    input.value = hasValue(item.kind) && part === 'value'
      ? isTransistor(item.kind) ? formatBeta(item.value) : formatQuantity(item.value, UNIT_OF[item.kind])
      : item.label;

    const error = document.createElement('p');
    error.className = 'inline-edit-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;

    box.append(input, error);
    canvas.append(box);

    inlineEdit = { id, part, box, input, error, recorded: false };
    input.addEventListener('input', onInlineInput);
    input.addEventListener('keydown', onInlineKey);
    input.addEventListener('blur', () => finishInlineEdit('blur'));
    input.focus();
    input.select();
  }

  function showInlineError(message: string | null): void {
    if (!inlineEdit) return;
    inlineEdit.error.textContent = message ?? '';
    inlineEdit.error.hidden = message === null;
    inlineEdit.input.classList.toggle('invalid', message !== null);
  }

  function valueProblem(text: string, kind: ValuedKind): string | Fraction {
    if (isTransistor(kind)) {
      const parsed = parseBeta(text);
      if (!parsed.ok) return tr.inlineEdit.invalidBeta;
      return parsed.value.isPositive() ? parsed.value : tr.inlineEdit.invalidPositive;
    }
    // A supply is drawn as ±15 V, so typing it the same way has to work.
    const typed = kind === 'op-amp' ? text.replace(/^\s*±/, '') : text;
    const parsed = parseQuantity(typed, UNIT_OF[kind]);
    if (!parsed.ok) {
      return parsed.reason === 'unit' ? tr.inlineEdit.invalidUnit : tr.inlineEdit.invalidFormat;
    }
    if (!isComponentValueValid(kind, parsed.value)) {
      return kind === 'diode' ? tr.inlineEdit.invalidNonNegative : tr.inlineEdit.invalidPositive;
    }
    return parsed.value;
  }

  function nameProblemMessage(id: ElementId, text: string): string | null {
    const problem = labelProblem(schematic(), id, text);
    if (problem === 'empty') return tr.inlineEdit.nameEmpty;
    if (problem === 'too-long') return tr.inlineEdit.nameTooLong;
    if (problem === 'taken') return tr.inlineEdit.nameTaken;
    return null;
  }

  /** Valid values apply as they are typed, so a running circuit updates live. */
  function onInlineInput(): void {
    if (!inlineEdit) return;
    const { id, part, input } = inlineEdit;
    const item = schematic().items.find((candidate) => candidate.id === id);
    if (!item || !isComponent(item)) return;

    if (part === 'name') {
      showInlineError(nameProblemMessage(id, input.value));
      return;
    }

    if (!hasValue(item.kind)) return;
    const result = valueProblem(input.value, item.kind);
    if (typeof result === 'string') {
      showInlineError(result);
      return;
    }
    showInlineError(null);
    if (result.equals(item.value)) return;

    const next = setItemValue(schematic(), id, result);
    if (inlineEdit.recorded) history.replace(next);
    else history.commit(next);
    inlineEdit.recorded = true;

    if (running) recompute();
    renderDrawing();
    renderInspector();
    renderStatus();
  }

  function onInlineKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishInlineEdit('confirm');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishInlineEdit('cancel');
    }
  }

  function finishInlineEdit(reason: 'confirm' | 'cancel' | 'blur'): void {
    if (!inlineEdit) return;
    const { id, part, box, input, recorded } = inlineEdit;
    const item = schematic().items.find((candidate) => candidate.id === id);

    if (part === 'name' && reason !== 'cancel' && item && isComponent(item)) {
      const problem = nameProblemMessage(id, input.value);
      // Enter on a bad name keeps the box open to fix it; clicking away just leaves the old name.
      if (problem && reason === 'confirm') {
        showInlineError(problem);
        return;
      }
      if (!problem && input.value.trim() !== item.label) {
        history.commit(setItemLabel(schematic(), id, input.value));
        if (running) recompute();
      }
    }

    // Cleared first: removing the focused input fires blur, which must not finish the edit again.
    inlineEdit = null;
    box.remove();

    if (part === 'value' && reason === 'cancel' && recorded) {
      history.undo();
      if (running) recompute();
    }
    renderAll();
  }

  function finishWire(end: Cell): void {
    const start = wireStart;
    wireStart = null;
    wirePressed = false;
    tool = 'select';
    if (start && (start.x !== end.x || start.y !== end.y)) {
      commitStructure(addWire(schematic(), start, end));
    } else {
      renderAll();
    }
  }

  function placeAt(cell: Cell, kind: ComponentKind | 'ground'): void {
    tool = 'select';
    if (kind === 'ground') {
      const next = addGround(schematic(), cell);
      select([next.items.at(-1)!.id]);
      commitStructure(next);
      return;
    }

    const { withItem, item, plan } = attemptPlacement(kind, cell);
    if (plan.status === 'blocked') {
      notice = tr.placement[plan.reason];
      renderAll();
      return;
    }
    select([item.id]);
    commitStructure(plan.status === 'inserted' ? plan.schematic : withItem);
  }

  const isOverCanvas = (event: MouseEvent): boolean => {
    const box = canvas.getBoundingClientRect();
    return (
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    );
  };

  // Dragging a tool from the toolbar onto the drawing places exactly one element.
  toolbar.addEventListener('pointerdown', (event) => {
    suppressToolClick = false;
    if (event.button !== 0) return;
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-tool]');
    const kind = button?.dataset.tool as Tool | undefined;
    if (kind && (isComponentTool(kind) || kind === 'ground')) {
      paletteDrag = { kind, startX: event.clientX, startY: event.clientY, active: false };
    }
  });

  window.addEventListener('pointermove', (event) => {
    if (!paletteDrag) return;
    if (!paletteDrag.active) {
      const distance = Math.hypot(event.clientX - paletteDrag.startX, event.clientY - paletteDrag.startY);
      if (distance < PALETTE_DRAG_THRESHOLD) return;
      paletteDrag.active = true;
      // The pressed button holds focus, which would stop Space from rotating the element.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setTool(paletteDrag.kind);
    }
    cursor = isOverCanvas(event) ? cellFrom(pointFrom(event)) : null;
    renderDrawing();
  });

  window.addEventListener('pointerup', (event) => {
    if (!paletteDrag) return;
    const { kind, active } = paletteDrag;
    paletteDrag = null;
    if (!active) return;
    suppressToolClick = true;
    if (isOverCanvas(event)) {
      placeAt(cellFrom(pointFrom(event)), kind);
    } else {
      cursor = null;
      setTool('select');
    }
  });

  window.addEventListener('pointercancel', () => {
    if (paletteDrag) cancel();
  });

  // The middle button drags the view, like a hand. Its usual autoscroll would get in the way.
  drawing.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault();
  });

  drawing.addEventListener('pointerdown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      pan = { x: event.clientX, y: event.clientY };
      drawing.style.cursor = 'grabbing';
      try {
        // Keeps the drag going if the pointer leaves the drawing. Panning still works without it.
        drawing.setPointerCapture(event.pointerId);
      } catch {
        // The pointer may already be gone, as when the button was released at once.
      }
      return;
    }
    if (event.button !== 0) return;
    drawing.setPointerCapture(event.pointerId);
    const point = pointFrom(event);
    const cell = cellFrom(point);
    cursor = cell;
    notice = null;

    if (wireStart) {
      finishWire(cell);
      return;
    }
    if (tool === 'wire') {
      wireStart = connectionNear(point) ?? cell;
      wirePressed = true;
      renderOverlay();
      return;
    }
    if (isComponentTool(tool) || tool === 'ground') {
      placeAt(cell, tool);
      return;
    }

    const targetId = itemIdFrom(event.target);
    if (tool === 'remove') {
      if (targetId) {
        tool = 'select';
        commitStructure(removeWithWires(schematic(), targetId));
      }
      return;
    }

    const connection = connectionNear(point);
    if (connection) {
      wireStart = connection;
      wirePressed = true;
      nearConnection = null;
      renderOverlay();
      return;
    }

    // An empty spot starts a selection box, as on the Windows desktop. Shift adds to what's selected.
    if (!targetId) {
      box = { start: point, end: point, adding: event.shiftKey };
      renderOverlay();
      return;
    }
    if (event.shiftKey) {
      const next = new Set(selection);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      select(next);
      renderAll();
      return;
    }

    pressedPart =
      event.target instanceof Element
        ? ((event.target.closest('[data-edit]')?.getAttribute('data-edit') as EditPart | null) ?? null)
        : null;
    // Pressing one of several selected elements moves them all; a click without moving picks just it.
    const group = selection.size > 1 && selection.has(targetId);
    if (!group) select([targetId]);
    drag = { id: targetId, start: cell, dx: 0, dy: 0, group };
    renderAll();
  });

  drawing.addEventListener('pointermove', (event) => {
    if (pan) {
      setCamera(panBy(camera, event.clientX - pan.x, event.clientY - pan.y));
      pan = { x: event.clientX, y: event.clientY };
      return;
    }
    const point = pointFrom(event);
    const cell = cellFrom(point);
    const moved = !cursor || cursor.x !== cell.x || cursor.y !== cell.y;
    cursor = cell;
    const near = tool === 'select' && !drag && !wireStart && !box ? connectionNear(point) : null;
    const nearChanged = near?.x !== nearConnection?.x || near?.y !== nearConnection?.y;
    nearConnection = near;

    if (box) {
      box.end = point;
      renderOverlay();
      return;
    }

    if (drag) {
      const dx = cell.x - drag.start.x;
      const dy = cell.y - drag.start.y;
      if (dx !== drag.dx || dy !== drag.dy) {
        drag.dx = dx;
        drag.dy = dy;
        renderDrawing();
      }
      return;
    }
    if (moved && isComponentTool(tool)) renderDrawing();
    else if (moved || nearChanged) renderOverlay();
  });

  drawing.addEventListener('pointerup', (event) => {
    if (pan) {
      pan = null;
      renderOverlay();
      return;
    }
    if (box) {
      const { start, adding } = box;
      const end = pointFrom(event);
      box = null;
      const dragged = Math.hypot(end.x - start.x, end.y - start.y) * camera.scale >= BOX_SELECT_THRESHOLD;
      // Only cells whose centre falls inside the box count, so the box can be drawn loosely.
      const inBox = dragged
        ? itemsInBox(schematic(), {
            left: Math.ceil(Math.min(start.x, end.x) / CELL_SIZE),
            top: Math.ceil(Math.min(start.y, end.y) / CELL_SIZE),
            right: Math.floor(Math.max(start.x, end.x) / CELL_SIZE),
            bottom: Math.floor(Math.max(start.y, end.y) / CELL_SIZE),
          })
        : [];
      select(adding ? [...selection, ...inBox] : inBox);
      renderAll();
      return;
    }
    const cell = cellFrom(pointFrom(event));
    if (wireStart && wirePressed) {
      wirePressed = false;
      // Releasing on the starting cell keeps the wire open, so a second click can finish it.
      if (wireStart.x !== cell.x || wireStart.y !== cell.y) finishWire(cell);
      return;
    }
    if (drag) {
      // A quick flick can release before any move event arrives, so the release position counts too.
      drag.dx = cell.x - drag.start.x;
      drag.dy = cell.y - drag.start.y;
      const result = draggedResult();
      const { id, dx, dy, group } = drag;
      drag = null;
      if (group && dx === 0 && dy === 0) select([id]);
      if (dx !== 0 || dy !== 0) {
        lastPress = null;
        if ('schematic' in result) {
          commitStructure(result.schematic);
        } else {
          notice = tr.placement[result.blocked];
          renderAll();
        }
        return;
      }
      renderAll();
      if (lastPress?.id === id && event.timeStamp - lastPress.time < DOUBLE_CLICK_MS) {
        lastPress = null;
        onDoubleClick(id, pressedPart);
      } else {
        lastPress = { id, time: event.timeStamp };
      }
    }
  });

  drawing.addEventListener('pointerleave', () => {
    if (drag || wirePressed || box) return;
    cursor = null;
    nearConnection = null;
    if (isComponentTool(tool)) renderDrawing();
    else renderOverlay();
  });

  /**
   * Ctrl + wheel zooms toward the pointer (a touchpad pinch arrives the same way). Otherwise the
   * wheel rotates while placing or over the selected component, and scrolls the view elsewhere.
   */
  drawing.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const steps = -wheelPixels(event, event.deltaY) / WHEEL_PIXELS_PER_ZOOM_STEP;
        setCamera(zoomAt(camera, ZOOM_STEP ** Math.max(-1, Math.min(1, steps)), viewPoint(event)));
        return;
      }
      const single = selectedId();
      const overSelected = single !== null && itemIdFrom(event.target) === single;
      const canRotate = isComponentTool(tool) || (tool === 'select' && overSelected);
      if (canRotate) {
        if (event.timeStamp - lastWheelRotation < WHEEL_ROTATE_COOLDOWN_MS) return;
        lastWheelRotation = event.timeStamp;
        rotate();
        return;
      }
      // Shift turns an ordinary wheel sideways, as in most programs.
      const sideways = event.shiftKey && event.deltaX === 0;
      const dx = wheelPixels(event, sideways ? event.deltaY : event.deltaX);
      const dy = sideways ? 0 : wheelPixels(event, event.deltaY);
      setCamera(panBy(camera, -dx, -dy));
    },
    { passive: false },
  );

  zoomControls.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-zoom]');
    const view = viewSize();
    switch (button?.dataset.zoom) {
      case 'in':
        setCamera(zoomTo(camera, camera.scale * ZOOM_STEP, view));
        break;
      case 'out':
        setCamera(zoomTo(camera, camera.scale / ZOOM_STEP, view));
        break;
      case 'reset':
        setCamera(zoomTo(camera, 1, view));
        break;
      case 'fit':
        fitToDrawing();
        break;
    }
  });

  // A mouse click leaves focus on the button; drop it so Space rotates instead of re-pressing it.
  root.querySelector('.app')!.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button');
    if (button && (event as MouseEvent).detail > 0) button.blur();
  });

  const onToolClick = (event: Event): void => {
    if (suppressToolClick) {
      suppressToolClick = false;
      return;
    }
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.tool) setTool(button.dataset.tool as Tool);
    if (button.dataset.history === 'undo') undo();
    if (button.dataset.history === 'redo') redo();
  };
  toolbar.addEventListener('click', onToolClick);
  query<HTMLElement>('.edit-bar').addEventListener('click', onToolClick);

  runButton.addEventListener('click', () => toggleRun());
  solveButton.addEventListener('click', () => toggleSolve());
  new ResizeObserver(() => {
    applyCamera();
    syncSlider();
  }).observe(canvas);
  inspectorFlip.addEventListener('click', flip);

  capacitorStyleSelect.addEventListener('change', () => {
    const style = capacitorStyleSelect.value;
    if (style !== 'straight' && style !== 'curved') return;
    capacitorStyle = style;
    saveCapacitorStyle(capacitorStyle);
    renderToolbar();
    renderDrawing();
  });

  query<HTMLButtonElement>('#clear').addEventListener('click', () => {
    if (schematic().items.length === 0) return;
    select([]);
    commitStructure(EMPTY_SCHEMATIC);
  });

  saveButton.addEventListener('click', () => saveToFile());
  openButton.addEventListener('click', () => openFromFile());

  examples.addEventListener('change', () => {
    const id = examples.value as ExampleMenuId | '';
    examples.value = '';
    if (!id) return;
    select([]);
    tool = 'select';
    commitStructure(buildExample(id));
  });

  status.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-issue]');
    if (!button) return;
    const index = Number(button.dataset.issue);
    focusedIssue = focusedIssue === index ? null : index;
    renderDrawing();
    renderStatus();
  });

  const shortcutsDialog = setupShortcutsDialog(query<HTMLDialogElement>('#shortcuts-dialog'), {
    getBindings: () => bindings,
    setBindings: (next) => {
      bindings = next;
      saveBindings(bindings);
      renderToolbar();
    },
  });
  query<HTMLButtonElement>('#shortcuts').addEventListener('click', () => shortcutsDialog.open());

  const ACTIONS: Readonly<Record<ActionId, () => void>> = {
    resistor: () => setTool('resistor'),
    'variable-resistor': () => setTool('variable-resistor'),
    capacitor: () => setTool('capacitor'),
    inductor: () => setTool('inductor'),
    'voltage-source': () => setTool('voltage-source'),
    'current-source': () => setTool('current-source'),
    'voltage-point': () => setTool('voltage-point'),
    diode: () => setTool('diode'),
    zener: () => setTool('zener'),
    led: () => setTool('led'),
    'op-amp': () => setTool('op-amp'),
    npn: () => setTool('npn'),
    pnp: () => setTool('pnp'),
    ground: () => setTool('ground'),
    wire: () => setTool('wire'),
    switch: () => setTool('switch'),
    ammeter: () => setTool('ammeter'),
    voltmeter: () => setTool('voltmeter'),
    select: () => setTool('select'),
    remove: () => setTool('remove'),
    rotate,
    flip,
    delete: deleteSelected,
    'select-all': selectAll,
    copy: copySelection,
    cut: cutSelection,
    paste,
    undo,
    redo,
    run: () => toggleRun(),
    save: saveToFile,
    load: openFromFile,
  };

  window.addEventListener('keydown', (event) => {
    if (shortcutsDialog.isOpen()) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;

    if (event.key === 'Escape') {
      cancel();
      return;
    }

    const combo = comboFromKey(event);
    if (!combo) return;
    // With a focused button, Space and Enter keep their normal meaning for keyboard users.
    if (target instanceof HTMLButtonElement && (combo === 'Space' || combo === 'Enter')) return;

    // Backspace deletes too, as on a laptop keyboard without a Delete key, unless it was given another job.
    const action = actionForCombo(bindings, combo) ?? (combo === 'Backspace' ? 'delete' : undefined);
    if (!action) return;
    event.preventDefault();
    ACTIONS[action]();
  });

  renderAll();
}
