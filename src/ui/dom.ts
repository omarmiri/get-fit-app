/**
 * DOM construction helpers.
 *
 * Every element in the app is built through these. There is no `innerHTML` and
 * no template-string HTML anywhere in `src/` — all text goes in as
 * `textContent`, so user-supplied strings (imported backups, custom modality
 * names) can never be interpreted as markup.
 */

export type Child = Node | string | number | false | null | undefined;

/**
 * Decide how one attribute value is written, or `null` to omit it entirely.
 *
 * ARIA and data attributes take the literal strings `"true"` / `"false"`.
 * Everything else follows the HTML boolean-attribute convention, where presence
 * means true and absence means false.
 *
 * The distinction is not cosmetic. `aria-pressed=""` is invalid, and omitting it
 * tells assistive technology the control is not a toggle at all rather than an
 * unpressed one. On the data side, a CSS selector like `[data-done='true']`
 * silently fails to match an attribute written as `data-done=""`.
 *
 * Exported so the rule can be tested without a DOM.
 */
export function serializeAttribute(
  key: string,
  value: string | number | boolean | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (key.startsWith('aria-') || key.startsWith('data-')) return String(value);
  if (value === false) return null;
  return value === true ? '' : String(value);
}

type EventMapOf<T extends Element> = T extends HTMLElement ? HTMLElementEventMap : ElementEventMap;

export interface ElementOptions<T extends Element> {
  readonly class?: string;
  readonly text?: string | number;
  readonly attrs?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly dataset?: Readonly<Record<string, string>>;
  /** Applied via `style.setProperty`, so custom properties like `--pc` work. */
  readonly style?: Readonly<Record<string, string>>;
  readonly on?: {
    readonly [K in keyof EventMapOf<T>]?: (event: EventMapOf<T>[K]) => void;
  };
}

/** Create an element with attributes, listeners and children in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions<HTMLElementTagNameMap[K]> = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyOptions(node, options);
  append(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element. Attributes are set verbatim, so `stroke-width` works. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string | number>> = {},
  children: readonly Child[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function applyOptions<T extends HTMLElement>(node: T, options: ElementOptions<T>): void {
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = String(options.text);

  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      const serialized = serializeAttribute(key, value);
      if (serialized === null) continue;
      node.setAttribute(key, serialized);
    }
  }

  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) node.dataset[key] = value;
  }

  if (options.style) {
    for (const [key, value] of Object.entries(options.style)) node.style.setProperty(key, value);
  }

  if (options.on) {
    for (const [type, handler] of Object.entries(options.on)) {
      node.addEventListener(type, handler as EventListener);
    }
  }
}

/** Append children, skipping falsy entries so conditionals can be written inline. */
export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Remove all children. Faster and safer than assigning `innerHTML = ''`. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Replace all children in one operation. */
export function replaceChildren(parent: Element, children: readonly Child[]): void {
  clear(parent);
  append(parent, children);
}

/** Query a required element, throwing if the markup and code have drifted apart. */
export function requireElement<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Required element not found: ${selector}`);
  return node;
}

/* --------------------------------------------------------------- shorthands */

/** A `div` with a class and optional children. The most common case by far. */
export function div(className: string, children: readonly Child[] = []): HTMLDivElement {
  return el('div', { class: className }, children);
}

/** A `div` carrying only text — labels, captions, values. */
export function text(className: string, content: string | number): HTMLDivElement {
  return el('div', { class: className, text: content });
}

/** The small uppercase placard label used throughout the design. */
export function eyebrow(content: string): HTMLDivElement {
  return text('eyebrow', content);
}

/** The standard bordered content card. */
export function card(children: readonly Child[] = [], extraClass = ''): HTMLDivElement {
  return div(extraClass ? `card ${extraClass}` : 'card', children);
}
