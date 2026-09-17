/**
 * Chatbots that can be opened with the prompt already in the box.
 *
 * ## Why this is possible at all, and only just
 *
 * These providers accept the first message as a query parameter, which means
 * the app can hand someone a link instead of asking them to copy, switch apps
 * and paste. The catch is length: a URL is good for a few thousand characters
 * and the full specification is seventeen thousand, so only the short prompt
 * can travel this way — about 1.8kb once encoded.
 *
 * That only became viable when the short prompt learned to say where the spec
 * lives. A model opened with a short prompt and no way to find the format
 * would invent one. Now it fetches `/llms.txt`, which ChatGPT and Claude both
 * do, and which the ones that cannot are told to admit rather than guess.
 *
 * ## On the parameter names
 *
 * Undocumented, in the sense that none of these vendors promise them. They are
 * what the providers' own share and search integrations use, and they can
 * change without warning — so the app copies the prompt to the clipboard
 * before opening the link. If a parameter stops working the user lands on an
 * empty chat box with exactly the right thing already copied, which is the
 * failure this feature is meant to avoid anyway.
 *
 * ## Who is listed, and who is not
 *
 * Tested by hand against each product, and the list changes as they do.
 *
 * ChatGPT, Claude and Grok prefill and write a good week.
 *
 * Perplexity prefilled but never produced a usable plan, through two rounds of
 * testing and a `robots.txt` fix that ruled out the likeliest cause. A launcher
 * that reliably leads to "send me the long prompt" is a round trip to a dead
 * end, so it is gone.
 *
 * Copilot has no deep link at all. `?q=`, `?prompt=`, `/chats?q=`, the
 * `sendquery`/`autosend` pairs and the old `bing.com/chat` entry point all
 * canonicalise to the bare origin with an empty box; a control fetch of the
 * same shape confirmed the parameter was not being lost in transit. There is
 * nothing here to fix.
 *
 * Gemini is back, with its limitation stated rather than hidden. It keeps the
 * query parameter in the URL — unlike Copilot, which discards it — but does
 * not put it in the box, on `?q=`, `?text=` or `?prompt=`. It was dropped once
 * for exactly that, on the principle that a control which quietly does less
 * than the identical control beside it is worse than no control. The word there
 * was *quietly*: `launch` copies the prompt before opening any of these, so the
 * prompt is already on the clipboard, and `pastes` makes the button say so.
 * A button that asks for one paste and admits it is a fair offer; the same
 * button pretending to be its neighbours was not.
 */

export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  /** Builds the URL that opens this provider with `prompt` in the box. */
  readonly link: (prompt: string) => string;
  /**
   * Set when the product opens but does not accept the prompt, so the user has
   * to paste it. The app says so at the moment it opens rather than letting
   * them find an empty box and guess why.
   */
  readonly pastes?: boolean;
}

export const LLM_PROVIDERS: readonly LlmProvider[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    link: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: 'claude',
    name: 'Claude',
    link: (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: 'grok',
    name: 'Grok',
    link: (prompt) => `https://grok.com/?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    link: (prompt) => `https://gemini.google.com/app?q=${encodeURIComponent(prompt)}`,
    pastes: true,
  },
];

/**
 * The longest URL worth attempting.
 *
 * Browsers differ and the limit is nowhere near as low as the often-quoted
 * 2083 — but intermediaries cap too, and a truncated prompt is worse than no
 * prompt because the model answers the fragment as though it were the whole
 * request. Past this, the app offers the clipboard instead.
 */
export const MAX_LINK_LENGTH = 8000;

/** Whether a prompt is short enough to travel in a link. */
export function fitsInLink(provider: LlmProvider, prompt: string): boolean {
  return provider.link(prompt).length <= MAX_LINK_LENGTH;
}
