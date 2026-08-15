/**
 * Fetching a plan from a Google Drive share link.
 *
 * ## Why this goes through the server
 *
 * The obvious implementation is the Google Drive Picker, which needs an OAuth
 * client, a Google account, and third-party scripts from `apis.google.com`.
 * This app currently loads nothing from anywhere — the CSP in `server.js` is
 * `script-src 'self'` and `connect-src 'self'` — and giving that up to save a
 * copy-paste is a poor trade.
 *
 * So instead: the user shares the file with "anyone with the link", pastes the
 * link, and this proxy fetches it. No OAuth, no account, no third-party code,
 * and the browser still talks only to this origin.
 *
 * ## What this must not become
 *
 * A URL fetched by a server on behalf of a client is a server-side request
 * forgery primitive unless it is fenced in. This one is fenced in four ways:
 *
 * - The URL is not used as given. A Google file id is *extracted* from it, and
 *   a fresh URL is constructed from a fixed template. A link to an internal
 *   address cannot survive that, because there is nowhere in the template for
 *   it to go.
 * - Redirects are followed manually, and every hop must land on an allowlisted
 *   Google host. Drive redirects to `googleusercontent.com` to serve content,
 *   so redirects cannot simply be refused.
 * - The response is capped, so a large file cannot exhaust memory.
 * - The whole thing is on a timeout.
 */

/** Hosts a Drive download is allowed to touch, at any hop. */
const ALLOWED_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
  'googleusercontent.com',
]);

/** Plans are small. This is generous and still far from expensive. */
const MAX_BYTES = 512 * 1024;

const TIMEOUT_MS = 15_000;

/** Drive serves file content from a redirect, so a few hops are expected. */
const MAX_REDIRECTS = 5;

export class DriveError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

/** Whether a hostname is allowlisted, including subdomains of the bare entries. */
function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  if (ALLOWED_HOSTS.has(host)) return true;
  // `*.googleusercontent.com` — Drive serves bytes from numbered subdomains.
  return host.endsWith('.googleusercontent.com');
}

/**
 * Turn a share link into a direct-download URL.
 *
 * Returns `null` for anything that is not recognisably a Google file link.
 * Note that the returned URL is *built*, never the user's string — see the
 * SSRF note above.
 */
export function toDownloadUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (!isAllowedHost(url.hostname)) return null;

  // A native Google Doc has no downloadable bytes; it has to be exported.
  // Plans pasted into a Doc rather than saved as a file are common enough to
  // be worth handling, and plain text is exactly what the parser wants.
  const docMatch = url.pathname.match(/^\/document\/d\/([a-zA-Z0-9_-]{10,})/);
  if (docMatch) {
    return `https://docs.google.com/document/d/${docMatch[1]}/export?format=txt`;
  }

  const fileId = extractFileId(url);
  if (!fileId) return null;

  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

function extractFileId(url) {
  // https://drive.google.com/file/d/<id>/view?usp=sharing
  const pathMatch = url.pathname.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (pathMatch) return pathMatch[1];

  // https://drive.google.com/open?id=<id> and ?id= on the download endpoint
  const queryId = url.searchParams.get('id');
  if (queryId && /^[a-zA-Z0-9_-]{10,}$/.test(queryId)) return queryId;

  return null;
}

/**
 * Fetch the text of a shared plan file.
 *
 * Returns the body as a string. Throws `DriveError` with a message written for
 * the person who pasted the link — by far the likeliest failure is that they
 * forgot to make the file shareable, and saying so is more use than a status
 * code.
 */
export async function fetchDrivePlan(input) {
  const start = toDownloadUrl(input);
  if (!start) {
    throw new DriveError('That does not look like a Google Drive or Google Docs link.', 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await follow(start, controller.signal);

    if (response.status === 404) {
      throw new DriveError('Google could not find that file. Check the link.', 404);
    }
    if (response.status === 401 || response.status === 403) {
      throw new DriveError(
        'That file is not shared publicly. In Drive, choose Share, then "Anyone with the link".',
        403,
      );
    }
    if (!response.ok) {
      throw new DriveError(`Google returned ${response.status} for that link.`, 502);
    }

    const text = await readCapped(response);

    /*
     * An unshared file often answers 200 with Google's sign-in page rather
     * than a 403. Detecting that here turns a baffling "could not read the
     * plan" into the instruction that actually fixes it.
     */
    if (/^\s*<(?:!doctype|html)/i.test(text)) {
      throw new DriveError(
        'That link returned a Google web page rather than a file. Make sure it is shared with "Anyone with the link", and that it is a file rather than a folder.',
        403,
      );
    }

    return text;
  } catch (error) {
    if (error instanceof DriveError) throw error;
    if (error?.name === 'AbortError') throw new DriveError('Google took too long to respond.', 504);
    throw new DriveError(`Could not reach Google Drive: ${error?.message ?? 'unknown error'}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

/** Follow redirects by hand, checking the host at every hop. */
async function follow(startUrl, signal) {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: { accept: 'application/json, text/plain, */*' },
    });

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      // Resolved against the current URL, so a relative Location is handled.
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || !isAllowedHost(next.hostname)) {
        throw new DriveError('That link redirected somewhere unexpected, so it was not followed.', 502);
      }
      current = next.toString();
      continue;
    }

    return response;
  }

  throw new DriveError('That link redirected too many times.', 502);
}

/**
 * Read the body, refusing to buffer more than the cap.
 *
 * Streamed rather than `response.text()` so an oversized file is abandoned
 * partway instead of being read into memory in full and measured afterwards.
 */
async function readCapped(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new DriveError('That file is too large to be a training plan.', 413);
  }

  const body = response.body;
  if (!body) return '';

  const decoder = new TextDecoder();
  const reader = body.getReader();
  let total = 0;
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new DriveError('That file is too large to be a training plan.', 413);
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}
