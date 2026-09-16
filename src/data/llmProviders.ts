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
 * ## Who is listed, and who was removed
 *
 * Tested by hand against each product, and the list is shorter than it was
 * because two of them failed.
 *
 * Gemini opens on `?q=` and leaves the box empty, so the button promised the
 * one thing its neighbours deliver and then asked for a paste anyway. A
 * control that quietly does less than the identical control beside it is worse
 * than no control — "Copy prompt for your LLM" already serves Gemini honestly.
 *
 * Copilot has no deep link at all. `?q=`, `?prompt=`, `/chats?q=`, the
 * `sendquery`/`autosend` pairs and the old `bing.com/chat` entry point all
 * canonicalise to the bare origin with an empty box; a control fetch of the
 * same shape confirmed the parameter was not being lost in transit. There is
 * nothing here to fix, so it is gone rather than kept as a button that
 * silently does half its job.
 *
 * Grok prefills correctly and writes the plan, but will not call the MCP
 * server — which is true of every product on this list. That is a fact about
 * the return path, not about the launcher, and it is why the launchers are now
 * only half of this feature.
 *
 * Perplexity prefills correctly but could not fetch `/llms.txt`, so it answered
 * by asking for the long prompt. It stays pending a re-test now that
 * `robots.txt` is served — its 403 was the likeliest cause. If that was not it,
 * Perplexity goes: a launcher that reliably leads to "send me the long prompt"
 * is a round trip to a dead end.
 */

export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  /** Builds the URL that opens this provider with `prompt` in the box. */
  readonly link: (prompt: string) => string;
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
    id: 'perplexity',
    name: 'Perplexity',
    link: (prompt) => `https://www.perplexity.ai/search?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: 'grok',
    name: 'Grok',
    link: (prompt) => `https://grok.com/?q=${encodeURIComponent(prompt)}`,
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
