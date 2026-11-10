import katex from 'katex';
import { DEFAULT_KCL_CONVENTION, type KclConvention, type Solution, type SolutionStep } from '../../core';
import { tr } from '../../i18n/tr';
import { escapeHtml } from '../format';
import { mnaTex, stepView, type LabelOf, type ResultRow, type StepView } from './step-views';

type Solved = Extract<Solution, { status: 'solved' }>;

const CONVENTION_KEY = 'devre-coz.kcl-convention';

function loadConvention(): KclConvention {
  try {
    const saved = localStorage.getItem(CONVENTION_KEY);
    return saved === 'leaving-sum' || saved === 'entering-equals-leaving' ? saved : DEFAULT_KCL_CONVENTION;
  } catch {
    return DEFAULT_KCL_CONVENTION;
  }
}

function saveConvention(convention: KclConvention): void {
  try {
    localStorage.setItem(CONVENTION_KEY, convention);
  } catch {
    // The choice just isn't remembered.
  }
}

const renderTex = (tex: string): string =>
  katex.renderToString(tex, { displayMode: true, throwOnError: false, strict: false, output: 'html' });

export type PanelMessage = 'intro' | 'fix-first';

export interface DrawingExtras {
  /** An opening step for elements that become a wire or a gap in DC, if there are any. */
  readonly prelude: StepView | null;
  /** Readings of those elements, added to the table of results. */
  readonly rows: readonly ResultRow[];
}

export interface StepsPanel {
  /** Shows a solution, keeping the student's place when only a value or a name changed. */
  readonly setSolution: (solution: Solved, labelOf: LabelOf, extras: DrawingExtras) => void;
  /** Goes back to the message shown before solving, forgetting the place. */
  readonly clear: (message: PanelMessage) => void;
  readonly currentView: () => StepView | null;
}

export function createStepsPanel(container: HTMLElement, onChange: () => void): StepsPanel {
  let solution: Solved | null = null;
  let labelOf: LabelOf = (id) => id;
  let extras: DrawingExtras = { prelude: null, rows: [] };
  let message: PanelMessage = 'intro';
  let convention = loadConvention();
  let showMna = false;
  let current = 0;
  /** The furthest step reached. Later steps stay hidden, so the student can think first. */
  let reached = 0;

  const viewOf = (step: SolutionStep): StepView => {
    const view = stepView(step, convention, labelOf);
    return view.type === 'element-results' ? { ...view, rows: [...view.rows, ...extras.rows] } : view;
  };

  const views = (): readonly StepView[] => {
    const fromSteps = (solution?.steps ?? []).map(viewOf);
    return extras.prelude && solution ? [extras.prelude, ...fromSteps] : fromSteps;
  };

  function expandedStep(view: StepView, position: number): string {
    const lines = view.lines
      .map(
        (line) =>
          `${line.caption ? `<p class="step-caption">${escapeHtml(line.caption)}</p>` : ''}<div class="equation">${renderTex(line.tex)}</div>`,
      )
      .join('');

    const text = tr.learn.elements;
    const rows =
      view.rows.length > 0
        ? `<div class="result-table"><table>
            <thead><tr><th>${text.name}</th><th>${text.voltage}</th><th>${text.current}</th><th>${text.power}</th></tr></thead>
            <tbody>${view.rows
              .map(
                (row) =>
                  `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.voltage)}</td><td>${escapeHtml(row.current)}</td><td>${escapeHtml(row.power)}</td></tr>`,
              )
              .join('')}</tbody>
          </table></div>`
        : '';

    const facts = view.facts.map((fact) => `<p class="step-fact">${escapeHtml(fact)}</p>`).join('');
    const notes = view.notes.map((note) => `<p class="step-note">${escapeHtml(note)}</p>`).join('');

    // Shown on every step once asked for: the system holds no answers, so it spoils nothing.
    const mna =
      solution && showMna
        ? `<div class="mna-block">
            <p class="step-caption">${tr.learn.mnaTitle}</p>
            <div class="equation">${renderTex(mnaTex(solution.mna, labelOf))}</div>
            <p class="step-why">${tr.learn.mnaNote}</p>
          </div>`
        : '';

    return `<section class="step-current">
      <h3>${position + 1}. ${escapeHtml(view.title)}</h3>
      ${facts}${lines}${rows}${notes}
      <p class="step-why"><strong>${tr.learn.why}</strong> ${escapeHtml(view.why)}</p>
      ${mna}
    </section>`;
  }

  function render(): void {
    const advancedOptionsOpen = container.querySelector<HTMLDetailsElement>('.learn-options')?.open ?? false;
    if (!solution) {
      const text = message === 'intro' ? tr.learn.intro : tr.learn.fixFirst;
      container.innerHTML = `<h2>${tr.learn.panelTitle}</h2><p class="learn-message">${text}</p>`;
      return;
    }

    const all = views();
    const list = all
      .slice(0, reached + 1)
      .map((view, position) => {
        return position === current
          ? expandedStep(view, position)
          : `<button type="button" class="step-row" data-step="${position}">${position + 1}. ${escapeHtml(view.title)}</button>`;
      })
      .join('');

    const options = (value: KclConvention, label: string): string =>
      `<option value="${value}"${convention === value ? ' selected' : ''}>${label}</option>`;

    container.innerHTML = `
      <details class="learn-options"${advancedOptionsOpen ? ' open' : ''}>
        <summary>${tr.learn.advancedOptions}</summary>
        <div class="learn-options-content">
          <label>${tr.learn.conventionLabel}
            <select data-convention>
              ${options('entering-equals-leaving', tr.learn.enteringEqualsLeaving)}
              ${options('leaving-sum', tr.learn.leavingSum)}
            </select>
          </label>
          <label class="learn-check"><input type="checkbox" data-mna${showMna ? ' checked' : ''} /> ${tr.learn.showMna}</label>
        </div>
      </details>
      <div class="step-list">${list}</div>
      <div class="step-nav">
        <button type="button" data-previous${current === 0 ? ' disabled' : ''}>${tr.learn.previous}</button>
        <span>${tr.learn.stepOf.replace('{current}', String(current + 1)).replace('{total}', String(all.length))}</span>
        <button type="button" class="primary" data-next${current === all.length - 1 ? ' disabled' : ''}>${
          current === all.length - 1 ? tr.learn.finished : tr.learn.next
        }</button>
      </div>`;
  }

  const update = (): void => {
    render();
    onChange();
  };

  container.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.step !== undefined) {
      current = Number(button.dataset.step);
    } else if ('next' in button.dataset) {
      current = Math.min(current + 1, views().length - 1);
      reached = Math.max(reached, current);
    } else if ('previous' in button.dataset) {
      current = Math.max(current - 1, 0);
    } else {
      return;
    }
    update();
    container.querySelector('.step-current')?.scrollIntoView({ block: 'nearest' });
  });

  container.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if ('convention' in target.dataset) {
      convention = target.value as KclConvention;
      saveConvention(convention);
    } else if ('mna' in target.dataset) {
      showMna = (target as HTMLInputElement).checked;
    } else {
      return;
    }
    update();
  });

  render();

  return {
    setSolution: (next, nextLabelOf, nextExtras) => {
      solution = next;
      labelOf = nextLabelOf;
      extras = nextExtras;
      const last = views().length - 1;
      current = Math.min(current, last);
      reached = Math.min(reached, last);
      render();
    },
    clear: (nextMessage) => {
      solution = null;
      extras = { prelude: null, rows: [] };
      message = nextMessage;
      current = 0;
      reached = 0;
      render();
    },
    currentView: () => views()[current] ?? null,
  };
}
