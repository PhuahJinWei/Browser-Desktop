/**
 * The boot splash, driven through the DOM.
 *
 * The splash has to exist before this bundle does, so it is static markup in index.html rather
 * than a component (see the comment there). That makes it the one piece of the desktop that React
 * does not own: this module reaches into those nodes, and the boot sequence in Shell.tsx calls it.
 *
 * Nothing here writes a step's label. Labels live in index.html, addressed by `data-step`, so the
 * markup that paints first is also the only copy.
 */

export type BootStepKey = 'isolation' | 'probe' | 'vfs' | 'search';
export type BootStepState = 'running' | 'done' | 'warn' | 'fail';

const STATUS_TEXT: Record<BootStepState, string> = {
  // Four periods rather than a word, because the leader dots either side make it read as a line
  // still being drawn. It is hidden from assistive technology: the transition worth announcing is
  // the one that follows it.
  running: '····',
  done: 'OK',
  warn: 'WARN',
  fail: 'FAIL',
};

function splash(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('boot-splash');
}

function stepNode(key: BootStepKey): HTMLElement | null {
  return splash()?.querySelector<HTMLElement>(`[data-step="${key}"]`) ?? null;
}

function paint(node: HTMLElement, state: BootStepState, detail?: string): void {
  node.dataset['state'] = state;

  const status = node.querySelector<HTMLElement>('.bs-status');
  if (status) {
    status.textContent = STATUS_TEXT[state];
    if (state === 'running') status.setAttribute('aria-hidden', 'true');
    else status.removeAttribute('aria-hidden');
  }

  if (detail !== undefined) {
    const node_ = node.querySelector<HTMLElement>('.bs-detail');
    if (node_) node_.textContent = detail;
  }
}

export function setBootStep(key: BootStepKey, state: BootStepState, detail?: string): void {
  const node = stepNode(key);
  if (node) paint(node, state, detail);
}

/**
 * Report a boot that did not finish.
 *
 * Whichever step was still running is the one that failed, so it is marked rather than left
 * blinking at a screen that is never going to advance.
 */
export function failBootSplash(message: string): void {
  const root = splash();
  if (!root) return;

  root.dataset['state'] = 'failed';

  root
    .querySelectorAll<HTMLElement>('[data-step][data-state="running"]')
    .forEach((node) => paint(node, 'fail'));

  const text = root.querySelector<HTMLElement>('.bs-failure-message');
  if (text) text.textContent = message;

  const reload = root.querySelector<HTMLButtonElement>('.bs-reload');
  if (reload) {
    reload.addEventListener('click', () => location.reload(), { once: true });
    reload.focus();
  }
}

/**
 * Take the splash down. Call this once the desktop is mounted underneath, never before: the fade
 * uncovers whatever is behind it, and that had better not be an empty page.
 */
export function dismissBootSplash(): void {
  const root = splash();
  if (!root) return;

  root.dataset['state'] = 'done';

  const remove = () => root.remove();
  root.addEventListener('transitionend', remove, { once: true });
  // Reduced motion removes the transition, and a transition that never runs never ends. This is
  // what actually removes the node in that case; a second remove() is a no-op.
  setTimeout(remove, 400);
}
