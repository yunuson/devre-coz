import { tr } from '../i18n/tr';
import {
  ACTION_IDS,
  assignBinding,
  comboFromKey,
  DEFAULT_BINDINGS,
  type ActionId,
  type Bindings,
} from './shortcuts';

interface ShortcutsDialogOptions {
  readonly getBindings: () => Bindings;
  readonly setBindings: (bindings: Bindings) => void;
}

export interface ShortcutsDialog {
  readonly open: () => void;
  readonly isOpen: () => boolean;
}

export function setupShortcutsDialog(
  dialog: HTMLDialogElement,
  { getBindings, setBindings }: ShortcutsDialogOptions,
): ShortcutsDialog {
  let capturing: ActionId | null = null;
  let lastAction: ActionId | null = null;

  const render = (): void => {
    const bindings = getBindings();
    const rows = ACTION_IDS.map((action) => {
      const key = bindings[action];
      const text = capturing === action ? tr.shortcuts.pressKey : (key ?? tr.shortcuts.none);
      const clear = key
        ? `<button type="button" class="link-button" data-clear="${action}">${tr.shortcuts.clearKey}</button>`
        : '';
      return `<tr>
        <td>${tr.shortcuts.actions[action]}</td>
        <td><button type="button" class="key${capturing === action ? ' capturing' : ''}" data-capture="${action}">${text}</button></td>
        <td>${clear}</td>
      </tr>`;
    }).join('');

    dialog.innerHTML = `
      <h2 id="shortcuts-title">${tr.shortcuts.title}</h2>
      <p>${tr.shortcuts.hint}</p>
      <table class="shortcut-table"><tbody>${rows}</tbody></table>
      <div class="dialog-actions">
        <button type="button" data-reset>${tr.shortcuts.reset}</button>
        <button type="button" class="primary" data-close>${tr.shortcuts.close}</button>
      </div>`;

    // Rebuilding the table drops focus, so hand it back to keep keyboard use working.
    const focusTarget = capturing ?? lastAction;
    if (focusTarget) dialog.querySelector<HTMLButtonElement>(`[data-capture="${focusTarget}"]`)?.focus();
  };

  dialog.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('button');
    if (!button) return;
    const { capture, clear } = button.dataset;
    if (capture) {
      capturing = capture as ActionId;
      lastAction = capturing;
    } else if (clear) {
      capturing = null;
      lastAction = clear as ActionId;
      setBindings(assignBinding(getBindings(), lastAction, null));
    } else if ('reset' in button.dataset) {
      capturing = null;
      setBindings(DEFAULT_BINDINGS);
    } else if ('close' in button.dataset) {
      capturing = null;
      dialog.close();
      return;
    }
    render();
  });

  // Listens on the window, ahead of everything else, so the key is caught wherever focus is.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!capturing) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key !== 'Escape') {
        const combo = comboFromKey(event);
        if (!combo) return;
        setBindings(assignBinding(getBindings(), capturing, combo));
      }
      capturing = null;
      render();
    },
    true,
  );

  // Esc while waiting for a key cancels the capture, not the whole dialog.
  dialog.addEventListener('cancel', (event) => {
    if (capturing) {
      event.preventDefault();
      capturing = null;
      render();
    }
  });

  return {
    open: () => {
      capturing = null;
      lastAction = null;
      render();
      dialog.showModal();
    },
    isOpen: () => dialog.open,
  };
}
