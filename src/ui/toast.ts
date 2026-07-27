import { requireElement } from './dom';

/**
 * Transient status messages.
 *
 * The host element is an `aria-live` region, so messages reach screen readers
 * as well as eyes. `polite` is correct here: nothing announced is urgent enough
 * to interrupt what the user is already hearing.
 */

const VISIBLE_MS = 2200;

let hideTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string): void {
  const node = requireElement('#toast');
  node.textContent = message;
  node.classList.add('is-visible');

  if (hideTimer !== undefined) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    node.classList.remove('is-visible');
    // Clearing the text stops a screen reader re-announcing a stale message if
    // the region is re-read after it fades.
    node.textContent = '';
  }, VISIBLE_MS);
}
