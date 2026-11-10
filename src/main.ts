import 'katex/dist/katex.min.css';
import './ui/styles.css';
import { renderAppShell } from './ui/app-shell';
import { mountEditor } from './ui/editor/editor';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app root element');
}

mountEditor(root, renderAppShell(root));
