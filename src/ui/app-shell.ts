import { tr } from '../i18n/tr';
import { EXAMPLE_MENU_IDS } from './editor/examples';
import { CELL_SIZE } from './editor/render';
import { loadCapacitorStyle } from './capacitor-style';
import type { ComponentKind } from './editor/schematic';
import { icons } from './icons';

type PlaceableTool = ComponentKind | 'ground' | 'wire';
type ToolGroup = keyof typeof tr.tools.groups;

const TOOL_GROUPS: readonly { readonly id: ToolGroup; readonly tools: readonly PlaceableTool[] }[] = [
  { id: 'basic', tools: ['resistor', 'variable-resistor', 'capacitor', 'inductor'] },
  { id: 'sources', tools: ['voltage-source', 'current-source', 'voltage-point'] },
  { id: 'active', tools: ['op-amp'] },
  { id: 'semiconductor', tools: ['diode', 'zener', 'led', 'npn', 'pnp'] },
  { id: 'connection', tools: ['wire', 'ground', 'switch'] },
  { id: 'measurement', tools: ['ammeter', 'voltmeter'] },
];

const toolButton = (tool: PlaceableTool): string => `
  <button class="tool" type="button" data-tool="${tool}" aria-pressed="false">
    ${tool === 'capacitor' && loadCapacitorStyle() === 'curved' ? icons.capacitorCurved : icons[tool]}
    <span>${tr.tools[tool]}</span>
  </button>`;

const editButton = (tool: 'select' | 'remove'): string => `
  <button class="edit-button" type="button" data-tool="${tool}" aria-pressed="false">
    ${icons[tool]}${tr.tools[tool]}
  </button>`;

const historyButton = (action: 'undo' | 'redo'): string => `
  <button class="edit-button" type="button" data-history="${action}">
    ${icons[action]}${tr.tools[action]}
  </button>`;

const GROUPS_KEY = 'devre-coz.closed-tool-groups';

function loadClosedGroups(): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveClosedGroups(closed: ReadonlySet<string>): void {
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify([...closed]));
  } catch {
    // The groups still fold; the choice just isn't remembered.
  }
}

function setupToolGroups(root: HTMLElement): void {
  const closed = loadClosedGroups();
  root.querySelectorAll<HTMLElement>('.tool-group').forEach((group) => {
    const id = group.dataset.group ?? '';
    const header = group.querySelector<HTMLButtonElement>('.tool-group-header')!;
    const apply = (): void => {
      const isClosed = closed.has(id);
      group.classList.toggle('closed', isClosed);
      header.setAttribute('aria-expanded', String(!isClosed));
    };
    header.addEventListener('click', () => {
      if (closed.has(id)) closed.delete(id);
      else closed.add(id);
      saveClosedGroups(closed);
      apply();
    });
    apply();
  });
}

const INSPECTOR_OPEN_KEY = 'devre-coz.inspector-open';

// Storage can throw or come back empty (private window, blocked site data).
function readInspectorOpen(): boolean {
  try {
    return localStorage.getItem(INSPECTOR_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveInspectorOpen(open: boolean): void {
  try {
    localStorage.setItem(INSPECTOR_OPEN_KEY, String(open));
  } catch {
    // The panel still works; the choice just isn't remembered.
  }
}

export interface PanelControls {
  readonly open: () => void;
}

function setupInspectorToggle(root: HTMLElement): PanelControls {
  const app = root.querySelector<HTMLElement>('.app')!;
  const panel = root.querySelector<HTMLElement>('#inspector')!;
  const toggle = root.querySelector<HTMLButtonElement>('#inspector-toggle')!;
  let open = readInspectorOpen();

  const apply = (): void => {
    app.classList.toggle('inspector-closed', !open);
    panel.hidden = !open;
    const label = open ? tr.inspector.hide : tr.inspector.show;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  };

  toggle.addEventListener('click', () => {
    open = !open;
    apply();
    saveInspectorOpen(open);
  });
  apply();
  return {
    open: () => {
      open = true;
      apply();
    },
  };
}

export function renderAppShell(root: HTMLElement): PanelControls {
  const exampleOptions = EXAMPLE_MENU_IDS.map(
    (id) => `<option value="${id}">${tr.examples[id]}</option>`,
  ).join('');

  root.innerHTML = `
    <div class="app">
      <header class="topbar">
        <strong class="brand">${tr.app.name}</strong>
        <span class="spacer"></span>
        <select id="examples" aria-label="${tr.actions.examples}">
          <option value="">${tr.actions.examples}</option>
          ${exampleOptions}
        </select>
        <button type="button" disabled title="${tr.soon}">${tr.actions.share}</button>
        <button id="save" type="button">${tr.actions.save}</button>
        <button id="open" type="button">${tr.actions.load}</button>
        <button id="clear" type="button">${tr.actions.clear}</button>
        <button id="shortcuts" type="button">${tr.actions.shortcuts}</button>
        <button id="solve" class="secondary" type="button"></button>
        <button id="run" class="primary" type="button"></button>
        <button id="inspector-toggle" class="icon-button" type="button" aria-controls="inspector">
          ${icons.panel}
        </button>
      </header>

      <nav class="toolbar" aria-label="${tr.tools.label}">
        ${TOOL_GROUPS.map(
          ({ id, tools }) => `
          <section class="tool-group" data-group="${id}">
            <button class="tool-group-header" type="button" aria-expanded="true">
              <svg class="icon chevron" viewBox="0 0 32 32" aria-hidden="true"><path d="m9 12 7 8 7-8"/></svg>
              ${tr.tools.groups[id]}
            </button>
            <div class="tool-grid">${tools.map(toolButton).join('')}</div>
          </section>`,
        ).join('')}
      </nav>

      <div class="edit-bar" role="group" aria-label="${tr.tools.editGroup}">
        ${editButton('select')}
        ${editButton('remove')}
        ${historyButton('undo')}
        ${historyButton('redo')}
      </div>

      <main class="canvas" aria-label="${tr.canvas.label}">
        <svg id="drawing" width="100%" height="100%">
          <defs>
            <pattern id="grid" width="${CELL_SIZE}" height="${CELL_SIZE}" patternUnits="userSpaceOnUse"
              patternTransform="translate(${-CELL_SIZE / 2} ${-CELL_SIZE / 2})">
              <circle class="grid-dot" cx="${CELL_SIZE / 2}" cy="${CELL_SIZE / 2}" r="1" />
            </pattern>
          </defs>
          <rect id="grid-rect" width="100%" height="100%" fill="url(#grid)" />
          <g id="items"></g>
          <g id="overlay"></g>
        </svg>
        <p id="canvas-empty" class="canvas-empty">${tr.canvas.empty}</p>
        <div class="zoom-controls" role="group" aria-label="${tr.view.label}">
          <button type="button" data-zoom="out" title="${tr.view.zoomOut}" aria-label="${tr.view.zoomOut}">−</button>
          <button type="button" data-zoom="reset" title="${tr.view.reset}" aria-label="${tr.view.reset}">
            <span id="zoom-level">%100</span>
          </button>
          <button type="button" data-zoom="in" title="${tr.view.zoomIn}" aria-label="${tr.view.zoomIn}">+</button>
          <button type="button" data-zoom="fit" title="${tr.view.fitHint}">${tr.view.fit}</button>
        </div>
      </main>

      <aside id="inspector" class="inspector">
        <div id="inspector-design">
          <section id="inspector-guide" class="inspector-guide" hidden>
            <h2>${tr.inspector.quickStart.title}</h2>
            <ol>${tr.inspector.quickStart.steps.map((step) => `<li>${step}</li>`).join('')}</ol>
            <div class="inspector-guide-hints">
              ${tr.inspector.quickStart.hints.map((hint) => `<p>${hint}</p>`).join('')}
            </div>
          </section>
          <div id="inspector-properties">
            <h2 id="inspector-title">${tr.inspector.title}</h2>
            <p id="inspector-note"></p>
            <dl id="inspector-results" class="results" hidden></dl>
            <div id="capacitor-style-setting" class="capacitor-style-setting" hidden>
              <label for="capacitor-style">${tr.inspector.capacitorDrawing}
                <select id="capacitor-style">
                  <option value="straight">${tr.inspector.capacitorStraight}</option>
                  <option value="curved">${tr.inspector.capacitorCurved}</option>
                </select>
              </label>
              <p>${tr.inspector.capacitorStyleNote}</p>
            </div>
            <button id="inspector-flip" class="panel-action" type="button" hidden>${tr.inspector.flip}</button>
          </div>
        </div>
        <div id="learn-panel" class="learn-panel" hidden></div>
      </aside>

      <footer id="status" class="status" role="status"></footer>
    </div>

    <dialog id="shortcuts-dialog" class="dialog" aria-labelledby="shortcuts-title"></dialog>`;

  setupToolGroups(root);
  return setupInspectorToggle(root);
}
